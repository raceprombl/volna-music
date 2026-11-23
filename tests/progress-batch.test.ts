import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressBatch, type ItemUpdate } from "../src/progress-batch";
import { TransferMeter } from "../src/transfer-meter";
afterEach(() => vi.useRealTimers());
describe("coalesced concurrent download progress", () => {
  it("updates telemetry while waiting for data and stops its heartbeat on close", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_items: ItemUpdate[])=>{});
    const batch = new ProgressBatch(send,450,new TransferMeter([]));
    await vi.advanceTimersByTimeAsync(900);
    expect(send).toHaveBeenCalledTimes(2);
    await batch.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("turns updates from five transfers into one write with their latest bytes", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_items: ItemUpdate[]) => {}),
      batch = new ProgressBatch(send);
    for (let bytes = 1; bytes <= 100; bytes++)
      for (let index = 0; index < 5; index++) batch.record(index, bytes, 100);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(450);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toEqual(
      Array.from({ length: 5 }, (_, index) => ({
        index,
        item: { bytes: 100, total: 100 },
      })),
    );
    await batch.close();
  });
  it("does not overwrite final tagged size with stale transfer bytes", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {}),
      batch = new ProgressBatch(send);
    batch.record(0, 90, 100);
    await batch.finish(0);
    await vi.advanceTimersByTimeAsync(450);
    expect(send).not.toHaveBeenCalled();
    await batch.close();
  });
  it("waits for an in-flight write before publishing final state", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const batch = new ProgressBatch(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    batch.record(0, 5, 100);
    await vi.advanceTimersByTimeAsync(450);
    let done = false;
    const finishing = batch.finish(0).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await finishing;
    expect(done).toBe(true);
    await batch.close();
  });
});
