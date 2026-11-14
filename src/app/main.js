import { store, subscribe, setView, undo, redo, update, selectedLayer, setProject, flushSave } from './store.js';
import { STATES } from '../core/model.js';
import { mountPreview, playUnlockDemo } from './preview.js';
import { mountPanels, installGuide } from './panels.js';
import { el, segmented, modal, toast, button, runSyncs, persistent } from './dom.js';
import { listProjects, deleteProject, saveProject, collectGarbage, requestPersistence, getProject } from '../browser/storage.js';
import { projectThumbnail } from './assets.js';
import { TEMPLATES } from './templates.js';
import * as A from './actions.js';
import { clone, uid } from '../core/model.js';

const $ = (s) => document.querySelector(s);

function mountTopbar() {
  const bar = $('#topbar');
  const name = el('input', { class: 'proj-name', 'aria-label': 'Projektname', spellcheck: 'false' });
  name.addEventListener('input', () => update((p) => (p.name = name.value), 'pname'));
  const undoB = el('button', { class: 'icon-btn', title: 'Rückgängig (⌘Z)', 'aria-label': 'Rückgängig', onclick: undo }, '↶');
  const redoB = el('button', { class: 'icon-btn', title: 'Wiederholen (⇧⌘Z)', 'aria-label': 'Wiederholen', onclick: redo }, '↷');
  bar.append(
    el('button', { class: 'icon-btn', title: 'Bibliothek', 'aria-label': 'Bibliothek', id: 'libBtn', onclick: openLibrary }, '☰'),
    el('div', { class: 'brand' }, [el('span', { class: 'logo' }, '◐'), el('span', { class: 'brand-name' }, 'Tendies Studio')]),
    name,
    el('div', { class: 'spacer' }),
    undoB,
    redoB,
    el('button', { class: 'btn primary', id: 'exportBtn', onclick: () => A.exportTendies() }, '⬇︎ Export')
  );
  subscribe(() => {
    if (document.activeElement !== name) name.value = store.project?.name || '';
    undoB.disabled = !store.undo.length;
    redoB.disabled = !store.redo.length;
    document.title = `${store.project?.name || 'Projekt'} – Tendies Studio`;
  });
}

function mountStateBar() {
  const bar = $('#statebar');
  const seg = persistent(() => segmented(STATES.map((s) => [s.id, `${s.icon} ${s.name}`]), () => store.view.state, (v) => setView({ state: v }), 'states'));
  const darkBtn = el('button', { class: 'icon-btn toggle-btn', title: 'Hell / Dunkel', 'aria-label': 'Hell/Dunkel umschalten', onclick: () => {
    if (!store.project.appearanceAware) {
      toast('Hell/Dunkel-Varianten sind aus. Aktivieren unter Projekt → „Hell/Dunkel-Varianten“.', 'info', 5000);
      return;
    }
    setView({ dark: !store.view.dark });
  } });
  const demo = el('button', { class: 'btn small', title: 'Entsperren abspielen', onclick: playUnlockDemo }, '▶︎ Entsperren');
  const clock = el('button', { class: 'icon-btn toggle-btn', title: 'Uhr-Overlay', 'aria-label': 'Uhr anzeigen', onclick: () => setView({ clock: !store.view.clock }) }, '🕘');
  bar.append(seg, darkBtn, demo, clock);
  subscribe(() => {
    runSyncs();
    darkBtn.textContent = store.view.dark && store.project?.appearanceAware ? '🌙' : '☀️';
    darkBtn.classList.toggle('dim', !store.project?.appearanceAware);
    clock.classList.toggle('on', store.view.clock);
    $('#app').dataset.editing = store.view.state === 'Locked' && !(store.view.dark && store.project?.appearanceAware) ? 'base' : 'state';
  });
}

// ---------------------------------------------------------------- library

async function openLibrary() {
  await flushSave();
  const list = await listProjects();
  const chosen = new Set();
  const grid = el('div', { class: 'lib-grid' });
  const collectBtn = button('Als Sammlung exportieren', async () => {
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
      el('div', { class: 'lib-meta' }, [el('b', {}, p.name), el('small', {}, `${p.layers.length} Ebenen · ${new Date(p.updated).toLocaleDateString('de-DE')}`)]),
      el('div', { class: 'lib-actions' }, [
        el('label', { class: 'lib-check', title: 'Für Sammlung auswählen' }, [
          el('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? chosen.add(p.id) : chosen.delete(p.id), (collectBtn.disabled = !chosen.size), (collectBtn.textContent = `Als Sammlung exportieren (${chosen.size})`)) }),
          'Sammlung',
        ]),
        el('button', { class: 'icon-btn', title: 'Duplizieren', 'aria-label': 'Duplizieren', onclick: async () => { const c = clone(p); c.id = uid('p'); c.name += ' Kopie'; c.updated = Date.now(); await saveProject(c); close(); openLibrary(); } }, '⧉'),
        el('button', { class: 'icon-btn', title: 'Löschen', 'aria-label': 'Löschen', onclick: async () => {
          if (!confirm(`„${p.name}“ löschen?`)) return;
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
      const fresh = await getProject(p.id);
      setProject(fresh || p);
      close();
    });
    grid.append(card);
    const d = (await import('../core/devices.js')).getDevice(p.device);
    projectThumbnail({ ...p, _w: d.w, _h: d.h }, 160).then((u) => (img.style.backgroundImage = `url("${u}")`));
  }
  const templates = el(
    'div',
    { class: 'tpl-grid' },
    TEMPLATES.map((t) =>
      el('button', { type: 'button', class: 'tpl', onclick: () => { close(); A.createProject(t.build); toast(`„${t.name}“ erstellt`, 'ok'); } }, [el('b', {}, t.name), el('small', {}, t.desc)])
    )
  );
  const close = modal('Bibliothek', [
    el('h3', {}, 'Neu aus Vorlage'),
    templates,
    el('h3', {}, `Deine Wallpaper (${list.length})`),
    list.length ? grid : el('p', { class: 'muted' }, 'Noch keine Projekte.'),
  ], [
    ['.tendies importieren', async (c) => { c(); await A.importTendiesFile(); }],
    ['Installations-Hilfe', (c) => { c(); modal('Installation', installGuide()); }],
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
      A.exportTendies();
      return;
    }
    if (typing) return;
    const l = selectedLayer();
    if (mod && e.key.toLowerCase() === 'd' && l) {
      e.preventDefault();
      A.duplicateLayer(l.id);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && l) {
      e.preventDefault();
      A.deleteLayer(l.id);
    } else if (['1', '2', '3'].includes(e.key)) {
      setView({ state: STATES[Number(e.key) - 1].id });
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
  if (f.type.startsWith('image/')) return A.addImageFromFile(f);
  if (f.type.startsWith('video/')) return toast('Videos bitte über „Video“ hinzufügen (Frame-Einstellungen).', 'info');
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
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  // mobile: panel collapse toggle
  $('#panelToggle')?.addEventListener('click', () => $('#app').classList.toggle('panel-collapsed'));
  window.__studio = { store, A };
}

boot().catch((e) => {
  console.error(e);
  document.body.append(el('pre', { class: 'fatal' }, `Fehler beim Start: ${e.message}`));
});
