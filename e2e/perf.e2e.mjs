// Performance on a phone-sized page (docs/region.md R4): start-up time, frame time and draw calls
// on each quality tier, over the busiest zoomed-out view and zoomed in over the centre.
// node e2e/perf.e2e.mjs [base url] [maps, comma separated] [tiers, comma separated] [out.json]
// e.g. node e2e/perf.e2e.mjs http://localhost:4173/ town,region 0,2,4
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173/';
const maps = (process.argv[3] ?? 'town,region').split(',');
const tiers = (process.argv[4] ?? '0,1,2,3,4').split(',').map(Number);
const outFile = process.argv[5];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = [];
for (const map of maps) {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`${base}?map=${map}`);
  // (start-up: from navigation to the loading screen going, which is when the first frame is drawn)
  await page.waitForFunction(() => document.querySelector('.loading.gone'), null, { timeout: 300000, polling: 50 });
  const start = await page.evaluate(() => ({ ms: Math.round(performance.now()), stages: window.proto.loading.times.map((t) => `${t.label}: ${Math.round(t.ms)}`) }));
  await page.waitForFunction(() => window.__perf, null, { timeout: 300000 });
  const wall = Date.now() - t0;
  // (views: the whole map from as far out as the camera goes, and close over the busiest centre)
  const views = await page.evaluate(() => {
    const P = window.proto, lim = P.nav.limits ?? {}, s = [...(P.map.settlements ?? [])].sort((a, b) => b.r - a.r)[0];
    const c = s ? { x: s.centre?.x ?? s.x ?? 0, z: s.centre?.z ?? s.z ?? 0 } : { x: 0, z: 0 };
    return { out: { x: 0, z: 0, h: lim.hMax ?? 900 }, wide: { ...c, h: 900 }, near: { ...c, h: 220 } };
  });
  for (const [name, v] of Object.entries(views)) {
    await page.evaluate((v) => { const P = window.proto; P.nav.animateTo({ ...P.view, x: v.x, z: v.z, h: v.h }); }, v);
    for (const t of tiers) {
      await page.evaluate((t) => window.proto.quality(t), t);
      await page.waitForTimeout(2500);
      // three 2 s windows
      const samples = [];
      for (let k = 0; k < 3; k++) {
        await page.waitForFunction((prev) => window.__perf && window.__perf.since !== prev, await page.evaluate(() => window.__perf.since), { timeout: 60000 });
        samples.push(await page.evaluate(() => ({ ...window.__perf })));
      }
      const avg = (f) => samples.reduce((a, s) => a + f(s), 0) / samples.length;
      const r = { map, view: name, tier: samples[0].tier, frameMs: +avg((s) => s.frameMs / Math.max(1, s.frames)).toFixed(1), simMs: +avg((s) => s.simMs / Math.max(1, s.frames)).toFixed(1), drawMs: +avg((s) => s.drawMs / Math.max(1, s.frames)).toFixed(1), worst: Math.round(Math.max(...samples.map((s) => s.worst))), calls: Math.round(avg((s) => s.calls)), ktris: Math.round(avg((s) => s.tris) / 1000) };
      console.log(JSON.stringify(r));
      results.push(r);
    }
  }
  // an edit: a street drawn off one near the centre, built as the road tool builds it (the call's own
  // time), and the worst frame in the few seconds after (the town catching up: buildings, infill)
  const edit = await page.evaluate(async (v) => {
    const P = window.proto, net = P.net;
    let best = null, bd = Infinity;
    for (const s of net.segs.values()) {
      if (net.def(s).cls !== 'road' || net.def(s).family === 'Motorway') continue;
      const p = net.path(s), m = p[Math.floor(p.length / 2)], a = p[0], b = p[p.length - 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 60) continue;
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, d = Math.hypot(mid.x - v.x, mid.z - v.z);
      if (d < bd) { bd = d; best = { mid, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L }; }
    }
    const a = best.mid, b = { x: a.x - best.uz * 140, z: a.z + best.ux * 140 };
    await new Promise((r) => requestAnimationFrame(r));
    const t0 = performance.now();
    const made = P.buildRoad(a, b, 'street');
    const ms = performance.now() - t0;
    // the frames after it
    let worst = 0, last = performance.now();
    const until = last + 4000;
    await new Promise((res) => { const f = () => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; if (now < until) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { ms: Math.round(ms), made: made.length, worstAfter: Math.round(worst) };
  }, views.near);
  console.log(map, 'edit', JSON.stringify(edit));
  results.push({ map, edit });
  results.push({ map, startMs: start.ms, wallMs: wall, stages: start.stages, errors: errs.slice(0, 5) });
  console.log(map, 'start', start.ms, 'ms (wall', wall, ')', errs.length ? `errors: ${errs.slice(0, 3).join(' | ')}` : 'no errors');
  console.log('  ' + start.stages.join('\n  '));
  await page.close();
}
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 1));
await browser.close();
