import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePassword,
  generatePassphrase,
  passwordEntropy,
  passphraseEntropy,
  estimateStrength,
  randomInt,
  CHARSETS,
  DEFAULT_PASSWORD,
  DEFAULT_PASSPHRASE,
} from '../src/generator.ts';
import { WORDLIST_FR } from '../src/wordlist-fr.ts';
import { parseOtp, totpAt, base32Decode } from '../src/totp.ts';
import { csvToEntries, parseCsv } from '../src/csv.ts';

test('mots de passe : longueur et catégories respectées', () => {
  for (let i = 0; i < 300; i++) {
    const pw = generatePassword({ ...DEFAULT_PASSWORD, length: 12 });
    assert.equal(pw.length, 12);
    assert.match(pw, /[a-z]/);
    assert.match(pw, /[A-Z]/);
    assert.match(pw, /[0-9]/);
    assert.ok([...pw].some((c) => CHARSETS.symbols.includes(c)));
    assert.ok(![...pw].some((c) => 'Il1O0o'.includes(c)), 'caractères ambigus exclus');
  }
  assert.equal(generatePassword({ ...DEFAULT_PASSWORD, symbols: false, upper: false, length: 30 }).match(/^[a-z0-9]{30}$/)?.length, 1);
  assert.ok(passwordEntropy(DEFAULT_PASSWORD) >= 120);
});

test('tirage uniforme (pas de biais grossier)', () => {
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 70000; i++) counts[randomInt(7)]++;
  for (const c of counts) assert.ok(Math.abs(c - 10000) < 600, `distribution ${counts}`);
});

test('phrases de passe', () => {
  assert.ok(WORDLIST_FR.length >= 1024, `liste de ${WORDLIST_FR.length} mots`);
  assert.equal(new Set(WORDLIST_FR).size, WORDLIST_FR.length);
  const p = generatePassphrase(DEFAULT_PASSPHRASE);
  const parts = p.split('-');
  assert.equal(parts.length, 6);
  assert.equal(parts.filter((w) => /\d$/.test(w)).length, 1);
  assert.ok(passphraseEntropy(DEFAULT_PASSPHRASE) >= 60);
});

test('estimation de robustesse', () => {
  assert.equal(estimateStrength('azerty123').score, 0);
  assert.equal(estimateStrength('motdepasse2024').score <= 1, true);
  assert.ok(estimateStrength(generatePassword(DEFAULT_PASSWORD)).score >= 3);
  assert.ok(estimateStrength(generatePassphrase(DEFAULT_PASSPHRASE)).score >= 3);
});

test('TOTP : vecteurs officiels RFC 6238', async () => {
  const secret = new TextEncoder().encode('12345678901234567890');
  const cfg = { secret, digits: 8, period: 30, algorithm: 'SHA-1' as const };
  assert.equal(await totpAt(cfg, 59_000), '94287082');
  assert.equal(await totpAt(cfg, 1111111109_000), '07081804');
  assert.equal(await totpAt(cfg, 20000000000_000), '65353130');
  assert.deepEqual([...base32Decode('GEZDGNBV')], [...new TextEncoder().encode('12345')]);
  const parsed = parseOtp('otpauth://totp/Site:moi?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8');
  assert.equal(parsed?.digits, 8);
  assert.equal(await totpAt(parsed!, 59_000), '94287082');
  assert.equal(parseOtp('pas une clé !'), null);
});

test('import CSV (Chrome, Firefox, Bitwarden)', () => {
  const chrome = 'name,url,username,password,note\n"Ma, banque",https://banque.fr,moi,"mot ""de"" passe","ligne1\nligne2"\n';
  const [e] = csvToEntries(chrome);
  assert.equal(e.title, 'Ma, banque');
  assert.equal(e.password, 'mot "de" passe');
  assert.equal(e.notes, 'ligne1\nligne2');

  const firefox = '"url","username","password","httpRealm"\r\n"https://www.site.com","bob","pw",""\r\n';
  assert.deepEqual(csvToEntries(firefox)[0].title, 'site.com');

  const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Mail,,,0,https://mail.fr,a@b.fr,xyz,JBSWY3DPEHPK3PXP\n';
  const b = csvToEntries(bw)[0];
  assert.equal(b.username, 'a@b.fr');
  assert.equal(b.otp, 'JBSWY3DPEHPK3PXP');
  assert.equal(parseCsv('a,b\n\n1,2\n').length, 2);
});
