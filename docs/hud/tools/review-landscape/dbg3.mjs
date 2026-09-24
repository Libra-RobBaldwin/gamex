import { open, insets, OUT } from './lib.mjs';
const [w, h] = (process.argv[2] || '844x390').split('x').map(Number);
const { browser, page } = await open(w, h);
if (process.argv[3]) await insets(page, 0, 47, 21, 47);
await page.tap('[data-bar="build"]'); await page.waitForTimeout(800);
for (const t of ['stops', 'roads']) {
  await page.tap(`[data-tab="${t}"]`); await page.waitForTimeout(2000);
  console.log(t, await page.evaluate(() => { const s = document.querySelector('#sheet'), b = s.querySelector('.sb'); const r = s.getBoundingClientRect(), q = b.getBoundingClientRect(); const c = s.querySelector('.card').getBoundingClientRect(); return { sheet: [r.top, r.bottom, r.height], sb: [q.top, q.bottom], card: [c.left, c.top], hit: document.elementFromPoint(c.left + 20, c.top + 20)?.className?.baseVal ?? document.elementFromPoint(c.left + 20, c.top + 20)?.className, cls: s.className, cs: getComputedStyle(s).height }; }));
  await page.screenshot({ path: `${OUT}dbg3-${t}-${w}x${h}${process.argv[3] ? '-ins' : ''}.png` });
}
await browser.close();
