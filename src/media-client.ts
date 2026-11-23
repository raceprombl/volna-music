import { ConnectionPool } from "./connection-pool";
import { abortDelay, retryAfterMs } from "./api-rate";
import { HttpError } from "./http-error";
import { allowedMedia, coverUrl } from "./shared";
type Progress = (bytes: number, total: number) => Promise<unknown> | void;
export type MediaOptions = {
  attempts?: number;
  multipart?: number;
  priority?: number;
  hedgeMs?: number;
};
type Opened = { response: Response; url: string; dispose: () => void };
class RangeIntegrityError extends Error {}
function contentRange(value: string | null) {
  const match = value?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!match) return undefined;
  const [start, end, total] = match.slice(1).map(Number);
  if (
    ![start, end, total].every(Number.isSafeInteger) ||
    start < 0 ||
    end < start ||
    total <= end
  )
    return undefined;
  return { start, end, total };
}
function validator(response: Response) {
  const etag = response.headers.get("ETag");
  if (etag && !etag.startsWith("W/")) return etag;
  const date = response.headers.get("Last-Modified");
  return date && Number.isFinite(Date.parse(date)) ? date : undefined;
}
function identity(response: Response) {
  const encoding = response.headers.get("Content-Encoding");
  return !encoding || encoding.toLowerCase() === "identity";
}
function retriable(error: unknown) {
  return (
    error instanceof TypeError ||
    error instanceof RangeIntegrityError ||
    (error instanceof DOMException &&
      ["TimeoutError", "NetworkError"].includes(error.name)) ||
    (error instanceof HttpError &&
      [408, 429, 500, 502, 503, 504].includes(error.status))
  );
}
/** One browser HTTP client and shared connection budget for every media request. */
export class MediaClient {
  constructor(
    private pool = new ConnectionPool(24),
    private http: typeof fetch = (...args) => fetch(...args),
    private allow = (url: string) => allowedMedia(url) || !!coverUrl(url),
  ) {}
  private open(
    urls: string[],
    headers: Headers,
    signal: AbortSignal,
    priority: number,
    hedgeMs: number,
  ): Promise<Opened> {
    signal.throwIfAborted();
    urls = [...new Set(urls)].filter(this.allow).slice(0, 8);
    if (!urls.length)
      return Promise.reject(
        new Error("Сервис вернул неподдерживаемый адрес файла."),
      );
    return new Promise((resolve, reject) => {
      let done = false,
        next = 0,
        active = 0,
        lastError: unknown,
        timer: ReturnType<typeof setTimeout> | undefined;
      const controls = new Set<AbortController>();
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        if (done) return;
        done = true;
        finish();
        for (const controller of controls) controller.abort(signal.reason);
        reject(signal.reason);
      };
      const launch = (reserved?: () => void) => {
        if (done || next >= urls.length) {
          reserved?.();
          return;
        }
        const url = urls[next++],
          controller = new AbortController();
        controls.add(controller);
        active++;
        const joined = AbortSignal.any([signal, controller.signal]);
        void (async () => {
          const release =
            reserved ?? (await this.pool.acquire(joined, priority));
          const releaseOnAbort = () => release();
          joined.addEventListener("abort", releaseOnAbort, { once: true });
          let response: Response | undefined;
          const dispose = () => {
            joined.removeEventListener("abort", releaseOnAbort);
            controller.abort();
            void response?.body?.cancel().catch(() => {});
            release();
          };
          try {
            joined.throwIfAborted();
            response = await this.http(url, {
              headers,
              signal: joined,
              credentials: "omit",
              cache: "no-store",
              redirect: "error",
            });
            if (!response.ok) {
              const error = new HttpError(
                response.status,
                retryAfterMs(response.headers.get("Retry-After")),
              );
              dispose();
              throw error;
            }
            if (done) {
              dispose();
              return;
            }
            done = true;
            finish();
            for (const other of controls)
              if (other !== controller)
                other.abort(
                  new DOMException("Выбрано другое зеркало", "AbortError"),
                );
            resolve({ response, url, dispose });
          } catch (error) {
            dispose();
            throw error;
          }
        })().catch((error) => {
          if (done) return;
          if (error instanceof HttpError && error.status === 429) {
            done = true;
            finish();
            for (const other of controls) other.abort(error);
            reject(error);
            return;
          }
          lastError = error;
          active--;
          if (next < urls.length) launch();
          else if (active === 0) {
            done = true;
            finish();
            reject(lastError);
          }
        });
      };
      signal.addEventListener("abort", abort, { once: true });
      launch();
      if (urls.length > 1)
        timer = setTimeout(() => {
          if (!done && next < urls.length) {
            const slot = this.pool.tryAcquire();
            if (slot) launch(slot);
          }
        }, hedgeMs);
    });
  }
  async download(
    urls: string[],
    signal: AbortSignal,
    onProgress?: Progress,
    limit = 150 * 1024 * 1024,
    options: MediaOptions = {},
  ): Promise<Uint8Array> {
    signal.throwIfAborted();
    if ((options.multipart ?? 1) > 1) {
      const segmented = await this.multipart(
        urls,
        signal,
        onProgress,
        limit,
        options,
      );
      if (segmented) return segmented;
    }
    return this.read(urls, signal, onProgress, limit, options);
  }
  private async read(
    urls: string[],
    signal: AbortSignal,
    onProgress: Progress | undefined,
    limit: number,
    options: MediaOptions,
    range?: { start: number; end: number; total: number; tag: string },
    destination?: Uint8Array,
  ): Promise<Uint8Array> {
    const attempts = Math.max(1, Math.min(4, options.attempts ?? 4));
    let size = 0,
      total = range ? range.end - range.start + 1 : 0,
      tag = range?.tag;
    let buffer: Uint8Array | undefined =
        destination && destination.length === total ? destination : undefined,
      chunks: Uint8Array[] = [];
    let currentUrls = urls;
    const reset = () => {
      size = 0;
      total = range ? range.end - range.start + 1 : 0;
      buffer =
        destination && destination.length === total ? destination : undefined;
      chunks = [];
      if (!range) tag = undefined;
    };
    const output = () => {
      if (buffer) return buffer.subarray(0, size);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    };
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal.throwIfAborted();
      const idle = new AbortController(),
        active = AbortSignal.any([signal, idle.signal]);
      let timer: ReturnType<typeof setTimeout> | undefined,
        opened: Opened | undefined,
        reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            idle.abort(
              new DOMException(
                "Передача не отвечает 45 секунд.",
                "TimeoutError",
              ),
            ),
          45000,
        );
      };
      const cancel = () => {
        void reader?.cancel(active.reason).catch(() => {});
      };
      active.addEventListener("abort", cancel, { once: true });
      try {
        if (size && !tag) reset();
        const headers = new Headers();
        if (range || size) {
          headers.set(
            "Range",
            `bytes=${(range?.start ?? 0) + size}-${range?.end ?? ""}`,
          );
          if (tag) headers.set("If-Range", tag);
        }
        touch();
        opened = await this.open(
          currentUrls,
          headers,
          active,
          options.priority ?? 1,
          options.hedgeMs ?? 300,
        );
        const response = opened.response,
          ranged = headers.has("Range"),
          receivedTag = validator(response);
        if (response.status === 206) {
          const info = contentRange(response.headers.get("Content-Range"));
          if (
            !info ||
            !identity(response) ||
            info.start !== (range?.start ?? 0) + size ||
            (range && (info.end > range.end || info.total !== range.total)) ||
            (tag && receivedTag && tag !== receivedTag)
          )
            throw new RangeIntegrityError(
              "Сервер вернул несовместимый диапазон аудио. Повторите загрузку.",
            );
          if (!range && total && info.total !== total)
            throw new RangeIntegrityError(
              "Размер файла изменился при дозагрузке.",
            );
          total = range ? range.end - range.start + 1 : info.total;
        } else {
          if (range)
            throw new RangeIntegrityError(
              "Сервер не поддерживает параллельные диапазоны.",
            );
          if (ranged) reset();
          total = identity(response)
            ? Number(response.headers.get("Content-Length")) || 0
            : 0;
        }
        if (!range) tag = receivedTag;
        if (total > limit)
          throw new Error("Файл слишком большой для обработки в браузере.");
        if (total && !buffer) {
          buffer = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            buffer.set(chunk, offset);
            offset += chunk.length;
          }
          chunks = [];
        }
        reader = response.body?.getReader();
        if (!reader) throw new Error("Не удалось прочитать файл.");
        let last = 0;
        touch();
        while (true) {
          const { done, value } = await reader.read();
          active.throwIfAborted();
          if (done) break;
          touch();
          if (size + value.length > limit) {
            if (range)
              throw new RangeIntegrityError(
                "Сервер прислал данные вне запрошенного диапазона.",
              );
            throw new Error("Достигнут лимит размера файла.");
          }
          if (total && size + value.length > total)
            throw new RangeIntegrityError(
              "Сервер прислал больше данных, чем указал.",
            );
          if (buffer) buffer.set(value, size);
          else chunks.push(value);
          size += value.length;
          if (Date.now() - last > 450) {
            last = Date.now();
            await onProgress?.(size, total);
          }
        }
        if (total && size !== total)
          throw new TypeError("Connection ended before the file completed");
        await onProgress?.(size, total || size);
        return output();
      } catch (error) {
        signal.throwIfAborted();
        let reason = active.aborted ? active.reason : error;
        if (
          reason instanceof HttpError &&
          reason.status === 416 &&
          (size || range)
        )
          reason = new RangeIntegrityError(
            "Диапазон устарел. Файл будет получен заново.",
          );
        if (reason instanceof RangeIntegrityError) {
          reset();
          if (range) throw reason;
        }
        if (attempt === attempts - 1 || !retriable(reason)) throw reason;
        const previous = opened?.url;
        opened?.dispose();
        opened = undefined;
        clearTimeout(timer);
        if (previous)
          currentUrls = [...urls.filter((url) => url !== previous), previous];
        else if (currentUrls.length > 1)
          currentUrls = [...currentUrls.slice(1), currentUrls[0]];
        const wait =
          reason instanceof HttpError && reason.retryAfter !== undefined
            ? reason.retryAfter
            : 500 * 2 ** attempt + Math.floor(Math.random() * 150);
        await abortDelay(wait, signal);
      } finally {
        clearTimeout(timer);
        active.removeEventListener("abort", cancel);
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
        opened?.dispose();
      }
    }
    throw new Error("Не удалось скачать аудио после повторных попыток.");
  }
  private async multipart(
    urls: string[],
    signal: AbortSignal,
    onProgress: Progress | undefined,
    limit: number,
    options: MediaOptions,
  ) {
    let probe: Opened | undefined;
    try {
      probe = await this.open(
        urls,
        new Headers({ Range: "bytes=0-0" }),
        AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        options.priority ?? 0,
        options.hedgeMs ?? 300,
      );
      const info = contentRange(probe.response.headers.get("Content-Range")),
        tag = validator(probe.response);
      if (
        probe.response.status !== 206 ||
        !info ||
        info.start !== 0 ||
        info.end !== 0 ||
        !tag ||
        !identity(probe.response)
      )
        return undefined;
      if (info.total > limit)
        throw new Error("Файл слишком большой для обработки в браузере.");
      if (info.total < 2 * 1024 * 1024) return undefined;
      probe.dispose();
      probe = undefined;
      const maxParts = Math.max(2, Math.floor(info.total / (512 * 1024)));
      const count = Math.min(
          maxParts,
          Math.max(2, Math.min(8, options.multipart ?? 4)),
        ),
        width = Math.ceil(info.total / count),
        sizes = new Array(count).fill(0);
      const controller = new AbortController(),
        joined = AbortSignal.any([signal, controller.signal]);
      const bytes = new Uint8Array(info.total);
      const tasks = Array.from({ length: count }, async (_, part) => {
        const start = part * width,
          end = Math.min(info.total - 1, start + width - 1);
        try {
          return await this.read(
            [
              ...urls.slice(part % urls.length),
              ...urls.slice(0, part % urls.length),
            ],
            joined,
            (partBytes) => {
              sizes[part] = partBytes;
              return onProgress?.(
                sizes.reduce((a, b) => a + b, 0),
                info.total,
              );
            },
            end - start + 1,
            { ...options, multipart: 1, priority: 0 },
            { start, end, total: info.total, tag },
            bytes.subarray(start, end + 1),
          );
        } catch (error) {
          controller.abort(error);
          throw error;
        }
      });
      const results = await Promise.allSettled(tasks),
        failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        signal.throwIfAborted();
        if (failure.reason instanceof RangeIntegrityError) {
          await onProgress?.(0, info.total);
          return undefined;
        }
        throw failure.reason;
      }
      await onProgress?.(bytes.length, bytes.length);
      return bytes;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof HttpError && error.status === 429) {
        await abortDelay(error.retryAfter ?? 1000, signal);
        return undefined;
      }
      if (
        error instanceof HttpError ||
        (error instanceof DOMException && error.name === "TimeoutError") ||
        error instanceof TypeError
      )
        return undefined;
      throw error;
    } finally {
      probe?.dispose();
    }
  }
}
