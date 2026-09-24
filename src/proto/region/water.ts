// A map's water as data: lakes (noise-warped bowls) and rivers (a channel along a centre line),
// and the ground they make. The water library (src/proto/water) takes a height source and finds
// the water in it, so this is the form it takes: `waterGround(spec)` is the ground (flat at 0,
// dipping into every bed), and WATER_LEVEL the level it fills them to (an FnHeight of the two).
// Pure: no three.js, no DOM (game/water.ts draws it; the region generator keeps towns off it).
//
// Metres, x east, z south, as everywhere else.

export interface XZ { x: number; z: number }
// a lake: centre, rough radius (its shore wobbles by up to ±13% round it), and the phases of the
// three slow waves that give the shore its bays and headlands
export interface LakeSpec { x: number; z: number; r: number; waves?: [number, number, number] }
// a river: its centre line (smooth: points a few tens of metres apart) and its width at the waterline
export interface RiverSpec { path: XZ[]; width: number }
export interface WaterSpec { lakes: LakeSpec[]; rivers: RiverSpec[] }

// The water's surface as drawn (a little under the flat map, so its banks shelve down to it). The
// water system is given a level DROP higher, so the water it finds (from 8 cm deep, its film)
// reaches 2 cm past the drawn waterline: its raster, its shore distance, the land claims and
// isWater never fall short of the water you see.
export const LEVEL = -0.3;
export const DROP = 0.1;
export const WATER_LEVEL = LEVEL + DROP;
const DEEP = 4.2; // m of water in the middle of a lake
const RIVER_DEEP = 2.2; // and of a river
export const RIM = 8; // m out from the waterline where the beach starts dropping from the flat (4% at the water)
const SHELF = 0.3; // how far in (share of the radius) a lake's bed reaches its full depth
const RIVER_SHELF = 0.6; // (share of a river's half-width)
// the town's lake keeps the shore it has always had
export const TOWN_WAVES: [number, number, number] = [0.7, 2.1, 0.4];

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// a lake's radius in each direction: a few slow waves, so the shore has bays and headlands
export function lakeRadiusOf(L: LakeSpec, a: number) {
  const w = L.waves ?? TOWN_WAVES;
  return L.r * (1 + 0.075 * Math.sin(2 * a + w[0]) + 0.05 * Math.sin(3 * a + w[1]) + 0.03 * Math.sin(5 * a + w[2]));
}
// The bank's profile, `u` metres inside the waterline of a body `R` across to its middle: from the
// flat down to the waterline over the rim (a beach, easing off the flat and meeting the water on a
// slope, so the waterline is crisp), then shelving on down to the full depth (straight for the last
// 70%, where beaches are drawn, so the shore distance read off the slope is true).
function bank(u: number, R: number, shelf: number, deep: number) {
  if (u <= -RIM) return 0;
  if (u <= 0) { const t = (u + RIM) / RIM, e = 0.3; return (LEVEL * (t < e ? (t * t) / (2 * e) : t - e / 2)) / (1 - e / 2); }
  const t = Math.min(1, u / (shelf * R));
  return LEVEL - (deep + LEVEL) * (0.12 * t + 0.88 * smooth(t)); // (starting at about the beach's slope)
}
// The ground in and round one lake (0 away from it).
export function lakeGroundOf(L: LakeSpec, x: number, z: number) {
  const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
  if (d > L.r * 1.35) return 0;
  const R = lakeRadiusOf(L, Math.atan2(dz, dx));
  return bank(R - d, R, SHELF, DEEP);
}
// the bowl's extent, with room for the bank (past the widest bay and its beach)
export const lakeBox = (L: LakeSpec) => ({ x0: L.x - L.r * 1.35, z0: L.z - L.r * 1.35, x1: L.x + L.r * 1.35, z1: L.z + L.r * 1.35 });

// Nearest distance from a point to a polyline, through a grid of buckets (a river is thousands of
// metres long; the water system asks about millions of points).
export class LineIndex {
  private cells = new Map<number, number[]>();
  constructor(readonly path: XZ[], readonly cell = 64) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const i0 = Math.floor(Math.min(a.x, b.x) / cell), i1 = Math.floor(Math.max(a.x, b.x) / cell);
      const j0 = Math.floor(Math.min(a.z, b.z) / cell), j1 = Math.floor(Math.max(a.z, b.z) / cell);
      for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) {
        const k = key(ci, cj);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(i);
      }
    }
  }
  // distance to the line, or Infinity when it's further than `max`
  near(x: number, z: number, max: number) {
    const c = this.cell, r = Math.ceil(max / c), ci = Math.floor(x / c), cj = Math.floor(z / c), P = this.path;
    let best = Infinity;
    // (far enough that the buckets would cost more than the line: just walk it)
    if ((2 * r + 1) ** 2 > P.length) {
      for (let i = 1; i < P.length; i++) best = Math.min(best, segDist(x, z, P[i - 1], P[i]));
      return best <= max ? best : Infinity;
    }
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      const l = this.cells.get(key(ci + di, cj + dj));
      if (!l) continue;
      for (const i of l) { const d = segDist(x, z, P[i - 1], P[i]); if (d < best) best = d; }
    }
    return best <= max ? best : Infinity;
  }
}
function segDist(x: number, z: number, a: XZ, b: XZ) {
  const ux = b.x - a.x, uz = b.z - a.z, L2 = ux * ux + uz * uz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * ux + (z - a.z) * uz) / L2));
  return Math.hypot(x - a.x - ux * t, z - a.z - uz * t);
}
const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

// how far either side of a river's centre line its ground dips (the water and the beach)
export const riverReach = (r: RiverSpec) => r.width / 2 + RIM;

// A map's water, ready to ask about: the ground (for the water system and the ground mesh), and
// quick tests for "is there water anywhere near here?".
export class MapWater {
  readonly rivers: { spec: RiverSpec; index: LineIndex; half: number }[];
  readonly boxes: { x0: number; z0: number; x1: number; z1: number }[];
  constructor(readonly spec: WaterSpec) {
    this.rivers = spec.rivers.map((r) => ({ spec: r, index: new LineIndex(r.path), half: r.width / 2 }));
    this.boxes = [...spec.lakes.map(lakeBox), ...spec.rivers.map((r) => {
      const m = riverReach(r);
      return { x0: Math.min(...r.path.map((p) => p.x)) - m, z0: Math.min(...r.path.map((p) => p.z)) - m, x1: Math.max(...r.path.map((p) => p.x)) + m, z1: Math.max(...r.path.map((p) => p.z)) + m };
    })];
  }
  // the ground with only the lakes' bowls in it (rivers' channels are drawn as strips of their own)
  lakesGround = (x: number, z: number) => {
    let h = 0;
    for (const L of this.spec.lakes) { const g = lakeGroundOf(L, x, z); if (g < h) h = g; }
    return h;
  };
  // the ground: flat at 0, dipping into each bed
  ground = (x: number, z: number) => {
    let h = this.lakesGround(x, z);
    for (const r of this.rivers) {
      const d = r.index.near(x, z, r.half + RIM);
      if (d === Infinity) continue;
      const g = bank(r.half - d, r.half, RIVER_SHELF, RIVER_DEEP);
      if (g < h) h = g;
    }
    return h;
  };
  // Could there be water within `m` metres of this spot? (false means certainly not)
  mayBeNear(p: XZ, m: number) {
    for (const L of this.spec.lakes) { const B = lakeBox(L); if (p.x >= B.x0 - m && p.x <= B.x1 + m && p.z >= B.z0 - m && p.z <= B.z1 + m) return true; }
    for (const r of this.rivers) if (r.index.near(p.x, p.z, r.half + RIM + m) !== Infinity) return true;
    return false;
  }
  // Roughly how far a spot is from the water's edge (negative in the water): from the shapes, not
  // the water system, so the generator can ask it before anything is built.
  // (Past `cap` metres it only promises "at least cap", which is much quicker to answer.)
  edgeDistance(p: XZ, cap = 1e5) {
    let best = cap;
    for (const L of this.spec.lakes) {
      const dx = p.x - L.x, dz = p.z - L.z;
      best = Math.min(best, Math.hypot(dx, dz) - lakeRadiusOf(L, Math.atan2(dz, dx)));
    }
    for (const r of this.rivers) {
      const d = r.index.near(p.x, p.z, cap + r.half);
      if (d !== Infinity) best = Math.min(best, d - r.half);
    }
    return best;
  }
}

// the town's water: one lake south-east of the centre
export const TOWN_LAKE: LakeSpec = { x: 250, z: -190, r: 90 };
export const TOWN_WATER: WaterSpec = { lakes: [TOWN_LAKE], rivers: [] };
