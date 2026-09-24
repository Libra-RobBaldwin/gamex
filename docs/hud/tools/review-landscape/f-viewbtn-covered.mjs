// Landscape: with a tool active the View button sits under the compass, top right. The stop planner
// sheet (and a tall blueprint card) is pushed to the right edge while tooling and covers it.
// usage: node f-viewbtn-covered.mjs 844x390
import { open, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '844x390').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
await page.evaluate(() => proto.startStopTool()); await page.waitForTimeout(600);
const r = await page.evaluate(() => { const p = proto, c = p.shell.clearRect(); for (const s of p.net.segs.values()) { if (p.net.def(s).cls !== 'road') continue; for (const m of p.net.path(s)) { const q = p.toScreen(m); if (q.x > c.left + 40 && q.x < c.right - 140 && q.y > c.top + 40 && q.y < c.bottom - 40) return q; } } });
const before = await page.evaluate(() => { const v = document.querySelector('#viewbtn'); const b = v.getBoundingClientRect(); return { hidden: v.hidden, top: document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)?.closest('#viewbtn') !== null }; });
await page.touchscreen.tap(r.x, r.y); await page.waitForTimeout(2500);
const after = await page.evaluate(() => { const v = document.querySelector('#viewbtn'); const b = v.getBoundingClientRect(); const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return { sheet: proto.shell.sheetKey, view: [b.left, b.top, b.right, b.bottom].map(Math.round), sheetRect: (() => { const s = document.querySelector('#sheet').getBoundingClientRect(); return [s.left, s.top, s.right, s.bottom].map(Math.round); })(), reachable: !!hit?.closest('#viewbtn'), hit: hit?.closest('[id]')?.id }; });
await page.screenshot({ path: `${OUT}viewbtn-${w}x${h}.png` });
console.log('before sheet', JSON.stringify(before), 'after', JSON.stringify(after));
console.log(!before.hidden && before.top && after.sheet && !after.reachable ? 'FAIL: View button is covered by the stop planner sheet' : 'PASS', errs.length ? JSON.stringify(errs) : '');
await browser.close();
