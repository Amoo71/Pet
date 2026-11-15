// .tendies package builders.
//
// modern (ParameterizedCA, iOS 26/27) – layout verified on device by tendies_kit:
//   descriptors/<UUID>/
//     com.apple.posterkit.role.identifier, …descriptor.identifier, providerInfo.plist,
//     …identifierURL.suggestionMetadata.plist
//     versions/0/
//       …instance.renderingConfiguration.plist   (iOS 27: depth + motion on)
//       …complicationLayout.plist, …titleStyleConfiguration.plist, supplements/0/…
//       contents/
//         .…configurableOptions.plist              (hidden file – importer must keep it)
//         …otherMetadata.plist, …userInfo
//         7400.WWDC_2022-390w-844h@3x~iphone.wallpaper/
//           Wallpaper.plist                          type ParameterizedCA, wantsDeviceMotion
//           <ident>.Clownfish_Gyro.ca/               "Clownfish" in the name enables iOS 27 depth
//             main.caml, index.xml, assetManifest.caml, assets/…
//
// classic (LayeredAnimation, iOS 17+): descriptors/<UUID>/versions/1/contents/<id>.<Name>-<cls>.wallpaper/
//   with _Background / _Floating / _Foreground .ca bundles.

import { createZip } from './zip.js';
import { toXmlPlist, int, real, data, uid as plistUid, parsePlist } from './plist.js';
import { toBinaryPlist } from './bplist.js';
import { PLANES, ANIMATABLE, animatedProps, hasLoops } from './model.js';
import { buildModernCaml, buildDuoCaml, buildClassicCaml, buildIndexXml, ASSET_MANIFEST, uniqueNames } from './caml.js';
import { getDevice, screenClass } from './devices.js';
import { PCA_FILES, PCA_WALLPAPER_DIR } from './template-data.js';

const enc = new TextEncoder();
const PRODUCT_TYPES = ['iPhone18,3', 'iPhone19,4', 'iPhone18,4'];

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().toUpperCase();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((c === 'x' ? Math.random() * 16 : (Math.random() * 4) | 8) | 0).toString(16)).toUpperCase();
}

export const safeName = (s) =>
  (String(s || 'Wallpaper')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Wallpaper').slice(0, 40);

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function sha256(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all));
}

function uuidFrom(bytes) {
  const b = Uint8Array.from(bytes.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toUpperCase();
}

/** decoded-bitmap memory estimate in MB (what PosterBoard holds in RAM) */
export function memoryEstimate(project) {
  let px = 0;
  for (const l of project.layers) {
    if (l.hidden) continue;
    const s = 9; // @3x
    const frames = l.kind === 'video' ? Math.min(l.video?.frames?.length || 1, 400) : 1;
    px += l.w * l.h * s * frames;
  }
  return (px * 4) / 1024 / 1024;
}

/** Problems that would make a wallpaper fail, look broken or drain the battery. */
export function validateProject(project) {
  const issues = [];
  const modern = project.format !== 'classic';
  if (!project.layers.length) issues.push({ level: 'error', msg: 'The wallpaper has no layers.' });
  const visible = project.layers.filter((l) => !l.hidden);
  if (project.layers.length && !visible.length) issues.push({ level: 'error', msg: 'All layers are hidden.' });
  for (const l of project.layers) {
    if (l.kind === 'image' && !l.asset) issues.push({ level: 'error', msg: `“${l.name}”: no image selected.` });
    if (l.kind === 'video' && !l.video?.frames?.length) issues.push({ level: 'error', msg: `“${l.name}”: no frames.` });
    if (l.kind === 'video' && l.video?.frames?.length > 400) issues.push({ level: 'warn', msg: `“${l.name}”: ${l.video.frames.length} frames – PosterBoard may crash above 400.` });
    if (l.kind === 'emitter') issues.push({ level: 'info', msg: `“${l.name}”: particles (CAEmitterLayer) are experimental on device.` });
    if (l.kind === 'glass' && l.glass?.mode === 'liquid') issues.push({ level: 'info', msg: `“${l.name}”: Liquid Glass needs iOS 26+ (CAPlayground structure, experimental).` });
    if (l.kind === 'glass' && l.glass?.mode === 'live') issues.push({ level: 'info', msg: `“${l.name}”: live backdrop blur is experimental – “Frosted (baked)” works everywhere.` });
    if (!modern && l.parallax > 0) issues.push({ level: 'info', msg: `“${l.name}”: gyro parallax only exists in the Modern format.` });
  }
  if (project.format === 'duo' && project.device !== 'iphone-duo') issues.push({ level: 'warn', msg: 'Duo format: switch the device to “iPhone Duo” so the scene covers all three postures.' });
  if (project.format === 'duo') issues.push({ level: 'info', msg: 'Duo format is for iPhone Duo (foldable) on iOS 27 – import with AirCard Depth Test. Use Modern for regular iPhones.' });
  for (const l of project.layers) {
    if (modern && (l.gyro?.tilt > 0 || (l.gyro?.fade && l.gyro.fade !== 'none'))) issues.push({ level: 'info', msg: `“${l.name}”: gyro 3D tilt / gyro fade are experimental (only gyro move is device-verified).` });
  }
  if (modern && project.appearanceAware) issues.push({ level: 'info', msg: 'Light/Dark variants are only exported in the Classic format.' });
  const loops = project.layers.filter((l) => !l.hidden && hasLoops(l));
  if (loops.length)
    issues.push({ level: 'warn', msg: `${loops.length} layer(s) animate forever – the screen redraws every frame (measured ~30% vs ~4% CPU idle). Prefer swipe-driven state animation for battery life.`, kind: 'battery' });
  const mem = memoryEstimate(project);
  if (mem > 120) issues.push({ level: 'warn', msg: `≈${Math.round(mem)} MB decoded image memory – may stutter on older iPhones (aim for < 80 MB).` });
  const bg = project.layers.filter((l) => l.plane === 'background' && !l.hidden);
  if (project.layers.length && !bg.length) issues.push({ level: 'warn', msg: 'No visible layer behind the clock – parts of the lock screen would be black.' });
  // Always-On has no depth effect: anything in front of the clock region is drawn under the clock
  const clockBottom = project._h * 0.3;
  for (const l of project.layers.filter((x) => x.plane === 'floating' && !x.hidden)) {
    const s = { ...l, ...(l.states?.Locked || {}), ...(l.states?.Sleep || {}) };
    if ((s.opacity ?? 1) > 0.05 && s.y - (l.h * (s.scale ?? 1)) / 2 < clockBottom && l.w < project._w * 0.95)
      issues.push({ level: 'info', msg: `“${l.name}” reaches the clock area in Always-On – AOD has no depth effect, the clock will cover it.` });
  }
  void ANIMATABLE;
  void animatedProps;
  return issues;
}

/** Resolve layer bitmaps through the render callback into package paths. */
async function collectResources(project, render, caDir, add) {
  const resources = new Map();
  for (const layer of project.layers) {
    const r = await render(layer, project);
    if (!r) continue;
    if (r.frames) {
      const unique = r.frames.map((f, i) => {
        const p = `assets/${layer.id}_${i}.${f.ext}`;
        add(`${caDir}/${p}`, f.bytes);
        return p;
      });
      const order = r.sequence || unique.map((_, i) => i);
      resources.set(layer.id, { frames: order.map((i) => unique[i]), file: unique[order[0] ?? 0] });
    } else if (r.bytes) {
      const p = `assets/${layer.id}.${r.ext}`;
      add(`${caDir}/${p}`, r.bytes);
      resources.set(layer.id, { file: p });
    }
  }
  return resources;
}

// ---------------------------------------------------------------- modern

export async function buildModernDescriptor(project, render, opts = {}) {
  const assetFiles = [];
  const resources = await collectResources(project, render, '', (p, b) => assetFiles.push({ p: p.replace(/^\//, ''), b }));
  const duo = project.format === 'duo';
  const caml = (duo ? buildDuoCaml : buildModernCaml)(project, resources, { batter: opts.batter });
  // identity follows the content (re-exporting the same design keeps it, any change gets a new one)
  const digest = await sha256([enc.encode(caml), ...assetFiles.flatMap((f) => [enc.encode(f.p), f.b]), enc.encode(opts.salt || '')]);
  const ident = opts.ident ?? 100000 + (((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0) % 900000;
  const descUuid = opts.uuid || uuidFrom(digest.slice(4, 20));
  const galleryUuid = uuidFrom(digest.slice(16, 32));
  const root = `${opts.root || 'descriptors'}/${descUuid}`;
  const contents = `${root}/versions/0/contents`;
  const bundle = `${contents}/${PCA_WALLPAPER_DIR}`;
  const caName = `${ident}.Clownfish_Gyro.ca`;
  const ca = `${bundle}/${caName}`;
  const files = [];
  const add = (path, bytes) => files.push({ path, data: typeof bytes === 'string' ? enc.encode(bytes) : bytes });

  for (const [rel, b] of Object.entries(PCA_FILES)) {
    let bytes = b64(b);
    if (rel.endsWith('suggestionMetadata.plist')) {
      const meta = parsePlist(bytes, true);
      const objs = meta.$objects;
      const rootObj = objs[meta.$top.root.v];
      const gallery = objs[rootObj.suggestedGalleryItem.v];
      objs[gallery.identifier.v] = galleryUuid;
      objs[gallery.descriptorIdentifier.v] = `${ident}.DYNAMIC`;
      bytes = toBinaryPlist(meta);
    }
    add(`${root}/${rel}`, bytes);
  }
  add(`${root}/com.apple.posterkit.provider.descriptor.identifier`, String(ident));
  add(
    `${contents}/com.apple.posterkit.provider.contents.userInfo`,
    toBinaryPlist({ wallpaperRepresentingIdentifier: String(ident), wallpaperRepresentingFileName: PCA_WALLPAPER_DIR, posterEnvironmentOverrides: data(enc.encode('{}')) })
  );
  add(
    `${bundle}/Wallpaper.plist`,
    toBinaryPlist({
      preferredProminentColor: { default: '#FFFFFF' },
      contentVersion: real(1.07),
      assets: { lockAndHome: { default: { assetFileName: caName, identifier: int(7920), name: 'Lavender', type: 'ParameterizedCA' } } },
      version: int(6),
      family: 'Marble',
      preferredTitleColor: ['#FFFFFF02'],
      logicalScreenClass: 'any',
      appearanceAware: false,
      identifier: int(ident),
      productTypes: PRODUCT_TYPES,
      wantsDeviceMotion: true,
      name: 'Lavender',
      // Duo per-screen schema: without this the inner landscape gets scaled up by 951/669 (device-verified)
      ...(duo ? { requiresLandscapeScaling: false } : {}),
    })
  );
  add(`${ca}/main.caml`, caml);
  add(`${ca}/index.xml`, buildIndexXml(project, true));
  add(`${ca}/assetManifest.caml`, ASSET_MANIFEST);
  for (const f of assetFiles) add(`${ca}/${f.p}`, f.b);
  return { files, ident, root, caDir: ca, caml };
}

// ---------------------------------------------------------------- classic

function providerInfoPlist() {
  const secondsSince2001 = Date.now() / 1000 - 978307200;
  return toXmlPlist({
    $archiver: 'NSKeyedArchiver',
    $objects: [
      '$null',
      { 'NS.keys': [plistUid(2)], 'NS.objects': [plistUid(3)], $class: plistUid(5) },
      'kConfigurationLastUseDateKey',
      { 'NS.time': real(secondsSince2001), $class: plistUid(4) },
      { $classname: 'NSDate', $classes: ['NSDate', 'NSObject'] },
      { $classname: 'NSMutableDictionary', $classes: ['NSMutableDictionary', 'NSDictionary', 'NSObject'] },
    ],
    $top: { root: plistUid(1) },
    $version: int(100000),
  });
}

export async function buildClassicDescriptor(project, render, opts = {}) {
  const device = getDevice(project.device);
  const cls = screenClass(device);
  const id = opts.wallpaperId ?? 10000 + Math.floor(Math.random() * 89999);
  const name = safeName(project.name);
  const root = `${opts.root || 'descriptors'}/${opts.uuid || uuid()}`;
  const wpName = `${id}.${name}-${cls}.wallpaper`;
  const contents = `${root}/versions/1/contents`;
  const wpDir = `${contents}/${wpName}`;
  const files = [];
  const add = (path, bytes) => files.push({ path, data: typeof bytes === 'string' ? enc.encode(bytes) : bytes });
  add(`${root}/com.apple.posterkit.role.identifier`, 'PRPosterRoleLockScreen');
  add(`${root}/com.apple.posterkit.provider.descriptor.identifier`, String(id));
  add(`${root}/providerInfo.plist`, providerInfoPlist());
  add(`${contents}/com.apple.posterkit.provider.contents.userInfo`, toXmlPlist({ posterEnvironmentOverrides: data(enc.encode('{}')), wallpaperRepresentingFileName: wpName, wallpaperRepresentingIdentifier: String(id) }));
  const names = uniqueNames(project.layers);
  const planeFiles = {};
  const caDirs = {};
  for (const plane of [...PLANES, { id: 'foreground', file: 'Foreground' }]) {
    const caName = `${id}.${name}_${plane.file}-${cls}.ca`;
    planeFiles[plane.id] = caName;
    const caDir = `${wpDir}/${caName}`;
    caDirs[plane.id] = caDir;
    const sub = { ...project, layers: project.layers.filter((l) => l.plane === plane.id) };
    const resources = await collectResources(sub, render, caDir, add);
    add(`${caDir}/main.caml`, buildClassicCaml(project, plane.id, resources, { batter: opts.batter, names }));
    add(`${caDir}/index.xml`, buildIndexXml(project));
    add(`${caDir}/assetManifest.caml`, ASSET_MANIFEST);
  }
  add(
    `${wpDir}/Wallpaper.plist`,
    toXmlPlist({
      appearanceAware: !!project.appearanceAware,
      assets: { lockAndHome: { default: { backgroundAnimationFileName: planeFiles.background, floatingAnimationFileNameKey: planeFiles.floating, foregroundAnimationFileName: planeFiles.foreground, identifier: int(id), name: project.name || 'Wallpaper', type: 'LayeredAnimation' } } },
      contentVersion: real(2.01),
      family: name,
      identifier: int(id),
      logicalScreenClass: cls,
      name: project.name || 'Wallpaper',
      preferredProminentColor: { dark: '#000000', default: '#FFFFFF' },
      version: int(1),
    })
  );
  return { files, root, caDirs };
}

// ---------------------------------------------------------------- public API

export async function buildDescriptor(project, render, opts = {}) {
  return project.format === 'classic' ? buildClassicDescriptor(project, render, opts) : buildModernDescriptor(project, render, opts);
}

/** Build a .tendies archive from one or more projects. */
export async function buildTendies(projects, render, opts = {}) {
  const list = Array.isArray(projects) ? projects : [projects];
  const all = [];
  const ordered = list.length > 1 && opts.ordered !== false && list.every((p) => p.format === 'classic');
  const baseId = 10000 + Math.floor(Math.random() * 80000);
  for (let i = 0; i < list.length; i++) {
    const { files } = await buildDescriptor(list[i], render, { root: ordered ? 'ordered-descriptors' : 'descriptors', wallpaperId: baseId + (list.length - i), salt: String(i) });
    all.push(...files);
  }
  return createZip(all);
}

/** Nugget "batter" template: descriptor tree + config.json with user-configurable options. */
export async function buildBatter(project, render, meta = {}) {
  const res = await buildDescriptor(project, render, { batter: true, wallpaperId: 9999 });
  const files = res.files;
  const camlOf = (l) => (project.format === 'classic' ? `${res.caDirs[l.plane]}/main.caml` : `${res.caDir}/main.caml`);
  const assetDir = (l) => (project.format === 'classic' ? res.caDirs[l.plane] : res.caDir);
  const options = [];
  for (const l of project.layers.filter((x) => x.nuggetOption)) {
    if (l.kind === 'image') {
      options.push({
        type: 'replace',
        label: `${l.name}: image`,
        button_label: 'Choose image',
        allowed_files: 'Image Files (*.png *.jpg *.jpeg)',
        required: false,
        files: files.filter((f) => f.path === `${assetDir(l)}/assets/${l.id}.png` || f.path === `${assetDir(l)}/assets/${l.id}.jpg`).map((f) => f.path),
      });
    }
    options.push({ type: 'set', label: `${l.name}: opacity`, identifier: l.id, key: 'opacity', default_value: String(l.opacity), value_type: 'float', setter_type: 'slider', min_value: '0', max_value: '1', step: '0.05', files: [camlOf(l)] });
    options.push({ type: 'set', label: `${l.name}: hide`, identifier: l.id, key: 'hidden', default_value: l.hidden ? '1' : '0', value_type: 'integer', setter_type: 'toggle', toggle_on_value: '1', toggle_off_value: '0', files: [camlOf(l)] });
  }
  const config = {
    title: meta.title || project.name || 'Wallpaper',
    author: meta.author || 'Tendies Studio',
    description: meta.description || 'Made with Tendies Studio',
    format_version: '2',
    domain: 'AppDomain-com.apple.PosterBoard',
    min_version: project.format === 'classic' ? '17.0' : '26.0',
    options,
  };
  files.push({ path: 'config.json', data: enc.encode(JSON.stringify(config, null, 2)) });
  return createZip(files);
}
