// The region's farmland: fields laid out as English enclosure fields are, in blocks that follow the
// lanes, the rivers and the lie of the land, and what each field is (docs/ground.md, "Fields on a
// region").
//
//   const plan = layFields({ seed, box, settlements, lanes, waterDist, heightAt });  // a box at once
//   const c = new Countryside({ seed, bounds, settlements, lanes, ... }); c.near(tileBox)  // lazily, a tile at a time
//   plan.fields   // convex polygons: arable (with a crop), grass, wood or rough grazing
//   plan.lines    // the boundaries between them, each once: hedged, or not (along a lane, which
//                 // has hedges of its own)
//
// How: the country is cut into farm blocks (the Voronoi cells of seeds about 650 m apart). Each
// block has one direction its fields are laid out in: along the nearest lane or river if there's
// one close, else across the slope (fields follow the contours), else as the land's grain runs.
// Each block is then cut, again and again, square across its longer side, until its fields are
// the size that land has: big (6 to 10 ha) on flat arable land far from anywhere, smaller (2 to 4)
// round villages, on slopes and in pasture. So fields are four-sided with right angles, sit in
// patterns that change from farm to farm, and meet the block's edge (a lane, an old boundary) at
// whatever angle it takes. A lane through a field splits it. Now and then a cut is a narrow strip
// of trees: a shelter belt.
//
// Pure: no three.js, no DOM. The same inputs always give the same fields.
import { rng, mix, type Rand } from './random';
import { chooseWoods, type WoodSite } from './woods';
import { COUNTRYSIDE } from './countryside';

export interface XZ { x: number; z: number }
export type FieldKind = 'arable' | 'grass' | 'wood' | 'rough';
export type Crop = 'grass' | 'ley' | 'wheat' | 'barley' | 'plough' | 'rape' | 'stubble';
export interface Field {
  poly: XZ[]; // convex, anticlockwise (x right, z down the page: the shoelace sum is positive)
  kind: FieldKind;
  crop: Crop; // (grass for anything that isn't a field)
  dir: number; // the way it's drilled or mown (radians, 0..π)
  conifer?: boolean; // a wood that's a conifer plantation
  belt?: boolean; // a shelter belt (a strip of trees)
  block: number;
}
export interface Line { a: XZ; b: XZ; hedge: boolean }
// a farmstead: a house and its barns round a yard, beside a lane (x, z its middle, a the lane's direction)
export interface Farm { x: number; z: number; a: number; side: number; seed: number; track?: [XZ, XZ] } // (side: which side of the lane, looking along a; track: its drive to the road, if it stands back from it)
export interface FieldPlan { fields: Field[]; lines: Line[]; farms: Farm[] }
export interface FieldsInput {
  seed: number;
  box: { x0: number; z0: number; x1: number; z1: number }; // the land to lay out
  settlements: { x: number; z: number; r: number; reach: number; kind: string }[]; // reach: how far its streets and estates go
  lanes: XZ[][]; // country roads and railways (centre lines): blocks follow them, and they split fields
  farmLanes?: XZ[][]; // the roads farms stand beside or have their tracks to (not motorways or railways): else none
  waterDist?: (x: number, z: number) => number; // metres to the water's edge (negative in it)
  rivers?: XZ[][]; // river centre lines (blocks follow them too)
  heightAt?: (x: number, z: number) => number; // the hills, if the map has them
  woods?: number; // how wooded (1 = English lowland, about an eighth; the style's density)
  pines?: number; // share of the woods that are conifer plantations (the style's)
}


// ---- convex polygons ----
type Poly = XZ[];
export function area(p: Poly) { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j].x * p[i].z - p[i].x * p[j].z); return s / 2; }
export function centroidOf(p: Poly): XZ {
  let a = 0, x = 0, z = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const c = p[j].x * p[i].z - p[i].x * p[j].z; a += c; x += (p[j].x + p[i].x) * c; z += (p[j].z + p[i].z) * c; }
  return Math.abs(a) < 1e-9 ? p[0] : { x: x / (3 * a), z: z / (3 * a) };
}
// Cut a convex polygon by the line n·p = c: the part with n·p ≤ c, the part with n·p ≥ c, and the
// cut (where the line crosses it). Edge tags ride along (tags[i] is edge i → i+1); the cut is tag `cut`.
interface Tagged { pts: XZ[]; tags: number[] }
function cutPoly(P: Tagged, nx: number, nz: number, c: number, cut: number): { lo: Tagged; hi: Tagged; seg: [XZ, XZ] | null } {
  const lo: Tagged = { pts: [], tags: [] }, hi: Tagged = { pts: [], tags: [] }, cross: XZ[] = [];
  const n = P.pts.length;
  for (let i = 0; i < n; i++) {
    const a = P.pts[i], b = P.pts[(i + 1) % n], da = a.x * nx + a.z * nz - c, db = b.x * nx + b.z * nz - c, t = P.tags[i];
    if (da <= 0) { lo.pts.push(a); lo.tags.push(t); }
    if (da >= 0) { hi.pts.push(a); hi.tags.push(t); }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const f = da / (da - db), m = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
      cross.push(m);
      // (the new point starts the rest of edge i on one side, and the cut on the other)
      if (da < 0) { lo.pts.push(m); lo.tags.push(cut); hi.pts.push(m); hi.tags.push(t); }
      else { hi.pts.push(m); hi.tags.push(cut); lo.pts.push(m); lo.tags.push(t); }
    } else if (da === 0 && db !== 0) {
      // (a corner on the line: the cut starts or ends there)
      cross.push(a);
      if (db > 0) lo.tags[lo.tags.length - 1] = cut; else hi.tags[hi.tags.length - 1] = cut;
    }
  }
  return { lo, hi, seg: cross.length >= 2 ? [cross[0], cross[cross.length - 1]] : null };
}
// how far a polygon reaches along a direction (min and max of u·p)
function extent(p: Poly, ux: number, uz: number) { let a = Infinity, b = -Infinity; for (const q of p) { const d = q.x * ux + q.z * uz; if (d < a) a = d; if (d > b) b = d; } return [a, b]; }

// ---- lines, for "what's the nearest lane or river" ----
class Lines {
  private cells = new Map<number, [XZ, XZ][]>();
  private static C = 200;
  constructor(paths: XZ[][]) {
    for (const path of paths) for (let k = 1; k < path.length; k++) {
      const a = path[k - 1], b = path[k], C = Lines.C;
      for (let i = Math.floor(Math.min(a.x, b.x) / C); i <= Math.floor(Math.max(a.x, b.x) / C); i++) for (let j = Math.floor(Math.min(a.z, b.z) / C); j <= Math.floor(Math.max(a.z, b.z) / C); j++) {
        const key = (i + 32768) * 65536 + (j + 32768), l = this.cells.get(key);
        if (l) l.push([a, b]); else this.cells.set(key, [[a, b]]);
      }
    }
  }
  // the nearest segment within r: its distance and direction
  nearest(x: number, z: number, r: number): { d: number; a: number; x: number; z: number } | null {
    const C = Lines.C;
    let best: { d: number; a: number; x: number; z: number } | null = null;
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) {
      for (const [a, b] of this.cells.get((i + 32768) * 65536 + (j + 32768)) ?? []) {
        const ex = b.x - a.x, ez = b.z - a.z, L = ex * ex + ez * ez, t = L > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L)) : 0;
        const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
        if (d < r && (!best || d < best.d)) best = { d, a: Math.atan2(ez, ex), x: a.x + ex * t, z: a.z + ez * t };
      }
    }
    return best;
  }
  // the segments whose boxes come near a box
  near(b: { x0: number; z0: number; x1: number; z1: number }) {
    const C = Lines.C, out = new Set<[XZ, XZ]>();
    for (let i = Math.floor(b.x0 / C); i <= Math.floor(b.x1 / C); i++) for (let j = Math.floor(b.z0 / C); j <= Math.floor(b.z1 / C); j++) for (const s of this.cells.get((i + 32768) * 65536 + (j + 32768)) ?? []) out.add(s);
    return [...out];
  }
}

// a smooth value noise (0..1) over `scale` metres
function noise(seed: number) {
  const h = (i: number, j: number) => (mix(seed, i, j) & 0xffff) / 0xffff;
  return (x: number, z: number, scale: number) => {
    const gx = x / scale, gz = z / scale, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * u, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

export interface FieldSite extends WoodSite { arable: number }
const C = COUNTRYSIDE;
const blockId = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
export interface BlockPlan { id: number; i: number; j: number; box: { x0: number; z0: number; x1: number; z1: number }; fields: Field[]; lines: Line[]; farms: Farm[] | null }

// The countryside, laid out lazily a farm block at a time: each block depends only on the seed,
// its place, and the roads, water, hills and settlements near it, so any tile anywhere can be laid
// out on its own, in any order, and agrees with its neighbours at the border. `near(box)` is
// everything touching a box (a tile: a few milliseconds for a kilometre); `tileCover` a far tile's
// cheap look. Blocks are remembered (and can be forgotten: `forget`).
export class Countryside {
  private lanes: Lines; private farmLanes: Lines; private rivers: Lines;
  private nz: (x: number, z: number, s: number) => number;
  private towns: Map<number, FieldsInput['settlements']> = new Map();
  private blocks = new Map<number, BlockPlan | null>();
  private hMax: number;
  constructor(readonly inp: CountryInput) {
    this.lanes = new Lines(inp.lanes); this.farmLanes = new Lines(inp.farmLanes ?? []); this.rivers = new Lines(inp.rivers ?? []);
    this.nz = noise(mix(inp.seed, 71));
    // settlements on a 2 km grid, each in every cell its reach (plus 700 m) touches
    const G = 2000;
    for (const s of inp.settlements) {
      const R = s.reach + 800;
      for (let i = Math.floor((s.x - R) / G); i <= Math.floor((s.x + R) / G); i++) for (let j = Math.floor((s.z - R) / G); j <= Math.floor((s.z + R) / G); j++) {
        const k = blockId(i, j), l = this.towns.get(k);
        if (l) l.push(s); else this.towns.set(k, [s]);
      }
    }
    this.hMax = inp.hMax ?? 0;
  }
  private slopeAt(x: number, z: number) { const H = this.inp.heightAt; return H ? Math.hypot(H(x + 20, z) - H(x - 20, z), H(x, z + 20) - H(x, z - 20)) / 40 : 0; }
  // metres to the nearest settlement's edge (Infinity past 800 m of every one)
  private townD(x: number, z: number) {
    let d = Infinity;
    for (const s of this.towns.get(blockId(Math.floor(x / 2000), Math.floor(z / 2000))) ?? []) d = Math.min(d, Math.hypot(x - s.x, z - s.z) - s.reach);
    return d;
  }
  private water(x: number, z: number) { return this.inp.waterDist ? this.inp.waterDist(x, z) : 1e4; }
  private seedAt(i: number, j: number) { const r = rng(mix(this.inp.seed, 61, i, j)); return { x: (i + 0.15 + r() * 0.7) * C.block, z: (j + 0.15 + r() * 0.7) * C.block }; }

  // Everything touching a box: whole blocks (so fields cross tile borders whole), in a fixed order.
  near(box: { x0: number; z0: number; x1: number; z1: number }, farms = true): FieldPlan {
    const B = C.block, out: FieldPlan = { fields: [], lines: [], farms: [] };
    for (let i = Math.floor(box.x0 / B) - 2; i <= Math.floor(box.x1 / B) + 1; i++) for (let j = Math.floor(box.z0 / B) - 2; j <= Math.floor(box.z1 / B) + 1; j++) {
      const b = this.block(i, j);
      if (!b || b.box.x1 < box.x0 || b.box.x0 > box.x1 || b.box.z1 < box.z0 || b.box.z0 > box.z1) continue;
      out.fields.push(...b.fields); out.lines.push(...b.lines);
      if (farms) out.farms.push(...this.farmsOf(b));
    }
    return out;
  }
  forget(box: { x0: number; z0: number; x1: number; z1: number }) { for (const [k, b] of this.blocks) if (b && b.box.x1 >= box.x0 && b.box.x0 <= box.x1 && b.box.z1 >= box.z0 && b.box.z0 <= box.z1) this.blocks.delete(k); }

  // A far tile's look: n × n RGBA texels over the box, a colour a field (COUNTRYSIDE.far), dark
  // hedge lines where a texel is fine enough to show them. Reads as the patchwork and its woods from high up.
  tileCover(box: { x0: number; z0: number; x1: number; z1: number }, n: number): Uint8Array {
    const px = new Uint8Array(n * n * 4), t = (box.x1 - box.x0) / n, P = this.near(box, false), col = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const pal = Object.fromEntries(Object.entries(C.far).map(([k, v]) => [k, col(v)])) as Record<keyof typeof C.far, number[]>;
    for (let k = 0; k < n * n; k++) px.set([...pal.none, 255], k * 4);
    for (const f of P.fields) {
      const c = f.kind === 'wood' ? (f.conifer ? pal.conifer : pal.wood) : f.kind === 'rough' ? pal.rough : f.kind === 'arable' ? pal[f.crop] : f.crop === 'ley' ? pal.ley : pal.grass;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const q of f.poly) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
      for (let j = Math.max(0, Math.floor((z0 - box.z0) / t)); j < Math.min(n, Math.ceil((z1 - box.z0) / t)); j++) for (let i = Math.max(0, Math.floor((x0 - box.x0) / t)); i < Math.min(n, Math.ceil((x1 - box.x0) / t)); i++) {
        if (inPoly(box.x0 + (i + 0.5) * t, box.z0 + (j + 0.5) * t, f.poly)) px.set(c, (j * n + i) * 4);
      }
    }
    if (t <= 12) for (const l of P.lines) {
      if (!l.hedge) continue;
      const L = Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z), steps = Math.ceil(L / (t * 0.7));
      for (let s = 0; s <= steps; s++) {
        const x = l.a.x + (l.b.x - l.a.x) * s / steps, z = l.a.z + (l.b.z - l.a.z) * s / steps, i = Math.floor((x - box.x0) / t), j = Math.floor((z - box.z0) / t);
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const o = (j * n + i) * 4, h = pal.hedge, k = t < 6 ? 0.8 : 0.5;
        for (let q = 0; q < 3; q++) px[o + q] = px[o + q] * (1 - k) + h[q] * k;
      }
    }
    return px;
  }

  // One farm block: its fields (and what each is) and its boundaries, from its seed and what's near it.
  block(i: number, j: number): BlockPlan | null {
    const me = blockId(i, j);
    if (this.blocks.has(me)) return this.blocks.get(me)!;
    const b = this.layBlock(i, j);
    this.blocks.set(me, b);
    return b;
  }
  private layBlock(i: number, j: number): BlockPlan | null {
    const { inp } = this, me = blockId(i, j), s = this.seedAt(i, j), R = C.block * 2, bounds = inp.bounds;
    let P: Tagged | null = { pts: [{ x: s.x - R, z: s.z - R }, { x: s.x - R, z: s.z + R }, { x: s.x + R, z: s.z + R }, { x: s.x + R, z: s.z - R }], tags: [-1, -1, -1, -1] };
    if (area(P.pts) < 0) P.pts.reverse(); // (anticlockwise, as every field is)
    for (let di = -2; di <= 2 && P; di++) for (let dj = -2; dj <= 2 && P; dj++) {
      if (!di && !dj) continue;
      const o = this.seedAt(i + di, j + dj), nx = o.x - s.x, nzz = o.z - s.z, c = (nx * (o.x + s.x) + nzz * (o.z + s.z)) / 2;
      P = cutPoly(P, nx, nzz, c, blockId(i + di, j + dj)).lo;
      if (P.pts.length < 3) P = null;
    }
    // (clipped to the map)
    if (P && bounds) for (const [nx, nzz, c] of [[-1, 0, -bounds.x0], [1, 0, bounds.x1], [0, -1, -bounds.z0], [0, 1, bounds.z1]] as const) { if (!P) break; P = cutPoly(P, nx, nzz, c, -1).lo; if (P.pts.length < 3) P = null; }
    if (!P || area(P.pts) < 100) return null;
    const fields: Field[] = [], lines: Line[] = [], sites: FieldSite[] = [];
    // its edges, once each: an edge a neighbour made is drawn by whichever has the smaller id
    for (let k = 0; k < P.pts.length; k++) { const t = P.tags[k]; if (t === -1 || t < me) continue; lines.push({ a: P.pts[k], b: P.pts[(k + 1) % P.pts.length], hedge: true }); }
    const r = rng(mix(inp.seed, 62, i, j));
    this.cutBlock(P.pts, me, r, fields, lines, sites);
    this.decide(me, fields, sites);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const q of P.pts) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
    return { id: me, i, j, box: { x0, z0, x1, z1 }, fields, lines, farms: null };
  }

  private cutBlock(poly: Poly, block: number, r: Rand, fields: Field[], lines: Line[], sites: FieldSite[]) {
    const H = this.inp.heightAt, nz = this.nz, c = centroidOf(poly), slope = this.slopeAt(c.x, c.z), dT = this.townD(c.x, c.z), dW = this.water(c.x, c.z);
    // which way the fields run
    let theta: number;
    const lane = this.lanes.nearest(c.x, c.z, C.alignReach), river = this.rivers.nearest(c.x, c.z, C.alignReach);
    if (lane && (!river || lane.d < river.d * 1.3)) theta = lane.a;
    else if (river) theta = river.a;
    else if (slope > 0.015 && H) theta = Math.atan2(H(c.x + 20, c.z) - H(c.x - 20, c.z), -(H(c.x, c.z + 20) - H(c.x, c.z - 20))); // (along the contour)
    else theta = nz(c.x, c.z, 2600) * Math.PI * 2 + (r() - 0.5) * 0.5;
    theta += (r() - 0.5) * 0.08;
    // how much of it is ploughed: flat land away from the towns and the water
    const A0 = C.arable, flat = 1 - Math.min(1, slope / A0.flatSlope);
    const arable = Math.max(0, Math.min(1, (A0.base + A0.noise * nz(c.x + 5000, c.z, A0.noiseScale)) * flat * Math.min(1, Math.max(0.3, (dT - 50) / A0.townFade)) * (dW < 150 ? A0.water : 1)));
    // the size its fields come in (m²): big where it's ploughed, smaller round the villages and on slopes
    let target = (C.fieldHa.base + C.fieldHa.arable * arable) * 1e4;
    if (dT < C.nearTown.reach) target *= C.nearTown.least + (1 - C.nearTown.least) * Math.max(0, dT) / C.nearTown.reach;
    target *= (0.85 + 0.3 * r()) / (1 + slope * C.slopeShrink);
    const ux = Math.cos(theta), uz = Math.sin(theta), vx = -uz, vz = ux;
    const leaves: { poly: Poly; belt: boolean }[] = [];
    const [k0, k1] = C.keepWhole, Bt = C.belt;
    const split = (p: Poly, depth: number) => {
      const A = area(p);
      if (depth > 14 || A < target * (k0 + (k1 - k0) * r())) { leaves.push({ poly: p, belt: false }); return; }
      const [u0, u1] = extent(p, ux, uz), [v0, v1] = extent(p, vx, vz), Lu = u1 - u0, Lv = v1 - v0;
      // across the longer side (fields about 1:1.6), square to the block's direction
      const acrossU = Lu > Lv * (0.85 + 0.3 * r());
      const [nx, nzz, lo, L] = acrossU ? [ux, uz, u0, Lu] : [vx, vz, v0, Lv];
      const cpos = lo + L * (0.36 + 0.28 * r());
      // now and then a shelter belt: a strip of trees along the cut
      if (A > target * Bt.minBlock && L > 260 && r() < Bt.chance) {
        const w = Bt.width[0] + r() * (Bt.width[1] - Bt.width[0]), a = cutPoly({ pts: p, tags: p.map(() => 0) }, nx, nzz, cpos - w / 2, 1), b = cutPoly({ pts: a.hi.pts, tags: a.hi.tags }, nx, nzz, cpos + w / 2, 1);
        if (a.seg && b.seg && area(a.lo.pts) > target * 0.4 && area(b.hi.pts) > target * 0.4) {
          lines.push({ a: a.seg[0], b: a.seg[1], hedge: false }, { a: b.seg[0], b: b.seg[1], hedge: false });
          leaves.push({ poly: b.lo.pts, belt: true });
          split(a.lo.pts, depth + 1); split(b.hi.pts, depth + 1);
          return;
        }
      }
      const got = cutPoly({ pts: p, tags: p.map(() => 0) }, nx, nzz, cpos, 1);
      if (!got.seg || area(got.lo.pts) < target * C.minPiece || area(got.hi.pts) < target * C.minPiece) { leaves.push({ poly: p, belt: false }); return; }
      lines.push({ a: got.seg[0], b: got.seg[1], hedge: true });
      split(got.lo.pts, depth + 1); split(got.hi.pts, depth + 1);
    };
    split(poly, 0);
    // a lane through a field splits it (along the chord it takes across it)
    const out: { poly: Poly; belt: boolean }[] = [];
    for (const lf of leaves) {
      let parts = [lf];
      if (!lf.belt) for (let pass = 0; pass < 2; pass++) {
        const next: typeof parts = [];
        for (const pt of parts) {
          const cut = this.laneChord(pt.poly);
          if (!cut) { next.push(pt); continue; }
          const nx = -(cut[1].z - cut[0].z), nzz = cut[1].x - cut[0].x, L = Math.hypot(nx, nzz), cc = (nx * cut[0].x + nzz * cut[0].z) / L;
          const got = cutPoly({ pts: pt.poly, tags: pt.poly.map(() => 0) }, nx / L, nzz / L, cc, 1);
          if (!got.seg || area(got.lo.pts) < C.laneSplitMin || area(got.hi.pts) < C.laneSplitMin) { next.push(pt); continue; }
          lines.push({ a: got.seg[0], b: got.seg[1], hedge: false });
          next.push({ poly: got.lo.pts, belt: false }, { poly: got.hi.pts, belt: false });
        }
        parts = next;
      }
      out.push(...parts);
    }
    for (const lf of out) {
      const m = centroidOf(lf.poly), [u0, u1] = extent(lf.poly, ux, uz), [v0, v1] = extent(lf.poly, vx, vz);
      // rows along the field's long side (the block's direction or square to it)
      const dir = (((u1 - u0 >= v1 - v0 ? theta : theta + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI;
      fields.push({ poly: lf.poly, kind: 'grass', crop: 'grass', dir, block, belt: lf.belt || undefined });
      sites.push({ x: m.x, z: m.z, area: area(lf.poly), slope: this.slopeAt(m.x, m.z), height: H ? H(m.x, m.z) : 0, hMax: this.hMax, water: this.water(m.x, m.z), town: this.townD(m.x, m.z), belt: lf.belt, arable, block, rand: r() });
    }
  }
  // where the first lane to cross a field enters and leaves it
  private laneChord(p: Poly): [XZ, XZ] | null {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const q of p) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
    const hits: XZ[] = [];
    for (const [a, b] of this.lanes.near({ x0, z0, x1, z1 })) {
      for (let k = 0; k < p.length; k++) {
        const c = p[k], d = p[(k + 1) % p.length];
        const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x);
        if (Math.abs(den) < 1e-9) continue;
        const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den, s = ((c.x - a.x) * (b.z - a.z) - (c.z - a.z) * (b.x - a.x)) / den;
        if (t >= 0 && t <= 1 && s >= 0 && s <= 1) hits.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      }
      if (hits.length >= 2) break;
    }
    if (hits.length < 2) return null;
    // (the two furthest apart: a winding lane can cross an edge more than once)
    let best: [XZ, XZ] = [hits[0], hits[1]], bd = 0;
    for (let a = 0; a < hits.length; a++) for (let b = a + 1; b < hits.length; b++) { const d = Math.hypot(hits[a].x - hits[b].x, hits[a].z - hits[b].z); if (d > bd) { bd = d; best = [hits[a], hits[b]]; } }
    return bd > 20 ? best : null;
  }

  // What each of a block's fields is: woods first (woods.ts), then rough grazing, then ploughed or grass.
  private decide(block: number, fields: Field[], sites: FieldSite[]) {
    const { seed } = this.inp, inp = this.inp;
    const woods = chooseWoods(sites, { seed, woods: inp.woods ?? 1, pines: inp.pines ?? 0.3 });
    const kr = rng(mix(seed, 63, block));
    const cs = C.crops, cum = [cs.wheat, cs.wheat + cs.barley, cs.wheat + cs.barley + cs.ley, cs.wheat + cs.barley + cs.ley + cs.stubble, 1 - cs.rape];
    const pickCrop = (c: number): Crop => (c < cum[0] ? 'wheat' : c < cum[1] ? 'barley' : c < cum[2] ? 'ley' : c < cum[3] ? 'stubble' : c < cum[4] ? 'plough' : 'rape');
    // a farm grows two or three crops at a time, so fields side by side are often the same
    const fr = rng(mix(seed, 64, block)), farm: [Crop, Crop, boolean] = [pickCrop(fr()), pickCrop(fr()), fr() < C.ley.silageFarm];
    const Rg = C.rough;
    for (let k = 0; k < fields.length; k++) {
      const f = fields[k], s = sites[k], w = woods[k], q = kr();
      if (w) { f.kind = 'wood'; f.conifer = w === 'conifer' || undefined; continue; }
      const high = s.hMax > 35 && s.height > s.hMax * Rg.high;
      if ((high && q < Rg.highChance) || (s.water < Rg.water && q < Rg.waterChance) || (s.slope > Rg.steep && q < Rg.steepChance)) { f.kind = 'rough'; continue; }
      // arable where its block is ploughed (not too near the villages, the water or on a slope)
      const pa = s.arable * (s.slope > 0.08 ? 0.2 : 1) * (s.water < 60 ? 0.2 : 1) * (s.town < 80 ? 0.4 : 1);
      if (kr() < pa) {
        f.kind = 'arable';
        const c = kr();
        f.crop = c < C.farmCrops[0] ? farm[0] : c < C.farmCrops[0] + C.farmCrops[1] ? farm[1] : pickCrop(kr());
      } else {
        f.kind = 'grass';
        f.crop = kr() < (farm[2] ? C.ley.onSilage : C.ley.otherwise) ? 'ley' : 'grass'; // (a ley: cut for silage, fresher, with the mower's lines)
      }
    }
  }

  // A block's farmsteads (none, one or two): beside a road if one runs close, else out among its
  // fields with a track to the nearest road; out of the villages, off the water, out of the woods
  // (its own and its neighbours').
  private farmsOf(b: BlockPlan): Farm[] {
    if (b.farms) return b.farms;
    const F = C.farms, farms: Farm[] = [], fr = rng(mix(this.inp.seed, 65, b.id)), W = (x: number, z: number) => this.water(x, z);
    const woodsNear: Field[] = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const f of this.block(b.i + di, b.j + dj)?.fields ?? []) if (f.kind === 'wood') woodsNear.push(f);
    const inWood = (x: number, z: number) => woodsNear.some((f) => inPoly(x, z, f.poly));
    const list = b.fields, bounds = this.inp.bounds;
    const want = fr() < F.none ? 0 : fr() < F.two ? 2 : 1;
    for (let tries = 0; tries < 8 && farms.length < want; tries++) {
      const f = list[Math.floor(fr() * list.length)], side = fr() < 0.5 ? 1 : -1, seedF = (fr() * 1e9) | 0;
      if (!f || f.kind === 'wood' || f.belt) continue;
      const c = centroidOf(f.poly), lane = this.farmLanes.nearest(c.x, c.z, F.reach);
      if (!lane || lane.d < 40) continue;
      let farm: Farm;
      if (lane.d < F.beside) {
        const nx = -Math.sin(lane.a) * side, nzz = Math.cos(lane.a) * side;
        farm = { x: lane.x + nx * F.off, z: lane.z + nzz * F.off, a: lane.a, side, seed: seedF };
      } else {
        // (facing its road down the track: the yard's near side towards it)
        const dx = (c.x - lane.x) / lane.d, dz = (c.z - lane.z) / lane.d;
        farm = { x: c.x, z: c.z, a: Math.atan2(-dx, dz), side: 1, seed: seedF, track: [{ x: c.x - dx * 17, z: c.z - dz * 17 }, { x: lane.x, z: lane.z }] };
        let bad = false;
        for (let t = 10; t < lane.d - 17 && !bad; t += 20) { const x = c.x - dx * (17 + t), z = c.z - dz * (17 + t); bad = W(x, z) < 15 || inWood(x, z); }
        if (bad) continue;
      }
      const { x, z } = farm;
      if (bounds && (x < bounds.x0 + 60 || x > bounds.x1 - 60 || z < bounds.z0 + 60 || z > bounds.z1 - 60)) continue;
      if (this.townD(x, z) < F.town || W(x, z) < 70 || this.slopeAt(x, z) > 0.08 || inWood(x, z)) continue;
      if (farms.some((o) => Math.hypot(o.x - x, o.z - z) < F.apart)) continue;
      // (not where two roads meet: clear of every other one too)
      if (this.lanes.nearest(x, z, 24)) continue;
      farms.push(farm);
    }
    return (b.farms = farms);
  }
}
export interface CountryInput extends Omit<FieldsInput, 'box'> {
  bounds?: { x0: number; z0: number; x1: number; z1: number }; // the map's edge: blocks are clipped to it
  hMax?: number; // the map's highest ground (m): the top of it is rough grazing and plantations
}

// The whole of a box at once (the 6 km region lays out its painted ground in one go).
export function layFields(inp: FieldsInput & { hMax?: number }): FieldPlan {
  let hMax = inp.hMax ?? 0;
  const H = inp.heightAt, box = inp.box;
  if (H && inp.hMax === undefined) for (let x = box.x0; x <= box.x1; x += 200) for (let z = box.z0; z <= box.z1; z += 200) hMax = Math.max(hMax, H(x, z));
  return new Countryside({ ...inp, bounds: box, hMax }).near(box);
}
function inPoly(x: number, z: number, p: XZ[]) {
  let inside = false;
  for (let a = 0, b = p.length - 1; a < p.length; b = a++) if ((p[a].z > z) !== (p[b].z > z) && x < ((p[b].x - p[a].x) * (z - p[a].z)) / (p[b].z - p[a].z) + p[a].x) inside = !inside;
  return inside;
}
