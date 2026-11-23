import { fetchBytes } from "./media-fetch";
import type { ProgressBatch, ItemUpdate } from "./progress-batch";
import type { TransferMeter } from "./transfer-meter";
import type { SourceBroker } from "./source-broker";
import { HttpError } from "./http-error";
import {
  api,
  normalizeTrack,
  sniff,
  UnavailableError,
} from "./provider";
import { fileStore, stagingBytes } from "./blob-store";
import { tagMp3, tagFlac, toWav } from "./audio";
import { fetchLyrics } from "./lyrics";
import { log } from "./log";
import { demuxFlacMp4 } from "./mp4-flac";
import { verifyFullAudio } from "./audio-duration";
import { saveSortedTrack } from "./library";
import { coverUrl, filename, friendly, rpc } from "./shared";
import type { Job } from "./types";
import {
  clearItemFiles,
  fetchArtwork,
  itemKey,
  patchJob,
  patchJobItems,
  saveBlobToDownloads,
} from "./engine-io";

// Batch metadata requests instead of one network round-trip per song.
export async function hydrateJob(
  job: Job,
  token: string,
  signal: AbortSignal,
  from: number,
) {
  const hydrated = new Set<string>();
  const pending = job.items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => {
      if (item.status !== "queued" || index < from || index >= from + 50)
        return false;
      const track = item.track;
      if (
        track.duration &&
        (!job.settings.metadata || track.album !== undefined)
      ) {
        hydrated.add(track.id);
        return false;
      }
      return true;
    });
  for (let offset = 0; offset < pending.length; offset += 50) {
    signal.throwIfAborted();
    const batch = pending.slice(offset, offset + 50);
    if (
      batch.every(({ item }) => item.track.duration && !job.settings.metadata)
    ) {
      for (const { item } of batch) hydrated.add(item.track.id);
      continue;
    }
    try {
      const raw = await api(
        `/tracks?track-ids=${batch.map(({ item }) => item.track.id).join(",")}`,
        token,
        AbortSignal.any([signal, AbortSignal.timeout(12000)]),
      );
      const full = new Map<
        string,
        NonNullable<ReturnType<typeof normalizeTrack>>
      >();
      for (const data of raw) {
        const track = normalizeTrack(data);
        if (track) full.set(track.id, track);
      }
      const updates: ItemUpdate[] = [];
      for (const { item, index } of batch) {
        const track = full.get(item.track.id);
        if (track) {
          item.track = { ...item.track, ...track };
          updates.push({ index, item: { track: item.track } });
          hydrated.add(item.track.id);
        }
      }
      if (updates.length) await patchJobItems(job.id, updates);
    } catch (e) {
      signal.throwIfAborted();
      // A failed optional batch must not add a second timeout to every song.
      // Known catalog durations still allow full-audio validation.
      for (const { item } of batch)
        if (item.track.duration) hydrated.add(item.track.id);
      log(job.settings, "warn", "Пакет метаданных недоступен", {
        message: friendly(e),
      });
    }
  }
  return hydrated;
}

export async function workItem(
  job: Job,
  index: number,
  token: string,
  signal: AbortSignal,
  hydrated: Set<string>,
  transferProgress: ProgressBatch,
  meter: TransferMeter,
  sources: SourceBroker,
) {
  const item = job.items[index];
  let track = item.track;
  let lyricsBlob: Blob | undefined;
  let lyricsFilename: string | undefined;
  try {
    let blob = job.settings.zip
      ? undefined
      : await fileStore<Blob | undefined>("get", itemKey(job.id, index));
    let name = item.filename;
    if (!blob) {
      log(job.settings, "info", "Подготовка трека", { trackId: track.id });
      // Duration is required even when optional tags/artwork are disabled.
      if (!hydrated.has(track.id))
        try {
          const raw = await api(
            `/tracks?track-ids=${track.id}`,
            token,
            AbortSignal.any([signal, AbortSignal.timeout(12000)]),
          );
          const full = normalizeTrack(raw[0]);
          if (full) {
            track = { ...track, ...full };
            transferProgress.stage(index, { track });
          }
        } catch (e) {
          if (signal.aborted) throw e;
          log(job.settings, "warn", "Дополнительные метаданные недоступны", {
            trackId: track.id,
          });
        }
      transferProgress.stage(index, {
        status: "resolving",
        error: undefined,
        bytes: 0,
        total: 0,
      });
      let source = await sources.get(index);
      signal.throwIfAborted();
      transferProgress.stage(index, { status: "fetching" });
      const lyricsPromise =
        job.settings.lyricsTags || job.settings.lyricsFile
          ? fetchLyrics(
              track,
              AbortSignal.any([signal, AbortSignal.timeout(15000)]),
            ).catch(() => {
              log(job.settings, "warn", "Текст трека недоступен", {
                trackId: track.id,
              });
              return null;
            })
          : undefined;
      const artworkPromise =
        job.settings.metadata &&
        job.settings.covers &&
        coverUrl(track.cover) &&
        ["mp3", "original"].includes(job.settings.format)
          ? fetchArtwork(
              coverUrl(track.cover, job.settings.coverSize)!,
              signal,
            ).catch(() => undefined)
          : undefined;
      // Each active transfer has a bounded lifetime and aborts immediately on cancellation.
      const transfer = signal;
      const multipart =
        job.items.length === 1
          ? 8
          : job.items.length <= 4 || job.settings.format === "flac"
            ? 4
            : job.settings.concurrency <= 6
              ? 2
              : 1;
      const fetchAudio = () =>
        fetchBytes(
          source.urls ?? [source.url],
          transfer,
          (bytes, total) => transferProgress.record(index, bytes, total),
          150 * 1024 * 1024,
          {
            multipart,
            priority: job.items.length === 1 ? 0 : 1,
            hedgeMs: 150,
          },
        );
      let bytes: Uint8Array;
      try {
        bytes = await fetchAudio();
      } catch (error) {
        if (
          signal.aborted ||
          !(error instanceof HttpError) ||
          ![401, 403, 404, 410].includes(error.status)
        )
          throw error;
        sources.invalidate(index);
        source = await sources.get(index);
        bytes = await fetchAudio();
      }
      await transferProgress.finish(index);
      if (source.codec === "flac-mp4") bytes = demuxFlacMp4(bytes);
      let type = sniff(bytes);
      await verifyFullAudio(bytes, type.mime, track.duration, signal);
      const wanted = job.settings.format;
      if (
        wanted !== "original" &&
        wanted !== "wav" &&
        !(wanted === "aac"
          ? ["aac", "m4a"].includes(type.ext)
          : wanted === type.ext)
      )
        throw new Error(
          "Формат ответа не соответствует выбранному. Файл не переименован.",
        );
      if (wanted === "wav" && type.ext !== "wav") {
        bytes = await toWav(bytes);
        type = { ext: "wav", mime: "audio/wav" };
      }
      const lyrics = lyricsPromise ? await lyricsPromise : null;
      if ((job.settings.lyricsTags || job.settings.lyricsFile) && !lyrics)
        transferProgress.stage(index, {
          notice: "Сервис не предоставил текст; аудио сохранено без текста",
        });
      const trackIndex =
        job.trackNumber !== undefined ? job.trackNumber - 1 : index;
      if (type.ext === "mp3" && job.settings.metadata) {
        const cover = artworkPromise
          ? await artworkPromise
          : job.settings.covers && coverUrl(track.cover)
            ? await fetchArtwork(
                coverUrl(track.cover, job.settings.coverSize)!,
                signal,
              ).catch(() => undefined)
            : undefined;
        try {
          bytes = tagMp3(
            bytes,
            track,
            trackIndex,
            cover,
            job.settings.lyricsTags ? lyrics?.text : undefined,
          );
        } catch {
          bytes = tagMp3(
            bytes,
            track,
            trackIndex,
            undefined,
            job.settings.lyricsTags ? lyrics?.text : undefined,
          );
        }
      }
      if (type.ext === "flac" && job.settings.metadata)
        bytes = tagFlac(
          bytes,
          track,
          trackIndex,
          job.settings.lyricsTags ? lyrics?.text : undefined,
        );
      signal.throwIfAborted();
      name = filename(
        track,
        trackIndex,
        type.ext,
        job.settings.numbering,
        job.settings.unicodeFilenames,
      );
      if (job.settings.zip) {
        let lyricsBytes: Uint8Array | undefined;
        if (lyrics && job.settings.lyricsFile) {
          lyricsFilename = name.replace(
            /\.[^.]+$/,
            lyrics.format === "LRC" ? ".lrc" : ".txt",
          );
          lyricsBytes = new TextEncoder().encode(lyrics.text);
          transferProgress.stage(index, { lyricsFilename });
        }
        transferProgress.stage(index, {
          status: "ready",
          filename: name,
          bytes: bytes.byteLength,
          total: bytes.byteLength,
        });
        return {
          blob: bytes as Blob | Uint8Array,
          name,
          lyricsBlob: lyricsBytes as Blob | Uint8Array | undefined,
          lyricsFilename,
        };
      }
      if (lyrics && job.settings.lyricsFile) {
        lyricsFilename = name.replace(
          /\.[^.]+$/,
          lyrics.format === "LRC" ? ".lrc" : ".txt",
        );
        lyricsBlob = new Blob([lyrics.text], {
          type: "text/plain;charset=utf-8",
        });
        await fileStore(
          "put",
          itemKey(job.id, index) + "/lyrics",
          lyricsBlob,
        );
        transferProgress.stage(index, { lyricsFilename });
      }
      blob = new Blob([bytes as BlobPart], { type: type.mime });
      if ((await stagingBytes()) + blob.size > 512 * 1024 * 1024)
        throw new Error(
          "Локальная очередь превысит 512 МБ. Очистите завершённые задачи или скачивайте плейлист частями.",
        );
      await fileStore("put", itemKey(job.id, index), blob);
      transferProgress.stage(index, {
        status: "ready",
        filename: name,
        bytes: blob.size,
        total: blob.size,
      });
    }
    if (job.settings.zip) {
      if (!name || !blob) throw new Error("Не удалось получить имя файла.");
      return {
        blob: blob as Blob | Uint8Array,
        name,
        lyricsBlob: lyricsBlob as Blob | Uint8Array | undefined,
        lyricsFilename,
      };
    }
    if (!job.settings.zip) {
      transferProgress.stage(index, { status: "saving" });
      if (job.kind === "page" && job.items.length === 1) {
        const storedLyrics = await fileStore<Blob | undefined>(
          "get",
          itemKey(job.id, index) + "/lyrics",
        );
        const freshLyrics = storedLyrics
          ? (await rpc("ENGINE_STATE")).jobs.find((j) => j.id === job.id)
              ?.items[index].lyricsFilename
          : undefined;
        const lyricExt: ".lrc" | ".txt" = freshLyrics?.endsWith(".lrc")
          ? ".lrc"
          : ".txt";
        signal.throwIfAborted();
        const saved = await saveSortedTrack(
          blob,
          name!,
          storedLyrics ? { blob: storedLyrics, ext: lyricExt } : undefined,
          undefined,
          itemKey(job.id, index),
          { id: track.id, duration: track.duration },
        );
        if (saved) {
          await rpc("LIBRARY_REINDEX", {
            jobId: job.id,
            index,
            filename: saved.name,
            number: saved.number,
            renamed: saved.renamed,
          });
          signal.throwIfAborted();
          await transferProgress.finish(index).catch(() => {});
          await patchJob(job.id, {}, index, {
            status: "complete",
            filename: saved.name,
            folderSaved: true,
            notice:
              "duplicate" in saved && saved.duplicate
                ? "Песня уже есть в папке; повторная копия не создана"
                : undefined,
            downloadId: undefined,
            lyricsFilename: storedLyrics
              ? saved.name.replace(/\.[^.]+$/, lyricExt)
              : undefined,
          });
          await clearItemFiles(job.id, index);
          return;
        }
      }
      const audioDownloadId = await saveBlobToDownloads(
        blob,
        name!,
        job,
        signal,
        index,
      );
      const storedLyrics = await fileStore<Blob | undefined>(
        "get",
        itemKey(job.id, index) + "/lyrics",
      );
      if (storedLyrics) {
        const fresh = (await rpc("ENGINE_STATE")).jobs.find(
          (j) => j.id === job.id,
        )!;
        await saveBlobToDownloads(
          storedLyrics,
          fresh.items[index].lyricsFilename!,
          job,
          signal,
          index,
        );
        await fileStore("delete", itemKey(job.id, index) + "/lyrics");
      }
      await transferProgress.finish(index).catch(() => {});
      await patchJob(job.id, {}, index, {
        status: "complete",
        downloadId: audioDownloadId,
      });
      await clearItemFiles(job.id, index);
    }
  } catch (e) {
    meter.skip(index);
    if (signal.aborted) return;
    log(job.settings, "error", "Ошибка трека", {
      trackId: track.id,
      message: friendly(e),
    });
    await transferProgress.finish(index).catch(() => {});
    await patchJob(job.id, {}, index, {
      status: e instanceof UnavailableError ? "skipped" : "failed",
      error: friendly(e),
    });
  }
}
