import { store, subscribe, setView, undo, redo, update, selectedLayer, setProject, flushSave } from './store.js';
import { STATES, clone, uid } from '../core/model.js';
import { getDevice } from '../core/devices.js';
import { mountPreview, playUnlockDemo, enableDeviceMotion, resetTilt } from './preview.js';
import { mountPanels, installGuide, ADD } from './panels.js';
import { el, segmented, modal, toast, button, runSyncs, persistent, confirmModal } from './dom.js';
import { listProjects, deleteProject, saveProject, collectGarbage, requestPersistence, getProject } from '../browser/storage.js';
import { projectThumbnail } from './assets.js';
import { TEMPLATES } from './templates.js';
import * as A from './actions.js';
import { icon } from './icons.js';

const $ = (s) => document.querySelector(s);

const TABS = [
  ['layers', 'layers', 'Layers'],
  ['style', 'style', 'Style'],
  ['motion', 'motion', 'Motion'],
  ['project', 'gear', 'Project'],
];

/** left tool rail (Liquid Glass) */
function mountRail() {
  const rail = $('#rail');
  const rb = (ic, label, fn, attrs = {}) => el('button', { type: 'button', class: `rail-btn ${attrs.class || ''}`, title: label, 'aria-label': label, onclick: fn, ...attrs, ...(attrs.class ? { class: `rail-btn ${attrs.class}` } : {}) }, [icon(ic), el('span', { class: 'rail-label' }, label)]);
  const tabBtns = TABS.map(([id, ic, label]) =>
    rb(ic, label, () => {
      const open = $('#app').dataset.panel !== 'closed';
      if (store.view.tab === id && open) setPanel('closed');
      else {
        setView({ tab: id });
        setPanel('open');
      }
    }, { class: 'tab', 'data-tab': id, role: 'tab' })
  );
  const undoB = rb('undo', 'Undo', undo, { class: 'mini' });
  const redoB = rb('redo', 'Redo', redo, { class: 'mini' });
  rail.append(
    el('div', { class: 'rail-group' }, [
      rb('library', 'Library', openLibrary, { id: 'libBtn' }),
      rb('plus', 'Add', openAddMenu, { id: 'addBtn', class: 'accent' }),
    ]),
    el('div', { class: 'rail-group' }, tabBtns),
    el('div', { class: 'rail-group' }, [
      rb('sparkles', 'Effects', () => A.openEffects(), { id: 'fxBtn' }),
      rb('globe', 'Browse', () => A.openBrowse(), { id: 'browseBtn' }),
      rb('fold', 'Duo', () => A.openDuoPreview(), { id: 'duoBtn' }),
    ]),
    el('div', { class: 'rail-spacer' }),
    el('div', { class: 'rail-group' }, [undoB, redoB, rb('share', 'Export', () => A.openExport(), { id: 'exportBtn', class: 'primary' })])
  );
  subscribe(() => {
    const open = $('#app').dataset.panel !== 'closed';
    tabBtns.forEach((b) => b.classList.toggle('on', open && b.dataset.tab === store.view.tab));
    undoB.disabled = !store.undo.length;
    redoB.disabled = !store.redo.length;
    document.title = `${store.project?.name || 'Project'} – Tendies Studio`;
  });
}

/** inspector: docked on the right (wide) or a bottom sheet with detents (narrow) */
function setPanel(state) {
  const app = $('#app');
  app.dataset.panel = state;
  try {
    localStorage.setItem('tendies.panel', state);
  } catch {
    /* private mode */
  }
  setView({});
}

function mountSheet() {
  const panel = $('#panel');
  let saved = null;
  try {
    saved = localStorage.getItem('tendies.panel');
  } catch {
    /* ignore */
  }
  $('#app').dataset.panel = saved || 'open';
  // drag the grabber (narrow layout): up = full, down = closed
  let drag = null;
  panel.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.grabber, .panel-head')) return;
    if (e.target.closest('button')) return;
    drag = { y: e.clientY, h: panel.getBoundingClientRect().height, id: e.pointerId };
    panel.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
  });
  panel.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    panel.style.height = `${Math.max(56, drag.h + drag.y - e.clientY)}px`;
  });
  const end = (e) => {
    if (!drag) return;
    const dy = drag.y - e.clientY;
    const cur = $('#app').dataset.panel;
    panel.style.height = '';
    panel.classList.remove('dragging');
    drag = null;
    if (Math.abs(dy) < 6) return setPanel(cur === 'closed' ? 'open' : cur === 'open' ? 'full' : 'open');
    if (dy > 60) setPanel(cur === 'closed' ? 'open' : 'full');
    else if (dy < -60) setPanel(cur === 'full' ? 'open' : 'closed');
  };
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
}

function openAddMenu() {
  const close = modal('Add', el('div', { class: 'add-grid big' }, ADD.map(([k, i, n, fn]) => el('button', { type: 'button', class: 'add-btn', 'data-add': k, onclick: () => (close(), fn()) }, [el('span', { class: 'add-ico' }, i), n]))), [], { sheet: true });
}

/** floating glass pills on the canvas: project name, Edit / Play */
function mountTopPills() {
  const bar = $('#topPills');
  const name = el('input', { class: 'proj-name', 'aria-label': 'Project name', spellcheck: 'false' });
  name.addEventListener('input', () => update((p) => (p.name = name.value), 'pname'));
  const mode = persistent(() =>
    segmented([['edit', [icon('edit'), el('span', {}, 'Edit')]], ['preview', [icon('play'), el('span', {}, 'Play')]]], () => store.view.mode, (v) => {
      setView({ mode: v, progress: store.view.state === 'Unlock' ? 1 : 0 });
      if (v === 'edit') resetTilt();
      // on a phone, Play asks for the motion sensor right away (iOS needs this tap)
      else if (matchMedia('(pointer: coarse)').matches && typeof DeviceOrientationEvent !== 'undefined')
        enableDeviceMotion().then((ok) => toast(ok ? 'Tilt your phone' : 'Motion sensor not allowed – move over the preview instead', ok ? 'ok' : 'warn'));
    }, 'mode glass-seg')
  );
  bar.append(el('div', { class: 'pill name-pill' }, name), mode);
  subscribe(() => {
    if (document.activeElement !== name) name.value = store.project?.name || '';
  });
}

function mountStateBar() {
  const bar = $('#statebar');
  const ICON = { Locked: 'lock', Unlock: 'home', Sleep: 'moon' };
  const seg = persistent(() => segmented(STATES.map((s) => [s.id, [icon(ICON[s.id] || 'lock'), el('span', {}, s.name)], s.name]), () => store.view.state, (v) => setView({ state: v, progress: v === 'Unlock' ? 1 : 0 }), 'states glass-seg'));
  const scrub = el('input', { type: 'range', min: 0, max: 1, step: 0.01, class: 'scrub', 'aria-label': 'Swipe progress Lock → Home', title: 'Unlock swipe' });
  scrub.addEventListener('input', () => {
    const v = Number(scrub.value);
    setView({ progress: v, state: v >= 1 ? 'Unlock' : 'Locked' });
  });
  const scrubWrap = el('label', { class: 'pill scrub-wrap' }, [icon('lock'), scrub, icon('home')]);
  const ib = (ic, label, fn) => el('button', { type: 'button', class: 'pill icon-pill', title: label, 'aria-label': label, onclick: fn }, icon(ic));
  const darkBtn = ib('sun', 'Light / Dark', () => setView({ dark: !store.view.dark }));
  const demo = ib('unlock', 'Play unlock', playUnlockDemo);
  const clock = ib('clock', 'Clock & UI', () => setView({ clock: !store.view.clock }));
  const motion = ib('gyro', 'Motion sensor', async () => toast((await enableDeviceMotion()) ? 'Tilt your phone' : 'Motion sensor not available', 'info'));
  const posture = persistent(() => segmented([['cover', 'Cover'], ['inner', 'Inner'], ['land', 'Land']], () => store.view.posture || 'inner', (v) => setView({ posture: v }), 'posture glass-seg'));
  // live 3D tilt strength for gyro-tilted layers (Duo tilt …)
  const tilted = () => (store.project?.layers || []).filter((l) => l.gyro?.tilt > 0 && !l.gyro?.fold);
  const tiltVal = el('output', { class: 'tilt-val' });
  const tilt = el('input', { type: 'range', min: 0, max: 60, step: 1, class: 'scrub', 'aria-label': '3D tilt strength', title: '3D tilt strength' });
  tilt.addEventListener('input', () => {
    const v = Math.max(1, Number(tilt.value));
    update((p) => {
      for (const l of p.layers) if (l.gyro?.tilt > 0 && !l.gyro.fold) {
        l.gyro.tiltV = l.gyro.tiltV ? Math.round(v * (l.gyro.tiltV / l.gyro.tilt)) : 0;
        l.gyro.tilt = v;
      }
    }, 'tiltStrength');
  });
  const tiltWrap = el('label', { class: 'pill scrub-wrap tilt-wrap' }, [icon('gyro'), tilt, tiltVal]);
  bar.append(seg, scrubWrap, tiltWrap, posture);
  $('#topPills .mode')?.before(el('div', { class: 'pill-row' }, [demo, motion, clock, darkBtn]));
  subscribe(() => {
    runSyncs();
    const p = store.project;
    const modern = p?.format !== 'classic';
    const tl = modern ? tilted() : [];
    tiltWrap.hidden = !tl.length;
    scrubWrap.hidden = !modern || (store.view.mode === 'preview' && tl.length > 0);
    if (tl.length) {
      const v = Math.max(...tl.map((l) => l.gyro.tilt));
      if (document.activeElement !== tilt) tilt.value = v;
      tiltVal.textContent = `${Math.round(v)}°`;
    }
    if (document.activeElement !== scrub) scrub.value = store.view.progress ?? (store.view.state === 'Unlock' ? 1 : 0);
    darkBtn.hidden = modern || !p?.appearanceAware;
    darkBtn.replaceChildren(icon(store.view.dark ? 'moon' : 'sun'));
    motion.hidden = store.view.mode !== 'preview' || !modern;
    posture.hidden = p?.format !== 'duo';
    clock.classList.toggle('on', store.view.clock);
    const dark = p?.appearanceAware && store.view.dark && !modern;
    $('#app').dataset.editing = store.view.state === 'Locked' && !dark ? 'base' : 'state';
    $('#app').dataset.mode = store.view.mode;
  });
}

// ---------------------------------------------------------------- library

async function openLibrary() {
  await flushSave();
  const list = await listProjects();
  const chosen = new Set();
  const grid = el('div', { class: 'lib-grid' });
  const collectBtn = button('Export as collection', async () => {
    if (chosen.size) {
      close();
      await A.exportCollection([...chosen]);
    }
  }, 'primary');
  collectBtn.disabled = true;
  for (const p of list) {
    const img = el('div', { class: 'lib-thumb' });
    const card = el('div', { class: `lib-card ${p.id === store.project?.id ? 'current' : ''}` }, [
      img,
      el('div', { class: 'lib-meta' }, [el('b', {}, p.name), el('small', {}, `${p.layers.length} layers · ${p.format === 'classic' ? 'Classic' : 'Modern'} · ${new Date(p.updated).toLocaleDateString('en-US')}`)]),
      el('div', { class: 'lib-actions' }, [
        el('label', { class: 'lib-check', title: 'Select for collection' }, [
          el('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? chosen.add(p.id) : chosen.delete(p.id), (collectBtn.disabled = !chosen.size), (collectBtn.textContent = `Export as collection (${chosen.size})`)) }),
          'Collection',
        ]),
        el('button', { class: 'icon-btn', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: async () => { const c = clone(p); c.id = uid('p'); c.name += ' copy'; c.updated = Date.now(); await saveProject(c); close(); openLibrary(); } }, '⧉'),
        el('button', { class: 'icon-btn', title: 'Delete', 'aria-label': 'Delete', onclick: async () => {
          if (!(await confirmModal('Delete wallpaper', `Delete “${p.name}”? This can’t be undone.`))) return;
          await deleteProject(p.id);
          collectGarbage();
          if (p.id === store.project?.id) {
            const rest = await listProjects();
            if (rest[0]) setProject(rest[0]);
            else A.createProject(TEMPLATES.at(-1).build);
          }
          close();
          openLibrary();
        } }, '🗑'),
      ]),
    ]);
    img.addEventListener('click', async () => {
      setProject((await getProject(p.id)) || p);
      close();
    });
    grid.append(card);
    const d = getDevice(p.device);
    projectThumbnail({ ...p, _w: d.w, _h: d.h }, 160).then((u) => (img.style.backgroundImage = `url("${u}")`)).catch(() => {});
  }
  const templates = el('div', { class: 'tpl-grid' }, TEMPLATES.map((t) =>
    el('button', { type: 'button', class: 'tpl', 'data-tpl': t.id, onclick: () => { close(); A.createProject(t.build); toast(`“${t.name}” created`, 'ok'); } }, [el('span', { class: 'tpl-ico' }, t.icon || '✦'), el('b', {}, t.name), el('small', {}, t.desc)])
  ));
  const close = modal('Library', [el('h3', {}, 'Start from a template'), templates, el('h3', {}, `Your wallpapers (${list.length})`), list.length ? grid : el('p', { class: 'muted' }, 'No projects yet.')], [
    ['Import .tendies', async (c) => { c(); await A.importTendiesFile(); }],
    ['✨ Morph .tendies', async (c) => { c(); await A.morphTendies(); }],
    ['🌐 Browse', (c) => { c(); A.openBrowse(); }],
    ['How to install', (c) => { c(); modal('Install on iPhone', installGuide()); }],
  ]);
  document.querySelector('.modal-actions')?.prepend(collectBtn);
}

// ---------------------------------------------------------------- input

function keyboard() {
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      if (typing) return;
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      A.openExport();
      return;
    }
    if (typing || document.querySelector('.modal-back')) return;
    const l = selectedLayer();
    if (mod && e.key.toLowerCase() === 'd' && l) {
      e.preventDefault();
      A.duplicateLayer(l.id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && l) {
      e.preventDefault();
      A.deleteLayer(l.id);
    } else if (['1', '2', '3'].includes(e.key)) {
      const s = STATES[Number(e.key) - 1].id;
      setView({ state: s, progress: s === 'Unlock' ? 1 : 0 });
    } else if (e.key.toLowerCase() === 'p') {
      setView({ mode: store.view.mode === 'preview' ? 'edit' : 'preview' });
    } else if (e.key === ' ') {
      e.preventDefault();
      playUnlockDemo();
    } else if (e.key.startsWith('Arrow') && l && !l.locked) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      update((p) => {
        const x = p.layers.find((q) => q.id === l.id);
        x.x += dx;
        x.y += dy;
      }, 'nudge');
    }
  });
}

function dropFiles() {
  const app = $('#app');
  app.addEventListener('dragover', (e) => {
    e.preventDefault();
    app.classList.add('dropping');
  });
  app.addEventListener('dragleave', (e) => {
    if (e.target === app) app.classList.remove('dropping');
  });
  app.addEventListener('drop', async (e) => {
    e.preventDefault();
    app.classList.remove('dropping');
    for (const f of e.dataTransfer.files) await handleFile(f);
  });
  window.addEventListener('paste', async (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    for (const item of e.clipboardData?.files || []) await handleFile(item);
  });
}

async function handleFile(f) {
  if (/\.(tendies|zip|batter)$/i.test(f.name)) return A.importTendiesFile(f);
  if (f.type === 'image/gif' || /\.gif$/i.test(f.name)) return A.addGifFile(f);
  if (f.type.startsWith('image/')) return A.addImageFromFile(f);
  if (f.type.startsWith('video/')) return toast('Add videos via ＋ Add → Video (frame settings).', 'info');
}

// ---------------------------------------------------------------- clean start

const APP_VERSION = '2026-11-15.3';
/** every start: drop unused stored pictures; on a new version also wipe old caches */
async function cleanOnStart() {
  try {
    let last = null;
    try {
      last = localStorage.getItem('tendies.version');
      localStorage.setItem('tendies.version', APP_VERSION);
    } catch {
      /* private mode */
    }
    if (last !== APP_VERSION && 'caches' in window) {
      for (const k of await caches.keys()) if (!k.endsWith(APP_VERSION)) await caches.delete(k);
      if (last) toast('Updated – old caches cleared', 'ok');
    }
    collectGarbage();
  } catch (e) {
    console.warn('clean start', e);
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  mountRail();
  mountSheet();
  mountTopPills();
  mountStateBar();
  mountPreview($('#stage'));
  mountPanels($('#panel'));
  keyboard();
  dropFiles();
  await A.openLatestOrNew();
  requestPersistence();
  window.addEventListener('pagehide', () => flushSave());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave());
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
    // a new version took over → reload once so no old code keeps running
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      flushSave().finally(() => location.reload());
    });
  }
  cleanOnStart();
  window.__studio = { store, A };
}

boot().catch((e) => {
  console.error(e);
  document.body.append(el('pre', { class: 'fatal' }, `Startup error: ${e.message}`));
});
