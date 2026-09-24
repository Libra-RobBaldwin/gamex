// Landscape: Build and Transport sheets use .sheet.fixed, whose height (55dvh minus --chrome-b, the
// bar's height, which in landscape is the tall side rail) beats the landscape rule's `height: auto`.
// The sheet collapses to its header and tabs; the cards are clipped away.
// usage: node f-landscape-sheet-height.mjs 915x412 [more sizes...]
import { open, OUT } from './lib.mjs';
let fails = 0;
for (const v of process.argv.slice(2).length ? process.argv.slice(2) : ['915x412']) {
  const [w, h] = v.split('x').map(Number);
  const { browser, page, errs } = await open(w, h);
  for (const bar of ['build', 'transport']) {
    await page.tap(`[data-bar="${bar}"]`); await page.waitForTimeout(800);
    const r = await page.evaluate(() => { const s = document.querySelector('#sheet'), b = s.querySelector('.sb'), first = b.querySelector('button'); const fr = first.getBoundingClientRect(); const hit = document.elementFromPoint(fr.left + fr.width / 2, fr.top + Math.min(fr.height, 30) / 2);
      return { sheetH: Math.round(s.getBoundingClientRect().height), bodyVisibleH: b.clientHeight, fixed: s.classList.contains('fixed'), chromeB: getComputedStyle(document.querySelector('#ui')).getPropertyValue('--chrome-b'), firstItemTappable: !!hit && first.contains(hit) }; });
    const bad = r.bodyVisibleH < 90 || !r.firstItemTappable; if (bad) fails++;
    console.log(`${bad ? 'FAIL' : 'PASS'} ${v} ${bar}: ${JSON.stringify(r)}`);
    await page.screenshot({ path: `${OUT}sheet-height-${bar}-${v}.png` });
    await page.tap(`[data-bar="${bar}"]`); await page.waitForTimeout(300);
  }
  if (errs.length) console.log('errors', JSON.stringify(errs));
  await browser.close();
}
console.log(fails ? `FAIL (${fails})` : 'PASS');
