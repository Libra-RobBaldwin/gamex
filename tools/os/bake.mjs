#!/usr/bin/env node
// Bake a real 50 km region from Ordnance Survey OpenData (docs/real.md).
//
//   node tools/os/bake.mjs exe [--cache <dir>] [--keep]
//
// Downloads what the region needs from the OS Downloads API (no key: OpenData is free under the
// Open Government Licence), per 100 km tile where a product offers it, into a cache directory;
// reads the layers; writes public/regions/<id>/region.json and one small binary per 5 km tile
// (src/proto/real/format.ts). The raw downloads are deleted afterwards unless --keep.
//
// Sources:
//   OS OpenMap - Local (per 100 km tile): buildings, roads and their classes, railways, stations,
//     surface water, tidal water (the sea), foreshore, woodland, functional sites, named places
//   OS Terrain 50 (GB, cut into 10 km tiles inside): heights on a 50 m grid
//   OS Open Names (GB, 20 km CSVs inside): cities, towns, villages and hamlets, and their extents
//   OS Open Greenspace (per 100 km tile): parks, playing fields, golf, allotments, cemeteries
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShapefile } from './shp.mjs';
import { gridToLatLon } from './bng.mjs';
import { REGIONS } from './regions.mjs';
import * as F from '../../src/proto/real/format.ts';
const M2_PER_PERSON = 42; // (src/proto/real/priors.ts PEOPLE.footprintPerPerson)

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.os.uk/downloads/v1/products';
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) ?? 'exe';
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CACHE = opt('--cache', join(ROOT, '.os-cache'));
const KEEP = args.includes('--keep');
const R = REGIONS[id];
if (!R) { console.error(`no region "${id}": ${Object.keys(REGIONS).join(', ')}`); process.exit(1); }

const SIZE = R.size ?? 50000, TILE = 5000, N = SIZE / TILE, STEP = 50;
const E0 = R.e, N0 = R.n; // the square's south-west corner (BNG metres)
const EC = E0 + SIZE / 2, NC = N0 + SIZE / 2;
const BBOX = [E0, N0, E0 + SIZE, N0 + SIZE];
// BNG → game metres: x east, z south, the centre at 0, 0
const gx = (e) => e - EC, gz = (n) => NC - n;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ---------------- downloads ----------------
mkdirSync(CACHE, { recursive: true });
const letters = gridLetters(BBOX);
function fetchTo(file, url) {
  const p = join(CACHE, file);
  if (existsSync(p) && statSync(p).size > 0) return p;
  log('downloading', file);
  execFileSync('curl', ['-sSfL', '--retry', '4', '-o', p, url], { stdio: 'inherit' });
  return p;
}
const SHP = encodeURIComponent('ESRI® Shapefile');
const oml = letters.map((t) => ({ t, zip: fetchTo(`oml_${t}.zip`, `${API}/OpenMapLocal/downloads?area=${t}&format=${SHP}&redirect`) }));
const green = letters.map((t) => ({ t, zip: fetchTo(`gs_${t}.zip`, `${API}/OpenGreenspace/downloads?area=${t}&format=${SHP}&redirect`) }));
const t50 = fetchTo('t50.zip', `${API}/Terrain50/downloads?area=GB&format=${encodeURIComponent('ASCII Grid and GML (Grid)')}&redirect`);
const riversZip = fetchTo('rivers.zip', `${API}/OpenRivers/downloads?area=GB&format=${SHP}&redirect`);
const names = fetchTo('names.zip', `${API}/OpenNames/downloads?area=GB&format=CSV&redirect`);
const X = join(CACHE, 'x');
rmSync(X, { recursive: true, force: true });
mkdirSync(X, { recursive: true });
const unzip = (zip, ...pats) => { try { execFileSync('unzip', ['-oq', zip, ...pats, '-d', X], { stdio: ['ignore', 'ignore', 'inherit'] }); } catch (e) { if (e.status !== 11) throw e; } };
for (const { zip } of [...oml, ...green]) unzip(zip);
unzip(riversZip, '*WatercourseLink*');
const find = (dir, re, out = []) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) find(p, re, out); else if (re.test(f)) out.push(p); } return out; };
const layer = (name) => {
  const out = [];
  for (const p of find(X, new RegExp(`^([A-Z]{2}_)?${name}\\.shp$`))) for (const r of readShapefile(p.slice(0, -4), { bbox: BBOX })) out.push(r);
  return out;
};

// ---------------- geometry helpers ----------------
const toGame = (part) => { const a = new Float64Array(part.length); for (let k = 0; k < part.length; k += 2) { a[k] = gx(part[k]); a[k + 1] = gz(part[k + 1]); } return a; };
function simplify(a, tol) { // Douglas–Peucker on x, z pairs
  const n = a.length / 2;
  if (n <= 2 || tol <= 0) return a;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  // (a closed ring's two ends are the same point: split it at the point furthest from them)
  let far = 0, fd = -1;
  for (let k = 1; k < n - 1; k++) { const d = Math.hypot(a[2 * k] - a[0], a[2 * k + 1] - a[1]); if (d > fd) { fd = d; far = k; } }
  const closed = a[0] === a[2 * n - 2] && a[1] === a[2 * n - 1];
  if (closed) keep[far] = 1;
  const stack = closed ? [[0, far], [far, n - 1]] : [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const ax = a[2 * s], az = a[2 * s + 1], bx = a[2 * e], bz = a[2 * e + 1], ux = bx - ax, uz = bz - az, L = Math.hypot(ux, uz) || 1e-9;
    let best = -1, bi = -1;
    for (let k = s + 1; k < e; k++) { const d = Math.abs((a[2 * k] - ax) * uz - (a[2 * k + 1] - az) * ux) / L; if (d > best) { best = d; bi = k; } }
    if (best > tol) { keep[bi] = 1; stack.push([s, bi], [bi, e]); }
  }
  const out = [];
  for (let k = 0; k < n; k++) if (keep[k]) out.push(a[2 * k], a[2 * k + 1]);
  return Float64Array.from(out);
}
const area2 = (a) => { let s = 0; for (let k = 0, n = a.length; k < n; k += 2) { const j = (k + 2) % n; s += a[k] * a[j + 1] - a[j] * a[k + 1]; } return s / 2; };
// clip a ring to a box (Sutherland–Hodgman; keeps its winding)
function clipRing(a, x0, z0, x1, z1) {
  let pts = [];
  for (let k = 0; k < a.length; k += 2) pts.push([a[k], a[k + 1]]);
  const edges = [[(p) => p[0] >= x0, (p, q) => [x0, p[1] + ((q[1] - p[1]) * (x0 - p[0])) / (q[0] - p[0])]], [(p) => p[0] <= x1, (p, q) => [x1, p[1] + ((q[1] - p[1]) * (x1 - p[0])) / (q[0] - p[0])]], [(p) => p[1] >= z0, (p, q) => [p[0] + ((q[0] - p[0]) * (z0 - p[1])) / (q[1] - p[1]), z0]], [(p) => p[1] <= z1, (p, q) => [p[0] + ((q[0] - p[0]) * (z1 - p[1])) / (q[1] - p[1]), z1]]];
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length], pi = inside(p), qi = inside(q);
      if (pi) out.push(p);
      if (pi !== qi) out.push(cut(p, q));
    }
    pts = out;
  }
  return pts.length >= 3 ? Float64Array.from(pts.flat()) : null;
}
const boxOf = (a) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let k = 0; k < a.length; k += 2) { x0 = Math.min(x0, a[k]); x1 = Math.max(x1, a[k]); z0 = Math.min(z0, a[k + 1]); z1 = Math.max(z1, a[k + 1]); } return { x0, z0, x1, z1 }; };

// ---------------- the tiles ----------------
const tiles = [];
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) tiles.push({ i, j, x0: -SIZE / 2 + i * TILE, z0: -SIZE / 2 + j * TILE, size: TILE, layers: {} });
const tileAt = (x, z) => { const i = Math.floor((x + SIZE / 2) / TILE), j = Math.floor((z + SIZE / 2) / TILE); return i >= 0 && j >= 0 && i < N && j < N ? tiles[j * N + i] : null; };
const push = (t, name, f) => (t.layers[name] ??= []).push(f);
const stats = {};
const count = (k, n = 1) => { stats[k] = (stats[k] ?? 0) + n; };

// Lines go to the tile their middle point is in (not clipped: a road may run a little past its tile).
function addLines(name, recs, classOf, { tol = 1, nameOf } = {}) {
  for (const r of recs) {
    const c = classOf(r.attrs);
    if (c < 0) continue;
    for (const p of r.parts) {
      const a = simplify(toGame(p), tol), m = Math.floor(a.length / 4) * 2, t = tileAt(a[m], a[m + 1]);
      if (!t) continue;
      const f = { c, parts: [a] }, nm = nameOf?.(r.attrs);
      if (nm) f.name = nm;
      push(t, name, f);
      count(name);
    }
  }
}
// Polygons are clipped to every tile they cross (the sea and big woods cross many). Rings with
// their holes: a shapefile's outer rings run clockwise (in grid east, north).
function addPolys(name, recs, classOf, { tol = 1, minArea = 0, nameOf } = {}) {
  for (const r of recs) {
    const c = classOf(r.attrs);
    if (c < 0) continue;
    const rings = r.parts.map((p) => { const a = simplify(toGame(p), tol); return { a, hole: false }; });
    // (in game x, z the clockwise-in-grid outer rings come out anticlockwise: positive area2 is an outer ring)
    for (const g of rings) g.hole = area2(g.a) < 0;
    const outer = rings.filter((g) => !g.hole);
    if (!outer.length || outer.reduce((s, g) => s + area2(g.a), 0) < minArea) continue;
    const b = boxOf(r.parts.length === 1 ? rings[0].a : Float64Array.from(rings.flatMap((g) => [...g.a])));
    const nm = nameOf?.(r.attrs);
    const ti0 = Math.max(0, Math.floor((b.x0 + SIZE / 2) / TILE)), ti1 = Math.min(N - 1, Math.floor((b.x1 + SIZE / 2) / TILE));
    const tj0 = Math.max(0, Math.floor((b.z0 + SIZE / 2) / TILE)), tj1 = Math.min(N - 1, Math.floor((b.z1 + SIZE / 2) / TILE));
    for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) {
      const t = tiles[tj * N + ti], whole = b.x0 >= t.x0 && b.x1 <= t.x0 + TILE && b.z0 >= t.z0 && b.z1 <= t.z0 + TILE;
      const parts = [], holes = [];
      for (const g of rings) {
        const a = whole ? g.a : clipRing(g.a, t.x0, t.z0, t.x0 + TILE, t.z0 + TILE);
        if (!a || Math.abs(area2(a)) < 1) continue;
        parts.push(a); holes.push(g.hole);
      }
      if (!holes.some((h) => !h)) continue;
      const f = { c, parts };
      if (holes.some(Boolean)) f.holes = holes;
      if (nm) f.name = nm;
      push(t, name, f);
      count(name);
    }
  }
}

log('region', R.name, `${SIZE / 1000} km`, 'grid tiles', letters.join(' '));
// roads
const ROAD = { 'Motorway': 'motorway', 'Primary Road': 'primary', 'A Road': 'a', 'B Road': 'b', 'Minor Road': 'minor', 'Local Road': 'local', 'Local Access Road': 'access', 'Restricted Local Access Road': 'restricted', 'Shared Use Carriageway': 'shared' };
const roads = layer('Road');
addLines('roads', roads, (a) => {
  const [base, dual] = a.CLASSIFICA.split(', ');
  const k = F.ROAD_CLASSES.indexOf(ROAD[base]);
  if (k < 0) { count('roads:unknown'); return -1; }
  return k + (dual ? F.DUAL : 0) + (a.DRAWLEVEL === '1' ? F.RAISED : 0);
}, { tol: 0.75, nameOf: (a) => [a.ROADNUMBER, a.DISTNAME].filter(Boolean).join(' ') || undefined });
log('roads', stats.roads);
// railways (tunnels are their own layer in OML: marked as tunnel classes here)
const RAIL = { 'Multi Track': 0, 'Single Track': 1, 'Narrow Gauge': 2 };
addLines('rail', layer('RailwayTrack'), (a) => RAIL[a.CLASSIFICA] ?? -1, { tol: 0.5 });
addLines('rail', layer('RailwayTunnel'), () => 3, { tol: 0.5 });
log('rail', stats.rail);
// buildings, with the important ones' themes from their own layer (matched by the point inside)
const THEME = { 'Education': 'education', 'Religious Buildings': 'religious', 'Medical Care': 'medical', 'Sports Or Exercise Facility': 'sport', 'Retail': 'retail', 'Cultural Facility': 'culture', 'Air Transport': 'transport', 'Road Transport': 'transport', 'Water Transport': 'transport', 'Emergency Service': 'emergency', 'Attraction And Leisure': 'leisure' };
const important = layer('ImportantBuilding').map((r) => ({ c: F.BUILDING_CLASSES.indexOf(THEME[r.attrs.BUILDGTHEM] ?? 'building'), name: r.attrs.DISTNAME, a: r.parts.map(toGame) }));
const byTheme = new Map();
for (const b of important) for (const a of b.a) { const x = a.reduce((s, v, k) => (k % 2 ? s : s + v), 0) / (a.length / 2), z = a.reduce((s, v, k) => (k % 2 ? s + v : s), 0) / (a.length / 2); byTheme.set(`${Math.round(x / 4)},${Math.round(z / 4)}`, b); }
// (OML's important buildings are the same footprints as its buildings: match by centroid, 4 m cells)
const bcentre = (a) => { let x = 0, z = 0; for (let k = 0; k < a.length; k += 2) { x += a[k]; z += a[k + 1]; } return [x / (a.length / 2), z / (a.length / 2)]; };
addPolys('buildings', layer('Building'), () => 0, { tol: 0.3, minArea: 6 });
addPolys('buildings', layer('Glasshouse'), () => F.BUILDING_CLASSES.indexOf('glasshouse'), { tol: 0.3 });
for (const t of tiles) for (const f of t.layers.buildings ?? []) {
  const [x, z] = bcentre(f.parts[0]);
  for (let dx = -1; dx <= 1 && !f.name; dx++) for (let dz = -1; dz <= 1 && !f.name; dz++) {
    const b = byTheme.get(`${Math.round(x / 4) + dx},${Math.round(z / 4) + dz}`);
    if (b) { f.c = b.c; if (b.name) f.name = b.name; count('buildings:named'); }
  }
}
log('buildings', stats.buildings);
// water, the sea, the foreshore, woods
addPolys('water', layer('SurfaceWater_Area'), () => 0, { tol: 1 });
addLines('streams', layer('SurfaceWater_Line'), () => 0, { tol: 1.5 });
addPolys('sea', layer('TidalWater'), () => 0, { tol: 1.5 });
addPolys('foreshore', layer('Foreshore'), () => 0, { tol: 1.5 });
addPolys('woods', layer('Woodland'), () => 0, { tol: 2.5, minArea: 50 });
log('water', stats.water, 'sea', stats.sea, 'woods', stats.woods);
// rivers (OS Open Rivers centre lines), each as wide as the water it runs down: sampled every
// 15 m, twice the distance to the nearest bank where the point is in a water polygon; the median
{
  const polys = [];
  for (const t of tiles) for (const k of ['water', 'sea']) for (const f of t.layers[k] ?? []) polys.push(f);
  const C = 100, edges = new Map();
  polys.forEach((f, fi) => { for (const a of f.parts) for (let k = 0; k < a.length; k += 2) {
    const j = (k + 2) % a.length, x0 = Math.min(a[k], a[j]), x1 = Math.max(a[k], a[j]), z0 = Math.min(a[k + 1], a[j + 1]), z1 = Math.max(a[k + 1], a[j + 1]);
    // (the tile edge a clipped polygon was cut along isn't a bank)
    const t = tileAt((a[k] + a[j]) / 2, (a[k + 1] + a[j + 1]) / 2);
    const cut = t && ((a[k] === a[j] && (Math.abs(a[k] - t.x0) < 0.01 || Math.abs(a[k] - t.x0 - TILE) < 0.01)) || (a[k + 1] === a[j + 1] && (Math.abs(a[k + 1] - t.z0) < 0.01 || Math.abs(a[k + 1] - t.z0 - TILE) < 0.01)));
    for (let ci = Math.floor(x0 / C); ci <= Math.floor(x1 / C); ci++) for (let cj = Math.floor(z0 / C); cj <= Math.floor(z1 / C); cj++) { const key = ci * 100000 + cj; (edges.get(key) ?? edges.set(key, []).get(key)).push([a[k], a[k + 1], a[j], a[j + 1], fi, cut]); }
  } });
  const inside = (x, z) => { // crossings of edges to the east, in this cell row: even-odd per polygon
    const cj = Math.floor(z / C), counts = new Map();
    for (let ci = Math.floor(x / C); ci < Math.floor(x / C) + 60; ci++) for (const [ax, az, bx, bz, fi] of edges.get(ci * 100000 + cj) ?? []) {
      if ((az > z) === (bz > z)) continue;
      const xc = ax + ((z - az) * (bx - ax)) / (bz - az);
      if (xc > x && Math.floor(xc / C) === ci) counts.set(fi, (counts.get(fi) ?? 0) + 1);
    }
    for (const n of counts.values()) if (n % 2) return true;
    return false;
  };
  const bank = (x, z, max = 400) => { let best = max;
    for (let r = 0; r * C <= best + C; r++) for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      for (const [ax, az, bx, bz, , cut] of edges.get((Math.floor(x / C) + di) * 100000 + Math.floor(z / C) + dj) ?? []) { if (cut) continue; const ux = bx - ax, uz = bz - az, L2 = ux * ux + uz * uz || 1, t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / L2)); best = Math.min(best, Math.hypot(x - ax - ux * t, z - az - uz * t)); } }
    return best; };
  const FORM = { inlandRiver: 0, tidalRiver: 1, canal: 2, lake: 3 };
  for (const r of layer('WatercourseLink')) for (const p of r.parts) {
    const a = simplify(toGame(p), 1.5), ws = [];
    for (let k = 0; k + 2 < a.length; k += 2) {
      const L = Math.hypot(a[k + 2] - a[k], a[k + 3] - a[k + 1]);
      for (let s = 0; s < L; s += 15) { const x = a[k] + ((a[k + 2] - a[k]) * s) / L, z = a[k + 1] + ((a[k + 3] - a[k + 1]) * s) / L; ws.push(inside(x, z) ? 2 * bank(x, z) : 0); }
    }
    ws.sort((u, v) => u - v);
    const w = Math.min(255, Math.round(ws[Math.floor(ws.length / 2)] ?? 0));
    const m = Math.floor(a.length / 4) * 2, t = tileAt(a[m], a[m + 1]);
    if (!t) continue;
    const f = { c: (FORM[r.attrs.form] ?? 0) + F.WIDTH * w, parts: [a] };
    if (r.attrs.name1) f.name = r.attrs.name1;
    push(t, 'rivers', f); count('rivers');
  }
  log('rivers', stats.rivers);
}
// functional sites (schools, hospitals…) and green space
const SITE = (c) => /University/.test(c) ? 'university' : /Further/.test(c) ? 'college' : /Education/.test(c) ? 'school' : /Hospital/.test(c) ? 'hospital' : /Medical|Hospice/.test(c) ? 'care' : /Transport|Ferry|Airport|Bus|Coach|Port|Helicopter|Road User/.test(c) ? 'transport' : 'other';
addPolys('sites', layer('FunctionalSite'), (a) => F.SITE_CLASSES.indexOf(SITE(a.CLASSIFICA)), { tol: 1, nameOf: (a) => a.DISTNAME || undefined });
const GREEN = { 'Public Park Or Garden': 'park', 'Playing Field': 'playing', 'Golf Course': 'golf', 'Allotments Or Community Growing Spaces': 'allotment', 'Cemetery': 'cemetery', 'Religious Grounds': 'religious', 'Play Space': 'play', 'Other Sports Facility': 'sport', 'Bowling Green': 'bowls', 'Tennis Court': 'tennis' };
addPolys('green', layer('GreenspaceSite'), (a) => F.GREEN_CLASSES.indexOf(GREEN[a.function] ?? 'other'), { tol: 1, nameOf: (a) => a.distName1 || undefined });
log('green', stats.green);
// points: stations, roundabouts, motorway junctions
const stations = [];
for (const r of layer('RailwayStation')) {
  const x = gx(r.parts[0][0]), z = gz(r.parts[0][1]), t = tileAt(x, z);
  if (!t) continue;
  push(t, 'points', { c: 0, name: r.attrs.DISTNAME, parts: [Float64Array.of(x, z)] });
  stations.push({ name: r.attrs.DISTNAME, x: Math.round(x), z: Math.round(z) });
}
for (const [L, c, nm] of [['Roundabout', 1, () => undefined], ['MotorwayJunction', 2, (a) => `J${a.JUNCTNUM}`]]) {
  for (const r of layer(L)) { const x = gx(r.parts[0][0]), z = gz(r.parts[0][1]), t = tileAt(x, z); if (t) push(t, 'points', { c, name: nm(r.attrs), parts: [Float64Array.of(x, z)] }); }
}
log('stations', stations.length);

// ---------------- heights (Terrain 50) ----------------
// posts every 50 m over the whole square (n × n, shared along tile edges), from the 10 km ASCII
// grids that cover it; a post off the data (out at sea past the tiles OS publishes) reads 0
const HN = SIZE / STEP + 1, H = new Float32Array(HN * HN).fill(NaN);
{
  // the 50 m cells round the square (one more each way than the posts): cell (ci, cj) has its
  // north-west corner at post (ci − 1, cj − 1); each post is the mean of the four cells round it
  const CN = HN + 1, G = new Float32Array(CN * CN).fill(NaN), NT = N0 + SIZE;
  const want = new Set();
  for (let e = Math.floor((E0 - 50) / 10000) * 10000; e < E0 + SIZE + 50; e += 10000) for (let n = Math.floor((N0 - 50) / 10000) * 10000; n < N0 + SIZE + 50; n += 10000) want.add(tile10(e, n));
  const inZip = execFileSync('unzip', ['-Z1', t50]).toString().split('\n');
  for (const w of want) {
    const z = inZip.find((f) => f.toLowerCase().includes(`/${w.slice(0, 2)}/${w}_`));
    if (!z) continue;
    unzip(t50, z);
    unzip(join(X, z), '*.asc');
    const asc = find(X, new RegExp(`^${w}\\.asc$`, 'i'))[0];
    if (!asc) continue;
    const lines = readFileSync(asc, 'latin1').split('\n');
    const hd = {};
    let k = 0;
    for (; k < 6 && /^[a-z]/i.test(lines[k]); k++) { const [a, b] = lines[k].trim().split(/\s+/); hd[a.toLowerCase()] = Number(b); }
    const nc = hd.ncols, nr = hd.nrows, cs = hd.cellsize, xll = hd.xllcorner, yll = hd.yllcorner;
    for (let r = 0; r < nr; r++) {
      const vals = lines[k + r].trim().split(/\s+/).map(Number);
      const north = yll + (nr - r) * cs; // (the cell's north edge)
      const cj = Math.round((NT - north) / STEP) + 1;
      if (cj < 0 || cj >= CN) continue;
      for (let c = 0; c < nc; c++) {
        const ci = Math.round((xll + c * cs - E0) / STEP) + 1;
        if (ci >= 0 && ci < CN) G[cj * CN + ci] = vals[c];
      }
    }
    rmSync(asc);
  }
  for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    let s = 0, m = 0;
    for (const k of [j * CN + i, j * CN + i + 1, (j + 1) * CN + i, (j + 1) * CN + i + 1]) if (!Number.isNaN(G[k])) { s += G[k]; m++; }
    if (m) H[j * HN + i] = s / m;
  }
  // the edge posts (east and south, past the last cell) and any gaps: the nearest known neighbour
  for (let pass = 0; pass < 4; pass++) for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
    const k = j * HN + i;
    if (!Number.isNaN(H[k])) continue;
    const ns = [i > 0 ? H[k - 1] : NaN, j > 0 ? H[k - HN] : NaN, i + 1 < HN ? H[k + 1] : NaN, j + 1 < HN ? H[k + HN] : NaN].filter((v) => !Number.isNaN(v));
    if (ns.length) H[k] = ns[0];
  }
  let missing = 0;
  for (let k = 0; k < H.length; k++) if (Number.isNaN(H[k])) { H[k] = 0; missing++; }
  stats.heightsMissing = missing;
  let lo = Infinity, hi = -Infinity;
  for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  stats.heightMin = lo; stats.heightMax = hi;
  const P = TILE / STEP + 1;
  for (const t of tiles) {
    const h = new Float32Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) h[j * P + i] = H[(t.j * (P - 1) + j) * HN + t.i * (P - 1) + i];
    t.heights = { x0: t.x0, z0: t.z0, step: STEP, n: P, h };
  }
  log('heights', `${lo}–${hi} m`, missing ? `${missing} posts missing` : '');
}

// ---------------- the open sea ----------------
// OS tidal water stops at the edge of the 5 km squares it's drawn in; a tile wholly offshore (no
// land feature, and its heights all at sea level or under) is sea from edge to edge.
for (const t of tiles) {
  if (t.layers.sea?.length) continue;
  const land = ['buildings', 'roads', 'rail', 'woods', 'water', 'streams', 'green', 'foreshore'].some((k) => t.layers[k]?.length);
  if (land || t.heights.h.some((v) => v > 1)) continue;
  push(t, 'sea', { c: 1, parts: [Float64Array.of(t.x0, t.z0, t.x0, t.z0 + TILE, t.x0 + TILE, t.z0 + TILE, t.x0 + TILE, t.z0)] });
  count('sea:open');
}

// ---------------- places (Open Names) ----------------
const places = [];
{
  const csvs = execFileSync('unzip', ['-Z1', names]).toString().split('\n').filter((f) => new RegExp(`Data/(${letters.join('|')})\\d\\d\\.csv$`, 'i').test(f));
  const KIND = { City: 'city', Town: 'town', Village: 'village', Hamlet: 'hamlet', 'Suburban Area': 'suburb' };
  for (const f of csvs) {
    const text = execFileSync('unzip', ['-p', names, f], { maxBuffer: 1 << 28 }).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('populatedPlace')) continue;
      const c = csvSplit(line), kind = KIND[c[7]];
      if (!kind) continue;
      // (a Welsh place's English name, where it has one)
      const e = Number(c[8]), n = Number(c[9]);
      if (e < E0 || e >= E0 + SIZE || n < N0 || n >= N0 + SIZE) continue;
      const w = Number(c[14]) - Number(c[12]), h = Number(c[15]) - Number(c[13]);
      places.push({ name: c[3] === 'cym' && c[4] ? c[4] : c[2], kind, x: Math.round(gx(e)), z: Math.round(gz(n)), r: Math.round(Math.max(60, Math.sqrt(Math.max(1, w * h)) / 2)), buildings: 0, people: 0 });
    }
  }
  // buildings and people: each building of a house's size or more counts to its nearest place
  // within reach (a city's or town's suburbs are their own places in Open Names, so they add up
  // to the town they're part of when they're inside its extent)
  const grid = new Map(), C = 2000;
  places.forEach((p, k) => { const key = `${Math.floor(p.x / C)},${Math.floor(p.z / C)}`; (grid.get(key) ?? grid.set(key, []).get(key)).push(k); });
  for (const t of tiles) for (const f of t.layers.buildings ?? []) {
    const a = Math.abs(area2(f.parts[0]));
    if (a < 30) continue;
    const [x, z] = bcentre(f.parts[0]);
    let best = -1, bd = Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const k of grid.get(`${Math.floor(x / C) + di},${Math.floor(z / C) + dj}`) ?? []) {
      const p = places[k], d = Math.hypot(p.x - x, p.z - z) / (p.r + 150);
      if (d < 1.4 && d < bd) { bd = d; best = k; }
    }
    if (best >= 0) { places[best].buildings++; places[best].area = (places[best].area ?? 0) + a; }
  }
  // (fold suburbs into the city or town whose extent they're in)
  for (const s of places.filter((p) => p.kind === 'suburb')) {
    const host = places.filter((p) => p.kind === 'city' || p.kind === 'town').sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) / a.r - Math.hypot(b.x - s.x, b.z - s.z) / b.r)[0];
    if (host && Math.hypot(host.x - s.x, host.z - s.z) < host.r * 1.3) { host.buildings += s.buildings; host.area = (host.area ?? 0) + (s.area ?? 0); s.buildings = 0; s.area = 0; }
  }
  // (OML merges a terrace into one footprint, so people come from the footprint area: see
  // M2_PER_PERSON in src/proto/real/priors.ts)
  for (const p of places) { p.people = Math.round((p.area ?? 0) / M2_PER_PERSON / 10) * 10; p.area = Math.round(p.area ?? 0); }
  places.sort((a, b) => b.people - a.people);
  log('places', places.length, places.slice(0, 8).map((p) => `${p.name} ${p.people}`).join(', '));
}

// ---------------- write ----------------
const OUT = join(ROOT, 'public/regions', id);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 't'), { recursive: true });
let bytes = 0;
const names2 = [];
for (const t of tiles) {
  const b = F.encodeTile(t);
  writeFileSync(join(OUT, F.tileFile(t.i, t.j)), b);
  bytes += b.length;
  names2.push(`${t.i}-${t.j}`);
}
const centre = gridToLatLon(EC, NC);
const year = new Date().getFullYear();
const manifest = {
  format: F.FORMAT, id, name: R.name, blurb: R.blurb, size: SIZE, tile: TILE, n: N, step: STEP,
  grid: { e: EC, n: NC }, centre: { lat: +centre.lat.toFixed(5), lon: +centre.lon.toFixed(5) },
  places: places.filter((p) => p.kind !== 'suburb' || p.buildings > 0), stations, home: R.home,
  attribution: `Contains OS data © Crown copyright and database right ${year}`,
  licence: 'Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)',
  sources: ['OS OpenMap - Local', 'OS Terrain 50', 'OS Open Names', 'OS Open Greenspace'],
  stats, tiles: names2, bytes,
};
writeFileSync(join(OUT, 'region.json'), JSON.stringify(manifest, null, 1));
log('wrote', OUT, `${(bytes / 1e6).toFixed(2)} MB in ${tiles.length} tiles`);
rmSync(X, { recursive: true, force: true });
if (!KEEP) { for (const f of readdirSync(CACHE)) rmSync(join(CACHE, f), { recursive: true, force: true }); log('deleted the raw downloads'); }

// ---------------- small things ----------------
// the 100 km grid squares (two letters) a box touches
function gridLetters([e0, n0, e1, n1]) {
  const out = new Set();
  for (let e = Math.floor(e0 / 1e5) * 1e5; e < e1; e += 1e5) for (let n = Math.floor(n0 / 1e5) * 1e5; n < n1; n += 1e5) out.add(tile100(e, n));
  return [...out];
}
function tile100(e, n) {
  const E = Math.floor(e / 1e5), Nn = Math.floor(n / 1e5);
  let l1 = 19 - Nn - ((19 - Nn) % 5) + Math.floor((E + 10) / 5);
  let l2 = (((19 - Nn) * 5) % 25) + (E % 5);
  if (l1 > 7) l1++;
  if (l2 > 7) l2++;
  return String.fromCharCode(65 + l1) + String.fromCharCode(65 + l2);
}
function tile10(e, n) { return (tile100(e, n) + Math.floor((e % 1e5) / 1e4) + Math.floor((n % 1e5) / 1e4)).toLowerCase(); }
function csvSplit(line) {
  const out = [];
  let cur = '', q = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (q) { if (ch === '"') { if (line[k + 1] === '"') { cur += '"'; k++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur.replace(/\r$/, ''));
  return out;
}
