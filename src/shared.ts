import type { Format, Job, Reply, Source, Track } from "./types";
import type { RpcCommand, RpcMap } from "./rpc";
import { HttpError } from "./http-error";
export const MUSIC_HOST = /^music\.yandex\.(ru|kz|com|by|uz)$/;
export function isMusic(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && MUSIC_HOST.test(u.hostname);
  } catch {
    return false;
  }
}
export function safeName(
  value: string,
  fallback = "Без названия",
  unicode = false,
) {
  if (unicode) {
    const replacements: Record<string, string> = {
      "?": "？",
      ":": "：",
      '"': "＂",
      "<": "＜",
      ">": "＞",
      "/": "／",
      "\\": "＼",
      "|": "｜",
      "*": "＊",
    };
    value = value.replace(/[?:"<>/\\|*]/g, (c) => replacements[c]);
  }
  const cleaned = value
    .normalize("NFC")
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 110);
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned || fallback;
}
export function filename(
  track: Track,
  index: number,
  ext: string,
  numbering: boolean,
  unicode = false,
) {
  return `${numbering ? String(index + 1).padStart(2, "0") + " · " : ""}${safeName(track.artists, "Неизвестный исполнитель", unicode)} — ${safeName(track.title, "Без названия", unicode)}.${ext}`;
}
export function safeFilename(value: string) {
  const dot = value.lastIndexOf(".");
  const ext =
    dot >= 0
      ? value
          .slice(dot + 1)
          .replace(/[^a-z0-9]/gi, "")
          .slice(0, 8)
      : "";
  return (
    safeName(dot >= 0 ? value.slice(0, dot) : value) + (ext ? "." + ext : "")
  );
}
export function allowedMedia(url: string) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (/\.(storage|strm|music)\.yandex\.net$/.test(u.hostname) ||
        ["storage.mds.yandex.net", "api.music.yandex.ru"].includes(u.hostname))
    );
  } catch {
    return false;
  }
}
export function coverUrl(value: unknown, size = 400) {
  if (typeof value !== "string") return;
  try {
    const u = new URL(
      value.startsWith("https://") ? value : `https://${value}`,
    );
    if (!["avatars.yandex.net", "avatars.mds.yandex.net"].includes(u.hostname))
      return;
    u.pathname = u.pathname.replace(
      /%%|\d{2,4}x\d{2,4}(?=\/|$)/,
      `${size}x${size}`,
    );
    return u.href;
  } catch {
    return;
  }
}
export function chooseSource(
  sources: Source[],
  format: Format,
  quality: string,
) {
  const codec = (s: Source) => s.codec.toLowerCase();
  let list = sources.filter(
    (s) =>
      allowedMedia(s.url) &&
      /^(mp3|flac|aac|m4a|mp4|ogg|vorbis|wav)$/.test(codec(s)),
  );
  if (format !== "original" && format !== "wav")
    list = list.filter((s) =>
      format === "aac"
        ? ["aac", "m4a", "mp4"].includes(codec(s))
        : format === "ogg"
          ? ["ogg", "vorbis"].includes(codec(s))
          : codec(s) === format,
    );
  if (!list.length)
    throw new Error(
      "Сервис не предоставил файл в выбранном формате. Выберите «Оригинал» или другой доступный формат.",
    );
  if (quality !== "best") {
    const cap = Number(quality);
    const limited = list.filter((s) => s.bitrate > 0 && s.bitrate <= cap);
    if (limited.length) list = limited;
  }
  return [...list].sort(
    (a, b) =>
      (codec(b) === "flac" ? 10000 : b.bitrate) -
      (codec(a) === "flac" ? 10000 : a.bitrate),
  )[0];
}
export function progress(job: Job) {
  if (!job.items.length) return 0;
  const sum = job.items.reduce(
    (n, i) =>
      n +
      (["complete", "ready", "skipped", "failed", "cancelled"].includes(
        i.status,
      )
        ? 1
        : i.total
          ? Math.min(0.98, i.bytes / i.total)
          : 0),
    0,
  );
  return Math.round((sum / job.items.length) * 100);
}
export type EmptyRpcCommand = {
  [K in RpcCommand]: keyof RpcMap[K]["req"] extends never ? K : never;
}[RpcCommand];
export type OptionalPayloadRpcCommand = {
  [K in RpcCommand]: keyof RpcMap[K]["req"] extends never
    ? never
    : Record<never, never> extends RpcMap[K]["req"]
      ? K
      : never;
}[RpcCommand];
export type RequiredPayloadRpcCommand = Exclude<
  RpcCommand,
  EmptyRpcCommand | OptionalPayloadRpcCommand
>;
export function rpc<K extends EmptyRpcCommand>(
  type: K,
  payload?: Record<string, never>,
): Promise<RpcMap[K]["res"]>;
export function rpc<K extends OptionalPayloadRpcCommand>(
  type: K,
  payload?: RpcMap[K]["req"],
): Promise<RpcMap[K]["res"]>;
export function rpc<K extends RequiredPayloadRpcCommand>(
  type: K,
  payload: RpcMap[K]["req"],
): Promise<RpcMap[K]["res"]>;
export async function rpc<K extends RpcCommand>(
  type: K,
  payload: Record<string, unknown> = {},
): Promise<RpcMap[K]["res"]> {
  const r: Reply<RpcMap[K]["res"]> = await chrome.runtime.sendMessage({
    type,
    ...payload,
  });
  if (!r?.ok && r?.status) throw new HttpError(r.status, r.retryAfter);
  if (!r?.ok)
    throw new Error(
      r?.error || "Расширение не ответило. Откройте окно ещё раз.",
    );
  return r.data as RpcMap[K]["res"];
}
export function friendly(error: unknown) {
  const m = error instanceof Error ? error.message : String(error);
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  if (/QUOTA_BYTES|storage quota/i.test(m))
    return "Хранилище очереди заполнено. Очистите историю загрузок и повторите.";
  if (
    /FILE_NO_SPACE|QuotaExceededError|disk full|not enough space/i.test(m) ||
    name === "QuotaExceededError"
  )
    return "Недостаточно места на диске. Освободите место и повторите загрузку.";
  if (
    /FILE_ACCESS_DENIED|NotAllowedError|permission denied/i.test(m) ||
    name === "NotAllowedError"
  )
    return "Нет доступа к папке. Восстановите доступ в настройках VOLNA и повторите загрузку.";
  if (name === "NoModificationAllowedError")
    return "Файл занят другой программой. Закройте её и повторите сохранение.";
  if (/USER_CANCELED/.test(m))
    return "Сохранение отменено в Chrome. Нажмите «Повторить», чтобы скачать файл.";
  if (/USER_SHUTDOWN/.test(m))
    return "Chrome закрылся во время сохранения. Повторите загрузку.";
  if (/FILE_TOO_LARGE/.test(m))
    return "Файл слишком большой для выбранного диска. Выберите диск с поддержкой больших файлов.";
  if (/FILE_FAILED/.test(m))
    return "Не удалось записать файл. Проверьте доступ к папке и свободное место на диске.";
  if (name === "AbortError")
    return "Загрузка прервана. Нажмите «Повторить», чтобы попробовать снова.";
  if (name === "EncodingError")
    return "Не удалось прочитать аудио. Файл может быть повреждён. Повторите загрузку.";
  if (
    name === "TimeoutError" ||
    /NETWORK_TIMEOUT|ERR_TIMED_OUT|timed? out|due to timeout|\b408\b/i.test(m)
  )
    return "Сервер долго не отвечает. Проверьте интернет и повторите загрузку.";
  if (
    /Failed to fetch|Load failed|NetworkError|NETWORK_|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION_|ERR_NAME_NOT_RESOLVED/i.test(
      m,
    )
  )
    return "Ошибка соединения с интернетом или сервером. Проверьте сеть и повторите загрузку.";
  if (
    /Extension context invalidated|Receiving end does not exist|message port closed/i.test(
      m,
    )
  )
    return "Связь с VOLNA прервалась. Обновите страницу Яндекс Музыки и повторите загрузку.";
  if (/\b401\b/.test(m))
    return "Вход в Яндекс Музыку истёк. Откройте Музыку, войдите в аккаунт и повторите загрузку.";
  if (/\b403\b/.test(m))
    return "Сервис не разрешил загрузку: проверьте доступ к композиции и права аккаунта.";
  if (/\b429\b/.test(m))
    return "Сервис временно ограничил запросы. Повторите позже.";
  if (/\b50[0-4]\b/.test(m))
    return "Сервер Яндекс Музыки временно недоступен. Повторите загрузку немного позже.";
  if (/\b404\b/.test(m))
    return "Файл не найден на сервере. Повторите загрузку, чтобы получить новую ссылку.";
  return m.slice(0, 400);
}
