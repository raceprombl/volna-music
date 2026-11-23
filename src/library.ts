import { filename } from "./shared";
import type { Format, Track } from "./types";
import { mp3Duration, assertDuration } from "./audio-duration";
import { openStoreDb } from "./idb";
/** User-selected folder access. No native host and no access outside this handle. */
export type LibraryDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
};
interface Entry {
  from?: string;
  to: string;
  temp: string;
  size: number;
  hash: string;
}
interface Journal {
  phase: "copying" | "staged" | "committing";
  entries: Entry[];
  receipt?: {
    key: string;
    name: string;
    number: number;
    hash: string;
    size: number;
    updatedBy?: string;
    trackId?: string;
  };
}
type Receipt = NonNullable<Journal["receipt"]>;
const AUDIO = /\.(mp3|flac|m4a|aac|ogg|wav)$/i;
const PREFIX = /^\d+\s*[·.\-]\s*/;
const strip = (name: string) => name.replace(PREFIX, "");
const stem = (name: string) =>
  strip(name)
    .replace(/\.[^.]+$/, "")
    .normalize("NFC")
    .toLocaleLowerCase("ru");
const matchesFormat = (name: string, format: Format) =>
  format === "original" ||
  (format === "aac"
    ? /\.(aac|m4a)$/i.test(name)
    : name.toLowerCase().endsWith("." + format));
async function usableExisting(
  handle: FileSystemFileHandle,
  expectedMs?: number,
) {
  const saved = await handle.getFile();
  if (!saved.size) return false;
  if (expectedMs && /\.mp3$/i.test(handle.name)) {
    const duration = mp3Duration(new Uint8Array(await saved.arrayBuffer()));
    if (!duration) return false;
    try {
      assertDuration(duration, expectedMs);
    } catch {
      return false;
    }
  }
  return true;
}
export async function findExistingTrack(
  track: Track,
  format: Format,
  directory?: LibraryDirectory,
) {
  return lock(async () => {
    const d = directory ?? (await requireDirectory());
    if (!d) return null;
    const receipts = (await setting<Record<string, Receipt>>("receipts")) ?? {};
    for (const receipt of Object.values(receipts)) {
      if (receipt.trackId !== track.id || !matchesFormat(receipt.name, format))
        continue;
      const existing = await file(d, receipt.name);
      if (
        existing &&
        (await matches(existing, { ...receipt, to: receipt.name, temp: "" }))
      )
        return { name: receipt.name };
    }
    const candidates = new Set(
      [false, true].map((unicode) =>
        stem(filename(track, 0, "mp3", false, unicode)),
      ),
    );
    for await (const handle of d.values()) {
      if (
        handle.kind !== "file" ||
        !AUDIO.test(handle.name) ||
        !matchesFormat(handle.name, format) ||
        !candidates.has(stem(handle.name))
      )
        continue;
      const known = Object.values(receipts).find(
        (r) => r.name === handle.name && r.trackId,
      );
      if (known && known.trackId !== track.id) continue;
      if (await usableExisting(handle as FileSystemFileHandle, track.duration))
        return { name: handle.name };
    }
    return null;
  });
}
const database = () => openStoreDb("volna-library", "settings");
async function setting<T>(
  key: string,
  value?: T,
  remove = false,
): Promise<T | undefined> {
  const db = await database();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(
        "settings",
        value !== undefined || remove ? "readwrite" : "readonly",
      ),
      s = tx.objectStore("settings");
    const r = remove
      ? s.delete(key)
      : value !== undefined
        ? s.put(value, key)
        : s.get(key);
    tx.oncomplete = () => resolve(r.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function libraryStatus() {
  const directory = await setting<LibraryDirectory>("directory");
  return {
    connected: !!directory,
    name: directory?.name,
    permission: directory
      ? await directory.queryPermission({ mode: "readwrite" })
      : ("prompt" as PermissionState),
  };
}
export const getLibraryDirectory = () => setting<LibraryDirectory>("directory");
export async function connectLibrary(directory: LibraryDirectory) {
  return lock(async () => {
    if (directory.name !== "Треки")
      throw new Error(
        "Выберите папку «Треки», в которую нужно сохранять песни.",
      );
    if ((await directory.queryPermission({ mode: "readwrite" })) !== "granted")
      throw new Error("Нужен доступ к чтению и изменению выбранной папки.");
    const old = await setting<LibraryDirectory>("directory");
    if (
      old &&
      (await setting("journal")) &&
      !(await old.isSameEntry(directory))
    )
      throw new Error(
        "Сначала завершите восстановление сортировки прежней папки.",
      );
    await setting("directory", directory);
  });
}
export async function disconnectLibrary() {
  return lock(async () => {
    if (await setting("journal"))
      throw new Error("Сначала завершите восстановление сортировки папки.");
    await setting("directory", undefined, true);
  });
}
async function file(directory: LibraryDirectory, name: string) {
  try {
    return await directory.getFileHandle(name);
  } catch (e) {
    if ((e as DOMException).name === "NotFoundError") return;
    throw e;
  }
}
async function digest(blob: Blob) {
  if (blob.size > 200 * 1024 * 1024)
    throw new Error("Для сортировки поддерживаются файлы до 200 МБ.");
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function matches(handle: FileSystemFileHandle, entry: Entry) {
  const f = await handle.getFile();
  return f.size === entry.size && (await digest(f)) === entry.hash;
}
async function copy(
  directory: LibraryDirectory,
  blob: Blob,
  name: string,
  entry: Entry,
) {
  const target = await directory.getFileHandle(name, { create: true });
  if ((await target.getFile()).size > 0) {
    if (await matches(target, entry)) return;
    throw new Error("Имя занято другим файлом. Он не перезаписан.");
  }
  const writer = await target.createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (e) {
    try {
      await writer.abort();
    } catch {}
    throw e;
  }
  if (!(await matches(target, entry)))
    throw new Error(
      "Проверка копии не прошла. Исходные данные сохранены для восстановления.",
    );
}
async function requireDirectory() {
  const directory = await setting<LibraryDirectory>("directory");
  if (!directory) return;
  if ((await directory.queryPermission({ mode: "readwrite" })) !== "granted")
    throw new Error(
      "Восстановите доступ к папке «Треки» в настройках VOLNA. Сортировка требует разрешения Chrome.",
    );
  return directory;
}
// A persisted journal retains verified backups until every final file is verified.
async function recover(directory: LibraryDirectory) {
  const journal = await setting<Journal>("journal");
  if (!journal) return;
  if (journal.phase === "copying") {
    // Originals have never been removed at this phase.
    for (const e of journal.entries)
      if (await file(directory, e.temp)) await directory.removeEntry(e.temp);
    await setting("journal", undefined, true);
    return;
  }
  if (journal.phase === "staged") {
    let changed = false;
    for (const e of journal.entries) {
      const backup = await file(directory, e.temp);
      if (!backup || !(await matches(backup, e)))
        throw new Error(
          "Резервная копия сортировки повреждена. Исходные файлы не заменены.",
        );
      const original = e.from && (await file(directory, e.from));
      if (original && !(await matches(original, e))) changed = true;
    }
    if (changed) {
      // Restore any already removed originals, preserving externally edited files.
      for (const e of journal.entries)
        if (e.from && !(await file(directory, e.from)))
          await copy(
            directory,
            await (await directory.getFileHandle(e.temp)).getFile(),
            e.from,
            e,
          );
      for (const e of journal.entries) await directory.removeEntry(e.temp);
      await setting("journal", undefined, true);
      throw new Error(
        "Файл изменился во время сортировки. Исходные имена восстановлены; повторите после завершения изменений.",
      );
    }
    for (const e of journal.entries)
      if (e.from && (await file(directory, e.from)))
        await directory.removeEntry(e.from);
    journal.phase = "committing";
    await setting("journal", journal);
  }
  for (const e of journal.entries) {
    const final = await file(directory, e.to);
    if (final) {
      if (await matches(final, e)) continue;
      if ((await final.getFile()).size !== 0 || e.size === 0)
        throw new Error(
          "Новое имя уже занято другим файлом. Ничего не перезаписано; резервные копии сохранены.",
        );
      // A crash before close() can leave our newly-created empty destination.
    }
    const backup = await file(directory, e.temp);
    if (!backup || !(await matches(backup, e)))
      throw new Error(
        "Нет проверенной резервной копии. Сортировка остановлена.",
      );
    await copy(directory, await backup.getFile(), e.to, e);
  }
  const receipts = (await setting<Record<string, Receipt>>("receipts")) ?? {};
  const operation = journal.entries[0]?.temp;
  for (const receipt of Object.values(receipts)) {
    const moved = journal.entries.find((e) => e.from === receipt.name);
    if (moved && receipt.updatedBy !== operation) {
      receipt.name = moved.to;
      receipt.number = Number(moved.to.match(/^\d+/)?.[0]);
      receipt.updatedBy = operation;
    }
  }
  if (journal.receipt)
    receipts[journal.receipt.key] = {
      ...journal.receipt,
      updatedBy: operation,
    };
  await setting(
    "receipts",
    Object.fromEntries(Object.entries(receipts).slice(-128)),
  );
  for (const e of journal.entries) {
    const backup = await file(directory, e.temp);
    if (backup) {
      if (!(await matches(backup, e)))
        throw new Error("Временный файл изменился. Он сохранён без удаления.");
      await directory.removeEntry(e.temp);
    }
  }
  await setting("journal", undefined, true);
}
async function scan(directory: LibraryDirectory) {
  const files: { name: string; modified: number; number: number }[] = [];
  const all = new Set<string>();
  for await (const handle of directory.values()) {
    if (handle.kind !== "file") continue;
    all.add(handle.name);
    if (!AUDIO.test(handle.name)) continue;
    const n = Number(handle.name.match(/^(\d+)\s*[·.\-]\s*/)?.[1]);
    files.push({
      name: handle.name,
      modified: (await (handle as FileSystemFileHandle).getFile()).lastModified,
      number: n > 0 ? n : Infinity,
    });
  }
  if (files.length > 5000)
    throw new Error("Для сортировки поддерживается до 5000 песен в папке.");
  files.sort(
    (a, b) =>
      a.number - b.number ||
      a.modified - b.modified ||
      a.name.localeCompare(b.name, "ru", { numeric: true }),
  );
  return { files, all };
}
async function compact(directory: LibraryDirectory) {
  await recover(directory);
  const { files, all } = await scan(directory),
    entries: Entry[] = [];
  const transaction = crypto.randomUUID();
  for (const [index, f] of files.entries()) {
    const to = `${String(index + 1).padStart(2, "0")} · ${strip(f.name)}`;
    if (f.name === to) continue;
    const names = [{ from: f.name, to }];
    const stem = f.name.replace(/\.[^.]+$/, ""),
      newStem = to.replace(/\.[^.]+$/, "");
    for (const ext of [".lrc", ".txt"])
      if (all.has(stem + ext))
        names.push({ from: stem + ext, to: newStem + ext });
    for (const pair of names) {
      if (entries.some((e) => e.from === pair.from))
        throw new Error(
          "У двух аудиофайлов общий файл текста. Сортировка остановлена без изменения файлов.",
        );
      const source = await (await directory.getFileHandle(pair.from)).getFile();
      entries.push({
        ...pair,
        temp: `.volna-${transaction}-${entries.length}.tmp`,
        size: source.size,
        hash: await digest(source),
      });
    }
  }
  const changing = new Set(entries.map((e) => e.from!.toLocaleLowerCase())),
    present = new Set([...all].map((n) => n.toLocaleLowerCase()));
  for (const e of entries)
    if (
      present.has(e.to.toLocaleLowerCase()) &&
      !changing.has(e.to.toLocaleLowerCase())
    )
      throw new Error(
        "Имя после сортировки занято. Существующие файлы сохранены.",
      );
  if (entries.length) {
    const journal: Journal = { phase: "copying", entries };
    await setting("journal", journal);
    for (const e of entries) {
      if (await file(directory, e.temp))
        throw new Error("Временное имя уже занято.");
      await copy(
        directory,
        await (await directory.getFileHandle(e.from!)).getFile(),
        e.temp,
        e,
      );
    }
    journal.phase = "staged";
    await setting("journal", journal);
    await recover(directory);
  }
  return {
    count: files.length,
    renamed: entries
      .filter((e) => AUDIO.test(e.to))
      .map((e) => ({ from: e.from!, to: e.to })),
  };
}
async function lock<T>(action: () => Promise<T>) {
  return typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("volna-library", action)
    : action();
}
export async function compactLibrary() {
  return lock(async () => {
    const d = await requireDirectory();
    if (!d) throw new Error("Сначала выберите папку «Треки».");
    return compact(d);
  });
}
export async function saveSortedTrack(
  blob: Blob,
  name: string,
  sidecar?: { blob: Blob; ext: ".lrc" | ".txt" },
  directory?: LibraryDirectory,
  saveKey?: string,
  identity?: { id: string; duration?: number },
) {
  return lock(async () => {
    const d = directory ?? (await requireDirectory());
    if (!d) return null;
    const result = await compact(d),
      number = result.count + 1;
    if (saveKey) {
      const receipt = (await setting<Record<string, Receipt>>("receipts"))?.[
        saveKey
      ];
      const saved = receipt && (await file(d, receipt.name));
      if (
        receipt &&
        saved &&
        (await saved.getFile()).size === receipt.size &&
        (await digest(await saved.getFile())) === receipt.hash
      )
        return { ...result, name: receipt.name, number: receipt.number };
    }
    // Re-check inside the same directory lock as the write: another context
    // or an external copy may have added the song since ENQUEUE.
    const knownReceipts = Object.values(
      (await setting<Record<string, Receipt>>("receipts")) ?? {},
    );
    for (const f of (await scan(d)).files) {
      const known = knownReceipts.find((r) => r.name === f.name && r.trackId);
      if (identity?.id && known?.trackId && known.trackId !== identity.id)
        continue;
      if (
        stem(f.name) === stem(name) &&
        f.name.split(".").pop()?.toLowerCase() ===
          name.split(".").pop()?.toLowerCase() &&
        (await usableExisting(
          await d.getFileHandle(f.name),
          identity?.duration,
        ))
      ) {
        if (saveKey) {
          const existing = await (await d.getFileHandle(f.name)).getFile();
          const records =
            (await setting<Record<string, Receipt>>("receipts")) ?? {};
          records[saveKey] = {
            key: saveKey,
            name: f.name,
            number: Number(f.name.match(/^\d+/)?.[0]) || 0,
            size: existing.size,
            hash: await digest(existing),
            trackId: identity?.id,
          };
          await setting(
            "receipts",
            Object.fromEntries(Object.entries(records).slice(-128)),
          );
        }
        return {
          ...result,
          name: f.name,
          number: Number(f.name.match(/^\d+/)?.[0]) || 0,
          duplicate: true,
        };
      }
    }
    const to = `${String(number).padStart(2, "0")} · ${strip(name)}`;
    if (await file(d, to))
      throw new Error(
        "Имя новой песни уже занято. Существующий файл не перезаписан.",
      );
    const incoming = [
      { blob, to },
      ...(sidecar
        ? [{ blob: sidecar.blob, to: to.replace(/\.[^.]+$/, sidecar.ext) }]
        : []),
    ];
    const entries: Entry[] = [];
    for (const item of incoming) {
      if (await file(d, item.to))
        throw new Error("Имя файла уже занято. Он не перезаписан.");
      entries.push({
        to: item.to,
        temp: `.volna-${crypto.randomUUID()}-new.tmp`,
        size: item.blob.size,
        hash: await digest(item.blob),
      });
    }
    await setting<Journal>("journal", { phase: "copying", entries });
    for (let i = 0; i < entries.length; i++)
      await copy(d, incoming[i].blob, entries[i].temp, entries[i]);
    await setting<Journal>("journal", {
      phase: "committing",
      entries,
      receipt: saveKey
        ? {
            key: saveKey,
            name: to,
            number,
            hash: entries[0].hash,
            size: entries[0].size,
            trackId: identity?.id,
          }
        : undefined,
    });
    await recover(d);
    return { ...result, name: to, number };
  });
}
/** Exported for filesystem regression fixtures; production uses the granted handle. */
export const compactDirectory = (directory: LibraryDirectory) =>
  lock(() => compact(directory));
