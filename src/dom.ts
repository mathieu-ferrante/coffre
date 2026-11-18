// Petit utilitaire de construction du DOM.
// Tout le texte passe par textContent : aucune donnée du coffre n'est jamais interprétée comme du HTML.

export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k in el && typeof v !== 'string') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else if (k === 'value' || k === 'checked' || k === 'disabled') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, children);
}

// Icônes (traits 24×24), construites sans innerHTML.
const PATHS: Record<string, string[]> = {
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  unlock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 7.5-2'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M20 20l-4-4'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z'],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2', 'M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  key: ['M15 3a6 6 0 1 0 0 12a6 6 0 1 0 0-12z', 'M10.7 13.3L3 21', 'M6 18l3 3', 'M8 16l2 2'],
  dice: ['M4 4h16v16H4z', 'M8.5 8.5h.01', 'M15.5 8.5h.01', 'M12 12h.01', 'M8.5 15.5h.01', 'M15.5 15.5h.01'],
  settings: ['M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  sync: ['M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 12a9 9 0 0 1 15.5-6.2L21 8', 'M21 3v5h-5', 'M3 21v-5h5'],
  check: ['M5 12l5 5L20 7'],
  alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17.5h.01'],
  cloudOff: ['M3 3l18 18', 'M18 18H7a5 5 0 0 1-1.6-9.7', 'M9.5 5.4A6 6 0 0 1 17.6 9 4.5 4.5 0 0 1 21 13.5a4.4 4.4 0 0 1-.9 2.7'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  back: ['M15 18l-6-6 6-6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  clock: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7v5l3 2'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  upload: ['M12 20V8', 'M7 13l5-5 5 5', 'M4 4h16'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  restore: ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
  user: ['M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z', 'M4 21a8 8 0 0 1 16 0'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
};

export function icon(name: keyof typeof PATHS | string, size = 20): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  for (const d of PATHS[name] ?? []) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}
