/**
 * IndexedDB persistence for installed mods and auto-charted songs — a tiny
 * hand-rolled promise wrapper, no dependency. Blobs are
 * structured-cloneable, so raw mod files and dropped audio are stored as-is
 * and re-parsed on boot.
 */

import type { Chart } from '../core/chart';
import type { AutoDifficulty } from '../core/autochart/generate';
import type { ModManifest } from './manifest';

const DB_NAME = 'mf-mods';
const DB_VERSION = 2;
const MODS_STORE = 'mods';
const AUTOCHARTS_STORE = 'autocharts';

export interface StoredMod {
  /** manifest.id — the object store key. */
  id: string;
  manifest: ModManifest;
  files: Record<string, Blob>;
  addedAt: number;
}

export interface StoredAutochart {
  /** SHA-256 of the audio file's bytes — the object store key. */
  hash: string;
  fileName: string;
  addedAt: number;
  /** The original dropped file, kept so the song survives reloads. */
  audio: Blob;
  charts: Record<AutoDifficulty, Chart>;
}

const STORES = [
  { name: MODS_STORE, keyPath: 'id' },
  { name: AUTOCHARTS_STORE, keyPath: 'hash' },
] as const;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const { name, keyPath } of STORES) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name, { keyPath });
        }
      }
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
  storeName: typeof MODS_STORE | typeof AUTOCHARTS_STORE,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await done(run(db.transaction(storeName, mode).objectStore(storeName)));
  } finally {
    db.close();
  }
}

export function idbPutMod(mod: StoredMod): Promise<IDBValidKey> {
  return withStore(MODS_STORE, 'readwrite', (s) => s.put(mod));
}

export function idbGetAllMods(): Promise<StoredMod[]> {
  return withStore(MODS_STORE, 'readonly', (s) => s.getAll() as IDBRequest<StoredMod[]>);
}

export function idbDeleteMod(id: string): Promise<undefined> {
  return withStore(MODS_STORE, 'readwrite', (s) => s.delete(id));
}

export function idbPutAutochart(rec: StoredAutochart): Promise<IDBValidKey> {
  return withStore(AUTOCHARTS_STORE, 'readwrite', (s) => s.put(rec));
}

export function idbGetAutochart(hash: string): Promise<StoredAutochart | undefined> {
  return withStore(
    AUTOCHARTS_STORE,
    'readonly',
    (s) => s.get(hash) as IDBRequest<StoredAutochart | undefined>,
  );
}

export function idbGetAllAutocharts(): Promise<StoredAutochart[]> {
  return withStore(
    AUTOCHARTS_STORE,
    'readonly',
    (s) => s.getAll() as IDBRequest<StoredAutochart[]>,
  );
}

export function idbDeleteAutochart(hash: string): Promise<undefined> {
  return withStore(AUTOCHARTS_STORE, 'readwrite', (s) => s.delete(hash));
}
