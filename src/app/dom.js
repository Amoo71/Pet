// Tiny DOM + form helpers. Fields register a sync() so panels can refresh values
// (e.g. after dragging on the canvas) without re-creating inputs and losing focus.

import { icon } from './icons.js';

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

// panel fields are re-created on every panel render; persistent ones (top/state bar) live forever
let panelSyncs = [];
const persistentSyncs = [];
let syncs = panelSyncs;
export function resetSyncs() {
  panelSyncs = [];
  syncs = panelSyncs;
}
export function persistent(fn) {
  const prev = syncs;
  syncs = persistentSyncs;
  try {
    return fn();
  } finally {
    syncs = prev === persistentSyncs ? panelSyncs : prev;
  }
}
export function runSyncs() {
  for (const s of persistentSyncs) s();
  for (const s of panelSyncs) s();
}

const row = (label, control, extra) =>
  el('label', { class: 'field' }, [el('span', { class: 'field-label' }, label), control, extra]);

const round = (v, step) => {
  if (typeof v !== 'number' || !isFinite(v)) return v;
  const d = step && step < 1 ? Math.min(3, String(step).split('.')[1]?.length || 2) : 0;
  return Number(v.toFixed(d));
};

/** Number input (+ optional range slider). get/set read & write the model. */
export function numField(label, get, set, o = {}) {
  const inp = el('input', { type: 'number', inputmode: 'decimal', step: o.step ?? 1, min: o.min, max: o.max, class: 'num' });
  const range = o.slider ? el('input', { type: 'range', step: o.step ?? 1, min: o.min ?? 0, max: o.max ?? 100, class: 'range' }) : null;
  const apply = (raw) => {
    let v = Number(raw);
    if (!isFinite(v)) return;
    if (o.min != null && !o.slider) v = Math.max(o.min, v);
    if (o.max != null && !o.slider) v = Math.min(o.max, v);
    set(o.fromUI ? o.fromUI(v) : v);
  };
  inp.addEventListener('input', () => apply(inp.value));
  range?.addEventListener('input', () => {
    inp.value = range.value;
    apply(range.value);
  });
  const sync = () => {
    let v = get();
    if (o.toUI) v = o.toUI(v);
    const r = round(v, o.step);
    if (document.activeElement !== inp) inp.value = r ?? '';
    if (range && document.activeElement !== range) range.value = r ?? 0;
    inp.classList.toggle('overridden', !!o.isOverride?.());
  };
  sync();
  syncs.push(sync);
  const ctrl = el('div', { class: 'num-wrap' }, [range, inp, o.unit ? el('span', { class: 'unit' }, o.unit) : null]);
  return row(label, ctrl);
}

export function colorField(label, get, set) {
  const inp = el('input', { type: 'color', class: 'color' });
  const txt = el('input', { type: 'text', class: 'hex', maxlength: 9, spellcheck: 'false' });
  inp.addEventListener('input', () => {
    txt.value = inp.value;
    set(inp.value);
  });
  txt.addEventListener('change', () => {
    if (/^#[0-9a-f]{6}$/i.test(txt.value)) set(txt.value);
  });
  const sync = () => {
    const v = get() || '#000000';
    if (document.activeElement !== inp) inp.value = v.slice(0, 7);
    if (document.activeElement !== txt) txt.value = v;
  };
  sync();
  syncs.push(sync);
  return row(label, el('div', { class: 'color-wrap' }, [inp, txt]));
}

export function selectField(label, options, get, set) {
  const s = el(
    'select',
    { class: 'select' },
    options.map(([v, t]) => el('option', { value: v }, t))
  );
  s.addEventListener('change', () => set(s.value));
  const sync = () => {
    if (document.activeElement !== s) s.value = String(get());
  };
  sync();
  syncs.push(sync);
  return row(label, s);
}

export function toggleField(label, get, set, hint) {
  const c = el('input', { type: 'checkbox', class: 'switch' });
  c.addEventListener('change', () => set(c.checked));
  const sync = () => (c.checked = !!get());
  sync();
  syncs.push(sync);
  return el('label', { class: 'field toggle' }, [el('span', { class: 'field-label' }, [label, hint ? el('small', {}, hint) : null]), c]);
}

export function textField(label, get, set, o = {}) {
  const t = o.multiline ? el('textarea', { rows: o.rows || 3, class: 'text' }) : el('input', { type: 'text', class: 'text' });
  if (o.placeholder) t.placeholder = o.placeholder;
  t.addEventListener('input', () => set(t.value));
  const sync = () => {
    if (document.activeElement !== t) t.value = get() ?? '';
  };
  sync();
  syncs.push(sync);
  return row(label, t);
}

export function segmented(options, get, set, cls = '') {
  const wrap = el('div', { class: `seg ${cls}`, role: 'radiogroup' });
  const btns = options.map(([v, t, title]) => {
    const b = el('button', { type: 'button', class: 'seg-btn', title: title || '', 'data-v': v }, t);
    b.addEventListener('click', () => set(v));
    wrap.append(b);
    return b;
  });
  const sync = () => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(get())));
  sync();
  syncs.push(sync);
  return wrap;
}

export function section(title, children, o = {}) {
  const d = el('details', { class: 'section', open: o.closed ? null : true }, [el('summary', {}, title), el('div', { class: 'section-body' }, children)]);
  return d;
}

export function button(label, onclick, cls = '') {
  return el('button', { type: 'button', class: `btn ${cls}`, onclick }, label);
}

export function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const i = el('input', { type: 'file', accept, multiple: multiple || null, style: { display: 'none' } });
    document.body.append(i);
    i.addEventListener('change', () => {
      resolve([...i.files]);
      i.remove();
    });
    i.addEventListener('cancel', () => {
      resolve([]);
      i.remove();
    });
    i.click();
  });
}

// ---------- toast & modal ----------

export function toast(msg, kind = 'info', ms = 3200) {
  let host = document.getElementById('toasts');
  if (!host) {
    host = el('div', { id: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = el('div', { class: `toast toast-${kind}` }, msg);
  host.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function modal(title, content, actions = [], o = {}) {
  const close = () => back.remove();
  const back = el('div', { class: `modal-back ${o.sheet ? 'as-sheet' : ''}`, onclick: (e) => e.target === back && close() }, [
    el('div', { class: `modal ${o.wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title }, [
      el('div', { class: 'modal-head' }, [el('h2', {}, title), el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))]),
      el('div', { class: 'modal-body' }, content),
      actions.length ? el('div', { class: 'modal-actions' }, actions.map(([t, fn, cls]) => button(t, () => fn(close), cls))) : null,
    ]),
  ]);
  document.body.append(back);
  return close;
}

export function progressModal(title) {
  const bar = el('div', { class: 'progress' }, el('div', { class: 'progress-fill' }));
  const label = el('p', { class: 'muted' }, '…');
  let aborted = false;
  const ctrl = new AbortController();
  const close = modal(title, [label, bar], [['Cancel', (c) => (ctrl.abort(), (aborted = true), c())]]);
  return {
    signal: ctrl.signal,
    set(i, n, text) {
      bar.firstChild.style.width = `${Math.round((i / Math.max(1, n)) * 100)}%`;
      label.textContent = text || `${i} / ${n}`;
    },
    close: () => !aborted && close(),
  };
}

export function download(bytes, filename, type = 'application/zip') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

/** Ask the user to confirm inside the page (window.confirm is unavailable in some embeds). */
export function confirmModal(title, text, okLabel = 'Delete', cls = 'danger') {
  return new Promise((resolve) => {
    modal(title, el('p', {}, text), [
      ['Cancel', (c) => (c(), resolve(false))],
      [okLabel, (c) => (c(), resolve(true)), cls],
    ]);
  });
}

/** Share sheet on iOS (lets the user send the .tendies straight to Pocket Poster / Files), else download. */
export async function shareOrDownload(bytes, filename) {
  if (globalThis.claude && typeof globalThis.claude.use === 'function') {
    // claude.ai artifact preview: the sandbox blocks file downloads and the share sheet
    modal('Export is not available in this preview', el('div', { class: 'form' }, [
      el('p', {}, 'This link is a live preview of Tendies Studio. The sandbox it runs in blocks file downloads, so .tendies files can’t be saved from here.'),
      el('p', { class: 'muted' }, 'Open the full app (GitHub Pages build of this repository) to export – your design is easy to rebuild there, or start from the same template.'),
    ]), [['OK', (c) => c(), 'primary']]);
    return 'cancelled';
  }
  const file = new File([bytes], filename, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  download(bytes, filename, 'application/octet-stream');
  return 'downloaded';
}
