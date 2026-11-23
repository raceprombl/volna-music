import { friendly } from "./shared";
import { mutate, state, validSettings } from "./state";
import { pruneFiles } from "./blob-store";
import { pruneArchives } from "./archive-store";
import { ApiRateLimiter } from "./api-rate";
import { configureApiCoordinator } from "./api-fetch";
import { HttpError } from "./http-error";
import { activeJobs } from "./types";
import { handleOAuthTabUpdate } from "./background-auth";
import {
  engineLock,
  ensureEngine,
  injectExistingTabs,
  updateBadge,
  wakeEngine,
} from "./background-engine";
import { createMessageHandler } from "./background-handlers";

const offscreenUrl = chrome.runtime.getURL("offscreen.html");
const uiUrl = chrome.runtime.getURL("popup.html");
const apiLimiter = new ApiRateLimiter();
configureApiCoordinator({
  acquire: (signal) => apiLimiter.acquire(signal),
  defer: (ms) => apiLimiter.defer(ms),
});
const apiPermits = new Map<string, AbortController>();
const handle = createMessageHandler({
  offscreenUrl,
  uiUrl,
  apiLimiter,
  apiPermits,
});

chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m?.target === "offscreen") return;
  void (async () => {
    try {
      respond({ ok: true, data: await handle(m, sender) });
    } catch (e) {
      respond({
        ok: false,
        error: friendly(e),
        status: e instanceof HttpError ? e.status : undefined,
        retryAfter: e instanceof HttpError ? e.retryAfter : undefined,
      });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await mutate(async (s) => {
      s.settings = validSettings(s.settings);
      await pruneFiles(s.jobs.filter(activeJobs).map((j) => j.id));
      await pruneArchives(s.jobs.filter(activeJobs).map((j) => j.id));
    });
    await chrome.alarms.create("queue-recovery", { periodInMinutes: 1 });
    await injectExistingTabs();
    if ((await state()).jobs.some(activeJobs)) await wakeEngine();
  })().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await chrome.alarms.create("queue-recovery", { periodInMinutes: 1 });
    await mutate(async (s) => {
      for (const j of s.jobs)
        if (activeJobs(j)) {
          j.status = "interrupted";
          j.error =
            "Браузер был закрыт. Нажмите «Повторить», чтобы продолжить.";
          for (const i of j.items)
            if (["resolving", "fetching", "saving"].includes(i.status))
              i.status = "queued";
        }
      await pruneFiles([]);
      await pruneArchives([]);
    });
    await updateBadge();
  })().catch(console.error);
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "queue-recovery")
    void engineLock(() =>
      mutate(async (s) => {
        const active = s.jobs.filter(activeJobs);
        await pruneFiles(active.map((j) => j.id));
        if (active.length) {
          await ensureEngine();
          try {
            await chrome.runtime.sendMessage({
              target: "offscreen",
              type: "WAKE",
            });
          } catch {}
          return;
        }
        if (await chrome.offscreen.hasDocument()) {
          try {
            const status = await chrome.runtime.sendMessage({
              target: "offscreen",
              type: "ENGINE_STATUS",
            });
            if (!status || status.busy) return;
          } catch {
            return;
          }
          await pruneArchives([]);
          await chrome.offscreen.closeDocument();
        } else await pruneArchives([]);
      }),
    ).catch(console.error);
});

chrome.downloads.onChanged.addListener((d) => {
  if (d.state?.current) void updateBadge().catch(() => {});
});

chrome.tabs?.onUpdated?.addListener((id, change) =>
  handleOAuthTabUpdate(id, change, uiUrl),
);
