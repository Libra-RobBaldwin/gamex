// The cover map painter: fills two RGBA byte images (see covers.ts for the channels) over a square
// region of the world, from the parcel layout and the input shapes. It can repaint any rectangle
// of texels on its own, giving exactly what a full paint gives there: every texel depends only on
// the world within a fixed margin of it, and the margin is painted too (then thrown away).
import { CROP } from './covers';
import { cellAt, Layout, toGrid, type ParcelInfo, type XZ } from './layout';

export interface Region { x0: number; z0: number; size: number; n: number } // n texels across
export interface Rect { i0: number; j0: number; i1: number; j1: number } // texels, i1/j1 exclusive

const DT = 8; // how far (texels) distances are tracked: wet grass reaches this far from water
const MARGIN = DT + 2;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Fill a polygon's texels (centres inside) within the window, calling f(index) for each.
function fill(poly: XZ[], x0: number, z0: number, t: number, W: number, H: number, f: (k: number) => void) {
  let zmin = Infinity, zmax = -Infinity;
  for (const p of poly) { zmin = Math.min(zmin, p.z); zmax = Math.max(zmax, p.z); }
  const ja = Math.max(0, Math.ceil((zmin - z0) / t - 0.5)), jb = Math.min(H - 1, Math.floor((zmax - z0) / t - 0.5));
  const xs: number[] = [];
  for (let j = ja; j <= jb; j++) {
    const z = z0 + (j + 0.5) * t;
    xs.length = 0;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const p = poly[a], q = poly[b];
      if ((p.z > z) !== (q.z > z)) xs.push(p.x + ((z - p.z) * (q.x - p.x)) / (q.z - p.z));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ia = Math.max(0, Math.ceil((xs[k] - x0) / t - 0.5)), ib = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / t - 0.5));
      for (let i = ia; i <= ib; i++) f(j * W + i);
    }
  }
}
function boxOf(poly: XZ[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1 };
}

// Two-pass chamfer distance (in texels, 1 and √2 steps) from the set texels, capped at DT.
function distance(mask: Uint8Array, W: number, H: number, out: Float32Array) {
  const D = 1.4142;
  for (let k = 0; k < W * H; k++) out[k] = mask[k] ? 0 : DT;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let d = out[k];
    if (i > 0) d = Math.min(d, out[k - 1] + 1);
    if (j > 0) {
      d = Math.min(d, out[k - W] + 1);
      if (i > 0) d = Math.min(d, out[k - W - 1] + D);
      if (i < W - 1) d = Math.min(d, out[k - W + 1] + D);
    }
    out[k] = d;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    let d = out[k];
    if (i < W - 1) d = Math.min(d, out[k + 1] + 1);
    if (j < H - 1) {
      d = Math.min(d, out[k + W] + 1);
      if (i < W - 1) d = Math.min(d, out[k + W + 1] + D);
      if (i > 0) d = Math.min(d, out[k + W - 1] + D);
    }
    out[k] = d;
  }
}

// [1 2 1]/4 each way: softens stair-steps on polygon edges before the texture's own filtering
function blur(a: Float32Array, W: number, H: number, tmp: Float32Array) {
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    tmp[k] = (a[i > 0 ? k - 1 : k] + 2 * a[k] + a[i < W - 1 ? k + 1 : k]) * 0.25;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    a[k] = (tmp[j > 0 ? k - W : k] + 2 * tmp[k] + tmp[j < H - 1 ? k + W : k]) * 0.25;
  }
}

export interface Spot { x: number; z: number; r: number; v: number } // a dab: bare earth at gateways

export class CoverMap {
  readonly a: Uint8Array;
  readonly b: Uint8Array;
  readonly texel: number;
  constructor(readonly region: Region) {
    this.a = new Uint8Array(region.n * region.n * 4);
    this.b = new Uint8Array(region.n * region.n * 4);
    this.texel = region.size / region.n;
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
    // the window: the rectangle plus the margin, possibly past the map's edge
    const ei0 = rect.i0 - MARGIN, ej0 = rect.j0 - MARGIN, W = rect.i1 - rect.i0 + 2 * MARGIN, H = rect.j1 - rect.j0 + 2 * MARGIN, N = W * H;
    const x0 = R.x0 + ei0 * t, z0 = R.z0 + ej0 * t, x1 = x0 + W * t, z1 = z0 + H * t;
    const lawn = new Float32Array(N), field = new Float32Array(N), wood = new Float32Array(N), bare = new Float32Array(N), rough = new Float32Array(N), wet = new Float32Array(N);
    const crop = new Uint8Array(N), dir = new Float32Array(N), town = new Uint8Array(N);
    const inWin = (b: { x0: number; z0: number; x1: number; z1: number }, pad = 0) => b.x1 + pad > x0 && b.x0 - pad < x1 && b.z1 + pad > z0 && b.z0 - pad < z1;

    // 1. parcels: the nearest seed (in grid space) decides the parcel; the distance to its edge is
    // measured to the bisector with the nearest seed of a different parcel, and to a split line
    const corners = [toGrid(x0, z0), toGrid(x1, z0), toGrid(x0, z1), toGrid(x1, z1)];
    const gi0 = Math.floor(Math.min(...corners.map((c) => c[0]))) - 2, gi1 = Math.floor(Math.max(...corners.map((c) => c[0]))) + 2;
    const gj0 = Math.floor(Math.min(...corners.map((c) => c[1]))) - 2, gj1 = Math.floor(Math.max(...corners.map((c) => c[1]))) + 2;
    const GW = gi1 - gi0 + 1, GH = gj1 - gj0 + 1, GN = GW * GH;
    const cu = new Float64Array(GN), cv = new Float64Array(GN), grp = new Int32Array(GN);
    const cells = new Array(GN);
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW; gi++) {
      const c = cellAt(gi0 + gi, gj0 + gj, layout.seed), k = gj * GW + gi;
      cells[k] = c; cu[k] = c.u; cv[k] = c.v; grp[k] = k;
    }
    for (let gj = 0; gj < GH; gj++) for (let gi = 0; gi < GW - 1; gi++) if (cells[gj * GW + gi].merge) grp[gj * GW + gi + 1] = gj * GW + gi;
    const infos = new Map<number, ParcelInfo>();
    const hit = { id: 0, cell: cells[0], edge: 0 };
    const CA = Math.cos(0.33), SA = Math.sin(0.33), SX = 240, SZ = 165; // (layout's grid; see toGrid)
    for (let j = 0; j < H; j++) {
      const z = z0 + (j + 0.5) * t;
      for (let i = 0; i < W; i++) {
        const x = x0 + (i + 0.5) * t, gu = (x * CA + z * SA) / SX, gv = (-x * SA + z * CA) / SZ;
        const ci = Math.floor(gu) - gi0, cj = Math.floor(gv) - gj0;
        let b1 = -1, d1 = Infinity;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const k = (cj + dj) * GW + ci + di, d = (cu[k] - gu) ** 2 + (cv[k] - gv) ** 2;
          if (d < d1) { d1 = d; b1 = k; }
        }
        const c = cells[b1];
        let edge = Infinity;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const k = (cj + dj) * GW + ci + di;
          if (k === b1 || grp[k] === grp[b1]) continue;
          const du = cu[k] - cu[b1], dv = cv[k] - cv[b1];
          const f = ((cu[k] + cu[b1]) / 2 - gu) * du + ((cv[k] + cv[b1]) / 2 - gv) * dv;
          const wx = (du * CA) / SX - (dv * SA) / SZ, wz = (du * SA) / SX + (dv * CA) / SZ;
          edge = Math.min(edge, f / Math.sqrt(wx * wx + wz * wz));
        }
        let side = 0;
        if (c.split) {
          const s = c.split, g = s.nu * gu + s.nv * gv - s.c;
          side = g > 0 ? 1 : 0;
          const wx = (s.nu * CA) / SX - (s.nv * SA) / SZ, wz = (s.nu * SA) / SX + (s.nv * CA) / SZ;
          edge = Math.min(edge, Math.abs(g) / Math.sqrt(wx * wx + wz * wz));
        }
        const owner = cells[grp[b1]];
        const id = ((owner.i + 32768) * 65536 + (owner.j + 32768)) * 2 + side;
        let inf = infos.get(id);
        if (!inf) { hit.id = id; hit.cell = owner === c ? c : owner; inf = layout.about(hit); infos.set(id, inf); }
        const k = j * W + i;
        switch (inf.kind) {
          case 'arable': case 'grass':
            field[k] = smooth(1.5, 4.5, edge);
            rough[k] = (1 - smooth(1, 4, edge)) * 0.85; // the uncut margin along the hedge
            crop[k] = inf.crop; dir[k] = inf.dir;
            break;
          case 'wood':
            wood[k] = smooth(0, 6, edge);
            rough[k] = (1 - wood[k]) * 0.8; // scrub at the wood's edge
            break;
          case 'rough':
            rough[k] = 0.85;
            break;
          case 'town':
            lawn[k] = 0.7; town[k] = 1;
            break;
        }
      }
    }

    // 2. shapes
    const blocked = new Uint8Array(N), water = new Uint8Array(N);
    for (const p of inp.blocked ?? []) if (inWin(boxOf(p), 10)) fill(p, x0, z0, t, W, H, (k) => { blocked[k] = 1; });
    for (const p of inp.water ?? []) if (inWin(boxOf(p), DT * t)) fill(p, x0, z0, t, W, H, (k) => { water[k] = 1; });
    for (const p of inp.plots ?? []) if (inWin(boxOf(p.poly))) fill(p.poly, x0, z0, t, W, H, (k) => {
      field[k] = wood[k] = 0; town[k] = 1;
      if (p.kind === 'garden') { lawn[k] = 1; bare[k] = rough[k] = 0; }
      else if (p.kind === 'site') { lawn[k] = 0; bare[k] = 0.9; rough[k] = 0.1; }
      else { lawn[k] = 0; bare[k] = 0.45; rough[k] = 0.55; }
    });
    for (const p of inp.parks ?? []) if (inWin(boxOf(p.poly))) fill(p.poly, x0, z0, t, W, H, (k) => {
      field[k] = wood[k] = bare[k] = rough[k] = 0; lawn[k] = 1; town[k] = 1;
      if (p.stripes !== undefined) { crop[k] = CROP.stripes; dir[k] = ((p.stripes % Math.PI) + Math.PI) % Math.PI; }
    });
    // woodland floor under trees out of town; bare earth at gateways
    const dab = (layer: Float32Array, x: number, z: number, r: number, v: number) => {
      if (x + r < x0 || x - r > x1 || z + r < z0 || z - r > z1) return;
      const ia = Math.max(0, Math.floor((x - r - x0) / t)), ib = Math.min(W - 1, Math.floor((x + r - x0) / t));
      const ja = Math.max(0, Math.floor((z - r - z0) / t)), jb = Math.min(H - 1, Math.floor((z + r - z0) / t));
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
        const k = j * W + i, d = Math.hypot(x0 + (i + 0.5) * t - x, z0 + (j + 0.5) * t - z) / r;
        if (d < 1 && !town[k]) layer[k] = Math.max(layer[k], v * (1 - d * d));
      }
    };
    for (const p of inp.trees ?? []) dab(wood, p.x, p.z, 5.5, 0.75);
    for (const s of spots) dab(bare, s.x, s.z, s.r, s.v);

    // 3. verges: on and just beside roads and railways (mown in town, rough out of it), and no
    // crops or woods there
    const d = new Float32Array(N);
    distance(blocked, W, H, d);
    for (let k = 0; k < N; k++) {
      if (d[k] > 2.5) continue;
      const v = 1 - smooth(1, 2.5, d[k]);
      field[k] *= 1 - v; wood[k] *= 1 - v;
      if (town[k]) lawn[k] = Math.max(lawn[k], 0.85 * v);
      else rough[k] = Math.max(rough[k], 0.8 * v);
    }
    // 4. lush grass beside water, fading over DT texels
    distance(water, W, H, d);
    for (let k = 0; k < N; k++) {
      const w = 1 - smooth(0, DT, d[k]);
      wet[k] = w; field[k] *= 1 - w; bare[k] *= 1 - w;
    }

    // 5. soften, keep the four weights summing to at most one, and write the rectangle out
    const tmp = new Float32Array(N);
    for (const l of [lawn, field, wood, bare, rough, wet]) blur(l, W, H, tmp);
    const n = R.n;
    for (let j = rect.j0; j < rect.j1; j++) for (let i = rect.i0; i < rect.i1; i++) {
      const k = (j - ej0) * W + (i - ei0), o = (j * n + i) * 4;
      const s = lawn[k] + field[k] + wood[k] + bare[k], f = s > 1 ? 1 / s : 1;
      this.a[o] = (lawn[k] * f * 255 + 0.5) | 0;
      this.a[o + 1] = (field[k] * f * 255 + 0.5) | 0;
      this.a[o + 2] = (wood[k] * f * 255 + 0.5) | 0;
      this.a[o + 3] = (bare[k] * f * 255 + 0.5) | 0;
      this.b[o] = crop[k] * 32 + 16;
      this.b[o + 1] = Math.min(255, (dir[k] / Math.PI) * 256) | 0;
      this.b[o + 2] = (Math.min(1, rough[k]) * 255 + 0.5) | 0;
      this.b[o + 3] = (Math.min(1, wet[k]) * 255 + 0.5) | 0;
    }
    return rect;
  }
}
