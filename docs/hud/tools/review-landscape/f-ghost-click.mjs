// A tap on the map opens an info sheet on pointerup; the browser's click from the same tap then
// lands on whatever the new sheet put under the finger. If that is a button, it fires.
// usage: node f-ghost-click.mjs 740x360
import { open, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '740x360').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
await page.evaluate(() => { window.__clicks = []; document.addEventListener('click', (e) => { const b = e.target.closest('button'); window.__clicks.push(b ? 'BUTTON:' + b.textContent.trim().slice(0, 30) : e.target.tagName); }, true); });
// where the building sheet's action button sits, then buildings whose centre is inside that box
const cands = await page.evaluate(async () => {
  const p = proto; const bs = p.buildings.filter((b) => !b.dying && !b.region && b.lot.id >= 0);
  const on = (b) => { const q = p.toScreen({ x: b.lot.x, z: b.lot.z, y: b.height / 2 }); return { q, ok: q.x > 0 && q.y > 60 && q.x < innerWidth - 90 && q.y < innerHeight - 10 && p.pickBuilding(q.x, q.y) === b }; };
  const first = bs.find((b) => on(b).ok);
  const q0 = on(first).q; p.tapMap(q0.x, q0.y);
  const btn = document.querySelector('#sheet .acts button'); const r = btn.getBoundingClientRect();
  p.shell.closeSheet();
  return bs.map(on).filter((o) => o.ok && o.q.x > r.left + 4 && o.q.x < r.right - 4 && o.q.y > r.top + 4 && o.q.y < r.bottom - 4).map((o) => o.q).slice(0, 4).concat([{ box: [r.left, r.top, r.right, r.bottom] }]);
});
console.log('action button box and candidates', JSON.stringify(cands));
let bad = 0, tried = 0;
for (const q of cands.filter((c) => c.x)) {
  await page.evaluate(() => { window.__clicks = []; });
  await page.touchscreen.tap(q.x, q.y); await page.waitForTimeout(800);
  const s = await page.evaluate(() => ({ tool: proto.shell.toolActive, mode: document.body.dataset.mode, sheet: proto.shell.sheetKey, clicks: window.__clicks }));
  tried++; const ghost = s.clicks.some((c) => c.startsWith('BUTTON')); if (ghost) bad++;
  console.log(`tap map at ${q.x.toFixed(0)},${q.y.toFixed(0)} -> sheet=${s.sheet} toolActive=${s.tool} mode=${s.mode} clicks=${JSON.stringify(s.clicks)}`);
  if (ghost) await page.screenshot({ path: `${OUT}ghost-${w}x${h}.png` });
  await page.evaluate(() => { proto.endTool(); proto.shell.closeSheet(); }); await page.waitForTimeout(300);
}
console.log(!tried ? 'INCONCLUSIVE: no building under the action button' : bad ? `FAIL: ${bad}/${tried} map taps also pressed a button in the sheet they opened` : `PASS (${tried} taps)`, errs.length ? JSON.stringify(errs) : '');
await browser.close();
