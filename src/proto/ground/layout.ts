// The countryside's layout: field parcels, what each one is, and the hedgerows between them.
//
// Parcels are anchored to the world, not to a map, so any cover map anywhere agrees about them:
// a jittered grid (rotated, and longer one way than the other, as enclosure fields tend to be) of
// seeds, each seed's Voronoi cell a field. Some cells are merged with a neighbour (big fields),
// some split in two by a straight hedge (small ones), so the patchwork isn't a grid. What a parcel
// becomes (arable, grass, wood, rough, or part of the town) depends on what's around it: the
// town's plots and parks, its roads, water.
//
// Plain arrays and numbers, no three.js, so the tests run in Node.
import { hash2, worldNoise } from './noise';
import { CROP } from './covers';

export interface XZ { x: number; z: number }
export type ParcelKind = 'arable' | 'grass' | 'wood' | 'rough' | 'town';

// What the painter needs to know about the world. Every polygon is in world metres.
export interface GroundInput {
  seed?: number;
  // road and rail footprints (the land registry's claims): nothing agricultural goes on them, and
  // a band round them becomes a verge (mown in town, rough in the country)
  blocked?: XZ[][];
  // centrelines of country roads and railways, which get hedges along both sides
  lanes?: { path: XZ[]; half: number; hedge?: boolean }[];
  // plots: gardens become lawn, building sites bare earth, yards worn and rough
  plots?: { poly: XZ[]; kind: 'garden' | 'site' | 'yard' }[];
  // parks and playing fields: lawn, with mowing stripes along `stripes` (radians) if given
  parks?: { poly: XZ[]; stripes?: number }[];
  water?: XZ[][];
  // standing trees: woodland floor under the ones out of town
  trees?: XZ[];
  // more places that count as town (plots still to be built, say)
  town?: XZ[];
  // industrial land: town, but rough and worn rather than mown
  industrial?: XZ[];
  // no fields at all (a park demo, say): everything not town is grass
  noFields?: boolean;
}

// ---- the parcel grid ----
// Fields are the cells of a grid whose corners are jittered a little and whose lines bend gently
// over a kilometre or two (a smooth displacement of every corner), so they're four-sided with
// near-square corners, as enclosure fields are, but face every which way across the map.
const ANGLE = 0.33; // the grid's mean rotation
const SX = 240, SZ = 165; // cell size in metres: ~4 ha, 2 ha when split, 8 when merged
export const GRID = { angle: ANGLE, sx: SX, sz: SZ };
const JIT = 0.12; // corner jitter, in cells
const BEND = 120, BEND_L = 1500; // how far (m) the grid lines wander, and over what distance
const CA = Math.cos(ANGLE), SA = Math.sin(ANGLE);
// world -> the undisplaced grid (cells are unit squares), and back
export const toGrid = (x: number, z: number): [number, number] => [(x * CA + z * SA) / SX, (-x * SA + z * CA) / SZ];
export const gridU = (x: number, z: number) => (x * CA + z * SA) / SX; // (the same, one at a time, for hot loops)
export const gridV = (x: number, z: number) => (-x * SA + z * CA) / SZ;
export const fromGrid = (u: number, v: number): XZ => ({ x: u * SX * CA - v * SZ * SA, z: u * SX * SA + v * SZ * CA });

export interface Cell {
  i: number; j: number;
  u: number; v: number; // its middle, in (undisplaced) grid coordinates
  pts: XZ[]; // its corners in world metres, anticlockwise from (i, j)
  merge: boolean; // merged with its +i neighbour into one field
  split: null | { nu: number; nv: number; c: number }; // a hedge across it: side = sign(nu·u + nv·v − c), in grid coordinates
}

// How far the grid is moved at a point: a gentle wander, plus swirls about 900 m apart that
// turn the grid by up to about 50 degrees round their middles (and not at all far from them), so
// one farm's fields face a different way from the next. Turning falls off smoothly enough that
// cells never fold over.
const SWIRL = 900, SWIRL_R = 600, SWIRL_MAX = 0.9;
// A layout can be given straighter fields, by its seed (a 50 km map's ground: worldmap/country.ts):
// the same grid, but it wanders less and turns only over kilometres, so each field's hedges run
// straight and its corners stay near square, while farms across the map still face different ways.
export interface ParcelStyle { bend: number; jitter: number; swirl: number; swirlR: number; swirlMax: number }
const STYLES = new Map<number, ParcelStyle>();
const DEFAULT_STYLE: ParcelStyle = { bend: BEND, jitter: JIT, swirl: SWIRL, swirlR: SWIRL_R, swirlMax: SWIRL_MAX };
export function setParcelStyle(seed: number, s: Partial<ParcelStyle>) { STYLES.set(seed, { ...DEFAULT_STYLE, ...s }); lastSeed = NaN; }
// (the hot path: every corner of every field a paint looks at; the last seed's style is kept)
let lastSeed = NaN, lastStyle = DEFAULT_STYLE;
const styleOf = (seed: number) => { if (seed !== lastSeed) { lastSeed = seed; lastStyle = STYLES.size ? STYLES.get(seed) ?? DEFAULT_STYLE : DEFAULT_STYLE; } return lastStyle; };
export const STRAIGHT_FIELDS: Partial<ParcelStyle> = { bend: 25, jitter: 0.09, swirl: 6000, swirlR: 3500, swirlMax: 0.6 };
export function bend(x: number, z: number, seed: number): XZ {
  const st = styleOf(seed), SWIRL = st.swirl, SWIRL_R = st.swirlR, SWIRL_MAX = st.swirlMax;
  let dx = (worldNoise(x, z, BEND_L, seed + 111) - 0.5) * 2 * st.bend, dz = (worldNoise(x, z, BEND_L, seed + 112) - 0.5) * 2 * st.bend;
  const ci = Math.floor(x / SWIRL), cj = Math.floor(z / SWIRL);
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const qx = (i + 0.2 + hash2(i, j, seed + 121) * 0.6) * SWIRL, qz = (j + 0.2 + hash2(i, j, seed + 122) * 0.6) * SWIRL;
    const rx = x - qx, rz = z - qz, r2 = rx * rx + rz * rz;
    if (r2 > 9 * SWIRL_R * SWIRL_R) continue;
    const a = (hash2(i, j, seed + 123) * 2 - 1) * SWIRL_MAX * Math.exp(-r2 / (SWIRL_R * SWIRL_R)), c = Math.cos(a), sn = Math.sin(a);
    dx += rx * c - rz * sn - rx; dz += rx * sn + rz * c - rz;
  }
  return { x: dx, z: dz };
}
// the world position of grid corner (i, j)
function corner(i: number, j: number, seed: number): XZ {
  const J = styleOf(seed).jitter;
  const b = fromGrid(i + (hash2(i, j, seed + 101) - 0.5) * 2 * J, j + (hash2(i, j, seed + 102) - 0.5) * 2 * J), d = bend(b.x, b.z, seed);
  return { x: b.x + d.x, z: b.z + d.z };
}

export function cellAt(i: number, j: number, seed: number): Cell {
  const pts = [corner(i, j, seed), corner(i + 1, j, seed), corner(i + 1, j + 1, seed), corner(i, j + 1, seed)];
  const m = centroid(pts), [u, v] = toGrid(m.x, m.z);
  const split = hash2(i, j, seed + 103) < 0.3;
  // a merged pair is two unsplit cells side by side, the left one not itself merged into its left
  const merge = !split && hash2(i, j, seed + 104) < 0.22 && hash2(i + 1, j, seed + 103) >= 0.3 && !(hash2(i - 1, j, seed + 104) < 0.22 && hash2(i - 1, j, seed + 103) >= 0.3);
  let sp: Cell['split'] = null;
  if (split) {
    // across the long way (from the bottom edge to the top), so the halves are near square
    const t0 = 0.35 + hash2(i, j, seed + 105) * 0.3, t1 = t0 + (hash2(i, j, seed + 106) - 0.5) * 0.12;
    const A = toGrid(pts[0].x + (pts[1].x - pts[0].x) * t0, pts[0].z + (pts[1].z - pts[0].z) * t0);
    const B = toGrid(pts[3].x + (pts[2].x - pts[3].x) * t1, pts[3].z + (pts[2].z - pts[3].z) * t1);
    let nu = B[1] - A[1], nv = A[0] - B[0];
    const l = Math.hypot(nu, nv) || 1;
    nu /= l; nv /= l;
    sp = { nu, nv, c: nu * A[0] + nv * A[1] };
  }
  return { i, j, u, v, pts, merge, split: sp };
}

// A parcel's id: its cell, and which side of a split. Merged cells share their left cell's id.
export const parcelId = (i: number, j: number, side: number) => ((i + 32768) * 65536 + (j + 32768)) * 2 + side;

// inside the (convex, anticlockwise) quad?
function inQuad(x: number, z: number, q: XZ[]) {
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) & 3];
    if ((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x) < 0) return false;
  }
  return true;
}
// does a quad's outline cross a box's edges (or the box sit inside it)?
function quadCrosses(q: XZ[], b: { x0: number; z0: number; x1: number; z1: number }) {
  const bc = [{ x: b.x0, z: b.z0 }, { x: b.x1, z: b.z0 }, { x: b.x1, z: b.z1 }, { x: b.x0, z: b.z1 }];
  if (bc.some((p) => inQuad(p.x, p.z, q))) return true;
  const cross = (a: XZ, c: XZ, d: XZ, e: XZ) => {
    const o = (p: XZ, r: XZ, t: XZ) => (r.x - p.x) * (t.z - p.z) - (r.z - p.z) * (t.x - p.x);
    return o(a, c, d) * o(a, c, e) < 0 && o(d, e, a) * o(d, e, c) < 0;
  };
  for (let k = 0; k < 4; k++) for (let m = 0; m < 4; m++) if (cross(q[k], q[(k + 1) & 3], bc[m], bc[(m + 1) & 3])) return true;
  return false;
}
function segDist(x: number, z: number, a: XZ, b: XZ) {
  const ex = b.x - a.x, ez = b.z - a.z, L = ex * ex + ez * ez;
  const t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L)) : 0;
  return Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
}

// Which parcel a point is in, and how far (in metres) it is from that parcel's edge.
export interface Hit { id: number; cell: Cell; edge: number }
export class Parcels {
  private cache = new Map<number, Cell>();
  constructor(readonly seed: number) {}
  cell(i: number, j: number) {
    const k = (i + 32768) * 65536 + (j + 32768);
    let c = this.cache.get(k);
    if (!c) { c = cellAt(i, j, this.seed); this.cache.set(k, c); if (this.cache.size > 20000) this.cache.clear(); }
    return c;
  }
  // the id a cell's side belongs to (merged cells answer with their left partner's)
  owner(c: Cell, side: number) {
    if (c.split) return parcelId(c.i, c.j, side);
    const left = this.cell(c.i - 1, c.j);
    return left.merge ? parcelId(left.i, left.j, 0) : parcelId(c.i, c.j, 0);
  }
  // The cell a point is in: undo the grid's bend there (it changes slowly, so that lands within a
  // cell of the right one), then look at that cell and its neighbours.
  cellOf(x: number, z: number): Cell {
    const d = this.unbend(x, z), [gu, gv] = toGrid(x - d.x, z - d.z), ci = Math.floor(gu), cj = Math.floor(gv);
    let best = this.cell(ci, cj), bd = Infinity;
    for (let r = 0; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const c = this.cell(ci + di, cj + dj);
      if (inQuad(x, z, c.pts)) return c;
      const m = fromGrid(c.u, c.v), d = (m.x - x) ** 2 + (m.z - z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  // The bend at a point, undone in two steps (it changes slowly, so that lands on or next to the
  // right cell), remembered on a 25 m grid: near enough to start the search from.
  private bends = new Map<number, XZ>();
  private unbend(x: number, z: number) {
    const i = Math.floor(x / 25), j = Math.floor(z / 25), k = (i + 32768) * 65536 + (j + 32768);
    let d = this.bends.get(k);
    if (!d) {
      const cx = (i + 0.5) * 25, cz = (j + 0.5) * 25;
      d = bend(cx, cz, this.seed);
      d = bend(cx - d.x, cz - d.z, this.seed);
      this.bends.set(k, d);
      if (this.bends.size > 50000) this.bends.clear();
    }
    return d;
  }
  // every cell whose outline comes within the box
  cellsNear(b: { x0: number; z0: number; x1: number; z1: number }) {
    const cs = [toGrid(b.x0, b.z0), toGrid(b.x1, b.z0), toGrid(b.x0, b.z1), toGrid(b.x1, b.z1)], out: Cell[] = [];
    const i0 = Math.floor(Math.min(...cs.map((c) => c[0]))) - 3, i1 = Math.floor(Math.max(...cs.map((c) => c[0]))) + 3;
    const j0 = Math.floor(Math.min(...cs.map((c) => c[1]))) - 3, j1 = Math.floor(Math.max(...cs.map((c) => c[1]))) + 3;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const c = this.cell(i, j);
      if (c.pts.some((p) => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1) || inQuad((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, c.pts) || quadCrosses(c.pts, b)) out.push(c);
    }
    return out;
  }
  // The parcel at a point, and its distance (m) to the parcel's edge: a side of its cell that
  // isn't shared with the other half of a merged pair, or the split line.
  hit(x: number, z: number, out: Hit = { id: 0, cell: null as unknown as Cell, edge: 0 }): Hit {
    const c = this.cellOf(x, z);
    const side = c.split ? (c.split.nu * gridU(x, z) + c.split.nv * gridV(x, z) - c.split.c > 0 ? 1 : 0) : 0;
    const id = this.owner(c, side), { pts, across } = this.polygon(c);
    let edge = Infinity;
    for (let k = 0; k < 4; k++) {
      const o = across[k]!;
      if (!o.split && !c.split && this.owner(o, 0) === id) continue; // the other half of a merged field
      edge = Math.min(edge, segDist(x, z, pts[k], pts[(k + 1) & 3]));
    }
    const sl = this.splitLine(c);
    if (sl) edge = Math.min(edge, segDist(x, z, sl[0], sl[1]));
    out.id = id; out.cell = c; out.edge = edge;
    return out;
  }
  // The cell's outline in world metres, with the neighbour across each edge.
  private polys = new Map<Cell, { pts: XZ[]; across: (Cell | null)[] }>();
  polygon(c: Cell): { pts: XZ[]; across: (Cell | null)[] } {
    let got = this.polys.get(c);
    if (!got) {
      got = { pts: c.pts, across: [this.cell(c.i, c.j - 1), this.cell(c.i + 1, c.j), this.cell(c.i, c.j + 1), this.cell(c.i - 1, c.j)] };
      this.polys.set(c, got);
      if (this.polys.size > 5000) this.polys.clear();
    }
    return got;
  }
  // A split cell's hedge line, clipped to the cell.
  splitLine(c: Cell): [XZ, XZ] | null {
    if (!c.split) return null;
    const s = c.split, pts = c.pts, tu = s.nv, tv = -s.nu;
    const f = s.nu * c.u + s.nv * c.v - s.c, mu = c.u - s.nu * f, mv = c.v - s.nv * f;
    const g = pts.map((p) => toGrid(p.x, p.z));
    // the line's parameter range inside the convex polygon
    let lo = -Infinity, hi = Infinity;
    for (let e = 0; e < g.length; e++) {
      const a = g[e], b = g[(e + 1) % g.length];
      // inside is to the left of a->b: cross(b − a, p − a) ≥ 0, with p = m + t·T
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const c0 = ex * (mv - a[1]) - ey * (mu - a[0]), c1 = ex * tv - ey * tu;
      if (Math.abs(c1) < 1e-12) { if (c0 < 0) return null; continue; }
      const t = -c0 / c1;
      if (c1 > 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    }
    if (!(hi > lo)) return null;
    return [fromGrid(mu + tu * lo, mv + tv * lo), fromGrid(mu + tu * hi, mv + tv * hi)];
  }
}

// ---- what each parcel is ----
export interface ParcelInfo { kind: ParcelKind; crop: number; dir: number }

// A coarse grid (20 m cells, in 16x16 blocks) of flags marking the town, industry and water, for
// deciding what parcels are.
export const TOWN = 1, INDUS = 2, WET = 4;
export class Coarse {
  static C = 20;
  private blocks = new Map<number, Uint8Array>();
  constructor(private under?: Coarse) {} // (flags of another grid, read through)
  mark(flag: number, x: number, z: number, r: number) {
    const C = Coarse.C;
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) {
      const k = ((i >> 4) + 32768) * 65536 + ((j >> 4) + 32768);
      let b = this.blocks.get(k);
      if (!b) this.blocks.set(k, (b = new Uint8Array(256)));
      b[(i & 15) * 16 + (j & 15)] |= flag;
    }
  }
  at(x: number, z: number): number {
    const i = Math.floor(x / Coarse.C), j = Math.floor(z / Coarse.C);
    const b = this.blocks.get(((i >> 4) + 32768) * 65536 + ((j >> 4) + 32768));
    return (b ? b[(i & 15) * 16 + (j & 15)] : 0) | (this.under ? this.under.at(x, z) : 0);
  }
}

function inPoly(x: number, z: number, poly: XZ[]) {
  let inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const p = poly[a], q = poly[b];
    if ((p.z > z) !== (q.z > z) && x < ((q.x - p.x) * (z - p.z)) / (q.z - p.z) + p.x) inside = !inside;
  }
  return inside;
}
// A polygon's bounding box, remembered per polygon (inputs keep their unchanged polygons between
// repaints, so this is mostly a lookup).
const boxes = new WeakMap<XZ[], { x0: number; z0: number; x1: number; z1: number }>();
export function bbox(poly: XZ[]) {
  let b = boxes.get(poly);
  if (b) return b;
  b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  for (const q of poly) { if (q.x < b.x0) b.x0 = q.x; if (q.x > b.x1) b.x1 = q.x; if (q.z < b.z0) b.z0 = q.z; if (q.z > b.z1) b.z1 = q.z; }
  boxes.set(poly, b);
  return b;
}
export function centroid(poly: XZ[]): XZ {
  let x = 0, z = 0;
  for (const p of poly) { x += p.x; z += p.z; }
  return { x: x / poly.length, z: z / poly.length };
}

export class Layout {
  readonly seed: number;
  readonly parcels: Parcels;
  coarse = new Coarse();
  private fixed: { parks: GroundInput['parks']; industrial: GroundInput['industrial']; water: GroundInput['water']; coarse: Coarse } | null = null;
  private info = new Map<number, ParcelInfo>();
  constructor(public input: GroundInput) {
    this.seed = input.seed ?? 1;
    this.parcels = new Parcels(this.seed);
    this.setInput(input);
  }
  // A new input. With `near` (world boxes round what changed), parcels away from it keep what they
  // were; the boxes of those near it that became something else are returned.
  setInput(input: GroundInput, near?: { x0: number; z0: number; x1: number; z1: number }[]) {
    this.input = input;
    const old = this.info;
    this.info = new Map();
    if (near) for (const [id, v] of old) this.info.set(id, v);
    // the marks from parks, industry and water are kept while those arrays stay the same
    if (!this.fixed || this.fixed.parks !== input.parks || this.fixed.industrial !== input.industrial || this.fixed.water !== input.water) {
      const f = new Coarse();
      for (const p of input.parks ?? []) { const b = bbox(p.poly); f.mark(TOWN, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 20); }
      for (const p of input.industrial ?? []) f.mark(INDUS, p.x, p.z, 30);
      for (const w of input.water ?? []) for (const q of w) f.mark(WET, q.x, q.z, 10);
      this.fixed = { parks: input.parks, industrial: input.industrial, water: input.water, coarse: f };
    }
    const c = (this.coarse = new Coarse(this.fixed.coarse));
    // the town reaches 30 m past its plots and parks, the industrial estate likewise
    for (const p of input.plots ?? []) { const m = centroid(p.poly); c.mark(p.kind === 'yard' ? INDUS : TOWN, m.x, m.z, 30); }
    for (const p of input.town ?? []) c.mark(TOWN, p.x, p.z, 30);
    const changed: { x0: number; z0: number; x1: number; z1: number }[] = [];
    if (!near) return changed;
    // every parcel with ground within 40 m of the box (a plot marks the town 30 m round it)
    const ids = new Set<number>(), h = { id: 0, cell: this.parcels.cell(0, 0), edge: 0 };
    for (const b of near) for (const c of this.parcels.cellsNear({ x0: b.x0 - 40, z0: b.z0 - 40, x1: b.x1 + 40, z1: b.z1 + 40 })) { ids.add(this.parcels.owner(c, 0)); ids.add(this.parcels.owner(c, 1)); }
    for (const id of ids) {
      const was = this.info.get(id);
      this.info.delete(id);
      const now = this.about({ id, cell: h.cell, edge: 0 });
      if (was && was.kind === now.kind && was.crop === now.crop) continue;
      changed.push(this.boxOf(id));
    }
    return changed;
  }
  // a parcel's bounding box (both cells of a merged pair)
  boxOf(id: number) {
    const k = Math.floor(id / 2), c = this.parcels.cell(Math.floor(k / 65536) - 32768, (k % 65536) - 32768);
    const pts = [...this.parcels.polygon(c).pts, ...(c.merge ? this.parcels.polygon(this.parcels.cell(c.i + 1, c.j)).pts : [])];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
    return { x0, z0, x1, z1 };
  }
  // What a parcel is, decided once per input from a sample of points across it.
  about(h: Hit): ParcelInfo {
    let inf = this.info.get(h.id);
    if (inf) return inf;
    // always judged from the parcel's own cell (a merged pair's left one), whoever asks
    const k = Math.floor(h.id / 2), c = this.parcels.cell(Math.floor(k / 65536) - 32768, (k % 65536) - 32768);
    const { pts } = this.parcels.polygon(c);
    // sample the parcel's polygon (both cells of a merged pair, one side of a split) every 16 m
    let n = 0, town = 0, ind = 0, wet = 0;
    const polys = [pts];
    if (c.merge) polys.push(this.parcels.polygon(this.parcels.cell(c.i + 1, c.j)).pts);
    const side = h.id % 2;
    for (const poly of polys) {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
      for (let x = x0 + 8; x < x1; x += 16) for (let z = z0 + 8; z < z1; z += 16) {
        if (!inPoly(x, z, poly)) continue;
        if (c.split && (c.split.nu * gridU(x, z) + c.split.nv * gridV(x, z) - c.split.c > 0 ? 1 : 0) !== side) continue;
        n++;
        const f = this.coarse.at(x, z);
        if (f & TOWN) town++;
        if (f & INDUS) ind++;
        if (f & WET) wet++;
      }
    }
    n = Math.max(1, n);
    const r = (k: number) => hash2(h.id % 65536, Math.floor(h.id / 65536), this.seed + k);
    const mid = centroid(pts);
    let kind: ParcelKind;
    if (ind / n > 0.12) kind = 'rough';
    else if (town / n > 0.15) kind = 'town';
    else if (wet / n > 0.08) kind = 'rough';
    else if (this.input.noFields) kind = 'grass';
    else {
      // woods come in clumps at the landscape scale; arable and grass in broad swathes too
      const wood = worldNoise(mid.x, mid.z, 520, this.seed + 7) + (r(1) - 0.5) * 0.25;
      const arable = worldNoise(mid.x, mid.z, 700, this.seed + 8) + (r(2) - 0.5) * 0.5;
      kind = wood > 0.7 ? 'wood' : arable > 0.52 ? 'arable' : r(3) < 0.12 ? 'rough' : 'grass';
    }
    let crop: number = CROP.grass;
    if (kind === 'arable') {
      const q = r(4);
      crop = q < 0.3 ? CROP.wheat : q < 0.5 ? CROP.barley : q < 0.68 ? CROP.plough : q < 0.8 ? CROP.ley : q < 0.9 ? CROP.stubble : CROP.rape;
    }
    // rows run parallel to one of the field's sides, as a farmer drills it: mostly the longest,
    // often the side next to it (each farm has its habits)
    let best = 0, bi = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], L = Math.hypot(q.x - p.x, q.z - p.z);
      if (L > best) { best = L; bi = i; }
    }
    if (r(6) < 0.45) bi = (bi + 1) % pts.length;
    const p0 = pts[bi], p1 = pts[(bi + 1) % pts.length];
    let dir = Math.atan2(p1.z - p0.z, p1.x - p0.x);
    if (c.split) { const s = c.split, w = fromGrid(s.nv, -s.nu), a = Math.atan2(w.z, w.x); if (r(5) < 0.6) dir = a; }
    dir = ((dir % Math.PI) + Math.PI) % Math.PI;
    inf = { kind, crop, dir };
    this.info.set(h.id, inf);
    return inf;
  }
}
