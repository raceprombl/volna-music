import { afterEach, describe, it, expect, vi } from "vitest";
import { fetchBytes } from "../src/media-fetch";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function response() {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          },
        }),
      ),
  );
  return () => stream;
}
describe("media transfer deadlines", () => {
  it("allows more than three minutes while data keeps arriving", async () => {
    vi.useFakeTimers();
    const stream = response(),
      task = fetchBytes(
        "https://fixture.storage.yandex.net/track",
        new AbortController().signal,
      );
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 32; i++) {
      await vi.advanceTimersByTimeAsync(10000);
      stream().enqueue(new Uint8Array([i]));
      await vi.advanceTimersByTimeAsync(0);
    }
    stream().close();
    expect(await task).toEqual(
      Uint8Array.from({ length: 32 }, (_, index) => index),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops a genuinely stalled transfer and clears its timer", async () => {
    vi.useFakeTimers();
    response();
    const task = fetchBytes(
      "https://fixture.storage.yandex.net/track",
      new AbortController().signal,
      undefined,
      150 * 1024 * 1024,
      { attempts: 1 },
    );
    const check = expect(task).rejects.toThrow("45 секунд");
    await vi.advanceTimersByTimeAsync(45000);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honours explicit cancellation immediately", async () => {
    vi.useFakeTimers();
    response();
    const controller = new AbortController();
    const task = fetchBytes(
      "https://fixture.storage.yandex.net/track",
      controller.signal,
    );
    const check = expect(task).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });
});
