// Import existing .tendies into editable projects (best effort).
// Supports LayeredAnimation (LKStates) and ParameterizedCA (wallpaperPropertyGroups +
// wallpaperParallaxGroups), image layers, frame sequences, blend modes and filters.
// CAML is y-up; the editor is y-down → y = H - y, rotation = -rotation.

import { readZip } from '../core/zip.js';
import { parsePlist } from '../core/plist.js';
import { newProject, newLayer, uid, ANIMATABLE } from '../core/model.js';
import { DEVICES } from '../core/devices.js';

const mime = (p) => (/\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.heic$/i.test(p) ? 'image/heic' : 'image/png');
const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const nums = (s) => String(s || '').trim().split(/[\s,]+/).map(Number);
const RAD = 180 / Math.PI;

function parseTransform(s) {
  const out = { rot: 0, scale: 1, sx: 1, sy: 1 };
  if (!s) return out;
  // z rotations only (rotate(Xdeg) without an axis, or with axis 0,0,1)
  for (const m of s.matchAll(/rotate\(\s*(-?[\d.e+-]+)deg\s*(?:,\s*(-?[\d.e+-]+)\s*,\s*(-?[\d.e+-]+)\s*,\s*(-?[\d.e+-]+)\s*)?\)/g)) {
    if (m[2] == null || (Number(m[2]) === 0 && Number(m[3]) === 0 && Number(m[4]) !== 0)) out.rot += Number(m[1]) * (m[4] != null && Number(m[4]) < 0 ? -1 : 1);
  }
  for (const m of s.matchAll(/scale\(\s*(-?[\d.e+-]+)(?:\s*,\s*(-?[\d.e+-]+))?/g)) {
    out.sx *= Number(m[1]);
    out.sy *= m[2] != null ? Number(m[2]) : Number(m[1]);
  }
  out.scale = out.sx;
  return out;
}

// ---------------------------------------------------------------- colours, gradients, text, particles

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hex2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
/** "r g b [a]" (extended sRGB floats) as attribute, or <name value="r g b" opacity="a"/> child */
function readColor(el, attrName) {
  let v = el.getAttribute(attrName);
  let a = 1;
  if (v == null) {
    const n = el.querySelector(`:scope > ${attrName}`);
    if (!n) return null;
    v = n.getAttribute('value');
    if (n.hasAttribute('opacity')) a = Number(n.getAttribute('opacity'));
  }
  const c = nums(v);
  if (c.length < 3 || c.some((x) => !Number.isFinite(x))) return null;
  if (c.length >= 4) a *= c[3];
  return { hex: `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`, a: clamp01(a) };
}
const colorHex = (v) => {
  const c = nums(v);
  return c.length >= 3 && c.every(Number.isFinite) ? `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}` : null;
};

function readGradient(el) {
  const colors = [...el.querySelectorAll(':scope > colors > *')].map((n) => colorHex(n.getAttribute('value'))).filter(Boolean);
  if (colors.length < 2) return null;
  let locs = [...el.querySelectorAll(':scope > locations > *')].map((n) => Number(n.getAttribute('value')));
  if (locs.length !== colors.length) locs = colors.map((_, i) => i / (colors.length - 1));
  const [sx = 0.5, sy = 0] = el.hasAttribute('startPoint') ? nums(el.getAttribute('startPoint')) : [];
  const [ex = 0.5, ey = 1] = el.hasAttribute('endPoint') ? nums(el.getAttribute('endPoint')) : [];
  const type = el.getAttribute('type') === 'radial' ? 'radial' : 'linear';
  // unit points with y down → editor angle (180 = top → bottom)
  const angle = Math.round(((Math.atan2(ex - sx, -(ey - sy)) * 180) / Math.PI + 360) % 360);
  return { type, angle, stops: colors.map((c, i) => ({ c, p: clamp01(locs[i]) })) };
}

function readText(el, scale) {
  const str = el.getAttribute('string') ?? el.querySelector(':scope > string')?.getAttribute('value') ?? el.querySelector(':scope > string')?.textContent;
  if (!str) return null;
  const fg = readColor(el, 'foregroundColor');
  const align = { left: 'left', right: 'right', center: 'center', natural: 'left', justified: 'left' }[el.getAttribute('alignmentMode')] || 'center';
  return { content: String(str), size: Math.round((Number(el.getAttribute('fontSize')) || 36) * scale), color: fg?.hex || '#ffffff', align, shadow: 0 };
}

/** CAEmitterLayer → editor particles (first cell): position, direction, gravity and size in screen space */
async function readEmitter(el, own, resolve, files, caDir, H) {
  const cell = el.querySelector(':scope > emitterCells > CAEmitterCell');
  if (!cell) return null;
  const n = (k, d = 0) => (cell.hasAttribute(k) ? Number(cell.getAttribute(k)) : d);
  const [epx = 0, epy = 0] = nums(el.getAttribute('emitterPosition'));
  const [esw = 0, esh = 0] = nums(el.getAttribute('emitterSize'));
  const lin = (x, y) => [own[0] * x + own[2] * y, own[1] * x + own[3] * y];
  const [wx, wy] = mApply(own, epx, epy);
  const sc = Math.hypot(own[0], own[1]) || 1;
  // a direction in emitter space → editor degrees (screen, y down)
  const dirDeg = (ang) => {
    const [dx, dy] = lin(Math.cos(ang), Math.sin(ang));
    return (Math.atan2(-dy, dx) * 180) / Math.PI;
  };
  const [ax, ay] = lin(n('xAcceleration'), n('yAcceleration'));
  const src = cell.querySelector(':scope > contents > CGImage, :scope > contents[src]')?.getAttribute('src') || cell.querySelector('CGImage')?.getAttribute('src');
  let particleAsset = null;
  let imgPx = 64;
  if (src) {
    particleAsset = await resolve(src);
    try {
      const bytes = files.get(caDir + src) || files.get(caDir + safeDecode(src));
      const bmp = await createImageBitmap(new Blob([bytes]));
      imgPx = Math.max(bmp.width, bmp.height) || 64;
      bmp.close?.();
    } catch {
      /* keep 64 */
    }
  }
  const cs = n('contentsScale', 1) || 1;
  const shape = el.getAttribute('emitterShape') || 'point';
  const lineShape = shape === 'line';
  const wPt = Math.max(8, Math.abs(esw) * sc);
  const hPt = lineShape ? 8 : Math.max(8, Math.abs(esh) * sc);
  const fg = colorHex(cell.getAttribute('color') || '1 1 1') || '#ffffff';
  const longitude = dirDeg(n('emissionLongitude'));
  return {
    x: wx,
    y: H - wy,
    w: wPt,
    h: hPt,
    emitter: {
      preset: 'custom',
      name: 'Imported',
      birthRate: n('birthRate', 1) * (Number(el.getAttribute('birthRate')) || 1),
      lifetime: n('lifetime', 1) * (Number(el.getAttribute('lifetime')) || 1),
      velocity: n('velocity') * sc * (Number(el.getAttribute('velocity')) || 1),
      velocityRange: n('velocityRange') * sc,
      emissionLongitude: Math.round(longitude * 10) / 10,
      emissionRange: (Math.abs(n('emissionRange')) * 180) / Math.PI,
      xAcceleration: ax,
      yAcceleration: -ay,
      scale: n('scale', 1),
      scaleRange: n('scaleRange'),
      spin: n('spin'),
      spinRange: n('spinRange'),
      alphaSpeed: n('alphaSpeed'),
      color: fg,
      size: (imgPx / cs) * sc, // pt size of the particle image at scale 1
      particle: 'dot',
      particleAsset,
      shape: lineShape ? 'line' : 'rectangle',
      additive: el.getAttribute('renderMode') === 'additive',
    },
  };
}

// ---------------------------------------------------------------- animations

const ANIM_KEYS = new Set(['position', 'position.x', 'position.y', 'transform.translation.x', 'transform.translation.y', 'transform.rotation.z', 'transform.rotation', 'transform.scale', 'transform.scale.xy', 'opacity']);
const valOf = (n) => {
  if (!n) return null;
  const v = n.getAttribute('value');
  if (n.tagName === 'CGPoint' || /\s/.test(v || '')) return nums(v);
  return Number(v);
};

/**
 * CAML animations on one element (link of the layer chain) → editor animations
 * (offsets / multipliers relative to the element, in screen space).
 */
function readAnimations(link) {
  const out = [];
  for (const a of link.el.querySelectorAll(':scope > animations > *')) {
    const kp = a.getAttribute('keyPath') || '';
    const type = a.getAttribute('type') || '';
    if (!ANIM_KEYS.has(kp) || /Spring/.test(type)) continue;
    let values = [];
    let keyTimes = [];
    if (/Keyframe/.test(type)) {
      values = [...a.querySelectorAll(':scope > values > *')].map(valOf);
      keyTimes = [...a.querySelectorAll(':scope > keyTimes > *')].map((n) => Number(n.getAttribute('value')));
    } else {
      const from = a.querySelector(':scope > fromValue');
      const to = a.querySelector(':scope > toValue');
      if (!from || !to) continue;
      values = [valOf(from), valOf(to)];
    }
    values = values.filter((v) => v != null && (Array.isArray(v) ? v.every(Number.isFinite) : Number.isFinite(v)));
    if (values.length < 2) continue;
    if (keyTimes.length !== values.length) keyTimes = values.map((_, i) => i / (values.length - 1));
    const rep = a.getAttribute('repeatCount');
    const timing = {
      duration: Number(a.getAttribute('duration')) || 1,
      autoreverse: a.getAttribute('autoreverses') === '1',
      repeat: rep === 'inf' || Number(rep) > 1e6 || a.getAttribute('repeatDuration') === 'inf' ? 'loop' : 'once',
      easing: a.getAttribute('timingFunction') || 'linear',
      delay: Math.max(0, Number(a.getAttribute('timeOffset')) || 0),
    };
    const make = (prop, vs) => ({ id: uid('A'), preset: 'custom', prop, amount: 0, absPos: !kp.startsWith('transform.'), keys: vs.map((v, i) => ({ t: Math.max(0, Math.min(1, keyTimes[i])), v: Math.round(v * 1000) / 1000 })), ...timing, enabled: true });
    const m = link.pm || I2;
    const sd = (dx, dy) => [m[0] * dx + m[2] * dy, -(m[1] * dx + m[3] * dy)];
    if (kp === 'position' || kp === 'position.x' || kp === 'position.y' || kp.startsWith('transform.translation')) {
      const own = kp.startsWith('transform.translation');
      const d = values.map((v) => {
        let dx = 0, dy = 0;
        if (kp === 'position') [dx, dy] = [v[0] - (link.px || 0), v[1] - (link.py || 0)];
        else if (kp === 'position.x') dx = v - (link.px || 0);
        else if (kp === 'position.y') dy = v - (link.py || 0);
        else if (kp === 'transform.translation.x') dx = v;
        else dy = v;
        if (own) [dx, dy] = [dx * (link.ts || 1), dy * (link.ts || 1)];
        return sd(dx, dy);
      });
      if (d.some(([x]) => Math.abs(x) > 0.01)) out.push(make('x', d.map(([x]) => x)));
      if (d.some(([, y]) => Math.abs(y) > 0.01)) out.push(make('y', d.map(([, y]) => y)));
    } else if (kp.startsWith('transform.rotation')) {
      // CA radians counter-clockwise → editor degrees clockwise, relative to the element's own rotation
      out.push(make('rotation', values.map((v) => -(v * RAD - (link.tr || 0)))));
    } else if (kp.startsWith('transform.scale')) {
      out.push(make('scale', values.map((v) => v / (link.ts || 1))));
    } else if (kp === 'opacity') {
      out.push(make('opacity', values.map((v) => v / (link.opAttr > 0 ? link.opAttr : 1))));
    }
  }
  return out;
}

// 2D affine matrices [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (CA space, y up)
const I2 = [1, 0, 0, 1, 0, 0];
const mm = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const mT = (x, y) => [1, 0, 0, 1, x, y];
const mRS = (deg, sx, sy) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, 0, 0];
};
const mApply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** matrix from a layer's own bounds space into its parent's sublayer space – exactly like Core Animation */
function layerMatrix(el) {
  const [bx = 0, by = 0, bw = 0, bh = 0] = nums(el.getAttribute('bounds'));
  const [px = 0, py = 0] = nums(el.getAttribute('position'));
  const [ax, ay] = el.hasAttribute('anchorPoint') ? nums(el.getAttribute('anchorPoint')) : [0.5, 0.5];
  const tr = parseTransform(el.getAttribute('transform'));
  return mm(mm(mm(mT(px || 0, py || 0), mRS(tr.rot, tr.sx, tr.sy)), mT(-(ax ?? 0.5) * (bw || 0), -(ay ?? 0.5) * (bh || 0))), mT(-(bx || 0), -(by || 0)));
}
/** the space a layer's sublayers live in (geometryFlipped flips it, sublayerTransform 2D part applies) */
function childSpace(el, own) {
  const [, by = 0, , bh = 0] = nums(el.getAttribute('bounds'));
  let m = own;
  const st = el.getAttribute('sublayerTransform');
  if (st && !/perspective/.test(st)) {
    const t = parseTransform(st);
    const [bx2 = 0, by2 = 0, bw2 = 0, bh2 = 0] = nums(el.getAttribute('bounds'));
    const cx = bx2 + bw2 / 2, cy = by2 + bh2 / 2;
    m = mm(m, mm(mm(mT(cx, cy), mRS(t.rot, t.sx, t.sy)), mT(-cx, -cy)));
  }
  if (el.getAttribute('geometryFlipped') === '1') m = mm(m, [1, 0, 0, -1, 0, 2 * (by || 0) + (bh || 0)]);
  return m;
}

function planeOf(caName, wp) {
  const d = wp?.assets?.lockAndHome?.default || {};
  if (caName === d.floatingAnimationFileNameKey || caName === d.foregroundAnimationFileName || /_Floating|_Foreground/i.test(caName)) return 'floating';
  return 'background';
}

export async function importTendies(buf, storeAsset) {
  const files = await readZip(buf);
  const paths = [...files.keys()];
  const warnings = [];
  const dec = new TextDecoder();
  let wallpapers = paths.filter((p) => /\.wallpaper\/Wallpaper\.plist$/i.test(p));
  if (!wallpapers.length) {
    if (!paths.some((p) => /\.ca\/main\.caml$/i.test(p))) {
      if (paths.some((p) => /provider\.descriptor\.identifier$/.test(p))) {
        const e = new Error('This is a built-in iOS wallpaper: the file only points to a wallpaper iOS draws itself, it contains no images or layers to edit.');
        e.code = 'system_only';
        throw e;
      }
      throw new Error('No PosterBoard wallpaper found in this file.');
    }
    wallpapers = [null];
  }
  const projects = [];
  for (const wpPath of wallpapers) {
    const wpDir = wpPath ? wpPath.replace(/Wallpaper\.plist$/i, '') : '';
    let wp = null;
    try {
      wp = wpPath ? parsePlist(files.get(wpPath)) : null;
    } catch {
      warnings.push('Could not read Wallpaper.plist.');
    }
    const parameterized = wp?.assets?.lockAndHome?.default?.type === 'ParameterizedCA';
    const cls = wp?.logicalScreenClass || '';
    const m = /^(\d+)w-(\d+)h@(\d)x/.exec(cls);
    const dev = m && DEVICES.find((d) => d.w === +m[1] && d.h === +m[2]);
    const proj = newProject(dev?.id || DEVICES[2].id, dev || DEVICES[2]);
    proj.format = parameterized ? 'modern' : 'classic';
    proj.name = (wp?.name && !['Lavender', 'Chip'].includes(wp.name) ? wp.name : '') || wpDir.split('/').filter(Boolean).pop()?.replace(/\.wallpaper$/, '').replace(/^\d+\./, '') || 'Imported';
    proj.appearanceAware = !!wp?.appearanceAware && !parameterized;

    let docW = 0;
    let docH = 0;
    const caMain = paths.filter((p) => p.startsWith(wpDir) && /\.ca\/main\.caml$/i.test(p));
    for (const mainPath of caMain) {
      const caDir = mainPath.replace(/main\.caml$/i, '');
      const caName = caDir.split('/').filter(Boolean).pop();
      const xml = dec.decode(files.get(mainPath));
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const root = doc.documentElement.firstElementChild;
      if (!root) continue;
      const [, , rw, rh] = nums(root.getAttribute('bounds'));
      const H = rh || proj._h;
      docW = Math.max(docW, rw || 0);
      docH = Math.max(docH, rh || 0);
      if (/LKState name="[^"]+ (Light|Dark)"/.test(xml)) proj.appearanceAware = true;

      const byId = new Map(); // CA id -> editor layer
      const byName = new Map(); // CA layer name -> [{layer, opacityAttr}]
      const resolve = async (s) => {
        // srcs are often URL-encoded ("woopah1%201.PNG" for "woopah1 1.PNG")
        let dec2 = s;
        try {
          dec2 = decodeURIComponent(s);
        } catch {
          /* keep */
        }
        const bytes = files.get(caDir + s) || files.get(caDir + dec2) || files.get(caDir + s.replace(/%20/g, ' '));
        return bytes ? storeAsset(new Blob([bytes], { type: mime(s) })) : null;
      };
      const layerGeo = new Map(); // editor layer -> { pm: parent sublayer-space matrix, px, py }
      const idGeo = new Map(); // CA id -> the same for the element that carries the id (state targets)
      const walk = async (el, space, op, chain, plane) => {
        for (const child of el.querySelectorAll(':scope > sublayers > *')) {
          const tag = child.tagName;
          const name = child.getAttribute('name') || '';
          let pl = plane;
          if (name === 'BACKGROUND') pl = 'background';
          if (name === 'FLOATING' || name === 'FOREGROUND') pl = 'floating';
          const [bx0 = 0, by0 = 0, w, h] = nums(child.getAttribute('bounds'));
          const own = mm(space, layerMatrix(child));
          // centre of the layer in document space (y up), its on-screen size and rotation
          const [cx, cy] = mApply(own, (bx0 || 0) + (w || 0) / 2, (by0 || 0) + (h || 0) / 2);
          const wsx = Math.hypot(own[0], own[1]);
          const wsy = Math.hypot(own[2], own[3]);
          const wrot = (Math.atan2(own[1], own[0]) * 180) / Math.PI;
          const [ppx = 0, ppy = 0] = nums(child.getAttribute('position'));
          const opAttr = child.hasAttribute('opacity') ? Number(child.getAttribute('opacity')) : 1;
          const tr = parseTransform(child.getAttribute('transform'));
          const ownUniform = Math.abs(Math.abs(tr.sx) - Math.abs(tr.sy)) < 1e-6 && tr.sx !== 0;
          const link = { name, opAttr, el: child, pm: space, px: ppx, py: ppy, ts: tr.sx || 1, tr: tr.rot };
          const nextChain = [...chain, link];
          const common = (l) => {
            proj.layers.push(l);
            layerGeo.set(l, { pm: space, px: ppx, py: ppy, s0: l.scale || 1, r0: l.rotation || 0, ts: tr.sx || 1, tr: tr.rot });
            for (const c of nextChain) (byName.get(c.name) || byName.set(c.name, []).get(c.name)).push({ layer: l, opAttr: c.opAttr, pm: c.pm });
            const id = child.getAttribute('id');
            if (id && !byId.has(id)) (byId.set(id, l), idGeo.set(id, { pm: space, px: ppx, py: ppy, ts: tr.sx || 1, tr: tr.rot }));
            return l;
          };
          const cumOp = nextChain.reduce((s2, c) => s2 * c.opAttr, op);
          const geo = { plane: pl, x: cx, y: H - cy, w: (w || 0) * wsx, h: (h || 0) * wsy, rotation: Math.round(-wrot * 100) / 100, hidden: child.getAttribute('hidden') === '1', cornerRadius: (Number(child.getAttribute('cornerRadius')) || 0) * wsx };
          // solid colour fill (backgroundColor) – drawn behind the layer's own picture / sublayers
          const bg = readColor(child, 'backgroundColor');
          if (bg && bg.a > 0.004 && w > 0 && h > 0 && tag !== 'CAEmitterLayer' && tag !== 'CATransformLayer') {
            common(newLayer('color', proj, { ...geo, name: `${name || 'Color'}${child.querySelector(':scope > contents') ? ' fill' : ''}`, color: bg.hex, opacity: cumOp * bg.a }));
          }
          if (tag === 'CAGradientLayer') {
            const g = readGradient(child);
            if (g) common(newLayer('gradient', proj, { ...geo, name: name || 'Gradient', gradient: g, opacity: cumOp }));
          }
          if (tag === 'CATextLayer') {
            const t = readText(child, wsx);
            if (t) common(newLayer('text', proj, { ...geo, name: name || 'Text', text: { ...newLayer('text', proj).text, ...t }, opacity: cumOp }));
          }
          if (tag === 'CAEmitterLayer') {
            const em = await readEmitter(child, own, resolve, files, caDir, H);
            if (em) common(newLayer('emitter', proj, { ...em, plane: pl, name: name || 'Particles', opacity: cumOp, hidden: geo.hidden }));
            else warnings.push(`Particle layer “${name}” could not be read.`);
            continue;
          }
          if (tag === 'CABackdropLayer') {
            const l = newLayer('glass', proj, { name: name || 'Glass', plane: pl, x: cx, y: H - cy, w: (w || 100) * wsx, h: (h || 100) * wsy, cornerRadius: Number(child.querySelector('CASDFElementLayer')?.getAttribute('cornerRadius')) || Number(child.getAttribute('cornerRadius')) || 0, glass: { mode: child.querySelector('CASDFLayer') ? 'liquid' : 'live', blur: 20, tint: '#ffffff', tintOpacity: 0.1, border: 0.4, saturation: 1.4, shine: 0.3, refraction: 80 } });
            proj.layers.push(l);
            for (const c of nextChain) (byName.get(c.name) || byName.set(c.name, []).get(c.name)).push({ layer: l, opAttr: c.opAttr, pm: c.pm });
            const id = child.getAttribute('id');
            if (id) (byId.set(id, l), idGeo.set(id, { pm: space, px: ppx, py: ppy, ts: tr.sx || 1, tr: tr.rot }));
            continue;
          }
          const img = child.querySelector(':scope > contents > CGImage, :scope > contents[src]');
          const src = img?.getAttribute('src');
          const frameAnim = child.querySelector(':scope > animations > [keyPath="contents"]');
          let frameSrcs = frameAnim ? [...frameAnim.querySelectorAll('values > CGImage')].map((n) => n.getAttribute('src')) : [];
          if (frameAnim && !frameSrcs.some((x) => files.has(caDir + x) || files.has(caDir + safeDecode(x)))) frameSrcs = [];
          if (src || frameSrcs.length) {
            let layer;
            if (frameSrcs.length) {
              const srcs = [...frameAnim.querySelectorAll('values > CGImage')].map((n) => n.getAttribute('src'));
              const uniq = [...new Set(srcs)];
              const ids = await Promise.all(uniq.map(resolve));
              const frames = ids.filter(Boolean);
              const dur = Number(frameAnim.getAttribute('duration')) || srcs.length / 24;
              layer = newLayer('video', proj, { video: { frames, sequence: srcs.map((s) => uniq.indexOf(s)), fps: Math.max(1, Math.round(srcs.length / dur)) || 24, autoreverse: frameAnim.getAttribute('autoreverses') === '1', calc: frameAnim.getAttribute('calculationMode') === 'linear' ? 'linear' : 'discrete' } });
            } else {
              const asset = await resolve(src);
              if (!asset) {
                warnings.push(`Image ${src} is missing from the archive.`);
                continue;
              }
              layer = newLayer('image', proj, { asset });
            }
            const grav = child.getAttribute('contentsGravity');
            const cum = nextChain.reduce((s, c) => s * c.opAttr, op);
            const rot = wrot;
            const blend = [...nextChain].reverse().map((c) => c.el.querySelector(':scope > compositingFilter')?.getAttribute('filter')).find(Boolean);
            const blur = [...nextChain].reverse().map((c) => c.el.querySelector(':scope > filters > [filter="gaussianBlur"]')?.getAttribute('inputRadius')).find(Boolean);
            Object.assign(layer, {
              plane: pl,
              name: (name && !/ (Content|Rim)$/.test(name) ? name : nextChain.map((c) => c.name).find((n) => n && !/^(BACKGROUND|FLOATING|FOREGROUND|Root Layer)$/.test(n) && !/ (Parallax( 2)?|Anim \d+|Content|Rim|Tilt|Fade|GyroFade)$/.test(n))) || layer.name,
              x: cx,
              y: H - cy,
              // the layer's own uniform scale stays editable as Scale; parents' scale is baked into the size
              w: (w || proj._w) * (ownUniform ? wsx / Math.abs(tr.sx) : wsx),
              h: (h || proj._h) * (ownUniform ? wsy / Math.abs(tr.sy) : wsy),
              opacity: cum,
              rotation: Math.round(-rot * 100) / 100,
              scale: ownUniform ? Math.abs(tr.sx) : 1,
              hidden: child.getAttribute('hidden') === '1',
              fit: grav === 'resizeAspectFill' ? 'cover' : grav === 'resizeAspect' ? 'contain' : 'stretch',
              cornerRadius: Number(child.getAttribute('cornerRadius')) || 0,
              blend: blend || 'normal',
              filters: { blur: Number(blur) || 0, hue: 0, saturate: 1, contrast: 1 },
            });
            // looping / one-shot animations of this layer and its containers → editable animations
            const anims = [];
            for (const c of nextChain) {
              const got = readAnimations(c);
              // a container animating several pictures at once (e.g. a group that rotates) can only be
              // approximated per layer – morphs of such files keep the original instead (raw morph)
              if (got.length && c.el !== child && c.el.querySelectorAll('contents, CGImage').length > 1 && !proj.importLossy) {
                proj.importLossy = true;
                warnings.push('This wallpaper animates whole groups – edits approximate them. To keep it 100 % original, use ✨ Morph instead.');
              }
              anims.push(...got);
            }
            // moves are applied inside the layer, i.e. in its own (scaled) units
            const ls = Math.abs(layer.scale || 1) || 1;
            for (const a of anims) if (a.prop === 'x' || a.prop === 'y') for (const k of a.keys) k.v = Math.round((k.v / ls) * 1000) / 1000;
            if (anims.length) layer.anims = [...(layer.anims || []), ...anims];
            proj.layers.push(layer);
            layerGeo.set(layer, { pm: space, px: ppx, py: ppy, s0: layer.scale, r0: layer.rotation, ts: tr.sx || 1, tr: tr.rot });
            for (const c of nextChain) (byName.get(c.name) || byName.set(c.name, []).get(c.name)).push({ layer, opAttr: c.opAttr, pm: c.pm });
            for (const c of nextChain) {
              const id = c.el.getAttribute('id');
              if (id && !byId.has(id)) (byId.set(id, layer), idGeo.set(id, { pm: c.pm, px: c.px, py: c.py, ts: c.ts, tr: c.tr }));
            }
          }
          if (nextChain.length < 12) await walk(child, childSpace(child, own), op, nextChain, pl);
        }
      };
      // a colour on the root layer fills the whole document
      const rootBg = readColor(root, 'backgroundColor');
      if (rootBg && rootBg.a > 0.004) {
        const [, , rw2 = proj._w, rh2 = proj._h] = nums(root.getAttribute('bounds'));
        proj.layers.push(newLayer('color', proj, { plane: planeOf(caName, wp), name: 'Background colour', x: rw2 / 2, y: rh2 / 2, w: rw2, h: rh2, color: rootBg.hex, opacity: rootBg.a }));
      }
      // the root's sublayers: root bounds space = document space
      await walk(root, childSpace(root, I2), 1, [], planeOf(caName, wp));
      // a position change (in the layer's parent space) → screen delta
      // a position change, expressed in the space the changed element lives in → screen delta
      const screenDelta = (m, dx, dy) => {
        m ||= I2;
        return [m[0] * dx + m[2] * dy, -(m[1] * dx + m[3] * dy)];
      };

      // LayeredAnimation states
      for (const st of root.querySelectorAll(':scope > states > LKState')) {
        const mm = /^(Locked|Unlock|Sleep)(?: (Light|Dark))?$/.exec(st.getAttribute('name') || '');
        if (!mm) continue;
        const key = mm[2] === 'Dark' ? `${mm[1]}@dark` : mm[1];
        for (const sv of st.querySelectorAll('LKStateSetValue')) {
          const layer = byId.get(sv.getAttribute('targetId'));
          const kp = sv.getAttribute('keyPath') === 'transform.scale.xy' ? 'transform.scale' : sv.getAttribute('keyPath');
          const val = sv.querySelector('value');
          if (!layer || !val) continue;
          const def = ANIMATABLE.find((a) => a.keyPath === kp || a.pcaKeyPath === kp);
          if (!def) continue;
          let v = Number(val.getAttribute('value'));
          const g = idGeo.get(sv.getAttribute('targetId')) || layerGeo.get(layer);
          if ((def.id === 'x' || def.id === 'y') && g) {
            const [dx, dy] = def.id === 'x' ? screenDelta(g.pm, v - g.px, 0) : screenDelta(g.pm, 0, v - g.py);
            const tgt = key === 'Locked' ? layer : (layer.states[key] ||= {});
            const baseX = layer.x, baseY = layer.y;
            if (Math.abs(dx) > 1e-6) tgt.x = baseX + dx;
            if (Math.abs(dy) > 1e-6) tgt.y = baseY + dy;
            // an animation of the absolute position wins over the state on device: keep its result unchanged
            if (key === 'Locked') {
              const ls = Math.abs(layer.scale || 1) || 1;
              for (const a of layer.anims || []) {
                if (!a.absPos) continue;
                if (a.prop === 'x' && Math.abs(dx) > 1e-6) for (const k of a.keys) k.v -= dx / ls;
                if (a.prop === 'y' && Math.abs(dy) > 1e-6) for (const k of a.keys) k.v -= dy / ls;
              }
            }
            continue;
          }
          const g0 = layerGeo.get(layer);
          if (def.id === 'scale' && g && g0) {
            // relative to the target element's own transform scale (already part of the imported size/scale)
            v = (g0.s0 * v) / (g.ts || 1);
            if (key === 'Locked') layer.scale = v;
            else (layer.states[key] ||= {}).scale = v;
            continue;
          }
          if (def.id === 'rotation' && g && g0) {
            // CA radians, counter-clockwise; editor degrees clockwise; relative to the element's own rotation
            v = g0.r0 - (v * RAD - (g.tr || 0));
            if (key === 'Locked') layer.rotation = v;
            else (layer.states[key] ||= {}).rotation = v;
            continue;
          }
          if (def.id === 'y') v = H - v;
          if (def.id === 'rotation') v = -v * RAD;
          if (key === 'Locked') layer[def.id] = v;
          else (layer.states[key] ||= {})[def.id] = v;
        }
      }

      // ParameterizedCA property + parallax groups (matched by layer name)
      const style = root.querySelector(':scope > style');
      if (style) {
        const val = (d, k) => {
          const n = d.querySelector(`:scope > ${k}`);
          return n ? n.getAttribute('value') : null;
        };
        for (const d of style.querySelectorAll(':scope > wallpaperPropertyGroups > NSDictionary')) {
          const targets = byName.get(val(d, 'layerName')) || [];
          const kp = val(d, 'keyPath');
          const vl = Number(val(d, 'v_lock'));
          const vh = Number(val(d, 'v_home'));
          const vs = Number(val(d, 'v_sleep'));
          for (const { layer, opAttr, pm } of targets) {
            const set = (st, prop, v) => (layer.states[st] ||= {})[prop] = Math.round(v * 1000) / 1000;
            if (kp === 'position.x' || kp === 'position.y') {
              const d = (v) => (kp === 'position.x' ? screenDelta(pm, v, 0) : screenDelta(pm, 0, v));
              const [hx, hy] = d(vh - vl);
              const [sx2, sy2] = d(vs - vl);
              if (Math.abs(hx) > 1e-6 || Math.abs(sx2) > 1e-6) (set('Unlock', 'x', layer.x + hx), set('Sleep', 'x', layer.x + sx2));
              if (Math.abs(hy) > 1e-6 || Math.abs(sy2) > 1e-6) (set('Unlock', 'y', layer.y + hy), set('Sleep', 'y', layer.y + sy2));
            } else if (kp === 'opacity') {
              const rest = opAttr > 0 ? layer.opacity / opAttr : 1;
              layer.opacity = rest * vl;
              set('Unlock', 'opacity', rest * vh);
              set('Sleep', 'opacity', rest * vs);
            } else if (kp?.startsWith('transform.scale')) {
              const k = vl || 1;
              set('Unlock', 'scale', (layer.scale * vh) / k);
              set('Sleep', 'scale', (layer.scale * vs) / k);
            } else if (kp === 'transform.rotation.z') {
              set('Unlock', 'rotation', layer.rotation - (vh - vl) * RAD);
              set('Sleep', 'rotation', layer.rotation - (vs - vl) * RAD);
            }
          }
        }
        for (const d of style.querySelectorAll(':scope > wallpaperParallaxGroups > NSDictionary')) {
          const n = Math.max(Math.abs(Number(val(d, 'mapMaxTo')) || 0), Math.abs(Number(val(d, 'mapMinTo')) || 0));
          const kp = val(d, 'keyPath') || '';
          const ln = val(d, 'layerName') || '';
          if (kp.startsWith('transform.rotation') && / Tilt$/.test(ln)) {
            // gyro tilt (our "<name> Tilt" rig): radians → degrees
            const deg = Math.round((n * 180) / Math.PI * 10) / 10;
            for (const { layer } of byName.get(ln) || []) {
              layer.gyro ||= { tilt: 0, fold: 0, fade: 'none', fadeMin: 0, fadeMax: 1 };
              if (kp === 'transform.rotation.y') layer.gyro.tilt = Math.max(layer.gyro.tilt || 0, deg);
              else layer.gyro.tiltV = deg;
            }
            continue;
          }
          if (!kp.startsWith('transform.translation')) continue;
          for (const { layer } of byName.get(ln) || []) layer.parallax = Math.max(layer.parallax || 0, n);
        }
      }
    }
    // drop overrides identical to base values
    for (const l of proj.layers) {
      for (const [k, v] of Object.entries(l.states)) {
        for (const p of Object.keys(v)) if (!k.includes('@') && Math.abs(v[p] - l[p]) < 1e-6) delete v[p];
        if (!Object.keys(v).length) delete l.states[k];
      }
    }
    if (docW && docH && (docW !== proj._w || docH !== proj._h)) {
      const d = DEVICES.find((x) => x.w === docW && x.h === docH);
      if (d) {
        proj.device = d.id;
        proj._w = d.w;
        proj._h = d.h;
      } else {
        // scale foreign canvases (e.g. 3176² or 1216×2160 CAPlayground docs) to cover the device
        const s = Math.max(proj._w / docW, proj._h / docH);
        const mx = (x) => proj._w / 2 + (x - docW / 2) * s;
        const my = (y) => proj._h / 2 + (y - docH / 2) * s;
        for (const l of proj.layers) {
          l.x = mx(l.x);
          l.y = my(l.y);
          l.w *= s;
          l.h *= s;
          l.parallax = Math.round((l.parallax || 0) * s);
          if (l.cornerRadius) l.cornerRadius *= s;
          if (l.text) l.text.size = Math.round(l.text.size * s);
          if (l.emitter) for (const k of ['size', 'velocity', 'velocityRange', 'xAcceleration', 'yAcceleration']) l.emitter[k] = (l.emitter[k] || 0) * s;
          for (const a of l.anims || []) if (a.prop === 'x' || a.prop === 'y') for (const k of a.keys) k.v *= s;
          for (const v of Object.values(l.states)) {
            if ('x' in v) v.x = mx(v.x);
            if ('y' in v) v.y = my(v.y);
          }
        }
        warnings.push(`Canvas ${docW}×${docH} was scaled to the device.`);
      }
    }
    if (!proj.layers.length) warnings.push(`“${proj.name}”: no importable image layers (e.g. Apple system wallpapers without assets).`);
    proj.id = uid('p');
    projects.push(proj);
  }
  return { projects, warnings };
}
