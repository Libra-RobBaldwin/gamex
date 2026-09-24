import { open, check, junctionPt, emptyPt, buildingPt } from './lib.mjs';
const { browser, page, errs } = await open();
const W = 412, H = 915;
// --- rail defaults cross to bridge
await page.evaluate(() => proto.startRoadTool('rail-main'));
await page.waitForTimeout(200);
check('rail tool: crossing defaults to Over (bridge)', (await page.getAttribute('[data-x="bridge"]', 'aria-pressed')) === 'true');
// --- view picker reachable while a tool is active?
const layersVisible = await page.isVisible('[data-bar="layers"]');
const anyView = await page.$$eval('[data-view], #top, #viewbtn', (a) => a.filter((e) => e.offsetParent).length);
check('Plan/Low view reachable while a tool is active (old #top button was)', layersVisible || anyView > 0, `layers button visible=${layersVisible}, view controls=${anyView}`);
await page.evaluate(() => proto.endTool());
// --- grade clamp: rack rail at 20% then street
await page.evaluate(() => proto.startRoadTool('rail-rack'));
for (let i = 0; i < 6 && !(await page.textContent('#g-g')).includes('20%'); i++) await page.tap('#g-g');
const rackG = await page.textContent('#g-g');
await page.evaluate(() => proto.endTool());
await page.evaluate(() => proto.startRoadTool('street'));
const stG = await page.textContent('#g-g');
check('grade clamps on type change (rack 20% -> street)', !stG.includes('20%'), `rack ${rackG.trim()} street ${stG.trim()}`);
// --- options row scroll position survives an option tap
const o = await page.$eval('#tool .opts', (e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
console.log('opts row', JSON.stringify(o));
if (o.sw > o.cw + 1) {
  await page.$eval('#tool .opts', (e) => { e.scrollLeft = e.scrollWidth; });
  await page.waitForTimeout(100);
  const before = await page.$eval('#tool .opts', (e) => e.scrollLeft);
  const tb = await page.$eval('[data-x="tunnel"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.touchscreen.tap(tb.x, tb.y);
  await page.waitForTimeout(150);
  const after = await page.$eval('#tool .opts', (e) => e.scrollLeft);
  const tun = await page.$eval('[data-x="tunnel"]', (e) => { const r = e.getBoundingClientRect(); return { right: r.right, pressed: e.getAttribute('aria-pressed') }; });
  const optsR = await page.$eval('#tool .opts', (e) => e.getBoundingClientRect().right);
  check('options row keeps its scroll after tapping Under', after === before && tun.right <= optsR + 1, `scrollLeft ${before} -> ${after}; Under pressed=${tun.pressed}, its right edge ${tun.right.toFixed(0)} vs row ${optsR.toFixed(0)}`);
  await page.screenshot({ path: 'opts-after.png' });
}
await page.evaluate(() => proto.endTool());
check('no page errors', errs.length === 0, JSON.stringify(errs));
await browser.close();
