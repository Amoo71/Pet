// "3D Photo": turn one picture into several depth layers for gyro parallax.
//  1. depth map – AI (Depth Anything v2 small via transformers.js, runs in the browser)
//     or a simple offline heuristic (lower = nearer, centre slightly nearer)
//  2. slice into N layers by depth quantiles with feathered edges
//  3. fill what nearer layers cover (normalised convolution) so shifting layers
//     reveal plausible background instead of a doubled subject.

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/transformers.min.js'; // ES module build
const MODEL = 'onnx-community/depth-anything-v2-small';
let pipePromise = null;

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** AI depth (0 = far … 1 = near). Throws if the model can't load (offline, blocked). */
export async function aiDepth(img, onProgress) {
  if (!pipePromise) {
    pipePromise = (async () => {
      const t = await import(/* @vite-ignore */ TRANSFORMERS);
      const device = globalThis.navigator?.gpu ? 'webgpu' : 'wasm';
      return t.pipeline('depth-estimation', MODEL, {
        device,
        dtype: device === 'webgpu' ? 'fp16' : 'q8',
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) onProgress?.(p.loaded / p.total, `Downloading depth model… ${Math.round((p.loaded / p.total) * 100)}%`);
        },
      });
    })();
    pipePromise.catch(() => (pipePromise = null));
  }
  const pipe = await pipePromise;
  onProgress?.(1, 'Estimating depth…');
  const c = canvasOf(img.width, img.height);
  c.getContext('2d').drawImage(img, 0, 0);
  const url = c.toDataURL('image/jpeg', 0.92);
  const out = await pipe(url);
  const d = out.depth; // RawImage, 1 channel, larger = nearer
  const src = d.data;
  const ch = d.channels || 1;
  const arr = new Float32Array(d.width * d.height);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    const v = src[i * ch];
    arr[i] = v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] - lo) / span;
  return { depth: arr, w: d.width, h: d.height };
}

/** Offline heuristic: lower in the frame = nearer, plus a soft central bump (subject). */
export function simpleDepth(w = 256, h = 256) {
  const arr = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x / w - 0.5) / 0.35;
      const dy = (y / h - 0.62) / 0.4;
      const bump = Math.exp(-(dx * dx + dy * dy));
      arr[y * w + x] = Math.min(1, 0.55 * (y / h) + 0.5 * bump);
    }
  }
  return { depth: arr, w, h };
}

/** depth map → alpha mask canvas (W×H) for depth >= threshold, feathered */
function maskCanvas(dm, threshold, W, H, feather) {
  const m = canvasOf(dm.w, dm.h);
  const ctx = m.getContext('2d');
  const id = ctx.createImageData(dm.w, dm.h);
  for (let i = 0; i < dm.depth.length; i++) {
    // soft step around the threshold
    const v = Math.max(0, Math.min(1, (dm.depth[i] - threshold) / 0.04 + 0.5));
    id.data[i * 4 + 3] = v * 255;
  }
  ctx.putImageData(id, 0, 0);
  const out = canvasOf(W, H);
  const o = out.getContext('2d');
  if (feather) o.filter = `blur(${feather}px)`;
  o.drawImage(m, 0, 0, W, H);
  return out;
}

/**
 * Fill the masked-out (transparent) parts of `rgba` from their surroundings
 * (multi-scale normalised convolution).
 */
function fillHoles(imgCanvas, keepMask) {
  const W = imgCanvas.width;
  const H = imgCanvas.height;
  // premultiplied kept colour
  const kept = canvasOf(W, H);
  const k = kept.getContext('2d');
  k.drawImage(imgCanvas, 0, 0);
  k.globalCompositeOperation = 'destination-in';
  k.drawImage(keepMask, 0, 0);
  const base = k.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(base.length);
  out.set(base);
  const layers = [Math.max(4, W / 80), Math.max(12, W / 25), Math.max(40, W / 8)].map((r) => {
    const c = canvasOf(W, H);
    const x = c.getContext('2d');
    x.filter = `blur(${r}px)`;
    x.drawImage(kept, 0, 0);
    return x.getImageData(0, 0, W, H).data;
  });
  for (let i = 0; i < out.length; i += 4) {
    const a = base[i + 3] / 255;
    if (a > 0.995) continue;
    // pick the finest blur level that has enough support
    let r = 0;
    let g = 0;
    let b = 0;
    let found = false;
    // getImageData is already un-premultiplied, so a blurred kept-only image IS the
    // normalised convolution – just take the finest level with enough support
    for (const L of layers) {
      if (L[i + 3] > 40) {
        r = L[i];
        g = L[i + 1];
        b = L[i + 2];
        found = true;
        break;
      }
    }
    if (!found) {
      const L = layers[layers.length - 1];
      r = L[i];
      g = L[i + 1];
      b = L[i + 2];
    }
    // composite: kept colour over fill
    out[i] = base[i] * a + r * (1 - a);
    out[i + 1] = base[i + 1] * a + g * (1 - a);
    out[i + 2] = base[i + 2] * a + b * (1 - a);
    out[i + 3] = 255;
  }
  const res = canvasOf(W, H);
  res.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
  return res;
}

/** depth quantiles so every slice gets a similar share of the picture */
function thresholds(dm, n) {
  const sorted = Float32Array.from(dm.depth).sort();
  const t = [];
  for (let k = 1; k < n; k++) t.push(sorted[Math.floor((sorted.length * k) / n)]);
  return t;
}

/**
 * @param {CanvasImageSource & {width:number,height:number}} img  source picture
 * @param {{depth:Float32Array,w:number,h:number}} dm  depth map
 * @param {number} n number of layers (2–6)
 * @returns {Promise<{canvas:HTMLCanvasElement, depthRank:number}[]>} far → near
 */
export async function sliceByDepth(img, dm, n = 4, { maxSide = 1600 } = {}) {
  const f = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = Math.round(img.width * f);
  const H = Math.round(img.height * f);
  const src = canvasOf(W, H);
  src.getContext('2d').drawImage(img, 0, 0, W, H);
  const t = thresholds(dm, n);
  const feather = Math.max(1.5, W / 500);
  const out = [];
  for (let k = 0; k < n; k++) {
    // what is nearer than this slice gets removed + filled so it can't double
    let colour = src;
    if (k < n - 1) {
      const nearer = maskCanvas(dm, t[k], W, H, feather * 2);
      const keep = canvasOf(W, H);
      const kc = keep.getContext('2d');
      kc.fillStyle = '#000';
      kc.fillRect(0, 0, W, H);
      kc.globalCompositeOperation = 'destination-out';
      kc.drawImage(nearer, 0, 0);
      colour = fillHoles(src, keep);
    }
    const layer = canvasOf(W, H);
    const lc = layer.getContext('2d');
    lc.drawImage(colour, 0, 0);
    if (k > 0) {
      // own extent: depth >= threshold of this slice
      lc.globalCompositeOperation = 'destination-in';
      lc.drawImage(maskCanvas(dm, t[k - 1], W, H, feather), 0, 0);
    }
    out.push({ canvas: layer, depthRank: n > 1 ? k / (n - 1) : 0 });
    await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }
  return out;
}
