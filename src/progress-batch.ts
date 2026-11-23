import type { QueueItem } from "./types";
import type { TransferMeter } from "./transfer-meter";

export type ItemUpdate = { index: number; item: Partial<QueueItem> };
/** One storage update for all concurrent transfers, with no stale final progress. */
export class ProgressBatch {
  private pending = new Map<number, { bytes: number; total: number }>();
  private pendingStatus = new Map<number, Partial<QueueItem>>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private failure: unknown;
  private closed = false;
  private flushing = false;
  constructor(
    private send: (items: ItemUpdate[]) => Promise<unknown>,
    private interval = 450,
    private meter?: TransferMeter,
  ) {
    if (meter) this.schedule();
  }
  private schedule() {
    if (this.closed || this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flushing = true;
      void this.flush()
        .catch(() => {})
        .finally(() => {
          this.flushing = false;
          if (this.meter || this.pending.size || this.pendingStatus.size)
            this.schedule();
        });
    }, this.interval);
  }
  record(index: number, bytes: number, total: number) {
    if (this.closed) return;
    if (this.failure) throw this.failure;
    this.meter?.record(index, bytes, total);
    this.pending.set(index, { bytes, total });
    this.schedule();
  }
  stage(index: number, patch: Partial<QueueItem>) {
    if (this.closed) return;
    if (this.failure) throw this.failure;
    this.pendingStatus.set(index, {
      ...this.pendingStatus.get(index),
      ...patch,
    });
    this.schedule();
  }
  private flush() {
    const indices = new Set([
      ...this.pendingStatus.keys(),
      ...this.pending.keys(),
    ]);
    const items: ItemUpdate[] = [...indices].map((index) => {
      const statusPatch = this.pendingStatus.get(index);
      const bytesPatch = this.pending.get(index);
      return {
        index,
        item:
          statusPatch?.status === "ready"
            ? { ...bytesPatch, ...statusPatch }
            : { ...statusPatch, ...bytesPatch },
      };
    });
    this.pendingStatus.clear();
    this.pending.clear();
    if (items.length || this.meter) {
      this.tail = this.tail.then(() => this.send(items));
      void this.tail.catch((error) => {
        this.failure = error;
      });
    }
    return this.tail;
  }
  async finish(index: number) {
    this.meter?.finish(index);
    // Final bytes/status are written by workItem, including any tagging changes.
    this.pending.delete(index);
    this.pendingStatus.delete(index);
    await this.tail;
    if (this.failure) throw this.failure;
  }
  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending.clear();
    if (this.pendingStatus.size) {
      const items = [...this.pendingStatus].map(([index, item]) => ({
        index,
        item,
      }));
      this.pendingStatus.clear();
      this.tail = this.tail.then(() => this.send(items));
      void this.tail.catch((error) => {
        this.failure = error;
      });
    }
    await this.tail;
  }
}
