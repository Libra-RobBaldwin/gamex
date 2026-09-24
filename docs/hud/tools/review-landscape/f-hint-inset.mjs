// Landscape with notch/home-indicator insets: the hint is placed from clearRect(), which ignores the
// safe areas, so its text runs into the left inset (tool strip + sheet) and sits in the bottom inset (at rest).
// usage: node f-hint-inset.mjs 844x390
import { open, insets, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '844x390').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
await insets(page, 0, 47, 21, 47);
let fails = 0;
const chk = async (name, wait = 500) => {
  await page.waitForTimeout(wait);
  const r = await page.evaluate(() => { const e = document.querySelector('#hint'); if (e.hidden) return null; const b = e.getBoundingClientRect(), t = e.querySelector('span').getBoundingClientRect(); return { box: [b.left, b.top, b.right, b.bottom].map(Math.round), text: [t.left, t.top, t.right, t.bottom].map(Math.round), W: innerWidth, H: innerHeight }; });
  const bad = r && (r.text[0] < 47 || r.text[2] > r.W - 47 || r.box[3] > r.H - 21); if (bad) fails++;
  console.log(`${bad ? 'FAIL' : 'PASS'} ${name}: ${JSON.stringify(r)} (insets l/r 47, b 21)`);
  await page.screenshot({ path: `${OUT}hint-inset-${name}-${w}x${h}.png` });
};
// a long hint while a sheet is open (no tool): e.g. tapping a locked Build card
await page.tap('[data-bar="build"]'); await page.waitForTimeout(500); await page.tap('[data-tab="stops"]'); await page.waitForTimeout(800); await page.evaluate(() => [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Bus station')).click()); await chk('sheet-open-locked-card', 50);
await page.tap('.sheet .close');
// with the stop tool (its long standing hint)
await page.evaluate(() => proto.startStopTool()); await chk('stop-tool');
const r = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const s of p.net.segs.values()) { if (p.net.def(s).cls !== 'road') continue; for (const m of p.net.path(s)) { const q = p.toScreen(m); if (q.x > c.left + 60 && q.x < c.right - 160 && q.y > c.top + 40 && q.y < c.bottom - 40) return q; } } });
await page.touchscreen.tap(r.x, r.y); await page.waitForTimeout(2500); await chk('stop-planner');
console.log(fails ? `FAIL (${fails})` : 'PASS', errs.length ? JSON.stringify(errs) : '');
await browser.close();
