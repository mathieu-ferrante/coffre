// Écrans hors coffre : accueil, création, connexion Dropbox, déverrouillage.
import { h, icon, mount } from './dom.ts';
import { app, errMsg } from './app.ts';
import { WrongPasswordError } from './vault.ts';
import { generatePassphrase, DEFAULT_PASSPHRASE } from './generator.ts';
import { startDropboxAuth, redirectUri } from './dropbox.ts';
import { busy, dialog, passwordField, strengthMeter, toast, copyText, pickFile } from './widgets.ts';

export const lockState = {
  step: 'home' as 'home' | 'create' | 'dropbox',
  flash: '' as string,
  flashKind: 'info' as 'info' | 'error' | 'ok',
};

export function setFlash(msg: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
  lockState.flash = msg;
  lockState.flashKind = kind;
}

function flashEl(): HTMLElement | null {
  if (!lockState.flash) return null;
  const el = h('p', { class: `flash ${lockState.flashKind}`, role: 'status' }, lockState.flash);
  lockState.flash = '';
  return el;
}

export function logo(size = 56): HTMLElement {
  const el = h('div', { class: 'logo', 'aria-hidden': 'true' }, icon('lock', size * 0.5));
  el.style.width = el.style.height = `${size}px`;
  return el;
}

function screen(...children: (Node | null)[]): HTMLElement {
  return h('main', { class: 'center-screen' }, h('div', { class: 'card narrow' }, ...children));
}

// ---------- Accueil ----------

export function renderWelcome(root: HTMLElement, rerender: () => void): void {
  if (lockState.step === 'create') return renderCreate(root, rerender);
  if (lockState.step === 'dropbox') {
    return mount(
      root,
      screen(
        backLink(rerender),
        h('h1', null, 'Récupérer mon coffre'),
        h('p', { class: 'muted' }, 'Connecte le même compte Dropbox que sur ton autre appareil : le coffre chiffré sera téléchargé, puis tu le déverrouilleras avec ton mot de passe maître.'),
        flashEl(),
        dropboxConnectForm(),
      ),
    );
  }
  mount(
    root,
    screen(
      logo(),
      h('h1', { class: 'title' }, 'Coffre'),
      h('p', { class: 'muted center' }, 'Tes mots de passe, chiffrés sur tes appareils et synchronisés entre Mac, Windows et Android.'),
      flashEl(),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary block', onclick: () => ((lockState.step = 'create'), rerender()) }, icon('plus'), 'Créer mon coffre'),
        h('button', { class: 'btn block', onclick: () => ((lockState.step = 'dropbox'), rerender()) }, icon('sync'), 'J’ai déjà un coffre (Dropbox)'),
        h('button', { class: 'btn ghost block', onclick: () => openKdbxAsVault(rerender) }, icon('upload'), 'Ouvrir un fichier KeePass (.kdbx)'),
      ),
    ),
  );
}

function backLink(rerender: () => void): HTMLElement {
  return h('button', { class: 'link-btn', onclick: () => ((lockState.step = 'home'), rerender()) }, icon('back', 16), 'Retour');
}

async function openKdbxAsVault(rerender: () => void) {
  const file = await pickFile('.kdbx,application/octet-stream');
  if (!file) return;
  const data = await file.arrayBuffer();
  const sig = new DataView(data.slice(0, 8));
  if (data.byteLength < 8 || sig.getUint32(0, true) !== 0x9aa2d903) {
    toast('Ce fichier n’est pas un coffre KeePass (.kdbx).', { kind: 'error' });
    return;
  }
  await app.adoptFile(data, null);
  setFlash('Fichier chargé. Déverrouille-le avec son mot de passe maître.', 'ok');
  rerender();
}

// ---------- Création ----------

function renderCreate(root: HTMLElement, rerender: () => void): void {
  const meter = strengthMeter();
  const err = h('p', { class: 'error', role: 'alert' });
  const pw1 = passwordField({ label: 'Mot de passe maître', autocomplete: 'new-password', onInput: (v) => (meter.update(v), (err.textContent = '')) });
  const pw2 = passwordField({ label: 'Confirmation', autocomplete: 'new-password' });
  const noted = h('input', { type: 'checkbox', id: 'noted' });
  const suggestion = h('p', { class: 'hint' });

  const suggest = () => {
    const p = generatePassphrase(DEFAULT_PASSPHRASE);
    pw1.input.value = p;
    pw2.input.value = p;
    pw1.setVisible(true);
    pw2.setVisible(true);
    meter.update(p);
    err.textContent = '';
    suggestion.textContent = 'Recopie cette phrase sur papier et range-la en lieu sûr. Elle est facile à taper, même sur téléphone.';
  };

  const submit = h('button', { class: 'btn primary block', type: 'submit' }, icon('lock'), 'Créer mon coffre');
  const form = h(
    'form',
    {
      class: 'stack',
      autocomplete: 'off',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.textContent = '';
        const p = pw1.input.value;
        const score = meter.update(p);
        if (p.length < 12 || score < 2) return void (err.textContent = 'Mot de passe trop faible : au moins 12 caractères et un niveau « Correct ». Une phrase de passe de 5–6 mots est idéale.');
        if (p !== pw2.input.value) return void (err.textContent = 'Les deux mots de passe ne sont pas identiques.');
        if (!noted.checked) return void (err.textContent = 'Coche la case pour confirmer que tu as noté ton mot de passe maître.');
        try {
          await busy(submit, 'Chiffrement…', () => app.createVault(p));
          lockState.step = 'home';
          rerender();
          toast('Coffre créé. Connecte Dropbox dans Réglages pour synchroniser tes appareils.', { kind: 'ok' });
        } catch (e2) {
          err.textContent = errMsg(e2);
        }
      },
    },
    h('label', { class: 'label' }, 'Mot de passe maître'),
    pw1.el,
    meter.el,
    h('button', { class: 'link-btn', type: 'button', onclick: suggest }, icon('dice', 16), 'Me proposer une phrase de passe'),
    suggestion,
    h('label', { class: 'label' }, 'Confirmation'),
    pw2.el,
    h('label', { class: 'check' }, noted, h('span', null, 'J’ai noté mon mot de passe maître en lieu sûr. Je sais que personne ne pourra le récupérer si je l’oublie.')),
    err,
    submit,
  );

  mount(
    root,
    screen(
      backLink(rerender),
      h('h1', null, 'Créer mon coffre'),
      h('p', { class: 'muted' }, 'Ce mot de passe maître chiffre tout ton coffre. Il n’est jamais envoyé ni enregistré nulle part : c’est le seul que tu auras à retenir.'),
      form,
    ),
  );
  pw1.input.focus();
}

// ---------- Connexion Dropbox ----------

export function dropboxConnectForm(): HTMLElement {
  const key = h('input', {
    class: 'input mono',
    value: app.dropboxAppKey || __DROPBOX_APP_KEY__,
    placeholder: 'ex. a1b2c3d4e5f6g7h',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    'aria-label': 'Clé d’app Dropbox (App key)',
  });
  const err = h('p', { class: 'error', role: 'alert' });
  const go = h('button', { class: 'btn primary block', type: 'submit' }, icon('sync'), 'Se connecter à Dropbox');
  const uri = redirectUri();
  const steps = h(
    'details',
    { class: 'help', open: !(app.dropboxAppKey || __DROPBOX_APP_KEY__) },
    h('summary', null, 'Comment obtenir la clé (une seule fois, 5 min)'),
    h(
      'ol',
      null,
      h('li', null, 'Ouvre ', h('a', { href: 'https://www.dropbox.com/developers/apps/create', target: '_blank', rel: 'noopener noreferrer' }, 'dropbox.com/developers/apps'), ' et clique « Create app ».'),
      h('li', null, 'Choisis « Scoped access », puis « App folder ». Donne un nom unique (ex. coffre-perso-1234).'),
      h('li', null, 'Onglet « Permissions » : coche files.metadata.read, files.content.read et files.content.write, puis « Submit ».'),
      h('li', null, 'Onglet « Settings », section « OAuth 2 » : dans « Redirect URIs », ajoute exactement : ',
        h('code', { class: 'select-all' }, uri), ' ',
        h('button', { class: 'link-btn', type: 'button', onclick: () => copyText(uri, 'Adresse') }, 'copier'),
        '. Laisse « Allow public clients (PKCE) » sur « Allow ».'),
      h('li', null, 'Copie l’« App key » (pas le secret) et colle-la ci-dessous.'),
    ),
    h('p', { class: 'hint' }, 'Le coffre est envoyé déjà chiffré dans un dossier réservé à l’app (Applications/<nom>). Dropbox ne voit jamais tes mots de passe.'),
  );
  return h(
    'form',
    {
      class: 'stack',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const k = key.value.trim();
        if (!/^[a-z0-9]{10,20}$/i.test(k)) return void (err.textContent = 'Cette clé ne ressemble pas à une « App key » Dropbox (10 à 20 lettres et chiffres).');
        if (app.vault) await app.persistNow();
        await busy(go, 'Redirection vers Dropbox…', () => startDropboxAuth(k));
      },
    },
    steps,
    h('label', { class: 'label' }, 'Clé d’app Dropbox (App key)'),
    key,
    err,
    go,
  );
}

// ---------- Déverrouillage ----------

export function renderUnlock(root: HTMLElement, rerender: () => void): void {
  const err = h('p', { class: 'error', role: 'alert' });
  const pw = passwordField({ label: 'Mot de passe maître', autocomplete: 'off', placeholder: 'Mot de passe maître' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, icon('unlock'), 'Déverrouiller');
  const card = h('div', { class: 'card narrow' });
  const form = h(
    'form',
    {
      class: 'stack',
      autocomplete: 'off',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        err.textContent = '';
        if (!pw.input.value) return;
        try {
          await busy(btn, 'Déchiffrement…', () => app.unlock(pw.input.value));
          rerender();
        } catch (e2) {
          if (e2 instanceof WrongPasswordError) {
            err.textContent = 'Mot de passe incorrect.';
            card.classList.remove('shake');
            void card.offsetWidth;
            card.classList.add('shake');
          } else err.textContent = 'Ouverture impossible : ' + errMsg(e2);
          pw.input.select();
        }
      },
    },
    pw.el,
    err,
    btn,
  );
  mount(
    card,
    logo(),
    h('h1', { class: 'title' }, 'Coffre verrouillé'),
    flashEl(),
    form,
    h('button', { class: 'link-btn subtle', onclick: () => resetDevice(rerender) }, 'Ce n’est pas mon coffre / réinitialiser cet appareil…'),
  );
  mount(root, h('main', { class: 'center-screen' }, card));
  pw.input.focus();
}

async function resetDevice(rerender: () => void) {
  const ok = await dialog({
    title: 'Effacer le coffre de cet appareil ?',
    body: h('p', null, 'La copie locale et la connexion Dropbox de cet appareil seront supprimées. Le coffre sur Dropbox et sur tes autres appareils n’est pas touché. Tape EFFACER pour confirmer.'),
    mustType: 'EFFACER',
    confirm: 'Effacer cet appareil',
    danger: true,
  });
  if (!ok) return;
  await app.resetDevice();
  lockState.step = 'home';
  rerender();
}
