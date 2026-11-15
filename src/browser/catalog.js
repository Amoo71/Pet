// Public wallpaper catalogs (the same sources Placard browses):
//  * Apple   – official Apple wallpapers as .tendies (SerStars/nugget-wallpapers, wallpapers-apple.json)
//  * Nugget  – community wallpapers (SerStars/nugget-wallpapers, wallpapers-custom.json)
//  * CAP     – CAPlayground gallery (CAPlayground/wallpapers, wallpapers.json)
//  * Plus    – community repos in the "repo.json" package format (LSNguyen, SpyG, Denrindz)
// Files are fetched straight from raw.githubusercontent.com (CORS enabled).

const RAW = 'https://raw.githubusercontent.com/';
const NUGGET = `${RAW}SerStars/nugget-wallpapers/main/`;
const CAP = `${RAW}CAPlayground/wallpapers/main/`;
const PLUS = [
  { base: `${RAW}nguyenls3005-cell/LSNguyen-repo/main/`, json: 'repo.json', name: 'LSNguyen' },
  { base: `${RAW}SpyGdev/3105-repo/refs/heads/main/`, json: 'repositories/purple/repo.json', name: 'SpyG', absolute: true },
  { base: `${RAW}tnt300709-debug/-my-3105-repo/main/`, json: 'repo.json', name: 'Denrindz' },
];

export const COLLECTIONS = [
  { id: 'apple', name: 'Apple' },
  { id: 'nugget', name: 'Nugget' },
  { id: 'cap', name: 'CAPlayground' },
  { id: 'plus', name: 'Community' },
];

const abs = (base, u) => (!u ? '' : /^https?:\/\//.test(u) ? u : base + u.replace(/^\.?\//, '').split('/').map(encodeURIComponent).join('/'));
const cache = new Map();

async function getJSON(url, signal) {
  const r = await fetch(url, { signal, cache: 'force-cache' });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.json();
}

/** @returns {Promise<{name,description,author,url,preview,source}[]>} */
export async function loadCollection(id, signal) {
  if (cache.has(id)) return cache.get(id);
  let items = [];
  if (id === 'apple' || id === 'nugget') {
    const list = await getJSON(`${NUGGET}${id === 'apple' ? 'wallpapers-apple.json' : 'wallpapers-custom.json'}`, signal);
    items = list.map((w) => ({ name: w.name, description: w.description, author: w.authors, url: abs(NUGGET, w.url), preview: abs(NUGGET, w.preview), source: id }));
  } else if (id === 'cap') {
    const j = await getJSON(`${CAP}wallpapers.json`, signal);
    items = [...(j.wallpapers || [])].sort((a, b) => (b.date || 0) - (a.date || 0)).map((w) => ({ name: w.name, description: w.description, author: w.creator, url: abs(CAP, w.file), preview: abs(CAP, w.preview), source: 'cap' }));
  } else if (id === 'plus') {
    const results = await Promise.allSettled(PLUS.map((r) => getJSON(r.base + r.json, signal).then((j) => ({ r, j }))));
    for (const res of results) {
      if (res.status !== 'fulfilled') continue;
      const { r, j } = res.value;
      for (const p of j.packages || []) {
        if (!(p.kind === 'wallpaper' || /\.tendies$/i.test(p.download || '')) || !p.download) continue;
        items.push({ name: p.name, description: p.description || p.summary, author: p.author, url: abs(r.base, p.download), preview: abs(r.base, p.icon), source: r.name });
      }
    }
  }
  // de-duplicate by url
  const seen = new Set();
  items = items.filter((w) => w.url && !seen.has(w.url) && seen.add(w.url));
  cache.set(id, items);
  return items;
}

export async function downloadTendies(url, onProgress, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got, total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
