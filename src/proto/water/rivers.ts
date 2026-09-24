// River reaches: centre lines running downstream, with the width, depth, water level and speed
// at every point, and a spatial index for asking "which rivers are near here?". A reach runs from
// a source or a confluence to the next confluence, the sea or the edge of its region.
//
// The channel each reach cuts into the ground is a rounded trough from bank to bank with the
// water standing at `surf`, and banks rising from the waterline at the reach's bank slope until
// they meet the natural ground. Both the point queries and the grid stamping below use exactly
// the same candidate segments and the same formula, so a tile and a point query always agree.

import type { RiverClass } from './types';

export const CLASS_CODE: Record<RiverClass, number> = { stream: 0, river: 1, navigable: 2, canal: 3, estuary: 4 };
export const CLASS_OF: RiverClass[] = ['stream', 'river', 'navigable', 'canal', 'estuary'];

export interface Reach {
  id: number;
  key: string; // stable id: region and index
  n: number;
  x: Float64Array; z: Float64Array; s: Float64Array; // centre line, downstream, and distance along it
  area: Float32Array; // km² of catchment
  hw: Float32Array; // half width at the waterline
  depth: Float32Array; // centre depth below the surface
  surf: Float32Array; // water surface
  speed: Float32Array; // m/s
  cls: Uint8Array; // CLASS_CODE
  sub: Uint8Array; // 1 where it is neither cut nor drawn (for culverts later: natural rivers run on through lakes and the sea, whose higher water wins)
  bank: Float32Array; // bank slope at each point, rise over run (gentle mudflats on an estuary)
  reach: Float32Array; // how far from the centre line the channel's banks reach before meeting the ground
  up: number[]; // reaches that end where this starts
  down: number; // the reach this flows into (−1 at the sea or the edge)
  mouth: 'sea' | 'edge' | 'join';
}

// the tallest a cut bank gets before it stops (a gorge deeper than that ends in a low cliff)
export const BANK_HEIGHT = 12;
export const reachOf = (r: Reach, i: number) => r.reach[i];
// how far past the waterline water may spill over a low bank
export const SPILL = 2;

// (the bed is flat across most of the width and rounds up to the waterline, as channels are, and
// so that a ground mesh a little coarser than a stream still dips under its water)
export function channelY(d: number, hw: number, depth: number, surf: number, bank: number) {
  if (d < hw) { const q = d / hw, q2 = q * q; return surf - depth * (1 - q2 * q2); }
  return surf + (d - hw) * bank;
}

// A segment hit: which reach and segment, how far along it (0..1) and how far from it.
export interface Hit { r: Reach; i: number; t: number; d: number; side: number }

// Reaches and a hash of their segments on a square grid of cells.
export class ReachIndex {
  private cells = new Map<number, number[]>();
  constructor(readonly reaches: Reach[], readonly cell = 48, box?: [number, number, number, number]) {
    for (const r of reaches) for (let i = 0; i + 1 < r.n; i++) {
      if (r.sub[i] && r.sub[i + 1]) continue;
      const e = Math.max(reachOf(r, i), reachOf(r, i + 1));
      let x0 = Math.min(r.x[i], r.x[i + 1]) - e, x1 = Math.max(r.x[i], r.x[i + 1]) + e;
      let z0 = Math.min(r.z[i], r.z[i + 1]) - e, z1 = Math.max(r.z[i], r.z[i + 1]) + e;
      if (box) { x0 = Math.max(x0, box[0]); z0 = Math.max(z0, box[1]); x1 = Math.min(x1, box[2]); z1 = Math.min(z1, box[3]); if (x0 > x1 || z0 > z1) continue; }
      for (let a = Math.floor(x0 / cell); a <= Math.floor(x1 / cell); a++) for (let b = Math.floor(z0 / cell); b <= Math.floor(z1 / cell); b++) {
        const k = (a + 32768) * 65536 + (b + 32768);
        let l = this.cells.get(k);
        if (!l) this.cells.set(k, (l = []));
        l.push(r.id * 65536 + i);
      }
    }
  }
  get size() { return this.reaches.length; }
  // every segment whose reach covers (x, z), with the projection onto it
  near(x: number, z: number, out: Hit[] = []): Hit[] {
    out.length = 0;
    const l = this.cells.get((Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(z / this.cell) + 32768));
    if (!l) return out;
    for (const code of l) {
      const r = this.reaches[Math.floor(code / 65536)], i = code % 65536;
      const h = project(r, i, x, z);
      if (h.d <= reachOf(r, i) + (reachOf(r, i + 1) - reachOf(r, i)) * h.t) out.push(h);
    }
    return out;
  }
  // segments whose influence box touches a box (for stamping a grid)
  within(x0: number, z0: number, x1: number, z1: number): [Reach, number][] {
    const seen = new Set<number>(), out: [Reach, number][] = [];
    for (let a = Math.floor(x0 / this.cell); a <= Math.floor(x1 / this.cell); a++) for (let b = Math.floor(z0 / this.cell); b <= Math.floor(z1 / this.cell); b++) {
      for (const code of this.cells.get((a + 32768) * 65536 + (b + 32768)) ?? []) if (!seen.has(code)) { seen.add(code); out.push([this.reaches[Math.floor(code / 65536)], code % 65536]); }
    }
    return out;
  }
  // Is a point's cell in the hash at all? (Cheap early-out for the grid code.)
  has(x: number, z: number) { return this.cells.has((Math.floor(x / this.cell) + 32768) * 65536 + (Math.floor(z / this.cell) + 32768)); }
}

export function project(r: Reach, i: number, x: number, z: number): Hit {
  const ax = r.x[i], az = r.z[i], dx = r.x[i + 1] - ax, dz = r.z[i + 1] - az, L2 = dx * dx + dz * dz || 1;
  let t = ((x - ax) * dx + (z - az) * dz) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x - (ax + dx * t), pz = z - (az + dz * t);
  // + on the left looking downstream (x east, z south: left of (dx, dz) is (dz, −dx))
  const side = px * dz - pz * dx >= 0 ? 1 : -1;
  return { r, i, t, d: Math.sqrt(px * px + pz * pz), side };
}

// Values along a reach at a hit, interpolated.
export const lerpAt = (a: ArrayLike<number>, h: Hit) => a[h.i] + (a[h.i + 1] - a[h.i]) * h.t;
export function channelAt(h: Hit) {
  const r = h.r;
  return channelY(h.d, lerpAt(r.hw, h), lerpAt(r.depth, h), lerpAt(r.surf, h), lerpAt(r.bank, h));
}

// ---------- line geometry ----------
// Chaikin corner cutting, ends kept where they are (so reaches meeting at a confluence still meet).
export function chaikin(xs: number[], zs: number[], iterations: number): [number[], number[]] {
  for (let it = 0; it < iterations && xs.length > 2; it++) {
    const n = xs.length, X = [xs[0]], Z = [zs[0]];
    for (let i = 0; i + 1 < n; i++) {
      if (i > 0) { X.push(xs[i] * 0.75 + xs[i + 1] * 0.25); Z.push(zs[i] * 0.75 + zs[i + 1] * 0.25); }
      if (i + 2 < n) { X.push(xs[i] * 0.25 + xs[i + 1] * 0.75); Z.push(zs[i] * 0.25 + zs[i + 1] * 0.75); }
    }
    X.push(xs[n - 1]); Z.push(zs[n - 1]);
    xs = X; zs = Z;
  }
  return [xs, zs];
}

// Resample a polyline every `step` metres (ends kept exactly). Returns the points and, for each,
// its position as a fraction of the original vertex index (for carrying values along).
export function resample(xs: number[], zs: number[], step: number) {
  const n = xs.length, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  const L = cum[n - 1], m = Math.max(1, Math.round(L / step));
  const X: number[] = [], Z: number[] = [], U: number[] = [], S: number[] = [];
  let j = 0;
  for (let k = 0; k <= m; k++) {
    const s = (L * k) / m;
    while (j < n - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1, t = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    X.push(xs[j] + (xs[j + 1] - xs[j]) * t); Z.push(zs[j] + (zs[j + 1] - zs[j]) * t); U.push(j + t); S.push(s);
  }
  return { X, Z, U, S, L };
}

// The grid points within `e` of segment a–b (a capsule), row by row: calls f(j, i0, i1) for each
// row j with the inclusive column range that can be inside. Exact for the capsule's outline, so
// stamping a river onto a grid looks at a few times fewer points than its bounding box.
export function capsuleRows(x0: number, z0: number, step: number, nx: number, nz: number, ax: number, az: number, bx: number, bz: number, e: number, f: (j: number, i0: number, i1: number) => void) {
  const j0 = Math.max(0, Math.ceil((Math.min(az, bz) - e - z0) / step)), j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz) + e - z0) / step));
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  for (let j = j0; j <= j1; j++) {
    const z = z0 + j * step;
    let lo = Infinity, hi = -Infinity;
    // the two end circles
    for (const [cx, cz] of [[ax, az], [bx, bz]]) {
      const q = e * e - (z - cz) * (z - cz);
      if (q >= 0) { const s = Math.sqrt(q); lo = Math.min(lo, cx - s); hi = Math.max(hi, cx + s); }
    }
    // the strip between them: 0 ≤ along ≤ L and |across| ≤ e, each linear in x along the row
    if (L > 1e-9) {
      let a = -Infinity, b = Infinity;
      const clip = (k: number, c: number, min: number, max: number) => {
        // min ≤ k·x + c ≤ max
        if (Math.abs(k) < 1e-12) { if (c < min || c > max) { a = Infinity; b = -Infinity; } return; }
        const u = (min - c) / k, v = (max - c) / k;
        a = Math.max(a, Math.min(u, v)); b = Math.min(b, Math.max(u, v));
      };
      clip(dx / L, ((z - az) * dz) / L - (ax * dx) / L, 0, L);
      clip(dz / L, (-(z - az) * dx) / L - (ax * dz) / L, -e, e);
      if (a <= b) { lo = Math.min(lo, a); hi = Math.max(hi, b); }
    }
    if (lo > hi) continue;
    const i0 = Math.max(0, Math.ceil((lo - x0) / step)), i1 = Math.min(nx - 1, Math.floor((hi - x0) / step));
    if (i0 <= i1) f(j, i0, i1);
  }
}
