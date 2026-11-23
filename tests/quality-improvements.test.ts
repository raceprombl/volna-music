import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { configureApiCoordinator } from "../src/api-fetch";
import { fetchLyrics } from "../src/lyrics";
import { closeCachedDb, openStoreDb } from "../src/idb";
import { clearFiles } from "../src/blob-store";
import { workItem } from "../src/engine-item";
import { ProgressBatch } from "../src/progress-batch";
import { SourceBroker } from "../src/source-broker";
import { newJob } from "../src/state";
import { TransferMeter } from "../src/transfer-meter";
import { defaults } from "../src/types";

function readId3TextFrame(bytes: Uint8Array, frameId: string): string | null {
  const target = new TextEncoder().encode(frameId);
  for (let i = 10; i + 10 <= bytes.length; i++) {
    if (
      bytes[i] === target[0] &&
      bytes[i + 1] === target[1] &&
      bytes[i + 2] === target[2] &&
      bytes[i + 3] === target[3]
    ) {
      const size =
        (bytes[i + 4] << 24) |
        (bytes[i + 5] << 16) |
        (bytes[i + 6] << 8) |
        bytes[i + 7];
      const encoding = bytes[i + 10];
      const payload = bytes.subarray(i + 11, i + 10 + size);
      if (encoding === 1) {
        const start =
          payload.length >= 2 &&
          ((payload[0] === 0xff && payload[1] === 0xfe) ||
            (payload[0] === 0xfe && payload[1] === 0xff))
            ? 2
            : 0;
        return new TextDecoder("utf-16le")
          .decode(payload.subarray(start))
          .replace(/\0+$/, "");
      }
      return new TextDecoder("latin1").decode(payload).replace(/\0+$/, "");
    }
  }
  return null;
}

afterEach(async () => {
  configureApiCoordinator(undefined);
  vi.unstubAllGlobals();
  await closeCachedDb("volna-idb-test");
  await clearFiles().catch(() => {});
});

describe("quality improvements", () => {
  it("routes fetchLyrics through the global API rate coordinator and retries 429", async () => {
    const acquire = vi.fn(async () => {});
    const defer = vi.fn();
    configureApiCoordinator({ acquire, defer });

    let apiCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("https://api.music.yandex.ru/tracks/42/lyrics")) {
          apiCalls++;
          if (apiCalls === 1) {
            return new Response(null, {
              status: 429,
              headers: { "Retry-After": "0" },
            });
          }
          return new Response(
            JSON.stringify({
              result: {
                downloadUrl: "https://storage.mds.yandex.net/lyrics/42.lrc",
              },
            }),
            { status: 200 },
          );
        }
        if (url === "https://storage.mds.yandex.net/lyrics/42.lrc") {
          const text = "[00:01.00] Hello world";
          return new Response(text, {
            status: 200,
            headers: {
              "Content-Length": String(new TextEncoder().encode(text).length),
            },
          });
        }
        throw new Error("Unexpected URL: " + url);
      }),
    );

    const lyrics = await fetchLyrics(
      {
        id: "42",
        title: "Track",
        artists: "Artist",
        lyricsInfo: { hasAvailableSyncLyrics: true },
      },
      new AbortController().signal,
    );

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(defer).toHaveBeenCalledTimes(1);
    expect(defer).toHaveBeenCalledWith(0);
    expect(lyrics).toEqual({
      text: "[00:01.00] Hello world",
      format: "LRC",
    });
  });

  it("falls back to SESSION_LYRICS RPC when apiFetch returns a non-2xx HTTP error", async () => {
    const acquire = vi.fn(async () => {});
    configureApiCoordinator({ acquire, defer: vi.fn() });

    const rpcMessages: unknown[] = [];
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (msg: unknown) => {
          rpcMessages.push(msg);
          return {
            ok: true,
            data: {
              downloadUrl: "https://storage.mds.yandex.net/lyrics/99.txt",
            },
          };
        }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.startsWith("https://api.music.yandex.ru/tracks/99/lyrics")) {
          return new Response(null, { status: 403 });
        }
        if (url === "https://storage.mds.yandex.net/lyrics/99.txt") {
          return new Response("Plain lyrics\r\nLine 2", { status: 200 });
        }
        throw new Error("Unexpected URL: " + url);
      }),
    );

    const lyrics = await fetchLyrics(
      { id: "99", title: "Song", artists: "Band" },
      new AbortController().signal,
    );

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(rpcMessages).toEqual([
      { type: "SESSION_LYRICS", id: "99", format: "TEXT" },
    ]);
    expect(lyrics).toEqual({
      text: "Plain lyrics\nLine 2",
      format: "TEXT",
    });
  });

  it("reuses cached IndexedDB connections and releases cleanly on deleteDatabase", async () => {
    const db1 = await openStoreDb("volna-idb-test", "items");
    const db2 = await openStoreDb("volna-idb-test", "items");
    expect(db2).toBe(db1);

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("volna-idb-test");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("deleteDatabase blocked"));
    });

    const db3 = await openStoreDb("volna-idb-test", "items");
    expect(db3).not.toBe(db1);
  });

  it("embeds job.trackNumber in ID3 TRCK tag for single-track downloads", async () => {
    const audio = new Uint8Array(417 * 575);
    for (let i = 0; i < 575; i++) audio.set([255, 251, 144, 0], i * 417);

    const originalFetch = globalThis.fetch;
    let savedAudio: Uint8Array | undefined;
    let savedName = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("blob:")) return originalFetch(input as RequestInfo, init);
        if (url === "https://fixture.storage.yandex.net/777.mp3") {
          return new Response(audio, {
            headers: {
              "Content-Type": "audio/mpeg",
              "Content-Length": String(audio.length),
            },
          });
        }
        throw new Error("Unexpected URL: " + url);
      }),
    );

    const job = newJob(
      "Single Track",
      [{ id: "777", title: "Numbered", artists: "Artist", duration: 15000 }],
      { ...defaults, zip: false, covers: false, metadata: true },
    );
    job.kind = "page";
    job.trackNumber = 7;

    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(async (m: any) => {
          if (m.type === "ENGINE_PATCH") {
            if (Number.isInteger(m.index) && job.items[m.index])
              Object.assign(job.items[m.index], m.item);
            return { ok: true };
          }
          if (m.type === "SAVE_BLOB") {
            savedName = m.filename;
            const res = await originalFetch(m.url);
            savedAudio = new Uint8Array(await res.arrayBuffer());
            return { ok: true, data: 101 };
          }
          if (m.type === "DOWNLOAD_STATE")
            return { ok: true, data: { state: "complete" } };
          if (m.type === "ENGINE_STATE")
            return {
              ok: true,
              data: { settings: job.settings, jobs: [job], tokenPresent: false, token: "" },
            };
          return { ok: true };
        }),
      },
    });

    const controller = new AbortController();
    const meter = new TransferMeter(job.items);
    const batch = new ProgressBatch(async () => {}, 450, meter);
    const sources = new SourceBroker(
      1,
      async () => ({
        codec: "mp3",
        bitrate: 320,
        url: "https://fixture.storage.yandex.net/777.mp3",
      }),
      controller.signal,
    );

    try {
      await workItem(
        job,
        0,
        "",
        controller.signal,
        new Set(["777"]),
        batch,
        meter,
        sources,
      );
    } finally {
      sources.close();
      await batch.close();
    }

    expect(savedName).toMatch(/^07 · /);
    expect(savedAudio).toBeDefined();
    expect(readId3TextFrame(savedAudio!, "TRCK")).toBe("7");
  });

  it("flushes staged statuses on ProgressBatch.close() and drops them on finish()", async () => {
    vi.useFakeTimers();
    try {
      const sent: unknown[] = [];
      const batch = new ProgressBatch(async (items) => {
        sent.push(items);
      });
      batch.stage(0, { status: "ready", filename: "01 · Track.mp3" });
      batch.stage(1, { status: "fetching" });
      await batch.finish(1);
      await batch.close();
      expect(sent).toEqual([
        [{ index: 0, item: { status: "ready", filename: "01 · Track.mp3" } }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
