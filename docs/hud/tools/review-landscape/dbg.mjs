import { open, insets } from './lib.mjs';
const { browser, page } = await open(844, 390);
await insets(page, 0, 47, 21, 47);
await page.tap('[data-bar="build"]'); await page.tap('[data-tab="stops"]');
const b = await page.evaluate(() => { const r = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Bus station')).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
console.log(b, await page.evaluate((b) => document.elementFromPoint(b.x, b.y).outerHTML.slice(0, 120), b)); await page.evaluate(() => { const h = proto.shell.hint.bind(proto.shell); proto.shell.hint = (...a) => { console.log('HINT', a[0].slice(-60)); return h(...a); }; }); page.on('console', m => console.log('page:', m.text())); await page.touchscreen.tap(b.x, b.y);
await page.screenshot({ path: 'shots/dbg.png' }); console.log(await page.evaluate(() => { const s = document.querySelector('#sheet'); return [s.hidden, s.className, JSON.stringify(s.getBoundingClientRect()), getComputedStyle(s).pointerEvents, getComputedStyle(document.querySelector('#ui')).pointerEvents]; }));
for (let i = 0; i < 4; i++) { console.log(await page.evaluate(() => { const e = document.querySelector('#hint'); const r = e.getBoundingClientRect(); return [e.hidden, e.textContent, r.left, r.bottom, innerHeight]; })); await page.waitForTimeout(300); }
await browser.close();
