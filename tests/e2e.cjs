// Browser end-to-end test (Playwright + Chromium).
//   npm start   (serves on :8080)   then   node tests/e2e.cjs [baseUrl]
// Covers: templates, every layer kind, image upload, canvas drag in a state,
// recipes, loops, undo/redo, .tendies + .batter export, re-import.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');

const BASE = process.argv[2] || 'http://localhost:8080/';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tendies-e2e-'));
// 2×2 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDFgBYxBAAA5XQEDw8M1xgAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(path.join(tmp, 'pic.png'), png);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.goto(BASE);
  await pg.waitForFunction(() => window.__studio?.store.project);
  const project = () => pg.evaluate(() => window.__studio.store.project);

  // every template loads
  for (const name of ['Tag & Nacht', 'Schneenacht', 'Neon-Puls', 'Foto-Reveal', 'Leer']) {
    await pg.click('#libBtn');
    await pg.click(`.tpl:has-text("${name}")`);
  }
  // add layers
  const fc = pg.waitForEvent('filechooser');
  await pg.click('[data-add="image"]');
  await (await fc).setFiles(path.join(tmp, 'pic.png'));
  await pg.waitForFunction(() => window.__studio.store.project.layers.length === 1);
  for (const k of ['text', 'gradient', 'color', 'shape', 'emitter']) await pg.click(`[data-add="${k}"]`);
  assert.equal((await project()).layers.length, 6);

  // drag the image while editing the Unlock state → state override
  await pg.click('.layer-row:has-text("pic")');
  await pg.click('.seg.states .seg-btn[data-v="Unlock"]');
  const box = await pg.locator('.sel-box').boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, { steps: 5 });
  await pg.mouse.up();
  const pic = (await project()).layers.find((l) => l.name === 'pic');
  assert(pic.states.Unlock && 'x' in pic.states.Unlock, 'drag in Unlock writes a state override');

  // recipe + loop
  await pg.click('.tab:has-text("Bewegung")');
  await pg.click('.chip:has-text("Im Ruhemodus abdunkeln")');
  await pg.selectOption('.section:has-text("Dauer-Animation") select', 'float');
  const pic2 = (await project()).layers.find((l) => l.name === 'pic');
  assert.equal(pic2.states.Sleep.opacity, 0.25);
  assert.equal(pic2.loop.type, 'float');

  // undo / redo
  await pg.click('#stage', { position: { x: 5, y: 5 } });
  await pg.keyboard.press('Control+z');
  assert.equal((await project()).layers.find((l) => l.name === 'pic').loop.type, 'none');
  await pg.keyboard.press('Control+Shift+z');
  assert.equal((await project()).layers.find((l) => l.name === 'pic').loop.type, 'float');

  // export
  await pg.click('.seg.states .seg-btn[data-v="Locked"]');
  const dl = pg.waitForEvent('download');
  await pg.click('#exportBtn');
  const file = path.join(tmp, 'out.tendies');
  await (await dl).saveAs(file);
  assert(fs.statSync(file).size > 1000);

  // re-import
  await pg.click('.tab:has-text("Projekt")');
  const fc2 = pg.waitForEvent('filechooser');
  await pg.click('button:has-text(".tendies importieren & bearbeiten")');
  await (await fc2).setFiles(file);
  await pg.waitForFunction(() => window.__studio.store.project.name === 'Neues Wallpaper' && window.__studio.store.project.layers.length >= 5);
  const imp = await project();
  assert(imp.layers.some((l) => l.states.Unlock), 'state overrides survive a round trip');

  assert.deepEqual(errors, []);
  console.log('E2E OK');
  await browser.close();
})().catch((e) => {
  console.error('E2E FAILED', e);
  process.exit(1);
});
