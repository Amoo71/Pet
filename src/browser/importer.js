// Import existing .tendies files into editable projects (best effort).
// Supports image layers (CGImage contents), frame sequences (keyframe "contents"),
// geometry, opacity, hidden, and LKState opacity/position/scale/rotation values.

import { readZip } from '../core/zip.js';
import { parsePlist } from '../core/plist.js';
import { newProject, newLayer, uid, PLANES, ANIMATABLE } from '../core/model.js';
import { DEVICES } from '../core/devices.js';

const mime = (p) => (/\.jpe?g$/i.test(p) ? 'image/jpeg' : /\.heic$/i.test(p) ? 'image/heic' : 'image/png');

const nums = (s) => String(s || '').trim().split(/\s+/).map(Number);

function planeOf(caName, wp) {
  const d = wp?.assets?.lockAndHome?.default || {};
  if (caName === d.backgroundAnimationFileName) return 'background';
  if (caName === d.floatingAnimationFileNameKey) return 'floating';
  if (caName === d.foregroundAnimationFileName) return 'foreground';
  if (/_Floating/i.test(caName)) return 'floating';
  if (/_Foreground/i.test(caName)) return 'foreground';
  return 'background';
}

/**
 * @param {ArrayBuffer} buf
 * @param {(blob:Blob)=>Promise<string>} storeAsset returns asset id
 * @returns {Promise<{projects:object[], warnings:string[]}>}
 */
export async function importTendies(buf, storeAsset) {
  const files = await readZip(buf);
  const paths = [...files.keys()];
  const warnings = [];
  const wallpapers = paths.filter((p) => /\.wallpaper\/Wallpaper\.plist$/i.test(p));
  if (!wallpapers.length) {
    // maybe a raw .ca package without wallpaper plist
    const camls = paths.filter((p) => /\.ca\/main\.caml$/i.test(p));
    if (!camls.length) throw new Error('Keine PosterBoard-Wallpaper in der Datei gefunden.');
    wallpapers.push(null);
  }
  const projects = [];
  for (const wpPath of wallpapers) {
    const wpDir = wpPath ? wpPath.replace(/Wallpaper\.plist$/i, '') : '';
    let wp = null;
    try {
      wp = wpPath ? parsePlist(files.get(wpPath)) : null;
    } catch {
      warnings.push('Wallpaper.plist konnte nicht gelesen werden.');
    }
    const cls = wp?.logicalScreenClass || '';
    const m = /^(\d+)w-(\d+)h@(\d)x/.exec(cls);
    let dev = m && DEVICES.find((d) => d.w === +m[1] && d.h === +m[2]);
    const proj = newProject(dev?.id || DEVICES[2].id, dev || DEVICES[2]);
    proj.name = wp?.name || wpDir.split('/').filter(Boolean).pop()?.replace(/\.wallpaper$/, '') || 'Import';
    proj.appearanceAware = !!wp?.appearanceAware;

    const caMain = paths.filter((p) => p.startsWith(wpDir) && /\.ca\/main\.caml$/i.test(p));
    let docW = 0;
    let docH = 0;
    for (const mainPath of caMain) {
      const caDir = mainPath.replace(/main\.caml$/i, '');
      const caName = caDir.split('/').filter(Boolean).pop();
      const plane = planeOf(caName, wp);
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(files.get(mainPath)), 'application/xml');
      const root = doc.documentElement.firstElementChild;
      if (!root) continue;
      const [, , rw, rh] = nums(root.getAttribute('bounds'));
      if (rw && rh) {
        docW = Math.max(docW, rw);
        docH = Math.max(docH, rh);
      }
      if (/LKState name="[^"]+ (Light|Dark)"/.test(new TextDecoder().decode(files.get(mainPath)))) proj.appearanceAware = true;

      const imported = new Map();
      const walk = async (el, ox, oy, inheritedOpacity, depth) => {
        for (const child of el.querySelectorAll(':scope > sublayers > *')) {
          const tag = child.tagName;
          const [, , w, h] = nums(child.getAttribute('bounds'));
          const [px, py] = nums(child.getAttribute('position'));
          const anchor = child.hasAttribute('anchorPoint') ? nums(child.getAttribute('anchorPoint')) : [0.5, 0.5];
          // convert to parent-space centre
          const cx = ox + (px || 0) + ((0.5 - anchor[0]) * (w || 0));
          const cy = oy + (py || 0) + ((0.5 - anchor[1]) * (h || 0));
          const op = child.hasAttribute('opacity') ? Number(child.getAttribute('opacity')) : 1;
          const img = child.querySelector(':scope > contents > CGImage, :scope > contents[src]');
          const src = img?.getAttribute('src');
          const frameAnim = child.querySelector(':scope > animations > animation[keyPath="contents"]');
          if (tag === 'CAEmitterLayer') {
            warnings.push(`Partikel-Ebene „${child.getAttribute('name') || ''}“ wurde übersprungen.`);
            continue;
          }
          if (src || frameAnim) {
            const resolve = async (s) => {
              const p = caDir + s;
              const bytes = files.get(p);
              if (!bytes) return null;
              return storeAsset(new Blob([bytes], { type: mime(p) }));
            };
            let layer;
            if (frameAnim) {
              const srcs = [...frameAnim.querySelectorAll('values > CGImage')].map((n) => n.getAttribute('src'));
              const frames = (await Promise.all(srcs.map(resolve))).filter(Boolean);
              const dur = Number(frameAnim.getAttribute('duration')) || frames.length / 24;
              layer = newLayer('video', proj, {
                video: { frames, fps: Math.round(frames.length / dur) || 24, autoreverse: frameAnim.getAttribute('autoreverses') === '1', calc: frameAnim.getAttribute('calculationMode') === 'linear' ? 'linear' : 'discrete', duration: dur },
              });
            } else {
              const asset = await resolve(src);
              if (!asset) {
                warnings.push(`Bild ${src} fehlt im Archiv.`);
                continue;
              }
              layer = newLayer('image', proj, { asset });
            }
            const grav = child.getAttribute('contentsGravity');
            Object.assign(layer, {
              plane,
              name: child.getAttribute('name') || layer.name,
              x: cx,
              y: cy,
              w: w || proj._w,
              h: h || proj._h,
              opacity: inheritedOpacity * op,
              hidden: child.getAttribute('hidden') === '1',
              fit: grav === 'resizeAspectFill' ? 'cover' : grav === 'resizeAspect' ? 'contain' : 'stretch',
              cornerRadius: Number(child.getAttribute('cornerRadius')) || 0,
            });
            proj.layers.push(layer);
            const id = child.getAttribute('id');
            if (id) imported.set(id, layer);
            // our own exports wrap content in "<id>-content"
            if (id?.endsWith('-content')) imported.set(id.slice(0, -8), layer);
            const parentId = el.getAttribute('id');
            if (parentId && depth > 0 && !imported.has(parentId)) imported.set(parentId, layer);
          }
          if (depth < 6) await walk(child, cx - (w || 0) / 2, cy - (h || 0) / 2, inheritedOpacity * op, depth + 1);
        }
      };
      await walk(root, 0, 0, 1, 0);

      // state values
      for (const st of root.querySelectorAll(':scope > states > LKState')) {
        const name = st.getAttribute('name') || '';
        const mm = /^(Locked|Unlock|Sleep)(?: (Light|Dark))?$/.exec(name);
        if (!mm) continue;
        const key = mm[2] === 'Dark' ? `${mm[1]}@dark` : mm[1];
        for (const sv of st.querySelectorAll('LKStateSetValue')) {
          const layer = imported.get(sv.getAttribute('targetId'));
          const def = ANIMATABLE.find((a) => a.keyPath === sv.getAttribute('keyPath'));
          const val = sv.querySelector('value');
          if (!layer || !val) continue;
          if (def) {
            let v = Number(val.getAttribute('value'));
            if (def.id === 'rotation') v = (v * 180) / Math.PI;
            if (key === 'Locked' && !mm[2]) layer[def.id] = v;
            else (layer.states[key] ||= {})[def.id] = v;
          } else if (sv.getAttribute('keyPath') === 'position') {
            const [x, y] = nums(val.getAttribute('value'));
            if (key === 'Locked') Object.assign(layer, { x, y });
            else Object.assign((layer.states[key] ||= {}), { x, y });
          }
        }
      }
      // "Locked Light" duplicates base values – drop identical overrides
      for (const l of proj.layers) {
        for (const [k, v] of Object.entries(l.states)) {
          for (const p of Object.keys(v)) if (!k.includes('@') && v[p] === l[p]) delete v[p];
          if (!Object.keys(v).length) delete l.states[k];
        }
      }
    }
    if (!dev && docW && docH) {
      // scale foreign document sizes (e.g. 3176×3176 Nugget video docs) into the default device
      const d = DEVICES.find((x) => x.w === docW && x.h === docH);
      if (d) {
        proj.device = d.id;
        proj._w = d.w;
        proj._h = d.h;
      } else {
        const f = Math.min(proj._w / docW, proj._h / docH) || 1;
        const k = Math.max(proj._w / docW, proj._h / docH) || 1;
        const s = k; // cover
        for (const l of proj.layers) {
          l.x = proj._w / 2 + (l.x - docW / 2) * s;
          l.y = proj._h / 2 + (l.y - docH / 2) * s;
          l.w *= s;
          l.h *= s;
          for (const v of Object.values(l.states)) {
            if ('x' in v) v.x = proj._w / 2 + (v.x - docW / 2) * s;
            if ('y' in v) v.y = proj._h / 2 + (v.y - docH / 2) * s;
          }
        }
        if (f !== 1) warnings.push('Dokumentgröße wurde an das Gerät angepasst.');
      }
    }
    if (!proj.layers.length) warnings.push(`„${proj.name}“: keine importierbaren Bild-Ebenen gefunden (z. B. Apple-Systemwallpaper ohne Assets).`);
    proj.id = uid('p');
    projects.push(proj);
  }
  return { projects, warnings, planes: PLANES.length };
}
