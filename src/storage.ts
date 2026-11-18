// Stockage local (IndexedDB) : copie chiffrée du coffre + réglages de l'appareil.
// Le mot de passe maître n'est jamais enregistré.
import type { KdbxEditState } from 'kdbxweb';

const DB_NAME = 'coffre';
const STORE = 'kv';

export interface LocalVaultRecord {
  data: ArrayBuffer;
  editState: KdbxEditState | null;
  remoteRev: string | null;
  dirty: boolean;
  savedAt: number;
  lastSync: number | null;
}

export interface Settings {
  lockMinutes: number;
  clipboardSeconds: number;
  lockOnHide: boolean;
}

export const DEFAULT_SETTINGS: Settings = { lockMinutes: 5, clipboardSeconds: 30, lockOnHide: true };

export interface DropboxConfig {
  appKey: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: number;
  accountName?: string;
  lastBackupDay?: string;
}

export const KEYS = {
  vault: 'vault',
  vaultPrev: 'vault-prev',
  settings: 'settings',
  dropbox: 'dropbox',
  oauth: 'oauth-pending',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'));
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve((req ? req.result : undefined) as T);
        t.onerror = () => reject(t.error ?? new Error('Erreur IndexedDB'));
        t.onabort = () => reject(t.error ?? new Error('Écriture annulée (espace disque ?)'));
      }),
  );
}

export function kvGet<T>(key: string): Promise<T | undefined> {
  return tx<T | undefined>('readonly', (s) => s.get(key));
}

export function kvSet(key: string, value: unknown): Promise<void> {
  return tx<void>('readwrite', (s) => {
    s.put(value, key);
  });
}

export function kvDel(key: string): Promise<void> {
  return tx<void>('readwrite', (s) => {
    s.delete(key);
  });
}

/** Écrit le coffre en gardant la version précédente comme filet de sécurité, dans une seule transaction. */
export function writeVault(rec: LocalVaultRecord): Promise<void> {
  return tx<void>('readwrite', (s) => {
    const get = s.get(KEYS.vault);
    get.onsuccess = () => {
      const prev = get.result as LocalVaultRecord | undefined;
      if (prev && prev.data !== rec.data) s.put(prev, KEYS.vaultPrev);
      s.put(rec, KEYS.vault);
    };
  });
}

export async function clearAll(): Promise<void> {
  await tx<void>('readwrite', (s) => {
    s.clear();
  });
}

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await kvGet<Partial<Settings>>(KEYS.settings)) ?? {}) };
}

/** Demande au navigateur de ne jamais effacer les données de l'app (important sur Android/Safari). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
