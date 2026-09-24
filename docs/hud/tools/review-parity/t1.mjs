import { open, check, junctionPt, emptyPt, buildingPt } from './lib.mjs';
const { browser, page, errs } = await open();
check('no page errors at load', errs.length === 0, JSON.stringify(errs));
console.log('junction', JSON.stringify(await junctionPt(page)), 'empty', JSON.stringify(await emptyPt(page)), 'bld', JSON.stringify(await buildingPt(page)));
await page.screenshot({ path: 'rest.png' });
await browser.close();
