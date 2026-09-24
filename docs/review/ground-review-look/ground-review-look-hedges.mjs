// Checks the main game's hedgerows against the world, in the browser (exits non-zero on failure):
//  - no hedge piece or hedgerow tree beyond the ground mesh (they'd float against the sky) or
//    beyond the painted cover map
//  - no hedge footprint on a road/rail claim, a plot, a park or the lake
//  - after the town grows (growAll), no hedge on a plot and no field cover left under a plot
// usage: node ground-review-look-hedges.mjs [port=4263]
import { chromium } from 'playwright-core';
const [port = '4263'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`http://127.0.0.1:${port}/proto.html`);
await page.waitForTimeout(10000);
const check = () => {
  const p = window.proto, gg = p.ground, G = gg.ground, inp = gg.input();
  const inPoly = (x, z, poly) => { let ins = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const P = poly[a], Q = poly[b]; if ((P.z > z) !== (Q.z > z) && x < ((Q.x - P.x) * (z - P.z)) / (Q.z - P.z) + P.x) ins = !ins; } return ins; };
  // the ground mesh's extent (a plane centred on the origin)
  let mesh = null;
  p.cam.parent; // (scene)
  const scene = (() => { let o = G.hedges; while (o.parent) o = o.parent; return o; })();
  scene.traverse((o) => { if (o.isMesh && o.material === G.material) mesh = o; });
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox; // plane in xy, rotated to xz
  const half = Math.max(bb.max.x, bb.max.y);
  const R = G.cover.region;
  const { pieces, trees } = G.hedgeList();
  const out = { half, region: [R.x0, R.x0 + R.size], pieces: pieces.length, trees: trees.length, offMesh: [], offMap: 0, onBlocked: [], onPlot: [], onPark: [], onWater: [], treeOffMesh: 0 };
  const polys = [['onBlocked', inp.blocked ?? []], ['onPlot', (inp.plots ?? []).map((q) => q.poly)], ['onPark', (inp.parks ?? []).map((q) => q.poly)], ['onWater', inp.water ?? []]];
  for (const pc of pieces) {
    const ux = Math.cos(pc.a), uz = Math.sin(pc.a);
    const pts = [];
    for (const s of [-0.5, -0.25, 0, 0.25, 0.5]) for (const t of [-0.5, 0, 0.5]) pts.push({ x: pc.x + ux * pc.len * s - uz * pc.w * t, z: pc.z + uz * pc.len * s + ux * pc.w * t });
    if (pts.some((q) => Math.abs(q.x) > half || Math.abs(q.z) > half)) out.offMesh.push([+pc.x.toFixed(1), +pc.z.toFixed(1)]);
    if (pts.some((q) => q.x < R.x0 || q.z < R.z0 || q.x > R.x0 + R.size || q.z > R.z0 + R.size)) out.offMap++;
    for (const [k, list] of polys) for (const poly of list) {
      const b = poly.reduce((a, q) => ({ x0: Math.min(a.x0, q.x), x1: Math.max(a.x1, q.x), z0: Math.min(a.z0, q.z), z1: Math.max(a.z1, q.z) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
      if (pc.x < b.x0 - 10 || pc.x > b.x1 + 10 || pc.z < b.z0 - 10 || pc.z > b.z1 + 10) continue;
      if (pts.some((q) => inPoly(q.x, q.z, poly))) { out[k].push([+pc.x.toFixed(1), +pc.z.toFixed(1)]); break; }
    }
  }
  for (const t of trees) if (Math.abs(t.x) > half - 4 || Math.abs(t.z) > half - 4) out.treeOffMesh++;
  // field cover left under plots
  const C = G.cover, n = C.region.n, tx = C.texel;
  let plotTex = 0, fieldUnder = 0;
  for (const pl of inp.plots ?? []) {
    if (pl.kind !== 'garden') continue;
    const b = pl.poly.reduce((a, q) => ({ x0: Math.min(a.x0, q.x), x1: Math.max(a.x1, q.x), z0: Math.min(a.z0, q.z), z1: Math.max(a.z1, q.z) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
    for (let x = b.x0 + 2; x < b.x1 - 2; x += tx) for (let z = b.z0 + 2; z < b.z1 - 2; z += tx) {
      if (!inPoly(x, z, pl.poly)) continue;
      const i = Math.floor((x - C.region.x0) / tx), j = Math.floor((z - C.region.z0) / tx);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      plotTex++;
      if (C.a[(j * n + i) * 4] > 140) fieldUnder++;
    }
  }
  out.plotTexels = plotTex; out.fieldUnderPlots = fieldUnder;
  for (const k of ['offMesh', 'onBlocked', 'onPlot', 'onPark', 'onWater']) { out[k + 'N'] = out[k].length; out[k] = out[k].slice(0, 6); }
  return out;
};
const before = await page.evaluate(check);
console.log('start', JSON.stringify(before));
await page.evaluate(() => { window.proto.growAll(); });
await page.waitForTimeout(4000);
const after = await page.evaluate(check);
console.log('grown', JSON.stringify(after));
await browser.close();
const fails = [];
for (const [w, r] of [['start', before], ['grown', after]]) {
  if (r.offMeshN) fails.push(`${w}: ${r.offMeshN} hedge pieces beyond the ground mesh (±${r.half} m), e.g. ${JSON.stringify(r.offMesh)}`);
  if (r.treeOffMesh) fails.push(`${w}: ${r.treeOffMesh} hedgerow trees at the ground mesh's edge`);
  for (const k of ['onBlocked', 'onPlot', 'onPark', 'onWater']) if (r[k + 'N']) fails.push(`${w}: ${r[k + 'N']} hedge pieces ${k}, e.g. ${JSON.stringify(r[k])}`);
  if (r.fieldUnderPlots) fails.push(`${w}: ${r.fieldUnderPlots}/${r.plotTexels} garden texels still field`);
}
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log('PASS');
