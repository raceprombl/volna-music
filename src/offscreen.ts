import { createArchive, pruneArchives } from "./archive-store";
import { clearJobFiles, pruneFiles } from "./blob-store";
import { ProgressBatch, type ItemUpdate } from "./progress-batch";
import { TransferMeter } from "./transfer-meter";
import { SourceBroker } from "./source-broker";
import { resolveSource, UnavailableError } from "./provider";
import { compactLibrary } from "./library";
import { coverUrl, friendly, rpc, safeName } from "./shared";
import { activeJobs, type Job } from "./types";
import type { OffscreenMessage } from "./rpc";
import {
  clearArtwork,
  clearConnectionHints,
  fetchArtwork,
  patchJob,
  patchJobItems,
  saveBlobToDownloads,
  waitForExistingDownload,
  warmConnection,
} from "./engine-io";
import { hydrateJob, workItem } from "./engine-item";

let running = false;
let wakePending = false;
let sorting = 0;
const aborters = new Map<string, AbortController>();

async function processJob(job: Job, token: string) {
  const controller = new AbortController();
  aborters.set(job.id, controller);
  const signal = controller.signal;
  const workers = new AbortController();
  const workerSignal = AbortSignal.any([signal, workers.signal]);
  let archive: Awaited<ReturnType<typeof createArchive>> | undefined;
  let transferProgress: ProgressBatch | undefined;
  let meter: TransferMeter | undefined;
  let sources: SourceBroker | undefined;
  try {
    const live = (await rpc("ENGINE_STATE")).jobs.find((j) => j.id === job.id);
    if (!live || !activeJobs(live) || signal.aborted) return;
    job = live;
    await patchJob(job.id, {
      status: "running",
      transfer: {
        receivedBytes: 0,
        estimated: true,
        pendingTracks: job.items.length,
        updatedAt: Date.now(),
      },
    });
    if (
      job.settings.zip &&
      job.downloadId !== undefined &&
      (await waitForExistingDownload(job.downloadId, signal))
    ) {
      await patchJobItems(
        job.id,
        job.items.flatMap((item, index) =>
          item.status === "ready"
            ? [{ index, item: { status: "complete" as const } }]
            : [],
        ),
      );
      await clearJobFiles(job.id);
      const current = (await rpc("ENGINE_STATE")).jobs.find(
        (j) => j.id === job.id,
      )!;
      await patchJob(job.id, {
        status: current.items.every((i) => i.status === "complete")
          ? "complete"
          : "partial",
      });
      return;
    }
    // Resume stale items after offscreen recovery; completed Chrome downloads are not repeated.
    for (let i = 0; i < job.items.length; i++) {
      const item = job.items[i];
      if (["resolving", "fetching", "saving"].includes(item.status)) {
        if (item.downloadId) {
          const d = await rpc("DOWNLOAD_STATE", { id: item.downloadId });
          if (
            d?.state === "complete" ||
            (d?.state === "in_progress" &&
              (await waitForExistingDownload(item.downloadId, signal)))
          ) {
            await patchJob(job.id, {}, i, { status: "complete" });
            item.status = "complete";
            continue;
          }
        }
        await patchJob(job.id, {}, i, { status: "queued" });
        item.status = "queued";
      }
    }
    if (job.settings.zip) {
      // A terminated offscreen document cannot resume an uncommitted ZIP stream.
      // Rebuild ready entries from their sources; never publish a partial archive.
      const reset: ItemUpdate[] = [];
      for (let i = 0; i < job.items.length; i++)
        if (job.items[i].status === "ready") {
          job.items[i].status = "queued";
          reset.push({ index: i, item: { status: "queued" } });
        }
      if (reset.length) await patchJobItems(job.id, reset);
      await clearJobFiles(job.id);
      archive = await createArchive(job.id);
    }
    const metadataBatches = new Map<number, Promise<Set<string>>>();
    meter = new TransferMeter(job.items);
    transferProgress = new ProgressBatch(
      (items) => patchJobItems(job.id, items, { transfer: meter!.snapshot() }),
      250,
      meter,
    );
    let archiveWrites = Promise.resolve();
    let pendingWrites = 0;
    const MAX_PENDING_WRITES = 4;
    let archiveError: unknown;
    let cursor = 0;
    const indexes = job.items
      .map((_, i) => i)
      .filter((i) => job.items[i].status === "queued");
    sources = new SourceBroker(
      job.items.length,
      async (index, sourceSignal) => {
        const item = job.items[index];
        if (item.status !== "queued" || item.track.available === false)
          throw new UnavailableError("Композиция недоступна.");
        const source = await resolveSource(
          item.track.id,
          token,
          job.settings.format,
          job.settings.quality,
          sourceSignal,
        );
        sourceSignal.throwIfAborted();
        for (const url of source.urls ?? [source.url]) warmConnection(url);
        return source;
      },
      workerSignal,
    );
    for (
      let i = 0;
      i < Math.min(job.settings.concurrency, indexes.length);
      i++
    )
      void sources.get(indexes[i]).catch(() => {});
    if (indexes.length > 0) {
      const firstBatch = Math.floor(indexes[0] / 50) * 50;
      metadataBatches.set(
        firstBatch,
        hydrateJob(job, token, workerSignal, firstBatch),
      );
    }
    await Promise.allSettled(
      Array.from(
        { length: Math.min(job.settings.concurrency, indexes.length) },
        async () => {
          while (cursor < indexes.length && !signal.aborted && !archiveError) {
            const index = indexes[cursor++];
            try {
              const batch = Math.floor(index / 50) * 50;
              let metadata = metadataBatches.get(batch);
              if (!metadata) {
                metadata = hydrateJob(job, token, workerSignal, batch);
                metadataBatches.set(batch, metadata);
              }
              const nextBatch = batch + 50;
              if (
                index % 50 >= 30 &&
                nextBatch < job.items.length &&
                !metadataBatches.has(nextBatch)
              ) {
                metadataBatches.set(
                  nextBatch,
                  hydrateJob(job, token, workerSignal, nextBatch),
                );
              }
              const prepared = await workItem(
                job,
                index,
                token,
                workerSignal,
                await metadata,
                transferProgress!,
                meter!,
                sources!,
              );
              if (archive && prepared) {
                // Writes serialize through a bounded queue while transfers continue in parallel.
                pendingWrites++;
                const writeIndex = index;
                const expectedName = prepared.name;
                archiveWrites = archiveWrites
                  .then(async () => {
                    workerSignal.throwIfAborted();
                    const name = await archive!.zip.add(
                      expectedName,
                      prepared.blob,
                      workerSignal,
                    );
                    if (prepared.lyricsBlob && prepared.lyricsFilename) {
                      await archive!.zip.add(
                        name.replace(
                          /\.[^.]+$/,
                          prepared.lyricsFilename.endsWith(".lrc")
                            ? ".lrc"
                            : ".txt",
                        ),
                        prepared.lyricsBlob,
                        workerSignal,
                      );
                    }
                    if (name !== expectedName)
                      transferProgress!.stage(writeIndex, { filename: name });
                  })
                  .catch((e) => {
                    if (!archiveError) archiveError = e;
                    workers.abort(archiveError);
                  })
                  .finally(() => {
                    pendingWrites--;
                  });
                if (pendingWrites >= MAX_PENDING_WRITES) await archiveWrites;
              }
            } catch (e) {
              if (!archiveError) archiveError = e;
              workers.abort(archiveError);
            }
          }
        },
      ),
    );
    await archiveWrites;
    signal.throwIfAborted();
    if (archiveError) throw archiveError;
    await transferProgress.close();
    let fresh = (await rpc("ENGINE_STATE")).jobs.find((j) => j.id === job.id)!;
    if (archive && archive.zip.count) {
      await patchJob(job.id, { status: "packing", transfer: meter.snapshot() });
      await archive.zip.add(
        "metadata.json",
        new TextEncoder().encode(
          JSON.stringify(
            {
              title: fresh.title,
              created: new Date(fresh.created).toISOString(),
              tracks: fresh.items.map((i) => ({
                track: i.track,
                file: i.filename,
                status: i.status,
                error: i.error,
              })),
            },
            null,
            2,
          ),
        ),
        signal,
      );
      const url =
        job.settings.covers &&
        coverUrl(fresh.items[0]?.track.cover, job.settings.coverSize);
      if (url) {
        let cover: Uint8Array | undefined;
        try {
          cover = await fetchArtwork(url, signal);
        } catch {
          signal.throwIfAborted();
        }
        if (cover) {
          const prefix = new TextDecoder().decode(cover.subarray(0, 12));
          const ext =
            cover[0] === 0x89 && prefix.slice(1, 4) === "PNG"
              ? "png"
              : prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP"
                ? "webp"
                : "jpg";
          await archive.zip.add(`cover.${ext}`, cover, signal);
        }
      }
      await archive.zip.close(signal);
      await saveBlobToDownloads(
        await archive.file(),
        `${safeName(job.title)}.zip`,
        job,
        signal,
      );
      await patchJobItems(
        job.id,
        fresh.items.flatMap((item, index) =>
          item.status === "ready"
            ? [{ index, item: { status: "complete" as const } }]
            : [],
        ),
      );
    }
    signal.throwIfAborted();
    fresh = (await rpc("ENGINE_STATE")).jobs.find((j) => j.id === job.id)!;
    const completed = fresh.items.filter((i) => i.status === "complete").length;
    await clearJobFiles(job.id);
    await patchJob(job.id, {
      transfer: meter.snapshot(),
      status:
        completed === fresh.items.length
          ? "complete"
          : completed
            ? "partial"
            : "failed",
      error: completed
        ? undefined
        : "Не удалось скачать ни одного трека. Откройте подробности и повторите.",
    });
  } catch (e) {
    if (!signal.aborted)
      await patchJob(job.id, {
        status: "failed",
        error: friendly(e),
        ...(meter ? { transfer: meter.snapshot() } : {}),
      });
  } finally {
    workers.abort(new DOMException("Задача завершена", "AbortError"));
    sources?.close();
    clearConnectionHints();
    await transferProgress?.close().catch(() => {});
    clearArtwork();
    if (archive)
      await archive
        .cleanup()
        .catch((e) => console.warn("VOLNA ZIP cleanup:", friendly(e)));
    aborters.delete(job.id);
    try {
      const current = (await rpc("ENGINE_STATE")).jobs.find(
        (j) => j.id === job.id,
      );
      if (!current || !activeJobs(current)) await clearJobFiles(job.id);
    } catch {
      /* Startup maintenance retries cleanup if the background was unavailable. */
    }
  }
}

async function pump() {
  if (running) {
    wakePending = true;
    return;
  }
  running = true;
  try {
    while (true) {
      const s = await rpc("ENGINE_STATE");
      await pruneArchives(s.jobs.filter(activeJobs).map((j) => j.id));
      await pruneFiles(s.jobs.filter(activeJobs).map((j) => j.id));
      const job = s.jobs.find(activeJobs);
      if (!job) {
        if (wakePending) {
          wakePending = false;
          continue;
        }
        break;
      }
      await processJob(job, s.token);
    }
  } catch (e) {
    console.error("VOLNA queue:", friendly(e));
  } finally {
    running = false;
    // ENQUEUE may arrive while an empty snapshot is being pruned. Don't lose
    // that wake-up and make the user wait for the recovery alarm.
    if (wakePending) {
      wakePending = false;
      void pump();
    }
  }
}

chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  if (
    !raw ||
    typeof raw !== "object" ||
    raw.target !== "offscreen" ||
    sender.id !== chrome.runtime.id
  )
    return;
  const m = raw as OffscreenMessage;
  if (m.type === "ENGINE_STATUS") {
    respond({ busy: running || sorting > 0 });
    return;
  }
  if (m.type === "SORT_LIBRARY") {
    sorting++;
    void compactLibrary()
      .then(
        (data) => respond({ ok: true, data }),
        (e) => respond({ ok: false, error: friendly(e) }),
      )
      .finally(() => {
        sorting--;
      });
    return true;
  }
  if (m.type === "CANCEL") {
    aborters.get(m.id)?.abort(new DOMException("Отменено", "AbortError"));
    void (async () => {
      const s = await rpc("ENGINE_STATE");
      const j = s.jobs.find((job) => job.id === m.id);
      if (j) await clearJobFiles(j.id);
    })().catch(() => {});
  }
  if (m.type === "CLEAN")
    void (async () => {
      for (const j of m.jobs ?? []) await clearJobFiles(j.id);
      const current = await rpc("ENGINE_STATE");
      await pruneArchives(current.jobs.filter(activeJobs).map((j) => j.id));
    })().catch(() => {});
  if (m.type === "WAKE") void pump();
  respond({ ok: true });
});

void pump();
