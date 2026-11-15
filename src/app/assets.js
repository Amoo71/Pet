// Asset cache: Blob storage, object URLs for preview, rendered layer bitmaps, fonts,
// GIF import, layer compositing (thumbnails + baked frosted glass) and export rendering.
import { putAsset, getAsset } from '../browser/storage.js';
import { uid, BLEND_CSS, effective } from '../core/model.js';
import { renderLayerCanvas, renderParticleCanvas, renderGlassCanvas, contentSignature, canvasToBlob, normaliseImage, blobToImage, makeCanvas } from '../browser/raster.js';
import { decodeGif, resampleTimeline } from '../browser/gif.js';

const blobs = new Map(); // id -> Blob
const urls = new Map(); // id -> objectURL
const meta = new Map(); // id -> record
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

/**
 * Decode an animated GIF into frame assets.
 * @returns {{frames:string[], sequence:number[], fps:number, width:number, height:number, single:boolean}}
 */
export async function addGifBytes(bytes, { onProgress, maxSide = 900, fps = 25 } = {}) {
  const gif = decodeGif(bytes);
  const f = Math.min(1, maxSide / Math.max(gif.width, gif.height));
  const src = makeCanvas(gif.width, gif.height);
  const sctx = src.getContext('2d');
  const out = makeCanvas(gif.width * f, gif.height * f);
  const octx = out.getContext('2d');
  const type = gif.transparent ? 'image/png' : 'image/jpeg';
  const frames = [];
  let n = gif.frames.length;
  // cap unique frames; drop every k-th if huge
  const step = Math.max(1, Math.ceil(n / 200));
  const kept = gif.frames.filter((_, i) => i % step === 0);
  for (let i = 0; i < kept.length; i++) {
    sctx.putImageData(new ImageData(kept[i].rgba, gif.width, gif.height), 0, 0);
    octx.clearRect(0, 0, out.width, out.height);
    octx.drawImage(src, 0, 0, out.width, out.height);
    frames.push(await addAsset(await canvasToBlob(out, type, 0.88), { w: out.width, h: out.height }));
    onProgress?.(i + 1, kept.length);
  }
  const delays = kept.map((_, i) => gif.frames.slice(i * step, i * step + step).reduce((s, x) => s + x.delay, 0));
  const tl = resampleTimeline(delays, fps);
  return { frames, sequence: tl.sequence, fps: tl.fps, width: out.width, height: out.height, single: kept.length === 1 };
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

export const assetMeta = (id) => meta.get(id);

export async function assetURL(id) {
  if (!id) return null;
  if (urls.has(id)) return urls.get(id);
  const b = await getBlob(id);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
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

export async function layerBitmapURL(layer) {
  if (layer.kind === 'image') return assetURL(layer.asset);
  if (layer.kind === 'video') return assetURL(layer.video?.frames?.[0]);
  const sig = contentSignature(layer);
  const hit = layerCache.get(sig);
  if (hit) return hit.url;
  const blob = await renderLayerBlob(layer, layer.kind === 'glass' ? 2 : 3);
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
  if (layer.kind === 'glass') return canvasToBlob(renderGlassCanvas(layer, scale, null));
  return canvasToBlob(renderLayerCanvas(layer, scale));
}

const extOf = (blob) => (blob?.type === 'image/jpeg' ? 'jpg' : 'png');
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

const COMPOSITE = { ...BLEND_CSS, normal: 'source-over' };

/**
 * Draw layers (Lock state) into a canvas the size of the screen × scale.
 * Used for library thumbnails and baked frosted glass.
 */
export async function compositeLayers(project, layers, scale = 1, { skipKinds = ['emitter'] } = {}) {
  const c = makeCanvas(project._w * scale, project._h * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  for (const l of layers) {
    if (l.hidden || skipKinds.includes(l.kind)) continue;
    const e = effective(l, 'Locked', false);
    if (e.opacity <= 0) continue;
    let img = null;
    try {
      if (l.kind === 'image' || l.kind === 'video') {
        const b = await getBlob(l.kind === 'image' ? l.asset : l.video?.frames?.[0]);
        if (b) img = await blobToImage(b);
      } else if (l.kind === 'glass') {
        img = renderGlassCanvas(l, scale, null);
      } else {
        if (l.kind === 'text' && l.text?.fontAsset) await ensureFont(l.text.fontAsset);
        img = renderLayerCanvas(l, Math.max(1, scale));
      }
    } catch {
      img = null;
    }
    if (!img) continue;
    const f = l.filters || {};
    ctx.save();
    ctx.globalAlpha = e.opacity;
    ctx.globalCompositeOperation = COMPOSITE[l.blend] || 'source-over';
    const filt = [];
    if (f.blur) filt.push(`blur(${f.blur * scale}px)`);
    if (f.hue) filt.push(`hue-rotate(${f.hue}deg)`);
    if (f.saturate != null && f.saturate !== 1) filt.push(`saturate(${f.saturate})`);
    if (f.contrast != null && f.contrast !== 1) filt.push(`contrast(${f.contrast})`);
    if (filt.length) ctx.filter = filt.join(' ');
    ctx.translate(e.x * scale, e.y * scale);
    ctx.rotate((e.rotation * Math.PI) / 180);
    ctx.scale(e.scale, e.scale);
    const w = l.w * scale;
    const h = l.h * scale;
    ctx.beginPath();
    if (l.cornerRadius && ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, l.cornerRadius * scale);
    else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    if ((l.kind === 'image' || l.kind === 'video') && l.fit !== 'stretch') {
      const r = l.fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
      ctx.drawImage(img, (-img.width * r) / 2, (-img.height * r) / 2, img.width * r, img.height * r);
    } else ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return c;
}

/** Layers that are drawn before (behind) the given layer. */
export function layersBehind(project, layer) {
  const order = [...project.layers.filter((l) => l.plane === 'background'), ...project.layers.filter((l) => l.plane === 'floating')];
  return order.slice(0, order.findIndex((l) => l.id === layer.id));
}

async function bakeGlass(layer, project, scale = 3) {
  const comp = await compositeLayers(project, layersBehind(project, layer), scale);
  const e = effective(layer, 'Locked', false);
  const crop = makeCanvas(layer.w * scale, layer.h * scale);
  crop.getContext('2d').drawImage(comp, (e.x - layer.w / 2) * scale, (e.y - layer.h / 2) * scale, layer.w * scale, layer.h * scale, 0, 0, crop.width, crop.height);
  return renderGlassCanvas(layer, scale, crop);
}

/** render() callback for core/tendies.js */
export async function exportRender(layer, project) {
  const scale = project.exportScale || 3;
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
    if (!frames.length) return null;
    const seq = layer.video.sequence?.filter((i) => i < frames.length);
    return { frames, sequence: seq?.length ? seq : undefined };
  }
  if (layer.kind === 'glass') {
    const c = layer.glass?.mode === 'frosted' ? await bakeGlass(layer, project, scale) : renderGlassCanvas(layer, scale, null);
    const blob = await canvasToBlob(c);
    return { bytes: await bytesOf(blob), ext: 'png' };
  }
  const sig = contentSignature(layer);
  let blob = scale === 3 ? layerCache.get(sig)?.blob : null;
  if (!blob) blob = await renderLayerBlob(layer, scale);
  return { bytes: await bytesOf(blob), ext: extOf(blob) };
}

/** Small JPEG thumbnail of a whole project (for the library). */
export async function projectThumbnail(project, width = 180) {
  const scale = width / project._w;
  const order = [...project.layers.filter((l) => l.plane === 'background'), ...project.layers.filter((l) => l.plane !== 'background')];
  const c = await compositeLayers(project, order, scale);
  return c.toDataURL('image/jpeg', 0.7);
}
