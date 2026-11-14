// Asset cache: Blob storage, object URLs for preview, rendered layer bitmaps, fonts.
import { putAsset, getAsset } from '../browser/storage.js';
import { uid } from '../core/model.js';
import { renderLayerCanvas, renderParticleCanvas, contentSignature, canvasToBlob, normaliseImage, blobToImage } from '../browser/raster.js';

const blobs = new Map(); // id -> Blob
const urls = new Map(); // id -> objectURL
const meta = new Map(); // id -> {w,h,type,name}
const fonts = new Set();

export async function addAsset(blob, extra = {}) {
  const id = uid('a');
  const rec = { id, blob, type: blob.type, created: Date.now(), ...extra };
  await putAsset(rec);
  blobs.set(id, blob);
  meta.set(id, rec);
  return id;
}

/** Import an image file → normalised asset id + intrinsic size. */
export async function addImageFile(file) {
  const { blob, w, h } = await normaliseImage(file);
  const id = await addAsset(blob, { w, h, name: file.name });
  return { id, w, h };
}

export async function getBlob(id) {
  if (!id) return null;
  if (blobs.has(id)) return blobs.get(id);
  const rec = await getAsset(id);
  if (!rec) return null;
  blobs.set(id, rec.blob);
  meta.set(id, rec);
  return rec.blob;
}

export function assetMeta(id) {
  return meta.get(id);
}

export async function assetURL(id) {
  if (!id) return null;
  if (urls.has(id)) return urls.get(id);
  const b = await getBlob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}

export function cachedURL(id) {
  return urls.get(id) || null;
}

export async function ensureFont(id) {
  if (!id || fonts.has(id)) return;
  const b = await getBlob(id);
  if (!b) return;
  try {
    const ff = new FontFace(`tf-${id}`, await b.arrayBuffer());
    await ff.load();
    document.fonts.add(ff);
    fonts.add(id);
  } catch (e) {
    console.warn('font load failed', e);
  }
}

// ---------- layer bitmaps (preview + export) ----------

const layerCache = new Map(); // signature -> {url, blob}

/** Returns an object URL with the layer's content bitmap (for preview). */
export async function layerBitmapURL(layer) {
  if (layer.kind === 'image') return assetURL(layer.asset);
  if (layer.kind === 'video') return assetURL(layer.video?.frames?.[0]);
  const sig = contentSignature(layer);
  const hit = layerCache.get(sig);
  if (hit) return hit.url;
  const blob = await renderLayerBlob(layer);
  const url = URL.createObjectURL(blob);
  layerCache.set(sig, { url, blob });
  if (layerCache.size > 200) {
    const [k, v] = layerCache.entries().next().value;
    URL.revokeObjectURL(v.url);
    layerCache.delete(k);
  }
  return url;
}

async function renderLayerBlob(layer, scale = 3) {
  if (layer.kind === 'text' && layer.text?.fontAsset) await ensureFont(layer.text.fontAsset);
  if (layer.kind === 'text') await document.fonts?.ready;
  if (layer.kind === 'emitter') {
    if (layer.emitter?.particleAsset) return getBlob(layer.emitter.particleAsset);
    return canvasToBlob(renderParticleCanvas(layer.emitter?.particle));
  }
  return canvasToBlob(renderLayerCanvas(layer, scale));
}

const extOf = (blob) => (blob?.type === 'image/jpeg' ? 'jpg' : 'png');
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

/** render() callback for core/tendies.js */
export async function exportRender(layer, project) {
  const scale = 3;
  if (layer.kind === 'image') {
    const b = await getBlob(layer.asset);
    if (!b) return null;
    return { bytes: await bytesOf(b), ext: extOf(b) };
  }
  if (layer.kind === 'video') {
    const frames = [];
    for (const id of layer.video?.frames || []) {
      const b = await getBlob(id);
      if (b) frames.push({ bytes: await bytesOf(b), ext: extOf(b) });
    }
    return frames.length ? { frames } : null;
  }
  const sig = contentSignature(layer);
  let blob = layerCache.get(sig)?.blob;
  if (!blob) blob = await renderLayerBlob(layer, scale);
  return { bytes: await bytesOf(blob), ext: extOf(blob) };
}

/** Small JPEG thumbnail of a whole project (for the library). */
export async function projectThumbnail(project, width = 180) {
  const f = width / project._w;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round(project._h * f);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  for (const plane of ['background', 'floating', 'foreground']) {
    for (const l of project.layers.filter((x) => x.plane === plane && !x.hidden)) {
      if (l.kind === 'emitter') continue;
      const url = await layerBitmapURL(l);
      if (!url) continue;
      try {
        const img = await blobToImage(await (await fetch(url)).blob());
        ctx.save();
        ctx.globalAlpha = l.opacity;
        ctx.translate(l.x * f, l.y * f);
        ctx.rotate((l.rotation * Math.PI) / 180);
        ctx.scale(l.scale, l.scale);
        const w = l.w * f;
        const h = l.h * f;
        if (l.kind === 'image' && l.fit !== 'stretch') {
          const r = l.fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
          ctx.beginPath();
          ctx.rect(-w / 2, -h / 2, w, h);
          ctx.clip();
          ctx.drawImage(img, (-img.width * r) / 2, (-img.height * r) / 2, img.width * r, img.height * r);
        } else ctx.drawImage(img, -w / 2, -h / 2, w, h);
        ctx.restore();
      } catch {
        /* ignore */
      }
    }
  }
  return c.toDataURL('image/jpeg', 0.7);
}
