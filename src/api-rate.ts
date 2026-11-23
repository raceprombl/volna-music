export function abortDelay(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
/** Global, FIFO start spacing with adaptive backoff on rate limits. */
export class ApiRateLimiter {
  private next = 0;
  private blockedUntil = 0;
  private currentInterval: number;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private interval = 75,
    private clock = Date.now,
  ) {
    this.currentInterval = interval;
  }
  defer(ms: number) {
    this.currentInterval = Math.min(
      350,
      Math.max(this.interval, this.currentInterval * 2),
    );
    this.blockedUntil = Math.max(
      this.blockedUntil,
      this.clock() + Math.max(0, Math.min(120000, ms)),
    );
  }
  acquire(signal?: AbortSignal) {
    const task = this.tail.then(async () => {
      signal?.throwIfAborted();
      while (true) {
        const wait = Math.max(this.next, this.blockedUntil) - this.clock();
        if (wait <= 0) break;
        await abortDelay(wait, signal);
      }
      signal?.throwIfAborted();
      this.currentInterval = Math.max(
        this.interval,
        this.currentInterval - 25,
      );
      this.next = this.clock() + this.currentInterval;
    });
    this.tail = task.catch(() => {});
    return task;
  }
}
export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return undefined;
  const ms = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(120000, ms)) : undefined;
}
