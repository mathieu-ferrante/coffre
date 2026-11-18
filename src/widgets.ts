// Composants d'interface réutilisables : notifications, boîtes de dialogue, champs mot de passe, presse-papiers.
import { h, icon, mount, type Child } from './dom.ts';
import { estimateStrength } from './generator.ts';
import { app } from './app.ts';

// ---------- Notifications ----------

export function toast(message: string, opts: { kind?: 'info' | 'error' | 'ok'; action?: { label: string; run: () => void } } = {}): void {
  const host = document.getElementById('toasts')!;
  const el = h(
    'div',
    { class: `toast ${opts.kind ?? 'info'}`, role: opts.kind === 'error' ? 'alert' : 'status' },
    h('span', null, message),
    opts.action &&
      h(
        'button',
        {
          class: 'toast-action',
          onclick: () => {
            opts.action!.run();
            el.remove();
          },
        },
        opts.action.label,
      ),
  );
  host.appendChild(el);
  const life = opts.action ? 6000 : opts.kind === 'error' ? 5000 : 2600;
  setTimeout(() => el.classList.add('out'), life);
  setTimeout(() => el.remove(), life + 400);
}

// ---------- Boîtes de dialogue ----------

export interface DialogOptions {
  title: string;
  body?: Child;
  input?: { type?: string; placeholder?: string; autocomplete?: string; label?: string };
  confirm: string;
  cancel?: string;
  danger?: boolean;
  /** Valeur à saisir exactement pour activer le bouton (confirmation forte). */
  mustType?: string;
}

export function dialog(opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const input = opts.input || opts.mustType
      ? h('input', {
          class: 'input',
          type: opts.input?.type ?? 'text',
          placeholder: opts.input?.placeholder ?? (opts.mustType ? opts.mustType : ''),
          autocomplete: opts.input?.autocomplete ?? 'off',
          'aria-label': opts.input?.label ?? opts.title,
          spellcheck: false,
        })
      : null;
    const ok = h('button', { class: `btn ${opts.danger ? 'danger' : 'primary'}`, type: 'submit' }, opts.confirm);
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, opts.cancel ?? 'Annuler');
    const form = h(
      'form',
      { method: 'dialog', class: 'dialog-form' },
      h('h2', null, opts.title),
      opts.body ? h('div', { class: 'dialog-body' }, opts.body) : null,
      input,
      h('div', { class: 'dialog-actions' }, cancel, ok),
    );
    const dlg = h('dialog', { class: 'dialog' }, form);
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    if (opts.mustType && input) {
      ok.disabled = true;
      input.addEventListener('input', () => (ok.disabled = input.value.trim() !== opts.mustType));
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (ok.disabled) return;
      finish(input ? input.value : 'ok');
    });
    cancel.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      finish(null);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    (input ?? ok).focus();
  });
}

// ---------- Boutons occupés ----------

export async function busy<T>(btn: HTMLButtonElement, label: string, fn: () => Promise<T>): Promise<T> {
  const saved = Array.from(btn.childNodes);
  btn.disabled = true;
  btn.classList.add('busy');
  mount(btn, h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    mount(btn, ...saved);
  }
}

// ---------- Champ mot de passe ----------

export function passwordField(opts: {
  value?: string;
  placeholder?: string;
  autocomplete?: string;
  label: string;
  extra?: Child;
  onInput?: (v: string) => void;
}): { el: HTMLElement; input: HTMLInputElement; setVisible: (v: boolean) => void } {
  const input = h('input', {
    class: 'input mono',
    type: 'password',
    value: opts.value ?? '',
    placeholder: opts.placeholder ?? '',
    autocomplete: opts.autocomplete ?? 'new-password',
    autocapitalize: 'off',
    spellcheck: false,
    'aria-label': opts.label,
  });
  const eye = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Afficher le mot de passe', title: 'Afficher / masquer' }, icon('eye'));
  const setVisible = (v: boolean) => {
    input.type = v ? 'text' : 'password';
    mount(eye, icon(v ? 'eyeOff' : 'eye'));
    eye.setAttribute('aria-label', v ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  };
  eye.addEventListener('click', () => setVisible(input.type === 'password'));
  if (opts.onInput) input.addEventListener('input', () => opts.onInput!(input.value));
  const el = h('div', { class: 'input-group' }, input, eye, opts.extra);
  return { el, input, setVisible };
}

export function strengthMeter(): { el: HTMLElement; update: (pw: string) => number } {
  const bar = h('div', { class: 'meter-bar' });
  const label = h('span', { class: 'meter-label' });
  const el = h('div', { class: 'meter', 'aria-live': 'polite' }, h('div', { class: 'meter-track' }, bar), label);
  const update = (pw: string) => {
    const s = estimateStrength(pw);
    el.dataset.score = pw ? String(s.score) : '';
    bar.style.width = pw ? `${Math.max(8, Math.min(100, (s.bits / 90) * 100))}%` : '0';
    label.textContent = pw ? `${s.label} · ~${s.bits} bits` : '';
    return s.score;
  };
  return { el, update };
}

// ---------- Presse-papiers ----------

let clipTimer: ReturnType<typeof setTimeout> | null = null;
let lastCopied = '';

export async function copyText(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { class: 'offscreen', 'aria-hidden': 'true' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  lastCopied = text;
  const secs = app.settings.clipboardSeconds;
  toast(secs ? `${label} copié · effacé dans ${secs} s` : `${label} copié`, { kind: 'ok' });
  if (clipTimer) clearTimeout(clipTimer);
  if (secs) {
    clipTimer = setTimeout(async () => {
      clipTimer = null;
      if (lastCopied !== text) return;
      lastCopied = '';
      try {
        await navigator.clipboard.writeText('');
      } catch {
        /* l'app doit être au premier plan pour effacer ; tant pis */
      }
    }, secs * 1000);
  }
}

export function copyBtn(get: () => string, label: string): HTMLButtonElement {
  return h('button', { class: 'icon-btn', type: 'button', title: `Copier ${label.toLowerCase()}`, 'aria-label': `Copier ${label.toLowerCase()}`, onclick: () => copyText(get(), label) }, icon('copy'));
}

// ---------- Divers ----------

export function avatar(title: string): HTMLElement {
  const letter = (title.trim()[0] || '?').toUpperCase();
  let hash = 0;
  for (const c of title) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const el = h('span', { class: 'avatar', 'aria-hidden': 'true' }, letter);
  el.style.setProperty('--hue', String(hash % 360));
  return el;
}

/** N'autorise que les liens http(s) (jamais javascript:, data:, etc.). */
export function safeHref(url: string): string | null {
  const u = url.trim();
  if (!u) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function fmtDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtAgo(ms: number | null): string {
  if (!ms) return 'jamais';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return fmtDate(ms);
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function downloadFile(data: ArrayBuffer, name: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const a = h('a', { href: url, download: name, class: 'offscreen' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'offscreen' });
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}
