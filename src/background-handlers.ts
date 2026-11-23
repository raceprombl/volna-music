import { api, availableFormats } from "./provider";
import { isMusic, safeFilename, safeName } from "./shared";
import { mutate, newJob, state, validSettings } from "./state";
import { snapshotRenderedMetadata } from "./page-bridge";
import { findExistingTrack, libraryStatus } from "./library";
import { stagingBytes } from "./blob-store";
import { archiveBytes } from "./archive-store";
import type { ApiRateLimiter } from "./api-rate";
import {
  fetchSessionLyrics,
  fetchSessionSource,
  getMusicToken,
  startMusicOAuth,
} from "./background-auth";
import {
  cancelJob,
  collectionForTab,
  ensureEngine,
  updateBadge,
  useEngine,
  wakeEngine,
} from "./background-engine";
import {
  activeJobs,
  type Collection,
  type Job,
  type QueueItem,
  type Track,
} from "./types";
import type { RpcRequest } from "./rpc";

interface SenderContext {
  engine: boolean;
  ui: boolean;
  content: boolean;
  sender: chrome.runtime.MessageSender;
}

interface HandlerDeps {
  offscreenUrl: string;
  uiUrl: string;
  apiLimiter: ApiRateLimiter;
  apiPermits: Map<string, AbortController>;
}

const UNHANDLED = Symbol("UNHANDLED");

async function handleApiControl(
  msg: RpcRequest,
  deps: Pick<HandlerDeps, "apiLimiter" | "apiPermits">,
): Promise<unknown> {
  if (msg.type === "API_PERMIT") {
    if (
      typeof msg.requestId !== "string" ||
      !/^[\w-]{1,100}$/.test(msg.requestId) ||
      deps.apiPermits.has(msg.requestId) ||
      deps.apiPermits.size >= 64
    )
      throw new Error("Очередь API занята. Повторите запрос.");
    const controller = new AbortController();
    deps.apiPermits.set(msg.requestId, controller);
    try {
      await deps.apiLimiter.acquire(controller.signal);
    } finally {
      deps.apiPermits.delete(msg.requestId);
    }
    return;
  }
  if (msg.type === "API_CANCEL") {
    deps.apiPermits
      .get(msg.requestId)
      ?.abort(new DOMException("Отменено", "AbortError"));
    return;
  }
  if (msg.type === "API_BACKOFF") {
    if (Number.isFinite(msg.ms)) deps.apiLimiter.defer(msg.ms);
    return;
  }
  return UNHANDLED;
}

async function handleLibrary(
  msg: RpcRequest,
  ctx: SenderContext,
  uiUrl: string,
): Promise<unknown> {
  if (msg.type === "LIBRARY_STATUS" && ctx.ui) return libraryStatus();
  if (msg.type === "CACHE_STATUS" && ctx.ui)
    return { temporaryBytes: (await stagingBytes()) + (await archiveBytes()) };
  if (msg.type === "OPEN_LIBRARY_SETTINGS" && (ctx.ui || ctx.content)) {
    await chrome.tabs.create({ url: uiUrl + "?view=settings&folder=connect" });
    return;
  }
  if (msg.type === "SORT_LIBRARY" && ctx.ui) {
    if ((await state()).jobs.some(activeJobs))
      throw new Error("Дождитесь окончания загрузки перед сортировкой.");
    const result = await useEngine(() =>
      chrome.runtime.sendMessage({
        target: "offscreen",
        type: "SORT_LIBRARY",
      }),
    );
    if (!result?.ok) throw new Error(result?.error ?? "Папка не ответила.");
    await mutate((s) => {
      for (const job of s.jobs)
        for (const item of job.items) {
          const rename = result.data.renamed.find(
            (r: { from: string; to: string }) =>
              item.folderSaved && r.from === item.filename,
          );
          if (rename) {
            item.filename = rename.to;
            item.downloadId = undefined;
          }
        }
      s.nextTrackNumber = result.data.count + 1;
    });
    return result.data;
  }
  if (msg.type === "LIBRARY_REINDEX" && ctx.engine) {
    await mutate((s) => {
      for (const job of s.jobs)
        for (const item of job.items) {
          const rename = msg.renamed?.find(
            (r) => item.folderSaved && r.from === item.filename,
          );
          if (rename) {
            item.filename = String(rename.to);
            item.downloadId = undefined;
          }
        }
      const job = s.jobs.find((j) => j.id === msg.jobId);
      if (job) job.trackNumber = Number(msg.number);
      s.nextTrackNumber = Number(msg.number) + 1;
    });
    return;
  }
  return UNHANDLED;
}

async function handleAccountAndNavigation(
  msg: RpcRequest,
  ctx: SenderContext,
  uiUrl: string,
): Promise<unknown> {
  if (msg.type === "CONNECT_ACCOUNT" && (ctx.ui || ctx.content))
    return startMusicOAuth();
  if (msg.type === "OPEN_SETTINGS" && (ctx.ui || ctx.content)) {
    await chrome.tabs.create({ url: uiUrl + "?view=settings" });
    return;
  }
  if (msg.type === "SET_TOKEN" && ctx.ui) {
    const t = String(msg.token ?? "")
      .trim()
      .replace(/^OAuth\s+/i, "");
    if (t.length > 4000 || /[\s\x00-\x1f]/.test(t))
      throw new Error("Некорректный токен.");
    if (t) await api("/account/status", t);
    await chrome.storage.session.set({ token: t });
    return { present: !!t };
  }
  if (msg.type === "OPEN_MUSIC" && ctx.ui) {
    const tabs = await chrome.tabs.query({
      url: ["https://music.yandex.ru/*", "https://music.yandex.kz/*"],
    });
    const tab = tabs[0];
    if (tab?.id) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId)
        await chrome.windows.update(tab.windowId, { focused: true });
    } else await chrome.tabs.create({ url: "https://music.yandex.kz/" });
    return;
  }
  return UNHANDLED;
}

async function handlePageAndMetadata(
  msg: RpcRequest,
  ctx: SenderContext,
): Promise<unknown> {
  if (msg.type === "EXPORT_TRACKLIST" && (ctx.ui || ctx.content)) {
    const c = msg.collection as Collection;
    if (
      !c ||
      !isMusic(c.url) ||
      !Array.isArray(c.tracks) ||
      c.tracks.length > 5000
    )
      throw new Error("Некорректный список треков.");
    const plain = (v: unknown) =>
      String(v ?? "")
        .replace(/[\r\n\t]/g, " ")
        .slice(0, 300);
    const text = [
      plain(c.title),
      c.url,
      "",
      ...c.tracks.map(
        (t, i) => `${i + 1}. ${plain(t.artists)} — ${plain(t.title)}`,
      ),
    ].join("\r\n");
    return chrome.downloads.download({
      url: "data:text/plain;charset=utf-8," + encodeURIComponent(text),
      filename: `${safeName((await state()).settings.folder)}/${safeName(c.title)} — список.txt`,
      conflictAction: "uniquify",
      saveAs: false,
    });
  }
  if (msg.type === "RENDER_METADATA" && ctx.content) {
    return (
      await chrome.scripting.executeScript({
        target: { tabId: ctx.sender.tab!.id! },
        world: "MAIN",
        func: snapshotRenderedMetadata,
      })
    )[0]?.result;
  }
  if (msg.type === "PAGE" && ctx.ui)
    return collectionForTab(msg.tabId, !!msg.full);
  if (msg.type === "FORMATS" && (ctx.ui || ctx.content))
    return availableFormats(String(msg.id), await getMusicToken());
  if (msg.type === "EXPAND" && ctx.content)
    return (await collectionForTab(ctx.sender.tab!.id!, true))?.collection;
  return UNHANDLED;
}

async function handleJobs(msg: RpcRequest, ctx: SenderContext): Promise<unknown> {
  if (msg.type === "GET_STATE" && ctx.ui) return state();
  if (msg.type === "GET_DOWNLOAD_SETTINGS" && (ctx.ui || ctx.content)) {
    const { format, quality, zip, concurrency } = (await state()).settings;
    return { format, quality, zip, concurrency };
  }
  if (msg.type === "GET_ACTIVE_JOB" && (ctx.ui || ctx.content))
    return (await state()).jobs.find(activeJobs) ?? null;
  if (msg.type === "GET_JOB" && (ctx.ui || ctx.content))
    return (await state()).jobs.find((j) => j.id === String(msg.id));
  if (msg.type === "SETTINGS" && ctx.ui) {
    return mutate((s) => {
      s.settings = validSettings(msg.settings);
      return s.settings;
    });
  }
  if (msg.type === "ENQUEUE" && (ctx.ui || ctx.content)) {
    const rawTracks = Array.isArray(msg.tracks) ? msg.tracks : [];
    const tracks: Track[] = rawTracks
      .slice(0, 5000)
      .filter(
        (t): t is Track =>
          !!t && /^\d+$/.test(String(t.id)) && typeof t.title === "string",
      )
      .map((t) => ({
        id: String(t.id),
        title: t.title.slice(0, 300),
        artists: String(t.artists ?? "").slice(0, 300),
        album: typeof t.album === "string" ? t.album.slice(0, 300) : undefined,
        year: Number(t.year) || undefined,
        duration: Number(t.duration) > 0 ? Number(t.duration) : undefined,
        cover:
          typeof t.cover === "string" &&
          /^https:\/\/avatars\.(mds\.)?yandex\.net\//.test(t.cover)
            ? t.cover
            : undefined,
        available: t.available !== false,
      }));
    if (!tracks.length) throw new Error("Не выбраны треки.");
    const current = await state();
    const settings = validSettings({ ...current.settings, ...msg.settings });
    const j = newJob(String(msg.title ?? "Моя музыка"), tracks, settings);
    j.kind =
      msg.kind && ["playlist", "album", "likes", "page"].includes(msg.kind)
        ? msg.kind
        : tracks.length > 1
          ? "playlist"
          : "page";
    await mutate(async (s) => {
      if (s.jobs.some(activeJobs))
        throw new Error(
          "Уже идёт загрузка. Дождитесь завершения или отмените её.",
        );
      if (j.kind === "page" && tracks.length === 1) {
        const found = await findExistingTrack(tracks[0], settings.format);
        if (found)
          throw new Error(
            `«${tracks[0].title}» уже есть в папке «Треки». Повторная загрузка не начата.`,
          );
        j.trackNumber = s.nextTrackNumber ?? 1;
        s.nextTrackNumber = j.trackNumber + 1;
      }
      if (s.jobs.length >= 80)
        s.jobs = s.jobs
          .filter(activeJobs)
          .concat(s.jobs.filter((job) => !activeJobs(job)).slice(-60));
      s.jobs.push(j);
    });
    await wakeEngine();
    await updateBadge();
    return j.id;
  }
  if (msg.type === "CANCEL_JOB" && (ctx.ui || ctx.content)) {
    await cancelJob(String(msg.id));
    return;
  }
  if (msg.type === "RETRY" && ctx.ui) {
    await mutate((s) => {
      if (s.jobs.some(activeJobs))
        throw new Error(
          "Уже идёт загрузка. Дождитесь завершения или отмените её.",
        );
      const j = s.jobs.find((x) => x.id === msg.id);
      if (!j || activeJobs(j)) throw new Error("Задача уже выполняется.");
      j.status = "queued";
      j.error = undefined;
      j.downloadId = undefined;
      j.transfer = undefined;
      for (const i of j.items)
        if (
          [
            "failed",
            "cancelled",
            "resolving",
            "fetching",
            "saving",
            "ready",
            ...(i.track.available !== false ? ["skipped"] : []),
          ].includes(i.status)
        ) {
          i.status = "queued";
          i.error = undefined;
          i.downloadId = undefined;
          i.bytes = 0;
          i.total = 0;
        }
    });
    await wakeEngine();
    return;
  }
  if (msg.type === "CLEAR_HISTORY" && ctx.ui) {
    const removed = await mutate((s) => {
      const ids = s.jobs
        .filter((j) => !activeJobs(j))
        .map((j) => ({ id: j.id, count: j.items.length }));
      s.jobs = s.jobs.filter(activeJobs);
      return ids;
    });
    await ensureEngine();
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "CLEAN",
      jobs: removed,
    });
    return;
  }
  if (msg.type === "SHOW_FILE" && ctx.ui) {
    await chrome.downloads.show(Number(msg.id));
    return;
  }
  return UNHANDLED;
}

async function handleEngine(
  msg: RpcRequest,
  ctx: SenderContext,
): Promise<unknown> {
  if (
    msg.type === "SESSION_SOURCE" &&
    (ctx.engine || ctx.ui) &&
    /^\d+$/.test(String(msg.id))
  )
    return fetchSessionSource(
      String(msg.id),
      String(msg.format),
      String(msg.quality),
    );
  if (msg.type === "SESSION_LYRICS" && ctx.engine) {
    if (!/^\d+$/.test(String(msg.id))) throw new Error("Некорректный трек.");
    return fetchSessionLyrics(String(msg.id), msg.format);
  }
  if (msg.type === "ENGINE_STATE" && ctx.engine)
    return { ...(await state()), token: await getMusicToken() };
  if (
    (msg.type === "ENGINE_PATCH" || msg.type === "ENGINE_PATCH_ITEMS") &&
    ctx.engine
  ) {
    if (
      msg.type === "ENGINE_PATCH_ITEMS" &&
      (!Array.isArray(msg.items) || msg.items.length > 5000)
    )
      throw new Error("Некорректный пакет обновлений.");
    await mutate((s) => {
      const j = s.jobs.find((x) => x.id === msg.id);
      if (!j || j.status === "cancelled") return;
      const patch = (msg.patch ?? {}) as Partial<Job>;
      if (patch.status) j.status = patch.status;
      if ("error" in patch) j.error = patch.error;
      if (patch.downloadId !== undefined) j.downloadId = patch.downloadId;
      if (patch.transfer !== undefined) j.transfer = patch.transfer;
      if (
        msg.type === "ENGINE_PATCH" &&
        Number.isInteger(msg.index) &&
        j.items[msg.index!]
      )
        Object.assign(j.items[msg.index!], msg.item as Partial<QueueItem>);
      if (msg.type === "ENGINE_PATCH_ITEMS")
        for (const update of msg.items)
          if (Number.isInteger(update.index) && j.items[update.index])
            Object.assign(
              j.items[update.index],
              update.item as Partial<QueueItem>,
            );
      j.updated = Date.now();
    });
    await updateBadge();
    return;
  }
  if (msg.type === "SAVE_BLOB" && ctx.engine) {
    const url = String(msg.url);
    if (!url.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`))
      throw new Error("Некорректный файл.");
    const current = await state();
    const j = current.jobs.find((job) => job.id === msg.jobId);
    if (!j || j.status === "cancelled") throw new Error("Загрузка отменена.");
    const isArchive = msg.index === undefined && j.settings.zip;
    const sub =
      !j.settings.structuredFolders || isArchive
        ? ""
        : j.kind === "page"
          ? "Треки/"
          : j.kind === "likes"
            ? "Мне нравится/"
            : `${safeName(j.title)}/`;
    const fname = `${safeName(j.settings.folder)}/${sub}${safeFilename(String(msg.filename))}`;
    const id = await chrome.downloads.download({
      url,
      filename: fname,
      saveAs: false,
      conflictAction: "uniquify",
    });
    await mutate((s) => {
      const job = s.jobs.find((x) => x.id === msg.jobId);
      if (!job) return;
      if (Number.isInteger(msg.index) && job.items[msg.index!])
        job.items[msg.index!].downloadId = id;
      else job.downloadId = id;
    });
    return id;
  }
  if (msg.type === "DOWNLOAD_STATE" && ctx.engine) {
    const [d] = await chrome.downloads.search({ id: Number(msg.id) });
    return d ? { state: d.state, error: d.error } : null;
  }
  return UNHANDLED;
}

export function createMessageHandler(deps: HandlerDeps) {
  return async (
    raw: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> => {
    const engine = sender.url === deps.offscreenUrl;
    const ui = sender.url?.split("?")[0] === deps.uiUrl;
    const content = !!sender.tab?.id && isMusic(sender.url ?? "");
    if (!engine && !ui && !content)
      throw new Error("Неизвестный отправитель.");
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof (raw as { type?: unknown }).type !== "string"
    )
      throw new Error("Неизвестная команда.");

    const msg = raw as RpcRequest;
    const ctx: SenderContext = { engine, ui, content, sender };
    const handlers = [
      () => handleApiControl(msg, deps),
      () => handleLibrary(msg, ctx, deps.uiUrl),
      () => handleAccountAndNavigation(msg, ctx, deps.uiUrl),
      () => handlePageAndMetadata(msg, ctx),
      () => handleJobs(msg, ctx),
      () => handleEngine(msg, ctx),
    ];
    for (const run of handlers) {
      const result = await run();
      if (result !== UNHANDLED) return result;
    }
    throw new Error("Неизвестная команда.");
  };
}
