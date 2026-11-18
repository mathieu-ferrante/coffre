// Import CSV depuis Chrome, Edge, Firefox, Safari, Bitwarden ou 1Password.
import type { EntryInput } from './vault.ts';

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const COLUMNS: Record<keyof EntryInput, string[]> = {
  title: ['name', 'title', 'nom', 'titre'],
  url: ['url', 'login_uri', 'website', 'site', 'uri'],
  username: ['username', 'login_username', 'login', 'user', 'email', 'identifiant', "nom d'utilisateur"],
  password: ['password', 'login_password', 'mot de passe', 'pass'],
  notes: ['note', 'notes', 'extra', 'comments'],
  otp: ['otpauth', 'login_totp', 'totp', 'otp'],
};

export function csvToEntries(text: string): EntryInput[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {} as Record<keyof EntryInput, number>;
  for (const key of Object.keys(COLUMNS) as (keyof EntryInput)[]) {
    idx[key] = header.findIndex((h) => COLUMNS[key].includes(h));
  }
  if (idx.password < 0) throw new Error('Colonne « password » introuvable dans le fichier CSV.');
  const get = (r: string[], k: keyof EntryInput) => (idx[k] >= 0 ? (r[idx[k]] ?? '') : '');
  return rows
    .slice(1)
    .map((r) => {
      const url = get(r, 'url').trim();
      let title = get(r, 'title').trim();
      if (!title && url) {
        try {
          title = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          title = url;
        }
      }
      return {
        title: title || 'Sans titre',
        url,
        username: get(r, 'username'),
        password: get(r, 'password'),
        notes: get(r, 'notes'),
        otp: get(r, 'otp'),
      };
    })
    .filter((e) => e.password || e.username);
}
