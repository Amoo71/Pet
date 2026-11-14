// Video → frame sequence (JPEG) for a CAKeyframeAnimation on "contents".
// Same technique as Nugget's VideoCAML, but fully in the browser.

import { makeCanvas, canvasToBlob } from './raster.js';

export const FRAME_LIMIT = 400;

function waitEvent(el, ev) {
  return new Promise((res, rej) => {
    const ok = () => (cleanup(), res());
    const bad = () => (cleanup(), rej(el.error || new Error('Video konnte nicht geladen werden.')));
    const cleanup = () => {
      el.removeEventListener(ev, ok);
      el.removeEventListener('error', bad);
    };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

export async function probeVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await waitEvent(v, 'loadedmetadata');
  const info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  URL.revokeObjectURL(url);
  return info;
}

/**
 * @param {File|Blob} file
 * @param {{fps:number,start:number,end:number,maxSide:number,quality:number,onProgress?:(i,n)=>void, signal?:AbortSignal}} o
 * @returns {Promise<{frames:Blob[], width:number, height:number}>}
 */
export async function extractFrames(file, o) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = url;
  try {
    await waitEvent(v, 'loadeddata');
    const dur = v.duration;
    const start = Math.max(0, o.start || 0);
    const end = Math.min(dur, o.end && o.end > start ? o.end : dur);
    const fps = Math.max(1, o.fps || 24);
    const n = Math.min(FRAME_LIMIT, Math.max(1, Math.floor((end - start) * fps)));
    const f = Math.min(1, (o.maxSide || 1290) / Math.max(v.videoWidth, v.videoHeight));
    const c = makeCanvas(v.videoWidth * f, v.videoHeight * f);
    const ctx = c.getContext('2d');
    const frames = [];
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      const t = Math.min(end - 0.001, start + i / fps);
      if (Math.abs(v.currentTime - t) > 0.0005) {
        v.currentTime = t;
        await waitEvent(v, 'seeked');
      }
      ctx.drawImage(v, 0, 0, c.width, c.height);
      frames.push(await canvasToBlob(c, 'image/jpeg', o.quality ?? 0.85));
      o.onProgress?.(i + 1, n);
    }
    return { frames, width: c.width, height: c.height };
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    v.load();
  }
}
