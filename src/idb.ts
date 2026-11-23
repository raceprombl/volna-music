const cache = new Map<string, Promise<IDBDatabase>>();

/** Reuse open IndexedDB handles per database name while releasing cleanly on versionchange/delete. */
export function openStoreDb(
  name: string,
  storeName: string,
): Promise<IDBDatabase> {
  const existing = cache.get(name);
  if (existing) return existing;

  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        if (cache.get(name) === pending) cache.delete(name);
      };
      db.onclose = () => {
        if (cache.get(name) === pending) cache.delete(name);
      };
      resolve(db);
    };
    request.onerror = () => {
      if (cache.get(name) === pending) cache.delete(name);
      reject(request.error);
    };
    request.onblocked = () => {
      if (cache.get(name) === pending) cache.delete(name);
      reject(new DOMException("IndexedDB connection blocked", "AbortError"));
    };
  });

  cache.set(name, pending);
  return pending;
}

export async function closeCachedDb(name?: string): Promise<void> {
  const keys = name ? [name] : [...cache.keys()];
  for (const key of keys) {
    const entry = cache.get(key);
    cache.delete(key);
    if (!entry) continue;
    try {
      const db = await entry;
      db.close();
    } catch {
      /* Failed opens have no database handle to close. */
    }
  }
}
