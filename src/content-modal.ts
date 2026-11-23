import { readCollection } from "./page-adapter";
import { friendly, progress, rpc } from "./shared";
import { transferInfo } from "./transfer-meter";
import type { Collection, Format, Job, Settings, Track } from "./types";
import { circleProgress, element, icon } from "./content-dom";

export interface ModalDeps {
  shadow: ShadowRoot;
  activityReady: Promise<void>;
  getState: () => {
    activeJob: Job | null;
    activityKnown: boolean;
    starting: boolean;
    disposed: boolean;
  };
  setStarting: (value: boolean) => void;
  applyActivity: (job: Job | null) => void;
  paintDownloads: () => void;
  setSyncModalStart: (fn: (() => void) | undefined) => void;
  clearSyncModalStart: (fn: () => void) => void;
  setJobTimer: (timer: ReturnType<typeof setInterval>) => void;
  clearJobTimer: () => void;
}

export async function openCollectionModal(deps: ModalDeps, single?: Track) {
  await deps.activityReady;
  const initial = deps.getState();
  if (!initial.activityKnown || initial.activeJob || initial.starting) return;
  deps.shadow.querySelector("dialog")?.remove();
  deps.clearJobTimer();
  const dialog = element("dialog");
  dialog.setAttribute("aria-labelledby", "volna-title");
  dialog.setAttribute("closedby", "any");
  const head = element("div", undefined, "head");
  const close = element("button", undefined, "icon");
  close.setAttribute("aria-label", "Закрыть");
  close.append(icon("close"));
  close.onclick = () => dialog.close();
  head.append(close);
  const title = element("h2", single?.title || readCollection().title);
  title.id = "volna-title";
  const subtitle = element("p", "Получаем список композиций…", "muted");
  const status = element("p", undefined, "muted");
  status.setAttribute("role", "status");
  const error = element("p", undefined, "error");
  error.setAttribute("role", "alert");
  const formatLabel = element("label", "Формат файла", "field"),
    format = element("select");
  format.setAttribute("aria-label", "Формат файла");
  for (const [value, label] of [
    ["original", "Оригинал · без перекодирования"],
    ["mp3", "MP3"],
    ["flac", "FLAC · если доступен"],
    ["aac", "M4A / AAC · если доступен"],
    ["ogg", "OGG · если доступен"],
    ["wav", "WAV · преобразование в PCM"],
  ]) {
    const o = element("option", label);
    o.value = value;
    format.append(o);
  }
  formatLabel.append(format);
  const qualityLabel = element("label", "Качество", "field"),
    quality = element("select");
  quality.setAttribute("aria-label", "Качество");
  for (const [value, label] of [
    ["best", "Лучшее из доступных"],
    ["192", "До 192 кбит/с · если доступно"],
    ["128", "До 128 кбит/с · если доступно"],
  ]) {
    const o = element("option", label);
    o.value = value;
    quality.append(o);
  }
  qualityLabel.append(quality);
  const threadsLabel = element("label", "Потоки загрузки", "field"),
    threads = element("select");
  threads.setAttribute("aria-label", "Потоки загрузки");
  for (const count of Array.from({ length: 16 }, (_, i) => i + 1)) {
    const option = element(
      "option",
      count === 1 ? "1 (по очереди)" : String(count),
    );
    option.value = String(count);
    threads.append(option);
  }
  threads.value = "12";
  threadsLabel.append(threads);
  const check = element("label", undefined, "check"),
    zip = element("input");
  zip.type = "checkbox";
  zip.checked = !single;
  check.append(zip, document.createTextNode("ZIP-архив"));
  const note = element(
    "div",
    "Скачивайте только контент, на получение которого у вас есть разрешение. Защищённые файлы не расшифровываются.",
    "notice",
  );
  const actions = element("div", undefined, "actions"),
    cancel = element("button", "Отмена"),
    start = element("button", "Добавить в очередь", "primary");
  start.disabled = true;
  let ready = false;
  const syncStart = () => {
    const { activeJob, starting, activityKnown } = deps.getState();
    start.disabled = !ready || !!activeJob || starting || !activityKnown;
    start.replaceChildren(
      ...(activeJob
        ? [
            circleProgress(progress(activeJob)),
            document.createTextNode(`Загружается · ${progress(activeJob)}%`),
          ]
        : [document.createTextNode("Начать загрузку")]),
    );
  };
  deps.setSyncModalStart(syncStart);
  cancel.onclick = () => dialog.close();
  actions.append(cancel, start);
  dialog.append(
    head,
    title,
    subtitle,
    formatLabel,
    qualityLabel,
    threadsLabel,
    check,
    note,
    error,
    status,
    actions,
  );
  deps.shadow.append(dialog);
  dialog.showModal();
  dialog.addEventListener(
    "close",
    () => {
      deps.clearJobTimer();
      deps.clearSyncModalStart(syncStart);
    },
    { once: true },
  );
  let collection: Collection | undefined;
  try {
    const settings = await rpc("GET_DOWNLOAD_SETTINGS").catch(() => null);
    if (settings) {
      format.value = settings.format ?? "original";
      quality.value = settings.quality ?? "best";
      threads.value = String(settings.concurrency ?? 12);
    }
    collection = single
      ? {
          title: single.title,
          kind: "page",
          url: location.href,
          tracks: [single],
        }
      : await rpc("EXPAND");
    if (!dialog.open) return;
    if (!collection) throw new Error("Не удалось получить список композиций.");
    subtitle.textContent = `${collection.tracks.length} композиций${collection.partial ? " · только найденные на странице" : ""}`;
    ready = !!collection.tracks.length;
    syncStart();
  } catch (e) {
    error.textContent = friendly(e);
    subtitle.textContent =
      "Не удалось получить список. Треки на странице можно скачивать отдельно.";
  }
  start.onclick = async () => {
    const current = deps.getState();
    if (
      !collection ||
      current.activeJob ||
      current.starting ||
      !current.activityKnown
    )
      return;
    deps.setStarting(true);
    deps.paintDownloads();
    start.disabled = true;
    error.textContent = "";
    try {
      const id = await rpc("ENQUEUE", {
        title: collection.title,
        kind: collection.kind,
        tracks: collection.tracks,
        settings: {
          format: format.value as Format,
          quality: quality.value as Settings["quality"],
          zip: zip.checked,
          concurrency: Number(threads.value),
        },
      });
      deps.applyActivity(await rpc("GET_ACTIVE_JOB"));
      formatLabel.hidden = true;
      qualityLabel.hidden = true;
      threadsLabel.hidden = true;
      check.hidden = true;
      note.hidden = true;
      start.hidden = true;
      cancel.textContent = "Продолжить в фоне";
      subtitle.textContent = "Можно закрыть окно — загрузка продолжится.";
      const p = element("div", undefined, "progress"),
        bar = element("div", undefined, "bar");
      p.append(bar);
      status.before(p);
      const transferDetails = element("div", undefined, "transfer-details");
      transferDetails.setAttribute("aria-label", "Скорость и время загрузки");
      const speedRow = element("div"),
        speedText = element("span"),
        waitText = element("span");
      const volumeText = element("p");
      speedRow.append(speedText, waitText);
      transferDetails.append(speedRow, volumeText);
      status.after(transferDetails);
      const stop = element("button", "Отменить загрузку");
      actions.prepend(stop);
      stop.onclick = async () => {
        try {
          await rpc("CANCEL_JOB", { id });
          stop.disabled = true;
        } catch (e) {
          error.textContent = friendly(e);
        }
      };
      let inFlight = false;
      let finished = false;
      const update = async () => {
        const { disposed } = deps.getState();
        if (inFlight || disposed || !dialog.open || !dialog.isConnected) return;
        inFlight = true;
        try {
          const j = await rpc("GET_JOB", { id });
          if (deps.getState().disposed || !dialog.open || !dialog.isConnected)
            return;
          if (!j) {
            finished = true;
            stop.hidden = true;
            cancel.textContent = "Закрыть";
            status.textContent = "Задача удалена из истории.";
            deps.clearJobTimer();
            return;
          }
          const done = j.items.filter((i) =>
            ["complete", "ready", "skipped", "failed"].includes(i.status),
          ).length;
          bar.style.transform = `scaleX(${progress(j) / 100})`;
          const info = transferInfo(j);
          speedText.textContent = info.speed;
          waitText.textContent = info.remaining;
          volumeText.textContent = info.volume;
          speedRow.hidden = !info.speed && !info.remaining;
          status.textContent = `${done} / ${j.items.length} · ${j.status === "packing" ? "Сохранение ZIP" : j.status === "cancelled" ? "Отменено" : j.status === "complete" ? "Готово" : j.status === "partial" ? "Готово с ошибками" : j.status === "interrupted" ? "Загрузка прервана" : j.status === "failed" ? "Загрузка не выполнена" : "В очереди / загрузка"}`;
          const failure = j.items.find(
            (i) => ["failed", "skipped"].includes(i.status) && i.error,
          );
          error.textContent =
            j.error ||
            (failure ? `${failure.track.title}: ${failure.error}` : "");
          if (!["queued", "running", "packing"].includes(j.status)) {
            finished = true;
            stop.hidden = true;
            cancel.textContent = "Закрыть";
            deps.clearJobTimer();
          }
        } catch (e) {
          error.textContent = friendly(e);
        } finally {
          inFlight = false;
        }
      };
      await update();
      if (
        !finished &&
        dialog.open &&
        dialog.isConnected &&
        !deps.getState().disposed
      )
        deps.setJobTimer(setInterval(() => void update(), 1000));
    } catch (e) {
      error.textContent = friendly(e);
    } finally {
      deps.setStarting(false);
      deps.paintDownloads();
    }
  };
}
