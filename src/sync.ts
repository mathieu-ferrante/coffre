// Moteur de synchronisation, indépendant du service de stockage.
//
// Principe (le service ne voit que le fichier chiffré) :
//  1. on lit la révision du fichier distant ;
//  2. s'il n'a pas bougé depuis la dernière synchro, on envoie nos modifications ;
//  3. sinon on le télécharge, on le fusionne entrée par entrée avec le coffre local
//     (la version la plus récente gagne, l'autre est conservée dans l'historique),
//     puis on renvoie le résultat ;
//  4. l'envoi est conditionnel (« seulement si la révision distante est toujours X ») :
//     si un autre appareil a écrit entre-temps, on recommence la fusion. Rien n'est écrasé.
import type { Kdbx, KdbxCredentials } from 'kdbxweb';
import { loadDb, WrongPasswordError, type Vault } from './vault.ts';

export class ConflictError extends Error {
  constructor() {
    super('Le fichier distant a changé pendant l’envoi.');
    this.name = 'ConflictError';
  }
}

export class RemotePasswordChangedError extends Error {
  constructor() {
    super('Le mot de passe maître a été changé sur un autre appareil.');
    this.name = 'RemotePasswordChangedError';
  }
}

export interface RemoteBackend {
  /** Révision actuelle du fichier distant, ou null s'il n'existe pas encore. */
  getRev(): Promise<string | null>;
  download(rev: string): Promise<ArrayBuffer>;
  /** Écrit le fichier si la révision distante vaut toujours `expectedRev` (null = création), sinon ConflictError. */
  upload(data: ArrayBuffer, expectedRev: string | null): Promise<string>;
}

export interface SyncHost {
  vault: Vault;
  backend: RemoteBackend;
  /** Révision distante correspondant à la dernière synchro réussie. */
  remoteRev: string | null;
  /** Vrai s'il existe des modifications locales non envoyées. */
  isDirty(): boolean;
  /** Chiffre le coffre (ou réutilise le dernier chiffrement s'il est à jour). */
  save(): Promise<{ data: ArrayBuffer; version: number }>;
  /** La version locale `version` correspond exactement au fichier distant `remoteRev`. */
  markSynced(p: { remoteRev: string; data: ArrayBuffer; version: number }): Promise<void>;
}

export type SyncOutcome = 'unchanged' | 'created' | 'uploaded' | 'downloaded' | 'merged';

export async function openRemote(data: ArrayBuffer, credentials: KdbxCredentials): Promise<Kdbx> {
  try {
    return await loadDb(data, credentials);
  } catch (e) {
    if (e instanceof WrongPasswordError) throw new RemotePasswordChangedError();
    throw e;
  }
}

/** Copie les entrées actives d'un coffre étranger dans `target` (aucune perte si deux coffres différents se rencontrent). */
function importForeignEntries(source: Kdbx, target: Kdbx): number {
  const binId = source.meta.recycleBinUuid?.id;
  let n = 0;
  for (const entry of source.getDefaultGroup().allEntries()) {
    let inBin = false;
    for (let g = entry.parentGroup; g; g = g.parentGroup) if (binId && g.uuid.id === binId) inBin = true;
    if (inBin) continue;
    target.importEntry(entry, target.getDefaultGroup(), source);
    n++;
  }
  return n;
}

async function pushAndMark(h: SyncHost, expectedRev: string | null): Promise<boolean> {
  const { data, version } = await h.save();
  let newRev: string;
  try {
    newRev = await h.backend.upload(data, expectedRev);
  } catch (e) {
    if (e instanceof ConflictError) return false;
    throw e;
  }
  if (h.vault.version === version) h.vault.clearEditState();
  await h.markSynced({ remoteRev: newRev, data, version });
  return true;
}

export async function synchronize(h: SyncHost): Promise<SyncOutcome> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const rev = await h.backend.getRev();

    if (rev !== null && rev === h.remoteRev && !h.isDirty()) return 'unchanged';

    if (rev === null || rev === h.remoteRev) {
      if (await pushAndMark(h, rev)) return rev === null ? 'created' : 'uploaded';
      continue;
    }

    // Le fichier distant a été modifié par un autre appareil.
    const remoteData = await h.backend.download(rev);
    const remoteDb = await openRemote(remoteData, h.vault.credentials);
    const sameVault = remoteDb.getDefaultGroup().uuid.equals(h.vault.db.getDefaultGroup().uuid);

    if (!sameVault) {
      // Deux coffres différents : on garde celui du serveur et on y recopie les entrées locales.
      importForeignEntries(h.vault.db, remoteDb);
      h.vault.replaceDb(remoteDb);
      if (await pushAndMark(h, rev)) return 'merged';
      continue;
    }

    if (!h.isDirty()) {
      h.vault.replaceDb(remoteDb);
      await h.markSynced({ remoteRev: rev, data: remoteData, version: h.vault.version });
      return 'downloaded';
    }

    h.vault.merge(remoteDb);
    if (await pushAndMark(h, rev)) return 'merged';
  }
  throw new Error('Synchronisation interrompue : trop de modifications simultanées. Réessaie dans un instant.');
}

/** Vérifie qu'un mot de passe ouvre bien le coffre distant actuel. */
export async function remoteAcceptsPassword(backend: RemoteBackend, credentials: KdbxCredentials): Promise<boolean> {
  const rev = await backend.getRev();
  if (!rev) return false;
  try {
    await loadDb(await backend.download(rev), credentials);
    return true;
  } catch (e) {
    if (e instanceof WrongPasswordError) return false;
    throw e;
  }
}
