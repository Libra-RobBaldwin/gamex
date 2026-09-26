// A 50 km map's hills, as a function of x, z (docs/streaming.md, "Interfaces"; docs/terrain.md,
// "The 50 km land"): one height for everyone (the ground, the far tiles, the drape, the routes).
// The lie of the land is the coarse land's (landform.ts: ranges, scarps, dales and vales cut by the
// rivers that drain them, the sea's coast and its drowned valleys), read smoothly between its grid
// points, with fine knolls and dips on top; then laid level where things need it:
//   - round the water: a river's floor at its level (falling downstream), a lake's shore at its
//     level, the sea's coast down to 0, with beaches in the bays and cliffs on the headlands;
//   - round each place: its streets and plots stand on its own gently tilted plane, easing out into the
//     hills over a few hundred metres (every nearby place's flat weighed together, so two close
//     ones meet smoothly).
//
//   terrain.heightAt(x, z)    // the ground's height (m), smooth, any point of the map
//   terrain.bed(x, z)         // how far the ground dips below that for water (≤ 0)
//   terrain.field(step)       // the heights on a grid: what everything drawn follows (drape.ts)
//
// Nothing here is a grid until `field` is asked for: a tile, the worker or a test can ask the height
// anywhere. Pure: no three.js.
import { LEVEL, RIM } from './water';
import { mix } from '../region/random';
import type { Relief } from '../region/options';
import { PARAMS, noise2, rockAt, sampleGrid, sampleSmooth, type CoarseLand, type Rock } from './landform';
import { riverFloor, type WorldWater } from './water';
import type { SettlementGrid, WorldSettlement } from './plan';

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------- the height field everything is drawn on ----------------
// The ground's heights on a square grid, and between grid points planar over the two triangles of
// each cell, split along the (i+1, j)–(i, j+1) diagonal: exactly how the ground mesh is triangulated,
// and what the drape shader does (drape.ts). So anything placed at `heightAt(x, z)`, on the CPU or in
// a shader, lies on the ground mesh itself: no gaps, no fighting.
export interface ReliefField {
  x0: number; z0: number; step: number; n: number; // grid: n × n points from (x0, z0)
  h: Float32Array; // heights, row by row (z outer): h[j * n + i] is at (x0 + i·step, z0 + j·step)
  max: number; // the highest point
  heightAt(x: number, z: number): number; // planar over the ground mesh's triangles (see above)
}

// A real map's own heights (a real region's bake: real/map.ts) as the field, or null for a map
// without any (the 50 km map's come from WorldTerrain.field / partField instead).
export function makeRelief(m: { ground?: { x0: number; z0: number; step: number; n: number; h: Float32Array; max: number }; relief?: unknown; seed?: unknown; water?: unknown; settlements?: unknown }, _half?: number): ReliefField | null {
  return m.ground ? field(m.ground.x0, m.ground.z0, m.ground.step, m.ground.n, m.ground.h, m.ground.max) : null;
}

export function field(x0: number, z0: number, step: number, n: number, h: Float32Array, max: number): ReliefField {
  const top = n - 1 - 1e-4;
  return {
    x0, z0, step, n, h, max,
    // (the shader in drape.ts does exactly this, in the same order)
    heightAt(x: number, z: number) {
      const gx = Math.max(0, Math.min(top, (x - x0) / step)), gz = Math.max(0, Math.min(top, (z - z0) / step));
      const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * n + i;
      const h10 = h[k + 1], h01 = h[k + n];
      if (fx + fz <= 1) { const h00 = h[k]; return h00 + (h10 - h00) * fx + (h01 - h00) * fz; }
      const h11 = h[k + n + 1];
      return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    },
  };
}

// (for tests: the steepest slope between neighbouring grid points)
export function steepest(f: ReliefField) {
  let s = 0;
  for (let j = 0; j + 1 < f.n; j++) for (let i = 0; i + 1 < f.n; i++) {
    const k = j * f.n + i;
    s = Math.max(s, Math.abs(f.h[k + 1] - f.h[k]) / f.step, Math.abs(f.h[k + f.n] - f.h[k]) / f.step);
  }
  return s;
}

// ---- the hills' lighting, in one place ----
// The ground is lit as if GROUND_LIFT times as steep as it is (the live ground: game/water.ts; the
// 50 km map's far tiles: worldmap/tilegen.ts): from the game's height, gentle country otherwise
// reads as flat. `litSlope` is what a true slope (rise over run) reads as in the ground shader's
// 1 − normal.y, and `slopeLook` the shader's uSlope for a map with hills (ground/material.ts: bare
// rock from a 1 in 2 slope, all rock by 1 in 1.1; heather on the tops from 300 m, all moor by 420).
export const GROUND_LIFT = 4.5;
export const litSlope = (s: number) => 1 - 1 / Math.hypot(1, GROUND_LIFT * s);
export const slopeLook = (): [number, number, number, number] => [litSlope(0.55), litSlope(0.9), 300, 420];
// and the sun for a map with hills: from the south-west, about 32° up (low enough that slopes facing
// away from it fall into shade, high enough that valleys aren't lost in it)
export const SUN_HILLS = { x: -190, y: 160, z: 170 };
// and the light's balance: less from the sky all round, more from the sun, so a slope's facing shows
export const LIGHT_HILLS = { hemi: 0.75, sun: 3.1 };
// The ground's small swells and dells, for the light only: at the game's zoom a whole hillside is one
// even slope, evenly lit, and reads as flat; what shows the land's shape is the rise and fall of the
// ground field by field. They're a sum of waves (the same in JS and GLSL, so the live ground, the far
// tiles and the fields drawn over the ground agree), a few hundred metres long, tilting the normal
// as if the ground rose and fell `amp` metres; heights are untouched, so nothing built on it moves.
const WAVES: [number, number, number, number][] = [[182, 0.3, 1.1, 1], [247, 1.9, 4.2, 0.9], [311, 2.8, 2.3, 0.8], [389, 4.1, 5.9, 0.7], [463, 0.95, 0.4, 0.6], [587, 5.3, 3.7, 0.5]]
  .map(([L, a, ph, w]) => [(Math.cos(a) * 2 * Math.PI) / L, (Math.sin(a) * 2 * Math.PI) / L, ph, w]);
const WSUM = WAVES.reduce((t, w) => t + w[3], 0);
// the swells' slope at a point (rise over run, x and z) for swells `amp` metres high
export function swellSlope(x: number, z: number, amp: number): [number, number] {
  let gx = 0, gz = 0;
  for (const [kx, kz, ph, w] of WAVES) { const c = (w / WSUM) * Math.cos(kx * x + kz * z + ph); gx += c * kx; gz += c * kz; }
  return [gx * amp, gz * amp];
}
export const SWELL_GLSL = `vec2 swellSlope( vec2 p, float amp ) { vec2 g = vec2( 0.0 ); float c;
${WAVES.map(([kx, kz, ph, w]) => `  c = ${(w / WSUM).toFixed(6)} * cos( ${kx.toFixed(8)} * p.x + ${kz.toFixed(8)} * p.y + ${ph.toFixed(4)} ); g += c * vec2( ${kx.toFixed(8)}, ${kz.toFixed(8)} );`).join('\n')}
  return g * amp; }`;
// how high the swells are lit as, on a 50 km map (0 elsewhere)
export const SWELL_AMP = 30;

export interface TerrainInput { seed: number; relief: Relief; half: number; water: WorldWater; grid: SettlementGrid; land: CoarseLand }

// how far round a place its level ground eases out into the hills (m, past its reach)
const PLACE_EASE = 900;
// the live area's knolls: how high on each landform (m), and where they fade out (Chebyshev distance from the start, m)
const LIVE_KNOLLS: Record<string, number> = { vale: 10, downs: 20, estuary: 14, uplands: 24, mountains: 32, coast: 18, islands: 18 };
const LIVE_FADE = [3300, 4300];
const COR_REACH = 120; // (the furthest a corridor's side slope reaches past its edge)
const PLACE_SLOPE = 0.025; // (and the most its own ground slopes)

export class WorldTerrain {
  readonly land: CoarseLand;
  // the surface on the coarse grid: the ground, but lakes at their level (their beds are the bowls')
  private surf: Float32Array;
  private n1: (x: number, z: number) => number; private n2: (x: number, z: number) => number; private n3: (x: number, z: number) => number;
  private levels = new Map<number, [number, number, number]>(); // each place's ground: its level at the middle, and its tilt
  readonly top: number; // the most the ground can reach
  private live: number; // (the live area's knolls' height)
  // the trunk routes' corridors (ease): each one's centre line, its ground's profile along it, and
  // half-width; their segments by 100 m bucket (corridor << 16 | segment)
  private cor: { path: { x: number; z: number }[]; prof: Float32Array; half: number }[] = [];
  private corSegs = new Map<number, number[]>();
  constructor(readonly o: TerrainInput) {
    const L = (this.land = o.land);
    this.surf = new Float32Array(L.h);
    for (let k = 0; k < L.h.length; k++) if (L.lake[k] >= 0) this.surf[k] = L.lakes[L.lake[k]].level;
    this.n1 = noise2(mix(o.seed, 351)); this.n2 = noise2(mix(o.seed, 352)); this.n3 = noise2(mix(o.seed, 353));
    this.live = LIVE_KNOLLS[L.landform] ?? 16;
    this.top = L.max + PARAMS.detail.amp * 1.8 * 1.4 + this.live + 5;
  }
  // The rock under a spot (for the buildings' walls and roofs: vernacular's setGeology).
  geologyAt = (x: number, z: number): Rock => rockAt(this.land, x, z);

  // The land before anything is laid level on it: the coarse surface, the coast's cliffs and
  // beaches, and the fine detail.
  private natural(x: number, z: number) {
    const L = this.land, D = PARAMS.detail;
    let h = sampleSmooth(L, this.surf, x, z);
    const w = this.o.water;
    // the coast: within a cell of it, a beach where the land comes down gently, a cliff on the
    // headlands (where the noise says and the land behind stands high)
    let s = Infinity;
    if (w.world.sea) {
      s = w.seaDistance(x, z, 1000);
      if (s < L.cell) {
        const c = smooth(0.05, 0.45, this.n3(x / 2600, z / 2600));
        if (c > 0 && s > 0) {
          const behind = Math.min(90, (Math.max(h, 0) * L.cell) / Math.max(s, 25));
          const cliff = behind * smooth(0, 30, s), hc = cliff + (h - cliff) * smooth(0.35 * L.cell, L.cell, s);
          h += (Math.max(h, hc) - h) * c;
        }
        h = Math.max(0, h) * smooth(0, 6, s);
      }
    }
    if (h < 0) h = 0;
    // (the small hills: three octaves, as big as the country round is rugged, pushing up more than
    // down so they read as hills, not hollows; none on the water's floors)
    const rel = sampleGrid(L, L.relief, x, z), a = D.amp * Math.max(0.3, Math.min(1.8, rel / D.relief));
    const p = x / D.wavelength, q = z / D.wavelength;
    let f = 0.55 * this.n1(p, q) + 0.3 * this.n2(p * 2.3 + 3.3, q * 2.3 - 1.7) + 0.15 * this.n1(p * 5.1 - 7.1, q * 5.1 + 2.2);
    f = f > 0 ? f : 0.5 * f;
    h += a * f * smooth(0, 120, s) * Math.min(1, h / 6);
    // (and round the start town, where the game is played and the camera looks: knolls and dells a
    // few hundred metres across, as the fields there rise and fall; gone by the live area's edge, so
    // the trunk routes beyond it, which keep to their grades, never meet them)
    const cheb = Math.max(Math.abs(x), Math.abs(z));
    if (cheb < LIVE_FADE[1] && this.live) {
      const q1 = x / 620, q2 = z / 620;
      let g = 0.65 * this.n3(q1 + 11.3, q2 - 4.1) + 0.35 * this.n2(q1 * 2.4 - 3.9, q2 * 2.4 + 8.8);
      g = g > 0 ? g : 0.6 * g;
      h += this.live * g * (1 - smooth(LIVE_FADE[0], LIVE_FADE[1], cheb)) * smooth(0, 120, s) * Math.min(1, h / 6);
    }
    return Math.max(0, h);
  }
  // A place's own ground: a plane through its middle's height, tilted as the land is there but no
  // more than PLACE_SLOPE (so it sits on a hillside as a real town does, its streets gently sloping).
  private levelOf(s: WorldSettlement) {
    let v = this.levels.get(s.id);
    if (v === undefined) {
      const e = Math.max(150, s.reach * 0.6), gx = (this.natural(s.x + e, s.z) - this.natural(s.x - e, s.z)) / (2 * e), gz = (this.natural(s.x, s.z + e) - this.natural(s.x, s.z - e)) / (2 * e);
      const g = Math.hypot(gx, gz), k = g > PLACE_SLOPE ? PLACE_SLOPE / g : 1;
      v = [Math.max(1.5, this.natural(s.x, s.z)), gx * k, gz * k];
      this.levels.set(s.id, v);
    }
    return v;
  }
  // The ground's height at a point.
  heightAt = (x: number, z: number) => {
    const w = this.o.water;
    if (w.atSea(x, z)) return 0;
    let h = this.natural(x, z);
    // places: level in them, easing out; every one near weighed by how near (w⁴ / (1 − w))
    let W = 1, S = h;
    for (const s of this.o.grid.near(x, z)) {
      // (the start town's flat is tight round it: the hills of its valley rise just past its edge)
      const home = s.id === 0, E = home ? 350 : PLACE_EASE, d = Math.hypot(x - s.x, z - s.z) - s.reach - (home ? 20 : 60);
      if (d >= E) continue;
      const t = 1 - smooth(0, E, d), wt = (t * t * t * t) / (1.000001 - t);
      const [l0, gx, gz] = this.levelOf(s);
      W += wt; S += wt * Math.max(1, l0 + gx * (x - s.x) + gz * (z - s.z));
    }
    if (W > 1) h = S / W;
    // the water: rivers' floors at their level, lakes' shores at theirs, the sea's at 0
    const r = w.riverAt(x, z);
    if (r) {
      // (its floor, then the valley side up to the land, no steeper than about 1 in 14)
      const b = r.half + RIM + 20, f = smooth(b, b + Math.min(riverFloor(r.half) - 20, Math.max(70, 3 * r.half, (h - r.level) * 14)), r.d);
      h = r.level + (Math.max(h, r.level) - r.level) * f;
    }
    if (this.cor.length) h = this.corridor(x, z, h);
    const l = w.lakeAt(x, z);
    if (l) h = l.level + (Math.max(h, l.level) - l.level) * smooth(RIM + 10, 250, l.d);
    return h;
  };
  // Ease the ground along the trunk routes once they're planned (plan.ts): each laid to a profile
  // no steeper than its grade, cut down through the crests and banked up over the dips (the lesser
  // of the two, blended), with its cuttings' and embankments' sides at about 1 in 2 either side.
  // Called once, before anything is drawn; the routes were planned on the ground before it.
  ease(routes: { path: { x: number; z: number }[]; grade: number; half: number }[]) {
    for (const r of routes) {
      const P = r.path, n = P.length;
      if (n < 2) continue;
      const g = Float32Array.from(P, (p) => this.heightAt(p.x, p.z)), up = new Float32Array(g), lo = new Float32Array(g), G = r.grade * 0.85;
      const ds = (i: number) => Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
      // (the cut envelope, never above the ground and never steeper than G; the fill one, never below)
      for (let i = 1; i < n; i++) { up[i] = Math.min(up[i], up[i - 1] + G * ds(i)); lo[i] = Math.max(lo[i], lo[i - 1] - G * ds(i)); }
      for (let i = n - 2; i >= 0; i--) { up[i] = Math.min(up[i], up[i + 1] + G * ds(i + 1)); lo[i] = Math.max(lo[i], lo[i + 1] - G * ds(i + 1)); }
      const prof = new Float32Array(n);
      for (let i = 0; i < n; i++) prof[i] = (up[i] + lo[i]) / 2;
      const ci = this.cor.length;
      this.cor.push({ path: P, prof, half: r.half });
      const R = r.half + COR_REACH;
      for (let i = 1; i < n; i++) {
        const a = P[i - 1], b = P[i];
        for (let gi = Math.floor((Math.min(a.x, b.x) - R) / 100); gi <= Math.floor((Math.max(a.x, b.x) + R) / 100); gi++) for (let gj = Math.floor((Math.min(a.z, b.z) - R) / 100); gj <= Math.floor((Math.max(a.z, b.z) + R) / 100); gj++) {
          const k = (gi + 32768) * 65536 + (gj + 32768), l = this.corSegs.get(k);
          if (l) l.push((ci << 16) | i); else this.corSegs.set(k, [(ci << 16) | i]);
        }
      }
    }
  }
  // (the ground at a spot near a corridor: its profile across the route's width, then the side slope
  // back to the land; the nearest corridor wins)
  private corridor(x: number, z: number, h: number) {
    const l = this.corSegs.get((Math.floor(x / 100) + 32768) * 65536 + (Math.floor(z / 100) + 32768));
    if (!l) return h;
    let bd = Infinity, bp = 0;
    for (const e of l) {
      const c = this.cor[e >>> 16], i = e & 0xffff, a = c.path[i - 1], b = c.path[i];
      const ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz || 1, t = Math.max(0, Math.min(1, ((x - a.x) * ux + (z - a.z) * uz) / L2));
      const d = Math.hypot(x - a.x - ux * t, z - a.z - uz * t) - c.half;
      if (d < bd) { bd = d; bp = c.prof[i - 1] + (c.prof[i] - c.prof[i - 1]) * t; }
    }
    if (bd >= COR_REACH) return h;
    const w = Math.min(COR_REACH, 6 + 2 * Math.abs(h - bp)), f = smooth(0, w, bd);
    return bp + (h - bp) * f;
  }
  // How far the ground dips below heightAt for standing water: a lake's bowl (worldmap/water.ts) or
  // the sea's shelving bed, from a beach at the coast. (Rivers are drawn on the valley floor.)
  bed = (x: number, z: number) => {
    const w = this.o.water;
    let h = 0;
    h = Math.min(h, w.lakesGround(x, z));
    if (w.world.sea) {
      if (w.atSea(x, z)) return LEVEL - 7;
      const d = w.seaDistance(x, z, 600);
      if (d < 12) h = Math.min(h, d > 0 ? LEVEL * (1 - d / 12) : LEVEL - Math.min(7, -d * 0.03 + 0.4));
    }
    return h;
  };
  // The same grid over the whole map with only a box of it filled in (the live play area's, made on
  // the main thread before the first frame); the rest comes from a worker (`field` there) and is
  // copied in when it arrives. `max` is the most it can ever be, so bounds widened by it before then
  // stay wide enough.
  partField(box: { x0: number; z0: number; x1: number; z1: number }, step = 50): ReliefField | null {
    const H = this.o.half + step, x0 = -Math.ceil(H / step) * step, n = Math.round((-2 * x0) / step) + 1;
    const h = new Float32Array(n * n);
    const i0 = Math.max(0, Math.floor((box.x0 - x0) / step) - 1), i1 = Math.min(n - 1, Math.ceil((box.x1 - x0) / step) + 1);
    const j0 = Math.max(0, Math.floor((box.z0 - x0) / step) - 1), j1 = Math.min(n - 1, Math.ceil((box.z1 - x0) / step) + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) h[j * n + i] = this.heightAt(x0 + i * step, x0 + j * step);
    return field(x0, x0, step, n, h, this.top);
  }
  // The heights on a grid `step` metres apart over the whole map (and a cell past its edge), as the
  // drape shader and the ground meshes take them (worldmap/terrain.ts ReliefField).
  field(step = 50): ReliefField | null {
    const H = this.o.half + step, x0 = -Math.ceil(H / step) * step, n = Math.round((-2 * x0) / step) + 1;
    const h = new Float32Array(n * n);
    let max = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = this.heightAt(x0 + i * step, x0 + j * step); h[j * n + i] = v; if (v > max) max = v; }
    return field(x0, x0, step, n, h, max);
  }
}
