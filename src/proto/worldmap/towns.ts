// A settlement as scenery (docs/streaming.md, "Per-tile generators": towns): its streets, and the
// plots and buildings along them, worked out from the plan alone, the same every time. The streets
// are the region's own street layout (region/generate.ts layStreets), so a place looks the same as
// scenery as it does once it's live on the game's Network; the plots are simpler than the Network's
// (no land registry): each street's frontage is filled with the buildings a place of that size has
// there (shops and flats in the middle, terraces, then semis and detached houses; sheds on the
// industrial edge), keeping off the other streets, the trunk routes, the railway and the water.
//
// A place is worked out whole, once (a city takes a few tens of milliseconds), and kept; a tile takes
// the streets whose middles and the buildings whose centres fall in it, so every one is drawn once
// and they meet seamlessly across tile borders. Pure: no three.js.
import { ROADS, halfOf, kerbOf } from '../catalog';
import { KINDS, layStreets, type Kind, type StreetCall } from '../region/generate';
import { mix, rng, type Rand } from '../region/random';
import type { XZ } from '../region/water';
import { ROUTE_HALF, type Route, type Rail } from './routes';
import type { WorldPlan, WorldSettlement } from './plan';
import { REAL_VERN, paletteOf, placeResolver, type Vern } from '../vernacular';

export interface SceneStreet { path: XZ[]; kerb: number; half: number; role: StreetCall['role']; settlement: number }
// A building: its footprint (centre, width along the street, depth, turn), eaves height, roof
// (0 flat, else the ridge's height above the eaves, gable along the width), and its colours.
export interface SceneBuilding { x: number; z: number; w: number; d: number; rot: number; h: number; ridge: number; wall: number; roof: number; kind: BKind; settlement: number; wc?: string; rc?: string } // (wc, rc: the place's own wall and roof colours, from vernacular.ts, over the indices)
export type BKind = 'house' | 'terrace' | 'shop' | 'flats' | 'office' | 'tower' | 'shed' | 'church' | 'farm' | 'barn';
export interface ScenePlot { poly: XZ[]; kind: 'garden' | 'yard' }
export interface Scene { streets: SceneStreet[]; buildings: SceneBuilding[]; plots: ScenePlot[]; junctions: { x: number; z: number; r: number; rot: number }[] }

// colours (sRGB hex) the view looks up by index: walls, then roofs
export const WALLS = ['#9a4a36', '#a65a42', '#8c4632', '#b0694d', '#c9a877', '#e6dcc4', '#efeae0', '#bfae8c', '#d8cfbd', '#b8b4aa', '#9ea7ad', '#8f9ca8', '#c4c0b6', '#a7a197'];
export const ROOFS = ['#4a4f57', '#565b63', '#9b4e3a', '#a35d44', '#6a4a3e', '#7b858c', '#8a8f94', '#5e6166', '#6b7a6a'];
const W = { brick: [0, 1, 2, 3], buff: [4], render: [5, 6, 8], stone: [7], concrete: [9, 12, 13], glass: [10, 11] };
const R = { slate: [0, 1], tile: [2, 3, 4], sheet: [5, 6], flat: [7, 6], green: [8] };

const pickOf = (r: Rand, a: number[]) => a[Math.floor(r() * a.length)];
const quad = (a: XZ, c: XZ, b: XZ, t: number): XZ => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, z: (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * c.z + t * t * b.z });
// a street's centre line, as the Network draws it (a quadratic Bézier when it bends)
function streetPath(st: StreetCall): XZ[] {
  const L = Math.hypot(st.b.x - st.a.x, st.b.z - st.a.z), n = Math.max(2, Math.ceil(L / 10));
  const out: XZ[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n; out.push(st.c ? quad(st.a, st.c, st.b, t) : { x: st.a.x + (st.b.x - st.a.x) * t, z: st.a.z + (st.b.z - st.a.z) * t }); }
  return out;
}

// A coarse occupancy raster (2 m cells) over a place: streets, routes and water first, then each
// building as it's placed.
class Occ {
  private cells = new Map<number, Uint8Array>();
  static C = 2;
  private key = (i: number, j: number) => ((i >> 6) + 32768) * 65536 + ((j >> 6) + 32768);
  private block(i: number, j: number, make: boolean) { const k = this.key(i, j); let b = this.cells.get(k); if (!b && make) this.cells.set(k, (b = new Uint8Array(4096))); return b; }
  set(i: number, j: number) { this.block(i, j, true)![(i & 63) * 64 + (j & 63)] = 1; }
  get(i: number, j: number) { const b = this.block(i, j, false); return b ? b[(i & 63) * 64 + (j & 63)] : 0; }
  // a rotated rectangle's cells: all free? (and mark them, with `mark`)
  rect(x: number, z: number, w: number, d: number, rot: number, mark: boolean, pad = 0): boolean {
    const C = Occ.C, co = Math.cos(rot), si = Math.sin(rot), hw = w / 2 + pad, hd = d / 2 + pad;
    const ex = Math.abs(co) * hw + Math.abs(si) * hd, ez = Math.abs(si) * hw + Math.abs(co) * hd;
    for (let i = Math.floor((x - ex) / C); i <= Math.floor((x + ex) / C); i++) for (let j = Math.floor((z - ez) / C); j <= Math.floor((z + ez) / C); j++) {
      const px = (i + 0.5) * C - x, pz = (j + 0.5) * C - z, u = px * co + pz * si, v = -px * si + pz * co;
      if (Math.abs(u) > hw || Math.abs(v) > hd) continue;
      if (mark) this.set(i, j); else if (this.get(i, j)) return false;
    }
    return true;
  }
  band(path: XZ[], half: number) {
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.01) continue;
      this.rect((a.x + b.x) / 2, (a.z + b.z) / 2, L + 1, half * 2, Math.atan2(b.z - a.z, b.x - a.x), true);
    }
  }
}

// How "central" a spot is, in the town's metres (region/mapspec.ts centrality): what gets built there.
const central: Record<Kind, (d: number) => number> = { town: (d) => d, city: (d) => d / 2, village: (d) => 70 + 1.2 * d };
interface Spec { kind: BKind; w: [number, number]; d: [number, number]; h: [number, number]; setback: number; ridge: number; walls: number[]; roofs: number[]; back: number; gap: number }
function specFor(c: number, kind: Kind, industrial: boolean, r: Rand): Spec {
  if (industrial) return { kind: 'shed', w: [26, 48], d: [22, 40], h: [7, 11], setback: 9, ridge: 0, walls: pickOf(r, [0, 1]) ? W.concrete : [10, 13], roofs: R.sheet, back: 8, gap: 8 };
  if (kind === 'city' && c < 45) return r() < 0.35 ? { kind: 'tower', w: [22, 30], d: [20, 28], h: [38, 80], setback: 4, ridge: 0, walls: W.glass, roofs: R.flat, back: 6, gap: 6 } : { kind: 'office', w: [20, 32], d: [16, 24], h: [16, 30], setback: 3, ridge: 0, walls: [...W.concrete, ...W.glass], roofs: R.flat, back: 6, gap: 3 };
  if (c < 70) return { kind: 'shop', w: [6.5, 9], d: [12, 16], h: [7, 10], setback: 0.5, ridge: r() < 0.5 ? 3.5 : 0, walls: [...W.brick, ...W.render, ...W.buff], roofs: [...R.slate, ...R.tile], back: 6, gap: 0 };
  if (c < 115) return r() < (kind === 'city' ? 0.55 : 0.25) ? { kind: 'flats', w: [18, 28], d: [12, 16], h: [10, 16], setback: 3, ridge: 0, walls: [...W.brick, ...W.concrete, ...W.buff], roofs: R.flat, back: 10, gap: 5 } : { kind: 'terrace', w: [5, 6.2], d: [8, 10], h: [5.6, 6.4], setback: 2, ridge: 3, walls: [...W.brick, ...W.brick, ...W.render], roofs: R.slate, back: 11, gap: 0 };
  if (c < 170) return r() < 0.5 ? { kind: 'terrace', w: [5.2, 6.4], d: [8, 10], h: [5.4, 6.2], setback: 3, ridge: 3, walls: [...W.brick, ...W.render, ...W.buff], roofs: [...R.slate, ...R.tile], back: 14, gap: 0 } : { kind: 'house', w: [8, 10], d: [8, 10], h: [5.2, 5.8], setback: 5, ridge: 3.2, walls: [...W.brick, ...W.render], roofs: [...R.tile, ...R.slate], back: 16, gap: 2.5 };
  return { kind: 'house', w: [9, 13], d: [8, 11], h: [5, 6], setback: 7, ridge: 3.4, walls: kind === 'village' ? [...W.brick, ...W.stone, ...W.render, ...W.buff] : [...W.brick, ...W.render, ...W.buff], roofs: [...R.tile, ...R.slate], back: 18, gap: 4 };
}

// the trunk routes and railways near a place, for keeping clear of
function corridors(plan: WorldPlan, s: WorldSettlement): { path: XZ[]; half: number }[] {
  const out: { path: XZ[]; half: number }[] = [], R = s.reach + 200;
  const near = (p: XZ) => Math.abs(p.x - s.x) < R && Math.abs(p.z - s.z) < R;
  const take = (path: XZ[], half: number) => { let run: XZ[] = []; for (const p of path) { if (near(p)) run.push(p); else if (run.length) { out.push({ path: run, half }); run = []; } } if (run.length > 1) out.push({ path: run, half }); };
  for (const r of plan.roads as Route[]) take(r.path, ROUTE_HALF[r.kind] + 3);
  for (const r of plan.rails as Rail[]) take(r.path, ROUTE_HALF.rail + 4);
  return out;
}

const scenes = new Map<string, Scene>();
// The scenery for one settlement (worked out once and kept: see above).
export function settlementScene(plan: WorldPlan, s: WorldSettlement): Scene {
  const key = `${plan.seed}:${plan.options.size}:${s.id}`;
  let sc = scenes.get(key);
  if (sc) return sc;
  sc = makeScene(plan, s);
  scenes.set(key, sc);
  if (scenes.size > 400) scenes.delete(scenes.keys().next().value!);
  return sc;
}

// a place's building tradition, as the live buildings pick it (a real region has its own)
const resolvers = new WeakMap<WorldPlan, ReturnType<typeof placeResolver>>();
export function vernOf(plan: WorldPlan, s: WorldSettlement): Vern {
  let at = resolvers.get(plan);
  if (!at) {
    const force = plan.source === 'real' ? REAL_VERN[plan.id] : undefined;
    at = placeResolver({ seed: plan.seed, style: plan.options.style, relief: plan.options.relief, settlements: plan.settlements }, force);
    resolvers.set(plan, at);
  }
  return at(s.x, s.z).vern;
}

function makeScene(plan: WorldPlan, s: WorldSettlement): Scene {
  const { streets: calls, zone } = layStreets({ ...s, gates: [] }, plan.water, plan.half);
  const r = rng(mix(s.seed, 77));
  const occ = new Occ();
  const streets: SceneStreet[] = calls.map((c) => { const d = ROADS[c.type] ?? ROADS.street; return { path: streetPath(c), kerb: kerbOf(d), half: halfOf(d), role: c.role, settlement: s.id }; });
  for (const st of streets) occ.band(st.path, st.half + 0.5);
  for (const c of corridors(plan, s)) occ.band(c.path, c.half);
  // junctions: where two or more streets meet (their ends), a patch of carriageway over the crossing
  const ends = new Map<string, { x: number; z: number; r: number; rot: number; n: number }>();
  for (const st of streets) for (const p of [st.path[0], st.path[st.path.length - 1]]) {
    const k = `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`, e = ends.get(k);
    const a = st.path[1], b = st.path[st.path.length - 2], q = p === st.path[0] ? a : b, rot = Math.atan2(q.z - p.z, q.x - p.x);
    if (e) { e.n++; e.r = Math.max(e.r, st.kerb); } else ends.set(k, { x: p.x, z: p.z, r: st.kerb, rot, n: 1 });
  }
  const junctions = [...ends.values()].filter((e) => e.n > 1).map(({ x, z, r: rr, rot }) => ({ x, z, r: rr + 0.3, rot }));
  const inZone = (p: XZ) => !!zone?.poly && pointInPoly(p, zone.poly);
  const buildings: SceneBuilding[] = [], plots: ScenePlot[] = [];
  const wet = (p: XZ) => plan.water.edgeDistance(p, 20) < 6;
  // a church near the middle of each village and town (by the high street)
  const addChurch = () => {
    const hs = streets.find((st) => st.role === 'high');
    if (!hs || s.kind === 'city') return;
    const m = hs.path[Math.floor(hs.path.length / 2)], a = hs.path[Math.floor(hs.path.length / 2) + 1] ?? hs.path[0];
    const rot = Math.atan2(a.z - m.z, a.x - m.x), nx = -Math.sin(rot), nz = Math.cos(rot);
    for (const side of [1, -1]) {
      const off = hs.half + 16, x = m.x + nx * off * side, z = m.z + nz * off * side;
      if (!occ.rect(x, z, 24, 30, rot, false, 1)) continue;
      occ.rect(x, z, 26, 32, rot, true);
      buildings.push({ x, z, w: 22, d: 10, rot, h: 8, ridge: 5, wall: 7, roof: 0, kind: 'church', settlement: s.id });
      const tx = x + Math.cos(rot) * 13, tz = z + Math.sin(rot) * 13;
      buildings.push({ x: tx, z: tz, w: 6, d: 6, rot, h: 19, ridge: 0, wall: 7, roof: 7, kind: 'church', settlement: s.id });
      plots.push({ poly: rectPoly(x, z, 34, 36, rot), kind: 'garden' });
      return;
    }
  };
  if (s.kind !== 'city') addChurch();
  // frontage: both sides of every street, in the order the streets were laid out (the centre first)
  for (const st of streets) {
    const P = st.path, L = P.reduce((t, p, i) => (i ? t + Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) : 0), 0);
    if (L < 25) continue;
    for (const side of [1, -1]) {
      let at = 12; // (clear of the junction at the start)
      let row: Spec | null = null, rowLeft = 0, rowH = 0, rowWall = 0, rowRoof = 0;
      while (at < L - 12) {
        const p = pointAt(P, at);
        const c = central[s.kind](Math.hypot(p.x - s.x, p.z - s.z));
        const industrial = st.role === 'industrial' || inZone(p);
        // (a village thins out into the country: gaps between the houses further out)
        if (s.kind === 'village' && c > 170 && r() < 0.35) { at += 14; row = null; continue; }
        let sp: Spec;
        if (row && rowLeft > 0) sp = row;
        else {
          sp = specFor(c, s.kind, industrial, r);
          if (sp.kind === 'terrace') { row = sp; rowLeft = 3 + Math.floor(r() * 6); rowH = sp.h[0] + r() * (sp.h[1] - sp.h[0]); rowWall = pickOf(r, sp.walls); rowRoof = pickOf(r, sp.roofs); }
          else row = null;
        }
        const w = sp.w[0] + r() * (sp.w[1] - sp.w[0]), d = sp.d[0] + r() * (sp.d[1] - sp.d[0]);
        if (at + w > L - 12) break;
        const q = pointAt(P, at + w / 2), off = st.half + sp.setback + d / 2;
        const x = q.x + (-q.uz * side) * off, z = q.z + (q.ux * side) * off, rot = Math.atan2(q.uz, q.ux);
        const ok = occ.rect(x, z, w, d, rot, false, sp.gap > 0 ? 0.6 : 0.05) && !wet({ x, z });
        if (ok) {
          occ.rect(x, z, w, d, rot, true, sp.gap > 0 ? 0.6 : 0);
          const terr = sp.kind === 'terrace';
          buildings.push({ x, z, w: terr ? w + 0.02 : w, d, rot, h: terr ? rowH : sp.h[0] + r() * (sp.h[1] - sp.h[0]), ridge: sp.ridge ? sp.ridge * (0.85 + r() * 0.3) * Math.min(1, d / 9) : 0, wall: terr ? rowWall : pickOf(r, sp.walls), roof: terr ? rowRoof : pickOf(r, sp.roofs), kind: sp.kind, settlement: s.id });
          // its plot: the front garden and the back, as the ground paints them
          const g0 = st.half + 0.3, g1 = st.half + sp.setback + d + sp.back, gm = (g0 + g1) / 2;
          const px = q.x + (-q.uz * side) * gm, pz = q.z + (q.ux * side) * gm;
          plots.push({ poly: rectPoly(px, pz, w, g1 - g0, rot), kind: industrial ? 'yard' : 'garden' });
          if (terr) rowLeft--;
          at += w + (terr && rowLeft > 0 ? 0 : sp.gap + (sp.kind === 'house' ? r() * 3 : 0));
        } else {
          row = null; rowLeft = 0;
          at += 4;
        }
      }
    }
  }
  // (houses, terraces, shops and churches in the place's own building tradition, as its live
  // buildings are: vernacular.ts; offices, towers, flats and sheds keep their concrete and glass)
  const pal = paletteOf(vernOf(plan, s));
  for (const b of buildings) if (b.kind === 'house' || b.kind === 'terrace' || b.kind === 'shop' || b.kind === 'church') {
    b.wc = pal.walls[b.wall % pal.walls.length]; b.rc = pal.roofs[b.roof % pal.roofs.length];
  }
  return { streets, buildings, plots, junctions };
}

// a point on a polyline at arc length s, with the direction there
function pointAt(P: XZ[], s: number) {
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + L >= s || i === P.length - 1) { const t = L > 0 ? Math.max(0, Math.min(1, (s - acc) / L)) : 0; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ux: (b.x - a.x) / (L || 1), uz: (b.z - a.z) / (L || 1) }; }
    acc += L;
  }
  return { x: P[0].x, z: P[0].z, ux: 1, uz: 0 };
}
export function rectPoly(x: number, z: number, w: number, d: number, rot: number): XZ[] {
  const co = Math.cos(rot), si = Math.sin(rot), hw = w / 2, hd = d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => ({ x: x + u * co - v * si, z: z + u * si + v * co }));
}
function pointInPoly(p: XZ, poly: XZ[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
export { KINDS };
