// The region's farmland: fields laid out as English enclosure fields are, in blocks that follow the
// lanes, the rivers and the lie of the land, and what each field is (docs/ground.md, "Fields on a
// region").
//
//   const plan = layFields({ seed, box, settlements, lanes, waterDist, heightAt });
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

const BLOCK = 650; // m between farm-block seeds

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
export function layFields(inp: FieldsInput): FieldPlan {
  const { box, seed } = inp;
  const lanes = new Lines(inp.lanes), farmLanes = new Lines(inp.farmLanes ?? []), rivers = new Lines(inp.rivers ?? []), nz = noise(mix(seed, 71));
  const H = inp.heightAt, W = inp.waterDist ?? (() => 1e4);
  const slopeAt = (x: number, z: number) => (H ? Math.hypot(H(x + 20, z) - H(x - 20, z), H(x, z + 20) - H(x, z - 20)) / 40 : 0);
  const townD = (x: number, z: number) => { let d = Infinity; for (const s of inp.settlements) d = Math.min(d, Math.hypot(x - s.x, z - s.z) - s.reach); return d; };
  let hMax = 0;
  if (H) for (let x = box.x0; x <= box.x1; x += 200) for (let z = box.z0; z <= box.z1; z += 200) hMax = Math.max(hMax, H(x, z));

  // 1. farm blocks: Voronoi cells of jittered seeds
  const i0 = Math.floor(box.x0 / BLOCK) - 1, i1 = Math.floor(box.x1 / BLOCK) + 1, j0 = Math.floor(box.z0 / BLOCK) - 1, j1 = Math.floor(box.z1 / BLOCK) + 1;
  const seedAt = (i: number, j: number) => { const r = rng(mix(seed, 61, i, j)); return { x: (i + 0.15 + r() * 0.7) * BLOCK, z: (j + 0.15 + r() * 0.7) * BLOCK }; };
  const bid = (i: number, j: number) => (i - i0 + 2) * 1000 + (j - j0 + 2);
  const fields: Field[] = [], lines: Line[] = [], sites: FieldSite[] = []; // (sites[k]: what field k's land is like)
  const clipBox = (P: Tagged): Tagged | null => {
    let q: Tagged | null = P;
    for (const [nx, nzz, c] of [[-1, 0, -box.x0], [1, 0, box.x1], [0, -1, -box.z0], [0, 1, box.z1]] as const) { if (!q) return null; q = cutPoly(q, nx, nzz, c, -1).lo; if (q.pts.length < 3) return null; }
    return q;
  };
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const s = seedAt(i, j), me = bid(i, j), R = BLOCK * 2;
    let P: Tagged | null = { pts: [{ x: s.x - R, z: s.z - R }, { x: s.x - R, z: s.z + R }, { x: s.x + R, z: s.z + R }, { x: s.x + R, z: s.z - R }], tags: [-1, -1, -1, -1] };
    if (area(P.pts) < 0) P.pts.reverse();
    for (let di = -2; di <= 2 && P; di++) for (let dj = -2; dj <= 2 && P; dj++) {
      if (!di && !dj) continue;
      const o = seedAt(i + di, j + dj), nx = o.x - s.x, nzz = o.z - s.z, c = (nx * (o.x + s.x) + nzz * (o.z + s.z)) / 2;
      P = cutPoly(P, nx, nzz, c, bid(i + di, j + dj)).lo;
      if (P.pts.length < 3) P = null;
    }
    if (!P) continue;
    P = clipBox(P);
    if (!P || area(P.pts) < 100) continue;
    // its edges, once each: an edge a neighbour made is drawn by whichever has the smaller id
    for (let k = 0; k < P.pts.length; k++) { const t = P.tags[k]; if (t >= 0 && t < me) continue; if (t === -1) continue; lines.push({ a: P.pts[k], b: P.pts[(k + 1) % P.pts.length], hedge: true }); }
    layBlock(P.pts, me, rng(mix(seed, 62, i, j)));
  }

  function layBlock(poly: Poly, block: number, r: Rand) {
    const c = centroidOf(poly), slope = slopeAt(c.x, c.z), dT = townD(c.x, c.z), dW = W(c.x, c.z);
    // which way the fields run
    let theta: number;
    const lane = lanes.nearest(c.x, c.z, 380), river = rivers.nearest(c.x, c.z, 380);
    if (lane && (!river || lane.d < river.d * 1.3)) theta = lane.a;
    else if (river) theta = river.a;
    else if (slope > 0.015 && H) theta = Math.atan2(H(c.x + 20, c.z) - H(c.x - 20, c.z), -(H(c.x, c.z + 20) - H(c.x, c.z - 20))); // (along the contour)
    else theta = nz(c.x, c.z, 2600) * Math.PI * 2 + (r() - 0.5) * 0.5;
    theta += (r() - 0.5) * 0.08;
    // how much of it is ploughed: flat land away from the towns and the water
    const flat = 1 - Math.min(1, slope / 0.13);
    const arable = Math.max(0, Math.min(1, (0.3 + 0.9 * nz(c.x + 5000, c.z, 1700)) * flat * Math.min(1, Math.max(0.3, (dT - 50) / 500)) * (dW < 150 ? 0.5 : 1)));
    // the size its fields come in (m²): big where it's ploughed, smaller round the villages and on slopes
    let target = (4 + 7.5 * arable) * 1e4;
    if (dT < 700) target *= 0.6 + 0.4 * Math.max(0, dT) / 700;
    target *= (0.85 + 0.3 * r()) / (1 + slope * 6);
    const ux = Math.cos(theta), uz = Math.sin(theta), vx = -uz, vz = ux;
    const leaves: { poly: Poly; belt: boolean }[] = [];
    const split = (p: Poly, depth: number) => {
      const A = area(p);
      if (depth > 14 || A < target * (0.7 + 0.6 * r())) { leaves.push({ poly: p, belt: false }); return; }
      const [u0, u1] = extent(p, ux, uz), [v0, v1] = extent(p, vx, vz), Lu = u1 - u0, Lv = v1 - v0;
      // across the longer side (fields about 1:1.6), square to the block's direction
      const acrossU = Lu > Lv * (0.85 + 0.3 * r());
      const [nx, nzz, lo, L] = acrossU ? [ux, uz, u0, Lu] : [vx, vz, v0, Lv];
      const cpos = lo + L * (0.36 + 0.28 * r());
      // now and then a shelter belt: a strip of trees 16-24 m wide along the cut
      if (A > target * 5 && L > 260 && r() < 0.1) {
        const w = 16 + r() * 8, a = cutPoly({ pts: p, tags: p.map(() => 0) }, nx, nzz, cpos - w / 2, 1), b = cutPoly({ pts: a.hi.pts, tags: a.hi.tags }, nx, nzz, cpos + w / 2, 1);
        if (a.seg && b.seg && area(a.lo.pts) > target * 0.4 && area(b.hi.pts) > target * 0.4) {
          lines.push({ a: a.seg[0], b: a.seg[1], hedge: false }, { a: b.seg[0], b: b.seg[1], hedge: false });
          leaves.push({ poly: b.lo.pts, belt: true });
          split(a.lo.pts, depth + 1); split(b.hi.pts, depth + 1);
          return;
        }
      }
      const got = cutPoly({ pts: p, tags: p.map(() => 0) }, nx, nzz, cpos, 1);
      const al = area(got.lo.pts), ah = area(got.hi.pts);
      if (!got.seg || al < target * 0.3 || ah < target * 0.3) { leaves.push({ poly: p, belt: false }); return; }
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
          const cut = laneChord(pt.poly);
          if (!cut) { next.push(pt); continue; }
          const nx = -(cut[1].z - cut[0].z), nzz = cut[1].x - cut[0].x, L = Math.hypot(nx, nzz), cc = (nx * cut[0].x + nzz * cut[0].z) / L;
          const got = cutPoly({ pts: pt.poly, tags: pt.poly.map(() => 0) }, nx / L, nzz / L, cc, 1);
          if (!got.seg || area(got.lo.pts) < 8000 || area(got.hi.pts) < 8000) { next.push(pt); continue; }
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
      sites.push({ x: m.x, z: m.z, area: area(lf.poly), slope: slopeAt(m.x, m.z), height: H ? H(m.x, m.z) : 0, hMax, water: W(m.x, m.z), town: townD(m.x, m.z), belt: lf.belt, arable, block, rand: r() });
    }
  }
  // where the first lane to cross a field enters and leaves it
  function laneChord(p: Poly): [XZ, XZ] | null {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const q of p) { x0 = Math.min(x0, q.x); z0 = Math.min(z0, q.z); x1 = Math.max(x1, q.x); z1 = Math.max(z1, q.z); }
    const hits: XZ[] = [];
    for (const [a, b] of lanes.near({ x0, z0, x1, z1 })) {
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

  // 2. what each field is: woods first (woods.ts), then rough grazing, then ploughed or grass
  const woods = chooseWoods(sites, { seed, woods: inp.woods ?? 1, pines: inp.pines ?? 0.3 });
  const kr = rng(mix(seed, 63));
  // a farm grows two or three crops at a time, so fields side by side are often the same
  const pickCrop = (c: number): Crop => (c < 0.34 ? 'wheat' : c < 0.56 ? 'barley' : c < 0.7 ? 'ley' : c < 0.81 ? 'stubble' : c < 0.93 ? 'plough' : 'rape');
  const farm = new Map<number, [Crop, Crop, boolean]>();
  const farmOf = (b: number) => { let f = farm.get(b); if (!f) { const r = rng(mix(seed, 64, b)); farm.set(b, (f = [pickCrop(r()), pickCrop(r()), r() < 0.35])); } return f; };
  for (let k = 0; k < fields.length; k++) {
    const f = fields[k], s = sites[k], w = woods[k], q = kr();
    if (w) { f.kind = 'wood'; f.conifer = w === 'conifer' || undefined; continue; }
    const high = s.hMax > 35 && s.height > s.hMax * 0.62;
    if ((high && q < 0.6) || (s.water < 25 && q < 0.35) || (s.slope > 0.12 && q < 0.45)) { f.kind = 'rough'; continue; }
    // arable where its block is ploughed (not too near the villages, the water or on a slope)
    const pa = s.arable * (s.slope > 0.08 ? 0.2 : 1) * (s.water < 60 ? 0.2 : 1) * (s.town < 80 ? 0.4 : 1);
    if (kr() < pa) {
      f.kind = 'arable';
      const c = kr(), fm = farmOf(f.block);
      f.crop = c < 0.45 ? fm[0] : c < 0.7 ? fm[1] : pickCrop(kr());
    } else {
      f.kind = 'grass';
      f.crop = kr() < (farmOf(f.block)[2] ? 0.45 : 0.12) ? 'ley' : 'grass'; // (a ley: cut for silage, fresher, with the mower's lines; some farms make a lot)
    }
  }
  // 3. farmsteads: about two farm blocks in three have one, beside a lane if one runs close, else
  // out among its fields with a track to the nearest road; out of the villages, off the water, out
  // of the woods
  const farms: Farm[] = [];
  const fr = rng(mix(seed, 65)), inWood = (x: number, z: number) => fields.some((f) => f.kind === 'wood' && inPoly(x, z, f.poly));
  const byBlock = new Map<number, Field[]>();
  for (const f of fields) { const l = byBlock.get(f.block); if (l) l.push(f); else byBlock.set(f.block, [f]); }
  for (const [, list] of byBlock) {
    // (up to two a block, each tried in a few of its fields)
    const want = fr() < 0.35 ? 0 : fr() < 0.45 ? 2 : 1;
    let got = 0;
    for (let tries = 0; tries < 8 && got < want; tries++) {
      const f = list[Math.floor(fr() * list.length)], side = fr() < 0.5 ? 1 : -1, seedF = (fr() * 1e9) | 0;
      if (f.kind === 'wood' || f.belt) continue;
      const c = centroidOf(f.poly), lane = farmLanes.nearest(c.x, c.z, 700);
      if (!lane || lane.d < 40) continue;
      let farm: Farm;
      if (lane.d < 260) {
        const nx = -Math.sin(lane.a) * side, nzz = Math.cos(lane.a) * side;
        farm = { x: lane.x + nx * 30, z: lane.z + nzz * 30, a: lane.a, side, seed: seedF };
      } else {
        // (facing its road down the track: the yard's near side towards it)
        const dx = (c.x - lane.x) / lane.d, dz = (c.z - lane.z) / lane.d;
        farm = { x: c.x, z: c.z, a: Math.atan2(-dx, dz), side: 1, seed: seedF, track: [{ x: c.x - dx * 17, z: c.z - dz * 17 }, { x: lane.x, z: lane.z }] };
        let bad = false;
        for (let t = 10; t < lane.d - 17 && !bad; t += 20) { const x = c.x - dx * (17 + t), z = c.z - dz * (17 + t); bad = W(x, z) < 15 || inWood(x, z); }
        if (bad) continue;
      }
      const { x, z } = farm;
      if (x < box.x0 + 60 || x > box.x1 - 60 || z < box.z0 + 60 || z > box.z1 - 60) continue;
      if (townD(x, z) < 160 || W(x, z) < 70 || slopeAt(x, z) > 0.08 || inWood(x, z)) continue;
      if (farms.some((o) => Math.hypot(o.x - x, o.z - z) < 380)) continue;
      // (not where two roads meet: clear of every other one too)
      if (lanes.nearest(x, z, 24)) continue;
      farms.push(farm);
      got++;
    }
  }
  return { fields, lines, farms };
}
function inPoly(x: number, z: number, p: XZ[]) {
  let inside = false;
  for (let a = 0, b = p.length - 1; a < p.length; b = a++) if ((p[a].z > z) !== (p[b].z > z) && x < ((p[b].x - p[a].x) * (z - p[a].z)) / (p[b].z - p[a].z) + p[a].x) inside = !inside;
  return inside;
}
