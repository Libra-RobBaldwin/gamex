// Bus stop tool: tap a road -> planner sheet; is the chosen road visible above the sheet? build; Lines; stop info
import { open, box, vis, smallTargets } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
const log = (...a) => console.log(...a);
let fails = 0; const check = (ok, msg) => { log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
await page.tap('[data-bar="build"]'); await page.tap('[data-tab="stops"]'); await page.waitForTimeout(300);
await shot('build-stops');
await page.tap('.card:has-text("Bus stop")'); await page.waitForTimeout(400);
log('tool', await page.textContent('#tool .tw b'), await page.getAttribute('#tool', 'class'), 'hint', await page.textContent('#hint'));
const r = await page.evaluate(() => { const P = proto; for (let y = 140; y < innerHeight * 0.55; y += 7) for (let x = 50; x < innerWidth - 50; x += 7) { const g = P.groundAt(x, y); const n = P.net.nearestSeg(g, 30, (s) => P.net.def(s).cls === 'road'); if (!n) continue; const pl = P.net.planStop(n.seg.id, n.s, P.net.sideOf(n.seg, g)); if (!pl.reason && pl.plans.some((q) => q.ok)) return { x, y, g }; } });
log('tap at', JSON.stringify(r));
await page.touchscreen.tap(r.x, r.y); await page.waitForTimeout(2500);
await shot('stop-plan');
const sb = await box(page, '#sheet');
const at = await page.evaluate((g) => proto.toScreen(g), r.g);
check(at.y < sb.top, `stop planner: the tapped spot (y=${at.y.toFixed(0)}) is above the sheet (top ${sb.top}, h ${sb.h})`);
const hb = await box(page, '#hint');
log('hint', JSON.stringify(hb), await page.textContent('#hint'), 'hidden?', await page.evaluate(() => document.getElementById('hint').hidden));
check(!(await vis(page, '#hint')) || hb.bottom <= sb.top, 'tool hint not painted under the planner sheet');
log('small', JSON.stringify(await smallTargets(page)));
const ok = await page.$('[data-plan]:not([disabled])');
if (ok) { await ok.tap(); await page.waitForTimeout(1000); }
log('stops', await page.evaluate(() => [...proto.net.segs.values()].reduce((t, s) => t + s.stops.length, 0)), 'sheet open', await vis(page, '#sheet'), 'hint', await page.textContent('#hint'));
await shot('stop-built');
await page.tap('#t-prim button'); await page.waitForTimeout(300);
check(await vis(page, '#bar'), 'Done restores bar');
await page.tap('[data-bar="transport"]'); await page.waitForTimeout(400); await shot('lines');
const row = await page.$('[data-stop]');
if (row) { await row.tap(); await page.waitForTimeout(2000); log('stop info', await page.textContent('.sheet h2')); await shot('stop-info');
  const sb2 = await box(page, '#sheet'); const st = await page.evaluate(() => { for (const s of proto.net.segs.values()) for (const x of s.stops) return proto.toScreen(proto.groundAt(0,0) && { x: 0, z: 0 }); });
  log('stop sheet', JSON.stringify(sb2));
}
// stop info by tapping the stop on the map: stop info sheet should open
await page.tap('.sheet .close');
log('errors', JSON.stringify(errs));
log(fails ? `FAIL ${fails}` : 'PASS');
await browser.close();
