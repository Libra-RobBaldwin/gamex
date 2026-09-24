// The view button shown during a tool: size, label after a two-finger tilt, mutations while tool idle
import { open, box, mutations, smallTargets } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
const log = (...a) => console.log(...a);
await page.tap('[data-bar="build"]'); await page.tap('.card:has-text("Street")'); await page.waitForTimeout(500);
log('viewbtn', JSON.stringify(await box(page, '#viewbtn')), 'label', await page.textContent('#viewbtn'), 'small', JSON.stringify(await smallTargets(page)));
log('mutations tool idle 5s', JSON.stringify(await mutations(page, 5000)));
// two fingers slide up together: tilts towards plan
await page.evaluate(({ w }) => { const c = document.getElementById('c'); const ev = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch' }));
  ev('pointerdown', 1, w / 2 - 50, 400); ev('pointerdown', 2, w / 2 + 50, 400); for (let i = 1; i <= 15; i++) { ev('pointermove', 1, w / 2 - 50, 400 - i * 15); ev('pointermove', 2, w / 2 + 50, 400 - i * 15); } ev('pointerup', 1, w / 2 - 50, 175); ev('pointerup', 2, w / 2 + 50, 175); }, { w });
await page.waitForTimeout(800);
const cur = await page.evaluate(() => { const el = proto.view.el; return el > 1.2 ? 'plan' : el < 0.45 ? 'low' : '3d'; });
const label = (await page.textContent('#viewbtn')).trim();
log('after tilt el', (await page.evaluate(() => proto.view.el)).toFixed(2), 'current', cur, 'label', label);
console.log(`${label.toLowerCase() === cur ? 'PASS' : 'FAIL'} view button label follows a gesture tilt (label "${label}", view is ${cur})`);
await shot('viewbtn-after-tilt');
log('errors', JSON.stringify(errs));
await browser.close();
