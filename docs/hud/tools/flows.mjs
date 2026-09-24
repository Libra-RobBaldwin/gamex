import { open, coverage } from './lib.mjs';
const out = process.argv[2]; const [w, h] = (process.argv[3] || '412x915').split('x').map(Number); const tag = `${w}x${h}`;
const { browser, page, errs } = await open(w, h);
const shot = (n) => page.screenshot({ path: `${out}/${tag}-${n}.png` });
await shot('rest'); console.log('coverage rest', (await coverage(page)).toFixed(4));
await page.tap('[data-bar="build"]'); await page.waitForTimeout(600); await shot('build');
await page.tap('.card:has-text("Street")'); await page.waitForTimeout(600); await shot('tool');
// draw a road by dragging
const s = await page.evaluate(() => { const p = window.proto; const a = p.toScreen({ x: -60, z: 60 }), b = p.toScreen({ x: 40, z: 40 }); return { a, b }; });
await page.evaluate(({ a, b }) => {
  const c = document.getElementById('c'); const ev = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: true }));
  ev('pointerdown', a.x, a.y); for (let i = 1; i <= 10; i++) ev('pointermove', a.x + (b.x - a.x) * i / 10, a.y + (b.y - a.y) * i / 10); ev('pointerup', b.x, b.y);
}, s);
await page.waitForTimeout(800); await shot('blueprint');
await page.tap('#t-cancel'); await page.waitForTimeout(400);
await page.tap('[data-bar="transport"]'); await page.waitForTimeout(500); await shot('transport');
await page.tap('[data-tab="buy"]'); await page.waitForTimeout(500); await shot('buy');
await page.tap('[data-bar="layers"]'); await page.waitForTimeout(500); await shot('layers');
await page.tap('[data-bar="menu"]'); await page.waitForTimeout(500); await shot('menu');
await page.tap('[data-bar="menu"]');
await page.tap('#clockbtn'); await page.waitForTimeout(300); await shot('drawer'); await page.tap('#clockbtn');
// inspect a junction and a building
const j = await page.evaluate(() => { const p = window.proto; const ok = (q) => q.x > 60 && q.x < innerWidth - 60 && q.y > 120 && q.y < innerHeight * 0.55; const all = [...p.junctions.values()].filter(j => j.form !== 'join' && j.form !== 'merge').map(j => p.toScreen(p.net.node(j.node))); return all.find(ok); });
await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(700); await shot('junction-info');
await page.tap('.sheet .act.primary'); await page.waitForTimeout(1500); await shot('junction-edit');
await page.tap('.sheet .close'); await page.waitForTimeout(800);
const b = await page.evaluate(() => { const p = window.proto; const b = p.buildings.find(b => b.lot.kind === 'flats') ?? p.buildings[5]; return p.toScreen({ x: b.lot.x, z: b.lot.z, y: b.height / 2 }); });
await page.touchscreen.tap(b.x, b.y); await page.waitForTimeout(700); await shot('building-info');
console.log('errors', JSON.stringify(errs));
await browser.close();
