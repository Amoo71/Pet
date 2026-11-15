// User actions that involve files, dialogs or several model changes.
import { store, update, select, setProject, flushSave } from './store.js';
import { newLayer, newProject, clone, uid, newAnim } from '../core/model.js';
import { buildTendies, buildBatter, validateProject, safeName, memoryEstimate } from '../core/tendies.js';
import { getDevice, guessDevice } from '../core/devices.js';
import { addImageFile, addAsset, addGifBytes, exportRender, ensureFont } from './assets.js';
import { extractFrames, probeVideo, FRAME_LIMIT } from '../browser/video.js';
import { importTendies } from '../browser/importer.js';
import { listProjects, getProject, saveProject } from '../browser/storage.js';
import { searchGifs, getSearchSettings, setSearchSettings, PROVIDERS } from '../browser/gifsearch.js';
import { el, pickFiles, toast, modal, progressModal, shareOrDownload, numField, toggleField, selectField, textField, segmented, button } from './dom.js';

export function addLayer(kind, props = {}) {
  const p = store.project;
  const l = newLayer(kind, p, props);
  const same = p.layers.filter((x) => x.kind === kind).length;
  if (same && !props.name) l.name = `${l.name} ${same + 1}`;
  update((proj) => proj.layers.push(l));
  select(l.id);
  return l;
}

export async function addImages(plane) {
  const files = await pickFiles('image/*', true);
  for (const f of files) {
    if (f.type === 'image/gif' || /\.gif$/i.test(f.name)) await addGifFile(f);
    else await addImageFromFile(f, plane);
  }
}

function fitSize(p, w, h, big) {
  if (big) {
    const k = Math.max(p._w / w, p._h / h);
    return Math.abs(w / h - p._w / p._h) > 0.02 ? [p._w, p._h] : [w * k, h * k];
  }
  const lw = Math.min(p._w * 0.8, w / 3);
  return [lw, lw * (h / w)];
}

export async function addImageFromFile(file, plane, layerProps = {}) {
  try {
    const { id, w, h } = await addImageFile(file);
    const p = store.project;
    const big = w >= p._w * 2 || h >= p._h * 2;
    const [lw, lh] = fitSize(p, w, h, big);
    return addLayer('image', {
      asset: id,
      name: file.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Image',
      w: Math.round(lw),
      h: Math.round(lh),
      fit: big ? 'cover' : 'stretch',
      plane: plane || (store.project.layers.length ? 'floating' : 'background'),
      ...layerProps,
    });
  } catch (e) {
    console.error(e);
    toast(`Couldn't load image: ${e.message}`, 'error');
  }
}

export async function replaceImage(layerId) {
  const [f] = await pickFiles('image/*');
  if (!f) return false;
  const { id } = await addImageFile(f);
  update((p) => {
    const l = p.layers.find((x) => x.id === layerId);
    if (l) l.asset = id;
  });
  return true;
}

// ---------------------------------------------------------------- GIF

async function gifToLayer(bytes, name, { sticker = false } = {}) {
  const pm = progressModal('Decoding GIF…');
  try {
    const g = await addGifBytes(bytes, { onProgress: (i, n) => pm.set(i, n, `Frame ${i} of ${n}`) });
    pm.close();
    const p = store.project;
    const big = !sticker && (g.width >= p._w * 0.8 || g.height >= p._h * 0.5);
    let w, h;
    if (big) [w, h] = [p._w, p._h];
    else {
      w = Math.min(p._w * 0.6, Math.max(120, g.width / 2));
      h = (w * g.height) / g.width;
    }
    if (g.single) return addLayer('image', { asset: g.frames[0], name, w: Math.round(w), h: Math.round(h), fit: big ? 'cover' : 'stretch', plane: big ? 'background' : 'floating' });
    const l = addLayer('video', {
      name,
      video: { frames: g.frames, sequence: g.sequence, fps: g.fps, autoreverse: false, calc: 'discrete', gif: true },
      w: Math.round(w),
      h: Math.round(h),
      fit: big ? 'cover' : 'stretch',
      plane: big ? 'background' : 'floating',
    });
    toast(`GIF added – ${g.frames.length} frames`, 'ok');
    return l;
  } catch (e) {
    pm.close();
    toast(`GIF failed: ${e.message}`, 'error', 6000);
  }
}

export async function addGifFile(file) {
  if (!file) [file] = await pickFiles('image/gif');
  if (!file) return;
  return gifToLayer(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.gif$/i, '').slice(0, 30) || 'GIF');
}

export function openGifSearch() {
  let settings = getSearchSettings();
  const state = { stickers: false, query: '', next: null, loading: false, ctrl: null };
  const grid = el('div', { class: 'gif-grid' });
  const status = el('p', { class: 'muted' });
  const input = el('input', { type: 'search', class: 'text gif-q', placeholder: 'Search GIFs…', enterkeyhint: 'search', autocomplete: 'off' });
  const more = button('Load more', () => run(true), 'subtle');
  more.hidden = true;
  const keyNote = el('div', { class: 'gif-key' });
  const renderKeyNote = () => {
    settings = getSearchSettings();
    const prov = PROVIDERS[settings.provider];
    const key = settings.provider === 'tenor' ? settings.tenorKey : settings.giphyKey;
    keyNote.innerHTML = '';
    if (key) return;
    const inp = el('input', { type: 'text', class: 'text', placeholder: `${prov.name} API key`, spellcheck: 'false' });
    keyNote.append(
      el('p', {}, [`GIF search uses ${prov.name}. Paste a free API key (stored only on this device). `, el('a', { href: prov.keyUrl, target: '_blank', rel: 'noopener' }, 'Get a key →')]),
      el('div', { class: 'row' }, [
        inp,
        button('Save', () => {
          const s = getSearchSettings();
          s[s.provider === 'tenor' ? 'tenorKey' : 'giphyKey'] = inp.value.trim();
          setSearchSettings(s);
          renderKeyNote();
          run();
        }, 'primary'),
      ])
    );
  };
  const run = async (append = false) => {
    if (state.loading) return;
    state.ctrl?.abort();
    state.ctrl = new AbortController();
    state.loading = true;
    status.textContent = 'Searching…';
    if (!append) {
      grid.innerHTML = '';
      state.next = null;
    }
    try {
      const r = await searchGifs(state.query, { stickers: state.stickers, offset: append ? Number(state.next) || 0 : 0, next: append ? state.next : null, signal: state.ctrl.signal });
      state.next = r.next;
      more.hidden = !r.next;
      for (const it of r.items) {
        if (!it.url) continue;
        const b = el('button', { type: 'button', class: 'gif-item', title: it.title }, el('img', { src: it.preview || it.url, loading: 'lazy', alt: it.title }));
        b.addEventListener('click', async () => {
          close();
          const pm = progressModal('Downloading GIF…');
          try {
            const res = await fetch(it.url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const bytes = new Uint8Array(await res.arrayBuffer());
            pm.close();
            await gifToLayer(bytes, (it.title || 'GIF').slice(0, 30), { sticker: state.stickers });
          } catch (e) {
            pm.close();
            toast(`Download failed: ${e.message}`, 'error');
          }
        });
        grid.append(b);
      }
      status.textContent = r.items.length ? PROVIDERS[getSearchSettings().provider].attribution : 'No results.';
    } catch (e) {
      if (e.name !== 'AbortError') status.textContent = e.message;
    } finally {
      state.loading = false;
    }
  };
  let t = 0;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => ((state.query = input.value), run()), 350);
  });
  const kind = segmented(
    [['gifs', 'GIFs'], ['stickers', 'Stickers (transparent)']],
    () => (state.stickers ? 'stickers' : 'gifs'),
    (v) => {
      state.stickers = v === 'stickers';
      kind.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      run();
    }
  );
  const close = modal('GIF search', [
    el('div', { class: 'gif-bar' }, [input, kind]),
    keyNote,
    grid,
    more,
    status,
  ], [
    ['Import GIF file…', (c) => (c(), addGifFile())],
    ['Settings', (c) => (c(), openSettings())],
  ]);
  renderKeyNote();
  setTimeout(() => input.focus(), 50);
  run();
}

export function openSettings() {
  const s = getSearchSettings();
  const save = () => setSearchSettings(s);
  modal('Settings', [
    el('h3', {}, 'GIF search'),
    selectField('Provider', [['giphy', 'GIPHY'], ['tenor', 'Tenor (Google)']], () => s.provider, (v) => ((s.provider = v), save())),
    textField('GIPHY key', () => s.giphyKey, (v) => ((s.giphyKey = v.trim()), save()), { placeholder: 'developers.giphy.com' }),
    textField('Tenor key', () => s.tenorKey, (v) => ((s.tenorKey = v.trim()), save()), { placeholder: 'Google Cloud → Tenor API' }),
    selectField('Content rating', [['g', 'G'], ['pg', 'PG'], ['pg-13', 'PG-13'], ['r', 'R']], () => s.rating, (v) => ((s.rating = v), save())),
    el('p', { class: 'muted' }, 'Keys are stored only in this browser and sent only to the selected provider.'),
  ]);
}

// ---------------------------------------------------------------- video

export async function addVideo(existingLayerId) {
  const [file] = await pickFiles('video/*,image/gif');
  if (!file) return;
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) return addGifFile(file);
  let info;
  try {
    info = await probeVideo(file);
  } catch {
    toast("This browser can't read that video. Tip: export it as MP4/MOV (H.264).", 'error', 6000);
    return;
  }
  const opts = { fps: 24, start: 0, end: Math.min(info.duration, 10), quality: 0.82, maxSide: 1290, autoreverse: false };
  const frames = () => Math.min(FRAME_LIMIT, Math.floor((opts.end - opts.start) * opts.fps));
  const est = el('p', { class: 'muted' });
  const refresh = () => (est.textContent = `≈ ${frames()} frames · ${(opts.end - opts.start).toFixed(1)} s · ${info.width}×${info.height}${frames() >= FRAME_LIMIT ? ' — capped at 400 frames (PosterBoard limit)' : ''}`);
  const wrapSet = (k) => (v) => ((opts[k] = v), refresh());
  const content = el('div', { class: 'form' }, [
    el('p', {}, 'The video is split into frames and embedded as a Core Animation keyframe sequence. Fewer frames = smaller file and smoother on device.'),
    numField('Start', () => opts.start, wrapSet('start'), { min: 0, max: info.duration, step: 0.1, unit: 's' }),
    numField('End', () => opts.end, wrapSet('end'), { min: 0, max: info.duration, step: 0.1, unit: 's' }),
    selectField('Frame rate', [[12, '12 fps (small)'], [15, '15 fps'], [20, '20 fps'], [24, '24 fps (film)'], [30, '30 fps (smooth)']], () => opts.fps, (v) => wrapSet('fps')(Number(v))),
    selectField('Resolution', [[720, '720 px'], [1080, '1080 px'], [1290, '1290 px (iPhone @3x)'], [1600, '1600 px']], () => opts.maxSide, (v) => wrapSet('maxSide')(Number(v))),
    numField('JPEG quality', () => opts.quality, wrapSet('quality'), { min: 0.4, max: 1, step: 0.02, slider: true }),
    toggleField('Boomerang (play back & forth)', () => opts.autoreverse, (v) => (opts.autoreverse = v)),
    est,
  ]);
  refresh();
  await new Promise((resolve) =>
    modal('Import video', content, [
      ['Cancel', (c) => (c(), resolve())],
      [
        'Create frames',
        async (c) => {
          c();
          const pm = progressModal('Extracting frames…');
          try {
            const { frames: blobs, width, height } = await extractFrames(file, { ...opts, signal: pm.signal, onProgress: (i, n) => pm.set(i, n, `Frame ${i} of ${n}`) });
            const ids = [];
            for (let i = 0; i < blobs.length; i++) {
              ids.push(await addAsset(blobs[i], { w: width, h: height }));
              if (i % 20 === 0) pm.set(i, blobs.length, `Saving ${i} / ${blobs.length}`);
            }
            const p = store.project;
            const video = { frames: ids, fps: opts.fps, autoreverse: opts.autoreverse, calc: 'discrete', duration: ids.length / opts.fps };
            if (existingLayerId) update((proj) => Object.assign(proj.layers.find((l) => l.id === existingLayerId), { video }));
            else {
              const k = Math.max(p._w / width, p._h / height);
              addLayer('video', { video, name: file.name.replace(/\.[^.]+$/, '').slice(0, 30), w: Math.round(width * k), h: Math.round(height * k), fit: 'cover' });
            }
            pm.close();
            toast(`${ids.length} frames imported`, 'ok');
          } catch (e) {
            pm.close();
            if (e.name !== 'AbortError') toast(`Video import failed: ${e.message}`, 'error', 6000);
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
  addLayer('video', { name: 'Image sequence', video: { frames: ids, fps: 12, autoreverse: false, calc: 'discrete' }, w: Math.round(w * k), h: Math.round(h * k), fit: 'contain' });
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

// ---------------------------------------------------------------- layer ops

export function duplicateLayer(id) {
  const src = store.project.layers.find((l) => l.id === id);
  if (!src) return;
  const copy = clone(src);
  copy.id = uid('L');
  copy.name = `${src.name} copy`;
  copy.x += 12;
  copy.y += 12;
  for (const a of copy.anims || []) a.id = uid('A');
  update((proj) => proj.layers.splice(proj.layers.findIndex((l) => l.id === id) + 1, 0, copy));
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
    const j = dir === 'top' ? same.length - 1 : dir === 'bottom' ? 0 : i + dir;
    if (j < 0 || j >= same.length || j === i) return;
    const idx = p.layers.indexOf(l);
    p.layers.splice(idx, 1);
    const target = same[j];
    const tIdx = p.layers.indexOf(target);
    p.layers.splice(j > i ? tIdx + 1 : tIdx, 0, l);
  });
}

export function align(id, how) {
  update((p) => {
    const l = p.layers.find((x) => x.id === id);
    const w = l.w * l.scale;
    const h = l.h * l.scale;
    if (how === 'left') l.x = w / 2;
    if (how === 'hcenter') l.x = p._w / 2;
    if (how === 'right') l.x = p._w - w / 2;
    if (how === 'top') l.y = h / 2;
    if (how === 'vcenter') l.y = p._h / 2;
    if (how === 'bottom') l.y = p._h - h / 2;
    if (how === 'fill') Object.assign(l, { x: p._w / 2, y: p._h / 2, w: p._w, h: p._h, scale: 1, rotation: 0 });
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
      if (full) [l.w, l.h] = [d.w, d.h];
      else {
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

// ---------------------------------------------------------------- browse public catalogs

export async function openBrowse(initial = 'apple') {
  const cat = await import('../browser/catalog.js');
  const state = { col: initial, q: '', items: [], shown: 60, ctrl: null };
  const grid = el('div', { class: 'cat-grid' });
  const status = el('p', { class: 'muted' }, 'Loading…');
  const more = button('Show more', () => ((state.shown += 60), draw()), 'subtle');
  const search = el('input', { type: 'search', class: 'text', placeholder: 'Search wallpapers…', id: 'catSearch', autocomplete: 'off' });
  const tabs = segmented(cat.COLLECTIONS.map((c) => [c.id, c.name]), () => state.col, (v) => {
    state.col = v;
    tabs.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    load();
  }, 'cat-tabs');
  const card = (w) => {
    const isVideo = /\.(mp4|mov|webm)$/i.test(w.preview);
    const media = w.preview ? (isVideo ? el('video', { src: w.preview, muted: true, autoplay: true, loop: true, playsinline: true }) : el('img', { src: w.preview, loading: 'lazy', alt: w.name })) : el('div', { class: 'cat-noimg' }, '◐');
    const c = el('div', { class: 'cat-card' }, [
      el('div', { class: 'cat-media' }, media),
      el('div', { class: 'cat-meta' }, [el('b', {}, w.name), el('small', {}, [w.author || w.source, w.description ? ` · ${w.description}` : ''])]),
      el('div', { class: 'btn-row' }, [button('Open', () => fetchAndOpen(w, false)), button('✨ Morph', () => fetchAndOpen(w, true), 'primary')]),
    ]);
    return c;
  };
  const draw = () => {
    const q = state.q.trim().toLowerCase();
    const list = q ? state.items.filter((w) => `${w.name} ${w.author || ''} ${w.description || ''}`.toLowerCase().includes(q)) : state.items;
    grid.innerHTML = '';
    list.slice(0, state.shown).forEach((w) => grid.append(card(w)));
    more.hidden = list.length <= state.shown;
    status.textContent = `${list.length} wallpaper${list.length === 1 ? '' : 's'} · from public GitHub repos (Placard sources)`;
  };
  const load = async () => {
    state.ctrl?.abort();
    state.ctrl = new AbortController();
    status.textContent = 'Loading…';
    grid.innerHTML = '';
    state.shown = 60;
    try {
      state.items = await cat.loadCollection(state.col, state.ctrl.signal);
      draw();
    } catch (e) {
      if (e.name !== 'AbortError') status.textContent = `Couldn’t load this collection (${e.message}). Check your connection.`;
    }
  };
  let t = 0;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => ((state.q = search.value), (state.shown = 60), draw()), 200);
  });
  const close = modal('🌐 Browse wallpapers', [el('div', { class: 'gif-bar' }, [search, tabs]), status, grid, more]);
  const fetchAndOpen = async (w, morph) => {
    close();
    const pm = progressModal(`Downloading “${w.name}”…`);
    try {
      const bytes = await cat.downloadTendies(w.url, (got, total) => pm.set(got, total, `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`), pm.signal);
      pm.close();
      const file = new File([bytes], `${w.name}.tendies`);
      const projects = await importTendiesFile(file);
      if (morph && projects?.length) await openEffects();
    } catch (e) {
      pm.close();
      if (e.name !== 'AbortError') toast(`Download failed: ${e.message}`, 'error', 6000);
    }
  };
  load();
}

// ---------------------------------------------------------------- effects / morph mode

function effectsForm(state) {
  const { EFFECTS, DUO_DEFAULTS } = state.mod;
  state.ids ||= new Set(state.applied?.length ? state.applied : ['duotilt']);
  state.duo ||= { ...DUO_DEFAULTS };
  const duoOpts = el('div', { class: 'form duo-opts' }, [
    numField('3D strength', () => state.duo.strength, (v) => (state.duo.strength = v), { min: 10, max: 90, step: 1, slider: true, unit: 'pt' }),
    numField('Fold angle', () => state.duo.angle, (v) => (state.duo.angle = v), { min: 15, max: 90, step: 1, slider: true, unit: '°' }),
    numField('Edge blur', () => state.duo.blur, (v) => (state.duo.blur = v), { min: 0, max: 60, step: 1, slider: true, unit: 'pt' }),
    numField('Edge shade', () => state.duo.shade, (v) => (state.duo.shade = v), { min: 0, max: 0.9, step: 0.02, slider: true }),
    toggleField('Folded on Lock, opens on unlock', () => state.duo.unlock, (v) => (state.duo.unlock = v)),
  ]);
  const grid = el('div', { class: 'fx-grid' }, EFFECTS.map((fx) => {
    const b = el('button', { type: 'button', class: `fx ${state.ids.has(fx.id) ? 'on' : ''}`, 'data-fx': fx.id, title: fx.desc }, [el('span', { class: 'fx-ico' }, fx.icon), el('b', {}, fx.name), el('small', {}, fx.desc)]);
    b.addEventListener('click', () => {
      state.ids.has(fx.id) ? state.ids.delete(fx.id) : state.ids.add(fx.id);
      b.classList.toggle('on', state.ids.has(fx.id));
      duoOpts.hidden = !state.ids.has('duo') && !state.ids.has('duotilt');
    });
    return b;
  }));
  duoOpts.hidden = !state.ids.has('duo') && !state.ids.has('duotilt');
  return [state.applied?.length ? el('p', { class: 'muted' }, 'Highlighted = already on this wallpaper. Tap one to turn it off, then Apply.') : null, grid, duoOpts, el('p', { class: 'muted' }, 'Duo fold, 3D tilt and gyro fade use gyro key paths beyond plain translation – experimental on device. Gyro needs the Modern format, effects switch to it automatically.')];
}

export async function openEffects() {
  const mod = await import('./effects.js');
  const state = { mod, applied: mod.appliedEffects(store.project) };
  const go = await new Promise((resolve) => modal('✨ Effects', effectsForm(state), [['Cancel', (c) => (c(), resolve(false))], ['Apply', (c) => (c(), resolve(true)), 'primary']]));
  if (!go) return;
  const pm = progressModal('Adding effects…');
  try {
    const apply = await mod.prepareEffects(store.project, [...state.ids], { duo: state.duo });
    let done = [];
    update((p) => (done = apply(p)));
    pm.close();
    toast(done.length ? `${done.join(', ')} – try ▶ Preview and tilt.` : 'No changes.', 'ok', 6000);
  } catch (e) {
    pm.close();
    console.error(e);
    toast(`Effects failed: ${e.message}`, 'error', 6000);
  }
}

/** Morph mode: import one or more .tendies, add effects to each, save them to the library. */
export async function morphTendies() {
  const files = await pickFiles('.tendies,.zip,application/zip,application/octet-stream', true);
  if (!files.length) return;
  const mod = await import('./effects.js');
  const state = { mod };
  const go = await new Promise((resolve) => modal(`Morph ${files.length} wallpaper${files.length > 1 ? 's' : ''}`, [el('p', {}, 'Pick the effects to add to every imported wallpaper. The originals stay untouched; morphed copies are saved to your library.'), ...effectsForm(state)], [['Cancel', (c) => (c(), resolve(false))], ['Morph', (c) => (c(), resolve(true)), 'primary']]));
  if (!go) return;
  const pm = progressModal('Morphing…');
  const results = [];
  try {
    for (let i = 0; i < files.length; i++) {
      pm.set(i, files.length, `${files[i].name} (${i + 1}/${files.length})`);
      const { projects, warnings } = await importTendies(await files[i].arrayBuffer(), (blob) => addAsset(blob));
      for (const w of warnings.slice(0, 2)) toast(`${files[i].name}: ${w}`, 'warn', 5000);
      for (const proj of projects) {
        const d = getDevice(proj.device);
        proj._w = d.w;
        proj._h = d.h;
        const apply = await mod.prepareEffects(proj, [...state.ids], { duo: state.duo });
        apply(proj);
        proj.name = `${proj.name} ✦`;
        proj.updated = Date.now();
        await saveProject(proj);
        results.push(proj);
      }
    }
    pm.close();
    if (!results.length) return toast('Nothing could be imported from those files.', 'warn');
    setProject(results[0]);
    if (results.length > 1)
      modal('Morph done', el('p', {}, `${results.length} wallpapers morphed and saved to your library.`), [
        ['Close', (c) => c()],
        ['Export all as collection', (c) => (c(), exportCollection(results.map((r) => r.id))), 'primary'],
      ]);
    else toast('Morphed copy saved – preview it, then Export.', 'ok', 5000);
  } catch (e) {
    pm.close();
    console.error(e);
    toast(`Morph failed: ${e.message}`, 'error', 6000);
  }
}

// ---------------------------------------------------------------- 3D photo (depth layers + gyro)

export async function add3DPhoto() {
  const [file] = await pickFiles('image/*');
  if (!file) return;
  const opts = { mode: 'ai', layers: 4, strength: 28, tilt: 6, front: true, zoom: true, replace: true };
  const modeSeg = segmented([['ai', 'AI (best)'], ['simple', 'Simple (offline)']], () => opts.mode, (v) => {
    opts.mode = v;
    modeSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  });
  const body = el('div', { class: 'form' }, [
    el('p', {}, 'Splits your picture into depth layers. Tilting the iPhone moves near layers more than far ones – the iPhone Duo style 3D depth effect.'),
    el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Depth from'), modeSeg]),
    el('p', { class: 'muted' }, 'AI downloads a ~27 MB depth model once (Depth Anything v2, runs on your device). Simple works offline: lower = nearer.'),
    numField('Layers', () => opts.layers, (v) => (opts.layers = Math.max(2, Math.min(6, Math.round(v)))), { min: 2, max: 6, step: 1, slider: true }),
    numField('Depth strength', () => opts.strength, (v) => (opts.strength = v), { min: 6, max: 60, step: 1, slider: true, unit: 'pt' }),
    numField('3D tilt', () => opts.tilt, (v) => (opts.tilt = v), { min: 0, max: 20, step: 1, slider: true, unit: '°' }),
    toggleField('Subject in front of clock', () => opts.front, (v) => (opts.front = v), 'Nearest layer goes above the clock (depth effect)'),
    toggleField('Zoom on unlock', () => opts.zoom, (v) => (opts.zoom = v), 'Background pushes in, subject settles while you swipe'),
    toggleField('Replace current layers', () => opts.replace, (v) => (opts.replace = v)),
  ]);
  const go = await new Promise((resolve) => modal('3D photo', body, [['Cancel', (c) => (c(), resolve(false))], ['Create 3D layers', (c) => (c(), resolve(true)), 'primary']]));
  if (!go) return;
  const pm = progressModal('Building 3D layers…');
  try {
    const { blobToImage } = await import('../browser/raster.js');
    const depthMod = await import('../browser/depth.js');
    const { blob } = await (await import('../browser/raster.js')).normaliseImage(file, { maxPx: 2400 });
    const img = await blobToImage(blob);
    let dm;
    if (opts.mode === 'ai') {
      try {
        dm = await depthMod.aiDepth(img, (f, t) => pm.set(f, 1, t));
      } catch (e) {
        console.warn('AI depth failed', e);
        toast('AI depth model couldn’t load here – using the simple depth instead.', 'warn', 6000);
      }
    }
    if (!dm) dm = depthMod.simpleDepth(256, Math.round((256 * img.height) / img.width));
    pm.set(0, opts.layers, 'Slicing layers…');
    const slices = await depthMod.sliceByDepth(img, dm, opts.layers);
    const { canvasToBlob } = await import('../browser/raster.js');
    const p = store.project;
    const N = opts.strength;
    const k = Math.max(p._w / img.width, p._h / img.height);
    const newLayers = [];
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      pm.set(i + 1, slices.length, `Saving layer ${i + 1} of ${slices.length}`);
      const b = await canvasToBlob(s.canvas, i === 0 ? 'image/jpeg' : 'image/png', 0.9);
      const id = await addAsset(b, { w: s.canvas.width, h: s.canvas.height });
      const par = Math.round(N * (0.15 + 0.85 * s.depthRank));
      const bleed = 1 + (2 * par + 8) / Math.min(p._w, p._h);
      const near = i === slices.length - 1;
      const l = newLayer('image', p, {
        asset: id,
        name: i === 0 ? '3D background' : near ? '3D subject' : `3D depth ${i}`,
        w: Math.round(img.width * k * bleed),
        h: Math.round(img.height * k * bleed),
        fit: 'cover',
        plane: near && opts.front ? 'floating' : 'background',
        parallax: par,
        gyro: { tilt: Math.round(opts.tilt * s.depthRank), fade: 'none', fadeMin: 0, fadeMax: 1 },
        states: opts.zoom ? { Unlock: { scale: i === 0 ? 1.08 : 1 + 0.04 * (1 - s.depthRank) }, Sleep: { scale: 0.97 } } : {},
      });
      newLayers.push(l);
    }
    update((proj) => {
      if (opts.replace) proj.layers = [];
      proj.layers.push(...newLayers);
      if (proj.format === 'classic') proj.format = 'modern';
      if (!proj.name || /^(New wallpaper|My Wallpaper)$/.test(proj.name)) proj.name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || '3D photo';
    });
    select(newLayers.at(-1).id);
    pm.close();
    toast('3D layers ready – switch to ▶ Preview and move the mouse (or 🧭 Motion on iPhone) to tilt.', 'ok', 7000);
  } catch (e) {
    console.error(e);
    pm.close();
    toast(`3D photo failed: ${e.message}`, 'error', 6000);
  }
}

export function setFormat(v) {
  const p = store.project;
  if (p.format === v) return;
  if (v === 'duo' && p.device !== 'iphone-duo') changeDevice('iphone-duo');
  if (v !== 'duo' && p.device === 'iphone-duo') changeDevice(guessDevice() === 'iphone-duo' ? 'iphone-17-pro' : guessDevice());
  update((pp) => (pp.format = v));
}

export function addAnimation(layerId, preset = 'float') {
  update((p) => p.layers.find((l) => l.id === layerId).anims.push(newAnim(preset)));
}

// ---------------------------------------------------------------- export / import

function confirmIssues(issues) {
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) {
    modal("Can't export yet", el('ul', { class: 'issues' }, errors.map((i) => el('li', { class: 'issue-error' }, i.msg))), [['OK', (c) => c(), 'primary']]);
    return false;
  }
  return true;
}

export function openExport() {
  const p = store.project;
  const issues = validateProject(p);
  const opts = { format: p.format || 'modern', scale: 3 };
  const mem = el('p', { class: 'muted' });
  const refreshMem = () => (mem.textContent = `Estimated decoded memory ≈ ${Math.round(memoryEstimate(p) * (opts.scale / 3) ** 2)} MB`);
  refreshMem();
  const body = el('div', { class: 'export' }, [
    el('div', { class: 'format-cards' }, [
      formatCard('modern', 'Modern', 'iOS 26 / 27', ['Follows your finger when swiping', 'Gyro parallax', 'iOS 27 depth fix (Clownfish)', 'Liquid Glass'], opts),
      formatCard('duo', 'Duo', 'only iPhone Duo · iOS 27', ['Cover + inner screen, portrait & landscape', 'Gyro, 3D, depth', 'Won’t appear on regular iPhones'], opts),
      formatCard('classic', 'Classic', 'iOS 17 – 26', ['Spring animation after unlock', 'Light / Dark variants', 'Most compatible with older tools'], opts),
    ]),
    el('p', { class: 'muted' }, 'Placard tip: Classic uses exactly the structure of community wallpapers verified on iOS 27.2 – if a Modern wallpaper doesn’t show up in Collections, export Classic. After installing, respring (Placard → refresh) and look under + → Collections.'),
    selectField('Quality', [[3, 'Best (@3x)'], [2, 'Performance (@2x, smaller)']], () => opts.scale, (v) => ((opts.scale = Number(v)), refreshMem())),
    mem,
    issues.length ? el('ul', { class: 'issues' }, issues.map((i) => el('li', { class: `issue-${i.level}` }, i.msg))) : el('p', { class: 'ok-note' }, '✓ Ready to export'),
  ]);
  modal('Export wallpaper', body, [
    ['Nugget template (.batter)', (c) => (c(), exportBatter(opts))],
    ['Export .tendies', (c) => (c(), exportTendies(opts)), 'primary'],
  ]);
}

function formatCard(id, title, sub, bullets, opts) {
  const card = el('button', { type: 'button', class: `format-card ${opts.format === id ? 'on' : ''}`, 'data-format': id }, [
    el('b', {}, title),
    el('small', {}, sub),
    el('ul', {}, bullets.map((b) => el('li', {}, b))),
  ]);
  card.addEventListener('click', () => {
    opts.format = id;
    card.parentNode.querySelectorAll('.format-card').forEach((c) => c.classList.toggle('on', c.dataset.format === id));
    if (store.project.format !== id) setFormat(id);
  });
  return card;
}

const withScale = (p, scale) => ({ ...p, exportScale: scale || 3 });

export async function exportTendies(o = {}) {
  const p = store.project;
  if (o.format && p.format !== o.format) update((pp) => (pp.format = o.format));
  if (!confirmIssues(validateProject(p))) return;
  const pm = progressModal('Building .tendies…');
  try {
    await flushSave();
    pm.set(1, 3, 'Rendering layers…');
    const zip = await buildTendies(withScale(store.project, o.scale), exportRender);
    pm.set(3, 3, `Done – ${(zip.length / 1024 / 1024).toFixed(2)} MB`);
    pm.close();
    const r = await shareOrDownload(zip, `${safeName(p.name)}.tendies`);
    if (r !== 'cancelled') toast('.tendies ready ✓ – install it with Nugget, Pocket Poster, Placard…', 'ok', 5000);
  } catch (e) {
    console.error(e);
    pm.close();
    toast(`Export failed: ${e.message}`, 'error', 6000);
  }
}

export async function exportBatter(o = {}) {
  const p = store.project;
  if (!confirmIssues(validateProject(p))) return;
  if (!p.layers.some((l) => l.nuggetOption)) toast('Tip: mark layers as “Customizable in Nugget” (Style tab), otherwise the template has no options.', 'info', 6000);
  try {
    const zip = await buildBatter(withScale(p, o.scale), exportRender, { title: p.name });
    await shareOrDownload(zip, `${safeName(p.name)}.batter`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, 'error');
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
      toast(`“${p.name}” has errors and was skipped.`, 'warn');
      continue;
    }
    projects.push(p);
  }
  if (!projects.length) return;
  if (projects.length > 10) toast('More than 10 wallpapers – Nugget accepts at most 10 per run.', 'warn', 6000);
  const pm = progressModal(`Collection of ${projects.length} wallpapers…`);
  try {
    const zip = await buildTendies(projects, exportRender, { ordered: true });
    pm.close();
    await shareOrDownload(zip, `Collection-${projects.length}.tendies`);
  } catch (e) {
    pm.close();
    toast(`Export failed: ${e.message}`, 'error');
  }
}

export async function importTendiesFile(file) {
  if (!file) [file] = await pickFiles('.tendies,.zip,.batter,application/zip,application/octet-stream');
  if (!file) return null;
  const pm = progressModal('Importing…');
  try {
    const { projects, warnings } = await importTendies(await file.arrayBuffer(), (blob) => addAsset(blob));
    pm.close();
    for (const w of warnings.slice(0, 4)) toast(w, 'warn', 6000);
    for (const p of projects) await saveProject(p);
    if (projects[0]) setProject(projects[0]);
    toast(`${projects.length} wallpaper(s) imported`, 'ok');
    return projects;
  } catch (e) {
    pm.close();
    toast(`Import failed: ${e.message}`, 'error', 6000);
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
