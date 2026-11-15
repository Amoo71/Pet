// Browser end-to-end test (Playwright + Chromium).
//   npm start   (serves on :8080)   then   node tests/e2e.cjs [baseUrl]
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const BASE = process.argv[2] || 'http://localhost:8080/';
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'tendies-e2e-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDFgBYxBAAA5XQEDw8M1xgAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(path.join(OUT, 'pic.png'), png);
// 3-frame 8×8 animated GIF with transparency (generated with Pillow)
const gif = Buffer.from('R0lGODlhCAAIAIEAAAAAAP8AAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJCgAAACwAAAAACAAIAAAIGwADCAwAoCCAgQQNIjR4cCDDhQodRhT4UGLBgAAh+QQJCgAAACwCAAAABAAIAIEAAAD/AAAAAAAAAAAIDAADCBxIsKDBgwQDAgAh+QQJCgAAACwEAAAABAAIAIEAAAD/AAAAAAAAAAAIDAADCBxIsKDBgwQDAgA7', 'base64');
fs.writeFileSync(path.join(OUT, 'anim.gif'), gif);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  // mock GIPHY
  await pg.route('https://api.giphy.com/**', (r) =>
    r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: [{ id: 'x', title: 'test gif', images: { fixed_width_small: { url: 'https://media.giphy.com/t.gif' }, downsized_medium: { url: 'https://media.giphy.com/t.gif' }, original: { width: '4', height: '4' } } }], pagination: { offset: 0, count: 1, total_count: 1 } }) })
  );
  await pg.route('https://media.giphy.com/**', (r) => r.fulfill({ contentType: 'image/gif', headers: { 'access-control-allow-origin': '*' }, body: gif }));
  await pg.goto(BASE);
  await pg.waitForFunction(() => window.__studio?.store.project);
  const project = () => pg.evaluate(() => window.__studio.store.project);

  // every template loads
  for (const id of ['liquid', 'frosted', 'depth', 'snow', 'neon', 'daynight', 'blank']) {
    await pg.click('#libBtn');
    await pg.click(`.tpl[data-tpl="${id}"]`);
  }
  // blank project → add every kind
  let fc = pg.waitForEvent('filechooser');
  await pg.click('[data-add="image"]');
  await (await fc).setFiles(path.join(OUT, 'pic.png'));
  await pg.waitForFunction(() => window.__studio.store.project.layers.length === 1);
  for (const k of ['text', 'gradient', 'color', 'shape', 'glass', 'emitter']) await pg.click(`[data-add="${k}"]`);
  // GIF file via image picker
  fc = pg.waitForEvent('filechooser');
  await pg.click('[data-add="image"]');
  await (await fc).setFiles(path.join(OUT, 'anim.gif'));
  await pg.waitForFunction(() => window.__studio.store.project.layers.some((l) => l.kind === 'video' && l.video.gif));
  // GIF search (mocked provider)
  await pg.evaluate(() => localStorage.setItem('tendies.gifsearch', JSON.stringify({ provider: 'giphy', giphyKey: 'test' })));
  await pg.click('[data-add="gif"]');
  await pg.waitForSelector('.gif-item');
  await pg.click('.gif-item');
  await pg.waitForFunction(() => window.__studio.store.project.layers.filter((l) => l.kind === 'video').length === 2);
  assert.equal((await project()).layers.length, 9);

  // state edit by dragging in Home state
  await pg.click('.layer-row:has-text("pic")');
  await pg.click('.seg.states .seg-btn[data-v="Unlock"]');
  const box = await pg.locator('.sel-box').boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 - 40, { steps: 5 });
  await pg.mouse.up();
  const pic = (await project()).layers.find((l) => l.name === 'pic');
  assert(pic.states.Unlock && 'y' in pic.states.Unlock, 'drag in Home writes a state override');

  // motion tab: recipe, parallax, animations
  await pg.click('.tab[data-tab="motion"]');
  await pg.click('.chip:has-text("Dim in Always-On")');
  await pg.click('[data-anim="float"]');
  await pg.click('[data-anim="spin"]');
  await pg.waitForTimeout(300); // panel re-renders on the next animation frame
  await pg.locator('.section:has-text("Gyro") .field:has-text("Move") input.num').fill('14');
  await pg.locator('.section:has-text("Gyro") .field:has-text("3D tilt") input.num').fill('12');
  let p = await project();
  let l = p.layers.find((x) => x.name === 'pic');
  assert.equal(l.states.Sleep.opacity, 0.25);
  assert.equal(l.anims.length, 2);
  assert.equal(l.parallax, 14);
  // style tab: blend + blur
  await pg.click('.tab[data-tab="style"]');
  await pg.selectOption('.field:has-text("Blend") select', 'screenBlendMode');
  l = (await project()).layers.find((x) => x.name === 'pic');
  assert.equal(l.blend, 'screenBlendMode');

  // undo / redo
  await pg.click('#stage', { position: { x: 5, y: 5 } });
  await pg.keyboard.press('Control+z');
  assert.equal((await project()).layers.find((x) => x.name === 'pic').blend, 'normal');
  await pg.keyboard.press('Control+Shift+z');

  // preview mode: swipe up follows the finger (modern)
  await pg.click('.seg.states .seg-btn[data-v="Locked"]');
  await pg.click('.seg.mode .seg-btn[data-v="preview"]');
  const ph = await pg.locator('#phone').boundingBox();
  await pg.mouse.move(ph.x + ph.width / 2, ph.y + ph.height * 0.9);
  await pg.mouse.down();
  await pg.mouse.move(ph.x + ph.width / 2, ph.y + ph.height * 0.7, { steps: 4 });
  const mid = await pg.evaluate(() => getComputedStyle(document.getElementById('phone')).getPropertyValue('--u'));
  assert(Number(mid) > 0.1 && Number(mid) < 0.9, `mid-swipe progress ${mid}`);
  await pg.mouse.move(ph.x + ph.width / 2, ph.y + ph.height * 0.3, { steps: 4 });
  await pg.mouse.up();
  await pg.waitForFunction(() => window.__studio.store.view.state === 'Unlock');
  await pg.click('.seg.mode .seg-btn[data-v="edit"]');
  await pg.click('.seg.states .seg-btn[data-v="Locked"]');

  // export all formats (duo last: it switches the device)
  for (const format of ['modern', 'classic', 'duo']) {
    await pg.click('#exportBtn');
    await pg.click(`.format-card[data-format="${format}"]`);
    const dl = pg.waitForEvent('download');
    await pg.click('.modal-actions button:has-text("Export .tendies")');
    const file = path.join(OUT, `out-${format}.tendies`);
    await (await dl).saveAs(file);
    assert(fs.statSync(file).size > 1000);
  }
  assert.equal((await project()).device, 'iphone-duo', 'duo switches device');
  // re-import the modern file
  await pg.click('.tab[data-tab="project"]');
  fc = pg.waitForEvent('filechooser');
  await pg.click('button:has-text("Import .tendies to edit")');
  await (await fc).setFiles(path.join(OUT, 'out-modern.tendies'));
  await pg.waitForFunction(() => window.__studio.store.project.format === 'modern' && window.__studio.store.project.layers.some((x) => x.name === 'pic'));
  const imp = await project();
  const ipic = imp.layers.find((x) => x.name === 'pic');
  assert(ipic.states.Unlock && Math.abs(ipic.states.Unlock.y - pic.states.Unlock.y) < 2, 'state y survives a modern round trip');
  assert.equal(ipic.parallax, 14, 'parallax survives');
  // 3D photo (offline depth) → depth layers with increasing gyro parallax
  await pg.click('#libBtn');
  await pg.click('.tpl[data-tpl="blank"]');
  await pg.click('.tab[data-tab="layers"]');
  fc = pg.waitForEvent('filechooser');
  await pg.click('[data-add="photo3d"]');
  await (await fc).setFiles(path.join(OUT, 'pic.png'));
  await pg.click('.modal .seg-btn[data-v="simple"]');
  await pg.click('.modal-actions button:has-text("Create 3D layers")');
  await pg.waitForFunction(() => window.__studio.store.project.layers.length === 4, null, { timeout: 60000 });
  const d3 = (await project()).layers.map((x) => x.parallax);
  assert(d3[0] < d3[1] && d3[1] < d3[2] && d3[2] < d3[3], 'nearer layers move more');
  assert.equal((await project()).format, 'modern');
  // effects: Duo fold on the 3D photo project
  await pg.click('[data-add="effects"]');
  await pg.click('.modal-actions button:has-text("Apply")');
  await pg.waitForFunction(() => { const L = window.__studio.store.project.layers.filter((x) => x.fx === 'duotilt'); return L.length === 5 && L.filter((x) => x.gyro?.tilt >= 20).length === 4 && L.filter((x) => x.anchor?.x === 0).length === 2 && L.filter((x) => x.anchor?.x === 1).length === 2 && window.__studio.store.project.perspective > 0; }, null, { timeout: 60000 });
  // turn it off again → the original layers come back
  await pg.click('[data-add="effects"]');
  await pg.click('.fx[data-fx="duotilt"]');
  await pg.click('.fx[data-fx="duo"]');
  await pg.click('.modal-actions button:has-text("Apply")');
  await pg.waitForFunction(() => { const p = window.__studio.store.project; return !p.layers.some((x) => x.fx === 'duotilt') && p.perspective > 0 && p.layers.some((x) => x.name === 'Duo fold' && x.anchor.x === 1 && x.gyro.fold > 0) && p.layers.filter((x) => !x.fx).every((x) => !x.hidden); }, null, { timeout: 60000 });
  // Duo template + postures
  await pg.click('#libBtn');
  await pg.click('.tpl[data-tpl="duo3d"]');
  for (const v of ['cover', 'land', 'inner']) await pg.click(`.seg.posture .seg-btn[data-v="${v}"]`);
  assert.equal(ipic.blend, 'screenBlendMode', 'blend survives');

  // raw morph of an Apple-style wallpaper (3D rig + HEIC): kept as is, snow added
  await pg.evaluate(async () => {
    const { createZip } = await import('/src/core/zip.js');
    const { toBinaryPlist } = await import('/src/core/bplist.js');
    const enc = new TextEncoder();
    const base = 'descriptors/M/versions/0/contents/7960.Marble.wallpaper/';
    const caml = '<?xml version="1.0"?><caml xmlns="http://www.apple.com/CoreAnimation/1.0"><CALayer bounds="0 0 2412 5244" name="Root Layer" position="1206 2622"><sublayers><CATransformLayer id="BACKGROUND" bounds="0 0 0 0" name="BACKGROUND" position="1206 2622"><sublayers><CATransformLayer name="_GYRO"/></sublayers></CATransformLayer><CATransformLayer id="FLOATING" bounds="0 0 0 0" name="FLOATING" position="1206 2622"/></sublayers></CALayer></caml>';
    const bytes = createZip([
      { path: base + 'Wallpaper.plist', data: toBinaryPlist({ assets: { lockAndHome: { default: { type: 'ParameterizedCA' } } } }) },
      { path: base + 'wallpaper.ca/main.caml', data: enc.encode(caml) },
      { path: base + 'wallpaper.ca/assets/a.HEIC', data: new Uint8Array(8) },
    ]);
    const a = await import('/src/app/actions.js');
    a.rawMorphFlow([{ name: 'Marble', bytes }]);
  });
  await pg.waitForSelector('.modal .fx[data-fx="fx-snow"]');
  await pg.click('.modal .fx[data-fx="fx-snow"]');
  await pg.locator('.modal .field:has-text("Light intensity") input.num').fill('0.6');
  await pg.locator('.modal .field:has-text("Saturation") input.num').fill('1.4');
  assert.equal(await pg.locator('.modal .fx[data-fx="duotilt"]').count(), 0, 'raw morph offers overlay effects only');
  // edit the original: hide one of its layers
  await pg.click('.orig summary:has-text("Layers")');
  await pg.locator('.orig .orig-row:has-text("_GYRO") .switch').click();
  const rdl = pg.waitForEvent('download');
  await pg.click('.modal-actions button:has-text("Morph & export")');
  const rfile = path.join(OUT, 'raw-morph.tendies');
  await (await rdl).saveAs(rfile);
  const rbuf = fs.readFileSync(rfile);
  assert(rbuf.includes(Buffer.from('morph-snow')) && rbuf.includes(Buffer.from('a.HEIC')), 'raw morph output keeps HEIC and adds snow');
  assert(rbuf.includes(Buffer.from('morph-light')) && rbuf.includes(Buffer.from('Morph Saturate')), 'light + grading');
  assert(/<CATransformLayer hidden="1" name="_GYRO"|name="_GYRO"[^>]*hidden="1"/.test(rbuf.toString('latin1')), 'original layer hidden');
  // system-drawn Apple wallpaper: look switch
  await pg.evaluate(async () => {
    const { createZip } = await import('/src/core/zip.js');
    const { toBinaryPlist } = await import('/src/core/bplist.js');
    const d = 'Container/Library/Application Support/PRBPosterExtensionDataStore/61/Extensions/com.apple.MercuryPoster/descriptors/X/';
    const bytes = createZip([
      { path: d + 'com.apple.posterkit.provider.descriptor.identifier', data: new TextEncoder().encode('X') },
      { path: d + 'versions/0/contents/com.apple.posterkit.provider.contents.userInfo', data: toBinaryPlist({ appearanceMode: 'Automatic', lookIdentifier: 'colorA' }) },
    ]);
    (await import('/src/app/actions.js')).rawMorphFlow([{ name: 'Mercury', bytes }]);
  });
  await pg.click('.modal .seg-btn[data-v="colorC"]');
  const sdl = pg.waitForEvent('download');
  await pg.click('.modal-actions button:has-text("Export")');
  const sfile = path.join(OUT, 'system.tendies');
  await (await sdl).saveAs(sfile);
  assert(fs.readFileSync(sfile).includes(Buffer.from('colorC')), 'look switched');

  // new shell: rail toggles the inspector, Duo 3D preview opens
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => document.querySelectorAll('.modal-back').forEach((m) => m.remove()));
  await pg.click('.rail-btn.tab[data-tab="style"]');
  const undoLen = await pg.evaluate(() => window.__studio.store.undo.length);
  await pg.click('.rail-btn.tab[data-tab="style"]');
  assert.equal(await pg.evaluate(() => document.getElementById('app').dataset.panel), 'closed', 'tapping the active tab closes the panel');
  assert.equal(await pg.evaluate(() => window.__studio.store.undo.length), undoLen, 'panel toggling is not an undo step');
  await pg.click('.rail-btn.tab[data-tab="layers"]');
  assert.equal(await pg.evaluate(() => document.getElementById('app').dataset.panel), 'open');
  await pg.click('#duoBtn');
  await pg.waitForSelector('duo-fold');
  assert.deepEqual(errors, []);
  console.log('E2E OK →', OUT);
  await browser.close();
})().catch((e) => {
  console.error('E2E FAILED', e);
  process.exit(1);
});
