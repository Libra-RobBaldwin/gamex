import { open, check } from './lib.mjs';
const W = +(process.argv[2] || 412), H = +(process.argv[3] || 915);
const { browser, page, errs } = await open(W, H);
await page.evaluate(() => proto.startStopTool());
const r = await page.evaluate(() => { for (const s of proto.net.segs.values()) { if (proto.net.def(s).cls !== 'road') continue; const p = proto.net.path(s); for (let k = 0; k + 1 < p.length; k++) for (const f of [0.3, 0.5, 0.7]) { const m = { x: p[k].x + (p[k + 1].x - p[k].x) * f, y: 0, z: p[k].z + (p[k + 1].z - p[k].z) * f }; const q = proto.toScreen(m); if (q.x > 60 && q.x < innerWidth - 60 && q.y > 120 && q.y < innerHeight * 0.6) { const n = proto.net.nearestSeg(proto.groundAt(q.x, q.y), 30, (x) => proto.net.def(x).cls === 'road'); if (n) { const pl = proto.net.planStop(n.seg.id, n.s, 1); if (!pl.reason) return { x: q.x, y: q.y }; } } } } });
await page.touchscreen.tap(r.x, r.y); await page.waitForTimeout(2500);
const st = await page.evaluate(({ x, y }) => {
  const s = document.querySelector('#sheet').getBoundingClientRect();
  const g = proto.groundAt(x, y); // not used
  return { sheetTop: Math.round(s.top), clear: proto.shell.clearRect() };
}, r);
// where is the tapped point now? recompute the stop target from the sheet's preview: use nearest seg of original ground point
console.log(JSON.stringify(st));
check('stop planner: clearRect excludes the sheet', st.clear.bottom <= st.sheetTop + 1, `clearRect.bottom=${st.clear.bottom}, sheet top=${st.sheetTop}, title=${await page.textContent('.sheet h2')}`);
await page.screenshot({ path: `stopplan-${W}.png` });
await page.evaluate(() => proto.endTool());
// opts row at this width
await page.evaluate(() => proto.startRoadTool('street'));
const o = await page.$eval('#tool .opts', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
console.log('opts row', JSON.stringify(o));
if (o.sw > o.cw + 1) {
  await page.$eval('#tool .opts', (e) => { e.scrollLeft = e.scrollWidth; });
  await page.waitForTimeout(100);
  const before = await page.$eval('#tool .opts', (e) => e.scrollLeft);
  const tb = await page.$eval('[data-x="tunnel"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(tb.x, tb.y); await page.waitForTimeout(150);
  const after = await page.$eval('#tool .opts', (e) => e.scrollLeft);
  const vis = await page.$eval('[data-x="tunnel"]', (e) => { const r = e.getBoundingClientRect(); const o = e.closest('.opts').getBoundingClientRect(); return { pressed: e.getAttribute('aria-pressed'), inView: r.right <= o.right + 1 }; });
  check('options row keeps its scroll after tapping Under', after === before && vis.inView, `scrollLeft ${before} -> ${after}; Under pressed=${vis.pressed}, still in view=${vis.inView}`);
}
check('no page errors', errs.length === 0, JSON.stringify(errs));
await browser.close();
