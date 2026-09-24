// The loop's rail milestone (docs/loop.md, M4), played by touch on a phone-sized page: build two
// stations on the main line with the station tool, draw a rail line between them, and watch its
// train call at both platforms and turn round; the economy counts the stations and the line.
// node e2e/rail.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/?map=town';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
await page.goto(url);
await page.waitForFunction(() => window.proto?.stations, null, { timeout: 60000 });
await page.waitForTimeout(3000);

// two places on the main line where platforms fit, well apart
const spots = await page.evaluate(() => {
  const P = window.proto, ok = [];
  for (const x of [-200, 200, -150, 150, -250, 250]) { const pl = P.stations.plan({ x, z: 185 }); if (pl.ok && !ok.some((o) => Math.abs(o.x - pl.x) < 250)) ok.push({ x: pl.x, z: pl.z }); }
  return ok;
});
console.log('station spots', JSON.stringify(spots));
if (spots.length < 2) fail('no two places for stations on the main line');
// (rail costs more than a new game starts with: it's what bus profits buy; top the bank up)
await page.evaluate(() => { window.proto.purse.balance += 1_000_000; });
const bal0 = await page.evaluate(() => window.proto.purse.balance);
for (const sp of spots.slice(0, 2)) {
  await page.evaluate(() => window.proto.startStationTool());
  await page.evaluate((sp) => window.proto.focusOn(sp, 160), sp);
  await page.waitForTimeout(3500); // (a tap while the camera is still flying only stops it)
  const at = await page.evaluate((sp) => window.proto.toScreen(sp), sp);
  await page.touchscreen.tap(at.x, at.y);
  await page.waitForTimeout(1200);
  // (the very first tap can go to dismissing the first-run hint)
  if (!(await page.$('[data-build]'))) { await page.screenshot({ path: `${out}/rail-0-miss.png` }); console.log('missed; sheet:', await page.evaluate(() => document.querySelector('#sheet h2')?.textContent), 'mode', await page.evaluate(() => document.body.dataset.mode)); await page.touchscreen.tap(at.x, at.y); await page.waitForTimeout(1200); }
  await page.screenshot({ path: `${out}/rail-0-plan.png` });
  const btn = await page.$('[data-build]');
  if (!btn) { fail(`no Build button for the station at ${sp.x}`); continue; }
  await btn.tap();
  await page.waitForTimeout(600);
  await page.tap('#t-cancel').catch(() => {});
  await page.waitForTimeout(300);
}
const built = await page.evaluate(() => window.proto.stations.list.map((s) => ({ id: s.id, name: s.name, x: Math.round(s.x) })));
console.log('stations', JSON.stringify(built));
if (built.length < 2) fail('stations were not built');
const bal1 = await page.evaluate(() => window.proto.purse.balance);
if (!(bal1 < bal0)) fail('stations cost nothing');

// a close look at a platform, for flicker
await page.evaluate((st) => window.proto.focusOn({ x: st.x, z: 185 }, 45), built[0]);
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/rail-1-platform.png` });

// the line, by touch on the two station badges
await page.evaluate(() => { window.proto.startLineTool(); window.proto.focusOn({ x: 0, z: 185 }, 700); });
await page.waitForTimeout(2500);
const taps = await page.evaluate((ids) => ids.map((id) => { const P = window.proto, m = P.markers.stationPlaces().find((x) => x.id === id); return P.toScreen(m.p); }), built.slice(0, 2).map((b) => b.id));
for (const t of taps) { await page.touchscreen.tap(t.x, t.y); await page.waitForTimeout(400); }
await page.screenshot({ path: `${out}/rail-2-drawing.png` });
await page.tap('#t-prim button'); await page.waitForTimeout(1500);
const line = await page.evaluate(() => { const P = window.proto, l = P.lines.list.find((x) => x.mode === 'rail'); return l ? { id: l.id, stops: l.stops, trains: P.lines.buses(l) } : null; });
console.log('rail line', JSON.stringify(line));
if (!line || !line.trains.length) fail('no rail line with a train');
await page.screenshot({ path: `${out}/rail-3-line.png` });

// its train calls at both stations (run the clock; the platform stops are logged)
await page.evaluate(() => { const T = window.proto.traffic, orig = T.onTrainStop; window.__tcalls = []; T.onTrainStop = (st, tr) => { window.__tcalls.push(st); return orig(st, tr); }; window.proto.setSpeed(4); });
await page.tap('#sheet .close').catch(() => {});
await page.waitForFunction(() => new Set(window.__tcalls).size >= 2 && window.__tcalls.length >= 3, null, { timeout: 240000, polling: 2000 }).catch(() => {});
const calls = await page.evaluate(() => window.__tcalls);
console.log('train calls', JSON.stringify(calls));
if (new Set(calls).size < 2) fail('the train did not call at both stations');
for (let i = 1; i < calls.length; i++) if (calls[i] === calls[i - 1]) fail(`called twice running at ${calls[i]}`);
const econ = await page.evaluate((id) => { const T = window.proto.town; T.sync(); const s = T.econ.lineStats().find((x) => x.id === id); return s ? { ok: s.ok, vehicle: s.vehicle, problem: s.problem } : null; }, line?.id);
console.log('economy line', JSON.stringify(econ));
if (!econ?.ok) fail('the economy does not run the rail line');
await page.evaluate(() => window.proto.setSpeed(1));
console.log('errors', JSON.stringify(errs));
if (errs.length) fail('console errors');
await browser.close();
