// The cover map painter: fills two RGBA byte images (see covers.ts for the channels) over a square
// region of the world, from the parcel layout and the input shapes. It can repaint any rectangle
// of texels on its own, giving exactly what a full paint gives there: every texel depends only on
// the world within a fixed margin of it, and the margin is painted too (then thrown away).
import { CROP, DIRS } from './covers';
import { worldNoise } from './noise';

const DPI = DIRS / Math.PI;
import { bbox, Layout, type ParcelInfo, type XZ } from './layout';

export interface Region { x0: number; z0: number; size: number; n: number } // n texels across
export interface Rect { i0: number; j0: number; i1: number; j1: number } // texels, i1/j1 exclusive

const DT = 8; // how far (texels) distances are tracked: wet grass reaches this far from water
const MARGIN = DT + 3;
// the town's reach past a plot: its centroid marks the coarse grid (20 m cells) 30 m round, so a
// texel up to about 50 m off can change with it (layout.ts townAt); a repaint's window reaches that far
export const TOWN_REACH = 52;
const POOL_KEEP = 1 << 20; // texels: the scratch layers of a bigger paint than this aren't kept (see CoverMap)
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Fill a polygon's texels (centres inside) within the window, calling f(first, last) with the
// index range of each run along a row (inclusive).
const xs: number[] = [];
function fill(poly: XZ[], x0: number, z0: number, t: number, W: number, H: number, f: (a: number, b: number) => void) {
  let zmin = Infinity, zmax = -Infinity;
  for (const p of poly) { if (p.z < zmin) zmin = p.z; if (p.z > zmax) zmax = p.z; }
  const ja = Math.max(0, Math.ceil((zmin - z0) / t - 0.5)), jb = Math.min(H - 1, Math.floor((zmax - z0) / t - 0.5));
  for (let j = ja; j <= jb; j++) {
    const z = z0 + (j + 0.5) * t;
    xs.length = 0;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const p = poly[a], q = poly[b];
      if ((p.z > z) !== (q.z > z)) xs.push(p.x + ((z - p.z) * (q.x - p.x)) / (q.z - p.z));
    }
    if (xs.length > 2) xs.sort((a, b) => a - b);
    else if (xs.length === 2 && xs[0] > xs[1]) { const m = xs[0]; xs[0] = xs[1]; xs[1] = m; }
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ia = Math.max(0, Math.ceil((xs[k] - x0) / t - 0.5)), ib = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / t - 0.5));
      if (ib >= ia) f(j * W + ia, j * W + ib);
    }
  }
}
const boxOf = bbox;

// Two-pass chamfer distance (in texels, 1 and √2 steps) from the set texels, capped at `cap`.
// Returns false (and leaves `out` alone) if nothing is set.
function distance(mask: Uint8Array, W: number, H: number, out: Float32Array, cap: number) {
  const D = 1.4142;
  let ia = W, ib = -1, ja = H, jb = -1;
  out.fill(cap, 0, W * H);
  for (let j = 0; j < H; j++) for (let i = 0, k = j * W; i < W; i++, k++) if (mask[k]) {
    out[k] = 0;
    if (i < ia) ia = i; if (i > ib) ib = i; if (j < ja) ja = j; if (j > jb) jb = j;
  }
  if (ib < 0) return false;
  // only the set texels' box, grown by the cap, can hold anything nearer than the cap
  const g = Math.ceil(cap);
  ia = Math.max(1, ia - g); ib = Math.min(W - 2, ib + g); ja = Math.max(1, ja - g); jb = Math.min(H - 2, jb + g);
  for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
    const k = j * W + i;
    let d = out[k], e = out[k - 1] + 1;
    if (e < d) d = e;
    e = out[k - W] + 1; if (e < d) d = e;
    e = out[k - W - 1] + D; if (e < d) d = e;
    e = out[k - W + 1] + D; if (e < d) d = e;
    out[k] = d;
  }
  for (let j = jb; j >= ja; j--) for (let i = ib; i >= ia; i--) {
    const k = j * W + i;
    let d = out[k], e = out[k + 1] + 1;
    if (e < d) d = e;
    e = out[k + W] + 1; if (e < d) d = e;
    e = out[k + W + 1] + D; if (e < d) d = e;
    e = out[k + W - 1] + D; if (e < d) d = e;
    out[k] = d;
  }
  return true;
}

// [1 2 1]/4 each way: softens stair-steps on polygon edges before the texture's own filtering.
// (The window's outermost texels are left as they are: they're margin, never written out.)
function blur(a: Float32Array, W: number, H: number, tmp: Float32Array) {
  for (let j = 0; j < H; j++) { const r = j * W; tmp[r] = a[r]; tmp[r + W - 1] = a[r + W - 1]; for (let k = r + 1; k < r + W - 1; k++) tmp[k] = (a[k - 1] + a[k] + a[k] + a[k + 1]) * 0.25; }
  for (let k = W; k < W * (H - 1); k++) a[k] = (tmp[k - W] + tmp[k] + tmp[k] + tmp[k + W]) * 0.25;
}

export interface Spot { x: number; z: number; r: number; v: number } // a dab: bare earth at gateways

// The items of a long list whose boxes come near a window, in the list's order (later shapes paint
// over earlier ones). A small repaint shouldn't walk every road, park and tree on the map, so each
// list gets a coarse grid of its boxes, built the first time it's seen: the game keeps its roads,
// parks, water and trees lists between repaints, so that's once (and again if one grows in place,
// as the game's trees do). Short lists are just walked.
type Box = { x0: number; z0: number; x1: number; z1: number };
const IC = 64; // metres per index cell
interface Index { cells: Map<number, number[]>; big: number[]; n: number }
const indexes = new WeakMap<readonly unknown[], Index>();
const ckey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
let stamp = new Uint32Array(0), stampNo = 0;
function near<T>(list: readonly T[] | undefined, boxOfItem: (v: T) => Box, w: Box): readonly T[] {
  if (!list) return [];
  // (a short list, or a big window that would take most of it anyway, is just walked)
  if (list.length < 64 || (w.x1 - w.x0) * (w.z1 - w.z0) > 256 * IC * IC) return list;
  let ix = indexes.get(list);
  if (!ix || ix.n !== list.length) {
    ix = { cells: new Map(), big: [], n: list.length };
    for (let n = 0; n < list.length; n++) {
      const b = boxOfItem(list[n]);
      const i0 = Math.floor(b.x0 / IC), i1 = Math.floor(b.x1 / IC), j0 = Math.floor(b.z0 / IC), j1 = Math.floor(b.z1 / IC);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64 || !Number.isFinite(i0 + i1 + j0 + j1)) { ix.big.push(n); continue; } // (huge ones are always checked)
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = ckey(i, j), c = ix.cells.get(k);
        if (c) c.push(n); else ix.cells.set(k, [n]);
      }
    }
    indexes.set(list, ix);
  }
  if (stamp.length < list.length) stamp = new Uint32Array(list.length);
  if (++stampNo === 0xffffffff) { stamp.fill(0); stampNo = 1; }
  const hits: number[] = [...ix.big];
  for (const n of ix.big) stamp[n] = stampNo;
  for (let i = Math.floor(w.x0 / IC); i <= Math.floor(w.x1 / IC); i++) for (let j = Math.floor(w.z0 / IC); j <= Math.floor(w.z1 / IC); j++) {
    const c = ix.cells.get(ckey(i, j));
    if (c) for (const n of c) if (stamp[n] !== stampNo) { stamp[n] = stampNo; hits.push(n); }
  }
  hits.sort((a, b) => a - b);
  return hits.map((n) => list[n]);
}

export class CoverMap {
  readonly a: Uint8Array; // (see packCover in covers.ts)
  readonly texel: number;
  // how long the last paint spent on each step (ms)
  times = { parcels: 0, shapes: 0, distances: 0, write: 0 };
  constructor(readonly region: Region) {
    this.a = new Uint8Array(region.n * region.n * 4);
    this.texel = region.size / region.n;
  }
  // scratch layers, kept between paints (zeroed for each), and dropped after a paint of a window
  // over POOL_KEEP texels: the live area's first whole-area paint (about 2048² texels) sized them
  // at some 205 MB, kept for good, on a phone; the repaints after it are small (a building, a road)
  private fpool: Float32Array[] = [];
  private bpool: Uint8Array[] = [];
  private floats(N: number, k: number) {
    if (!this.fpool.length || this.fpool[0].length < N) this.fpool = Array.from({ length: k }, () => new Float32Array(N));
    return this.fpool.map((a) => { const v = a.subarray(0, N); v.fill(0); return v; });
  }
  private ipool = new Int32Array(0);
  private ints(N: number) {
    if (this.ipool.length < N) this.ipool = new Int32Array(N);
    return this.ipool.subarray(0, N);
  }
  private bytes(N: number, k: number) {
    if (!this.bpool.length || this.bpool[0].length < N) this.bpool = Array.from({ length: k }, () => new Uint8Array(N));
    return this.bpool.map((a) => { const v = a.subarray(0, N); v.fill(0); return v; });
  }
  // texel rectangle covering a world box (clamped to the map)
  rectFor(x0: number, z0: number, x1: number, z1: number): Rect | null {
    const { region: R, texel: t } = this;
    const r = { i0: Math.max(0, Math.floor((x0 - R.x0) / t)), j0: Math.max(0, Math.floor((z0 - R.z0) / t)), i1: Math.min(R.n, Math.ceil((x1 - R.x0) / t)), j1: Math.min(R.n, Math.ceil((z1 - R.z0) / t)) };
    return r.i1 > r.i0 && r.j1 > r.j0 ? r : null;
  }

  // Paint the rectangle (the whole map if none is given). `spots` are extra bare patches.
  paint(layout: Layout, rect: Rect = { i0: 0, j0: 0, i1: this.region.n, j1: this.region.n }, spots: Spot[] = []) {
    const { region: R, texel: t } = this, inp = layout.input;
    let tm = performance.now();
    const lap = (k: keyof CoverMap['times']) => { const n = performance.now(); this.times[k] = n - tm; tm = n; };
    // the window: the rectangle plus the margin, possibly past the map's edge
    const M = Math.max(MARGIN, Math.ceil(TOWN_REACH / t) + 1);
    const ei0 = rect.i0 - M, ej0 = rect.j0 - M, W = rect.i1 - rect.i0 + 2 * M, H = rect.j1 - rect.j0 + 2 * M, N = W * H;
    const x0 = R.x0 + ei0 * t, z0 = R.z0 + ej0 * t, x1 = x0 + W * t, z1 = z0 + H * t;
    const [lawn, field, wood, bare, rough, wet, dir, d, tmp, edge] = this.floats(N, 10);
    const [crop, town, blocked, water] = this.bytes(N, 4);
    const pid = this.ints(N);
    const win0 = { x0, z0, x1, z1 };
    const inWin = (b: { x0: number; z0: number; x1: number; z1: number }, pad = 0) => b.x1 + pad > x0 && b.x0 - pad < x1 && b.z1 + pad > z0 && b.z0 - pad < z1;

    // 1. fields (the layout's farm blocks, laid out for the window if they aren't yet): each
    // polygon filled with its index; the boundaries banded, recording the exact distance to them, so
    // field margins and wood edges follow the hedges to the centimetre (not inside a wood or the
    // town, where there's none to see); the hedged ones banded again, for the dark line of the
    // hedge's foot that shows from far off
    edge.fill(1e9);
    pid.fill(-1);
    const band = (a: XZ, b: XZ, into: Float32Array = edge) => {
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-6) return;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, B = Math.max(7, t * 0.9);
      const bx0 = Math.min(a.x, b.x) - B, bx1 = Math.max(a.x, b.x) + B, bz0 = Math.min(a.z, b.z) - B, bz1 = Math.max(a.z, b.z) + B;
      if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) return;
      const ia = Math.max(0, Math.floor((bx0 - x0) / t)), ib = Math.min(W - 1, Math.floor((bx1 - x0) / t));
      const ja = Math.max(0, Math.floor((bz0 - z0) / t)), jb = Math.min(H - 1, Math.floor((bz1 - z0) / t));
      for (let j = ja; j <= jb; j++) {
        const pz = z0 + (j + 0.5) * t - a.z;
        for (let i = ia; i <= ib; i++) {
          const px = x0 + (i + 0.5) * t - a.x, s = px * ux + pz * uz;
          const d = s < 0 ? Math.sqrt(px * px + pz * pz) : s > L ? Math.sqrt((px - ux * L) ** 2 + (pz - uz * L) ** 2) : Math.abs(px * uz - pz * ux);
          const k = j * W + i;
          if (d < into[k]) into[k] = d;
        }
      }
    };
    layout.ensure(win0);
    const PL = layout.plan, hedge = d;
    hedge.fill(1e9);
    for (const n of PL.fieldsNear(win0)) fill(PL.fields[n].poly, x0, z0, t, W, H, (a, b) => pid.fill(n, a, b + 1));
    for (const n of PL.linesNear(win0)) {
      const [p, q] = layout.sides(n);
      if ((p === 'wood' && q === 'wood') || (p === 'town' && q === 'town')) continue;
      const l = PL.lines[n];
      band(l.a, l.b);
      if (l.hedge && p !== 'wood' && q !== 'wood' && !(p === 'rough' && q === 'rough') && p !== 'town' && q !== 'town') band(l.a, l.b, hedge);
    }
    // (on a coarse map the margins and the hedge's foot widen with the texel, weaker, so they stay
    // a continuous line rather than a dotted one where the texels only sometimes land on them; no
    // wider than at 16 m texels, past which they'd cover the fields and hide their crops)
    const sc = Math.min(4, Math.max(1, t / 4)), hw = 3 * sc, hk = 0.78 / Math.sqrt(sc);
    let lastId = -2, inf: ParcelInfo = { kind: 'grass', crop: 0, dir: 0 };
    for (let k = 0; k < N; k++) {
      const id = pid[k];
      if (id < 0) continue; // (off the fields: plain pasture)
      if (id !== lastId) { lastId = id; inf = layout.about(id); }
      const ed = edge[k];
      // (a field the town has reached: within 30 m of its plots the ground is the town's)
      if (inf.mixed && layout.townAt(x0 + ((k % W) + 0.5) * t, z0 + (Math.floor(k / W) + 0.5) * t)) { lawn[k] = 0.5; town[k] = 1; continue; }
      switch (inf.kind) {
        case 'arable': case 'grass': {
          field[k] = ed >= 4.5 * sc ? 1 : smooth(1.5 * sc, 4.5 * sc, ed);
          rough[k] = ed >= 4 * sc ? 0 : (1 - smooth(sc, 4 * sc, ed)) * 0.7 / sc; // the uncut margin along the hedge
          crop[k] = inf.crop; dir[k] = inf.dir;
          const hd = hedge[k];
          if (hd < hw) wood[k] = hk * (1 - smooth(0.5 * sc, hw, hd));
          break;
        }
        case 'wood': {
          // (a wood's edge wanders in from the field's: scrub and bramble where the trees stop short)
          const e = ed < 12 ? ed - 4.5 * worldNoise(x0 + ((k % W) + 0.5) * t, z0 + (Math.floor(k / W) + 0.5) * t, 26, 17) : ed;
          wood[k] = e >= 6 ? 1 : smooth(0, 6, e);
          rough[k] = (1 - wood[k]) * 0.8;
          break;
        }
        case 'rough':
          rough[k] = 0.85;
          break;
        case 'town':
          lawn[k] = 0.5; town[k] = 1; // amenity grass: mown, but not a lawn
          break;
      }
    }
    lap('parcels');
    // 2. shapes (only those near the window: see `near`; each is still tested exactly as before)
    const pad = Math.max(10, DT * t, 5.5), win = { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
    for (const p of near(inp.blocked, boxOf, win)) if (inWin(boxOf(p), 10)) fill(p, x0, z0, t, W, H, (a, b) => blocked.fill(1, a, b + 1));
    for (const p of near(inp.water, boxOf, win)) if (inWin(boxOf(p), DT * t)) fill(p, x0, z0, t, W, H, (a, b) => water.fill(1, a, b + 1));
    for (const p of inp.plots ?? []) if (inWin(boxOf(p.poly))) {
      const [l, b, r] = p.kind === 'garden' ? [1, 0, 0] : p.kind === 'site' ? [0, 0.9, 0.1] : p.kind === 'track' ? [0, 0.62, 0.38] : [0, 0.45, 0.55];
      fill(p.poly, x0, z0, t, W, H, (a, e) => { e++; field.fill(0, a, e); wood.fill(0, a, e); town.fill(1, a, e); lawn.fill(l, a, e); bare.fill(b, a, e); rough.fill(r, a, e); });
    }
    for (const p of near(inp.parks, (q) => boxOf(q.poly), win)) if (inWin(boxOf(p.poly))) {
      const st = p.stripes !== undefined, a0 = st ? ((p.stripes! % Math.PI) + Math.PI) % Math.PI : 0;
      fill(p.poly, x0, z0, t, W, H, (a, e) => {
        e++; field.fill(0, a, e); wood.fill(0, a, e); bare.fill(0, a, e); rough.fill(0, a, e); lawn.fill(1, a, e); town.fill(1, a, e);
        if (st) { crop.fill(CROP.stripes, a, e); dir.fill(a0, a, e); }
      });
    }
    // woodland floor under trees out of town; bare earth at gateways
    const dab = (layer: Float32Array, x: number, z: number, r: number, v: number) => {
      if (x + r < x0 || x - r > x1 || z + r < z0 || z - r > z1) return;
      const ia = Math.max(0, Math.floor((x - r - x0) / t)), ib = Math.min(W - 1, Math.floor((x + r - x0) / t));
      const ja = Math.max(0, Math.floor((z - r - z0) / t)), jb = Math.min(H - 1, Math.floor((z + r - z0) / t));
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const k = j * W + i, dx = x0 + (i + 0.5) * t - x, dz = z0 + (j + 0.5) * t - z, d2 = (dx * dx + dz * dz) / (r * r);
        if (d2 < 1 && !town[k]) { const u = v * (1 - d2); if (u > layer[k]) layer[k] = u; }
      }
    };
    for (const p of near(inp.trees, (q) => ({ x0: q.x - 5.5, z0: q.z - 5.5, x1: q.x + 5.5, z1: q.z + 5.5 }), win)) dab(wood, p.x, p.z, 5.5, 0.75);
    for (const s of spots) dab(bare, s.x, s.z, s.r, s.v);

    lap('shapes');
    // 3. verges: on and just beside roads and railways (mown in town, rough out of it), and no
    // crops or woods there
    if (distance(blocked, W, H, d, 3)) for (let k = 0; k < N; k++) {
      const dk = d[k];
      if (dk > 2.5) continue;
      const v = dk <= 1 ? 1 : 1 - smooth(1, 2.5, dk);
      field[k] *= 1 - v; wood[k] *= 1 - v;
      if (town[k]) { if (lawn[k] < 0.85 * v) lawn[k] = 0.85 * v; }
      else if (rough[k] < 0.8 * v) rough[k] = 0.8 * v;
    }
    // 4. lush grass beside water, fading over DT texels
    if (distance(water, W, H, d, DT)) for (let k = 0; k < N; k++) {
      if (d[k] >= DT) continue;
      const w = 1 - smooth(0, DT, d[k]);
      wet[k] = w; field[k] *= 1 - w; bare[k] *= 1 - w;
    }

    lap('distances');
    // 5. soften, keep the four weights summing to at most one, and write the rectangle out
    for (const l of [lawn, field, bare]) blur(l, W, H, tmp); // (wood and field edges are already soft)
    const n = R.n, A = this.a;
    for (let j = rect.j0; j < rect.j1; j++) {
      let k = (j - ej0) * W + (rect.i0 - ei0), o = (j * n + rect.i0) * 4;
      for (let i = rect.i0; i < rect.i1; i++, k++, o += 4) {
        // (packCover, inlined: this runs for every texel)
        const s = lawn[k] + field[k] + wood[k] + bare[k], f = s > 1 ? 127.5 / s : 127.5, r = rough[k], w = wet[k];
        A[o] = 128 + (field[k] - lawn[k]) * f;
        A[o + 1] = crop[k] * DIRS + (((dir[k] * DPI + 0.5) | 0) % DIRS);
        A[o + 2] = 128 + (wood[k] - bare[k]) * f;
        A[o + 3] = 128 + ((r > 1 ? 1 : r) - (w > 1 ? 1 : w)) * 127.5;
      }
    }
    lap('write');
    if (N > POOL_KEEP) { this.fpool = []; this.bpool = []; this.ipool = new Int32Array(0); }
    return rect;
  }
}
