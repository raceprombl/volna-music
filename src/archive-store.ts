import { StreamZip } from "./stream-zip";

const DIRECTORY = "volna-archives";
async function archiveDirectory() {
  if (!navigator.storage?.getDirectory)
    throw new Error(
      "Для ZIP требуется файловое хранилище Chrome. Откройте обычное окно браузера.",
    );
  return (await navigator.storage.getDirectory()).getDirectoryHandle(
    DIRECTORY,
    { create: true },
  );
}
/** Private temporary files only; never touches the user's Downloads folder. */
export async function pruneArchives(keep: string[] = []) {
  if (!navigator.storage?.getDirectory) return;
  const directory = await archiveDirectory();
  for await (const [name] of (directory as any).entries()) {
    if (/^[a-zA-Z0-9-]+\.zip$/.test(name) && !keep.includes(name.slice(0, -4)))
      await directory.removeEntry(name);
  }
}
export async function archiveBytes() {
  if (!navigator.storage?.getDirectory) return 0;
  let size = 0;
  const directory = await archiveDirectory();
  for await (const [name, handle] of (directory as any).entries()) {
    if (/^[a-zA-Z0-9-]+\.zip$/.test(name) && handle.kind === "file")
      size += (await handle.getFile()).size;
  }
  return size;
}
export async function createArchive(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id))
    throw new Error("Некорректный идентификатор архива.");
  const directory = await archiveDirectory(),
    name = `${id}.zip`;
  const handle = await directory.getFileHandle(name, { create: true });
  let stream: FileSystemWritableFileStream;
  try {
    stream = await handle.createWritable();
  } catch (e) {
    await directory.removeEntry(name).catch(() => {});
    throw e;
  }
  const zip = new StreamZip({
    write: async (bytes) => {
      try {
        await stream.write(bytes as Uint8Array<ArrayBuffer>);
      } catch (e) {
        if (e instanceof DOMException && e.name === "QuotaExceededError")
          throw new Error(
            "Недостаточно места для ZIP. Освободите место на диске или выберите меньше треков.",
          );
        throw e;
      }
    },
    close: () => stream.close(),
    abort: (reason) => stream.abort(reason),
  });
  return {
    zip,
    file: () => handle.getFile(),
    cleanup: async () => {
      await zip.abort();
      await directory.removeEntry(name);
    },
  };
}
