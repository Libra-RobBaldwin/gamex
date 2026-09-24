// Combinations: road tool + junction editor + drag; editor then Escape/tap; rapid taps; map taps with sheets open; pinch with sheet open
import { open, box, vis, drag, mutations } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
const log = (...a) => console.log(...a);
let fails = 0; const check = (ok, msg) => { log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const jn = () => page.evaluate(() => { const p = window.proto; const ok = (q) => q.x > 60 && q.x < innerWidth - 60 && q.y > 130 && q.y < innerHeight * 0.45; return [...p.junctions.values()].filter(j => j.form !== 'join' && j.form !== 'merge').map(j => ({ node: j.node, ...p.toScreen(p.net.node(j.node)) })).find(ok); });
const saved = await page.evaluate(() => ({ ...proto.view }));
const home = async () => { await page.evaluate((v) => { Object.assign(proto.view, v); }, saved); await page.waitForTimeout(700); };
// A. road tool, tap a junction -> editor sheet over tool strip; then drag on the map above
await page.tap('[data-bar="build"]'); await page.tap('.card:has-text("Street")'); await page.waitForTimeout(400);
let j = await jn(); log('junction', JSON.stringify(j));
await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(2500);
log('sheet', await page.textContent('.sheet h2').catch(() => 'none'), JSON.stringify(await box(page, '#sheet')), 'tool', JSON.stringify(await box(page, '#tool')));
await shot('tool-junction-editor');
await drag(page, { x: w * 0.2, y: 110 }, { x: w * 0.8, y: 200 }); await page.waitForTimeout(900);
await shot('tool-junction-editor-drag');
const sb = await box(page, '#sheet'), tp = await box(page, '#tpanel');
const both = (await vis(page, '#sheet')) && (await vis(page, '#tpanel'));
check(!(both && tp.top < sb.bottom && tp.bottom > sb.top), `blueprint card does not overlap an open sheet (sheet ${JSON.stringify(sb)}, card ${JSON.stringify(tp)})`);
await page.tap('#t-cancel'); await page.waitForTimeout(400);
check(!(await vis(page, '#sheet')) && await vis(page, '#bar'), 'cancel closes everything');
// B. junction editor in look mode, then open Layers (closes sheet), is editing left?
await home(); j = await jn(); await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(1200);
await page.tap('.sheet .act.primary'); await page.waitForTimeout(1500);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check(!(await vis(page, '#sheet')), 'Escape closes junction editor');
// C. rapid taps on bar buttons
for (let i = 0; i < 6; i++) { await page.tap('[data-bar="build"]'); }
log('after 6 taps on Build: sheet', await vis(page, '#sheet'));
for (const k of ['build', 'transport', 'layers', 'menu', 'build', 'layers']) await page.tap(`[data-bar="${k}"]`);
await page.waitForTimeout(400);
const lit = await page.$$eval('#bar button[aria-expanded="true"]', (b) => b.map((x) => x.dataset.bar));
log('after rapid mix: sheet', await vis(page, '#sheet'), 'layers', await vis(page, '#layers'), 'lit', JSON.stringify(lit));
check(lit.length === 1 && lit[0] === 'layers' && await vis(page, '#layers') && !(await vis(page, '#sheet')), 'rapid bar taps leave exactly Layers open and lit');
await page.tap('[data-bar="layers"]');
// D. tap the map while Build sheet open -> sheet closes? (empty spot) and first-run not relevant
await page.tap('[data-bar="build"]'); await page.waitForTimeout(300);
await page.touchscreen.tap(w * 0.5, 120); await page.waitForTimeout(800);
log('map tap with Build open -> sheet', await page.textContent('.sheet h2').catch(() => 'closed'), 'lit', JSON.stringify(await page.$$eval('#bar button[aria-expanded="true"]', (b) => b.map((x) => x.dataset.bar))));
await page.evaluate(() => proto.shell.closeSheet());
// E. pinch with the Transport sheet open (touches on the map above the sheet)
await page.tap('[data-bar="transport"]'); await page.waitForTimeout(300);
const h0 = await page.evaluate(() => proto.view.h);
await page.evaluate(({ w }) => { const c = document.getElementById('c'); const ev = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
  ev('pointerdown', 1, w / 2 - 30, 200); ev('pointerdown', 2, w / 2 + 30, 200); for (let i = 1; i <= 10; i++) { ev('pointermove', 1, w / 2 - 30 - i * 8, 200); ev('pointermove', 2, w / 2 + 30 + i * 8, 200); } ev('pointerup', 1, w / 2 - 110, 200); ev('pointerup', 2, w / 2 + 110, 200); }, { w });
await page.waitForTimeout(300);
log('pinch with sheet open: h', h0.toFixed(1), '->', (await page.evaluate(() => proto.view.h)).toFixed(1), 'sheet still', await vis(page, '#sheet'));
await page.tap('.sheet .close');
// F. start a tool from an info sheet (building -> Add a bus stop)
await home(); const b = await page.evaluate(() => { const p = proto; for (const b of p.buildings) { if (b.dying || b.region) continue; const s = p.toScreen({ x: b.lot.x, z: b.lot.z, y: b.height / 2 }); if (s.x > 40 && s.x < innerWidth - 40 && s.y > 130 && s.y < innerHeight * 0.5 && p.pickBuilding(s.x, s.y) === b) return s; } });
await page.touchscreen.tap(b.x, b.y); await page.waitForTimeout(800);
log('building sheet', await page.textContent('.sheet h2'), '|', (await page.textContent('.sheet .sub').catch(() => '')));
await shot('building-info');
await page.tap('.sheet .act:has-text("Add a bus stop")'); await page.waitForTimeout(400);
check(!(await vis(page, '#sheet')) && (await page.textContent('#tool .tw b')) === 'Bus stop', 'Add a bus stop from building starts stop tool and closes sheet');
await page.tap('#t-cancel');
// G. mutations while the junction editor is open (traffic counting could re-render)
await home(); j = await jn(); await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(1200); await page.tap('.sheet .act.primary'); await page.waitForTimeout(1500);
log('mutations junction editor 5s', JSON.stringify(await mutations(page, 5000)));
await page.tap('.sheet .back'); await page.waitForTimeout(500);
log('back ->', await page.textContent('.sheet h2'));
await page.tap('.sheet .close');
log('errors', JSON.stringify(errs));
log(fails ? `FAIL ${fails}` : 'PASS');
await browser.close();
