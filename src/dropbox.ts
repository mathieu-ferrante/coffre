// Synchronisation via Dropbox (dossier d'application dédié, accès limité à ce dossier).
// Connexion OAuth 2 « PKCE » : aucun secret n'est stocké dans l'app ; seul un jeton
// de renouvellement reste sur l'appareil. Le fichier envoyé est déjà chiffré.
import { ConflictError, type RemoteBackend } from './sync.ts';
import { KEYS, kvDel, kvGet, kvSet, type DropboxConfig } from './storage.ts';

const AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

export const VAULT_PATH = '/coffre.kdbx';
export const BACKUP_DIR = '/sauvegardes';
const BACKUPS_TO_KEEP = 30;

export class DropboxAuthError extends Error {
  constructor(msg = 'La connexion Dropbox a expiré. Reconnecte Dropbox dans les réglages.') {
    super(msg);
    this.name = 'DropboxAuthError';
  }
}

export class OfflineError extends Error {
  constructor() {
    super('Hors ligne : la synchronisation reprendra dès le retour du réseau.');
    this.name = 'OfflineError';
  }
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** En-tête Dropbox-API-Arg : JSON en ASCII strict. */
function apiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function redirectUri(): string {
  return location.origin + location.pathname;
}

export async function startDropboxAuth(appKey: string): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await kvSet(KEYS.oauth, { verifier, state, appKey, redirect: redirectUri(), at: Date.now() });
  const params = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri(),
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

/** À appeler au démarrage : termine la connexion si l'on revient de Dropbox. Renvoie true si une connexion a eu lieu. */
export async function completeDropboxAuth(): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  if (!code && !error) return false;
  history.replaceState(null, '', url.pathname);
  const pending = await kvGet<{ verifier: string; state: string; appKey: string; redirect: string; at: number }>(KEYS.oauth);
  await kvDel(KEYS.oauth);
  if (error) throw new Error('Connexion Dropbox annulée.');
  if (!pending || pending.state !== state || Date.now() - pending.at > 30 * 60 * 1000) {
    throw new Error('Réponse Dropbox inattendue. Recommence la connexion.');
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: code!,
      grant_type: 'authorization_code',
      code_verifier: pending.verifier,
      client_id: pending.appKey,
      redirect_uri: pending.redirect,
    }),
  });
  if (!res.ok) throw new Error(`Dropbox a refusé la connexion (${res.status}). Vérifie la clé d'app et l'adresse de redirection.`);
  const tok = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const cfg: DropboxConfig = {
    appKey: pending.appKey,
    refreshToken: tok.refresh_token,
    accessToken: tok.access_token,
    expiresAt: Date.now() + tok.expires_in * 1000,
  };
  try {
    const acc = await fetch(`${API}/users/get_current_account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (acc.ok) cfg.accountName = ((await acc.json()) as { email?: string; name?: { display_name?: string } }).email;
  } catch {
    /* facultatif */
  }
  await kvSet(KEYS.dropbox, cfg);
  return true;
}

export async function getDropboxConfig(): Promise<DropboxConfig | undefined> {
  return kvGet<DropboxConfig>(KEYS.dropbox);
}

export async function disconnectDropbox(): Promise<void> {
  const cfg = await getDropboxConfig();
  if (cfg?.accessToken) {
    try {
      await fetch(`${API}/auth/token/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${cfg.accessToken}` } });
    } catch {
      /* tant pis : on oublie le jeton localement */
    }
  }
  await kvSet(KEYS.dropbox, { appKey: cfg?.appKey ?? '' } satisfies DropboxConfig);
}

export class DropboxBackend implements RemoteBackend {
  private cfg: DropboxConfig;

  constructor(cfg: DropboxConfig) {
    this.cfg = cfg;
  }

  static async load(): Promise<DropboxBackend | null> {
    const cfg = await getDropboxConfig();
    return cfg?.refreshToken ? new DropboxBackend(cfg) : null;
  }

  private async refresh(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.cfg.refreshToken!,
          client_id: this.cfg.appKey,
        }),
      });
    } catch {
      throw new OfflineError();
    }
    if (res.status === 400 || res.status === 401) throw new DropboxAuthError();
    if (!res.ok) throw new Error(`Dropbox indisponible (${res.status}).`);
    const tok = (await res.json()) as { access_token: string; expires_in: number };
    this.cfg = { ...this.cfg, accessToken: tok.access_token, expiresAt: Date.now() + tok.expires_in * 1000 };
    await kvSet(KEYS.dropbox, this.cfg);
    return tok.access_token;
  }

  private async token(): Promise<string> {
    if (this.cfg.accessToken && (this.cfg.expiresAt ?? 0) - Date.now() > 60_000) return this.cfg.accessToken;
    return this.refresh();
  }

  private async call(url: string, init: RequestInit, retry = true): Promise<Response> {
    const tok = await this.token();
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${tok}` } });
    } catch {
      throw new OfflineError();
    }
    if (res.status === 401 && retry) {
      this.cfg.expiresAt = 0;
      return this.call(url, init, false);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`Dropbox est momentanément indisponible (${res.status}). Nouvel essai bientôt.`);
    }
    return res;
  }

  private async rpc<T>(endpoint: string, body: unknown): Promise<{ ok: boolean; status: number; json: T }> {
    const res = await this.call(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, json };
  }

  async getRev(): Promise<string | null> {
    const r = await this.rpc<{ rev?: string; error_summary?: string }>('/files/get_metadata', { path: VAULT_PATH });
    if (r.ok) return r.json.rev ?? null;
    if (r.status === 409 && r.json.error_summary?.startsWith('path/not_found')) return null;
    throw new Error(`Lecture Dropbox impossible : ${r.json.error_summary ?? r.status}`);
  }

  async download(rev: string): Promise<ArrayBuffer> {
    const res = await this.call(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': apiArg({ path: `rev:${rev}` }) },
    });
    if (!res.ok) throw new Error(`Téléchargement Dropbox impossible (${res.status}).`);
    return res.arrayBuffer();
  }

  private async put(path: string, data: ArrayBuffer, mode: unknown): Promise<Response> {
    return this.call(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': apiArg({ path, mode, autorename: false, mute: true, strict_conflict: true }),
      },
      body: data,
    });
  }

  async upload(data: ArrayBuffer, expectedRev: string | null): Promise<string> {
    const mode = expectedRev ? { '.tag': 'update', update: expectedRev } : { '.tag': 'add' };
    const res = await this.put(VAULT_PATH, data, mode);
    if (res.ok) return ((await res.json()) as { rev: string }).rev;
    const err = (await res.json().catch(() => ({}))) as { error_summary?: string };
    if (res.status === 409 && err.error_summary?.includes('conflict')) throw new ConflictError();
    throw new Error(`Envoi Dropbox impossible : ${err.error_summary ?? res.status}`);
  }

  /** Une copie datée par jour dans /sauvegardes (30 conservées), en plus de l'historique Dropbox. */
  async dailyBackup(data: ArrayBuffer): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    if (this.cfg.lastBackupDay === day) return;
    const res = await this.put(`${BACKUP_DIR}/coffre-${day}.kdbx`, data, { '.tag': 'overwrite' });
    if (!res.ok) return;
    this.cfg = { ...this.cfg, lastBackupDay: day };
    await kvSet(KEYS.dropbox, this.cfg);
    const list = await this.rpc<{ entries?: { name: string; path_lower: string }[] }>('/files/list_folder', { path: BACKUP_DIR });
    const files = (list.json.entries ?? []).filter((e) => /^coffre-\d{4}-\d\d-\d\d\.kdbx$/.test(e.name)).sort((a, b) => b.name.localeCompare(a.name));
    for (const old of files.slice(BACKUPS_TO_KEEP)) {
      await this.rpc('/files/delete_v2', { path: old.path_lower });
    }
  }
}
