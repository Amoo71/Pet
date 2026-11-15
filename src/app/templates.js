// Starter templates – vector layers only, so they work offline. Most are battery-friendly:
// motion comes from the swipe (state values) and the gyro instead of endless loops.
import { newLayer, newAnim, EMITTER_PRESETS } from '../core/model.js';

const grad = (angle, ...stops) => ({ type: 'linear', angle, stops: stops.map(([c, p]) => ({ c, p })) });
const radial = (...stops) => ({ type: 'radial', angle: 0, stops: stops.map(([c, p]) => ({ c, p })) });

export const TEMPLATES = [
  {
    id: 'sunrise',
    icon: '🌅',
    name: 'Sunrise unlock',
    desc: 'Swipe up and the sun rises with your finger. Gyro depth, zero loops.',
    build(p) {
      p.name = 'Sunrise';
      const W = p._w, H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Night sky', gradient: grad(180, ['#0b1030', 0], ['#2a2160', 0.6], ['#6b3a6e', 1]), parallax: 4, w: W + 40, h: H + 40 }),
        newLayer('gradient', p, { name: 'Day sky', gradient: grad(180, ['#5fb4ff', 0], ['#ffd29a', 0.75], ['#ff9a6b', 1]), opacity: 0, states: { Unlock: { opacity: 1 } }, parallax: 4, w: W + 40, h: H + 40 }),
        newLayer('shape', p, { name: 'Sun', plane: 'background', w: W * 0.55, h: W * 0.55, x: W / 2, y: H * 0.95, shape: { type: 'ellipse', fill: '#ffcf5a', stroke: '#fff', strokeWidth: 0, points: 5, blur: 6 }, states: { Unlock: { y: H * 0.56, scale: 1.1 }, Sleep: { opacity: 0.35 } }, parallax: 8 }),
        newLayer('shape', p, { name: 'Far hills', plane: 'background', w: W * 1.7, h: H * 0.36, x: W * 0.3, y: H * 0.98, shape: { type: 'ellipse', fill: '#2c3b35', stroke: '#000', strokeWidth: 0, points: 5, blur: 0 }, parallax: 10, states: { Unlock: { y: H * 1.0 } } }),
        newLayer('shape', p, { name: 'Near hill', plane: 'floating', w: W * 1.6, h: H * 0.42, x: W * 0.75, y: H * 1.03, shape: { type: 'ellipse', fill: '#18241c', stroke: '#000', strokeWidth: 0, points: 5, blur: 0 }, parallax: 18, states: { Unlock: { y: H * 1.08 } } })
      );
    },
  },
  {
    id: 'duo3d',
    icon: '📖',
    name: 'Duo · Gyro 3D fade',
    desc: 'iPhone Duo split screens: layered 3D scene that tilts with the gyro and fades away in depth when you unlock.',
    build(p) {
      p.name = 'Duo 3D fade';
      p.format = 'duo';
      p.device = 'iphone-duo';
      p._w = 951;
      p._h = 951;
      p.perspective = 800;
      const S = 951;
      const C = S / 2;
      p.layers.push(
        newLayer('gradient', p, { name: 'Deep space', w: S + 120, h: S + 120, gradient: radial(['#24125e', 0], ['#060312', 1]), parallax: 6, states: { Unlock: { scale: 1.06 }, Sleep: { opacity: 0.5 } } }),
        newLayer('emitter', p, { name: 'Stars', plane: 'background', w: S, h: S, emitter: { preset: 'stars', ...EMITTER_PRESETS.stars }, parallax: 8, states: { Sleep: { opacity: 0 } } }),
        newLayer('shape', p, { name: 'Ring far', plane: 'background', w: 620, h: 620, x: C, y: C + 40, rotX: 62, shape: { type: 'ring', fill: '#7c6cff', stroke: '#fff', strokeWidth: 6, points: 5, blur: 2 }, parallax: 10, gyro: { tilt: 14, fade: 'none', fadeMin: 0, fadeMax: 1 }, fastFade: true, states: { Unlock: { rotX: 80, scale: 1.4, opacity: 0 }, Sleep: { opacity: 0.35 } } }),
        newLayer('shape', p, { name: 'Planet', plane: 'background', w: 300, h: 300, x: C, y: C + 40, shape: { type: 'ellipse', fill: '#36c5ff', stroke: '#fff', strokeWidth: 0, points: 5, blur: 1 }, parallax: 14, gyro: { tilt: 0, fade: 'none', fadeMin: 0, fadeMax: 1 }, states: { Unlock: { y: C + 260, scale: 0.7 }, Sleep: { y: C + 220, scale: 0.8 } } }),
        newLayer('glass', p, { name: 'Glass shard', w: 300, h: 420, x: C + 150, y: C + 120, rotY: -28, cornerRadius: 40, glass: { mode: 'liquid', blur: 3, tint: '#ffffff', tintOpacity: 0.08, border: 0.6, saturation: 1.6, shine: 0.45, refraction: 90 }, parallax: 24, gyro: { tilt: 18, fade: '-x', fadeMin: 0.35, fadeMax: 1 }, fastFade: true, states: { Unlock: { rotY: -85, x: C + 420, opacity: 0 }, Sleep: { opacity: 0 } } }),
        newLayer('text', p, { name: 'Title', w: 700, h: 120, x: C, y: C + 300, text: { content: 'D E P T H', font: 'ui-rounded, system-ui', weight: 800, size: 64, color: '#ffffff', align: 'center', lineHeight: 1, letterSpacing: 6, italic: false, shadow: 0.5, fontAsset: null }, parallax: 30, gyro: { tilt: 10, fade: 'none', fadeMin: 0, fadeMax: 1 }, fastFade: true, states: { Unlock: { rotX: 70, y: C + 380, opacity: 0 }, Sleep: { opacity: 0 } } })
      );
    },
  },
  {
    id: 'liquid',
    icon: '💧',
    name: 'Liquid Glass card',
    desc: 'iOS 26 Liquid Glass panel floating over colour blobs; lifts on unlock.',
    build(p) {
      p.name = 'Liquid Glass';
      const W = p._w, H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Backdrop', gradient: grad(150, ['#12052e', 0], ['#2b1066', 0.5], ['#04132e', 1]), parallax: 4, w: W + 40, h: H + 40 }),
        newLayer('shape', p, { name: 'Blob pink', w: 300, h: 300, x: W * 0.25, y: H * 0.62, shape: { type: 'ellipse', fill: '#ff4fa3', stroke: '#fff', strokeWidth: 0, points: 5, blur: 30 }, parallax: 10, states: { Unlock: { x: W * 0.35, y: H * 0.45 } } }),
        newLayer('shape', p, { name: 'Blob blue', w: 340, h: 340, x: W * 0.8, y: H * 0.78, shape: { type: 'ellipse', fill: '#38b6ff', stroke: '#fff', strokeWidth: 0, points: 5, blur: 30 }, parallax: 12, states: { Unlock: { x: W * 0.65, y: H * 0.6 } } }),
        newLayer('shape', p, { name: 'Blob gold', w: 200, h: 200, x: W * 0.62, y: H * 0.42, shape: { type: 'ellipse', fill: '#ffcc4d', stroke: '#fff', strokeWidth: 0, points: 5, blur: 24 }, parallax: 8 }),
        newLayer('glass', p, { name: 'Glass card', y: H * 0.7, h: 170, cornerRadius: 44, glass: { mode: 'liquid', blur: 3, tint: '#ffffff', tintOpacity: 0.08, border: 0.6, saturation: 1.6, shine: 0.4, refraction: 90 }, parallax: 16, states: { Unlock: { y: H * 0.55, scale: 1.04 }, Sleep: { opacity: 0 } } }),
        newLayer('text', p, { name: 'Caption', y: H * 0.7, h: 80, text: { content: 'liquid glass', font: 'ui-rounded, system-ui', weight: 600, size: 34, color: '#ffffff', align: 'center', lineHeight: 1.1, letterSpacing: 1, italic: false, shadow: 0.2, fontAsset: null }, parallax: 16, states: { Unlock: { y: H * 0.55, scale: 1.04 }, Sleep: { opacity: 0 } } })
      );
    },
  },
  {
    id: 'frosted',
    icon: '🫧',
    name: 'Frosted widget',
    desc: 'Glassmorphism panel (baked blur – works on every iOS) over an aurora.',
    build(p) {
      p.name = 'Frosted';
      const W = p._w, H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Aurora', gradient: grad(200, ['#001a2c', 0], ['#00594f', 0.45], ['#2d1b69', 1]), parallax: 4, w: W + 40, h: H + 40 }),
        newLayer('shape', p, { name: 'Glow', w: W * 1.2, h: 260, x: W / 2, y: H * 0.5, rotation: -18, shape: { type: 'ellipse', fill: '#3dffc2', stroke: '#fff', strokeWidth: 0, points: 5, blur: 50 }, opacity: 0.75, parallax: 8, states: { Unlock: { rotation: 10, opacity: 0.5 } } }),
        newLayer('glass', p, { name: 'Frosted panel', y: H * 0.74, h: 190, cornerRadius: 38, glass: { mode: 'frosted', blur: 24, tint: '#ffffff', tintOpacity: 0.12, border: 0.5, saturation: 1.6, shine: 0.3, refraction: 80 }, parallax: 12, states: { Unlock: { y: H * 0.86, opacity: 0.0 } } }),
        newLayer('text', p, { name: 'Quote', y: H * 0.74, h: 140, w: W - 90, text: { content: 'stay curious', font: 'ui-serif, Georgia, serif', weight: 500, size: 38, color: '#ffffff', align: 'center', lineHeight: 1.1, letterSpacing: 0, italic: true, shadow: 0.25, fontAsset: null }, parallax: 12, states: { Unlock: { y: H * 0.86, opacity: 0 } } })
      );
    },
  },
  {
    id: 'depth',
    icon: '🧍',
    name: 'Depth photo',
    desc: 'Background photo + cut-out subject in front of the clock. Replace both with your images.',
    build(p) {
      p.name = 'Depth photo';
      const W = p._w, H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Background (replace)', gradient: radial(['#ff9a8b', 0], ['#4d2c6f', 1]), parallax: 5, w: W + 40, h: H + 40, states: { Unlock: { scale: 1.08 }, Sleep: { opacity: 0.35 } } }),
        newLayer('shape', p, { name: 'Subject (replace with PNG cut-out)', plane: 'floating', w: W * 0.8, h: H * 0.62, y: H * 0.72, shape: { type: 'rounded', fill: '#1b1b2b', stroke: '#fff', strokeWidth: 0, points: 5, blur: 0 }, parallax: 16, states: { Unlock: { scale: 0.92, y: H * 0.8 }, Sleep: { y: H * 0.86, scale: 0.85 } } })
      );
    },
  },
  {
    id: 'snow',
    icon: '❄️',
    name: 'Snow night',
    desc: 'Particle snow (loops – uses more battery).',
    build(p) {
      p.name = 'Snow night';
      const W = p._w, H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Night', gradient: grad(180, ['#0d1b2a', 0], ['#1b263b', 0.6], ['#415a77', 1]), parallax: 4, w: W + 40, h: H + 40 }),
        newLayer('shape', p, { name: 'Moon', plane: 'background', w: 110, h: 110, x: W * 0.75, y: H * 0.36, shape: { type: 'ellipse', fill: '#f4f1de', stroke: '#fff', strokeWidth: 0, points: 5, blur: 1 }, parallax: 6 }),
        newLayer('shape', p, { name: 'Snow bank', plane: 'floating', w: W * 1.5, h: H * 0.25, x: W / 2, y: H * 1.02, shape: { type: 'ellipse', fill: '#e9f1f7', stroke: '#fff', strokeWidth: 0, points: 5, blur: 0 }, parallax: 14 }),
        newLayer('emitter', p, { name: 'Snow', plane: 'floating', emitter: { preset: 'snow', ...EMITTER_PRESETS.snow }, states: { Sleep: { opacity: 0 } } })
      );
    },
  },
  {
    id: 'neon',
    icon: '🌀',
    name: 'Neon pulse',
    desc: 'Glowing text, spinning ring, zoom on unlock (loops).',
    build(p) {
      p.name = 'Neon';
      const W = p._w, H = p._h;
      const ring = newLayer('shape', p, { name: 'Ring', w: W * 0.8, h: W * 0.8, y: H * 0.55, shape: { type: 'ring', fill: '#ff2bd6', stroke: '#fff', strokeWidth: 10, points: 5, blur: 3 }, blend: 'screenBlendMode', states: { Unlock: { scale: 1.6, opacity: 0.3 } } });
      ring.anims.push(newAnim('spin'));
      const star = newLayer('shape', p, { name: 'Star', plane: 'background', w: W * 0.5, h: W * 0.5, y: H * 0.55, shape: { type: 'star', fill: '#00e5ff', stroke: '#fff', strokeWidth: 0, points: 6, blur: 0 }, states: { Unlock: { rotation: 180, scale: 0.6 } } });
      star.anims.push(newAnim('heartbeat'));
      const txt = newLayer('text', p, { name: 'Text', y: H * 0.82, text: { content: 'STAY WEIRD', font: 'system-ui', weight: 900, size: 54, color: '#fff7a8', align: 'center', lineHeight: 1.1, letterSpacing: 4, italic: true, shadow: 0.9, fontAsset: null }, states: { Unlock: { y: H * 0.9, opacity: 0 } } });
      txt.anims.push(newAnim('blink'));
      p.layers.push(newLayer('color', p, { name: 'Black', color: '#07010f' }), ring, star, txt);
    },
  },
  {
    id: 'daynight',
    icon: '🌗',
    name: 'Day & Night (Classic)',
    desc: 'Follows iOS light/dark appearance – Classic format.',
    build(p) {
      p.name = 'Day & Night';
      p.format = 'classic';
      p.appearanceAware = true;
      const W = p._w, H = p._h;
      p.layers.push(
        newLayer('gradient', p, { name: 'Sky', gradient: grad(170, ['#9ad7ff', 0], ['#e8f6ff', 1]) }),
        newLayer('gradient', p, { name: 'Night sky', gradient: grad(170, ['#05081c', 0], ['#1a2350', 1]), opacity: 0, states: { 'Locked@dark': { opacity: 1 } } }),
        newLayer('shape', p, { name: 'Sun / Moon', plane: 'background', w: 150, h: 150, x: W * 0.72, y: H * 0.33, shape: { type: 'ellipse', fill: '#ffd34d', stroke: '#fff', strokeWidth: 0, points: 5, blur: 2 }, states: { Unlock: { scale: 1.25, y: H * 0.3 }, 'Locked@dark': { opacity: 0.85 } } }),
        newLayer('shape', p, { name: 'City', plane: 'floating', w: W * 1.2, h: H * 0.3, x: W / 2, y: H * 0.93, shape: { type: 'rect', fill: '#26324a', stroke: '#000', strokeWidth: 0, points: 5, blur: 0 } })
      );
    },
  },
  {
    id: 'blank',
    icon: '＋',
    name: 'Blank',
    desc: 'Empty canvas.',
    build(p) {
      p.name = 'New wallpaper';
    },
  },
];
