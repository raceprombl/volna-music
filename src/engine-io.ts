import { clearJobFiles, fileStore } from "./blob-store";
import { fetchBytes } from "./media-fetch";
import type { ItemUpdate } from "./progress-batch";
import { allowedMedia, rpc } from "./shared";
import type { Job, QueueItem } from "./types";

const connectionHints = new Map<string, HTMLLinkElement>();
const artwork = new Map<string, Promise<Uint8Array>>();

export const itemKey = (id: string, index: number) => `${id}/${index}`;

export async function clearItemFiles(id: string, index: number) {
  await fileStore("delete", itemKey(id, index));
  await fileStore("delete", itemKey(id, index) + "/lyrics");
}

export function warmConnection(url: string) {
  if (typeof document === "undefined" || !allowedMedia(url)) return;
  const origin = new URL(url).origin;
  if (connectionHints.has(origin) || connectionHints.size >= 12) return;
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = origin;
  link.crossOrigin = "anonymous";
  document.head?.append(link);
  connectionHints.set(origin, link);
}

export function clearConnectionHints() {
  for (const link of connectionHints.values()) link.remove();
  connectionHints.clear();
}

export const patchJob = (
  id: string,
  data: Partial<Job> = {},
  index?: number,
  item?: Partial<QueueItem>,
) => rpc("ENGINE_PATCH", { id, patch: data, index, item });

export const patchJobItems = (
  id: string,
  items: ItemUpdate[],
  patch: Partial<Job> = {},
) => rpc("ENGINE_PATCH_ITEMS", { id, items, patch });

export function fetchArtwork(url: string, signal: AbortSignal) {
  let request = artwork.get(url);
  if (!request) {
    if (artwork.size >= 8) artwork.delete(artwork.keys().next().value!);
    request = fetchBytes(
      url,
      AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      undefined,
      4 * 1024 * 1024,
    );
    artwork.set(url, request);
    void request.catch(() => {
      if (artwork.get(url) === request) artwork.delete(url);
    });
  }
  return request;
}

export function clearArtwork() {
  artwork.clear();
}

export async function saveBlobToDownloads(
  blob: Blob,
  name: string,
  job: Job,
  signal: AbortSignal,
  index?: number,
) {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  try {
    const downloadId = await rpc("SAVE_BLOB", {
      url,
      filename: name,
      jobId: job.id,
      index,
    });
    let delay = 40;
    while (true) {
      signal.throwIfAborted();
      const d = await rpc("DOWNLOAD_STATE", { id: downloadId });
      if (d?.state === "complete") return downloadId;
      if (!d || d.state === "interrupted")
        throw new Error(
          "Сохранение прервано: " + (d?.error ?? "файл не найден"),
        );
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(400, delay * 2);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function waitForExistingDownload(
  id: number,
  signal: AbortSignal,
) {
  let delay = 40;
  while (!signal.aborted) {
    const d = await rpc("DOWNLOAD_STATE", { id });
    if (!d || d.state === "interrupted") return false;
    if (d.state === "complete") return true;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(400, delay * 2);
  }
  signal.throwIfAborted();
  return false;
}

export { clearJobFiles };
