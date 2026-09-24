import { open } from './lib.mjs';
const out = process.argv[2]; const [w, h] = (process.argv[3] || '412x915').split('x').map(Number); const tag = `${w}x${h}`;
const { browser, page, errs } = await open(w, h);
const shot = (n) => page.screenshot({ path: `${out}/${tag}-${n}.png` });
const log = (...a) => console.log(...a);
log('firstrun visible', await page.isVisible('#firstrun'));
await shot('firstrun');
// speed
await page.tap('#sp-pause'); log('paused', await page.evaluate(() => proto.speed()));
await page.tap('#sp-pause'); await page.tap('#sp-rate'); log('rate', await page.evaluate(() => proto.speed()), await page.textContent('#sp-rate'));
await page.tap('#sp-rate'); await page.tap('#sp-rate'); log('rate back', await page.evaluate(() => proto.speed()));
// perf
await page.tap('#clockbtn'); await page.tap('#perfbtn'); await page.waitForTimeout(2500); log('perf', await page.textContent('#perf-t')); await shot('perf'); await page.tap('#perfbtn'); await page.tap('#clockbtn');
// road picker via More
await page.tap('[data-bar="build"]'); await page.tap('.card:has-text("More road types")'); await page.waitForTimeout(400);
await page.tap('[data-f="lanes"][data-v="2"]'); await page.waitForTimeout(300); await shot('picker');
log('picker count', await page.textContent('.sb .cnt'));
await page.tap('.sheet .back'); log('back to build', await page.isVisible('.card:has-text("More road types")'));
await page.tap('.card:has-text("More road types")'); await page.tap('[data-pick]'); await page.waitForTimeout(300);
log('tool', await page.textContent('#tool .tw b'), await page.evaluate(() => document.body.dataset.mode));
// curve tool with taps + undo
await page.tap('[data-k="curve"]');
const pts = [[0.3, 0.45], [0.5, 0.3], [0.75, 0.42]].map(([x, y]) => ({ x: x * w, y: y * h }));
await page.touchscreen.tap(pts[0].x, pts[0].y); await page.waitForTimeout(400);
await page.touchscreen.tap(pts[1].x, pts[1].y); await page.waitForTimeout(400);
log('undo enabled after 2 picks', await page.isEnabled('#t-undo'));
await page.tap('#t-undo'); await page.waitForTimeout(200);
await page.touchscreen.tap(pts[1].x, pts[1].y); await page.waitForTimeout(400);
await page.touchscreen.tap(pts[2].x, pts[2].y); await page.waitForTimeout(800);
log('blueprint shown', await page.isVisible('#tpanel'), await page.textContent('#t-prim'));
await shot('curve');
const segs0 = await page.evaluate(() => proto.net.segs.size);
if ((await page.textContent('#t-prim')).includes('Build') && await page.isEnabled('#t-prim button')) { await page.tap('#t-prim button'); await page.waitForTimeout(800); }
log('built segs', segs0, '->', await page.evaluate(() => proto.net.segs.size), 'hint', await page.textContent('#hint'));
// height/grade/cross option changes
await page.tap('#g-h'); await page.tap('[data-x="bridge"]'); log('opt label', await page.textContent('#g-h'), await page.getAttribute('[data-x="bridge"]', 'aria-pressed'));
await page.tap('#t-cancel'); log('bar back', await page.isVisible('#bar'), await page.evaluate(() => document.body.dataset.mode));
// rail
await page.tap('[data-bar="build"]'); await page.tap('[data-tab="rail"]'); await page.tap('.card:has-text("Main line")'); await page.waitForTimeout(300); await shot('rail');
log('rail mode', await page.evaluate(() => document.body.dataset.mode)); await page.tap('#t-cancel');
// stop tool
await page.tap('[data-bar="build"]'); await page.tap('[data-tab="stops"]'); await page.tap('.card:has-text("Bus stop")');
const r = await page.evaluate(() => { for (const s of proto.net.segs.values()) { if (proto.net.def(s).cls !== 'road') continue; const p = proto.net.path(s); for (const m of p) { const q = proto.toScreen(m); if (q.x > 60 && q.x < innerWidth - 60 && q.y > 120 && q.y < innerHeight * 0.6) { const n = proto.net.nearestSeg(proto.groundAt(q.x, q.y), 30, (x) => proto.net.def(x).cls === 'road'); if (n) { const pl = proto.net.planStop(n.seg.id, n.s, 1); if (!pl.reason && pl.plans.some(x => x.ok)) return q; } } } } });
await page.touchscreen.tap(r.x, r.y); await page.waitForTimeout(1500); await shot('stop-plan');
log('stop sheet', await page.textContent('.sheet h2'));
const ok = await page.$('[data-plan]:not([disabled])');
if (ok) { await ok.tap(); await page.waitForTimeout(800); }
log('stops', await page.evaluate(() => [...proto.net.segs.values()].reduce((t, s) => t + s.stops.length, 0)));
await page.tap('#t-prim button'); // Done
await page.tap('[data-bar="transport"]'); await page.waitForTimeout(300); await shot('lines');
const row = await page.$('[data-stop]'); if (row) { await row.tap(); await page.waitForTimeout(1200); log('stop info', await page.textContent('.sheet h2')); await shot('stop-info'); }
await page.tap('.sheet .close');
// menu: quality + reset
await page.tap('[data-bar="menu"]'); await page.tap('.card:has-text("Quality")'); await page.tap('[data-q="1"]'); log('tier', await page.evaluate(() => proto.perf().tier)); await shot('quality');
await page.tap('.sheet .back'); await page.tap('.card:has-text("New town")'); await shot('reset'); await page.tap('[data-keep]');
// layers view
await page.tap('[data-bar="layers"]'); await page.tap('[data-view="plan"]'); await page.waitForTimeout(1500); await shot('plan');
log('view', await page.getAttribute('[data-view="plan"]', 'aria-pressed'), await page.evaluate(() => proto.view.el.toFixed(2)));
await page.touchscreen.tap(w / 2, h / 3); log('layers closed on map tap', await page.isHidden('#layers'));
await page.tap('#compass'); await page.waitForTimeout(1500); log('el after compass', await page.evaluate(() => proto.view.el.toFixed(2)));
log('errors', JSON.stringify(errs));
await browser.close();
