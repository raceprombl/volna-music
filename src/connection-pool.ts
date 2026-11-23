type Waiting = {
  priority: number;
  signal: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (reason: unknown) => void;
  abort: () => void;
};
/** Shared by files, mirrors and multipart requests; never exceeds twenty-four requests by default. */
export class ConnectionPool {
  private active = 0;
  private queue: Waiting[] = [];
  constructor(private limit = 24) {}
  private lease() {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }
  tryAcquire() {
    return this.active < this.limit && !this.queue.length
      ? this.lease()
      : undefined;
  }
  acquire(signal: AbortSignal, priority = 1): Promise<() => void> {
    signal.throwIfAborted();
    if (this.active < this.limit && !this.queue.length)
      return Promise.resolve(this.lease());
    return new Promise((resolve, reject) => {
      const waiting: Waiting = {
        priority,
        signal,
        resolve,
        reject,
        abort: () => {
          this.queue = this.queue.filter((item) => item !== waiting);
          reject(signal.reason);
        },
      };
      this.queue.push(waiting);
      this.queue.sort((a, b) => a.priority - b.priority);
      signal.addEventListener("abort", waiting.abort, { once: true });
    });
  }
  private drain() {
    while (this.active < this.limit && this.queue.length) {
      const next = this.queue.shift()!;
      next.signal.removeEventListener("abort", next.abort);
      if (next.signal.aborted) {
        next.reject(next.signal.reason);
        continue;
      }
      next.resolve(this.lease());
    }
  }
}
