// Procedural terrain: a seeded height field that looks like somewhere in Britain, from Fenland
// flats through Cotswold-style rolling hills to Lake District fells, chosen by a few numbers.
//
// The height is built in layers, broadest first:
//   1. a domain warp — every later layer is looked up at a slightly pushed-about position, which
//      bends straight noise features into meanders and spurs;
//   2. the regional surface — very broad swells a few kilometres across (the valley floors
//      follow this, so rivers run at a sensible level);
//   3. rolling hills on top;
//   4. an upland mask, and within it ridged noise for crests, edges and fells;
//   5. river valleys carved along the zero lines of a broad noise field: a channel, a flat
//      floodplain and valley sides that ease back into the hills (wider and deeper in the uplands);
//   6. lakes: a few per region, placed per coarse cell (deterministic from the cell's hash), each
//      a flat surface with a bowl beneath and a shore that rises out of it; plus an optional sea
//      level, below which everything is water.
// Everything is a pure function of the seed and the position, so every tile is deterministic and
// meets its neighbours exactly, whatever order they are generated in.

import { BaseHeight, type GridSpec } from './height';
import { Noise2, hash32, mulberry, smoothstep } from './noise';

export interface TerrainParams {
  seed: number;
  scale: number; // horizontal stretch: 2 makes every feature twice as broad
  baseHeight: number; // metres: the lowest the regional surface goes
  base: number; // metres of broad regional swell
  hills: number; // metres of rolling hills
  upland: number; // 0..1: how much of the land is upland (0 = none at all)
  mountains: number; // metres of ridged relief at the heart of the uplands
  warp: number; // metres the domain is pushed about
  rivers: number; // river density (0 = none, 1 ≈ one every 3 km)
  riverWidth: number; // metres, the channel
  riverDepth: number; // metres, bank to bed
  valleyWidth: number; // metres either side of the channel before the valley sides reach the hills
  lakes: number; // 0..1: chance that each 2 km cell holds a lake
  sea: number | null; // sea level in metres, or null for an inland map
}

export const TERRAIN_PRESETS: Record<'flat' | 'lowland' | 'rolling' | 'upland' | 'mountain', Partial<TerrainParams>> = {
  flat: { base: 0, hills: 0, upland: 0, rivers: 0, lakes: 0, warp: 0 },
  lowland: { base: 12, hills: 6, upland: 0, rivers: 0.8, valleyWidth: 220, lakes: 0.15 },
  rolling: { base: 60, hills: 35, upland: 0.15, mountains: 120, rivers: 1, lakes: 0.2 },
  upland: { base: 120, hills: 45, upland: 0.55, mountains: 320, rivers: 1, lakes: 0.3, valleyWidth: 160 },
  mountain: { base: 200, hills: 60, upland: 0.9, mountains: 650, rivers: 0.9, lakes: 0.35, valleyWidth: 140, riverDepth: 3 },
};

export const DEFAULT_TERRAIN: TerrainParams = {
  seed: 1, scale: 1, baseHeight: 5, base: 60, hills: 35, upland: 0.15, mountains: 120, warp: 350,
  rivers: 1, riverWidth: 14, riverDepth: 2.5, valleyWidth: 180, lakes: 0.2, sea: null,
};

interface Lake { cx: number; cz: number; r: number; level: number; depth: number }
const LAKE_CELL = 2000;

// The smooth layers (warp, regional surface, hills, uplands, the river field) have nothing finer
// than about 50 m in them, so they are evaluated on a lattice LATTICE metres apart and read back
// with Catmull-Rom interpolation, which is smooth enough that lighting shows no grid. Only the
// sharp parts (the river channel, lake shores) are worked out per point. The lattice is kept in
// blocks of BLOCK × BLOCK cells, cached, so heightAt costs a few dozen multiplies once warm.
// This lattice is part of the definition of the terrain: every caller sees the same numbers.
// Its spacing (7.8125 m) divides a 1 km tile 128 times, so the grids of coarser levels of detail
// (a tile at 64, 32, 16… cells) land exactly on lattice points and can be evaluated directly.
const LATTICE = 1000 / 128, BLOCK = 32, SIDE = BLOCK + 3, MAX_BLOCKS = 1024;
// four fields per lattice point: height before the rivers, valley floor, upland mask, river field
const F = 4;
interface Block { bi: number; bj: number; d: Float32Array; lakes?: Lake[] }

// Catmull-Rom weights for fraction t, into w[o..o+3].
function crWeights(t: number, w: Float64Array, o: number) {
  const t2 = t * t, t3 = t2 * t;
  w[o] = (-t3 + 2 * t2 - t) / 2; w[o + 1] = (3 * t3 - 5 * t2 + 2) / 2; w[o + 2] = (-3 * t3 + 4 * t2 + t) / 2; w[o + 3] = (t3 - t2) / 2;
}

export class ProceduralTerrain extends BaseHeight {
  readonly p: TerrainParams;
  private n: Noise2;
  private lakes = new Map<number, Lake | null>();
  private blocks = new Map<number, Block>();
  private lastBlock: Block | null = null;
  private lastKey = NaN;
  private step: number;
  private water: number | null = null; // water surface found by the last eval()
  private w = new Float64Array(8); // interpolation weights, reused
  private f = new Float64Array(F); // fields at the last point interpolated
  constructor(params: Partial<TerrainParams> = {}) {
    super();
    this.p = { ...DEFAULT_TERRAIN, ...params };
    this.n = new Noise2(this.p.seed);
    this.step = LATTICE;
  }

  heightAt(x: number, z: number) { return this.eval(x, z); }
  waterLevel(x: number, z: number) { this.eval(x, z); return this.water; }
  isWater(x: number, z: number) { const h = this.eval(x, z); return this.water !== null && this.water > h; }
  get cachedBlocks() { return this.blocks.size; }

  // The smooth layers at one lattice point, into d[o..o+3].
  private smooth(x: number, z: number, d: Float32Array, o: number) {
    const p = this.p, n = this.n, S = p.scale;
    let wx = x, wz = z;
    if (p.warp) {
      const u = x / (1800 * S), v = z / (1800 * S);
      wx += p.warp * n.fbm(u + 11.1, v - 3.7, 2);
      wz += p.warp * n.fbm(u - 7.9, v + 5.3, 2);
    }
    const floor = p.baseHeight + p.base * (0.5 + 0.5 * n.fbm(wx / (7000 * S) + 50.5, wz / (7000 * S) - 20.5, 3));
    let mask = 0;
    if (p.upland > 0) {
      const t0 = 0.55 - 1.1 * p.upland;
      mask = smoothstep(t0, t0 + 0.45, n.fbm(x / (12000 * S) - 40.2, z / (12000 * S) + 20.7, 2)) * Math.min(1, p.upland * 5);
    }
    let h = floor;
    if (p.hills) h += p.hills * (1 + mask) * (0.5 + 0.5 * n.fbm(wx / (900 * S) + 3.3, wz / (900 * S) + 7.7, 5));
    if (mask > 0.002) h += p.mountains * mask * n.ridged(wx / (2600 * S) + 9.1, wz / (2600 * S) - 4.3, 5);
    d[o] = h; d[o + 1] = floor; d[o + 2] = mask;
    d[o + 3] = p.rivers > 0 ? n.fbm(wx / ((3200 * S) / p.rivers) - 23.3, wz / ((3200 * S) / p.rivers) + 61.1, 2) : 0;
  }
  private block(bi: number, bj: number): Block {
    const key = (bi + 32768) * 65536 + (bj + 32768);
    if (key === this.lastKey) return this.lastBlock!;
    let b = this.blocks.get(key);
    if (!b) {
      b = { bi, bj, d: new Float32Array(SIDE * SIDE * F) };
      // lattice points bi·BLOCK − 1 … bi·BLOCK + BLOCK + 1: one before and two after, for the cubic
      for (let j = 0, k = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++, k += F) this.smooth((bi * BLOCK + i - 1) * this.step, (bj * BLOCK + j - 1) * this.step, b.d, k);
      this.blocks.set(key, b);
      if (this.blocks.size > MAX_BLOCKS) this.blocks.delete(this.blocks.keys().next().value!);
    }
    this.lastBlock = b; this.lastKey = key;
    return b;
  }
  private blockAt(x: number, z: number) { return this.block(Math.floor(Math.floor(x / this.step) / BLOCK), Math.floor(Math.floor(z / this.step) / BLOCK)); }

  // The four smooth fields at a point, into this.f.
  private fields(x: number, z: number) {
    const fx = x / this.step, fz = z / this.step, ix = Math.floor(fx), iz = Math.floor(fz);
    const bi = Math.floor(ix / BLOCK), bj = Math.floor(iz / BLOCK), d = this.block(bi, bj).d, w = this.w, f = this.f;
    crWeights(fx - ix, w, 0); crWeights(fz - iz, w, 4);
    const k0 = ((iz - bj * BLOCK) * SIDE + (ix - bi * BLOCK)) * F;
    for (let c = 0; c < F; c++) {
      let v = 0;
      for (let r = 0; r < 4; r++) {
        const k = k0 + r * SIDE * F + c;
        v += w[4 + r] * (w[0] * d[k] + w[1] * d[k + F] + w[2] * d[k + 2 * F] + w[3] * d[k + 3 * F]);
      }
      f[c] = v;
    }
  }

  // From the smooth fields to the final height: rivers, then lakes, then the sea. Sets this.water.
  private finish(x: number, z: number, h: number, floor: number, mask: number, rv: number, lakes: Lake[] | undefined) {
    const p = this.p;
    this.water = null;
    if (p.rivers > 0) {
      const lam = (3200 * p.scale) / p.rivers;
      // approximate distance to the river's line: the noise value over its gradient (≈ 1.1/λ)
      const d = (Math.abs(rv) * lam) / 1.1;
      const vw = p.valleyWidth * (1 + 1.5 * mask), half = p.riverWidth / 2;
      if (d < vw) {
        // the valley: the hills ease down to a floodplain at the regional floor...
        const t = smoothstep(half, vw, d);
        h = floor + (h - floor) * t * t;
        // ...and the channel is cut into it, a rounded trough
        if (d < half) {
          const q = d / half, bed = floor - p.riverDepth * (1 + mask);
          h = bed + (floor - bed) * q * q;
          this.water = floor - 0.3;
        }
      }
    }
    if (lakes) for (const l of lakes) {
      const dx = x - l.cx, dz = z - l.cz;
      if (Math.abs(dx) > l.r * 2.4 || Math.abs(dz) > l.r * 2.4) continue;
      // a wobbly shoreline rather than a circle
      const r = l.r * (1 + 0.3 * this.n.at(x / 180 + 71.3, z / 180 - 12.9));
      const q = Math.hypot(dx, dz) / r;
      if (q >= 1.8) continue;
      const rim = l.level + 0.5;
      if (q < 1) {
        h = rim - (l.depth + 0.5) * (1 - q * q);
        this.water = this.water === null ? l.level : Math.max(this.water, l.level);
      } else h = rim + (h - rim) * smoothstep(1, 1.8, q); // the shore: eased to just above the water, up or down
    }
    if (p.sea !== null && h < p.sea) this.water = this.water === null ? p.sea : Math.max(this.water, p.sea);
    return h;
  }

  private lake(ci: number, cj: number): Lake | null {
    const k = (ci + 32768) * 65536 + (cj + 32768);
    let l = this.lakes.get(k);
    if (l !== undefined) return l;
    const r = mulberry(hash32(this.p.seed, ci, cj, 0x1a4e));
    l = null;
    const C = LAKE_CELL * this.p.scale;
    if (r() < this.p.lakes) {
      const cx = (ci + 0.2 + 0.6 * r()) * C, cz = (cj + 0.2 + 0.6 * r()) * C;
      const rad = (90 + 260 * r()) * Math.sqrt(this.p.scale);
      // the surface sits a little below the land at its centre, so the bowl reads as a hollow
      // (worked out directly at the centre: no lattice block needed there)
      const d = new Float32Array(F);
      this.smooth(cx, cz, d, 0);
      const level = this.finish(cx, cz, d[0], d[1], d[2], d[3], undefined) - 1.5;
      l = { cx, cz, r: rad, level, depth: 3 + 12 * r() };
    }
    this.lakes.set(k, l);
    return l;
  }
  // The lakes whose shores reach into a box.
  private lakesIn(x0: number, z0: number, x1: number, z1: number) {
    const out: Lake[] = [];
    if (this.p.lakes <= 0) return out;
    const S = this.p.scale, C = LAKE_CELL * S, reach = 2.4 * 350 * Math.sqrt(S);
    for (let ci = Math.floor((x0 - reach) / C); ci <= Math.floor((x1 + reach) / C); ci++) for (let cj = Math.floor((z0 - reach) / C); cj <= Math.floor((z1 + reach) / C); cj++) {
      const l = this.lake(ci, cj);
      if (l && l.cx + l.r * 2.4 > x0 && l.cx - l.r * 2.4 < x1 && l.cz + l.r * 2.4 > z0 && l.cz - l.r * 2.4 < z1) out.push(l);
    }
    return out;
  }

  private eval(x: number, z: number) {
    let lakes: Lake[] | undefined;
    if (this.p.lakes > 0) {
      const b = this.blockAt(x, z), s = BLOCK * this.step;
      lakes = b.lakes ??= this.lakesIn(b.bi * s, b.bj * s, (b.bi + 1) * s, (b.bj + 1) * s);
    }
    this.fields(x, z);
    const f = this.f;
    return this.finish(x, z, f[0], f[1], f[2], f[3], lakes);
  }

  // A whole grid at once. The same numbers as heightAt, but the cubic is done separably (along x
  // for every lattice row, then along z), which is about four times less work per point.
  sample(g: GridSpec, out = new Float32Array(g.nx * g.nz), water?: Float32Array) {
    const st = this.step, nx = g.nx, nz = g.nz;
    const lx0 = Math.floor(g.x0 / st) - 1, lx1 = Math.floor((g.x0 + (nx - 1) * g.step) / st) + 2;
    const lz0 = Math.floor(g.z0 / st) - 1, lz1 = Math.floor((g.z0 + (nz - 1) * g.step) / st) + 2;
    const LX = lx1 - lx0 + 1, LZ = lz1 - lz0 + 1;
    const lakes = this.lakesIn(g.x0, g.z0, g.x0 + (nx - 1) * g.step, g.z0 + (nz - 1) * g.step);
    // coarse grids (far levels of detail, overviews) evaluate the smooth layers at each point
    // instead: exact where the points are lattice points, and far less work than the lattice
    if (g.step >= 2 * st) {
      const d = new Float32Array(F);
      for (let j = 0, k = 0; j < nz; j++) for (let i = 0; i < nx; i++, k++) {
        const x = g.x0 + i * g.step, z = g.z0 + j * g.step;
        this.smooth(x, z, d, 0);
        const y = (out[k] = this.finish(x, z, d[0], d[1], d[2], d[3], lakes));
        if (water) water[k] = this.water !== null && this.water > y ? this.water : NaN;
      }
      return out;
    }
    // 1. the lattice patch under the grid, copied from the cached blocks
    const lat = new Float32Array(LX * LZ * F);
    // (a block that only a thin strip of the patch reaches into, like the border a mesh asks for
    // to get its edge normals, isn't built: those few points are worked out directly)
    const reach = (b: number, a0: number, a1: number) => Math.min(a1, b * BLOCK + BLOCK - 1) - Math.max(a0, b * BLOCK) + 1;
    for (let Z = lz0; Z <= lz1; Z++) {
      const bj = Math.floor(Z / BLOCK), j = Z - bj * BLOCK + 1;
      for (let X = lx0; X <= lx1;) {
        const bi = Math.floor(X / BLOCK), run = Math.min(lx1, bi * BLOCK + BLOCK - 1) - X + 1, at = ((Z - lz0) * LX + X - lx0) * F;
        if (this.blocks.has((bi + 32768) * 65536 + (bj + 32768)) || (reach(bi, lx0, lx1) >= 4 && reach(bj, lz0, lz1) >= 4)) {
          const d = this.block(bi, bj).d, src = (j * SIDE + X - bi * BLOCK + 1) * F;
          lat.set(d.subarray(src, src + run * F), at);
        } else for (let q = 0; q < run; q++) this.smooth((X + q) * st, Z * st, lat, at + q * F);
        X += run;
      }
    }
    // 2. along x: every lattice row, at every column of the grid
    const wx = new Float64Array(nx * 4), bx = new Int32Array(nx);
    for (let i = 0; i < nx; i++) { const fx = (g.x0 + i * g.step) / st, ix = Math.floor(fx); crWeights(fx - ix, wx, i * 4); bx[i] = ix - 1 - lx0; }
    const row = new Float32Array(LZ * nx * F);
    for (let Z = 0; Z < LZ; Z++) for (let i = 0; i < nx; i++) {
      const k = (Z * LX + bx[i]) * F, o = (Z * nx + i) * F, w0 = wx[i * 4], w1 = wx[i * 4 + 1], w2 = wx[i * 4 + 2], w3 = wx[i * 4 + 3];
      for (let c = 0; c < F; c++) row[o + c] = w0 * lat[k + c] + w1 * lat[k + F + c] + w2 * lat[k + 2 * F + c] + w3 * lat[k + 3 * F + c];
    }
    // 3. along z, then the sharp parts per point
    const wz = new Float64Array(4);
    for (let j = 0, k = 0; j < nz; j++) {
      const z = g.z0 + j * g.step, fz = z / st, iz = Math.floor(fz);
      crWeights(fz - iz, wz, 0);
      const r0 = (iz - 1 - lz0) * nx * F, R = nx * F, a0 = wz[0], a1 = wz[1], a2 = wz[2], a3 = wz[3];
      for (let i = 0; i < nx; i++, k++) {
        const o = r0 + i * F;
        const h = a0 * row[o] + a1 * row[o + R] + a2 * row[o + 2 * R] + a3 * row[o + 3 * R];
        const fl = a0 * row[o + 1] + a1 * row[o + 1 + R] + a2 * row[o + 1 + 2 * R] + a3 * row[o + 1 + 3 * R];
        const m = a0 * row[o + 2] + a1 * row[o + 2 + R] + a2 * row[o + 2 + 2 * R] + a3 * row[o + 2 + 3 * R];
        const rv = a0 * row[o + 3] + a1 * row[o + 3 + R] + a2 * row[o + 3 + 2 * R] + a3 * row[o + 3 + 3 * R];
        const y = this.finish(g.x0 + i * g.step, z, h, fl, m, rv, lakes);
        out[k] = y;
        if (water) water[k] = this.water !== null && this.water > y ? this.water : NaN;
      }
    }
    return out;
  }
  // The water surface over each point of a grid (NaN where dry), for drawing water.
  sampleWater(g: GridSpec, out = new Float32Array(g.nx * g.nz)) {
    this.sample(g, undefined, out);
    return out;
  }
}
