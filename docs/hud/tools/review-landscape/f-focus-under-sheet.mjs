// focusOn frames the target in shell.clearRect(). clearRect only treats a full-width panel as
// covering the bottom when its top is below mid-screen, so a tall sheet (55dvh) is ignored and the
// junction / stop being edited is centred underneath it. The hint is also placed under the sheet.
// usage: node f-focus-under-sheet.mjs 412x915
import { open, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
let fails = 0;
const check = async (name, P0) => {
  const r = await page.evaluate((P0) => {
    const s = proto.toScreen(P0), c = proto.shell.clearRect(), sh = document.querySelector('#sheet').getBoundingClientRect(), hi = document.querySelector('#hint');
    const under = s.x > sh.left && s.x < sh.right && s.y > sh.top && s.y < sh.bottom;
    const hb = hi.hidden ? null : hi.getBoundingClientRect();
    return { target: [Math.round(s.x), Math.round(s.y)], clear: c, sheet: [sh.left, sh.top, sh.right, sh.bottom].map(Math.round), under, hintUnder: !!hb && hb.bottom > sh.top && hb.top < sh.bottom && hb.right > sh.left && hb.left < sh.right };
  }, P0);
  const bad = r.under || r.hintUnder; if (bad) fails++;
  console.log(`${bad ? 'FAIL' : 'PASS'} ${name}: target ${r.under ? 'UNDER the sheet' : 'clear'}${r.hintUnder ? ', hint under the sheet' : ''} ${JSON.stringify(r)}`);
  await page.screenshot({ path: `${OUT}focus-${name}-${w}x${h}.png` });
};
// junction editor
const j = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const j of p.junctions.values()) { if (j.form === 'join' || j.form === 'merge') continue; const n = p.net.node(j.node); const q = p.toScreen(n); if (q.x > c.left + 50 && q.x < c.right - 50 && q.y > c.top + 50 && q.y < c.bottom - 50) return { q, n: { x: n.x, z: n.z } }; } });
if (j) { await page.touchscreen.tap(j.q.x, j.q.y); await page.waitForTimeout(800); await page.tap('.sheet .act.primary'); await page.waitForTimeout(3500); await check('junction-editor', j.n); await page.tap('.sheet .close'); await page.waitForTimeout(500); } else console.log('no junction on screen');
// stop planner (tool strip showing)
await page.evaluate(() => proto.startStopTool()); await page.waitForTimeout(500);
const r = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const s of p.net.segs.values()) { if (p.net.def(s).cls !== 'road') continue; for (const m of p.net.path(s)) { const q = p.toScreen(m); if (q.x > c.left + 40 && q.x < c.right - 40 && q.y > c.top + 40 && q.y < c.bottom - 40) { const n = p.net.nearestSeg(p.groundAt(q.x, q.y), 30, (x) => p.net.def(x).cls === 'road'); if (n) { const pl = p.net.planStop(n.seg.id, n.s, 1); if (!pl.reason && pl.plans.some(x => x.ok)) return { q, P: { x: m.x, z: m.z } }; } } } } });
await page.touchscreen.tap(r.q.x, r.q.y); await page.waitForTimeout(3500); await check('stop-planner', r.P);
console.log(fails ? `FAIL (${fails})` : 'PASS', errs.length ? JSON.stringify(errs) : '');
await browser.close();
