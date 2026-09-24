import { chromium } from 'playwright-core';
export async function open(w = 412, h = 915, wait = 11000) {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--ignore-certificate-errors'] });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto('http://127.0.0.1:5173/proto.html');
  await page.waitForTimeout(wait);
  return { browser, page, errs };
}
export const check = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
// a junction (not join/merge) on screen in the clear map
export const junctionPt = (page) => page.evaluate(() => {
  const r = proto.shell.clearRect();
  for (const j of proto.junctions.values()) {
    if (j.form === 'join' || j.form === 'merge') continue;
    const q = proto.toScreen(proto.net.node(j.node));
    if (q.x > r.left + 40 && q.x < r.right - 40 && q.y > r.top + 40 && q.y < r.bottom - 40) return { x: q.x, y: q.y, node: j.node, form: j.form };
  }
  return null;
});
// an empty ground point (no building, not near road)
export const emptyPt = (page) => page.evaluate(() => {
  const r = proto.shell.clearRect();
  for (let y = r.top + 60; y < r.bottom - 60; y += 17) for (let x = r.left + 40; x < r.right - 40; x += 13) {
    if (proto.pickBuilding(x, y)) continue;
    const g = proto.groundAt(x, y);
    if (proto.net.nearestSeg(g, 25, () => true)) continue;
    if (proto.infill().some?.(() => false)) {}
    return { x, y };
  }
  return null;
});
export const buildingPt = (page) => page.evaluate(() => {
  const r = proto.shell.clearRect();
  for (let y = r.top + 60; y < r.bottom - 60; y += 11) for (let x = r.left + 40; x < r.right - 40; x += 11) {
    const b = proto.pickBuilding(x, y); if (b && !b.region) return { x, y, name: b.name };
  }
  return null;
});
