#!/usr/bin/env node
// How real places are put together, from the baked regions (public/regions/*), for the seeded
// generator's town layout (docs/briefs/realism.md, region/priors.ts PRIORS.towns). For every city, town
// and village: its radials (the ways out that, followed in, reach the middle), the streets that branch
// off the radials inside the place (T-junctions and closes: how often, how long, how many are closes),
// how ragged the built-up edge is (how far it reaches along the radials against between them), and
// the place's shape (elongated along a road, or round). Prints a JSON summary; --out writes it all.
//
//   node --experimental-transform-types --no-warnings --import ./tools/os/ts-register.mjs tools/os/towns.mjs [exe teme …] [--out report.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTile, tileFile, ROAD_CLASSES } from '../../src/proto/real/format.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : null; };
const OUT = take('--out');
const ids = args.length ? args : readdirSync(join(ROOT, 'public/regions'));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const qs = (a) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => Math.round(q(a, p) * 100) / 100);
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const deg = (r) => (r * 180) / Math.PI;
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const MAIN = new Set(['motorway', 'primary', 'a', 'b', 'minor']);
const C = 100;

function measure(id) {
  const dir = join(ROOT, 'public/regions', id), M = JSON.parse(readFileSync(join(dir, 'region.json'), 'utf8'));
  const tiles = [];
  for (let j = 0; j < M.n; j++) for (let i = 0; i < M.n; i++) tiles.push(decodeTile(new Uint8Array(readFileSync(join(dir, tileFile(i, j))))));
  const all = (k) => tiles.flatMap((t) => t.layers[k] ?? []);
  const cells = new Map(), blds = [];
  for (const f of all('buildings')) { const a = f.parts[0]; let x = 0, z = 0, n = 0; for (let k = 0; k < a.length; k += 2) { x += a[k]; z += a[k + 1]; n++; } x /= n; z /= n; blds.push([x, z]); const key = `${Math.floor(x / C)},${Math.floor(z / C)}`; (cells.get(key) ?? cells.set(key, []).get(key)).push([x, z, blds.length - 1]); }
  const builtUp = (x, z, r = 150, need = 4) => { let n = 0; const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [bx, bz] of cells.get(`${i},${j}`) ?? []) if (Math.hypot(bx - x, bz - z) < r && ++n >= need) return true; return false; };
  // every road, including the streets (local); the graph by shared end points
  const roads = all('roads').map((f) => ({ cls: ROAD_CLASSES[f.c & 15], a: f.parts[0] })).filter((r) => r.cls !== 'restricted' && r.cls !== 'access' && r.cls !== 'shared' && r.a.length >= 4);
  const key = (x, z) => `${Math.round(x)},${Math.round(z)}`;
  const at = new Map();
  roads.forEach((r, i) => { r.id = i; r.L = 0; for (let k = 2; k < r.a.length; k += 2) r.L += Math.hypot(r.a[k] - r.a[k - 2], r.a[k + 1] - r.a[k - 1]); for (const end of [0, 1]) { const k = end ? key(r.a[r.a.length - 2], r.a[r.a.length - 1]) : key(r.a[0], r.a[1]); (at.get(k) ?? at.set(k, []).get(k)).push({ road: r, end }); } });
  const pts = (r, fromEnd) => { const p = []; for (let k = 0; k < r.a.length; k += 2) p.push({ x: r.a[k], z: r.a[k + 1] }); return fromEnd ? p.reverse() : p; };
  const degreeAt = (p) => (at.get(key(p.x, p.z)) ?? []).length;
  // the straightest continuation on from a road's end
  const onward = (r, e) => { const p = pts(r, e === 1)[0], here = at.get(key(p.x, p.z)) ?? [], prev = pts(r, e === 0), hx = prev[prev.length - 1].x - prev[prev.length - 2].x, hz = prev[prev.length - 1].z - prev[prev.length - 2].z, hl = Math.hypot(hx, hz) || 1; let best = null, bd = -0.3; for (const n of here) { if (n.road === r) continue; const np = pts(n.road, n.end === 1), dx = np[1].x - np[0].x, dz = np[1].z - np[0].z, dl = Math.hypot(dx, dz) || 1; const s = (hx * dx + hz * dz) / (hl * dl) + (MAIN.has(n.road.cls) ? 0.15 : 0); if (s > bd) { bd = s; best = n; } } return best; };
  // walk on `far` metres from a road's end: the points and the roads passed
  function walk(road, end, far) { let r = road, e = end, run = 0; const out = [pts(r, e === 1)[0]], passed = []; for (let hops = 0; hops < 120 && run < far; hops++) { const b = onward(r, e); if (!b) break; r = b.road; e = b.end === 1 ? 0 : 1; const P = pts(r, b.end === 1); for (let i = 1; i < P.length && run < far; i++) { run += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); out.push(P[i]); } passed.push(r); } return { pts: out, run, passed }; }
  // a side street from a node: how long until it ends (a close) or meets another street
  function sideStreet(r, fromEnd) { let road = r, e = fromEnd, L = 0; const seen = new Set(); for (let hops = 0; hops < 40; hops++) { if (seen.has(road.id)) break; seen.add(road.id); L += road.L; const p = pts(road, e === 0)[0] /* the far end */; const d = degreeAt(p); if (d === 1) return { L, close: true }; if (d > 2) return { L, close: false }; const nxt = (at.get(key(p.x, p.z)) ?? []).find((n) => n.road !== road); if (!nxt) return { L, close: true }; road = nxt.road; e = nxt.end; } return { L, close: false }; }

  // a polyline every 25 m; the buildings (by index) within `w` of a run of points; the heading of a run
  const every25 = (P) => { const out = [P[0]]; for (let i = 1; i < P.length; i++) { const a = out[out.length - 1], b = P[i], d = Math.hypot(b.x - a.x, b.z - a.z); for (let t = 25; t <= d; t += 25) out.push({ x: a.x + ((b.x - a.x) * t) / d, z: a.z + ((b.z - a.z) * t) / d }); } return out; };
  const near = (pts, w) => { const seen = new Set(); for (const p of pts) { const i0 = Math.floor((p.x - w) / C), i1 = Math.floor((p.x + w) / C), j0 = Math.floor((p.z - w) / C), j1 = Math.floor((p.z + w) / C); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [bx, bz, bi] of cells.get(`${i},${j}`) ?? []) if (Math.hypot(bx - p.x, bz - p.z) < w) seen.add(bi); } return seen.size; };
  const heading = (pts, i, span = 4) => { const a = pts[Math.max(0, i - span)], b = pts[Math.min(pts.length - 1, i + span)]; return Math.atan2(b.z - a.z, b.x - a.x); };

  const places = M.places.filter((p) => ['city', 'town', 'village'].includes(p.kind) && p.people >= 150);
  const out = [];
  for (const p of places) {
    // the built-up blob, holes filled (as exits.mjs)
    const R0 = Math.max(400, p.r * 2.5), ck = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`, blob = new Set();
    let start = null, bd = Infinity;
    for (let x = p.x - 400; x <= p.x + 400; x += C) for (let z = p.z - 400; z <= p.z + 400; z += C) { const d = Math.hypot(x - p.x, z - p.z); if (d < bd && builtUp(x, z)) { bd = d; start = [x, z]; } }
    if (!start) continue;
    const todo = [start]; blob.add(ck(start[0], start[1]));
    while (todo.length) { const [x, z] = todo.pop(); for (const [dx, dz] of [[C, 0], [-C, 0], [0, C], [0, -C]]) { const nx = x + dx, nz = z + dz, k = ck(nx, nz); if (blob.has(k) || Math.hypot(nx - p.x, nz - p.z) > R0 || !builtUp(nx, nz)) continue; blob.add(k); todo.push([nx, nz]); } }
    for (let pass = 0; pass < 3; pass++) { const add = [], seen = new Set(); for (const k of blob) { const [i, j] = k.split(',').map(Number); for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${i + di},${j + dj}`; if (blob.has(nk) || seen.has(nk)) continue; seen.add(nk); let n = 0; for (const [ei, ej] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blob.has(`${i + di + ei},${j + dj + ej}`)) n++; if (n >= 3) add.push(nk); } } for (const k of add) blob.add(k); }
    if (blob.size < 3) continue;
    const inBlob = (x, z) => blob.has(ck(x, z));
    // the blob's shape: its cells' principal axes (elongation), its area, and its radius by direction
    const cs = [...blob].map((k) => { const [i, j] = k.split(',').map(Number); return [(i + 0.5) * C, (j + 0.5) * C]; });
    const cx = mean(cs.map((c) => c[0])), cz = mean(cs.map((c) => c[1]));
    let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of cs) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
    const tr = sxx + szz, det = sxx * szz - sxz * sxz, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const elongation = Math.sqrt(l1 / Math.max(1e-6, l2));
    const areaHa = (blob.size * C * C) / 1e4, Req = Math.sqrt(blob.size * C * C / Math.PI);
    // the edge radius by direction (36 bins): the farthest blob cell in each 10° sector
    const rad = new Array(36).fill(0);
    for (const [x, z] of cs) { const d = Math.hypot(x - p.x, z - p.z), b = Math.floor(((Math.atan2(z - p.z, x - p.x) + Math.PI) / (2 * Math.PI)) * 36) % 36; rad[b] = Math.max(rad[b], d); }
    // the ways out (as exits.mjs: a road's last departure), and which are radials (reach the middle)
    const exits = [];
    for (const r of roads) {
      if (!MAIN.has(r.cls) && r.cls !== 'local') continue;
      const P = pts(r, false);
      if (!P.some((a) => Math.hypot(a.x - p.x, a.z - p.z) < Req * 2 + 300)) continue;
      const Pd = []; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z), n = Math.max(1, Math.ceil(d / 25)); for (let k = 0; k < n; k++) Pd.push({ x: P[i - 1].x + (P[i].x - P[i - 1].x) * (k / n), z: P[i - 1].z + (P[i].z - P[i - 1].z) * (k / n) }); } Pd.push(P[P.length - 1]);
      for (let i = 1; i < Pd.length; i++) for (const dir of [1, -1]) {
        const a = dir > 0 ? Pd[i - 1] : Pd[i], b = dir > 0 ? Pd[i] : Pd[i - 1];
        if (!(inBlob(a.x, a.z) && !inBlob(b.x, b.z))) continue;
        const outw = walk(r, dir > 0 ? 1 : 0, 2200), inw = walk(r, dir > 0 ? 0 : 1, Req * 2 + 400);
        const after = dir > 0 ? Pd.slice(i) : Pd.slice(0, i).reverse(), before = dir > 0 ? Pd.slice(0, i).reverse() : Pd.slice(i);
        const outFull = [...after, ...outw.pts.slice(1)];
        let last = -1; for (let k = 0; k < outFull.length; k++) if (inBlob(outFull[k].x, outFull[k].z)) last = k;
        if (last >= outFull.length - 2) continue;
        const c = outFull[last + 1], outPts = outFull.slice(last + 1), inPts = [...outFull.slice(0, last + 1).reverse(), ...before, ...inw.pts.slice(1)];
        let lo = 0; for (let k = 1; k < outPts.length; k++) lo += Math.hypot(outPts[k].x - outPts[k - 1].x, outPts[k].z - outPts[k - 1].z);
        if (lo < 600) continue;
        // in: how near the middle it gets, and the side streets off it inside the place
        let nearest = Infinity, run = 0; const roadsIn = [r, ...inw.passed];
        for (let k = 0; k < inPts.length; k++) { const d = Math.hypot(inPts[k].x - p.x, inPts[k].z - p.z); if (d < nearest) nearest = d; }
        const sides = [];
        for (const rr of roadsIn) for (const end of [0, 1]) { const e = pts(rr, end === 1)[0]; if (!inBlob(e.x, e.z)) continue; for (const n of at.get(key(e.x, e.z)) ?? []) { if (roadsIn.includes(n.road)) continue; const s = sideStreet(n.road, n.end); sides.push({ L: Math.round(s.L), close: s.close, cls: n.road.cls }); } }
        let inRun = 0; for (let k = 1; k < inPts.length; k++) if (inBlob(inPts[k].x, inPts[k].z)) inRun += Math.hypot(inPts[k].x - inPts[k - 1].x, inPts[k].z - inPts[k - 1].z);
        // the bend of the road inside the place (from the edge in to where it gets nearest the middle) and
        // over its first 400 m outside: the net turn, and how much its heading wanders per 100 m
        const inside = every25(inPts).filter((q) => inBlob(q.x, q.z)).slice(0, Math.max(2, Math.round(inRun / 25))), outside = every25(outPts).slice(0, 25);
        const bendOf = (pts) => { if (pts.length < 6) return null; let wander = 0, n = 0; for (let k = 4; k < pts.length - 4; k += 4) { wander += Math.abs(norm(heading(pts, k) - heading(pts, k - 4))); n++; } const net = Math.abs(norm(heading(pts, pts.length - 3) - heading(pts, 2))), L = (pts.length - 1) * 25; return { netDeg: deg(net), perKmDeg: (deg(net) * 1000) / L, wanderDegPer100m: n ? deg(wander / n) : 0 }; };
        // the houses along it: buildings within 40 m of the road per 100 m, by quarter of its run inside
        // (from the middle out) and by 200 m outside the edge (the ribbon straggling on)
        const inFromMiddle = [...inside].reverse();
        const q4 = [0, 1, 2, 3].map((k) => { const a = Math.floor((inFromMiddle.length * k) / 4), b = Math.floor((inFromMiddle.length * (k + 1)) / 4); const run = inFromMiddle.slice(a, Math.max(a + 2, b)); return run.length >= 2 ? (near(run, 40) * 100) / ((run.length - 1) * 25) : null; });
        const out3 = [0, 1, 2].map((k) => { const run = outside.slice(k * 8, k * 8 + 9); return run.length >= 2 ? (near(run, 40) * 100) / ((run.length - 1) * 25) : null; });
        exits.push({ theta: deg(Math.atan2(c.z - p.z, c.x - p.x)), at: c, dist: Math.hypot(c.x - p.x, c.z - p.z), cls: r.cls, nearest, radial: nearest < Math.max(120, 0.3 * Req), inRun, sides, bendIn: bendOf(inside), bendOut: bendOf(outside), housesPer100m: { inQuarters: q4, outBy200m: out3 } });
      }
    }
    exits.sort((a, b) => a.theta - b.theta);
    const kept = []; for (const e of exits) if (!kept.some((k) => Math.hypot(k.at.x - e.at.x, k.at.z - e.at.z) < 150)) kept.push(e);
    const radials = kept.filter((e) => e.radial);
    // the edge along the radials against between them (raggedness): the farthest built cell within
    // ±15° of each radial, against the median over the sectors 30° or more from any
    const along = radials.map((e) => { const b0 = Math.floor(((e.theta / 180) * Math.PI + Math.PI) / (2 * Math.PI) * 36); let m = 0; for (let d = -1; d <= 1; d++) m = Math.max(m, rad[(b0 + d + 36) % 36]); return m; });
    const between = rad.filter((_, b) => { const th = deg(((b + 0.5) / 36) * 2 * Math.PI - Math.PI); return rad[b] > 0 && radials.every((e) => Math.abs(deg(norm(((th - e.theta) / 180) * Math.PI))) >= 30); });
    const sidesAll = radials.flatMap((e) => e.sides), inKm = radials.reduce((t, e) => t + e.inRun, 0) / 1000;
    out.push({
      name: p.name, kind: p.kind, people: p.people, areaHa: Math.round(areaHa), elongation: Math.round(elongation * 100) / 100,
      waysOut: kept.length, radials: radials.length, radialGaps: radials.length > 1 ? radials.map((e, i) => { const n = radials[(i + 1) % radials.length]; let g = n.theta - e.theta; if (g <= 0) g += 360; return Math.round(g); }) : [],
      edgeAlongRadialM: Math.round(mean(along)), edgeBetweenM: Math.round(q(between, 0.5)), edgeRatio: between.length && along.length ? Math.round((mean(along) / Math.max(1, q(between, 0.5))) * 100) / 100 : null,
      sideStreetsPerKm: inKm > 0 ? Math.round(sidesAll.length / inKm) : null, closeShare: sidesAll.length ? Math.round((100 * sidesAll.filter((s) => s.close).length) / sidesAll.length) / 100 : null,
      sideLengthM: sidesAll.map((s) => s.L), closeLengthM: sidesAll.filter((s) => s.close).map((s) => s.L),
      radialBendIn: radials.map((e) => e.bendIn).filter(Boolean), radialBendOut: radials.map((e) => e.bendOut).filter(Boolean), radialHouses: radials.map((e) => e.housesPer100m),
    });
  }
  return { id, places: out };
}

const reports = ids.map(measure);
const summary = {};
for (const kind of ['town', 'village']) {
  const ps = reports.flatMap((r) => r.places.filter((p) => p.kind === kind));
  if (!ps.length) continue;
  const withR = ps.filter((p) => p.radials > 0);
  summary[kind] = {
    places: ps.length,
    waysOut: qs(ps.map((p) => p.waysOut)), radials: qs(ps.map((p) => p.radials)), radialShare: Math.round((100 * ps.reduce((t, p) => t + p.radials, 0)) / Math.max(1, ps.reduce((t, p) => t + p.waysOut, 0))) / 100,
    radialGapsDeg: qs(ps.flatMap((p) => p.radialGaps)),
    areaHa: qs(ps.map((p) => p.areaHa)), elongation: qs(ps.map((p) => p.elongation)), linearShare: Math.round((100 * ps.filter((p) => p.elongation > 2).length) / ps.length) / 100,
    edgeRatioAlongRadials: qs(ps.filter((p) => p.edgeRatio !== null).map((p) => p.edgeRatio)),
    sideStreetsPerKm: qs(withR.filter((p) => p.sideStreetsPerKm !== null).map((p) => p.sideStreetsPerKm)), closeShare: qs(withR.filter((p) => p.closeShare !== null).map((p) => p.closeShare)),
    sideStreetLengthM: qs(ps.flatMap((p) => p.sideLengthM)), closeLengthM: qs(ps.flatMap((p) => p.closeLengthM)),
    // a radial's bend inside the place and over its first 400 m outside (net turn in degrees, per km, and the wander per 100 m)
    radialNetTurnInsideDeg: qs(ps.flatMap((p) => p.radialBendIn.map((b) => b.netDeg))), radialTurnInsideDegPerKm: qs(ps.flatMap((p) => p.radialBendIn.map((b) => b.perKmDeg))), radialWanderInsideDegPer100m: qs(ps.flatMap((p) => p.radialBendIn.map((b) => b.wanderDegPer100m))),
    radialNetTurnOutsideDeg: qs(ps.flatMap((p) => p.radialBendOut.map((b) => b.netDeg))), radialWanderOutsideDegPer100m: qs(ps.flatMap((p) => p.radialBendOut.map((b) => b.wanderDegPer100m))),
    // the houses along a radial, per 100 m within 40 m of it: by quarter of its run from the middle to the edge, then by 200 m on outside
    housesPer100mByQuarter: [0, 1, 2, 3].map((k) => qs(ps.flatMap((p) => p.radialHouses.map((h) => h.inQuarters[k]).filter((v) => v !== null)))),
    housesPer100mOutsideBy200m: [0, 1, 2].map((k) => qs(ps.flatMap((p) => p.radialHouses.map((h) => h.outBy200m[k]).filter((v) => v !== null)))),
  };
}
console.log(JSON.stringify(summary, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, reports }, null, 1));
