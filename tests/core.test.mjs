// Node test of the export pipeline: node tests/core.test.mjs <outdir>
import { newProject, newLayer } from '../src/core/model.js';
import { buildTendies, buildBatter, validateProject } from '../src/core/tendies.js';
import { readZip } from '../src/core/zip.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const out = process.argv[2] || 'test-out';
mkdirSync(out, { recursive: true });
// 1x1 transparent png
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const render = async (l) => (l.kind === 'video' ? { frames: [0, 1, 2].map(() => ({ bytes: PNG, ext: 'png' })) } : { bytes: PNG, ext: 'png' });

const p = newProject();
p.name = 'Test Ünlock';
p.appearanceAware = true;
const bg = newLayer('gradient', p);
const img = newLayer('image', p, { asset: 'a1', plane: 'floating', nuggetOption: true });
img.states = { Locked: { opacity: 0 }, Unlock: { opacity: 1, y: 300 }, 'Locked@dark': { opacity: 0.2 } };
img.loop = { type: 'float', duration: 3, amount: 10, autoreverse: true };
const txt = newLayer('text', p, { rotation: 10, plane: 'foreground' });
const vid = newLayer('video', p, { video: { frames: ['f1', 'f2', 'f3'], fps: 12 } });
const em = newLayer('emitter', p);
p.layers.push(bg, img, txt, vid, em);
console.log(validateProject(p));

const zip = await buildTendies(p, render);
writeFileSync(`${out}/test.tendies`, zip);
const files = await readZip(zip);
const names = [...files.keys()];
assert(names.some((n) => /^descriptors\/[0-9A-F-]{36}\/versions\/1\/contents\/\d+\.Test_Unlock-402w-874h@3x~iphone\.wallpaper\/Wallpaper\.plist$/.test(n)), 'wallpaper plist');
assert.equal(names.filter((n) => n.endsWith('main.caml')).length, 3);
const fl = new TextDecoder().decode(files.get(names.find((n) => n.includes('_Floating') && n.endsWith('main.caml'))));
assert(fl.includes('<LKState name="Unlock Dark">'));
assert(fl.includes('keyPath="position.y"'));
assert(fl.includes('CASpringAnimation'));

const p2 = structuredClone(p); p2.name = 'Second';
writeFileSync(`${out}/collection.tendies`, await buildTendies([p, p2], render));
const batter = await buildBatter(p, render);
writeFileSync(`${out}/template.batter`, batter);
const bfiles = await readZip(batter);
const cfg = JSON.parse(new TextDecoder().decode(bfiles.get('config.json')));
assert.equal(cfg.domain, 'AppDomain-com.apple.PosterBoard');
assert.equal(cfg.options.filter((o) => o.type === 'replace').length, 1);
for (const o of cfg.options) for (const f of o.files) assert(bfiles.has(f), 'batter option file exists: ' + f);
const bcaml = new TextDecoder().decode(bfiles.get(cfg.options.find((o) => o.type === 'set').files[0]));
assert(bcaml.includes(`nuggetId="${img.id}"`), 'nuggetId present');
console.log('OK', names.length, 'files');
