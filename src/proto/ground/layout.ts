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
const ANGLE = 0.33; // the grid's rotation: fields don't line up with the map
const SX = 240, SZ = 165; // seed spacing in metres: cells of ~4 ha, 2 ha when split, 8 when merged
export const GRID = { angle: ANGLE, sx: SX, sz: SZ };
const JIT = 0.3; // seeds stay within ±0.3 of their cell's middle, so the 3x3 cells round a point hold its nearest seed
const CA = Math.cos(ANGLE), SA = Math.sin(ANGLE);
// world -> grid coordinates (cells are unit squares)
export const toGrid = (x: number, z: number): [number, number] => [(x * CA + z * SA) / SX, (-x * SA + z * CA) / SZ];
export const fromGrid = (u: number, v: number): XZ => ({ x: u * SX * CA - v * SZ * SA, z: u * SX * SA + v * SZ * CA });

export interface Cell {
  i: number; j: number; u: number; v: number; // seed in grid space
  merge: boolean; // merged with its +i neighbour into one field
  split: null | { nu: number; nv: number; c: number }; // a hedge across it: side = sign(nu·u + nv·v − c)
}

export function cellAt(i: number, j: number, seed: number): Cell {
  const u = i + 0.5 + (hash2(i, j, seed + 101) - 0.5) * 2 * JIT, v = j + 0.5 + (hash2(i, j, seed + 102) - 0.5) * 2 * JIT;
  const split = hash2(i, j, seed + 103) < 0.3;
  // a merged pair is two unsplit cells side by side, the left one not itself merged into its left
  const merge = !split && hash2(i, j, seed + 104) < 0.22 && hash2(i + 1, j, seed + 103) >= 0.3 && !(hash2(i - 1, j, seed + 104) < 0.22 && hash2(i - 1, j, seed + 103) >= 0.3);
  let sp: Cell['split'] = null;
  if (split) {
    // mostly across the long way, so the halves are roughly square; in world metres the grid is
    // anisotropic, so pick the angle there and bring the normal back into grid space
    const a = (hash2(i, j, seed + 105) - 0.5) * 1.1 + (hash2(i, j, seed + 106) < 0.75 ? 0 : Math.PI / 2);
    const nu = Math.cos(a) * SX, nv = Math.sin(a) * SZ, l = Math.hypot(nu, nv);
    const off = (hash2(i, j, seed + 107) - 0.5) * 0.3;
    sp = { nu: nu / l, nv: nv / l, c: (nu / l) * (u + off) + (nv / l) * v };
  }
  return { i, j, u, v, merge, split: sp };
}

// A parcel's id: its cell, and which side of a split. Merged cells share their left cell's id.
export const parcelId = (i: number, j: number, side: number) => ((i + 32768) * 65536 + (j + 32768)) * 2 + side;

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
  // The nearest seed in grid space decides the cell; the distance to the edge is measured in
  // metres to the nearest bisector with a cell of a different parcel (or to the split line).
  hit(x: number, z: number, out: Hit = { id: 0, cell: null as unknown as Cell, edge: 0 }): Hit {
    const [gu, gv] = toGrid(x, z), ci = Math.floor(gu), cj = Math.floor(gv);
    let best: Cell | null = null, bd = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const c = this.cell(ci + di, cj + dj), d = (c.u - gu) ** 2 + (c.v - gv) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    const c = best!;
    const side = c.split ? (c.split.nu * gu + c.split.nv * gv - c.split.c > 0 ? 1 : 0) : 0;
    const id = this.owner(c, side);
    let edge = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const o = this.cell(ci + di, cj + dj);
      if (o === c) continue;
      if (!o.split && !c.split && this.owner(o, 0) === id) continue; // the other half of a merged field
      // bisector: points g with (g − m)·d = 0; in world metres the distance is f / |Aᵀd|
      const du = o.u - c.u, dv = o.v - c.v, mu = (o.u + c.u) / 2, mv = (o.v + c.v) / 2;
      const f = (mu - gu) * du + (mv - gv) * dv; // ≥ 0 on c's side
      // Aᵀd, A being world -> grid: rows (CA/SX, SA/SX) and (−SA/SZ, CA/SZ)
      const wx = (du * CA) / SX - (dv * SA) / SZ, wz = (du * SA) / SX + (dv * CA) / SZ;
      edge = Math.min(edge, f / Math.hypot(wx, wz));
    }
    if (c.split) {
      const s = c.split, f = Math.abs(s.nu * gu + s.nv * gv - s.c);
      const wx = (s.nu * CA) / SX - (s.nv * SA) / SZ, wz = (s.nu * SA) / SX + (s.nv * CA) / SZ;
      edge = Math.min(edge, f / Math.hypot(wx, wz));
    }
    out.id = id; out.cell = c; out.edge = edge;
    return out;
  }
  // The cell's Voronoi polygon in world metres (the square round its seed, clipped by the
  // bisectors with its eight neighbours), with the neighbour across each edge.
  private polys = new Map<Cell, { pts: XZ[]; across: (Cell | null)[] }>();
  polygon(c: Cell): { pts: XZ[]; across: (Cell | null)[] } {
    let got = this.polys.get(c);
    if (!got) { got = this.clipCell(c); this.polys.set(c, got); if (this.polys.size > 5000) this.polys.clear(); }
    return got;
  }
  // A split cell's hedge line, clipped to the cell (grid-space bisection is exact enough: 1 cm).
  splitLine(c: Cell): [XZ, XZ] | null {
    if (!c.split) return null;
    const s = c.split, { pts } = this.polygon(c), tu = s.nv, tv = -s.nu;
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
  private clipCell(c: Cell): { pts: XZ[]; across: (Cell | null)[] } {
    let poly: { u: number; v: number; n: Cell | null }[] = [
      { u: c.i - 1, v: c.j - 1, n: null }, { u: c.i + 2, v: c.j - 1, n: null }, { u: c.i + 2, v: c.j + 2, n: null }, { u: c.i - 1, v: c.j + 2, n: null },
    ];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const o = this.cell(c.i + di, c.j + dj), du = o.u - c.u, dv = o.v - c.v, k = ((o.u + c.u) / 2) * du + ((o.v + c.v) / 2) * dv;
      poly = clip(poly, du, dv, k, o);
    }
    return { pts: poly.map((p) => fromGrid(p.u, p.v)), across: poly.map((p) => p.n) };
  }
}
// keep the part of a polygon where u·a + v·b ≤ k; edge i runs from point i to i+1 and remembers
// what's across it (new edges along the cut face `n`)
function clip(poly: { u: number; v: number; n: Cell | null }[], a: number, b: number, k: number, n: Cell) {
  const out: typeof poly = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], fp = p.u * a + p.v * b - k, fq = q.u * a + q.v * b - k;
    if (fp <= 0) out.push(p);
    if ((fp <= 0) !== (fq <= 0)) {
      const t = fp / (fp - fq);
      // the crossing point starts an edge: along the old edge if we're leaving, along the cut if entering
      out.push({ u: p.u + (q.u - p.u) * t, v: p.v + (q.v - p.v) * t, n: fp <= 0 ? n : p.n });
    }
  }
  return out;
}

// ---- what each parcel is ----
export interface ParcelInfo { kind: ParcelKind; crop: number; dir: number }

// A coarse grid (20 m cells, in 16x16 blocks) of flags marking the town, industry and water, for
// deciding what parcels are.
export const TOWN = 1, INDUS = 2, WET = 4;
export class Coarse {
  static C = 20;
  private blocks = new Map<number, Uint8Array>();
  mark(flag: number, x: number, z: number, r: number) {
    const C = Coarse.C;
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) {
      const k = ((i >> 4) + 32768) * 65536 + ((j >> 4) + 32768);
      let b = this.blocks.get(k);
      if (!b) this.blocks.set(k, (b = new Uint8Array(256)));
      b[(i & 15) * 16 + (j & 15)] |= flag;
    }
  }
  at(x: number, z: number) {
    const i = Math.floor(x / Coarse.C), j = Math.floor(z / Coarse.C);
    const b = this.blocks.get(((i >> 4) + 32768) * 65536 + ((j >> 4) + 32768));
    return b ? b[(i & 15) * 16 + (j & 15)] : 0;
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
export function centroid(poly: XZ[]): XZ {
  let x = 0, z = 0;
  for (const p of poly) { x += p.x; z += p.z; }
  return { x: x / poly.length, z: z / poly.length };
}

export class Layout {
  readonly seed: number;
  readonly parcels: Parcels;
  coarse = new Coarse();
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
    const c = (this.coarse = new Coarse());
    // the town reaches 30 m past its plots and parks, the industrial estate likewise
    for (const p of input.plots ?? []) { const m = centroid(p.poly); c.mark(p.kind === 'yard' ? INDUS : TOWN, m.x, m.z, 30); }
    for (const p of input.parks ?? []) { const m = centroid(p.poly); c.mark(TOWN, m.x, m.z, 20); }
    for (const p of input.town ?? []) c.mark(TOWN, p.x, p.z, 30);
    for (const p of input.industrial ?? []) c.mark(INDUS, p.x, p.z, 30);
    for (const w of input.water ?? []) for (const q of w) c.mark(WET, q.x, q.z, 10);
    const changed: { x0: number; z0: number; x1: number; z1: number }[] = [];
    if (!near) return changed;
    // every parcel with ground within 40 m of the box (a plot marks the town 30 m round it)
    const ids = new Set<number>(), h = { id: 0, cell: this.parcels.cell(0, 0), edge: 0 };
    for (const b of near) for (let x = b.x0 - 40; x <= b.x1 + 40; x += 10) for (let z = b.z0 - 40; z <= b.z1 + 40; z += 10) ids.add(this.parcels.hit(x, z, h).id);
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
        if (c.split) { const [u, v] = toGrid(x, z); if ((c.split.nu * u + c.split.nv * v - c.split.c > 0 ? 1 : 0) !== side) continue; }
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
      kind = wood > 0.66 ? 'wood' : arable > 0.45 ? 'arable' : r(3) < 0.12 ? 'rough' : 'grass';
    }
    let crop: number = CROP.grass;
    if (kind === 'arable') {
      const q = r(4);
      crop = q < 0.3 ? CROP.wheat : q < 0.5 ? CROP.barley : q < 0.68 ? CROP.plough : q < 0.8 ? CROP.ley : q < 0.9 ? CROP.stubble : CROP.rape;
    }
    // rows run along the parcel's longest edge, as a farmer drills a field
    let best = 0, dir = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], L = Math.hypot(q.x - p.x, q.z - p.z);
      if (L > best) { best = L; dir = Math.atan2(q.z - p.z, q.x - p.x); }
    }
    if (c.split) { const s = c.split, w = fromGrid(s.nv, -s.nu), a = Math.atan2(w.z, w.x); if (r(5) < 0.6) dir = a; }
    dir = ((dir % Math.PI) + Math.PI) % Math.PI;
    inf = { kind, crop, dir };
    this.info.set(h.id, inf);
    return inf;
  }
}
