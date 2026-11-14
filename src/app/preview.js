// Live preview stage: renders the project like PosterBoard would, simulates
// state transitions (spring), loops, frame sequences and particle emitters,
// and offers direct manipulation (move / resize / rotate) with touch & mouse.

import { store, update, select, selectedLayer, subscribe, setView } from './store.js';
import { effective, stateKey, PLANES } from '../core/model.js';
import { layerBitmapURL, assetURL } from './assets.js';
import { transitionCSS } from './spring.js';
import { el } from './dom.js';

let stage, phone, overlay, planesEl = {}, clockEl, homeEl;
const nodes = new Map(); // layer id -> {outer, content, sig, loopSig, anim, timer, emitter}
let fitScale = 1;
let lastStateKey = '';

export function mountPreview(root) {
  stage = root;
  phone = el('div', { class: 'phone', id: 'phone' });
  for (const p of PLANES) {
    planesEl[p.id] = el('div', { class: `plane plane-${p.id}`, 'data-plane': p.id });
  }
  clockEl = el('div', { class: 'ls-clock', 'aria-hidden': 'true' }, [
    el('div', { class: 'ls-date' }),
    el('div', { class: 'ls-time' }),
  ]);
  homeEl = el('div', { class: 'ls-home', 'aria-hidden': 'true' }, Array.from({ length: 24 }, () => el('i')));
  const chrome = el('div', { class: 'ls-chrome', 'aria-hidden': 'true' }, [
    el('div', { class: 'ls-island' }),
    el('div', { class: 'ls-btn ls-left' }, '🔦'),
    el('div', { class: 'ls-btn ls-right' }, '📷'),
    el('div', { class: 'ls-bar' }),
  ]);
  overlay = el('div', { class: 'sel-overlay' });
  phone.append(planesEl.background, clockEl, planesEl.floating, planesEl.foreground, homeEl, chrome, overlay);
  stage.append(phone);

  new ResizeObserver(() => layout()).observe(stage);
  phone.addEventListener('pointerdown', onPointerDown);
  subscribe(render);
  tickClock();
  setInterval(tickClock, 15000);
  render('project');
}

function tickClock() {
  const d = new Date();
  clockEl.querySelector('.ls-date').textContent = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  clockEl.querySelector('.ls-time').textContent = d.toLocaleTimeString('de-DE', { hour: 'numeric', minute: '2-digit' });
}

function layout() {
  const p = store.project;
  if (!p || !stage) return;
  const r = stage.getBoundingClientRect();
  const pad = 24;
  fitScale = Math.max(0.05, Math.min((r.width - pad) / p._w, (r.height - pad) / p._h));
  const z = store.view.zoom || fitScale;
  phone.style.width = `${p._w}px`;
  phone.style.height = `${p._h}px`;
  phone.style.transform = `translate(-50%, -50%) scale(${z})`;
  phone.style.setProperty('--z', z);
  phone.style.setProperty('--W', p._w);
  phone.style.setProperty('--H', p._h);
}

export const currentScale = () => store.view.zoom || fitScale;

function render(reason) {
  const p = store.project;
  if (!p) return;
  layout();
  const v = store.view;
  const sk = `${v.state}|${v.dark}`;
  const stateChanged = sk !== lastStateKey;
  lastStateKey = sk;
  phone.dataset.state = v.state;
  phone.classList.toggle('dark', v.dark);
  phone.classList.toggle('show-clock', v.clock);
  phone.classList.toggle('guides', v.guides);

  const seen = new Set();
  for (const plane of PLANES) {
    const host = planesEl[plane.id];
    const layers = p.layers.filter((l) => l.plane === plane.id);
    layers.forEach((l, i) => {
      seen.add(l.id);
      let n = nodes.get(l.id);
      if (!n) {
        const outer = el('div', { class: 'layer', 'data-id': l.id });
        const content = el('div', { class: 'content' });
        outer.append(content);
        n = { outer, content, sig: '', loopSig: '' };
        nodes.set(l.id, n);
      }
      if (n.outer.parentNode !== host || host.children[i] !== n.outer) host.insertBefore(n.outer, host.children[i] || null);
      paintLayer(l, n, p, stateChanged && reason !== 'project');
    });
  }
  for (const [id, n] of nodes) {
    if (!seen.has(id)) {
      stopNode(n);
      n.outer.remove();
      nodes.delete(id);
    }
  }
  if (stateChanged) {
    const t = transitionCSS(p.transition);
    phone.style.setProperty('--tdur', `${t.duration}s`);
    phone.style.setProperty('--tease', t.easing);
  }
  drawOverlay();
}

function stopNode(n) {
  n.anim?.cancel();
  clearInterval(n.timer);
  if (n.emitter) n.emitter.stop();
}

function paintLayer(l, n, p, animate) {
  const v = store.view;
  const e = effective(l, v.state, p.appearanceAware && v.dark);
  const o = n.outer;
  if (animate) {
    const t = transitionCSS(l.transition || p.transition);
    o.style.transition = ['left', 'top', 'transform', 'opacity'].map((k) => `${k} ${t.duration}s ${t.easing}`).join(', ');
    clearTimeout(n.tt);
    n.tt = setTimeout(() => (o.style.transition = ''), t.duration * 1000 + 50);
  } else if (!n.tt) o.style.transition = '';
  o.style.left = `${e.x - l.w / 2}px`;
  o.style.top = `${e.y - l.h / 2}px`;
  o.style.width = `${l.w}px`;
  o.style.height = `${l.h}px`;
  o.style.opacity = e.opacity;
  o.style.transform = `rotate(${e.rotation}deg) scale(${e.scale})`;
  o.style.borderRadius = l.cornerRadius ? `${l.cornerRadius}px` : '';
  o.style.overflow = l.cornerRadius ? 'hidden' : '';
  o.style.visibility = l.hidden ? 'hidden' : '';
  o.classList.toggle('locked', !!l.locked);
  o.classList.toggle('selected', l.id === store.selection);

  const c = n.content;
  c.style.backgroundSize = l.kind === 'image' || l.kind === 'video' ? { cover: 'cover', contain: 'contain', stretch: '100% 100%' }[l.fit] : '100% 100%';

  // content bitmap
  const sig = JSON.stringify([l.kind, l.asset, l.color, l.gradient, l.text, l.shape, l.w, l.h, l.video?.frames?.length, l.video?.fps, l.video?.autoreverse, l.emitter]);
  if (sig !== n.sig) {
    n.sig = sig;
    clearInterval(n.timer);
    n.emitter?.stop();
    n.emitter = null;
    c.innerHTML = '';
    c.style.backgroundImage = '';
    if (l.kind === 'emitter') {
      startEmitter(l, n);
    } else if (l.kind === 'video') {
      startFrames(l, n);
    } else {
      const want = sig;
      layerBitmapURL(l).then((url) => {
        if (n.sig === want && url) c.style.backgroundImage = `url("${url}")`;
      });
    }
  } else if (n.emitter) n.emitter.update(l);

  // loop
  const loopSig = JSON.stringify([l.loop, l.w, l.h]);
  if (loopSig !== n.loopSig) {
    n.loopSig = loopSig;
    n.anim?.cancel();
    n.anim = startLoop(c, l);
  }
}

function startLoop(target, l) {
  const lp = l.loop || {};
  const d = Math.max(0.05, Number(lp.duration) || 4) * 1000;
  const a = Number(lp.amount) || 0;
  const alt = lp.autoreverse ? 'alternate' : 'normal';
  const ease = 'ease-in-out';
  switch (lp.type) {
    case 'rotate':
      return target.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${360 * (a || 1)}deg)` }], { duration: d, iterations: Infinity, easing: 'linear' });
    case 'pulse':
      return target.animate([{ transform: 'scale(1)' }, { transform: `scale(${1 + a / 100})` }], { duration: d, iterations: Infinity, direction: alt, easing: ease });
    case 'float':
      return target.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-a}px)` }], { duration: d, iterations: Infinity, direction: alt, easing: ease });
    case 'drift':
      return target.animate([{ transform: `translateX(${-a / 2}px)` }, { transform: `translateX(${a / 2}px)` }], { duration: d, iterations: Infinity, direction: alt, easing: ease });
    case 'sway':
      return target.animate([{ transform: `rotate(${-a}deg)` }, { transform: `rotate(${a}deg)` }], { duration: d, iterations: Infinity, direction: alt, easing: ease });
    case 'fade':
      return target.animate([{ opacity: 1 }, { opacity: a / 100 }], { duration: d, iterations: Infinity, direction: alt, easing: ease });
    case 'blink':
      return target.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: a / 100, offset: 0.5 }, { opacity: a / 100, offset: 0.75 }, { opacity: 1, offset: 0.75 }], { duration: d, iterations: Infinity });
    default:
      return null;
  }
}

async function startFrames(l, n) {
  const frames = l.video?.frames || [];
  const urls = await Promise.all(frames.map((f) => assetURL(f)));
  if (!urls.length) return;
  // preload
  urls.forEach((u) => {
    const i = new Image();
    i.src = u;
  });
  const fps = Math.max(1, l.video.fps || 24);
  let i = 0;
  let dir = 1;
  n.content.style.backgroundImage = `url("${urls[0]}")`;
  n.timer = setInterval(() => {
    if (l.video.autoreverse && urls.length > 1) {
      if (i + dir >= urls.length || i + dir < 0) dir = -dir;
      i += dir;
    } else i = (i + 1) % urls.length;
    n.content.style.backgroundImage = `url("${urls[i]}")`;
  }, 1000 / fps);
}

// ---------- particle simulation (approximation of CAEmitterLayer) ----------

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
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = cfg.emitter.color || '#fff';
        if (!cfg.emitter.particleAsset) x.fillRect(0, 0, 64, 64);
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
        x: e.shape === 'line' ? Math.random() * W : Math.random() * W,
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
  n.emitter = {
    stop: () => (running = false),
    update: (nl) => {
      cfg = nl;
      loadSprite();
    },
  };
}

// ---------- selection overlay + direct manipulation ----------

function drawOverlay() {
  const l = selectedLayer();
  overlay.innerHTML = '';
  if (!l || l.hidden) return;
  const v = store.view;
  const e = effective(l, v.state, store.project.appearanceAware && v.dark);
  const box = el('div', { class: 'sel-box' + (l.locked ? ' is-locked' : '') });
  box.style.left = `${e.x - (l.w * e.scale) / 2}px`;
  box.style.top = `${e.y - (l.h * e.scale) / 2}px`;
  box.style.width = `${l.w * e.scale}px`;
  box.style.height = `${l.h * e.scale}px`;
  box.style.transform = `rotate(${e.rotation}deg)`;
  if (!l.locked) {
    // keep the middle of small boxes free for dragging: fewer handles when the box is small on screen
    const z = currentScale();
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

/** write animatable props either to the base or the active state override */
function writeProps(l, props) {
  const v = store.view;
  const dark = store.project.appearanceAware && v.dark;
  if (v.state === 'Locked' && !dark) {
    Object.assign(l, props);
  } else {
    const k = stateKey(v.state, dark);
    l.states[k] = { ...(l.states[k] || {}), ...props };
  }
}

let lastTap = { x: 0, y: 0, t: 0, ids: [] };

function onPointerDown(ev) {
  const p = store.project;
  if (!p || ev.button > 0) return;
  const handle = ev.target.closest('[data-handle]')?.dataset.handle;
  let layer = selectedLayer();
  if (!handle) {
    // pick: topmost layer under the pointer; tapping again at the same spot cycles downwards
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
    if (same && stack.includes(store.selection)) {
      id = stack[(stack.indexOf(store.selection) + 1) % stack.length];
    } else if (stack.includes(store.selection)) {
      id = store.selection; // keep dragging the selected layer even if it is underneath
    }
    lastTap = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    if (id !== store.selection) select(id);
    layer = p.layers.find((l) => l.id === id);
  }
  if (!layer || layer.locked) return;
  ev.preventDefault();
  phone.setPointerCapture(ev.pointerId);

  const z = currentScale();
  const v = store.view;
  const start = effective(layer, v.state, p.appearanceAware && v.dark);
  const sx = ev.clientX;
  const sy = ev.clientY;
  const w0 = layer.w;
  const h0 = layer.h;
  const rect = phone.getBoundingClientRect();
  const center = { x: rect.left + start.x * z, y: rect.top + start.y * z };
  const a0 = Math.atan2(sy - center.y, sx - center.x);
  const group = `drag-${performance.now()}`;
  const keepAspect = layer.kind === 'image' || layer.kind === 'video';
  const moved = { v: false };

  const move = (e) => {
    const dx = (e.clientX - sx) / z;
    const dy = (e.clientY - sy) / z;
    if (!moved.v && Math.hypot(dx, dy) < 2) return;
    moved.v = true;
    update((proj) => {
      const l = proj.layers.find((x) => x.id === layer.id);
      if (!handle) {
        let nx = start.x + dx;
        let ny = start.y + dy;
        // snapping to centre / edges
        const snap = 6 / z;
        if (Math.abs(nx - proj._w / 2) < snap) nx = proj._w / 2;
        if (Math.abs(ny - proj._h / 2) < snap) ny = proj._h / 2;
        writeProps(l, { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 });
      } else if (handle === 'rot') {
        const a = Math.atan2(e.clientY - center.y, e.clientX - center.x);
        let deg = start.rotation + ((a - a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        else if (Math.abs(deg - Math.round(deg / 90) * 90) < 3) deg = Math.round(deg / 90) * 90; // magnetic right angles
        writeProps(l, { rotation: Math.round(deg * 10) / 10 });
      } else {
        // resize in the layer's local (rotated) space, anchored at the opposite edge
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
        const dw = (nw - w0) * start.scale;
        const dh = (nh - h0) * start.scale;
        const cxl = (sxn * dw) / 2;
        const cyl = (syn * dh) / 2;
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

/** Plays Locked → Unlock → Locked like a real unlock gesture. */
export function playUnlockDemo() {
  const v = store.view;
  setView({ state: 'Locked' });
  setTimeout(() => setView({ state: 'Unlock' }), 700);
  setTimeout(() => setView({ state: 'Locked' }), 3200);
  return v;
}
