import { openStoreDb } from "./idb";

const NAME = "volna-files";
const STORE = "files";
const database = () => openStoreDb(NAME, STORE);

export async function fileStore<T>(
  method: "get" | "put" | "delete",
  key: string,
  value?: Blob,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(
      STORE,
      method === "get" ? "readonly" : "readwrite",
    );
    const store = tx.objectStore(STORE);
    const req =
      method === "put"
        ? store.put(value, key)
        : method === "get"
          ? store.get(key)
          : store.delete(key);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearFiles() {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function stagingBytes() {
  const db = await database();
  return new Promise<number>((resolve, reject) => {
    let size = 0;
    const tx = db.transaction(STORE, "readonly");
    const cursor = tx.objectStore(STORE).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        size += (c.value as Blob).size;
        c.continue();
      }
    };
    tx.oncomplete = () => resolve(size);
    tx.onerror = () => reject(tx.error);
  });
}

/** Remove only media staging; settings, history, receipts and directory grants live elsewhere. */
export async function pruneFiles(activeIds: string[]) {
  const keep = new Set(activeIds);
  const db = await database();
  return new Promise<{ removed: number; bytes: number }>((resolve, reject) => {
    let removed = 0;
    let bytes = 0;
    const tx = db.transaction(STORE, "readwrite");
    const r = tx.objectStore(STORE).openCursor();
    r.onsuccess = () => {
      const cursor = r.result;
      if (!cursor) return;
      const id = String(cursor.key).split("/")[0];
      if (!keep.has(id)) {
        bytes += (cursor.value as Blob).size || 0;
        removed++;
        cursor.delete();
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve({ removed, bytes });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const clearJobFiles = async (id: string) => {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(IDBKeyRange.bound(id + "/", id + "/\uffff"));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};
