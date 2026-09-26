// A 50 km map's water, as functions of x, z (docs/streaming.md, "The world plan"; docs/terrain.md,
// "The 50 km land"): the sea and its coast, rivers that widen down to it, and lakes, all from the
// coarse land (landform.ts), so the water lies where the land drains to. It's the region's MapWater
// (region/water.ts: lakes as bowls, rivers as channels, a quick "how far to the water" for the
// generator) with the sea added, so everything written for the 6 km region's water (the street
// layout, the relief, the game's live water) reads it unchanged.
//
//   water.seaDistance(x, z)     // how far inland from the coast (negative out at sea)
//   water.edgeDistance(p, cap)  // how far from any water's edge (negative in it)
//   water.kindAt(x, z)          // 'sea' | 'lake' | 'river' | null
//   water.riverAt(x, z, reach)  // the nearest river within reach: its distance, half-width and level
//   water.standingPolys(box)    // the sea and lakes in a box, as polygons (for the ground's cover)
//
// Water lies at different heights on a map with hills: a lake's `level`, a river's `levels` along
// it, and the sea at 0. The terrain (terrain.ts) lays the ground level to them round the water.
//
// Pure: no three.js, no DOM.
import { LEVEL, LineIndex, MapWater, RIM, lakeBox, type LakeSpec, type RiverSpec, type WaterSpec, type XZ } from '../region/water';
import { mix, range, rng } from '../region/random';
import { PARAMS, noise2, sampleGrid, sampleSmooth, type CoarseLand } from './landform';

// A river of the world plan: its centre line, its width at each point of it (it widens on the way
// down to the sea) and its water's height (never rising downstream).
export interface WorldRiver { path: XZ[]; widths: number[]; levels?: number[]; name?: string }
// The sea: which side of the map it mostly lies (for the motorways and the edge's exits), and points
// along its coast, about 200 m apart (unordered: the coast can be many pieces, round islands).
export interface Sea { coast: XZ[]; side: 'n' | 'e' | 's' | 'w' }
export interface WorldWaterSpec { sea: Sea | null; rivers: WorldRiver[]; lakes: LakeSpec[] }

// a river as the region's water takes it
export const riverSpec = (r: WorldRiver): RiverSpec => ({ path: r.path, width: Math.max(...r.widths), widths: r.widths });

// how far round a river the ground can be laid down to it (terrain.ts): its bank, then at most this
// much more (its floor, and the valley side eased down to it)
export const riverFloor = (half: number) => Math.max(240, 5 * half);
const G = 100; // m: the buckets rivers and lakes are found by

export class WorldWater extends MapWater {
  readonly world: WorldWaterSpec;
  // each river's half-width and level at each point
  private rh: Float32Array[]; private rl: Float32Array[];
  // the rivers' segments by bucket (river << 16 | segment), within their floor's reach
  private segs = new Map<number, number[]>();
  // distance to any water (m, negative in it) on the coarse grid: the quick "nowhere near"
  private wd: Float32Array | null = null;
  private coastNoise: (x: number, z: number) => number;
  // the lakes on the land's grid: the signed distance to their shores (m, negative in them), and
  // which lake is nearest each point
  private lakeSd: Float32Array | null = null; private lakeOf: Int32Array | null = null;
  constructor(w: WorldWaterSpec, readonly land: CoarseLand | null = null) {
    super({ lakes: w.lakes, rivers: w.rivers.map(riverSpec) });
    this.world = w;
    // (rivers tens of kilometres long: coarser buckets, so "how far to the river" within a few
    // hundred metres looks at a few dozen of them rather than walking the whole line)
    for (const r of this.rivers) r.index = new LineIndex(r.spec.path, 250);
    this.rh = w.rivers.map((r) => Float32Array.from(r.widths, (v) => v / 2));
    this.rl = w.rivers.map((r) => Float32Array.from(r.levels ?? r.path.map(() => 0)));
    w.rivers.forEach((r, ri) => {
      for (let i = 1; i < r.path.length; i++) {
        const a = r.path[i - 1], b = r.path[i], R = this.rh[ri][i] + RIM + riverFloor(this.rh[ri][i]);
        const i0 = Math.floor((Math.min(a.x, b.x) - R) / G), i1 = Math.floor((Math.max(a.x, b.x) + R) / G);
        const j0 = Math.floor((Math.min(a.z, b.z) - R) / G), j1 = Math.floor((Math.max(a.z, b.z) + R) / G);
        for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) { const k = key(ci, cj), l = this.segs.get(k); if (l) l.push((ri << 16) | i); else this.segs.set(k, [(ri << 16) | i]); }
      }
    });
    const n1 = noise2(331), n2 = noise2(332);
    this.coastNoise = (x, z) => 20 * n1(x / 420, z / 420) + 8 * n2(x / 150, z / 150);
    if (land && land.lakes.length) this.lakeField(land);
    if (land) this.wd = this.distances(land);
  }

  // ---- the sea ----
  // How far inland a spot is from the coast (negative out at sea); Infinity with no sea.
  seaDistance(x: number, z: number, cap = 1e5): number {
    const L = this.land;
    if (!this.world.sea || !L) return Infinity;
    let v = sampleGrid(L, L.sea, x, z);
    const a = Math.abs(v);
    // (near the coast: smoothly, with the small bays and points the coarse grid is too coarse for)
    if (a < 450) v = sampleSmooth(L, L.sea, x, z) + this.coastNoise(x, z) * (a < 250 ? 1 : 1 - smooth01((a - 250) / 200));
    return v > cap ? cap : v < -cap ? -cap : v;
  }
  // (a spot well out at sea: nothing else to ask about)
  atSea(x: number, z: number) { return !!this.world.sea && !!this.land && sampleGrid(this.land, this.land.sea, x, z) < -500; }

  // ---- rivers ----
  // The nearest river within `reach` metres of its bank (its floor, by default): how far from its
  // centre line, its half-width and its water's level there, and which it is; null if none.
  riverAt(x: number, z: number, reach = -1): { d: number; half: number; level: number; river: number } | null {
    const l = this.segs.get(key(Math.floor(x / G), Math.floor(z / G)));
    if (!l) return null;
    let best: { d: number; half: number; level: number; river: number } | null = null, bs = Infinity;
    for (const e of l) {
      const ri = e >>> 16, i = e & 0xffff, P = this.world.rivers[ri].path, a = P[i - 1], b = P[i];
      const ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ux + (z - a.z) * uz) / L2));
      const d = Math.hypot(x - a.x - ux * t, z - a.z - uz * t);
      const half = this.rh[ri][i - 1] + (this.rh[ri][i] - this.rh[ri][i - 1]) * t;
      const R = reach < 0 ? RIM + riverFloor(half) : reach;
      // (the one whose bank is nearest, as a share of its reach: a tributary's floor meets its river's)
      const s = (d - half) / R;
      if (d - half > R || s >= bs) continue;
      bs = s;
      best = { d, half, level: this.rl[ri][i - 1] + (this.rl[ri][i] - this.rl[ri][i - 1]) * t, river: ri };
    }
    return best;
  }
  // The river width nearest a spot (for drawing), or 0 away from rivers.
  riverWidth(x: number, z: number, max = 80) {
    const r = this.riverAt(x, z, max);
    return r ? r.half * 2 : 0;
  }

  // ---- lakes ----
  // A lake's shape is the coarse land's (its cells), its shore smoothed between them; `spec.lakes`
  // are bowls covering each, for anything that only needs to know roughly where the lakes are.
  // The ground's dip for the lakes (≤ 0: from the beach down the shelving bed), as the region's
  // bowls have it (region/water.ts), from the shore's distance.
  override lakesGround = (x: number, z: number) => {
    if (!this.lakeSd) return 0;
    const L = this.land!;
    if (sampleGrid(L, this.lakeSd, x, z) > RIM + 2 * L.cell) return 0;
    const d = this.lakeShore(x, z);
    return d >= RIM ? 0 : d >= 0 ? LEVEL * smooth01(1 - d / RIM) : LEVEL - Math.min(LAKE_DEEP, 0.3 - d * 0.06);
  };
  // (the shore's distance, smoothly, with a little wobble the grid is too coarse for)
  private lakeShore(x: number, z: number) { return sampleSmooth(this.land!, this.lakeSd!, x, z) + 0.3 * this.coastNoise(x * 1.7, z * 1.7); }
  // How far a spot is from the nearest lake's shore (negative in it), and that lake's level, within
  // `cap` metres (else null).
  lakeAt(x: number, z: number, cap = 260): { d: number; level: number } | null {
    if (!this.lakeSd) return null;
    const L = this.land!;
    if (sampleGrid(L, this.lakeSd, x, z) > cap + 2 * L.cell) return null;
    const d = this.lakeShore(x, z);
    if (d > cap) return null;
    const i = Math.max(0, Math.min(L.n - 1, Math.round((x - L.x0) / L.cell))), j = Math.max(0, Math.min(L.n - 1, Math.round((z - L.z0) / L.cell)));
    return { d, level: L.lakes[this.lakeOf![j * L.n + i]].level };
  }
  private lakeField(L: CoarseLand) {
    const n = L.n, C = L.cell, NN = n * n, d = new Float32Array(NN).fill(1e7), of = new Int32Array(NN).fill(-1);
    // (the shore halfway between a lake's cell and a dry one)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      for (const q of [i + 1 < n ? k + 1 : -1, j + 1 < n ? k + n : -1]) {
        if (q < 0 || (L.lake[k] >= 0) === (L.lake[q] >= 0)) continue;
        const id = L.lake[k] >= 0 ? L.lake[k] : L.lake[q];
        if (C / 2 < d[k]) { d[k] = C / 2; of[k] = id; }
        if (C / 2 < d[q]) { d[q] = C / 2; of[q] = id; }
      }
    }
    const D = C * Math.SQRT2, step = (k: number, q: number, e: number) => { if (d[q] + e < d[k]) { d[k] = d[q] + e; of[k] = of[q]; } };
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; if (i > 0) step(k, k - 1, C); if (j > 0) { step(k, k - n, C); if (i > 0) step(k, k - n - 1, D); if (i < n - 1) step(k, k - n + 1, D); } }
      for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) { const k = j * n + i; if (i < n - 1) step(k, k + 1, C); if (j < n - 1) { step(k, k + n, C); if (i < n - 1) step(k, k + n + 1, D); if (i > 0) step(k, k + n - 1, D); } }
    }
    for (let k = 0; k < NN; k++) { if (L.lake[k] >= 0) { d[k] = -d[k]; of[k] = L.lake[k]; } if (d[k] > 1e6) d[k] = 1e6; if (of[k] < 0) of[k] = 0; }
    this.lakeSd = d; this.lakeOf = of;
  }

  // ---- any water ----
  // (the coarse distance to any water, bilinear: within a cell or so of the truth)
  private coarseDistance(x: number, z: number) { return this.wd && this.land ? sampleGrid(this.land, this.wd, x, z) : -Infinity; }
  // The region's "how far to the water's edge" (negative in the water), with the sea too.
  override edgeDistance(p: XZ, cap = 1e5) {
    const c = this.coarseDistance(p.x, p.z);
    if (c - 2 * (this.land?.cell ?? 0) > cap) return cap; // (nowhere near: the usual answer, quickly)
    let best = Math.min(cap, this.seaDistance(p.x, p.z, cap));
    if (cap <= 250) {
      const r = this.riverAt(p.x, p.z, cap);
      if (r) best = Math.min(best, r.d - r.half);
      const l = this.lakeAt(p.x, p.z, cap);
      if (l) best = Math.min(best, l.d);
      return best;
    }
    const l = this.lakeAt(p.x, p.z, best);
    if (l) best = Math.min(best, l.d);
    for (let k = 0; k < this.rivers.length; k++) {
      const r = this.rivers[k], B = this.boxes[this.spec.lakes.length + k];
      if (p.x < B.x0 - best || p.x > B.x1 + best || p.z < B.z0 - best || p.z > B.z1 + best) continue;
      const d = r.index.near(p.x, p.z, best + r.half);
      if (d !== Infinity) best = Math.min(best, d - r.index.at(r.halves));
    }
    return best;
  }
  override mayBeNear(p: XZ, m: number) {
    if (this.wd) return this.coarseDistance(p.x, p.z) - 2 * this.land!.cell < m;
    return super.mayBeNear(p, m) || (this.world.sea !== null && this.seaDistance(p.x, p.z, m + 1) < m);
  }
  // Is there water here (or within `gap` metres)?
  wet(p: XZ, gap = 0) { return this.edgeDistance(p, gap + 1) < gap; }
  // what's here: the sea, a lake, a river or nothing (for painting and drawing)
  kindAt(x: number, z: number): 'sea' | 'lake' | 'river' | null {
    if (this.world.sea && this.seaDistance(x, z, 2) < 0) return 'sea';
    if (this.lakesGround(x, z) < LEVEL) return 'lake';
    const r = this.riverAt(x, z, 0);
    return r && r.d < r.half ? 'river' : null;
  }

  // The sea and lakes in a box as polygons, for the ground's cover (country.ts): each row of
  // `step` m cells whose middles are in the water, run together into one strip.
  standingPolys(b: { x0: number; z0: number; x1: number; z1: number }, step = 40): XZ[][] {
    const out: XZ[][] = [];
    const wet = (x: number, z: number) => this.seaDistance(x, z, 5) < 4 || this.lakesGround(x, z) < LEVEL + 0.05;
    if (!this.world.sea && !this.spec.lakes.some((L) => { const B = lakeBox(L); return B.x1 > b.x0 && B.x0 < b.x1 && B.z1 > b.z0 && B.z0 < b.z1; })) return out;
    for (let z = b.z0; z < b.z1; z += step) {
      let run = -Infinity;
      for (let x = b.x0; x <= b.x1; x += step) {
        const w = x < b.x1 && (this.coarseDistance(x, z) < 400) && wet(x + step / 2, z + step / 2);
        if (w && run === -Infinity) run = x;
        if (!w && run !== -Infinity) { out.push([{ x: run, z }, { x, z }, { x, z: z + step }, { x: run, z: z + step }]); run = -Infinity; }
      }
    }
    return out;
  }

  // The coarse distance to any water, on the land's grid: exact near the rivers and lakes, the
  // sea's own, spread out by a chamfer.
  private distances(L: CoarseLand) {
    const n = L.n, C = L.cell, d = new Float32Array(n * n);
    for (let k = 0; k < d.length; k++) d[k] = this.world.sea ? L.sea[k] : 1e6;
    const seed = (x: number, z: number, v: number) => {
      const i = Math.round((x - L.x0) / C), j = Math.round((z - L.z0) / C);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const k = jj * n + ii, e = Math.hypot(L.x0 + ii * C - x, L.z0 + jj * C - z) + v;
        if (e < d[k]) d[k] = e;
      }
    };
    this.world.rivers.forEach((r, ri) => { for (let i = 0; i < r.path.length; i += 2) seed(r.path[i].x, r.path[i].z, -this.rh[ri][i]); });
    if (this.lakeSd) for (let k = 0; k < d.length; k++) d[k] = Math.min(d[k], this.lakeSd[k]);
    const D = C * Math.SQRT2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + C);
      if (j > 0) { v = Math.min(v, d[k - n] + C); if (i > 0) v = Math.min(v, d[k - n - 1] + D); if (i < n - 1) v = Math.min(v, d[k - n + 1] + D); }
      d[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = d[k];
      if (i < n - 1) v = Math.min(v, d[k + 1] + C);
      if (j < n - 1) { v = Math.min(v, d[k + n] + C); if (i < n - 1) v = Math.min(v, d[k + n + 1] + D); if (i > 0) v = Math.min(v, d[k + n - 1] + D); }
      d[k] = v;
    }
    return d;
  }
}
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
const LAKE_DEEP = 4.2; // (m of water in the middle of a lake, as the region's: region/water.ts)
const smooth01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// The region's WaterSpec for the part of the world inside a box (the live play area's GameWater):
// the lakes that reach it, and the rivers' stretches through it (run on past the box by `margin`).
export function waterInBox(w: WorldWaterSpec, box: { x0: number; z0: number; x1: number; z1: number }, margin = 600): WaterSpec {
  const inside = (p: XZ, m: number) => p.x >= box.x0 - m && p.x <= box.x1 + m && p.z >= box.z0 - m && p.z <= box.z1 + m;
  const lakes = w.lakes.filter((L) => inside(L, L.r * 1.35 + 10));
  const rivers: RiverSpec[] = [];
  for (const r of w.rivers) {
    let run: XZ[] = [], ws: number[] = [];
    const flush = () => { if (run.length > 1) rivers.push({ path: run, width: Math.round(Math.max(...ws)), widths: ws }); run = []; ws = []; };
    r.path.forEach((p, i) => { if (inside(p, margin)) { run.push(p); ws.push(r.widths[i]); } else flush(); });
    flush();
  }
  return { lakes, rivers };
}

// ---------------- from the land ----------------
// The water the coarse land leaves (landform.ts): its rivers smoothed from the grid's cell-to-cell
// steps into winding lines, widening downstream and into an estuary at the sea; its lakes as bowls
// covering their cells; the sea where the land is below 0. `rivers` (0–4) and `water` (0–100) are
// the region options' (how many and how wet).
export function waterFromLand(L: CoarseLand, seed: number, opts: { rivers: number; water: number; sea: boolean }): WorldWaterSpec {
  const P = PARAMS, n = L.n, C = L.cell, r = rng(mix(seed, 330));
  const wetness = opts.water === -1 ? 1 : Math.max(0.05, opts.water / 50);
  // ---- the sea ----
  let sea: Sea | null = null;
  let seaCells = 0;
  for (let k = 0; k < L.sea.length; k++) if (L.sea[k] < 0) seaCells++;
  if (seaCells > 0) {
    const coast: XZ[] = [];
    for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
      const k = j * n + i;
      if ((L.sea[k] < 0) !== (L.sea[k + 1] < 0)) coast.push({ x: L.x0 + (i + 0.5) * C, z: L.z0 + j * C });
      if ((L.sea[k] < 0) !== (L.sea[k + n] < 0)) coast.push({ x: L.x0 + i * C, z: L.z0 + (j + 0.5) * C });
    }
    // (the side with the most sea along it)
    const along = { n: 0, s: 0, e: 0, w: 0 };
    for (let t = 0; t < n; t++) { along.n += +(L.sea[t] < 0); along.s += +(L.sea[(n - 1) * n + t] < 0); along.w += +(L.sea[t * n] < 0); along.e += +(L.sea[t * n + n - 1] < 0); }
    const side = L.side ?? (Object.entries(along).sort((a, b) => b[1] - a[1])[0][0] as Sea['side']);
    sea = { coast, side };
  }
  // ---- rivers: from where they drain enough ----
  const cut = opts.rivers === 0 ? Infinity : (P.river / wetness) * (2 / Math.max(1, opts.rivers)) ** 0.5;
  const rivers: WorldRiver[] = [], idOf = new Map<number, number>();
  const widthOf = (A: number) => Math.max(P.width.min, Math.min(P.width.max, P.width.a * (A / 1e6) ** P.width.b));
  L.rivers.forEach((cr, ci) => {
    const i0 = cr.area.findIndex((a) => a >= cut);
    if (i0 < 0 || cr.path.length - i0 < 2) return;
    let pts = cr.path.slice(i0).map((p) => ({ ...p })), area = cr.area.slice(i0), lev = cr.level.slice(i0);
    // (its mouth, where it joins the river it runs into: that river's own line there, once smoothed)
    const into = cr.into >= 0 ? idOf.get(cr.into) : undefined;
    // smooth: Chaikin's corner cutting, three times (the ends kept), then a gentle meander
    for (let it = 0; it < 3; it++) { const c = chaikin(pts, area, lev); pts = c.p; area = c.a; lev = c.l; }
    const widths = area.map(widthOf);
    const len = pathLength(pts);
    meander(pts, widths, rng(mix(seed, 340 + ci)), len);
    if (into !== undefined) {
      const m = rivers[into], q = nearestOn(m.path, pts[pts.length - 1]);
      pts[pts.length - 1] = q.p;
      const lm = m.levels![q.i];
      for (let i = lev.length - 1; i >= 0; i--) lev[i] = Math.max(lev[i], lm); // (never below its river where it meets it)
    }
    // (into the sea: an estuary, widening over its last few kilometres; the sea level at its mouth)
    const end = pts[pts.length - 1];
    if (sea && sampleGrid(L, L.sea, end.x, end.z) < 0) {
      let s = 0;
      for (let i = pts.length - 1; i >= 0; i--) {
        if (i < pts.length - 1) s += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
        if (s > P.estuaryLength) break;
        widths[i] = Math.min(P.width.max * 1.5, widths[i] * (1 + (P.estuaryWiden - 1) * smooth01(1 - s / P.estuaryLength)));
      }
    }
    // (levels never rise downstream)
    for (let i = 1; i < lev.length; i++) lev[i] = Math.min(lev[i], lev[i - 1]);
    idOf.set(ci, rivers.length);
    rivers.push({ path: pts, widths: widths.map((w) => Math.round(w * 10) / 10), levels: lev.map((v) => Math.max(0, v)) });
  });
  // ---- lakes: bowls over each lake's cells, the biggest in its middle first ----
  const lakes: LakeSpec[] = [];
  for (const cl of L.lakes) {
    const inLake = new Set(cl.cells), dist = new Map<number, number>();
    // (each cell's distance in from the shore, in cells)
    let front = cl.cells.filter((k) => [1, -1, n, -n].some((o) => !inLake.has(k + o)));
    for (const k of front) dist.set(k, 0);
    for (let dd = 1; front.length; dd++) {
      const next: number[] = [];
      for (const k of front) for (const o of [1, -1, n, -n]) { const q = k + o; if (inLake.has(q) && !dist.has(q)) { dist.set(q, dd); next.push(q); } }
      front = next;
    }
    const order = [...cl.cells].sort((a, b) => dist.get(b)! - dist.get(a)! || a - b), covered = new Set<number>();
    for (const k of order) {
      if (covered.has(k)) continue;
      const x = L.x0 + (k % n) * C, z = L.z0 + Math.floor(k / n) * C, R = (dist.get(k)! + 0.78) * C;
      lakes.push({ x: x + range(r, -0.15, 0.15) * C, z: z + range(r, -0.15, 0.15) * C, r: Math.round(R), waves: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)], level: Math.round(cl.level * 100) / 100 });
      for (const q of cl.cells) if (Math.hypot(L.x0 + (q % n) * C - x, L.z0 + Math.floor(q / n) * C - z) < R - 0.6 * C) covered.add(q);
    }
  }
  return { sea, rivers, lakes };
}

function chaikin(p: XZ[], a: number[], l: number[]) {
  const P: XZ[] = [p[0]], A = [a[0]], Lv = [l[0]];
  for (let i = 0; i + 1 < p.length; i++) {
    const q = p[i], s = p[i + 1];
    P.push({ x: 0.75 * q.x + 0.25 * s.x, z: 0.75 * q.z + 0.25 * s.z }, { x: 0.25 * q.x + 0.75 * s.x, z: 0.25 * q.z + 0.75 * s.z });
    A.push(0.75 * a[i] + 0.25 * a[i + 1], 0.25 * a[i] + 0.75 * a[i + 1]);
    Lv.push(0.75 * l[i] + 0.25 * l[i + 1], 0.25 * l[i] + 0.75 * l[i + 1]);
  }
  P.push(p[p.length - 1]); A.push(a[a.length - 1]); Lv.push(l[l.length - 1]);
  return { p: P, a: A, l: Lv };
}
const pathLength = (p: XZ[]) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); return s; };
// A gentle meander across the valley floor: each point moved sideways by a slow wave, its size and
// length from the river's width (none at the two ends, where it rises and where it joins).
function meander(p: XZ[], widths: number[], r: () => number, len: number) {
  if (p.length < 3) return;
  const ph = r() * 6.28, ph2 = r() * 6.28;
  const off: number[] = [];
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    if (i) s += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z);
    const w = widths[i], lam = Math.max(260, Math.min(900, 14 * w)), A = Math.max(12, Math.min(55, 1.6 * w));
    off.push(A * (0.7 * Math.sin((s / lam) * 6.2832 + ph) + 0.3 * Math.sin((s / (lam * 0.43)) * 6.2832 + ph2)) * smooth01(s / 300) * smooth01((len - s) / 300));
  }
  const q = p.map((v) => ({ ...v }));
  for (let i = 1; i + 1 < p.length; i++) {
    const dx = q[i + 1].x - q[i - 1].x, dz = q[i + 1].z - q[i - 1].z, l = Math.hypot(dx, dz) || 1;
    p[i] = { x: q[i].x - (dz / l) * off[i], z: q[i].z + (dx / l) * off[i] };
  }
}
function nearestOn(path: XZ[], p: XZ) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < path.length; i++) { const d = (path[i].x - p.x) ** 2 + (path[i].z - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }
  return { p: { ...path[bi] }, i: bi };
}
