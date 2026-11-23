import { loadCollection } from "./provider";
import { isMusic } from "./shared";
import { mutate, state } from "./state";
import { activeJobs, type Collection } from "./types";
import { getMusicToken, MUSIC_TAB_URLS } from "./background-auth";

let creation: Promise<void> | undefined;
let engineTail: Promise<unknown> = Promise.resolve();

export function engineLock<T>(action: () => Promise<T>) {
  const next = engineTail.then(action);
  engineTail = next.catch(() => {});
  return next;
}

export async function ensureEngine() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creation)
    creation = (async () => {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification:
          "Загрузка доступных аудиофайлов, создание ZIP и сохранение blob без зависимости от popup",
      });
    })();
  try {
    await creation;
  } finally {
    creation = undefined;
  }
}

export const useEngine = <T>(action: () => Promise<T>) =>
  engineLock(async () => {
    await ensureEngine();
    return action();
  });

export async function wakeEngine() {
  await useEngine(async () => {
    try {
      await chrome.runtime.sendMessage({ target: "offscreen", type: "WAKE" });
    } catch {
      /* Its boot message also starts the queue. */
    }
  });
}

export async function updateBadge() {
  const s = await state();
  const count = s.jobs.filter(activeJobs).length;
  await chrome.action.setBadgeText({ text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#FFD84D" });
}

export async function cancelJob(id: string) {
  const ids = await mutate((s) => {
    const j = s.jobs.find((x) => x.id === id);
    if (!j) return [];
    j.status = "cancelled";
    j.updated = Date.now();
    for (const i of j.items)
      if (!["complete", "failed", "skipped"].includes(i.status))
        i.status = "cancelled";
    return [j.downloadId, ...j.items.map((i) => i.downloadId)].filter(
      (n): n is number => typeof n === "number",
    );
  });
  await Promise.allSettled(ids.map((itemId) => chrome.downloads.cancel(itemId)));
  try {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "CANCEL",
      id,
    });
  } catch {}
  await updateBadge();
}

export async function collectionForTab(tabId?: number, full = false) {
  let tab: chrome.tabs.Tab | undefined;
  if (tabId) tab = await chrome.tabs.get(tabId);
  else {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    tab = tabs.find((t) => isMusic(t.url ?? ""));
    if (!tab)
      tab = (await chrome.tabs.query({ url: MUSIC_TAB_URLS })).sort(
        (a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
      )[0];
  }
  if (!tab?.id || !isMusic(tab.url ?? "")) return null;
  let c: Collection;
  try {
    c = await chrome.tabs.sendMessage(tab.id, { type: "COLLECTION" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    c = await chrome.tabs.sendMessage(tab.id, { type: "COLLECTION" });
  }
  if (full) {
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, {
        type: "COLLECTION_FULL",
      });
      if (reply?.ok) c = reply.data;
      else throw new Error(reply?.error);
    } catch {
      try {
        c = await loadCollection(c, await getMusicToken());
      } catch (e) {
        if (!c.tracks.length) throw e;
        c = { ...c, partial: true };
      }
    }
  }
  return { collection: c, tabId: tab.id };
}

export async function injectExistingTabs() {
  for (const tab of await chrome.tabs.query({ url: MUSIC_TAB_URLS })) {
    if (tab.id)
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
      } catch {}
  }
}
