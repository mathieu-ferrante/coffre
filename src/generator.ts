// Générateur de mots de passe et de phrases de passe.
// Aléa : crypto.getRandomValues (générateur cryptographique du système),
// tirage sans biais par rejet.
import { WORDLIST_FR } from './wordlist-fr.ts';

export const CHARSETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!#$%&*+-=?@^_~.,:;/()[]{}',
};
const AMBIGUOUS = new Set('Il1O0o|`\'"');

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  addNumber: boolean;
}

export const DEFAULT_PASSWORD: PasswordOptions = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  avoidAmbiguous: true,
};

export const DEFAULT_PASSPHRASE: PassphraseOptions = {
  words: 6,
  separator: '-',
  capitalize: true,
  addNumber: true,
};

/** Entier uniforme dans [0, max) sans biais modulo. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new Error('max invalide');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function classes(opts: PasswordOptions): string[] {
  const list: string[] = [];
  const keep = (s: string) => (opts.avoidAmbiguous ? [...s].filter((c) => !AMBIGUOUS.has(c)).join('') : s);
  if (opts.lower) list.push(keep(CHARSETS.lower));
  if (opts.upper) list.push(keep(CHARSETS.upper));
  if (opts.digits) list.push(keep(CHARSETS.digits));
  if (opts.symbols) list.push(keep(CHARSETS.symbols));
  return list.filter((s) => s.length > 0);
}

export function generatePassword(opts: PasswordOptions): string {
  const cls = classes(opts);
  if (cls.length === 0) throw new Error('Choisis au moins un type de caractères.');
  const length = Math.max(4, Math.min(128, Math.floor(opts.length)));
  const pool = cls.join('');
  // On tire uniformément puis on rejette les résultats où une catégorie demandée manque :
  // le résultat reste uniforme parmi les mots de passe valides.
  for (let attempt = 0; attempt < 10000; attempt++) {
    let out = '';
    for (let i = 0; i < length; i++) out += pool[randomInt(pool.length)];
    if (length < cls.length || cls.every((set) => [...out].some((c) => set.includes(c)))) return out;
  }
  throw new Error('Génération impossible avec ces options.');
}

export function passwordEntropy(opts: PasswordOptions): number {
  const pool = classes(opts).join('').length;
  if (!pool) return 0;
  return Math.floor(opts.length * Math.log2(pool));
}

export function generatePassphrase(opts: PassphraseOptions, words: readonly string[] = WORDLIST_FR): string {
  const n = Math.max(3, Math.min(12, Math.floor(opts.words)));
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    let w = words[randomInt(words.length)];
    if (opts.capitalize) w = w[0].toUpperCase() + w.slice(1);
    parts.push(w);
  }
  if (opts.addNumber) {
    const idx = randomInt(parts.length);
    parts[idx] = parts[idx] + String(randomInt(10));
  }
  return parts.join(opts.separator);
}

export function passphraseEntropy(opts: PassphraseOptions, words: readonly string[] = WORDLIST_FR): number {
  const n = Math.max(3, Math.min(12, Math.floor(opts.words)));
  let bits = n * Math.log2(words.length);
  if (opts.addNumber) bits += Math.log2(10 * n);
  return Math.floor(bits);
}

// ---------- Estimation de la robustesse d'un mot de passe saisi ----------

const COMMON = [
  'password', 'motdepasse', 'azerty', 'qwerty', 'qwertz', 'abc123', 'admin', 'welcome', 'bienvenue', 'soleil',
  'bonjour', 'loulou', 'doudou', 'chouchou', 'marseille', 'paris', 'iloveyou', 'jetaime', 'football', 'dragon',
  'monkey', 'letmein', 'master', 'secret', 'sunshine', 'princess', 'coucou', 'nicolas', 'camille', 'julien',
  'chocolat', 'azertyuiop', 'qwertyuiop', '123456', '1234567890', '000000', '111111', '654321', '121212', '696969',
];

export interface Strength {
  bits: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

/** Seuils adaptés à un coffre protégé par Argon2id (chaque essai coûte cher à un attaquant). */
export function strengthFromBits(bits: number): Strength {
  const score: Strength['score'] = bits < 40 ? 0 : bits < 50 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, score, label: ['Très faible', 'Faible', 'Correct', 'Fort', 'Très fort'][score] };
}

const WORDSET = new Set(WORDLIST_FR);

/** Phrase de passe (mots séparés) : on compte en mots, pas en caractères. */
function passphraseBits(pw: string): number | null {
  const tokens = pw.split(/[\s\-._,;:/+|]+/).filter(Boolean);
  if (tokens.length < 3) return null;
  let bits = 0;
  for (const t of tokens) {
    const word = t.replace(/\d+/g, '');
    const digits = t.length - word.length;
    if (!/^\p{L}*$/u.test(word)) return null;
    if (word.length > 12) return null;
    // Mot de notre liste : log2(taille de la liste) ; autre mot : dictionnaire d'~20 000 mots.
    if (word) bits += WORDSET.has(word.toLowerCase()) ? Math.log2(WORDLIST_FR.length) : Math.min(word.length * 4.7, 14.3);
    bits += digits * Math.log2(10);
  }
  return Math.floor(bits);
}

export function estimateStrength(pw: string): Strength {
  if (!pw) return { bits: 0, score: 0, label: 'Vide' };
  const asPhrase = passphraseBits(pw);
  if (asPhrase !== null) return strengthFromBits(asPhrase);
  const chars = [...pw];
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  // Longueur effective : les répétitions et suites comptent peu.
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i].codePointAt(0)!;
    const p = i > 0 ? chars[i - 1].codePointAt(0)! : -10;
    const pp = i > 1 ? chars[i - 2].codePointAt(0)! : -20;
    if (c === p) effective += 0.25;
    else if (c - p === p - pp && Math.abs(c - p) <= 1) effective += 0.25;
    else effective += 1;
  }
  let bits = effective * Math.log2(Math.max(pool, 2));
  const lower = pw.toLowerCase();
  for (const w of COMMON) {
    if (lower.includes(w)) bits -= w.length * Math.log2(Math.max(pool, 2)) * 0.8;
  }
  // Mot de passe constitué uniquement de chiffres ou d'une date : très prévisible.
  if (/^\d+$/.test(pw)) bits = Math.min(bits, pw.length * 3.32);
  if (/(19|20)\d\d/.test(pw)) bits -= 6;
  return strengthFromBits(Math.max(0, Math.floor(bits)));
}
