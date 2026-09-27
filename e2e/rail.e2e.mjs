// Railway stations and lines (docs/rail.md), played by touch on a phone-sized page: the empty
// region's start town has no stations or trains; a branch line just west of it gets a level crossing
// where it meets the lane west; two stations are built on it from Build > Stops and a line drawn between them by
// tapping them; its trains call at both with their doors open, the barriers hold the road, and
// nothing is logged as an error.
// node e2e/rail.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/proto.html?map=region&seed=42'; // (straight into the region's start town, past the start menu)
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(url);
await page.waitForFunction(() => window.proto?.railway, null, { timeout: 90000 });
await wait(2500);
await page.evaluate(() => { window.proto.setSpeed(4); window.proto.purse.balance = 3_000_000; }); // (enough for two stations and their trains)

// the town starts with no stations, lines or trains: they're the player's to build
const starter = await page.evaluate(() => { const R = window.proto.railway; return { stations: R.stations.map((s) => s.name), lines: R.lines.length, trains: R.trains.length }; });
console.log('at the start', JSON.stringify(starter));
if (starter.stations.length || starter.lines || starter.trains) fail('the town starts with railway stations or lines already built');
await page.evaluate(() => window.proto.focusOn({ x: -480, z: 116 }, 220));
await wait(2500);
await page.screenshot({ path: `${out}/rail-0-starter.png` });

// the rail tool by touch: Build > Rail > Branch line, a finger dragged across the fields north of town; the blueprint calls it a railway
{
  await page.tap('[data-bar="build"]'); await wait(400);
  await page.tap('[data-tab="rail"]'); await wait(400);
  let hit = false;
  for (const c of await page.$$('[data-item]')) if ((await c.getAttribute('aria-label'))?.startsWith('Branch line')) { await c.tap(); hit = true; break; }
  if (!hit) fail('no Branch line card under Build > Rail');
  await page.evaluate(() => window.proto.focusOn({ x: 0, z: 760 }, 900)); await wait(2000);
  const cdp = await page.context().newCDPSession(page);
  const [a, b] = await page.evaluate(() => [window.proto.toScreen({ x: -200, z: 760 }), window.proto.toScreen({ x: 200, z: 760 })]);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] }); await wait(150);
  for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + ((b.x - a.x) * i) / 12, y: a.y + ((b.y - a.y) * i) / 12, id: 1 }] }); await wait(40); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(1500);
  const panel = (await page.textContent('#tpanel').catch(() => '')) ?? '';
  if (!/New railway|Curved railway/.test(panel)) fail(`the rail blueprint should say it's a railway, not a road: "${panel.slice(0, 60)}"`);
  else console.log('rail blueprint:', panel.slice(0, 40));
  await page.tap('#t-cancel'); await wait(500);
}

// a branch line just west of the start town, north to south: it crosses the lane west on the level
const laid = await page.evaluate(() => {
  const P = window.proto;
  P.buildRoad({ x: -480, z: -380 }, { x: -480, z: 580 }, 'rail-branch');
  P.rebuild();
  return { crossings: P.railway.crossings.length, balance: 0 };
});
console.log('laid', JSON.stringify(laid));
if (laid.crossings < 1) fail('no level crossing where the branch meets the lane west');

// (the camera glides to each spot: on a slow runner a fixed wait ends mid-glide and the tap lands
// on the wrong stretch of track, so wait for the glide to end, then a frame or two)
const settled = async () => { for (let i = 0; i < 60 && (await page.evaluate(() => !!window.proto.nav.anim)); i++) await wait(250); await wait(800); };
// Build > Stops > Railway station, then tap the track (twice, once for each station)
async function buildStation(z) {
  await page.tap('[data-bar="build"]'); await wait(400);
  await page.tap('[data-tab="stops"]'); await wait(400);
  const cards = await page.$$('[data-item]');
  let hit = false;
  for (const c of cards) if ((await c.getAttribute('aria-label'))?.startsWith('Railway station')) { await c.tap(); hit = true; break; }
  if (!hit) { fail('no Railway station card'); return; }
  await wait(500);
  await page.evaluate((z) => window.proto.focusOn({ x: -480, z }, 380), z);
  await settled();
  const s = await page.evaluate((z) => window.proto.toScreen({ x: -477, z }), z);
  await page.touchscreen.tap(s.x, s.y);
  await wait(1500);
  await page.screenshot({ path: `${out}/rail-1-plan-${z}.png` });
  // the card: the layouts with their prices, and Build in the tool strip
  const btn = await page.$('#t-prim button:not([disabled])');
  if (!btn) { fail(`no station can be built at z=${z}: ${(await page.textContent('#tpanel').catch(() => ''))?.slice(0, 200)}`); return; }
  await btn.tap();
  await wait(1500);
}
await buildStation(-250);
await page.tap('#sheet .close').catch(() => {});
await wait(300);
await buildStation(340);
const built = await page.evaluate(() => window.proto.railway.stations.map((s) => ({ id: s.id, name: s.name, x: Math.round(s.x), z: Math.round(s.z) })));
console.log('stations', JSON.stringify(built));
if (built.length !== 2) fail('two stations were not built on the branch');

// the second station's sheet is open: New line from here, then tap the first station, Create
const newLine = await page.$$('#sheet button');
let started = false;
for (const b of newLine) if ((await b.textContent())?.includes('New line from here')) { await b.tap(); started = true; break; }
if (!started) fail('no New line from here on the station sheet');
await wait(600);
await page.evaluate(() => window.proto.focusOn({ x: -480, z: 100 }, 900));
await settled(); await wait(1000);
const first = built.find((s) => s.z < 0);
const fp = await page.evaluate((id) => { const P = window.proto, sh = P.railway.shapes.get(id); return P.toScreen(sh.mid); }, first.id);
await page.touchscreen.tap(fp.x, fp.y);
await wait(600);
await page.screenshot({ path: `${out}/rail-2-line.png` });
await page.tap('#t-prim button');
await wait(1200);
const line = await page.evaluate(() => { const R = window.proto.railway, l = R.lines[R.lines.length - 1]; return l ? { id: l.id, stops: l.stops, trains: R.trainsOn(l).length + R.sim.waiting, depot: l.depot ?? null } : null; });
console.log('line', JSON.stringify(line));
if (!line || line.stops.length !== 2) fail('the rail line was not created');

// run: calls at both stations, doors open at a platform, the crossing shuts and holds the road
await page.evaluate(() => window.proto.focusOn({ x: -480, z: 116 }, 160));
let doorsSeen = false, closedSeen = false, carsHeld = 0, onTrack = 0, doorsWrong = 0, doorsChecked = 0;
for (let i = 0; i < 180; i++) { // (up to 3 min: SwiftShader runs a few frames a second)
  await wait(1000);
  const s = await page.evaluate((lid) => {
    const P = window.proto, R = P.railway, sim = R.sim, l = R.lines.find((x) => x.id === lid);
    const doors = sim.trains.some((t) => t.line === l && t.state === 'dwell' && t.doors === 1);
    const c = sim.crossings[0], held = sim.graph.blocks.some((b) => b.crossings.includes(0) && sim.owner[b.id] !== 0);
    const on = c ? P.traffic.onStretch(c.site.road, c.site.z0, c.site.z1) : false;
    const waitingCars = c ? (P.traffic.barriers.get(c.site.road)?.length ?? 0) : 0;
    const calls = sim.log.filter((e) => e.line === lid).map((e) => e.station);
    // doors open on the platform side: every open door is at a platform edge of the station the train stands at
    let wrong = 0, checked = 0;
    for (const t of sim.trains) {
      if (t.line !== l || t.state !== 'dwell' || t.doors !== 1 || t.station === undefined) continue;
      const sh = R.shapes.get(t.station), pts = P.railDraw.doorsOf(t);
      const near = (q) => (sh?.platforms ?? []).some((pl) => [pl.edge, ...(pl.twoFaced ? [pl.back] : [])].some((ln) => ln.some((e, i) => i && (() => { const A = ln[i - 1], B = e, dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((q.x - A.x) * dx + (q.z - A.z) * dz) / L2)); return Math.hypot(A.x + dx * u - q.x, A.z + dz * u - q.z) < 1.2; })())));
      for (const q of pts) { checked++; if (!near(q)) wrong++; }
    }
    return { doors, closed: c?.down ?? false, held, on, waitingCars, calls, red: sim.stats.redPassed, wrong, checked };
  }, line.id);
  doorsWrong += s.wrong; doorsChecked += s.checked;
  if (s.doors && !doorsSeen) await page.screenshot({ path: `${out}/rail-3-doors.png` });
  doorsSeen ||= s.doors;
  closedSeen ||= s.closed;
  if (s.held && s.on) onTrack++;
  if (s.waitingCars) carsHeld++;
  if (s.closed && i % 5 === 0) await page.screenshot({ path: `${out}/rail-4-crossing.png` });
  if (new Set(s.calls).size >= 2 && doorsSeen && closedSeen) { console.log('after', i + 1, 's', JSON.stringify(s)); break; }
  if (i === 179) { console.log('state', JSON.stringify(s)); fail('trains did not call at both stations, open their doors and shut the crossing'); }
  if (s.red) fail('a train passed a red signal');
}
if (onTrack) fail(`a car was on the level crossing while a train held its block (${onTrack} samples)`);
console.log('doors checked against the platform edges', doorsChecked, 'wrong side', doorsWrong);
if (!doorsChecked) fail('no open door was seen to check against a platform');
if (doorsWrong) fail(`${doorsWrong} open doors were not at a platform edge`);
await page.evaluate(() => window.proto.focusOn({ x: -480, z: 340 }, 120));
await wait(2500);
await page.screenshot({ path: `${out}/rail-5-station.png` });
// Transport > Railway lists the line
await page.tap('[data-bar="transport"]'); await wait(400);
await page.tap('[data-tab="rail"]').catch(() => {});
await wait(500);
const rows = await page.$$('[data-rline]');
if (rows.length < 1) fail(`Transport > Railway lists ${rows.length} lines`);
await page.screenshot({ path: `${out}/rail-6-transport.png` });
const perf = await page.evaluate(() => window.__perf);
console.log('perf', JSON.stringify({ frameMs: perf && perf.frameMs / Math.max(1, perf.frames), calls: perf?.calls }));
console.log('errors', JSON.stringify(errs));
if (errs.length) fail('console errors');
await browser.close();
