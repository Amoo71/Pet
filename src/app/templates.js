// Starter templates – built from vector layers only, so they work offline and
// show off states, appearance variants, loops and particles.
import { newLayer, EMITTER_PRESETS } from '../core/model.js';

const grad = (angle, ...stops) => ({ type: 'linear', angle, stops: stops.map(([c, p]) => ({ c, p })) });

export const TEMPLATES = [
  {
    id: 'sunrise',
    name: 'Sonnenaufgang beim Entsperren',
    desc: 'Die Sonne steigt beim Entsperren auf, der Himmel wird hell.',
    build(p) {
      p.name = 'Sonnenaufgang';
      const W = p._w, H = p._h;
      const night = newLayer('gradient', p, { name: 'Nachthimmel', gradient: grad(180, ['#0b1030', 0], ['#2a2160', 0.6], ['#6b3a6e', 1]) });
      const day = newLayer('gradient', p, { name: 'Taghimmel', gradient: grad(180, ['#5fb4ff', 0], ['#ffd29a', 0.75], ['#ff9a6b', 1]), opacity: 0, states: { Unlock: { opacity: 1 } } });
      const sun = newLayer('shape', p, { name: 'Sonne', plane: 'background', w: W * 0.55, h: W * 0.55, x: W / 2, y: H * 0.95, shape: { type: 'ellipse', fill: '#ffcf5a', stroke: '#fff', strokeWidth: 0, points: 5, blur: 6 }, states: { Unlock: { y: H * 0.58, scale: 1.1 }, Sleep: { opacity: 0.4 } } });
      const hills = newLayer('shape', p, { name: 'Hügel', plane: 'floating', w: W * 1.6, h: H * 0.42, x: W / 2, y: H * 0.98, shape: { type: 'ellipse', fill: '#1d2a1f', stroke: '#000', strokeWidth: 0, points: 5, blur: 0 } });
      const stars = newLayer('emitter', p, { name: 'Sterne', plane: 'background', h: H * 0.6, y: H * 0.3, emitter: { preset: 'stars', ...EMITTER_PRESETS.stars }, states: { Unlock: { opacity: 0 } } });
      p.layers.push(night, day, stars, sun, hills);
    },
  },
  {
    id: 'daynight',
    name: 'Tag & Nacht (Hell/Dunkel)',
    desc: 'Reagiert auf den Erscheinungsmodus von iOS und auf das Entsperren.',
    build(p) {
      p.name = 'Tag & Nacht';
      p.appearanceAware = true;
      const W = p._w, H = p._h;
      const bg = newLayer('gradient', p, { name: 'Himmel', gradient: grad(170, ['#9ad7ff', 0], ['#e8f6ff', 1]) });
      const bgDark = newLayer('gradient', p, { name: 'Himmel Nacht', gradient: grad(170, ['#05081c', 0], ['#1a2350', 1]), opacity: 0, states: { 'Locked@dark': { opacity: 1 } } });
      const orb = newLayer('shape', p, { name: 'Sonne / Mond', plane: 'background', w: 150, h: 150, x: W * 0.72, y: H * 0.33, shape: { type: 'ellipse', fill: '#ffd34d', stroke: '#fff', strokeWidth: 0, points: 5, blur: 2 }, states: { Unlock: { scale: 1.25, y: H * 0.3 }, 'Locked@dark': { opacity: 0.85 } } });
      orb.loop = { type: 'pulse', duration: 3, amount: 6, autoreverse: true };
      const city = newLayer('shape', p, { name: 'Stadt', plane: 'floating', w: W * 1.2, h: H * 0.3, x: W / 2, y: H * 0.93, shape: { type: 'rect', fill: '#26324a', stroke: '#000', strokeWidth: 0, points: 5, blur: 0 } });
      const sparkle = newLayer('emitter', p, { name: 'Sterne', plane: 'background', h: H * 0.6, y: H * 0.3, emitter: { preset: 'stars', ...EMITTER_PRESETS.stars }, opacity: 0, states: { 'Locked@dark': { opacity: 1 } } });
      p.layers.push(bg, bgDark, sparkle, orb, city);
    },
  },
  {
    id: 'snow',
    name: 'Schneenacht',
    desc: 'Partikel-Schnee, der beim Entsperren dichter wird.',
    build(p) {
      p.name = 'Schneenacht';
      const W = p._w, H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Nacht', gradient: grad(180, ['#0d1b2a', 0], ['#1b263b', 0.6], ['#415a77', 1]) }),
        newLayer('shape', p, { name: 'Mond', plane: 'background', w: 110, h: 110, x: W * 0.75, y: H * 0.36, shape: { type: 'ellipse', fill: '#f4f1de', stroke: '#fff', strokeWidth: 0, points: 5, blur: 1 } }),
        newLayer('shape', p, { name: 'Schneedecke', plane: 'floating', w: W * 1.5, h: H * 0.25, x: W / 2, y: H * 1.02, shape: { type: 'ellipse', fill: '#e9f1f7', stroke: '#fff', strokeWidth: 0, points: 5, blur: 0 } }),
        newLayer('emitter', p, { name: 'Schnee', plane: 'floating', emitter: { preset: 'snow', ...EMITTER_PRESETS.snow }, states: { Sleep: { opacity: 0.3 } } })
      );
    },
  },
  {
    id: 'neon',
    name: 'Neon-Puls',
    desc: 'Leuchtender Text, rotierender Ring, Zoom beim Entsperren.',
    build(p) {
      p.name = 'Neon';
      const W = p._w, H = p._h;
      const ring = newLayer('shape', p, { name: 'Ring', plane: 'background', w: W * 0.8, h: W * 0.8, y: H * 0.55, shape: { type: 'ring', fill: '#ff2bd6', stroke: '#fff', strokeWidth: 10, points: 5, blur: 3 }, states: { Unlock: { scale: 1.6, opacity: 0.3 } } });
      ring.loop = { type: 'rotate', duration: 12, amount: 1, autoreverse: false };
      const star = newLayer('shape', p, { name: 'Stern', plane: 'background', w: W * 0.5, h: W * 0.5, y: H * 0.55, shape: { type: 'star', fill: '#00e5ff', stroke: '#fff', strokeWidth: 0, points: 6, blur: 0 }, states: { Unlock: { rotation: 180, scale: 0.6 } } });
      star.loop = { type: 'pulse', duration: 1.6, amount: 10, autoreverse: true };
      const txt = newLayer('text', p, { name: 'Text', plane: 'foreground', y: H * 0.82, text: { content: 'STAY WEIRD', font: 'system-ui', weight: 900, size: 54, color: '#fff7a8', align: 'center', lineHeight: 1.1, letterSpacing: 4, italic: true, shadow: 0.9, fontAsset: null }, states: { Unlock: { y: H * 0.9, opacity: 0 } } });
      txt.loop = { type: 'blink', duration: 3, amount: 40, autoreverse: false };
      p.layers.push(newLayer('color', p, { name: 'Schwarz', color: '#07010f' }), ring, star, txt);
    },
  },
  {
    id: 'reveal',
    name: 'Foto-Reveal',
    desc: 'Verschwommenes Sperrbild → klares Bild beim Entsperren. Ersetze die Ebenen durch eigene Fotos.',
    build(p) {
      p.name = 'Foto-Reveal';
      const H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Platzhalter Sperrbild (ersetzen)', gradient: { type: 'radial', angle: 0, stops: [{ c: '#3a506b', p: 0 }, { c: '#0b132b', p: 1 }] } }),
        newLayer('gradient', p, { name: 'Platzhalter Entsperrt (ersetzen)', plane: 'floating', gradient: grad(135, ['#f72585', 0], ['#7209b7', 0.5], ['#4cc9f0', 1]), opacity: 0, scale: 1.08, states: { Unlock: { opacity: 1, scale: 1 } } }),
        newLayer('text', p, { name: 'Hinweis', plane: 'foreground', y: H * 0.75, text: { content: 'Tippe eine Ebene an → „Bild ersetzen“', font: 'system-ui', weight: 600, size: 22, color: '#ffffff', align: 'center', lineHeight: 1.2, letterSpacing: 0, italic: false, shadow: 0.5, fontAsset: null }, states: { Unlock: { opacity: 0 } } })
      );
    },
  },
  {
    id: 'blank',
    name: 'Leer',
    desc: 'Leere Leinwand.',
    build(p) {
      p.name = 'Neues Wallpaper';
    },
  },
];
