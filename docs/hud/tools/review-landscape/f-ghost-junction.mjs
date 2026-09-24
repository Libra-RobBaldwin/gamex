// One tap on a junction (no tool in use) should open its info sheet. The click that follows the
// tap lands on the sheet that just opened; when "Edit junction" is under the finger, the editor opens.
// usage: node f-ghost-junction.mjs 600x500
import { open, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '600x500').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
await page.evaluate(() => { window.__clicks = []; document.addEventListener('click', (e) => { const b = e.target.closest('button'); window.__clicks.push(b ? 'BUTTON:' + b.textContent.trim().slice(0, 30) : e.target.tagName); }, true); });
// find where the info sheet's Edit junction button appears, then put a junction there
const at = await page.evaluate(() => { const p = proto; const j = [...p.junctions.values()].find((j) => j.form !== 'join' && j.form !== 'merge'); p.tapMap(...Object.values(p.toScreen(p.net.node(j.node)))); const r = document.querySelector('#sheet .act.primary').getBoundingClientRect(); p.shell.closeSheet(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; });
let fails = 0, n = 0;
for (const j of await page.evaluate(() => [...proto.junctions.values()].filter((j) => j.form !== 'join' && j.form !== 'merge').slice(0, 3).map((j) => { const q = proto.net.node(j.node); return { x: q.x, z: q.z }; }))) {
  await page.evaluate(({ j, at }) => { const p = proto; const g = p.groundAt(at.x, at.y); p.view.x += j.x - g.x; p.view.z += j.z - g.z; }, { j, at });
  await page.waitForTimeout(1500);
  const q = await page.evaluate((j) => proto.toScreen(j), j);
  await page.evaluate(() => { window.__clicks = []; });
  await page.touchscreen.tap(q.x, q.y); await page.waitForTimeout(1000);
  const s = await page.evaluate(() => ({ sheet: proto.shell.sheetKey, clicks: window.__clicks }));
  n++; const bad = s.sheet === 'junction'; if (bad) fails++;
  console.log(`tap junction at ${q.x.toFixed(0)},${q.y.toFixed(0)} (Edit junction button would be at ${at.x.toFixed(0)},${at.y.toFixed(0)}) -> sheet=${s.sheet} clicks=${JSON.stringify(s.clicks)}`);
  if (bad) await page.screenshot({ path: `${OUT}ghost-junction-${w}x${h}.png` });
  await page.evaluate(() => proto.shell.closeSheet()); await page.waitForTimeout(400);
}
console.log(fails ? `FAIL: ${fails}/${n} single taps on a junction went straight into the junction editor` : `PASS (${n})`, errs.length ? JSON.stringify(errs) : '');
await browser.close();
