#!/usr/bin/env node
// Measure what real Britain looks like, from the baked regions (public/regions/*), for the seeded
// generator's priors (src/proto/region/priors.ts). Prints a JSON report per region and pooled.
//
//   node tools/os/measure.mjs [exe teme …] [--out report.json]
//
// Settlements (OS Open Names places, people from building footprints), roads (OS OpenMap Local
// classes), street patterns (junction degrees, dead ends, orientation order), ribbon development,
// the coastline's fractal dimension, woodland patches (sizes, shapes, slopes, valleys) and
// building footprints. Every figure says what it's measured over.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeTile, tileFile, ROAD_CLASSES, WIDTH } from '../../src/proto/real/format.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const oi = args.indexOf('--out'), OUT = oi >= 0 ? args.splice(oi, 2)[1] : null;
const ids = args.length ? args : readdirSync(join(ROOT, 'public/regions'));

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const r2 = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const area2 = (a) => { let s = 0; for (let k = 0, n = a.length; k < n; k += 2) { const j = (k + 2) % n; s += a[k] * a[j + 1] - a[j] * a[k + 1]; } return s / 2; };
const len = (a) => { let s = 0; for (let k = 2; k < a.length; k += 2) s += Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1]); return s; };
// least squares y = a + b x
const fit = (xs, ys) => { const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } const b = sxy / (sxx || 1); return { a: my - b * mx, b }; };

function measure(id) {
  const dir = join(ROOT, 'public/regions', id), M = JSON.parse(readFileSync(join(dir, 'region.json'), 'utf8'));
  const tiles = [];
  for (let j = 0; j < M.n; j++) for (let i = 0; i < M.n; i++) tiles.push(decodeTile(new Uint8Array(readFileSync(join(dir, tileFile(i, j))))));
  const km2 = (M.size / 1000) ** 2;
  const all = (k) => tiles.flatMap((t) => t.layers[k] ?? []);
  // heights: one grid over the square
  const H = (x, z) => { const i = Math.min(M.n - 1, Math.max(0, Math.floor((x + M.size / 2) / M.tile))), j = Math.min(M.n - 1, Math.max(0, Math.floor((z + M.size / 2) / M.tile))); const h = tiles[j * M.n + i].heights; const a = Math.min(h.n - 1, Math.max(0, Math.round((x - h.x0) / h.step))), b = Math.min(h.n - 1, Math.max(0, Math.round((z - h.z0) / h.step))); return h.h[b * h.n + a]; };
  const slope = (x, z) => { const e = 50; return Math.hypot(H(x + e, z) - H(x - e, z), H(x, z + e) - H(x, z - e)) / (2 * e); };
  // land: not sea
  const seaCells = new Set();
  {
    const C = 250;
    for (const f of all('sea')) for (const a of f.parts) { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (let k = 0; k < a.length; k += 2) { b[0] = Math.min(b[0], a[k]); b[1] = Math.min(b[1], a[k + 1]); b[2] = Math.max(b[2], a[k]); b[3] = Math.max(b[3], a[k + 1]); }
      for (let x = Math.ceil(b[0] / C) * C; x <= b[2]; x += C) for (let z = Math.ceil(b[1] / C) * C; z <= b[3]; z += C) if (inRing(x, z, a)) seaCells.add(`${x / C},${z / C}`); }
  }
  const isSea = (x, z) => seaCells.has(`${Math.round(x / 250)},${Math.round(z / 250)}`);
  let landKm2 = 0; for (let x = -M.size / 2 + 125; x < M.size / 2; x += 250) for (let z = -M.size / 2 + 125; z < M.size / 2; z += 250) if (!isSea(x, z)) landKm2 += 0.0625;

  // ---------------- settlements ----------------
  const places = M.places.filter((p) => ['city', 'town', 'village', 'hamlet'].includes(p.kind));
  const byKind = (ks) => places.filter((p) => ks.includes(p.kind));
  const nn = (from, to) => from.map((p) => Math.min(...to.filter((q2) => q2 !== p).map((q2) => Math.hypot(q2.x - p.x, q2.z - p.z)))).filter(Number.isFinite);
  const towns = byKind(['city', 'town']), villages = byKind(['village']), hamlets = byKind(['hamlet']);
  const nnTown = nn(towns, towns), nnVillage = nn(villages, [...villages, ...towns]), nnHamlet = nn(hamlets, places);
  const sized = places.filter((p) => p.people >= 300).sort((a, b) => b.people - a.people);
  const zipf = fit(sized.map((_, i) => Math.log(i + 1)), sized.map((p) => Math.log(p.people)));
  const rp = fit(sized.map((p) => Math.log(p.people)), sized.map((p) => Math.log(p.r)));
  const settlements = {
    perThousandKm2: { cityOrTown: r2((towns.length / landKm2) * 1000, 1), village: r2((villages.length / landKm2) * 1000, 1), hamlet: r2((hamlets.length / landKm2) * 1000, 1) },
    nearestNeighbourM: { town: [q(nnTown, 0.25), q(nnTown, 0.5), q(nnTown, 0.75)].map(Math.round), village: [q(nnVillage, 0.25), q(nnVillage, 0.5), q(nnVillage, 0.75)].map(Math.round), hamlet: [q(nnHamlet, 0.25), q(nnHamlet, 0.5), q(nnHamlet, 0.75)].map(Math.round) },
    rankSize: { exponent: r2(-zipf.b), over: sized.length },
    extentRadius: { a: r2(Math.exp(rp.a)), b: r2(rp.b), note: 'Open Names extent: r ≈ a · people^b (m)' },
    people: { town: [q(towns.map((p) => p.people), 0.25), q(towns.map((p) => p.people), 0.5), q(towns.map((p) => p.people), 0.75)], village: [q(villages.map((p) => p.people), 0.25), q(villages.map((p) => p.people), 0.5), q(villages.map((p) => p.people), 0.75)] },
    largest: sized.slice(0, 5).map((p) => `${p.name} ${p.people}`),
  };

  // ---------------- roads ----------------
  const roads = all('roads');
  const inPlace = (x, z, grow = 1) => { for (const p of places) if (p.kind !== 'hamlet' && Math.hypot(p.x - x, p.z - z) < p.r * grow) return p; return null; };
  const km = {}, kmIn = {}, kmOut = {};
  for (const f of roads) { const c = ROAD_CLASSES[f.c & 15], a = f.parts[0], L = len(a) / 1000, m = Math.floor(a.length / 4) * 2; km[c] = (km[c] ?? 0) + L; if (inPlace(a[m], a[m + 1])) kmIn[c] = (kmIn[c] ?? 0) + L; else kmOut[c] = (kmOut[c] ?? 0) + L; }
  const density = Object.fromEntries(Object.entries(km).map(([k, v]) => [k, r2(v / landKm2, 3)]));
  // junctions from shared endpoints (OML splits its roads at junctions): degree of each end point
  const deg = new Map(), key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  for (const f of roads) { const c = ROAD_CLASSES[f.c & 15]; if (c === 'restricted' || c === 'access' || c === 'shared') continue; const a = f.parts[0]; for (const [x, z] of [[a[0], a[1]], [a[a.length - 2], a[a.length - 1]]]) { const k = key(x, z); const d = deg.get(k) ?? { n: 0, x, z }; d.n++; deg.set(k, d); } }
  const degIn = { 1: 0, 3: 0, 4: 0 }, degOut = { 1: 0, 3: 0, 4: 0 };
  for (const d of deg.values()) { if (d.n === 2) continue; const t = inPlace(d.x, d.z) ? degIn : degOut; t[Math.min(4, d.n)] = (t[Math.min(4, d.n)] ?? 0) + 1; }
  const share = (t) => { const n = t[1] + t[3] + t[4]; return { deadEnd: r2(t[1] / n), tee: r2(t[3] / n), cross: r2(t[4] / n) }; };
  // street pieces between junctions, in places (local and minor roads)
  const pieces = roads.filter((f) => ['local', 'minor'].includes(ROAD_CLASSES[f.c & 15])).map((f) => ({ L: len(f.parts[0]), a: f.parts[0] })).filter((p) => inPlace(p.a[0], p.a[1]));
  // orientation order (Boeing 2019): 36 bins of street bearings (both ways), entropy against a
  // perfect grid's (4 bins) and a uniform spread's; 1 is a grid, 0 is every direction alike
  const order = (pred) => {
    const bins = new Float64Array(36);
    for (const f of roads) { const c = ROAD_CLASSES[f.c & 15]; if (!['local', 'minor', 'b', 'a'].includes(c)) continue; const a = f.parts[0]; for (let k = 2; k < a.length; k += 2) { const x = (a[k] + a[k - 2]) / 2, z = (a[k + 1] + a[k - 1]) / 2; if (!pred(x, z)) continue; const L = Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1]); const b = ((Math.atan2(a[k + 1] - a[k - 1], a[k] - a[k - 2]) * 180) / Math.PI + 360) % 180; bins[Math.floor(b / 10) % 18] += L; bins[(Math.floor(b / 10) % 18) + 18] += L; } }
    const tot = bins.reduce((s, v) => s + v, 0); let Hh = 0; for (const v of bins) if (v > 0) Hh -= (v / tot) * Math.log(v / tot);
    const Hmax = Math.log(36), Hg = Math.log(4);
    return r2(1 - ((Hh - Hg) / (Hmax - Hg)) ** 2);
  };
  const cores = places.filter((p) => p.kind === 'city' || p.kind === 'town');
  const inCore = (x, z) => cores.some((p) => Math.hypot(p.x - x, p.z - z) < p.r * 0.3);
  const inSuburb = (x, z) => cores.some((p) => { const d = Math.hypot(p.x - x, p.z - z); return d >= p.r * 0.3 && d < p.r; });
  // ribbon development: buildings outside places, how many stand within 60 m of an A or B road,
  // against the share of the land that's that close (their ratio: how strongly they line the roads)
  const bld = all('buildings');
  const abGrid = new Map(), C = 100;
  for (const f of roads) { const c = ROAD_CLASSES[f.c & 15]; if (!['primary', 'a', 'b'].includes(c)) continue; const a = f.parts[0]; for (let k = 2; k < a.length; k += 2) { const n = Math.ceil(Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1]) / 20); for (let s = 0; s <= n; s++) { const x = a[k - 2] + ((a[k] - a[k - 2]) * s) / n, z = a[k - 1] + ((a[k + 1] - a[k - 1]) * s) / n; const kk = `${Math.floor(x / C)},${Math.floor(z / C)}`; (abGrid.get(kk) ?? abGrid.set(kk, []).get(kk)).push(x, z); } } }
  const nearAB = (x, z, m = 60) => { for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const l = abGrid.get(`${Math.floor(x / C) + di},${Math.floor(z / C) + dj}`); if (l) for (let k = 0; k < l.length; k += 2) if (Math.hypot(l[k] - x, l[k + 1] - z) < m) return true; } return false; };
  let bOut = 0, bOutNear = 0;
  for (const f of bld) { const a = f.parts[0]; if (Math.abs(area2(a)) < 30) continue; const x = a[0], z = a[1]; if (isSea(x, z) || inPlace(x, z, 1.2)) continue; bOut++; if (nearAB(x, z)) bOutNear++; }
  let landOut = 0, landNear = 0;
  for (let x = -M.size / 2 + 50; x < M.size / 2; x += 200) for (let z = -M.size / 2 + 50; z < M.size / 2; z += 200) { if (isSea(x, z) || inPlace(x, z, 1.2)) continue; landOut++; if (nearAB(x, z)) landNear++; }
  const road = {
    kmPerKm2: density,
    kmPerKm2InPlaces: Object.fromEntries(Object.entries(kmIn).map(([k, v]) => [k, r2(v / landKm2, 3)])),
    junctions: { inPlaces: share(degIn), outside: share(degOut) },
    streetPieceM: [q(pieces.map((p) => p.L), 0.25), q(pieces.map((p) => p.L), 0.5), q(pieces.map((p) => p.L), 0.75)].map(Math.round),
    orientationOrder: { core: order(inCore), suburb: order(inSuburb), country: order((x, z) => !inPlace(x, z, 1.2)) },
    ribbon: { buildingsNearABOutside: r2(bOutNear / (bOut || 1)), landNearABOutside: r2(landNear / (landOut || 1)), lift: r2(bOutNear / (bOut || 1) / (landNear / (landOut || 1))) },
  };

  // ---------------- how roads follow the land ----------------
  // along each class: the grade every 50 m, against the steepest slope of the ground there (a road
  // straight up the hill has a ratio of 1; one along the contour, 0); how much a road winds between
  // junctions (length over the straight line, pieces over 300 m); and how low it runs (height above
  // the lowest ground within 1 km, against the land's)
  const lowIn = (x, z) => { let lo = Infinity; for (let dx = -1000; dx <= 1000; dx += 250) for (let dz = -1000; dz <= 1000; dz += 250) lo = Math.min(lo, H(x + dx, z + dz)); return H(x, z) - lo; };
  const follow = {};
  for (const c of ['motorway', 'primary', 'a', 'b', 'minor', 'local']) {
    const grades = [], ratios = [], sin = [], above = [];
    for (const f of roads) {
      if (ROAD_CLASSES[f.c & 15] !== c) continue;
      const a = f.parts[0], L = len(a);
      if (L > 300) { const d = Math.hypot(a[a.length - 2] - a[0], a[a.length - 1] - a[1]); if (d > 1) sin.push(L / d); }
      // (points every 50 m along it)
      let acc = 0, next = 0, px = a[0], pz = a[1], ph = H(a[0], a[1]);
      for (let k = 2; k < a.length; k += 2) {
        const sl = Math.hypot(a[k] - a[k - 2], a[k + 1] - a[k - 1]);
        while (acc + sl >= next + 50) {
          next += 50;
          const t = (next - acc) / sl, x = a[k - 2] + (a[k] - a[k - 2]) * t, z = a[k - 1] + (a[k + 1] - a[k - 1]) * t, h = H(x, z);
          const g = Math.abs(h - ph) / 50, s0 = slope(x, z);
          grades.push(g);
          if (s0 > 0.04) ratios.push(Math.min(1, g / s0));
          if (grades.length % 4 === 0 && !isSea(x, z)) above.push(lowIn(x, z));
          px = x; pz = z; ph = h;
        }
        acc += sl;
      }
    }
    if (!grades.length) continue;
    follow[c] = {
      gradeMedian: r2(q(grades, 0.5), 3), gradeP90: r2(q(grades, 0.9), 3), over10pct: r2(grades.filter((g) => g > 0.1).length / grades.length, 3),
      gradeOverSlope: r2(q(ratios, 0.5), 2), // (on ground steeper than 4%)
      sinuosity: [q(sin, 0.25), q(sin, 0.5), q(sin, 0.75)].map((v) => r2(v, 3)),
      aboveValleyM: Math.round(q(above, 0.5)),
    };
  }
  const landAbove = [];
  for (let x = -M.size / 2 + 1500; x < M.size / 2 - 1500; x += 700) for (let z = -M.size / 2 + 1500; z < M.size / 2 - 1500; z += 700) if (!isSea(x, z)) landAbove.push(lowIn(x, z));
  follow.land = { aboveValleyM: Math.round(q(landAbove, 0.5)), slopeMedian: r2(q(landAbove.length ? (() => { const a = []; for (let x = -M.size / 2 + 1500; x < M.size / 2 - 1500; x += 700) for (let z = -M.size / 2 + 1500; z < M.size / 2 - 1500; z += 700) if (!isSea(x, z)) a.push(slope(x, z)); return a; })() : [0], 0.5), 3) };
  // (and where places stand: height above the valley at their middles)
  follow.places = { aboveValleyM: Math.round(q(places.filter((p) => p.kind !== 'hamlet').map((p) => lowIn(p.x, p.z)), 0.5)) };
  road.followLand = follow;

  // ---------------- coast ----------------
  let coast = null;
  const seaF = all('sea').filter((f) => f.c === 0);
  if (seaF.length) {
    // the sea's edges, less the tile cuts
    const segs = [];
    for (const f of seaF) for (const a of f.parts) for (let k = 0; k < a.length; k += 2) { const j = (k + 2) % a.length, x1 = a[k], z1 = a[k + 1], x2 = a[j], z2 = a[j + 1]; const onCut = (v) => Math.abs(((v + M.size / 2) % M.tile + M.tile) % M.tile) < 0.6 || Math.abs(((v + M.size / 2) % M.tile + M.tile) % M.tile - M.tile) < 0.6; if ((x1 === x2 && onCut(x1)) || (z1 === z2 && onCut(z1))) continue; segs.push([x1, z1, x2, z2]); }
    // box counting over 50 m – 3.2 km
    const sizes = [50, 100, 200, 400, 800, 1600, 3200], counts = sizes.map((s) => { const box = new Set(); for (const [x1, z1, x2, z2] of segs) { const n = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (s / 4)) + 1; for (let t = 0; t <= n; t++) box.add(`${Math.floor((x1 + ((x2 - x1) * t) / n) / s)},${Math.floor((z1 + ((z2 - z1) * t) / n) / s)}`); } return box.size; });
    const f2 = fit(sizes.map((s) => Math.log(1 / s)), counts.map((c) => Math.log(c)));
    let total = 0; for (const [x1, z1, x2, z2] of segs) total += Math.hypot(x2 - x1, z2 - z1);
    // estuaries: tidal rivers (OS Open Rivers' tidal links) and how far they reach inland
    const tidal = all('rivers').filter((f) => f.c % WIDTH === 1);
    coast = { fractalDimension: r2(f2.b), boxes: Object.fromEntries(sizes.map((s, i) => [s, counts[i]])), lengthKm: Math.round(total / 1000), tidalRiverKm: Math.round(tidal.reduce((s, f) => s + len(f.parts[0]), 0) / 1000), tidalRiverWidthM: [q(tidal.map((f) => Math.floor(f.c / WIDTH)), 0.25), q(tidal.map((f) => Math.floor(f.c / WIDTH)), 0.5), q(tidal.map((f) => Math.floor(f.c / WIDTH)), 0.75)] };
  }

  // ---------------- woods ----------------
  const woods = all('woods').filter((f) => !f.holes || f.holes.filter((h) => !h).length === 1);
  const wA = [], wShape = [];
  for (const f of woods) { const a = f.parts[0], A = Math.abs(area2(a)); if (A < 100) continue; wA.push(A); wShape.push(len([...a, a[0], a[1]]) / (2 * Math.sqrt(Math.PI * A))); }
  const lnA = wA.map(Math.log), mu = mean(lnA), sd = Math.sqrt(mean(lnA.map((v) => (v - mu) ** 2)));
  // where they sit: slope, height above the lowest point within 1 km (valley or hill), distance to a stream
  const streamGrid = new Map();
  for (const f of [...all('streams'), ...all('rivers')]) { const a = f.parts[0]; for (let k = 0; k < a.length; k += 2) { const kk = `${Math.floor(a[k] / C)},${Math.floor(a[k + 1] / C)}`; (streamGrid.get(kk) ?? streamGrid.set(kk, []).get(kk)).push(a[k], a[k + 1]); } }
  const toStream = (x, z) => { let b = 400; for (let di = -4; di <= 4; di++) for (let dj = -4; dj <= 4; dj++) { const l = streamGrid.get(`${Math.floor(x / C) + di},${Math.floor(z / C) + dj}`); if (l) for (let k = 0; k < l.length; k += 2) b = Math.min(b, Math.hypot(l[k] - x, l[k + 1] - z)); } return b; };
  const relH = (x, z) => { let lo = Infinity; for (let dx = -1000; dx <= 1000; dx += 250) for (let dz = -1000; dz <= 1000; dz += 250) lo = Math.min(lo, H(x + dx, z + dz)); return H(x, z) - lo; };
  const woodGrid = new Set();
  for (const f of all('woods')) { const a = f.parts[0]; const b = [Infinity, Infinity, -Infinity, -Infinity]; for (let k = 0; k < a.length; k += 2) { b[0] = Math.min(b[0], a[k]); b[1] = Math.min(b[1], a[k + 1]); b[2] = Math.max(b[2], a[k]); b[3] = Math.max(b[3], a[k + 1]); }
    for (let x = Math.ceil(b[0] / 100) * 100; x <= b[2]; x += 100) for (let z = Math.ceil(b[1] / 100) * 100; z <= b[3]; z += 100) if (inRing(x, z, a)) woodGrid.add(`${x},${z}`); }
  const inW = { s: [], st: [], rh: [] }, allL = { s: [], st: [], rh: [] };
  let cells = 0, wooded = 0;
  for (let x = -M.size / 2 + 1000; x < M.size / 2 - 1000; x += 300) for (let z = -M.size / 2 + 1000; z < M.size / 2 - 1000; z += 300) {
    if (isSea(x, z) || inPlace(x, z)) continue;
    const w = woodGrid.has(`${Math.round(x / 100) * 100},${Math.round(z / 100) * 100}`);
    const s = slope(x, z), st = toStream(x, z), rh = relH(x, z);
    cells++; allL.s.push(s); allL.st.push(st); allL.rh.push(rh);
    if (w) { wooded++; inW.s.push(s); inW.st.push(st); inW.rh.push(rh); }
  }
  // wooded share by slope band: how much likelier a steep field is to be a wood
  const bands = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 1];
  const bySlope = bands.slice(0, -1).map((lo, i) => { const hi = bands[i + 1]; const n = allL.s.filter((v) => v >= lo && v < hi).length, w = inW.s.filter((v) => v >= lo && v < hi).length; return { slope: `${lo}-${hi}`, share: r2(w / (n || 1), 3), n }; });
  const woodland = {
    coverOutsidePlaces: r2(wooded / (cells || 1), 3),
    perKm2: r2(wA.length / landKm2, 1),
    areaLogNormal: { muLnM2: r2(mu), sigma: r2(sd), medianHa: r2(Math.exp(mu) / 1e4), p90Ha: r2(q(wA, 0.9) / 1e4) },
    shapeIndex: [q(wShape, 0.25), q(wShape, 0.5), q(wShape, 0.75)].map((v) => r2(v)),
    slope: { woods: r2(q(inW.s, 0.5), 3), land: r2(q(allL.s, 0.5), 3), bySlope },
    streamM: { woods: Math.round(q(inW.st, 0.5)), land: Math.round(q(allL.st, 0.5)) },
    aboveValleyM: { woods: Math.round(q(inW.rh, 0.5)), land: Math.round(q(allL.rh, 0.5)) },
  };

  // ---------------- buildings ----------------
  const fa = bld.map((f) => Math.abs(area2(f.parts[0]))).filter((v) => v >= 6);
  const buildings = { footprintM2: [q(fa, 0.25), q(fa, 0.5), q(fa, 0.75), q(fa, 0.95)].map(Math.round), perKm2: Math.round(fa.length / landKm2) };
  return { id, name: M.name, landKm2: Math.round(landKm2), settlements, roads: road, coast, woodland, buildings };
}
function inRing(x, z, a) { let s = false; for (let i = 0, j = a.length - 2; i < a.length; j = i, i += 2) if ((a[i + 1] > z) !== (a[j + 1] > z) && x < ((a[j] - a[i]) * (z - a[i + 1])) / (a[j + 1] - a[i + 1]) + a[i]) s = !s; return s; }

const reports = ids.map(measure);
console.log(JSON.stringify(reports, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify(reports, null, 1));
