// Measures a train line's money on the phone build (not part of CI): two stations and one train
// built by touch, then ten game days skipped on the page's own clock hook, the line's fares and
// running cost read from the purse each day. Once for the rail e2e's line just west of the start
// town (a well-used line), once for a line out in the countryside (an empty one).
// node e2e/railmoney.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/proto.html?map=region&seed=42';
const out = process.argv[3] ?? '.';
const RAIL_ID = 1_000_000;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function measure(label, x, zA, zB, days = 10) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const wait = (ms) => page.waitForTimeout(ms);
  await page.goto(url);
  await page.waitForFunction(() => window.proto?.railway, null, { timeout: 90000 });
  await wait(2500);
  await page.evaluate(() => { window.proto.setSpeed(1); window.proto.purse.balance = 3_000_000; });
  const laid = await page.evaluate(({ x }) => { const P = window.proto; P.buildRoad({ x, z: -380 }, { x, z: 580 }, 'rail-branch'); P.rebuild(); return { rail: [...P.net.segs.values()].filter((s) => P.net.def(s).cls === 'rail').length }; }, { x });
  console.log(label, 'laid', JSON.stringify(laid));
  async function buildStation(z) {
    await page.tap('[data-bar="build"]'); await wait(400);
    await page.tap('[data-tab="stops"]'); await wait(400);
    const cards = await page.$$('[data-item]');
    for (const c of cards) if ((await c.getAttribute('aria-label'))?.startsWith('Railway station')) { await c.tap(); break; }
    await wait(500);
    await page.evaluate(({ x, z }) => window.proto.focusOn({ x, z }, 380), { x, z });
    await wait(1800);
    const s = await page.evaluate(({ x, z }) => window.proto.toScreen({ x: x + 3, z }), { x, z });
    await page.touchscreen.tap(s.x, s.y);
    await wait(1500);
    const btn = await page.$('#t-prim button:not([disabled])');
    if (!btn) { console.log(label, `no station at z=${z}:`, (await page.textContent('#tpanel').catch(() => ''))?.slice(0, 160)); return false; }
    await btn.tap();
    await wait(1500);
    return true;
  }
  if (!(await buildStation(zA))) return;
  await page.tap('#sheet .close').catch(() => {});
  await wait(300);
  if (!(await buildStation(zB))) return;
  const built = await page.evaluate(() => window.proto.railway.stations.map((s) => ({ id: s.id, name: s.name, x: Math.round(s.x), z: Math.round(s.z) })));
  console.log(label, 'stations', JSON.stringify(built));
  const newLine = await page.$$('#sheet button');
  for (const b of newLine) if ((await b.textContent())?.includes('New line from here')) { await b.tap(); break; }
  await wait(600);
  await page.evaluate(({ x }) => window.proto.focusOn({ x, z: 100 }, 900), { x });
  await wait(2200);
  const first = built.find((s) => s.z === Math.min(...built.map((b) => b.z)));
  const fp = await page.evaluate((id) => { const P = window.proto, sh = P.railway.shapes.get(id); return P.toScreen(sh.mid); }, first.id);
  await page.touchscreen.tap(fp.x, fp.y);
  await wait(600);
  await page.tap('#t-prim button');
  await wait(1200);
  const line = await page.evaluate(() => { const R = window.proto.railway, l = R.lines[R.lines.length - 1]; return l ? { id: l.id, stops: l.stops, trains: R.trainsOn(l).length + R.sim.waiting } : null; });
  console.log(label, 'line', JSON.stringify(line));
  if (!line) return;
  await page.evaluate(() => window.proto.setSpeed(4));
  await wait(20000); // (the train under way, the crowds at the platforms)
  await page.screenshot({ path: `${out}/railmoney-${label}.png` });
  const rows = [];
  for (let d = 1; d <= days; d++) {
    await page.evaluate(() => window.proto.skip(1440));
    const r = await page.evaluate(({ id, RAIL_ID }) => {
      const P = window.proto, b = P.purse.line(RAIL_ID + id), st = P.town.line(RAIL_ID + id);
      return { fares: Math.round(b.lastFares), running: Math.round(b.lastRunning), carried: st ? +st.carriedLastMonth.toFixed(1) : null, ok: st?.ok, problem: st?.problem, balance: Math.round(P.purse.balance), residents: Math.round(P.town.report?.residents ?? 0) };
    }, { id: line.id, RAIL_ID });
    rows.push(r);
    console.log(label, `day ${d}`, JSON.stringify(r));
  }
  const last5 = rows.slice(-5), f = last5.reduce((a, r) => a + r.fares, 0) / last5.length, c = last5.reduce((a, r) => a + r.running, 0) / last5.length;
  console.log(label, `mean of the last five days: fares £${Math.round(f)}, running £${Math.round(c)}, ratio ${(f / Math.max(1, c)).toFixed(2)}, carried ${(last5.reduce((a, r) => a + (r.carried ?? 0), 0) / last5.length).toFixed(1)} a town-day`);
  console.log(label, 'errors', JSON.stringify(errs));
  await page.close();
}
// The town to the nearest village (Fellwick, 590 people, 2.9 km west), brought to life first by
// looking at it: a branch from the town's west edge, a station at each end, one train.
async function measureVillage(days = 10) {
  const label = 'village';
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const wait = (ms) => page.waitForTimeout(ms);
  await page.goto(url);
  await page.waitForFunction(() => window.proto?.railway, null, { timeout: 90000 });
  await wait(2500);
  await page.evaluate(() => { window.proto.setSpeed(1); window.proto.purse.balance = 3_000_000; });
  const village = await page.evaluate(() => { const W = window.proto.map.world; const s = W.settlements.find((x) => x.name === 'Fellwick') ?? W.settlements.filter((x) => x.id !== W.start).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]; return { id: s.id, name: s.name, x: Math.round(s.x), z: Math.round(s.z), pop: s.pop }; });
  console.log(label, 'village', JSON.stringify(village));
  await page.evaluate(({ x, z }) => window.proto.focusOn({ x, z }, 700), village);
  const live = await page.waitForFunction((id) => window.proto.worldGame.towns.places.find((p) => p.id === id)?.live === true, village.id, { timeout: 90000 }).then(() => true, () => false);
  await wait(3000);
  console.log(label, 'live', live, 'lots now', await page.evaluate(() => window.proto.net.lots.length));
  await page.screenshot({ path: `${out}/railmoney-village-alive.png` });
  // the branch: from just west of the town towards the village's edge
  const A = { x: -440, z: -200 }, B = { x: village.x + 300, z: village.z + 150 };
  const laid = await page.evaluate(({ A, B }) => { const P = window.proto, before = [...P.net.segs.keys()].length; P.buildRoad(A, B, 'rail-branch'); P.rebuild(); const rail = [...P.net.segs.values()].filter((s) => P.net.def(s).cls === 'rail'); return { segs: [...P.net.segs.keys()].length - before, rail: rail.map((s) => ({ id: s.id, len: Math.round(P.net.length(s)) })) }; }, { A, B });
  console.log(label, 'laid', JSON.stringify(laid));
  if (!laid.rail.length) { console.log(label, 'no branch could be laid'); await page.close(); return; }
  // a station near each end of the branch: the first spot the planner accepts, 150 m in and onwards
  const stations = await page.evaluate(({ A, B }) => {
    const P = window.proto, R = P.railway, net = P.net;
    const rail = [...net.segs.values()].filter((s) => net.def(s).cls === 'rail');
    const endOf = (q) => { let best = null; for (const s of rail) { const p = net.path(s); for (const [i, e] of [[0, 'a'], [p.length - 1, 'b']]) { const d = Math.hypot(p[i].x - q.x, p[i].z - q.z); if (!best || d < best.d) best = { s, d, end: e }; } } return best; };
    const out = [];
    for (const q of [A, B]) {
      const e = endOf(q); let done = null;
      for (let s = 150; s <= 900 && !done; s += 50) {
        const at = e.end === 'a' ? s : net.length(e.s) - s;
        if (at < 0 || at > net.length(e.s)) break;
        const r = R.plan(e.s.id, at, 1, 130);
        if (r.plans.length) { const st = R.build(r.plans[0]).station; done = { id: st.id, name: st.name, x: Math.round(st.x), z: Math.round(st.z), at: s, reason: null }; }
        else if (s === 900) done = { reason: r.reason };
      }
      out.push(done ?? { reason: 'no spot' });
    }
    P.rebuild();
    return out;
  }, { A, B });
  console.log(label, 'stations', JSON.stringify(stations));
  if (stations.some((s) => !s.id)) { await page.close(); return; }
  // the line, from the second station's sheet, one train
  await page.evaluate((id) => { const P = window.proto; P.railGame.showStation(P.railway.station(id)); }, stations[1].id);
  await wait(800);
  for (const b of await page.$$('#sheet button')) if ((await b.textContent())?.includes('New line from here')) { await b.tap(); break; }
  await wait(600);
  await page.evaluate(({ x, z }) => window.proto.focusOn({ x, z }, 900), stations[0]);
  await wait(2200);
  const fp = await page.evaluate((id) => { const P = window.proto, sh = P.railway.shapes.get(id); return P.toScreen(sh.mid); }, stations[0].id);
  await page.touchscreen.tap(fp.x, fp.y);
  await wait(600);
  await page.tap('#t-prim button');
  await wait(1200);
  // (KEEP=1: the trains the line tool gives a long line, an intercity and a diesel unit; else one train, the intercity)
  const line = await page.evaluate((keep) => { const P = window.proto, R = P.railway, l = R.lines[R.lines.length - 1]; if (!l) return null; const ts = R.trainsOn(l); if (!keep) for (const t of ts.slice(1)) R.removeTrain(t); return { id: l.id, stops: l.stops, trains: R.trainsOn(l).length + R.sim.waiting, kinds: R.trainsOn(l).map((t) => t.def.id) }; }, process.env.KEEP === '1');
  console.log(label, 'line', JSON.stringify(line));
  if (!line) { await page.close(); return; }
  await page.evaluate(() => window.proto.setSpeed(4));
  await wait(20000);
  await page.screenshot({ path: `${out}/railmoney-village.png` });
  const rows = [];
  for (let d = 1; d <= days; d++) {
    await page.evaluate(() => window.proto.skip(1440));
    const r = await page.evaluate(({ id, RAIL_ID }) => { const P = window.proto, b = P.purse.line(RAIL_ID + id), st = P.town.line(RAIL_ID + id); return { fares: Math.round(b.lastFares), running: Math.round(b.lastRunning), carried: st ? +st.carriedLastMonth.toFixed(1) : null, ok: st?.ok, problem: st?.problem, cycleMin: st?.cycleMin, balance: Math.round(P.purse.balance), residents: Math.round(P.town.report?.residents ?? 0) }; }, { id: line.id, RAIL_ID });
    rows.push(r);
    console.log(label, `day ${d}`, JSON.stringify(r));
  }
  const last5 = rows.slice(-5), f = last5.reduce((a, r) => a + r.fares, 0) / last5.length, c = last5.reduce((a, r) => a + r.running, 0) / last5.length;
  console.log(label, `mean of the last five days: fares £${Math.round(f)}, running £${Math.round(c)}, ratio ${(f / Math.max(1, c)).toFixed(2)}, carried ${(last5.reduce((a, r) => a + (r.carried ?? 0), 0) / last5.length).toFixed(1)} a town-day`);
  console.log(label, 'errors', JSON.stringify(errs));
  await page.close();
}
const which = process.argv[4] ?? 'town,village,empty';
if (which.includes('town')) await measure('town', -440, -250, 340);
if (which.includes('village')) await measureVillage();
if (which.includes('empty')) await measure('empty', -2600, -250, 340);
await browser.close();
