// CAML (Core Animation archive XML) generator.
// The markup mirrors what PosterBoard's own wallpapers and community wallpapers
// verified on iOS 17 – 27 use:
//   <CALayer> tree, <contents><CGImage src=…/></contents>,
//   <LKState>/<LKStateSetValue> per lock-screen state,
//   <LKStateTransition>/<LKStateTransitionElement> with CASpringAnimation,
//   CAKeyframeAnimation with repeatCount="inf" for loops & frame sequences.
// Key paths use Apple's documented KVC extensions for CALayer
// (position.x, position.y, transform.scale, transform.rotation.z, opacity).

import { ANIMATABLE, PLANES, STATES, LOOPS, animatedProps, effective, stateKey } from './model.js';

export const CAML_NS = 'http://www.apple.com/CoreAnimation/1.0';

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const num = (n) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

const DEG = Math.PI / 180;

/** CA value for one of our animatable props. Rotation is degrees in the model. */
function caValue(prop, v) {
  return prop === 'rotation' ? v * DEG : v;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => num(c / 255));
}

/** State names emitted. Plain names are always present (PosterBoard on older iOS & non-appearance wallpapers),
 *  Light/Dark variants are added for appearance-aware wallpapers. */
export function stateNames(appearanceAware) {
  const plain = STATES.map((s) => ({ name: s.id, state: s.id, dark: false }));
  if (!appearanceAware) return plain;
  return [
    ...plain,
    ...STATES.map((s) => ({ name: `${s.id} Light`, state: s.id, dark: false })),
    ...STATES.map((s) => ({ name: `${s.id} Dark`, state: s.id, dark: true })),
  ];
}

function transitionAnim(t, keyPath, ind) {
  if (t.type === 'basic') {
    return `${ind}<animation type="CABasicAnimation" duration="${num(t.duration)}" fillMode="backwards" keyPath="${keyPath}"/>`;
  }
  return `${ind}<animation type="CASpringAnimation" damping="${num(t.damping)}" mass="${num(t.mass)}" stiffness="${num(t.stiffness)}" velocity="0" duration="${num(t.duration)}" fillMode="backwards" keyPath="${keyPath}" mica_autorecalculatesDuration="1"/>`;
}

/** Loop animation definition for the inner content layer (relative to its own frame). */
function loopAnimation(layer, ind) {
  const loop = layer.loop || {};
  if (!loop.type || loop.type === 'none') return '';
  const d = Math.max(0.05, Number(loop.duration) || 4);
  const amount = Number(loop.amount ?? LOOPS[loop.type]?.amount ?? 0);
  const cx = layer.w / 2;
  const cy = layer.h / 2;
  let keyPath;
  let values;
  let autoreverse = loop.autoreverse ? 1 : 0;
  let calc = 'linear';
  switch (loop.type) {
    case 'rotate':
      keyPath = 'transform.rotation.z';
      values = [0, Math.PI * 2 * (amount || 1)];
      autoreverse = 0;
      break;
    case 'pulse':
      keyPath = 'transform.scale';
      values = [1, 1 + amount / 100];
      calc = 'cubic';
      break;
    case 'float':
      keyPath = 'position.y';
      values = [cy, cy - amount];
      calc = 'cubic';
      break;
    case 'drift':
      keyPath = 'position.x';
      values = [cx - amount / 2, cx + amount / 2];
      calc = 'cubic';
      break;
    case 'sway':
      keyPath = 'transform.rotation.z';
      values = [-amount * DEG, amount * DEG];
      calc = 'cubic';
      break;
    case 'fade':
      keyPath = 'opacity';
      values = [1, Math.max(0, Math.min(1, amount / 100))];
      calc = 'cubic';
      break;
    case 'blink':
      keyPath = 'opacity';
      values = [1, 1, Math.max(0, Math.min(1, amount / 100)), 1];
      calc = 'discrete';
      autoreverse = 0;
      break;
    default:
      return '';
  }
  return [
    `${ind}<animation type="CAKeyframeAnimation" calculationMode="${calc}" keyPath="${keyPath}" beginTime="1e-100" duration="${num(d)}" removedOnCompletion="0" repeatCount="inf" repeatDuration="0" speed="1" timeOffset="0" autoreverses="${autoreverse}">`,
    `${ind}\t<values>`,
    ...values.map((v) => `${ind}\t\t<real value="${num(v)}"/>`),
    `${ind}\t</values>`,
    `${ind}</animation>`,
  ].join('\n');
}

function framesAnimation(layer, frames, ind) {
  const v = layer.video || {};
  const fps = Math.max(1, Number(v.fps) || 24);
  const duration = frames.length / fps;
  return [
    `${ind}<animation type="CAKeyframeAnimation" calculationMode="${v.calc === 'linear' ? 'linear' : 'discrete'}" keyPath="contents" beginTime="1e-100" duration="${num(duration)}" removedOnCompletion="0" repeatCount="inf" repeatDuration="0" speed="1" timeOffset="0" autoreverses="${v.autoreverse ? 1 : 0}">`,
    `${ind}\t<values>`,
    ...frames.map((f) => `${ind}\t\t<CGImage src="${esc(f)}"/>`),
    `${ind}\t</values>`,
    `${ind}</animation>`,
  ].join('\n');
}

const GRAVITY = { cover: 'resizeAspectFill', contain: 'resizeAspect', stretch: 'resize' };

function emitterXml(layer, asset, ind) {
  const e = layer.emitter || {};
  const W = layer.w;
  const H = layer.h;
  const shape = e.shape || 'line';
  // "line" emits along the top edge (or the bottom edge for upward motion), rectangle fills the layer
  const up = Math.sin((e.emissionLongitude || 0) * DEG) < -0.3;
  const pos = shape === 'line' ? `${num(W / 2)} ${up ? num(H + 10) : -10}` : `${num(W / 2)} ${num(H / 2)}`;
  const size = shape === 'line' ? `${num(W)} 1` : `${num(W)} ${num(H)}`;
  const [r, g, b] = hexToRgb(e.color || '#ffffff');
  const cellScale = (Number(e.scale) || 1) * ((Number(e.size) || 16) / 64); // particle bitmaps are 64 px
  return [
    `${ind}<CAEmitterLayer id="${esc(layer.id)}-emitter" name="${esc(layer.name)} Emitter" bounds="0 0 ${num(W)} ${num(H)}" position="${num(W / 2)} ${num(H / 2)}" emitterPosition="${pos}" emitterSize="${size}" emitterShape="${shape}" emitterMode="${shape === 'line' ? 'outline' : 'volume'}" renderMode="unordered" birthRate="1" lifetime="1" velocity="1" scale="1" spin="1" seed="${Math.floor(Math.random() * 1e6)}" allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8">`,
    `${ind}\t<emitterCells>`,
    `${ind}\t\t<CAEmitterCell name="particle" enabled="1" birthRate="${num(e.birthRate)}" lifetime="${num(e.lifetime)}" lifetimeRange="${num((e.lifetime || 1) * 0.3)}" velocity="${num(e.velocity)}" velocityRange="${num(e.velocityRange)}" emissionLongitude="${num((e.emissionLongitude || 0) * DEG)}" emissionRange="${num((e.emissionRange || 0) * DEG)}" xAcceleration="${num(e.xAcceleration || 0)}" yAcceleration="${num(e.yAcceleration || 0)}" scale="${num(cellScale)}" scaleRange="${num((Number(e.scaleRange) || 0) * ((Number(e.size) || 16) / 64))}" spin="${num(e.spin || 0)}" spinRange="${num(e.spinRange || 0)}" alphaSpeed="${num(e.alphaSpeed || 0)}" color="${r} ${g} ${b} 1">`,
    `${ind}\t\t\t<contents>`,
    `${ind}\t\t\t\t<CGImage src="${esc(asset)}"/>`,
    `${ind}\t\t\t</contents>`,
    `${ind}\t\t</CAEmitterCell>`,
    `${ind}\t</emitterCells>`,
    `${ind}</CAEmitterLayer>`,
  ].join('\n');
}

/**
 * One exported layer = an outer CALayer (geometry + state values, id = layer.id)
 * holding an inner content layer (image / frames / emitter + loop animation).
 * Splitting them lets loops and state transitions animate the same property without clashing.
 */
function layerXml(layer, res, ind, opts) {
  const base = effective(layer, 'Locked', false);
  const nugget = opts.batter && layer.nuggetOption ? ` nuggetId="${esc(layer.id)}"` : '';
  const radius = layer.cornerRadius > 0 ? ` cornerRadius="${num(layer.cornerRadius)}" masksToBounds="1"` : '';
  const outer =
    `${ind}<CALayer id="${esc(layer.id)}"${nugget} name="${esc(layer.name)}" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" ` +
    `position="${num(base.x)} ${num(base.y)}" opacity="${num(base.opacity)}" hidden="${layer.hidden ? 1 : 0}"${radius} ` +
    `geometryFlipped="0" allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8" cornerCurve="continuous">`;

  const inner = [];
  const loop = loopAnimation(layer, `${ind}\t\t\t\t`);
  const innerOpen =
    `${ind}\t\t<CALayer id="${esc(layer.id)}-content" name="${esc(layer.name)} Inhalt" bounds="0 0 ${num(layer.w)} ${num(layer.h)}" ` +
    `position="${num(layer.w / 2)} ${num(layer.h / 2)}" contentsGravity="${GRAVITY[layer.fit] || 'resize'}"${layer.fit === 'cover' ? ' masksToBounds="1"' : ''} ` +
    `allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8">`;

  if (layer.kind === 'emitter') {
    inner.push(innerOpen.replace(/ contentsGravity="[^"]*"( masksToBounds="1")?/, ''));
    inner.push(`${ind}\t\t\t<sublayers>`);
    inner.push(emitterXml(layer, res.file, `${ind}\t\t\t\t`));
    inner.push(`${ind}\t\t\t</sublayers>`);
  } else {
    inner.push(innerOpen);
    if (res.file) {
      inner.push(`${ind}\t\t\t<contents>`, `${ind}\t\t\t\t<CGImage src="${esc(res.file)}"/>`, `${ind}\t\t\t</contents>`);
    }
  }
  const anims = [];
  if (layer.kind === 'video' && res.frames?.length) anims.push(framesAnimation(layer, res.frames, `${ind}\t\t\t\t`));
  if (loop) anims.push(loop);
  if (anims.length) inner.push(`${ind}\t\t\t<animations>`, ...anims, `${ind}\t\t\t</animations>`);
  inner.push(`${ind}\t\t</CALayer>`);

  return [outer, `${ind}\t<sublayers>`, ...inner, `${ind}\t</sublayers>`, `${ind}</CALayer>`].join('\n');
}

/**
 * Build main.caml for one plane.
 * @param {object} project
 * @param {string} planeId background|floating|foreground
 * @param {Map<string,{file?:string,frames?:string[]}>} resources layer id -> asset paths (relative to the .ca)
 * @param {object} opts {batter:boolean}
 */
export function buildPlaneCaml(project, planeId, resources, opts = {}) {
  const W = project._w;
  const H = project._h;
  const layers = project.layers.filter((l) => l.plane === planeId);
  const aware = !!project.appearanceAware;
  const states = stateNames(aware);
  const I = '  ';

  const sub = layers.map((l) => layerXml(l, resources.get(l.id) || {}, I.repeat(3), opts)).join('\n');

  // state values
  const animated = new Map(layers.map((l) => [l.id, animatedProps(l, aware)]));
  const stateXml = states
    .map((st) => {
      const els = [];
      for (const l of layers) {
        const vals = effective(l, st.state, st.dark);
        for (const p of animated.get(l.id)) {
          const def = ANIMATABLE.find((a) => a.id === p);
          els.push(
            `${I.repeat(5)}<LKStateSetValue targetId="${esc(l.id)}" keyPath="${def.keyPath}">\n` +
              `${I.repeat(6)}<value type="real" value="${num(caValue(p, vals[p]))}"/>\n` +
              `${I.repeat(5)}</LKStateSetValue>`
          );
        }
      }
      return els.length
        ? `${I.repeat(3)}<LKState name="${esc(st.name)}">\n${I.repeat(4)}<elements>\n${els.join('\n')}\n${I.repeat(4)}</elements>\n${I.repeat(3)}</LKState>`
        : `${I.repeat(3)}<LKState name="${esc(st.name)}">\n${I.repeat(4)}<elements/>\n${I.repeat(3)}</LKState>`;
    })
    .join('\n');

  const transXml = states
    .map((st) => {
      const els = [];
      for (const l of layers) {
        const t = l.transition || project.transition;
        for (const p of animated.get(l.id)) {
          const def = ANIMATABLE.find((a) => a.id === p);
          els.push(
            `${I.repeat(5)}<LKStateTransitionElement targetId="${esc(l.id)}" key="${def.keyPath}">\n` +
              transitionAnim(t, def.keyPath, I.repeat(6)) +
              `\n${I.repeat(5)}</LKStateTransitionElement>`
          );
        }
      }
      const body = els.length ? `${I.repeat(4)}<elements>\n${els.join('\n')}\n${I.repeat(4)}</elements>` : `${I.repeat(4)}<elements/>`;
      return `${I.repeat(3)}<LKStateTransition fromState="*" toState="${esc(st.name)}">\n${body}\n${I.repeat(3)}</LKStateTransition>`;
    })
    .join('\n');

  const plane = PLANES.find((p) => p.id === planeId);
  return `<?xml version="1.0" encoding="UTF-8"?>
<caml xmlns="${CAML_NS}">
${I}<CALayer id="root-${planeId}" name="_${plane.file.toUpperCase()}" bounds="0 0 ${num(W)} ${num(H)}" position="${num(W / 2)} ${num(H / 2)}" geometryFlipped="0" allowsEdgeAntialiasing="1" allowsGroupOpacity="1" contentsFormat="RGBA8" cornerCurve="circular" hidden="0">
${I}${I}<sublayers>${sub ? '\n' + sub + '\n' + I + I : ''}</sublayers>
${I}${I}<states>
${stateXml}
${I}${I}</states>
${I}${I}<stateTransitions>
${transXml}
${I}${I}</stateTransitions>
${I}</CALayer>
</caml>
`;
}

export function buildIndexXml(project) {
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
	<key>loopEnd</key>
	<real>0.0</real>
	<key>loopStart</key>
	<real>0.0</real>
	<key>loopingEnabled</key>
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

export { stateKey };
