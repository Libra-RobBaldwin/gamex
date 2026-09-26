// A real region as a 50 km map's source (worldmap/source.ts, docs/real.md "On the 50 km map"): the
// same WorldPlan a seeded map makes, from the bake (tools/os/bake.mjs) instead of the generator, so
// a real region is drawn, streamed and played through the one WORLD pipeline.
//
//   - places: OS Open Names' cities, towns and villages, sized by the people the bake counted in them;
//   - the land: OS Terrain 50, with rivers' floors and lakes' shores laid at their water;
//   - the sea: OS OpenMap Local's tidal water, as a coarse signed distance to the coast (the plan's
//     water reads it as it reads a seeded map's coarse land);
//   - rivers: OS Open Rivers at their measured widths, their water falling downstream;
//   - roads and railways: OS OpenMap Local's, by class (A, B and minor roads; the railways);
//   - woods: OpenMap Local's woodland.
//
// The region is shifted so its home place is at 0, 0 (the bake centres the square on it). Importing
// this file registers it (setRealSource), on the main thread and in the tile worker alike.
import { decodeTile, tileFile, RAIL_CLASSES, ROAD_CLASSES, type RegionManifest, type Tile } from './format';
import { waterOf, type RealRegion } from './map';
import { field as reliefField, type ReliefField } from '../region/terrain';
import { LEVEL, RIM, type XZ } from '../region/water';
import { regionOptions, type RegionOptions } from '../region/options';
import type { Kind } from '../region/generate';
import { setRealSource, type Box, type WorldHeights, type WorldSource } from '../worldmap/source';
import { WorldWater, riverFloor, type WorldRiver } from '../worldmap/water';
import { resample, STEP, type Rail, type Route, type RouteKind } from '../worldmap/routes';
import type { CoarseLand } from '../worldmap/landform';
import type { WorldSettlement } from '../worldmap/plan';

// what a source needs of the bake: the manifest and every tile (fetched, or read from disk in node)
export type RegionReader = (id: string) => Promise<RealRegion>;

// ---------------- places ----------------
// how much of a place is built up, from the people living in it (about 250 m² of town a head, from
// the bake's buildings; never more than Open Names' own extent)
const M2_A_HEAD = 250;
export function realPlaces(M: RegionManifest, home: XZ): WorldSettlement[] {
  const out: WorldSettlement[] = [];
  const homeP = M.places.find((p) => p.name === M.home) ?? M.places[0];
  const kinds = new Map<string, Kind>([['city', 'city'], ['town', 'town'], ['village', 'village'], ['hamlet', 'village']]);
  const kept: typeof M.places = [];
  for (const p of [homeP, ...M.places.filter((q) => q !== homeP).sort((a, b) => b.people - a.people)]) {
    const kind = kinds.get(p.kind);
    if (!kind || (p.kind === 'hamlet' && p.people < 150) || (p !== homeP && p.people < 60)) continue;
    // (a village inside a city's extent is one of its suburbs: the city's people, not its own place)
    if (kept.some((q) => q.people > p.people && Math.hypot(q.x - p.x, q.z - p.z) < q.r * 0.9)) continue;
    kept.push(p);
    const r = Math.round(Math.max(kind === 'village' ? 110 : 230, Math.min(p.r, Math.sqrt((p.people * M2_A_HEAD) / Math.PI))));
    const id = out.length;
    out.push({ id, name: p.name, kind, x: p.x - home.x, z: p.z - home.z, r, axis: 0, plan: 'organic', seed: (hash(p.name) % 100000) / 100000, gates: [], pop: p.people, reach: Math.round(r * 1.25) });
  }
  return out;
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };

// ---------------- the land and the sea ----------------
// The coarse land a real region's water reads (worldmap/water.ts WorldWater): the heights on its
// grid, and the signed distance to the coast (+ inland, − at sea) from the tidal water's polygons.
export const COARSE = 100; // m
export function realLand(R: RealRegion, home: XZ, half: number): CoarseLand {
  const C = COARSE, x0 = -half - C, n = Math.round((2 * half + 2 * C) / C) + 1, NN = n * n;
  const tidal = new Uint8Array(NN), wet = new Uint8Array(NN);
  // (each tidal water polygon filled on the grid, even-odd over its rings: OpenMap Local's tidal
  // water is only the strip along the shore and up the estuaries)
  for (const t of R.tiles) for (const f of t.layers.sea ?? []) fillRings(tidal, n, x0, C, f.parts, home);
  const H = rawHeights(R, home, half, C), h = new Float32Array(NN);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = H(x0 + i * C, x0 + j * C);
  // the sea: the tidal water, and the ground at sea level (Terrain 50's sea is 0 or below) that
  // reaches it or the map's edge (a hollow inland at sea level stays land)
  const low = (k: number) => tidal[k] || h[k] <= 0.2, q: number[] = [];
  for (let k = 0; k < NN; k++) { const i = k % n, j = (k / n) | 0; if (tidal[k] || (low(k) && (i === 0 || j === 0 || i === n - 1 || j === n - 1))) { wet[k] = 1; q.push(k); } }
  while (q.length) {
    const k = q.pop()!, i = k % n;
    for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (m >= 0 && m < NN && !wet[m] && low(m)) { wet[m] = 1; q.push(m); }
  }
  // a chamfer distance from the coast either way
  const inl = chamfer(wet, n, C, 0), out = chamfer(wet, n, C, 1), sea = new Float32Array(NN);
  for (let k = 0; k < NN; k++) sea[k] = wet[k] ? -Math.max(C / 2, out[k] - C / 2) : Math.max(C / 2, inl[k] - C / 2);
  let max = 0;
  for (let k = 0; k < NN; k++) { const v = h[k]; if (wet[k]) h[k] = Math.min(0, v) - 5; if (v > max) max = v; }
  return { x0, z0: x0, cell: C, n, h, sea, lake: new Int16Array(NN).fill(-1), rock: new Uint8Array(NN).fill(5), relief: new Float32Array(NN).fill(30), rivers: [], lakes: [], landform: 'estuary', side: mainSide(wet, n), max, ms: 0 };
}
// fill `grid` (n × n posts from x0, `C` apart) where a point is inside the rings (region coordinates,
// shifted by `home`)
function fillRings(grid: Uint8Array, n: number, x0: number, C: number, parts: Float64Array[], home: XZ) {
  let zmin = Infinity, zmax = -Infinity;
  for (const a of parts) for (let k = 1; k < a.length; k += 2) { zmin = Math.min(zmin, a[k] - home.z); zmax = Math.max(zmax, a[k] - home.z); }
  const j0 = Math.max(0, Math.ceil((zmin - x0) / C)), j1 = Math.min(n - 1, Math.floor((zmax - x0) / C));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const z = x0 + j * C;
    xs.length = 0;
    for (const a of parts) {
      const m = a.length / 2;
      for (let p = 0, q = m - 1; p < m; q = p++) {
        const za = a[2 * p + 1] - home.z, zb = a[2 * q + 1] - home.z;
        if ((za > z) === (zb > z)) continue;
        const xa = a[2 * p] - home.x, xb = a[2 * q] - home.x;
        xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
    }
    xs.sort((u, v) => u - v);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / C)), i1 = Math.min(n - 1, Math.floor((xs[k + 1] - x0) / C));
      for (let i = i0; i <= i1; i++) grid[j * n + i] ^= 1;
    }
  }
}
// distance (m) from each post to the nearest post whose `grid` value isn't `v` (0 on those)
function chamfer(grid: Uint8Array, n: number, C: number, v: number) {
  const d = new Float32Array(n * n), D = C * Math.SQRT2;
  for (let k = 0; k < d.length; k++) d[k] = grid[k] === v ? 1e7 : 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i; let x = d[k];
    if (i > 0) x = Math.min(x, d[k - 1] + C);
    if (j > 0) { x = Math.min(x, d[k - n] + C); if (i > 0) x = Math.min(x, d[k - n - 1] + D); if (i < n - 1) x = Math.min(x, d[k - n + 1] + D); }
    d[k] = x;
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i; let x = d[k];
    if (i < n - 1) x = Math.min(x, d[k + 1] + C);
    if (j < n - 1) { x = Math.min(x, d[k + n] + C); if (i < n - 1) x = Math.min(x, d[k + n + 1] + D); if (i > 0) x = Math.min(x, d[k + n - 1] + D); }
    d[k] = x;
  }
  for (let k = 0; k < d.length; k++) if (d[k] > 1e6) d[k] = 1e6;
  return d;
}
// the side of the map most of the sea lies on (null: none)
function mainSide(wet: Uint8Array, n: number): CoarseLand['side'] {
  const c = { n: 0, s: 0, e: 0, w: 0 };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (wet[j * n + i]) { const u = i / n - 0.5, v = j / n - 0.5; if (Math.abs(u) > Math.abs(v)) c[u > 0 ? 'e' : 'w']++; else c[v > 0 ? 's' : 'n']++; }
  const best = (Object.entries(c) as [keyof typeof c, number][]).sort((a, b) => b[1] - a[1])[0];
  return best[1] > n ? best[0] : null;
}
// The bake's heights (Terrain 50, on its 50 m grid) as a function of the map's x, z: bilinear
// between the posts, 0 off the region.
function rawHeights(R: RealRegion, home: XZ, _half: number, _C: number) {
  const M = R.manifest, byKey = new Map(R.tiles.map((t) => [`${t.i},${t.j}`, t]));
  const post = (x: number, z: number) => {
    const ti = Math.floor((x + M.size / 2) / M.tile), tj = Math.floor((z + M.size / 2) / M.tile);
    const t = byKey.get(`${Math.min(M.n - 1, Math.max(0, ti))},${Math.min(M.n - 1, Math.max(0, tj))}`)?.heights;
    if (!t) return 0;
    const a = Math.min(t.n - 1, Math.max(0, Math.round((x - t.x0) / t.step))), b = Math.min(t.n - 1, Math.max(0, Math.round((z - t.z0) / t.step)));
    return t.h[b * t.n + a];
  };
  const S = M.step;
  return (x: number, z: number) => {
    const X = x + home.x, Z = z + home.z, gx = Math.floor(X / S) * S, gz = Math.floor(Z / S) * S, fx = (X - gx) / S, fz = (Z - gz) / S;
    return (post(gx, gz) * (1 - fx) + post(gx + S, gz) * fx) * (1 - fz) + (post(gx, gz + S) * (1 - fx) + post(gx + S, gz + S) * fx) * fz;
  };
}

// ---------------- rivers ----------------
// Open Rivers at their measured widths (real/map.ts waterOf, over the whole square), each resampled
// to the plan's step, its water's level read off the heights along it and made never to rise
// downstream (the end that starts lower is its mouth).
export function realRivers(R: RealRegion, home: XZ, half: number, H: (x: number, z: number) => number): { rivers: WorldRiver[]; lakes: ReturnType<typeof waterOf>['lakes'] } {
  const w = waterOf(R, home, half + 500);
  const rivers: WorldRiver[] = [];
  for (const r of w.rivers) {
    let path = resample(r.path, STEP);
    if (path.length < 3) continue;
    let lv = path.map((p) => Math.max(LEVEL, H(p.x, p.z)));
    if (lv[0] < lv[lv.length - 1]) { path = path.reverse(); lv = lv.reverse(); }
    for (let i = 1; i < lv.length; i++) lv[i] = Math.min(lv[i], lv[i - 1]);
    rivers.push({ path, widths: path.map(() => r.width), levels: lv });
  }
  return { rivers, lakes: w.lakes.filter((l) => l.r >= 55) }; // (still water of a hectare or more: ponds are the ground's)
}

// ---------------- the heights ----------------
// The ground a real map stands on: Terrain 50, with each river's floor laid at its water and eased
// up to the land beside it (no steeper than about 1 in 14), as the seeded terrain does
// (worldmap/terrain.ts), and the sea's bed below its coast.
export class RealHeights implements WorldHeights {
  readonly top: number;
  constructor(private raw: (x: number, z: number) => number, private water: WorldWater, readonly half: number, top: number) { this.top = top; }
  heightAt = (x: number, z: number) => {
    const w = this.water;
    if (w.atSea(x, z)) return 0;
    let h = this.raw(x, z);
    const s = w.seaDistance(x, z, 400);
    if (s < 0) return 0;
    if (s < 200) h = Math.max(0, h) * smooth(0, 200, s);
    const r = w.riverAt(x, z);
    if (r) {
      const b = r.half + RIM + 20, f = smooth(b, b + Math.min(riverFloor(r.half) - 20, Math.max(70, 3 * r.half, (h - r.level) * 14)), r.d);
      h = r.level + (Math.max(h, r.level) - r.level) * f;
    }
    return Math.max(0, h);
  };
  bed = (x: number, z: number) => {
    const w = this.water;
    let h = Math.min(0, w.lakesGround(x, z));
    if (w.atSea(x, z)) return LEVEL - 7;
    const d = w.seaDistance(x, z, 600);
    if (d < 12) h = Math.min(h, d > 0 ? LEVEL * (1 - d / 12) : LEVEL - Math.min(7, -d * 0.03 + 0.4));
    return h;
  };
  partField(box: Box, step = 50): ReliefField | null {
    const H = this.half + step, x0 = -Math.ceil(H / step) * step, n = Math.round((-2 * x0) / step) + 1, h = new Float32Array(n * n);
    const i0 = Math.max(0, Math.floor((box.x0 - x0) / step) - 1), i1 = Math.min(n - 1, Math.ceil((box.x1 - x0) / step) + 1);
    const j0 = Math.max(0, Math.floor((box.z0 - x0) / step) - 1), j1 = Math.min(n - 1, Math.ceil((box.z1 - x0) / step) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) h[j * n + i] = this.heightAt(x0 + i * step, x0 + j * step);
    return reliefField(x0, x0, step, n, h, this.top);
  }
  field(step = 50): ReliefField | null {
    const H = this.half + step, x0 = -Math.ceil(H / step) * step, n = Math.round((-2 * x0) / step) + 1, h = new Float32Array(n * n);
    let max = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = this.heightAt(x0 + i * step, x0 + j * step); h[j * n + i] = v; if (v > max) max = v; }
    return reliefField(x0, x0, step, n, h, max);
  }
}
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- roads and railways ----------------
// OpenMap Local's roads by class as the plan's routes (motorways; primary and A roads; B roads and
// minor roads, as the plan's B), joined end to end where one piece of a class meets the next (the
// bake cuts them at its tiles), resampled to the plan's step. A main road reaching the square's edge
// runs a little past it, so the edge finds its way off the map (game/portals.ts). The railways
// likewise, main lines (double track) and branches (single). Their ends aren't tied to places: the
// places' own streets meet them (plan.ts lays the gates).
const ROUTE_OF: Partial<Record<(typeof ROAD_CLASSES)[number], RouteKind>> = { motorway: 'motorway', primary: 'A', a: 'A', b: 'B', minor: 'B' };
export function realRoutes(R: RealRegion, home: XZ, half: number): { roads: Route[]; rails: Rail[] } {
  const pieces = new Map<string, XZ[][]>();
  const add = (k: string, a: Float64Array) => {
    const p: XZ[] = [];
    for (let i = 0; i < a.length; i += 2) p.push({ x: a[i] - home.x, z: a[i + 1] - home.z });
    if (p.length > 1) (pieces.get(k) ?? pieces.set(k, []).get(k)!).push(p);
  };
  for (const t of R.tiles) {
    for (const f of t.layers.roads ?? []) { const c = ROAD_CLASSES[f.c & 15], kind = ROUTE_OF[c]; if (kind) for (const a of f.parts) add(c === 'minor' ? 'minor' : kind, a); }
    for (const f of t.layers.rail ?? []) { const c = RAIL_CLASSES[f.c & 15]; if (c === 'multi' || c === 'single' || c === 'multi-tunnel' || c === 'single-tunnel') for (const a of f.parts) add(c.startsWith('multi') ? 'main' : 'branch', a); }
  }
  const roads: Route[] = [], rails: Rail[] = [];
  for (const [k, list] of pieces) for (const run of joinRuns(list)) for (let path of clipTo(resample(run, STEP), half, k === 'minor' ? 0 : 60)) {
    if (path.length < 3) continue;
    // (a main road or railway leaving the map runs on 60 m past its rim, where game/portals.ts makes
    // its way off the map; a minor road just stops there)
    if (k === 'main' || k === 'branch') { rails.push({ id: rails.length, kind: k, path, stations: [] }); continue; }
    // (a road's way off the map is at its far end, `b`: game/portals.ts; one leaving at both ends is two)
    const out = (q: XZ) => Math.max(Math.abs(q.x), Math.abs(q.z)) >= half, m = path.length >> 1;
    const parts = out(path[0]) && out(path[path.length - 1]) && path.length > 6 ? [path.slice(0, m + 1).reverse(), path.slice(m)] : [out(path[0]) ? [...path].reverse() : path];
    for (const q of parts) roads.push({ id: roads.length, kind: k === 'minor' ? 'B' : (k as RouteKind), path: q, a: null, b: null });
  }
  return { roads, rails };
}
// join polylines that meet end to end (within 2 m) into runs, the longest first
function joinRuns(list: XZ[][]): XZ[][] {
  const key = (p: XZ) => `${Math.round(p.x / 2)},${Math.round(p.z / 2)}`;
  const at = new Map<string, number[]>();
  list.forEach((l, i) => { for (const p of [l[0], l[l.length - 1]]) (at.get(key(p)) ?? at.set(key(p), []).get(key(p))!).push(i); });
  const used = new Uint8Array(list.length), out: XZ[][] = [];
  const grow = (run: XZ[]) => {
    for (;;) {
      const end = run[run.length - 1], next = (at.get(key(end)) ?? []).find((i) => !used[i]);
      if (next === undefined) return run;
      used[next] = 1;
      const l = list[next], fwd = key(l[0]) === key(end);
      run.push(...(fwd ? l : [...l].reverse()).slice(1));
    }
  };
  for (let i = 0; i < list.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const run = grow([...list[i]]);
    run.reverse();
    out.push(grow(run));
  }
  return out.sort((a, b) => b.length - a.length);
}
// A path cut into its pieces inside the map (|x|, |z| < half), each running `on` metres past the
// rim where it leaves the map (or comes in).
function clipTo(p: XZ[], half: number, on: number): XZ[][] {
  const inside = (q: XZ) => Math.max(Math.abs(q.x), Math.abs(q.z)) < half;
  const past = (a: XZ, b: XZ) => { const L = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: a.x + ((b.x - a.x) / L) * on, z: a.z + ((b.z - a.z) / L) * on }; };
  const out: XZ[][] = [];
  let run: XZ[] = [];
  for (let i = 0; i < p.length; i++) {
    if (inside(p[i])) {
      if (!run.length && i > 0 && on) run.push(past(p[i], p[i - 1]));
      run.push(p[i]);
    } else if (run.length) {
      if (on) run.push(past(p[i - 1], p[i]));
      out.push(run); run = [];
    }
  }
  if (run.length) out.push(run);
  return out;
}

// ---------------- woods ----------------
function realWoods(R: RealRegion, home: XZ) {
  const byTile = new Map<string, XZ[][]>();
  const M = R.manifest;
  for (const t of R.tiles) {
    const rings: XZ[][] = [];
    for (const f of t.layers.woods ?? []) for (const a of f.parts) { const r: XZ[] = []; for (let i = 0; i < a.length; i += 2) r.push({ x: a[i] - home.x, z: a[i + 1] - home.z }); if (r.length > 2) rings.push(r); }
    byTile.set(`${t.i},${t.j}`, rings);
  }
  return (box: Box): XZ[][] => {
    const out: XZ[][] = [];
    const i0 = Math.floor((box.x0 + home.x + M.size / 2) / M.tile), i1 = Math.floor((box.x1 + home.x + M.size / 2) / M.tile);
    const j0 = Math.floor((box.z0 + home.z + M.size / 2) / M.tile), j1 = Math.floor((box.z1 + home.z + M.size / 2) / M.tile);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const r of byTile.get(`${i},${j}`) ?? []) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of r) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z; }
      if (x1 >= box.x0 && x0 <= box.x1 && z1 >= box.z0 && z0 <= box.z1) out.push(r);
    }
    return out;
  };
}

// ---------------- the source ----------------
export async function realSource(id: string, o: RegionOptions, read: RegionReader): Promise<WorldSource> {
  const R = await read(id), M = R.manifest;
  const homeP = M.places.find((p) => p.name === M.home) ?? M.places[0], home = { x: homeP.x, z: homeP.z };
  const half = Math.floor((M.size / 2 - Math.max(Math.abs(home.x), Math.abs(home.z))) / 500) * 500; // (the square round the home place the bake covers)
  const land = realLand(R, home, half), raw = rawHeights(R, home, half, COARSE);
  const { rivers, lakes } = realRivers(R, home, half, raw);
  const water = new WorldWater({ sea: land.side ? { coast: [], side: land.side } : null, rivers, lakes }, land);
  const settlements = realPlaces(M, home).filter((s) => Math.max(Math.abs(s.x), Math.abs(s.z)) < half - 200 && (s.id === 0 || water.seaDistance(s.x, s.z, 300) > 50));
  settlements.forEach((s, k) => { s.id = k; });
  const routes = realRoutes(R, home, half);
  const options = regionOptions({ ...o, size: 50, seed: o.seed, sea: !!land.side, real: id });
  const heights = new RealHeights(raw, water, half, land.max + 5);
  return {
    kind: 'real', id, seed: options.seed, options, half, water, settlements,
    heights: () => heights,
    routes: () => ({ ...routes, links: [] }),
    industries: [], // (a real region's works come from its own sites: not yet)
    woods: realWoods(R, home),
  };
}

// ---------------- reading the bake ----------------
const regionCache = new Map<string, Promise<RealRegion>>();
// the bake over the network (the game: main thread and tile worker)
export const fetchRegion: RegionReader = (id) => {
  let p = regionCache.get(id);
  if (!p) {
    const base = `${import.meta.env?.BASE_URL ?? '/'}regions/${id}/`;
    p = (async () => {
      const got = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r; };
      const manifest = (await (await got(`${base}region.json`)).json()) as RegionManifest;
      const tiles: Tile[] = await Promise.all(manifest.tiles.map(async (name) => { const [i, j] = name.split('-').map(Number); return decodeTile(new Uint8Array(await (await got(base + tileFile(i, j))).arrayBuffer())); }));
      return { manifest, tiles };
    })();
    regionCache.set(id, p);
  }
  return p;
};
let reader: RegionReader = fetchRegion;
// (node's tests and tools read the bake from disk instead: real/node.ts)
export function setRegionReader(r: RegionReader) { reader = r; }
setRealSource((id, o) => realSource(id, o, reader));
