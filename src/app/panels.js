// Side panels: Layers, Style, Motion, Project.
import { store, update, select, selectedLayer, subscribe, setView } from './store.js';
import { PLANES, STATES, KINDS, TRANSITION_PRESETS, EMITTER_PRESETS, ANIMATABLE, BLEND_MODES, EASINGS, ANIM_PROPS, ANIM_PRESETS, stateKey, effective, rebuildAnim, hasLoops } from '../core/model.js';
import { DEVICES, getDevice } from '../core/devices.js';
import { validateProject } from '../core/tendies.js';
import { layerBitmapURL } from './assets.js';
import { el, numField, colorField, selectField, toggleField, textField, segmented, section, button, resetSyncs, runSyncs, toast } from './dom.js';
import * as A from './actions.js';

let host;
let lastKey = '';

export function mountPanels(root) {
  host = root;
  subscribe((reason) => {
    const l = selectedLayer();
    const p = store.project;
    const key = JSON.stringify([store.view.tab, store.selection, l?.kind, p?.id, p?.appearanceAware, p?.format, l?.text?.fontAsset, !!l?.transition, l?.gradient?.stops?.length, l?.shape?.type, l?.emitter?.preset, l?.glass?.mode, p?.layers.length, (l?.anims || []).map((a) => [a.id, a.preset, a.prop, a.keys.length, a.repeat])]);
    const structural = ['project', 'history', 'select'].includes(reason) || key !== lastKey;
    const live = (store.view.tab === 'layers' && reason === 'edit') || (reason === 'view' && store.view.tab === 'motion');
    if (structural || live) {
      lastKey = key;
      render();
    } else runSyncs();
  });
  render();
}

function tabs() {
  const t = [
    ['layers', 'Layers'],
    ['style', 'Style'],
    ['motion', 'Motion'],
    ['project', 'Project'],
  ];
  return el('nav', { class: 'tabs', role: 'tablist' }, t.map(([id, name]) => el('button', { type: 'button', role: 'tab', class: `tab ${store.view.tab === id ? 'on' : ''}`, 'data-tab': id, 'aria-selected': String(store.view.tab === id), onclick: () => setView({ tab: id }) }, name)));
}

function render() {
  if (!host || !store.project) return;
  resetSyncs();
  const scroll = host.querySelector('.panel-body')?.scrollTop || 0;
  host.innerHTML = '';
  const body = el('div', { class: 'panel-body' });
  const tab = store.view.tab;
  if (tab === 'layers') body.append(...layersPanel());
  else if (tab === 'style') body.append(...stylePanel());
  else if (tab === 'motion') body.append(...motionPanel());
  else body.append(...projectPanel());
  host.append(tabs(), body);
  body.scrollTop = scroll;
}

const iconBtn = (t, label, fn, cls = '') => el('button', { type: 'button', class: `icon-btn ${cls}`, title: label, 'aria-label': label, onclick: (e) => (e.stopPropagation(), fn()) }, t);

// ---------------------------------------------------------------- Layers

export const ADD = [
  ['image', '🖼️', 'Image', () => A.addImages()],
  ['gif', '🔍', 'GIF search', () => A.openGifSearch()],
  ['video', '🎞️', 'Video', () => A.addVideo()],
  ['text', '𝐓', 'Text', () => A.addLayer('text')],
  ['shape', '⬟', 'Shape', () => A.addLayer('shape')],
  ['gradient', '🌈', 'Gradient', () => A.addLayer('gradient')],
  ['color', '🎨', 'Color', () => A.addLayer('color')],
  ['glass', '🫧', 'Glass', () => A.addLayer('glass')],
  ['emitter', '❄️', 'Particles', () => A.addLayer('emitter')],
  ['frames', '🧩', 'Sequence', () => A.addFrameSequence()],
];

function layersPanel() {
  const p = store.project;
  const add = el('div', { class: 'add-grid' }, ADD.map(([k, i, n, fn]) => el('button', { type: 'button', class: 'add-btn', 'data-add': k, onclick: fn }, [el('span', { class: 'add-ico' }, i), n])));
  const lists = [...PLANES].reverse().map((plane) => {
    const layers = p.layers.filter((l) => l.plane === plane.id).reverse();
    return el('div', { class: 'plane-group' }, [
      el('div', { class: 'plane-head' }, [el('b', {}, plane.name), el('small', {}, plane.id === 'floating' ? 'depth effect · above the clock' : 'wallpaper · under the clock')]),
      layers.length ? el('ul', { class: 'layer-list' }, layers.map(layerRow)) : el('p', { class: 'empty' }, 'No layers'),
    ]);
  });
  return [add, ...lists, el('p', { class: 'hint' }, 'Tip: tap the same spot again to select the layer underneath. Higher in the list = closer to you.')];
}

function layerRow(l) {
  const thumb = el('span', { class: 'thumb' }, KINDS[l.kind]?.icon);
  if (['image', 'gradient', 'video', 'color', 'shape', 'text'].includes(l.kind)) {
    layerBitmapURL(l).then((u) => {
      if (u) {
        thumb.textContent = '';
        thumb.style.backgroundImage = `url("${u}")`;
      }
    });
  }
  const tags = [];
  if (Object.keys(l.states || {}).length) tags.push('swipe');
  if ((l.anims || []).length) tags.push('anim');
  if (l.parallax) tags.push('gyro');
  if (hasLoops(l)) tags.push('🔋');
  return el('li', { class: `layer-row ${l.id === store.selection ? 'on' : ''} ${l.hidden ? 'is-hidden' : ''}`, 'data-id': l.id, onclick: () => select(l.id) }, [
    thumb,
    el('span', { class: 'lname' }, [l.name, el('small', {}, [KINDS[l.kind]?.name, ...tags.map((t) => ` · ${t}`)])]),
    el('span', { class: 'row-actions' }, [
      iconBtn(l.hidden ? '◌' : '●', l.hidden ? 'Show' : 'Hide', () => update((p) => (p.layers.find((x) => x.id === l.id).hidden = !l.hidden))),
      iconBtn(l.locked ? '🔒' : '🔓', l.locked ? 'Unlock' : 'Lock', () => update((p) => (p.layers.find((x) => x.id === l.id).locked = !l.locked))),
      iconBtn('↑', 'Bring forward', () => A.moveLayer(l.id, 1)),
      iconBtn('↓', 'Send backward', () => A.moveLayer(l.id, -1)),
    ]),
  ]);
}

// ---------------------------------------------------------------- Style

const L = (fn, group) => update((p) => fn(p.layers.find((l) => l.id === store.selection), p), group);
const g = (k) => `${store.selection}:${k}`;
const darkActive = () => store.project.appearanceAware && store.view.dark && store.project.format === 'classic';
const editingBase = () => store.view.state === 'Locked' && !darkActive();
const curKey = () => stateKey(store.view.state, darkActive());

function animField(def, label, o = {}) {
  return numField(
    label,
    () => effective(selectedLayer(), store.view.state, darkActive())[def.id],
    (v) =>
      L((l) => {
        if (editingBase()) l[def.id] = v;
        else l.states[curKey()] = { ...(l.states[curKey()] || {}), [def.id]: v };
      }, g(def.id)),
    { ...o, step: def.step, min: def.min, max: def.max, isOverride: () => !editingBase() && selectedLayer()?.states?.[curKey()]?.[def.id] !== undefined }
  );
}

function editingBadge() {
  if (editingBase()) return el('div', { class: 'badge base' }, ['🔒 Editing the ', el('b', {}, 'Lock screen'), ' (base values)']);
  const s = STATES.find((x) => x.id === store.view.state);
  return el('div', { class: 'badge state' }, [`${s.icon} Editing `, el('b', {}, `${s.name}${darkActive() ? ' · Dark' : ''}`), ' – position, scale, rotation & opacity are stored for this state and animate when swiping.']);
}

function stylePanel() {
  const l = selectedLayer();
  if (!l) return [el('p', { class: 'empty big' }, 'Select a layer on the canvas or in Layers.')];
  const p = store.project;
  return [
    editingBadge(),
    section('Layer', [
      textField('Name', () => selectedLayer().name, (v) => L((x) => (x.name = v), g('name'))),
      el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Depth'), segmented(PLANES.map((pl) => [pl.id, pl.short, pl.name]), () => selectedLayer()?.plane, (v) => L((x) => (x.plane = v)))]),
      el('div', { class: 'btn-row' }, [button('Duplicate', () => A.duplicateLayer(l.id)), button('To front', () => A.moveLayer(l.id, 'top')), button('To back', () => A.moveLayer(l.id, 'bottom')), button('Delete', () => A.deleteLayer(l.id), 'danger')]),
    ]),
    section('Transform', [
      animField(ANIMATABLE[1], 'X', { unit: 'pt' }),
      animField(ANIMATABLE[2], 'Y', { unit: 'pt' }),
      numField('Width', () => selectedLayer().w, (v) => L((x) => (x.w = Math.max(1, v)), g('w')), { min: 1, unit: 'pt' }),
      numField('Height', () => selectedLayer().h, (v) => L((x) => (x.h = Math.max(1, v)), g('h')), { min: 1, unit: 'pt' }),
      animField(ANIMATABLE[3], 'Scale', { slider: true, min: 0, max: 3 }),
      animField(ANIMATABLE[4], 'Rotation', { slider: true, min: -180, max: 180, unit: '°' }),
      animField(ANIMATABLE[0], 'Opacity', { slider: true, min: 0, max: 1 }),
      el('div', { class: 'align-row' }, [
        ['left', '⇤', 'Align left'], ['hcenter', '↔', 'Center horizontally'], ['right', '⇥', 'Align right'],
        ['top', '⤒', 'Align top'], ['vcenter', '↕', 'Center vertically'], ['bottom', '⤓', 'Align bottom'], ['fill', '⛶', 'Fill screen'],
      ].map(([k, t, label]) => iconBtn(t, label, () => A.align(l.id, k), 'align'))),
    ]),
    section(`${KINDS[l.kind].icon} ${KINDS[l.kind].name}`, kindFields(l, p)),
    section('Appearance', [
      selectField('Blend', BLEND_MODES, () => selectedLayer().blend || 'normal', (v) => L((x) => (x.blend = v))),
      numField('Corner radius', () => selectedLayer().cornerRadius, (v) => L((x) => (x.cornerRadius = Math.max(0, v)), g('cr')), { min: 0, max: 400, slider: true, unit: 'pt' }),
      numField('Blur', () => selectedLayer().filters?.blur || 0, (v) => L((x) => (x.filters = { ...x.filters, blur: v }), g('fb')), { min: 0, max: 60, slider: true, unit: 'pt' }),
      numField('Hue', () => selectedLayer().filters?.hue || 0, (v) => L((x) => (x.filters = { ...x.filters, hue: v }), g('fh')), { min: -180, max: 180, slider: true, unit: '°' }),
      numField('Saturation', () => selectedLayer().filters?.saturate ?? 1, (v) => L((x) => (x.filters = { ...x.filters, saturate: v }), g('fs')), { min: 0, max: 3, step: 0.05, slider: true }),
      numField('Contrast', () => selectedLayer().filters?.contrast ?? 1, (v) => L((x) => (x.filters = { ...x.filters, contrast: v }), g('fc')), { min: 0, max: 3, step: 0.05, slider: true }),
      button('Reset filters', () => L((x) => ((x.filters = { blur: 0, hue: 0, saturate: 1, contrast: 1 }), (x.blend = 'normal'))), 'subtle'),
    ]),
    section('Nugget template', [toggleField('Customizable in Nugget', () => selectedLayer().nuggetOption, (v) => L((x) => (x.nuggetOption = v)), 'In a .batter export: swap image, opacity slider, hide toggle')], { closed: true }),
  ];
}

function kindFields(l, p) {
  const f = [];
  const fitField = () => el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Fit'), segmented([['cover', 'Fill'], ['contain', 'Fit'], ['stretch', 'Stretch']], () => selectedLayer().fit, (v) => L((x) => (x.fit = v)))]);
  switch (l.kind) {
    case 'image':
      f.push(button('Replace image…', () => A.replaceImage(l.id), 'primary'), fitField());
      break;
    case 'color':
      f.push(colorField('Color', () => selectedLayer().color, (v) => L((x) => (x.color = v), g('color'))));
      break;
    case 'gradient': {
      const gr = () => selectedLayer().gradient;
      f.push(
        el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Type'), segmented([['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']], () => gr().type, (v) => L((x) => (x.gradient.type = v)))]),
        numField('Angle', () => gr().angle, (v) => L((x) => (x.gradient.angle = v), g('ga')), { min: 0, max: 360, slider: true, unit: '°' })
      );
      gr().stops.forEach((s, i) => {
        f.push(
          el('div', { class: 'stop-row' }, [
            colorField(`Color ${i + 1}`, () => gr().stops[i]?.c, (v) => L((x) => (x.gradient.stops[i].c = v), g(`gc${i}`))),
            numField('Position', () => gr().stops[i]?.p, (v) => L((x) => (x.gradient.stops[i].p = v), g(`gp${i}`)), { min: 0, max: 1, step: 0.01, slider: true }),
            gr().stops.length > 2 ? iconBtn('✕', 'Remove color', () => L((x) => x.gradient.stops.splice(i, 1))) : null,
          ])
        );
      });
      f.push(button('+ Color stop', () => L((x) => x.gradient.stops.push({ c: '#ffffff', p: 1 }))));
      break;
    }
    case 'text': {
      const t = () => selectedLayer().text;
      const T = (k, parse = (v) => v) => (v) => L((x) => (x.text = { ...x.text, [k]: parse(v) }), g(`t${k}`));
      f.push(
        textField('Text', () => t().content, T('content'), { multiline: true }),
        selectField('Font', [
          ['system-ui', 'SF Pro'], ['ui-rounded, system-ui', 'SF Pro Rounded'], ['ui-serif, Georgia, serif', 'New York'], ['ui-monospace, Menlo, monospace', 'SF Mono'],
          ['"Avenir Next", Avenir, system-ui', 'Avenir Next'], ['Didot, "Bodoni 72", serif', 'Didot'], ['"Snell Roundhand", cursive', 'Snell Roundhand'],
          ['"Marker Felt", "Comic Sans MS", cursive', 'Marker Felt'], ['Futura, system-ui', 'Futura'], ['Impact, "Arial Black", sans-serif', 'Impact'],
        ], () => t().font, T('font')),
        el('div', { class: 'btn-row' }, [
          button(t().fontAsset ? `Custom font: ${t().fontName || 'loaded'}` : 'Upload font (TTF/OTF)…', () => A.uploadFont(l.id)),
          t().fontAsset ? button('Remove', () => L((x) => (x.text = { ...x.text, fontAsset: null, fontName: null }))) : null,
        ]),
        numField('Size', () => t().size, T('size', Number), { min: 4, max: 400, slider: true, unit: 'pt' }),
        selectField('Weight', [[100, 'Ultralight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Heavy'], [900, 'Black']], () => t().weight, T('weight', Number)),
        colorField('Color', () => t().color, T('color')),
        el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Align'), segmented([['left', 'Left'], ['center', 'Center'], ['right', 'Right']], () => t().align, T('align'))]),
        numField('Line height', () => t().lineHeight, T('lineHeight', Number), { min: 0.6, max: 3, step: 0.05, slider: true }),
        numField('Tracking', () => t().letterSpacing, T('letterSpacing', Number), { min: -10, max: 40, step: 0.5, slider: true, unit: 'pt' }),
        numField('Shadow', () => t().shadow, T('shadow', Number), { min: 0, max: 1, step: 0.05, slider: true }),
        toggleField('Italic', () => t().italic, T('italic'))
      );
      break;
    }
    case 'shape': {
      const s = () => selectedLayer().shape;
      const S = (k, parse = (v) => v) => (v) => L((x) => (x.shape = { ...x.shape, [k]: parse(v) }), g(`s${k}`));
      f.push(
        el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Shape'), segmented([['ellipse', '●'], ['rect', '■'], ['rounded', '▢'], ['star', '★'], ['polygon', '⬢'], ['heart', '♥'], ['ring', '◯']], () => s().type, S('type'))]),
        colorField('Fill', () => s().fill, S('fill')),
        numField('Stroke', () => s().strokeWidth, S('strokeWidth', Number), { min: 0, max: 60, slider: true, unit: 'pt' }),
        colorField('Stroke color', () => s().stroke, S('stroke')),
        ['star', 'polygon'].includes(s().type) ? numField('Points', () => s().points, S('points', Number), { min: 3, max: 24, slider: true }) : null,
        numField('Softness', () => s().blur, S('blur', Number), { min: 0, max: 60, slider: true, unit: 'pt' })
      );
      break;
    }
    case 'video': {
      const v = () => selectedLayer().video;
      const V = (k, parse = (x) => x) => (val) => L((x) => (x.video = { ...x.video, [k]: parse(val) }), g(`v${k}`));
      const playLen = (v().sequence?.length || v().frames.length) / (v().fps || 24);
      f.push(
        el('p', { class: 'muted' }, `${v().frames.length} frames · ${playLen.toFixed(1)} s${v().gif ? ' · from GIF' : ''}`),
        numField('Frame rate', () => v().fps, V('fps', Number), { min: 1, max: 60, unit: 'fps' }),
        toggleField('Boomerang', () => v().autoreverse, V('autoreverse')),
        selectField('Frame change', [['discrete', 'Cut (like video)'], ['linear', 'Crossfade']], () => v().calc, V('calc')),
        fitField(),
        button('Replace video / GIF…', () => A.addVideo(l.id))
      );
      break;
    }
    case 'glass': {
      const gl = () => selectedLayer().glass;
      const G = (k, parse = Number) => (val) => L((x) => (x.glass = { ...x.glass, [k]: parse(val) }), g(`g${k}`));
      f.push(
        el('div', { class: 'field' }, [
          el('span', { class: 'field-label' }, 'Mode'),
          segmented([['frosted', 'Frosted', 'Baked blur – works on every iOS'], ['liquid', 'Liquid Glass', 'iOS 26+ refraction (CABackdropLayer + SDF)'], ['live', 'Live blur', 'CABackdropLayer blur – experimental']], () => gl().mode, G('mode', String)),
        ]),
        el('p', { class: 'muted' }, {
          frosted: 'Frosted: the layers behind are blurred into the image at export – reliable everywhere, but it won’t follow layers that move behind it.',
          liquid: 'Liquid Glass: Apple’s iOS 26 refraction effect via CABackdropLayer + CASDFGlassDisplacementEffect (as exported by CAPlayground). Live on device, experimental.',
          live: 'Live blur: CABackdropLayer with a gaussian blur filter. Follows content live; experimental on device.',
        }[gl().mode]),
        numField('Corner radius', () => selectedLayer().cornerRadius, (v) => L((x) => (x.cornerRadius = Math.max(0, v)), g('gcr')), { min: 0, max: 300, slider: true, unit: 'pt' }),
        gl().mode !== 'liquid' ? numField('Blur', () => gl().blur, G('blur'), { min: 0, max: 80, slider: true, unit: 'pt' }) : numField('Refraction', () => gl().refraction ?? 80, G('refraction'), { min: 0, max: 200, slider: true }),
        numField('Saturation', () => gl().saturation, G('saturation'), { min: 0, max: 3, step: 0.05, slider: true }),
        colorField('Tint', () => gl().tint, G('tint', String)),
        numField('Tint amount', () => gl().tintOpacity, G('tintOpacity'), { min: 0, max: 1, step: 0.01, slider: true }),
        numField('Rim light', () => gl().border, G('border'), { min: 0, max: 1, step: 0.05, slider: true }),
        numField('Shine', () => gl().shine, G('shine'), { min: 0, max: 1, step: 0.05, slider: true })
      );
      break;
    }
    case 'emitter': {
      const e = () => selectedLayer().emitter;
      const E = (k, parse = Number) => (val) => L((x) => (x.emitter = { ...x.emitter, [k]: parse(val) }), g(`e${k}`));
      f.push(
        el('p', { class: 'warn-note' }, 'Experimental: CAEmitterLayer renders on device but is barely tested by the community – and particles keep the screen redrawing (battery).'),
        selectField('Preset', Object.entries(EMITTER_PRESETS).map(([k, v]) => [k, v.name]), () => e().preset, (k) => L((x) => (x.emitter = { preset: k, ...EMITTER_PRESETS[k], particleAsset: x.emitter.particleAsset }))),
        selectField('Particle', [['dot', 'Soft dot'], ['star', 'Star'], ['streak', 'Streak'], ['ring', 'Bubble'], ['petal', 'Petal'], ['square', 'Confetti']], () => e().particle, E('particle', String)),
        el('div', { class: 'btn-row' }, [
          button(e().particleAsset ? 'Custom particle ✓' : 'Custom particle image…', () => A.uploadParticle(l.id)),
          e().particleAsset ? button('Remove', () => L((x) => (x.emitter = { ...x.emitter, particleAsset: null }))) : null,
        ]),
        colorField('Color', () => e().color, E('color', String)),
        toggleField('Glow (additive)', () => e().additive, E('additive', Boolean)),
        selectField('Source', [['line', 'Edge (line)'], ['rectangle', 'Area']], () => e().shape, E('shape', String)),
        numField('Birth rate', () => e().birthRate, E('birthRate'), { min: 0, max: 200, slider: true, unit: '/s' }),
        numField('Lifetime', () => e().lifetime, E('lifetime'), { min: 0.2, max: 40, step: 0.1, slider: true, unit: 's' }),
        numField('Size', () => e().size, E('size'), { min: 2, max: 120, slider: true, unit: 'pt' }),
        numField('Size variance', () => e().scaleRange, E('scaleRange'), { min: 0, max: 2, step: 0.05, slider: true }),
        numField('Speed', () => e().velocity, E('velocity'), { min: 0, max: 1000, slider: true }),
        numField('Speed variance', () => e().velocityRange, E('velocityRange'), { min: 0, max: 500, slider: true }),
        numField('Direction', () => e().emissionLongitude, E('emissionLongitude'), { min: -180, max: 180, slider: true, unit: '°' }),
        numField('Spread', () => e().emissionRange, E('emissionRange'), { min: 0, max: 360, slider: true, unit: '°' }),
        numField('Gravity', () => e().yAcceleration, E('yAcceleration'), { min: -400, max: 400, slider: true }),
        numField('Wind', () => e().xAcceleration, E('xAcceleration'), { min: -200, max: 200, slider: true }),
        numField('Spin', () => e().spin, E('spin'), { min: -6, max: 6, step: 0.1, slider: true }),
        numField('Fade / s', () => e().alphaSpeed, E('alphaSpeed'), { min: -1, max: 0, step: 0.01, slider: true })
      );
      break;
    }
  }
  if (!['image', 'video', 'glass', 'emitter'].includes(l.kind)) {
    f.push(
      button('Convert to photo…', async () => {
        const id = store.selection;
        if (await A.replaceImage(id)) L((x) => ((x.kind = 'image'), (x.fit = 'cover')));
        else toast('No image chosen', 'info');
      }, 'subtle')
    );
  }
  void p;
  return f;
}

// ---------------------------------------------------------------- Motion

const RECIPES = [
  ['Fade in on unlock', (l) => ((l.opacity = 0), (l.states.Unlock = { ...l.states.Unlock, opacity: 1 }))],
  ['Fade out on unlock', (l) => (l.states.Unlock = { ...l.states.Unlock, opacity: 0 })],
  ['Zoom in on unlock', (l) => (l.states.Unlock = { ...l.states.Unlock, scale: 1.25 })],
  ['Shrink away on unlock', (l) => (l.states.Unlock = { ...l.states.Unlock, scale: 0.6, opacity: 0 })],
  ['Slide up on unlock', (l, p) => (l.states.Unlock = { ...l.states.Unlock, y: l.y - p._h * 0.3 })],
  ['Slide down on unlock', (l, p) => (l.states.Unlock = { ...l.states.Unlock, y: l.y + p._h * 0.3 })],
  ['Fly off left', (l, p) => (l.states.Unlock = { ...l.states.Unlock, x: -l.w })],
  ['Fly in from right', (l, p) => ((l.states.Unlock = { ...l.states.Unlock, x: l.x }), (l.x = p._w + l.w))],
  ['Spin on unlock', (l) => (l.states.Unlock = { ...l.states.Unlock, rotation: (l.rotation || 0) + 180 })],
  ['Push background in', (l) => (l.states.Unlock = { ...l.states.Unlock, scale: 1.08 })],
  ['Dim in Always-On', (l) => (l.states.Sleep = { ...l.states.Sleep, opacity: 0.25 })],
  ['Hide in Always-On', (l) => (l.states.Sleep = { ...l.states.Sleep, opacity: 0 })],
  ['Sink in Always-On', (l, p) => (l.states.Sleep = { ...l.states.Sleep, y: l.y + p._h * 0.12, scale: 0.9 })],
  ['Only on Home screen', (l) => ((l.opacity = 0), (l.states.Unlock = { ...l.states.Unlock, opacity: 1 }), (l.states.Sleep = { ...l.states.Sleep, opacity: 0 }))],
];

function motionPanel() {
  const l = selectedLayer();
  if (!l) return [el('p', { class: 'empty big' }, 'Select a layer first.')];
  const p = store.project;
  const modern = p.format !== 'classic';
  const out = [];

  out.push(
    section('Swipe effects', [
      el('p', { class: 'muted' }, modern
        ? 'Modern format: values move with your finger while swiping up (and back when pulling down). Try it with ▶ Preview.'
        : 'Classic format: after the swipe completes, values spring to the new state.'),
      el('div', { class: 'chip-grid' }, RECIPES.map(([name, fn]) => el('button', { type: 'button', class: 'chip', onclick: () => update((proj) => fn(proj.layers.find((x) => x.id === l.id), proj)) }, name))),
    ])
  );

  const keys = [...STATES.map((s) => s.id), ...(p.appearanceAware && !modern ? STATES.map((s) => `${s.id}@dark`) : [])];
  const rows = keys.map((k) => {
    const [sid, dark] = k.split('@');
    const s = STATES.find((x) => x.id === sid);
    const ov = l.states[k] || {};
    const chips = k === 'Locked'
      ? [el('small', { class: 'muted' }, 'base values')]
      : Object.keys(ov).length
        ? Object.entries(ov).map(([prop, v]) => el('span', { class: 'ov-chip' }, [
            `${ANIMATABLE.find((a) => a.id === prop)?.name || prop} ${Math.round(v * 100) / 100}`,
            el('button', { type: 'button', class: 'x', 'aria-label': 'Remove', onclick: () => update((pp) => { const ll = pp.layers.find((x) => x.id === l.id); delete ll.states[k][prop]; if (!Object.keys(ll.states[k]).length) delete ll.states[k]; }) }, '×'),
          ]))
        : [el('small', { class: 'muted' }, sid === 'Sleep' ? 'same as Lock' : 'same as Lock (no motion)')];
    const active = store.view.state === sid && !!dark === darkActive();
    return el('div', { class: `state-row ${active ? 'on' : ''}` }, [
      el('button', { type: 'button', class: 'state-name', onclick: () => setView({ state: sid, dark: !!dark, progress: sid === 'Unlock' ? 1 : 0 }) }, `${s.icon} ${s.name}${dark ? ' · Dark' : ''}`),
      el('div', { class: 'state-vals' }, chips),
    ]);
  });
  out.push(
    section('States', [
      el('p', { class: 'muted' }, 'Pick a state, then drag / scale / rotate the layer on the canvas. PosterBoard switches states itself: Lock, Home (after unlocking) and Always-On.'),
      ...rows,
      Object.keys(l.states).length ? button('Reset all states of this layer', () => update((pp) => (pp.layers.find((x) => x.id === l.id).states = {})), 'danger subtle') : null,
    ])
  );

  if (modern) {
    out.push(
      section('Gyro parallax', [
        numField('Depth', () => selectedLayer().parallax || 0, (v) => L((x) => (x.parallax = Math.max(0, v)), g('px')), { min: 0, max: 60, slider: true, unit: 'pt' }),
        el('p', { class: 'muted' }, 'How far the layer shifts when the phone tilts. Far: 4–8 · middle: 10–14 · near: 20–40. Keep nearer layers at higher values. Tilt the preview with your mouse or enable motion in ▶ Preview.'),
      ])
    );
  } else {
    const tr = () => selectedLayer().transition;
    out.push(
      section('Spring transition', [
        toggleField('Custom transition for this layer', () => !!tr(), (v) => L((x) => (x.transition = v ? { ...p.transition } : null))),
        ...(tr() ? transitionFields(() => selectedLayer().transition, (fn) => L((x) => fn(x.transition), g('tr'))) : [el('p', { class: 'muted' }, `Uses the project transition: ${TRANSITION_PRESETS[p.transition.preset]?.name || 'custom spring'}`)]),
      ])
    );
  }

  // animations
  const anims = l.anims || [];
  out.push(
    section(`Animations (${anims.length})`, [
      hasLoops(l) ? el('p', { class: 'warn-note' }, '🔋 Endless animations keep the lock screen redrawing (~30% vs ~4% CPU idle, measured on device). For battery-friendly wallpapers use swipe effects instead, or “Play once”.') : null,
      ...anims.map((a, i) => animCard(l, a, i)),
      el('div', { class: 'chip-grid' }, Object.entries(ANIM_PRESETS).map(([k, v]) => el('button', { type: 'button', class: 'chip add', 'data-anim': k, onclick: () => A.addAnimation(l.id, k) }, `+ ${v.name}`))),
    ])
  );
  return out;
}

function animCard(layer, a, i) {
  const A_ = (fn, grp) => update((p) => {
    const an = p.layers.find((x) => x.id === layer.id).anims.find((x) => x.id === a.id);
    fn(an);
  }, grp);
  const get = () => selectedLayer()?.anims.find((x) => x.id === a.id) || a;
  const preset = ANIM_PRESETS[a.preset] || ANIM_PRESETS.custom;
  const card = el('div', { class: `anim-card ${a.enabled === false ? 'off' : ''}` }, [
    el('div', { class: 'anim-head' }, [
      el('b', {}, `${i + 1}. ${preset.name}`),
      el('span', { class: 'row-actions' }, [
        iconBtn(a.enabled === false ? '◌' : '●', a.enabled === false ? 'Enable' : 'Disable', () => A_((x) => (x.enabled = x.enabled === false))),
        iconBtn('↑', 'Move up', () => update((p) => { const arr = p.layers.find((x) => x.id === layer.id).anims; if (i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; })),
        iconBtn('✕', 'Remove', () => update((p) => { const ll = p.layers.find((x) => x.id === layer.id); ll.anims = ll.anims.filter((x) => x.id !== a.id); })),
      ]),
    ]),
    a.preset === 'custom'
      ? selectField('Property', ANIM_PROPS, () => get().prop, (v) => A_((x) => (x.prop = v)))
      : numField(preset.label || 'Amount', () => get().amount, (v) => A_((x) => ((x.amount = v), rebuildAnim(x)), `am${a.id}`), { min: a.prop === 'rotation' && a.preset === 'spin' ? -10 : 0, max: a.preset === 'spin' ? 10 : 200, step: a.preset === 'spin' ? 1 : 1, slider: true }),
    numField('Duration', () => get().duration, (v) => A_((x) => (x.duration = Math.max(0.05, v)), `du${a.id}`), { min: 0.1, max: 60, step: 0.1, slider: true, unit: 's' }),
    numField(a.repeat === 'once' ? 'Delay' : 'Phase offset', () => get().delay || 0, (v) => A_((x) => (x.delay = Math.max(0, v)), `de${a.id}`), { min: 0, max: 30, step: 0.1, slider: true, unit: 's' }),
    selectField('Easing', EASINGS, () => get().easing, (v) => A_((x) => (x.easing = v))),
    el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Repeat'), segmented([['loop', 'Loop forever'], ['once', 'Play once']], () => get().repeat, (v) => A_((x) => (x.repeat = v)))]),
    toggleField('Back & forth', () => get().autoreverse, (v) => A_((x) => (x.autoreverse = v))),
  ]);
  // keyframe editor
  const kf = el('div', { class: 'kf' }, [el('div', { class: 'kf-head' }, [el('span', {}, 'Time'), el('span', {}, ANIM_PROPS.find((x) => x[0] === a.prop)?.[1] || 'Value'), el('span')])]);
  a.keys.forEach((k, ki) => {
    const tIn = el('input', { type: 'number', class: 'num', step: 0.01, min: 0, max: 1, value: k.t });
    const vIn = el('input', { type: 'number', class: 'num', step: a.prop === 'scale' || a.prop === 'opacity' ? 0.01 : 1, value: Math.round(k.v * 1000) / 1000 });
    const setK = () => A_((x) => {
      x.preset = 'custom';
      x.keys[ki] = { t: Math.max(0, Math.min(1, Number(tIn.value) || 0)), v: Number(vIn.value) || 0 };
    }, `kf${a.id}${ki}`);
    tIn.addEventListener('change', setK);
    vIn.addEventListener('change', setK);
    kf.append(el('div', { class: 'kf-row' }, [tIn, vIn, a.keys.length > 2 ? iconBtn('✕', 'Remove keyframe', () => A_((x) => ((x.preset = 'custom'), x.keys.splice(ki, 1)))) : el('span')]));
  });
  kf.append(button('+ Keyframe', () => A_((x) => {
    x.preset = 'custom';
    const last = x.keys[x.keys.length - 1];
    x.keys.push({ t: 1, v: last?.v ?? 0 });
    x.keys.sort((p, q) => p.t - q.t);
  }), 'subtle'));
  card.append(el('details', { class: 'kf-wrap' }, [el('summary', {}, `Keyframes (${a.keys.length})`), kf]));
  return card;
}

function transitionFields(get, set) {
  const t = get();
  return [
    selectField('Style', [...Object.entries(TRANSITION_PRESETS).map(([k, v]) => [k, v.name]), ['custom', 'Custom spring…']], () => get().preset || 'custom', (k) => set((tt) => Object.assign(tt, k === 'custom' ? { preset: 'custom', type: 'spring' } : { ...TRANSITION_PRESETS[k], preset: k }))),
    ...(t.type === 'spring' && t.preset === 'custom'
      ? [
          numField('Damping', () => get().damping, (v) => set((tt) => (tt.damping = v)), { min: 1, max: 200, slider: true }),
          numField('Mass', () => get().mass, (v) => set((tt) => (tt.mass = v)), { min: 0.1, max: 10, step: 0.1, slider: true }),
          numField('Stiffness', () => get().stiffness, (v) => set((tt) => (tt.stiffness = v)), { min: 10, max: 1000, slider: true }),
        ]
      : []),
    t.type === 'basic' ? numField('Duration', () => get().duration, (v) => set((tt) => (tt.duration = v)), { min: 0.05, max: 5, step: 0.05, slider: true, unit: 's' }) : null,
  ];
}

// ---------------------------------------------------------------- Project

function projectPanel() {
  const p = store.project;
  const P = (fn, grp) => update(fn, grp);
  const issues = validateProject(p);
  const modern = p.format !== 'classic';
  return [
    section('Wallpaper', [
      textField('Name', () => store.project.name, (v) => P((pp) => (pp.name = v), 'pname')),
      selectField('Device', DEVICES.map((x) => [x.id, `${x.name} · ${x.w}×${x.h}`]), () => store.project.device, (v) => A.changeDevice(v)),
      el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Format'), segmented([['modern', 'Modern · iOS 26/27'], ['classic', 'Classic · iOS 17+']], () => store.project.format || 'modern', (v) => P((pp) => (pp.format = v)))]),
      el('p', { class: 'muted' }, modern
        ? 'ParameterizedCA: one bundle with Lock/Home/Always-On values that follow your finger, gyro parallax and the iOS 27 depth fix. Recommended for iOS 26 and 27.'
        : 'LayeredAnimation: three bundles with spring transitions and optional Light/Dark states. Loses gyro on iOS 27.'),
      !modern ? toggleField('Light / Dark variants', () => store.project.appearanceAware, (v) => P((pp) => (pp.appearanceAware = v)), 'Adds Locked/Unlock/Sleep Light & Dark states') : null,
    ]),
    !modern ? section('Default spring', transitionFields(() => store.project.transition, (fn) => P((pp) => fn(pp.transition), 'ptr'))) : null,
    section('Checks', [issues.length ? el('ul', { class: 'issues' }, issues.map((i) => el('li', { class: `issue-${i.level}` }, i.msg))) : el('p', { class: 'ok-note' }, '✓ Ready to export')]),
    section('Export & import', [
      button('⬇︎ Export…', () => A.openExport(), 'primary wide'),
      button('Import .tendies to edit…', () => A.importTendiesFile(), 'wide'),
      el('p', { class: 'muted' }, 'Collections: open the Library (☰), tick several wallpapers → “Export as collection”.'),
    ]),
    section('Install on iPhone', [installGuide()], { closed: true }),
    section('App', [button('Settings (GIF search keys)…', () => A.openSettings(), 'wide')], { closed: true }),
  ].filter(Boolean);
}

export function installGuide() {
  return el('div', { class: 'guide' }, [
    el('ol', {}, [
      el('li', {}, [el('b', {}, 'Export: '), 'tap Export – on iPhone the share sheet opens (save to Files or send straight to an installer app).']),
      el('li', {}, [el('b', {}, 'iOS 26 / 27 on-device: '), 'Placard, Pocket Poster or AirCard (use the AirCard “Depth Test” build for iOS 27 depth). Import the .tendies and apply.']),
      el('li', {}, [el('b', {}, 'With a computer: '), 'Nugget / GoldenNugget → Posterboard → add .tendies → Apply.']),
      el('li', {}, [el('b', {}, 'Activate: '), 'long-press the lock screen → + → Collections → your wallpaper.']),
    ]),
    el('p', { class: 'muted' }, 'Custom PosterBoard wallpapers are not an official Apple feature – which installer works depends on your iOS version and the currently available exploit. If something looks wrong, reset collections in your installer and apply again.'),
  ]);
}
