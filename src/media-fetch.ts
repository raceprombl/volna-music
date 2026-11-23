import { MediaClient, type MediaOptions } from "./media-client";
const client = new MediaClient();
export function fetchBytes(
  url: string | string[],
  signal: AbortSignal,
  onProgress?: (bytes: number, total: number) => Promise<unknown> | void,
  limit = 150 * 1024 * 1024,
  options: MediaOptions = {},
) {
  return client.download(
    Array.isArray(url) ? url : [url],
    signal,
    onProgress,
    limit,
    options,
  );
}
