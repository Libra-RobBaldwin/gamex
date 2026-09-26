// A real region as a map the game can play (docs/real.md). The whole region (50 km) is baked;
// the game plays a window of it round a home place (6 km, as big as the engine takes today: the
// world-scale work streams the rest), with its real roads, railways, stations, buildings, rivers,
// lakes, woods and hills. Pure: no three.js, no DOM.
//
// Map coordinates are the window's: the region's metres, shifted so the window's centre is 0, 0.
// Contains OS data © Crown copyright and database right (the Open Government Licence).
import type { MapSpec, SettlementInfo } from '../region/mapspec';
import type { LakeSpec, RiverSpec } from '../region/water';
import { RIVER_FORMS, WIDTH, type Place, type RegionManifest, type Tile } from './format';
import { ringArea, toOverpass, type Box, type XZ } from './osm';
import { rng } from '../region/random';

export const WINDOW = 3000; // half the playable window (m): the region generator's size
export interface RealRegion { manifest: RegionManifest; tiles: Tile[] }
export interface HeightGrid { x0: number; z0: number; step: number; n: number; h: Float32Array }
export interface RealMap extends MapSpec {
  real: {
    region: string; // the region's id (public/regions/<id>)
    centre: XZ; // where the window's centre is in the region
    heights: HeightGrid; // the ground's real height (m), over the window and its margin
    overpass?: ReturnType<typeof toOverpass>; // roads, railways, stations and buildings, for the importer (made in the page when there's no pack)
    pack?: import('./live').LivePack; // the live area packed ahead of time (tools/os/pack.mjs, real/live.ts)
    green?: { c: number; rings: XZ[][]; holes: boolean[] }[];
    stations: { name: string; x: number; z: number }[]; // OS's railway stations in the window // OS Open Greenspace in the window: its parks (real/lay.ts greenRegions)
  };
}

// the tiles a box (in region metres) touches
export function tilesFor(m: RegionManifest, b: Box) {
  const out: [number, number][] = [];
  for (let j = 0; j < m.n; j++) for (let i = 0; i < m.n; i++) {
    const x0 = -m.size / 2 + i * m.tile, z0 = -m.size / 2 + j * m.tile;
    if (x0 <= b.x1 && x0 + m.tile >= b.x0 && z0 <= b.z1 && z0 + m.tile >= b.z0) out.push([i, j]);
  }
  return out;
}
export const homeOf = (m: RegionManifest, name = m.home) => m.places.find((p) => p.name === name) ?? m.places[0];
// the region box a window round `c` needs (its ground reaches half as far again, as a region map's does)
export const windowBox = (c: XZ, half = WINDOW, grow = 1.5): Box => ({ x0: c.x - half * grow, z0: c.z - half * grow, x1: c.x + half * grow, z1: c.z + half * grow });

const KIND: Partial<Record<Place['kind'], SettlementInfo['kind']>> = { city: 'city', town: 'town', village: 'village' };

export function realMap(R: RealRegion, o: { home?: string; half?: number } = {}): RealMap {
  const M = R.manifest, half = o.half ?? WINDOW, home = homeOf(M, o.home);
  const c = { x: home.x, z: home.z }, shift = { x: -c.x, z: -c.z };
  const at = (p: XZ) => ({ x: p.x - c.x, z: p.z - c.z });
  // the places in the window: cities, towns and villages (their suburbs are part of them)
  const places = M.places.filter((p) => KIND[p.kind] && Math.abs(p.x - c.x) < half && Math.abs(p.z - c.z) < half);
  const settlements: SettlementInfo[] = places.map((p, id) => ({ id, name: p.name, kind: KIND[p.kind]!, ...at(p), r: Math.min(p.r, p.kind === 'city' ? 2600 : p.kind === 'town' ? 1500 : 500) }));
  if (!settlements.length) settlements.push({ id: 0, name: home.name, kind: 'town', x: 0, z: 0, r: 400 });
  const inTown = (p: XZ) => settlements.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < s.r);
  const box: Box = { x0: -half + 40, z0: -half + 40, x1: half - 40, z1: half - 40 };
  const overpass = toOverpass(R.tiles, { box, shift, inTown });
  const heights = heightGrid(R, c, half * 1.5 + 100);
  const found = waterOf(R, c, half * 1.5);
  const { ground, water } = reliefOf(heights, found, half * 1.5);
  const treeSpots = treesIn(R, c, half * 1.5, M.id);
  const year = M.attribution.match(/\d{4}/)?.[0] ?? '';
  return {
    id: M.id,
    name: `${home.name} · ${M.name}`,
    seed: 1,
    bound: half,
    water,
    zones: [],
    settlements,
    streets: [],
    generated: false,
    links: [],
    view: { x: 0, z: 20, h: 420 },
    stops: [],
    line: [],
    industries: false,
    trees: { count: treeSpots.length, spots: treeSpots },
    style: 'temperate',
    relief: 'rolling',
    ground,
    placeBy: 'edge',
    credit: { text: `Contains OS data © Crown copyright and database right ${year}`, href: 'https://www.ordnancesurvey.co.uk/customers/public-sector/public-sector-licensing/copyright-acknowledgements' },
    real: {
      region: M.id, centre: c,
      heights, overpass, green: greenIn(R, c, half),
      stations: M.stations.map((st) => ({ name: st.name, x: st.x - c.x, z: st.z - c.z })).filter((st) => Math.abs(st.x) < half && Math.abs(st.z) < half),
    },
  };
}

// The real heights over a square round c (half `r`), on the bake's grid, shifted to the window.
export function heightGrid(R: RealRegion, c: XZ, r: number): HeightGrid {
  const M = R.manifest, step = M.step, x0 = Math.floor((c.x - r) / step) * step, z0 = Math.floor((c.z - r) / step) * step;
  const n = Math.ceil((2 * r) / step) + 2, h = new Float32Array(n * n);
  const byKey = new Map(R.tiles.map((t) => [`${t.i},${t.j}`, t]));
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * step, z = z0 + j * step;
    const ti = Math.min(M.n - 1, Math.max(0, Math.floor((x + M.size / 2) / M.tile))), tj = Math.min(M.n - 1, Math.max(0, Math.floor((z + M.size / 2) / M.tile)));
    const t = byKey.get(`${ti},${tj}`)?.heights;
    if (!t) continue;
    const a = Math.min(t.n - 1, Math.max(0, Math.round((x - t.x0) / step))), b = Math.min(t.n - 1, Math.max(0, Math.round((z - t.z0) / step)));
    h[j * n + i] = t.h[b * t.n + a];
  }
  return { x0: x0 - c.x, z0: z0 - c.z, step, n, h };
}

// ---------------- water ----------------
// Rivers from OS Open Rivers centre lines, as wide as the water they run down (the bake measured
// each link), chained end to end by name; a run keeps one width (its median), so it breaks where
// the width changes by more than half. Streams narrower than MIN_RIVER are left to the ground
// painter. Lakes: the still water no river runs through, as round lakes of the same area.
export const MIN_RIVER = 6;
export const MAX_RIVER = 90;
export function waterOf(R: RealRegion, c: XZ, r: number): { lakes: LakeSpec[]; rivers: RiverSpec[] } {
  const box: Box = { x0: c.x - r, z0: c.z - r, x1: c.x + r, z1: c.z + r };
  const inside = (x: number, z: number) => x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1;
  interface Link { name: string; form: string; w: number; p: XZ[] }
  const links: Link[] = [];
  for (const t of R.tiles) for (const f of t.layers.rivers ?? []) {
    const w = Math.floor(f.c / WIDTH), form = RIVER_FORMS[f.c % WIDTH];
    if (w < MIN_RIVER || form === 'lake') continue;
    const a = f.parts[0], p: XZ[] = [];
    for (let k = 0; k < a.length; k += 2) p.push({ x: a[k], z: a[k + 1] });
    if (!p.some((q) => inside(q.x, q.z))) continue;
    links.push({ name: f.name ?? '', form, w: Math.min(MAX_RIVER, w), p });
  }
  // chain links end to end: at each end, the link of the same name whose start is there
  const key = (q: XZ) => `${Math.round(q.x)},${Math.round(q.z)}`;
  const starts = new Map<string, Link[]>(), ends = new Set<string>();
  for (const l of links) { (starts.get(key(l.p[0])) ?? starts.set(key(l.p[0]), []).get(key(l.p[0]))!).push(l); ends.add(key(l.p[l.p.length - 1])); }
  const used = new Set<Link>(), runs: { w: number[]; p: XZ[] }[] = [];
  const heads = links.filter((l) => !ends.has(key(l.p[0])) || !links.some((m) => m !== l && m.name === l.name && key(m.p[m.p.length - 1]) === key(l.p[0])));
  for (const l0 of [...heads, ...links]) {
    if (used.has(l0)) continue;
    let l: Link | undefined = l0;
    const run = { w: [] as number[], p: [] as XZ[] };
    while (l && !used.has(l)) {
      used.add(l);
      const med = run.w.length ? [...run.w].sort((a, b) => a - b)[run.w.length >> 1] : l.w;
      if (run.w.length && (l.w > med * 1.5 || l.w < med / 1.5)) { runs.push(run); run.w = []; run.p = [run.p[run.p.length - 1]]; }
      run.p.push(...(run.p.length ? l.p.slice(1) : l.p));
      for (let k = 1; k < l.p.length; k++) run.w.push(l.w);
      const next: Link[] = (starts.get(key(l.p[l.p.length - 1])) ?? []).filter((m) => !used.has(m));
      l = next.find((m) => m.name === l!.name) ?? (next.length === 1 ? next[0] : undefined);
    }
    runs.push(run);
  }
  const rivers: RiverSpec[] = [];
  for (const run of runs) {
    if (run.p.length < 2 || !run.w.length) continue;
    const w = [...run.w].sort((a, b) => a - b)[run.w.length >> 1];
    const path = densify(run.p, 20).map((q) => ({ x: q.x - c.x, z: q.z - c.z }));
    let L = 0;
    for (let k = 1; k < path.length; k++) L += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
    if (L < 3 * w) continue;
    rivers.push({ path, width: Math.round(w) });
  }
  // still water: ponds and lakes with no river through them, at least 25 m across
  const lakes: LakeSpec[] = [];
  const onRiver = (x: number, z: number, rr: number) => rivers.some((rv) => rv.path.some((q) => Math.hypot(q.x - x, q.z - z) < rr + rv.width));
  for (const t of R.tiles) for (const f of t.layers.water ?? []) {
    const ring = f.parts[0], pts: XZ[] = [];
    for (let k = 0; k < ring.length; k += 2) pts.push({ x: ring[k], z: ring[k + 1] });
    const A = Math.abs(ringArea(pts));
    if (A < 500) continue;
    let x = 0, z = 0;
    for (const q of pts) { x += q.x; z += q.z; }
    x /= pts.length; z /= pts.length;
    if (!inside(x, z)) continue;
    const rr = Math.sqrt(A / Math.PI);
    if (onRiver(x - c.x, z - c.z, rr)) continue;
    lakes.push({ x: x - c.x, z: z - c.z, r: Math.round(rr), waves: [x % 6.28, z % 6.28, (x + z) % 6.28] });
  }
  return { lakes, rivers };
}
function densify(p: XZ[], step: number): XZ[] {
  const out: XZ[] = [p[0]];
  for (let k = 1; k < p.length; k++) {
    const a = p[k - 1], b = p[k], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let i = 1; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
  }
  return out;
}

// ---------------- the ground ----------------
// The game's water all lies at one level (region/water.ts LEVEL), on ground that's flat at 0 round
// it. So the ground the game gets is the real height above the nearest river's (Terrain 50 there
// is the water's surface), eased down to 0 over the last 200 m to each bank, on the region
// generator's 25 m grid (region/terrain.ts). A lake well above its river (a pond up a hill) would
// be a pit in that, so it's left out.
export const RELIEF_STEP = 25;
export function reliefOf(H: HeightGrid, w: { lakes: LakeSpec[]; rivers: RiverSpec[] }, half: number) {
  const at = (x: number, z: number) => {
    const gx = Math.max(0, Math.min(H.n - 1.001, (x - H.x0) / H.step)), gz = Math.max(0, Math.min(H.n - 1.001, (z - H.z0) / H.step));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * H.n + i;
    return (H.h[k] * (1 - fx) + H.h[k + 1] * fx) * (1 - fz) + (H.h[k + H.n] * (1 - fx) + H.h[k + H.n + 1] * fx) * fz;
  };
  // each river point's level: the height there, never above the level upstream of it (so a river
  // only runs down, whatever the 50 m grid says under its banks)
  const pts: { x: number; z: number; y: number; hw: number }[] = [];
  for (const r of w.rivers) {
    const ys = r.path.map((q) => at(q.x, q.z));
    // (which way it runs: down from its higher end)
    const down = ys[0] >= ys[ys.length - 1];
    let lo = Infinity;
    const order = down ? ys.map((_, k) => k) : ys.map((_, k) => ys.length - 1 - k);
    for (const k of order) { lo = Math.min(lo, ys[k]); pts.push({ x: r.path[k].x, z: r.path[k].z, y: lo, hw: r.width / 2 }); }
  }
  // the water's level and the distance to its bank, on a coarse grid
  const C = 100, cn = Math.ceil((2 * half) / C) + 3, c0 = -Math.ceil(half / C) * C - C;
  const base = new Float32Array(cn * cn), dist = new Float32Array(cn * cn);
  let lowest = Infinity;
  for (const p of pts) lowest = Math.min(lowest, p.y);
  if (!pts.length) lowest = Math.min(...Array.from(H.h));
  for (let j = 0; j < cn; j++) for (let i = 0; i < cn; i++) {
    const x = c0 + i * C, z = c0 + j * C;
    let bd = Infinity, by = lowest;
    for (const p of pts) { const d = Math.hypot(p.x - x, p.z - z) - p.hw; if (d < bd) { bd = d; by = p.y; } }
    base[j * cn + i] = by; dist[j * cn + i] = bd;
  }
  const lerp = (g: Float32Array, x: number, z: number) => {
    const gx = Math.max(0, Math.min(cn - 1.001, (x - c0) / C)), gz = Math.max(0, Math.min(cn - 1.001, (z - c0) / C));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * cn + i;
    return (g[k] * (1 - fx) + g[k + 1] * fx) * (1 - fz) + (g[k + cn] * (1 - fx) + g[k + cn + 1] * fx) * fz;
  };
  // (the bank itself, near enough, from the river points: the coarse grid is only for the level)
  const bank = (x: number, z: number) => { let d = Infinity; for (const p of pts) { const e = Math.hypot(p.x - x, p.z - z) - p.hw; if (e < d) d = e; } return d; };
  const lakes = w.lakes.filter((L) => at(L.x, L.z) - lerp(base, L.x, L.z) < 3);
  const S = RELIEF_STEP, x0 = -Math.ceil(half / S) * S, n = Math.round((-2 * x0) / S) + 1, h = new Float32Array(n * n);
  const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  let max = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * S, z = x0 + j * S;
    let k = 1;
    const dc = lerp(dist, x, z);
    if (dc < 400) k = smooth(12, 200, bank(x, z));
    for (const L of lakes) { const d = Math.hypot(x - L.x, z - L.z) - L.r * 1.35; if (d < 200) k = Math.min(k, smooth(0, 200, d)); }
    const v = k * Math.max(0, at(x, z) - lerp(base, x, z));
    h[j * n + i] = v;
    if (v > max) max = v;
  }
  return { ground: { x0, z0: x0, step: S, n, h, max }, water: { lakes, rivers: w.rivers } };
}

// ---------------- woods ----------------
// Trees where the woods are: a spot every so often inside each woodland polygon (about one tree a
// 700 m² on average, as the region's scattered woods are; the ground paints the woods themselves).
export function treesIn(R: RealRegion, c: XZ, r: number, seed: string, per = 700, max = 9000): XZ[] {
  const out: XZ[] = [], rand = rng([...seed].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7) >>> 0);
  const polys: { rings: XZ[][]; holes: boolean[]; A: number; box: Box }[] = [];
  let total = 0;
  for (const t of R.tiles) for (const f of t.layers.woods ?? []) {
    const rings = f.parts.map((a) => { const q: XZ[] = []; for (let k = 0; k < a.length; k += 2) q.push({ x: a[k], z: a[k + 1] }); return q; });
    const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    for (const q of rings[0]) { b.x0 = Math.min(b.x0, q.x); b.x1 = Math.max(b.x1, q.x); b.z0 = Math.min(b.z0, q.z); b.z1 = Math.max(b.z1, q.z); }
    if (b.x1 < c.x - r || b.x0 > c.x + r || b.z1 < c.z - r || b.z0 > c.z + r) continue;
    const A = rings.reduce((s, q, k) => s + (f.holes?.[k] ? -1 : 1) * Math.abs(ringArea(q)), 0);
    polys.push({ rings, holes: f.holes ?? rings.map(() => false), A, box: b });
    total += A;
  }
  const want = Math.min(max, Math.round(total / per));
  for (const P of polys) {
    let n = (P.A / total) * want;
    let tries = 0;
    while (n > 0 && tries++ < 60 + n * 8) {
      if (n < 1 && rand() > n) break;
      const x = P.box.x0 + rand() * (P.box.x1 - P.box.x0), z = P.box.z0 + rand() * (P.box.z1 - P.box.z0);
      if (Math.abs(x - c.x) > r || Math.abs(z - c.z) > r) continue;
      let inWood = false;
      P.rings.forEach((q, k) => { if (inRing(x, z, q)) inWood = P.holes[k] ? false : true; });
      if (!inWood) continue;
      out.push({ x: x - c.x, z: z - c.z });
      n--;
    }
  }
  return out;
}
function inRing(x: number, z: number, r: XZ[]) {
  let s = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i].z > z) !== (r[j].z > z) && x < ((r[j].x - r[i].x) * (z - r[i].z)) / (r[j].z - r[i].z) + r[i].x) s = !s;
  return s;
}

// the green space sites in the window, in its coordinates
export function greenIn(R: RealRegion, c: XZ, half: number) {
  const out: { c: number; rings: XZ[][]; holes: boolean[] }[] = [];
  for (const t of R.tiles) for (const f of t.layers.green ?? []) {
    const rings = f.parts.map((a) => { const q: XZ[] = []; for (let k = 0; k < a.length; k += 2) q.push({ x: a[k] - c.x, z: a[k + 1] - c.z }); return q; });
    if (!rings[0].some((p) => Math.abs(p.x) < half && Math.abs(p.z) < half)) continue;
    out.push({ c: f.c, rings, holes: f.holes ?? rings.map(() => false) });
  }
  return out;
}
