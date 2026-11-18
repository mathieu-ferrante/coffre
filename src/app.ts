// Contrôleur de l'application : ouverture/verrouillage, enregistrement local, synchronisation.
// Aucune manipulation du DOM ici (voir ui.ts).
import { Vault, loadDb, makeCredentials } from './vault.ts';
import { synchronize, remoteAcceptsPassword, RemotePasswordChangedError, type SyncOutcome } from './sync.ts';
import { DropboxBackend, DropboxAuthError, OfflineError, getDropboxConfig, disconnectDropbox } from './dropbox.ts';
import {
  KEYS,
  kvGet,
  kvSet,
  writeVault,
  clearAll,
  loadSettings,
  requestPersistence,
  type LocalVaultRecord,
  type Settings,
} from './storage.ts';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'pending' | 'offline' | 'error';

class App {
  vault: Vault | null = null;
  hasLocalVault = false;
  settings!: Settings;
  dropbox: DropboxBackend | null = null;
  dropboxAccount = '';
  dropboxAppKey = '';

  syncStatus: SyncStatus = 'off';
  syncMessage = '';
  lastSync: number | null = null;
  /** Le coffre distant n'accepte pas notre mot de passe maître (changé ailleurs). */
  needsRemotePassword = false;

  private remoteRev: string | null = null;
  private syncedVersion = -1;
  private persistedVersion = -1;
  private savedCache: { data: ArrayBuffer; version: number } | null = null;
  private record: LocalVaultRecord | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private periodic: ReturnType<typeof setInterval> | null = null;
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(what: 'data' | 'status' | 'lock') => void>();

  on(fn: (what: 'data' | 'status' | 'lock') => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(what: 'data' | 'status' | 'lock') {
    for (const fn of this.listeners) fn(what);
  }

  async init(): Promise<void> {
    this.settings = await loadSettings();
    this.record = (await kvGet<LocalVaultRecord>(KEYS.vault)) ?? null;
    this.hasLocalVault = !!this.record;
    await this.loadDropbox();
    void requestPersistence();
  }

  async loadDropbox(): Promise<void> {
    const cfg = await getDropboxConfig();
    this.dropboxAppKey = cfg?.appKey ?? '';
    this.dropboxAccount = cfg?.accountName ?? '';
    this.dropbox = cfg?.refreshToken ? new DropboxBackend(cfg) : null;
    this.syncStatus = this.dropbox ? 'idle' : 'off';
  }

  async saveSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await kvSet(KEYS.settings, this.settings);
  }

  get lastLocalSync(): number | null {
    return this.record?.lastSync ?? null;
  }

  // ---------- Ouverture / création ----------

  async createVault(password: string): Promise<void> {
    const vault = await Vault.create(password);
    this.adopt(vault, null, -1);
    await this.persistNow();
    this.hasLocalVault = true;
    this.scheduleSync(500);
  }

  async unlock(password: string): Promise<void> {
    const rec = (await kvGet<LocalVaultRecord>(KEYS.vault)) ?? null;
    if (!rec) throw new Error('Aucun coffre sur cet appareil.');
    const vault = await Vault.open(rec.data, password, rec.editState);
    this.record = rec;
    this.lastSync = rec.lastSync;
    this.adopt(vault, rec.remoteRev, rec.dirty ? -1 : vault.version);
    this.savedCache = rec.dirty ? null : { data: rec.data, version: vault.version };
    this.persistedVersion = vault.version;
    this.scheduleSync(300);
  }

  private adopt(vault: Vault, remoteRev: string | null, syncedVersion: number) {
    this.vault = vault;
    this.remoteRev = remoteRev;
    this.syncedVersion = syncedVersion;
    this.persistedVersion = -1;
    this.savedCache = null;
    this.needsRemotePassword = false;
    this.startPeriodicSync();
    this.emit('data');
  }

  /** Enregistre un fichier .kdbx existant comme coffre de cet appareil (avant déverrouillage). */
  async adoptFile(data: ArrayBuffer, fromRemoteRev: string | null): Promise<void> {
    const rec: LocalVaultRecord = {
      data,
      editState: null,
      remoteRev: fromRemoteRev,
      dirty: fromRemoteRev === null,
      savedAt: Date.now(),
      lastSync: fromRemoteRev ? Date.now() : null,
    };
    await writeVault(rec);
    this.record = rec;
    this.hasLocalVault = true;
  }

  /** Nouvel appareil : récupère le coffre depuis Dropbox. Renvoie false s'il n'y en a pas encore. */
  async fetchRemoteVault(): Promise<boolean> {
    if (!this.dropbox) throw new Error('Dropbox n’est pas connecté.');
    const rev = await this.dropbox.getRev();
    if (!rev) return false;
    const data = await this.dropbox.download(rev);
    await this.adoptFile(data, rev);
    return true;
  }

  async lock(): Promise<void> {
    if (!this.vault) return;
    try {
      await this.persistNow();
    } catch {
      /* on verrouille quand même */
    }
    this.vault = null;
    this.savedCache = null;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.periodic) clearInterval(this.periodic);
    this.syncTimer = null;
    this.periodic = null;
    this.emit('lock');
  }

  async resetDevice(): Promise<void> {
    this.vault = null;
    await clearAll();
    this.record = null;
    this.hasLocalVault = false;
    await this.loadDropbox();
    this.emit('lock');
  }

  // ---------- Modifications ----------

  /** Applique une modification au coffre, puis l'enregistre et la synchronise. */
  mutate<T>(fn: (v: Vault) => T): T {
    if (!this.vault) throw new Error('Coffre verrouillé.');
    const r = fn(this.vault);
    this.emit('data');
    this.persistSoon();
    return r;
  }

  private persistSoon() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow()
        .then(() => this.scheduleSync(1000))
        .catch((e) => this.setStatus('error', 'Enregistrement local impossible : ' + errMsg(e)));
    }, 150);
  }

  private async saveCached(): Promise<{ data: ArrayBuffer; version: number }> {
    const v = this.vault!;
    if (this.savedCache && this.savedCache.version === v.version) return this.savedCache;
    const r = await v.save();
    if (!this.savedCache || r.version >= this.savedCache.version) this.savedCache = r;
    return r;
  }

  async persistNow(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (!this.vault) return;
    const { data, version } = await this.saveCached();
    await this.writeRecord(data, version);
  }

  private async writeRecord(data: ArrayBuffer, version: number): Promise<void> {
    if (!this.vault) return;
    let rec: LocalVaultRecord;
    if (version >= this.persistedVersion) {
      this.persistedVersion = version;
      rec = {
        data,
        editState: this.vault.getEditState(),
        remoteRev: this.remoteRev,
        dirty: version !== this.syncedVersion,
        savedAt: Date.now(),
        lastSync: this.lastSync,
      };
    } else if (this.record) {
      // Une version plus récente est déjà enregistrée : on ne met à jour que l'état de synchro.
      rec = { ...this.record, remoteRev: this.remoteRev, lastSync: this.lastSync, dirty: true };
    } else return;
    await writeVault(rec);
    this.record = rec;
    this.hasLocalVault = true;
  }

  // ---------- Synchronisation ----------

  private setStatus(s: SyncStatus, msg = '') {
    this.syncStatus = s;
    this.syncMessage = msg;
    this.emit('status');
  }

  isDirty(): boolean {
    return !!this.vault && this.vault.version !== this.syncedVersion;
  }

  private startPeriodicSync() {
    if (this.periodic) clearInterval(this.periodic);
    this.periodic = setInterval(() => this.scheduleSync(0), 60_000);
  }

  scheduleSync(delay = 1500): void {
    if (!this.dropbox || !this.vault) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (this.isDirty() && this.syncStatus !== 'syncing') this.setStatus('pending');
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow();
    }, delay);
  }

  async syncNow(): Promise<void> {
    if (!this.dropbox || !this.vault || this.needsRemotePassword) return;
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
      if (this.syncAgain) {
        this.syncAgain = false;
        this.scheduleSync(500);
      }
    });
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    const backend = this.dropbox!;
    this.setStatus('syncing');
    let lastData: ArrayBuffer | null = null;
    try {
      const self = this;
      const outcome: SyncOutcome = await synchronize({
        get vault() {
          return self.vault!;
        },
        backend,
        get remoteRev() {
          return self.remoteRev;
        },
        isDirty: () => this.isDirty(),
        save: () => this.saveCached(),
        markSynced: async ({ remoteRev, data, version }) => {
          this.remoteRev = remoteRev;
          this.syncedVersion = version;
          this.lastSync = Date.now();
          lastData = data;
          if (!this.savedCache || version >= this.savedCache.version) this.savedCache = { data, version };
          await this.writeRecord(data, version);
        },
      });
      if (outcome === 'downloaded' || outcome === 'merged') this.emit('data');
      this.setStatus(this.isDirty() ? 'pending' : 'idle');
      if (lastData && outcome !== 'downloaded' && outcome !== 'unchanged') {
        backend.dailyBackup(lastData).catch(() => undefined);
      }
    } catch (e) {
      if (!this.vault) return;
      if (e instanceof OfflineError) this.setStatus('offline', e.message);
      else if (e instanceof RemotePasswordChangedError) {
        this.needsRemotePassword = true;
        this.setStatus('error', e.message);
      } else if (e instanceof DropboxAuthError) this.setStatus('error', e.message);
      else this.setStatus('error', errMsg(e));
    }
  }

  /** Le mot de passe maître a changé sur un autre appareil : on adopte le nouveau après vérification. */
  async adoptRemotePassword(password: string): Promise<boolean> {
    if (!this.dropbox || !this.vault) return false;
    const creds = makeCredentials(password);
    await creds.ready;
    if (!(await remoteAcceptsPassword(this.dropbox, creds))) return false;
    await this.vault.changePassword(password);
    this.needsRemotePassword = false;
    this.emit('data');
    await this.persistNow();
    await this.syncNow();
    return true;
  }

  async disconnectDropbox(): Promise<void> {
    await disconnectDropbox();
    await this.loadDropbox();
    this.remoteRev = null;
    this.syncedVersion = -1;
    if (this.vault) await this.persistNow();
    this.emit('status');
  }

  // ---------- Import / export ----------

  async exportFile(): Promise<ArrayBuffer> {
    if (!this.vault) throw new Error('Coffre verrouillé.');
    const { data } = await this.saveCached();
    return data;
  }

  async importKdbx(data: ArrayBuffer, password: string): Promise<number> {
    const creds = makeCredentials(password);
    const db = await loadDb(data, creds);
    return this.mutate((v) => v.importFrom(db));
  }
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const app = new App();
