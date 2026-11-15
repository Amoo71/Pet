// Property list helpers: XML writer, XML reader (DOMParser) and binary (bplist00) reader.

export const int = (v) => ({ __plist: 'integer', v: Math.round(v) });
export const real = (v) => ({ __plist: 'real', v });
export const data = (bytes) => ({ __plist: 'data', v: bytes });
export const uid = (v) => ({ __plist: 'uid', v });

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fmtReal(n) {
  if (n === Infinity) return '+infinity';
  if (n === -Infinity) return '-infinity';
  const s = String(n);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
}

function node(v, ind) {
  const pad = '\t'.repeat(ind);
  if (v === true) return `${pad}<true/>`;
  if (v === false) return `${pad}<false/>`;
  if (typeof v === 'string') return `${pad}<string>${esc(v)}</string>`;
  if (typeof v === 'number')
    return Number.isInteger(v) ? `${pad}<integer>${v}</integer>` : `${pad}<real>${fmtReal(v)}</real>`;
  if (v instanceof Uint8Array) return `${pad}<data>\n${pad}${b64(v)}\n${pad}</data>`;
  if (v && v.__plist === 'integer') return `${pad}<integer>${v.v}</integer>`;
  if (v && v.__plist === 'real') return `${pad}<real>${fmtReal(v.v)}</real>`;
  if (v && v.__plist === 'data') return `${pad}<data>\n${pad}${b64(v.v)}\n${pad}</data>`;
  if (v && v.__plist === 'uid')
    return `${pad}<dict>\n${pad}\t<key>CF$UID</key>\n${pad}\t<integer>${v.v}</integer>\n${pad}</dict>`;
  if (Array.isArray(v)) {
    if (!v.length) return `${pad}<array/>`;
    return `${pad}<array>\n${v.map((x) => node(x, ind + 1)).join('\n')}\n${pad}</array>`;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return `${pad}<dict/>`;
    const body = keys.map((k) => `${pad}\t<key>${esc(k)}</key>\n${node(v[k], ind + 1)}`).join('\n');
    return `${pad}<dict>\n${body}\n${pad}</dict>`;
  }
  throw new TypeError('plist: unsupported value ' + v);
}

export function toXmlPlist(value) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    node(value, 0) +
    '\n</plist>\n'
  );
}

// ---------- reading ----------

function parseXmlNode(el) {
  switch (el.tagName) {
    case 'dict': {
      const out = {};
      const kids = [...el.children];
      for (let i = 0; i < kids.length; i += 2) out[kids[i].textContent] = parseXmlNode(kids[i + 1]);
      return out;
    }
    case 'array':
      return [...el.children].map(parseXmlNode);
    case 'string':
      return el.textContent;
    case 'integer':
      return parseInt(el.textContent, 10);
    case 'real':
      return parseFloat(el.textContent);
    case 'true':
      return true;
    case 'false':
      return false;
    case 'date':
      return new Date(el.textContent);
    case 'data': {
      const s = atob(el.textContent.replace(/\s+/g, ''));
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
      return b;
    }
    default:
      return null;
  }
}

function parseBinary(bytes, typed = false) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tr = bytes.length - 32;
  const offSize = bytes[tr + 6];
  const refSize = bytes[tr + 7];
  const numObjects = Number(v.getBigUint64(tr + 8));
  const topObject = Number(v.getBigUint64(tr + 16));
  const tableOffset = Number(v.getBigUint64(tr + 24));
  const readN = (pos, n) => {
    let r = 0;
    for (let i = 0; i < n; i++) r = r * 256 + bytes[pos + i];
    return r;
  };
  const offsets = [];
  for (let i = 0; i < numObjects; i++) offsets.push(readN(tableOffset + i * offSize, offSize));

  const readObj = (idx) => {
    let p = offsets[idx];
    const marker = bytes[p];
    const hi = marker >> 4;
    const lo = marker & 0xf;
    const len = () => {
      if (lo !== 0xf) return [lo, p + 1];
      const intMarker = bytes[p + 1];
      const n = 1 << (intMarker & 0xf);
      return [readN(p + 2, n), p + 2 + n];
    };
    switch (hi) {
      case 0x0:
        return marker === 0x09 ? true : marker === 0x08 ? false : null;
      case 0x1: {
        const n = 1 << lo;
        if (n === 8) return Number(v.getBigInt64(p + 1));
        return readN(p + 1, n);
      }
      case 0x2: {
        const f = lo === 3 ? v.getFloat64(p + 1) : v.getFloat32(p + 1);
        return typed ? { __plist: 'real', v: f } : f;
      }
      case 0x3:
        return new Date((978307200 + v.getFloat64(p + 1)) * 1000);
      case 0x4: {
        const [l, s] = len();
        return bytes.slice(s, s + l);
      }
      case 0x5: {
        const [l, s] = len();
        return new TextDecoder('latin1').decode(bytes.subarray(s, s + l));
      }
      case 0x6: {
        const [l, s] = len();
        let str = '';
        for (let i = 0; i < l; i++) str += String.fromCharCode(v.getUint16(s + i * 2));
        return str;
      }
      case 0x8:
        return typed ? { __plist: 'uid', v: readN(p + 1, lo + 1) } : { CF$UID: readN(p + 1, lo + 1) };
      case 0xa: {
        const [l, s] = len();
        const arr = [];
        for (let i = 0; i < l; i++) arr.push(readObj(readN(s + i * refSize, refSize)));
        return arr;
      }
      case 0xd: {
        const [l, s] = len();
        const out = {};
        for (let i = 0; i < l; i++) {
          const k = readObj(readN(s + i * refSize, refSize));
          out[k] = readObj(readN(s + (l + i) * refSize, refSize));
        }
        return out;
      }
      default:
        return null;
    }
  };
  return readObj(topObject);
}

/** Parse an XML or binary plist. */
export function parsePlist(input, typed = false) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const head = new TextDecoder().decode(bytes.subarray(0, 8));
  if (head === 'bplist00') return parseBinary(bytes, typed);
  const text = new TextDecoder().decode(bytes);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.querySelector('plist > *');
  return root ? parseXmlNode(root) : null;
}
