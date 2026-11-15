// Renders non-image layers (color, gradient, text, shape, particles) into bitmaps.
// Everything is rasterised to PNG for export: plain CALayer + CGImage contents is
// the most robust thing PosterBoard renders on every iOS version.

const MAX_PX = 4096;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export const canvasToBlob = (c, type = 'image/png', q = 0.92) =>
  new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), type, q));

function pxSize(layer, scale) {
  let w = layer.w * scale;
  let h = layer.h * scale;
  const f = Math.min(1, MAX_PX / Math.max(w, h));
  return [Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f))];
}

function drawGradient(ctx, g, W, H) {
  let grad;
  if (g.type === 'radial') {
    grad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.hypot(W, H) / 2);
  } else if (g.type === 'conic' && ctx.createConicGradient) {
    grad = ctx.createConicGradient(((g.angle || 0) - 90) * (Math.PI / 180), W / 2, H / 2);
  } else {
    const a = ((g.angle ?? 180) - 90) * (Math.PI / 180);
    const r = (Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a))) / 2;
    grad = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
  }
  for (const s of g.stops || []) grad.addColorStop(Math.max(0, Math.min(1, s.p)), s.c);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function starPath(ctx, cx, cy, r, inner, n) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = (i * Math.PI) / n - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function shapePath(ctx, s, W, H, inset) {
  const x = inset;
  const y = inset;
  const w = W - inset * 2;
  const h = H - inset * 2;
  ctx.beginPath();
  switch (s.type) {
    case 'rect':
      ctx.rect(x, y, w, h);
      break;
    case 'rounded': {
      const r = Math.min(w, h) * 0.22;
      ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
      break;
    }
    case 'star':
      starPath(ctx, W / 2, H / 2, Math.min(w, h) / 2, 0.45, s.points || 5);
      break;
    case 'polygon':
      for (let i = 0; i < (s.points || 6); i++) {
        const a = (i * 2 * Math.PI) / (s.points || 6) - Math.PI / 2;
        ctx.lineTo(W / 2 + (Math.cos(a) * w) / 2, H / 2 + (Math.sin(a) * h) / 2);
      }
      ctx.closePath();
      break;
    case 'heart': {
      const cx = W / 2;
      ctx.moveTo(cx, y + h * 0.28);
      ctx.bezierCurveTo(cx, y, x, y, x, y + h * 0.32);
      ctx.bezierCurveTo(x, y + h * 0.6, cx, y + h * 0.78, cx, y + h);
      ctx.bezierCurveTo(cx, y + h * 0.78, x + w, y + h * 0.6, x + w, y + h * 0.32);
      ctx.bezierCurveTo(x + w, y, cx, y, cx, y + h * 0.28);
      ctx.closePath();
      break;
    }
    case 'ring':
    case 'ellipse':
    default:
      ctx.ellipse(W / 2, H / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  }
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxW && line.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function fontFamilyFor(t) {
  return t.fontAsset ? `"tf-${t.fontAsset}", ${t.font || 'system-ui'}` : t.font || 'system-ui';
}

/** Draw a layer's content (not its transform) onto a new canvas. */
export function renderLayerCanvas(layer, scale = 3) {
  const [W, H] = pxSize(layer, scale);
  const s = W / layer.w;
  if (layer.kind === 'color') {
    const c = makeCanvas(8, 8);
    const ctx = c.getContext('2d');
    ctx.fillStyle = layer.color;
    ctx.fillRect(0, 0, 8, 8);
    return c;
  }
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  if (layer.kind === 'gradient') {
    drawGradient(ctx, layer.gradient, W, H);
  } else if (layer.kind === 'shape') {
    const sh = layer.shape;
    const sw = (sh.strokeWidth || 0) * s;
    const blur = (sh.blur || 0) * s;
    const inset = sw / 2 + blur * 2 + 1;
    if (blur) ctx.filter = `blur(${blur}px)`;
    shapePath(ctx, sh, W, H, inset);
    if (sh.type === 'ring') {
      ctx.lineWidth = Math.max(2 * s, sw || Math.min(W, H) * 0.08);
      ctx.strokeStyle = sh.fill;
      ctx.stroke();
    } else {
      if (sh.gradient) {
        ctx.save();
        ctx.clip();
        drawGradient(ctx, sh.gradient, W, H);
        ctx.restore();
      } else {
        ctx.fillStyle = sh.fill;
        ctx.fill();
      }
      if (sw > 0) {
        ctx.lineWidth = sw;
        ctx.strokeStyle = sh.stroke;
        ctx.stroke();
      }
    }
  } else if (layer.kind === 'text') {
    const t = layer.text;
    const size = t.size * s;
    ctx.font = `${t.italic ? 'italic ' : ''}${t.weight || 400} ${size}px ${fontFamilyFor(t)}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(t.letterSpacing || 0) * s}px`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = t.align || 'center';
    ctx.fillStyle = t.color;
    if (t.shadow) {
      ctx.shadowColor = `rgba(0,0,0,${t.shadow})`;
      ctx.shadowBlur = size * 0.25;
      ctx.shadowOffsetY = size * 0.05;
    }
    const lines = wrapLines(ctx, t.content, W - 4);
    const lh = size * (t.lineHeight || 1.15);
    const total = lh * lines.length;
    const x = t.align === 'left' ? 2 : t.align === 'right' ? W - 2 : W / 2;
    lines.forEach((ln, i) => ctx.fillText(ln, x, H / 2 - total / 2 + lh * (i + 0.5)));
  }
  return c;
}

/** 64×64 white particle bitmap; the emitter cell colour tints it. */
export function renderParticleCanvas(kind = 'dot') {
  const c = makeCanvas(64, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  switch (kind) {
    case 'star':
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 10;
      starPath(ctx, 32, 32, 22, 0.32, 4);
      ctx.fill();
      break;
    case 'streak': {
      const g = ctx.createLinearGradient(32, 0, 32, 64);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = g;
      ctx.fillRect(30, 0, 4, 64);
      break;
    }
    case 'ring':
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(24, 22, 6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(18, 10, 28, 44);
      break;
    case 'petal':
      ctx.beginPath();
      ctx.ellipse(32, 32, 14, 26, 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dot':
    default: {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
  }
  return c;
}

/**
 * Glass rim: tint + inner border highlight + top shine, drawn over a (baked or live) blurred backdrop.
 * @param {CanvasImageSource|null} backdrop  pre-cropped backdrop (baked frosted glass) or null
 */
export function renderGlassCanvas(layer, scale = 3, backdrop = null) {
  const g = layer.glass || {};
  const [W, H] = pxSize(layer, scale);
  const s = W / layer.w;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const r = Math.min((layer.cornerRadius || 0) * s, W / 2, H / 2);
  const clip = () => {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(0, 0, W, H, r) : ctx.rect(0, 0, W, H);
  };
  ctx.save();
  clip();
  ctx.clip();
  if (backdrop) {
    const pad = (g.blur || 0) * s * 2;
    ctx.filter = `blur(${(g.blur || 0) * s}px) saturate(${g.saturation ?? 1.4})`;
    ctx.drawImage(backdrop, -pad, -pad, W + pad * 2, H + pad * 2);
    ctx.filter = 'none';
  }
  // tint
  ctx.globalAlpha = g.tintOpacity ?? 0.15;
  ctx.fillStyle = g.tint || '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  // top shine
  if (g.shine) {
    const sh = ctx.createLinearGradient(0, 0, 0, H);
    sh.addColorStop(0, `rgba(255,255,255,${0.55 * g.shine})`);
    sh.addColorStop(0.45, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  // rim (brighter top-left, darker bottom-right like iOS glass)
  if (g.border) {
    const lw = Math.max(1, 1.2 * s);
    const rim = ctx.createLinearGradient(0, 0, W, H);
    rim.addColorStop(0, `rgba(255,255,255,${0.9 * g.border})`);
    rim.addColorStop(0.5, `rgba(255,255,255,${0.15 * g.border})`);
    rim.addColorStop(1, `rgba(255,255,255,${0.6 * g.border})`);
    ctx.lineWidth = lw;
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(lw / 2, lw / 2, W - lw, H - lw, Math.max(0, r - lw / 2)) : ctx.rect(lw / 2, lw / 2, W - lw, H - lw);
    ctx.stroke();
  }
  return c;
}

/** Signature of everything that influences a layer's bitmap (for caching). */
export function contentSignature(layer) {
  switch (layer.kind) {
    case 'image':
      return `img:${layer.asset}`;
    case 'color':
      return `col:${layer.color}`;
    case 'gradient':
      return `grad:${layer.w}x${layer.h}:${JSON.stringify(layer.gradient)}`;
    case 'text':
      return `txt:${layer.w}x${layer.h}:${JSON.stringify(layer.text)}`;
    case 'shape':
      return `shp:${layer.w}x${layer.h}:${JSON.stringify(layer.shape)}`;
    case 'emitter':
      return `pt:${layer.emitter?.particle}:${layer.emitter?.particleAsset || ''}`;
    case 'video':
      return `vid:${(layer.video?.frames || []).join(',')}`;
    case 'glass':
      return `gls:${layer.w}x${layer.h}:${layer.cornerRadius}:${JSON.stringify(layer.glass)}`;
    default:
      return layer.kind;
  }
}

/** Load a Blob into an HTMLImageElement / ImageBitmap-like drawable. */
export async function blobToImage(blob) {
  if (globalThis.createImageBitmap) {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through (e.g. HEIC on some browsers) */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Normalise an imported image: re-encode HEIC/WebP/huge images to PNG/JPEG. */
export async function normaliseImage(blob, { maxPx = MAX_PX } = {}) {
  const img = await blobToImage(blob);
  const w = img.width;
  const h = img.height;
  const ok = (blob.type === 'image/png' || blob.type === 'image/jpeg') && Math.max(w, h) <= maxPx;
  if (ok) return { blob, w, h };
  const f = Math.min(1, maxPx / Math.max(w, h));
  const c = makeCanvas(w * f, h * f);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const type = blob.type === 'image/jpeg' || blob.type === 'image/heic' ? 'image/jpeg' : 'image/png';
  return { blob: await canvasToBlob(c, type), w: c.width, h: c.height };
}
