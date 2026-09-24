// The loop's second and third milestones (docs/loop.md, M2 and M3), played by touch on a
// phone-sized page: money in the status strip; the town panel steady at the start; a new line
// through the housing costs its buses and makes the town grow; withdrawing the starter line
// makes it decline. Days are skipped with the page's own clock hook, so it runs in a few minutes.
// node e2e/loop.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/?map=town';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const town = () => page.evaluate(() => { const r = window.proto.town.report; return { status: r.status, residents: r.residents, jobs: r.jobs, balance: Math.round(window.proto.purse.balance), stats: { ...window.proto.town.stats } }; });
const skip = (days) => page.evaluate((d) => window.proto.skip(d * 1440), days);
await page.goto(url);
await page.waitForFunction(() => window.proto?.town, null, { timeout: 60000 });
await page.waitForTimeout(3000);

// money shows in the status strip
const moneyText = await page.evaluate(() => document.querySelector('#money')?.textContent ?? '');
console.log('money slot:', moneyText);
if (!/^£[\d,]+$/.test(moneyText)) fail('no balance in the status strip');

// the town panel, from the drawer
await page.tap('#clockbtn'); await page.waitForTimeout(300);
await page.tap('#townbtn'); await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/loop-0-town.png` });
const t0 = await town();
console.log('start', JSON.stringify(t0));
if (t0.status === 'declining') fail('the town declines from the start');
await page.tap('#sheet .close'); await page.waitForTimeout(300);

// two new stops in the housing either side of the centre (placed through the game, as the stop tool does)
const made = await page.evaluate(() => {
  const P = window.proto, net = P.net, ids = [];
  for (const q of [{ x: -110, z: -96 }, { x: 60, z: 110 }]) {
    let best = null, bd = 1e9;
    for (const s of net.segs.values()) { if (net.def(s).cls !== 'road' || net.def(s).family === 'Motorway' || net.length(s) < 40 || s.stops.length) continue; const p = net.path(s), m = p[Math.floor(p.length / 2)], d = Math.hypot(m.x - q.x, m.z - q.z); if (d < bd) { bd = d; best = s; } }
    const L = net.length(best); let first = null;
    for (const side of [1, -1]) for (const f of [0.5, 0.35, 0.65]) { const { plans } = net.planStop(best.id, L * f, side); const pl = plans.find((x) => x.ok && x.kind === 'kerb') ?? plans.find((x) => x.ok); if (pl) { net.addStop(best.id, L * f, side, pl); first ??= best.stops[best.stops.length - 1].id; break; } }
    ids.push(first);
  }
  P.rebuild();
  return ids;
});
// draw the line by touch: housing, the high street's two stops, housing
await page.evaluate(() => { window.proto.startLineTool(); window.proto.focusOn({ x: 0, z: 0 }, 520); });
await page.waitForTimeout(2500);
const taps = await page.evaluate((ids) => { const P = window.proto, pl = P.markers.places(); const find = (id) => pl.find((m) => m.id === id || P.traffic.place(id)?.stops.some((s) => s.id === m.id)); return ids.map((id) => { const m = find(id); const s = P.toScreen(m.p); return { id, x: s.x, y: s.y }; }); }, [made[0], ...(await page.evaluate(() => { const pl = window.proto.markers.places(); const near = (q) => pl.map((m) => ({ id: m.id, d: Math.hypot(m.p.x - q.x, m.p.z - q.z) })).sort((a, b) => a.d - b.d)[0].id; return [near({ x: -85, z: 0 }), near({ x: 120, z: 0 })]; })), made[1]]); // (the high street's two stops, found by where they are)
for (const t of taps) {
  if (t.x < 10 || t.x > 402 || t.y < 110 || t.y > 760) fail(`stop ${t.id} is off screen`);
  await page.touchscreen.tap(t.x, t.y); await page.waitForTimeout(400);
}
await page.screenshot({ path: `${out}/loop-1-drawing.png` });
const before = (await town()).balance;
await page.tap('#t-prim button'); await page.waitForTimeout(1200);
const after = (await town()).balance;
console.log('balance', before, '->', after);
if (!(after < before)) fail('buying the new line cost nothing');
await page.screenshot({ path: `${out}/loop-2-line.png` });
await page.tap('#sheet .close').catch(() => {});

const seen1 = [];
for (let d = 0; d < 8; d++) { await skip(1); seen1.push((await town()).status[0]); }
const t1 = await town();
console.log('after 8 days with the new line', seen1.join(''), JSON.stringify(t1));
if (!seen1.includes('g') || !(t1.residents > t0.residents || t1.jobs > t0.jobs)) fail('the town did not grow with the new line');
if (t1.stats.builds + t1.stats.densified < 1) fail('nothing was built');
if (!(t1.balance > after)) console.log('note: the lines ran at a loss this week');
await page.evaluate(() => window.proto.showTown()); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/loop-3-growing.png` });
await page.tap('#sheet .close').catch(() => {});

// withdraw every line, each from its sheet, by touch (the panel is the whole town's: with the
// starter line still on the high street, withdrawing only the new one just settles it back)
for (let i = 0; i < 2; i++) {
  await page.tap('[data-bar="transport"]'); await page.waitForTimeout(400);
  await page.tap('[data-line="0"]'); await page.waitForTimeout(500);
  const withdraw = await page.$$('#sheet .acts button');
  for (const b of withdraw) if ((await b.textContent()).includes('Withdraw')) await b.tap();
  await page.waitForTimeout(500);
}
if (await page.evaluate(() => window.proto.lines.list.length)) fail('the lines were not withdrawn');
const seen2 = [];
for (let d = 0; d < 8; d++) { await skip(1); seen2.push((await town()).status[0]); }
const t2 = await town();
console.log('8 days after withdrawing them', seen2.join(''), JSON.stringify(t2));
if (!seen2.some((c) => c === 'd' || c === 's') || !(t2.residents < t1.residents || t2.jobs < t1.jobs)) fail('the town did not suffer when its lines went');
await page.evaluate(() => window.proto.showTown()); await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/loop-4-after-withdraw.png` });
console.log('errors', JSON.stringify(errs));
if (errs.length) fail('console errors');
await browser.close();
