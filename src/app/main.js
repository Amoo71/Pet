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

const $ = (s) => document.querySelector(s);

function mountTopbar() {
  const bar = $('#topbar');
  const name = el('input', { class: 'proj-name', 'aria-label': 'Project name', spellcheck: 'false' });
  name.addEventListener('input', () => update((p) => (p.name = name.value), 'pname'));
  const undoB = el('button', { class: 'icon-btn', title: 'Undo (⌘Z)', 'aria-label': 'Undo', onclick: undo }, '↶');
  const redoB = el('button', { class: 'icon-btn', title: 'Redo (⇧⌘Z)', 'aria-label': 'Redo', onclick: redo }, '↷');
  const mode = persistent(() =>
    segmented([['edit', '✎ Edit'], ['preview', '▶ Preview']], () => store.view.mode, (v) => {
      setView({ mode: v, progress: store.view.state === 'Unlock' ? 1 : 0 });
      if (v === 'edit') resetTilt();
    }, 'mode')
  );
  const addBtn = el('button', { class: 'btn add-main', id: 'addBtn', onclick: openAddMenu }, '＋ Add');
  bar.append(
    el('button', { class: 'icon-btn', title: 'Library', 'aria-label': 'Library', id: 'libBtn', onclick: openLibrary }, '☰'),
    el('button', { class: 'icon-btn', title: 'Browse wallpapers', 'aria-label': 'Browse wallpapers', id: 'browseBtn', onclick: () => A.openBrowse() }, '🌐'),
    el('div', { class: 'brand' }, [el('span', { class: 'logo' }), el('span', { class: 'brand-name' }, 'Tendies Studio')]),
    name,
    el('div', { class: 'spacer' }),
    addBtn,
    mode,
    undoB,
    redoB,
    el('button', { class: 'btn primary', id: 'exportBtn', onclick: () => A.openExport() }, 'Export')
  );
  subscribe(() => {
    if (document.activeElement !== name) name.value = store.project?.name || '';
    undoB.disabled = !store.undo.length;
    redoB.disabled = !store.redo.length;
    document.title = `${store.project?.name || 'Project'} – Tendies Studio`;
  });
}

function openAddMenu() {
  const close = modal('Add layer', el('div', { class: 'add-grid big' }, ADD.map(([k, i, n, fn]) => el('button', { type: 'button', class: 'add-btn', 'data-add': k, onclick: () => (close(), fn()) }, [el('span', { class: 'add-ico' }, i), n]))));
}

function mountStateBar() {
  const bar = $('#statebar');
  const seg = persistent(() => segmented(STATES.map((s) => [s.id, `${s.icon} ${s.name}`]), () => store.view.state, (v) => setView({ state: v, progress: v === 'Unlock' ? 1 : 0 }), 'states'));
  const scrub = el('input', { type: 'range', min: 0, max: 1, step: 0.01, class: 'scrub', 'aria-label': 'Swipe progress Lock → Home', title: 'Scrub the unlock swipe (Lock → Home)' });
  scrub.addEventListener('input', () => {
    const v = Number(scrub.value);
    setView({ progress: v, state: v >= 1 ? 'Unlock' : 'Locked' });
  });
  const scrubWrap = el('label', { class: 'scrub-wrap' }, [el('span', {}, '🔒'), scrub, el('span', {}, '📱')]);
  const darkBtn = el('button', { class: 'icon-btn toggle-btn', title: 'Light / Dark', 'aria-label': 'Toggle light/dark', onclick: () => setView({ dark: !store.view.dark }) });
  const demo = el('button', { class: 'btn small', title: 'Play the unlock swipe', onclick: playUnlockDemo }, '▶ Unlock');
  const clock = el('button', { class: 'icon-btn toggle-btn', title: 'Show clock & UI', 'aria-label': 'Toggle clock', onclick: () => setView({ clock: !store.view.clock }) }, '🕘');
  const motion = el('button', { class: 'btn small', title: 'Use the phone’s motion sensor for parallax', onclick: async () => toast((await enableDeviceMotion()) ? 'Motion on – tilt your phone' : 'Motion sensor not available', 'info') }, '🧭 Motion');
  const posture = persistent(() => segmented([['cover', 'Cover'], ['inner', 'Inner'], ['land', 'Landscape']], () => store.view.posture || 'inner', (v) => setView({ posture: v }), 'posture'));
  bar.append(seg, scrubWrap, posture, darkBtn, demo, motion, clock);
  subscribe(() => {
    runSyncs();
    const p = store.project;
    const modern = p?.format !== 'classic';
    scrubWrap.hidden = !modern;
    if (document.activeElement !== scrub) scrub.value = store.view.progress ?? (store.view.state === 'Unlock' ? 1 : 0);
    darkBtn.hidden = modern || !p?.appearanceAware;
    darkBtn.textContent = store.view.dark ? '🌙' : '☀️';
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

// ---------------------------------------------------------------- boot

async function boot() {
  mountTopbar();
  mountStateBar();
  mountPreview($('#stage'));
  mountPanels($('#panel'));
  keyboard();
  dropFiles();
  await A.openLatestOrNew();
  requestPersistence();
  window.addEventListener('pagehide', () => flushSave());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushSave());
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
  $('#panelToggle')?.addEventListener('click', () => $('#app').classList.toggle('panel-collapsed'));
  window.__studio = { store, A };
}

boot().catch((e) => {
  console.error(e);
  document.body.append(el('pre', { class: 'fatal' }, `Startup error: ${e.message}`));
});
