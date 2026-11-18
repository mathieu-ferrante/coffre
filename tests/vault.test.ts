import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entry } from './helpers.ts';
import { Vault, WrongPasswordError, KDF_PARAMS } from '../src/vault.ts';

const PW = 'Girafe-Tomate-Voilier7-Prisme-Lynx-Opale';

test('création, chiffrement, réouverture', async () => {
  const v = await Vault.create(PW);
  const id = v.addEntry(entry('banque', 'S3cret!é漢字', { notes: 'ligne1\nligne2', otp: 'JBSWY3DPEHPK3PXP' }));
  const { data } = await v.save();
  // Le fichier est un KDBX 4 (signatures KeePass)
  const sig = new DataView(data);
  assert.equal(sig.getUint32(0, true), 0x9aa2d903);
  assert.equal(sig.getUint32(4, true), 0xb54bfb67);
  assert.equal(sig.getUint16(10, true), 4);
  // Aucun texte en clair dans le fichier
  const raw = Buffer.from(data).toString('latin1');
  assert.ok(!raw.includes('banque') && !raw.includes('S3cret'));

  const v2 = await Vault.open(data, PW);
  const e = v2.read(id);
  assert.equal(e.title, 'banque');
  assert.equal(e.password, 'S3cret!é漢字');
  assert.equal(e.notes, 'ligne1\nligne2');
  assert.match(e.otp, /^otpauth:\/\/totp\/.*secret=JBSWY3DPEHPK3PXP/);
  assert.equal(v2.kdfDescription(), `Argon2id · ${KDF_PARAMS.memoryBytes / 1024 / 1024} Mio · ${KDF_PARAMS.iterations} passes`);
});

test('mauvais mot de passe refusé', async () => {
  const v = await Vault.create(PW);
  const { data } = await v.save();
  await assert.rejects(() => Vault.open(data, PW + 'x'), WrongPasswordError);
});

test('modification : historique des anciens mots de passe conservé', async () => {
  const v = await Vault.create(PW);
  const id = v.addEntry(entry('mail', 'ancien'));
  assert.equal(v.updateEntry(id, entry('mail', 'ancien')), false, 'aucun changement => pas d’historique');
  assert.equal(v.updateEntry(id, entry('mail', 'nouveau')), true);
  const { data } = await v.save();
  const v2 = await Vault.open(data, PW);
  assert.equal(v2.read(id).password, 'nouveau');
  assert.deepEqual(v2.history(id).map((h) => h.password), ['ancien']);
});

test('corbeille, restauration, suppression définitive', async () => {
  const v = await Vault.create(PW);
  const a = v.addEntry(entry('a'));
  const b = v.addEntry(entry('b'));
  v.trashEntry(a);
  assert.deepEqual(v.summaries().map((s) => s.title), ['b']);
  assert.deepEqual(v.summaries(true).map((s) => s.title), ['a']);
  v.restoreEntry(a);
  assert.deepEqual(v.summaries().map((s) => s.title), ['a', 'b']);
  v.trashEntry(b);
  assert.equal(v.emptyTrash(), 1);
  const v2 = await Vault.open((await v.save()).data, PW);
  assert.deepEqual(v2.summaries().map((s) => s.title), ['a']);
  assert.equal(v2.summaries(true).length, 0);
});

test('changement du mot de passe maître', async () => {
  const v = await Vault.create(PW);
  v.addEntry(entry('x'));
  assert.equal(await v.checkPassword(PW), true);
  await v.changePassword('Nouveau-Mot-De-Passe-Tres-Long-42');
  assert.equal(await v.checkPassword(PW), false);
  const { data } = await v.save();
  await assert.rejects(() => Vault.open(data, PW), WrongPasswordError);
  const v2 = await Vault.open(data, 'Nouveau-Mot-De-Passe-Tres-Long-42');
  assert.equal(v2.summaries().length, 1);
});

test('sauvegardes concurrentes sérialisées (fichier jamais corrompu)', async () => {
  const v = await Vault.create(PW);
  v.addEntry(entry('a'));
  const results = await Promise.all([v.save(), v.save(), v.save()]);
  for (const r of results) {
    const o = await Vault.open(r.data, PW);
    assert.equal(o.summaries().length, 1);
  }
});
