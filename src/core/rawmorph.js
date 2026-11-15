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
import { toBinaryPlist } from './bplist.js';
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

const LAYER_TAG = /<(\/?)(CALayer|CATransformLayer|CAEmitterLayer|CABackdropLayer|CAGradientLayer|CATextLayer|CAShapeLayer|CAReplicatorLayer|CASDFLayer|CASDFElementLayer)\b[^>]*?(\/?)>/g;

/** direct child layers inside the element whose open tag ends at `from` */
function directChildren(xml, from, end) {
  const out = [];
  const re = new RegExp(LAYER_TAG.source, 'g');
  re.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = re.exec(xml)) && m.index < end) {
    if (m[1] === '/') {
      depth--;
      continue;
    }
    if (depth === 0) out.push({ start: m.index, tagEnd: m.index + m[0].length, kind: m[2], self: m[3] === '/' });
    if (m[3] !== '/') depth++;
  }
  return out;
}

/** put colour-grading filters where PosterBoard renders them: like Apple, on the CALayers
 *  directly inside BACKGROUND (a CATransformLayer can't filter), else on BACKGROUND / the root */
function addGrade(xml, filters) {
  const bg = /<(CALayer|CATransformLayer)\b[^>]*\sname="BACKGROUND"[^>]*?(\/?)>/.exec(xml);
  let targets = [];
  if (bg && bg[2] !== '/') {
    const from = bg.index + bg[0].length;
    if (bg[1] === 'CALayer') targets = [{ tagEnd: from, kind: 'CALayer' }];
    else targets = directChildren(xml, from, matchingClose(xml, from)).filter((c) => c.kind === 'CALayer' && !c.self);
  }
  if (!targets.length) {
    const rm = /<caml\b[^>]*>\s*<(CALayer)\b[^>]*?>/.exec(xml);
    if (!rm || rm[0].endsWith('/>')) return xml;
    targets = [{ tagEnd: rm.index + rm[0].length, kind: 'CALayer' }];
  }
  for (const t of targets.sort((a, b) => b.tagEnd - a.tagEnd)) {
    const close = matchingClose(xml, t.tagEnd);
    const sub = xml.indexOf('<sublayers', t.tagEnd);
    const own = xml.slice(t.tagEnd, sub > -1 && sub < close ? sub : close);
    const fi = own.indexOf('<filters>');
    if (fi > -1) {
      const at = t.tagEnd + fi + '<filters>'.length;
      xml = xml.slice(0, at) + filters + xml.slice(at);
    } else xml = xml.slice(0, t.tagEnd) + `<filters>${filters}</filters>` + xml.slice(t.tagEnd);
  }
  return xml;
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
 * @param {{particle:(kind)=>Promise<Uint8Array>, vignette:()=>Promise<Uint8Array>, light?:(hex)=>Promise<Uint8Array>}} assets  PNG makers
 * @param {object} [tune]  re-program the wallpaper itself (see TUNE_DEFAULTS)
 * @returns {Promise<{zip:Uint8Array, changed:number, wallpapers:number}>}
 */
export async function rawMorph(input, effects, assets, tune = {}) {
  tune = { ...TUNE_DEFAULTS, ...tune, light: { ...TUNE_DEFAULTS.light, ...(tune.light || {}) } };
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
  // edits of the original (from openPackage / describeCaml indices) – any document, not only targets
  for (const [path, edits] of Object.entries(tune.edits || {})) {
    if (!files.has(path)) continue;
    files.set(path, enc.encode(editCaml(dec.decode(files.get(path)), edits)));
    changed++;
  }
  for (const [path, bytes] of Object.entries(tune.files || {})) files.set(path, bytes);
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
    const L = tune.light;
    const lightName = 'Light (morph)';
    if (L.intensity > 0 && assets.light) {
      const file = 'assets/morph-light.png';
      files.set(caDir + file, await assets.light(L.color));
      const size = t.h * (L.size || 0.9);
      const off = LIGHT_POS[L.pos] || LIGHT_POS.top;
      // CA is y-up: +y = towards the top of the screen
      insert += `<CALayer id="morph-light" name="${lightName}" bounds="0 0 ${num(size)} ${num(size)}" position="${num(t.cx + off[0] * t.w)} ${num(t.cy + off[1] * t.h)}" opacity="${num(Math.min(1, L.intensity))}" allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8">${L.blend && L.blend !== 'normal' ? `<compositingFilter type="CAFilter" filter="${esc(L.blend)}" name="${esc(L.blend)}"/>` : ''}<contents><CGImage src="${file}"/></contents></CALayer>`;
      changed++;
    }
    xml = t.placeholder ? xml.replace('\u0000', insert) : xml.slice(0, t.insertAt) + insert + xml.slice(t.insertAt);
    // colour grading of the whole wallpaper: filters on the root layer
    const grade = [];
    if (tune.brightness) grade.push(`<CAFilter filter="colorBrightness" name="Morph Brightness" enabled="1" inputAmount="${num(tune.brightness)}"/>`);
    if (tune.contrast !== 1) grade.push(`<CAFilter filter="colorContrast" name="Morph Contrast" enabled="1" inputAmount="${num(tune.contrast)}"/>`);
    if (tune.saturation !== 1) grade.push(`<CAFilter filter="colorSaturate" name="Morph Saturate" enabled="1" inputAmount="${num(tune.saturation)}"/>`);
    if (tune.hue) grade.push(`<CAFilter filter="colorHueRotate" name="Morph Hue" enabled="1" inputAngle="${num(tune.hue * DEG)}"/>`);
    if (grade.length) {
      const before = xml;
      xml = addGrade(xml, grade.join(''));
      if (xml !== before) changed++;
    }
    // gyro: scale Apple's own tilt/parallax ranges, add the moving light
    const gs = /<wallpaperParallaxGroups type="NSArray">([\s\S]*?)<\/wallpaperParallaxGroups>/.exec(xml);
    if (gs) {
      let body = gs[1];
      if (tune.gyro !== 1) {
        body = body.replace(/<(mapMaxTo|mapMinTo) type="(real|integer)" value="([^"]+)"\/>/g, (_, k, ty, v) => `<${k} type="real" value="${num(Number(v) * tune.gyro)}"/>`);
        changed++;
      }
      if (L.intensity > 0 && L.follow > 0 && assets.light) {
        const n = L.follow * (t.w / 402);
        for (const axis of ['x', 'y'])
          body += `<NSDictionary><axis type="string" value="${axis}"/><image type="null"/><keyPath type="string" value="transform.translation.${axis}"/><layerName type="string" value="${lightName}"/><mapMaxTo type="real" value="${num(axis === 'x' ? n : -n)}"/><mapMinTo type="real" value="${num(axis === 'x' ? -n : n)}"/><title type="string" value="Morph light"/><view type="string" value="Floating"/></NSDictionary>`;
      }
      xml = xml.slice(0, gs.index) + `<wallpaperParallaxGroups type="NSArray">${body}</wallpaperParallaxGroups>` + xml.slice(gs.index + gs[0].length);
    }
    files.set(camlPath, enc.encode(xml));
  }
  return { zip: createZip([...files].map(([path, data]) => ({ path, data }))), changed, wallpapers: targets.length };
}

export const TUNE_DEFAULTS = {
  brightness: 0, // -0.4 … 0.4
  contrast: 1, // 0.5 … 1.8
  saturation: 1, // 0 … 2
  hue: 0, // degrees
  gyro: 1, // × Apple's own tilt / parallax range
  light: { intensity: 0, color: '#ffd9a0', pos: 'top', blend: 'screenBlendMode', follow: 40, size: 0.9 },
};
const LIGHT_POS = { top: [0, 0.36], topLeft: [-0.38, 0.36], topRight: [0.38, 0.36], center: [0, 0], bottom: [0, -0.36] };

/** Apple's system-drawn wallpapers (MercuryPoster): the only knobs are the look, appearance and motion. */
export const SYSTEM_LOOKS = ['colorA', 'colorB', 'colorC', 'colorD'];
/** Mercury wallpaper families seen in Apple's files (descriptor.identifier = "<family>.<look>") */
export const SYSTEM_FAMILIES = [
  ['v6x', 'iPhone 17e / 18 Pro'],
  ['v68', 'iPhone Duo – Dunes'],
];
export async function tuneSystem(input, { look, appearance, motion, family } = {}) {
  const files = await readZip(input);
  let n = 0;
  for (const [path, bytes] of files) {
    if (/provider\.descriptor\.identifier$/.test(path) && (family || look)) {
      const [fam, lk] = new TextDecoder().decode(bytes).trim().split('.');
      files.set(path, new TextEncoder().encode(`${family || fam}.${look || lk}`));
      continue;
    }
    if (/provider\.contents\.userInfo$/.test(path)) {
      const u = parsePlist(bytes, true);
      if (look) u.lookIdentifier = look;
      if (appearance) u.appearanceMode = appearance;
      files.set(path, toBinaryPlist(u));
      n++;
    } else if (/configurableOptions\.plist$/.test(path) && motion != null) {
      const o = parsePlist(bytes, true);
      for (const obj of o.$objects || []) if (obj && typeof obj === 'object' && 'motionEffectsDisabled' in obj) obj.motionEffectsDisabled = !motion;
      files.set(path, toBinaryPlist(o));
    }
  }
  return { zip: createZip([...files].map(([path, data]) => ({ path, data }))), wallpapers: n };
}

export const RAW_CAPABLE = (id) => id === 'vignette' || /^fx-\w+$/.test(id);

const EDITABLE_ANIM = /^(contents|position(\.[xy])?|transform\.translation\.[xy]|transform\.rotation(\.z)?|transform\.scale(\.xy)?|opacity)$/;

/** true when a package should be morphed in place instead of being rebuilt from editable layers:
 *  Apple's own wallpapers (HEIC strips, nested 3D transform rigs) lose detail in the editor. */
export async function prefersRawMorph(input) {
  const files = await readZip(input);
  const info = inspectPackage(files);
  if (info.systemOnly) return true;
  if ([...files.keys()].some((p) => /\.heic$/i.test(p))) return true;
  for (const c of info.camls) {
    const xml = dec.decode(files.get(c));
    for (const m of xml.matchAll(/<CATransformLayer\b[^>]*\sname="([^"]*)"/g)) if (!/ (Parallax( 2)?|Tilt)$/.test(m[1])) return true;
    // endless animations the editor can't represent (bounds, corner radius, colour filters, full transform …)
    for (const m of xml.matchAll(/<(?:animation|p)\b[^>]*\bkeyPath="([^"]+)"[^>]*\brepeatCount="(?:inf|\d{4,})"/g)) if (!EDITABLE_ANIM.test(m[1])) return true;
  }
  return false;
}

// ---------------------------------------------------------------- edit the original CAML
// Everything a wallpaper file exposes, made editable without rebuilding it:
// gyro groups, swipe/AOD property groups, every named layer (hidden, opacity) and images.

const DICT_RE = /<NSDictionary>([\s\S]*?)<\/NSDictionary>/g;
const dval = (d, k) => {
  const m = new RegExp(`<${k} type="(\\w+)"(?: value="([^"]*)")?\\s*/>`).exec(d);
  return m ? (m[1] === 'null' ? null : m[1] === 'real' || m[1] === 'integer' ? Number(m[2]) : m[2]) : undefined;
};
const section = (xml, name) => new RegExp(`<${name} type="NSArray">([\\s\\S]*?)</${name}>`).exec(xml);

/** a readable summary of a CAML document */
export function describeCaml(xml) {
  const dicts = (name) => {
    const s = section(xml, name);
    return s ? [...s[1].matchAll(DICT_RE)].map((m) => m[1]) : [];
  };
  const parallax = dicts('wallpaperParallaxGroups').map((d, i) => ({ i, title: dval(d, 'title'), layerName: dval(d, 'layerName'), keyPath: dval(d, 'keyPath'), axis: dval(d, 'axis'), min: dval(d, 'mapMinTo'), max: dval(d, 'mapMaxTo') }));
  const props = dicts('wallpaperPropertyGroups').map((d, i) => ({ i, title: dval(d, 'title'), layerName: dval(d, 'layerName'), keyPath: dval(d, 'keyPath'), lock: dval(d, 'v_lock'), home: dval(d, 'v_home'), sleep: dval(d, 'v_sleep') }));
  const layers = [];
  const re = new RegExp(LAYER_TAG.source, 'g');
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] === '/') continue;
    const name = attr(m[0], 'name');
    if (!name || / \(morph\)$/.test(name) || /^morph-/.test(attr(m[0], 'id') || '')) continue;
    layers.push({ i: layers.length, name, kind: m[2], hidden: attr(m[0], 'hidden') === '1', opacity: attr(m[0], 'opacity') == null ? 1 : Number(attr(m[0], 'opacity')) });
  }
  const images = [...new Set([...xml.matchAll(/<(?:CGImage|contents)\b[^>]*\ssrc="([^"]+)"/g)].map((x) => x[1]))];
  return { parallax, props, layers, images };
}

/** apply edits from describeCaml indices: {parallax:{i:{min,max}}, props:{i:{lock,home,sleep}}, layers:{i:{hidden,opacity}}, images:{oldSrc:newSrc}} */
export function editCaml(xml, e = {}) {
  const setVal = (d, k, v) => {
    if (v == null || Number.isNaN(v)) return d;
    const re = new RegExp(`<${k} type="(real|integer)" value="[^"]*"\\s*/>`);
    return re.test(d) ? d.replace(re, `<${k} type="real" value="${num(v)}"/>`) : d;
  };
  const editSection = (name, map, keys) => {
    if (!map || !Object.keys(map).length) return;
    const s = section(xml, name);
    if (!s) return;
    let i = -1;
    const body = s[1].replace(DICT_RE, (all, d) => {
      i++;
      const ed = map[i];
      if (!ed) return all;
      let out = d;
      for (const [field, key] of keys) out = setVal(out, key, ed[field]);
      return `<NSDictionary>${out}</NSDictionary>`;
    });
    xml = xml.slice(0, s.index) + `<${name} type="NSArray">${body}</${name}>` + xml.slice(s.index + s[0].length);
  };
  editSection('wallpaperParallaxGroups', e.parallax, [['min', 'mapMinTo'], ['max', 'mapMaxTo']]);
  editSection('wallpaperPropertyGroups', e.props, [['lock', 'v_lock'], ['home', 'v_home'], ['sleep', 'v_sleep']]);
  if (e.layers && Object.keys(e.layers).length) {
    let i = -1;
    const re = new RegExp(LAYER_TAG.source, 'g');
    xml = xml.replace(re, (tag, close, kind) => {
      if (close === '/') return tag;
      const name = attr(tag, 'name');
      if (!name || / \(morph\)$/.test(name) || /^morph-/.test(attr(tag, 'id') || '')) return tag;
      i++;
      const ed = e.layers[i];
      if (!ed) return tag;
      let t = tag;
      const set = (k, v) => {
        t = new RegExp(`\\s${k}="[^"]*"`).test(t) ? t.replace(new RegExp(`\\s${k}="[^"]*"`), ` ${k}="${v}"`) : t.replace(new RegExp(`^<${kind}\\b`), `<${kind} ${k}="${v}"`);
      };
      if (ed.hidden != null) set('hidden', ed.hidden ? 1 : 0);
      if (ed.opacity != null) set('opacity', num(ed.opacity));
      return t;
    });
  }
  for (const [from, to] of Object.entries(e.images || {})) xml = xml.split(`src="${from}"`).join(`src="${to}"`);
  return xml;
}

/** the Core Animation documents of a package, with what each exposes */
export async function openPackage(input) {
  const files = await readZip(input);
  const info = inspectPackage(files);
  const docs = info.camls.map((path) => ({
    path,
    label: (path.match(/([^/]+)\.wallpaper\//)?.[1] || path.split('/').slice(-3, -2)[0] || 'Wallpaper').replace(/^\d+\./, '') + (/_Floating/i.test(path) ? ' · floating' : /_Background/i.test(path) ? ' · background' : ''),
    ...describeCaml(dec.decode(files.get(path))),
  }));
  return { systemOnly: info.systemOnly, docs };
}
