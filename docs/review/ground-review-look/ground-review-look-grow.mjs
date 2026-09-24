// The town grows onto a field: build a street from the town's west edge out into the arable land,
// let the plots along it be built (naturally for a while, then all at once), and check that the
// field and its hedges give way: no hedge on or hard against a new plot, no crop under gardens,
// no hedge left standing between two town parcels. Screenshots before/after.
// usage: node ground-review-look-grow.mjs [port=4263]   (exits non-zero on failure)
import { chromium } from 'playwright-core';
const [port = '4263'] = process.argv.slice(2);
const SP = new URL('..', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/proto.html`);
await page.waitForTimeout(10000);
const view = async (x, z, h) => { await page.evaluate(([x, z, h]) => { const v = window.proto.view; v.x = x; v.z = z; v.h = h; window.proto.setTier(0); }, [x, z, h]); await page.waitForTimeout(3000); };
await view(-280, 215, 200);
await page.screenshot({ path: `${SP}/ground/review-look-grow-0.png` });
const built = await page.evaluate(() => { const p = window.proto; const r = p.buildRoad({ x: -215, z: 150 }, { x: -330, z: 262 }, 'street'); return { r: String(r), segs: p.net.segs.size }; });
console.log('built', JSON.stringify(built));
await page.evaluate(() => window.proto.setSpeed?.(4));
await page.waitForTimeout(12000); // some plots go up on their own
await view(-280, 215, 200);
await page.screenshot({ path: `${SP}/ground/review-look-grow-1.png` });
await page.evaluate(() => window.proto.growAll());
await page.waitForTimeout(3000);
await view(-280, 215, 200);
await page.screenshot({ path: `${SP}/ground/review-look-grow-2.png` });
await view(-280, 215, 60);
await page.screenshot({ path: `${SP}/ground/review-look-grow-3.png` });
const r = await page.evaluate(() => {
  const p = window.proto, G = p.ground.ground, inp = p.ground.input(), L = G.layout;
  const inPoly = (x, z, poly) => { let ins = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const P = poly[a], Q = poly[b]; if ((P.z > z) !== (Q.z > z) && x < ((Q.x - P.x) * (z - P.z)) / (Q.z - P.z) + P.x) ins = !ins; } return ins; };
  const near = (pc) => Math.hypot(pc.x + 280, pc.z - 215) < 160;
  const plots = (inp.plots ?? []).filter((q) => q.poly.some((v) => Math.hypot(v.x + 280, v.z - 215) < 160));
  const { pieces } = G.hedgeList();
  const h = { id: 0, cell: L.parcels.cell(0, 0), edge: 0 };
  let onPlot = 0, townTown = 0, total = 0;
  for (const pc of pieces) {
    if (!near(pc)) continue;
    total++;
    if (plots.some((q) => inPoly(pc.x, pc.z, q.poly))) onPlot++;
    const nx = -Math.sin(pc.a) * 4, nz = Math.cos(pc.a) * 4;
    L.parcels.hit(pc.x + nx, pc.z + nz, h); const a = L.about(h).kind;
    L.parcels.hit(pc.x - nx, pc.z - nz, h); const b = L.about(h).kind;
    if (a === 'town' && b === 'town') townTown++;
  }
  const C = G.cover, n = C.region.n, t = C.texel;
  let tex = 0, crop = 0;
  for (const q of plots) {
    if (q.kind !== 'garden') continue;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const v of q.poly) { x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z); }
    for (let x = x0 + 1; x < x1 - 1; x += t) for (let z = z0 + 1; z < z1 - 1; z += t) {
      if (!inPoly(x, z, q.poly)) continue;
      const i = Math.floor((x - C.region.x0) / t), j = Math.floor((z - C.region.z0) / t);
      tex++; if (C.a[(j * n + i) * 4] > 140) crop++;
    }
  }
  return { plots: plots.length, hedgesNear: total, onPlot, townTown, gardenTexels: tex, cropUnderGardens: crop };
});
console.log(JSON.stringify(r), 'errors', JSON.stringify(errs));
await browser.close();
const fails = [];
if (!r.plots) fails.push('no plots were laid along the new street (test setup)');
if (r.onPlot) fails.push(`${r.onPlot} hedge pieces on new plots`);
if (r.townTown) fails.push(`${r.townTown} hedge pieces left between two town parcels`);
if (r.cropUnderGardens) fails.push(`${r.cropUnderGardens}/${r.gardenTexels} garden texels still crop`);
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS');
