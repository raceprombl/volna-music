import { defaults, type AppState, type Job, type Settings } from "./types";
export async function state(): Promise<AppState> {
  const data = await chrome.storage.local.get({
    settings: defaults,
    jobs: [],
    nextTrackNumber: null,
  });
  const session = await chrome.storage.session.get("token");
  return {
    settings: { ...defaults, ...data.settings },
    jobs: data.jobs.map((job: Job) => ({
      ...job,
      settings: { ...defaults, ...job.settings },
    })),
    tokenPresent: !!session.token,
    nextTrackNumber:
      Number.isSafeInteger(data.nextTrackNumber) && data.nextTrackNumber > 0
        ? data.nextTrackNumber
        : 1 +
          data.jobs.filter(
            (j: Job) => j.kind === "page" && j.items.length === 1,
          ).length,
  };
}
// The lock is only coordination; all durable state lives in chrome.storage.local.
let tail: Promise<unknown> = Promise.resolve();
export function mutate<T>(fn: (s: AppState) => T | Promise<T>): Promise<T> {
  const next = tail.then(async () => {
    const s = await state();
    const result = await fn(s);
    const persist = () =>
      chrome.storage.local.set({
        settings: s.settings,
        jobs: s.jobs,
        nextTrackNumber: s.nextTrackNumber,
      });
    const isQuota = (error: unknown) =>
      error instanceof Error &&
      (error.name === "QuotaExceededError" ||
        /QUOTA_BYTES|quota.*exceed/i.test(error.message));
    try {
      await persist();
    } catch (error) {
      if (!isQuota(error)) throw error;
      // Drop only old completed/cancelled history, never an active or retryable job.
      const newest = s.jobs.reduce<Job | undefined>(
        (latest, job) =>
          !latest || job.created > latest.created ? job : latest,
        undefined,
      );
      const removable = s.jobs
        .filter(
          (job) =>
            job !== newest && ["complete", "cancelled"].includes(job.status),
        )
        .sort((a, b) => a.created - b.created);
      let saved = false;
      for (const old of removable) {
        s.jobs = s.jobs.filter((job) => job !== old);
        try {
          await persist();
          saved = true;
          break;
        } catch (nextError) {
          if (!isQuota(nextError)) throw nextError;
        }
      }
      if (!saved)
        throw new Error(
          "Хранилище очереди заполнено. Очистите историю загрузок или выберите меньше треков.",
        );
    }
    return result;
  });
  tail = next.catch(() => {});
  return next;
}
export function validSettings(input: Partial<Settings>): Settings {
  const s = { ...defaults, ...input };
  if (
    !["dark", "light", "system"].includes(s.theme) ||
    !["original", "mp3", "flac", "aac", "ogg", "wav"].includes(s.format) ||
    !["best", "192", "128"].includes(s.quality)
  )
    throw new Error("Некорректные настройки.");
  s.concurrency = Math.max(
    1,
    Math.min(16, Math.round(Number(s.concurrency) || defaults.concurrency)),
  );
  for (const k of [
    "zip",
    "numbering",
    "covers",
    "metadata",
    "lyricsTags",
    "lyricsFile",
    "unicodeFilenames",
    "structuredFolders",
  ] as const)
    s[k] = !!s[k];
  if (![400, 600, 800, 1000].includes(Number(s.coverSize))) s.coverSize = 400;
  if (!["off", "error", "warn", "info", "debug"].includes(s.logLevel))
    s.logLevel = "off";
  s.folder =
    String(s.folder)
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, " ")
      .replace(/\.{2,}/g, " ")
      .trim()
      .slice(0, 60) || "VOLNA";
  return s;
}
export function newJob(
  title: string,
  tracks: Job["items"][number]["track"][],
  settings: Settings,
): Job {
  return {
    id: crypto.randomUUID(),
    title: title.slice(0, 200) || "Моя музыка",
    created: Date.now(),
    updated: Date.now(),
    status: "queued",
    settings,
    items: tracks.map((track) => ({
      track,
      status: track.available === false ? "skipped" : "queued",
      bytes: 0,
      total: 0,
      error:
        track.available === false
          ? "Композиция недоступна в вашем регионе"
          : undefined,
    })),
  };
}
