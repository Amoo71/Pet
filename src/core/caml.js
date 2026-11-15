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

import { ANIMATABLE, PLANES, STATES, animatedProps, effective } from './model.js';

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

/** editor value → CA value for a state property (needs the document height for y) */
export function caStateValue(prop, v, H) {
  if (prop === 'y') return H - v;
  if (prop === 'rotation') return -v * DEG;
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
    while (used.has(n) || used.has(`${n} Parallax`)) n = `${base} ${i++}`;
    used.add(n);
    used.add(`${n} Parallax`);
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
function transformAttr(rotation, scale) {
  const parts = [];
  if (rotation) parts.push(`rotate(${num(-rotation)}deg)`);
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
  const wantsParallax = ctx.format === 'modern' && layer.parallax > 0;
  if (wantsParallax) {
    lines.push(`${pad()}<CATransformLayer id="${esc(layer.id)}-px" name="${esc(name)} Parallax" bounds="0 0 ${num(ctx.W)} ${num(ctx.H)}" position="${num(ctx.W / 2)} ${num(ctx.H / 2)}" ${COMMON}>`);
    depth++;
    lines.push(`${pad()}<sublayers>`);
    depth++;
  }
  lines.push(
    `${pad()}<CALayer id="${esc(layer.id)}"${nugget} name="${esc(name)}" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" position="${num(base.x)} ${num(H - base.y)}" opacity="${num(base.opacity)}"${transformAttr(base.rotation, base.scale)} hidden="${layer.hidden ? 1 : 0}"${radius} geometryFlipped="0" ${COMMON} cornerCurve="continuous">`
  );
  depth++;
  const fx = filtersXml(layer, pad());
  if (fx) lines.push(fx);
  const anims = (layer.anims || []).filter((a) => a.enabled !== false && (a.keys || []).length >= 2);
  const center = `position="${num(layer.w / 2)} ${num(layer.h / 2)}"`;
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
  const ctx = { W, H, names, format: 'modern', batter: opts.batter };
  const I = '  ';
  const props = [];
  const parallax = [];
  for (const l of project.layers) {
    const view = l.plane === 'background' ? 'Background' : 'Floating';
    const n = names.get(l.id);
    for (const p of animatedProps(l, false)) {
      const def = ANIMATABLE.find((a) => a.id === p);
      const v = (st) => caStateValue(p, effective(l, st, false)[p], H);
      props.push(dict([['image', 'null'], ['keyPath', 'string', def.pcaKeyPath], ['layerName', 'string', n], ['v_home', 'real', num(v('Unlock'))], ['v_lock', 'real', num(v('Locked'))], ['v_sleep', 'real', num(v('Sleep'))], ['view', 'string', view]], I.repeat(4)));
    }
    if (l.parallax > 0) {
      for (const axis of ['x', 'y']) {
        parallax.push(dict([['axis', 'string', axis], ['image', 'string', 'null'], ['keyPath', 'string', `transform.translation.${axis}`], ['layerName', 'string', `${n} Parallax`], ['mapMaxTo', 'integer', Math.round(l.parallax)], ['mapMinTo', 'integer', -Math.round(l.parallax)], ['title', 'string', 'Gyro'], ['view', 'string', view]], I.repeat(4)));
      }
    }
  }
  const group = (plane) => {
    const layers = project.layers.filter((l) => l.plane === plane.id);
    const body = layers.map((l) => layerXml(l, resources.get(l.id) || {}, ctx, I.repeat(4))).join('\n');
    return `${I.repeat(2)}<CALayer id="${plane.id}" name="${plane.group}" bounds="0 0 ${num(W)} ${num(H)}" position="${num(W / 2)} ${num(H / 2)}" geometryFlipped="0" masksToBounds="0" opacity="1" ${COMMON} cornerCurve="circular">\n${I.repeat(3)}<sublayers>${body ? `\n${body}\n${I.repeat(3)}` : ''}</sublayers>\n${I.repeat(2)}</CALayer>`;
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
          els.push(`${I.repeat(5)}<LKStateSetValue targetId="${esc(l.id)}" keyPath="${def.keyPath}">${valueXml(p, caStateValue(p, vals[p], H))}</LKStateSetValue>`);
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
