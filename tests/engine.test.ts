import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { unzipSync } from "fflate";
import { defaults, type AppState, type Job } from "../src/types";
import { newJob } from "../src/state";
import { clearFiles, stagingBytes } from "../src/blob-store";
import { memoryOpfs } from "./opfs-fixture";
import { readFile } from "node:fs/promises";

const originalFetch = globalThis.fetch;
const s: AppState = { settings: defaults, jobs: [], tokenPresent: false };
let listener: any;
let onIdleSnapshot: (() => void) | undefined;
let transferCount = 0,
  maxTransfers = 0,
  aborted = false;
const saved: { name: string; data: Uint8Array }[] = [];
let slow = false;
const slowIds = new Set<string>();
const abortedTransfers: string[] = [];
let saveFails = false;
const mediaCacheModes: (RequestCache | undefined)[] = [];
const metadataRequests: string[][] = [];
const patchEvents: any[] = [];
let coverRequests = 0;
const opfs = memoryOpfs();
const audio = new Uint8Array(417 * 575);
for (let i = 0; i < 575; i++) audio.set([255, 251, 144, 0], i * 417);
async function waitUntil(fn: () => boolean) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > 7000) throw new Error("Queue timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
beforeAll(async () => {
  vi.stubGlobal("navigator", {
    storage: { getDirectory: async () => opfs.directory },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("blob:")) return originalFetch(input, init);
      if (url.includes("avatars.yandex.net")) {
        coverRequests++;
        return new Response(await readFile("public/icons/32.png"), {
          headers: { "Content-Type": "image/png" },
        });
      }
      if (url.includes("/tracks?track-ids=")) {
        const ids = new URL(url).searchParams.get("track-ids")!.split(",");
        metadataRequests.push(ids);
        return new Response(
          JSON.stringify({
            result: ids.map((id) => ({
              id,
              title: "Трек " + id,
              artists: [{ name: "Автор" }],
              durationMs: 15000,
              albums: [{ title: "Тестовый альбом", year: 2026 }],
              coverUri: "avatars.yandex.net/get-fixture/%%",
            })),
          }),
        );
      }
      if (url.includes("/download-info")) {
        const id = url.match(/tracks\/(\d+)/)?.[1];
        return new Response(
          JSON.stringify({
            result: [
              {
                codec: "mp3",
                bitrateInKbps: 320,
                preview: id === "99",
                direct: true,
                downloadInfoUrl: `https://fixture.storage.yandex.net/${id}.mp3`,
              },
            ],
          }),
        );
      }
      if (url.includes("fixture.storage.yandex.net")) {
        mediaCacheModes.push(init?.cache);
        transferCount++;
        maxTransfers = Math.max(maxTransfers, transferCount);
        try {
          if (slow || slowIds.has(url.match(/\/(\d+)\.mp3/)?.[1] ?? ""))
            await new Promise<void>((resolve, reject) => {
              const t = setTimeout(resolve, 3000);
              init?.signal?.addEventListener(
                "abort",
                () => {
                  clearTimeout(t);
                  aborted = true;
                  abortedTransfers.push(url.match(/\/(\d+)\.mp3/)?.[1] ?? "");
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            });
          else await new Promise((r) => setTimeout(r, 20));
          return new Response(audio, {
            headers: {
              "Content-Type": "audio/mpeg",
              "Content-Length": String(audio.length),
            },
          });
        } finally {
          transferCount--;
        }
      }
      throw new Error("Unexpected URL " + url);
    }),
  );
  vi.stubGlobal("chrome", {
    runtime: {
      id: "engine-test",
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
      },
      sendMessage: async (m: any) => {
        let data: any;
        switch (m.type) {
          case "API_PERMIT":
          case "API_CANCEL":
          case "API_BACKOFF":
            break;
          case "ENGINE_STATE":
            data = structuredClone({ ...s, token: "" });
            if (
              onIdleSnapshot &&
              !s.jobs.some((j) =>
                ["queued", "running", "packing"].includes(j.status),
              )
            ) {
              const callback = onIdleSnapshot;
              onIdleSnapshot = undefined;
              queueMicrotask(callback);
            }
            break;
          case "ENGINE_PATCH":
          case "ENGINE_PATCH_ITEMS": {
            patchEvents.push(structuredClone(m));
            const j = s.jobs.find((j) => j.id === m.id);
            if (j && j.status !== "cancelled") {
              Object.assign(j, m.patch);
              if (m.index !== undefined)
                Object.assign(j.items[m.index], m.item);
              for (const update of m.items ?? [])
                Object.assign(j.items[update.index], update.item);
            }
            break;
          }
          case "SAVE_BLOB": {
            if (saveFails) throw new Error("Disk error fixture");
            const b = await originalFetch(m.url);
            saved.push({
              name: m.filename,
              data: new Uint8Array(await b.arrayBuffer()),
            });
            data = saved.length;
            break;
          }
          case "DOWNLOAD_STATE":
            data = { state: "complete" };
            break;
          default:
            throw new Error(m.type);
        }
        return { ok: true, data };
      },
    },
  });
  await import("../src/offscreen");
  await new Promise((r) => setTimeout(r, 20));
});
afterAll(() => vi.unstubAllGlobals());
function start(
  ids: string[],
  zip = true,
  trackNumber?: number,
  covers = false,
  concurrency = 2,
) {
  const j = newJob(
    "Тестовый плейлист",
    ids.map((id) => ({
      id,
      title: "Трек " + id,
      artists: "Автор",
      duration: 15000,
    })),
    { ...defaults, zip, covers, metadata: true, concurrency },
  );
  j.trackNumber = trackNumber;
  s.jobs.push(j);
  listener(
    { target: "offscreen", type: "WAKE" },
    { id: "engine-test" },
    () => {},
  );
  return j;
}
describe("durable download engine", () => {
  it("downloads, tags and packages real fixture files into a readable ZIP with limited concurrency", async () => {
    await clearFiles();
    const j = start(["1", "2", "3"]);
    await waitUntil(() => j.status === "complete");
    expect(j.items.every((i) => i.status === "complete")).toBe(true);
    expect(maxTransfers).toBeLessThanOrEqual(2);
    expect(maxTransfers).toBe(2);
    expect(metadataRequests).toEqual([["1", "2", "3"]]);
    const completedPatches = patchEvents.filter(
      (m) =>
        m.id === j.id &&
        m.items?.some((update: any) => update.item.status === "complete"),
    );
    expect(completedPatches).toHaveLength(1);
    expect(completedPatches[0].items).toHaveLength(3);
    expect(
      patchEvents.filter((m) => m.id === j.id && m.item?.status === "complete"),
    ).toHaveLength(0);
    const archive = saved.find((x) => x.name.endsWith(".zip"))!;
    const entries = unzipSync(archive.data);
    expect(Object.keys(entries).filter((f) => f.endsWith(".mp3"))).toHaveLength(
      3,
    );
    expect(entries["metadata.json"]).toBeDefined();
    const first = Object.entries(entries).find(([name]) =>
      name.endsWith(".mp3"),
    )![1];
    expect(new TextDecoder().decode(first.slice(0, 3))).toBe("ID3");
    expect(await stagingBytes()).toBe(0);
    await waitUntil(() => opfs.files.size === 0);
    expect(mediaCacheModes.every((mode) => mode === "no-store")).toBe(true);
  });
  it("saves individual audio files with actual extensions", async () => {
    const before = saved.length;
    const j = start(["4"], false, 7);
    await waitUntil(() => j.status === "complete");
    expect(saved[before].name.endsWith(".mp3")).toBe(true);
    expect(saved[before].name).toContain("Автор");
    expect(saved[before].name).toMatch(/^07 · /);
  });
  it("skips preview-only content instead of exporting a preview as a full track", async () => {
    const before = saved.length;
    const j = start(["99"]);
    await waitUntil(() => j.status === "failed");
    expect(j.items[0].status).toBe("skipped");
    expect(j.items[0].error).toContain("превью");
    expect(saved.length).toBe(before);
  });
  it("aborts an in-flight fetch when the user cancels", async () => {
    slow = true;
    const j = start(["5"], false);
    await waitUntil(() => j.items[0].status === "fetching");
    j.status = "cancelled";
    listener(
      { target: "offscreen", type: "CANCEL", id: j.id },
      { id: "engine-test" },
      () => {},
    );
    await waitUntil(() => aborted);
    expect(j.status).toBe("cancelled");
    slow = false;
  });
  it("cleans cached audio after failed ZIP saving", async () => {
    saveFails = true;
    const j = start(["6"], true);
    await waitUntil(() => j.status === "failed");
    const deadline = Date.now() + 1500;
    while (await stagingBytes()) {
      if (Date.now() > deadline) throw Error("Cache cleanup timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(await stagingBytes()).toBe(0);
    saveFails = false;
  });
  it("cleans the partial archive and staging on quota failure", async () => {
    opfs.failWrites = true;
    slowIds.add("8");
    const before = saved.length;
    const j = start(["7", "8"], true);
    await waitUntil(() => j.status === "failed");
    await waitUntil(() => opfs.files.size === 0);
    expect(opfs.aborted).toBeGreaterThan(0);
    expect(await stagingBytes()).toBe(0);
    expect(saved.length).toBe(before);
    expect(abortedTransfers).toContain("8");
    slowIds.delete("8");
    opfs.failWrites = false;
  });
  it("shares one artwork request between parallel songs and the ZIP cover", async () => {
    const before = coverRequests;
    const j = start(["10", "11", "12"], true, undefined, true);
    try {
      await waitUntil(() =>
        ["complete", "partial", "failed"].includes(j.status),
      );
    } catch {
      throw Error(
        JSON.stringify({
          job: j,
          coverRequests,
          metadataRequests,
          transfers: transferCount,
          files: [...opfs.files.keys()],
        }),
      );
    }
    expect(j.status, JSON.stringify(j)).toBe("complete");
    expect(coverRequests - before).toBe(1);
    const entries = unzipSync(saved.at(-1)!.data);
    expect(entries["cover.png"]).toBeDefined();
    expect(
      Object.keys(entries).filter((name) => name.endsWith(".mp3")),
    ).toHaveLength(3);
    await waitUntil(() => opfs.files.size === 0);
  });
  it("does not lose a new download queued during idle cleanup", async () => {
    const queued = new Promise<Job>((resolve) => {
      onIdleSnapshot = () => resolve(start(["13"], true));
    });
    listener(
      { target: "offscreen", type: "WAKE" },
      { id: "engine-test" },
      () => {},
    );
    const j = await queued;
    await waitUntil(() => ["complete", "failed", "partial"].includes(j.status));
    expect(j.status, JSON.stringify(j)).toBe("complete");
  });
  it("runs all five selected transfer streams and saves every track in one ZIP", async () => {
    maxTransfers = 0;
    const j = start(
      ["20", "21", "22", "23", "24", "25", "26"],
      true,
      undefined,
      false,
      5,
    );
    await waitUntil(() => ["complete", "partial", "failed"].includes(j.status));
    expect(j.status, JSON.stringify(j)).toBe("complete");
    expect(maxTransfers).toBe(5);
    expect(j.transfer?.receivedBytes).toBe(audio.length * 7);
    expect(j.transfer?.pendingTracks).toBe(0);
    expect(
      Object.keys(unzipSync(saved.at(-1)!.data)).filter((name) =>
        name.endsWith(".mp3"),
      ),
    ).toHaveLength(7);
  });
  it("downloads a complete eight-stream batch without leaving staged audio", async () => {
    maxTransfers = 0;
    const j = start(
      ["30", "31", "32", "33", "34", "35", "36", "37", "38"],
      true,
      undefined,
      false,
      8,
    );
    await waitUntil(() => ["complete", "partial", "failed"].includes(j.status));
    expect(j.status, JSON.stringify(j)).toBe("complete");
    expect(maxTransfers).toBe(8);
    expect(
      Object.keys(unzipSync(saved.at(-1)!.data)).filter((name) =>
        name.endsWith(".mp3"),
      ),
    ).toHaveLength(9);
    expect(j.transfer?.receivedBytes).toBe(audio.length * 9);
    expect(await stagingBytes()).toBe(0);
  });
  it("downloads a twelve-stream batch concurrently without leaving staged audio", async () => {
    maxTransfers = 0;
    const ids = Array.from({ length: 14 }, (_, i) => String(40 + i));
    const j = start(ids, true, undefined, false, 12);
    await waitUntil(() => ["complete", "partial", "failed"].includes(j.status));
    expect(j.status, JSON.stringify(j)).toBe("complete");
    expect(maxTransfers).toBe(12);
    expect(
      Object.keys(unzipSync(saved.at(-1)!.data)).filter((name) =>
        name.endsWith(".mp3"),
      ),
    ).toHaveLength(14);
    expect(j.transfer?.receivedBytes).toBe(audio.length * 14);
    expect(await stagingBytes()).toBe(0);
  });
});
