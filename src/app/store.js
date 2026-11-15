// Central app state with undo/redo and debounced autosave.
import { clone, migrateProject } from '../core/model.js';
import { getDevice } from '../core/devices.js';
import { saveProject } from '../browser/storage.js';

const listeners = new Set();
const MAX_UNDO = 120;

export const store = {
  project: null,
  selection: null, // layer id
  view: {
    state: 'Locked',
    dark: false,
    clock: true,
    tab: 'layers',
    mode: 'edit', // edit | preview
    progress: 0, // 0 = Lock … 1 = Home (swipe scrub)
    zoom: 0, // 0 = fit
  },
  undo: [],
  redo: [],
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let raf = 0;
export function emit(reason = 'change') {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    for (const fn of listeners) fn(reason);
  });
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (store.project) saveProject(store.project).catch((e) => console.warn('save failed', e));
  }, 400);
}
export function flushSave() {
  clearTimeout(saveTimer);
  if (store.project) return saveProject(store.project);
}

export function setProject(p) {
  if ((p.v || 1) < 2) migrateProject(p);
  const d = getDevice(p.device);
  p._w = d.w;
  p._h = d.h;
  store.project = p;
  store.selection = p.layers.at(-1)?.id || null;
  store.undo = [];
  store.redo = [];
  emit('project');
}

let lastGroup = null;
let lastGroupTime = 0;
/**
 * Mutate the project. Consecutive calls with the same `group` within 800 ms
 * merge into one undo step (e.g. slider drags, typing).
 */
export function update(fn, group = null) {
  const p = store.project;
  if (!p) return;
  const now = performance.now();
  if (!(group && group === lastGroup && now - lastGroupTime < 800)) {
    store.undo.push(JSON.stringify(p));
    if (store.undo.length > MAX_UNDO) store.undo.shift();
    store.redo = [];
  }
  lastGroup = group;
  lastGroupTime = now;
  fn(p);
  p.updated = Date.now();
  scheduleSave();
  emit('edit');
}

export function undo() {
  if (!store.undo.length) return;
  store.redo.push(JSON.stringify(store.project));
  store.project = JSON.parse(store.undo.pop());
  fixSelection();
  lastGroup = null;
  scheduleSave();
  emit('history');
}

export function redo() {
  if (!store.redo.length) return;
  store.undo.push(JSON.stringify(store.project));
  store.project = JSON.parse(store.redo.pop());
  fixSelection();
  lastGroup = null;
  scheduleSave();
  emit('history');
}

function fixSelection() {
  if (!store.project.layers.some((l) => l.id === store.selection)) store.selection = store.project.layers.at(-1)?.id || null;
}

export const selectedLayer = () => store.project?.layers.find((l) => l.id === store.selection) || null;

export function select(id) {
  store.selection = id;
  emit('select');
}

export function setView(patch) {
  Object.assign(store.view, patch);
  emit('view');
}

export { clone };
