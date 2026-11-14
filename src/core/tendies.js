// .tendies package builder (+ Nugget "batter" template variant).
//
// Layout (descriptor format, as read by Nugget, Pocket Poster, Gester & co):
//   descriptors/<UUID>/
//     com.apple.posterkit.role.identifier            "PRPosterRoleLockScreen"
//     com.apple.posterkit.provider.descriptor.identifier   "<wallpaper id>"
//     providerInfo.plist
//     versions/1/contents/
//       com.apple.posterkit.provider.contents.userInfo
//       <id>.<Name>-<screenClass>.wallpaper/
//         Wallpaper.plist
//         <id>.<Name>_Background-<screenClass>.ca/{main.caml,index.xml,assetManifest.caml,assets/…}
//         <id>.<Name>_Floating-<screenClass>.ca/…
//         <id>.<Name>_Foreground-<screenClass>.ca/…
// A folder named "ordered-descriptors" keeps the order of several wallpapers in a collection.

import { createZip } from './zip.js';
import { toXmlPlist, int, real, data, uid } from './plist.js';
import { PLANES, animatedProps } from './model.js';
import { buildPlaneCaml, buildIndexXml, ASSET_MANIFEST } from './caml.js';
import { getDevice, screenClass } from './devices.js';

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID().toUpperCase();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    })
    .toUpperCase();
}

export const safeName = (s) =>
  (String(s || 'Wallpaper')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'Wallpaper').slice(0, 40);

const enc = new TextEncoder();

function providerInfoPlist() {
  // NSKeyedArchiver dictionary { kConfigurationLastUseDateKey: NSDate } as XML plist
  const secondsSince2001 = Date.now() / 1000 - 978307200;
  return toXmlPlist({
    $archiver: 'NSKeyedArchiver',
    $objects: [
      '$null',
      { 'NS.keys': [uid(2)], 'NS.objects': [uid(3)], $class: uid(5) },
      'kConfigurationLastUseDateKey',
      { 'NS.time': real(secondsSince2001), $class: uid(4) },
      { $classname: 'NSDate', $classes: ['NSDate', 'NSObject'] },
      { $classname: 'NSMutableDictionary', $classes: ['NSMutableDictionary', 'NSDictionary', 'NSObject'] },
    ],
    $top: { root: uid(1) },
    $version: int(100000),
  });
}

/** Problems that would make a wallpaper fail or look broken. */
export function validateProject(project) {
  const issues = [];
  if (!project.layers.length) issues.push({ level: 'error', msg: 'Das Wallpaper hat keine Ebenen.' });
  const visible = project.layers.filter((l) => !l.hidden);
  if (project.layers.length && !visible.length) issues.push({ level: 'error', msg: 'Alle Ebenen sind ausgeblendet.' });
  for (const l of project.layers) {
    if (l.kind === 'image' && !l.asset) issues.push({ level: 'error', msg: `„${l.name}“: kein Bild gewählt.` });
    if (l.kind === 'video' && !(l.video?.frames?.length)) issues.push({ level: 'error', msg: `„${l.name}“: keine Video-Frames.` });
    if (l.kind === 'video' && l.video?.frames?.length > 400)
      issues.push({ level: 'warn', msg: `„${l.name}“: ${l.video.frames.length} Frames – über 400 Frames kann PosterBoard abstürzen.` });
    if (l.kind === 'emitter') issues.push({ level: 'info', msg: `„${l.name}“: Partikel (CAEmitterLayer) sind experimentell.` });
    const loopProp = { float: 'y', drift: 'x', rotate: 'rotation', sway: 'rotation', pulse: 'scale', fade: 'opacity', blink: 'opacity' }[l.loop?.type];
    if (loopProp && animatedProps(l, project.appearanceAware).includes(loopProp))
      issues.push({ level: 'info', msg: `„${l.name}“: Loop und Zustände animieren dieselbe Eigenschaft – beides wird kombiniert.` });
  }
  const bg = project.layers.filter((l) => l.plane === 'background' && !l.hidden);
  if (project.layers.length && !bg.length)
    issues.push({ level: 'warn', msg: 'Keine sichtbare Hintergrund-Ebene – der Sperrbildschirm wäre teilweise schwarz.' });
  return issues;
}

/**
 * Build the file list of one wallpaper descriptor.
 * @param {object} project
 * @param {(layer, project) => Promise<object>} render
 *        resolves { bytes, ext } for raster layers, { frames:[{bytes,ext}] } for video,
 *        { bytes, ext } (particle bitmap) for emitters.
 * @param {object} opts { root:'descriptors', batter:false, wallpaperId?, uuid? }
 */
export async function buildDescriptorFiles(project, render, opts = {}) {
  const device = getDevice(project.device);
  const cls = screenClass(device);
  const id = opts.wallpaperId ?? 10000 + Math.floor(Math.random() * 89999);
  const name = safeName(project.name);
  const dirUuid = opts.uuid || uuid();
  const root = `${opts.root || 'descriptors'}/${dirUuid}`;
  const wpName = `${id}.${name}-${cls}.wallpaper`;
  const contents = `${root}/versions/1/contents`;
  const wpDir = `${contents}/${wpName}`;
  const files = [];
  const add = (path, bytes) => files.push({ path, data: typeof bytes === 'string' ? enc.encode(bytes) : bytes });

  add(`${root}/com.apple.posterkit.role.identifier`, 'PRPosterRoleLockScreen');
  add(`${root}/com.apple.posterkit.provider.descriptor.identifier`, String(id));
  add(`${root}/providerInfo.plist`, providerInfoPlist());
  add(
    `${contents}/com.apple.posterkit.provider.contents.userInfo`,
    toXmlPlist({
      posterEnvironmentOverrides: data(enc.encode('{}')),
      wallpaperRepresentingFileName: wpName,
      wallpaperRepresentingIdentifier: String(id),
    })
  );

  const planeFiles = {};
  for (const plane of PLANES) {
    const caName = `${id}.${name}_${plane.file}-${cls}.ca`;
    planeFiles[plane.id] = caName;
    const caDir = `${wpDir}/${caName}`;
    const resources = new Map();
    for (const layer of project.layers.filter((l) => l.plane === plane.id)) {
      const r = await render(layer, project);
      if (!r) continue;
      if (r.frames) {
        const frames = r.frames.map((f, i) => {
          const p = `assets/${layer.id}_${i}.${f.ext}`;
          add(`${caDir}/${p}`, f.bytes);
          return p;
        });
        resources.set(layer.id, { frames, file: frames[0] });
      } else if (r.bytes) {
        const p = `assets/${layer.id}.${r.ext}`;
        add(`${caDir}/${p}`, r.bytes);
        resources.set(layer.id, { file: p });
      }
    }
    add(`${caDir}/main.caml`, buildPlaneCaml(project, plane.id, resources, { batter: opts.batter }));
    add(`${caDir}/index.xml`, buildIndexXml(project));
    add(`${caDir}/assetManifest.caml`, ASSET_MANIFEST);
  }

  add(
    `${wpDir}/Wallpaper.plist`,
    toXmlPlist({
      appearanceAware: !!project.appearanceAware,
      assets: {
        lockAndHome: {
          default: {
            backgroundAnimationFileName: planeFiles.background,
            floatingAnimationFileNameKey: planeFiles.floating,
            foregroundAnimationFileName: planeFiles.foreground,
            identifier: int(id),
            name: project.name || 'Wallpaper',
            type: 'LayeredAnimation',
          },
        },
      },
      contentVersion: real(2.01),
      family: name,
      identifier: int(id),
      logicalScreenClass: cls,
      name: project.name || 'Wallpaper',
      preferredProminentColor: { dark: '#000000', default: '#FFFFFF' },
      version: int(1),
    })
  );
  return { files, root, caDirs: Object.fromEntries(Object.entries(planeFiles).map(([k, v]) => [k, `${wpDir}/${v}`])) };
}

/** Build a .tendies archive from one or more projects. */
export async function buildTendies(projects, render, opts = {}) {
  const list = Array.isArray(projects) ? projects : [projects];
  const root = list.length > 1 && opts.ordered !== false ? 'ordered-descriptors' : 'descriptors';
  const all = [];
  // PosterBoard sorts collections by wallpaper id in reverse order
  const baseId = 10000 + Math.floor(Math.random() * 80000);
  for (let i = 0; i < list.length; i++) {
    const { files } = await buildDescriptorFiles(list[i], render, { root, wallpaperId: baseId + (list.length - i) });
    all.push(...files);
  }
  return createZip(all);
}

/**
 * Nugget batter template: same descriptor tree + config.json describing
 * user-configurable options (replace images, opacity sliders, hide toggles).
 */
export async function buildBatter(project, render, meta = {}) {
  const fixedUuid = uuid();
  const { files, caDirs } = await buildDescriptorFiles(project, render, { batter: true, uuid: fixedUuid, wallpaperId: 9999 });
  const options = [];
  for (const l of project.layers.filter((x) => x.nuggetOption)) {
    const ca = caDirs[l.plane];
    const caml = `${ca}/main.caml`;
    if (l.kind === 'image') {
      options.push({
        type: 'replace',
        label: `${l.name}: Bild`,
        button_label: 'Bild wählen',
        allowed_files: 'Image Files (*.png *.jpg *.jpeg)',
        required: false,
        files: files.filter((f) => f.path === `${ca}/assets/${l.id}.png` || f.path === `${ca}/assets/${l.id}.jpg`).map((f) => f.path),
      });
    }
    options.push({
      type: 'set',
      label: `${l.name}: Deckkraft`,
      identifier: l.id,
      key: 'opacity',
      default_value: String(l.opacity),
      value_type: 'float',
      setter_type: 'slider',
      min_value: '0',
      max_value: '1',
      step: '0.05',
      files: [caml],
    });
    options.push({
      type: 'set',
      label: `${l.name}: ausblenden`,
      identifier: l.id,
      key: 'hidden',
      default_value: l.hidden ? '1' : '0',
      value_type: 'integer',
      setter_type: 'toggle',
      toggle_on_value: '1',
      toggle_off_value: '0',
      files: [caml],
    });
  }
  const config = {
    title: meta.title || project.name || 'Wallpaper',
    author: meta.author || 'Tendies Studio',
    description: meta.description || 'Erstellt mit Tendies Studio',
    format_version: '2',
    domain: 'AppDomain-com.apple.PosterBoard',
    min_version: '17.0',
    options,
  };
  files.push({ path: 'config.json', data: enc.encode(JSON.stringify(config, null, 2)) });
  return createZip(files);
}
