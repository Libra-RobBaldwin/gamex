// A small geometry kit for industrial sites, in the style of buildgen.ts's Kit: flat-shaded,
// non-indexed triangles appended into one buffer, drawn inside nested local frames. It differs
// in one way on purpose: every colour is a vertex colour, with no canvas textures. A whole site
// is then one mesh and one draw call, it merges straight into the town's chunks, and it builds
// under Node, so the tests can count triangles and compare seeds without a browser.
// (buildgen's Kit isn't exported, and it mustn't be edited from here, so this is a local copy of
// the few helpers industry needs, plus the shapes buildings don't: lathes, heaps, trusses.)
import * as THREE from 'three';

export type XZ = [number, number];
export type V3 = [number, number, number];

const colCache = new Map<string, THREE.Color>();
export function colour(hex: string) {
  let c = colCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colCache.set(hex, c); }
  return c;
}
export const shadeHex = (hex: string, f: number) => {
  const c = colour(hex).clone().multiplyScalar(f);
  return `#${c.getHexString()}`;
};

// One shared material: plain vertex colours, lit, cast and receive shadows like the town.
export const SITE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

// A footprint rectangle, ordered front-left, front-right, back-right, back-left (+z is the front).
export const rect = (cx: number, cz: number, w: number, d: number): XZ[] => [[cx - w / 2, cz + d / 2], [cx + w / 2, cz + d / 2], [cx + w / 2, cz - d / 2], [cx - w / 2, cz - d / 2]];

export function polyArea(pts: XZ[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

// Ear clipping, enough for the handful of vertices a plot or yard has. Returns index triples.
export function triangulate(pts: XZ[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  const idx = [...Array(n).keys()];
  if (polyArea(pts) < 0) idx.reverse();
  const out: [number, number, number][] = [];
  const cross = (a: XZ, b: XZ, c: XZ) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: XZ, a: XZ, b: XZ, c: XZ) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      if (cross(a, b, c) <= 1e-9) continue;
      if (idx.some((j) => j !== ia && j !== ib && j !== ic && inside(pts[j], a, b, c))) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break; // degenerate outline: give up on what's left rather than loop
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

export class Kit {
  p: number[] = [];
  n: number[] = [];
  c: number[] = [];
  top = 0;
  private col = colour('#ffffff');
  private frames: { ox: number; oz: number; c: number; s: number }[] = [];

  get tris() { return this.p.length / 9; }
  paint(hex: string) { this.col = colour(hex); return this; }
  T(x: number, y: number, z: number): V3 {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      [x, z] = [f.ox + x * f.c + z * f.s, f.oz - x * f.s + z * f.c];
    }
    if (y > this.top) this.top = y;
    return [x, y, z];
  }
  // draw inside a local frame, offset and turned about the vertical axis (same sense as buildgen)
  at(ox: number, oz: number, ry: number, fn: () => void) {
    this.frames.push({ ox, oz, c: Math.cos(ry), s: Math.sin(ry) });
    fn();
    this.frames.pop();
  }
  // world-space triangle (already transformed)
  private raw(a: V3, b: V3, c: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    nx /= L; ny /= L; nz /= L;
    this.p.push(...a, ...b, ...c);
    const { r, g, b: bl } = this.col;
    for (let i = 0; i < 3; i++) { this.n.push(nx, ny, nz); this.c.push(r, g, bl); }
  }
  tri(a: V3, b: V3, c: V3) { this.raw(this.T(...a), this.T(...b), this.T(...c)); }
  quad(a: V3, b: V3, c: V3, d: V3) { this.tri(a, b, c); this.tri(a, c, d); }

  // A flat patch at height y, facing up whichever way the outline winds (ground, yards, water).
  flat(pts: XZ[], y: number, hex?: string) {
    if (hex) this.paint(hex);
    // triangulate() hands back anticlockwise triples in (x, z), which face down; emit them reversed
    for (const [a, b, c] of triangulate(pts)) this.tri([pts[a][0], y, pts[a][1]], [pts[c][0], y, pts[c][1]], [pts[b][0], y, pts[b][1]]);
  }
  // Vertical walls along a path.
  walls(pts: XZ[], closed: boolean, y0: number, y1: number) {
    const E = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < E; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      this.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]);
    }
  }
  // A box standing on y0. Bottoms are never seen from a top-down camera, so they're left off.
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, hex?: string, top = true) {
    if (hex) this.paint(hex);
    const r = rect(cx, cz, w, d);
    this.walls(r, true, y0, y0 + h);
    if (top) this.flat(r, y0 + h);
  }
  // A box between two points in plan at a fixed height band (fences, rails, conveyor trusses).
  beam(x0: number, z0: number, x1: number, z1: number, y0: number, h: number, w: number, hex?: string, y1 = y0) {
    if (hex) this.paint(hex);
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-6) return;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz * (w / 2), nz = ux * (w / 2);
    const A: V3 = [x0 + nx, y0, z0 + nz], B: V3 = [x1 + nx, y1, z1 + nz], C: V3 = [x1 - nx, y1, z1 - nz], D: V3 = [x0 - nx, y0, z0 - nz];
    const up = (v: V3): V3 => [v[0], v[1] + h, v[2]];
    this.quad(D, A, up(A), up(D)); this.quad(B, C, up(C), up(B));
    this.quad(C, D, up(D), up(C)); this.quad(A, B, up(B), up(A));
    this.quad(up(A), up(B), up(C), up(D));
  }
  // Regular n-gon prism or frustum (r1 at the top); cone when r1 = 0.
  prism(x: number, z: number, r0: number, n: number, y0: number, h: number, hex?: string, r1 = r0, cap = true) {
    if (hex) this.paint(hex);
    const ring = (r: number): XZ[] => { const o: XZ[] = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; o.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return o; };
    const A = ring(r0), B = ring(r1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (r1 < 1e-4) this.tri([A[j][0], y0, A[j][1]], [A[i][0], y0, A[i][1]], [x, y0 + h, z]);
      else this.quad([A[j][0], y0, A[j][1]], [A[i][0], y0, A[i][1]], [B[i][0], y0 + h, B[i][1]], [B[j][0], y0 + h, B[j][1]]);
    }
    if (cap && r1 > 1e-4) this.flat(B, y0 + h);
  }
  // Surface of revolution from a profile of [radius, height] pairs, bottom to top. Cooling towers,
  // kilns and domes. Open at the top so steam towers read as hollow from above.
  // With `inner` set it is hollow: the inside walls are drawn too, in that (darker) colour, so
  // looking down into a tank or a cooling tower shows its far wall rather than the ground.
  lathe(x: number, z: number, profile: [number, number][], n: number, hex?: string, inner?: string) {
    const ring = (i: number, r: number, y: number): V3 => { const a = (i / n) * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; };
    for (const pass of inner ? [0, 1] : [0]) {
      if (pass === 0 && hex) this.paint(hex);
      if (pass === 1) this.paint(inner!);
      for (let k = 0; k + 1 < profile.length; k++) {
        const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
        for (let i = 0; i < n; i++) {
          const A = ring(i + 1, r0, y0), B = ring(i, r0, y0), C = ring(i, r1, y1), D = ring(i + 1, r1, y1);
          if (pass === 0) this.quad(A, B, C, D); else this.quad(B, A, D, C);
        }
      }
    }
  }
  // Gable roof, ridge along x. The triangular ends are painted like the walls below.
  gable(cx: number, cz: number, w: number, d: number, y0: number, rise: number, roof: string, end: string, over = 0.3) {
    const x0 = cx - w / 2 - over, x1 = cx + w / 2 + over, zf = cz + d / 2 + over, zb = cz - d / 2 - over, top = y0 + rise;
    this.paint(roof);
    this.quad([x0, y0, zf], [x1, y0, zf], [x1, top, cz], [x0, top, cz]);
    this.quad([x1, y0, zb], [x0, y0, zb], [x0, top, cz], [x1, top, cz]);
    this.paint(end);
    const xl = cx - w / 2, xr = cx + w / 2;
    this.tri([xl, y0, cz + d / 2], [xl, top, cz], [xl, y0, cz - d / 2]);
    this.tri([xr, y0, cz - d / 2], [xr, top, cz], [xr, y0, cz + d / 2]);
  }
  // A long mound with sloping ends (spoil heaps, static stockpile bases, earth banks).
  mound(cx: number, cz: number, w: number, d: number, h: number, hex?: string, ridge = 0.35) {
    if (hex) this.paint(hex);
    const tw = w * ridge, td = Math.max(0.01, d * 0.12);
    const B = rect(cx, cz, w, d), U = rect(cx, cz, tw, td);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad([B[i][0], 0, B[i][1]], [B[j][0], 0, B[j][1]], [U[j][0], h, U[j][1]], [U[i][0], h, U[i][1]]);
    }
    this.flat(U, h);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
  build() {
    const mesh = new THREE.Mesh(this.toGeometry(), SITE_MAT);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }
}
