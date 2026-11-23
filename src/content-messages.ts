import { readCollection } from "./page-adapter";
import { friendly, rpc } from "./shared";
import { apiFetch } from "./api-fetch";
import { HttpError } from "./http-error";
import { loadCollection } from "./provider";
import { webSignature, webSource } from "./web-provider";
import type { Format } from "./types";

export function createContentMessageHandler(controller: AbortController) {
  return (
    m: any,
    _sender: chrome.runtime.MessageSender,
    respond: (v: unknown) => void,
  ) => {
    if (m?.type === "COLLECTION") respond(readCollection());
    if (
      m?.type === "SESSION_SOURCE" &&
      /^\d+$/.test(String(m.id)) &&
      ["original", "mp3", "flac", "aac", "ogg", "wav"].includes(m.format) &&
      ["best", "192", "128"].includes(m.quality)
    ) {
      void webSource(
        String(m.id),
        m.format as Format,
        m.quality,
        controller.signal,
        { region: location.hostname.split(".").pop()!, session: true },
      ).then(
        (data) => respond({ ok: true, data }),
        (e) =>
          respond({
            ok: false,
            error: friendly(e),
            status: e instanceof HttpError ? e.status : undefined,
            retryAfter: e instanceof HttpError ? e.retryAfter : undefined,
          }),
      );
      return true;
    }
    if (m?.type === "SESSION_LYRICS" && /^\d+$/.test(String(m.id))) {
      void (async () => {
        try {
          const ts = String(Math.floor(Date.now() / 1000));
          const sig = await webSignature(m.id + ts);
          const sign = sig.padEnd(Math.ceil(sig.length / 4) * 4, "=");
          const query = new URLSearchParams({
            timeStamp: ts,
            sign,
            format: m.format === "LRC" ? "LRC" : "TEXT",
          });
          const r = await apiFetch(
            `https://api.music.yandex.${location.hostname.split(".").pop()}/tracks/${m.id}/lyrics?${query}`,
            {
              credentials: "include",
              cache: "no-store",
              signal: AbortSignal.timeout(15000),
              headers: {
                "x-yandex-music-client": "YandexMusicWebNext/1.0.0",
                "x-yandex-music-without-invocation-info": "1",
              },
            },
          );
          const data = await r.json();
          respond({ ok: r.ok, data: data.result ?? data });
        } catch {
          respond({ ok: false });
        }
      })();
      return true;
    }
    if (m?.type === "COLLECTION_FULL") {
      void (async () => {
        try {
          await rpc("RENDER_METADATA");
          const c = readCollection();
          const request = async (
            path: string,
            _token: string,
            signal?: AbortSignal,
          ) => {
            const region = location.hostname.split(".").pop();
            const response = await apiFetch(
              `https://api.music.yandex.${region}${path}`,
              {
                credentials: "include",
                cache: "no-store",
                signal: signal
                  ? AbortSignal.any([signal, controller.signal])
                  : controller.signal,
                headers: {
                  "x-yandex-music-client": "YandexMusicWebNext/1.0.0",
                  "x-yandex-music-without-invocation-info": "1",
                  "X-Requested-With": "XMLHttpRequest",
                },
              },
            );
            if (!response.ok)
              throw new Error(`Сервис: HTTP ${response.status}`);
            const j = await response.json();
            return j.result ?? j;
          };
          respond({ ok: true, data: await loadCollection(c, "", request) });
        } catch (e) {
          respond({ ok: false, error: friendly(e) });
        }
      })();
      return true;
    }
  };
}
