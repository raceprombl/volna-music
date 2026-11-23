import { allowedMedia, rpc } from "./shared";
import { apiFetch } from "./api-fetch";
import { webSignature } from "./web-provider";
import type { Track } from "./types";

export interface Lyrics {
  text: string;
  format: "LRC" | "TEXT";
}

export async function fetchLyrics(
  track: Track,
  signal: AbortSignal,
): Promise<Lyrics | null> {
  const formats: ("LRC" | "TEXT")[] = track.lyricsInfo?.hasAvailableSyncLyrics
    ? ["LRC", "TEXT"]
    : ["TEXT"];
  for (const format of formats) {
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const signature = await webSignature(track.id + timeStamp);
    const sign = signature.padEnd(Math.ceil(signature.length / 4) * 4, "=");
    const params = new URLSearchParams({ sign, timeStamp, format });
    let json: { downloadUrl?: string; result?: { downloadUrl?: string } } | null;
    try {
      const r = await apiFetch(
        `https://api.music.yandex.ru/tracks/${track.id}/lyrics?${params}`,
        {
          headers: {
            "x-yandex-music-client": "YandexMusicWebNext/1.0.0",
            "x-yandex-music-without-invocation-info": "1",
          },
          signal,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
        },
        signal,
      );
      json = await r.json();
    } catch {
      signal.throwIfAborted();
      try {
        json = await rpc("SESSION_LYRICS", { id: track.id, format });
      } catch {
        continue;
      }
    }
    if (!json) continue;
    const url = json.downloadUrl ?? json.result?.downloadUrl;
    if (typeof url !== "string" || !allowedMedia(url)) continue;
    const textResponse = await fetch(url, {
      signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    if (!textResponse.ok) continue;
    const length = Number(textResponse.headers.get("Content-Length"));
    if (length > 512 * 1024) continue;
    const text = (await textResponse.text()).replace(/\r\n?/g, "\n").trim();
    if (text && text.length <= 512 * 1024) return { text, format };
  }
  return null;
}
