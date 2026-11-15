// CAML (Core Animation archive XML) generators.
//
// Two wallpaper formats:
//  * modern  – ParameterizedCA: one wallpaper .ca whose root <style> holds
//              wallpaperPropertyGroups (Lock/Home/Sleep values, interpolated linearly
//              while the user swipes) and wallpaperParallaxGroups (gyro). iOS 26 / 27.
//  * classic – LayeredAnimation: Background/Floating/Foreground .ca files with
//              LKStates + CASpringAnimation transitions (+ Light/Dark variants). iOS 17+.
//
// Coordinate system: CAML roots use geometryFlipped="0" → y axis points UP. The editor
// uses y-down, so every y position is mirrored (H - y), rotations are negated and
// emitter directions flipped. (PosterLab, tendies_kit and CAPlayground all agree.)

import { ANIMATABLE, PLANES, STATES, DUO, animatedProps, effective } from './model.js';

export const CAML_NS = 'http://www.apple.com/CoreAnimation/1.0';
const DEG = Math.PI / 180;

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const num = (n) => {
  const r = Math.round(Number(n) * 10000) / 10000;
  return Object.is(r, -0) || !isFinite(r) ? '0' : String(r);
};

export function hexToRgb(hex = '#ffffff') {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => num(c / 255)).join(' ');
}

/** offset from the layer centre to its anchor point (editor coords) */
export function anchorOffset(layer) {
  const a = layer.anchor || { x: 0.5, y: 0.5 };
  return { dx: (a.x - 0.5) * layer.w, dy: (a.y - 0.5) * layer.h, a };
}
const hasAnchor = (layer) => layer.anchor && (Math.abs(layer.anchor.x - 0.5) > 1e-6 || Math.abs(layer.anchor.y - 0.5) > 1e-6);

/** editor value → CA value for a state property (needs the document height for y) */
export function caStateValue(prop, v, H, layer) {
  if (prop === 'x' && layer && hasAnchor(layer)) return v + anchorOffset(layer).dx;
  if (prop === 'y') return H - (v + (layer && hasAnchor(layer) ? anchorOffset(layer).dy : 0));
  if (prop === 'rotation' || prop === 'rotX') return -v * DEG;
  if (prop === 'rotY') return v * DEG;
  return v;
}

/** Globally unique, stable layer names (ParameterizedCA matches groups by name). */
export function uniqueNames(layers) {
  const used = new Set(['Root Layer', 'BACKGROUND', 'FLOATING']);
  const map = new Map();
  for (const l of layers) {
    let base = String(l.name || l.kind).replace(/[^\w \-.]+/g, '').trim() || l.kind;
    let n = base;
    let i = 2;
    const SUFFIXES = ['', ' Parallax', ' Fade', ' Tilt', ' GyroFade', ' Content', ' Rim'];
    while (SUFFIXES.some((x) => used.has(n + x))) n = `${base} ${i++}`;
    for (const x of SUFFIXES) used.add(n + x);
    map.set(l.id, n);
  }
  return map;
}

// ---------------------------------------------------------------- animations

function animXml(anim, layer, ind, idx) {
  const keys = [...(anim.keys || [])].sort((a, b) => a.t - b.t);
  if (keys.length < 2) return '';
  const w = layer.w;
  const h = layer.h;
  const conv = {
    x: (v) => ({ tag: 'integer', v: Math.round(w / 2 + v) }),
    y: (v) => ({ tag: 'integer', v: Math.round(h / 2 - v) }),
    scale: (v) => ({ tag: 'real', v }),
    rotation: (v) => ({ tag: 'real', v: -v * DEG }),
    opacity: (v) => ({ tag: 'real', v: Math.max(0, Math.min(1, v)) }),
  }[anim.prop];
  const keyPath = { x: 'position.x', y: 'position.y', scale: 'transform.scale', rotation: 'transform.rotation.z', opacity: 'opacity' }[anim.prop];
  if (!conv) return '';
  const once = anim.repeat === 'once';
  const tag = idx === 0 ? 'animation' : 'p'; // CAPlayground convention for additional animations
  const delay = Number(anim.delay) || 0;
  return [
    `${ind}<${tag} key="animation-${idx}" type="CAKeyframeAnimation" keyPath="${keyPath}" autoreverses="${anim.autoreverse && !once ? 1 : 0}" beginTime="${delay > 0 && once ? num(delay) : '1e-100'}"${delay > 0 && !once ? ` timeOffset="${num(delay)}"` : ''} duration="${num(Math.max(0.05, Number(anim.duration) || 1))}" speed="1" removedOnCompletion="0" ${once ? 'repeatCount="1" fillMode="both"' : 'repeatCount="inf" repeatDuration="inf"'} calculationMode="linear" timingFunction="${anim.easing || 'linear'}">`,
    `${ind}\t<keyTimes>${keys.map((k) => `<real value="${num(Math.max(0, Math.min(1, k.t)))}"/>`).join('')}</keyTimes>`,
    `${ind}\t<values>${keys.map((k) => {
      const c = conv(Number(k.v));
      return `<${c.tag} value="${num(c.v)}"/>`;
    }).join('')}</values>`,
    `${ind}</${tag}>`,
  ].join('\n');
}

function framesXml(layer, frames, ind) {
  const v = layer.video || {};
  const fps = Math.max(1, Number(v.fps) || 24);
  return [
    `${ind}<animation key="frames" type="CAKeyframeAnimation" calculationMode="${v.calc === 'linear' ? 'linear' : 'discrete'}" keyPath="contents" beginTime="1e-100" duration="${num(frames.length / fps)}" removedOnCompletion="0" repeatCount="inf" repeatDuration="0" speed="1" timeOffset="0" autoreverses="${v.autoreverse ? 1 : 0}">`,
    `${ind}\t<values>`,
    ...frames.map((f) => `${ind}\t\t<CGImage src="${esc(f)}"/>`),
    `${ind}\t</values>`,
    `${ind}</animation>`,
  ].join('\n');
}

// ---------------------------------------------------------------- content

const GRAVITY = { cover: 'resizeAspectFill', contain: 'resizeAspect', stretch: 'resize' };
const COMMON = 'allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8"';

function emitterXml(layer, src, ind) {
  const e = layer.emitter || {};
  const W = layer.w;
  const H = layer.h;
  const shape = e.shape || 'line';
  const up = Math.sin((e.emissionLongitude || 0) * DEG) < -0.3; // editor: positive = downwards
  // y-up space: top edge is y = H
  const pos = shape === 'line' ? `${num(W / 2)} ${up ? -10 : num(H + 10)}` : `${num(W / 2)} ${num(H / 2)}`;
  const size = shape === 'line' ? `${num(W)} 1` : `${num(W)} ${num(H)}`;
  const px = (Number(e.size) || 16) / 64; // particle bitmaps are 64 px
  return [
    `${ind}<CAEmitterLayer id="${esc(layer.id)}-emitter" name="${esc(layer.id)} Emitter" bounds="0 0 ${num(W)} ${num(H)}" position="${num(W / 2)} ${num(H / 2)}" emitterPosition="${pos}" emitterSize="${size}" emitterShape="${shape === 'line' ? 'line' : 'rectangle'}" emitterMode="${shape === 'line' ? 'outline' : 'volume'}" renderMode="${e.additive ? 'additive' : 'unordered'}" birthRate="1" ${COMMON}>`,
    `${ind}\t<emitterCells>`,
    `${ind}\t\t<CAEmitterCell name="Cell 1" color="${hexToRgb(e.color)}" contentsScale="1" birthRate="${num(e.birthRate)}" lifetime="${num(e.lifetime)}" lifetimeRange="${num((e.lifetime || 1) * 0.3)}" velocity="${num(e.velocity)}" velocityRange="${num(e.velocityRange)}" emissionLongitude="${num(-(e.emissionLongitude || 0) * DEG)}" emissionLatitude="0" emissionRange="${num((e.emissionRange || 0) * DEG)}" xAcceleration="${num(e.xAcceleration || 0)}" yAcceleration="${num(-(e.yAcceleration || 0))}" scale="${num((Number(e.scale) || 1) * px)}" scaleRange="${num((Number(e.scaleRange) || 0) * px)}" scaleSpeed="0" alphaRange="0" alphaSpeed="${num(e.alphaSpeed || 0)}" spin="${num(e.spin || 0)}" spinRange="${num(e.spinRange || 0)}">`,
    `${ind}\t\t\t<contents><CGImage src="${esc(src)}"/></contents>`,
    `${ind}\t\t</CAEmitterCell>`,
    `${ind}\t</emitterCells>`,
    `${ind}</CAEmitterLayer>`,
  ].join('\n');
}

/** CAPlayground's Liquid Glass structure (iOS 26+): backdrop + SDF displacement. */
function liquidGlassXml(layer, ind) {
  const w = num(layer.w);
  const h = num(layer.h);
  const g = layer.glass || {};
  return [
    `${ind}<CABackdropLayer id="${esc(layer.id)}-glass" name="${esc(layer.id)} Liquid Glass" bounds="0 0 ${w} ${h}" position="${num(layer.w / 2)} ${num(layer.h / 2)}" ${COMMON} cornerCurve="circular">`,
    `${ind}\t<filters>`,
    `${ind}\t\t<CAFilter filter="displacementMap" name="displacementMap" inputSourceSublayerName="sdfLayer" inputOffset="0 0" inputAmount="${num(-(g.refraction ?? 80))}"/>`,
    `${ind}\t</filters>`,
    `${ind}\t<sublayers>`,
    `${ind}\t\t<CASDFLayer id="${esc(layer.id)}_sdfLayer" name="sdfLayer" bounds="0 0 ${w} ${h}" position="${num(Math.round(layer.w / 2))} ${num(Math.round(layer.h / 2))}" ${COMMON} cornerCurve="circular">`,
    `${ind}\t\t\t<effect type="CASDFGlassDisplacementEffect" height="40" maskOffset="0"/>`,
    `${ind}\t\t\t<sublayers>`,
    `${ind}\t\t\t\t<CASDFElementLayer id="${esc(layer.id)}_elementLayer" name="elementLayer" bounds="0 0 ${w} ${h}" position="${num(Math.round(layer.w / 2))} ${num(Math.round(layer.h / 2))}" cornerRadius="${num(Math.min(layer.cornerRadius || 0, layer.w / 2, layer.h / 2))}" ${COMMON} cornerCurve="continuous"/>`,
    `${ind}\t\t\t</sublayers>`,
    `${ind}\t\t</CASDFLayer>`,
    `${ind}\t</sublayers>`,
    `${ind}</CABackdropLayer>`,
  ].join('\n');
}

function liveFrostXml(layer, ind) {
  const g = layer.glass || {};
  return [
    `${ind}<CABackdropLayer id="${esc(layer.id)}-backdrop" name="${esc(layer.id)} Backdrop" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" position="${num(layer.w / 2)} ${num(layer.h / 2)}" cornerRadius="${num(layer.cornerRadius || 0)}" masksToBounds="1" ${COMMON} cornerCurve="continuous">`,
    `${ind}\t<filters>`,
    `${ind}\t\t<CAFilter filter="gaussianBlur" name="Gaussian Blur" enabled="true" inputRadius="${num(g.blur ?? 20)}"/>`,
    `${ind}\t\t<CAFilter filter="colorSaturate" name="Saturate" enabled="true" inputAmount="${num(g.saturation ?? 1.4)}"/>`,
    `${ind}\t</filters>`,
    `${ind}</CABackdropLayer>`,
  ].join('\n');
}

function filtersXml(layer, ind) {
  const f = layer.filters || {};
  const out = [];
  if (f.blur > 0) out.push(`<CAFilter filter="gaussianBlur" name="Gaussian Blur" enabled="true" inputRadius="${num(f.blur)}"/>`);
  if (f.hue) out.push(`<CAFilter filter="colorHueRotate" name="Hue" enabled="true" inputAngle="${num(f.hue * DEG)}"/>`);
  if (f.saturate != null && f.saturate !== 1) out.push(`<CAFilter filter="colorSaturate" name="Saturate" enabled="true" inputAmount="${num(f.saturate)}"/>`);
  if (f.contrast != null && f.contrast !== 1) out.push(`<CAFilter filter="colorContrast" name="Contrast" enabled="true" inputAmount="${num(f.contrast)}"/>`);
  const parts = [];
  if (layer.blend && layer.blend !== 'normal') parts.push(`${ind}<compositingFilter type="CAFilter" filter="${esc(layer.blend)}" name="${esc(layer.blend)}"/>`);
  if (out.length) parts.push(`${ind}<filters>${out.join('')}</filters>`);
  return parts.join('\n');
}

/** transform attribute for static rotation / scale (CAPlayground syntax). */
function transformAttr(rotation, scale, rotX = 0, rotY = 0) {
  const parts = [];
  if (rotation) parts.push(`rotate(${num(-rotation)}deg)`);
  if (rotY) parts.push(`rotate(${num(rotY)}deg, 0, 1, 0)`);
  if (rotX) parts.push(`rotate(${num(-rotX)}deg, 1, 0, 0)`);
  if (scale != null && scale !== 1) parts.push(`scale(${num(scale)}, ${num(scale)}, 1)`);
  return parts.length ? ` transform="${parts.join(' ')}"` : '';
}

/**
 * One editor layer → CAML subtree:
 *   [CATransformLayer "<name> Parallax"]          gyro (modern only)
 *     CALayer "<name>"  (id = layer.id)            geometry, opacity, state values, blend, filters
 *       CALayer "<name> Anim n" …                  one nesting level per animation
 *         content (image / frames / emitter / glass)
 */
export function layerXml(layer, res, ctx, ind = '      ') {
  const H = ctx.H;
  const name = ctx.names.get(layer.id);
  const base = effective(layer, 'Locked', false);
  const nugget = ctx.batter && layer.nuggetOption ? ` nuggetId="${esc(layer.id)}"` : '';
  const radius = layer.cornerRadius > 0 && layer.kind !== 'glass' ? ` cornerRadius="${num(layer.cornerRadius)}" masksToBounds="1"` : '';
  const lines = [];
  let depth = 0;
  const open = (s) => {
    lines.push('\t'.repeat(depth) + s);
  };
  const pad = () => ind + '\t'.repeat(depth);
  const wantsParallax = ctx.format !== 'classic' && layer.parallax > 0;
  if (wantsParallax) {
    lines.push(`${pad()}<CATransformLayer id="${esc(layer.id)}-px" name="${esc(name)} Parallax" bounds="0 0 ${num(ctx.W)} ${num(ctx.H)}" position="${num(ctx.W / 2)} ${num(ctx.H / 2)}" ${COMMON}>`);
    depth++;
    lines.push(`${pad()}<sublayers>`);
    depth++;
  }
  const fast = fastFadeActive(layer, ctx);
  const outerOpacity = fast ? Math.sqrt(Math.max(0, base.opacity)) : base.opacity;
  // a layer whose content folds / tilts needs its own perspective, otherwise CALayer flattens the 3D
  const ownPersp = usesGyro(ctx) && (layer.gyro?.tilt > 0 || layer.gyro?.fold > 0) ? ` sublayerTransform="perspective(${num(ctx.perspective || 900)})"` : '';
  lines.push(
    `${pad()}<CALayer id="${esc(layer.id)}"${nugget} name="${esc(name)}" bounds="0 0 ${num(layer.w)} ${num(layer.h)}"${anchorAttr(layer)}${ownPersp} position="${num(caStateValue('x', base.x, H, layer))} ${num(caStateValue('y', base.y, H, layer))}" opacity="${num(outerOpacity)}"${transformAttr(base.rotation, base.scale, base.rotX, base.rotY)} hidden="${layer.hidden ? 1 : 0}"${radius} geometryFlipped="0" ${COMMON} cornerCurve="continuous">`
  );
  depth++;
  const fx = filtersXml(layer, pad());
  if (fx) lines.push(fx);
  const anims = (layer.anims || []).filter((a) => a.enabled !== false && (a.keys || []).length >= 2);
  const center = `position="${num(layer.w / 2)} ${num(layer.h / 2)}"`;
  // helper wrappers (fast fade, gyro tilt, gyro fade) – each its own layer so groups never collide
  const wrappers = wrapperSpecs(layer, ctx, name, base);
  wrappers.forEach((w) => {
    lines.push(`${pad()}<sublayers>`);
    depth++;
    const where = w.pivot && hasAnchor(layer) ? `${anchorAttr(layer)} ${innerAnchorPos(layer)}` : center;
    lines.push(`${pad()}<${w.kind || 'CALayer'} id="${esc(layer.id)}-${w.suffix}" name="${esc(w.name)}" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" ${where}${w.attrs || ''} ${COMMON}>`);
    depth++;
  });
  // nested animation layers
  anims.forEach((a, i) => {
    lines.push(`${pad()}<sublayers>`);
    depth++;
    lines.push(`${pad()}<CALayer id="${esc(layer.id)}-a${i}" name="${esc(name)} Anim ${i + 1}" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" ${center} ${COMMON}>`);
    depth++;
    lines.push(`${pad()}<animations>`);
    lines.push(animXml(a, layer, pad() + '\t', 0));
    lines.push(`${pad()}</animations>`);
  });
  // content
  lines.push(`${pad()}<sublayers>`);
  depth++;
  if (layer.kind === 'emitter') {
    lines.push(emitterXml(layer, res.file, pad()));
  } else if (layer.kind === 'glass' && layer.glass?.mode === 'liquid') {
    lines.push(liquidGlassXml(layer, pad()));
    if (res.file) lines.push(`${pad()}<CALayer id="${esc(layer.id)}-rim" name="${esc(name)} Rim" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" ${center} ${COMMON}><contents><CGImage src="${esc(res.file)}"/></contents></CALayer>`);
  } else if (layer.kind === 'glass' && layer.glass?.mode === 'live') {
    lines.push(liveFrostXml(layer, pad()));
    if (res.file) lines.push(`${pad()}<CALayer id="${esc(layer.id)}-rim" name="${esc(name)} Rim" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" ${center} ${COMMON}><contents><CGImage src="${esc(res.file)}"/></contents></CALayer>`);
  } else {
    const gravity = layer.kind === 'image' || layer.kind === 'video' ? GRAVITY[layer.fit] || 'resize' : 'resize';
    const clip = (layer.kind === 'image' || layer.kind === 'video') && layer.fit === 'cover' ? ' masksToBounds="1"' : '';
    lines.push(`${pad()}<CALayer id="${esc(layer.id)}-content" name="${esc(name)} Content" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" ${center} contentsGravity="${gravity}"${clip} ${COMMON}>`);
    if (res.file) lines.push(`${pad()}\t<contents><CGImage src="${esc(res.file)}"/></contents>`);
    if (layer.kind === 'video' && res.frames?.length > 1) {
      lines.push(`${pad()}\t<animations>`);
      lines.push(framesXml(layer, res.frames, pad() + '\t\t'));
      lines.push(`${pad()}\t</animations>`);
    }
    lines.push(`${pad()}</CALayer>`);
  }
  depth--;
  lines.push(`${pad()}</sublayers>`);
  for (let i = anims.length - 1; i >= 0; i--) {
    depth--;
    lines.push(`${pad()}</CALayer>`);
    depth--;
    lines.push(`${pad()}</sublayers>`);
  }
  for (let i = wrappers.length - 1; i >= 0; i--) {
    depth--;
    lines.push(`${pad()}</${wrappers[i].kind || 'CALayer'}>`);
    depth--;
    lines.push(`${pad()}</sublayers>`);
  }
  depth--;
  lines.push(`${pad()}</CALayer>`);
  if (wantsParallax) {
    depth--;
    lines.push(`${pad()}</sublayers>`);
    depth--;
    lines.push(`${pad()}</CATransformLayer>`);
  }
  void open;
  return lines.join('\n');
}

const usesGyro = (ctx) => ctx.format === 'modern' || ctx.format === 'duo';

/** anchorPoint attribute (CA is y-up, so the y component flips) */
function anchorAttr(layer) {
  if (!hasAnchor(layer)) return '';
  return ` anchorPoint="${num(layer.anchor.x)} ${num(1 - layer.anchor.y)}"`;
}
/** position of the anchor inside the layer's own bounds (for pivoting wrappers) */
function innerAnchorPos(layer) {
  const a = layer.anchor || { x: 0.5, y: 0.5 };
  return `position="${num(a.x * layer.w)} ${num((1 - a.y) * layer.h)}"`;
}

function fastFadeActive(layer, ctx) {
  return usesGyro(ctx) && layer.fastFade && animatedProps(layer, false).includes('opacity');
}

/** extra nested layers a layer needs, outermost first */
function wrapperSpecs(layer, ctx, name, base) {
  const out = [];
  if (fastFadeActive(layer, ctx)) out.push({ suffix: 'ff', name: `${name} Fade`, attrs: ` opacity="${num(Math.sqrt(Math.max(0, base.opacity)))}"` });
  if (usesGyro(ctx) && (layer.gyro?.tilt > 0 || layer.gyro?.fold > 0)) out.push({ suffix: 'tilt', name: `${name} Tilt`, pivot: true });
  if (usesGyro(ctx) && layer.gyro?.fade && layer.gyro.fade !== 'none') out.push({ suffix: 'gf', name: `${name} GyroFade` });
  return out;
}

/** state property groups of one layer: [{name, keyPath, lock, home, sleep}] (CA values) */
export function layerPropertyGroups(layer, name, H) {
  const out = [];
  const props = animatedProps(layer, false);
  const fast = layer.fastFade && props.includes('opacity');
  for (const p of props) {
    const def = ANIMATABLE.find((a) => a.id === p);
    let v = (st) => caStateValue(p, effective(layer, st, false)[p], H, layer);
    if (p === 'opacity' && fast) {
      const raw = v;
      v = (st) => Math.sqrt(Math.max(0, Math.min(1, raw(st))));
      out.push({ name: `${name} Fade`, keyPath: 'opacity', lock: v('Locked'), home: v('Unlock'), sleep: v('Sleep') });
    }
    out.push({ name, keyPath: def.pcaKeyPath, lock: v('Locked'), home: v('Unlock'), sleep: v('Sleep') });
  }
  return out;
}

/** gyro groups of one layer: [{name, axis, keyPath, min, max, type}] */
export function layerGyroGroups(layer, name) {
  const out = [];
  const n = Math.round(layer.parallax || 0);
  if (n > 0) for (const axis of ['x', 'y']) out.push({ name: `${name} Parallax`, axis, keyPath: `transform.translation.${axis}`, min: -n, max: n, type: 'integer' });
  const t = layer.gyro?.tilt || 0;
  if (t > 0) {
    out.push({ name: `${name} Tilt`, axis: 'x', keyPath: 'transform.rotation.y', min: -t * DEG, max: t * DEG, type: 'real' });
    out.push({ name: `${name} Tilt`, axis: 'y', keyPath: 'transform.rotation.x', min: -t * DEG, max: t * DEG, type: 'real' });
  }
  const fold = layer.gyro?.fold || 0;
  if (fold > 0) out.push({ name: `${name} Tilt`, axis: 'x', keyPath: 'transform.rotation.y', min: 0, max: fold * DEG, type: 'real' });
  const f = layer.gyro?.fade;
  if (f && f !== 'none') {
    const axis = f.replace('-', '');
    // values below 0 are allowed so a fade can stay invisible until the phone passes level
    const lo = Math.max(-1, Math.min(1, layer.gyro.fadeMin ?? 0));
    const hi = Math.max(-1, Math.min(1, layer.gyro.fadeMax ?? 1));
    const flip = f.startsWith('-');
    out.push({ name: `${name} GyroFade`, axis, keyPath: 'opacity', min: flip ? hi : lo, max: flip ? lo : hi, type: 'real' });
  }
  return out;
}

const perspectiveAttr = (project, layers) =>
  layers.some((l) => l.rotX || l.rotY || l.gyro?.tilt > 0 || Object.values(l.states || {}).some((s) => 'rotX' in s || 'rotY' in s))
    ? ` sublayerTransform="perspective(${num(project.perspective || 900)})"`
    : '';

// ---------------------------------------------------------------- modern (ParameterizedCA)

const dict = (entries, ind) =>
  `${ind}<NSDictionary>\n${entries.map(([k, type, v]) => (type === 'null' ? `${ind}\t<${k} type="null"/>` : `${ind}\t<${k} type="${type}" value="${esc(v)}"/>`)).join('\n')}\n${ind}</NSDictionary>`;

/**
 * Build the single main.caml of a ParameterizedCA wallpaper.
 * @param {object} project
 * @param {Map<string,{file?:string,frames?:string[]}>} resources
 */
export function buildModernCaml(project, resources, opts = {}) {
  const W = project._w;
  const H = project._h;
  const names = uniqueNames(project.layers);
  const ctx = { W, H, names, format: 'modern', batter: opts.batter, perspective: project.perspective };
  const I = '  ';
  const props = [];
  const parallax = [];
  for (const l of project.layers) {
    const view = l.plane === 'background' ? 'Background' : 'Floating';
    const n = names.get(l.id);
    for (const g of layerPropertyGroups(l, n, H))
      props.push(dict([['image', 'null'], ['keyPath', 'string', g.keyPath], ['layerName', 'string', g.name], ['v_home', 'real', num(g.home)], ['v_lock', 'real', num(g.lock)], ['v_sleep', 'real', num(g.sleep)], ['view', 'string', view]], I.repeat(4)));
    for (const g of layerGyroGroups(l, n))
      parallax.push(dict([['axis', 'string', g.axis], ['image', 'string', 'null'], ['keyPath', 'string', g.keyPath], ['layerName', 'string', g.name], ['mapMaxTo', g.type, num(g.max)], ['mapMinTo', g.type, num(g.min)], ['title', 'string', 'Gyro'], ['view', 'string', view]], I.repeat(4)));
  }
  const group = (plane) => {
    const layers = project.layers.filter((l) => l.plane === plane.id);
    const body = layers.map((l) => layerXml(l, resources.get(l.id) || {}, ctx, I.repeat(4))).join('\n');
    return `${I.repeat(2)}<CALayer id="${plane.id}" name="${plane.group}" bounds="0 0 ${num(W)} ${num(H)}" position="${num(W / 2)} ${num(H / 2)}"${perspectiveAttr(project, layers)} geometryFlipped="0" masksToBounds="0" opacity="1" ${COMMON} cornerCurve="circular">\n${I.repeat(3)}<sublayers>${body ? `\n${body}\n${I.repeat(3)}` : ''}</sublayers>\n${I.repeat(2)}</CALayer>`;
  };
  const arr = (tag, items) => (items.length ? `${I.repeat(3)}<${tag} type="NSArray">\n${items.join('\n')}\n${I.repeat(3)}</${tag}>` : `${I.repeat(3)}<${tag} type="NSArray"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<caml xmlns="${CAML_NS}">
${I}<CALayer id="__capRootLayer__" name="Root Layer" bounds="0 0 ${num(W)} ${num(H)}" position="${num(W / 2)} ${num(H / 2)}" geometryFlipped="0" opacity="1" backgroundColor="0 0 0" ${COMMON} cornerCurve="circular">
${I.repeat(2)}<style>
${arr('wallpaperBackgroundAssetNames', [])}
${arr('wallpaperFloatingAssetNames', [])}
${arr('wallpaperParallaxGroups', parallax)}
${arr('wallpaperPropertyGroups', props)}
${I.repeat(2)}</style>
${I.repeat(2)}<sublayers>
${PLANES.map(group).join('\n')}
${I.repeat(2)}</sublayers>
${I}</CALayer>
</caml>
`;
}

// ---------------------------------------------------------------- iPhone Duo (iOS 27 per-screen schema)

/**
 * iPhone Duo split-screen wallpaper (Apple's Clownfish-V68 layout, device-verified by tendies_kit):
 * root 6000×6000 px, one BACKGROUND/FLOATING pair per screen (ONE = inner, TWO = cover), each with
 * its own parallax + property groups holding portrait_* and landscape_* values. The scene (S×S pt)
 * is placed once per screen in a Frame layer scaled to 3 px/pt around the screen centre, so the cover
 * shows a tighter crop and opening the phone feels like zooming out.
 */
export function buildDuoCaml(project, resources, opts = {}) {
  const S = project._w;
  const H = project._h;
  const R = DUO.root;
  const C = R / 2;
  const I = '  ';
  const screens = {};
  for (const [scr, info] of Object.entries(DUO.screens)) {
    const key = info.key;
    // per-screen copies with unique ids + names
    const copies = project.layers.map((l) => ({ ...l, id: `${l.id}-${key}` }));
    const names = new Map([...uniqueNames(project.layers)].map(([id, n]) => [`${id}-${key}`, `${n} ${key}`]));
    const res = new Map([...resources].map(([id, r]) => [`${id}-${key}`, r]));
    const ctx = { W: S, H, names, format: 'duo', batter: opts.batter, perspective: project.perspective };
    const trees = {};
    for (const plane of PLANES) {
      const layers = copies.filter((l) => l.plane === plane.id);
      const body = layers.map((l) => layerXml(l, res.get(l.id) || {}, ctx, I.repeat(6))).join('\n');
      const groupName = `${plane.group} ${key}`;
      const xml = `${I.repeat(3)}<CALayer id="${plane.id}-${key}" name="${groupName}" bounds="0 0 ${R} ${R}" position="${C} ${C}" geometryFlipped="0" masksToBounds="0" opacity="1" ${COMMON} cornerCurve="circular">
${I.repeat(4)}<sublayers>
${I.repeat(5)}<CALayer id="frame-${plane.id}-${key}" name="Frame ${plane.short} ${key}" bounds="0 0 ${num(S)} ${num(H)}" position="${C} ${C}" transform="scale(${DUO.ppt}, ${DUO.ppt}, 1)"${perspectiveAttr(project, layers)} geometryFlipped="0" masksToBounds="0" opacity="1" ${COMMON} cornerCurve="circular">
${I.repeat(6)}<sublayers>${body ? `\n${body}\n${I.repeat(6)}` : ''}</sublayers>
${I.repeat(5)}</CALayer>
${I.repeat(4)}</sublayers>
${I.repeat(3)}</CALayer>`;
      const props = [];
      const par = [];
      for (const l of layers) {
        const n = names.get(l.id);
        for (const g of layerPropertyGroups(l, n, H))
          props.push([['keyPath', 'string', g.keyPath], ['landscape_home', 'real', g.home], ['landscape_lock', 'real', g.lock], ['landscape_sleep', 'real', g.sleep], ['layerName', 'string', g.name], ['portrait_home', 'real', g.home], ['portrait_lock', 'real', g.lock], ['portrait_sleep', 'real', g.sleep]]);
        for (const g of layerGyroGroups(l, n))
          par.push([['axis', 'string', g.axis], ['image', 'string', 'null'], ['keyPath', 'string', g.keyPath], ['layerName', 'string', g.name], ['mapMaxTo', g.type, g.max], ['mapMinTo', g.type, g.min], ['title', 'string', 'Gyro'], ['view', 'string', plane.id === 'background' ? 'Background' : 'Floating']]);
      }
      trees[plane.id] = { xml, name: groupName, props, par };
    }
    screens[scr] = { info, trees };
  }
  const ind = I.repeat(5);
  const array = (tag, dicts) => {
    if (!dicts.length) return [`${ind}<${tag} type="NSArray"/>`];
    const out = [`${ind}<${tag} type="NSArray">`];
    for (const d of dicts) {
      out.push(`${ind}  <NSDictionary>`);
      for (const [k, t, v] of d) out.push(`${ind}    <${k} type="${t}" value="${t === 'integer' ? Math.round(v) : t === 'real' ? num(v) : esc(v)}"/>`);
      out.push(`${ind}  </NSDictionary>`);
    }
    return [...out, `${ind}</${tag}>`];
  };
  const style = [`${I.repeat(2)}<style>`, `${I.repeat(3)}<wallpapers type="NSArray">`];
  for (const scr of ['cover', 'inner']) {
    const { info, trees } = screens[scr];
    style.push(`${I.repeat(4)}<NSDictionary>`, `${ind}<backgroundAssetNames type="NSArray"/>`, `${ind}<backgroundLayerName type="string" value="${trees.background.name}"/>`);
    style.push(...array('backgroundParallaxGroups', trees.background.par), ...array('backgroundPropertyGroups', trees.background.props));
    style.push(`${ind}<floatingAssetNames type="NSArray"/>`, `${ind}<floatingLayerName type="string" value="${trees.floating.name}"/>`);
    style.push(...array('floatingParallaxGroups', trees.floating.par), ...array('floatingPropertyGroups', trees.floating.props));
    for (const k of ['idealHeight', 'idealWidth', 'pixelHeight', 'pixelParallaxBleed', 'pixelSquareWithParallax', 'pixelSquareWithoutParallax', 'pixelWidth']) style.push(`${ind}<${k} type="integer" value="${info[k]}"/>`);
    style.push(`${ind}<retinaMultiplier type="integer" value="3"/>`, `${ind}<screenName type="string" value="${info.screenName}"/>`, `${ind}<supportsLandscape type="integer" value="1"/>`, `${I.repeat(4)}</NSDictionary>`);
  }
  style.push(`${I.repeat(3)}</wallpapers>`, `${I.repeat(2)}</style>`);
  const body = ['inner', 'cover'].flatMap((scr) => [screens[scr].trees.background.xml, screens[scr].trees.floating.xml]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<caml xmlns="${CAML_NS}">
${I}<CALayer id="root" name="Root Layer" bounds="0 0 ${R} ${R}" position="${C} ${C}" zPosition="0" geometryFlipped="0" opacity="1" backgroundColor="0 0 0" ${COMMON} cornerCurve="circular">
${style.join('\n')}
${I.repeat(2)}<sublayers>
${body.join('\n')}
${I.repeat(2)}</sublayers>
${I.repeat(2)}<modules/>
${I}</CALayer>
</caml>
`;
}

// ---------------------------------------------------------------- classic (LayeredAnimation)

export function stateNames(appearanceAware) {
  const plain = STATES.map((s) => ({ name: s.id, state: s.id, dark: false }));
  if (!appearanceAware) return plain;
  return [
    ...plain,
    ...STATES.map((s) => ({ name: `${s.id} Light`, state: s.id, dark: false })),
    ...STATES.map((s) => ({ name: `${s.id} Dark`, state: s.id, dark: true })),
  ];
}

function springXml(t, keyPath, ind) {
  if (t.type === 'basic') return `${ind}<animation type="CABasicAnimation" duration="${num(t.duration)}" fillMode="backwards" keyPath="${keyPath}"/>`;
  return `${ind}<animation type="CASpringAnimation" damping="${num(t.damping)}" mass="${num(t.mass)}" stiffness="${num(t.stiffness)}" velocity="0" duration="${num(t.duration)}" fillMode="backwards" keyPath="${keyPath}" mica_autorecalculatesDuration="1"/>`;
}

export function buildClassicCaml(project, planeId, resources, opts = {}) {
  const W = project._w;
  const H = project._h;
  const names = opts.names || uniqueNames(project.layers);
  const ctx = { W, H, names, format: 'classic', batter: opts.batter };
  const layers = planeId === 'foreground' ? [] : project.layers.filter((l) => l.plane === planeId);
  const aware = !!project.appearanceAware;
  const states = stateNames(aware);
  const I = '  ';
  const sub = layers.map((l) => layerXml(l, resources.get(l.id) || {}, ctx, I.repeat(3))).join('\n');
  const animated = new Map(layers.map((l) => [l.id, animatedProps(l, aware)]));
  const valueXml = (p, v) => (p === 'x' || p === 'y' ? `<value type="integer" value="${Math.round(v)}"/>` : `<value type="real" value="${num(v)}"/>`);
  const stateXml = states
    .map((st) => {
      const els = [];
      for (const l of layers) {
        const vals = effective(l, st.state, st.dark);
        for (const p of animated.get(l.id)) {
          const def = ANIMATABLE.find((a) => a.id === p);
          els.push(`${I.repeat(5)}<LKStateSetValue targetId="${esc(l.id)}" keyPath="${def.keyPath}">${valueXml(p, caStateValue(p, vals[p], H, l))}</LKStateSetValue>`);
        }
      }
      return `${I.repeat(3)}<LKState name="${esc(st.name)}">\n${I.repeat(4)}${els.length ? `<elements>\n${els.join('\n')}\n${I.repeat(4)}</elements>` : '<elements/>'}\n${I.repeat(3)}</LKState>`;
    })
    .join('\n');
  const transXml = states
    .map((st) => {
      const els = [];
      for (const l of layers) {
        const t = l.transition || project.transition;
        for (const p of animated.get(l.id)) {
          const def = ANIMATABLE.find((a) => a.id === p);
          els.push(`${I.repeat(5)}<LKStateTransitionElement targetId="${esc(l.id)}" key="${def.keyPath}">\n${springXml(t, def.keyPath, I.repeat(6))}\n${I.repeat(5)}</LKStateTransitionElement>`);
        }
      }
      const body = els.length ? `${I.repeat(4)}<elements>\n${els.join('\n')}\n${I.repeat(4)}</elements>` : `${I.repeat(4)}<elements/>`;
      return `${I.repeat(3)}<LKStateTransition fromState="*" toState="${esc(st.name)}">\n${body}\n${I.repeat(3)}</LKStateTransition>`;
    })
    .join('\n');
  const label = { background: '_BACKGROUND', floating: '_FLOATING', foreground: '_FOREGROUND' }[planeId];
  return `<?xml version="1.0" encoding="UTF-8"?>
<caml xmlns="${CAML_NS}">
${I}<CALayer id="root-${planeId}" name="${label}" bounds="0 0 ${num(W)} ${num(H)}" position="${num(W / 2)} ${num(H / 2)}" geometryFlipped="0" ${COMMON} cornerCurve="circular" hidden="0">
${I.repeat(2)}<sublayers>${sub ? '\n' + sub + '\n' + I.repeat(2) : ''}</sublayers>
${I.repeat(2)}<states>
${stateXml}
${I.repeat(2)}</states>
${I.repeat(2)}<stateTransitions>
${transXml}
${I.repeat(2)}</stateTransitions>
${I}</CALayer>
</caml>
`;
}

export function buildIndexXml(project, minimal = false) {
  if (minimal) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>rootDocument</key>
  <string>main.caml</string>
</dict>
</plist>
`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>assetManifest</key>
	<string>assetManifest.caml</string>
	<key>documentHeight</key>
	<real>${num(project._h)}</real>
	<key>documentResizesToView</key>
	<false/>
	<key>documentWidth</key>
	<real>${num(project._w)}</real>
	<key>geometryFlipped</key>
	<false/>
	<key>rootDocument</key>
	<string>main.caml</string>
	<key>scalesToFitInPlayer</key>
	<true/>
	<key>unitsInPixelsInPlayer</key>
	<false/>
</dict>
</plist>
`;
}

export const ASSET_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>

<caml xmlns="${CAML_NS}">
  <MicaAssetManifest>
    <modules type="NSArray"/>
  </MicaAssetManifest>
</caml>
`;
