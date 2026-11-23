import type { Source } from "./types";
import { allowedMedia } from "./shared";
type Pending = {
  index: number;
  promise: Promise<Source>;
  resolve: (source: Source) => void;
  reject: (error: unknown) => void;
  priority: number;
};
/** A small API pool ahead of the independent CDN workers; URLs stay in RAM only. */
export class SourceBroker {
  private cache = new Map<number, { source: Source; expires: number }>();
  private failures = new Map<number, { error: unknown; expires: number }>();
  private pending = new Map<number, Pending>();
  private queue: Pending[] = [];
  private active = 0;
  private disposed = false;
  private controller = new AbortController();
  private abort = () => this.close();
  constructor(
    private count: number,
    private load: (index: number, signal: AbortSignal) => Promise<Source>,
    private signal: AbortSignal,
    private options = {
      parallel: 6,
      lookahead: 16,
      ttl: 300000,
      maxEntries: 200,
    },
    private clock = Date.now,
  ) {
    this.signal = AbortSignal.any([signal, this.controller.signal]);
    this.signal.addEventListener("abort", this.abort, { once: true });
  }
  get(index: number) {
    const promise = this.request(index, 0);
    for (
      let next = index + 1;
      next < Math.min(this.count, index + 1 + this.options.lookahead);
      next++
    )
      void this.request(next, 1).catch(() => {});
    return promise;
  }
  invalidate(index: number) {
    this.cache.delete(index);
    this.failures.delete(index);
  }
  private request(index: number, priority: number): Promise<Source> {
    if (this.disposed || this.signal.aborted)
      return Promise.reject(
        this.signal.reason ?? new DOMException("Отменено", "AbortError"),
      );
    const cached = this.cache.get(index);
    if (cached && cached.expires > this.clock()) {
      this.cache.delete(index);
      this.cache.set(index, cached);
      return Promise.resolve(cached.source);
    }
    this.cache.delete(index);
    const failure = this.failures.get(index);
    if (failure && failure.expires > this.clock())
      return Promise.reject(failure.error);
    this.failures.delete(index);
    const waiting = this.pending.get(index);
    if (waiting) {
      waiting.priority = Math.min(waiting.priority, priority);
      this.queue.sort((a, b) => a.priority - b.priority || a.index - b.index);
      return waiting.promise;
    }
    let resolve!: (value: Source) => void, reject!: (error: unknown) => void;
    const promise = new Promise<Source>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const task = { index, priority, promise, resolve, reject };
    this.pending.set(index, task);
    this.queue.push(task);
    void promise.catch(() => {});
    this.pump();
    return promise;
  }
  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority || a.index - b.index);
    while (
      !this.disposed &&
      this.active < this.options.parallel &&
      this.queue.length
    ) {
      const task = this.queue.shift()!;
      const untrack = () => {
        if (this.pending.get(task.index) === task)
          this.pending.delete(task.index);
      };
      this.active++;
      void Promise.resolve()
        .then(() => this.load(task.index, this.signal))
        .then(
          (source) => {
            untrack();
            if (this.disposed || this.signal.aborted) {
              task.reject(
                this.signal.reason ??
                  new DOMException("Отменено", "AbortError"),
              );
              return;
            }
            const urls = [
              ...new Set([source.url, ...(source.urls ?? [])]),
            ].filter(allowedMedia);
            if (!urls.length) {
              task.reject(
                new Error("Сервис вернул неподдерживаемый адрес файла."),
              );
              return;
            }
            const safe = { ...source, url: urls[0], urls };
            let expires = Math.min(
              this.clock() + this.options.ttl,
              source.expiresAt ?? Infinity,
            );
            for (const value of urls) {
              const raw = new URL(value).searchParams.get("expires");
              if (raw && /^\d+$/.test(raw))
                expires = Math.min(expires, Number(raw) * 1000 - 5000);
            }
            this.cache.set(task.index, { source: safe, expires });
            while (this.cache.size > this.options.maxEntries)
              this.cache.delete(this.cache.keys().next().value!);
            task.resolve(safe);
          },
          (error) => {
            untrack();
            if (!this.disposed) {
              this.failures.set(task.index, {
                error,
                expires: this.clock() + 5000,
              });
              while (this.failures.size > this.options.maxEntries)
                this.failures.delete(this.failures.keys().next().value!);
            }
            task.reject(error);
          },
        )
        .finally(() => {
          untrack();
          this.active--;
          this.pump();
        });
    }
  }
  close() {
    if (this.disposed) return;
    this.disposed = true;
    this.signal.removeEventListener("abort", this.abort);
    this.cache.clear();
    this.failures.clear();
    this.controller.abort(new DOMException("Очередь закрыта", "AbortError"));
    for (const task of this.pending.values())
      task.reject(
        this.signal.reason ?? new DOMException("Очередь закрыта", "AbortError"),
      );
    this.pending.clear();
    this.queue = [];
  }
}
