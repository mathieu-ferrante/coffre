// Écran principal (coffre ouvert) : barre du haut, onglets, liste, fiche, édition, historique.
import { h, icon, mount, clear } from './dom.ts';
import { app, errMsg } from './app.ts';
import type { EntryInput } from './vault.ts';
import { parseOtp, currentTotp } from './totp.ts';
import { generatePassword } from './generator.ts';
import { avatar, copyBtn, copyText, dialog, fmtAgo, fmtDate, normalize, passwordField, safeHref, strengthMeter, toast } from './widgets.ts';
import { renderGenerator, genPrefs } from './ui-gen.ts';
import { renderSettings, refreshSettingsData, refreshSyncStatus } from './ui-settings.ts';

type Tab = 'list' | 'gen' | 'settings';
type Pane = 'view' | 'edit' | 'new' | 'history';

export const view = {
  tab: 'list' as Tab,
  query: '',
  selected: null as string | null,
  pane: 'view' as Pane,
};

let shell: HTMLElement;
let content: HTMLElement;
let syncPill: HTMLElement;
let banner: HTMLElement;
let listEl: HTMLElement | null = null;
let detailEl: HTMLElement | null = null;
let detailTimer: ReturnType<typeof setInterval> | null = null;

export function resetView(): void {
  view.tab = 'list';
  view.query = '';
  view.selected = null;
  view.pane = 'view';
  stopDetailTimer();
}

function stopDetailTimer() {
  if (detailTimer) clearInterval(detailTimer);
  detailTimer = null;
}

// ---------- Coquille ----------

export function renderMain(root: HTMLElement): void {
  syncPill = h('button', { class: 'sync-pill', onclick: () => app.syncNow() });
  banner = h('div', { class: 'banner-host' });
  content = h('div', { class: 'content' });
  const tabs = h(
    'nav',
    { class: 'tabs', 'aria-label': 'Sections' },
    tabBtn('list', 'key', 'Mots de passe'),
    tabBtn('gen', 'dice', 'Générateur'),
    tabBtn('settings', 'settings', 'Réglages'),
  );
  shell = h(
    'div',
    { class: 'shell' },
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('lock', 16)), 'Coffre'),
      h('div', { class: 'topbar-actions' }, syncPill, h('button', { class: 'icon-btn', title: 'Verrouiller', 'aria-label': 'Verrouiller', onclick: () => app.lock() }, icon('lock'))),
    ),
    tabs,
    banner,
    content,
  );
  mount(root, shell);
  updateStatus();
  renderTab();
}

function tabBtn(tab: Tab, ic: string, label: string): HTMLElement {
  return h(
    'button',
    {
      class: 'tab',
      dataset: { tab },
      'aria-current': view.tab === tab ? 'page' : null,
      onclick: () => switchTab(tab),
    },
    icon(ic),
    h('span', null, label),
  );
}

export function switchTab(tab: Tab): void {
  view.tab = tab;
  for (const b of shell.querySelectorAll<HTMLElement>('.tab')) {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  renderTab();
}

function renderTab() {
  stopDetailTimer();
  listEl = null;
  detailEl = null;
  content.className = `content tab-${view.tab}`;
  if (view.tab === 'gen') return mount(content, renderGenerator());
  if (view.tab === 'settings') return mount(content, renderSettings());
  listEl = h('ul', { class: 'entries', role: 'list' });
  detailEl = h('section', { class: 'detail-pane', 'aria-live': 'polite' });
  const search = h('input', {
    class: 'input search',
    type: 'search',
    placeholder: 'Rechercher',
    value: view.query,
    autocomplete: 'off',
    spellcheck: false,
    'aria-label': 'Rechercher',
    oninput: (e: Event) => {
      view.query = (e.target as HTMLInputElement).value;
      renderList();
    },
  });
  mount(
    content,
    h(
      'div',
      { class: 'split' },
      h(
        'section',
        { class: 'list-pane' },
        h(
          'div',
          { class: 'list-tools' },
          h('label', { class: 'search-wrap' }, icon('search', 18), search),
          h('button', { class: 'btn primary add-btn', 'aria-label': 'Ajouter une entrée', title: 'Ajouter', onclick: () => openPane(null, 'new') }, icon('plus'), h('span', { class: 'hide-sm' }, 'Ajouter')),
        ),
        listEl,
      ),
      detailEl,
    ),
  );
  renderList();
  renderDetail();
}

/** Appelé quand les données changent (modification locale ou synchro). */
export function onDataChanged(): void {
  updateStatus();
  if (view.tab === 'settings') return refreshSettingsData();
  if (view.tab !== 'list') return;
  if (view.selected && !app.vault!.summaries().some((s) => s.id === view.selected) && !app.vault!.summaries(true).some((s) => s.id === view.selected)) {
    view.selected = null;
    view.pane = 'view';
  }
  renderList();
  if (view.pane === 'view' || view.pane === 'history') renderDetail();
}

export function updateStatus(): void {
  if (!syncPill) return;
  const s = app.syncStatus;
  const map = {
    off: ['cloudOff', 'Local', 'Synchronisation désactivée — connecte Dropbox dans Réglages'],
    idle: ['check', 'Synchronisé', `Dernière synchro : ${fmtAgo(app.lastSync)}`],
    syncing: ['sync', 'Synchro…', 'Synchronisation en cours'],
    pending: ['sync', 'En attente', 'Modifications à envoyer'],
    offline: ['cloudOff', 'Hors ligne', app.syncMessage],
    error: ['alert', 'Erreur', app.syncMessage],
  } as const;
  const [ic, label, title] = map[s];
  syncPill.className = `sync-pill ${s}`;
  syncPill.title = title + (s === 'off' ? '' : ' — cliquer pour synchroniser');
  syncPill.setAttribute('aria-label', `${label}. ${title}`);
  mount(syncPill, icon(ic, 16), h('span', { class: 'hide-xs' }, label));
  if (view.tab === 'settings') refreshSyncStatus();

  if (!banner) return;
  clear(banner);
  if (app.needsRemotePassword) {
    banner.appendChild(
      h(
        'div',
        { class: 'banner warn' },
        icon('alert'),
        h('span', null, 'Le coffre sur Dropbox utilise un autre mot de passe maître (changé sur un autre appareil ?). Saisis-le pour reprendre la synchronisation.'),
        h('button', { class: 'btn small', onclick: askRemotePassword }, 'Saisir'),
      ),
    );
  } else if (s === 'error' && app.syncMessage) {
    banner.appendChild(h('div', { class: 'banner error' }, icon('alert'), h('span', null, app.syncMessage), h('button', { class: 'btn small', onclick: () => app.syncNow() }, 'Réessayer')));
  }
}

async function askRemotePassword() {
  const pw = await dialog({
    title: 'Mot de passe du coffre Dropbox',
    body: h('p', null, 'Saisis le mot de passe maître actuel (celui défini sur ton autre appareil). Il remplacera l’ancien sur cet appareil.'),
    input: { type: 'password', autocomplete: 'off', label: 'Mot de passe maître actuel' },
    confirm: 'Valider',
  });
  if (!pw) return;
  try {
    if (await app.adoptRemotePassword(pw)) toast('Mot de passe mis à jour, synchronisation reprise.', { kind: 'ok' });
    else toast('Ce mot de passe n’ouvre pas le coffre Dropbox.', { kind: 'error' });
  } catch (e) {
    toast(errMsg(e), { kind: 'error' });
  }
}

// ---------- Liste ----------

function renderList() {
  if (!listEl || !app.vault) return;
  const all = app.vault.summaries();
  const q = normalize(view.query.trim());
  const items = q ? all.filter((s) => normalize(`${s.title} ${s.username} ${s.url} ${s.group}`).includes(q)) : all;
  clear(listEl);
  if (!all.length) {
    listEl.appendChild(
      h('li', { class: 'empty' },
        h('p', null, h('strong', null, 'Ton coffre est vide.')),
        h('p', { class: 'muted' }, 'Ajoute ton premier mot de passe avec « + », ou importe ceux de ton navigateur dans Réglages → Importer.')),
    );
    return;
  }
  if (!items.length) {
    listEl.appendChild(h('li', { class: 'empty muted' }, 'Aucun résultat.'));
    return;
  }
  for (const s of items) {
    listEl.appendChild(
      h(
        'li',
        null,
        h(
          'button',
          {
            class: 'entry' + (s.id === view.selected ? ' selected' : ''),
            onclick: () => openPane(s.id, 'view'),
          },
          avatar(s.title || s.url),
          h('span', { class: 'entry-text' }, h('span', { class: 'entry-title' }, s.title || '(sans titre)'), h('span', { class: 'entry-sub' }, s.username || s.url || s.group || '')),
          s.hasOtp ? h('span', { class: 'badge', title: 'Code 2FA' }, '2FA') : null,
        ),
      ),
    );
  }
}

export function openPane(id: string | null, pane: Pane): void {
  if (view.tab !== 'list') switchTab('list');
  view.selected = id;
  view.pane = pane;
  renderList();
  renderDetail();
}

function closePane() {
  view.selected = null;
  view.pane = 'view';
  renderList();
  renderDetail();
}

// ---------- Fiche ----------

function renderDetail() {
  if (!detailEl || !app.vault) return;
  stopDetailTimer();
  const open = view.pane === 'new' || !!view.selected;
  shell.classList.toggle('detail-open', open);
  if (!open) {
    mount(detailEl, h('div', { class: 'placeholder muted' }, icon('key', 40), h('p', null, 'Sélectionne une entrée ou ajoutes-en une.')));
    return;
  }
  if (view.pane === 'new') return mount(detailEl, editForm(null));
  const id = view.selected!;
  if (view.pane === 'edit') return mount(detailEl, editForm(id));
  if (view.pane === 'history') return mount(detailEl, historyView(id));
  mount(detailEl, entryView(id));
}

function paneHeader(title: string, actions: (Node | null)[] = [], onBack = closePane): HTMLElement {
  return h(
    'div',
    { class: 'pane-header' },
    h('button', { class: 'icon-btn back', 'aria-label': 'Retour', onclick: onBack }, icon('back')),
    h('h2', { class: 'pane-title' }, title),
    h('div', { class: 'pane-actions' }, ...actions),
  );
}

function fieldRow(label: string, value: Node | string, actions: (Node | null)[]): HTMLElement {
  return h('div', { class: 'field' }, h('div', { class: 'field-label' }, label), h('div', { class: 'field-main' }, h('div', { class: 'field-value' }, value), h('div', { class: 'field-actions' }, ...actions)));
}

function entryView(id: string): HTMLElement {
  const e = app.vault!.read(id);
  const hist = app.vault!.history(id);
  const rows: HTMLElement[] = [];

  if (e.username) rows.push(fieldRow('Identifiant', e.username, [copyBtn(() => app.vault!.read(id).username, 'Identifiant')]));

  const pwText = h('span', { class: 'mono secret' }, e.password ? '•'.repeat(Math.min(16, Math.max(8, e.password.length))) : '—');
  let shown = false;
  const eye = h('button', { class: 'icon-btn', 'aria-label': 'Afficher le mot de passe', title: 'Afficher / masquer' }, icon('eye'));
  eye.addEventListener('click', () => {
    shown = !shown;
    pwText.textContent = shown ? e.password : '•'.repeat(Math.min(16, Math.max(8, e.password.length)));
    pwText.classList.toggle('revealed', shown);
    mount(eye, icon(shown ? 'eyeOff' : 'eye'));
  });
  if (e.password) rows.push(fieldRow('Mot de passe', pwText, [eye, copyBtn(() => app.vault!.read(id).password, 'Mot de passe')]));

  const otpCfg = parseOtp(e.otp);
  if (otpCfg) {
    const code = h('span', { class: 'mono otp-code' }, '··· ···');
    const ring = h('span', { class: 'otp-ring' });
    let current = '';
    const tick = async () => {
      const { code: c, remaining } = await currentTotp(otpCfg);
      current = c;
      code.textContent = c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
      ring.textContent = String(remaining);
      ring.classList.toggle('low', remaining <= 5);
    };
    void tick();
    detailTimer = setInterval(tick, 1000);
    rows.push(fieldRow('Code 2FA', h('span', { class: 'otp' }, code, ring), [copyBtn(() => current, 'Code')]));
  } else if (e.otp) {
    rows.push(fieldRow('Code 2FA', h('span', { class: 'muted' }, 'Clé 2FA illisible'), []));
  }

  if (e.url) {
    const href = safeHref(e.url);
    rows.push(
      fieldRow('Site web', href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'url' }, e.url) : e.url, [
        href ? h('a', { class: 'icon-btn', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Ouvrir le site', title: 'Ouvrir le site' }, icon('external')) : null,
        copyBtn(() => app.vault!.read(id).url, 'Adresse'),
      ]),
    );
  }
  if (e.notes) rows.push(h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Notes'), h('div', { class: 'notes' }, e.notes)));

  const actions: HTMLElement[] = e.inTrash
    ? [
        h('button', { class: 'btn', onclick: () => (app.mutate((v) => v.restoreEntry(id)), toast('Entrée restaurée', { kind: 'ok' })) }, icon('restore'), 'Restaurer'),
      ]
    : [
        h('button', { class: 'btn', onclick: () => openPane(id, 'edit') }, icon('edit'), 'Modifier'),
        hist.length ? h('button', { class: 'btn ghost', onclick: () => openPane(id, 'history') }, icon('clock'), `Historique (${hist.length})`) : null,
        h('button', { class: 'btn ghost danger-text', onclick: () => trash(id, e.title) }, icon('trash'), 'Supprimer'),
      ].filter((x): x is HTMLButtonElement => !!x);

  return h(
    'div',
    { class: 'pane' },
    paneHeader('', [!e.inTrash ? h('button', { class: 'icon-btn', 'aria-label': 'Modifier', title: 'Modifier', onclick: () => openPane(id, 'edit') }, icon('edit')) : null]),
    h('div', { class: 'entry-hero' }, avatar(e.title || e.url), h('div', null, h('h2', { class: 'hero-title' }, e.title || '(sans titre)'), e.inTrash ? h('span', { class: 'badge warn' }, 'Dans la corbeille') : null)),
    h('div', { class: 'fields' }, ...rows),
    h('div', { class: 'pane-footer' }, h('div', { class: 'row-actions' }, ...actions), h('p', { class: 'meta muted' }, `Modifié le ${fmtDate(e.modified)} · créé le ${fmtDate(e.created)}`)),
  );
}

function trash(id: string, title: string) {
  app.mutate((v) => v.trashEntry(id));
  closePane();
  toast(`« ${title || 'Entrée'} » mise à la corbeille`, { action: { label: 'Annuler', run: () => app.mutate((v) => v.restoreEntry(id)) } });
}

// ---------- Édition ----------

function editForm(id: string | null): HTMLElement {
  const cur: EntryInput = id ? app.vault!.read(id) : { title: '', username: '', password: '', url: '', notes: '', otp: '' };
  const meter = strengthMeter();
  const title = h('input', { class: 'input', value: cur.title, placeholder: 'ex. Banque, Gmail, Netflix', autocomplete: 'off', 'aria-label': 'Titre' });
  const username = h('input', { class: 'input', value: cur.username, placeholder: 'e-mail ou identifiant', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Identifiant' });
  const gen = h('button', { class: 'icon-btn', type: 'button', title: 'Générer un mot de passe', 'aria-label': 'Générer un mot de passe' }, icon('dice'));
  const pw = passwordField({ label: 'Mot de passe', value: cur.password, autocomplete: 'new-password', onInput: (v) => meter.update(v), extra: gen });
  gen.addEventListener('click', () => {
    const p = generatePassword(genPrefs().password);
    pw.input.value = p;
    pw.setVisible(true);
    meter.update(p);
  });
  meter.update(cur.password);
  const url = h('input', { class: 'input', value: cur.url, type: 'url', inputmode: 'url', placeholder: 'https://…', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Site web' });
  const otp = h('input', { class: 'input mono', value: cur.otp, placeholder: 'Clé secrète ou lien otpauth:// (facultatif)', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, 'aria-label': 'Clé 2FA' });
  const notes = h('textarea', { class: 'input', rows: 4, placeholder: 'Questions secrètes, codes de secours…', 'aria-label': 'Notes' });
  notes.value = cur.notes;
  const err = h('p', { class: 'error', role: 'alert' });

  const save = () => {
    err.textContent = '';
    const input: EntryInput = {
      title: title.value.trim(),
      username: username.value,
      password: pw.input.value,
      url: url.value.trim(),
      notes: notes.value,
      otp: otp.value.trim(),
    };
    if (!input.title && input.url) {
      try {
        input.title = new URL(safeHref(input.url) ?? input.url).hostname.replace(/^www\./, '');
      } catch {
        /* ignore */
      }
    }
    if (!input.title) return void (err.textContent = 'Donne un titre à cette entrée.');
    if (input.otp && !parseOtp(input.otp)) return void (err.textContent = 'La clé 2FA n’est pas valide (clé base32 ou lien otpauth://totp/…).');
    try {
      if (id) {
        app.mutate((v) => v.updateEntry(id, input));
        openPane(id, 'view');
      } else {
        const newId = app.mutate((v) => v.addEntry(input));
        openPane(newId, 'view');
      }
      toast('Enregistré', { kind: 'ok' });
    } catch (e) {
      err.textContent = errMsg(e);
    }
  };

  const cancel = () => (id ? openPane(id, 'view') : closePane());
  const el = h(
    'div',
    { class: 'pane' },
    paneHeader(id ? 'Modifier' : 'Nouvelle entrée', [], cancel),
    h(
      'div',
      {
        class: 'form stack',
        onkeydown: (e: KeyboardEvent) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
          if (e.key === 'Escape') cancel();
        },
      },
      h('label', { class: 'label' }, 'Titre'),
      title,
      h('label', { class: 'label' }, 'Identifiant'),
      username,
      h('label', { class: 'label' }, 'Mot de passe'),
      pw.el,
      meter.el,
      h('label', { class: 'label' }, 'Site web'),
      url,
      h('label', { class: 'label' }, 'Code 2FA ', h('span', { class: 'muted' }, '(facultatif)')),
      otp,
      h('label', { class: 'label' }, 'Notes'),
      notes,
      err,
      h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: save }, icon('check'), 'Enregistrer'), h('button', { class: 'btn ghost', onclick: cancel }, 'Annuler')),
    ),
  );
  setTimeout(() => (id ? pw.input : title).focus(), 0);
  return el;
}

// ---------- Historique ----------

function historyView(id: string): HTMLElement {
  const e = app.vault!.read(id);
  const items = app.vault!.history(id);
  return h(
    'div',
    { class: 'pane' },
    paneHeader(`Historique — ${e.title}`, [], () => openPane(id, 'view')),
    h('p', { class: 'muted' }, 'Les versions précédentes sont conservées (20 maximum), y compris celles remplacées lors d’une synchronisation.'),
    h(
      'ul',
      { class: 'history' },
      ...items.map((it) => {
        const pwSpan = h('span', { class: 'mono secret' }, '••••••••••');
        let shown = false;
        return h(
          'li',
          null,
          h('div', { class: 'history-date' }, fmtDate(it.modified)),
          it.username !== e.username ? h('div', { class: 'muted' }, 'Identifiant : ', it.username || '—') : null,
          h(
            'div',
            { class: 'field-main' },
            pwSpan,
            h(
              'div',
              { class: 'field-actions' },
              h('button', { class: 'icon-btn', 'aria-label': 'Afficher', onclick: () => ((shown = !shown), (pwSpan.textContent = shown ? it.password || '—' : '••••••••••')) }, icon('eye')),
              h('button', { class: 'icon-btn', 'aria-label': 'Copier', onclick: () => copyText(it.password, 'Ancien mot de passe') }, icon('copy')),
              h(
                'button',
                {
                  class: 'btn small ghost',
                  onclick: () => {
                    const curr = app.vault!.read(id);
                    app.mutate((v) => v.updateEntry(id, { ...curr, username: it.username, password: it.password, url: it.url }));
                    openPane(id, 'view');
                    toast('Version restaurée', { kind: 'ok' });
                  },
                },
                'Restaurer',
              ),
            ),
          ),
        );
      }),
    ),
  );
}
