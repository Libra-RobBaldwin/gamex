// The geometry kit: a tiny mesh builder and a handful of parts (boxes, extruded side profiles,
// cross-section lofts, cylinders, discs and decals) that every vehicle is made from.
// Output is one flat-shaded, non-indexed BufferGeometry per model and level of detail, with:
//   color – baked colour, or a tint multiplied by the instance's livery colour for paint zones
//   vk    – (paint zone, light code, wheel-centre x, wheel-centre y); the centre lets the shader
//           spin wheels, and a wheel's centre height equals its radius because it sits on the ground.
import * as THREE from 'three';
import type { Lod, Zone } from './types';

export type V3 = [number, number, number];
export type P2 = [number, number];
export interface Style { c: V3; zone: Zone; light: number; wheel?: [number, number] }

const tmp = new THREE.Color();
const lin = (h: string): V3 => { tmp.set(h); return [tmp.r, tmp.g, tmp.b]; };

// a baked colour, optionally one of the light codes
export const fixed = (h: string, light = 0): Style => ({ c: lin(h), zone: 0, light });
// a paint zone; tint darkens or lightens the livery colour for panels that should read apart
export const paint = (zone: Zone, tint = 1, light = 0): Style => ({ c: [tint, tint, tint], zone, light });
export const withLight = (s: Style, light: number): Style => ({ ...s, light });
export const asWheel = (s: Style, cx: number, cy: number): Style => ({ ...s, wheel: [cx, cy] });

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const addS = (a: V3, n: V3, s: number): V3 => [a[0] + n[0] * s, a[1] + n[1] * s, a[2] + n[2] * s];
const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export type FaceKey = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';
export type FaceStyles = Partial<Record<FaceKey, Style | null>>;

export interface LoftSect { x: number; sy: number; sz: number; dy: number }
export interface Loft {
  at(seg: number, u: number, j: number, v: number): V3;
  // a decal on the loft surface: between sections seg and seg+1 (u0..u1) and along cross-section edge j (v0..v1)
  patch(seg: number, u0: number, u1: number, j: number, v0: number, v1: number, st: Style, off?: number): void;
}

export class Kit {
  pos: number[] = [];
  col: number[] = [];
  key: number[] = [];
  constructor(public lod: Lod = 0) {}

  get tris() { return this.pos.length / 9; }

  tri(a: V3, b: V3, c: V3, st: Style) {
    this.pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) {
      this.col.push(st.c[0], st.c[1], st.c[2]);
      this.key.push(st.zone, st.light, st.wheel ? st.wheel[0] : 0, st.wheel ? st.wheel[1] : 0);
    }
  }

  // A convex polygon, fanned from its first corner and wound to face `out`.
  face(pts: V3[], out: V3, st: Style) {
    if (pts.length < 3) return;
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    let flip = dot(n, out) < 0;
    // a degenerate first triangle can't tell us the winding; use the polygon's summed normal
    if (Math.abs(dot(n, out)) < 1e-12) {
      let s: V3 = [0, 0, 0];
      for (let i = 1; i < pts.length - 1; i++) { const m = cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0])); s = [s[0] + m[0], s[1] + m[1], s[2] + m[2]]; }
      flip = dot(s, out) < 0;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      if (flip) this.tri(pts[0], pts[i + 1], pts[i], st);
      else this.tri(pts[0], pts[i], pts[i + 1], st);
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3, out: V3, st: Style) { this.face([a, b, c, d], out, st); }

  // An axis-aligned box. The underside is left off unless asked for: nobody sees it.
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, st: Style | null, faces: FaceStyles = {}) {
    const f = (k: FaceKey, def: Style | null) => (k in faces ? faces[k]! : def);
    const px = f('px', st), nx = f('nx', st), py = f('py', st), ny = f('ny', null), pz = f('pz', st), nz = f('nz', st);
    if (px) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], px);
    if (nx) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], nx);
    if (py) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], py);
    if (ny) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], ny);
    if (pz) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], pz);
    if (nz) this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1], nz);
  }
  // a box centred across the vehicle's width
  boxW(x0: number, x1: number, y0: number, y1: number, w: number, st: Style | null, faces: FaceStyles = {}) { this.box(x0, x1, y0, y1, -w / 2, w / 2, st, faces); }

  // A side profile (x, y) extruded across the width. hw is the half-width, optionally varying with
  // height so a greenhouse can lean in (tumblehome). edge(i) styles the face along edge i→i+1.
  prism(poly: P2[], hw: number | ((y: number) => number), cap: Style | null, edge: (i: number) => Style | null, zc = 0) {
    const pts = area(poly) < 0 ? poly.slice().reverse() : poly;
    const map = pts === poly ? (i: number) => i : (i: number) => (poly.length - 2 - i + poly.length) % poly.length;
    const H = typeof hw === 'number' ? () => hw : hw;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const st = edge(map(i));
      if (!st) continue;
      const out: V3 = [b[1] - a[1], -(b[0] - a[0]), 0];
      const ha = H(a[1]), hb = H(b[1]);
      this.quad([a[0], a[1], zc - ha], [b[0], b[1], zc - hb], [b[0], b[1], zc + hb], [a[0], a[1], zc + ha], out, st);
    }
    if (!cap) return;
    const tris = n === 3 ? [[0, 1, 2]] : THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const s of [1, -1]) for (const t of tris) {
      const v = t.map((i) => [pts[i][0], pts[i][1], zc + s * H(pts[i][1])] as V3);
      this.face(v, [0, 0, s], cap);
    }
  }

  // A decal on one face of a prism: along edge i from t0 to t1, across the width from f0 to f1
  // (fractions of the half-width, −1 to 1), lifted off the surface so it never z-fights.
  edgeDecal(poly: P2[], hw: number | ((y: number) => number), i: number, t0: number, t1: number, f0: number, f1: number, st: Style, off = 0.012) {
    const ccw = area(poly) >= 0;
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const H = typeof hw === 'number' ? () => hw : hw;
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    if (!ccw) { nx = -nx; ny = -ny; }
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const P = (t: number, f: number): V3 => {
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      return [x + nx * off, y + ny * off, f * H(y)];
    };
    this.quad(P(t0, f0), P(t1, f0), P(t1, f1), P(t0, f1), [nx, ny, 0], st);
  }

  // A small polygon (round or oval lamp, badge, grille) on a prism face, centred at t along edge i
  // and f across the half-width; rx runs across, ry along the face.
  edgeDisc(poly: P2[], hw: number | ((y: number) => number), i: number, t: number, f: number, rx: number, ry: number, sides: number, st: Style, off = 0.014) {
    const ccw = area(poly) >= 0;
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const H = typeof hw === 'number' ? () => hw : hw;
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    if (!ccw) { nx = -nx; ny = -ny; }
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const ex = (b[0] - a[0]) / l, ey = (b[1] - a[1]) / l; // along the face
    const cx = a[0] + (b[0] - a[0]) * t, cyy = a[1] + (b[1] - a[1]) * t, cz = f * H(cyy);
    const pts: V3[] = [];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2, u = Math.cos(ang) * rx, v = Math.sin(ang) * ry;
      pts.push([cx + ex * v + nx * off, cyy + ey * v + ny * off, cz + u]);
    }
    this.face(pts, [nx, ny, 0], st);
  }

  // A flat polygon (x, y) on the side of the vehicle at ±(hw + off). Pass sgn 0 for both sides.
  side(pts: P2[], hw: number | ((y: number) => number), sgn: 1 | -1 | 0, st: Style, off = 0.012) {
    const H = typeof hw === 'number' ? () => hw : hw;
    for (const s of sgn === 0 ? [1, -1] : [sgn]) {
      const v = pts.map((p) => [p[0], p[1], s * (H(p[1]) + off)] as V3);
      if (pts.length > 4 && !convex(pts)) {
        for (const t of THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), [])) this.face(t.map((i) => v[i]), [0, 0, s], st);
      } else this.face(v, [0, 0, s], st);
    }
  }
  // a rectangle on both sides
  sideRect(x0: number, x1: number, y0: number, y1: number, hw: number | ((y: number) => number), st: Style, sgn: 1 | -1 | 0 = 0, off = 0.012) {
    this.side([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], hw, sgn, st, off);
  }
  // a rectangle on the front (dir 1) or back (dir −1) face at x
  end(x: number, dir: 1 | -1, z0: number, z1: number, y0: number, y1: number, st: Style, off = 0.012) {
    const X = x + dir * off;
    this.quad([X, y0, z0], [X, y0, z1], [X, y1, z1], [X, y1, z0], [dir, 0, 0], st);
  }
  // a rectangle on a horizontal surface at height y
  top(x0: number, x1: number, z0: number, z1: number, y: number, st: Style, off = 0.012) {
    const Y = y + off;
    this.quad([x0, Y, z0], [x0, Y, z1], [x1, Y, z1], [x1, Y, z0], [0, 1, 0], st);
  }

  // A regular polygon in a plane: axis 'x' faces ±x (lamps, buffers), 'y' faces up (roof fans), 'z' sideways.
  disc(c: V3, axis: 'x' | 'y' | 'z', dir: 1 | -1, r: number, sides: number, st: Style, rot = 0) {
    const pts: V3[] = [];
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2, u = Math.cos(a) * r, v = Math.sin(a) * r;
      pts.push(axis === 'x' ? [c[0], c[1] + v, c[2] + u] : axis === 'y' ? [c[0] + u, c[1], c[2] + v] : [c[0] + u, c[1] + v, c[2]]);
    }
    const out: V3 = axis === 'x' ? [dir, 0, 0] : axis === 'y' ? [0, dir, 0] : [0, 0, dir];
    this.face(pts, out, st);
  }

  // A cylinder along z: wheels. Only the caps named are drawn; the tread is always drawn.
  cylZ(x: number, y: number, r: number, z0: number, z1: number, sides: number, tread: Style, cap0: Style | null, cap1: Style | null, rot = Math.PI / sides) {
    const ring = (z: number) => Array.from({ length: sides }, (_, i) => { const a = rot + (i / sides) * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r, z] as V3; });
    const A = ring(z0), B = ring(z1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, a = rot + ((i + 0.5) / sides) * Math.PI * 2;
      this.quad(A[i], A[j], B[j], B[i], [Math.cos(a), Math.sin(a), 0], tread);
    }
    if (cap0) this.face(A, [0, 0, z0 < z1 ? -1 : 1], cap0);
    if (cap1) this.face(B, [0, 0, z1 > z0 ? 1 : -1], cap1);
  }
  // A cylinder along x (tanks, boilers, logs, buffers, engines), elliptical if ry ≠ rz.
  cylX(x0: number, x1: number, y: number, z: number, ry: number, rz: number, sides: number, st: Style, cap0: Style | null, cap1: Style | null, rot = 0) {
    const ring = (x: number) => Array.from({ length: sides }, (_, i) => { const a = rot + (i / sides) * Math.PI * 2; return [x, y + Math.sin(a) * ry, z + Math.cos(a) * rz] as V3; });
    const A = ring(x0), B = ring(x1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, a = rot + ((i + 0.5) / sides) * Math.PI * 2;
      this.quad(A[i], A[j], B[j], B[i], [0, Math.sin(a), Math.cos(a)], st);
    }
    if (cap0) this.face(A, [x0 < x1 ? -1 : 1, 0, 0], cap0);
    if (cap1) this.face(B, [x1 > x0 ? 1 : -1, 0, 0], cap1);
  }
  // A vertical cylinder or cone (chimneys, domes, beacons, ice-cream cones); r1 is the top radius.
  cylY(x: number, z: number, y0: number, y1: number, r0: number, r1: number, sides: number, st: Style, capTop: Style | null) {
    const ring = (y: number, r: number) => Array.from({ length: sides }, (_, i) => { const a = (i / sides) * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r] as V3; });
    const A = ring(y0, r0), B = ring(y1, r1);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, a = ((i + 0.5) / sides) * Math.PI * 2;
      if (r1 < 1e-4) this.face([A[i], A[j], B[i]], [Math.cos(a), 0.3, Math.sin(a)], st);
      else this.quad(A[i], A[j], B[j], B[i], [Math.cos(a), 0, Math.sin(a)], st);
    }
    if (capTop && r1 > 1e-4) this.face(B, [0, 1, 0], capTop);
  }

  // A cross-section (z, y) swept along x through a list of sections, each scaling and lifting the
  // section. Rail vehicles, bus and coach roofs, boat hulls and fuselages are all lofts, and a
  // tapering run of sections makes a nose. edge(j, seg) styles the band along section edge j.
  loftX(cs: P2[], sects: LoftSect[], edge: (j: number, seg: number) => Style | null, capBack: Style | null, capFront: Style | null): Loft {
    const n = cs.length;
    const cy = cs.reduce((s, p) => s + p[1], 0) / n;
    const P = (s: LoftSect, p: P2): V3 => [s.x, s.dy + p[1] * s.sy, p[0] * s.sz];
    for (let k = 0; k < sects.length - 1; k++) {
      const s0 = sects[k], s1 = sects[k + 1];
      for (let j = 0; j < n; j++) {
        const st = edge(j, k);
        if (!st) continue;
        const a = cs[j], b = cs[(j + 1) % n];
        const q: V3[] = [P(s0, a), P(s0, b), P(s1, b), P(s1, a)];
        const mid = mix(mix(q[0], q[1], 0.5), mix(q[2], q[3], 0.5), 0.5);
        const axis: V3 = [mid[0], (s0.dy + s1.dy) / 2 + cy * (s0.sy + s1.sy) / 2, 0];
        this.face(q, sub(mid, axis), st);
      }
    }
    const capAt = (s: LoftSect, dir: number, st: Style) => this.face(cs.map((p) => P(s, p)), [dir, 0, 0], st);
    const first = sects[0], last = sects[sects.length - 1];
    const fwd = last.x >= first.x ? 1 : -1;
    if (capBack) capAt(first, -fwd, capBack);
    if (capFront) capAt(last, fwd, capFront);
    const at = (seg: number, u: number, j: number, v: number): V3 => {
      const s0 = sects[seg], s1 = sects[seg + 1];
      const a = cs[j], b = cs[(j + 1) % n];
      const e0 = mix(P(s0, a), P(s0, b), v), e1 = mix(P(s1, a), P(s1, b), v);
      return mix(e0, e1, u);
    };
    const kit = this;
    return {
      at,
      patch(seg, u0, u1, j, v0, v1, st, off = 0.012) {
        const q: V3[] = [at(seg, u0, j, v0), at(seg, u1, j, v0), at(seg, u1, j, v1), at(seg, u0, j, v1)];
        const mid = mix(mix(q[0], q[1], 0.5), mix(q[2], q[3], 0.5), 0.5);
        const s0 = sects[seg], s1 = sects[seg + 1];
        const axis: V3 = [mid[0], (s0.dy + s1.dy) / 2 + cy * (s0.sy + s1.sy) / 2, 0];
        let nrm = unit(cross(sub(q[1], q[0]), sub(q[3], q[0])));
        if (dot(nrm, sub(mid, axis)) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
        kit.face(q.map((p) => addS(p, nrm, off)), nrm, st);
      },
    };
  }

  // Copy another kit in, moved by (dx, dy, dz) and optionally turned end for end. Wheel spin is
  // dropped: the copied parts are a load (cars on a transporter), not running gear.
  add(k: Kit, dx: number, dy: number, dz: number, flip = false, scale = 1) {
    for (let i = 0; i < k.pos.length; i += 9) {
      const v: V3[] = [];
      for (let j = 0; j < 3; j++) {
        const x = k.pos[i + j * 3] * scale, y = k.pos[i + j * 3 + 1] * scale, z = k.pos[i + j * 3 + 2] * scale;
        v.push(flip ? [-x + dx, y + dy, -z + dz] : [x + dx, y + dy, z + dz]);
      }
      this.pos.push(...v[0], ...v[1], ...v[2]);
    }
    this.col.push(...k.col);
    for (let i = 0; i < k.key.length; i += 4) this.key.push(k.key[i], k.key[i + 1], 0, 0);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos);
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const a: V3 = [pos[i], pos[i + 1], pos[i + 2]], b: V3 = [pos[i + 3], pos[i + 4], pos[i + 5]], c: V3 = [pos[i + 6], pos[i + 7], pos[i + 8]];
      const n = unit(cross(sub(b, a), sub(c, a)));
      for (let j = 0; j < 3; j++) nrm.set(n, i + j * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('vk', new THREE.BufferAttribute(new Float32Array(this.key), 4));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// Clip a polygon to the rectangle x0..x1, y0..y1 (Sutherland–Hodgman): used to cut stripes,
// two-tone bands and livery blocks out of a side profile so they always fit the body.
export function clip(poly: P2[], x0: number, x1: number, y0: number, y1: number): P2[] {
  let out = poly;
  const edges: [(p: P2) => number, number][] = [[(p) => p[0] - x0, 0], [(p) => x1 - p[0], 0], [(p) => p[1] - y0, 1], [(p) => y1 - p[1], 1]];
  for (const [inside] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], da = inside(a), db = inside(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (!out.length) return out;
  }
  return out;
}

export function area(p: P2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; }
  return a / 2;
}
function convex(p: P2[]) {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

// Common baked colours.
export const C = {
  glass: fixed('#26323c', 6), glassDark: fixed('#1a2127', 6), glassPlain: fixed('#2c3944'),
  tyre: fixed('#19191b'), hub: fixed('#a3a8ad'), hubDark: fixed('#4a4d52'), steelWheel: fixed('#6d7176'),
  chrome: fixed('#d9dde0'), trim: fixed('#232427'), grille: fixed('#2a2c2f'), chassis: fixed('#242528'),
  arch: fixed('#141416'), interior: fixed('#3b3631'), seat: fixed('#4a3a30'), hood: fixed('#222326'),
  head: fixed('#f4f1e0', 1), tail: fixed('#8a1a16', 2), brake: fixed('#8a1a16', 3), indL: fixed('#d9861c', 4), indR: fixed('#d9861c', 5),
  plateF: fixed('#f2f2ee'), plateR: fixed('#f0c419'), beaconBlue: fixed('#2a4fd0', 7), beaconAmber: fixed('#e09a1c', 8), sign: fixed('#f2c14a', 9),
  bogie: fixed('#2b2c2e'), buffer: fixed('#3a3c3f'), rail: fixed('#55585c'), roofGrey: fixed('#6e7378'), pantograph: fixed('#3c3f43'),
  wood: fixed('#8a6a45'), logs: fixed('#7a5a3a'), logEnd: fixed('#c9a878'), aggregate: fixed('#8d8578'), coal: fixed('#2a2a2c'),
  deck: fixed('#6b5a48'), rubber: fixed('#2e2f31'), white: fixed('#f2f2f0'), red: fixed('#b8322b'), water: fixed('#2a4a5a'),
  hull: fixed('#2b2f33'), antifoul: fixed('#8a2d24'), canvas: fixed('#6b7058'),
};
