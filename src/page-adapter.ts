import { coverUrl, isMusic } from "./shared";
import type { Collection, Track } from "./types";
export const ROW_SELECTOR =
  '[data-testid="track"],[class*="HorizontalCardContainer_root"],[class*="HorizontalCard_root"],.d-track,[role="row"]';
export function trackId(href: string) {
  return href.match(/\/(?:track)\/(\d+)(?:[/?#]|$)/)?.[1];
}
export function rowTrack(row: Element): Track | undefined {
  const link = row.querySelector<HTMLAnchorElement>('a[href*="/track/"]');
  const id =
    (link && trackId(link.getAttribute("href") ?? "")) ||
    (row as HTMLElement).dataset.volnaTrackId;
  if (!id) return;
  const title =
    link?.textContent?.trim() ||
    (row as HTMLElement).dataset.volnaTitle ||
    row.querySelector('[class*="title"],[class*="Title"]')?.textContent?.trim();
  if (!title) return;
  const artists = [
    ...row.querySelectorAll<HTMLAnchorElement>('a[href*="/artist/"]'),
  ]
    .map((a) => a.textContent?.trim())
    .filter(Boolean)
    .join(", ");
  const img = row.querySelector<HTMLImageElement>("img");
  return {
    id,
    title: title.slice(0, 300),
    artists:
      artists ||
      (row as HTMLElement).dataset.volnaArtists ||
      "Неизвестный исполнитель",
    cover: coverUrl(img?.src),
    duration: Number((row as HTMLElement).dataset.volnaDuration) || undefined,
    available: !row.className.toString().includes("unavailable"),
  };
}
export function readCollection(
  doc: Document = document,
  href = location.href,
): Collection {
  if (!isMusic(href)) throw new Error("Неподдерживаемый сайт.");
  const path = new URL(href).pathname;
  const tracks = new Map<string, Track>();
  const main = doc.querySelector("main") ?? doc;
  for (const row of main.querySelectorAll(ROW_SELECTOR)) {
    const t = rowTrack(row);
    if (t && !tracks.has(t.id)) tracks.set(t.id, t);
  }
  // Some layouts expose title links without a known row wrapper.
  if (!tracks.size)
    for (const link of main.querySelectorAll<HTMLAnchorElement>(
      'a[href*="/track/"]',
    )) {
      const row =
        link.closest('[class*="track"],[class*="Track"]') ?? link.parentElement;
      if (row) {
        const t = rowTrack(row);
        if (t && !tracks.has(t.id)) tracks.set(t.id, t);
      }
    }
  const kind: Collection["kind"] = /\/album\//.test(path)
    ? "album"
    : /\/playlists\/lk\.|\/(collection|my)\//.test(path)
      ? "likes"
      : /\/playlist/.test(path)
        ? "playlist"
        : "page";
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.title.replace(/\s*[—–|]\s*Яндекс.*$/, "").trim() ||
    "Моя музыка";
  return {
    title: title.slice(0, 200),
    kind,
    tracks: [...tracks.values()],
    url: href,
    partial: true,
  };
}
