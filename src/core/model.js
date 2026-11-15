// Project / layer data model. Plain JSON (snapshotted for undo/redo, stored in IndexedDB).
// Binary assets live in a separate store and are referenced by id.
//
// Editor coordinates: points, origin top-left, y down, rotation clockwise in degrees.
// The CAML exporters convert to Core Animation's y-up space.

export const PLANES = [
  { id: 'background', name: 'Behind clock', short: 'Back', file: 'Background', group: 'BACKGROUND' },
  { id: 'floating', name: 'In front of clock', short: 'Front', file: 'Floating', group: 'FLOATING' },
];

/** PosterBoard drives these states itself. */
export const STATES = [
  { id: 'Locked', name: 'Lock', icon: '🔒' },
  { id: 'Unlock', name: 'Home', icon: '📱' },
  { id: 'Sleep', name: 'Always-On', icon: '🌙' },
];

/** Properties that can differ per state. */
export const ANIMATABLE = [
  { id: 'opacity', name: 'Opacity', keyPath: 'opacity', pcaKeyPath: 'opacity', min: 0, max: 1, step: 0.01 },
  { id: 'x', name: 'X', keyPath: 'position.x', pcaKeyPath: 'position.x', step: 1 },
  { id: 'y', name: 'Y', keyPath: 'position.y', pcaKeyPath: 'position.y', step: 1 },
  { id: 'scale', name: 'Scale', keyPath: 'transform.scale', pcaKeyPath: 'transform.scale.xy', min: 0, max: 5, step: 0.01 },
  { id: 'rotation', name: 'Rotation', keyPath: 'transform.rotation.z', pcaKeyPath: 'transform.rotation.z', min: -720, max: 720, step: 1 },
  { id: 'rotX', name: '3D tilt X', keyPath: 'transform.rotation.x', pcaKeyPath: 'transform.rotation.x', min: -180, max: 180, step: 1 },
  { id: 'rotY', name: '3D tilt Y', keyPath: 'transform.rotation.y', pcaKeyPath: 'transform.rotation.y', min: -180, max: 180, step: 1 },
];

/** Gyro effects per layer. move = translation (device-verified); tilt & fade are experimental. */
export const DEFAULT_GYRO = { tilt: 0, fold: 0, fade: 'none', fadeMin: 0, fadeMax: 1 };

/** iPhone Duo (foldable) screens – Apple's numbers from the iOS 27 Clownfish-V68 wallpaper. */
export const DUO = {
  root: 6000,
  ppt: 3,
  screens: {
    cover: { key: 'TWO', screenName: 'Cover Screen', idealWidth: 466, idealHeight: 678, pixelWidth: 1398, pixelHeight: 2034, pixelParallaxBleed: 64, pixelSquareWithParallax: 3553, pixelSquareWithoutParallax: 3489 },
    inner: { key: 'ONE', screenName: 'Inner Display', idealWidth: 669, idealHeight: 951, pixelWidth: 2007, pixelHeight: 2853, pixelParallaxBleed: 119, pixelSquareWithParallax: 3608, pixelSquareWithoutParallax: 3489 },
  },
  postures: {
    cover: { name: 'Cover', w: 466, h: 678 },
    inner: { name: 'Inner', w: 669, h: 951 },
    land: { name: 'Inner landscape', w: 951, h: 669 },
  },
};

export const KINDS = {
  image: { name: 'Image', icon: '🖼️' },
  video: { name: 'Video / GIF', icon: '🎞️' },
  text: { name: 'Text', icon: '𝐓' },
  gradient: { name: 'Gradient', icon: '🌈' },
  color: { name: 'Color', icon: '🎨' },
  shape: { name: 'Shape', icon: '⬟' },
  glass: { name: 'Glass', icon: '🫧' },
  emitter: { name: 'Particles', icon: '❄️' },
};

export const BLEND_MODES = [
  ['normal', 'Normal'],
  ['multiplyBlendMode', 'Multiply'],
  ['screenBlendMode', 'Screen'],
  ['overlayBlendMode', 'Overlay'],
  ['softLightBlendMode', 'Soft light'],
  ['hardLightBlendMode', 'Hard light'],
  ['lightenBlendMode', 'Lighten'],
  ['darkenBlendMode', 'Darken'],
  ['colorDodgeBlendMode', 'Color dodge'],
  ['colorBurnBlendMode', 'Color burn'],
  ['differenceBlendMode', 'Difference'],
  ['exclusionBlendMode', 'Exclusion'],
  ['hueBlendMode', 'Hue'],
  ['saturationBlendMode', 'Saturation'],
  ['colorBlendMode', 'Color'],
  ['luminosityBlendMode', 'Luminosity'],
];

/** CSS equivalents for the live preview. */
export const BLEND_CSS = {
  normal: 'normal', multiplyBlendMode: 'multiply', screenBlendMode: 'screen', overlayBlendMode: 'overlay',
  softLightBlendMode: 'soft-light', hardLightBlendMode: 'hard-light', lightenBlendMode: 'lighten', darkenBlendMode: 'darken',
  colorDodgeBlendMode: 'color-dodge', colorBurnBlendMode: 'color-burn', differenceBlendMode: 'difference',
  exclusionBlendMode: 'exclusion', hueBlendMode: 'hue', saturationBlendMode: 'saturation', colorBlendMode: 'color',
  luminosityBlendMode: 'luminosity',
};

export const EASINGS = [
  ['easeInEaseOut', 'Ease in-out'],
  ['linear', 'Linear'],
  ['easeIn', 'Ease in'],
  ['easeOut', 'Ease out'],
];

export const ANIM_PROPS = [
  ['y', 'Move Y (pt)'],
  ['x', 'Move X (pt)'],
  ['scale', 'Scale (×)'],
  ['rotation', 'Rotate (°)'],
  ['opacity', 'Opacity (×)'],
];

/** Animation presets → keyframes (values are offsets/multipliers relative to the layer). */
export const ANIM_PRESETS = {
  float: { name: 'Float', prop: 'y', amount: 12, label: 'Distance', build: (a) => [[0, 0], [1, -a]], autoreverse: true, duration: 3 },
  bounce: { name: 'Bounce', prop: 'y', amount: 24, label: 'Height', build: (a) => [[0, 0], [0.35, -a], [0.6, 0], [0.75, -a * 0.25], [1, 0]], autoreverse: false, duration: 1.6, easing: 'easeOut' },
  drift: { name: 'Drift', prop: 'x', amount: 30, label: 'Distance', build: (a) => [[0, -a / 2], [1, a / 2]], autoreverse: true, duration: 6 },
  pulse: { name: 'Pulse', prop: 'scale', amount: 8, label: 'Strength %', build: (a) => [[0, 1], [1, 1 + a / 100]], autoreverse: true, duration: 1.4 },
  heartbeat: { name: 'Heartbeat', prop: 'scale', amount: 15, label: 'Strength %', build: (a) => [[0, 1], [0.12, 1 + a / 100], [0.24, 1], [0.36, 1 + a / 150], [0.5, 1], [1, 1]], autoreverse: false, duration: 1.2 },
  spin: { name: 'Spin', prop: 'rotation', amount: 1, label: 'Turns', build: (a) => [[0, 0], [1, 360 * (a || 1)]], autoreverse: false, duration: 10, easing: 'linear' },
  sway: { name: 'Sway', prop: 'rotation', amount: 6, label: 'Angle °', build: (a) => [[0, -a], [1, a]], autoreverse: true, duration: 2.6 },
  wiggle: { name: 'Wiggle', prop: 'rotation', amount: 8, label: 'Angle °', build: (a) => [[0, 0], [0.1, -a], [0.2, a], [0.3, -a / 2], [0.4, 0], [1, 0]], autoreverse: false, duration: 2 },
  breathe: { name: 'Breathe', prop: 'opacity', amount: 35, label: 'Min opacity %', build: (a) => [[0, 1], [1, a / 100]], autoreverse: true, duration: 3 },
  blink: { name: 'Blink', prop: 'opacity', amount: 0, label: 'Off opacity %', build: (a) => [[0, 1], [0.9, 1], [0.93, a / 100], [0.97, 1], [1, 1]], autoreverse: false, duration: 3.5 },
  custom: { name: 'Custom keyframes', prop: 'y', amount: 0, build: () => [[0, 0], [1, -20]], autoreverse: true, duration: 2 },
};

export const TRANSITION_PRESETS = {
  gentle: { name: 'Gentle (Apple default)', type: 'spring', damping: 50, mass: 2, stiffness: 300, duration: 0.8 },
  bouncy: { name: 'Bouncy', type: 'spring', damping: 12, mass: 1, stiffness: 180, duration: 1.2 },
  snappy: { name: 'Snappy', type: 'spring', damping: 30, mass: 1, stiffness: 400, duration: 0.45 },
  slow: { name: 'Slow', type: 'spring', damping: 40, mass: 3, stiffness: 120, duration: 1.6 },
  linear: { name: 'Linear', type: 'basic', duration: 0.6 },
};

export const EMITTER_PRESETS = {
  snow: { name: 'Snow', birthRate: 18, lifetime: 14, velocity: 40, velocityRange: 20, emissionLongitude: 90, emissionRange: 30, yAcceleration: 6, xAcceleration: 0, scale: 0.6, scaleRange: 0.4, spin: 0.3, spinRange: 1, alphaSpeed: -0.04, particle: 'dot', color: '#ffffff', size: 14, shape: 'line', additive: false },
  rain: { name: 'Rain', birthRate: 60, lifetime: 3, velocity: 600, velocityRange: 100, emissionLongitude: 100, emissionRange: 2, yAcceleration: 200, xAcceleration: 0, scale: 1, scaleRange: 0.3, spin: 0, spinRange: 0, alphaSpeed: -0.1, particle: 'streak', color: '#a9c8ff', size: 24, shape: 'line', additive: false },
  sparkle: { name: 'Sparkle', birthRate: 8, lifetime: 4, velocity: 8, velocityRange: 8, emissionLongitude: 0, emissionRange: 360, yAcceleration: 0, xAcceleration: 0, scale: 0.5, scaleRange: 0.5, spin: 0.5, spinRange: 2, alphaSpeed: -0.25, particle: 'star', color: '#fff4b0', size: 18, shape: 'rectangle', additive: true },
  bubbles: { name: 'Bubbles', birthRate: 6, lifetime: 12, velocity: 50, velocityRange: 25, emissionLongitude: -90, emissionRange: 20, yAcceleration: -4, xAcceleration: 0, scale: 0.7, scaleRange: 0.5, spin: 0, spinRange: 0, alphaSpeed: -0.05, particle: 'ring', color: '#bfefff', size: 22, shape: 'line', additive: false },
  embers: { name: 'Embers', birthRate: 14, lifetime: 6, velocity: 70, velocityRange: 40, emissionLongitude: -90, emissionRange: 40, yAcceleration: -10, xAcceleration: 4, scale: 0.4, scaleRange: 0.3, spin: 0, spinRange: 0, alphaSpeed: -0.15, particle: 'dot', color: '#ff9a3c', size: 10, shape: 'line', additive: true },
  petals: { name: 'Petals', birthRate: 4, lifetime: 16, velocity: 35, velocityRange: 15, emissionLongitude: 75, emissionRange: 40, yAcceleration: 5, xAcceleration: 6, scale: 0.7, scaleRange: 0.4, spin: 0.6, spinRange: 1.5, alphaSpeed: -0.03, particle: 'petal', color: '#ffc0d6', size: 22, shape: 'line', additive: false },
  stars: { name: 'Twinkling stars', birthRate: 3, lifetime: 10, velocity: 0, velocityRange: 2, emissionLongitude: 0, emissionRange: 360, yAcceleration: 0, xAcceleration: 0, scale: 0.35, scaleRange: 0.3, spin: 0, spinRange: 0, alphaSpeed: -0.08, particle: 'star', color: '#ffffff', size: 14, shape: 'rectangle', additive: true },
  confetti: { name: 'Confetti', birthRate: 12, lifetime: 10, velocity: 90, velocityRange: 40, emissionLongitude: 90, emissionRange: 50, yAcceleration: 40, xAcceleration: 0, scale: 0.5, scaleRange: 0.3, spin: 2, spinRange: 4, alphaSpeed: -0.05, particle: 'square', color: '#ff5ea8', size: 14, shape: 'line', additive: false },
};

let counter = 0;
export function uid(prefix = 'l') {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newProject(deviceId = 'iphone-17-pro', device = { w: 402, h: 874 }) {
  return {
    id: uid('p'),
    name: 'My Wallpaper',
    device: deviceId,
    format: 'modern', // modern = ParameterizedCA (iOS 26/27) | duo = iPhone Duo split screens (iOS 27) | classic = LayeredAnimation
    perspective: 900, // pt, for 3D tilt
    appearanceAware: false,
    transition: { ...TRANSITION_PRESETS.gentle, preset: 'gentle' },
    created: Date.now(),
    updated: Date.now(),
    layers: [],
    v: 2,
    _w: device.w,
    _h: device.h,
  };
}

export const DEFAULT_FILTERS = { blur: 0, hue: 0, saturate: 1, contrast: 1 };

export function newLayer(kind, project, props = {}) {
  const W = project._w;
  const H = project._h;
  const base = {
    id: uid('L'),
    name: KINDS[kind]?.name || kind,
    kind,
    plane: 'background',
    x: W / 2,
    y: H / 2,
    w: W,
    h: H,
    opacity: 1,
    scale: 1,
    rotation: 0,
    rotX: 0,
    rotY: 0,
    cornerRadius: 0,
    hidden: false,
    locked: false,
    fit: 'cover',
    states: {},
    anims: [],
    parallax: 0,
    anchor: { x: 0.5, y: 0.5 }, // rotation / scale pivot (0..1 of the layer box, y down)
    gyro: { ...DEFAULT_GYRO },
    fastFade: false,
    blend: 'normal',
    filters: { ...DEFAULT_FILTERS },
    transition: null,
    nuggetOption: false,
  };
  const defaults = {
    image: { asset: null },
    color: { color: '#1c1c2e' },
    gradient: {
      gradient: { type: 'linear', angle: 160, stops: [{ c: '#ff6b9a', p: 0 }, { c: '#7b5cff', p: 0.55 }, { c: '#1b1446', p: 1 }] },
    },
    text: {
      w: W - 40,
      h: 120,
      y: H * 0.62,
      plane: 'floating',
      text: { content: 'Hello', font: 'system-ui', weight: 700, size: 64, color: '#ffffff', align: 'center', lineHeight: 1.1, letterSpacing: 0, italic: false, shadow: 0.35, fontAsset: null },
    },
    shape: {
      w: 180,
      h: 180,
      plane: 'floating',
      shape: { type: 'ellipse', fill: '#ffd166', stroke: '#ffffff', strokeWidth: 0, points: 5, blur: 0 },
    },
    video: { fit: 'cover', video: { frames: [], fps: 24, autoreverse: false, calc: 'discrete', duration: 0 } },
    emitter: { plane: 'floating', emitter: { preset: 'snow', ...EMITTER_PRESETS.snow } },
    glass: {
      plane: 'floating',
      w: W - 48,
      h: 150,
      y: H * 0.72,
      cornerRadius: 34,
      glass: { mode: 'frosted', blur: 22, tint: '#ffffff', tintOpacity: 0.14, border: 0.45, saturation: 1.5, shine: 0.35, refraction: 80 },
    },
  };
  return { ...base, ...(defaults[kind] || {}), ...props };
}

export function newAnim(preset = 'float', amount) {
  const p = ANIM_PRESETS[preset] || ANIM_PRESETS.float;
  const a = amount ?? p.amount;
  return {
    id: uid('A'),
    preset,
    prop: p.prop,
    amount: a,
    keys: p.build(a).map(([t, v]) => ({ t, v })),
    duration: p.duration,
    delay: 0,
    autoreverse: p.autoreverse,
    repeat: 'loop', // loop | once
    easing: p.easing || 'easeInEaseOut',
    enabled: true,
  };
}

/** Rebuild keyframes after amount change for preset animations. */
export function rebuildAnim(anim) {
  const p = ANIM_PRESETS[anim.preset];
  if (!p || anim.preset === 'custom') return anim;
  anim.keys = p.build(Number(anim.amount) || 0).map(([t, v]) => ({ t, v }));
  return anim;
}

/** Key used for a state override. Dark overrides apply on top of light ones (classic format only). */
export const stateKey = (state, dark) => (dark ? `${state}@dark` : state);

/** Effective animatable values of a layer for a given state + appearance. */
export function effective(layer, state = 'Locked', dark = false) {
  const out = {};
  for (const p of ANIMATABLE) out[p.id] = layer[p.id] ?? 0;
  const s = layer.states || {};
  if (dark) Object.assign(out, s['Locked@dark'] || {});
  if (state === 'Sleep') Object.assign(out, s.Locked || {});
  Object.assign(out, s[state] || {});
  if (dark && state !== 'Locked') {
    if (state === 'Sleep') Object.assign(out, s['Locked@dark'] || {});
    Object.assign(out, s[`${state}@dark`] || {});
  }
  return out;
}

/** Linear interpolation between two states, exactly like ParameterizedCA while swiping. */
export function interpolate(layer, from, to, u, dark = false) {
  const a = effective(layer, from, dark);
  const b = effective(layer, to, dark);
  const out = {};
  for (const p of ANIMATABLE) out[p.id] = a[p.id] + (b[p.id] - a[p.id]) * u;
  return out;
}

/** Which animatable props of a layer change between any of the states. */
export function animatedProps(layer, appearanceAware) {
  const props = new Set();
  for (const [k, v] of Object.entries(layer.states || {})) {
    if (!appearanceAware && k.endsWith('@dark')) continue;
    for (const p of Object.keys(v || {})) props.add(p);
  }
  return [...props].filter((p) => ANIMATABLE.some((a) => a.id === p));
}

export const isGyro = (layer) => layer.parallax > 0 || layer.gyro?.tilt > 0 || layer.gyro?.fold > 0 || (layer.gyro?.fade && layer.gyro.fade !== 'none');

export const hasLoops = (layer) => (layer.anims || []).some((a) => a.enabled !== false && a.repeat !== 'once') || layer.kind === 'emitter' || (layer.kind === 'video' && (layer.video?.frames?.length || 0) > 1);

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Upgrade projects from older versions in place. */
export function migrateProject(p) {
  if (!p.format) p.format = 'classic';
  for (const l of p.layers) {
    if (l.plane === 'foreground') l.plane = 'floating';
    l.anims ||= [];
    if (l.loop && l.loop.type && l.loop.type !== 'none') {
      const map = { rotate: 'spin', fade: 'breathe' };
      const preset = map[l.loop.type] || l.loop.type;
      if (ANIM_PRESETS[preset]) {
        const a = newAnim(preset, l.loop.amount);
        a.duration = l.loop.duration || a.duration;
        a.autoreverse = preset === 'spin' || preset === 'blink' ? false : !!l.loop.autoreverse;
        l.anims.push(a);
      }
    }
    delete l.loop;
    l.parallax ??= 0;
    l.rotX ??= 0;
    l.rotY ??= 0;
    l.gyro = { ...DEFAULT_GYRO, ...(l.gyro || {}) };
    l.anchor ??= { x: 0.5, y: 0.5 };
    l.fastFade ??= false;
    l.blend ??= 'normal';
    l.filters = { ...DEFAULT_FILTERS, ...(l.filters || {}) };
  }
  p.perspective ??= 900;
  p.v = 3;
  return p;
}
