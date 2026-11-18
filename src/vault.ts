// Le coffre : une base KeePass (KDBX 4) chiffrée en AES-256 / ChaCha20,
// clé dérivée du mot de passe maître par Argon2id.
// Le fichier produit s'ouvre aussi avec KeePassXC (Mac/Windows) et KeePassDX (Android).
import kdbxweb from './kdbx.ts';
import type { Kdbx, KdbxEntry, KdbxEditState, KdbxCredentials } from 'kdbxweb';

/** Paramètres Argon2id des nouveaux coffres : 64 Mio, 10 passes, 2 voies. */
export const KDF_PARAMS = { memoryBytes: 64 * 1024 * 1024, iterations: 10, parallelism: 2 };

export class WrongPasswordError extends Error {
  constructor() {
    super('Mot de passe maître incorrect.');
    this.name = 'WrongPasswordError';
  }
}

export interface EntryInput {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  otp: string;
}

export interface EntrySummary {
  id: string;
  title: string;
  username: string;
  url: string;
  group: string;
  hasOtp: boolean;
  modified: number;
}

export interface HistoryItem {
  modified: number;
  username: string;
  password: string;
  url: string;
}

const STD = { title: 'Title', username: 'UserName', password: 'Password', url: 'URL', notes: 'Notes', otp: 'otp' };

function text(v: unknown): string {
  if (v instanceof kdbxweb.ProtectedValue) return v.getText();
  return typeof v === 'string' ? v : '';
}

export function makeCredentials(password: string): KdbxCredentials {
  return new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password));
}

function isWrongKey(e: unknown): boolean {
  return e instanceof kdbxweb.KdbxError && e.code === kdbxweb.Consts.ErrorCodes.InvalidKey;
}

export async function loadDb(data: ArrayBuffer, credentials: KdbxCredentials): Promise<Kdbx> {
  try {
    return await kdbxweb.Kdbx.load(data, credentials);
  } catch (e) {
    if (isWrongKey(e)) throw new WrongPasswordError();
    throw e;
  }
}

export class Vault {
  db: Kdbx;
  /** Incrémenté à chaque modification, pour savoir si une sauvegarde est à jour. */
  version = 0;
  private saveChain: Promise<unknown> = Promise.resolve();

  private constructor(db: Kdbx) {
    this.db = db;
  }

  static async create(password: string, name = 'Coffre'): Promise<Vault> {
    const credentials = makeCredentials(password);
    await credentials.ready;
    const db = kdbxweb.Kdbx.create(credentials, name);
    db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
    const p = db.header.kdfParameters!;
    const T = kdbxweb.VarDictionary.ValueType;
    p.set('M', T.UInt64, new kdbxweb.Int64(KDF_PARAMS.memoryBytes));
    p.set('I', T.UInt64, new kdbxweb.Int64(KDF_PARAMS.iterations));
    p.set('P', T.UInt32, KDF_PARAMS.parallelism);
    db.meta.historyMaxItems = 20;
    db.getDefaultGroup().name = name;
    return new Vault(db);
  }

  static async open(data: ArrayBuffer, password: string, editState?: KdbxEditState | null): Promise<Vault> {
    const db = await loadDb(data, makeCredentials(password));
    const v = new Vault(db);
    if (editState) db.setLocalEditState(editState);
    return v;
  }

  static fromDb(db: Kdbx): Vault {
    return new Vault(db);
  }

  get credentials(): KdbxCredentials {
    return this.db.credentials;
  }

  /** Chiffre le coffre. Les sauvegardes sont strictement séquentielles (kdbxweb n'est pas réentrant). */
  save(): Promise<{ data: ArrayBuffer; version: number }> {
    const run = async () => {
      const version = this.version;
      const data = await this.db.save();
      return { data, version };
    };
    const next = this.saveChain.then(run, run);
    this.saveChain = next.catch(() => undefined);
    return next;
  }

  async checkPassword(password: string): Promise<boolean> {
    const probe = makeCredentials(password);
    await probe.ready;
    const a = await probe.getHash();
    const b = await this.db.credentials.getHash();
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
  }

  async changePassword(newPassword: string): Promise<void> {
    await this.db.credentials.setPassword(kdbxweb.ProtectedValue.fromString(newPassword));
    this.db.meta.keyChanged = new Date();
    this.version++;
  }

  // ---------- Lecture ----------

  private recycleBinId(): string | undefined {
    return this.db.meta.recycleBinUuid?.id;
  }

  private inTrash(entry: KdbxEntry): boolean {
    const bin = this.recycleBinId();
    if (!bin) return false;
    for (let g = entry.parentGroup; g; g = g.parentGroup) {
      if (g.uuid.id === bin) return true;
    }
    return false;
  }

  private allEntries(): KdbxEntry[] {
    return Array.from(this.db.getDefaultGroup().allEntries());
  }

  private find(id: string): KdbxEntry {
    const e = this.allEntries().find((x) => x.uuid.id === id);
    if (!e) throw new Error('Entrée introuvable.');
    return e;
  }

  private groupLabel(entry: KdbxEntry): string {
    const root = this.db.getDefaultGroup();
    const parts: string[] = [];
    for (let g = entry.parentGroup; g && g !== root; g = g.parentGroup) parts.unshift(g.name || '');
    return parts.join(' / ');
  }

  summaries(trash = false): EntrySummary[] {
    return this.allEntries()
      .filter((e) => this.inTrash(e) === trash)
      .map((e) => ({
        id: e.uuid.id,
        title: text(e.fields.get(STD.title)),
        username: text(e.fields.get(STD.username)),
        url: text(e.fields.get(STD.url)),
        group: this.groupLabel(e),
        hasOtp: !!readOtp(e),
        modified: e.times.lastModTime?.getTime() ?? 0,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
  }

  read(id: string): EntryInput & { created: number; modified: number; inTrash: boolean } {
    const e = this.find(id);
    return {
      title: text(e.fields.get(STD.title)),
      username: text(e.fields.get(STD.username)),
      password: text(e.fields.get(STD.password)),
      url: text(e.fields.get(STD.url)),
      notes: text(e.fields.get(STD.notes)),
      otp: readOtp(e),
      created: e.times.creationTime?.getTime() ?? 0,
      modified: e.times.lastModTime?.getTime() ?? 0,
      inTrash: this.inTrash(e),
    };
  }

  history(id: string): HistoryItem[] {
    const e = this.find(id);
    return e.history
      .map((h) => ({
        modified: h.times.lastModTime?.getTime() ?? 0,
        username: text(h.fields.get(STD.username)),
        password: text(h.fields.get(STD.password)),
        url: text(h.fields.get(STD.url)),
      }))
      .sort((a, b) => b.modified - a.modified);
  }

  /** Tous les mots de passe actifs (pour l'audit de sécurité). */
  allPasswords(): { id: string; title: string; password: string }[] {
    return this.allEntries()
      .filter((e) => !this.inTrash(e))
      .map((e) => ({ id: e.uuid.id, title: text(e.fields.get(STD.title)), password: text(e.fields.get(STD.password)) }));
  }

  // ---------- Écriture ----------

  /** Horodatage à la seconde (précision du format), strictement croissant pour une entrée. */
  private touch(entry: KdbxEntry): void {
    let now = Math.floor(Date.now() / 1000) * 1000;
    const prev = Math.floor((entry.times.lastModTime?.getTime() ?? 0) / 1000) * 1000;
    if (now <= prev) now = prev + 1000;
    entry.times.lastModTime = new Date(now);
    entry.times.lastAccessTime = new Date(now);
  }

  private apply(entry: KdbxEntry, input: EntryInput): void {
    const mp = this.db.meta.memoryProtection;
    const set = (name: string, value: string, protect: boolean | undefined) => {
      entry.fields.set(name, protect ? kdbxweb.ProtectedValue.fromString(value) : value);
    };
    set(STD.title, input.title.trim(), mp.title);
    set(STD.username, input.username.trim(), mp.userName);
    set(STD.password, input.password, true);
    set(STD.url, input.url.trim(), mp.url);
    set(STD.notes, input.notes, mp.notes);
    const otp = normalizeOtpField(input.otp);
    if (otp) set(STD.otp, otp, true);
    else entry.fields.delete(STD.otp);
    entry.fields.delete('TOTP Seed');
    entry.fields.delete('TOTP Settings');
  }

  addEntry(input: EntryInput): string {
    const entry = this.db.createEntry(this.db.getDefaultGroup());
    this.apply(entry, input);
    this.touch(entry);
    entry.times.creationTime = entry.times.lastModTime;
    this.version++;
    return entry.uuid.id;
  }

  updateEntry(id: string, input: EntryInput): boolean {
    const entry = this.find(id);
    const cur = this.read(id);
    const same = (Object.keys(STD) as (keyof EntryInput)[]).every((k) =>
      k === 'otp' ? normalizeOtpField(cur.otp) === normalizeOtpField(input.otp) : k === 'password' || k === 'notes' ? cur[k] === input[k] : cur[k] === input[k].trim(),
    );
    if (same) return false;
    entry.pushHistory();
    this.apply(entry, input);
    this.touch(entry);
    this.db.cleanup({ historyRules: true });
    this.version++;
    return true;
  }

  /** Met l'entrée à la corbeille (récupérable). */
  trashEntry(id: string): void {
    const entry = this.find(id);
    this.db.remove(entry);
    this.version++;
  }

  restoreEntry(id: string): void {
    const entry = this.find(id);
    this.db.move(entry, this.db.getDefaultGroup());
    this.version++;
  }

  /** Suppression définitive (propagée aux autres appareils). */
  purgeEntry(id: string): void {
    const entry = this.find(id);
    this.db.move(entry, null);
    this.version++;
  }

  emptyTrash(): number {
    const ids = this.summaries(true).map((s) => s.id);
    for (const id of ids) this.purgeEntry(id);
    return ids.length;
  }

  /** Recopie les entrées d'un autre coffre KeePass (dossiers conservés, corbeille ignorée). */
  importFrom(source: Kdbx): number {
    const srcRoot = source.getDefaultGroup();
    const srcBin = source.meta.recycleBinUuid?.id;
    const myBin = this.recycleBinId();
    let n = 0;
    for (const entry of Array.from(srcRoot.allEntries())) {
      const path: string[] = [];
      let inBin = false;
      for (let g = entry.parentGroup; g && g !== srcRoot; g = g.parentGroup) {
        if (srcBin && g.uuid.id === srcBin) inBin = true;
        path.unshift(g.name || 'Dossier');
      }
      if (inBin) continue;
      let target = this.db.getDefaultGroup();
      for (const name of path) {
        target = target.groups.find((g) => g.name === name && g.uuid.id !== myBin) ?? this.db.createGroup(target, name);
      }
      this.db.importEntry(entry, target, source);
      n++;
    }
    if (n) this.version++;
    return n;
  }

  // ---------- Synchronisation ----------

  merge(remote: Kdbx): void {
    // Cas limite : la même entrée modifiée sur deux appareils dans la même seconde.
    // Le format ne distingue pas les deux versions (même horodatage) et kdbxweb en ignorerait une.
    // On avance l'horodatage local d'une seconde : la version locale gagne et la distante
    // est conservée dans l'historique par la fusion.
    const remoteById = new Map<string, KdbxEntry>();
    for (const e of remote.getDefaultGroup().allEntries()) remoteById.set(e.uuid.id, e);
    for (const local of this.allEntries()) {
      const rem = remoteById.get(local.uuid.id);
      if (!rem || local.lastModTime !== rem.lastModTime || sameContent(local, rem)) continue;
      local.times.lastModTime = new Date(Math.floor(local.lastModTime / 1000) * 1000 + 1000);
    }
    this.db.merge(remote);
    this.version++;
  }

  /** Remplace le contenu par une base distante (quand il n'y a aucune modification locale). */
  replaceDb(db: Kdbx): void {
    this.db = db;
    this.version++;
  }

  getEditState(): KdbxEditState {
    return this.db.getLocalEditState();
  }

  clearEditState(): void {
    this.db.removeLocalEditState();
  }

  kdfDescription(): string {
    const p = this.db.header.kdfParameters;
    if (!p) return 'AES-KDF (KDBX 3)';
    const uuid = kdbxweb.ByteUtils.bytesToBase64(p.get('$UUID') as ArrayBuffer);
    const name =
      uuid === kdbxweb.Consts.KdfId.Argon2id ? 'Argon2id' : uuid === kdbxweb.Consts.KdfId.Argon2d ? 'Argon2d' : 'AES-KDF';
    if (name === 'AES-KDF') return name;
    const mem = Number((p.get('M') as { value: number }).value) / 1024 / 1024;
    const it = Number((p.get('I') as { value: number }).value);
    return `${name} · ${mem} Mio · ${it} passes`;
  }

  usesStrongKdf(): boolean {
    const p = this.db.header.kdfParameters;
    if (!p) return false;
    const uuid = kdbxweb.ByteUtils.bytesToBase64(p.get('$UUID') as ArrayBuffer);
    return uuid === kdbxweb.Consts.KdfId.Argon2id || uuid === kdbxweb.Consts.KdfId.Argon2d;
  }

  /** Passe un coffre importé (ex. ancien KeePass) aux paramètres de chiffrement actuels. */
  upgradeKdf(): void {
    if (this.db.versionMajor < 4) this.db.upgrade();
    this.db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
    const p = this.db.header.kdfParameters!;
    const T = kdbxweb.VarDictionary.ValueType;
    p.set('M', T.UInt64, new kdbxweb.Int64(KDF_PARAMS.memoryBytes));
    p.set('I', T.UInt64, new kdbxweb.Int64(KDF_PARAMS.iterations));
    p.set('P', T.UInt32, KDF_PARAMS.parallelism);
    this.version++;
  }
}

function sameContent(a: KdbxEntry, b: KdbxEntry): boolean {
  const names = new Set([...a.fields.keys(), ...b.fields.keys()]);
  for (const n of names) if (text(a.fields.get(n)) !== text(b.fields.get(n))) return false;
  return true;
}

function readOtp(e: KdbxEntry): string {
  const otp = text(e.fields.get(STD.otp));
  if (otp) return otp;
  // Ancien format KeePassXC (« TOTP Seed »)
  return text(e.fields.get('TOTP Seed'));
}

/** Stocke la 2FA au format otpauth:// (compatible KeePassXC / KeePassDX). */
export function normalizeOtpField(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (/^otpauth:\/\//i.test(v)) return v;
  const secret = v.replace(/[\s-]/g, '').toUpperCase();
  return `otpauth://totp/Coffre?secret=${secret}&period=30&digits=6&algorithm=SHA1`;
}
