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
  await pg.locator('.section:has-text("Gyro parallax") input.num').fill('14');
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

  // export both formats
  for (const format of ['modern', 'classic']) {
    await pg.click('#exportBtn');
    await pg.click(`.format-card[data-format="${format}"]`);
    const dl = pg.waitForEvent('download');
    await pg.click('.modal-actions button:has-text("Export .tendies")');
    const file = path.join(OUT, `out-${format}.tendies`);
    await (await dl).saveAs(file);
    assert(fs.statSync(file).size > 1000);
  }
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
  assert.equal(ipic.blend, 'screenBlendMode', 'blend survives');

  assert.deepEqual(errors, []);
  console.log('E2E OK →', OUT);
  await browser.close();
})().catch((e) => {
  console.error('E2E FAILED', e);
  process.exit(1);
});
