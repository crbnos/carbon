// IndexedDB cache for parsed raw-model meshes. The occt-import-js STEP parse
// is ~40s of WASM for a real assembly and its output is deterministic for a
// given raw, so parse once and replay from disk on every later visit. Keyed by
// the raw's same-origin URL path — model uploads mint a new id (and therefore a
// new path) per file, so a path never silently changes content.

import type { OcctWorkerMesh } from "./rawWorker";

const DB_NAME = "carbon-raw-viewer";
const STORE = "meshes";
/** Keep the store bounded — parsed buffers for a big assembly run ~30MB. */
const MAX_ENTRIES = 8;

type CacheRow = {
  key: string;
  savedAt: number;
  meshes: OcctWorkerMesh[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

/** Cache read — any failure (no IDB, private mode, corrupt row) is a miss. */
export async function rawCacheGet(
  key: string
): Promise<OcctWorkerMesh[] | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as CacheRow | undefined;
        resolve(row?.meshes?.length ? row.meshes : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/** Cache write, best-effort — evicts oldest rows beyond MAX_ENTRIES. */
export async function rawCachePut(
  key: string,
  meshes: OcctWorkerMesh[]
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put({ key, savedAt: Date.now(), meshes } satisfies CacheRow);
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = (all.result as CacheRow[]).sort(
          (a, b) => a.savedAt - b.savedAt
        );
        for (const row of rows.slice(
          0,
          Math.max(0, rows.length - MAX_ENTRIES)
        )) {
          store.delete(row.key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // best-effort
  }
}
