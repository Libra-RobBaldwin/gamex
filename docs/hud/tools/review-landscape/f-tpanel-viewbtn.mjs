// Landscape: a tall blueprint card (demolition warning) can grow up over the View button.
// usage: node f-tpanel-viewbtn.mjs 640x360
import { open, OUT, demolishingBlueprint } from './lib.mjs';
const [w, h] = (process.argv[2] || '640x360').split('x').map(Number);
const { browser, page, errs } = await open(w, h);
await page.evaluate(() => proto.startRoadTool('street')); await page.waitForTimeout(800);
const ok = await demolishingBlueprint(page); await page.waitForTimeout(800);
const r = await page.evaluate(() => { const v = document.querySelector('#viewbtn').getBoundingClientRect(), p = document.querySelector('#tpanel').getBoundingClientRect(); const hit = document.elementFromPoint((v.left + v.right) / 2, (v.top + v.bottom) / 2); return { view: [v.left, v.top, v.right, v.bottom].map(Math.round), card: [p.left, p.top, p.right, p.bottom].map(Math.round), viewReachable: !!hit?.closest('#viewbtn') }; });
await page.screenshot({ path: `${OUT}tpanel-viewbtn-${w}x${h}.png` });
console.log('blueprint with demolition', !!ok, JSON.stringify(r));
console.log(!ok ? 'INCONCLUSIVE' : r.viewReachable ? 'PASS' : 'FAIL: blueprint card covers the View button', errs.length ? JSON.stringify(errs) : '');
await browser.close();
