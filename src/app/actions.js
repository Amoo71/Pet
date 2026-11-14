// User actions that involve files, dialogs or several model changes.
import { store, update, select, setProject, flushSave } from './store.js';
import { newLayer, newProject, clone, uid, EMITTER_PRESETS } from '../core/model.js';
import { buildTendies, buildBatter, validateProject, safeName } from '../core/tendies.js';
import { getDevice, guessDevice } from '../core/devices.js';
import { addImageFile, addAsset, exportRender, ensureFont } from './assets.js';
import { extractFrames, probeVideo, FRAME_LIMIT } from '../browser/video.js';
import { importTendies } from '../browser/importer.js';
import { listProjects, getProject } from '../browser/storage.js';
import { el, pickFiles, toast, modal, progressModal, shareOrDownload, numField, toggleField, selectField } from './dom.js';

export function addLayer(kind, props = {}) {
  const p = store.project;
  const l = newLayer(kind, p, props);
  // name uniquely
  const same = p.layers.filter((x) => x.kind === kind).length;
  if (same && !props.name) l.name = `${l.name} ${same + 1}`;
  update((proj) => proj.layers.push(l));
  select(l.id);
  return l;
}

export async function addImages(plane) {
  const files = await pickFiles('image/*', true);
  for (const f of files) await addImageFromFile(f, plane);
}

export async function addImageFromFile(file, plane, layerProps = {}) {
  try {
    const { id, w, h } = await addImageFile(file);
    const p = store.project;
    // cover the screen for big images, otherwise fit at native @3x size
    const big = w >= p._w * 2 || h >= p._h * 2;
    let lw, lh;
    if (big) {
      const k = Math.max(p._w / w, p._h / h);
      lw = w * k;
      lh = h * k;
      if (Math.abs(w / h - p._w / p._h) > 0.02) {
        lw = p._w;
        lh = p._h;
      }
    } else {
      lw = Math.min(p._w * 0.8, w / 3);
      lh = lw * (h / w);
    }
    return addLayer('image', {
      asset: id,
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Bild',
      w: Math.round(lw),
      h: Math.round(lh),
      fit: big ? 'cover' : 'stretch',
      plane: plane || (store.project.layers.length ? 'floating' : 'background'),
      ...layerProps,
    });
  } catch (e) {
    console.error(e);
    toast(`Bild konnte nicht geladen werden: ${e.message}`, 'error');
  }
}

export async function replaceImage(layerId) {
  const [f] = await pickFiles('image/*');
  if (!f) return;
  const { id } = await addImageFile(f);
  update((p) => {
    const l = p.layers.find((x) => x.id === layerId);
    if (l) l.asset = id;
  });
}

export async function addVideo(existingLayerId) {
  const [file] = await pickFiles('video/*,image/gif');
  if (!file) return;
  let info;
  try {
    info = await probeVideo(file);
  } catch (e) {
    toast('Dieses Video kann der Browser nicht lesen. Tipp: als MP4/MOV (H.264) speichern.', 'error', 6000);
    return;
  }
  const opts = { fps: 24, start: 0, end: Math.min(info.duration, 10), quality: 0.82, maxSide: 1290, autoreverse: false };
  const frames = () => Math.min(FRAME_LIMIT, Math.floor((opts.end - opts.start) * opts.fps));
  const est = el('p', { class: 'muted' });
  const refresh = () => (est.textContent = `≈ ${frames()} Frames · ${(opts.end - opts.start).toFixed(1)} s · ${info.width}×${info.height}${frames() >= FRAME_LIMIT ? ' — auf 400 Frames begrenzt (PosterBoard-Limit)' : ''}`);
  const wrapSet = (k) => (v) => ((opts[k] = v), refresh());
  const content = el('div', {}, [
    el('p', {}, 'Das Video wird in Einzelbilder zerlegt und als Core-Animation-Keyframe-Sequenz eingebettet (wie Nuggets VideoCAML). Weniger Frames = kleinere Datei & flüssiger auf dem Gerät.'),
    numField('Start', () => opts.start, wrapSet('start'), { min: 0, max: info.duration, step: 0.1, unit: 's' }),
    numField('Ende', () => opts.end, wrapSet('end'), { min: 0, max: info.duration, step: 0.1, unit: 's' }),
    selectField('Bildrate', [[12, '12 fps (klein)'], [15, '15 fps'], [20, '20 fps'], [24, '24 fps (Film)'], [30, '30 fps (flüssig)']], () => opts.fps, (v) => wrapSet('fps')(Number(v))),
    selectField('Auflösung', [[720, '720 px'], [1080, '1080 px'], [1290, '1290 px (iPhone @3x)'], [1600, '1600 px']], () => opts.maxSide, (v) => wrapSet('maxSide')(Number(v))),
    numField('JPEG-Qualität', () => opts.quality, wrapSet('quality'), { min: 0.4, max: 1, step: 0.02, slider: true }),
    toggleField('Hin & zurück (Boomerang)', () => opts.autoreverse, (v) => (opts.autoreverse = v)),
    est,
  ]);
  refresh();
  await new Promise((resolve) =>
    modal('Video importieren', content, [
      ['Abbrechen', (c) => (c(), resolve())],
      [
        'Frames erzeugen',
        async (c) => {
          c();
          const pm = progressModal('Video wird zerlegt …');
          try {
            const { frames: blobs, width, height } = await extractFrames(file, { ...opts, signal: pm.signal, onProgress: (i, n) => pm.set(i, n, `Frame ${i} von ${n}`) });
            pm.set(0, 1, 'Speichere Frames …');
            const ids = [];
            for (let i = 0; i < blobs.length; i++) {
              ids.push(await addAsset(blobs[i], { w: width, h: height }));
              if (i % 20 === 0) pm.set(i, blobs.length, `Speichere ${i} / ${blobs.length}`);
            }
            const p = store.project;
            const video = { frames: ids, fps: opts.fps, autoreverse: opts.autoreverse, calc: 'discrete', duration: ids.length / opts.fps };
            if (existingLayerId) {
              update((proj) => Object.assign(proj.layers.find((l) => l.id === existingLayerId), { video }));
            } else {
              const k = Math.max(p._w / width, p._h / height);
              addLayer('video', { video, name: file.name.replace(/\.[^.]+$/, '').slice(0, 30), w: Math.round(width * k), h: Math.round(height * k), fit: 'cover' });
            }
            pm.close();
            toast(`${ids.length} Frames importiert`, 'ok');
          } catch (e) {
            pm.close();
            if (e.name !== 'AbortError') toast(`Video-Import fehlgeschlagen: ${e.message}`, 'error', 6000);
          }
          resolve();
        },
        'primary',
      ],
    ])
  );
}

export async function addFrameSequence() {
  const files = (await pickFiles('image/*', true)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!files.length) return;
  const ids = [];
  let w = 0, h = 0;
  for (const f of files.slice(0, FRAME_LIMIT)) {
    const r = await addImageFile(f);
    ids.push(r.id);
    w = r.w;
    h = r.h;
  }
  const p = store.project;
  const k = Math.min(p._w / w, p._h / h);
  addLayer('video', { name: 'Bildfolge', video: { frames: ids, fps: 12, autoreverse: false, calc: 'discrete' }, w: Math.round(w * k), h: Math.round(h * k), fit: 'contain' });
}

export async function uploadFont(layerId) {
  const [f] = await pickFiles('.ttf,.otf,.woff,.woff2,font/*');
  if (!f) return;
  const id = await addAsset(f, { name: f.name });
  await ensureFont(id);
  update((p) => {
    const l = p.layers.find((x) => x.id === layerId);
    if (l) l.text = { ...l.text, fontAsset: id, fontName: f.name };
  });
}

export async function uploadParticle(layerId) {
  const [f] = await pickFiles('image/*');
  if (!f) return;
  const { id } = await addImageFile(f);
  update((p) => {
    const l = p.layers.find((x) => x.id === layerId);
    if (l) l.emitter = { ...l.emitter, particleAsset: id };
  });
}

export function duplicateLayer(id) {
  const p = store.project;
  const src = p.layers.find((l) => l.id === id);
  if (!src) return;
  const copy = clone(src);
  copy.id = uid('L');
  copy.name = `${src.name} Kopie`;
  copy.x += 12;
  copy.y += 12;
  update((proj) => proj.layers.splice(proj.layers.indexOf(proj.layers.find((l) => l.id === id)) + 1, 0, copy));
  select(copy.id);
}

export function deleteLayer(id) {
  update((p) => (p.layers = p.layers.filter((l) => l.id !== id)));
  select(store.project.layers.at(-1)?.id || null);
}

export function moveLayer(id, dir) {
  update((p) => {
    const l = p.layers.find((x) => x.id === id);
    const same = p.layers.filter((x) => x.plane === l.plane);
    const i = same.indexOf(l);
    const j = i + dir;
    if (j < 0 || j >= same.length) return;
    const a = p.layers.indexOf(l);
    const b = p.layers.indexOf(same[j]);
    [p.layers[a], p.layers[b]] = [p.layers[b], p.layers[a]];
  });
}

export function changeDevice(id) {
  const d = getDevice(id);
  update((p) => {
    const sx = d.w / p._w;
    const sy = d.h / p._h;
    for (const l of p.layers) {
      const full = Math.abs(l.w - p._w) < 1 && Math.abs(l.h - p._h) < 1;
      l.x *= sx;
      l.y *= sy;
      if (full) {
        l.w = d.w;
        l.h = d.h;
      } else {
        const k = Math.min(sx, sy);
        l.w *= k;
        l.h *= k;
      }
      for (const s of Object.values(l.states)) {
        if ('x' in s) s.x *= sx;
        if ('y' in s) s.y *= sy;
      }
    }
    p.device = id;
    p._w = d.w;
    p._h = d.h;
  });
}

// ---------- export / import ----------

function confirmIssues(issues) {
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) {
    modal('Export nicht möglich', el('ul', { class: 'issues' }, errors.map((i) => el('li', { class: 'issue-error' }, i.msg))), [['OK', (c) => c(), 'primary']]);
    return false;
  }
  return true;
}

export async function exportTendies() {
  const p = store.project;
  if (!confirmIssues(validateProject(p))) return;
  const pm = progressModal('Erzeuge .tendies …');
  try {
    await flushSave();
    pm.set(1, 3, 'Rendere Ebenen …');
    const zip = await buildTendies(p, exportRender);
    pm.set(3, 3, `Fertig – ${(zip.length / 1024 / 1024).toFixed(2)} MB`);
    pm.close();
    const r = await shareOrDownload(zip, `${safeName(p.name)}.tendies`);
    if (r !== 'cancelled') toast('.tendies erstellt ✓ – jetzt mit Nugget, Pocket Poster o. Ä. installieren', 'ok', 5000);
  } catch (e) {
    console.error(e);
    pm.close();
    toast(`Export fehlgeschlagen: ${e.message}`, 'error', 6000);
  }
}

export async function exportBatter() {
  const p = store.project;
  if (!confirmIssues(validateProject(p))) return;
  if (!p.layers.some((l) => l.nuggetOption)) {
    toast('Tipp: Markiere unter „Eigenschaften“ Ebenen als „In Nugget anpassbar“, sonst hat die Vorlage keine Optionen.', 'info', 6000);
  }
  try {
    const zip = await buildBatter(p, exportRender, { title: p.name });
    await shareOrDownload(zip, `${safeName(p.name)}.batter`);
  } catch (e) {
    toast(`Export fehlgeschlagen: ${e.message}`, 'error');
  }
}

export async function exportCollection(ids) {
  const projects = [];
  for (const id of ids) {
    const p = id === store.project?.id ? store.project : await getProject(id);
    if (!p) continue;
    const d = getDevice(p.device);
    p._w = d.w;
    p._h = d.h;
    if (validateProject(p).some((i) => i.level === 'error')) {
      toast(`„${p.name}“ hat Fehler und wird übersprungen.`, 'warn');
      continue;
    }
    projects.push(p);
  }
  if (!projects.length) return;
  if (projects.length > 10) toast('Mehr als 10 Wallpaper – Nugget erlaubt maximal 10 pro Vorgang.', 'warn', 6000);
  const pm = progressModal(`Sammlung mit ${projects.length} Wallpapern …`);
  try {
    const zip = await buildTendies(projects, exportRender, { ordered: true });
    pm.close();
    await shareOrDownload(zip, `Sammlung-${projects.length}.tendies`);
  } catch (e) {
    pm.close();
    toast(`Export fehlgeschlagen: ${e.message}`, 'error');
  }
}

export async function importTendiesFile(file) {
  if (!file) [file] = await pickFiles('.tendies,.zip,.batter,application/zip,application/octet-stream');
  if (!file) return null;
  const pm = progressModal('Importiere …');
  try {
    const { projects, warnings } = await importTendies(await file.arrayBuffer(), (blob) => addAsset(blob));
    pm.close();
    for (const w of warnings.slice(0, 4)) toast(w, 'warn', 6000);
    const { saveProject } = await import('../browser/storage.js');
    for (const p of projects) await saveProject(p);
    if (projects[0]) setProject(projects[0]);
    toast(`${projects.length} Wallpaper importiert`, 'ok');
    return projects;
  } catch (e) {
    pm.close();
    toast(`Import fehlgeschlagen: ${e.message}`, 'error', 6000);
    return null;
  }
}

export function createProject(template) {
  const id = guessDevice();
  const d = getDevice(id);
  const p = newProject(id, d);
  if (template) template(p);
  setProject(p);
  flushSave();
  return p;
}

export async function openLatestOrNew() {
  const list = await listProjects();
  if (list.length) {
    setProject(list[0]);
    return;
  }
  const { TEMPLATES } = await import('./templates.js');
  createProject(TEMPLATES[0].build);
}

export { EMITTER_PRESETS };
