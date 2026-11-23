import { api } from "./provider";
import { existingMusicAccessToken } from "./account-access";
import { HttpError } from "./http-error";

export const MUSIC_TAB_URLS = [
  "https://music.yandex.ru/*",
  "https://music.yandex.kz/*",
  "https://music.yandex.com/*",
  "https://music.yandex.by/*",
  "https://music.yandex.uz/*",
];

let autoAccess: Promise<string> | undefined;
let lastAccessAttempt = 0;

export async function getMusicToken(): Promise<string> {
  const saved = String((await chrome.storage.session.get("token")).token ?? "");
  if (saved) return saved;
  if (autoAccess) return autoAccess;
  if (Date.now() - lastAccessAttempt < 60000) return "";
  lastAccessAttempt = Date.now();
  autoAccess = (async () => {
    const tabs = await chrome.tabs.query({ url: MUSIC_TAB_URLS });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: existingMusicAccessToken,
        });
        const candidate = result[0]?.result;
        if (!candidate) continue;
        await api("/account/status", candidate, AbortSignal.timeout(10000));
        await chrome.storage.session.set({ token: candidate });
        return candidate;
      } catch {
        /* No token or expired Music access: use the normal page session. */
      }
    }
    return "";
  })();
  try {
    return await autoAccess;
  } finally {
    autoAccess = undefined;
  }
}

export async function startMusicOAuth() {
  if (await getMusicToken()) return { connected: true };
  // Same registered Music OAuth client/redirect used by the user-selected Fisher project.
  const nonce = crypto.randomUUID();
  const params = new URLSearchParams({
    response_type: "token",
    client_id: "97fe03033fa34407ac9bcf91d5afed5b",
    redirect_uri: "https://music.yandex.ru/oauth",
    state: nonce,
  });
  const tab = await chrome.tabs.create({
    url: "https://oauth.yandex.ru/authorize?" + params,
  });
  await chrome.storage.session.set({
    pendingMusicOAuth: { tabId: tab.id, nonce, expires: Date.now() + 600000 },
  });
  return { connected: false, opened: true };
}

export function handleOAuthTabUpdate(
  id: number,
  change: { url?: string },
  uiUrl: string,
) {
  if (!change.url?.startsWith("https://music.yandex.ru/oauth")) return;
  void (async () => {
    const { pendingMusicOAuth: pending } =
      await chrome.storage.session.get("pendingMusicOAuth");
    if (!pending || pending.tabId !== id || pending.expires < Date.now())
      return;
    const url = new URL(change.url!);
    if (url.origin !== "https://music.yandex.ru" || url.pathname !== "/oauth")
      return;
    const params = new URLSearchParams(url.hash.slice(1));
    if (params.get("state") !== pending.nonce) return;
    const access = params.get("access_token");
    if (!access || !/^[a-zA-Z0-9_.-]{20,4000}$/.test(access)) return;
    await chrome.scripting.executeScript({
      target: { tabId: id },
      world: "MAIN",
      func: () => history.replaceState(null, "", location.pathname),
    });
    await api("/account/status", access, AbortSignal.timeout(10000));
    await chrome.storage.session.set({ token: access });
    await chrome.storage.session.remove("pendingMusicOAuth");
    await chrome.tabs.update(id, { url: uiUrl + "?view=settings" });
  })().catch(() => {
    /* OAuth secrets never enter logs. User may retry normal sign-in. */
  });
}

let lastMusicTabId: number | undefined;

export async function fetchSessionSource(
  id: string,
  format: string,
  quality: string,
) {
  if (lastMusicTabId !== undefined) {
    try {
      const r = await chrome.tabs.sendMessage(lastMusicTabId, {
        type: "SESSION_SOURCE",
        id,
        format,
        quality,
      });
      if (r?.ok && r.data?.url) return r.data;
      if (r?.status === 429) throw new HttpError(429, r.retryAfter);
      lastMusicTabId = undefined;
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) throw error;
      lastMusicTabId = undefined;
    }
  }
  for (const tab of (
    await chrome.tabs.query({ url: MUSIC_TAB_URLS })
  ).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))) {
    if (!tab.id) continue;
    try {
      const r = await chrome.tabs.sendMessage(tab.id, {
        type: "SESSION_SOURCE",
        id,
        format,
        quality,
      });
      if (r?.ok && r.data?.url) {
        lastMusicTabId = tab.id;
        return r.data;
      }
      if (r?.status === 429) throw new HttpError(429, r.retryAfter);
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) throw error;
    }
  }
  throw new Error(
    "Сессия Яндекс Музыки не предоставила полный файл. Откройте Музыку и проверьте вход в аккаунт.",
  );
}

export async function fetchSessionLyrics(id: string, format: "LRC" | "TEXT") {
  if (lastMusicTabId !== undefined) {
    try {
      const result = await chrome.tabs.sendMessage(lastMusicTabId, {
        type: "SESSION_LYRICS",
        id,
        format,
      });
      if (result?.ok && result.data?.downloadUrl) return result.data;
    } catch {
      lastMusicTabId = undefined;
    }
  }
  const tabs = await chrome.tabs.query({ url: MUSIC_TAB_URLS });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: "SESSION_LYRICS",
        id,
        format,
      });
      if (result?.ok && result.data?.downloadUrl) {
        lastMusicTabId = tab.id;
        return result.data;
      }
    } catch {}
  }
  return null;
}
