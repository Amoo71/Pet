// Import existing .tendies into editable projects (best effort).
// Supports LayeredAnimation (LKStates) and ParameterizedCA (wallpaperPropertyGroups +
// wallpaperParallaxGroups), image layers, frame sequences, blend modes and filters.
// CAML is y-up; the editor is y-down → y = H - y, rotation = -rotation.

import { readZip } from '../core/zip.js';
import { parsePlist } from '../core/plist.js';
import { newProject, newLayer, uid, ANIMATABLE } from '../core/model.js';
import { DEVICES } from '../core/devices.js';

const mime = (p) => (/\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.heic$/i.test(p) ? 'image/heic' : 'image/png');
const nums = (s) => String(s || '').trim().split(/[\s,]+/).map(Number);
const RAD = 180 / Math.PI;

function parseTransform(s) {
  const out = { rot: 0, scale: 1 };
  if (!s) return out;
  const r = /rotate\(\s*(-?[\d.e-]+)deg\s*\)/.exec(s);
  if (r) out.rot = Number(r[1]);
  const sc = /scale\(\s*(-?[\d.e-]+)/.exec(s);
  if (sc) out.scale = Number(sc[1]);
  return out;
}

function planeOf(caName, wp) {
  const d = wp?.assets?.lockAndHome?.default || {};
  if (caName === d.floatingAnimationFileNameKey || caName === d.foregroundAnimationFileName || /_Floating|_Foreground/i.test(caName)) return 'floating';
  return 'background';
}

export async function importTendies(buf, storeAsset) {
  const files = await readZip(buf);
  const paths = [...files.keys()];
  const warnings = [];
  const dec = new TextDecoder();
  let wallpapers = paths.filter((p) => /\.wallpaper\/Wallpaper\.plist$/i.test(p));
  if (!wallpapers.length) {
    if (!paths.some((p) => /\.ca\/main\.caml$/i.test(p))) throw new Error('No PosterBoard wallpaper found in this file.');
    wallpapers = [null];
  }
  const projects = [];
  for (const wpPath of wallpapers) {
    const wpDir = wpPath ? wpPath.replace(/Wallpaper\.plist$/i, '') : '';
    let wp = null;
    try {
      wp = wpPath ? parsePlist(files.get(wpPath)) : null;
    } catch {
      warnings.push('Could not read Wallpaper.plist.');
    }
    const parameterized = wp?.assets?.lockAndHome?.default?.type === 'ParameterizedCA';
    const cls = wp?.logicalScreenClass || '';
    const m = /^(\d+)w-(\d+)h@(\d)x/.exec(cls);
    const dev = m && DEVICES.find((d) => d.w === +m[1] && d.h === +m[2]);
    const proj = newProject(dev?.id || DEVICES[2].id, dev || DEVICES[2]);
    proj.format = parameterized ? 'modern' : 'classic';
    proj.name = (wp?.name && !['Lavender', 'Chip'].includes(wp.name) ? wp.name : '') || wpDir.split('/').filter(Boolean).pop()?.replace(/\.wallpaper$/, '').replace(/^\d+\./, '') || 'Imported';
    proj.appearanceAware = !!wp?.appearanceAware && !parameterized;

    let docW = 0;
    let docH = 0;
    const caMain = paths.filter((p) => p.startsWith(wpDir) && /\.ca\/main\.caml$/i.test(p));
    for (const mainPath of caMain) {
      const caDir = mainPath.replace(/main\.caml$/i, '');
      const caName = caDir.split('/').filter(Boolean).pop();
      const xml = dec.decode(files.get(mainPath));
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const root = doc.documentElement.firstElementChild;
      if (!root) continue;
      const [, , rw, rh] = nums(root.getAttribute('bounds'));
      const H = rh || proj._h;
      docW = Math.max(docW, rw || 0);
      docH = Math.max(docH, rh || 0);
      if (/LKState name="[^"]+ (Light|Dark)"/.test(xml)) proj.appearanceAware = true;

      const byId = new Map(); // CA id -> editor layer
      const byName = new Map(); // CA layer name -> [{layer, opacityAttr}]
      const resolve = async (s) => {
        const bytes = files.get(caDir + s);
        return bytes ? storeAsset(new Blob([bytes], { type: mime(s) })) : null;
      };
      const walk = async (el, ox, oy, op, chain, plane) => {
        for (const child of el.querySelectorAll(':scope > sublayers > *')) {
          const tag = child.tagName;
          const name = child.getAttribute('name') || '';
          let pl = plane;
          if (name === 'BACKGROUND') pl = 'background';
          if (name === 'FLOATING' || name === 'FOREGROUND') pl = 'floating';
          const [, , w, h] = nums(child.getAttribute('bounds'));
          const [px, py] = nums(child.getAttribute('position'));
          const anchor = child.hasAttribute('anchorPoint') ? nums(child.getAttribute('anchorPoint')) : [0.5, 0.5];
          const cx = ox + (px || 0) + (0.5 - anchor[0]) * (w || 0);
          const cy = oy + (py || 0) + (0.5 - anchor[1]) * (h || 0);
          const opAttr = child.hasAttribute('opacity') ? Number(child.getAttribute('opacity')) : 1;
          const tr = parseTransform(child.getAttribute('transform'));
          const link = { name, opAttr, el: child };
          const nextChain = [...chain, link];
          if (tag === 'CAEmitterLayer') {
            warnings.push(`Particle layer “${name}” was skipped.`);
            continue;
          }
          if (tag === 'CABackdropLayer') {
            const l = newLayer('glass', proj, { name: name || 'Glass', plane: pl, x: cx, y: H - cy, w: w || 100, h: h || 100, cornerRadius: Number(child.querySelector('CASDFElementLayer')?.getAttribute('cornerRadius')) || Number(child.getAttribute('cornerRadius')) || 0, glass: { mode: child.querySelector('CASDFLayer') ? 'liquid' : 'live', blur: 20, tint: '#ffffff', tintOpacity: 0.1, border: 0.4, saturation: 1.4, shine: 0.3, refraction: 80 } });
            proj.layers.push(l);
            for (const c of nextChain) (byName.get(c.name) || byName.set(c.name, []).get(c.name)).push({ layer: l, opAttr: c.opAttr });
            const id = child.getAttribute('id');
            if (id) byId.set(id, l);
            continue;
          }
          const img = child.querySelector(':scope > contents > CGImage, :scope > contents[src]');
          const src = img?.getAttribute('src');
          const frameAnim = child.querySelector(':scope > animations > [keyPath="contents"]');
          if (src || frameAnim) {
            let layer;
            if (frameAnim) {
              const srcs = [...frameAnim.querySelectorAll('values > CGImage')].map((n) => n.getAttribute('src'));
              const uniq = [...new Set(srcs)];
              const ids = await Promise.all(uniq.map(resolve));
              const frames = ids.filter(Boolean);
              const dur = Number(frameAnim.getAttribute('duration')) || srcs.length / 24;
              layer = newLayer('video', proj, { video: { frames, sequence: srcs.map((s) => uniq.indexOf(s)), fps: Math.max(1, Math.round(srcs.length / dur)) || 24, autoreverse: frameAnim.getAttribute('autoreverses') === '1', calc: frameAnim.getAttribute('calculationMode') === 'linear' ? 'linear' : 'discrete' } });
            } else {
              const asset = await resolve(src);
              if (!asset) {
                warnings.push(`Image ${src} is missing from the archive.`);
                continue;
              }
              layer = newLayer('image', proj, { asset });
            }
            const grav = child.getAttribute('contentsGravity');
            const cum = nextChain.reduce((s, c) => s * c.opAttr, op);
            const rot = nextChain.reduce((s, c) => s + parseTransform(c.el.getAttribute('transform')).rot, 0);
            const blend = [...nextChain].reverse().map((c) => c.el.querySelector(':scope > compositingFilter')?.getAttribute('filter')).find(Boolean);
            const blur = [...nextChain].reverse().map((c) => c.el.querySelector(':scope > filters > [filter="gaussianBlur"]')?.getAttribute('inputRadius')).find(Boolean);
            Object.assign(layer, {
              plane: pl,
              name: (name && !/ (Content|Rim)$/.test(name) ? name : nextChain.map((c) => c.name).find((n) => n && !/^(BACKGROUND|FLOATING|FOREGROUND|Root Layer)$/.test(n) && !/ (Parallax|Anim \d+|Content|Rim)$/.test(n))) || layer.name,
              x: cx,
              y: H - cy,
              w: w || proj._w,
              h: h || proj._h,
              opacity: cum,
              rotation: -rot,
              scale: tr.scale,
              hidden: child.getAttribute('hidden') === '1',
              fit: grav === 'resizeAspectFill' ? 'cover' : grav === 'resizeAspect' ? 'contain' : 'stretch',
              cornerRadius: Number(child.getAttribute('cornerRadius')) || 0,
              blend: blend || 'normal',
              filters: { blur: Number(blur) || 0, hue: 0, saturate: 1, contrast: 1 },
            });
            proj.layers.push(layer);
            for (const c of nextChain) (byName.get(c.name) || byName.set(c.name, []).get(c.name)).push({ layer, opAttr: c.opAttr });
            for (const c of nextChain) {
              const id = c.el.getAttribute('id');
              if (id && !byId.has(id)) byId.set(id, layer);
            }
          }
          if (nextChain.length < 10) await walk(child, cx - (w || 0) / 2, cy - (h || 0) / 2, op, nextChain, pl);
        }
      };
      await walk(root, 0, 0, 1, [], planeOf(caName, wp));

      // LayeredAnimation states
      for (const st of root.querySelectorAll(':scope > states > LKState')) {
        const mm = /^(Locked|Unlock|Sleep)(?: (Light|Dark))?$/.exec(st.getAttribute('name') || '');
        if (!mm) continue;
        const key = mm[2] === 'Dark' ? `${mm[1]}@dark` : mm[1];
        for (const sv of st.querySelectorAll('LKStateSetValue')) {
          const layer = byId.get(sv.getAttribute('targetId'));
          const kp = sv.getAttribute('keyPath');
          const val = sv.querySelector('value');
          if (!layer || !val) continue;
          const def = ANIMATABLE.find((a) => a.keyPath === kp || a.pcaKeyPath === kp);
          if (!def) continue;
          let v = Number(val.getAttribute('value'));
          if (def.id === 'y') v = H - v;
          if (def.id === 'rotation') v = -v * RAD;
          if (key === 'Locked') layer[def.id] = v;
          else (layer.states[key] ||= {})[def.id] = v;
        }
      }

      // ParameterizedCA property + parallax groups (matched by layer name)
      const style = root.querySelector(':scope > style');
      if (style) {
        const val = (d, k) => {
          const n = d.querySelector(`:scope > ${k}`);
          return n ? n.getAttribute('value') : null;
        };
        for (const d of style.querySelectorAll(':scope > wallpaperPropertyGroups > NSDictionary')) {
          const targets = byName.get(val(d, 'layerName')) || [];
          const kp = val(d, 'keyPath');
          const vl = Number(val(d, 'v_lock'));
          const vh = Number(val(d, 'v_home'));
          const vs = Number(val(d, 'v_sleep'));
          for (const { layer, opAttr } of targets) {
            const set = (st, prop, v) => (layer.states[st] ||= {})[prop] = Math.round(v * 1000) / 1000;
            if (kp === 'position.x') {
              set('Unlock', 'x', layer.x + (vh - vl));
              set('Sleep', 'x', layer.x + (vs - vl));
            } else if (kp === 'position.y') {
              set('Unlock', 'y', layer.y - (vh - vl));
              set('Sleep', 'y', layer.y - (vs - vl));
            } else if (kp === 'opacity') {
              const rest = opAttr > 0 ? layer.opacity / opAttr : 1;
              layer.opacity = rest * vl;
              set('Unlock', 'opacity', rest * vh);
              set('Sleep', 'opacity', rest * vs);
            } else if (kp?.startsWith('transform.scale')) {
              const k = vl || 1;
              set('Unlock', 'scale', (layer.scale * vh) / k);
              set('Sleep', 'scale', (layer.scale * vs) / k);
            } else if (kp === 'transform.rotation.z') {
              set('Unlock', 'rotation', layer.rotation - (vh - vl) * RAD);
              set('Sleep', 'rotation', layer.rotation - (vs - vl) * RAD);
            }
          }
        }
        for (const d of style.querySelectorAll(':scope > wallpaperParallaxGroups > NSDictionary')) {
          const n = Math.max(Math.abs(Number(val(d, 'mapMaxTo')) || 0), Math.abs(Number(val(d, 'mapMinTo')) || 0));
          for (const { layer } of byName.get(val(d, 'layerName')) || []) layer.parallax = Math.max(layer.parallax || 0, n);
        }
      }
    }
    // drop overrides identical to base values
    for (const l of proj.layers) {
      for (const [k, v] of Object.entries(l.states)) {
        for (const p of Object.keys(v)) if (!k.includes('@') && Math.abs(v[p] - l[p]) < 1e-6) delete v[p];
        if (!Object.keys(v).length) delete l.states[k];
      }
    }
    if (docW && docH && (docW !== proj._w || docH !== proj._h)) {
      const d = DEVICES.find((x) => x.w === docW && x.h === docH);
      if (d) {
        proj.device = d.id;
        proj._w = d.w;
        proj._h = d.h;
      } else {
        // scale foreign canvases (e.g. 3176² or 1216×2160 CAPlayground docs) to cover the device
        const s = Math.max(proj._w / docW, proj._h / docH);
        const mx = (x) => proj._w / 2 + (x - docW / 2) * s;
        const my = (y) => proj._h / 2 + (y - docH / 2) * s;
        for (const l of proj.layers) {
          l.x = mx(l.x);
          l.y = my(l.y);
          l.w *= s;
          l.h *= s;
          l.parallax = Math.round((l.parallax || 0) * s);
          for (const v of Object.values(l.states)) {
            if ('x' in v) v.x = mx(v.x);
            if ('y' in v) v.y = my(v.y);
          }
        }
        warnings.push(`Canvas ${docW}×${docH} was scaled to the device.`);
      }
    }
    if (!proj.layers.length) warnings.push(`“${proj.name}”: no importable image layers (e.g. Apple system wallpapers without assets).`);
    proj.id = uid('p');
    projects.push(proj);
  }
  return { projects, warnings };
}
