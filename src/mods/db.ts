/**
 * IndexedDB persistence for installed mods — a tiny hand-rolled promise
 * wrapper, no dependency. Blobs are structured-cloneable, so raw mod files
 * are stored as-is and re-parsed on boot.
 */

import type { ModManifest } from './manifest';

const DB_NAME = 'mf-mods';
const STORE = 'mods';

export interface StoredMod {
  /** manifest.id — the object store key. */
  id: string;
  manifest: ModManifest;
  files: Record<string, Blob>;
  addedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await done(run(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

export function idbPutMod(mod: StoredMod): Promise<IDBValidKey> {
  return withStore('readwrite', (s) => s.put(mod));
}

export function idbGetAllMods(): Promise<StoredMod[]> {
  return withStore('readonly', (s) => s.getAll() as IDBRequest<StoredMod[]>);
}

export function idbDeleteMod(id: string): Promise<undefined> {
  return withStore('readwrite', (s) => s.delete(id));
}
