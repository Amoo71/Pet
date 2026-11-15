// Effects / Morph mode: one-click additions that work on any project – including
// imported .tendies – so an existing wallpaper can get "+ Duo fold", "+ Snow" …
//
// Duo fold re-creates the iPhone Duo fold choreography (studied from
// github.com/jal-co/iphone-duo and github.com/chuspeeism/iphone-duo):
//   * the left half of the picture is a panel hinged at the screen centre,
//   * it folds (rotation about Y around the hinge) as you tilt the phone,
//   * a progressively blurred copy (sharp at the hinge → blurry at the outer edge)
//     and a shade (up to ~52% black at the outer edge) fade in with the fold,
//   * the fixed half gets a light shade next to the hinge (~18%).
import { newLayer, EMITTER_PRESETS, uid } from '../core/model.js';
import { compositeLayers, addAsset } from './assets.js';
import { makeCanvas, canvasToBlob } from '../browser/raster.js';

const PARTICLES = ['snow', 'rain', 'sparkle', 'stars', 'bubbles', 'embers', 'petals', 'confetti'];

export const EFFECTS = [
  { id: 'duotilt', icon: '📱', name: 'Duo 3D tilt', desc: 'iPhone Duo look: the picture tilts back in 3D with the gyro, the far side blurs and darkens.' },
  { id: 'duo', icon: '📖', name: 'Duo fold', desc: 'iPhone Duo fold: the left half folds on its hinge as you tilt (blur + shade follow).' },
  { id: 'depth', icon: '🧊', name: 'Depth parallax', desc: 'Gives every layer gyro parallax – back layers move less, front layers more.' },
  { id: 'unlockZoom', icon: '🔍', name: 'Unlock zoom', desc: 'Background pushes in while you swipe up.' },
  { id: 'aodDim', icon: '🌙', name: 'Always-On dim', desc: 'Dims everything in Always-On.' },
  { id: 'vignette', icon: '◐', name: 'Vignette', desc: 'Soft dark edges.' },
  { id: 'glass', icon: '💧', name: 'Liquid Glass card', desc: 'Glass card near the bottom (iOS 26+).' },
  ...PARTICLES.map((k) => ({ id: `fx-${k}`, icon: { snow: '❄️', rain: '🌧️', sparkle: '✨', stars: '⭐', bubbles: '🫧', embers: '🔥', petals: '🌸', confetti: '🎉' }[k], name: EMITTER_PRESETS[k].name, desc: 'Particles (animate forever – uses more battery).' })),
];

export const DUO_DEFAULTS = { angle: 60, blur: 55, shade: 0.6, unlock: true, tilt: 24, strength: 44 };

const tag = (layers, fx) => layers.map((l) => Object.assign(l, { fx }));

async function canvasAsset(canvas, type = 'image/png', q = 0.9) {
  const blob = await canvasToBlob(canvas, type, q);
  return addAsset(blob, { w: canvas.width, h: canvas.height });
}

/** progressive blur: sharp at the hinge (right edge) → fully blurred at the outer (left) edge */
function progressiveBlur(src, radius) {
  const W = src.width;
  const H = src.height;
  const blurred = makeCanvas(W, H);
  const b = blurred.getContext('2d');
  // pad the edges so the blur doesn't fade to transparent
  const pad = radius * 2;
  b.filter = `blur(${radius}px)`;
  b.drawImage(src, -pad, -pad, W + pad * 2, H + pad * 2);
  b.filter = 'none';
  const mask = makeCanvas(W, H);
  const m = mask.getContext('2d');
  const g = m.createLinearGradient(W, 0, 0, 0);
  // chuspeeism/iphone-duo inner screen: blur radius ∝ edge^1.35 (0 at the hinge → max at the outer edge)
  for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `rgba(0,0,0,${Math.pow(i / 10, 1.35).toFixed(3)})`);
  m.fillStyle = g;
  m.fillRect(0, 0, W, H);
  b.globalCompositeOperation = 'destination-in';
  b.drawImage(mask, 0, 0);
  const out = makeCanvas(W, H);
  const o = out.getContext('2d');
  o.drawImage(src, 0, 0);
  o.drawImage(blurred, 0, 0);
  return out;
}

function shadeCanvas(W, H, max, fromRight) {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const g = fromRight ? x.createLinearGradient(0, 0, W, 0) : x.createLinearGradient(W, 0, 0, 0);
  g.addColorStop(0, `rgba(0,0,0,${fromRight ? max : 0.08 * max})`);
  g.addColorStop(fromRight ? 0.6 : 1, `rgba(0,0,0,${fromRight ? 0 : max})`);
  if (fromRight) g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  return c;
}

/**
 * Build the Duo fold layers.
 * @param {object} project
 * @param {HTMLCanvasElement|null} picture  full-screen picture (W×H × scale); null = flatten the current wallpaper
 */
export async function duoLayers(project, picture, o = DUO_DEFAULTS) {
  const W = project._w;
  const H = project._h;
  const scale = 3;
  const pic = picture || (await compositeLayers(project, [...project.layers.filter((l) => l.plane === 'background'), ...project.layers.filter((l) => l.plane !== 'background')], scale));
  const PW = pic.width;
  const PH = pic.height;
  const half = makeCanvas(PW / 2, PH);
  half.getContext('2d').drawImage(pic, 0, 0, PW / 2, PH, 0, 0, PW / 2, PH);
  const blur = progressiveBlur(half, Math.max(4, o.blur * (PW / W)));
  const shade = shadeCanvas(Math.round(PW / 2), PH, o.shade, false);
  const inner = shadeCanvas(Math.round(PW / 2), PH, 0.18, true);
  // what the fold reveals: the dark space behind the panel (dim, blurred hint of the picture)
  const back = makeCanvas(Math.round(PW / 2), PH);
  const bx = back.getContext('2d');
  bx.fillStyle = '#000';
  bx.fillRect(0, 0, back.width, back.height);
  bx.globalAlpha = 0.28;
  bx.filter = `blur(${Math.round(PW / 40)}px)`;
  bx.drawImage(half, 0, 0);
  const ids = {
    back: await canvasAsset(back, 'image/jpeg'),
    fold: await canvasAsset(half, 'image/jpeg'),
    blur: await canvasAsset(blur, 'image/jpeg'),
    shade: await canvasAsset(shade),
    inner: await canvasAsset(inner),
  };
  const panel = (name, asset, extra = {}) =>
    newLayer('image', project, {
      name,
      asset,
      x: W / 4,
      y: H / 2,
      w: W / 2,
      h: H,
      fit: 'stretch',
      plane: 'background',
      anchor: { x: 1, y: 0.5 }, // hinge = right edge of the left half = screen centre
      gyro: { tilt: 0, fold: o.angle, fade: 'none', fadeMin: 0, fadeMax: 1 },
      states: o.unlock ? { Unlock: { rotY: 0 } } : {},
      ...extra,
    });
  const lockFold = o.unlock ? Math.min(35, o.angle * 0.6) : 0;
  const layers = [];
  if (picture) {
    layers.push(newLayer('image', project, { name: 'Duo base', asset: await canvasAsset(picture, 'image/jpeg'), fit: 'cover', plane: 'background' }));
  }
  layers.push(
    newLayer('image', project, { name: 'Duo backdrop', asset: ids.back, x: W / 4, y: H / 2, w: W / 2, h: H, fit: 'stretch', plane: 'background' }),
    newLayer('image', project, {
      name: 'Duo hinge shade',
      asset: ids.inner,
      x: (W * 3) / 4,
      y: H / 2,
      w: W / 2,
      h: H,
      fit: 'stretch',
      plane: 'background',
      opacity: 1,
      gyro: { tilt: 0, fold: 0, fade: 'x', fadeMin: 0, fadeMax: 1 },
    }),
    panel('Duo fold', ids.fold, { rotY: lockFold }),
    panel('Duo fold blur', ids.blur, { rotY: lockFold, gyro: { tilt: 0, fold: o.angle, fade: 'x', fadeMin: 0, fadeMax: 1 }, states: o.unlock ? { Unlock: { rotY: 0, opacity: 0.4 } } : {} }),
    panel('Duo fold shade', ids.shade, { rotY: lockFold, gyro: { tilt: 0, fold: o.angle, fade: 'x', fadeMin: 0, fadeMax: 1 }, states: o.unlock ? { Unlock: { rotY: 0, opacity: 0.4 } } : {} })
  );
  return layers;
}

/**
 * Side strip for Duo 3D tilt: blurred, darkened copy of the picture's edge,
 * opaque at the outer edge and fading inward. It sits just outside the screen
 * and slides in with gyro translation (the only gyro key path verified on device).
 */
/**
 * The far-edge look of the iPhone Duo fold, as recreated 1:1 by Mac-Duo
 * (github.com/sumimakito/Mac-Duo, Apache-2.0 – DepthShaders / BlurGradient / DepthTuning):
 *   h      = 0 at the near edge … 1 at the far edge
 *   blur   = maxBlur · smoothstep(0.3, 1, h)^1.35   (Duo ^1.35 curve, only the outer part)
 *   colour = colour · (1 − maxDim · smoothstep(0.55, 1, h))^2.2   (Mac-Duo dimming)
 * Rendered as a bitmap whose far side is `far` ('left' | 'right').
 */
function duoFarCopy(src, far, maxBlur, maxDim, o = {}) {
  const W = src.width;
  const H = src.height;
  // only the outer part of the far side blurs / darkens – the middle stays clear
  const blurStart = o.blurStart ?? 0.3;
  const dimStart = o.dimStart ?? 0.55;
  const smooth = (e0, e1, x) => {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const hAt = (x) => (far === 'left' ? 1 - x / W : x / W);
  const blurAt = (h) => Math.pow(smooth(blurStart, 1, h), 1.35); // 0…1 of maxBlur (Duo curve ^1.35)
  const out = makeCanvas(W, H);
  const g = out.getContext('2d');
  g.drawImage(src, 0, 0);
  const N = 10;
  const level = (r) => {
    const c = makeCanvas(W, H);
    const x = c.getContext('2d');
    const pad = r * 2;
    x.filter = r > 0.5 ? `blur(${r}px)` : 'none';
    x.drawImage(src, -pad, -pad, W + pad * 2, H + pad * 2);
    return c;
  };
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const L = level(maxBlur * t);
    const m = makeCanvas(W, H);
    const mx = m.getContext('2d');
    const grad = mx.createLinearGradient(0, 0, W, 0);
    for (let k = 0; k <= 24; k++) {
      const x = k / 24;
      const a = Math.max(0, Math.min(1, (blurAt(hAt(x * W)) - (t - 1 / N)) * N));
      grad.addColorStop(x, `rgba(0,0,0,${a.toFixed(3)})`);
    }
    mx.fillStyle = grad;
    mx.fillRect(0, 0, W, H);
    mx.globalCompositeOperation = 'source-in';
    mx.drawImage(L, 0, 0);
    g.drawImage(m, 0, 0);
  }
  // dimming towards the far edge: colour · (1 − maxDim·fade)^2.2 (Mac-Duo)
  const dg = g.createLinearGradient(0, 0, W, 0);
  for (let k = 0; k <= 24; k++) {
    const x = k / 24;
    const keep = Math.pow(1 - maxDim * smooth(dimStart, 1, hAt(x * W)), 2.2);
    dg.addColorStop(x, `rgba(0,0,0,${(1 - keep).toFixed(3)})`);
  }
  g.fillStyle = dg;
  g.fillRect(0, 0, W, H);
  return out;
}

/**
 * Duo 3D tilt – the iPhone Duo fold look, driven by the gyro.
 * Model (Mac-Duo's DepthGeometry): the whole picture is one plate hinged at the NEAR edge
 * that turns back in real perspective – the far side recedes into black, and blur +
 * dimming grow towards it. A plate can only have one hinge, so there are two:
 *   * "Duo R" – hinged on the left edge, turns its right side away (tilt right, +x),
 *   * "Duo L" – hinged on the right edge, turns its left side away (tilt left, −x).
 * Steep gyro fades switch between them around level (opacity = k·tilt, clamped), so at
 * rest the picture is flat and full-screen. Each plate has a far-edge copy whose opacity
 * follows the tilt. Black behind, like the Duo's panel edge.
 */
export async function duoTiltLayers(project, o = DUO_DEFAULTS) {
  const W = project._w;
  const H = project._h;
  const scale = 2;
  const tilt = Math.max(4, Math.min(45, o.tilt ?? 24));
  const maxBlur = Math.max(0, o.blur ?? 55) * scale;
  const maxDim = Math.max(0, Math.min(1, o.shade ?? 0.6));
  const K = 6; // switch steepness: plate fully on at |tilt| ≥ 1/K of the range
  const kh = 1.03; // a little bleed above / below for the vertical tilt
  const src = await compositeLayers(project, [...project.layers.filter((l) => l.plane === 'background'), ...project.layers.filter((l) => l.plane !== 'background')].filter((l) => !l.fx), scale);
  const PW = Math.round(W * scale);
  const PH = Math.round(H * kh * scale);
  const pic = makeCanvas(PW, PH);
  pic.getContext('2d').drawImage(src, 0, 0, PW, PH);
  const picAsset = await canvasAsset(pic, 'image/jpeg', 0.92);
  const geo = (hinge) => ({ x: W / 2, y: H / 2, w: W, h: Math.round(H * kh), fit: 'stretch', plane: 'background', anchor: { x: hinge === 'left' ? 0 : 1, y: 0.5 } });
  const gyro = (fade, lo, hi) => ({ tilt, tiltV: Math.round(tilt * 0.25), fold: 0, fade, fadeMin: lo, fadeMax: hi });
  const layers = [
    newLayer('color', project, { name: 'Duo backdrop', color: '#000000', plane: 'background' }),
    // tilt left: hinge right, left side away. Visible for tilt ≤ 0 (opacity 1 − K·t)
    newLayer('image', project, { ...geo('right'), name: 'Duo L', asset: picAsset, gyro: gyro('x', 1 + K, 1 - K) }),
    newLayer('image', project, { ...geo('right'), name: 'Duo L far', asset: await canvasAsset(duoFarCopy(pic, 'left', maxBlur, maxDim), 'image/jpeg', 0.9), gyro: gyro('x', 1, -1) }),
    // tilt right: hinge left, right side away. Visible for tilt > 0 (opacity K·t)
    newLayer('image', project, { ...geo('left'), name: 'Duo R', asset: picAsset, gyro: gyro('x', -K, K) }),
    newLayer('image', project, { ...geo('left'), name: 'Duo R far', asset: await canvasAsset(duoFarCopy(pic, 'right', maxBlur, maxDim), 'image/jpeg', 0.9), gyro: gyro('x', -1, 1) }),
  ];
  if (o.unlock) for (const l of layers.slice(1)) l.states = { Sleep: { opacity: 0.6 } };
  return { layers, hideOthers: true };
}

/**
 * Bring a project to the chosen effect set. Effects not in `ids` are removed again
 * (layers tagged with `fx`, plus recorded changes to existing layers).
 * Async work happens here; the returned function mutates the project synchronously.
 */
export async function prepareEffects(project, ids, opts = {}) {
  const want = new Set(ids);
  const have = new Set(appliedEffects(project));
  const duo = { ...DUO_DEFAULTS, ...(opts.duo || {}) };
  const added = {};
  if (want.has('duo') && !have.has('duo')) added.duo = tag(await duoLayers(project, opts.picture || null, duo), 'duo');
  if (want.has('duotilt') && !have.has('duotilt')) added.duotilt = tag((await duoTiltLayers(project, duo)).layers, 'duotilt');
  return (p) => {
    const done = [];
    p.fxApplied ||= {};
    const remember = (fx, l, keys) => {
      const rec = (p.fxApplied[fx] ||= {});
      if (!rec[l.id]) rec[l.id] = JSON.parse(JSON.stringify(Object.fromEntries(keys.map((k) => [k, l[k]]))));
    };
    // ---- removals
    for (const fx of have) {
      if (want.has(fx)) continue;
      p.layers = p.layers.filter((l) => l.fx !== fx);
      for (const [id, prev] of Object.entries(p.fxApplied[fx] || {})) {
        if (id === '__project') {
          Object.assign(p, prev);
          continue;
        }
        const l = p.layers.find((x) => x.id === id);
        if (l) Object.assign(l, prev);
      }
      delete p.fxApplied[fx];
      done.push(`− ${EFFECTS.find((e) => e.id === fx)?.name || fx}`);
    }
    const plain = () => p.layers.filter((l) => !l.fx);
    // ---- additions
    if (want.has('depth') && !have.has('depth')) {
      const order = [...plain().filter((l) => l.plane === 'background'), ...plain().filter((l) => l.plane !== 'background')];
      order.forEach((l, i) => {
        remember('depth', l, ['parallax', 'w', 'h']);
        if (!l.parallax) l.parallax = Math.round(4 + (order.length > 1 ? (20 * i) / (order.length - 1) : 0));
        const bleed = 1 + (2 * l.parallax) / Math.min(p._w, p._h);
        if (Math.abs(l.w - p._w) < 2 && Math.abs(l.h - p._h) < 2) {
          l.w = Math.round(p._w * bleed);
          l.h = Math.round(p._h * bleed);
        }
      });
      p.fxApplied.depth ||= {};
      done.push('+ depth');
    }
    if (want.has('unlockZoom') && !have.has('unlockZoom')) {
      for (const l of plain().filter((x) => x.plane === 'background')) {
        remember('unlockZoom', l, ['states']);
        l.states.Unlock = { scale: 1.08, ...(l.states.Unlock || {}) };
      }
      p.fxApplied.unlockZoom ||= {};
      done.push('+ unlock zoom');
    }
    if (want.has('aodDim') && !have.has('aodDim')) {
      for (const l of plain()) {
        remember('aodDim', l, ['states']);
        l.states.Sleep = { opacity: Math.min(l.opacity, 0.55), ...(l.states.Sleep || {}) };
      }
      p.fxApplied.aodDim ||= {};
      done.push('+ AOD dim');
    }
    if (added.duotilt) {
      // the flattened picture replaces the originals visually: hide them (restored on removal)
      for (const l of plain()) {
        remember('duotilt', l, ['hidden']);
        l.hidden = true;
      }
      p.layers.unshift(...added.duotilt);
      // real perspective like the Duo (restored on removal)
      p.fxApplied.duotilt.__project = { perspective: p.perspective };
      done.push('+ Duo 3D tilt');
    }
    if (added.duo) {
      const lastBg = p.layers.map((l) => l.plane).lastIndexOf('background');
      p.layers.splice(lastBg + 1, 0, ...added.duo);
      done.push('+ Duo fold');
    }
    if (added.duo || added.duotilt) {
      if (p.format === 'classic') p.format = 'modern';
      p.perspective = Math.min(p.perspective || 800, 800);
    }
    if (want.has('vignette') && !have.has('vignette')) {
      p.layers.push(Object.assign(newLayer('gradient', p, { name: 'Vignette', plane: 'floating', gradient: { type: 'radial', angle: 0, stops: [{ c: '#00000000', p: 0.55 }, { c: '#000000b3', p: 1 }] } }), { fx: 'vignette' }));
      done.push('+ vignette');
    }
    if (want.has('glass') && !have.has('glass')) {
      p.layers.push(Object.assign(newLayer('glass', p, { name: 'Glass card', y: p._h * 0.78, h: 150, cornerRadius: 40, glass: { mode: 'liquid', blur: 3, tint: '#ffffff', tintOpacity: 0.08, border: 0.6, saturation: 1.6, shine: 0.4, refraction: 90 }, parallax: 14, states: { Unlock: { opacity: 0, y: p._h * 0.9 }, Sleep: { opacity: 0 } } }), { fx: 'glass' }));
      done.push('+ glass');
    }
    for (const k of PARTICLES) {
      const fx = `fx-${k}`;
      if (!want.has(fx) || have.has(fx)) continue;
      p.layers.push(Object.assign(newLayer('emitter', p, { id: uid('L'), name: EMITTER_PRESETS[k].name, plane: 'floating', emitter: { preset: k, ...EMITTER_PRESETS[k] }, states: { Sleep: { opacity: 0 } } }), { fx }));
      done.push(`+ ${EMITTER_PRESETS[k].name.toLowerCase()}`);
    }
    return done;
  };
}

/** effect ids currently applied to a project */
export function appliedEffects(project) {
  const ids = new Set(project.layers.map((l) => l.fx).filter(Boolean));
  for (const k of Object.keys(project.fxApplied || {})) ids.add(k);
  return [...ids];
}
