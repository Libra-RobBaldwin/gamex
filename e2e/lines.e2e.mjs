// The loop's first milestone (docs/loop.md, M1), played by touch on a phone-sized page: draw a
// three-stop line, watch its buses call at those stops only and in order, tap a bus for its sheet.
// node e2e/lines.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/proto.html?map=region&seed=42';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
await page.goto(url);
await page.waitForFunction(() => window.proto?.lines, null, { timeout: 60000 });
await page.waitForTimeout(4000);
const frameMs = () => page.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const f = (n) => { t.push(n - last); last = n; if (t.length < 90) requestAnimationFrame(f); else res(t.sort((a, b) => a - b)[45]); }; requestAnimationFrame(f); }));
console.log('median frame ms (before)', (await frameMs()).toFixed(1));
await page.screenshot({ path: `${out}/m1-0-start.png` });

// nothing to start with: no stops and no lines; place three stops (as the stop tool does)
const none = await page.evaluate(() => ({ lines: window.proto.lines.list.length, stops: [...window.proto.net.segs.values()].reduce((a, s) => a + s.stops.length, 0) }));
if (none.lines || none.stops) fail('the game starts with stops or lines already built');
await page.evaluate(() => {
  const P = window.proto, net = P.net;
  for (const q of [{ x: -80, z: -50 }, { x: -110, z: 30 }, { x: 60, z: 100 }]) {
    const n = net.nearestSeg(q, 80, (s) => net.def(s).cls === 'road' && net.def(s).family !== 'Motorway' && net.def(s).family !== 'Rural');
    if (n) for (const side of [1, -1]) for (const d of [0, 15, -15, 30, -30]) { const { plans } = net.planStop(n.seg.id, n.s + d, side); const pl = plans.find((x) => x.ok && x.kind === 'kerb') ?? plans.find((x) => x.ok); if (pl) { net.addStop(n.seg.id, n.s + d, side, pl); break; } }
  }
  P.rebuild();
});
// Transport > Lines: empty, with New line ready
await page.tap('[data-bar="transport"]');
await page.waitForTimeout(400);
const tabs = await page.$$('[data-tab]');
for (const t of tabs) if ((await t.textContent()).includes('Lines')) await t.tap();
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/m1-1-lines.png` });
if (await page.$('[data-line="0"]')) fail('a line is listed before one was drawn');

// (on a slow machine, SwiftShader draws a frame or two a second: wait for the camera to stop
// moving before working out where to tap, and for each tap to take, rather than for fixed times;
// each look is after a frame is drawn, so a camera that hasn't started moving yet isn't taken as settled)
async function settle(p = { x: 0, z: 0 }) {
  let last = null;
  for (let i = 0; i < 60; i++) {
    const s = await page.evaluate((p) => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res(window.proto.toScreen(p))))), p);
    if (last && Math.hypot(s.x - last.x, s.y - last.y) < 0.5) return;
    last = s; await page.waitForTimeout(400);
  }
}
const drafted = () => page.evaluate(() => document.querySelector('#tpanel')?.textContent ?? '');

// New line: frame the town, tap three stop badges
await page.tap('[data-newline]');
await page.waitForTimeout(1000);
await settle();
// (the tool frames every stop itself: each badge inside the part of the screen the chrome leaves clear, above the hint)
{
  const out = await page.evaluate(() => {
    const P = window.proto, c = P.shell.clearRect(), h = document.querySelector('#hint'), hb = h && !h.hidden ? h.getBoundingClientRect().top : c.bottom;
    return P.markers.places().map((m) => ({ id: m.id, ...P.toScreen(m.p) })).filter((s) => s.x < c.left + 20 || s.x > c.right - 20 || s.y < c.top + 20 || s.y > hb - 20).map((s) => `${s.id} at ${Math.round(s.x)},${Math.round(s.y)}`);
  });
  if (out.length) fail(`New line should frame every stop clear of the chrome and the hint: ${out.join('; ')}`);
  else console.log('New line frames every stop clear of the chrome and the hint');
}
const targets = [{ x: -80, z: -50 }, { x: -110, z: 30 }, { x: 60, z: 100 }];
const pickOf = (q) => page.evaluate((q) => {
  const P = window.proto, places = P.markers.places();
  const b = places.map((m) => ({ m, d: Math.hypot(m.p.x - q.x, m.p.z - q.z) })).sort((a, b) => a.d - b.d)[0].m, s = P.toScreen(b.p);
  return { id: b.id, x: s.x, y: s.y };
}, q);
for (const [i, q] of targets.entries()) {
  // (tapped until the line takes it, twice at most: a tap can land between frames)
  for (let tries = 0; tries < 2; tries++) {
    const p = await pickOf(q);
    if (p.x < 10 || p.x > 402 || p.y < 110 || p.y > 760) { fail(`stop ${p.id} is off screen at ${Math.round(p.x)},${Math.round(p.y)}`); break; }
    await page.touchscreen.tap(p.x, p.y);
    const took = await page.waitForFunction((n) => (document.querySelector('#tpanel')?.textContent ?? '').includes(`${n} `), i + 1, { timeout: 10000 }).then(() => true, () => false);
    if (took) break;
    await settle();
  }
}
await page.screenshot({ path: `${out}/m1-2-drawing.png` });
const draft = await drafted();
console.log('drafted:', draft.trim());
if (!/1.*2.*3/.test(draft)) fail('three stops were not all picked');
await page.tap('#t-prim button');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/m1-3-line-sheet.png` });
const line = await page.evaluate(() => { const L = window.proto.lines.list; const l = L[L.length - 1]; return { id: l.id, stops: l.stops, seq: l.bus.seq, buses: window.proto.lines.buses(l) }; });
console.log('new line', JSON.stringify(line));

// a third bus, which starts close behind one of the two (the line spreads new buses by the golden
// ratio: 0, 0.62, 0.24 of the way round), so the even-gaps rule has something to do
const third = await page.evaluate(() => { const L = window.proto.lines.list, l = L[L.length - 1]; const c = window.proto.lines.addBus(l); return c ? c.id : null; });
if (third === null) fail('a third bus could not be added'); else line.buses.push(third);
const gapsAt = () => page.evaluate((id) => { const sp = window.proto.traffic.spacing(id); return { min: sp.buses.length ? Math.min(...sp.buses.map((b) => b.ahead)) : 0, at: sp.buses.map((b) => +b.at.toFixed(2)), holds: window.proto.traffic.stats.holds }; }, line.id);
const gap0 = await gapsAt();
console.log('gaps round the loop at the start', JSON.stringify(gap0));
// run the clock at 4x and log every call
await page.evaluate(() => {
  const T = window.proto.traffic, orig = T.onBusStop;
  window.__calls = [];
  T.onBusStop = (seg, st, bus) => { window.__calls.push([bus, st.id]); return orig(seg, st, bus); };
  window.proto.setSpeed(4);
});
await page.tap('.close').catch(() => {});
// until every bus on it has made three calls (SwiftShader runs a few frames a second), or 4 minutes
await page.waitForFunction((ids) => ids.every((id) => window.__calls.filter(([b]) => b === id).length >= 3), line.buses, { timeout: 240000, polling: 2000 }).catch(() => {});
// even gaps: the rule engaged (a bus held at a stop for the one ahead to get away), and the
// smallest gap between buses is no worse than where the third bus started. (A few sim minutes
// on SwiftShader is too little to measure headways settling; traffic.spacing.test.ts does that
// over twenty minutes: bunched buses end up calling at intervals within 30% of even.)
const gap1 = await gapsAt();
console.log('gaps round the loop at the end', JSON.stringify(gap1));
if (gap1.holds === 0) fail('no bus held at a stop to even the gaps');
if (gap1.min < gap0.min - 0.05) fail(`the smallest gap round the loop closed up: ${gap0.min.toFixed(2)} -> ${gap1.min.toFixed(2)}`);
const res = await page.evaluate((line) => {
  const P = window.proto, placeOf = (id) => line.stops.findIndex((k) => P.traffic.place(k)?.stops.some((s) => s.id === id));
  const by = {};
  for (const [bus, st] of window.__calls) if (line.buses.includes(bus)) (by[bus] ??= []).push(placeOf(st));
  return by;
}, line);
console.log('calls by the new line\'s buses (place index):', JSON.stringify(res));
const order = line.seq.map((k) => line.stops.indexOf(k));
let calls = 0;
for (const [bus, seq] of Object.entries(res)) {
  calls += seq.length;
  if (seq.some((k) => k < 0)) fail(`bus ${bus} called at a stop not on its line`);
  const st = order.indexOf(seq[0]);
  seq.forEach((k, i) => { if (k !== order[(st + i) % order.length]) fail(`bus ${bus} call ${i} out of order: ${seq}`); });
}
// (SwiftShader runs a few frames a second: at least one call each here; game/lines.test.ts checks many)
if (calls < line.buses.length) fail(`only ${calls} calls`);

// tap one of its buses
await page.evaluate(() => window.proto.setSpeed(0));
const bus = await page.evaluate((ids) => { const P = window.proto; for (const id of ids) { const b = P.traffic.bus(id); if (b) { P.focusOn({ x: b.x, z: b.z }, 90); return id; } } return null; }, line.buses);
await page.waitForTimeout(1000);
for (let tries = 0; tries < 2; tries++) {
  await settle(await page.evaluate((id) => { const b = window.proto.traffic.bus(id); return { x: b.x, z: b.z }; }, bus));
  const at = await page.evaluate((id) => { const P = window.proto, b = P.traffic.bus(id); return P.toScreen({ x: b.x, z: b.z, y: 1.5 }); }, bus);
  await page.touchscreen.tap(at.x, at.y);
  if (await page.waitForFunction(() => (document.querySelector('#sheet h2')?.textContent ?? '').startsWith('Bus'), null, { timeout: 10000 }).then(() => true, () => false)) break;
}
await page.screenshot({ path: `${out}/m1-4-bus-sheet.png` });
const title = await page.evaluate(() => document.querySelector('#sheet h2')?.textContent ?? '');
console.log('sheet after tapping a bus:', title);
if (!title.startsWith('Bus')) fail('tapping a bus did not open its sheet');
await page.tap('.close').catch(() => {});

// tap a building: its sheet names it and says what it's used for (on the region's hills the chunks
// are drawn lifted by the ground, and the tap has to find them where they're drawn)
await page.evaluate(() => window.proto.focusOn({ x: 0, z: 0 }, 110));
await page.waitForTimeout(1000);
await settle();
const spot = await page.evaluate(() => {
  const P = window.proto;
  // (clear of junctions, which a tap inspects first)
  const nearJunction = (g) => [...P.junctions.values()].some((j) => { const n = P.net.node(j.node); return Math.hypot(n.x - g.x, n.z - g.z) < Math.max(10, j.R, P.net.nodeHalf(j.node)) + 2; });
  for (let y = 160; y < 720; y += 40) for (let x = 40; x < 380; x += 40) { const b = P.pickBuilding(x, y); if (b && !b.region && !nearJunction(P.groundAt(x, y))) return { x, y, name: b.name }; }
  return null;
});
console.log('a building under the finger:', JSON.stringify(spot));
if (!spot) fail('no building can be picked in the town centre');
else {
  await page.touchscreen.tap(spot.x, spot.y);
  const opened = await page.waitForFunction((n) => (document.querySelector('#sheet h2')?.textContent ?? '') === n && /Use/.test(document.querySelector('#sheet')?.textContent ?? ''), spot.name, { timeout: 10000 }).then(() => true, () => false);
  await page.screenshot({ path: `${out}/m1-5-building-sheet.png` });
  if (!opened) fail(`tapping a building did not open its sheet (${await page.evaluate(() => document.querySelector('#sheet h2')?.textContent ?? '')})`);
  await page.tap('.close').catch(() => {});
}
await page.evaluate(() => window.proto.setSpeed(1));
console.log('median frame ms (after)', (await frameMs()).toFixed(1));
console.log('errors', JSON.stringify(errs));
if (errs.length) fail('console errors');
await browser.close();
