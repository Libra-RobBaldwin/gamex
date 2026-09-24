// Low-poly bodies, built once and shared by every figure. Each vertex carries the part it
// belongs to (a hip, a shin, a hat brim...), which is all the vertex shader needs to pose
// it: parts swing about fixed joints, and hats, hair and skirts are reshaped per figure.
// Faces nobody sees from the game's camera (under a foot, the top of a thigh inside the
// hips) are left out.
import * as THREE from 'three';

// Part ids, shared with the shaders.
export const P = {
  Hips: 0, Chest: 1, Head: 2, Hair: 3, ThighL: 4, ThighR: 5, ShinL: 6, ShinR: 7, ArmL: 8, ArmR: 9,
  Crown: 10, Brim: 11, Bag: 12, Pack: 13, Umbrella: 14, Stick: 15,
  // middle distance: fewer, merged parts
  Body: 16, HeadM: 17, LegL: 18, LegR: 19,
  // far: one flat card
  Card: 20,
} as const;
export const A = { Body: 0, Head: 1, Snout: 2, EarL: 3, EarR: 4, LegFL: 5, LegFR: 6, LegBL: 7, LegBR: 8, Tail: 9, Lead: 10 } as const;
export const B = { Body: 0, Head: 1, Tail: 2, WingL: 3, WingR: 4, Beak: 5 } as const;
export const Q = { Frame: 0, Wheel: 1, Seat: 2, Bar: 3, Dark: 4 } as const;

const NO_BOTTOM = 1, NO_TOP = 2;
class Builder {
  pos: number[] = []; nrm: number[] = []; part: number[] = []; idx: number[] = [];
  private quad(a: number[], b: number[], c: number[], d: number[], n: number[], p: number) {
    const i = this.pos.length / 3;
    for (const v of [a, b, c, d]) { this.pos.push(v[0], v[1], v[2]); this.nrm.push(n[0], n[1], n[2]); this.part.push(p); }
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  tri(a: number[], b: number[], c: number[], p: number) {
    const i = this.pos.length / 3;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const q of [a, b, c]) { this.pos.push(q[0], q[1], q[2]); this.nrm.push(n[0] / l, n[1] / l, n[2] / l); this.part.push(p); }
    this.idx.push(i, i + 1, i + 2);
  }
  // A box from y0 to y1, centred on (cx, cz), bottom half-size (bx, bz), top half-size (tx, tz),
  // with the top shifted forward by dz. Side normals are left horizontal (it's low-poly).
  box(p: number, cx: number, cz: number, y0: number, y1: number, bx: number, bz: number, tx = bx, tz = bz, flags = NO_BOTTOM, dz = 0) {
    const b = (sx: number, sz: number) => [cx + sx * bx, y0, cz + sz * bz];
    const t = (sx: number, sz: number) => [cx + sx * tx, y1, cz + dz + sz * tz];
    this.quad(b(-1, 1), b(1, 1), t(1, 1), t(-1, 1), [0, 0, 1], p); // front (+z)
    this.quad(b(1, -1), b(-1, -1), t(-1, -1), t(1, -1), [0, 0, -1], p);
    this.quad(b(1, 1), b(1, -1), t(1, -1), t(1, 1), [1, 0, 0], p);
    this.quad(b(-1, -1), b(-1, 1), t(-1, 1), t(-1, -1), [-1, 0, 0], p);
    if (!(flags & NO_TOP)) this.quad(t(-1, 1), t(1, 1), t(1, -1), t(-1, -1), [0, 1, 0], p);
    if (!(flags & NO_BOTTOM)) this.quad(b(-1, -1), b(1, -1), b(1, 1), b(-1, 1), [0, -1, 0], p);
  }
  // A box between two points along z (for bike frames, leads): square section of half-size h.
  bar(p: number, a: number[], b: number[], h: number) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
    const f = [d[0] / L, d[1] / L, d[2] / L];
    let s = [f[2], 0, -f[0]];
    if (Math.hypot(s[0], s[2]) < 1e-3) s = [1, 0, 0];
    const sl = Math.hypot(s[0], s[1], s[2]); s = [s[0] / sl, s[1] / sl, s[2] / sl];
    const u = [f[1] * s[2] - f[2] * s[1], f[2] * s[0] - f[0] * s[2], f[0] * s[1] - f[1] * s[0]];
    const c = (o: number[], i: number, j: number) => [o[0] + (s[0] * i + u[0] * j) * h, o[1] + (s[1] * i + u[1] * j) * h, o[2] + (s[2] * i + u[2] * j) * h];
    const faces: [number, number, number, number, number[]][] = [[1, 1, -1, 1, u], [-1, -1, 1, -1, u.map((x) => -x)], [1, -1, 1, 1, s], [-1, 1, -1, -1, s.map((x) => -x)]];
    for (const [i0, j0, i1, j1, n] of faces) this.quad(c(a, i0, j0), c(a, i1, j1), c(b, i1, j1), c(b, i0, j0), n, p);
  }
  // A thin wheel: an n-sided ring in the y–z plane at x, seen from the side and from above.
  wheel(p: number, x: number, cy: number, cz: number, R: number, w: number, n = 6) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const o = (a: number, r: number, dx: number) => [x + dx, cy + Math.sin(a) * r, cz + Math.cos(a) * r];
      const am = (a0 + a1) / 2;
      this.quad(o(a0, R, -w), o(a0, R, w), o(a1, R, w), o(a1, R, -w), [0, Math.sin(am), Math.cos(am)], p);
      this.quad(o(a1, R, w), o(a0, R, w), o(a0, R * 0.8, w), o(a1, R * 0.8, w), [1, 0, 0], p);
      this.quad(o(a0, R, -w), o(a1, R, -w), o(a1, R * 0.8, -w), o(a0, R * 0.8, -w), [-1, 0, 0], p);
    }
  }
  geometry() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setIndex(this.idx);
    g.instanceCount = 0;
    return g;
  }
}

// Joints and sizes of a 1.75 m adult; the shader scales to each figure's height.
export const BODY = {
  hipY: 0.86, hipX: 0.09, kneeY: 0.47, shoulderY: 1.39, shoulderX: 0.235, neckY: 1.45, handY: 0.76,
};

// Near: about 150 triangles with every optional part; a figure without a hat, bag or umbrella
// shows 90–110 (the rest collapse to nothing in the shader).
export function personNear() {
  const b = new Builder();
  b.box(P.Hips, 0, 0, 0.8, 1.02, 0.17, 0.105, 0.17, 0.11);
  b.box(P.Chest, 0, 0, 1.0, 1.44, 0.165, 0.105, 0.2, 0.115);
  b.box(P.Head, 0, 0.01, 1.46, 1.72, 0.09, 0.1, 0.095, 0.105);
  b.box(P.Hair, 0, -0.025, 1.58, 1.755, 0.105, 0.095, 0.105, 0.1);
  for (const [p, x] of [[P.ThighL, BODY.hipX], [P.ThighR, -BODY.hipX]] as const) b.box(p, x, 0, 0.46, 0.9, 0.06, 0.068, 0.07, 0.075, NO_BOTTOM | NO_TOP);
  // shins end in a shoe that points forward
  for (const [p, x] of [[P.ShinL, BODY.hipX], [P.ShinR, -BODY.hipX]] as const) b.box(p, x, 0.035, 0, 0.49, 0.055, 0.095, 0.052, 0.055, NO_BOTTOM | NO_TOP, -0.035);
  for (const [p, x] of [[P.ArmL, BODY.shoulderX], [P.ArmR, -BODY.shoulderX]] as const) b.box(p, x, 0, 0.74, 1.44, 0.042, 0.048, 0.055, 0.06, 0);
  b.box(P.Crown, 0, 0, 1.7, 1.82, 0.105, 0.115);
  b.box(P.Brim, 0, 0, 1.7, 1.72, 0.165, 0.175);
  b.box(P.Bag, -BODY.shoulderX - 0.01, 0, 0.5, 0.76, 0.035, 0.14);
  b.box(P.Pack, 0, -0.19, 1.06, 1.4, 0.14, 0.07, 0.13, 0.065);
  // umbrella: a six-sided canopy over the raised right hand
  const n = 6, apex = [0, 2.16, 0.12];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    b.tri(apex, [Math.cos(a1) * 0.55, 1.97, 0.12 + Math.sin(a1) * 0.55], [Math.cos(a0) * 0.55, 1.97, 0.12 + Math.sin(a0) * 0.55], P.Umbrella);
  }
  b.box(P.Stick, -0.27, 0.16, 0, 0.8, 0.012, 0.012, 0.012, 0.012, NO_BOTTOM | NO_TOP);
  return b.geometry();
}

// Middle distance: one body, one head (hair drawn on its top), two legs, a hat, the umbrella.
export function personMid() {
  const b = new Builder();
  b.box(P.Body, 0, 0, 0.8, 1.44, 0.17, 0.105, 0.2, 0.115);
  b.box(P.HeadM, 0, 0, 1.46, 1.74, 0.095, 0.105);
  for (const [p, x] of [[P.LegL, BODY.hipX], [P.LegR, -BODY.hipX]] as const) b.box(p, x, 0.01, 0, 0.9, 0.065, 0.075, 0.07, 0.075, NO_BOTTOM | NO_TOP);
  b.box(P.Crown, 0, 0, 1.7, 1.82, 0.105, 0.115, 0.105, 0.115);
  const n = 6, apex = [0, 2.16, 0.12];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    b.tri(apex, [Math.cos(a1) * 0.55, 1.97, 0.12 + Math.sin(a1) * 0.55], [Math.cos(a0) * 0.55, 1.97, 0.12 + Math.sin(a0) * 0.55], P.Umbrella);
  }
  return b.geometry();
}

// Far: a card that turns to face the camera, coloured head / top / legs in the fragment shader.
export function personCard() {
  const b = new Builder();
  b.pos.push(-0.24, 0, 0, 0.24, 0, 0, 0.24, 1.75, 0, -0.24, 1.75, 0);
  for (let i = 0; i < 4; i++) { b.nrm.push(0, 0, 1); b.part.push(P.Card); }
  b.idx.push(0, 1, 2, 0, 2, 3);
  return b.geometry();
}

// Four-legged animals in a unit box: the shader stretches each part to a breed's proportions.
// Body: x ±0.5, y 0..1, z ±0.5. Legs hang from y 0 down to −1. Head sits at the front.
export function quadruped(mid = false) {
  const b = new Builder();
  b.box(A.Body, 0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5);
  b.box(A.Head, 0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5);
  if (!mid) {
    b.box(A.Snout, 0, 0, 0, 1, 0.5, 0.5, 0.45, 0.5);
    b.box(A.EarL, 0, 0, 0, 1, 0.5, 0.5, 0.3, 0.3);
    b.box(A.EarR, 0, 0, 0, 1, 0.5, 0.5, 0.3, 0.3);
    b.box(A.Tail, 0, 0, 0, 1, 0.5, 0.5, 0.35, 0.35);
  }
  for (const p of [A.LegFL, A.LegFR, A.LegBL, A.LegBR]) b.box(p, 0, 0, -1, 0, 0.5, 0.5, 0.5, 0.5, NO_BOTTOM | NO_TOP);
  if (!mid) {
    // the lead: two crossed ribbons with a sag in the middle, drawn from both sides.
    // x runs 0 (collar) to 1 (hand); y and z hold the ribbon's width.
    for (const [oy, oz] of [[1, 0], [0, 1]]) for (let i = 0; i < 2; i++) {
      const t0 = i / 2, t1 = (i + 1) / 2;
      const v = (t: number, s: number) => [t, oy * s, oz * s];
      b.tri(v(t0, -1), v(t1, -1), v(t1, 1), A.Lead); b.tri(v(t0, -1), v(t1, 1), v(t0, 1), A.Lead);
      b.tri(v(t1, 1), v(t1, -1), v(t0, -1), A.Lead); b.tri(v(t0, 1), v(t1, 1), v(t0, -1), A.Lead);
    }
  }
  return b.geometry();
}

// Birds (pigeons, ducks) in the same unit-box style.
export function bird() {
  const b = new Builder();
  b.box(B.Body, 0, 0, 0, 1, 0.5, 0.5, 0.45, 0.45);
  b.box(B.Head, 0, 0, 0, 1, 0.5, 0.5, 0.45, 0.45);
  b.box(B.Beak, 0, 0, 0, 1, 0.5, 0.5, 0.3, 0.3);
  b.box(B.Tail, 0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5, NO_BOTTOM);
  b.box(B.WingL, 0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5, NO_BOTTOM);
  b.box(B.WingR, 0, 0, 0, 1, 0.5, 0.5, 0.5, 0.5, NO_BOTTOM);
  return b.geometry();
}

// Things people ride or push, in the rider's own frame (forward is +z).
export function bike() {
  const b = new Builder();
  b.wheel(Q.Wheel, 0, 0.34, -0.52, 0.34, 0.02);
  b.wheel(Q.Wheel, 0, 0.34, 0.55, 0.34, 0.02);
  const hub0 = [0, 0.34, -0.52], hub1 = [0, 0.34, 0.55], seat = [0, 0.86, -0.22], head = [0, 0.9, 0.42], crank = [0, 0.32, 0.02];
  b.bar(Q.Frame, crank, seat, 0.018); b.bar(Q.Frame, seat, head, 0.018); b.bar(Q.Frame, crank, head, 0.02);
  b.bar(Q.Frame, hub0, seat, 0.012); b.bar(Q.Frame, hub0, crank, 0.012); b.bar(Q.Frame, head, hub1, 0.016);
  b.box(Q.Seat, 0, -0.24, 0.87, 0.92, 0.06, 0.11);
  b.bar(Q.Bar, [-0.24, 1.02, 0.4], [0.24, 1.02, 0.4], 0.015);
  return b.geometry();
}
export function pushchair() {
  const b = new Builder();
  b.box(Q.Seat, 0, 0.82, 0.3, 0.72, 0.2, 0.3, 0.21, 0.28);
  b.box(Q.Frame, 0, 0.68, 0.72, 0.95, 0.21, 0.14, 0.2, 0.06, NO_BOTTOM, 0.08); // hood
  for (const s of [-1, 1]) {
    b.bar(Q.Dark, [s * 0.2, 1.0, 0.42], [s * 0.2, 0.2, 0.9], 0.013);
    for (const z of [0.58, 1.08]) b.box(Q.Wheel, s * 0.21, z, 0, 0.16, 0.025, 0.08, 0.025, 0.08);
  }
  b.bar(Q.Bar, [-0.22, 1.0, 0.42], [0.22, 1.0, 0.42], 0.016);
  return b.geometry();
}
export function wheelchair() {
  const b = new Builder();
  for (const s of [-1, 1]) { b.wheel(Q.Wheel, s * 0.31, 0.3, -0.05, 0.3, 0.018); b.box(Q.Dark, s * 0.24, 0.3, 0, 0.1, 0.02, 0.04); }
  b.box(Q.Seat, 0, 0.02, 0.44, 0.5, 0.23, 0.22);
  b.box(Q.Seat, 0, -0.22, 0.5, 0.95, 0.23, 0.03);
  b.bar(Q.Frame, [0, 0.46, 0.2], [0, 0.1, 0.38], 0.02);
  b.box(Q.Dark, 0, 0.4, 0.08, 0.11, 0.15, 0.06);
  return b.geometry();
}

export const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
