// Road tool flows: options row, drag draw, blueprint, build, demolition, curve taps, undo, smooth, cancel, rail, Escape
import { open, box, drag, smallTargets, mutations, vis } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
const log = (...a) => console.log(...a);
let fails = 0; const check = (ok, msg) => { log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };
await page.tap('[data-bar="build"]'); await page.waitForTimeout(400);
await page.tap('.card:has-text("Street")'); await page.waitForTimeout(600);
await shot('tool');
log('tool box', JSON.stringify(await box(page, '#tool')), 'small', JSON.stringify(await smallTargets(page)));
// options row: scroll to the end, tap Under, is it still scrolled?
const o = await page.evaluate(() => { const o = document.querySelector('#tool .opts'); return { sw: o.scrollWidth, cw: o.clientWidth }; });
log('opts overflow', JSON.stringify(o));
if (o.sw > o.cw) {
  await page.evaluate(() => { const o = document.querySelector('#tool .opts'); o.scrollLeft = o.scrollWidth; o.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => document.querySelector('#tool .opts').scrollLeft);
  await page.tap('[data-x="tunnel"]'); await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('#tool .opts').scrollLeft);
  const ub = await box(page, '[data-x="tunnel"]');
  check(Math.abs(after - before) < 2, `options row keeps its scroll after tapping Under (before ${before}, after ${after}; Under now at x=${ub.x}..${ub.x + ub.w} of ${w})`);
  await shot('opts-after-under');
  await page.tap('[data-x="junction"]', { force: true }).catch(() => {});
  await page.evaluate(() => { document.querySelector('#tool .opts').scrollLeft = 0; });
}
// Height and grade cycle
await page.tap('#g-h'); log('height', await page.textContent('#g-h')); await page.tap('#g-h'); await page.tap('#g-h');
await page.tap('#g-g'); log('grade', await page.textContent('#g-g'));
await page.tap('[data-x="junction"]');
// drag a straight road across clear map
const a = { x: w * 0.25, y: h * 0.28 }, b = { x: w * 0.75, y: h * 0.42 };
await drag(page, a, b); await page.waitForTimeout(800);
await shot('blueprint');
const tp = await box(page, '#tpanel'), tl = await box(page, '#tool'), hb = await box(page, '#hint');
log('tpanel', JSON.stringify(tp), 'tool', JSON.stringify(tl), 'hint', JSON.stringify(hb), await page.textContent('#tpanel').catch(() => ''));
check(tp && tp.top > 52, 'blueprint card below status strip');
check(!hb || hb.bottom <= tp.top || !(await vis(page, '#hint')), `hint not overlapping blueprint card (hint ${JSON.stringify(hb)})`);
log('prim', await page.textContent('#t-prim'), 'undo enabled', await page.isEnabled('#t-undo'));
log('mutations with blueprint at rest 3s', JSON.stringify(await mutations(page, 3000)));
// undo
await page.tap('#t-undo'); await page.waitForTimeout(400);
check(!(await vis(page, '#tpanel')), 'undo clears blueprint card');
check((await page.textContent('#t-prim')).includes('Done'), 'undo restores Done');
// redraw and build
await drag(page, a, b); await page.waitForTimeout(800);
const segs0 = await page.evaluate(() => proto.net.segs.size);
if (await page.isEnabled('#t-prim button')) { await page.tap('#t-prim button'); await page.waitForTimeout(1000); }
log('built', segs0, '->', await page.evaluate(() => proto.net.segs.size), 'hint', await page.textContent('#hint'), 'tool still', await vis(page, '#tool'));
await shot('built');
// demolition road: drag across buildings centre to centre
const pair = await page.evaluate(() => { const p = proto; const on = (q) => q.x > 30 && q.x < innerWidth - 30 && q.y > 120 && q.y < innerHeight * 0.5; const bs = p.buildings.filter((b) => !b.dying && !b.region).map((b) => ({ b, s: p.toScreen({ x: b.lot.x, z: b.lot.z }) })).filter((x) => on(x.s)); return bs.length > 1 ? [bs[0].s, bs[bs.length - 1].s] : null; });
if (pair) {
  await drag(page, pair[0], pair[1]); await page.waitForTimeout(900);
  await shot('demolish');
  const t = await page.textContent('#tpanel').catch(() => '');
  log('demolish card', t.replace(/\s+/g, ' ').slice(0, 200));
  const cls = await page.getAttribute('#t-prim button', 'class'); log('prim class', cls, 'label', await page.getAttribute('#t-prim button', 'aria-label'));
  const tpb = await box(page, '#tpanel');
  check(tpb.top > 60, `blueprint card with demolition fits (top ${tpb.top})`);
  const n0 = await page.evaluate(() => proto.buildings.filter((b) => !b.dying).length);
  if (await page.isEnabled('#t-prim button')) { await page.tap('#t-prim button'); await page.waitForTimeout(1500); }
  log('buildings', n0, '->', await page.evaluate(() => proto.buildings.filter((b) => !b.dying).length), 'hint', await page.textContent('#hint'));
  await shot('demolished');
}
// curve by taps
await page.tap('[data-k="curve"]'); await page.waitForTimeout(300);
const P = [[0.3, 0.3], [0.5, 0.2], [0.7, 0.32]].map(([x, y]) => ({ x: x * w, y: y * h }));
for (const p of P.slice(0, 2)) { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(400); }
log('curve hint', await page.textContent('#hint'), 'undo', await page.isEnabled('#t-undo'));
await page.tap('#t-undo'); await page.tap('#t-undo'); await page.waitForTimeout(300);
check(!(await page.isEnabled('#t-undo')), 'undo disabled after undoing all picks');
for (const p of P) { await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(400); }
await page.waitForTimeout(500); await shot('curve');
check(await vis(page, '#tpanel'), 'curve by taps makes a blueprint');
// switch to smooth while blueprint shown
await page.tap('[data-k="smooth"]'); await page.waitForTimeout(400);
check(!(await vis(page, '#tpanel')), 'changing shape clears blueprint card');
// cancel
await page.tap('#t-cancel'); await page.waitForTimeout(400);
check(await vis(page, '#bar') && !(await vis(page, '#tool')) && !(await vis(page, '#tpanel')), 'cancel restores bar');
log('mode', await page.evaluate(() => document.body.dataset.mode), 'ghost children', await page.evaluate(() => proto.THREE && proto.cam.parent ? 0 : 0));
// rail
await page.tap('[data-bar="build"]'); await page.tap('[data-tab="rail"]'); await page.waitForTimeout(300);
await shot('build-rail');
const cards = await page.$$eval('.sheet .card', (cs) => cs.map((c) => c.textContent.trim().replace(/\s+/g, ' ')));
log('rail cards', JSON.stringify(cards));
await page.tap('.sheet .card >> nth=0'); await page.waitForTimeout(500);
log('rail tool', await page.textContent('#tool .tw b'), 'tone', await page.getAttribute('#tool', 'class'), 'mode', await page.evaluate(() => document.body.dataset.mode));
await drag(page, { x: w * 0.2, y: h * 0.25 }, { x: w * 0.8, y: h * 0.3 }); await page.waitForTimeout(800);
await shot('rail-blueprint');
// Escape with a tool active and a blueprint
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
log('after Escape: tool visible', await vis(page, '#tool'), 'tpanel', await vis(page, '#tpanel'));
await page.tap('#t-cancel');
log('errors', JSON.stringify(errs));
log(fails ? `FAIL ${fails}` : 'PASS');
await browser.close();
