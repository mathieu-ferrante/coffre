import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Device, MemoryBackend, entry } from './helpers.ts';
import { Vault } from '../src/vault.ts';
import { RemotePasswordChangedError } from '../src/sync.ts';

const PW = 'Phrase-De-Passe-Pour-Les-Tests-123';

/** Mac crée le coffre et l'envoie ; le téléphone le récupère comme dans l'app (« J'ai déjà un coffre »). */
async function twoDevices() {
  const cloud = new MemoryBackend();
  const mac = new Device(await Vault.create(PW), cloud);
  mac.vault.addEntry(entry('initial'));
  assert.equal(await mac.sync(), 'created');
  const phoneVault = await Vault.open(cloud.data!.slice(0), PW);
  const phone = new Device(phoneVault, cloud);
  phone.remoteRev = cloud.rev;
  phone.syncedVersion = phoneVault.version;
  return { cloud, mac, phone };
}

const titles = (d: Device) => d.vault.summaries().map((s) => s.title);

test('premier envoi puis rien à faire', async () => {
  const { mac, phone } = await twoDevices();
  assert.equal(await mac.sync(), 'unchanged');
  assert.equal(await phone.sync(), 'unchanged');
});

test('modification sur un appareil → récupérée par l’autre', async () => {
  const { mac, phone } = await twoDevices();
  phone.vault.addEntry(entry('ajout-tel'));
  assert.equal(await phone.sync(), 'uploaded');
  assert.equal(await mac.sync(), 'downloaded');
  assert.deepEqual(titles(mac), ['ajout-tel', 'initial']);
});

test('modifications hors ligne des deux côtés → fusion sans perte', async () => {
  const { mac, phone } = await twoDevices();
  mac.vault.addEntry(entry('ajout-mac'));
  phone.vault.addEntry(entry('ajout-tel'));
  assert.equal(await mac.sync(), 'uploaded');
  assert.equal(await phone.sync(), 'merged');
  assert.equal(await mac.sync(), 'downloaded');
  assert.deepEqual(titles(mac), ['ajout-mac', 'ajout-tel', 'initial']);
  assert.deepEqual(titles(phone), titles(mac));
});

test('même entrée modifiée des deux côtés → la plus récente gagne, l’autre reste dans l’historique', async () => {
  const { mac, phone } = await twoDevices();
  const id = mac.vault.summaries()[0].id;
  mac.vault.updateEntry(id, entry('initial', 'version-mac'));
  await new Promise((r) => setTimeout(r, 1100)); // horodatage à la seconde dans le format KeePass
  phone.vault.updateEntry(id, entry('initial', 'version-tel'));
  await mac.sync();
  assert.equal(await phone.sync(), 'merged');
  await mac.sync();
  for (const d of [mac, phone]) {
    assert.equal(d.vault.read(id).password, 'version-tel');
    const old = d.vault.history(id).map((h) => h.password);
    assert.ok(old.includes('version-mac'), 'version du Mac conservée dans l’historique');
    assert.ok(old.includes('pw-initial'));
  }
});

test('même entrée modifiée des deux côtés dans la même seconde → aucune version perdue', async () => {
  const { mac, phone } = await twoDevices();
  const id = mac.vault.summaries()[0].id;
  mac.vault.updateEntry(id, entry('initial', 'meme-seconde-mac'));
  phone.vault.updateEntry(id, entry('initial', 'meme-seconde-tel'));
  await mac.sync();
  await phone.sync();
  await mac.sync();
  for (const d of [mac, phone]) {
    const all = [d.vault.read(id).password, ...d.vault.history(id).map((h) => h.password)];
    assert.ok(all.includes('meme-seconde-mac') && all.includes('meme-seconde-tel'), JSON.stringify(all));
  }
  assert.equal(mac.vault.read(id).password, phone.vault.read(id).password, 'les deux appareils convergent');
});

test('suppression propagée, sans résurrection', async () => {
  const { mac, phone } = await twoDevices();
  const id = mac.vault.summaries()[0].id;
  mac.vault.trashEntry(id);
  mac.vault.emptyTrash();
  await mac.sync();
  phone.vault.addEntry(entry('autre')); // modification locale concurrente
  await phone.sync();
  await mac.sync();
  assert.deepEqual(titles(phone), ['autre']);
  assert.deepEqual(titles(mac), ['autre']);
});

test('un autre appareil écrit pendant notre envoi → on refusionne, rien n’est écrasé', async () => {
  const { cloud, mac, phone } = await twoDevices();
  mac.vault.addEntry(entry('mac-1'));
  phone.vault.addEntry(entry('tel-1'));
  cloud.beforeUpload = async () => {
    // Le téléphone écrit pile entre la lecture et l'envoi du Mac
    await phone.sync();
  };
  assert.equal(await mac.sync(), 'merged');
  await phone.sync();
  assert.deepEqual(titles(mac), ['initial', 'mac-1', 'tel-1']);
  assert.deepEqual(titles(phone), titles(mac));
});

test('modification pendant une synchro → reste à envoyer, pas perdue', async () => {
  const { cloud, mac, phone } = await twoDevices();
  mac.vault.addEntry(entry('avant'));
  cloud.beforeUpload = async () => {
    mac.vault.addEntry(entry('pendant'));
  };
  await mac.sync();
  assert.equal(mac.host().isDirty(), true);
  assert.equal(await mac.sync(), 'uploaded');
  await phone.sync();
  assert.deepEqual(titles(phone), ['avant', 'initial', 'pendant']);
});

test('mot de passe maître changé sur un autre appareil → détecté', async () => {
  const { mac, phone } = await twoDevices();
  await mac.vault.changePassword('Tout-Nouveau-Mot-De-Passe-99');
  await mac.sync();
  phone.vault.addEntry(entry('tel'));
  await assert.rejects(() => phone.sync(), RemotePasswordChangedError);
  // L'utilisateur saisit le nouveau mot de passe sur le téléphone : tout se resynchronise
  await phone.vault.changePassword('Tout-Nouveau-Mot-De-Passe-99');
  assert.equal(await phone.sync(), 'merged');
  await mac.sync();
  assert.deepEqual(titles(mac), ['initial', 'tel']);
});

test('deux coffres différents se rencontrent → entrées locales recopiées, aucune perte', async () => {
  const { cloud, mac } = await twoDevices();
  const other = new Device(await Vault.create(PW), cloud);
  other.vault.addEntry(entry('coffre-neuf'));
  assert.equal(await other.sync(), 'merged');
  assert.deepEqual(titles(other), ['coffre-neuf', 'initial']);
  await mac.sync();
  assert.deepEqual(titles(mac), ['coffre-neuf', 'initial']);
});

test('le fichier synchronisé reste lisible par un nouvel appareil', async () => {
  const { cloud, mac, phone } = await twoDevices();
  mac.vault.addEntry(entry('m'));
  phone.vault.addEntry(entry('p'));
  await mac.sync();
  await phone.sync();
  const fresh = await Vault.open(cloud.data!.slice(0), PW);
  assert.deepEqual(fresh.summaries().map((s) => s.title), ['initial', 'm', 'p']);
});
