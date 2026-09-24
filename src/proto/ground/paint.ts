// The cover map painter: fills two RGBA byte images (see covers.ts for the channels) over a square
// region of the world, from the parcel layout and the input shapes. It can repaint any rectangle
// of texels on its own, giving exactly what a full paint gives there: every texel depends only on
// the world within a fixed margin of it, and the margin is painted too (then thrown away).
import { CROP, DIRS } from './covers';

const DPI = DIRS / Math.PI;
import { bbox, GRID, Layout, toGrid, type Cell, type ParcelInfo, type XZ } from './layout';

export interface Region { x0: number; z0: number; size: number; n: number } // n texels across
export interface Rect { i0: number; j0: number; i1: number; j1: number } // texels, i1/j1 exclusive

const DT = 8; // how far (texels) distances are tracked: wet grass reaches this far from water
const MARGIN = DT + 3;
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

export class CoverMap {
  readonly a: Uint8Array; // (see packCover in covers.ts)
  readonly texel: number;
  // how long the last paint spent on each step (ms)
  times = { parcels: 0, shapes: 0, distances: 0, write: 0 };
  constructor(readonly region: Region) {
    this.a = new Uint8Array(region.n * region.n * 4);
    this.texel = region.size / region.n;
  }
  // scratch layers, kept between paints (zeroed for each)
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
    const ei0 = rect.i0 - MARGIN, ej0 = rect.j0 - MARGIN, W = rect.i1 - rect.i0 + 2 * MARGIN, H = rect.j1 - rect.j0 + 2 * MARGIN, N = W * H;
    const x0 = R.x0 + ei0 * t, z0 = R.z0 + ej0 * t, x1 = x0 + W * t, z1 = z0 + H * t;
    const [lawn, field, wood, bare, rough, wet, dir, d, tmp, edge] = this.floats(N, 10);
    const [crop, town, blocked, water] = this.bytes(N, 4);
    const pid = this.ints(N);
    const inWin = (b: { x0: number; z0: number; x1: number; z1: number }, pad = 0) => b.x1 + pad > x0 && b.x0 - pad < x1 && b.z1 + pad > z0 && b.z0 - pad < z1;

    // 1. parcels: each cell's Voronoi polygon is filled with the cell; then a band either side of
    // every edge between different parcels (and of every split line) records the exact distance
    // to it, so field margins and wood edges follow the hedges to the centimetre
    const P = layout.parcels;
    const corners = [toGrid(x0, z0), toGrid(x1, z0), toGrid(x0, z1), toGrid(x1, z1)];
    // (the grid bends up to a cell and a half from where it would be)
    const gi0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 3, gi1 = Math.floor(Math.max(...corners.map((c) => c[0]))) + 3;
    const gj0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 3, gj1 = Math.floor(Math.max(...corners.map((c) => c[1]))) + 3;
    const cellOf: Cell[] = [], own: number[] = [];
    const CA = Math.cos(GRID.angle), SA = Math.sin(GRID.angle), SX = GRID.sx, SZ = GRID.sz;
    edge.fill(1e9);
    pid.fill(-1);
    const band = (a: XZ, b: XZ) => {
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-6) return;
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, B = 7;
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
          if (d < edge[k]) edge[k] = d;
        }
      }
    };
    for (let gi = gi0; gi <= gi1; gi++) for (let gj = gj0; gj <= gj1; gj++) {
      const c = P.cell(gi, gj), { pts, across } = P.polygon(c), idx = cellOf.length;
      cellOf.push(c);
      fill(pts, x0, z0, t, W, H, (a, b) => pid.fill(idx, a, b + 1));
      own.push(P.owner(c, 0), P.owner(c, 1));
      for (let e = 0; e < pts.length; e++) {
        const o = across[e];
        if (!o || (!c.split && !o.split && P.owner(o, 0) === own[idx * 2])) continue; // (inside a merged pair)
        band(pts[e], pts[(e + 1) % pts.length]);
      }
      const sl = P.splitLine(c);
      if (sl) band(sl[0], sl[1]);
    }
    const infos = new Map<number, ParcelInfo>();
    const hit = { id: 0, cell: cellOf[0], edge: 0 };
    let lastId = -1, inf: ParcelInfo = { kind: 'grass', crop: 0, dir: 0 };
    for (let j = 0; j < H; j++) {
      const z = z0 + (j + 0.5) * t;
      for (let i = 0; i < W; i++) {
        const k = j * W + i, x = x0 + (i + 0.5) * t;
        let q = pid[k];
        if (q < 0) { P.hit(x, z, hit); q = cellOf.indexOf(hit.cell); if (q < 0) { cellOf.push(hit.cell); own.push(P.owner(hit.cell, 0), P.owner(hit.cell, 1)); q = cellOf.length - 1; } } // (a texel centre right on an edge)
        const sp = cellOf[q].split;
        const id = own[q * 2 + (sp && sp.nu * ((x * CA + z * SA) / SX) + sp.nv * ((-x * SA + z * CA) / SZ) > sp.c ? 1 : 0)];
        if (id !== lastId) {
          lastId = id;
          const got = infos.get(id);
          if (got) inf = got;
          else { hit.id = id; inf = layout.about(hit); infos.set(id, inf); }
        }
        const ed = edge[k];
        switch (inf.kind) {
          case 'arable': case 'grass':
            field[k] = ed >= 4.5 ? 1 : smooth(1.5, 4.5, ed);
            rough[k] = ed >= 4 ? 0 : (1 - smooth(1, 4, ed)) * 0.85; // the uncut margin along the hedge
            crop[k] = inf.crop; dir[k] = inf.dir;
            break;
          case 'wood':
            wood[k] = ed >= 6 ? 1 : smooth(0, 6, ed);
            rough[k] = (1 - wood[k]) * 0.8; // scrub at the wood's edge
            break;
          case 'rough':
            rough[k] = 0.85;
            break;
          case 'town':
            lawn[k] = 0.5; town[k] = 1; // amenity grass: mown, but not a lawn
            break;
        }
      }
    }
    lap('parcels');
    // 2. shapes
    for (const p of inp.blocked ?? []) if (inWin(boxOf(p), 10)) fill(p, x0, z0, t, W, H, (a, b) => blocked.fill(1, a, b + 1));
    for (const p of inp.water ?? []) if (inWin(boxOf(p), DT * t)) fill(p, x0, z0, t, W, H, (a, b) => water.fill(1, a, b + 1));
    for (const p of inp.plots ?? []) if (inWin(boxOf(p.poly))) {
      const [l, b, r] = p.kind === 'garden' ? [1, 0, 0] : p.kind === 'site' ? [0, 0.9, 0.1] : [0, 0.45, 0.55];
      fill(p.poly, x0, z0, t, W, H, (a, e) => { e++; field.fill(0, a, e); wood.fill(0, a, e); town.fill(1, a, e); lawn.fill(l, a, e); bare.fill(b, a, e); rough.fill(r, a, e); });
    }
    for (const p of inp.parks ?? []) if (inWin(boxOf(p.poly))) {
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
    for (const p of inp.trees ?? []) dab(wood, p.x, p.z, 5.5, 0.75);
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
    return rect;
  }
}
