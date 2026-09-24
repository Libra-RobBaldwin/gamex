// FAIL if a hint shown while a sheet is open is hidden behind the sheet or bar (clearRect ignores tall sheets)
import { open, box, onTop } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
let fails = 0;
const check = async (name) => {
  await page.waitForTimeout(250);
  const hb = await box(page, '#hint'), sb = await box(page, '#sheet'), top = await onTop(page, '#hint'), cr = await page.evaluate(() => proto.shell.clearRect());
  const bb = await box(page, '#bar');
  const ov = (a, b) => a && b && a.w && b.w && a.top < b.bottom && a.bottom > b.top;
  // the hint comes before #sheet and #bar in the DOM with no z-index, so any overlap means it is painted under them
  const hidden = ov(hb, sb) || ov(hb, bb);
  console.log(`${hidden ? 'FAIL' : 'PASS'} ${name}: hint`, JSON.stringify(hb), 'sheet', JSON.stringify(sb),  'clearRect.bottom', cr.bottom);
  if (hidden) fails++;
  await shot('hint-' + name);
};
// 1. Buy vehicles -> Add a bus
await page.tap('[data-bar="transport"]'); await page.tap('[data-tab="buy"]'); await page.waitForTimeout(400);
await page.tap('[data-add="bus"]'); await check('add-bus');
// 2. Build -> Stops -> tap a locked card
await page.tap('[data-bar="build"]'); await page.tap('[data-tab="stops"]'); await page.waitForTimeout(400);
await page.tap('.card.locked', { force: true }); await check('locked-stop-card');
// 3. Menu -> Save (disabled)
await page.tap('[data-bar="menu"]'); await page.waitForTimeout(400);
await page.tap('.card:has-text("Save town")', { force: true }); await check('menu-save');
console.log(fails ? `FAIL ${fails}` : 'PASS', 'errors', JSON.stringify(errs));
await browser.close();
