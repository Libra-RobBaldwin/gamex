import { open } from './lib.mjs';
const { browser, page } = await open(915, 412);
await page.tap('[data-bar="menu"]');
for (const t of [100, 300, 600, 1200, 2500]) { await page.waitForTimeout(t); console.log(t, await page.evaluate(() => { const s = document.querySelector('#sheet'); return [s.className, s.getBoundingClientRect().top, getComputedStyle(s).transform, document.getAnimations().map(a => a.playState + ':' + a.currentTime).join(',')]; })); }
await browser.close();
