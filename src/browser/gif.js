// Minimal animated GIF decoder (GIF87a/89a): LZW, local/global palettes, interlacing,
// transparency and disposal methods. Produces fully composited RGBA frames + delays.

function lzwDecode(minCodeSize, data, pixelCount) {
  const out = new Uint8Array(pixelCount);
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const length = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    suffix[i] = i;
    length[i] = 1;
    prefix[i] = -1;
  }
  let prev = -1;
  let op = 0;
  let bits = 0;
  let acc = 0;
  let p = 0;
  const stack = new Uint8Array(4097);
  while (p < data.length || bits >= codeSize) {
    while (bits < codeSize && p < data.length) {
      acc |= data[p++] << bits;
      bits += 8;
    }
    if (bits < codeSize) break;
    const code = acc & ((1 << codeSize) - 1);
    acc >>>= codeSize;
    bits -= codeSize;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    let c = code;
    let first;
    if (prev === -1) {
      if (op < pixelCount) out[op++] = suffix[code];
      prev = code;
      continue;
    }
    let sp = 0;
    if (code >= next) {
      // KwKwK case
      c = prev;
      let t = c;
      while (prefix[t] !== -1) t = prefix[t];
      stack[sp++] = suffix[t];
    }
    while (c !== -1 && sp < 4097) {
      stack[sp++] = suffix[c];
      c = prefix[c];
    }
    first = stack[sp - 1];
    while (sp > 0 && op < pixelCount) out[op++] = stack[--sp];
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      length[next] = length[prev] + 1;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return out;
}

/**
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{width:number,height:number,frames:{rgba:Uint8ClampedArray,delay:number}[],transparent:boolean}}
 */
export function decodeGif(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const sig = String.fromCharCode(...b.subarray(0, 6));
  if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new Error('Not a GIF file.');
  const width = b[6] | (b[7] << 8);
  const height = b[8] | (b[9] << 8);
  const flags = b[10];
  let p = 13;
  let gct = null;
  if (flags & 0x80) {
    const size = 3 * (1 << ((flags & 7) + 1));
    gct = b.subarray(p, p + size);
    p += size;
  }
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  let gce = { delay: 10, transIndex: -1, disposal: 0 };
  let anyTransparent = false;
  const readSub = () => {
    const chunks = [];
    let total = 0;
    while (p < b.length) {
      const n = b[p++];
      if (!n) break;
      chunks.push(b.subarray(p, p + n));
      total += n;
      p += n;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  };
  while (p < b.length) {
    const block = b[p++];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      const label = b[p++];
      if (label === 0xf9) {
        const size = b[p++];
        const pf = b[p];
        gce = { disposal: (pf >> 2) & 7, delay: b[p + 1] | (b[p + 2] << 8), transIndex: pf & 1 ? b[p + 3] : -1 };
        p += size;
        readSub();
      } else readSub();
      continue;
    }
    if (block !== 0x2c) break;
    const ix = b[p] | (b[p + 1] << 8);
    const iy = b[p + 2] | (b[p + 3] << 8);
    const iw = b[p + 4] | (b[p + 5] << 8);
    const ih = b[p + 6] | (b[p + 7] << 8);
    const lf = b[p + 8];
    p += 9;
    let ct = gct;
    if (lf & 0x80) {
      const size = 3 * (1 << ((lf & 7) + 1));
      ct = b.subarray(p, p + size);
      p += size;
    }
    const interlaced = !!(lf & 0x40);
    const minCode = b[p++];
    const pixels = lzwDecode(minCode, readSub(), iw * ih);
    const before = gce.disposal === 3 ? canvas.slice() : null;
    const rows = [];
    if (interlaced) {
      for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < ih; y += step) rows.push(y);
    } else for (let y = 0; y < ih; y++) rows.push(y);
    for (let r = 0; r < ih; r++) {
      const y = rows[r] + iy;
      if (y >= height) continue;
      for (let x = 0; x < iw; x++) {
        const xx = x + ix;
        if (xx >= width) continue;
        const idx = pixels[r * iw + x];
        if (idx === gce.transIndex) {
          anyTransparent = true;
          continue;
        }
        if (!ct) continue;
        const o = (y * width + xx) * 4;
        canvas[o] = ct[idx * 3];
        canvas[o + 1] = ct[idx * 3 + 1];
        canvas[o + 2] = ct[idx * 3 + 2];
        canvas[o + 3] = 255;
      }
    }
    frames.push({ rgba: canvas.slice(), delay: Math.max(20, (gce.delay || 10) * 10) });
    if (gce.disposal === 2) {
      for (let y = iy; y < Math.min(height, iy + ih); y++) canvas.fill(0, (y * width + ix) * 4, (y * width + Math.min(width, ix + iw)) * 4);
      anyTransparent = true;
    } else if (gce.disposal === 3 && before) canvas.set(before);
    gce = { delay: 10, transIndex: -1, disposal: 0 };
  }
  if (!frames.length) throw new Error('GIF contains no frames.');
  if (!anyTransparent) {
    for (const f of frames) {
      for (let i = 3; i < f.rgba.length; i += 4) if (f.rgba[i] !== 255) {
        anyTransparent = true;
        break;
      }
      if (anyTransparent) break;
    }
  }
  return { width, height, frames, transparent: anyTransparent };
}

/**
 * Resample variable GIF delays to a constant frame rate.
 * @returns {{fps:number, sequence:number[]}} sequence[i] = index of the source frame to show
 */
export function resampleTimeline(delays, fps = 25) {
  const total = delays.reduce((s, d) => s + d, 0);
  const n = Math.max(1, Math.round((total / 1000) * fps));
  const seq = [];
  let acc = 0;
  let fi = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / fps) * 1000;
    while (fi < delays.length - 1 && t >= acc + delays[fi]) {
      acc += delays[fi];
      fi++;
    }
    seq.push(fi);
  }
  return { fps, sequence: seq };
}
