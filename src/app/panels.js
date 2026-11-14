// Side panels: Layers, Properties, Motion, Project.
import { store, update, select, selectedLayer, subscribe, setView } from './store.js';
import { PLANES, STATES, KINDS, LOOPS, TRANSITION_PRESETS, EMITTER_PRESETS, ANIMATABLE, stateKey, effective } from '../core/model.js';
import { DEVICES, screenClass, getDevice } from '../core/devices.js';
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
    const key = `${store.view.tab}|${store.selection}|${l?.kind}|${store.project?.id}|${store.project?.appearanceAware}|${l?.loop?.type}|${l?.text?.fontAsset}|${!!l?.transition}|${l?.gradient?.stops?.length}|${l?.shape?.type}|${l?.emitter?.preset}|${store.project?.layers.length}`;
    const structural = ['project', 'history', 'select'].includes(reason) || key !== lastKey;
    const layersTab = store.view.tab === 'layers' && reason === 'edit';
    if (structural || layersTab || (reason === 'view' && store.view.tab === 'motion')) {
      lastKey = key;
      render();
    } else runSyncs();
  });
  render();
}

function tabs() {
  const t = [
    ['layers', 'Ebenen'],
    ['props', 'Eigenschaften'],
    ['motion', 'Bewegung'],
    ['project', 'Projekt'],
  ];
  return el(
    'nav',
    { class: 'tabs', role: 'tablist' },
    t.map(([id, name]) =>
      el('button', { type: 'button', role: 'tab', class: `tab ${store.view.tab === id ? 'on' : ''}`, 'aria-selected': String(store.view.tab === id), onclick: () => setView({ tab: id }) }, name)
    )
  );
}

function render() {
  if (!host || !store.project) return;
  resetSyncs();
  const scroll = host.querySelector('.panel-body')?.scrollTop || 0;
  host.innerHTML = '';
  const body = el('div', { class: 'panel-body' });
  const tab = store.view.tab;
  if (tab === 'layers') body.append(...layersPanel());
  else if (tab === 'props') body.append(...propsPanel());
  else if (tab === 'motion') body.append(...motionPanel());
  else body.append(...projectPanel());
  host.append(tabs(), body);
  body.scrollTop = scroll;
}

// ---------------------------------------------------------------- layers

const ADD = [
  ['image', '🖼️', 'Bild', () => A.addImages()],
  ['video', '🎞️', 'Video', () => A.addVideo()],
  ['text', '🔤', 'Text', () => A.addLayer('text', { plane: 'foreground' })],
  ['gradient', '🌈', 'Verlauf', () => A.addLayer('gradient')],
  ['color', '🎨', 'Farbe', () => A.addLayer('color')],
  ['shape', '⬟', 'Form', () => A.addLayer('shape', { plane: 'floating' })],
  ['emitter', '❄️', 'Partikel', () => A.addLayer('emitter')],
  ['frames', '🧩', 'Bildfolge', () => A.addFrameSequence()],
];

function layersPanel() {
  const p = store.project;
  const add = el('div', { class: 'add-grid' }, ADD.map(([k, i, n, fn]) => el('button', { type: 'button', class: 'add-btn', 'data-add': k, onclick: fn }, [el('span', { class: 'add-ico' }, i), n])));
  const lists = [...PLANES].reverse().map((plane) => {
    const layers = p.layers.filter((l) => l.plane === plane.id).reverse();
    return el('div', { class: 'plane-group' }, [
      el('div', { class: 'plane-head' }, [el('b', {}, plane.name), el('small', {}, plane.hint)]),
      layers.length
        ? el('ul', { class: 'layer-list' }, layers.map((l) => layerRow(l)))
        : el('p', { class: 'empty' }, 'Keine Ebenen'),
    ]);
  });
  return [add, ...lists, el('p', { class: 'hint' }, 'Tipp: Mehrmals auf dieselbe Stelle tippen wählt die Ebene darunter. Ebenen weiter oben in der Liste liegen vorne.')];
}

function layerRow(l) {
  const thumb = el('span', { class: 'thumb' }, KINDS[l.kind]?.icon);
  if (['image', 'gradient', 'video', 'color', 'shape'].includes(l.kind)) {
    layerBitmapURL(l).then((u) => {
      if (u) {
        thumb.textContent = '';
        thumb.style.backgroundImage = `url("${u}")`;
      }
    });
  }
  const hasStates = Object.keys(l.states || {}).length > 0;
  const hasLoop = l.loop?.type && l.loop.type !== 'none';
  return el('li', { class: `layer-row ${l.id === store.selection ? 'on' : ''} ${l.hidden ? 'is-hidden' : ''}`, 'data-id': l.id, onclick: () => select(l.id) }, [
    thumb,
    el('span', { class: 'lname' }, [l.name, el('small', {}, [KINDS[l.kind]?.name, hasStates ? ' · Zustände' : '', hasLoop ? ' · Loop' : ''])]),
    el('span', { class: 'row-actions' }, [
      iconBtn(l.hidden ? '🙈' : '👁', 'Sichtbarkeit', () => update((p) => (p.layers.find((x) => x.id === l.id).hidden = !l.hidden))),
      iconBtn(l.locked ? '🔒' : '🔓', 'Sperren', () => update((p) => (p.layers.find((x) => x.id === l.id).locked = !l.locked))),
      iconBtn('▲', 'Nach vorne', () => A.moveLayer(l.id, 1)),
      iconBtn('▼', 'Nach hinten', () => A.moveLayer(l.id, -1)),
    ]),
  ]);
}

function iconBtn(t, label, fn) {
  return el('button', { type: 'button', class: 'icon-btn', title: label, 'aria-label': label, onclick: (e) => (e.stopPropagation(), fn()) }, t);
}

// ---------------------------------------------------------------- properties

/** mutate the selected layer */
const L = (fn, group) => update((p) => fn(p.layers.find((l) => l.id === store.selection), p), group);
const g = (k) => `${store.selection}:${k}`;

/** animatable value aware of the edited state */
function animField(def, label, o = {}) {
  const editingBase = () => store.view.state === 'Locked' && !(store.project.appearanceAware && store.view.dark);
  const key = () => stateKey(store.view.state, store.project.appearanceAware && store.view.dark);
  return numField(
    label,
    () => effective(selectedLayer(), store.view.state, store.project.appearanceAware && store.view.dark)[def.id],
    (v) =>
      L((l) => {
        if (editingBase()) l[def.id] = v;
        else l.states[key()] = { ...(l.states[key()] || {}), [def.id]: v };
      }, g(def.id)),
    { ...o, step: def.step, min: def.min, max: def.max, isOverride: () => !editingBase() && selectedLayer()?.states?.[key()]?.[def.id] !== undefined }
  );
}

function editingBadge() {
  const v = store.view;
  const dark = store.project.appearanceAware && v.dark;
  if (v.state === 'Locked' && !dark) return el('div', { class: 'badge base' }, '✏️ Du bearbeitest die Grundwerte (Gesperrt)');
  const s = STATES.find((x) => x.id === v.state);
  return el('div', { class: 'badge state' }, [`✏️ Du bearbeitest den Zustand ${s.icon} ${s.name}${dark ? ' 🌙 Dunkel' : ''} – Position, Größe, Deckkraft & Drehung werden dort gespeichert.`]);
}

function propsPanel() {
  const l = selectedLayer();
  if (!l) return [el('p', { class: 'empty big' }, 'Wähle eine Ebene in der Vorschau oder unter „Ebenen“.')];
  const p = store.project;
  const out = [];
  out.push(editingBadge());
  out.push(
    section('Ebene', [
      textField('Name', () => l.name, (v) => L((x) => (x.name = v), g('name'))),
      el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Tiefe'), segmented(PLANES.map((pl) => [pl.id, pl.name, pl.hint]), () => selectedLayer()?.plane, (v) => L((x) => (x.plane = v)))]),
      el('div', { class: 'btn-row' }, [
        button('Duplizieren', () => A.duplicateLayer(l.id)),
        button('Löschen', () => A.deleteLayer(l.id), 'danger'),
      ]),
    ])
  );
  out.push(
    section('Position & Größe', [
      animField(ANIMATABLE[1], 'X', { unit: 'pt' }),
      animField(ANIMATABLE[2], 'Y', { unit: 'pt' }),
      numField('Breite', () => selectedLayer().w, (v) => L((x) => (x.w = Math.max(1, v)), g('w')), { min: 1, unit: 'pt' }),
      numField('Höhe', () => selectedLayer().h, (v) => L((x) => (x.h = Math.max(1, v)), g('h')), { min: 1, unit: 'pt' }),
      animField(ANIMATABLE[3], 'Skalierung', { slider: true, min: 0, max: 3 }),
      animField(ANIMATABLE[4], 'Drehung', { slider: true, min: -180, max: 180, unit: '°' }),
      animField(ANIMATABLE[0], 'Deckkraft', { slider: true, min: 0, max: 1 }),
      numField('Eckenradius', () => selectedLayer().cornerRadius, (v) => L((x) => (x.cornerRadius = Math.max(0, v)), g('cr')), { min: 0, max: 400, slider: true, unit: 'pt' }),
      el('div', { class: 'btn-row' }, [
        button('Vollbild', () => L((x) => Object.assign(x, { x: p._w / 2, y: p._h / 2, w: p._w, h: p._h }))),
        button('Zentrieren', () => L((x) => Object.assign(x, { x: p._w / 2, y: p._h / 2 }))),
        button('Seitenverhältnis 1:1', () => L((x) => (x.h = x.w))),
      ]),
    ])
  );
  out.push(section(`${KINDS[l.kind].icon} ${KINDS[l.kind].name}`, kindFields(l)));
  out.push(
    section('Nugget-Vorlage', [
      toggleField('In Nugget anpassbar', () => selectedLayer().nuggetOption, (v) => L((x) => (x.nuggetOption = v)), 'Beim Export als .batter: Bild tauschen, Deckkraft & Ausblenden einstellbar'),
    ], { closed: true })
  );
  return out;
}

function kindFields(l) {
  const f = [];
  const fitField = () => el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Einpassen'), segmented([['cover', 'Füllen'], ['contain', 'Einpassen'], ['stretch', 'Strecken']], () => selectedLayer().fit, (v) => L((x) => (x.fit = v)))]);
  switch (l.kind) {
    case 'image':
      f.push(button('Bild ersetzen …', () => A.replaceImage(l.id), 'primary'), fitField());
      break;
    case 'color':
      f.push(colorField('Farbe', () => selectedLayer().color, (v) => L((x) => (x.color = v), g('color'))));
      break;
    case 'gradient': {
      const gr = () => selectedLayer().gradient;
      f.push(
        el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Typ'), segmented([['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Konisch']], () => gr().type, (v) => L((x) => (x.gradient.type = v)))]),
        numField('Winkel', () => gr().angle, (v) => L((x) => (x.gradient.angle = v), g('ga')), { min: 0, max: 360, slider: true, unit: '°' })
      );
      gr().stops.forEach((s, i) => {
        f.push(
          el('div', { class: 'stop-row' }, [
            colorField(`Farbe ${i + 1}`, () => gr().stops[i]?.c, (v) => L((x) => (x.gradient.stops[i].c = v), g(`gc${i}`))),
            numField('Pos.', () => gr().stops[i]?.p, (v) => L((x) => (x.gradient.stops[i].p = v), g(`gp${i}`)), { min: 0, max: 1, step: 0.01, slider: true }),
            gr().stops.length > 2 ? iconBtn('✕', 'Farbe entfernen', () => L((x) => x.gradient.stops.splice(i, 1))) : null,
          ])
        );
      });
      f.push(button('+ Farbstopp', () => L((x) => x.gradient.stops.push({ c: '#ffffff', p: 1 }))));
      break;
    }
    case 'text': {
      const t = () => selectedLayer().text;
      const T = (k, parse = (v) => v) => (v) => L((x) => (x.text = { ...x.text, [k]: parse(v) }), g(`t${k}`));
      f.push(
        textField('Text', () => t().content, T('content'), { multiline: true }),
        selectField(
          'Schrift',
          [
            ['system-ui', 'SF Pro (System)'],
            ['ui-rounded, system-ui', 'SF Pro Rounded'],
            ['ui-serif, Georgia, serif', 'New York (Serif)'],
            ['ui-monospace, Menlo, monospace', 'SF Mono'],
            ['"Avenir Next", Avenir, system-ui', 'Avenir Next'],
            ['Didot, "Bodoni 72", serif', 'Didot'],
            ['"Snell Roundhand", cursive', 'Snell Roundhand'],
            ['"Marker Felt", "Comic Sans MS", cursive', 'Marker Felt'],
            ['Futura, system-ui', 'Futura'],
            ['Impact, "Arial Black", sans-serif', 'Impact'],
          ],
          () => t().font,
          T('font')
        ),
        el('div', { class: 'btn-row' }, [
          button(t().fontAsset ? `Eigene Schrift: ${t().fontName || 'geladen'}` : 'Eigene Schrift laden (TTF/OTF) …', () => A.uploadFont(l.id)),
          t().fontAsset ? button('Entfernen', () => L((x) => (x.text = { ...x.text, fontAsset: null, fontName: null }))) : null,
        ]),
        numField('Größe', () => t().size, T('size', Number), { min: 4, max: 400, slider: true, unit: 'pt' }),
        selectField('Stärke', [[100, 'Ultraleicht'], [300, 'Leicht'], [400, 'Normal'], [500, 'Medium'], [600, 'Halbfett'], [700, 'Fett'], [800, 'Heavy'], [900, 'Black']], () => t().weight, T('weight', Number)),
        colorField('Farbe', () => t().color, T('color')),
        el('div', { class: 'field' }, [el('span', { class: 'field-label' }, 'Ausrichtung'), segmented([['left', '⟸'], ['center', '≡'], ['right', '⟹']], () => t().align, T('align'))]),
        numField('Zeilenhöhe', () => t().lineHeight, T('lineHeight', Number), { min: 0.6, max: 3, step: 0.05, slider: true }),
        numField('Laufweite', () => t().letterSpacing, T('letterSpacing', Number), { min: -10, max: 40, step: 0.5, slider: true, unit: 'pt' }),
        numField('Schatten', () => t().shadow, T('shadow', Number), { min: 0, max: 1, step: 0.05, slider: true }),
        toggleField('Kursiv', () => t().italic, T('italic'))
      );
      break;
    }
    case 'shape': {
      const s = () => selectedLayer().shape;
      const S = (k, parse = (v) => v) => (v) => L((x) => (x.shape = { ...x.shape, [k]: parse(v) }), g(`s${k}`));
      f.push(
        el('div', { class: 'field' }, [
          el('span', { class: 'field-label' }, 'Form'),
          segmented([['ellipse', '●'], ['rect', '■'], ['rounded', '▢'], ['star', '★'], ['polygon', '⬢'], ['heart', '♥'], ['ring', '◯']], () => s().type, S('type')),
        ]),
        colorField('Füllung', () => s().fill, S('fill')),
        numField('Kontur', () => s().strokeWidth, S('strokeWidth', Number), { min: 0, max: 60, slider: true, unit: 'pt' }),
        colorField('Konturfarbe', () => s().stroke, S('stroke')),
        ['star', 'polygon'].includes(s().type) ? numField('Zacken / Ecken', () => s().points, S('points', Number), { min: 3, max: 24, slider: true }) : null,
        numField('Weichzeichnen', () => s().blur, S('blur', Number), { min: 0, max: 60, slider: true, unit: 'pt' })
      );
      break;
    }
    case 'video': {
      const v = () => selectedLayer().video;
      const V = (k, parse = (x) => x) => (val) => L((x) => (x.video = { ...x.video, [k]: parse(val) }), g(`v${k}`));
      f.push(
        el('p', { class: 'muted' }, `${v().frames.length} Frames · ${(v().frames.length / (v().fps || 24)).toFixed(1)} s`),
        numField('Bildrate', () => v().fps, V('fps', Number), { min: 1, max: 60, unit: 'fps' }),
        toggleField('Hin & zurück', () => v().autoreverse, V('autoreverse')),
        selectField('Bildwechsel', [['discrete', 'Hart (wie Video)'], ['linear', 'Überblenden']], () => v().calc, V('calc')),
        fitField(),
        button('Anderes Video …', () => A.addVideo(l.id))
      );
      break;
    }
    case 'emitter': {
      const e = () => selectedLayer().emitter;
      const E = (k, parse = Number) => (val) => L((x) => (x.emitter = { ...x.emitter, [k]: parse(val) }), g(`e${k}`));
      f.push(
        el('p', { class: 'warn-note' }, 'Experimentell: CAEmitterLayer wird von PosterBoard gerendert, ist aber in der Community kaum getestet. Teste auf dem Gerät.'),
        selectField('Voreinstellung', Object.entries(EMITTER_PRESETS).map(([k, v]) => [k, v.name]), () => e().preset, (k) => L((x) => (x.emitter = { preset: k, ...EMITTER_PRESETS[k], particleAsset: x.emitter.particleAsset }))),
        selectField('Partikel', [['dot', 'Punkt (weich)'], ['star', 'Stern'], ['streak', 'Strich'], ['ring', 'Blase'], ['petal', 'Blatt']], () => e().particle, E('particle', String)),
        el('div', { class: 'btn-row' }, [
          button(e().particleAsset ? 'Eigenes Partikelbild ✓' : 'Eigenes Partikelbild …', () => A.uploadParticle(l.id)),
          e().particleAsset ? button('Entfernen', () => L((x) => (x.emitter = { ...x.emitter, particleAsset: null }))) : null,
        ]),
        colorField('Farbe', () => e().color, E('color', String)),
        selectField('Quelle', [['line', 'Kante (Linie)'], ['rectangle', 'Fläche']], () => e().shape, E('shape', String)),
        numField('Anzahl / s', () => e().birthRate, E('birthRate'), { min: 0, max: 200, slider: true }),
        numField('Lebensdauer', () => e().lifetime, E('lifetime'), { min: 0.2, max: 40, step: 0.1, slider: true, unit: 's' }),
        numField('Größe', () => e().size, E('size'), { min: 2, max: 120, slider: true, unit: 'pt' }),
        numField('Größenvarianz', () => e().scaleRange, E('scaleRange'), { min: 0, max: 2, step: 0.05, slider: true }),
        numField('Tempo', () => e().velocity, E('velocity'), { min: 0, max: 1000, slider: true }),
        numField('Tempo-Varianz', () => e().velocityRange, E('velocityRange'), { min: 0, max: 500, slider: true }),
        numField('Richtung', () => e().emissionLongitude, E('emissionLongitude'), { min: -180, max: 180, slider: true, unit: '°' }),
        numField('Streuung', () => e().emissionRange, E('emissionRange'), { min: 0, max: 360, slider: true, unit: '°' }),
        numField('Schwerkraft Y', () => e().yAcceleration, E('yAcceleration'), { min: -400, max: 400, slider: true }),
        numField('Wind X', () => e().xAcceleration, E('xAcceleration'), { min: -200, max: 200, slider: true }),
        numField('Drehen', () => e().spin, E('spin'), { min: -6, max: 6, step: 0.1, slider: true }),
        numField('Ausblenden / s', () => e().alphaSpeed, E('alphaSpeed'), { min: -1, max: 0, step: 0.01, slider: true })
      );
      break;
    }
  }
  if (l.kind !== 'image' && l.kind !== 'video') {
    f.push(
      button('In Bild umwandeln / durch Foto ersetzen …', async () => {
        const id = store.selection;
        const before = store.project.layers.find((x) => x.id === id);
        const kind = before.kind;
        await A.replaceImage(id);
        if (store.project.layers.find((x) => x.id === id).asset) L((x) => ((x.kind = 'image'), (x.fit = 'cover')));
        else if (kind) toast('Kein Bild gewählt', 'info');
      })
    );
  }
  return f;
}

// ---------------------------------------------------------------- motion

const RECIPES = [
  ['Beim Entsperren einblenden', (l) => ((l.opacity = 0), (l.states.Unlock = { ...l.states.Unlock, opacity: 1 }))],
  ['Beim Entsperren ausblenden', (l) => (l.states.Unlock = { ...l.states.Unlock, opacity: 0 })],
  ['Beim Entsperren heranzoomen', (l) => (l.states.Unlock = { ...l.states.Unlock, scale: 1.25 })],
  ['Beim Entsperren wegzoomen', (l) => (l.states.Unlock = { ...l.states.Unlock, scale: 0.6, opacity: 0 })],
  ['Beim Entsperren nach oben', (l, p) => (l.states.Unlock = { ...l.states.Unlock, y: l.y - p._h * 0.25 })],
  ['Beim Entsperren nach unten', (l, p) => (l.states.Unlock = { ...l.states.Unlock, y: l.y + p._h * 0.25 })],
  ['Beim Entsperren drehen', (l) => (l.states.Unlock = { ...l.states.Unlock, rotation: (l.rotation || 0) + 180 })],
  ['Im Ruhemodus abdunkeln', (l) => (l.states.Sleep = { ...l.states.Sleep, opacity: 0.25 })],
  ['Nur im Dunkelmodus zeigen', (l, p) => ((p.appearanceAware = true), (l.opacity = 0), (l.states['Locked@dark'] = { ...l.states['Locked@dark'], opacity: 1 }))],
  ['Nur im Hellmodus zeigen', (l, p) => ((p.appearanceAware = true), (l.states['Locked@dark'] = { ...l.states['Locked@dark'], opacity: 0 }))],
];

function motionPanel() {
  const l = selectedLayer();
  if (!l) return [el('p', { class: 'empty big' }, 'Wähle zuerst eine Ebene.')];
  const p = store.project;
  const out = [];

  out.push(
    section('Schnell-Effekte', [
      el('div', { class: 'chip-grid' }, RECIPES.map(([name, fn]) => el('button', { type: 'button', class: 'chip', onclick: () => update((proj) => fn(proj.layers.find((x) => x.id === l.id), proj)) }, name))),
    ])
  );

  // state overview
  const keys = [...STATES.map((s) => s.id), ...(p.appearanceAware ? STATES.map((s) => `${s.id}@dark`) : [])];
  const rows = keys.map((k) => {
    const [sid, dark] = k.split('@');
    const s = STATES.find((x) => x.id === sid);
    const isBase = k === 'Locked';
    const ov = l.states[k] || {};
    const chips = isBase
      ? [el('small', { class: 'muted' }, 'Grundwerte')]
      : Object.keys(ov).length
        ? Object.entries(ov).map(([prop, v]) => {
            const def = ANIMATABLE.find((a) => a.id === prop);
            return el('span', { class: 'ov-chip' }, [
              `${def?.name || prop}: ${Math.round(v * 100) / 100}`,
              el('button', { type: 'button', class: 'x', 'aria-label': 'Entfernen', onclick: () => update((pp) => { const ll = pp.layers.find((x) => x.id === l.id); delete ll.states[k][prop]; if (!Object.keys(ll.states[k]).length) delete ll.states[k]; }) }, '×'),
            ]);
          })
        : [el('small', { class: 'muted' }, 'erbt')];
    const active = store.view.state === sid && !!dark === (p.appearanceAware && store.view.dark);
    return el('div', { class: `state-row ${active ? 'on' : ''}` }, [
      el('button', { type: 'button', class: 'state-name', onclick: () => setView({ state: sid, dark: !!dark }) }, `${s.icon} ${s.name}${dark ? ' 🌙' : ''}`),
      el('div', { class: 'state-vals' }, chips),
    ]);
  });
  out.push(
    section('Zustände', [
      el('p', { class: 'muted' }, 'PosterBoard schaltet diese Zustände selbst: Gesperrt, beim Entsperren-Wisch, und im Always-On-Display (Ruhe). Wähle einen Zustand und verschiebe/skaliere die Ebene – der Übergang wird automatisch animiert.'),
      ...rows,
      Object.keys(l.states).length ? button('Alle Zustände dieser Ebene zurücksetzen', () => update((pp) => (pp.layers.find((x) => x.id === l.id).states = {})), 'danger subtle') : null,
    ])
  );

  // transition
  const tr = () => selectedLayer().transition;
  out.push(
    section('Übergang', [
      toggleField('Eigener Übergang für diese Ebene', () => !!tr(), (v) => L((x) => (x.transition = v ? { ...p.transition } : null))),
      ...(tr() ? transitionFields(() => selectedLayer().transition, (fn) => L((x) => fn(x.transition), g('tr'))) : [el('p', { class: 'muted' }, `Nutzt den Projekt-Übergang: ${TRANSITION_PRESETS[p.transition.preset]?.name || 'Eigene Feder'}`)]),
    ])
  );

  // loop
  const lp = () => selectedLayer().loop;
  const LP = (k, parse = Number) => (v) => L((x) => (x.loop = { ...x.loop, [k]: parse(v) }), g(`lp${k}`));
  const loopType = lp().type;
  out.push(
    section('Dauer-Animation (Loop)', [
      selectField('Effekt', Object.entries(LOOPS).map(([k, v]) => [k, v.name]), () => lp().type, (v) => L((x) => (x.loop = { ...x.loop, type: v, amount: LOOPS[v].amount ?? 0, autoreverse: v !== 'rotate' && v !== 'blink' }))),
      loopType !== 'none' ? numField('Dauer', () => lp().duration, LP('duration'), { min: 0.1, max: 120, step: 0.1, slider: true, unit: 's' }) : null,
      loopType !== 'none' && LOOPS[loopType].amountLabel ? numField(LOOPS[loopType].amountLabel, () => lp().amount, LP('amount'), { min: loopType === 'rotate' ? -10 : 0, max: loopType === 'rotate' ? 10 : 200, step: loopType === 'rotate' ? 1 : 1, slider: true }) : null,
      loopType !== 'none' && loopType !== 'rotate' && loopType !== 'blink' ? toggleField('Hin & zurück', () => lp().autoreverse, LP('autoreverse', Boolean)) : null,
    ])
  );
  return out;
}

function transitionFields(get, set) {
  const t = get();
  return [
    selectField(
      'Stil',
      [...Object.entries(TRANSITION_PRESETS).map(([k, v]) => [k, v.name]), ['custom', 'Eigene Feder …']],
      () => get().preset || 'custom',
      (k) => set((tt) => Object.assign(tt, k === 'custom' ? { preset: 'custom', type: 'spring' } : { ...TRANSITION_PRESETS[k], preset: k }))
    ),
    ...(t.type === 'spring' && t.preset === 'custom'
      ? [
          numField('Dämpfung', () => get().damping, (v) => set((tt) => (tt.damping = v)), { min: 1, max: 200, slider: true }),
          numField('Masse', () => get().mass, (v) => set((tt) => (tt.mass = v)), { min: 0.1, max: 10, step: 0.1, slider: true }),
          numField('Steifigkeit', () => get().stiffness, (v) => set((tt) => (tt.stiffness = v)), { min: 10, max: 1000, slider: true }),
        ]
      : []),
    t.type === 'basic' ? numField('Dauer', () => get().duration, (v) => set((tt) => (tt.duration = v)), { min: 0.05, max: 5, step: 0.05, slider: true, unit: 's' }) : null,
  ];
}

// ---------------------------------------------------------------- project

function projectPanel() {
  const p = store.project;
  const P = (fn, grp) => update(fn, grp);
  const d = getDevice(p.device);
  const issues = validateProject(p);
  return [
    section('Wallpaper', [
      textField('Name', () => store.project.name, (v) => P((pp) => (pp.name = v), 'pname')),
      selectField('Gerät', DEVICES.map((x) => [x.id, `${x.name} · ${x.w}×${x.h}`]), () => store.project.device, (v) => A.changeDevice(v)),
      el('p', { class: 'muted' }, `Screen-Klasse: ${screenClass(d)} · Export in @${d.scale}x`),
      toggleField('Hell/Dunkel-Varianten', () => store.project.appearanceAware, (v) => P((pp) => (pp.appearanceAware = v)), 'Erzeugt zusätzlich „Locked Light/Dark“-Zustände (iOS-Erscheinungsbild)'),
    ]),
    section('Standard-Übergang', transitionFields(() => store.project.transition, (fn) => P((pp) => fn(pp.transition), 'ptr'))),
    section('Prüfung', [
      issues.length
        ? el('ul', { class: 'issues' }, issues.map((i) => el('li', { class: `issue-${i.level}` }, i.msg)))
        : el('p', { class: 'ok-note' }, '✓ Bereit zum Export'),
    ]),
    section('Export', [
      button('⬇︎ .tendies exportieren', () => A.exportTendies(), 'primary wide'),
      button('Nugget-Vorlage (.batter) exportieren', () => A.exportBatter(), 'wide'),
      el('p', { class: 'muted' }, 'Mehrere Wallpaper als Sammlung exportieren: Bibliothek öffnen (☰) → auswählen → „Als Sammlung exportieren“.'),
    ]),
    section('Import', [
      button('.tendies importieren & bearbeiten …', () => A.importTendiesFile(), 'wide'),
      el('p', { class: 'muted' }, 'Importiert Bild- und Video-Ebenen sowie Zustandswerte aus bestehenden Wallpapern (z. B. aus Pocket Poster / Cowabunga).'),
    ]),
    section('Installation aufs iPhone', [installGuide()], { closed: true }),
  ];
}

export function installGuide() {
  return el('div', { class: 'guide' }, [
    el('ol', {}, [
      el('li', {}, [el('b', {}, 'Exportieren: '), '„.tendies exportieren“ – auf dem iPhone öffnet sich das Teilen-Menü (in „Dateien“ sichern oder direkt an die Installer-App senden).']),
      el('li', {}, [el('b', {}, 'Mit Computer (alle unterstützten iOS-Versionen): '), 'Nugget (github.com/leminlimez/Nugget) → Gerät verbinden → „Posterboard“ → .tendies hinzufügen → „Apply“.']),
      el('li', {}, [el('b', {}, 'Ohne Computer: '), 'Pocket Poster oder eine vergleichbare On-Device-App (abhängig von deiner iOS-Version und dem aktuell verfügbaren Exploit) → .tendies importieren → anwenden.']),
      el('li', {}, [el('b', {}, 'Aktivieren: '), 'Sperrbildschirm lange drücken → „+“ → Kategorie „Sammlungen“ – dort erscheint dein Wallpaper.']),
    ]),
    el('p', { class: 'muted' }, 'Hinweis: Eigene PosterBoard-Wallpaper nutzen keine offizielle Apple-API. Tools & Unterstützung hängen von der iOS-Version ab. Bei Problemen: in Nugget „Reset Collections“ ausführen und neu anwenden.'),
  ]);
}
