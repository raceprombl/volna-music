import { ROW_SELECTOR, readCollection, rowTrack } from "./page-adapter";
import { friendly, progress, rpc } from "./shared";
import { activeJobs, type Job, type Track } from "./types";
import {
  circleProgress,
  element,
  icon,
  NS,
  shadowHost,
} from "./content-dom";
import { createContentMessageHandler } from "./content-messages";
import { openCollectionModal } from "./content-modal";

const win = window as Window & { __volnaCleanup?: () => void };
try {
  win.__volnaCleanup?.();
} catch {
  /* Old extension context can be invalid after reload. */
}
for (const stale of document.querySelectorAll("[data-volna]")) stale.remove();

let lastUrl = location.href;
let frame = 0;
let disposed = false;
const pending = new Set<Element>();
const rows = new Map<Element, () => void>();
const controller = new AbortController();

const overlay = shadowHost();
overlay.host.id = "volna-overlay";
document.documentElement.append(overlay.host);

let activeJob: Job | null = null;
let activityKnown = false;
let starting = false;
let startingTrackId: string | null = null;
let syncModalStart: (() => void) | undefined;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let jobTimer: ReturnType<typeof setInterval> | undefined;
let toolbar: HTMLElement | undefined;
let playerHost: HTMLElement | undefined;
let scanning = false;

const downloadButtons = new Map<
  HTMLButtonElement,
  { label: string; text: boolean; track?: () => Track | undefined }
>();

function paintDownloads() {
  const busy = !!activeJob || starting || !activityKnown;
  for (const [button, base] of downloadButtons) {
    if (!button.isConnected) {
      downloadButtons.delete(button);
      continue;
    }
    const track = base.track?.();
    const item =
      track && activeJob?.items.find((i) => i.track?.id === track.id);
    const ownTrack =
      !!item &&
      (["resolving", "fetching", "saving"].includes(item.status) ||
        activeJob!.items.length === 1);
    const ownCollection =
      base.text &&
      ((starting && !startingTrackId) ||
        (!!activeJob &&
          activeJob.kind !== "page" &&
          activeJob.title === readCollection().title));
    const ownPending = starting && !!track && track.id === startingTrackId;
    const showProgress = ownTrack || ownCollection || ownPending;
    const value = item
      ? progress({ ...activeJob!, items: [item] })
      : activeJob
        ? progress(activeJob)
        : 0;
    const label = activeJob
      ? `${activeJob.status === "packing" ? "Создаём ZIP" : "Загружается"} · ${value}%`
      : "Подготовка…";
    button.disabled = busy;
    button.setAttribute("aria-busy", String(showProgress));
    button.setAttribute(
      "aria-label",
      showProgress
        ? `${label}. Новая загрузка будет доступна после завершения`
        : base.label,
    );
    button.title = busy
      ? "Дождитесь завершения или отмените текущую загрузку"
      : base.label;
    button.style.opacity = showProgress ? "1" : "";
    button.replaceChildren(
      showProgress ? circleProgress(value) : icon("download"),
    );
    if (base.text)
      button.append(document.createTextNode(showProgress ? label : base.label));
  }
  syncModalStart?.();
}

function registerDownload(
  button: HTMLButtonElement,
  label: string,
  text = false,
  track?: () => Track | undefined,
) {
  downloadButtons.set(button, { label, text, track });
}

function applyActivity(job: Job | null) {
  activeJob = job;
  activityKnown = true;
  paintDownloads();
}

const activityReady = rpc("GET_ACTIVE_JOB")
  .then((job) => {
    if (!activityKnown) applyActivity(job);
  })
  .catch(() => {
    /* Keep disabled until state is known. */
  });

const onStorage = (
  changes: { [key: string]: chrome.storage.StorageChange },
  area: string,
) => {
  if (area === "local" && changes.jobs)
    applyActivity(
      ((changes.jobs.newValue as Job[] | undefined) ?? []).find(activeJobs) ??
        null,
    );
};
chrome.storage?.onChanged?.addListener(onStorage);

function toast(text: string) {
  overlay.shadow.querySelector(".toast")?.remove();
  const e = element("div", text, "toast");
  e.setAttribute("role", "status");
  overlay.shadow.append(e);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => e.remove(), 6000);
}

async function downloadSingle(track: Track) {
  await activityReady;
  if (!activityKnown || activeJob || starting) return;
  starting = true;
  startingTrackId = track.id;
  paintDownloads();
  try {
    await rpc("ENQUEUE", {
      title: track.title,
      kind: "page",
      tracks: [track],
      // Format/quality/tags come from saved settings; a single song is a file.
      settings: { zip: false },
    });
    applyActivity(await rpc("GET_ACTIVE_JOB"));
    toast(`Скачиваем «${track.title}»`);
  } catch (e) {
    toast(friendly(e));
  } finally {
    starting = false;
    startingTrackId = null;
    paintDownloads();
  }
}

const modalDeps = {
  shadow: overlay.shadow,
  activityReady,
  getState: () => ({ activeJob, activityKnown, starting, disposed }),
  setStarting: (value: boolean) => {
    starting = value;
  },
  applyActivity,
  paintDownloads,
  setSyncModalStart: (fn: (() => void) | undefined) => {
    syncModalStart = fn;
  },
  clearSyncModalStart: (fn: () => void) => {
    if (syncModalStart === fn) syncModalStart = undefined;
  },
  setJobTimer: (timer: ReturnType<typeof setInterval>) => {
    jobTimer = timer;
  },
  clearJobTimer: () => {
    clearInterval(jobTimer);
  },
};

function enhance(row: Element) {
  if (
    disposed ||
    row.closest(`[${NS}]`) ||
    row.parentElement?.closest(ROW_SELECTOR)
  )
    return;
  const t = rowTrack(row);
  if (!t) return;
  const existing = row.querySelector<HTMLElement>(
    ":scope > [data-volna-track]",
  );
  if (existing) {
    existing.dataset.volnaTrack = t.id;
    const button = existing.shadowRoot?.querySelector("button");
    if (button)
      registerDownload(button, `Скачать «${t.title}» через VOLNA`, false, () =>
        rowTrack(row),
      );
    return;
  }
  const { host, shadow } = shadowHost();
  host.dataset.volnaTrack = t.id;
  host.style.cssText =
    "display:inline-flex;align-self:center;flex:0 0 auto;vertical-align:middle";
  const button = element("button", undefined, "icon trackbutton");
  button.setAttribute("aria-label", `Скачать «${t.title}» через VOLNA`);
  button.title = "Скачать через VOLNA";
  button.append(icon("download"));
  button.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const current = rowTrack(row);
      if (current) void downloadSingle(current);
    },
    { signal: controller.signal },
  );
  shadow.append(button);
  row.append(host);
  registerDownload(button, `Скачать «${t.title}» через VOLNA`, false, () =>
    rowTrack(row),
  );
  paintDownloads();
  rows.set(row, () => host.remove());
}

function updateToolbar() {
  if (disposed) return;
  for (const duplicate of document.querySelectorAll<HTMLElement>(`[${NS}]`))
    if (
      duplicate !== toolbar &&
      duplicate.shadowRoot?.querySelector(".toolbar")
    )
      duplicate.remove();
  const heading = document.querySelector("main h1,h1");
  if (!heading) return;
  if (toolbar?.isConnected) return;
  const { host, shadow } = shadowHost();
  host.style.cssText = "display:block;margin:16px 0";
  const bar = element("div", undefined, "toolbar");
  const button = element("button", undefined, "primary");
  button.append(icon("download"), document.createTextNode("Скачать плейлист"));
  const path = location.pathname;
  const kind = path.includes("/album/")
    ? "album"
    : /\/playlists\/lk\.|\/(collection|my)\//.test(path)
      ? "likes"
      : "playlist";
  button.lastChild!.textContent =
    kind === "album"
      ? "Скачать альбом"
      : kind === "likes"
        ? "Скачать «Мне нравится»"
        : "Скачать плейлист";
  button.onclick = () => void openCollectionModal(modalDeps);
  bar.append(button);
  const list = element("button", undefined, "icon");
  list.setAttribute("aria-label", "Сохранить список треков");
  list.title = "Сохранить список треков";
  list.append(icon("document"));
  list.onclick = async () => {
    list.disabled = true;
    try {
      const collection = await rpc("EXPAND");
      if (!collection) throw new Error("Не удалось получить список треков.");
      await rpc("EXPORT_TRACKLIST", { collection });
      toast("Список треков сохранён");
    } catch (e) {
      toast(friendly(e));
    } finally {
      list.disabled = false;
    }
  };
  bar.append(list);
  const settings = element("button", undefined, "icon");
  settings.setAttribute("aria-label", "Настройки VOLNA");
  settings.title = "Настройки VOLNA";
  settings.append(icon("settings"));
  settings.onclick = () =>
    void rpc("OPEN_SETTINGS").catch((e) => toast(friendly(e)));
  bar.append(settings);
  shadow.append(bar);
  heading.parentElement?.append(host);
  toolbar = host;
  registerDownload(button, button.textContent!, true);
  paintDownloads();
}

function updatePlayer() {
  if (disposed) return;
  const player = document.querySelector(
    'section[class*="PlayerBar"],[class*="PlayerBarDesktop_root"],[class*="PlayerBar_root"]',
  );
  if (!player) return;
  // A previous asynchronous scan may finish after extension re-injection.
  // Keep exactly one player control across scans and player replacements.
  for (const duplicate of document.querySelectorAll("[data-volna-player]"))
    if (duplicate !== playerHost) duplicate.remove();
  if (playerHost?.isConnected && player.contains(playerHost)) return;
  playerHost?.remove();
  const { host, shadow } = shadowHost();
  host.dataset.volnaPlayer = "";
  host.style.cssText =
    "display:inline-flex;align-items:center;align-self:center;flex:0 0 44px;width:44px;height:44px;margin:0 12px 0 0;position:relative;z-index:1";
  const button = element("button", undefined, "primary icon");
  button.style.cssText =
    "width:44px;min-height:44px;border-radius:50%;background:#ffdc5e;color:#1a180e;flex:0 0 44px";
  button.setAttribute("aria-label", "Скачать текущий трек");
  button.title = "Скачать текущий трек";
  button.append(icon("download"));
  button.addEventListener("pointerdown", (e) => e.stopPropagation(), {
    signal: controller.signal,
  });
  button.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await rpc("RENDER_METADATA");
      const current = rowTrack(player);
      if (!current)
        throw new Error(
          "Не удалось определить текущий трек. Запустите воспроизведение и повторите.",
        );
      await downloadSingle(current);
    } catch (e) {
      toast(friendly(e));
    }
  };
  shadow.append(button);
  // Join the real right-hand flex group, reserving width inside it. Appending
  // beside the full-width player wrapper overlaps the volume control.
  const controls =
    player.querySelector('[class*="ChangeVolume_root"]')?.parentElement ??
    player.querySelector(
      '[class*="PlayerBarDesktopWithBackgroundProgressBar_meta"],[class*="PlayerBarDesktop_meta"],[class*="rightControls"],[class*="RightControls"],[class*="PlayerBarDesktop_controls"]',
    );
  if (!controls) return;
  controls.prepend(host);
  playerHost = host;
  registerDownload(button, "Скачать текущий трек", false, () =>
    rowTrack(player),
  );
  paintDownloads();
}

async function flush() {
  frame = 0;
  if (disposed || scanning) return;
  scanning = true;
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    toolbar?.remove();
    toolbar = undefined;
    pending.clear();
    pending.add(document.querySelector("main") ?? document.body);
  }
  const candidates = new Set<Element>();
  for (const root of pending) {
    if (!root.isConnected) continue;
    if (root.matches(ROW_SELECTOR)) candidates.add(root);
    for (const row of root.querySelectorAll(ROW_SELECTOR)) candidates.add(row);
  }
  pending.clear();
  let count = 0;
  for (const row of candidates) {
    if (disposed) break;
    enhance(row);
    if (++count % 30 === 0)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  }
  if (
    [...candidates].some(
      (row) => !rowTrack(row) || (row as HTMLElement).dataset.volnaTrackId,
    )
  )
    try {
      await rpc("RENDER_METADATA");
      if (disposed) return;
      for (const row of candidates) enhance(row);
    } catch {}
  if (disposed) return;
  updateToolbar();
  updatePlayer();
  paintDownloads();
  for (const row of rows.keys()) if (!row.isConnected) rows.delete(row);
  scanning = false;
  if (pending.size && !disposed)
    frame = requestAnimationFrame(() => void flush());
}

function schedule(root: Element) {
  if (root.closest(`[${NS}]`)) return;
  // Coalesce overlapping added subtrees before walking them.
  for (const queued of pending) {
    if (queued.contains(root)) return;
    if (root.contains(queued)) pending.delete(queued);
  }
  pending.add(root);
  if (!frame && !scanning) frame = requestAnimationFrame(() => void flush());
}

const observer = new MutationObserver((records) => {
  let changed = false;
  for (const record of records) {
    for (const node of record.addedNodes)
      if (node instanceof Element && node.hasAttribute(NS)) {
        // Remove late controls from obsolete isolated script instances without
        // scheduling a new full-page scan or interrupting playback.
        if (
          (node.hasAttribute("data-volna-player") && node !== playerHost) ||
          (node.shadowRoot?.querySelector(".toolbar") && node !== toolbar)
        )
          node.remove();
      } else if (node instanceof Element && !node.hasAttribute(NS)) {
        schedule(node);
        changed = true;
      }
    if (record.type === "attributes" && record.target instanceof Element) {
      schedule(record.target.closest(ROW_SELECTOR) ?? record.target);
      changed = true;
    }
    if (record.type === "characterData") {
      const row = record.target.parentElement?.closest(ROW_SELECTOR);
      if (row) {
        schedule(row);
        changed = true;
      }
    }
  }
  if (location.href !== lastUrl || (!toolbar?.isConnected && changed))
    schedule(document.querySelector("main") ?? document.body);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["href"],
  characterData: true,
});

window.addEventListener(
  "popstate",
  () => schedule(document.querySelector("main") ?? document.body),
  { signal: controller.signal },
);

const onMessage = createContentMessageHandler(controller);
chrome.runtime.onMessage.addListener(onMessage);
schedule(document.querySelector("main") ?? document.body);

win.__volnaCleanup = () => {
  disposed = true;
  observer.disconnect();
  controller.abort();
  cancelAnimationFrame(frame);
  clearInterval(jobTimer);
  clearTimeout(toastTimer);
  overlay.host.remove();
  toolbar?.remove();
  playerHost?.remove();
  for (const remove of rows.values()) remove();
  rows.clear();
  chrome.runtime.onMessage.removeListener(onMessage);
  chrome.storage?.onChanged?.removeListener(onStorage);
  downloadButtons.clear();
};
