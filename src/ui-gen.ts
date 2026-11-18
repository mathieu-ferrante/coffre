// Onglet Générateur.
import { h, icon, mount } from './dom.ts';
import {
  generatePassword,
  generatePassphrase,
  passwordEntropy,
  passphraseEntropy,
  strengthFromBits,
  DEFAULT_PASSWORD,
  DEFAULT_PASSPHRASE,
  type PasswordOptions,
  type PassphraseOptions,
} from './generator.ts';
import { kvGet, kvSet } from './storage.ts';
import { copyText } from './widgets.ts';

interface GenPrefs {
  mode: 'password' | 'passphrase';
  password: PasswordOptions;
  passphrase: PassphraseOptions;
}

let prefs: GenPrefs = { mode: 'password', password: { ...DEFAULT_PASSWORD }, passphrase: { ...DEFAULT_PASSPHRASE } };

export async function loadGenPrefs(): Promise<void> {
  const saved = await kvGet<Partial<GenPrefs>>('generator');
  if (saved) {
    prefs = {
      mode: saved.mode === 'passphrase' ? 'passphrase' : 'password',
      password: { ...DEFAULT_PASSWORD, ...saved.password },
      passphrase: { ...DEFAULT_PASSPHRASE, ...saved.passphrase },
    };
  }
}

export function genPrefs(): GenPrefs {
  return prefs;
}

function savePrefs() {
  void kvSet('generator', prefs);
}

function colorize(pw: string): HTMLElement {
  const out = h('span', { class: 'gen-text mono' });
  for (const c of pw) {
    const cls = /[0-9]/.test(c) ? 'd' : /[a-zA-Z]/.test(c) ? '' : 's';
    out.appendChild(cls ? h('span', { class: cls }, c) : document.createTextNode(c));
  }
  return out;
}

function bitsLabel(bits: number): string {
  return strengthFromBits(bits).label;
}

export function renderGenerator(): HTMLElement {
  const output = h('div', { class: 'gen-output', 'aria-live': 'polite' });
  const info = h('p', { class: 'gen-info muted' });
  const options = h('div', { class: 'gen-options' });
  let current = '';

  const regenerate = () => {
    try {
      if (prefs.mode === 'password') {
        current = generatePassword(prefs.password);
        info.textContent = `${current.length} caractères · ~${passwordEntropy(prefs.password)} bits · ${bitsLabel(passwordEntropy(prefs.password))}`;
      } else {
        current = generatePassphrase(prefs.passphrase);
        const b = passphraseEntropy(prefs.passphrase);
        info.textContent = `${prefs.passphrase.words} mots · ~${b} bits · ${bitsLabel(b)} · facile à retenir et à taper`;
      }
      mount(output, colorize(current));
    } catch (e) {
      current = '';
      mount(output, h('span', { class: 'error' }, e instanceof Error ? e.message : String(e)));
      info.textContent = '';
    }
  };

  const check = (label: string, get: () => boolean, set: (v: boolean) => void) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: get(),
        onchange: (e: Event) => {
          set((e.target as HTMLInputElement).checked);
          savePrefs();
          regenerate();
        },
      }),
      h('span', null, label),
    );

  const slider = (label: string, min: number, max: number, get: () => number, set: (v: number) => void) => {
    const val = h('output', { class: 'slider-val' }, String(get()));
    return h(
      'label',
      { class: 'slider' },
      h('span', { class: 'slider-label' }, label, val),
      h('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        value: String(get()),
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          set(v);
          val.textContent = String(v);
          regenerate();
        },
        onchange: savePrefs,
      }),
    );
  };

  const renderOptions = () => {
    if (prefs.mode === 'password') {
      const p = prefs.password;
      mount(
        options,
        slider('Longueur', 8, 64, () => p.length, (v) => (p.length = v)),
        h(
          'div',
          { class: 'checks' },
          check('Minuscules (a-z)', () => p.lower, (v) => (p.lower = v)),
          check('Majuscules (A-Z)', () => p.upper, (v) => (p.upper = v)),
          check('Chiffres (0-9)', () => p.digits, (v) => (p.digits = v)),
          check('Symboles (!#$…)', () => p.symbols, (v) => (p.symbols = v)),
          check('Éviter les caractères ambigus (l, 1, O, 0…)', () => p.avoidAmbiguous, (v) => (p.avoidAmbiguous = v)),
        ),
      );
    } else {
      const p = prefs.passphrase;
      const sep = h(
        'select',
        {
          class: 'input',
          'aria-label': 'Séparateur',
          onchange: (e: Event) => {
            p.separator = (e.target as HTMLSelectElement).value;
            savePrefs();
            regenerate();
          },
        },
        ...[
          ['-', 'Tiret (-)'],
          ['.', 'Point (.)'],
          ['_', 'Souligné (_)'],
          [' ', 'Espace'],
        ].map(([v, l]) => h('option', { value: v, selected: p.separator === v }, l)),
      );
      mount(
        options,
        slider('Nombre de mots', 3, 10, () => p.words, (v) => (p.words = v)),
        h('label', { class: 'field-inline' }, h('span', null, 'Séparateur'), sep),
        h(
          'div',
          { class: 'checks' },
          check('Majuscule à chaque mot', () => p.capitalize, (v) => (p.capitalize = v)),
          check('Ajouter un chiffre', () => p.addNumber, (v) => (p.addNumber = v)),
        ),
      );
    }
  };

  const modeBtn = (mode: GenPrefs['mode'], label: string) =>
    h(
      'button',
      {
        class: 'seg-btn',
        'aria-pressed': String(prefs.mode === mode),
        onclick: (e: Event) => {
          prefs.mode = mode;
          savePrefs();
          for (const b of (e.currentTarget as HTMLElement).parentElement!.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
          renderOptions();
          regenerate();
        },
      },
      label,
    );

  renderOptions();
  regenerate();

  return h(
    'div',
    { class: 'page narrow-page' },
    h('h1', { class: 'page-title' }, 'Générateur'),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Type' }, modeBtn('password', 'Mot de passe'), modeBtn('passphrase', 'Phrase de passe')),
    h(
      'div',
      { class: 'card gen-card' },
      output,
      h(
        'div',
        { class: 'gen-actions' },
        h('button', { class: 'btn', onclick: regenerate }, icon('sync'), 'Nouveau'),
        h('button', { class: 'btn primary', onclick: () => current && copyText(current, 'Mot de passe') }, icon('copy'), 'Copier'),
      ),
      info,
    ),
    h('div', { class: 'card' }, options),
    h('p', { class: 'hint' }, 'Aléa cryptographique du système, sans biais. Rien n’est enregistré tant que tu ne l’ajoutes pas à une entrée.'),
  );
}
