// A real region (docs/real.md) played on a phone-sized page: Exeter from Ordnance Survey data.
// It loads with no console errors and shows its data credit; the economy knows its places; two
// bus stops go on real streets and a line drawn by touch between them carries people; two
// stations go on the real railway, a train line joins them and its trains call at both.
// node e2e/real.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5180/?map=exe';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => document.querySelector('.loading.gone') && window.proto?.town, null, { timeout: 600000, polling: 1000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's', JSON.stringify(await page.evaluate(() => window.proto.loading.times.map((t) => `${t.label}: ${Math.round(t.ms)}`))));
await wait(3000);

// what it is: the map, its places, its credit
const info = await page.evaluate(() => { const P = window.proto, M = P.map; return { name: M.name, places: M.settlements.map((s) => s.name), segs: P.net.segs.size, lots: P.net.lots.length, credit: document.querySelector('#credit')?.textContent ?? '', towns: P.town.reportFor ? M.settlements.map((s) => P.town.reportFor(s.id + 1)?.residents ?? null) : null }; });
console.log('map', JSON.stringify(info));
if (!info.places.includes('Exeter')) fail('Exeter is not a place on the map');
if (info.lots < 10000) fail(`only ${info.lots} buildings`);
if (!/Contains OS data © Crown copyright/.test(info.credit)) fail('no OS data credit on the map');
await page.screenshot({ path: `${out}/real-0-start.png` });

// two stops on real streets a kilometre apart (placed as the stop tool does), and a line between them by touch
const made = await page.evaluate(() => {
  const P = window.proto, net = P.net, ids = [];
  for (const q of [{ x: -300, z: -150 }, { x: 450, z: 250 }]) {
    // (the streets nearest the spot, nearest first, until one takes a stop)
    const near = [...net.segs.values()].filter((s) => net.def(s).cls === 'road' && net.def(s).family !== 'Motorway').map((s) => ({ s, c: net.nearestSeg(q, 400, (x) => x === s) })).filter((x) => x.c).sort((a, b) => Math.hypot(a.c.x - q.x, a.c.z - q.z) - Math.hypot(b.c.x - q.x, b.c.z - q.z)).slice(0, 25);
    let first = null;
    for (const { s: sg, c: n } of near) { for (const side of [1, -1]) { for (const d of [0, 15, -15, 30, -30, 45]) { const { plans } = net.planStop(sg.id, n.s + d, side); const pl = plans.find((x) => x.ok && x.kind === 'kerb') ?? plans.find((x) => x.ok); if (pl) { net.addStop(sg.id, n.s + d, side, pl); first = sg.stops[sg.stops.length - 1].id; break; } } if (first) break; } if (first) break; }
    ids.push(first);
  }
  P.rebuild();
  return ids;
});
console.log('stops', JSON.stringify(made));
if (made.some((x) => x == null)) fail('a stop could not be placed on a real street');
await page.evaluate(() => { window.proto.startLineTool(); window.proto.focusOn({ x: 75, z: 50 }, 1300); });
await wait(4000);
const taps = await page.evaluate((ids) => { const P = window.proto, pl = P.markers.places(); const find = (id) => pl.find((m) => m.id === id || P.traffic.place(id)?.stops.some((s) => s.id === m.id)); return ids.map((id) => { const m = find(id); const s = P.toScreen(m.p); return { id, x: s.x, y: s.y }; }); }, made);
for (const t of taps) {
  if (t.x < 10 || t.x > 402 || t.y < 110 || t.y > 760) fail(`stop ${t.id} is off screen`);
  await page.touchscreen.tap(t.x, t.y); await wait(500);
}
await page.tap('#t-prim button'); await wait(1500);
await page.screenshot({ path: `${out}/real-1-bus-line.png` });
await page.tap('#sheet .close').catch(() => {});
const bus = await page.evaluate(() => ({ lines: window.proto.lines.list.length, buses: window.proto.traffic.buses }));
console.log('bus line', JSON.stringify(bus));
if (bus.lines !== 1) fail('the bus line was not created');

// two stations on the real railway, by OS's own station points, and a train line between them
await page.evaluate(() => { window.proto.purse.balance = 6_000_000; });
const stations = await page.evaluate(() => {
  const P = window.proto, R = P.railway, net = P.net, out = [];
  const points = P.map.real.overpass.elements.filter((e) => e.type === 'node' && e.tags?.railway === 'station').map((e) => ({ name: e.tags.name, x: e.lon, z: e.lat }));
  for (const want of ["Exeter St David's", 'Exeter St Thomas', 'Exeter Central', "St James' Park", 'Polsloe Bridge']) {
    if (out.length === 2) break;
    const p = points.find((q) => q.name === want);
    if (!p) continue;
    const sg = net.nearestSeg(p, 80, (s) => net.def(s).cls === 'rail');
    if (!sg) continue;
    let built = null;
    for (const d of [0, 40, -40, 80, -80, 120, -120, 160, -160]) for (const side of [1, -1]) {
      if (built) break;
      const res = R.plan(sg.seg.id, sg.s + d, side, 90);
      const pl = res.plans.find((q) => q.ok);
      if (pl) { pl.station.name = want; built = R.build(pl).station; }
    }
    if (built) out.push({ id: built.id, name: built.name });
  }
  P.rebuild();
  return out;
});
console.log('stations', JSON.stringify(stations));
if (stations.length !== 2) fail('two stations could not be built on the real railway');
else {
  await page.evaluate((id) => window.proto.railGame.startLineTool(id), stations[0].id);
  await page.evaluate((id) => { const P = window.proto, sh = P.railway.shapes.get(id); P.focusOn(sh.mid, 900); }, stations[1].id);
  await wait(3000);
  const sp = await page.evaluate((id) => { const P = window.proto; return P.toScreen(P.railway.shapes.get(id).mid); }, stations[1].id);
  await page.touchscreen.tap(sp.x, sp.y); await wait(600);
  await page.tap('#t-prim button'); await wait(1500);
  await page.screenshot({ path: `${out}/real-2-rail-line.png` });
  await page.tap('#sheet .close').catch(() => {});
  const line = await page.evaluate(() => { const R = window.proto.railway, l = R.lines[R.lines.length - 1]; return l ? { id: l.id, stops: l.stops.length, trains: R.trainsOn(l).length + R.sim.waiting } : null; });
  console.log('rail line', JSON.stringify(line));
  if (!line || line.stops !== 2 || !line.trains) fail('the rail line was not created with a train');
  // trains call at both stations (the railway stepped on directly: SwiftShader draws a frame a second)
  let calls = [];
  for (let i = 0; i < 40 && new Set(calls).size < 2; i++) {
    calls = await page.evaluate((lid) => { const R = window.proto.railway; for (let k = 0; k < 120; k++) R.update(0.25); return R.sim.log.filter((e) => e.line === lid).map((e) => e.station); }, line?.id);
  }
  console.log('calls', JSON.stringify(calls.slice(0, 6)));
  if (new Set(calls).size < 2) fail('the trains did not call at both stations');
}

// a few days on: the bus line carries people, and the economy counts them
await page.evaluate(() => { const P = window.proto; for (let m = 0; m < 3 * 1440; m += 60) P.skip(60); });
await wait(2000);
const after = await page.evaluate(() => { const P = window.proto, l = P.lines.list[0], r = P.town.report; return { riders: l ? (() => { const st = P.town.econ.line(l.id); return st ? st.carried + st.carriedLastMonth : 0; })() : null, residents: Math.round(r.residents), status: r.status, report: JSON.stringify(P.town.report).slice(0, 200) }; });
console.log('after three days', JSON.stringify(after));
if (!(after.residents > 1000)) fail('the economy does not see the city');
if (!(after.riders > 0)) fail('nobody rode the bus line');
await page.evaluate(() => window.proto.showTown()); await wait(700);
await page.screenshot({ path: `${out}/real-3-town.png` });
console.log('errors', JSON.stringify(errs.slice(0, 5)));
if (errs.length) fail('console errors');
await browser.close();
