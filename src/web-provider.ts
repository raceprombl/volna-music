import { allowedMedia } from "./shared";
import { apiFetch } from "./api-fetch";
import type { Format, Source } from "./types";

// Public web-client request-signing parameter observed in YMD 0.4.15.
// This is not a user credential or a decryption key; the server authorizes every request.
const WEB_SIGNING_PARAMETER = "7tvSmFbyf5hJnIHhCimDDD";
const WEB_HEADERS = {
  "x-yandex-music-client": "YandexMusicWebNext/1.0.0",
  "x-yandex-music-without-invocation-info": "1",
  "X-Requested-With": "XMLHttpRequest",
};
export interface WebSource extends Source {
  transport: "raw";
}
const encoder = new TextEncoder();
let signingKeyPromise: Promise<CryptoKey> | undefined;
function getWebSigningKey() {
  if (!signingKeyPromise) {
    signingKeyPromise = crypto.subtle
      .importKey(
        "raw",
        encoder.encode(WEB_SIGNING_PARAMETER),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      )
      .catch((error) => {
        signingKeyPromise = undefined;
        throw error;
      });
  }
  return signingKeyPromise;
}
export async function webSignature(payload: string) {
  const key = await getWebSigningKey();
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
  );
  return btoa(String.fromCharCode(...signature)).replace(/=+$/, "");
}
export async function webSource(
  id: string,
  format: Format,
  quality: string,
  signal: AbortSignal,
  context?: { region: string; session: boolean; token?: string },
): Promise<WebSource> {
  if (!/^\d+$/.test(id)) throw new Error("Некорректный идентификатор трека.");
  if (format === "ogg")
    throw new Error("Web-метод сервиса не предоставляет OGG.");
  const codecs =
    format === "flac"
      ? ["flac", "flac-mp4"]
      : format === "aac"
        ? ["aac-mp4", "he-aac-mp4", "aac"]
        : format === "original"
          ? ["aac-mp4", "he-aac-mp4", "mp3"]
          : ["mp3"];
  const level =
    format === "flac" ? "lossless" : quality === "best" ? "hq" : "nq";
  const ts = String(Math.floor(Date.now() / 1000));
  const params = new URLSearchParams({
    ts,
    trackId: id,
    quality: level,
    codecs: codecs.join(","),
    transports: "raw",
    sign: await webSignature(ts + id + level + codecs.join("") + "raw"),
  });
  const region =
    context && ["ru", "kz", "com", "by", "uz"].includes(context.region)
      ? context.region
      : "ru";
  const response = await apiFetch(
    `https://api.music.yandex.${region}/get-file-info?` + params,
    {
      headers: {
        ...WEB_HEADERS,
        ...(context?.token ? { Authorization: `OAuth ${context.token}` } : {}),
      },
      signal,
      cache: "no-store",
      credentials: context?.session ? "include" : "omit",
      redirect: "error",
      referrer: context?.session ? `https://music.yandex.${region}/` : "",
    },
    signal,
  );
  if (!response.ok) throw new Error(`Web API: HTTP ${response.status}`);
  const json = await response.json();
  const info = json.result?.downloadInfo ?? json.downloadInfo;
  if (
    !info ||
    info.preview ||
    info.drm ||
    info.encrypted ||
    info.key ||
    info.transport !== "raw"
  )
    throw new Error("Web API не выдал разрешённый незашифрованный файл.");
  const candidates = [
    ...(Array.isArray(info.urls) ? info.urls.slice(0, 8) : []),
    ...(info.url ? [info.url] : []),
  ];
  const urls = [
    ...new Set(
      candidates.flatMap((value: unknown) => {
        if (typeof value !== "string" || value.length > 8192) return [];
        try {
          const url = decodeURIComponent(value);
          return allowedMedia(url) ? [url] : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
  if (!urls.length)
    throw new Error("Сервис вернул неподдерживаемый адрес файла.");
  const codec = String(info.codec ?? "").toLowerCase();
  if (
    !["mp3", "aac", "aac-mp4", "he-aac-mp4", "flac", "flac-mp4"].includes(codec)
  )
    throw new Error("Неизвестный web-кодек: " + codec);
  if (
    (format === "mp3" && codec !== "mp3") ||
    (format === "flac" && !codec.startsWith("flac")) ||
    (format === "aac" && !codec.includes("aac"))
  )
    throw new Error(
      "Сервис не предоставил выбранный формат. Файл не будет переименован.",
    );
  return {
    url: urls[0],
    urls,
    codec,
    bitrate:
      (Number(info.bitrate ?? info.bitrateInKbps) || 0) > 10000
        ? Math.round(Number(info.bitrate ?? info.bitrateInKbps) / 1000)
        : Number(info.bitrate ?? info.bitrateInKbps) || 0,
    transport: "raw",
  };
}
