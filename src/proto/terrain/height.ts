// The height source: the one question every layer asks of the ground. "How high is it here,
// how steep, and is it under water?" Procedural terrain and real elevation data both answer it,
// so nothing above this line needs to know which one it is talking to (ROADMAP: anything
// procedural must be able to take real data instead).
//
// World coordinates are metres on the region's local projection: x east, z south (so north is
// -z, as the camera looks by default), heights y up, all absolute (not above a flat plane).

// A regular grid of samples: nx × nz points, the first at (x0, z0), `step` metres apart.
// Samples are stored row by row (z outer, x inner), so data[j * nx + i] is at (x0 + i·step, z0 + j·step).
export interface GridSpec { x0: number; z0: number; step: number; nx: number; nz: number }
export interface HeightGrid extends GridSpec { data: Float32Array }

export interface HeightSource {
  // ground height in metres (the bed, where there is water)
  heightAt(x: number, z: number): number;
  // height of the water surface covering this spot, or null when it's dry
  waterLevel(x: number, z: number): number | null;
  isWater(x: number, z: number): boolean;
  // steepest gradient (rise over run, so 0.08 is 8%) and the unit surface normal
  slopeAt(x: number, z: number): number;
  normalAt(x: number, z: number): [number, number, number];
  // every point of a grid in one go (for meshing, caching and profiles): implementations can do
  // this much faster than one call per point
  sample(g: GridSpec, out?: Float32Array): Float32Array;
}

// The shared parts, derived from heightAt and waterLevel. Subclasses override sample() when they
// have a faster way to fill a grid.
export abstract class BaseHeight implements HeightSource {
  // finite-difference spacing for slopes and normals; about the resolution of the source
  protected eps = 1;
  abstract heightAt(x: number, z: number): number;
  waterLevel(_x: number, _z: number): number | null { return null; }
  isWater(x: number, z: number) {
    const w = this.waterLevel(x, z);
    return w !== null && w > this.heightAt(x, z);
  }
  // (dh/dx, dh/dz) by central differences
  gradAt(x: number, z: number): [number, number] {
    const e = this.eps;
    return [(this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e), (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e)];
  }
  slopeAt(x: number, z: number) { const [gx, gz] = this.gradAt(x, z); return Math.hypot(gx, gz); }
  normalAt(x: number, z: number): [number, number, number] {
    const [gx, gz] = this.gradAt(x, z), l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  }
  sample(g: GridSpec, out = new Float32Array(g.nx * g.nz)) {
    for (let j = 0, k = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++, k++) out[k] = this.heightAt(g.x0 + i * g.step, g.z0 + j * g.step);
    return out;
  }
}

// Level ground at one height, with optional water (the prototype's world, as a height source).
export class FlatHeight extends BaseHeight {
  constructor(public h = 0, private water: (x: number, z: number) => boolean = () => false, private surface = 0.1) { super(); }
  heightAt() { return this.h; }
  waterLevel(x: number, z: number) { return this.water(x, z) ? this.h + this.surface : null; }
  isWater(x: number, z: number) { return this.water(x, z); }
  slopeAt() { return 0; }
  normalAt(): [number, number, number] { return [0, 1, 0]; }
}

// Any function of (x, z) as a height source — handy for tests and hand-made scenes.
export class FnHeight extends BaseHeight {
  constructor(private f: (x: number, z: number) => number, private w: (x: number, z: number) => number | null = () => null) { super(); }
  heightAt(x: number, z: number) { return this.f(x, z); }
  waterLevel(x: number, z: number) { return this.w(x, z); }
}

// Bilinear sample of a grid at a world point (clamped to the grid's edge).
export function gridHeight(g: HeightGrid, x: number, z: number) {
  let fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  fx = Math.max(0, Math.min(g.nx - 1, fx)); fz = Math.max(0, Math.min(g.nz - 1, fz));
  const i = Math.min(g.nx - 2, Math.floor(fx)), j = Math.min(g.nz - 2, Math.floor(fz));
  const tx = fx - i, tz = fz - j, d = g.data, k = j * g.nx + i;
  const a = d[k] + (d[k + 1] - d[k]) * tx, b = d[k + g.nx] + (d[k + g.nx + 1] - d[k + g.nx]) * tx;
  return a + (b - a) * tz;
}

// ---------- tiles ----------
// The world is cut into square tiles (1 km by default, as in ENGINE.md). A tile key is a pair of
// integers; everything generated for a tile is a pure function of the source and its key.
export const TILE = 1000;
export const tileKey = (ti: number, tj: number) => `${ti},${tj}`;
export const tileOf = (x: number, z: number, size = TILE): [number, number] => [Math.floor(x / size), Math.floor(z / size)];
// the grid covering tile (ti, tj) edge to edge with `n` cells a side (n + 1 points: the edge
// points are shared with the neighbours, which is what makes seams meet)
export const tileGrid = (ti: number, tj: number, n: number, size = TILE): GridSpec => ({ x0: ti * size, z0: tj * size, step: size / n, nx: n + 1, nz: n + 1 });

// A cache in front of any height source: heights come from a grid per tile, filled on first use
// with the source's fast sample() and read back bilinearly. That makes heightAt a few array reads
// however expensive the source is (the procedural one stacks a dozen octaves of noise). The grid
// spacing is the cache's resolution: features finer than it are smoothed away, so match it to
// what the source actually holds (2 m for procedural, 30–50 m for real data is plenty).
export class CachedHeight extends BaseHeight {
  private tiles = new Map<number, HeightGrid>();
  private last: HeightGrid | null = null;
  private lastKey = NaN;
  readonly n: number;
  hits = 0; misses = 0;
  constructor(readonly src: HeightSource, readonly size = 250, readonly res = 2, readonly maxTiles = 256) {
    super();
    this.n = Math.max(1, Math.round(size / res));
    this.eps = size / this.n;
  }
  // numeric key: tile indices within ±32767 of the origin (±8,000 km at 250 m tiles)
  private key(ti: number, tj: number) { return (ti + 32768) * 65536 + (tj + 32768); }
  grid(ti: number, tj: number): HeightGrid {
    const k = this.key(ti, tj);
    if (k === this.lastKey && this.last) return this.last;
    let g = this.tiles.get(k);
    if (g) {
      this.hits++;
      // move to the back so the Map's insertion order is least-recently-used first
      this.tiles.delete(k); this.tiles.set(k, g);
    } else {
      this.misses++;
      const spec = tileGrid(ti, tj, this.n, this.size);
      g = { ...spec, data: this.src.sample(spec) };
      this.tiles.set(k, g);
      if (this.tiles.size > this.maxTiles) this.tiles.delete(this.tiles.keys().next().value!);
    }
    this.last = g; this.lastKey = k;
    return g;
  }
  heightAt(x: number, z: number) {
    const ti = Math.floor(x / this.size), tj = Math.floor(z / this.size);
    return gridHeight(this.grid(ti, tj), x, z);
  }
  waterLevel(x: number, z: number) { return this.src.waterLevel(x, z); }
  isWater(x: number, z: number) {
    const w = this.src.waterLevel(x, z);
    return w !== null && w > this.heightAt(x, z);
  }
  // forget tiles (all, or those a changed area touches) — for when the source is edited
  invalidate(box?: [number, number, number, number]) {
    if (!box) { this.tiles.clear(); this.last = null; this.lastKey = NaN; return; }
    for (let i = Math.floor(box[0] / this.size); i <= Math.floor(box[2] / this.size); i++)
      for (let j = Math.floor(box[1] / this.size); j <= Math.floor(box[3] / this.size); j++) this.tiles.delete(this.key(i, j));
    this.last = null; this.lastKey = NaN;
  }
  get count() { return this.tiles.size; }
}
