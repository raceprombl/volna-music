// Small-fixture substitute only. Production always uses disk-backed Chrome OPFS.
export function memoryOpfs() {
  const files = new Map<string, Blob>();
  let aborted = 0;
  let failWrites = false;
  const directory = {
    getDirectoryHandle: async () => directory,
    entries: async function* () {
      for (const name of files.keys()) yield [name, {}];
    },
    removeEntry: async (name: string) => {
      files.delete(name);
    },
    getFileHandle: async (name: string) => ({
      getFile: async () => files.get(name) ?? new Blob(),
      createWritable: async () => {
        const chunks: Uint8Array[] = [];
        files.set(name, new Blob());
        return {
          write: async (bytes: Uint8Array) => {
            if (failWrites)
              throw new DOMException(
                "Disk quota fixture",
                "QuotaExceededError",
              );
            chunks.push(bytes.slice());
          },
          close: async () => {
            files.set(name, new Blob(chunks as BlobPart[]));
          },
          abort: async () => {
            aborted++;
            chunks.length = 0;
          },
        };
      },
    }),
  };
  return {
    files,
    directory,
    get aborted() {
      return aborted;
    },
    set failWrites(value: boolean) {
      failWrites = value;
    },
  };
}
