// Raw morph: add effect layers straight into an existing .tendies package without
// rebuilding it. Everything else (Apple's HEIC strips, 3D transforms, states, gyro
// groups, scripts) stays byte-for-byte as it was.
//
// Works for ParameterizedCA (one wallpaper .ca with BACKGROUND / FLOATING groups –
// e.g. Apple's iPhone 17 wallpapers) and LayeredAnimation (Background/Floating .ca).
// Container-only packages that just point at a system wallpaper (e.g. Apple's
// MercuryPoster descriptors) have no CAML to extend; they are reported as such.

import { readZip, createZip } from './zip.js';
import { parsePlist } from './plist.js';
import { EMITTER_PRESETS } from './model.js';
import { hexToRgb, num, esc } from './caml.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const DEG = Math.PI / 180;

/** describe what a package contains */
export function inspectPackage(files) {
  const paths = [...files.keys()];
  const wallpapers = paths.filter((p) => /\.wallpaper\/Wallpaper\.plist$/i.test(p));
  const camls = paths.filter((p) => /\.ca\/main\.caml$/i.test(p));
  const systemOnly = !camls.length && paths.some((p) => /com\.apple\.posterkit\.provider\.descriptor\.identifier$/.test(p));
  return { wallpapers, camls, systemOnly };
}

function attr(tagText, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tagText);
  return m ? m[1] : null;
}
const nums = (s) => String(s || '').trim().split(/[\s,]+/).map(Number);

/**
 * Find where to insert into a CAML document.
 * @returns {{insertAt:number, cx:number, cy:number, w:number, h:number} | null}
 *   insertAt = string index just before the target group's closing </sublayers>,
 *   (cx, cy) = screen centre in the target group's coordinates, w/h = screen size in root units.
 */
function findTarget(xml, preferFloating) {
  const rootM = /<(CALayer|CATransformLayer)\b[^>]*>/.exec(xml.slice(xml.indexOf('<caml')));
  if (!rootM) return null;
  const rootStart = xml.indexOf('<caml') + rootM.index;
  const rootTag = rootM[0];
  const [, , rw, rh] = nums(attr(rootTag, 'bounds'));
  const [ox0, oy0] = nums(attr(rootTag, 'bounds'));
  const W = rw || 1000;
  const H = rh || 1000;
  const rcx = (ox0 || 0) + W / 2;
  const rcy = (oy0 || 0) + H / 2;
  // ParameterizedCA: a top-level group named FLOATING / BACKGROUND
  const names = preferFloating ? ['FLOATING', 'BACKGROUND'] : ['BACKGROUND', 'FLOATING'];
  for (const n of names) {
    const re = new RegExp(`<(CALayer|CATransformLayer)\\b[^>]*\\sname="${n}"[^>]*?(/?)>`);
    const m = re.exec(xml);
    if (!m) continue;
    const tag = m[0];
    const kind = m[1];
    const [px, py] = nums(attr(tag, 'position'));
    const [, , gw, gh] = nums(attr(tag, 'bounds'));
    const [ax, ay] = attr(tag, 'anchorPoint') ? nums(attr(tag, 'anchorPoint')) : [0.5, 0.5];
    // screen centre in group coordinates (root centre → group local)
    const cx = rcx - (px || 0) + ax * (gw || 0);
    const cy = rcy - (py || 0) + ay * (gh || 0);
    if (m[2] === '/') {
      // self-closing group: open it up
      const open = tag.replace(/\s*\/>$/, '>');
      const replaced = `${open}<sublayers>\u0000</sublayers></${kind}>`;
      const xml2 = xml.slice(0, m.index) + replaced + xml.slice(m.index + tag.length);
      return { xml: xml2, insertAt: xml2.indexOf('\u0000'), placeholder: true, cx, cy, w: W, h: H };
    }
    // find this group's own direct <sublayers>…</sublayers> end by depth counting
    const start = m.index + tag.length;
    const close = matchingClose(xml, start, kind);
    const sub = xml.lastIndexOf('</sublayers>', close);
    if (sub > start) return { xml, insertAt: sub, cx, cy, w: W, h: H };
    return { xml: xml.slice(0, close) + '<sublayers>\u0000</sublayers>' + xml.slice(close), insertAt: close + '<sublayers>'.length, placeholder: true, cx, cy, w: W, h: H };
  }
  // LayeredAnimation: insert into the root's sublayers (root coords, centre = W/2,H/2)
  const close = matchingClose(xml, rootStart + rootTag.length, rootM[1]);
  const sub = xml.lastIndexOf('</sublayers>', close);
  if (sub > rootStart) return { xml, insertAt: sub, cx: rcx, cy: rcy, w: W, h: H };
  return null;
}

/** index of the closing tag that matches an element opened right before `from` */
function matchingClose(xml, from, kind) {
  const re = /<(\/?)(CALayer|CATransformLayer|CAEmitterLayer|CABackdropLayer|CAGradientLayer|CATextLayer|CAShapeLayer|CAReplicatorLayer|CASDFLayer|CASDFElementLayer)\b[^>]*?(\/?)>/g;
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(xml))) {
    if (m[3] === '/') continue; // self-closing
    if (m[1] === '/') {
      depth--;
      if (depth === 0) return m.index;
    } else depth++;
  }
  return xml.length;
}

function emitterLayerXml(id, preset, cx, cy, w, h, s, asset) {
  const e = EMITTER_PRESETS[preset];
  const up = Math.sin((e.emissionLongitude || 0) * DEG) < -0.3;
  const line = e.shape === 'line';
  const px = ((e.size || 16) / 64) * s;
  return `<CALayer id="${id}" name="${esc(e.name)} (morph)" bounds="0 0 ${num(w)} ${num(h)}" position="${num(cx)} ${num(cy)}" allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8"><sublayers><CAEmitterLayer id="${id}-emitter" name="${id} Emitter" bounds="0 0 ${num(w)} ${num(h)}" position="${num(w / 2)} ${num(h / 2)}" emitterPosition="${line ? `${num(w / 2)} ${up ? num(-10 * s) : num(h + 10 * s)}` : `${num(w / 2)} ${num(h / 2)}`}" emitterSize="${line ? `${num(w)} 1` : `${num(w)} ${num(h)}`}" emitterShape="${line ? 'line' : 'rectangle'}" emitterMode="${line ? 'outline' : 'volume'}" renderMode="${e.additive ? 'additive' : 'unordered'}" birthRate="1" allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8"><emitterCells><CAEmitterCell name="Cell 1" color="${hexToRgb(e.color)}" contentsScale="1" birthRate="${num(e.birthRate)}" lifetime="${num(e.lifetime)}" lifetimeRange="${num(e.lifetime * 0.3)}" velocity="${num(e.velocity * s)}" velocityRange="${num(e.velocityRange * s)}" emissionLongitude="${num(-(e.emissionLongitude || 0) * DEG)}" emissionLatitude="0" emissionRange="${num((e.emissionRange || 0) * DEG)}" xAcceleration="${num((e.xAcceleration || 0) * s)}" yAcceleration="${num(-(e.yAcceleration || 0) * s)}" scale="${num((e.scale || 1) * px)}" scaleRange="${num((e.scaleRange || 0) * px)}" scaleSpeed="0" alphaRange="0" alphaSpeed="${num(e.alphaSpeed || 0)}" spin="${num(e.spin || 0)}" spinRange="${num(e.spinRange || 0)}"><contents><CGImage src="${esc(asset)}"/></contents></CAEmitterCell></emitterCells></CAEmitterLayer></sublayers></CALayer>`;
}

/**
 * @param {Uint8Array|ArrayBuffer} input  original .tendies
 * @param {string[]} effects  supported: fx-<particle>, vignette
 * @param {{particle:(kind)=>Promise<Uint8Array>, vignette:()=>Promise<Uint8Array>}} assets  PNG makers
 * @returns {Promise<{zip:Uint8Array, changed:number, wallpapers:number}>}
 */
export async function rawMorph(input, effects, assets) {
  const files = await readZip(input);
  const info = inspectPackage(files);
  if (info.systemOnly) {
    const err = new Error('This wallpaper is rendered by iOS itself (it only references a built-in system wallpaper), so effects can’t be added to its contents.');
    err.code = 'system_only';
    throw err;
  }
  if (!info.camls.length) throw new Error('No Core Animation wallpaper found in this file.');
  // pick the documents to extend: the ParameterizedCA bundle, or the Floating .ca of each LayeredAnimation wallpaper
  const targets = [];
  for (const caml of info.camls) {
    const wpPath = info.wallpapers.find((w) => caml.startsWith(w.replace(/Wallpaper\.plist$/i, '')));
    let type = 'ParameterizedCA';
    try {
      type = parsePlist(files.get(wpPath))?.assets?.lockAndHome?.default?.type || type;
    } catch {
      /* keep default */
    }
    if (type === 'LayeredAnimation') {
      if (/_Floating[^/]*\.ca\/main\.caml$/i.test(caml)) targets.push(caml);
    } else targets.push(caml);
  }
  if (!targets.length) targets.push(info.camls[0]);
  let changed = 0;
  for (const camlPath of targets) {
    let xml = dec.decode(files.get(camlPath));
    const t = findTarget(xml, true);
    if (!t) continue;
    xml = t.xml;
    const caDir = camlPath.replace(/main\.caml$/i, '');
    const s = t.w / 402; // root units per pt (≈ px @3x for Apple's documents)
    let insert = '';
    for (const fx of effects) {
      const m = /^fx-(\w+)$/.exec(fx);
      if (m && EMITTER_PRESETS[m[1]]) {
        const file = `assets/morph-${m[1]}.png`;
        files.set(caDir + file, await assets.particle(EMITTER_PRESETS[m[1]].particle));
        insert += emitterLayerXml(`morph-${m[1]}`, m[1], t.cx, t.cy, t.w, t.h, s, file);
        changed++;
      }
      if (fx === 'vignette') {
        const file = 'assets/morph-vignette.png';
        files.set(caDir + file, await assets.vignette());
        insert += `<CALayer id="morph-vignette" name="Vignette (morph)" bounds="0 0 ${num(t.w)} ${num(t.h)}" position="${num(t.cx)} ${num(t.cy)}" allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8"><contents><CGImage src="${file}"/></contents></CALayer>`;
        changed++;
      }
    }
    xml = t.placeholder ? xml.replace('\u0000', insert) : xml.slice(0, t.insertAt) + insert + xml.slice(t.insertAt);
    files.set(camlPath, enc.encode(xml));
  }
  return { zip: createZip([...files].map(([path, data]) => ({ path, data }))), changed, wallpapers: targets.length };
}

export const RAW_CAPABLE = (id) => id === 'vignette' || /^fx-\w+$/.test(id);

/** true when a package should be morphed in place instead of being rebuilt from editable layers:
 *  Apple's own wallpapers (HEIC strips, nested 3D transform rigs) lose detail in the editor. */
export async function prefersRawMorph(input) {
  const files = await readZip(input);
  const info = inspectPackage(files);
  if (info.systemOnly) return true;
  if ([...files.keys()].some((p) => /\.heic$/i.test(p))) return true;
  for (const c of info.camls) {
    const xml = dec.decode(files.get(c));
    for (const m of xml.matchAll(/<CATransformLayer\b[^>]*\sname="([^"]*)"/g)) if (!/ Parallax( 2)?$/.test(m[1])) return true;
  }
  return false;
}
