import { open, check, junctionPt, emptyPt, buildingPt } from './lib.mjs';
const W = +(process.argv[2] || 412), H = +(process.argv[3] || 915);
const { browser, page, errs } = await open(W, H);
await page.evaluate(() => proto.startRoadTool('street'));
await page.waitForTimeout(300);
// drag through a building, with touch via CDP
const cdp = await page.context().newCDPSession(page);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const b = await buildingPt(page);
const a = { x: b.x - 110, y: b.y + 120 }, e = { x: b.x + 60, y: b.y - 40 };
await touch('touchStart', a.x, a.y);
for (let i = 1; i <= 12; i++) { await touch('touchMove', a.x + (e.x - a.x) * i / 12, a.y + (e.y - a.y) * i / 12); await page.waitForTimeout(30); }
const mid = await page.evaluate(() => { const b = document.querySelector('#t-prim button'); return b ? { t: b.textContent, dis: b.disabled, title: b.title } : null; });
await touch('touchEnd');
await page.waitForTimeout(400);
const after = await page.evaluate(() => { const b = document.querySelector('#t-prim button'); return b ? { t: b.textContent, dis: b.disabled, title: b.title, cls: b.className } : null; });
console.log('mid', JSON.stringify(mid), 'after', JSON.stringify(after));
check('Build disabled while dragging', mid && mid.t.includes('Build') && mid.dis);
check('blueprint card shown', await page.isVisible('#tpanel'), (await page.textContent('#tpanel')).slice(0, 160));
await page.screenshot({ path: `bp-${W}.png` });
// now open a junction editor while the blueprint waits (road tool, no draft required -> undo first?)
const j = await junctionPt(page);
// with a draft, tapping a junction doesn't open it (old behaviour too). Undo the draft first.
await page.tap('#t-undo');
await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(1500);
check('junction editor opens in road tool', (await page.isVisible('.sheet')) && (await page.textContent('.sheet h2')).length > 0, await page.textContent('.sheet h2'));
// draw a road with the editor open
const b2 = await buildingPt(page);
const e2 = await emptyPt(page);
const s = e2 ?? { x: W * 0.2, y: H * 0.25 };
await touch('touchStart', s.x, s.y);
for (let i = 1; i <= 10; i++) { await touch('touchMove', s.x + 120 * i / 10, s.y + 40 * i / 10); await page.waitForTimeout(30); }
await touch('touchEnd'); await page.waitForTimeout(500);
const rs = await page.evaluate(() => { const r = (s) => { const e = document.querySelector(s); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; }; return { sheet: r('#sheet'), tpanel: r('#tpanel'), tool: r('#tool') }; });
console.log(JSON.stringify(rs));
if (rs.sheet && rs.tpanel) {
  const ov = Math.max(0, Math.min(rs.sheet.bottom, rs.tpanel.bottom) - Math.max(rs.sheet.top, rs.tpanel.top)) * Math.max(0, Math.min(rs.sheet.right, rs.tpanel.right) - Math.max(rs.sheet.left, rs.tpanel.left));
  const top = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e.closest('#sheet') ? 'sheet' : e.closest('#tpanel') ? 'tpanel' : e.id; }, { x: (rs.tpanel.left + rs.tpanel.right) / 2, y: (Math.max(rs.sheet.top, rs.tpanel.top) + Math.min(rs.sheet.bottom, rs.tpanel.bottom)) / 2 });
  check('blueprint card and junction sheet do not overlap', ov === 0, `overlap ${ov} px², on top: ${top}`);
}
await page.screenshot({ path: `overlap-${W}.png` });
check('no page errors', errs.length === 0, JSON.stringify(errs));
await browser.close();
