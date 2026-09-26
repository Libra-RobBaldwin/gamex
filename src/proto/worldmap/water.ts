// A 50 km map's water, as functions of x, z (docs/streaming.md, "The world plan"): the sea beyond a
// coast along one edge, rivers that run down to it (or right across the map, with no sea), and
// lakes. It's the region's MapWater (region/water.ts: lakes as bowls, rivers as channels, a quick
// "how far to the water" for the generator) with the sea added, so everything written for the 6 km
// region's water (the street layout, the relief, the game's live water) reads it unchanged.
//
// Pure: no three.js, no DOM. The terrain session (claude/work-terrain-2) owns how water looks and
// lies in the ground; this is the plan's outline of it, and the interface they fill in.
import { LEVEL, LineIndex, MapWater, type LakeSpec, type RiverSpec, type WaterSpec, type XZ } from '../region/water';

// A river of the world plan: its centre line and its width at each point of it (it widens on the
// way down to the sea).
export interface WorldRiver { path: XZ[]; widths: number[]; name?: string }
// The sea: the coast as a line along one edge of the map (points 50 m apart, running from one side
// of the map to the other), and which way the sea lies from it.
export interface Sea { coast: XZ[]; side: 'n' | 'e' | 's' | 'w' }
export interface WorldWaterSpec { sea: Sea | null; rivers: WorldRiver[]; lakes: LakeSpec[] }

// a river as the region's water takes it: one width (its widest, so roads keep clear of it everywhere)
export const riverSpec = (r: WorldRiver): RiverSpec => ({ path: r.path, width: Math.max(...r.widths) });

export class WorldWater extends MapWater {
  readonly world: WorldWaterSpec;
  private coast: LineIndex | null;
  // (widths by nearest point, for drawing: each river's own index into its path)
  private widthAt: ((x: number, z: number) => number)[];
  constructor(w: WorldWaterSpec) {
    super({ lakes: w.lakes, rivers: w.rivers.map(riverSpec) });
    this.world = w;
    // (rivers tens of kilometres long: coarser buckets, so "how far to the river" within a few
    // hundred metres looks at a few dozen of them rather than walking the whole line)
    for (const r of this.rivers) r.index = new LineIndex(r.spec.path, 250);
    this.coast = w.sea ? new LineIndex(w.sea.coast, 256) : null;
    this.widthAt = w.rivers.map((r) => {
      return (x: number, z: number) => {
        // (the nearest point: the path is evenly spaced, so a coarse walk then a fine one)
        let best = 0, bd = Infinity;
        for (let i = 0; i < r.path.length; i += 8) { const d = (r.path[i].x - x) ** 2 + (r.path[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
        for (let i = Math.max(0, best - 8); i < Math.min(r.path.length, best + 9); i++) { const d = (r.path[i].x - x) ** 2 + (r.path[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
        return r.widths[best];
      };
    });
  }
  // How far inland a spot is from the coast (negative out at sea); Infinity with no sea.
  seaDistance(x: number, z: number, cap = 1e5): number {
    const s = this.world.sea;
    if (!s || !this.coast) return Infinity;
    const d = this.coast.near(x, z, cap);
    const land = inland(s, x, z, this.coastAt(s, x, z));
    if (d === Infinity) return land ? cap : -cap;
    return land ? d : -d;
  }
  // the coast's offset along its edge's axis at a spot (the coast is a function of the other axis)
  private coastAt(s: Sea, x: number, z: number) {
    const t = s.side === 'n' || s.side === 's' ? x : z, c = s.coast, n = c.length;
    const t0 = along(s, c[0]), t1 = along(s, c[n - 1]);
    const f = Math.max(0, Math.min(n - 1.001, ((t - t0) / (t1 - t0)) * (n - 1))), i = Math.floor(f), u = f - i;
    return across(s, c[i]) * (1 - u) + across(s, c[i + 1]) * u;
  }
  // The river width nearest a spot (for drawing), or 0 away from rivers.
  riverWidth(x: number, z: number, max = 80) {
    for (let k = 0; k < this.rivers.length; k++) {
      const r = this.rivers[k];
      if (r.index.near(x, z, r.half + max) === Infinity) continue;
      return this.widthAt[k](x, z);
    }
    return 0;
  }
  // The region's "how far to the water's edge" (negative in the water), with the sea too.
  override edgeDistance(p: XZ, cap = 1e5) {
    return Math.min(super.edgeDistance(p, cap), this.seaDistance(p.x, p.z, cap));
  }
  override mayBeNear(p: XZ, m: number) {
    if (super.mayBeNear(p, m)) return true;
    return this.world.sea !== null && this.seaDistance(p.x, p.z, m + 1) < m;
  }
  // Is there water here (or within `gap` metres)?
  wet(p: XZ, gap = 0) { return this.edgeDistance(p, gap + 1) < gap; }
  // what's here: the sea, a lake, a river or nothing (for painting and drawing)
  kindAt(x: number, z: number): 'sea' | 'lake' | 'river' | null {
    if (this.world.sea && this.seaDistance(x, z, 2) < 0) return 'sea';
    if (this.lakesGround(x, z) < LEVEL) return 'lake';
    for (const r of this.rivers) if (r.index.near(x, z, r.half) !== Infinity) return 'river';
    return null;
  }
}
const along = (s: Sea, p: XZ) => (s.side === 'n' || s.side === 's' ? p.x : p.z);
const across = (s: Sea, p: XZ) => (s.side === 'n' || s.side === 's' ? p.z : p.x);
// (z grows southwards, x eastwards: a southern sea lies at larger z than its coast)
function inland(s: Sea, x: number, z: number, c: number) {
  if (s.side === 's') return z < c;
  if (s.side === 'n') return z > c;
  if (s.side === 'e') return x < c;
  return x > c;
}

// The region's WaterSpec for the part of the world inside a box (the live play area's GameWater):
// the lakes that reach it, and the rivers' stretches through it (run on past the box by `margin`).
export function waterInBox(w: WorldWaterSpec, box: { x0: number; z0: number; x1: number; z1: number }, margin = 600): WaterSpec {
  const inside = (p: XZ, m: number) => p.x >= box.x0 - m && p.x <= box.x1 + m && p.z >= box.z0 - m && p.z <= box.z1 + m;
  const lakes = w.lakes.filter((L) => inside(L, L.r * 1.35 + 10));
  const rivers: RiverSpec[] = [];
  for (const r of w.rivers) {
    let run: XZ[] = [], wmax = 0;
    const flush = () => { if (run.length > 1) rivers.push({ path: run, width: Math.round(wmax) }); run = []; wmax = 0; };
    r.path.forEach((p, i) => { if (inside(p, margin)) { run.push(p); wmax = Math.max(wmax, r.widths[i]); } else flush(); });
    flush();
  }
  return { lakes, rivers };
}
