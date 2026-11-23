import { afterEach, describe, it, expect, vi } from "vitest";
import { ApiRateLimiter, retryAfterMs } from "../src/api-rate";
import { apiFetch, configureApiCoordinator } from "../src/api-fetch";
import { ConnectionPool } from "../src/connection-pool";
import { SourceBroker } from "../src/source-broker";
afterEach(() => {
  configureApiCoordinator(undefined);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("global API rate and backoff", () => {
  it("spaces simultaneous requests without a start burst", async () => {
    vi.useFakeTimers();
    const start = Date.now(),
      gate = new ApiRateLimiter(),
      times: number[] = [];
    const tasks = Array.from({ length: 5 }, async () => {
      await gate.acquire();
      times.push(Date.now() - start);
    });
    await vi.advanceTimersByTimeAsync(300);
    await Promise.all(tasks);
    expect(times).toEqual([0, 75, 150, 225, 300]);
  });
  it("steps up spacing on defer and gradually recovers to fast pacing", async () => {
    vi.useFakeTimers();
    const start = Date.now(),
      gate = new ApiRateLimiter(),
      times: number[] = [];
    await gate.acquire();
    times.push(Date.now() - start);
    gate.defer(0);
    gate.defer(0);
    const second = gate.acquire().then(() => times.push(Date.now() - start));
    await vi.advanceTimersByTimeAsync(75);
    await second;
    const third = gate.acquire().then(() => times.push(Date.now() - start));
    await vi.advanceTimersByTimeAsync(274);
    expect(times).toEqual([0, 75]);
    await vi.advanceTimersByTimeAsync(1);
    await third;
    expect(times).toEqual([0, 75, 350]);
  });
  it("applies a cooldown to requests already waiting", async () => {
    vi.useFakeTimers();
    const gate = new ApiRateLimiter();
    await gate.acquire();
    let done = false;
    const waiting = gate.acquire().then(() => {
      done = true;
    });
    gate.defer(2000);
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });
  it("removes a cancelled waiter without consuming another permit", async () => {
    vi.useFakeTimers();
    const gate = new ApiRateLimiter();
    await gate.acquire();
    const controller = new AbortController();
    const cancelled = expect(
      gate.acquire(controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await cancelled;
    const next = gate.acquire();
    await vi.advanceTimersByTimeAsync(75);
    await next;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honours Retry-After before retrying a 429", async () => {
    vi.useFakeTimers();
    const gate = new ApiRateLimiter();
    configureApiCoordinator({
      acquire: (s) => gate.acquire(s),
      defer: (n) => gate.defer(n),
    });
    const http = vi.fn(async () =>
      http.mock.calls.length === 1
        ? new Response("limited", {
            status: 429,
            headers: { "Retry-After": "2" },
          })
        : new Response("ok"),
    );
    vi.stubGlobal("fetch", http);
    const task = apiFetch("https://api.music.yandex.ru/get-file-info");
    await vi.advanceTimersByTimeAsync(0);
    expect(http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await (await task).text()).toBe("ok");
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("does not retry a mutation and parses both Retry-After forms", async () => {
    configureApiCoordinator({ acquire: async () => {}, defer: () => {} });
    const http = vi.fn(async () => new Response("error", { status: 503 }));
    vi.stubGlobal("fetch", http);
    await expect(
      apiFetch("https://api.music.yandex.ru/path", { method: "POST" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(http).toHaveBeenCalledOnce();
    expect(retryAfterMs("3", 0)).toBe(3000);
    expect(retryAfterMs("Thu, 01 Jan 1970 00:00:05 GMT", 0)).toBe(5000);
    expect(retryAfterMs("invalid", 0)).toBeUndefined();
  });
});
describe("independent CDN connection pool", () => {
  it("limits all requests to eight and releases cancelled waiters", async () => {
    const pool = new ConnectionPool(8),
      signal = new AbortController().signal,
      release = await Promise.all(
        Array.from({ length: 8 }, () => pool.acquire(signal)),
      );
    expect(pool.tryAcquire()).toBeUndefined();
    const controller = new AbortController();
    const check = expect(pool.acquire(controller.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
    controller.abort();
    await check;
    let got = false;
    const waiting = pool.acquire(signal).then((done) => {
      got = true;
      done();
    });
    await Promise.resolve();
    expect(got).toBe(false);
    release[0]();
    await waiting;
    release.forEach((done) => done());
    expect(pool.tryAcquire()).toBeTypeOf("function");
  });
  it("lets a selected track overtake background waiters", async () => {
    const pool = new ConnectionPool(1),
      signal = new AbortController().signal,
      release = await pool.acquire(signal),
      order: number[] = [];
    const background = pool.acquire(signal, 2).then((done) => {
      order.push(2);
      done();
    });
    const priority = pool.acquire(signal, 0).then((done) => {
      order.push(0);
      done();
    });
    release();
    await Promise.all([background, priority]);
    expect(order).toEqual([0, 2]);
  });
});
describe("RAM URL broker", () => {
  it("does not resolve a failed prefetched URL twice immediately", async () => {
    const load = vi.fn(async () => {
        throw Error("unavailable");
      }),
      broker = new SourceBroker(1, load, new AbortController().signal);
    await expect(broker.get(0)).rejects.toThrow("unavailable");
    await expect(broker.get(0)).rejects.toThrow("unavailable");
    expect(load).toHaveBeenCalledOnce();
    broker.close();
  });
  const source = (index: number) => ({
    url: `https://fixture.storage.yandex.net/${index}.mp3`,
    codec: "mp3",
    bitrate: 320,
  });
  it("deduplicates resolve calls and refreshes expired links", async () => {
    let now = 0;
    const load = vi.fn(async (index: number) => source(index)),
      broker = new SourceBroker(
        1,
        load,
        new AbortController().signal,
        undefined,
        () => now,
      );
    const first = broker.get(0),
      second = broker.get(0);
    expect(await first).toEqual(await second);
    expect(load).toHaveBeenCalledOnce();
    now = 300001;
    await broker.get(0);
    expect(load).toHaveBeenCalledTimes(2);
    broker.close();
  });
  it("resolves sixteen tracks ahead and uses at most six API workers", async () => {
    let active = 0,
      peak = 0;
    const load = vi.fn(async (index: number) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return source(index);
    });
    const broker = new SourceBroker(1000, load, new AbortController().signal);
    await broker.get(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      load.mock.calls.map(([index]) => index).sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(peak).toBeLessThanOrEqual(6);
    broker.close();
  });
  it("invalidates rejected links and rejects requests after cancellation", async () => {
    const controller = new AbortController(),
      load = vi.fn(async (index: number) => source(index)),
      broker = new SourceBroker(1, load, controller.signal);
    await broker.get(0);
    broker.invalidate(0);
    await broker.get(0);
    expect(load).toHaveBeenCalledTimes(2);
    controller.abort();
    await expect(broker.get(0)).rejects.toMatchObject({ name: "AbortError" });
  });
  it("does not keep a URL beyond its explicit expiry", async () => {
    let now = 0;
    const load = vi.fn(async () => ({
      ...source(0),
      url: "https://fixture.storage.yandex.net/0.mp3?expires=10",
    }));
    const broker = new SourceBroker(
      1,
      load,
      new AbortController().signal,
      undefined,
      () => now,
    );
    await broker.get(0);
    now = 6000;
    await broker.get(0);
    expect(load).toHaveBeenCalledTimes(2);
    broker.close();
  });
});
