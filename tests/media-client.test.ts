import { afterEach, describe, it, expect, vi } from "vitest";
import { MediaClient } from "../src/media-client";
import { ConnectionPool } from "../src/connection-pool";
const a = "https://a.storage.yandex.net/track",
  b = "https://b.storage.yandex.net/track",
  encode = (s: string) => new TextEncoder().encode(s);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function interrupted() {
  let first = true;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(c) {
        if (first) {
          first = false;
          c.enqueue(encode("ABCD"));
        } else c.error(new TypeError("Connection reset"));
      },
    }),
    { headers: { "Content-Length": "8", ETag: '"version1"' } },
  );
}
describe("resumable CDN media client", () => {
  it("waits out a CDN 429 instead of immediately spraying other mirrors", async () => {
    vi.useFakeTimers();
    let count = 0;
    const http = vi.fn(async () =>
      ++count === 1
        ? new Response(null, { status: 429, headers: { "Retry-After": "2" } })
        : new Response(encode("ok")),
    );
    const task = new MediaClient(
      new ConnectionPool(),
      http as typeof fetch,
    ).download([a, b], new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await task).toEqual(encode("ok"));
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("resumes with Range and If-Range without duplicate bytes", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const requests: Headers[] = [];
    const http = vi.fn(async (_url: any, init: any) => {
      requests.push(new Headers(init.headers));
      return requests.length === 1
        ? interrupted()
        : new Response(encode("EFGH"), {
            status: 206,
            headers: { "Content-Range": "bytes 4-7/8", ETag: '"version1"' },
          });
    });
    const client = new MediaClient(new ConnectionPool(), http as typeof fetch),
      task = client.download([a], new AbortController().signal);
    const check = expect(task).resolves.toEqual(encode("ABCDEFGH"));
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(requests[1].get("Range")).toBe("bytes=4-");
    expect(requests[1].get("If-Range")).toBe('"version1"');
    expect(requests[1].has("Accept-Encoding")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("restarts when If-Range receives a new 200 representation", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let count = 0;
    const http = vi.fn(async () =>
      ++count === 1
        ? interrupted()
        : new Response(encode("NEWFILE!"), {
            headers: { "Content-Length": "8", ETag: '"version2"' },
          }),
    );
    const task = new MediaClient(
      new ConnectionPool(),
      http as typeof fetch,
    ).download([a], new AbortController().signal);
    const check = expect(task).resolves.toEqual(encode("NEWFILE!"));
    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(count).toBe(2);
  });
  it("rejects incorrect Content-Range and retries from byte zero", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const requests: Headers[] = [];
    const http = vi.fn(async (_url: any, init: any) => {
      requests.push(new Headers(init.headers));
      if (requests.length === 1) return interrupted();
      if (requests.length === 2)
        return new Response(encode("EFGH"), {
          status: 206,
          headers: { "Content-Range": "bytes 3-6/8", ETag: '"version1"' },
        });
      return new Response(encode("ABCDEFGH"), {
        headers: { "Content-Length": "8" },
      });
    });
    const task = new MediaClient(
      new ConnectionPool(),
      http as typeof fetch,
    ).download([a], new AbortController().signal);
    const check = expect(task).resolves.toEqual(encode("ABCDEFGH"));
    await vi.advanceTimersByTimeAsync(2000);
    await check;
    expect(requests[2].has("Range")).toBe(false);
  });
  it("tries another mirror without another API resolve", async () => {
    const http = vi.fn(async (url: any) =>
      url === a
        ? new Response(null, { status: 503 })
        : new Response(encode("mirror")),
    );
    expect(
      await new MediaClient(
        new ConnectionPool(),
        http as typeof fetch,
      ).download([a, b], new AbortController().signal),
    ).toEqual(encode("mirror"));
    expect(http).toHaveBeenCalledTimes(2);
  });
  it("hedges a slow mirror after 300 ms and aborts the loser", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const http = vi.fn(async (url: any, init: any) =>
      url === b
        ? new Response(encode("fast"))
        : await new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () => resolve(new Response(encode("slow"))),
              1000,
            );
            init.signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                clearTimeout(timer);
                reject(init.signal.reason);
              },
              { once: true },
            );
          }),
    );
    const task = new MediaClient(
      new ConnectionPool(),
      http as typeof fetch,
    ).download([a, b], new AbortController().signal);
    await vi.advanceTimersByTimeAsync(299);
    expect(http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await task).toEqual(encode("fast"));
    expect(aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps twelve simultaneous files within the eight-request budget", async () => {
    let active = 0,
      peak = 0;
    const http = vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(encode("ok"));
    });
    const client = new MediaClient(new ConnectionPool(8), http as typeof fetch);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        client.download([a], new AbortController().signal),
      ),
    );
    expect(results).toHaveLength(12);
    expect(peak).toBe(8);
  });
  it("reassembles four verified ranges byte-for-byte", async () => {
    const data = Uint8Array.from(
        { length: 5 * 1024 * 1024 },
        (_, i) => i % 251,
      ),
      ranges: string[] = [];
    const http = vi.fn(async (_url: any, init: any) => {
      const range = new Headers(init.headers).get("Range")!;
      ranges.push(range);
      const [, start, end] = range.match(/^bytes=(\d+)-(\d+)$/)!;
      return new Response(data.slice(Number(start), Number(end) + 1), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          ETag: '"stable"',
        },
      });
    });
    const result = await new MediaClient(
      new ConnectionPool(),
      http as typeof fetch,
    ).download(
      [a, b],
      new AbortController().signal,
      undefined,
      10 * 1024 * 1024,
      { multipart: 4 },
    );
    expect(result.length).toBe(data.length);
    expect(ranges).toHaveLength(5);
    expect(
      await crypto.subtle.digest("SHA-256", result as Uint8Array<ArrayBuffer>),
    ).toEqual(await crypto.subtle.digest("SHA-256", data));
  });
  it("reassembles eight verified ranges byte-for-byte", async () => {
    const data = Uint8Array.from(
        { length: 6 * 1024 * 1024 },
        (_, i) => i % 251,
      ),
      ranges: string[] = [];
    const http = vi.fn(async (_url: any, init: any) => {
      const range = new Headers(init.headers).get("Range")!;
      ranges.push(range);
      const [, start, end] = range.match(/^bytes=(\d+)-(\d+)$/)!;
      return new Response(data.slice(Number(start), Number(end) + 1), {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          ETag: '"stable-8"',
        },
      });
    });
    const result = await new MediaClient(
      new ConnectionPool(),
      http as typeof fetch,
    ).download(
      [a, b],
      new AbortController().signal,
      undefined,
      10 * 1024 * 1024,
      { multipart: 8 },
    );
    expect(result.length).toBe(data.length);
    expect(ranges).toHaveLength(9);
    expect(
      await crypto.subtle.digest("SHA-256", result as Uint8Array<ArrayBuffer>),
    ).toEqual(await crypto.subtle.digest("SHA-256", data));
  });
  it("rejects third-party URLs before a network request", async () => {
    const http = vi.fn();
    await expect(
      new MediaClient(new ConnectionPool(), http as typeof fetch).download(
        ["https://untrusted.invalid/file"],
        new AbortController().signal,
      ),
    ).rejects.toThrow("неподдерживаемый");
    expect(http).not.toHaveBeenCalled();
  });
});
