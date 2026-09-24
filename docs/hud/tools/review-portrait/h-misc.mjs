// Layers/views, Menu (quality, performance, new town), compass, Escape, speed cycle, tab-switch jumps
import { open, box, vis, smallTargets } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
const log = (...a) => console.log(...a);
let fails = 0; const check = (ok, msg) => { log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
// speed
const rates = [];
for (let i = 0; i < 4; i++) { await page.tap('#sp-rate'); rates.push(await page.textContent('#sp-rate')); }
log('rate cycle', rates.join(','), 'speed', await page.evaluate(() => proto.speed()));
await page.tap('#sp-pause'); await page.waitForTimeout(400);
log('paused rush', await page.textContent('#st-rush'), 'pause label', await page.getAttribute('#sp-pause', 'aria-label'));
await page.tap('#sp-rate'); log('rate while paused ->', await page.evaluate(() => proto.speed()), await page.textContent('#sp-rate'));
await shot('paused'); await page.evaluate(() => proto.setSpeed(1));
// layers
await page.tap('[data-bar="layers"]'); await page.waitForTimeout(300); await shot('layers');
log('layers box', JSON.stringify(await box(page, '#layers')));
for (const v of ['plan', 'low', '3d']) { await page.tap(`[data-view="${v}"]`); await page.waitForTimeout(1500); log('view', v, await page.getAttribute(`[data-view="${v}"]`, 'aria-pressed'), (await page.evaluate(() => proto.view.el)).toFixed(2)); if (v !== '3d') await shot('view-' + v); }
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
check(!(await vis(page, '#layers')) && (await page.$$('#bar [aria-expanded="true"]')).length === 0, 'Escape closes layers and unlights bar');
// menu
await page.tap('[data-bar="menu"]'); await page.waitForTimeout(300);
await page.tap('.card:has-text("Performance")'); await page.waitForTimeout(300);
// (Performance closes the menu so the readout in the drawer shows; open the menu again over it)
log('readout shown', await vis(page, '#perf'));
await page.tap('[data-bar="menu"]'); await page.waitForTimeout(600);
log('perf sub', await page.textContent('.card:has-text("Performance")'), 'drawer open', await vis(page, '#drawer'), 'sheet', await vis(page, '#sheet'));
await shot('menu-perf');
const dr = await box(page, '#drawer'), sh = await box(page, '#sheet');
check(!(await vis(page, '#drawer')) || dr.bottom < sh.top, `drawer and menu sheet don't overlap (drawer ${JSON.stringify(dr)}, sheet ${JSON.stringify(sh)})`);
await page.tap('.card:has-text("Quality")'); await page.waitForTimeout(300);
await shot('quality');
log('quality small', JSON.stringify(await smallTargets(page)));
await page.tap('[data-q="2"]'); await page.waitForTimeout(300); log('tier', await page.evaluate(() => proto.perf().tier), 'lit', JSON.stringify(await page.$$eval('#bar [aria-expanded="true"]', (b) => b.map((x) => x.dataset.bar))));
await page.tap('[data-q="auto"]');
await page.tap('.sheet .back'); await page.waitForTimeout(200);
await page.tap('.card:has-text("New town")'); await page.waitForTimeout(300); await shot('newtown');
log('newtown', await page.textContent('.sheet h2'));
await page.tap('[data-keep]'); await page.waitForTimeout(200);
check(!(await vis(page, '#sheet')), 'Keep playing closes');
// compass after rotating
await page.evaluate(() => { proto.view.az += 1.2; }); await page.waitForTimeout(300);
await page.tap('#compass'); await page.waitForTimeout(2500);
log('az after compass', (await page.evaluate(() => proto.view.az)).toFixed(3));
// tab switching: does the tab row jump?
await page.tap('[data-bar="build"]'); await page.waitForTimeout(400);
const ys = {};
for (const t of ['roads', 'rail', 'stops', 'freight', 'bulldoze', 'landscape']) { await page.tap(`[data-tab="${t}"]`); await page.waitForTimeout(300); ys[t] = (await box(page, `[data-tab="${t}"]`)).y; }
log('Build tab row y per tab', JSON.stringify(ys));
const span = Math.max(...Object.values(ys)) - Math.min(...Object.values(ys));
check(span < 8, `Build tab row stays put when switching tabs (moves ${span}px)`);
await shot('build-landscape');
await page.tap('[data-bar="transport"]'); await page.waitForTimeout(300);
const ty = [(await box(page, '[data-tab="lines"]')).y]; await page.tap('[data-tab="buy"]'); await page.waitForTimeout(300); ty.push((await box(page, '[data-tab="buy"]')).y);
check(Math.abs(ty[1] - ty[0]) < 8, `Transport tab row stays put (${ty.join(' -> ')})`);
// traffic level
await page.tap('[data-lvl="0"]'); await page.waitForTimeout(200); log('level pressed', await page.getAttribute('[data-lvl="0"]', 'aria-pressed'), 'scroll', await page.evaluate(() => document.querySelector('.sb').scrollTop));
// trains
const tr = await page.$$('[data-train]'); for (const t of tr) { await t.tap(); await page.waitForTimeout(200); log('train hint', await page.textContent('#hint')); }
log('errors', JSON.stringify(errs));
log(fails ? `FAIL ${fails}` : 'PASS');
await browser.close();
