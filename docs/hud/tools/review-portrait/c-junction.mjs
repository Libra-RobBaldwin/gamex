// Junction: info -> Edit junction -> is the junction framed in the clear map above the sheet? lane arrow hint visible?
import { open, box } from './lib.mjs';
const [w, h] = (process.argv[2] || '412x915').split('x').map(Number);
const { browser, page, errs, shot } = await open(w, h);
let fails = 0;
const j = await page.evaluate(() => { const p = window.proto; const ok = (q) => q.x > 60 && q.x < innerWidth - 60 && q.y > 130 && q.y < innerHeight * 0.5; const all = [...p.junctions.values()].filter(j => j.form !== 'join' && j.form !== 'merge').map(j => ({ node: j.node, ...p.toScreen(p.net.node(j.node)) })); return all.find(ok); });
console.log('junction', JSON.stringify(j));
await page.touchscreen.tap(j.x, j.y); await page.waitForTimeout(1500);
console.log('info title', await page.textContent('.sheet h2'));
await shot('junction-info');
let s = await page.evaluate((n) => proto.toScreen(proto.net.node(n)), j.node), sb = await box(page, '#sheet');
let bad = s.y > sb.top; console.log(`${bad ? 'FAIL' : 'PASS'} info: junction at y=${s.y.toFixed(0)}, sheet top ${sb.top}`); fails += bad;
await page.tap('.sheet .act.primary'); await page.waitForTimeout(2500);
await shot('junction-edit');
s = await page.evaluate((n) => proto.toScreen(proto.net.node(n)), j.node); sb = await box(page, '#sheet');
const cr = await page.evaluate(() => proto.shell.clearRect());
bad = s.y > sb.top - 20; console.log(`${bad ? 'FAIL' : 'PASS'} editor: junction centre at y=${s.y.toFixed(0)}, sheet top ${sb.top}, clearRect ${JSON.stringify(cr)}`); fails += bad;
console.log('editor title', await page.textContent('.sheet h2'), 'sheet h', sb.h);
// scroll position / mutations while editor open
console.log('lanes before', JSON.stringify(await page.evaluate((n) => proto.junctions.get(n).lanes, j.node)));
console.log('errors', JSON.stringify(errs));
console.log(fails ? `FAIL ${fails}` : 'PASS');
await browser.close();
