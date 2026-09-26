#!/usr/bin/env node
// How roads leave real places, from the baked regions (public/regions/*), for the seeded map's lanes
// (worldmap/routes.ts, region/priors.ts PRIORS.exits). For every city, town and village: each road
// that runs out of its built-up area (the "exits"), the angle it meets the edge at (0°: straight out,
// radial; 90°: along the edge), how radial it runs inside the place, how much it bends in its first
// kilometre outside, its class, and how many exits a place of that size has and how they're spread
// round it. Prints a JSON report; --svg <dir> also draws each town (roads, buildings, exits) to look at.
//
//   node --experimental-transform-types --no-warnings --import ./tools/os/ts-register.mjs tools/os/exits.mjs [exe teme …] [--svg dir] [--out report.json]
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTile, tileFile, ROAD_CLASSES } from '../../src/proto/real/format.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1] : null; };
const OUT = take('--out'), SVG = take('--svg'), DEBUG = take('--debug');
const ids = args.length ? args : readdirSync(join(ROOT, 'public/regions'));

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const qs = (a) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => Math.round(q(a, p) * 10) / 10);
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const deg = (r) => (r * 180) / Math.PI;
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const OUTWARD = 1000, INWARD = 500; // m walked outside and inside the edge
const MAIN = new Set(['motorway', 'primary', 'a', 'b', 'minor']); // roads that go somewhere (not streets, drives or tracks)

function measure(id) {
  const dir = join(ROOT, 'public/regions', id), M = JSON.parse(readFileSync(join(dir, 'region.json'), 'utf8'));
  const tiles = [];
  for (let j = 0; j < M.n; j++) for (let i = 0; i < M.n; i++) tiles.push(decodeTile(new Uint8Array(readFileSync(join(dir, tileFile(i, j))))));
  const all = (k) => tiles.flatMap((t) => t.layers[k] ?? []);
  // buildings, by 100 m cell: "built-up" is at least 4 of them within 150 m
  const cells = new Map(), C = 100;
  for (const f of all('buildings')) { const a = f.parts[0]; let x = 0, z = 0, n = 0; for (let k = 0; k < a.length; k += 2) { x += a[k]; z += a[k + 1]; n++; } x /= n; z /= n; const key = `${Math.floor(x / C)},${Math.floor(z / C)}`; (cells.get(key) ?? cells.set(key, []).get(key)).push([x, z]); }
  const builtUp = (x, z, r = 150, need = 4) => { let n = 0; const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C); for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const [bx, bz] of cells.get(`${i},${j}`) ?? []) if (Math.hypot(bx - x, bz - z) < r && ++n >= need) return true; return false; };
  // the road graph: OS OpenMap Local splits roads at junctions, so shared end points are the nodes
  const roads = all('roads').map((f) => ({ cls: ROAD_CLASSES[f.c & 15], a: f.parts[0], name: f.name })).filter((r) => r.cls !== 'restricted' && r.cls !== 'access' && r.cls !== 'shared' && r.a.length >= 4);
  const key = (x, z) => `${Math.round(x)},${Math.round(z)}`;
  const at = new Map(); // node key -> [{ road, end: 0 | 1 }]
  roads.forEach((r, i) => { r.id = i; for (const end of [0, 1]) { const k = end ? key(r.a[r.a.length - 2], r.a[r.a.length - 1]) : key(r.a[0], r.a[1]); (at.get(k) ?? at.set(k, []).get(k)).push({ road: r, end }); } });
  const pts = (r, fromEnd) => { const p = []; for (let k = 0; k < r.a.length; k += 2) p.push({ x: r.a[k], z: r.a[k + 1] }); return fromEnd ? p.reverse() : p; };
  // Walk on from a road's end, taking the straightest continuation at each junction, `far` metres:
  // the points passed (the first is the end itself), and the classes met.
  function walk(road, end, far) {
    let r = road, e = end, run = 0;
    const out = [], classes = [];
    let p = pts(r, e === 1)[0]; // (the end we leave by)
    out.push(p);
    for (let hops = 0; hops < 80 && run < far; hops++) {
      const k = key(p.x, p.z), here = at.get(k) ?? [];
      const prev = pts(r, e === 0), hx = prev[prev.length - 1].x - prev[prev.length - 2].x, hz = prev[prev.length - 1].z - prev[prev.length - 2].z, hl = Math.hypot(hx, hz) || 1;
      let best = null, bd = -0.3;
      for (const n of here) {
        if (n.road === r) continue;
        const np = pts(n.road, n.end === 1), dx = np[1].x - np[0].x, dz = np[1].z - np[0].z, dl = Math.hypot(dx, dz) || 1;
        const s = (hx * dx + hz * dz) / (hl * dl) + (MAIN.has(n.road.cls) ? 0.15 : 0);
        if (s > bd) { bd = s; best = n; }
      }
      if (!best) break;
      r = best.road; e = best.end === 1 ? 0 : 1; // (we entered at best.end; we'll leave by the other)
      const P = pts(r, best.end === 1);
      for (let i = 1; i < P.length && run < far; i++) { run += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); out.push(P[i]); }
      classes.push(r.cls);
      p = P[P.length - 1];
      if (run >= far) break;
    }
    return { pts: out, run, classes };
  }
  const heading = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  const lengthOf = (P) => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); return s; };
  const pointAt = (P, s) => { let run = 0; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); if (run + d >= s) { const t = (s - run) / (d || 1); return { x: P[i - 1].x + (P[i].x - P[i - 1].x) * t, z: P[i - 1].z + (P[i].z - P[i - 1].z) * t }; } run += d; } return P[P.length - 1]; };
  // the road's heading over a stretch, and how much it turns: total absolute turning per km, and the net turn
  const turning = (P) => { let tot = 0, net = 0, prev = null; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); if (d < 5) continue; const h = heading(P[i - 1], P[i]); if (prev !== null) { const t = norm(h - prev); tot += Math.abs(t); net += t; } prev = h; } return { tot: deg(tot), net: deg(net) }; };

  const places = M.places.filter((p) => ['city', 'town', 'village'].includes(p.kind) && p.people >= 150);
  const report = [], svgs = [];
  // A place's built-up area: the 100 m cells that are built up (4 buildings within 150 m), joined
  // to its centre (a flood fill, out to 2.5 times its Open Names extent). Its edge is where that ends,
  // which is the edge you see on the map; the extent circle is often well inside or outside it.
  const blobOf = (p) => {
    const R = Math.max(400, p.r * 2.5), ck = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`, blob = new Set();
    let start = null, bd = Infinity;
    for (let x = p.x - 400; x <= p.x + 400; x += C) for (let z = p.z - 400; z <= p.z + 400; z += C) { const d = Math.hypot(x - p.x, z - p.z); if (d < bd && builtUp(x, z)) { bd = d; start = [x, z]; } }
    if (!start) return blob;
    const todo = [start];
    blob.add(ck(start[0], start[1]));
    while (todo.length) {
      const [x, z] = todo.pop();
      for (const [dx, dz] of [[C, 0], [-C, 0], [0, C], [0, -C]]) {
        const nx = x + dx, nz = z + dz, k = ck(nx, nz);
        if (blob.has(k) || Math.hypot(nx - p.x, nz - p.z) > R || !builtUp(nx, nz)) continue;
        blob.add(k); todo.push([nx, nz]);
      }
    }
    // (fill the holes: a park, a school field or a river meadow inside the town is still inside it)
    for (let pass = 0; pass < 3; pass++) {
      const add = [];
      const seen = new Set();
      for (const k of blob) { const [i, j] = k.split(',').map(Number); for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nk = `${i + di},${j + dj}`; if (blob.has(nk) || seen.has(nk)) continue; seen.add(nk); let n = 0; for (const [ei, ej] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (blob.has(`${i + di + ei},${j + dj + ej}`)) n++; if (n >= 3) add.push(nk); } }
      for (const k of add) blob.add(k);
    }
    return blob;
  };
  for (const p of places) {
    const blob = blobOf(p), inBlob = (x, z) => blob.has(`${Math.floor(x / C)},${Math.floor(z / C)}`);
    if (blob.size < 3) continue;
    // its radius as built (for the drawing, and the reach test)
    let R = 0; for (const k of blob) { const [i, j] = k.split(',').map(Number); R = Math.max(R, Math.hypot((i + 0.5) * C - p.x, (j + 0.5) * C - p.z)); }
    p.builtR = Math.round(R);
    // every road piece within reach: where a piece crosses the built-up edge (built-up at one point,
    // open at the next, and open 250 m on, and built-up 100 m back), heading outward
    const exits = [];
    for (const r of roads) {
      if (!MAIN.has(r.cls)) continue;
      const P = pts(r, false);
      const near = P.some((a) => Math.hypot(a.x - p.x, a.z - p.z) < R + 200);
      if (!near) continue;
      // (points 25 m apart, so a crossing is placed within a cell)
      const Pd = []; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z), n = Math.max(1, Math.ceil(d / 25)); for (let k = 0; k < n; k++) Pd.push({ x: P[i - 1].x + (P[i].x - P[i - 1].x) * (k / n), z: P[i - 1].z + (P[i].z - P[i - 1].z) * (k / n) }); } Pd.push(P[P.length - 1]);
      for (let i = 1; i < Pd.length; i++) for (const dir of [1, -1]) {
        const a = dir > 0 ? Pd[i - 1] : Pd[i], b = dir > 0 ? Pd[i] : Pd[i - 1]; // a inside, b outside
        if (!(inBlob(a.x, a.z) && !inBlob(b.x, b.z))) continue; // crossing the built-up edge outward
        // The way out is where the road last leaves the built-up area: ribbon houses run on along a
        // road out, with gaps, so it may cross the ragged edge several times before the open country.
        const outw = walk(r, dir > 0 ? 1 : 0, OUTWARD * 2.2), inw = walk(r, dir > 0 ? 0 : 1, INWARD);
        const before = dir > 0 ? Pd.slice(0, i).reverse() : Pd.slice(i), after = dir > 0 ? Pd.slice(i) : Pd.slice(0, i).reverse();
        const outFull = [...after, ...outw.pts.slice(1)];
        let last = -1;
        for (let k = 0; k < outFull.length; k++) if (inBlob(outFull[k].x, outFull[k].z)) last = k;
        const dbg = DEBUG && p.name === DEBUG ? (why) => console.error('reject', r.cls, r.name ?? '', Math.round(a.x - p.x), Math.round(a.z - p.z), why, 'last', last, 'of', outFull.length) : null;
        if (last >= outFull.length - 2) { dbg?.('never leaves'); continue; }
        const c = outFull[last + 1], outPts = outFull.slice(last + 1), inPts = [...outFull.slice(0, last + 1).reverse(), ...before, ...inw.pts.slice(1)];
        if (lengthOf(outPts) < 600) { dbg?.('short out'); continue; } // (a road that stops: a cul-de-sac over the edge)
        if (lengthOf(inPts) < 150) { dbg?.('short in'); continue; }
        const hp = outPts[Math.min(outPts.length - 1, 2)];
        const hx = hp.x - c.x, hz = hp.z - c.z, hl = Math.hypot(hx, hz) || 1, rl = Math.hypot(c.x - p.x, c.z - p.z) || 1, rx = (c.x - p.x) / rl, rz = (c.z - p.z) / rl;
        const alpha = deg(Math.acos(Math.max(-1, Math.min(1, (hx * rx + hz * rz) / hl))));
        // radialness inside: over the inner 400 m, the angle between the road's heading (inward) and the line to the centre
        let rad = [], runIn = 0;
        for (let k = 1; k < inPts.length && runIn < 400; k++) { const A = inPts[k - 1], B = inPts[k], d = Math.hypot(B.x - A.x, B.z - A.z); if (d < 3) continue; runIn += d; const h = heading(A, B), toC = Math.atan2(p.z - A.z, p.x - A.x); rad.push(Math.abs(deg(norm(h - toC)))); }
        // does it reach the middle (within 0.3 R) walking straight on?
        const reaches = inPts.some((x) => Math.hypot(x.x - p.x, x.z - p.z) < Math.max(120, 0.3 * R));
        const turn = turning(outPts.slice(0, outPts.length));
        exits.push({ theta: deg(Math.atan2(c.z - p.z, c.x - p.x)), alpha: Math.round(alpha), radialIn: Math.round(mean(rad)), reaches, cls: r.cls, outCls: outw.classes[0] ?? r.cls, turnPerKm: Math.round(turn.tot / (Math.min(OUTWARD, lengthOf(outPts)) / 1000)), netTurn: Math.round(Math.abs(turn.net)), at: c, outPts: outPts.slice(0, 60), inPts: inPts.slice(0, 40) });
      }
    }
    // (one exit where a road crosses the circle more than once, or two roads run out together)
    exits.sort((a, b) => a.theta - b.theta);
    const kept = [];
    for (const e of exits) if (!kept.some((k) => Math.hypot(k.at.x - e.at.x, k.at.z - e.at.z) < 150)) kept.push(e); // (a dual carriageway, or a lane beside the main road, is one way out)
    const gaps = kept.length > 1 ? kept.map((e, i) => { const n = kept[(i + 1) % kept.length]; let g = n.theta - e.theta; if (g <= 0) g += 360; return Math.round(g); }) : [];
    report.push({ name: p.name, kind: p.kind, people: p.people, r: p.r, builtR: p.builtR, exits: kept.length, mainExits: kept.filter((e) => e.cls !== 'minor').length, gaps, list: kept.map(({ outPts, inPts, at, ...e }) => e) });
    if (SVG && (p.kind !== 'village' || p.people > 900)) svgs.push(svgOf(p, kept, roads, cells, blob));
  }
  return { id, places: report, svgs };
}
function svgOf(p, exits, roads, cells, blob) {
  const S = Math.max(1200, p.builtR * 2.6), W = 800, sc = W / S, X = (x) => ((x - p.x) * sc + W / 2).toFixed(1), Z = (z) => ((z - p.z) * sc + W / 2).toFixed(1);
  const col = { motorway: '#00a', primary: '#c00', a: '#d40', b: '#c80', minor: '#666', local: '#bbb' };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="#f4f1e8"/>`;
  for (const [k, list] of cells) for (const [x, z] of list) if (Math.abs(x - p.x) < S / 2 && Math.abs(z - p.z) < S / 2) s += `<rect x="${X(x)}" y="${Z(z)}" width="1.6" height="1.6" fill="#a99"/>`;
  for (const r of roads) { const a = r.a; if (!(Math.abs(a[0] - p.x) < S && Math.abs(a[1] - p.z) < S)) continue; let d = ''; for (let k = 0; k < a.length; k += 2) d += `${k ? 'L' : 'M'}${X(a[k])} ${Z(a[k + 1])}`; s += `<path d="${d}" fill="none" stroke="${col[r.cls] ?? '#ddd'}" stroke-width="${r.cls === 'local' ? 0.7 : r.cls === 'minor' ? 1.2 : 2}"/>`; }
  for (const k of blob) { const [i, j] = k.split(',').map(Number); s += `<rect x="${X(i * 100)}" y="${Z(j * 100)}" width="${(100 * sc).toFixed(1)}" height="${(100 * sc).toFixed(1)}" fill="#06c" fill-opacity="0.12"/>`; }
  for (const e of exits) { s += `<circle cx="${X(e.at.x)}" cy="${Z(e.at.z)}" r="7" fill="none" stroke="#080" stroke-width="2"/><text x="${X(e.at.x)}" y="${(+Z(e.at.z) - 10).toFixed(1)}" font-size="11" fill="#080" text-anchor="middle">${e.cls} α${e.alpha}° in${e.radialIn}° ${e.reaches ? '→centre' : ''} turn${e.turnPerKm}/km</text>`; }
  s += `<text x="10" y="22" font-size="16" fill="#000">${p.name} (${p.kind}, ${p.people} people, built out to ${p.builtR} m): ${exits.length} roads out</text></svg>`;
  return { name: `${p.name.replace(/[^a-z0-9]+/gi, '-')}.svg`, s };
}

const reports = ids.map(measure);
if (SVG) { mkdirSync(SVG, { recursive: true }); for (const r of reports) for (const v of r.svgs) writeFileSync(join(SVG, `${r.id}-${v.name}`), v.s); }
// the summary: by kind, exits per place, the angles, the bends
const summary = {};
for (const kind of ['city', 'town', 'village']) {
  const ps = reports.flatMap((r) => r.places.filter((p) => p.kind === kind));
  const ex = ps.flatMap((p) => p.list);
  if (!ps.length) continue;
  summary[kind] = {
    places: ps.length,
    exitsPerPlace: qs(ps.map((p) => p.exits)),
    exitsPer1000People: Math.round((100 * ex.length) / (ps.reduce((t, p) => t + p.people, 0) / 1000)) / 100,
    byClass: Object.fromEntries(['primary', 'a', 'b', 'minor'].map((c) => [c, ex.filter((e) => e.cls === c).length])),
    alphaDeg: qs(ex.map((e) => e.alpha)), alphaUnder30: Math.round((100 * ex.filter((e) => e.alpha < 30).length) / (ex.length || 1)), alphaOver60: Math.round((100 * ex.filter((e) => e.alpha > 60).length) / (ex.length || 1)),
    radialInsideDeg: qs(ex.map((e) => e.radialIn)), reachesCentre: Math.round((100 * ex.filter((e) => e.reaches).length) / (ex.length || 1)),
    turnPerKmOutside: qs(ex.map((e) => e.turnPerKm)), netTurnFirstKm: qs(ex.map((e) => e.netTurn)),
    gapsDeg: qs(ps.flatMap((p) => p.gaps)), smallestGapDeg: qs(ps.filter((p) => p.gaps.length).map((p) => Math.min(...p.gaps))),
  };
}
const out = { summary, places: reports.map((r) => ({ id: r.id, places: r.places.map(({ list, ...p }) => p) })) };
console.log(JSON.stringify(summary, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify({ ...out, detail: reports.map((r) => ({ id: r.id, places: r.places })) }, null, 1));
