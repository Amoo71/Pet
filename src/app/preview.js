// Live preview stage.
//  Edit mode    – select / move / resize / rotate layers; edits go to the selected state.
//  Preview mode – behaves like the lock screen: swipe up to unlock, pull down to lock,
//                 tilt (mouse or device motion) for gyro parallax.
// Modern format: state values follow the finger linearly (ParameterizedCA behaviour).
// Classic format: the state switches when the swipe completes and springs (LKStateTransition).

import { store, update, select, selectedLayer, subscribe, setView } from './store.js';
import { effective, interpolate, stateKey, PLANES, BLEND_CSS, DUO } from '../core/model.js';
import { layerBitmapURL, assetURL } from './assets.js';
import { transitionCSS } from './spring.js';
import { el } from './dom.js';

let stage, phone, overlay, clockEl, homeEl, hintEl;
const planesEl = {};
const nodes = new Map(); // layer id -> node record
let fitScale = 1;
let lastStateKey = '';
const live = { u: null, from: 'Locked', to: 'Unlock', tiltX: 0, tiltY: 0 };

export function mountPreview(root) {
  stage = root;
  phone = el('div', { class: 'phone', id: 'phone' });
  for (const p of PLANES) planesEl[p.id] = el('div', { class: `plane plane-${p.id}`, 'data-plane': p.id });
  clockEl = el('div', { class: 'ls-clock', 'aria-hidden': 'true' }, [el('div', { class: 'ls-date' }), el('div', { class: 'ls-time' })]);
  homeEl = el('div', { class: 'ls-home', 'aria-hidden': 'true' }, [
    el('div', { class: 'ls-grid' }, Array.from({ length: 20 }, () => el('i'))),
    el('div', { class: 'ls-dock' }, Array.from({ length: 4 }, () => el('i'))),
  ]);
  const chrome = el('div', { class: 'ls-chrome', 'aria-hidden': 'true' }, [
    el('div', { class: 'ls-island' }),
    el('div', { class: 'ls-btn ls-left' }, '🔦'),
    el('div', { class: 'ls-btn ls-right' }, '📷'),
    el('div', { class: 'ls-bar' }),
  ]);
  hintEl = el('div', { class: 'swipe-hint' }, 'Swipe up to unlock');
  overlay = el('div', { class: 'sel-overlay' });
  phone.append(planesEl.background, clockEl, planesEl.floating, homeEl, chrome, hintEl, overlay);
  stage.append(phone);

  new ResizeObserver(() => layout()).observe(stage);
  phone.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onTiltMouse);
  stage.addEventListener('pointerleave', () => {
    if (store.view.mode === 'preview' && !motionOn) setTilt(0, 0);
  });
  subscribe(render);
  tickClock();
  setInterval(tickClock, 15000);
  render('project');
}

function tickClock() {
  const d = new Date();
  clockEl.querySelector('.ls-date').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  clockEl.querySelector('.ls-time').textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
}

function layout() {
  const p = store.project;
  if (!p || !stage) return;
  const r = stage.getBoundingClientRect();
  const pad = 28;
  // iPhone Duo: show one posture's crop of the square scene
  const post = p.format === 'duo' ? DUO.postures[store.view.posture || 'inner'] : null;
  const vw = post ? post.w : p._w;
  const vh = post ? post.h : p._h;
  fitScale = Math.max(0.05, Math.min((r.width - pad) / vw, (r.height - pad) / vh));
  const z = store.view.zoom || fitScale;
  phone.style.width = `${vw}px`;
  phone.style.height = `${vh}px`;
  phone.style.transform = `translate(-50%, -50%) scale(${z})`;
  phone.style.setProperty('--z', z);
  phone.style.setProperty('--W', vw);
  phone.style.setProperty('--H', vh);
  phone.style.setProperty('--CW', Math.min(vw, vh * 0.62));
  phone.classList.toggle('duo', !!post);
  const ox = (vw - p._w) / 2;
  const oy = (vh - p._h) / 2;
  for (const el of [planesEl.background, planesEl.floating, overlay]) {
    el.style.left = `${ox}px`;
    el.style.top = `${oy}px`;
    el.style.width = `${p._w}px`;
    el.style.height = `${p._h}px`;
    el.style.perspective = p.perspective === 0 ? 'none' : `${p.perspective || 900}px`;
  }
}

export const currentScale = () => store.view.zoom || fitScale;

/** current interpolation: null = rest at view.state */
function valuesFor(l, p) {
  const dark = p.appearanceAware && store.view.dark && p.format === 'classic';
  const lerp = (u) => {
    const v = interpolate(l, live.u != null ? live.from : 'Locked', live.u != null ? live.to : 'Unlock', u, dark);
    if (l.fastFade) {
      const a = Math.sqrt(Math.max(0, effective(l, live.u != null ? live.from : 'Locked', dark).opacity));
      const b = Math.sqrt(Math.max(0, effective(l, live.u != null ? live.to : 'Unlock', dark).opacity));
      v.opacity = (a + (b - a) * u) ** 2;
    }
    return v;
  };
  if (live.u != null && p.format !== 'classic') return lerp(live.u);
  if (store.view.progress > 0 && store.view.progress < 1 && p.format !== 'classic') return lerp(store.view.progress);
  return effective(l, store.view.state, dark);
}

function render(reason) {
  const p = store.project;
  if (!p) return;
  layout();
  const v = store.view;
  const sk = `${v.state}|${v.dark}`;
  const stateChanged = sk !== lastStateKey;
  lastStateKey = sk;
  phone.dataset.state = v.state;
  phone.dataset.mode = v.mode;
  phone.classList.toggle('dark', !!v.dark);
  phone.classList.toggle('show-clock', v.clock);
  const u = live.u ?? (v.progress > 0 && v.progress < 1 ? v.progress : v.state === 'Unlock' ? 1 : 0);
  phone.style.setProperty('--u', u);

  const seen = new Set();
  for (const plane of PLANES) {
    const host = planesEl[plane.id];
    const layers = p.layers.filter((l) => l.plane === plane.id);
    layers.forEach((l, i) => {
      seen.add(l.id);
      let n = nodes.get(l.id);
      if (!n) {
        const px = el('div', { class: 'px' });
        const tl = el('div', { class: 'px tl' }); // gyro tilt / fold (mirrors the export's "<name> Tilt" transform layer)
        const outer = el('div', { class: 'layer', 'data-id': l.id });
        const content = el('div', { class: 'content' });
        px.append(tl);
        tl.append(outer);
        n = { px, tl, outer, content, anims: [], sig: '', animSig: '' };
        outer.append(content);
        nodes.set(l.id, n);
      }
      if (n.px.parentNode !== host || host.children[i] !== n.px) host.insertBefore(n.px, host.children[i] || null);
      paintLayer(l, n, p, stateChanged && reason !== 'project' && live.u == null);
    });
  }
  for (const [id, n] of nodes) {
    if (!seen.has(id)) {
      stopNode(n);
      n.px.remove();
      nodes.delete(id);
    }
  }
  drawOverlay();
}

function stopNode(n) {
  n.anims.forEach((a) => a.anim?.cancel());
  clearInterval(n.timer);
  n.emitter?.stop();
}

function paintLayer(l, n, p, animate) {
  const e = valuesFor(l, p);
  const o = n.outer;
  if (animate && p.format === 'classic') {
    const t = transitionCSS(l.transition || p.transition);
    o.style.transition = ['left', 'top', 'transform', 'opacity'].map((k) => `${k} ${t.duration}s ${t.easing}`).join(', ');
    clearTimeout(n.tt);
    n.tt = setTimeout(() => ((o.style.transition = ''), (n.tt = 0)), t.duration * 1000 + 50);
  } else if (animate) {
    // modern: the system animates the remaining swipe linearly-ish
    o.style.transition = ['left', 'top', 'transform', 'opacity'].map((k) => `${k} .35s cubic-bezier(.25,.8,.3,1)`).join(', ');
    clearTimeout(n.tt);
    n.tt = setTimeout(() => ((o.style.transition = ''), (n.tt = 0)), 400);
  } else if (!n.tt) o.style.transition = '';
  o.style.left = `${e.x - l.w / 2}px`;
  o.style.top = `${e.y - l.h / 2}px`;
  o.style.width = `${l.w}px`;
  o.style.height = `${l.h}px`;
  o.style.opacity = Math.max(0, Math.min(1, e.opacity));
  const an = l.anchor || { x: 0.5, y: 0.5 };
  o.style.transformOrigin = `${an.x * 100}% ${an.y * 100}%`;
  // the tilt wrapper pivots around the layer's anchor (screen coordinates)
  n.tl.style.transformOrigin = `${e.x - l.w / 2 + an.x * l.w}px ${e.y - l.h / 2 + an.y * l.h}px`;
  const sx = l.sx || 1;
  o.style.transform = `rotate(${e.rotation}deg) rotateY(${e.rotY || 0}deg) rotateX(${e.rotX || 0}deg) scale(${e.scale * sx}, ${e.scale})`;
  o.style.transformStyle = '';
  o.style.borderRadius = l.cornerRadius ? `${l.cornerRadius}px` : '';
  o.style.overflow = l.cornerRadius ? 'hidden' : '';
  o.style.visibility = l.hidden ? 'hidden' : '';
  o.style.mixBlendMode = BLEND_CSS[l.blend] || '';
  const f = l.filters || {};
  const filt = [];
  if (f.blur) filt.push(`blur(${f.blur}px)`);
  if (f.hue) filt.push(`hue-rotate(${f.hue}deg)`);
  if (f.saturate != null && f.saturate !== 1) filt.push(`saturate(${f.saturate})`);
  if (f.contrast != null && f.contrast !== 1) filt.push(`contrast(${f.contrast})`);
  o.style.filter = filt.join(' ');
  o.classList.toggle('locked', !!l.locked);
  o.classList.toggle('selected', l.id === store.selection);
  applyGyro(l, n, p);

  // glass
  const c = n.content;
  if (l.kind === 'glass') {
    const g = l.glass || {};
    const blur = g.mode === 'liquid' ? Math.min(3, g.blur ?? 3) : g.blur ?? 20;
    c.style.backdropFilter = c.style.webkitBackdropFilter = `blur(${blur}px) saturate(${g.saturation ?? 1.4})`;
    c.style.borderRadius = `${l.cornerRadius || 0}px`;
    c.classList.toggle('liquid', g.mode === 'liquid');
  } else {
    c.style.backdropFilter = c.style.webkitBackdropFilter = '';
  }
  c.style.backgroundSize = l.kind === 'image' || l.kind === 'video' ? { cover: 'cover', contain: 'contain', stretch: '100% 100%' }[l.fit] : '100% 100%';

  const sig = JSON.stringify([l.kind, l.asset, l.color, l.gradient, l.text, l.shape, l.glass, l.cornerRadius, l.w, l.h, l.video?.frames?.length, l.video?.fps, l.video?.autoreverse, l.video?.sequence?.length, l.emitter]);
  if (sig !== n.sig) {
    n.sig = sig;
    clearInterval(n.timer);
    n.emitter?.stop();
    n.emitter = null;
    c.innerHTML = '';
    c.style.backgroundImage = '';
    if (l.kind === 'emitter') startEmitter(l, n);
    else if (l.kind === 'video') startFrames(l, n);
    else {
      const want = sig;
      layerBitmapURL(l).then((url) => {
        if (n.sig === want && url) c.style.backgroundImage = `url("${url}")`;
      });
    }
  } else if (n.emitter) n.emitter.update(l);

  // per-layer animations: one nested element per animation (mirrors the export)
  const animSig = JSON.stringify([l.anims, l.w, l.h]);
  if (animSig !== n.animSig) {
    n.animSig = animSig;
    n.anims.forEach((a) => a.anim?.cancel());
    // rebuild nesting
    o.innerHTML = '';
    n.gy = el('div', { class: 'gy' });
    o.append(n.gy);
    let parent = n.gy;
    n.anims = [];
    for (const a of (l.anims || []).filter((x) => x.enabled !== false)) {
      const wrap = el('div', { class: 'anim' });
      parent.append(wrap);
      n.anims.push({ el: wrap, anim: startAnim(wrap, a) });
      parent = wrap;
    }
    parent.append(c);
    applyGyro(l, n, p);
  }
}

const EASE = { easeInEaseOut: 'ease-in-out', linear: 'linear', easeIn: 'ease-in', easeOut: 'ease-out' };

function startAnim(target, a) {
  const keys = [...(a.keys || [])].sort((x, y) => x.t - y.t);
  if (keys.length < 2) return null;
  const frame = (v) => {
    switch (a.prop) {
      case 'x':
        return { transform: `translateX(${v}px)` };
      case 'y':
        return { transform: `translateY(${v}px)` };
      case 'scale':
        return { transform: `scale(${v})` };
      case 'rotation':
        return { transform: `rotate(${v}deg)` };
      case 'opacity':
        return { opacity: Math.max(0, Math.min(1, v)) };
      default:
        return {};
    }
  };
  const kf = keys.map((k) => ({ ...frame(Number(k.v)), offset: Math.max(0, Math.min(1, k.t)), easing: EASE[a.easing] || 'linear' }));
  kf[0].offset = 0;
  kf[kf.length - 1].offset = 1;
  const once = a.repeat === 'once';
  return target.animate(kf, {
    duration: Math.max(50, (Number(a.duration) || 1) * 1000),
    iterations: once ? 1 : Infinity,
    direction: a.autoreverse && !once ? 'alternate' : 'normal',
    delay: once ? (Number(a.delay) || 0) * 1000 : 0,
    iterationStart: 0,
    fill: 'both',
  });
}

async function startFrames(l, n) {
  const frames = l.video?.frames || [];
  const urls = await Promise.all(frames.map((f) => assetURL(f)));
  if (!urls.length) return;
  urls.forEach((u) => {
    const i = new Image();
    i.src = u;
  });
  const seq = l.video.sequence?.length ? l.video.sequence : urls.map((_, i) => i);
  const fps = Math.max(1, l.video.fps || 24);
  let i = 0;
  let dir = 1;
  n.content.style.backgroundImage = `url("${urls[seq[0]]}")`;
  if (seq.length < 2) return;
  n.timer = setInterval(() => {
    if (l.video.autoreverse) {
      if (i + dir >= seq.length || i + dir < 0) dir = -dir;
      i += dir;
    } else i = (i + 1) % seq.length;
    n.content.style.backgroundImage = `url("${urls[seq[i]]}")`;
  }, 1000 / fps);
}

// ---------------------------------------------------------------- particles (CAEmitterLayer approximation)

function startEmitter(l, n) {
  const canvas = el('canvas', { class: 'emitter-canvas' });
  n.content.append(canvas);
  const ctx = canvas.getContext('2d');
  let cfg = l;
  let sprite = null;
  let spriteKey = '';
  const parts = [];
  let last = performance.now();
  let carry = 0;
  let running = true;
  const loadSprite = () => {
    const key = `${cfg.emitter.particle}|${cfg.emitter.color}|${cfg.emitter.particleAsset || ''}`;
    if (key === spriteKey) return;
    spriteKey = key;
    layerBitmapURL(cfg).then((url) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0, 64, 64);
        if (!cfg.emitter.particleAsset) {
          x.globalCompositeOperation = 'source-in';
          x.fillStyle = cfg.emitter.color || '#fff';
          x.fillRect(0, 0, 64, 64);
        }
        sprite = c;
      };
      img.src = url;
    });
  };
  loadSprite();
  const frame = (now) => {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const e = cfg.emitter;
    const W = cfg.w;
    const H = cfg.h;
    const dpr = Math.min(2, devicePixelRatio || 1) * currentScale();
    if (canvas.width !== Math.round(W * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    carry += (e.birthRate || 0) * dt;
    const up = Math.sin((e.emissionLongitude || 0) * (Math.PI / 180)) < -0.3;
    while (carry >= 1 && parts.length < 1500) {
      carry -= 1;
      const ang = ((e.emissionLongitude || 0) + (Math.random() - 0.5) * (e.emissionRange || 0)) * (Math.PI / 180);
      const vel = (e.velocity || 0) + (Math.random() - 0.5) * 2 * (e.velocityRange || 0);
      const life = (e.lifetime || 1) * (1 + (Math.random() - 0.5) * 0.6);
      parts.push({
        x: Math.random() * W,
        y: e.shape === 'line' ? (up ? H + 10 : -10) : Math.random() * H,
        vx: Math.cos(ang) * vel,
        vy: Math.sin(ang) * vel,
        life,
        age: 0,
        a: 1,
        s: Math.max(0.02, (e.scale || 1) + (Math.random() - 0.5) * 2 * (e.scaleRange || 0)),
        r: Math.random() * Math.PI * 2,
        spin: (e.spin || 0) + (Math.random() - 0.5) * 2 * (e.spinRange || 0),
      });
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = e.additive ? 'lighter' : 'source-over';
    const size = e.size || 16;
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.age += dt;
      q.vx += (e.xAcceleration || 0) * dt;
      q.vy += (e.yAcceleration || 0) * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.r += q.spin * dt;
      q.a += (e.alphaSpeed || 0) * dt;
      if (q.age > q.life || q.a <= 0) {
        parts.splice(i, 1);
        continue;
      }
      if (!sprite) continue;
      const s = size * q.s;
      ctx.globalAlpha = Math.max(0, Math.min(1, q.a));
      ctx.save();
      ctx.translate(q.x, q.y);
      ctx.rotate(q.r);
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  n.emitter = { stop: () => (running = false), update: (nl) => ((cfg = nl), loadSprite()) };
}

// ---------------------------------------------------------------- selection overlay

function drawOverlay() {
  const l = selectedLayer();
  overlay.innerHTML = '';
  if (!l || l.hidden || store.view.mode === 'preview' || (store.view.progress > 0 && store.view.progress < 1)) return;
  const p = store.project;
  const e = valuesFor(l, p);
  const z = currentScale();
  const box = el('div', { class: 'sel-box' + (l.locked ? ' is-locked' : '') });
  box.style.left = `${e.x - (l.w * e.scale) / 2}px`;
  box.style.top = `${e.y - (l.h * e.scale) / 2}px`;
  box.style.width = `${l.w * e.scale}px`;
  box.style.height = `${l.h * e.scale}px`;
  box.style.transform = `rotate(${e.rotation}deg)`;
  if (!l.locked) {
    const sw = l.w * e.scale * z;
    const sh = l.h * e.scale * z;
    const hs = ['nw', 'ne', 'sw', 'se'];
    if (sw > 90) hs.push('n', 's');
    if (sh > 90) hs.push('e', 'w');
    box.classList.toggle('small', Math.min(sw, sh) < 50);
    for (const h of hs) box.append(el('div', { class: `h h-${h}`, 'data-handle': h }));
    box.append(el('div', { class: 'h h-rot', 'data-handle': 'rot' }));
  }
  overlay.append(box);
}

function writeProps(l, props) {
  const v = store.view;
  const dark = store.project.appearanceAware && v.dark && store.project.format === 'classic';
  if (v.state === 'Locked' && !dark) Object.assign(l, props);
  else {
    const k = stateKey(v.state, dark);
    l.states[k] = { ...(l.states[k] || {}), ...props };
  }
}

// ---------------------------------------------------------------- pointer handling

let lastTap = { x: 0, y: 0, t: 0 };

function onPointerDown(ev) {
  if (store.view.mode === 'preview') return onSwipeStart(ev);
  const p = store.project;
  if (!p || ev.button > 0) return;
  if (store.view.progress > 0 && store.view.progress < 1) setView({ progress: 0 });
  const handle = ev.target.closest('[data-handle]')?.dataset.handle;
  let layer = selectedLayer();
  if (!handle) {
    const stack = document
      .elementsFromPoint(ev.clientX, ev.clientY)
      .map((n) => n.closest?.('.layer'))
      .filter((n, i, a) => n && a.indexOf(n) === i && !n.classList.contains('locked') && n.style.visibility !== 'hidden')
      .map((n) => n.dataset.id);
    if (!stack.length) {
      select(null);
      return;
    }
    let id = stack[0];
    const same = Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 6 && performance.now() - lastTap.t < 1500;
    if (same && stack.includes(store.selection)) id = stack[(stack.indexOf(store.selection) + 1) % stack.length];
    else if (stack.includes(store.selection)) id = store.selection;
    lastTap = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    if (id !== store.selection) select(id);
    layer = p.layers.find((l) => l.id === id);
  }
  if (!layer || layer.locked) return;
  ev.preventDefault();
  phone.setPointerCapture(ev.pointerId);
  const z = currentScale();
  const start = valuesFor(layer, p);
  const sx = ev.clientX;
  const sy = ev.clientY;
  const w0 = layer.w;
  const h0 = layer.h;
  const rect = phone.getBoundingClientRect();
  const center = { x: rect.left + start.x * z, y: rect.top + start.y * z };
  const a0 = Math.atan2(sy - center.y, sx - center.x);
  const group = `drag-${performance.now()}`;
  const keepAspect = ['image', 'video'].includes(layer.kind);
  let moved = false;
  const move = (e) => {
    const dx = (e.clientX - sx) / z;
    const dy = (e.clientY - sy) / z;
    if (!moved && Math.hypot(dx, dy) < 2) return;
    moved = true;
    update((proj) => {
      const l = proj.layers.find((x) => x.id === layer.id);
      if (!handle) {
        let nx = start.x + dx;
        let ny = start.y + dy;
        const snap = 6 / z;
        if (Math.abs(nx - proj._w / 2) < snap) nx = proj._w / 2;
        if (Math.abs(ny - proj._h / 2) < snap) ny = proj._h / 2;
        writeProps(l, { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 });
      } else if (handle === 'rot') {
        const a = Math.atan2(e.clientY - center.y, e.clientX - center.x);
        let deg = start.rotation + ((a - a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        else if (Math.abs(deg - Math.round(deg / 90) * 90) < 3) deg = Math.round(deg / 90) * 90;
        writeProps(l, { rotation: Math.round(deg * 10) / 10 });
      } else {
        const r = (start.rotation * Math.PI) / 180;
        const lx = (dx * Math.cos(r) + dy * Math.sin(r)) / start.scale;
        const ly = (-dx * Math.sin(r) + dy * Math.cos(r)) / start.scale;
        const sxn = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
        const syn = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
        let nw = Math.max(4, w0 + sxn * lx);
        let nh = Math.max(4, h0 + syn * ly);
        if ((keepAspect || e.shiftKey) && sxn && syn) {
          const k = Math.max(nw / w0, nh / h0);
          nw = w0 * k;
          nh = h0 * k;
        }
        const cxl = (sxn * (nw - w0) * start.scale) / 2;
        const cyl = (syn * (nh - h0) * start.scale) / 2;
        l.w = Math.round(nw);
        l.h = Math.round(nh);
        writeProps(l, {
          x: Math.round((start.x + cxl * Math.cos(r) - cyl * Math.sin(r)) * 10) / 10,
          y: Math.round((start.y + cxl * Math.sin(r) + cyl * Math.cos(r)) * 10) / 10,
        });
      }
    }, group);
  };
  const up = () => {
    phone.removeEventListener('pointermove', move);
    phone.removeEventListener('pointerup', up);
    phone.removeEventListener('pointercancel', up);
  };
  phone.addEventListener('pointermove', move);
  phone.addEventListener('pointerup', up);
  phone.addEventListener('pointercancel', up);
}

// ---------------------------------------------------------------- lock screen gestures

function setLive(u) {
  live.u = u;
  render('gesture');
}

function animateLive(fromU, toU, ms, done) {
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    setLive(fromU + (toU - fromU) * e);
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

function finishAt(state) {
  live.u = null;
  setView({ state, progress: state === 'Unlock' ? 1 : 0 });
}

function onSwipeStart(ev) {
  const p = store.project;
  if (!p) return;
  ev.preventDefault();
  phone.setPointerCapture(ev.pointerId);
  const z = currentScale();
  const sy = ev.clientY;
  const st = store.view.state;
  if (st === 'Sleep') {
    // tap to wake
    finishAt('Locked');
    return;
  }
  const modern = p.format !== 'classic';
  const startU = st === 'Unlock' ? 1 : 0;
  live.from = 'Locked';
  live.to = 'Unlock';
  const dist = p._h * 0.45;
  let u = startU;
  const move = (e) => {
    const dy = (e.clientY - sy) / z;
    u = Math.max(0, Math.min(1, startU - dy / dist));
    phone.style.setProperty('--u', u);
    if (modern) setLive(u);
    else hintEl.style.opacity = String(1 - u);
  };
  const up = () => {
    phone.removeEventListener('pointermove', move);
    phone.removeEventListener('pointerup', up);
    phone.removeEventListener('pointercancel', up);
    hintEl.style.opacity = '';
    const target = startU === 0 ? (u > 0.35 ? 1 : 0) : u < 0.65 ? 0 : 1;
    if (modern) animateLive(u, target, 260 * Math.abs(target - u) + 60, () => finishAt(target ? 'Unlock' : 'Locked'));
    else finishAt(target ? 'Unlock' : 'Locked');
  };
  phone.addEventListener('pointermove', move);
  phone.addEventListener('pointerup', up);
  phone.addEventListener('pointercancel', up);
}

/** Plays Lock → Home → Lock like a real swipe. */
export function playUnlockDemo() {
  const p = store.project;
  if (!p) return;
  if (p.format === 'classic') {
    setView({ state: 'Locked', progress: 0 });
    setTimeout(() => setView({ state: 'Unlock', progress: 1 }), 600);
    setTimeout(() => setView({ state: 'Locked', progress: 0 }), 3000);
    return;
  }
  live.from = 'Locked';
  live.to = 'Unlock';
  setView({ state: 'Locked', progress: 0 });
  animateLive(0, 1, 900, () => {
    setTimeout(() => animateLive(1, 0, 900, () => finishAt('Locked')), 1200);
  });
}

// ---------------------------------------------------------------- tilt / gyro

/** gyro move (parallax wrapper), 3D tilt and fade (applied to the content chain root) */
function applyGyro(l, n, p) {
  const on = p.format !== 'classic';
  // same mapping as the export: main (x→x, y→y) + cross (x→y, y→x) translations
  let mx = 0, my = 0, cx = 0, cy = 0;
  if (on) {
    mx = my = l.parallax || 0;
    for (const m of l.gyroMoves || []) {
      if (m.axis === m.key) m.axis === 'x' ? (mx += m.n) : (my += m.n);
      else m.axis === 'x' ? (cx += m.n) : (cy += m.n);
    }
  }
  const tx = live.tiltX * mx + live.tiltY * cy;
  const ty = live.tiltY * my + live.tiltX * cx;
  n.px.style.transform = tx || ty ? `translate(${tx}px, ${ty}px)` : '';
  const g = on ? l.gyro || {} : {};
  const t = g.tilt || 0;
  const tv = g.tiltV ?? t;
  const fold = g.fold || 0;
  const parts = [];
  if (fold) parts.push(`rotateY(${((live.tiltX + 1) / 2) * fold}deg)`);
  if (t) parts.push(`rotateY(${live.tiltX * t}deg) rotateX(${-live.tiltY * tv}deg)`);
  n.tl.style.transform = parts.join(' ');
  const first = n.gy;
  if (!first) return;
  if (g.fade && g.fade !== 'none') {
    const axis = g.fade.replace('-', '');
    let u = ((axis === 'x' ? live.tiltX : live.tiltY) + 1) / 2;
    if (g.fade.startsWith('-')) u = 1 - u;
    const lo = g.fadeMin ?? 0;
    const hi = g.fadeMax ?? 1;
    first.style.opacity = String(Math.max(0, Math.min(1, lo + (hi - lo) * u)));
  } else first.style.opacity = '';
}

let motionOn = false;
function setTilt(x, y) {
  live.tiltX = Math.max(-1, Math.min(1, x));
  live.tiltY = Math.max(-1, Math.min(1, y));
  const p = store.project;
  if (!p) return;
  for (const l of p.layers) {
    const n = nodes.get(l.id);
    if (n) applyGyro(l, n, p);
  }
}

function onTiltMouse(e) {
  if (store.view.mode !== 'preview' || motionOn) return;
  // relative to the phone: its edges = full tilt (like holding the phone at the gyro range)
  const r = (stage.querySelector('.phone') || stage).getBoundingClientRect();
  setTilt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
}

export async function enableDeviceMotion() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') return false;
    }
    let base = null;
    window.addEventListener('deviceorientation', (e) => {
      if (store.view.mode !== 'preview' || e.gamma == null) return;
      base ||= { b: e.beta, g: e.gamma };
      setTilt((e.gamma - base.g) / 20, (e.beta - base.b) / 20);
    });
    motionOn = true;
    return true;
  } catch {
    return false;
  }
}

export function resetTilt() {
  setTilt(0, 0);
}
