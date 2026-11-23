import { md5 } from "js-md5";
import { apiFetch, requestApiSlot } from "./api-fetch";
import { allowedMedia, chooseSource, coverUrl, isMusic, rpc } from "./shared";
import type { Collection, Format, Source, Track } from "./types";
import { webSource } from "./web-provider";

const API = "https://api.music.yandex.ru";
type Obj = Record<string, any>;
export async function api(
  path: string,
  token: string,
  signal?: AbortSignal,
): Promise<any> {
  const response = await apiFetch(
    API + path,
    {
      headers: token ? { Authorization: `OAuth ${token}` } : {},
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: signal ?? AbortSignal.timeout(25000),
    },
    signal,
  );
  if (!response.ok) throw new Error(`Яндекс Музыка: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error)
    throw new Error(
      String(data.error.message || data.error.name || "Сервис отклонил запрос"),
    );
  return data.result ?? data;
}
export function normalizeTrack(raw: Obj): Track | undefined {
  const t = raw?.track ?? raw;
  if (!t || !/^\d+(?::\d+)?$/.test(String(t.id)) || typeof t.title !== "string")
    return;
  return {
    id: String(t.id).split(":")[0],
    title: t.title.slice(0, 300),
    artists: Array.isArray(t.artists)
      ? t.artists
          .map((a: Obj) => String(a.name ?? ""))
          .join(", ")
          .slice(0, 300)
      : "Неизвестный исполнитель",
    album: t.albums?.[0]?.title,
    year: t.albums?.[0]?.year,
    cover: coverUrl(t.coverUri ?? t.albums?.[0]?.coverUri),
    duration: Number(t.durationMs) || undefined,
    available: t.available !== false,
    genre: t.albums?.[0]?.genre,
    lyricsInfo: t.lyricsInfo,
  };
}
export async function hydrateTracks(
  rows: Obj[],
  token: string,
  request = api,
): Promise<Track[]> {
  const ids = rows
    .map((t) => String(t.id ?? t.track?.id ?? ""))
    .filter((i) => /^\d+(?::\d+)?$/.test(i));
  const ready = new Map(
    rows
      .map(normalizeTrack)
      .filter(Boolean)
      .map((t) => [t!.id, t!]),
  );
  for (let i = 0; i < ids.length; i += 100) {
    const missing = ids
      .slice(i, i + 100)
      .filter((id) => !ready.has(id.split(":")[0]));
    if (!missing.length) continue;
    const result = await request(
      `/tracks?track-ids=${encodeURIComponent(missing.join(","))}`,
      token,
    );
    for (const raw of result) {
      const t = normalizeTrack(raw);
      if (t) ready.set(t.id, t);
    }
  }
  return ids
    .map((id) => ready.get(id.split(":")[0]))
    .filter((t): t is Track => !!t);
}
export async function loadCollection(
  input: Collection,
  token: string,
  request = api,
): Promise<Collection> {
  if (!isMusic(input.url)) throw new Error("Откройте страницу Яндекс Музыки.");
  const path = new URL(input.url).pathname;
  let data: Obj;
  let rows: Obj[];
  const album = path.match(/^\/album\/(\d+)(?:\/|$)/),
    legacy = path.match(/^\/users\/([^/]+)\/playlists\/(\d+)/),
    uuid = path.match(/^\/playlists?\/((?:lk\.)?[\da-f-]{20,})/i);
  if (album) {
    data = await request(`/albums/${album[1]}/with-tracks`, token);
    rows = (data.volumes ?? []).flat();
  } else if (legacy) {
    data = await request(
      `/users/${encodeURIComponent(decodeURIComponent(legacy[1]))}/playlists/${legacy[2]}`,
      token,
    );
    rows = data.tracks ?? [];
  } else if (uuid) {
    data = await request(`/playlist/${uuid[1]}`, token);
    rows = data.tracks ?? [];
  } else if (
    /\/(collection|my)\/.*(track|like)|\/collection\/?$/.test(path) ||
    input.kind === "likes"
  ) {
    if (!token && request === api)
      throw new Error(
        "Для полного списка «Мне нравится» добавьте личный OAuth-токен в настройках.",
      );
    const me = await request("/account/status", token);
    const uid = me.account?.uid;
    if (!uid) throw new Error("Сервис не вернул аккаунт.");
    data = { title: "Мне нравится" };
    const likes = await request(
      `/users/${encodeURIComponent(uid)}/likes/tracks`,
      token,
    );
    rows = likes.library?.tracks ?? likes.tracks ?? [];
  } else return input;
  if (rows.length > 5000)
    throw new Error("В коллекции больше 5000 треков. Скачивайте её частями.");
  const tracks = await hydrateTracks(rows, token, request);
  if (!tracks.length)
    throw new Error(
      "Сервис не вернул треки. Возможно, коллекция закрыта или недоступна вашему аккаунту.",
    );
  return {
    ...input,
    title: String(data.title ?? input.title),
    tracks,
    partial:
      typeof data.trackCount === "number" && tracks.length < data.trackCount,
  };
}
export interface DownloadOption extends Source {
  direct: boolean;
}
export class UnavailableError extends Error {}
export async function downloadOptions(
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<DownloadOption[]> {
  if (!/^\d+$/.test(id)) throw new Error("Некорректный идентификатор трека.");
  const data = await api(`/tracks/${id}/download-info`, token, signal);
  if (!Array.isArray(data))
    throw new Error("Сервис не предоставил разрешённые файлы для скачивания.");
  const options = data
    .filter(
      (s: Obj) =>
        !s.preview &&
        !s.drm &&
        !s.encrypted &&
        !s.key &&
        typeof s.downloadInfoUrl === "string",
    )
    .map((s: Obj) => ({
      codec: String(s.codec).toLowerCase(),
      bitrate: Number(s.bitrateInKbps) || 0,
      url: s.downloadInfoUrl.replace(/^http:/, "https:"),
      direct: s.direct === true,
    }))
    .filter((s) => allowedMedia(s.url));
  if (!options.length)
    throw new UnavailableError(
      token
        ? "Сервис вернул только превью, защищённый или недоступный файл. Трек пропущен."
        : "Сервис не выдал разрешённый полный файл через web / download-info. Если доступно только превью, оно не скачивается. Композиция пропущена.",
    );
  return options;
}
export function xmlDownloadUrl(xml: string) {
  if (xml.includes("<!DOCTYPE") || xml.length > 65536)
    throw new Error("Некорректный ответ сервиса.");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const get = (tag: string) => doc.querySelector(tag)?.textContent ?? "";
  if (
    doc.querySelector("parsererror") ||
    get("key") ||
    get("drm") ||
    get("cipher")
  )
    throw new Error("Зашифрованные файлы не поддерживаются.");
  const host = get("host"),
    path = get("path"),
    ts = get("ts"),
    s = get("s");
  if (!host || !path.startsWith("/") || !/^\d+$/.test(ts) || !s)
    throw new Error("Сервис не вернул прямую ссылку.");
  // Standard non-encrypted download-info transport. No encraw, DRM, player interception or private client key.
  const url = `https://${host}/get-mp3/${md5("XGRlBW9FXlekgbPrRHuSiA" + path.slice(1) + s)}/${ts}${path}`;
  if (!allowedMedia(url))
    throw new Error("Сервис вернул неподдерживаемый адрес файла.");
  return url;
}
export async function resolveSource(
  id: string,
  token: string,
  format: Format,
  quality: string,
  signal: AbortSignal,
) {
  if (format !== "ogg") {
    if (token) {
      try {
        return await webSource(id, format, quality, signal, {
          region: "ru",
          session: false,
          token,
        });
      } catch (e) {
        if (
          signal.aborted ||
          (e instanceof Error && "status" in e && e.status === 429)
        )
          throw e;
      }
    }
    try {
      const sessionSource = await rpc("SESSION_SOURCE", {
        id,
        format,
        quality,
      });
      signal.throwIfAborted();
      if (sessionSource && allowedMedia(sessionSource.url)) return sessionSource;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error && "status" in error && error.status === 429)
      )
        throw error;
    }
    try {
      return await webSource(id, format, quality, signal);
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error && "status" in error && error.status === 429)
      )
        throw error;
    }
  }
  const options = await downloadOptions(id, token, signal);
  const source = chooseSource(options, format, quality);
  const original = options.find((s) => s === source || s.url === source.url)!;
  if (original.direct) return source;
  await requestApiSlot(signal);
  const response = await fetch(source.url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Файл: HTTP ${response.status}`);
  return { ...source, url: xmlDownloadUrl(await response.text()) };
}
export async function availableFormats(id: string, token: string) {
  const probes = await Promise.allSettled(
    (["mp3", "aac", "flac"] as const).map((format) =>
      webSource(id, format, "best", AbortSignal.timeout(20000)),
    ),
  );
  const found = probes.flatMap((r, i) =>
    r.status === "fulfilled"
      ? [
          {
            codec: (["mp3", "aac", "flac"] as const)[i],
            bitrate: r.value.bitrate,
          },
        ]
      : [],
  );
  if (found.length) return found;
  return (await downloadOptions(id, token)).map((s) => ({
    codec: s.codec,
    bitrate: s.bitrate,
  }));
}
export function sniff(data: Uint8Array): { ext: string; mime: string } {
  const s = new TextDecoder().decode(data.slice(0, 16));
  if (s.startsWith("fLaC")) return { ext: "flac", mime: "audio/flac" };
  if (s.startsWith("OggS")) return { ext: "ogg", mime: "audio/ogg" };
  if (s.startsWith("RIFF") && s.slice(8, 12) === "WAVE")
    return { ext: "wav", mime: "audio/wav" };
  if (s.slice(4, 8) === "ftyp") return { ext: "m4a", mime: "audio/mp4" };
  if (data[0] === 255 && (data[1] & 0xf6) === 0xf0)
    return { ext: "aac", mime: "audio/aac" };
  if (s.startsWith("ID3") || (data[0] === 255 && (data[1] & 0xe0) === 0xe0))
    return { ext: "mp3", mime: "audio/mpeg" };
  throw new Error(
    "Файл не распознан как незашифрованное аудио. Загрузка остановлена.",
  );
}
