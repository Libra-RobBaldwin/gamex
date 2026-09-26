// Woods drawn as woods: over each wood, a canopy of crowns as one low-poly, flat-shaded surface,
// lumpy where the trees are broadleaved and spiky in a conifer plantation, rising from the ground at
// the wood's edge. It's the cheap way to draw a lot of trees: a tile's woods are a few thousand
// triangles where instanced trees would be hundreds of thousands, it goes into the tile's one
// vertex-coloured mesh (no draw call of its own), and it reads as woodland from right out to close
// in, where the trees along the woods' edges (`fringe`) stand out of it.
//
// The canopy's outline is the cover map's woodland weight (it falls from 1 to 0 over the last 6 m
// to the wood's edge, and to nothing across a road or where the town is), so it follows the painted
// wood exactly. Grids: crowns on a 4 m grid close in; smoother lumps on coarser grids further out.
// Heights are above the ground: the drape (drape.ts) puts them on the hills like everything else.
// Where the canopy meets the ground it goes down steeply into it (the points just outside a wood
// are sunk a metre and more), so the two cross at an angle and never fight.
//
// Pure: no three.js, no DOM (it runs in the tile workers).
import type { Layout, XZ } from './layout';
import { hash2 } from './noise';

type Box = { x0: number; z0: number; x1: number; z1: number };
export interface CanopyLook { broadleaf: string; conifer: string }
export interface CanopyArrays { pos: Float32Array; nor: Float32Array; col: Float32Array; idx: Uint32Array }
// a cover map: RGBA bytes, n × n texels over a square from (x0, z0), `size` metres across
export interface CoverData { a: Uint8Array; x0: number; z0: number; size: number; n: number }

const SUNK = -1.4;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x: number, z: number, s: number, seed: number) {
  const gx = x / s, gz = z / s, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j, seed) + (hash2(i + 1, j, seed) - hash2(i, j, seed)) * u;
  const b = hash2(i, j + 1, seed) + (hash2(i + 1, j + 1, seed) - hash2(i, j + 1, seed)) * u;
  return a + (b - a) * v;
}
// The crown nearest a point: crowns stand on a jittered grid (9 m apart, 5.5 in a plantation);
// `dome` is 1 at a crown's middle and 0 past its rim.
const out = { dome: 0, size: 0, id: 0 };
function crownAt(x: number, z: number, conifer: boolean) {
  const S = conifer ? 5.5 : 9, ci = Math.floor(x / S), cj = Math.floor(z / S);
  out.dome = 0; out.size = 0; out.id = 0;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const i = ci + di, j = cj + dj, cx = (i + 0.2 + hash2(i, j, 61) * 0.6) * S, cz = (j + 0.2 + hash2(i, j, 62) * 0.6) * S;
    const sz = hash2(i, j, 63), r = S * (0.62 + 0.3 * sz), d = Math.hypot(x - cx, z - cz) / r;
    if (d >= 1) continue;
    const dome = conifer ? 1 - d : Math.sqrt(1 - d * d);
    if (dome > out.dome) { out.dome = dome; out.size = sz; out.id = (i * 7919 + j * 104729) >>> 0; }
  }
  return out;
}
// sRGB hex → linear, shaded in HSL a little (from above, crowns are darker than a tree's lit side, and vary tree to tree)
function lin(v: number) { return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
function shades(hex: string, ks: number[]): [number, number, number][] {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return ks.map((k) => [lin(r * k), lin(g * k), lin(b * k)]);
}
const looks = new Map<string, { broad: [number, number, number][]; conifer: [number, number, number][] }>();

// the cover map's woodland weight at a point (bilinear between texel centres)
export function woodAt(c: CoverData, x: number, z: number) {
  const t = c.size / c.n, n = c.n, a = c.a;
  const gx = (x - c.x0) / t - 0.5, gz = (z - c.z0) / t - 0.5, i = Math.max(0, Math.min(n - 2, Math.floor(gx))), j = Math.max(0, Math.min(n - 2, Math.floor(gz)));
  const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
  const w = (ii: number, jj: number) => Math.max(0, (a[(jj * n + ii) * 4 + 2] - 127.5) / 127.5);
  return (w(i, j) * (1 - fx) + w(i + 1, j) * fx) * (1 - fz) + (w(i, j + 1) * (1 - fx) + w(i + 1, j + 1) * fx) * fz;
}

// The canopy over a box, on a grid of `g` metres (crowns at 4 m or finer), or null if there's no
// wood in it. `own` says which grid squares are this box's to draw (by their middles: neighbouring
// tiles then meet without drawing a square twice).
export function canopy(layout: Layout, cover: CoverData, box: Box, g: number, look: CanopyLook, own: (p: XZ) => boolean = () => true): CanopyArrays | null {
  const P = layout.plan;
  let cols = looks.get(look.broadleaf + look.conifer);
  if (!cols) looks.set(look.broadleaf + look.conifer, (cols = { broad: shades(look.broadleaf, [0.62, 0.72, 0.8]), conifer: shades(look.conifer, [0.62, 0.72]) }));
  const X0 = Math.floor(box.x0 / g) * g, Z0 = Math.floor(box.z0 / g) * g;
  const nx = Math.ceil((box.x1 - X0) / g) + 1, nz = Math.ceil((box.z1 - Z0) / g) + 1;
  // which grid points are in a wood (0: no; 1: broadleaf; 2: conifer)
  const kind = new Uint8Array(nx * nz);
  let any = false;
  layout.ensure(box);
  for (const f of P.fieldsNear(box)) {
    const inf = layout.about(f);
    if (inf.kind !== 'wood') continue;
    const b = P.boxes[f], v = inf.conifer ? 2 : 1;
    const ia = Math.max(0, Math.ceil((b.x0 - X0) / g)), ib = Math.min(nx - 1, Math.floor((b.x1 - X0) / g));
    const ja = Math.max(0, Math.ceil((b.z0 - Z0) / g)), jb = Math.min(nz - 1, Math.floor((b.z1 - Z0) / g));
    for (let jj = ja; jj <= jb; jj++) for (let ii = ia; ii <= ib; ii++) if (P.fieldAt(X0 + ii * g, Z0 + jj * g) === f) { kind[jj * nx + ii] = v; any = true; }
  }
  if (!any) return null;
  // heights: the crowns' lumpy top, brought down to the ground over the wood's last few metres
  const N = nx * nz, hgt = new Float32Array(N).fill(SUNK), shade = new Float32Array(N), crown = new Uint32Array(N);
  for (let q = 0; q < N; q++) {
    const kd = kind[q];
    if (!kd) continue;
    const x = X0 + (q % nx) * g, z = Z0 + Math.floor(q / nx) * g;
    const e = smooth(0.2, 1, woodAt(cover, x, z)) * (0.72 + 0.28 * vnoise(x, z, 17, 55)); // (the edge's trees stand at all heights)
    if (e <= 0) continue;
    let top: number, s: number;
    if (g <= 5) {
      // crowns: domes round jittered points (a spire each in a plantation), with dark gaps between
      const c = crownAt(x, z, kd === 2);
      s = c.dome;
      top = (kd === 2 ? 12 + c.size * 2 + c.dome * 4 : 9 + c.size * 2.4 + c.dome * 2.8) + vnoise(x, z, 70, 53) * 2;
      crown[q] = c.id;
    } else {
      s = vnoise(x, z, g * 2.5, 51);
      top = (kd === 2 ? 13.5 : 10) + vnoise(x, z, 70, 53) * 2.5 + s * (g < 12 ? 3.2 : 1.6);
      crown[q] = Math.floor(vnoise(x, z, 25, 54) * 97);
    }
    hgt[q] = SUNK + (top - SUNK) * e;
    shade[q] = s * e; // (the wood's edge, going down into the ground, in the shade under the crowns)
  }
  // the triangles, each with its own face normal and colour (flat shaded): each grid square with a
  // corner up in the canopy (its sunk corners take it into the ground)
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const colOf = (q: number): [number, number, number] => {
    const kd = kind[q] || 1, set = kd === 2 ? cols!.conifer : cols!.broad, c = set[crown[q] % set.length], k = (kd === 2 ? 0.72 : 0.66) + 0.4 * shade[q] + 0.12 * ((crown[q] >>> 3) % 5) / 4;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  const tri = (a: number, b: number, c: number) => {
    const P3 = [a, b, c].map((q) => [X0 + (q % nx) * g, hgt[q], Z0 + Math.floor(q / nx) * g]);
    const ux = P3[1][0] - P3[0][0], uy = P3[1][1] - P3[0][1], uz = P3[1][2] - P3[0][2], vx = P3[2][0] - P3[0][0], vy = P3[2][1] - P3[0][1], vz = P3[2][2] - P3[0][2];
    let n0 = uy * vz - uz * vy, n1 = uz * vx - ux * vz, n2 = ux * vy - uy * vx;
    const L = Math.hypot(n0, n1, n2) || 1; n0 /= L; n1 /= L; n2 /= L;
    // (the colour of the highest corner: its crown)
    const top = [a, b, c].reduce((m, q) => (hgt[q] > hgt[m] ? q : m), a), cc = colOf(top);
    for (const p of P3) { idx.push(pos.length / 3); pos.push(p[0], p[1], p[2]); nor.push(n0, n1, n2); col.push(cc[0], cc[1], cc[2]); }
  };
  for (let jj = 0; jj + 1 < nz; jj++) for (let ii = 0; ii + 1 < nx; ii++) {
    const q00 = jj * nx + ii, q10 = q00 + 1, q01 = q00 + nx, q11 = q01 + 1;
    if (hgt[q00] <= 0 && hgt[q10] <= 0 && hgt[q01] <= 0 && hgt[q11] <= 0) continue;
    if (!own({ x: X0 + (ii + 0.5) * g, z: Z0 + (jj + 0.5) * g })) continue;
    // (anticlockwise seen from above, with y up)
    tri(q00, q01, q10); tri(q10, q01, q11);
  }
  if (!idx.length) return null;
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), col: new Float32Array(col), idx: new Uint32Array(idx) };
}

// Trees along the woods' edges, one every `spacing` metres or so, 3 m in: they stand out of the
// canopy close up. x, z, scale, kind (0 broadleaf, 1 conifer) per tree, for those `own` says are the box's.
export function fringe(layout: Layout, cover: CoverData, box: Box, spacing: number, own: (p: XZ) => boolean = () => true): Float32Array {
  const P = layout.plan, out: number[] = [];
  layout.ensure(box);
  for (const n of P.linesNear(box)) {
    const [p, q] = layout.sides(n);
    if ((p === 'wood') === (q === 'wood')) continue;
    const l = P.lines[n], len = Math.hypot(l.b.x - l.a.x, l.b.z - l.a.z), ux = (l.b.x - l.a.x) / len, uz = (l.b.z - l.a.z) / len;
    const side = p === 'wood' ? 1 : -1, nx = -uz * side, nz = ux * side; // (towards the wood)
    const ls = (Math.round(l.a.x) * 31 + Math.round(l.a.z) * 17 + Math.round(l.b.x) * 7 + Math.round(l.b.z)) | 0;
    for (let d = spacing * hash2(ls, 1, 71); d < len; d += spacing * (0.6 + 0.8 * hash2(ls, Math.round(d), 72))) {
      const r = hash2(ls, Math.round(d), 73), off = 2.6 + r * 2.4, x = l.a.x + ux * d + nx * off, z = l.a.z + uz * d + nz * off;
      if (x < cover.x0 || z < cover.z0 || x > cover.x0 + cover.size || z > cover.z0 + cover.size || !own({ x, z })) continue;
      const f = layout.fieldAt(x, z);
      if (f < 0 || woodAt(cover, x, z) < 0.45) continue;
      const inf = layout.about(f);
      if (inf.kind !== 'wood') continue;
      out.push(x, z, 1 + r * 0.5, inf.conifer ? 1 : 0);
    }
  }
  return new Float32Array(out);
}
