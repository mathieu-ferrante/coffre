import { installArgon2 } from '../src/argon2.ts';
import { ConflictError, synchronize, type RemoteBackend, type SyncHost } from '../src/sync.ts';
import type { Vault, EntryInput } from '../src/vault.ts';

installArgon2();

export function entry(title: string, password = 'pw-' + title, extra: Partial<EntryInput> = {}): EntryInput {
  return { title, username: title + '@exemple.fr', password, url: `https://${title}.exemple.fr`, notes: '', otp: '', ...extra };
}

/** Faux Dropbox en mémoire, avec révisions et écriture conditionnelle. */
export class MemoryBackend implements RemoteBackend {
  data: ArrayBuffer | null = null;
  n = 0;
  uploads = 0;
  /** Permet de simuler un autre appareil qui écrit juste avant notre envoi. */
  beforeUpload: (() => Promise<void>) | null = null;

  get rev(): string | null {
    return this.data ? `r${this.n}` : null;
  }
  async getRev() {
    return this.rev;
  }
  async download(rev: string) {
    if (rev !== this.rev || !this.data) throw new Error('révision inconnue');
    return this.data.slice(0);
  }
  async upload(data: ArrayBuffer, expected: string | null) {
    if (this.beforeUpload) {
      const f = this.beforeUpload;
      this.beforeUpload = null;
      await f();
    }
    if (expected !== this.rev) throw new ConflictError();
    this.data = data.slice(0);
    this.n++;
    this.uploads++;
    return this.rev!;
  }
}

/** Un « appareil » : un coffre en mémoire + l'état de synchro, comme dans l'app. */
export class Device {
  vault: Vault;
  backend: RemoteBackend;
  remoteRev: string | null = null;
  syncedVersion = -1;
  local: ArrayBuffer | null = null;

  constructor(vault: Vault, backend: RemoteBackend) {
    this.vault = vault;
    this.backend = backend;
  }

  host(): SyncHost {
    const self = this;
    return {
      get vault() {
        return self.vault;
      },
      backend: this.backend,
      get remoteRev() {
        return self.remoteRev;
      },
      isDirty: () => this.vault.version !== this.syncedVersion,
      save: () => this.vault.save(),
      markSynced: async ({ remoteRev, data, version }) => {
        this.remoteRev = remoteRev;
        this.syncedVersion = version;
        this.local = data;
      },
    };
  }

  sync() {
    return synchronize(this.host());
  }
}
