// Stations on a curve, on a viaduct and underground (docs/rail.md), played by touch on a
// phone-sized page. Three lines are laid round the 50 km region's start town (a gentle curve, one held up on a
// viaduct, one down in a deep tunnel under the town); a station is built on each from Build >
// Stops by tapping the track, the underground ones with the underground view on; a line is drawn
// between the two underground stations and its train calls at both with its doors open; the view
// fades out and back with nothing left over; and nothing is logged as an error.
// node e2e/stations.e2e.mjs [url] [shots dir]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/proto.html?map=region&seed=42';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const wait = (ms) => page.waitForTimeout(ms);
// wait for a camera move to finish (it takes longer while the underground view draws twice)
async function settle() {
  for (let i = 0; i < 60 && (await page.evaluate(() => !!window.proto.nav.anim)); i++) await wait(300);
  await wait(500);
}
await page.goto(url);
await page.waitForFunction(() => window.proto?.railway && window.proto?.underView, null, { timeout: 90000 });
await wait(2500);
await page.evaluate(() => { window.proto.setSpeed(0); window.proto.purse.balance = 30_000_000; }); // (underground stations cost a lot)

// the three lines, laid as the rail tool would (a curve of about 1,250 m radius; a viaduct 9 m up; a deep tunnel)
const laid = await page.evaluate(() => {
  const P = window.proto, net = P.net, out = {};
  const O = (o) => ({ height: 'auto', grade: 0.025, cross: 'bridge', spec: { max: 0.035, clear: 7.8, water: 7, under: 14, label: 'railway' }, type: 'rail-main', ...o });
  const lay = (k, a, b, c, o) => { const A = net.snapStart(a, 4, 'rail'), B = net.snapStart(b, 4, 'rail'), ch = net.check(A, B, c, O(o)); if (!ch.ok) { out[k] = ch.reason; return; } net.build(A, B, c, O(o)); out[k] = 'ok'; };
  lay('curve', { x: -800, z: 620 }, { x: 800, z: 620 }, { x: 0, z: 620 + 512 }, {});
  lay('viaduct', { x: -900, z: 480 }, { x: 900, z: 480 }, undefined, { limits: [{ s0: 500, s1: 1300, lo: 9, hi: 9, why: 'the viaduct' }] });
  lay('deep', { x: -1000, z: -60 }, { x: 1000, z: -60 }, undefined, { cross: 'tunnel', height: 'deep' });
  P.rebuild();
  return out;
});
console.log('laid', JSON.stringify(laid));
for (const [k, v] of Object.entries(laid)) if (v !== 'ok') fail(`the ${k} line couldn't be laid: ${v}`);

// Build > Stops > Railway station, then tap the track at (x, z) (at height y), a few metres to one side
async function buildStation(label, x, z, y = 0, side = 4) {
  await page.tap('[data-bar="build"]'); await wait(400);
  await page.tap('[data-tab="stops"]'); await wait(400);
  let hit = false;
  for (const c of await page.$$('[data-item]')) if ((await c.getAttribute('aria-label'))?.startsWith('Railway station')) { await c.tap(); hit = true; break; }
  if (!hit) { fail('no Railway station card'); return null; }
  await wait(500);
  await page.evaluate(({ x, z }) => window.proto.focusOn({ x, z }, 380), { x, z });
  await wait(600);
  await settle();
  const s = await page.evaluate(({ x, z, y, side }) => window.proto.toScreen({ x, y, z: z + side }), { x, z, y, side });
  await page.touchscreen.tap(s.x, s.y);
  await wait(1500);
  // the card has the quick picks and Build; More options opens the full plan, built from there
  await page.tap('#tpanel [data-more]').catch(() => {});
  await wait(800);
  const title = await page.textContent('#sheet h2').catch(() => '');
  const notes = await page.textContent('#sheet .plan').catch(() => '');
  await page.screenshot({ path: `${out}/stations-${label}-plan.png` });
  const btn = await page.$('#sheet [data-build]:not([disabled])');
  if (!btn) {
    const at = await page.evaluate(() => { const P = window.proto, t = P.railGame.tapAt, seg = t && P.net.segs.get(t.seg), q = seg && P.net.path(seg); return t && { s: Math.round(t.s), view: P.nav.view }; });
    fail(`no ${label} station can be built at x=${x} (tapped ${JSON.stringify(at)}): ${(await page.textContent('#sheet .bad').catch(() => ''))?.slice(0, 160)}`);
    return null;
  }
  const before = await page.evaluate(() => window.proto.railway.stations.length);
  await btn.tap();
  await wait(1500);
  const st = await page.evaluate((n) => { const R = window.proto.railway, s = R.stations[n]; return s ? { id: s.id, name: s.name, structure: s.structure ?? 'surface', x: Math.round(s.x), z: Math.round(s.z), radius: Math.round(R.shapes.get(s.id)?.radius ?? 0) } : null; }, before);
  console.log(label, JSON.stringify({ title, st }));
  return { ...st, title, notes };
}
const close = async () => { await page.tap('#sheet .close').catch(() => {}); await wait(300); };

// on the curve
const curved = await buildStation('curve', -450, 810);
if (!curved) fail('no station on the curve');
else {
  if (curved.structure !== 'surface') fail(`the curve's station is ${curved.structure}`);
  if (!(curved.radius > 1000 && curved.radius < 3000)) fail(`the curve's station isn't on the curve (radius ${curved.radius})`);
  if (!/curve/.test(curved.notes)) fail('the plan doesn’t say it’s on a curve');
}
await close();
// on the viaduct
const raised = await buildStation('viaduct', 30, 480);
if (!raised || raised.structure !== 'viaduct') fail(`no station on the viaduct (${raised?.structure})`);
else if (!/Viaduct station/.test(raised.title) || !/stairs and lifts/.test(raised.notes)) fail(`the viaduct station's plan says: ${raised.title} · ${raised.notes.slice(0, 120)}`);
await page.evaluate(({ x, z }) => window.proto.focusOn({ x, z }, 150), raised ?? { x: 30, z: 480 });
await wait(2500);
await page.screenshot({ path: `${out}/stations-viaduct.png` });
await close();

// underground: the view on, by its button; the stations built by tapping the track deep down
await page.tap('#ugbtn');
await wait(1200);
if ((await page.getAttribute('#ugbtn', 'aria-pressed')) !== 'true') fail('the underground view button isn’t lit');
if (!(await page.evaluate(() => window.proto.underView.on))) fail('the underground view didn’t come on');
const d1 = await buildStation('underground-1', 400, -60, -14, -4);
await close();
const d2 = await buildStation('underground-2', 650, -60, -14, -4); // (east of the start town, clear of its streets above: an underground station needs its entrances, and level track deep down)
for (const d of [d1, d2]) if (!d || d.structure !== 'underground') fail(`an underground station wasn't built (${d?.structure})`);
// the second's sheet is open: New line from here, tap the first, Create
let started = false;
for (const b of await page.$$('#sheet button')) if ((await b.textContent())?.includes('New line from here')) { await b.tap(); started = true; break; }
if (!started) fail('no New line from here on the station sheet');
await wait(600);
await page.evaluate(() => window.proto.focusOn({ x: 525, z: -60 }, 700));
await wait(600);
await settle();
if (d1) {
  const fp = await page.evaluate((id) => { const P = window.proto, sh = P.railway.shapes.get(id); return P.toScreen(sh.mid); }, d1.id);
  await page.touchscreen.tap(fp.x, fp.y);
  await wait(600);
}
await page.tap('#t-prim button');
await wait(1200);
const line = await page.evaluate(() => { const R = window.proto.railway, l = R.lines[R.lines.length - 1]; return l ? { id: l.id, stops: l.stops, trains: R.trainsOn(l).length, depot: l.depot ?? null } : null; });
console.log('line', JSON.stringify(line));
if (!line || !d1 || !d2 || line.stops.length !== 2 || !line.stops.includes(d1.id) || !line.stops.includes(d2.id)) fail('the line between the underground stations was not created');

// run: its train calls at both, doors open at the platform, deep down (with the view off: under
// SwiftShader it draws at half the frame rate, and the game's clock with it)
await page.tap('#ugbtn');
await page.evaluate(() => { window.proto.setSpeed(4); window.proto.focusOn({ x: 400, z: -60 }, 200); });
let doorsSeen = false;
// (up to 5 min: the region's two underground stations are 250 m apart, east of the start town and clear of its
// streets above, and SwiftShader draws the region at a couple of frames a second)
for (let i = 0; line && i < 300; i++) {
  await wait(1000);
  const s = await page.evaluate((lid) => {
    const R = window.proto.railway, sim = R.sim, l = R.lines.find((x) => x.id === lid);
    const t = sim.trains.find((x) => x.line === l), y = t ? sim.pose(t, 5).y : 0;
    return { doors: !!t && t.state === 'dwell' && t.doors === 1, y, calls: sim.log.filter((e) => e.line === lid).map((e) => e.station), red: sim.stats.redPassed };
  }, line.id);
  if (s.doors && !doorsSeen) {
    // (paused, with the view back on, to see it there)
    await page.evaluate(() => window.proto.setSpeed(0));
    await page.tap('#ugbtn');
    await wait(2500);
    await page.screenshot({ path: `${out}/stations-underground-doors.png` });
    if (s.y > -10) fail(`the train stood at ${s.y} m, not underground`);
    await page.tap('#ugbtn');
    await wait(1500);
    await page.evaluate(() => window.proto.setSpeed(4));
  }
  doorsSeen ||= s.doors;
  if (new Set(s.calls).size >= 2 && doorsSeen) { console.log('after', i + 1, 's', JSON.stringify(s)); break; }
  if (i === 299) { console.log('state', JSON.stringify(s)); fail('the train did not call at both underground stations with its doors open'); }
  if (s.red) fail('a train passed a red signal');
}
await page.evaluate(() => window.proto.setSpeed(0));
await page.tap('#ugbtn');
await page.evaluate(() => window.proto.focusOn({ x: 525, z: -60 }, 420));
await wait(1000);
await settle();
await page.screenshot({ path: `${out}/stations-underground-view.png` });
if (!(await page.evaluate(() => window.proto.underView.on))) fail('the underground view didn’t come back on');
// and back to the surface: the fade runs out and the ordinary picture is drawn again
await page.tap('#ugbtn');
for (let i = 0; i < 20 && (await page.evaluate(() => window.proto.underView.showing)); i++) await wait(300);
const back = await page.evaluate(() => ({ on: window.proto.underView.on, showing: window.proto.underView.showing, clip: window.proto.renderer.clippingPlanes.length }));
if (back.on || back.showing || back.clip) fail(`the underground view didn't go off: ${JSON.stringify(back)}`);
if ((await page.getAttribute('#ugbtn', 'aria-pressed')) !== 'false') fail('the underground view button is still lit');
await page.screenshot({ path: `${out}/stations-surface.png` });
console.log('errors', JSON.stringify(errs));
if (errs.length) fail('console errors');
await browser.close();
