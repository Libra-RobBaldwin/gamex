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
import { field as reliefField, type ReliefField } from '../region/terrain';
import { LEVEL, RIM } from '../region/water';
import { mix } from '../region/random';
import type { Relief } from '../region/options';
import { PARAMS, noise2, rockAt, sampleGrid, sampleSmooth, type CoarseLand, type Rock } from './landform';
import { riverFloor, type WorldWater } from './water';
import type { SettlementGrid, WorldSettlement } from './plan';

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface TerrainInput { seed: number; relief: Relief; half: number; water: WorldWater; grid: SettlementGrid; land: CoarseLand }

// how far round a place its level ground eases out into the hills (m, past its reach)
const PLACE_EASE = 900;
const COR_REACH = 120; // (the furthest a corridor's side slope reaches past its edge)
const PLACE_SLOPE = 0.025; // (and the most its own ground slopes)

export class WorldTerrain {
  readonly land: CoarseLand;
  // the surface on the coarse grid: the ground, but lakes at their level (their beds are the bowls')
  private surf: Float32Array;
  private n1: (x: number, z: number) => number; private n2: (x: number, z: number) => number; private n3: (x: number, z: number) => number;
  private levels = new Map<number, [number, number, number]>(); // each place's ground: its level at the middle, and its tilt
  readonly top: number; // the most the ground can reach
  // the trunk routes' corridors (ease): each one's centre line, its ground's profile along it, and
  // half-width; their segments by 100 m bucket (corridor << 16 | segment)
  private cor: { path: { x: number; z: number }[]; prof: Float32Array; half: number }[] = [];
  private corSegs = new Map<number, number[]>();
  constructor(readonly o: TerrainInput) {
    const L = (this.land = o.land);
    this.surf = new Float32Array(L.h);
    for (let k = 0; k < L.h.length; k++) if (L.lake[k] >= 0) this.surf[k] = L.lakes[L.lake[k]].level;
    this.n1 = noise2(mix(o.seed, 351)); this.n2 = noise2(mix(o.seed, 352)); this.n3 = noise2(mix(o.seed, 353));
    this.top = L.max + PARAMS.detail.amp * 1.8 * 1.4 + 5;
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
      const d = Math.hypot(x - s.x, z - s.z) - s.reach - 60;
      if (d >= PLACE_EASE) continue;
      const t = 1 - smooth(0, PLACE_EASE, d), wt = (t * t * t * t) / (1.000001 - t);
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
  // How far the ground dips below heightAt for standing water: a lake's bowl (region/water.ts) or
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
    return reliefField(x0, x0, step, n, h, this.top);
  }
  // The heights on a grid `step` metres apart over the whole map (and a cell past its edge), as the
  // drape shader and the ground meshes take them (region/terrain.ts ReliefField).
  field(step = 50): ReliefField | null {
    const H = this.o.half + step, x0 = -Math.ceil(H / step) * step, n = Math.round((-2 * x0) / step) + 1;
    const h = new Float32Array(n * n);
    let max = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = this.heightAt(x0 + i * step, x0 + j * step); h[j * n + i] = v; if (v > max) max = v; }
    return reliefField(x0, x0, step, n, h, max);
  }
}
