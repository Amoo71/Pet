// IndexedDB persistence: projects (JSON) + assets (Blobs). Falls back to memory.

const DB = 'tendies-studio';
const VER = 1;
let dbp = null;
const mem = { projects: new Map(), assets: new Map() };

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => (result = r));
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));

export async function saveProject(p) {
  const copy = JSON.parse(JSON.stringify(p));
  return tx('projects', 'readwrite', (s) => (s ? s.put(copy) : mem.projects.set(p.id, copy)));
}

export async function listProjects() {
  const db = await open();
  if (!db) return [...mem.projects.values()];
  return tx('projects', 'readonly', (s) => reqP(s.getAll())).then((r) => r.sort((a, b) => b.updated - a.updated));
}

export async function getProject(id) {
  const db = await open();
  if (!db) return mem.projects.get(id);
  return tx('projects', 'readonly', (s) => reqP(s.get(id)));
}

export async function deleteProject(id) {
  return tx('projects', 'readwrite', (s) => (s ? s.delete(id) : mem.projects.delete(id)));
}

export async function putAsset(asset) {
  return tx('assets', 'readwrite', (s) => (s ? s.put(asset) : mem.assets.set(asset.id, asset)));
}

export async function getAsset(id) {
  const db = await open();
  if (!db) return mem.assets.get(id);
  return tx('assets', 'readonly', (s) => reqP(s.get(id)));
}

/** Remove assets no project references any more. */
export async function collectGarbage() {
  const projects = await listProjects();
  const used = new Set();
  for (const p of projects)
    for (const l of p.layers) {
      if (l.asset) used.add(l.asset);
      if (l.text?.fontAsset) used.add(l.text.fontAsset);
      if (l.emitter?.particleAsset) used.add(l.emitter.particleAsset);
      for (const f of l.video?.frames || []) used.add(f);
    }
  const db = await open();
  if (!db) return;
  const keys = await tx('assets', 'readonly', (s) => reqP(s.getAllKeys()));
  const dead = keys.filter((k) => !used.has(k));
  if (dead.length) await tx('assets', 'readwrite', (s) => dead.forEach((k) => s.delete(k)));
  return dead.length;
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}
