// Saving and loading (docs/production.md §4), by touch on a phone-sized page: the town is changed
// (a road, a bus stop, a line, a junction of the player's own design), a game day passes, and
// Menu > Save town saves it. The save opened in a second tab has the same roads, stops, lines,
// buildings, money, clock and economy; then both run on two game days, paused so only the town's
// clock moves, and must still agree exactly. Menu > Load town lists it; the start menu's Continue
// opens it; autosave on hiding the page works. No console errors.
// node e2e/save.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/?map=town';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
const diff = (a, b) => Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

// ---- a new game, changed ----
const A = await open(url);
await A.evaluate(() => window.proto.setSpeed(0)); // (paused from here: only the town's clock moves, by skip)
const changed = await A.evaluate(() => {
  const P = window.proto, net = P.net;
  // a new road off the high street, and a bus stop on it
  P.buildRoad({ x: 120, z: 0 }, { x: 120, z: -90 });
  let best = null, bd = 1e9;
  for (const s of net.segs.values()) { if (net.def(s).cls !== 'road' || net.def(s).family === 'Motorway' || net.length(s) < 40 || s.stops.length) continue; const p = net.path(s), m = p[Math.floor(p.length / 2)], d = Math.hypot(m.x - -110, m.z - -96); if (d < bd) { bd = d; best = s; } }
  const L = net.length(best); let stop = null;
  for (const side of [1, -1]) { const { plans } = net.planStop(best.id, L / 2, side); const pl = plans.find((x) => x.ok); if (pl) { net.addStop(best.id, L / 2, side, pl); stop = best.stops[best.stops.length - 1].id; break; } }
  P.rebuild();
  // a line from it to the high street's two stops
  const pl = P.markers.places(), near = (q) => pl.map((m) => ({ id: m.id, d: Math.hypot(m.p.x - q.x, m.p.z - q.z) })).sort((a, b) => a.d - b.d)[0].id;
  const line = P.lines.add([stop, near({ x: -85, z: 0 }), near({ x: 120, z: 0 })], false, 2);
  // a junction of the player's own design (it keeps its form, and no longer redesigns itself)
  const j = [...P.junctions.values()].find((x) => x.form === 'signals' || x.form === 'roundabout' || x.form === 'priority');
  j.auto = false;
  P.rebuild();
  return { stop, line: line.id, junction: j.node, segs: net.segs.size };
});
console.log('changed', JSON.stringify(changed));
await A.evaluate(() => window.proto.skip(1440 + 200));
// ---- Menu > Save town, by touch ----
await A.tap('[data-bar="menu"]'); await A.waitForTimeout(400);
await A.screenshot({ path: `${out}/save-0-menu.png` });
const saveCard = await A.$('[data-menu]:has-text("Save town")');
ok(saveCard && !(await saveCard.getAttribute('aria-disabled')), 'Menu has Save town, enabled');
await saveCard.tap();
await A.waitForFunction(() => window.__saved?.why === 'manual', null, { timeout: 20000 });
const saved = await A.evaluate(() => window.__saved);
console.log('saved in', saved.ms.toFixed(1), 'ms (the snapshot, and storage copying it)');
ok(saved.ms < 400, `a save takes a moment, not a stall (${saved.ms.toFixed(0)} ms)`);
await A.waitForTimeout(600);
await A.screenshot({ path: `${out}/save-1-saved.png` });
const sa = await state(A);
const id = await A.evaluate(() => window.proto.saveId);

// ---- Menu > Load town lists it (the menu stays open after saving) ----
await (await A.$('[data-menu]:has-text("Load town")')).tap();
await A.waitForSelector('.saverow', { timeout: 5000 });
await A.waitForTimeout(300);
await A.screenshot({ path: `${out}/save-2-load.png` });
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
await B.screenshot({ path: `${out}/save-3-loaded.png` });

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
await M.screenshot({ path: `${out}/save-4-continue.png` });
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
