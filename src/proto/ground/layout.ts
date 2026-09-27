// The countryside's layout: the fields, what each one is, and the lines between them.
//
// Fields come from a field source: the region's farm blocks (region/fields.ts, `Countryside`),
// laid out a block at a time as the ground asks for a box of the world, so any cover map
// anywhere, a tile or the town's, agrees about them. They're straight-edged, square-cornered
// fields in farm blocks that follow the roads, rivers and contours (docs/ground.md). What a field
// becomes (arable, grass, wood, rough) is the source's; the town's plots and industry turn a field
// they grow over into town.
//
// Plain arrays and numbers, no three.js, so the tests run in Node.
import { CROP } from './covers';
import { PlanIndex, type FieldSource } from './plan';
import { Countryside } from '../region/fields';

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
  plots?: { poly: XZ[]; kind: 'garden' | 'site' | 'yard' | 'track' }[]; // (a track: a farm's drive, worn earth, not town)
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

// ---- what each parcel is ----
export interface ParcelInfo { kind: ParcelKind; crop: number; dir: number; conifer?: boolean; mixed?: boolean } // (mixed: a field the town has reached but not grown over: the ground within 30 m of its plots is town, texel by texel: `townAt`)

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

// the field source a layout uses when it isn't given one: farm blocks from its seed alone (no
// roads, rivers or hills to follow: the town's, and the demos')
const defaults = new Map<number, FieldSource>();
export function defaultFields(seed: number): FieldSource {
  let f = defaults.get(seed);
  if (!f) defaults.set(seed, (f = new Countryside({ seed, settlements: [], lanes: [] })));
  return f;
}
type Box = { x0: number; z0: number; x1: number; z1: number };

export class Layout {
  readonly seed: number;
  readonly source: FieldSource;
  readonly plan = new PlanIndex();
  coarse = new Coarse();
  private seen = new Set<number>();
  private fixed: { parks: GroundInput['parks']; industrial: GroundInput['industrial']; water: GroundInput['water']; coarse: Coarse } | null = null;
  private info = new Map<number, ParcelInfo>();
  constructor(public input: GroundInput, source?: FieldSource) {
    this.seed = input.seed ?? 1;
    this.source = source ?? defaultFields(this.seed);
    this.setInput(input);
  }
  // Lay out the fields touching a box (every block that reaches it, whole), if they aren't already.
  ensure(box: Box, pad = 60) {
    for (const b of this.source.blocksNear({ x0: box.x0 - pad, z0: box.z0 - pad, x1: box.x1 + pad, z1: box.z1 + pad })) {
      if (this.seen.has(b.id)) continue;
      this.seen.add(b.id);
      this.plan.add(b.fields, b.lines);
    }
  }
  // the field at a point (-1 for none), laying it out if it isn't yet
  fieldAt(x: number, z: number) { let f = this.plan.fieldAt(x, z); if (f < 0) { this.ensure({ x0: x, z0: z, x1: x, z1: z }, 1); f = this.plan.fieldAt(x, z); } return f; }
  // What's either side of a line, at its middle (a line borders one field each side there).
  sides(n: number): [ParcelKind | null, ParcelKind | null] {
    const P = this.plan, { a, b } = P.lines[n], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / L * 1.5, nz = (b.x - a.x) / L * 1.5, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const f = this.fieldAt(mx + nx, mz + nz), g = this.fieldAt(mx - nx, mz - nz);
    return [f < 0 ? null : this.about(f).kind, g < 0 ? null : this.about(g).kind];
  }
  // how far a point is from the edge of a wood it's in (or the wood it's near), up to 12 m
  woodEdge(x: number, z: number) { return this.plan.edge(x, z, (n) => { const [p, q] = this.sides(n); return (p === 'wood') !== (q === 'wood'); }); }
  // A new input. With `near` (world boxes round what changed), fields away from it keep what they
  // were; the boxes of those near it that became something else are returned.
  setInput(input: GroundInput, near?: Box[]) {
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
    for (const p of input.plots ?? []) { if (p.kind === 'track') continue; const m = centroid(p.poly); c.mark(p.kind === 'yard' ? INDUS : TOWN, m.x, m.z, 30); }
    for (const p of input.town ?? []) c.mark(TOWN, p.x, p.z, 30);
    const changed: Box[] = [];
    if (!near) return changed;
    // every field with ground within 52 m of the box (a plot marks the town 30 m round it, on 20 m cells)
    const ids = new Set<number>();
    for (const b of near) { const B = { x0: b.x0 - 52, z0: b.z0 - 52, x1: b.x1 + 52, z1: b.z1 + 52 }; this.ensure(B, 0); for (const n of this.plan.fieldsNear(B)) ids.add(n); }
    for (const id of ids) {
      const was = this.info.get(id);
      this.info.delete(id);
      const now = this.about(id);
      if (was && was.kind === now.kind && was.crop === now.crop) continue;
      changed.push(this.boxOf(id));
    }
    return changed;
  }
  boxOf(id: number) { return { ...this.plan.boxes[id] }; }
  // is this spot within 30 m of the town's plots (or the ground the town has marked as its own)?
  townAt(x: number, z: number) { return (this.coarse.at(x, z) & TOWN) !== 0; }
  // What a field is: what its source says, unless the town has grown over it (half of it within
  // 30 m of plots) or industry has, or it's a field at the water's edge (then it's grass). A field
  // the town has reached but not grown over stays a field (`mixed`): the ground within 30 m of the
  // plots is painted as town and gets no hedge, and the crop runs up to it, as fields do behind a
  // town's back gardens.
  about(id: number): ParcelInfo {
    let inf = this.info.get(id);
    if (inf) return inf;
    const P = this.plan, f = P.fields[id], b = P.boxes[id];
    let n = 0, town = 0, ind = 0, wet = 0;
    // (sampled every 16 m, or coarser on a big field: some 60 points)
    const st = Math.max(16, Math.sqrt((b.x1 - b.x0) * (b.z1 - b.z0)) / 8);
    for (let x = b.x0 + st / 2; x < b.x1; x += st) for (let z = b.z0 + st / 2; z < b.z1; z += st) {
      if (!inPoly(x, z, f.poly)) continue;
      n++;
      const fl = this.coarse.at(x, z);
      if (fl & TOWN) town++;
      if (fl & INDUS) ind++;
      if (fl & WET) wet++;
    }
    n = Math.max(1, n);
    let kind: ParcelKind = ind / n > 0.12 ? 'rough' : town / n > 0.5 ? 'town' : f.kind;
    if (this.input.noFields && kind !== 'town' && kind !== 'rough') kind = 'grass';
    else if (kind === 'arable' && wet / n > 0.08) kind = 'grass';
    inf = { kind, crop: kind === 'arable' || kind === 'grass' ? (kind === 'grass' && f.kind !== 'grass' ? CROP.grass : P.crops[id]) : CROP.grass, dir: f.dir, conifer: f.conifer, mixed: kind !== 'town' && town > 0 || undefined };
    this.info.set(id, inf);
    return inf;
  }
}
