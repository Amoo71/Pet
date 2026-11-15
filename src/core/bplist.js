// Binary property list (bplist00) writer. PosterKit's NSKeyedArchiver files and
// Wallpaper.plist are written in binary form, exactly like the device-verified templates.
import { parsePlist } from './plist.js';

const enc = new TextEncoder();

function isAscii(s) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

/**
 * Values: string, number (integer if Number.isInteger unless wrapped with real()), boolean,
 * Uint8Array (data), Date, arrays, plain objects, and the wrappers from plist.js
 * ({__plist:'integer'|'real'|'data'|'uid'}). Parsed binary plists use {CF$UID:n} for UIDs.
 */
export function toBinaryPlist(root) {
  const objects = []; // encoded object byte arrays
  const flatten = (v) => {
    const idx = objects.length;
    objects.push(null);
    let out;
    if (v === null || v === undefined) out = Uint8Array.of(0x00);
    else if (v === true) out = Uint8Array.of(0x09);
    else if (v === false) out = Uint8Array.of(0x08);
    else if (v?.__plist === 'uid' || (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && 'CF$UID' in v)) {
      const n = v.__plist ? v.v : v.CF$UID;
      out = n < 256 ? Uint8Array.of(0x80, n) : n < 65536 ? Uint8Array.of(0x81, n >> 8, n & 255) : Uint8Array.of(0x83, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
    } else if (typeof v === 'number' || v?.__plist === 'integer' || v?.__plist === 'real') {
      const isReal = v?.__plist === 'real' || (typeof v === 'number' && !Number.isInteger(v));
      const n = typeof v === 'number' ? v : v.v;
      if (isReal) {
        const b = new Uint8Array(9);
        b[0] = 0x23;
        new DataView(b.buffer).setFloat64(1, n);
        out = b;
      } else if (n >= 0 && n < 256) out = Uint8Array.of(0x10, n);
      else if (n >= 0 && n < 65536) out = Uint8Array.of(0x11, n >> 8, n & 255);
      else if (n >= 0 && n < 2 ** 31) out = Uint8Array.of(0x12, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
      else {
        const b = new Uint8Array(9);
        b[0] = 0x13;
        new DataView(b.buffer).setBigInt64(1, BigInt(Math.round(n)));
        out = b;
      }
    } else if (v instanceof Date) {
      const b = new Uint8Array(9);
      b[0] = 0x33;
      new DataView(b.buffer).setFloat64(1, v.getTime() / 1000 - 978307200);
      out = b;
    } else if (v instanceof Uint8Array || v?.__plist === 'data') {
      const d = v instanceof Uint8Array ? v : v.v;
      out = concat([marker(0x4, d.length), d]);
    } else if (typeof v === 'string') {
      if (isAscii(v)) out = concat([marker(0x5, v.length), enc.encode(v)]);
      else {
        const b = new Uint8Array(v.length * 2);
        for (let i = 0; i < v.length; i++) {
          b[i * 2] = v.charCodeAt(i) >> 8;
          b[i * 2 + 1] = v.charCodeAt(i) & 255;
        }
        out = concat([marker(0x6, v.length), b]);
      }
    } else if (Array.isArray(v)) {
      const refs = v.map(flatten);
      out = { kind: 'array', refs };
    } else if (typeof v === 'object') {
      const keys = Object.keys(v);
      const krefs = keys.map(flatten);
      const vrefs = keys.map((k) => flatten(v[k]));
      out = { kind: 'dict', refs: [...krefs, ...vrefs], count: keys.length };
    } else throw new TypeError('bplist: unsupported value ' + v);
    objects[idx] = out;
    return idx;
  };
  flatten(root);
  const refSize = objects.length < 256 ? 1 : objects.length < 65536 ? 2 : 4;
  const refBytes = (r) => (refSize === 1 ? [r] : refSize === 2 ? [r >> 8, r & 255] : [(r >>> 24) & 255, (r >> 16) & 255, (r >> 8) & 255, r & 255]);
  const encoded = objects.map((o) => {
    if (o instanceof Uint8Array) return o;
    const head = marker(o.kind === 'array' ? 0xa : 0xd, o.kind === 'array' ? o.refs.length : o.count);
    return concat([head, Uint8Array.from(o.refs.flatMap(refBytes))]);
  });
  const header = enc.encode('bplist00');
  const offsets = [];
  let pos = header.length;
  for (const e of encoded) {
    offsets.push(pos);
    pos += e.length;
  }
  const tableOffset = pos;
  const offSize = tableOffset < 256 ? 1 : tableOffset < 65536 ? 2 : 4;
  const table = new Uint8Array(offsets.length * offSize);
  offsets.forEach((o, i) => {
    for (let k = 0; k < offSize; k++) table[i * offSize + k] = (o >> (8 * (offSize - 1 - k))) & 255;
  });
  const trailer = new Uint8Array(32);
  const dv = new DataView(trailer.buffer);
  trailer[6] = offSize;
  trailer[7] = refSize;
  dv.setBigUint64(8, BigInt(objects.length));
  dv.setBigUint64(16, 0n);
  dv.setBigUint64(24, BigInt(tableOffset));
  return concat([header, ...encoded, table, trailer]);
}

function marker(type, len) {
  if (len < 15) return Uint8Array.of((type << 4) | len);
  const n = len < 256 ? [0x10, len] : len < 65536 ? [0x11, len >> 8, len & 255] : [0x12, (len >>> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255];
  return Uint8Array.of((type << 4) | 0xf, ...n);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Parse (binary or XML) → JS; real numbers that happen to be integral keep their type via a marker map. */
export function readKeyed(bytes) {
  return parsePlist(bytes);
}
