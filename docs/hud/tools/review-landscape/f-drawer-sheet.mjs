// Landscape: open the stats drawer (with the perf readout), then any sheet or Layers. Nothing closes
// the drawer, and the sheet/pop-over is laid over it. usage: node f-drawer-sheet.mjs 740x360
import { open, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '740x360').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
await page.tap('#clockbtn'); await page.tap('#perfbtn'); await page.waitForTimeout(1500);
let fails = 0;
for (const bar of ['build', 'transport', 'layers', 'menu']) {
  await page.tap(`[data-bar="${bar}"]`); await page.waitForTimeout(600);
  const r = await page.evaluate(() => { const d = document.querySelector('#drawer'), s = [...document.querySelectorAll('#sheet, #layers')].find((e) => !e.hidden); const a = d.getBoundingClientRect(), b = s.getBoundingClientRect(); const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); return { drawerOpen: !d.hidden, drawer: [a.left, a.top, a.right, a.bottom].map(Math.round), panel: s.id, rect: [b.left, b.top, b.right, b.bottom].map(Math.round), overlap: d.hidden ? 0 : Math.max(0, ox) * Math.max(0, oy) }; });
  const bad = r.overlap > 1; if (bad) fails++;
  console.log(`${bad ? 'FAIL' : 'PASS'} ${bar}: ${JSON.stringify(r)}`);
  if (bad) await page.screenshot({ path: `${OUT}drawer-${bar}-${w}x${h}.png` });
  await page.tap(`[data-bar="${bar}"]`); await page.waitForTimeout(300);
}
console.log(fails ? `FAIL (${fails}/4 panels overlap the open stats drawer)` : 'PASS', errs.length ? JSON.stringify(errs) : '');
await browser.close();
