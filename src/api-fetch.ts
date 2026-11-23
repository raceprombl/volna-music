import { ApiRateLimiter, abortDelay, retryAfterMs } from "./api-rate";
import { rpc } from "./shared";
import { HttpError } from "./http-error";
export { HttpError } from "./http-error";
const local = new ApiRateLimiter();
let coordinator:
  | {
      acquire: (signal?: AbortSignal) => Promise<void>;
      defer: (ms: number) => void;
    }
  | undefined;
export function configureApiCoordinator(value: typeof coordinator) {
  coordinator = value;
}
export async function requestApiSlot(signal?: AbortSignal) {
  return permit(signal);
}
async function permit(signal?: AbortSignal) {
  if (coordinator) return coordinator.acquire(signal);
  if (!globalThis.chrome?.runtime?.id) return local.acquire(signal);
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      void rpc("API_CANCEL", { requestId }).catch(() => {});
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    void rpc("API_PERMIT", { requestId })
      .then(() => resolve(), reject)
      .finally(() => signal?.removeEventListener("abort", abort));
  });
  signal?.throwIfAborted();
}
async function backoff(ms: number) {
  if (coordinator) {
    coordinator.defer(ms);
    return;
  }
  if (globalThis.chrome?.runtime?.id) await rpc("API_BACKOFF", { ms });
  else local.defer(ms);
}
export async function apiFetch(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
) {
  signal ??= init.signal ?? undefined;
  const host = new URL(url).hostname;
  if (!/^api\.music\.yandex\.(?:ru|kz|com|by|uz|net)$/.test(host))
    throw new Error("Неподдерживаемый API-хост.");
  const attempts = ["GET", "HEAD"].includes(
    (init.method ?? "GET").toUpperCase(),
  )
    ? 3
    : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    await permit(signal);
    try {
      const response = await fetch(url, {
        ...init,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });
      if (
        response.status === 429 ||
        [502, 503, 504].includes(response.status)
      ) {
        const wait =
          retryAfterMs(response.headers.get("Retry-After")) ??
          1000 * 2 ** attempt + Math.floor(Math.random() * 250);
        await response.body?.cancel();
        if (attempt === attempts - 1)
          throw new HttpError(response.status, wait);
        if (response.status === 429) await backoff(wait);
        else await abortDelay(wait, signal);
        continue;
      }
      if (!response.ok) throw new HttpError(response.status);
      return response;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof HttpError || attempt === attempts - 1) throw error;
      if (
        !(error instanceof TypeError) &&
        !(error instanceof DOMException && error.name === "TimeoutError")
      )
        throw error;
      await abortDelay(500 * 2 ** attempt, signal);
    }
  }
  throw new Error("Сервис временно недоступен.");
}
