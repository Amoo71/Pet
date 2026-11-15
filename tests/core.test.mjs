// Node test of the export pipeline: node tests/core.test.mjs <outdir>
import { newProject, newLayer, newAnim, migrateProject } from '../src/core/model.js';
import { buildTendies, buildBatter, validateProject } from '../src/core/tendies.js';
import { readZip } from '../src/core/zip.js';
import { parsePlist } from '../src/core/plist.js';
import { toBinaryPlist } from '../src/core/bplist.js';
import { PCA_FILES } from '../src/core/template-data.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = process.argv[2] || 'test-out';
mkdirSync(out, { recursive: true });
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const render = async (l) => (l.kind === 'video' ? { frames: [0, 1, 2].map(() => ({ bytes: PNG, ext: 'png' })), sequence: [0, 0, 1, 2] } : { bytes: PNG, ext: 'png' });
const text = (b) => new TextDecoder().decode(b);

// --- bplist round trip of every template archive (typed) must be byte-stable in content
for (const [name, b64] of Object.entries(PCA_FILES)) {
  if (!name.endsWith('.plist')) continue;
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  const a = parsePlist(bytes, true);
  const again = parsePlist(toBinaryPlist(a), true);
  assert.deepEqual(again, a, `bplist round trip ${name}`);
}

function makeProject(format) {
  const p = newProject();
  p.format = format;
  p.name = 'Test Ünlock';
  p.appearanceAware = format === 'classic';
  const bg = newLayer('gradient', p, { parallax: 8 });
  const img = newLayer('image', p, { asset: 'a1', plane: 'floating', nuggetOption: true, parallax: 14, blend: 'screenBlendMode', filters: { blur: 4, hue: 30, saturate: 1.2, contrast: 1 } });
  img.states = { Unlock: { opacity: 1, y: 300 }, Sleep: { opacity: 0.3 }, 'Locked@dark': { opacity: 0.2 } };
  img.opacity = 0;
  img.anims = [newAnim('float'), newAnim('spin')];
  const txt = newLayer('text', p, { rotation: 10, scale: 1.2 });
  const vid = newLayer('video', p, { video: { frames: ['f1', 'f2', 'f3'], fps: 12 } });
  const em = newLayer('emitter', p);
  const glass = newLayer('glass', p, { glass: { mode: 'liquid', refraction: 80 } });
  p.layers.push(bg, img, txt, vid, em, glass);
  return { p, img };
}

for (const format of ['modern', 'classic']) {
  const { p, img } = makeProject(format);
  const issues = validateProject(p);
  assert(issues.some((i) => i.kind === 'battery'), 'battery warning');
  const zip = await buildTendies(p, render);
  writeFileSync(`${out}/${format}.tendies`, zip);
  const files = await readZip(zip);
  const names = [...files.keys()];
  if (format === 'modern') {
    const camlPath = names.find((n) => /versions\/0\/contents\/7400\.WWDC_2022-390w-844h@3x~iphone\.wallpaper\/\d+\.Clownfish_Gyro\.ca\/main\.caml$/.test(n));
    assert(camlPath, 'Clownfish bundle');
    const caml = text(files.get(camlPath));
    assert(caml.includes('<wallpaperPropertyGroups type="NSArray">'));
    assert(caml.includes('value="transform.translation.x"'), 'parallax group');
    assert(caml.includes('<CABackdropLayer'), 'liquid glass');
    assert(caml.includes('CASDFGlassDisplacementEffect'));
    assert(caml.includes('filter="screenBlendMode"'));
    assert(caml.includes(`<v_home type="real" value="${874 - 300}"/>`), 'y flipped for v_home');
    assert(caml.includes('<p key') === false, 'one animation per nested layer');
    const wp = parsePlist(files.get(names.find((n) => n.endsWith('Wallpaper.plist'))));
    assert.equal(wp.assets.lockAndHome.default.type, 'ParameterizedCA');
    assert(wp.assets.lockAndHome.default.assetFileName.endsWith('.Clownfish_Gyro.ca'));
    assert.equal(wp.wantsDeviceMotion, true);
    assert(names.some((n) => n.endsWith('/.com.apple.posterkit.provider.contents.configurableOptions.plist')), 'hidden options plist kept');
    assert(names.some((n) => n.endsWith('renderingConfiguration.plist')));
    const meta = parsePlist(files.get(names.find((n) => n.endsWith('suggestionMetadata.plist'))));
    assert(meta.$objects.some((o) => typeof o === 'string' && o.endsWith('.DYNAMIC') && o !== '7400.DYNAMIC'), 'gallery identity rewritten');
    // identical content → identical identity
    const zip2 = await buildTendies(p, render);
    const names2 = [...(await readZip(zip2)).keys()];
    assert.equal(names2.find((n) => n.endsWith('main.caml')), camlPath, 'stable identity');
  } else {
    const fl = text(files.get(names.find((n) => n.includes('_Floating') && n.endsWith('main.caml'))));
    assert(fl.includes('<LKState name="Unlock Dark">'));
    assert(fl.includes(`keyPath="position.y"><value type="integer" value="${874 - 300}"/>`), 'classic y flipped');
    assert(fl.includes('CASpringAnimation'));
    assert(fl.includes(`id="${img.id}-a1"`), 'second animation nested');
  }
  const batter = await buildBatter(p, render);
  const bfiles = await readZip(batter);
  const cfg = JSON.parse(text(bfiles.get('config.json')));
  assert.equal(cfg.domain, 'AppDomain-com.apple.PosterBoard');
  for (const o of cfg.options) for (const f of o.files) assert(bfiles.has(f), 'batter option file exists: ' + f);
  writeFileSync(`${out}/${format}.batter`, batter);
}

// collection + migration of v1 projects
const { p: a } = makeProject('modern');
const { p: b } = makeProject('modern');
b.name = 'Second';
writeFileSync(`${out}/collection.tendies`, await buildTendies([a, b], render));
const old = { name: 'old', layers: [{ id: 'x', kind: 'color', plane: 'foreground', loop: { type: 'rotate', duration: 5, amount: 1 }, states: {} }] };
migrateProject(old);
assert.equal(old.format, 'classic');
assert.equal(old.layers[0].plane, 'floating');
assert.equal(old.layers[0].anims[0].preset, 'spin');

// --- Duo + 3D + gyro tilt/fade + fast fade
{
  const p = newProject('iphone-duo', { w: 951, h: 951 });
  p.format = 'duo';
  p.device = 'iphone-duo';
  const bg = newLayer('gradient', p, { parallax: 6 });
  const hero = newLayer('image', p, { asset: 'a', plane: 'floating', parallax: 14, rotX: 10, gyro: { tilt: 8, fade: 'x', fadeMin: 0.2, fadeMax: 1 }, fastFade: true });
  hero.states = { Unlock: { opacity: 0, rotY: 25 }, Sleep: { y: 700 } };
  p.layers.push(bg, hero);
  const zip = await buildTendies(p, render);
  writeFileSync(`${out}/duo.tendies`, zip);
  const files = await readZip(zip);
  const names = [...files.keys()];
  const caml = text(files.get(names.find((n) => n.endsWith('main.caml'))));
  for (const k of ['BACKGROUND ONE', 'FLOATING ONE', 'BACKGROUND TWO', 'FLOATING TWO']) assert(caml.includes(`name="${k}"`), k);
  assert(caml.includes('<wallpapers type="NSArray">'));
  assert(caml.includes('<screenName type="string" value="Cover Screen"/>'));
  assert(caml.includes('portrait_home') && caml.includes('landscape_lock'));
  assert(caml.includes('transform="scale(3, 3, 1)"'), 'frame scale');
  assert(caml.includes('sublayerTransform="perspective('), 'perspective');
  assert(caml.includes('value="transform.rotation.y"') && caml.includes('value="transform.rotation.x"'), 'tilt + rotY groups');
  assert(caml.includes(`value="${hero.name} TWO GyroFade"`) || caml.includes('GyroFade'), 'gyro fade target');
  assert(caml.includes(' Fade ONE') === false, 'suffix order');
  assert((caml.match(/Image ONE Fade"/g) || []).length >= 1, 'fast fade wrapper + group');
  const wp = parsePlist(files.get(names.find((n) => n.endsWith('Wallpaper.plist'))));
  assert.equal(wp.requiresLandscapeScaling, false);
  // every name unique
  const all = [...caml.matchAll(/ name="([^"]+)"/g)].map((m) => m[1]);
  const dup = all.filter((n, i) => all.indexOf(n) !== i && !n.startsWith('Cell'));
  assert.deepEqual(dup, [], 'unique layer names');
}
console.log('OK');
