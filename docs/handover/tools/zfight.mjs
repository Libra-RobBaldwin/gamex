// Find z-fighting: upward-facing triangles of different materials (or overlapping ones) at the
// same height whose footprints overlap, in every building in the town.
import { chromium } from 'playwright-core';
const port = process.argv[2] || 4190;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://localhost:${port}/proto.html`);
await page.waitForTimeout(3500);
await page.evaluate(() => window.proto.growAll());
const res = await page.evaluate(() => {
  const out = [], byName = new Map();
  const triArea = (a, b, c) => Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
  for (const b of window.proto.buildings) {
    const tris = [];
    b.parts.forEach((p, pi) => {
      const pos = p.g.attributes.position.array, idx = p.g.index?.array;
      const n = idx ? idx.length : pos.length / 3;
      const V = (i) => { const k = (idx ? idx[i] : i) * 3; return [pos[k], pos[k + 1], pos[k + 2]]; };
      for (let i = 0; i + 2 < n; i += 3) {
        const a = V(i), c = V(i + 1), d = V(i + 2);
        if (Math.abs(a[1] - c[1]) > 1e-3 || Math.abs(a[1] - d[1]) > 1e-3) continue; // horizontal only
        // facing up?
        const ny = (c[2] - a[2]) * (d[0] - a[0]) - (c[0] - a[0]) * (d[2] - a[2]);
        if (ny <= 0 || triArea(a, c, d) < 0.05) continue;
        tris.push({ y: a[1], pi, pts: [a, c, d], box: [Math.min(a[0], c[0], d[0]), Math.min(a[2], c[2], d[2]), Math.max(a[0], c[0], d[0]), Math.max(a[2], c[2], d[2])] });
      }
    });
    // overlap test between triangles at the same height from DIFFERENT parts (materials), or same part overlapping
    const inside = (p, t) => { const [a, b, c] = t; const s = (u, v, w) => (v[0] - u[0]) * (w[2] - u[2]) - (w[0] - u[0]) * (v[2] - u[2]); const d1 = s(a, b, p), d2 = s(b, c, p), d3 = s(c, a, p); return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6)); };
    let hits = 0, example = null;
    for (let i = 0; i < tris.length && hits < 50; i++) for (let j = i + 1; j < tris.length; j++) {
      const A = tris[i], B = tris[j];
      if (Math.abs(A.y - B.y) > 0.004) continue;
      if (A.box[2] <= B.box[0] + 0.05 || B.box[2] <= A.box[0] + 0.05 || A.box[3] <= B.box[1] + 0.05 || B.box[3] <= A.box[1] + 0.05) continue;
      // a sample point strictly inside both (centroid of A, and of B)
      const cA = [0, 1, 2].map((k) => (A.pts[0][k] + A.pts[1][k] + A.pts[2][k]) / 3), cB = [0, 1, 2].map((k) => (B.pts[0][k] + B.pts[1][k] + B.pts[2][k]) / 3);
      if ((inside(cA, B.pts) || inside(cB, A.pts))) { hits++; if (!example) example = { y: +A.y.toFixed(2), mats: [b.parts[A.pi].m.color?.getHexString?.(), b.parts[B.pi].m.color?.getHexString?.()], samePart: A.pi === B.pi }; }
    }
    if (hits) { const k = b.name.split(' · ')[0]; byName.set(k, (byName.get(k) || 0) + 1); out.push({ name: b.name, detail: b.detail, at: [Math.round(b.lot.x), Math.round(b.lot.z)], hits, example }); }
  }
  return { buildings: window.proto.buildings.length, bad: out.length, byName: [...byName.entries()], sample: out.slice(0, 12) };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
