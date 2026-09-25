// Saving and loading (docs/production.md §4), by touch on a phone-sized page: the town is changed
// (a road, bus stops and a line, a branch railway with two stations and a rail line, a junction
// of the player's own design), a game day passes, and Menu > Save town saves it. The save opened in a second tab has the same roads, stops, lines,
// buildings, money, clock and economy; then both run on two game days, paused so only the town's
// clock moves, and must still agree exactly. Menu > Load town lists it; the start menu's Continue
// opens it; autosave on hiding the page works. No console errors.
// node e2e/save.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/?map=town';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'en-GB', serviceWorkers: 'block' });
const errs = [];
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
async function open(u) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(u);
  await page.waitForFunction(() => window.proto?.town, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  return page;
}
// everything a save should keep, as it stands in a page
const state = (page) => page.evaluate(() => {
  const P = window.proto, net = P.net;
  return {
    clock: P.clock(), speed: P.speed(), balance: P.purse.balance, purse: P.purse.save(),
    nodes: net.nodes.size, segs: [...net.segs.values()].map((s) => `${s.id}:${s.type}:${s.a}-${s.b}:${s.oneway ? 1 : 0}:${s.stops.map((t) => t.id).join('/')}:${(s.bridges ?? []).map((b) => b.type).join('/')}`),
    lots: net.lots.map((l) => `${l.id}:${l.kind}`), buildings: P.buildings.filter((b) => !b.dying).length,
    lines: P.lines.list.map((l) => `${l.id}:${l.stops.join('>')}:${l.loop}:${P.lines.buses(l).length}`),
    names: P.lines.list.map((l) => P.lines.title(l)),
    mine: [...P.junctions.values()].filter((j) => !j.auto).map((j) => `${j.node}:${j.form}`),
    interchanges: P.interchanges.length, stations: P.railway.stations.map((s) => s.name), raillines: P.railway.lines.length,
    econ: JSON.stringify(P.town.econ.save()),
  };
});
// Screenshots are for looking at, not checks: on a slow runner, with two game tabs drawing, one can
// take longer than Playwright's 30 s, so they get more time and a miss is logged, not fatal.
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png`, timeout: 90000 }).catch((e) => console.log(`(screenshot ${name} skipped: ${e.message.split('\n')[0]})`));
const diff = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

// ---- a new game, changed ----
const A = await open(url);
await A.evaluate(() => window.proto.setSpeed(0)); // (paused from here: only the town's clock moves, by skip)
const changed = await A.evaluate(() => {
  const P = window.proto, net = P.net;
  // a branch line across the north of the town, two stations on it and a rail line between them
  P.purse.balance += 3_000_000;
  P.buildRoad({ x: -480, z: 340 }, { x: 480, z: 340 }, 'rail-branch');
  P.rebuild();
  const R = P.railway, seg = [...net.segs.values()].filter((x) => net.def(x).cls === 'rail').sort((a, b) => net.length(b) - net.length(a))[0];
  const made = [];
  for (const at of [0.25, 0.75]) { const pl = [1, -1].flatMap((side) => R.plan(seg.id, net.length(seg) * at, side, 130).plans).find((x) => x.ok); if (pl) made.push(R.build(pl).station.id); }
  const f = P.traffic.fleet, dmu = f.defFor(f.offerFor('dmu'));
  const rl = made.length === 2 ? R.addLine(made, false, [dmu]) : 'no stations';
  P.rebuild();
  // a new road off the high street, and three bus stops (the town starts with none)
  P.buildRoad({ x: 120, z: 0 }, { x: 120, z: -90 });
  // (on the nearest road that has room for one, kerbside or in a lay-by)
  const stopNear = (q) => {
    const segs = [...net.segs.values()].filter((s) => net.def(s).cls === 'road' && net.def(s).family !== 'Motorway' && net.length(s) >= 40 && !s.stops.length)
      .map((s) => { const p = net.path(s), m = p[Math.floor(p.length / 2)]; return { s, d: Math.hypot(m.x - q.x, m.z - q.z) }; }).sort((a, b) => a.d - b.d);
    for (const { s: seg } of segs.slice(0, 8)) {
      const L = net.length(seg);
      for (const side of [1, -1]) for (const f of [0.5, 0.35, 0.65]) { const { plans } = net.planStop(seg.id, L * f, side); const pl = plans.find((x) => x.ok); if (pl) { net.addStop(seg.id, L * f, side, pl); return seg.stops[seg.stops.length - 1].id; } }
    }
    return null;
  };
  const stops = [{ x: -110, z: -96 }, { x: -85, z: 0 }, { x: 120, z: 0 }].map(stopNear);
  const stop = stops[0];
  if (stops.includes(null)) return { error: `no room for a bus stop (${stops})` };
  P.rebuild();
  // a line through them
  const line = P.lines.add(stops, false, 2);
  P.rebuild();
  if (!P.lines.list.includes(line)) return { error: 'the new line was dropped as the roads were redrawn' };
  // a junction of the player's own design (it keeps its form, and no longer redesigns itself)
  const j = [...P.junctions.values()].find((x) => x.form === 'signals' || x.form === 'roundabout' || x.form === 'priority');
  j.auto = false;
  P.rebuild();
  return { stop, line: line.id, junction: j.node, segs: net.segs.size, stations: made.length, railLine: typeof rl === 'string' ? rl : rl.id };
});
console.log('changed', JSON.stringify(changed));
if (changed.error) fail(changed.error);
await A.evaluate(() => window.proto.skip(1440 + 200));
// ---- Menu > Save town, by touch ----
await A.tap('[data-bar="menu"]'); await A.waitForTimeout(400);
await shot(A, 'save-0-menu');
const saveCard = await A.$('[data-menu]:has-text("Save town")');
ok(saveCard && !(await saveCard.getAttribute('aria-disabled')), 'Menu has Save town, enabled');
await saveCard.tap();
await A.waitForFunction(() => window.__saved?.why === 'manual', null, { timeout: 20000 });
const saved = await A.evaluate(() => window.__saved);
console.log('saved in', saved.ms.toFixed(1), 'ms (the snapshot, and storage copying it)');
ok(saved.ms < 400, `a save takes a moment, not a stall (${saved.ms.toFixed(0)} ms)`);
await A.waitForTimeout(600);
await shot(A, 'save-1-saved');
const sa = await state(A);
const id = await A.evaluate(() => window.proto.saveId);

// ---- Menu > Load town lists it (the menu stays open after saving) ----
await (await A.$('[data-menu]:has-text("Load town")')).tap();
await A.waitForSelector('.saverow', { timeout: 5000 });
await A.waitForTimeout(300);
await shot(A, 'save-2-load');
const rows = await A.$$eval('.saverow b', (b) => b.map((x) => x.textContent));
ok(rows.length === 1 && /this town/.test(rows[0]), `Load town lists this town (${rows.join(' | ')})`);
await A.tap('#sheet .close').catch(() => {});

// ---- the save, opened in a second tab ----
const B = await open(url.replace(/\?.*$/, '') + `?map=town&save=${id}`);
await B.evaluate(() => window.proto.setSpeed(0));
const sb = await state(B);
const d0 = diff(sa, sb);
ok(d0.length === 0, `the loaded town is the saved one${d0.length ? `: differs in ${d0.join(', ')}` : ''}`);
if (d0.length) for (const k of d0.slice(0, 3)) console.log(k, JSON.stringify(sa[k]).slice(0, 300), '\n vs', JSON.stringify(sb[k]).slice(0, 300));
ok(sb.mine.includes(`${changed.junction}:${sa.mine.find((x) => x.startsWith(`${changed.junction}:`))?.split(':')[1]}`), 'the junction of the player’s design is kept');
ok(sb.lines.some((l) => l.startsWith(`${changed.line}:`)), 'the new line is kept, with its buses');
ok(sb.segs.some((s) => s.includes(`:${changed.stop}`)), 'the new stop is kept');
ok(sb.segs.some((s) => s.split(':')[3] === '1'), 'one-way carriageways (the motorway) are kept');
ok(sb.segs.some((s) => s.split(':')[5]), 'bridges and their types are kept');
ok(changed.stations === 2 && sb.stations.length === 2 && sb.raillines === 1, `railway stations and the rail line are kept (${JSON.stringify(changed)})`);
ok(await B.evaluate(() => window.proto.railway.trains.length) === await A.evaluate(() => window.proto.railway.trains.length), 'the rail line runs as many trains');
await shot(B, 'save-3-loaded');

// ---- both run on: the same town ----
for (const p of [A, B]) await p.evaluate(() => window.proto.skip(2 * 1440));
const ra = await state(A), rb = await state(B);
const d1 = diff({ ...ra, econ: ra.econ }, rb);
ok(ra.econ !== sa.econ, 'the town changed over those two days');
ok(d1.length === 0, `two days on, the saved and the loaded town agree${d1.length ? `: they differ in ${d1.join(', ')}` : ''}`);

// ---- autosave on hiding the page ----
await B.evaluate(() => { window.__saved = null; document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await B.waitForFunction(() => window.__saved?.why === 'hide', null, { timeout: 20000 }).then(() => ok(true, 'hiding the page saves'), () => fail('hiding the page did not save'));

// ---- the start menu: Continue opens it ----
const M = await ctx.newPage();
M.on('pageerror', (e) => errs.push(e.message));
await M.goto(url.replace(/\?.*$/, ''));
await M.waitForSelector('[data-continue]', { timeout: 10000 }).catch(() => {});
await shot(M, 'save-4-continue');
const cont = await M.$('[data-continue]');
ok(!!cont, 'the start menu offers Continue');
if (cont) {
  console.log('continue:', (await cont.textContent()).trim());
  await cont.tap();
  await M.waitForFunction(() => window.proto?.town, null, { timeout: 120000 });
  ok(new URL(M.url()).searchParams.get('save') === id, 'Continue opens the saved town');
}

for (const e of errs) fail(`console: ${e}`);
await browser.close();
console.log(process.exitCode ? 'FAILED' : 'all ok');
