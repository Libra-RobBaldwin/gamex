// A 50 km map's hills, as a function of x, z (docs/streaming.md, "Interfaces": the terrain). Two
// scales, as English country has them: broad swells and downs over ten kilometres or so, and the
// rolling hills of the region (region/terrain.ts) on top. Towns sit on the land (on its broad swell,
// not in a pit dug to sea level), level round their streets; valleys run down to the rivers, lakes
// and the coast, which lie at the water's level.
//
//   terrain.heightAt(x, z)    // the ground's height (m), smooth, any point of the map
//   terrain.bed(x, z)         // how far the ground dips below that for a lake or the sea (≤ 0)
//   terrain.field(step)       // the heights on a grid: what everything drawn follows (drape.ts)
//
// Nothing here is a grid until `field` is asked for: a tile, the worker or a test can ask the height
// anywhere. The terrain session (claude/work-terrain-2) can replace it with theirs: anything with
// these three methods will do. Pure: no three.js.
import { RELIEF_HEIGHT, field as reliefField, type ReliefField } from '../region/terrain';
import { lakeGroundOf, LEVEL } from '../region/water';
import { mix, rng } from '../region/random';
import type { Relief } from '../region/options';
import type { WorldWater } from './water';
import type { SettlementGrid } from './plan';

// the broad swells' height for each relief (the hills' own is RELIEF_HEIGHT)
export const BROAD_HEIGHT: Record<Relief, number> = { flat: 0, lowland: 25, rolling: 120, upland: 220, mountain: 420 };
// and the hills on them (the 6 km region's RELIEF_HEIGHT, a little higher: there's room for them here)
export const HILL_HEIGHT: Record<Relief, number> = { flat: 0, lowland: 12, rolling: 38, upland: 70, mountain: 130 };
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Seeded gradient noise, as region/terrain.ts has it (about −1 to 1).
function noise2(seed: number) {
  const r = rng(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gz = new Float32Array(256);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gz[i] = Math.sin(a); }
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, z: number) => {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const g = (i: number, j: number, dx: number, dz: number) => { const k = perm[(perm[(xi + i) & 255] + zi + j) & 255]; return gx[k] * dx + gz[k] * dz; };
    const u = fade(xf), v = fade(zf);
    const a = g(0, 0, xf, zf) + u * (g(1, 0, xf - 1, zf) - g(0, 0, xf, zf));
    const b = g(0, 1, xf, zf - 1) + u * (g(1, 1, xf - 1, zf - 1) - g(0, 1, xf, zf - 1));
    return (a + v * (b - a)) * 1.4;
  };
}

export interface TerrainInput { seed: number; relief: Relief; half: number; water: WorldWater; grid: SettlementGrid }

export class WorldTerrain {
  readonly hills: number; readonly broad: number;
  private n: ((x: number, z: number) => number)[];
  private ridged: boolean;
  // distance to the water on a coarse grid (the valleys are hundreds of metres to kilometres wide)
  private wd: Float32Array; private wx0: number; private wn: number;
  private static WC = 100;
  constructor(readonly o: TerrainInput) {
    this.hills = HILL_HEIGHT[o.relief] ?? RELIEF_HEIGHT[o.relief];
    this.broad = BROAD_HEIGHT[o.relief];
    this.n = [11, 12, 13, 14, 15].map((k) => noise2(mix(o.seed, k)));
    this.ridged = o.relief === 'upland' || o.relief === 'mountain';
    const C = WorldTerrain.WC, H = o.half + 2 * C;
    this.wx0 = -Math.ceil(H / C) * C; this.wn = Math.round((-2 * this.wx0) / C) + 1;
    this.wd = waterDistances(o.water, this.wx0, C, this.wn);
  }
  // distance to water, interpolated from the coarse grid
  waterDistance(x: number, z: number) {
    const C = WorldTerrain.WC, n = this.wn, gx = Math.max(0, Math.min(n - 1.001, (x - this.wx0) / C)), gz = Math.max(0, Math.min(n - 1.001, (z - this.wx0) / C));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * n + i, d = this.wd;
    return (d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fz) + (d[k + n] * (1 - fx) + d[k + n + 1] * fx) * fz;
  }
  // the broad swell (0 at the water, rising over kilometres inland)
  private swell(x: number, z: number, wd: number) {
    if (!this.broad) return 0;
    const [n1, n2] = this.n, p = { x: x / 11000, z: z / 11000 };
    const f = 0.7 * n1(p.x + 3.1, p.z - 7.7) + 0.3 * n2(p.x * 2.3 - 4.4, p.z * 2.3 + 1.9);
    // (downs: broad rises with steeper flanks and flattish tops, and wide vales between)
    const v = Math.max(0, Math.min(1, 0.3 + 0.85 * f));
    return this.broad * smooth(150, 3500, wd) * v * v * (3 - 2 * v);
  }
  // The ground's height at a point: the swell, and the hills on it, both easing off to the water;
  // round each place the hills level off onto the swell (the town stands on it, level).
  heightAt = (x: number, z: number) => {
    if (!this.hills && !this.broad) return 0;
    const wd = this.waterDistance(x, z);
    let k = smooth(110, 650, wd);
    for (const s of this.o.grid.near(x, z)) { const d = Math.hypot(x - s.x, z - s.z) - s.reach - 60; if (d < 500) k = Math.min(k, smooth(0, 500, d)); }
    // (a place's own ground is its middle's swell, so its streets are level with each other)
    let base = this.swell(x, z, wd);
    for (const s of this.o.grid.near(x, z)) {
      const d = Math.hypot(x - s.x, z - s.z) - s.reach - 60;
      if (d < 700) { const t = smooth(0, 700, d); base = base * t + this.swell(s.x, s.z, this.waterDistance(s.x, s.z)) * (1 - t); }
    }
    // (and nothing but the flat within reach of the water, so lakes, rivers and the sea lie level)
    base *= smooth(80, 700, wd);
    if (k <= 0 || !this.hills) return base;
    const [, , n3, n4, n5] = this.n, p = { x: x / 1400, z: z / 1400 };
    let f = 0.62 * n3(p.x, p.z) + 0.28 * n4(p.x * 2.1 + 5.3, p.z * 2.1 - 1.7) + 0.1 * n5(p.x * 4.3 - 2.2, p.z * 4.3 + 7.1);
    if (this.ridged) f = 0.55 * f + 0.45 * (1 - 2 * Math.abs(n5(p.x * 1.7 + 11, p.z * 1.7 - 3)));
    return base + this.hills * k * Math.max(0, Math.min(1, 0.45 + 0.75 * f));
  };
  // How far the ground dips below heightAt for standing water: a lake's bowl (region/water.ts) or
  // the sea's shelving bed, from a beach at the coast. (Rivers are drawn on the valley floor.)
  bed = (x: number, z: number) => {
    const w = this.o.water;
    let h = 0;
    for (const L of w.spec.lakes) { if (Math.abs(x - L.x) > L.r * 1.4 || Math.abs(z - L.z) > L.r * 1.4) continue; h = Math.min(h, lakeGroundOf(L, x, z)); }
    if (w.world.sea) {
      const d = w.seaDistance(x, z, 600);
      if (d < 12) h = Math.min(h, d > 0 ? LEVEL * (1 - d / 12) : LEVEL - Math.min(7, -d * 0.03 + 0.4));
    }
    return h;
  };
  // The same grid over the whole map with only a box of it filled in (the live play area's, made on
  // the main thread before the first frame: a few milliseconds); the rest comes from a worker
  // (`field` there) and is copied in when it arrives. `max` is the most it can ever be, so bounds
  // widened by it before then stay wide enough.
  partField(box: { x0: number; z0: number; x1: number; z1: number }, step = 50): ReliefField | null {
    if (!this.hills && !this.broad) return null;
    const H = this.o.half + step, x0 = -Math.ceil(H / step) * step, n = Math.round((-2 * x0) / step) + 1;
    const h = new Float32Array(n * n);
    const i0 = Math.max(0, Math.floor((box.x0 - x0) / step) - 1), i1 = Math.min(n - 1, Math.ceil((box.x1 - x0) / step) + 1);
    const j0 = Math.max(0, Math.floor((box.z0 - x0) / step) - 1), j1 = Math.min(n - 1, Math.ceil((box.z1 - x0) / step) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) h[j * n + i] = this.heightAt(x0 + i * step, x0 + j * step);
    return reliefField(x0, x0, step, n, h, this.broad + this.hills);
  }
  // The heights on a grid `step` metres apart over the whole map (and a cell past its edge), as the
  // drape shader and the ground meshes take them (region/terrain.ts ReliefField), or null when flat.
  field(step = 50): ReliefField | null {
    if (!this.hills && !this.broad) return null;
    const H = this.o.half + step, x0 = -Math.ceil(H / step) * step, n = Math.round((-2 * x0) / step) + 1;
    const h = new Float32Array(n * n);
    let max = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = this.heightAt(x0 + i * step, x0 + j * step); h[j * n + i] = v; if (v > max) max = v; }
    return reliefField(x0, x0, step, n, h, max);
  }
}

// How far each point of a grid is from the water's edge (negative in it), in metres: exact within a
// couple of cells of the water (worked out from the shapes there), then spread outwards by a
// two-pass chamfer (steps of one cell and √2 cells), which is near enough for valleys kilometres wide.
function waterDistances(w: WorldWater, x0: number, C: number, n: number) {
  const d = new Float32Array(n * n).fill(1e6), fixed = new Uint8Array(n * n);
  const exact = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    const k = j * n + i;
    if (fixed[k]) return;
    fixed[k] = 1;
    d[k] = w.edgeDistance({ x: x0 + i * C, z: x0 + j * C }, 3 * C);
  };
  const around = (x: number, z: number, r: number) => { const ci = Math.round((x - x0) / C), cj = Math.round((z - x0) / C); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) exact(ci + a, cj + b); };
  for (const r of w.world.rivers) for (let i = 0; i < r.path.length; i += 3) around(r.path[i].x, r.path[i].z, 2);
  for (const L of w.spec.lakes) { const R = Math.ceil((L.r * 1.35) / C) + 2; around(L.x, L.z, R); }
  if (w.world.sea) {
    for (const p of w.world.sea.coast) around(p.x, p.z, 2);
    // (out at sea, past what was worked out exactly: deep water)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; if (!fixed[k] && w.seaDistance(x0 + i * C, x0 + j * C, 1) < 0) { d[k] = -1000; fixed[k] = 1; } }
  }
  const D = C * Math.SQRT2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    if (fixed[k] && d[k] <= 0) continue;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + C);
    if (j > 0) { v = Math.min(v, d[k - n] + C); if (i > 0) v = Math.min(v, d[k - n - 1] + D); if (i < n - 1) v = Math.min(v, d[k - n + 1] + D); }
    d[k] = v;
  }
  for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
    const k = j * n + i;
    if (fixed[k] && d[k] <= 0) continue;
    let v = d[k];
    if (i < n - 1) v = Math.min(v, d[k + 1] + C);
    if (j < n - 1) { v = Math.min(v, d[k + n] + C); if (i < n - 1) v = Math.min(v, d[k + n + 1] + D); if (i > 0) v = Math.min(v, d[k + n - 1] + D); }
    d[k] = v;
  }
  // (the cap the valleys look out to)
  for (let k = 0; k < d.length; k++) if (d[k] > 4000) d[k] = 4000;
  return d;
}
