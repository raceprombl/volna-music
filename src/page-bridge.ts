// Runs in MAIN and projects only visible track metadata, never account state.
export function snapshotRenderedMetadata() {
  const selectors =
    '[data-testid="track"],[class*="HorizontalCardContainer_root"],[class*="HorizontalCard_root"],.d-track,[role="row"],section[class*="PlayerBar"],[class*="PlayerBar_root"],[class*="PlayerBarDesktop_root"]';
  let count = 0;
  for (const row of [
    ...document.querySelectorAll<HTMLElement>(selectors),
  ].slice(0, 600)) {
    const propKey = Object.keys(row).find((k) => k.startsWith("__reactProps$"));
    if (!propKey) continue;
    const pending = [{ v: (row as any)[propKey], d: 0 }];
    const seen = new Set<object>();
    let track: any;
    while (pending.length && seen.size < 100) {
      const { v, d } = pending.shift()!;
      if (!v || typeof v !== "object" || seen.has(v) || d > 6) continue;
      seen.add(v);
      if (
        v.track &&
        typeof v.track === "object" &&
        v.track.id &&
        typeof v.track.title === "string"
      ) {
        track = v.track;
        break;
      }
      if (v.id && typeof v.title === "string" && Array.isArray(v.artists)) {
        track = v;
        break;
      }
      for (const key of ["props", "children", "afterTitle"]) {
        const child = v[key];
        if (Array.isArray(child))
          for (const item of child) pending.push({ v: item, d: d + 1 });
        else if (child) pending.push({ v: child, d: d + 1 });
      }
    }
    if (track && /^\d+(?::\d+)?$/.test(String(track.id))) {
      row.dataset.volnaTrackId = String(track.id).split(":")[0];
      row.dataset.volnaTitle = String(track.title).slice(0, 300);
      if (Number(track.durationMs) > 0)
        row.dataset.volnaDuration = String(Number(track.durationMs));
      else delete row.dataset.volnaDuration;
      row.dataset.volnaArtists = (
        Array.isArray(track.artists) ? track.artists : []
      )
        .map((a: any) => String(a.name ?? ""))
        .join(", ")
        .slice(0, 300);
      count++;
    }
  }
  return { updated: count };
}
