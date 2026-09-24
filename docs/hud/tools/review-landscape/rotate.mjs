// Start in portrait with something open, rotate to landscape and back; audit each step.
import { open, audit, report, OUT, demolishingBlueprint } from './lib.mjs';
const P = { width: 412, height: 915 }, L = { width: 915, height: 412 };
const { browser, page, errs } = await open(P.width, P.height);
const all = [];
const hintCheck = async (n) => {
  const r = await page.evaluate(() => { const h = document.querySelector('#hint'); if (h.hidden) return null; const b = h.getBoundingClientRect(), c = proto.shell.clearRect(); return { hint: [b.left, b.top, b.right, b.bottom].map(Math.round), clear: c, midOff: Math.round((b.left + b.right) / 2 - (c.left + c.right) / 2) }; });
  if (!r) return;
  const bad = r.hint[0] < r.clear.left - 1 || r.hint[2] > r.clear.right + 1 || r.hint[3] > r.clear.bottom + 1 || r.hint[1] < r.clear.top - 1 || Math.abs(r.midOff) > 4;
  console.log(`   hint ${JSON.stringify(r)} ${bad ? 'HINT-OUTSIDE-CLEAR' : ''}`); if (bad) all.push(`${n}: hint outside clear map ${JSON.stringify(r)}`);
};
const step = async (n, vp) => { if (vp) await page.setViewportSize(vp); await page.waitForTimeout(1500); const a = await audit(page, n); all.push(...report(a).map((i) => `${n}: ${i}`)); await hintCheck(n); await page.screenshot({ path: `${OUT}rot-${n}.png` }); };
const target = async (n, P0) => { const r = await page.evaluate((P0) => { const s = proto.toScreen(P0), c = proto.shell.clearRect(); return { s: { x: Math.round(s.x), y: Math.round(s.y) }, c, inClear: s.x > c.left && s.x < c.right && s.y > c.top && s.y < c.bottom }; }, P0); console.log(`   target ${JSON.stringify(r)}`); if (!r.inClear) all.push(`${n}: focused target not in clear map ${JSON.stringify(r)}`); };
// 1 Build sheet
await page.tap('[data-bar="build"]'); await step('build-P');
await step('build-L', L); await step('build-P2', P);
await page.tap('.sheet .close');
// 2 road tool + demolishing blueprint
await page.evaluate(() => proto.startRoadTool('street')); await page.waitForTimeout(800);
console.log('   blueprint', !!(await demolishingBlueprint(page)));
await step('blueprint-P'); await step('blueprint-L', L); await step('blueprint-P2', P);
await page.evaluate(() => proto.endTool());
// 3 stop tool + planner
await page.evaluate(() => proto.startStopTool()); await page.waitForTimeout(500);
const r = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const s of p.net.segs.values()) { if (p.net.def(s).cls !== 'road') continue; for (const m of p.net.path(s)) { const q = p.toScreen(m); if (q.x > c.left + 40 && q.x < c.right - 40 && q.y > c.top + 40 && q.y < c.bottom - 40) { const n = p.net.nearestSeg(p.groundAt(q.x, q.y), 30, (x) => p.net.def(x).cls === 'road'); if (n) { const pl = p.net.planStop(n.seg.id, n.s, 1); if (!pl.reason && pl.plans.some(x => x.ok)) return { q, P: { x: m.x, z: m.z } }; } } } } });
await page.touchscreen.tap(r.q.x, r.q.y); await page.waitForTimeout(3000);
await step('stopplan-P'); await target('stopplan-P', r.P);
await step('stopplan-L', L); await target('stopplan-L', r.P);
await step('stopplan-P2', P); await target('stopplan-P2', r.P);
await page.evaluate(() => proto.endTool());
// 4 junction editor
const j = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const j of p.junctions.values()) { if (j.form === 'join' || j.form === 'merge') continue; const n = p.net.node(j.node); const q = p.toScreen(n); if (q.x > 60 && q.x < c.right - 60 && q.y > c.top + 60 && q.y < c.bottom - 60) return { q, n: { x: n.x, z: n.z } }; } });
if (j) { await page.touchscreen.tap(j.q.x, j.q.y); await page.waitForTimeout(800); await page.tap('.sheet .act.primary'); await page.waitForTimeout(3000);
  await step('junction-P'); await target('junction-P', j.n); await step('junction-L', L); await target('junction-L', j.n); await step('junction-P2', P); await target('junction-P2', j.n); await page.tap('.sheet .close'); } else console.log('no junction');
// 5 layers + drawer
await page.tap('#clockbtn'); await page.tap('[data-bar="layers"]'); await step('layers-P'); await step('layers-L', L); await step('layers-P2', P);
console.log(`SUMMARY rotate: ${all.length} issues`); for (const i of all) console.log('  ' + i);
console.log('errors', JSON.stringify(errs));
await browser.close();
