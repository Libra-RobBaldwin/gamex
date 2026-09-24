// Land claims for water: polygons for the land registry (land.ts), so plots, parks and roads keep
// off water with no new code (they already ask land.free()). Outlines come from marching squares
// on a tile's signed distance to the shore (so they follow the waterline smoothly, a `buffer`
// metres out if asked), cut into blocks of 200 m so each claim stays small and the registry's
// spatial hash stays quick. Islands inside a block are joined to their outline by a zero-width
// slit, which keeps every polygon simple (the registry's point-in-polygon and edge tests work on
// that unchanged).

import type { Land, Owner } from '../land';
import { KIND_OF, type WaterKind } from './types';
import type { WaterTile } from './water';

export interface XZ { x: number; z: number }
export interface WaterClaim { key: string; polys: XZ[][]; kinds: WaterKind[]; bodies: string[] }

export interface ClaimOpts {
  buffer?: number; // metres beyond the waterline to claim (a towpath, a sea wall's footing)
  block?: number; // metres per block
  tolerance?: number; // metres of simplification
}

// Corners a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1); edges 0 top, 1 right, 2 bottom, 3 left.
const PAIRS: number[][][] = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], [], [[0, 2]], [[3, 2]],
  [[2, 3]], [[0, 2]], [], [[1, 2]], [[1, 3]], [[0, 1]], [[3, 0]], [],
];

// Rings where f crosses 0 on a grid (f > 0 inside), in grid units. Outer rings come out with
// negative shoelace area in (x, z), holes positive.
export function contours(f: Float32Array, nx: number, nz: number): number[][][] {
  const W = nx, pt = new Map<number, [number, number]>();
  // the crossing on an edge: horizontal edges (i, j)–(i+1, j) are 2(jW + i), vertical ones (i, j)–(i, j+1) are 2(jW + i) + 1
  const cross = (id: number): [number, number] => {
    let p = pt.get(id);
    if (p) return p;
    const k = id >> 1, i = k % W, j = (k - i) / W, v = id & 1;
    const f0 = f[k], f1 = v ? f[k + W] : f[k + 1], t = f0 / (f0 - f1);
    p = v ? [i, j + t] : [i + t, j];
    pt.set(id, p);
    return p;
  };
  const next = new Map<number, number>();
  for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    const k = j * W + i, va = f[k], vb = f[k + 1], vc = f[k + W + 1], vd = f[k + W];
    const cs = (va > 0 ? 1 : 0) | (vb > 0 ? 2 : 0) | (vc > 0 ? 4 : 0) | (vd > 0 ? 8 : 0);
    if (cs === 0 || cs === 15) continue;
    const edge = [2 * k, 2 * (k + 1) + 1, 2 * (k + W), 2 * k + 1];
    let pairs = PAIRS[cs];
    if (cs === 5 || cs === 10) {
      const centre = (va + vb + vc + vd) / 4 > 0;
      // a saddle: joined through the middle or not, which decides which corners get cut off
      pairs = (cs === 5) === centre ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
    }
    const corners: [number, number, number][] = [[i, j, va], [i + 1, j, vb], [i + 1, j + 1, vc], [i, j + 1, vd]];
    for (const [e1, e2] of pairs) {
      let s = edge[e1], e = edge[e2];
      const p = cross(s), q = cross(e), dx = q[0] - p[0], dz = q[1] - p[1];
      // orient so the inside is where the cross product is negative
      let S = 0;
      for (const [x, z, v] of corners) { const c = dx * (z - p[1]) - dz * (x - p[0]); S += (v > 0 ? 1 : -1) * Math.sign(c); }
      if (S > 0) [s, e] = [e, s];
      next.set(s, e);
    }
  }
  const rings: number[][][] = [], seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring: number[][] = [];
    let e = start;
    while (!seen.has(e)) { seen.add(e); ring.push(cross(e)); const n = next.get(e); if (n === undefined) break; e = n; }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

const area = (r: number[][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
function inside(p: number[], r: number[][]) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
}
// Douglas–Peucker on a closed ring: split at the first point and the one farthest from it, and
// simplify each half.
function simplify(r: number[][], tol: number): number[][] {
  const n = r.length;
  if (n < 8) return r;
  let far = 0;
  for (let i = 1; i < n; i++) if ((r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2 > (r[far][0] - r[0][0]) ** 2 + (r[far][1] - r[0][1]) ** 2) far = i;
  const e = [...r, r[0]], keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const rec = (a: number, b: number) => {
    const [ax, az] = e[a], [bx, bz] = e[b], L = Math.hypot(bx - ax, bz - az) || 1;
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (az - e[i][1]) - (ax - e[i][0]) * (bz - az)) / L; if (d > md) { md = d; m = i; } }
    if (m >= 0) { keep[m % n] = 1; rec(a, m); rec(m, b); }
  };
  rec(0, far); rec(far, n);
  const out = r.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : r;
}
// Join each hole to its outer ring with a slit from the hole's easternmost point to the nearest
// outer vertex, making one simple (weakly simple) ring.
function bridge(outer: number[][], holes: number[][][]): number[][] {
  let ring = outer;
  for (const h of [...holes].sort((a, b) => Math.max(...b.map((p) => p[0])) - Math.max(...a.map((p) => p[0])))) {
    let hi = 0;
    for (let i = 1; i < h.length; i++) if (h[i][0] > h[hi][0]) hi = i;
    const p = h[hi];
    let oi = 0, od = Infinity;
    for (let i = 0; i < ring.length; i++) { const d = (ring[i][0] - p[0]) ** 2 + (ring[i][1] - p[1]) ** 2 + (ring[i][0] < p[0] ? 1e6 : 0); if (d < od) { od = d; oi = i; } }
    const hr = [...h.slice(hi), ...h.slice(0, hi), p];
    ring = [...ring.slice(0, oi + 1), ...hr, ...ring.slice(oi)];
  }
  return ring;
}

export function waterClaims(t: WaterTile, o: ClaimOpts = {}): WaterClaim[] {
  const buffer = o.buffer ?? 0, tol = o.tolerance ?? 0.6, g = t.g, mg = t.margin, res = g.step;
  const cells = Math.round(t.size / res), B = Math.max(1, Math.round((o.block ?? 200) / res)), out: WaterClaim[] = [];
  for (let bj = 0; bj * B < cells; bj++) for (let bi = 0; bi * B < cells; bi++) {
    const i0 = bi * B, j0 = bj * B, i1 = Math.min(cells, i0 + B), j1 = Math.min(cells, j0 + B);
    // the block's points plus a ring of "just outside" around it, so rings close on the block edge
    const nx = i1 - i0 + 3, nz = j1 - j0 + 3, f = new Float32Array(nx * nz).fill(-1e-3);
    let any = false;
    const kinds = new Set<WaterKind>(), bodies = new Set<string>();
    for (let j = 0; j <= j1 - j0; j++) for (let i = 0; i <= i1 - i0; i++) {
      const k = (mg + j0 + j) * g.nx + mg + i0 + i, v = t.shore[k] + buffer;
      f[(j + 1) * nx + i + 1] = v;
      if (v > 0) { any = true; const kd = KIND_OF[t.nearKind[k]]; if (kd) kinds.add(kd); if (t.body[k] !== 0xffff) bodies.add(t.bodies[t.body[k]]); }
    }
    if (!any) continue;
    const rings = contours(f, nx, nz);
    const X0 = g.x0 + (mg + i0 - 1) * res, Z0 = g.z0 + (mg + j0 - 1) * res;
    const bx0 = g.x0 + (mg + i0) * res, bz0 = g.z0 + (mg + j0) * res, bx1 = g.x0 + (mg + i1) * res, bz1 = g.z0 + (mg + j1) * res;
    // to world, clamped to the block (the outer ring of "just outside" puts edges a hair beyond it)
    const world = rings.map((r) => r.map(([x, z]) => [Math.max(bx0, Math.min(bx1, X0 + x * res)), Math.max(bz0, Math.min(bz1, Z0 + z * res))]));
    const outers = world.filter((r) => area(r) < 0), holes = world.filter((r) => area(r) > 0);
    const polys: XZ[][] = [];
    for (const ob of outers) {
      const mine = holes.filter((h) => inside(h[0], ob));
      // (simplified before bridging, so the slit's two sides stay exactly on top of each other)
      const ring = bridge(simplify(ob, tol), mine.map((h) => simplify(h, tol)));
      polys.push(ring.map(([x, z]) => ({ x, z })));
    }
    if (polys.length) out.push({ key: `water:${t.ti},${t.tj}:${bi},${bj}`, polys, kinds: [...kinds], bodies: [...bodies] });
  }
  return out;
}

// Claim a tile's water in the land registry (and forget any earlier claim for it). The registry's
// Owner type has no 'water' yet: pass the owner to use until it does (see docs/water.md).
export function claimWater(land: Land, t: WaterTile, owner: Owner, o?: ClaimOpts) {
  land.releaseWhere((k) => k.startsWith(`water:${t.ti},${t.tj}:`));
  const cs = waterClaims(t, o);
  for (const c of cs) land.claim(c.key, owner, c.polys);
  return cs;
}
