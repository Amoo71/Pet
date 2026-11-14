// Project / layer data model. Everything here is plain JSON so it can be
// snapshotted for undo/redo and stored in IndexedDB. Binary assets live in a
// separate asset store and are referenced by id.

export const PLANES = [
  { id: 'background', name: 'Hintergrund', hint: 'Hinter der Uhr', file: 'Background' },
  { id: 'floating', name: 'Floating', hint: 'Über der Uhr', file: 'Floating' },
  { id: 'foreground', name: 'Vordergrund', hint: 'Oberste Ebene', file: 'Foreground' },
];

/** PosterBoard drives these states (LKState names) itself. */
export const STATES = [
  { id: 'Locked', name: 'Gesperrt', icon: '🔒' },
  { id: 'Unlock', name: 'Entsperrt', icon: '🔓' },
  { id: 'Sleep', name: 'Ruhe (AOD)', icon: '🌙' },
];

/** Properties that can differ per state and are animated between states. */
export const ANIMATABLE = [
  { id: 'opacity', name: 'Deckkraft', keyPath: 'opacity', min: 0, max: 1, step: 0.01 },
  { id: 'x', name: 'Position X', keyPath: 'position.x', step: 1 },
  { id: 'y', name: 'Position Y', keyPath: 'position.y', step: 1 },
  { id: 'scale', name: 'Skalierung', keyPath: 'transform.scale', min: 0, max: 5, step: 0.01 },
  { id: 'rotation', name: 'Drehung °', keyPath: 'transform.rotation.z', min: -360, max: 360, step: 1 },
];

export const KINDS = {
  image: { name: 'Bild', icon: '🖼️' },
  color: { name: 'Farbe', icon: '🎨' },
  gradient: { name: 'Verlauf', icon: '🌈' },
  text: { name: 'Text', icon: '🔤' },
  shape: { name: 'Form', icon: '⬟' },
  video: { name: 'Video / Frames', icon: '🎞️' },
  emitter: { name: 'Partikel', icon: '❄️' },
};

export const LOOPS = {
  none: { name: 'Keine' },
  rotate: { name: 'Drehen', amountLabel: 'Umdrehungen', amount: 1 },
  pulse: { name: 'Pulsieren', amountLabel: 'Stärke %', amount: 8 },
  float: { name: 'Schweben', amountLabel: 'Weg (pt)', amount: 12 },
  sway: { name: 'Pendeln', amountLabel: 'Winkel °', amount: 6 },
  drift: { name: 'Seitwärts treiben', amountLabel: 'Weg (pt)', amount: 30 },
  fade: { name: 'Atmen (Deckkraft)', amountLabel: 'Min. Deckkraft %', amount: 35 },
  blink: { name: 'Blinken', amountLabel: 'Min. Deckkraft %', amount: 0 },
};

export const TRANSITION_PRESETS = {
  gentle: { name: 'Sanft (Apple-like)', type: 'spring', damping: 50, mass: 2, stiffness: 300, duration: 0.8 },
  bouncy: { name: 'Federnd', type: 'spring', damping: 12, mass: 1, stiffness: 180, duration: 1.2 },
  snappy: { name: 'Schnell', type: 'spring', damping: 30, mass: 1, stiffness: 400, duration: 0.45 },
  slow: { name: 'Langsam', type: 'spring', damping: 40, mass: 3, stiffness: 120, duration: 1.6 },
  linear: { name: 'Linear', type: 'basic', duration: 0.6 },
};

export const EMITTER_PRESETS = {
  snow: { name: 'Schnee', birthRate: 18, lifetime: 14, velocity: 40, velocityRange: 20, emissionLongitude: 90, emissionRange: 30, yAcceleration: 6, xAcceleration: 0, scale: 0.6, scaleRange: 0.4, spin: 0.3, spinRange: 1, alphaSpeed: -0.04, particle: 'dot', color: '#ffffff', size: 14, shape: 'line' },
  rain: { name: 'Regen', birthRate: 60, lifetime: 3, velocity: 600, velocityRange: 100, emissionLongitude: 100, emissionRange: 2, yAcceleration: 200, xAcceleration: 0, scale: 1, scaleRange: 0.3, spin: 0, spinRange: 0, alphaSpeed: -0.1, particle: 'streak', color: '#a9c8ff', size: 24, shape: 'line' },
  sparkle: { name: 'Funkeln', birthRate: 8, lifetime: 4, velocity: 8, velocityRange: 8, emissionLongitude: 0, emissionRange: 360, yAcceleration: 0, xAcceleration: 0, scale: 0.5, scaleRange: 0.5, spin: 0.5, spinRange: 2, alphaSpeed: -0.25, particle: 'star', color: '#fff4b0', size: 18, shape: 'rectangle' },
  bubbles: { name: 'Blasen', birthRate: 6, lifetime: 12, velocity: 50, velocityRange: 25, emissionLongitude: -90, emissionRange: 20, yAcceleration: -4, xAcceleration: 0, scale: 0.7, scaleRange: 0.5, spin: 0, spinRange: 0, alphaSpeed: -0.05, particle: 'ring', color: '#bfefff', size: 22, shape: 'line' },
  embers: { name: 'Glut / Funken', birthRate: 14, lifetime: 6, velocity: 70, velocityRange: 40, emissionLongitude: -90, emissionRange: 40, yAcceleration: -10, xAcceleration: 4, scale: 0.4, scaleRange: 0.3, spin: 0, spinRange: 0, alphaSpeed: -0.15, particle: 'dot', color: '#ff9a3c', size: 10, shape: 'line' },
  petals: { name: 'Blütenblätter', birthRate: 4, lifetime: 16, velocity: 35, velocityRange: 15, emissionLongitude: 75, emissionRange: 40, yAcceleration: 5, xAcceleration: 6, scale: 0.7, scaleRange: 0.4, spin: 0.6, spinRange: 1.5, alphaSpeed: -0.03, particle: 'petal', color: '#ffc0d6', size: 22, shape: 'line' },
  stars: { name: 'Sternenhimmel', birthRate: 3, lifetime: 10, velocity: 0, velocityRange: 2, emissionLongitude: 0, emissionRange: 360, yAcceleration: 0, xAcceleration: 0, scale: 0.35, scaleRange: 0.3, spin: 0, spinRange: 0, alphaSpeed: -0.08, particle: 'star', color: '#ffffff', size: 14, shape: 'rectangle' },
};

let counter = 0;
export function uid(prefix = 'l') {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newProject(deviceId = 'iphone-17-pro', device = { w: 402, h: 874 }) {
  return {
    id: uid('p'),
    name: 'Mein Wallpaper',
    device: deviceId,
    appearanceAware: false,
    transition: { ...TRANSITION_PRESETS.gentle, preset: 'gentle' },
    collectionOrdered: true,
    created: Date.now(),
    updated: Date.now(),
    layers: [],
    _w: device.w,
    _h: device.h,
  };
}

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
    cornerRadius: 0,
    hidden: false,
    locked: false,
    fit: 'cover',
    states: {},
    loop: { type: 'none', duration: 4, amount: 0, autoreverse: true },
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
      text: { content: 'Hallo', font: 'system-ui', weight: 700, size: 64, color: '#ffffff', align: 'center', lineHeight: 1.1, letterSpacing: 0, italic: false, shadow: 0.35, fontAsset: null },
    },
    shape: {
      w: 180,
      h: 180,
      shape: { type: 'ellipse', fill: '#ffd166', stroke: '#ffffff', strokeWidth: 0, points: 5, blur: 0 },
    },
    video: { video: { frames: [], fps: 24, autoreverse: false, calc: 'discrete', duration: 0 } },
    emitter: {
      plane: 'floating',
      emitter: { preset: 'snow', ...EMITTER_PRESETS.snow },
    },
  };
  return { ...base, ...(defaults[kind] || {}), ...props };
}

/** Key used for a state override. Dark overrides apply on top of light ones. */
export const stateKey = (state, dark) => (dark ? `${state}@dark` : state);

/** Effective animatable values of a layer for a given state + appearance. */
export function effective(layer, state = 'Locked', dark = false) {
  const out = {};
  for (const p of ANIMATABLE) out[p.id] = layer[p.id];
  const s = layer.states || {};
  // order: base → dark base (Locked@dark) → Locked (Sleep inherits it) → state → state@dark
  if (dark) Object.assign(out, s['Locked@dark'] || {});
  if (state === 'Sleep') Object.assign(out, s.Locked || {});
  Object.assign(out, s[state] || {});
  if (dark && state !== 'Locked') {
    if (state === 'Sleep') Object.assign(out, s['Locked@dark'] || {});
    Object.assign(out, s[`${state}@dark`] || {});
  }
  return out;
}

/** Which animatable props of a layer change between any of the states. */
export function animatedProps(layer, appearanceAware) {
  const props = new Set();
  const s = layer.states || {};
  for (const [k, v] of Object.entries(s)) {
    if (!appearanceAware && k.endsWith('@dark')) continue;
    for (const p of Object.keys(v || {})) props.add(p);
  }
  // base rotation / scale need to be expressed through state values (see caml.js)
  if (layer.rotation) props.add('rotation');
  if (layer.scale !== 1) props.add('scale');
  return [...props].filter((p) => ANIMATABLE.some((a) => a.id === p));
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
