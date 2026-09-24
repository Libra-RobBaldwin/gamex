import { open, coverage, mutations, smallTargets, box } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
await shot('rest');
console.log('coverage rest', (await coverage(page)).toFixed(4));
console.log('boxes', JSON.stringify({ status: await box(page, '#status'), compass: await box(page, '#compass'), bar: await box(page, '#bar') }));
console.log('mut rest 5s', JSON.stringify(await mutations(page, 5000)));
console.log('small rest', JSON.stringify(await smallTargets(page)));
await page.tap('#clockbtn'); await page.waitForTimeout(300); await page.tap('#perfbtn'); await page.waitForTimeout(2500); await shot('drawer-perf');
console.log('small drawer', JSON.stringify(await smallTargets(page)));
console.log('coverage drawer', (await coverage(page)).toFixed(4), JSON.stringify(await box(page, '#drawer')));
console.log('mut drawer 5s', JSON.stringify(await mutations(page, 5000)));
await page.tap('#clockbtn');
for (const k of ['build', 'transport', 'menu']) {
  await page.tap(`[data-bar="${k}"]`); await page.waitForTimeout(600);
  console.log(k, 'sheet', JSON.stringify(await box(page, '#sheet')), 'mut 3s', JSON.stringify(await mutations(page, 3000)));
  console.log(k, 'small', JSON.stringify(await smallTargets(page)));
  await shot('sheet-' + k);
}
await page.tap('[data-bar="layers"]'); await page.waitForTimeout(500); await shot('layers');
console.log('layers small', JSON.stringify(await smallTargets(page)), 'mut', JSON.stringify(await mutations(page, 3000)));
console.log('errors', JSON.stringify(errs));
await browser.close();
