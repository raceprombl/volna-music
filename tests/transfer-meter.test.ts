import { describe, expect, it } from "vitest";
import {
  TransferMeter,
  formatBytes,
  transferInfo,
} from "../src/transfer-meter";
import { defaults, type Job, type QueueItem } from "../src/types";
const items = (durations: number[]) =>
  durations.map((duration, index) => ({
    track: { id: String(index), title: "Track", artists: "A", duration },
    status: "queued",
    bytes: 0,
    total: 0,
  })) as QueueItem[];
describe("real transfer speed and estimated remaining time", () => {
  it("aggregates five transfers without counting unchanged progress twice", () => {
    let now = 0;
    const meter = new TransferMeter(
      items([100, 100, 100, 100, 100]),
      () => now,
    );
    for (let i = 0; i < 5; i++) {
      meter.record(i, 100, 1000);
      meter.record(i, 100, 1000);
    }
    now = 1000;
    const data = meter.snapshot();
    expect(data.receivedBytes).toBe(500);
    expect(data.bytesPerSecond).toBe(500);
    expect(data.totalBytes).toBe(5000);
    expect(data.remainingSeconds).toBe(9);
    expect(data.estimated).toBe(false);
  });
  it("estimates unstarted tracks using their duration and known file sizes", () => {
    let now = 0;
    const meter = new TransferMeter(items([100, 200]), () => now);
    meter.record(0, 500, 1000);
    now = 1000;
    const data = meter.snapshot();
    expect(data.totalBytes).toBe(3000);
    expect(data.estimated).toBe(true);
    expect(data.remainingSeconds).toBe(5);
  });
  it("does not invent a remaining time before any size is known", () => {
    const data = new TransferMeter(items([100, 200])).snapshot();
    expect(data.totalBytes).toBeUndefined();
    expect(data.remainingSeconds).toBeUndefined();
    expect(data.bytesPerSecond).toBeUndefined();
  });
  it("uses final byte counts for chunked responses and excludes failed tracks from the remaining work", () => {
    let now = 0;
    const meter = new TransferMeter(items([100, 100]), () => now);
    meter.record(0, 100, 100);
    meter.finish(0);
    meter.skip(1);
    now = 1000;
    const data = meter.snapshot();
    expect(data.receivedBytes).toBe(100);
    expect(data.pendingTracks).toBe(0);
    expect(data.totalBytes).toBe(100);
    expect(data.remainingSeconds).toBeUndefined();
  });
  it("decays speed to zero on a stalled connection", () => {
    let now = 0;
    const meter = new TransferMeter(items([100]), () => now);
    meter.record(0, 100, 1000);
    now = 1000;
    expect(meter.snapshot().bytesPerSecond).toBe(100);
    now = 9000;
    meter.snapshot();
    now = 17000;
    expect(meter.snapshot().bytesPerSecond).toBe(0);
    expect(meter.snapshot().remainingSeconds).toBeUndefined();
  });
  it("does not subtract traffic when a source restarts from zero", () => {
    const meter = new TransferMeter(items([100]));
    meter.record(0, 100, 1000);
    meter.record(0, 10, 1000);
    expect(meter.snapshot().receivedBytes).toBe(110);
  });
  it("formats speed, approximate time and bytes without showing a stale estimate during ZIP saving", () => {
    const job: Job = {
      id: "x",
      created: 0,
      updated: 0,
      title: "Test",
      status: "running",
      settings: defaults,
      items: items([100]),
      transfer: {
        receivedBytes: 1024 ** 2,
        totalBytes: 3 * 1024 ** 2,
        estimated: true,
        bytesPerSecond: 1024 ** 2,
        remainingSeconds: 2,
        pendingTracks: 1,
        updatedAt: 1000,
      },
    };
    expect(transferInfo(job, 1000)).toMatchObject({
      speed: "1 МБ/с",
      remaining: "Осталось ≈ 2 с",
    });
    expect(transferInfo(job, 1000).volume).toContain("из ≈ 3 МБ");
    expect(transferInfo(job, 5000).speed).toBe("Обновляем скорость…");
    job.status = "packing";
    expect(transferInfo(job, 5000).speed).toBe("Сохраняем ZIP");
    expect(transferInfo(job, 5000).remaining).not.toContain("2 с");
    job.status = "complete";
    expect(transferInfo(job, 5000).remaining).toBe("");
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 ГБ");
  });
});
