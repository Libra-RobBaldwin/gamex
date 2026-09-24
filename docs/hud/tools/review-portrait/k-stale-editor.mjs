// Road tool: junction editor open, then a road is drawn from that junction and built; is the editor still coherent?
import { open, box, vis, drag } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
const log = (...a) => console.log(...a);
await page.tap('[data-bar="build"]'); await page.tap('.card:has-text("Street")'); await page.waitForTimeout(400);
const j = await page.evaluate(() => { const p = window.proto; const ok = (q) => q.x > 60 && q.x < innerWidth - 60 && q.y > 130 && q.y < innerHeight * 0.45; return [...p.junctions.values()].filter(j => j.form !== 'join' && j.form !== 'merge').map(j => ({ node: j.node, ...p.toScreen(p.net.node(j.node)) })).find(ok); });
await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(2500);
const legs0 = await page.evaluate((n) => Object.keys(proto.junctions.get(n)?.lanes ?? {}).length, j.node);
// the junction is now under the sheet; drag from where it is on screen (the sheet covers it, so dispatch on the canvas as a finger on the map edge would after panning)
const s = await page.evaluate((n) => proto.toScreen(proto.net.node(n)), j.node);
const sb = await box(page, '#sheet');
log('junction on screen', s.y.toFixed(0), 'sheet top', sb.top);
// pan so the junction is above the sheet, then draw from it
await drag(page, { x: w / 2, y: 120 }, { x: w / 2, y: 120 - (s.y - (sb.top - 80)) }, 1); // one-step move: in road mode this draws, so instead set view
await page.evaluate(() => { const b = document.querySelector('#t-undo'); if (b && !b.disabled) b.click(); });
await page.waitForTimeout(300);
const made = await page.evaluate((n) => { const q = proto.net.node(n); proto.buildRoad({ x: q.x, z: q.z }, { x: q.x + 40, z: q.z - 55 }); return proto.net.segs.size; }, j.node);
await page.waitForTimeout(800);
const legs1 = await page.evaluate((n) => Object.keys(proto.junctions.get(n)?.lanes ?? {}).length, j.node);
log('legs', legs0, '->', legs1, 'editor title', await page.textContent('.sheet h2').catch(() => 'closed'));
await shot('stale-editor');
for (const sel of ['[data-opt]', '[data-form="auto"]', '[data-form]:not([data-form="auto"])']) { const b = await page.$(sel); if (b) { await b.tap().catch((e) => log('tap err', e.message.slice(0, 80))); await page.waitForTimeout(600); } }
log('after taps title', await page.textContent('.sheet h2').catch(() => 'closed'));
log('errors', JSON.stringify(errs));
console.log(errs.some((e) => e.startsWith('pageerror')) ? 'FAIL page errors' : 'PASS no page errors');
await browser.close();
