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
  { id: 'duotilt', icon: '📱', name: 'Duo 3D tilt', desc: 'Smooth 3D tilt with the gyro; the side that tips away blurs and darkens.' },
  { id: 'duo', icon: '📖', name: 'Duo fold', desc: 'iPhone Duo fold: the left half folds on its hinge as you tilt (blur + shade follow).' },
  { id: 'depth', icon: '🧊', name: 'Depth parallax', desc: 'Gives every layer gyro parallax – back layers move less, front layers more.' },
  { id: 'unlockZoom', icon: '🔍', name: 'Unlock zoom', desc: 'Background pushes in while you swipe up.' },
  { id: 'aodDim', icon: '🌙', name: 'Always-On dim', desc: 'Dims everything in Always-On.' },
  { id: 'vignette', icon: '◐', name: 'Vignette', desc: 'Soft dark edges.' },
  { id: 'glass', icon: '💧', name: 'Liquid Glass card', desc: 'Glass card near the bottom (iOS 26+).' },
  ...PARTICLES.map((k) => ({ id: `fx-${k}`, icon: { snow: '❄️', rain: '🌧️', sparkle: '✨', stars: '⭐', bubbles: '🫧', embers: '🔥', petals: '🌸', confetti: '🎉' }[k], name: EMITTER_PRESETS[k].name, desc: 'Particles (animate forever – uses more battery).' })),
];

export const DUO_DEFAULTS = { angle: 60, blur: 22, shade: 0.52, unlock: true, tilt: 14 };

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
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
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

/** edge strip for Duo 3D tilt: blurred + darkened picture, opaque at one side fading to 0 */
function edgeStrip(pic, radius, side, shade) {
  const W = pic.width;
  const H = pic.height;
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const pad = radius * 2;
  x.filter = `blur(${radius}px)`;
  x.drawImage(pic, -pad, -pad, W + pad * 2, H + pad * 2);
  x.filter = 'none';
  x.fillStyle = `rgba(0,0,0,${shade})`;
  x.fillRect(0, 0, W, H);
  const g = side === 'left' ? x.createLinearGradient(0, 0, W * 0.42, 0) : x.createLinearGradient(W, 0, W * 0.58, 0);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.globalCompositeOperation = 'destination-in';
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  return c;
}

/** Duo 3D tilt: the whole picture tilts with the gyro; the side tipping away blurs + darkens. */
export async function duoTiltLayers(project, o = DUO_DEFAULTS) {
  const W = project._w;
  const H = project._h;
  const pic = await compositeLayers(project, [...project.layers.filter((l) => l.plane === 'background'), ...project.layers.filter((l) => l.plane !== 'background')].filter((l) => !l.fx), 3);
  const r = Math.max(6, o.blur * 3);
  const ids = {
    pic: await canvasAsset(pic, 'image/jpeg'),
    left: await canvasAsset(edgeStrip(pic, r, 'left', o.shade * 0.6)),
    right: await canvasAsset(edgeStrip(pic, r, 'right', o.shade * 0.6)),
  };
  const k = 1.1; // bleed so tilting never shows the edge
  const base = { x: W / 2, y: H / 2, w: Math.round(W * k), h: Math.round(H * k), fit: 'stretch', plane: 'background', parallax: 6 };
  const tilt = o.tilt || 14;
  const backdrop = newLayer('color', project, { name: 'Duo tilt backdrop', color: '#000000', plane: 'background' });
  const panel = newLayer('image', project, { ...base, name: 'Duo tilt', asset: ids.pic, gyro: { tilt, fold: 0, fade: 'none', fadeMin: 0, fadeMax: 1 }, states: o.unlock ? { Unlock: { scale: 1.05 }, Sleep: { scale: 0.96 } } : {} });
  // left side tips away when tilting left (tilt x < 0) – fade maps tilt -1…1 to opacity 1…-1 (clamped)
  const left = newLayer('image', project, { ...base, name: 'Duo tilt blur L', asset: ids.left, gyro: { tilt, fold: 0, fade: '-x', fadeMin: -1, fadeMax: 1 }, states: panel.states });
  const right = newLayer('image', project, { ...base, name: 'Duo tilt blur R', asset: ids.right, gyro: { tilt, fold: 0, fade: 'x', fadeMin: -1, fadeMax: 1 }, states: panel.states });
  return { layers: [backdrop, panel, left, right], hideOthers: true };
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
      done.push('+ Duo 3D tilt');
    }
    if (added.duo) {
      const lastBg = p.layers.map((l) => l.plane).lastIndexOf('background');
      p.layers.splice(lastBg + 1, 0, ...added.duo);
      done.push('+ Duo fold');
    }
    if (added.duo || added.duotilt) {
      if (p.format === 'classic') p.format = 'modern';
      p.perspective = Math.min(p.perspective || 900, 700);
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
