import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { defaults, type AppState } from "../src/types";
import { newJob } from "../src/state";
const model: AppState = { settings: defaults, jobs: [], tokenPresent: false };
let listener: any;
let onTabUpdate: any;
let onAlarm: any;
const session: Record<string, any> = {};
const createdTabs: any[] = [];
const updatedTabs: any[] = [];
const savedDownloads: any[] = [];
const url = "chrome-extension://test/popup.html";
const call = (m: any) =>
  new Promise<any>((resolve) => listener(m, { url }, resolve));
beforeAll(async () => {
  const event = () => ({ addListener: vi.fn() });
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test",
      getURL: (p: string) => "chrome-extension://test/" + p,
      onMessage: { addListener: (f: any) => (listener = f) },
      onInstalled: event(),
      onStartup: event(),
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: async () => structuredClone(model),
        set: vi.fn(async (s: any) => Object.assign(model, structuredClone(s))),
      },
      session: {
        get: async () => ({ ...session }),
        set: async (s: any) => Object.assign(session, s),
        remove: async (k: string) => {
          delete session[k];
        },
      },
    },
    offscreen: {
      hasDocument: async () => true,
      closeDocument: vi.fn(async () => {}),
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    alarms: { onAlarm: { addListener: (f: any) => (onAlarm = f) } },
    downloads: {
      onChanged: event(),
      cancel: vi.fn(),
      download: async (d: any) => {
        savedDownloads.push(d);
        return 42;
      },
    },
    tabs: {
      query: async () => [],
      create: async (t: any) => {
        createdTabs.push(t);
        return { id: 77 };
      },
      update: async (id: number, t: any) => updatedTabs.push({ id, ...t }),
      onUpdated: { addListener: (f: any) => (onTabUpdate = f) },
    },
    scripting: { executeScript: vi.fn(async () => []) },
  });
  await import("../src/background");
});
describe("automatic Music OAuth", () => {
  it("accepts only its own callback tab and state, keeps tokens out of replies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: { account: { uid: 123 } } })),
      ),
    );
    const reply = await call({ type: "CONNECT_ACCOUNT" });
    expect(reply).toEqual({
      ok: true,
      data: { connected: false, opened: true },
    });
    const pending = session.pendingMusicOAuth;
    const authorization = new URL(createdTabs.at(-1).url);
    expect(authorization.hostname).toBe("oauth.yandex.ru");
    expect(authorization.searchParams.get("state")).toBe(pending.nonce);
    const access = "fixture_music_token_1234567890";
    onTabUpdate(77, {
      url: `https://music.yandex.ru/oauth#access_token=${access}&state=wrong`,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(session.token).toBeUndefined();
    onTabUpdate(78, {
      url: `https://music.yandex.ru/oauth#access_token=${access}&state=${pending.nonce}`,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(session.token).toBeUndefined();
    onTabUpdate(77, {
      url: `https://music.yandex.ru/oauth#access_token=${access}&state=${pending.nonce}`,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(session.token).toBe(access);
    expect(session.pendingMusicOAuth).toBeUndefined();
    expect(updatedTabs.at(-1).url).toBe(url + "?view=settings");
    expect(JSON.stringify(reply)).not.toContain(access);
  });
});
afterAll(() => vi.unstubAllGlobals());
describe("single active download", () => {
  // Further tests below exercise rejection before a queue record is created.
  it("atomically accepts only one of simultaneous popup/page submissions", async () => {
    const message = {
      type: "ENQUEUE",
      title: "Collection",
      tracks: [{ id: "1", title: "Track", artists: "Artist" }],
      settings: defaults,
    };
    const results = await Promise.all([
      call(message),
      new Promise<any>((resolve) =>
        listener(
          message,
          { url: "https://music.yandex.kz/album/1", tab: { id: 1 } },
          resolve,
        ),
      ),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok).error).toContain("Уже идёт загрузка");
    expect(model.jobs).toHaveLength(1);
  });
  it("blocks new jobs and retries during transfer and ZIP, then unlocks after cancellation", async () => {
    const message = {
      type: "ENQUEUE",
      title: "Next",
      tracks: [{ id: "2", title: "Next", artists: "A" }],
      settings: defaults,
    };
    for (const status of ["running", "packing"] as const) {
      model.jobs[0].status = status;
      expect((await call(message)).ok).toBe(false);
      expect((await call({ type: "RETRY", id: model.jobs[0].id })).ok).toBe(
        false,
      );
    }
    expect((await call({ type: "CANCEL_JOB", id: model.jobs[0].id })).ok).toBe(
      true,
    );
    expect((await call(message)).ok).toBe(true);
    expect(model.jobs.filter((j) => j.status === "queued")).toHaveLength(1);
  });
  it("saves single tracks directly in Tracks with a durable download sequence", async () => {
    const job = model.jobs.at(-1)!;
    expect(job.trackNumber).toBe(2);
    expect(model.nextTrackNumber).toBe(3);
    const result = await new Promise<any>((resolve) =>
      listener(
        {
          type: "SAVE_BLOB",
          url: "blob:chrome-extension://test/audio",
          filename: "02 · Artist — Next.mp3",
          jobId: job.id,
          index: 0,
        },
        { url: "chrome-extension://test/offscreen.html" },
        resolve,
      ),
    );
    expect(result.ok).toBe(true);
    expect(savedDownloads.at(-1).filename).toBe(
      "VOLNA/Треки/02 · Artist — Next.mp3",
    );
    expect(savedDownloads.at(-1).filename).not.toContain("/Next/");
  });
  it("rejects an existing song before allocating a job or consuming its sequence number", async () => {
    model.jobs.at(-1)!.status = "complete";
    const library = await import("../src/library");
    const check = vi
      .spyOn(library, "findExistingTrack")
      .mockResolvedValue({ name: "01 · A — Existing.mp3" });
    const before = model.jobs.length,
      number = model.nextTrackNumber;
    const message = {
      type: "ENQUEUE",
      title: "Existing",
      kind: "page",
      tracks: [{ id: "99", title: "Existing", artists: "A" }],
      settings: { ...defaults, zip: false },
    };
    expect(await call(message)).toMatchObject({
      ok: false,
      error: expect.stringContaining("уже есть в папке"),
    });
    expect(model.jobs).toHaveLength(before);
    expect(model.nextTrackNumber).toBe(number);
    check.mockResolvedValue(null);
    expect((await call(message)).ok).toBe(true);
    check.mockRestore();
    const retry = model.jobs.at(-1)!;
    retry.status = "failed";
    retry.items[0].status = "ready";
    expect((await call({ type: "RETRY", id: retry.id })).ok).toBe(true);
    expect(retry.items[0].status).toBe("ready"); // Storage returns copies; inspect persisted state below.
    expect(model.jobs.at(-1)!.items[0].status).toBe("queued");
  });
  it("does not close the engine or interrupt folder writes during idle maintenance", async () => {
    model.jobs.forEach((j) => (j.status = "complete"));
    let finishSort: (value: any) => void = () => {};
    const send = chrome.runtime.sendMessage as unknown as ReturnType<
      typeof vi.fn
    >;
    send.mockImplementation((m: any) =>
      m.type === "SORT_LIBRARY"
        ? new Promise((resolve) => (finishSort = resolve))
        : Promise.resolve({ busy: false }),
    );
    const operation = call({ type: "SORT_LIBRARY" });
    await new Promise((r) => setTimeout(r, 10));
    onAlarm({ name: "queue-recovery" });
    await new Promise((r) => setTimeout(r, 10));
    expect(chrome.offscreen.closeDocument).not.toHaveBeenCalled();
    finishSort({ ok: true, data: { count: 6, renamed: [] } });
    expect((await operation).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledTimes(1);
    send.mockReset();
  });
  it("completes a 5000-track archive in one durable write and denies UI engine patches", async () => {
    const job = newJob(
      "Large ZIP",
      Array.from({ length: 5000 }, (_, i) => ({
        id: String(i + 1),
        title: "Track",
        artists: "A",
      })),
      defaults,
    );
    model.jobs = [job];
    const items = job.items.map((_, index) => ({
      index,
      item: { status: "complete" },
    }));
    const before = (chrome.storage.local.set as any).mock.calls.length;
    const message = { type: "ENGINE_PATCH_ITEMS", id: job.id, items };
    expect((await call(message)).ok).toBe(false);
    expect((chrome.storage.local.set as any).mock.calls.length).toBe(before);
    const reply = await new Promise<any>((resolve) =>
      listener(
        message,
        { url: "chrome-extension://test/offscreen.html" },
        resolve,
      ),
    );
    expect(reply.ok).toBe(true);
    expect((chrome.storage.local.set as any).mock.calls.length - before).toBe(
      1,
    );
    expect(
      model.jobs[0].items.every((item) => item.status === "complete"),
    ).toBe(true);
  });
  it("keeps folder nesting shallow for likes, albums and ZIP archives", async () => {
    const saveBlob = (jobId: string, filename: string, index?: number) =>
      new Promise<any>((resolve) =>
        listener(
          {
            type: "SAVE_BLOB",
            url: "blob:chrome-extension://test/audio",
            filename,
            jobId,
            index,
          },
          { url: "chrome-extension://test/offscreen.html" },
          resolve,
        ),
      );
    const likes = newJob(
      "My Favorites",
      [{ id: "1", title: "Song", artists: "A" }],
      { ...defaults, zip: false, structuredFolders: true },
    );
    likes.kind = "likes";
    const album = newJob(
      "My Album",
      [{ id: "2", title: "Song", artists: "A" }],
      { ...defaults, zip: false, structuredFolders: true },
    );
    album.kind = "album";
    const archive = newJob(
      "Road Trip",
      [{ id: "3", title: "Song", artists: "A" }],
      { ...defaults, zip: true, structuredFolders: true },
    );
    archive.kind = "playlist";
    model.jobs = [likes, album, archive];

    expect((await saveBlob(likes.id, "01 · A — Song.mp3", 0)).ok).toBe(true);
    expect(savedDownloads.at(-1).filename).toBe(
      "VOLNA/Мне нравится/01 · A — Song.mp3",
    );

    expect((await saveBlob(album.id, "01 · A — Song.mp3", 0)).ok).toBe(true);
    expect(savedDownloads.at(-1).filename).toBe(
      "VOLNA/My Album/01 · A — Song.mp3",
    );

    expect((await saveBlob(archive.id, "Road Trip.zip")).ok).toBe(true);
    expect(savedDownloads.at(-1).filename).toBe("VOLNA/Road Trip.zip");
  });
});
