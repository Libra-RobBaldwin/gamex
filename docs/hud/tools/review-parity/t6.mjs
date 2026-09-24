import { open, check, junctionPt, emptyPt } from './lib.mjs';
const { browser, page, errs } = await open();
// junction editor: form, slip, re-optimise, back
const j = await junctionPt(page);
await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(500);
await page.tap('.sheet .acts .act'); await page.waitForTimeout(500);
await page.tap('[data-form="signals"]'); await page.waitForTimeout(300);
check('form choice applies', (await page.evaluate((n) => proto.junctions.get(n).form, j.node)) === 'signals' && (await page.textContent('.sheet h2')).includes('signals'));
const slip = await page.$('[data-slip]');
if (slip) { await slip.tap(); await page.waitForTimeout(300); check('slip lane toggles', await page.evaluate((n) => !!proto.junctions.get(n).slip, j.node)); }
else console.log('INFO no slip option for this junction');
await page.tap('[data-opt]'); await page.waitForTimeout(300);
check('re-optimise keeps sheet', (await page.textContent('.sheet h2')).length > 0);
await page.tap('[data-form="auto"]'); await page.waitForTimeout(300);
check('auto restores', await page.evaluate((n) => proto.junctions.get(n).auto, j.node));
await page.tap('.sheet .back'); await page.waitForTimeout(300);
check('back goes to junction info', (await page.textContent('.sheet .acts')).includes('Edit junction'));
await page.tap('.sheet .close');
// vehicles
await page.tap('[data-bar="transport"]'); await page.tap('[data-tab="buy"]');
const b0 = await page.evaluate(() => proto.traffic.buses);
await page.tap('[data-add="bus"]'); await page.waitForTimeout(200);
check('Add a bus', (await page.evaluate(() => proto.traffic.buses)) === b0 + 1, await page.textContent('#hint'));
await page.tap('[data-lvl="0"]'); await page.waitForTimeout(200);
check('traffic level button pressed after re-render', (await page.getAttribute('[data-lvl="0"]', 'aria-pressed')) === 'true');
await page.tap('[data-train]'); await page.waitForTimeout(200);
console.log('train hint:', (await page.textContent('#hint')).trim());
// Quality hold
await page.tap('[data-bar="menu"]'); await page.tap('.card:has-text("Quality")'); await page.tap('[data-q="2"]');
const t1 = await page.evaluate(() => proto.perf().tier);
await page.waitForTimeout(5000);
check('held tier stays', (await page.evaluate(() => proto.perf().tier)) === t1, t1);
check('no page errors', errs.length === 0, JSON.stringify(errs));
await browser.close();
