// Onglet Réglages : synchro, sécurité, santé des mots de passe, import/export, corbeille, appareil.
import { h, icon, mount } from './dom.ts';
import { app, errMsg } from './app.ts';
import { estimateStrength } from './generator.ts';
import { csvToEntries } from './csv.ts';
import { WrongPasswordError } from './vault.ts';
import { dropboxConnectForm } from './ui-lock.ts';
import { openPane } from './ui-main.ts';
import { busy, dialog, downloadFile, fmtAgo, fmtDate, passwordField, pickFile, strengthMeter, toast } from './widgets.ts';

let syncBox: HTMLElement | null = null;
let healthBox: HTMLElement | null = null;
let trashBox: HTMLElement | null = null;
let cryptoBox: HTMLElement | null = null;

function section(title: string, ic: string, ...children: (Node | null)[]): HTMLElement {
  return h('section', { class: 'card settings-section' }, h('h2', { class: 'section-title' }, icon(ic, 18), title), ...children);
}

export function renderSettings(): HTMLElement {
  syncBox = h('div');
  healthBox = h('div');
  trashBox = h('div');
  cryptoBox = h('div');
  const page = h(
    'div',
    { class: 'page narrow-page' },
    h('h1', { class: 'page-title' }, 'Réglages'),
    section('Synchronisation', 'sync', syncBox),
    section('Sécurité', 'shield', securityControls(), cryptoBox, changePasswordForm()),
    section('Santé des mots de passe', 'check', healthBox),
    section('Importer et sauvegarder', 'download', importExport()),
    section('Corbeille', 'trash', trashBox),
    section('Cet appareil', 'settings', deviceInfo()),
    h('p', { class: 'hint center' }, `Coffre ${__APP_VERSION__} · format KeePass KDBX 4 · compatible KeePassXC (Mac, Windows) et KeePassDX (Android)`),
  );
  refreshSettingsData();
  return page;
}

/** Rafraîchit uniquement l'état de synchro (sans toucher au formulaire de connexion). */
export function refreshSyncStatus(): void {
  if (syncBox && app.dropbox) renderSync(syncBox);
}

export function refreshSettingsData(): void {
  if (syncBox) renderSync(syncBox);
  if (healthBox) renderHealth(healthBox);
  if (trashBox) renderTrash(trashBox);
  if (cryptoBox) renderCrypto(cryptoBox);
}

// ---------- Synchro ----------

function renderSync(box: HTMLElement) {
  if (!app.dropbox) {
    mount(
      box,
      h('p', null, 'Ce coffre n’est enregistré que sur cet appareil. Connecte Dropbox pour le retrouver sur ton Mac, ton PC Windows et ton téléphone Android.'),
      dropboxConnectForm(),
    );
    return;
  }
  const status = {
    off: 'désactivée',
    idle: 'à jour',
    syncing: 'en cours…',
    pending: 'modifications en attente d’envoi',
    offline: 'hors ligne (reprise automatique)',
    error: app.syncMessage || 'erreur',
  }[app.syncStatus];
  const syncBtn = h('button', { class: 'btn', onclick: () => busy(syncBtn, 'Synchronisation…', () => app.syncNow()) }, icon('sync'), 'Synchroniser maintenant');
  mount(
    box,
    h(
      'dl',
      { class: 'kv' },
      h('dt', null, 'Service'),
      h('dd', null, 'Dropbox', app.dropboxAccount ? ` (${app.dropboxAccount})` : ''),
      h('dt', null, 'État'),
      h('dd', null, status),
      h('dt', null, 'Dernière synchro'),
      h('dd', null, fmtAgo(app.lastSync)),
      h('dt', null, 'Fichier'),
      h('dd', null, h('code', null, 'Applications/<ton app>/coffre.kdbx')),
    ),
    h('p', { class: 'hint' }, 'Synchro automatique à chaque modification, à l’ouverture et toutes les minutes. Une copie datée est aussi gardée chaque jour dans le dossier « sauvegardes » (30 jours), en plus de l’historique des versions de Dropbox.'),
    h(
      'div',
      { class: 'row-actions' },
      syncBtn,
      h(
        'button',
        {
          class: 'btn ghost danger-text',
          onclick: async () => {
            const ok = await dialog({
              title: 'Déconnecter Dropbox sur cet appareil ?',
              body: h('p', null, 'Ton coffre reste sur cet appareil et sur Dropbox, mais cet appareil ne sera plus synchronisé.'),
              confirm: 'Déconnecter',
              danger: true,
            });
            if (ok) {
              await app.disconnectDropbox();
              refreshSettingsData();
            }
          },
        },
        'Déconnecter',
      ),
    ),
  );
}

// ---------- Sécurité ----------

function securityControls(): HTMLElement {
  const sel = (label: string, options: [number, string][], value: number, onChange: (v: number) => void) =>
    h(
      'label',
      { class: 'field-inline' },
      h('span', null, label),
      h(
        'select',
        { class: 'input', onchange: (e: Event) => onChange(Number((e.target as HTMLSelectElement).value)) },
        ...options.map(([v, l]) => h('option', { value: String(v), selected: v === value }, l)),
      ),
    );
  return h(
    'div',
    { class: 'stack' },
    sel(
      'Verrouillage automatique après',
      [[1, '1 minute'], [2, '2 minutes'], [5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 heure']],
      app.settings.lockMinutes,
      (v) => app.saveSettings({ lockMinutes: v }),
    ),
    sel(
      'Effacer le presse-papiers après',
      [[15, '15 secondes'], [30, '30 secondes'], [60, '1 minute'], [120, '2 minutes'], [0, 'Jamais']],
      app.settings.clipboardSeconds,
      (v) => app.saveSettings({ clipboardSeconds: v }),
    ),
  );
}

function renderCrypto(box: HTMLElement) {
  const v = app.vault;
  if (!v) return;
  const strong = v.usesStrongKdf();
  mount(
    box,
    h('p', { class: 'hint' }, `Chiffrement : AES-256 · dérivation de clé ${v.kdfDescription()}.`),
    strong
      ? null
      : h(
          'div',
          { class: 'banner warn' },
          icon('alert'),
          h('span', null, 'Ce coffre (importé) utilise une protection du mot de passe ancienne. Renforce-la en un clic.'),
          h('button', { class: 'btn small', onclick: () => (app.mutate((x) => x.upgradeKdf()), toast('Chiffrement renforcé (Argon2id).', { kind: 'ok' })) }, 'Renforcer'),
        ),
  );
}

function changePasswordForm(): HTMLElement {
  const meter = strengthMeter();
  const cur = passwordField({ label: 'Mot de passe maître actuel', autocomplete: 'off' });
  const n1 = passwordField({ label: 'Nouveau mot de passe maître', autocomplete: 'new-password', onInput: (v) => meter.update(v) });
  const n2 = passwordField({ label: 'Confirmation', autocomplete: 'new-password' });
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Changer le mot de passe maître');
  const form = h(
    'form',
    {
      class: 'stack',
      autocomplete: 'off',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.textContent = '';
        const v = app.vault;
        if (!v) return;
        if (!(await v.checkPassword(cur.input.value))) return void (err.textContent = 'Le mot de passe actuel est incorrect.');
        const p = n1.input.value;
        if (p.length < 12 || meter.update(p) < 2) return void (err.textContent = 'Nouveau mot de passe trop faible (au moins « Correct »).');
        if (p !== n2.input.value) return void (err.textContent = 'Les deux nouveaux mots de passe diffèrent.');
        await busy(btn, 'Rechiffrement…', async () => {
          await v.changePassword(p);
          app.mutate(() => undefined);
          await app.persistNow();
        });
        cur.input.value = n1.input.value = n2.input.value = '';
        meter.update('');
        details.open = false;
        toast('Mot de passe maître changé. Tes autres appareils te demanderont le nouveau.', { kind: 'ok' });
      },
    },
    h('label', { class: 'label' }, 'Mot de passe actuel'),
    cur.el,
    h('label', { class: 'label' }, 'Nouveau mot de passe'),
    n1.el,
    meter.el,
    h('label', { class: 'label' }, 'Confirmation'),
    n2.el,
    err,
    btn,
  );
  const details = h('details', { class: 'sub' }, h('summary', null, 'Changer le mot de passe maître'), form);
  return details;
}

// ---------- Santé ----------

function renderHealth(box: HTMLElement) {
  const v = app.vault;
  if (!v) return;
  const all = v.allPasswords().filter((p) => p.password);
  const weak = all.filter((p) => estimateStrength(p.password).score < 2);
  const counts = new Map<string, number>();
  for (const p of all) counts.set(p.password, (counts.get(p.password) ?? 0) + 1);
  const reused = all.filter((p) => (counts.get(p.password) ?? 0) > 1);
  const item = (p: { id: string; title: string }) => h('li', null, h('button', { class: 'link-btn', onclick: () => openPane(p.id, 'edit') }, p.title || '(sans titre)'));
  if (!all.length) return mount(box, h('p', { class: 'muted' }, 'Aucun mot de passe enregistré pour l’instant.'));
  mount(
    box,
    h(
      'div',
      { class: 'health' },
      h('div', { class: 'stat' + (weak.length ? ' bad' : ' good') }, h('strong', null, String(weak.length)), h('span', null, 'faible(s)')),
      h('div', { class: 'stat' + (reused.length ? ' bad' : ' good') }, h('strong', null, String(reused.length)), h('span', null, 'réutilisé(s)')),
      h('div', { class: 'stat' }, h('strong', null, String(all.length)), h('span', null, 'au total')),
    ),
    weak.length ? h('details', { class: 'sub' }, h('summary', null, 'Mots de passe faibles — à remplacer'), h('ul', { class: 'plain' }, ...weak.map(item))) : null,
    reused.length ? h('details', { class: 'sub' }, h('summary', null, 'Mots de passe utilisés sur plusieurs sites'), h('ul', { class: 'plain' }, ...reused.map(item))) : null,
    !weak.length && !reused.length ? h('p', { class: 'muted' }, 'Tout est en ordre : aucun mot de passe faible ni réutilisé.') : null,
  );
}

// ---------- Import / export ----------

function importExport(): HTMLElement {
  const exportBtn = h('button', { class: 'btn' }, icon('download'), 'Exporter une sauvegarde (.kdbx)');
  exportBtn.addEventListener('click', () =>
    busy(exportBtn, 'Préparation…', async () => {
      const data = await app.exportFile();
      downloadFile(data, `coffre-${new Date().toISOString().slice(0, 10)}.kdbx`);
      toast('Sauvegarde exportée (chiffrée avec ton mot de passe maître).', { kind: 'ok' });
    }),
  );
  const importBtn = h('button', { class: 'btn' }, icon('upload'), 'Importer (CSV ou .kdbx)');
  importBtn.addEventListener('click', () => importFile(importBtn));
  return h(
    'div',
    { class: 'stack' },
    h('p', { class: 'hint' }, 'La sauvegarde exportée est chiffrée : garde-la sur une clé USB ou un disque externe. Elle s’ouvre aussi avec KeePassXC ou KeePassDX.'),
    h('div', { class: 'row-actions' }, exportBtn, importBtn),
    h('p', { class: 'hint' }, 'Import accepté : export CSV de Chrome, Edge, Firefox, Safari, Bitwarden ou 1Password, et coffres KeePass (.kdbx).'),
  );
}

async function importFile(btn: HTMLButtonElement) {
  const file = await pickFile('.csv,.kdbx,text/csv,application/octet-stream');
  if (!file) return;
  try {
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
      const entries = csvToEntries(await file.text());
      if (!entries.length) return toast('Aucune entrée trouvée dans ce fichier.', { kind: 'error' });
      const ok = await dialog({
        title: `Importer ${entries.length} entrée(s) ?`,
        body: h('p', null, 'Elles seront ajoutées à ton coffre et chiffrées. Pense ensuite à supprimer le fichier CSV : il contient tes mots de passe en clair.'),
        confirm: 'Importer',
      });
      if (!ok) return;
      app.mutate((v) => entries.forEach((e) => v.addEntry(e)));
      toast(`${entries.length} entrée(s) importée(s). Supprime maintenant le fichier CSV.`, { kind: 'ok' });
      return;
    }
    const data = await file.arrayBuffer();
    const pw = await dialog({
      title: 'Mot de passe de ce fichier KeePass',
      input: { type: 'password', autocomplete: 'off', label: 'Mot de passe du fichier' },
      confirm: 'Importer',
    });
    if (pw === null) return;
    const n = await busy(btn, 'Déchiffrement…', () => app.importKdbx(data, pw));
    toast(`${n} entrée(s) importée(s).`, { kind: 'ok' });
  } catch (e) {
    toast(e instanceof WrongPasswordError ? 'Mot de passe incorrect pour ce fichier.' : 'Import impossible : ' + errMsg(e), { kind: 'error' });
  }
}

// ---------- Corbeille ----------

function renderTrash(box: HTMLElement) {
  const v = app.vault;
  if (!v) return;
  const items = v.summaries(true);
  if (!items.length) return mount(box, h('p', { class: 'muted' }, 'La corbeille est vide.'));
  mount(
    box,
    h(
      'ul',
      { class: 'plain trash-list' },
      ...items.map((s) =>
        h(
          'li',
          null,
          h('span', { class: 'grow' }, s.title || '(sans titre)', h('span', { class: 'muted' }, ` · supprimé ${fmtDate(s.modified)}`)),
          h('button', { class: 'btn small ghost', onclick: () => (app.mutate((x) => x.restoreEntry(s.id)), toast('Entrée restaurée', { kind: 'ok' })) }, icon('restore', 16), 'Restaurer'),
        ),
      ),
    ),
    h(
      'button',
      {
        class: 'btn ghost danger-text',
        onclick: async () => {
          const ok = await dialog({
            title: 'Vider la corbeille ?',
            body: h('p', null, `${items.length} entrée(s) seront supprimées définitivement, sur tous tes appareils.`),
            confirm: 'Supprimer définitivement',
            danger: true,
          });
          if (ok) app.mutate((x) => x.emptyTrash());
        },
      },
      icon('trash'),
      'Vider la corbeille',
    ),
  );
}

// ---------- Appareil ----------

function deviceInfo(): HTMLElement {
  const persisted = h('dd', null, '…');
  void navigator.storage?.persisted?.().then((p) => (persisted.textContent = p ? 'oui (le navigateur ne l’effacera pas)' : 'non garanti — installe l’app pour plus de fiabilité'));
  return h(
    'div',
    { class: 'stack' },
    h('dl', { class: 'kv' }, h('dt', null, 'Stockage protégé'), persisted, h('dt', null, 'Copie locale'), h('dd', null, 'chiffrée, utilisable hors ligne')),
    h(
      'button',
      {
        class: 'btn ghost danger-text',
        onclick: async () => {
          const ok = await dialog({
            title: 'Effacer le coffre de cet appareil ?',
            body: h('p', null, 'Seule la copie de cet appareil est supprimée. Vérifie d’abord que la synchronisation est à jour ou exporte une sauvegarde. Tape EFFACER pour confirmer.'),
            mustType: 'EFFACER',
            confirm: 'Effacer cet appareil',
            danger: true,
          });
          if (ok) await app.resetDevice();
        },
      },
      'Effacer les données de cet appareil',
    ),
  );
}
