// Vehicle bodies, exactly as traffic.ts draws them (with the vehicle library), and a counter of
// vehicles overlapping each other. It's the yardstick for "nobody drives through anybody": the
// traffic's junction conflicts are worked out from the same bodies (conflicts.ts), and the tests
// and the browser checks count overlaps with it.
//
// A body sits on its course the way wheels do: a rigid part lies along the chord between the
// points of the course under its front and its back, so on a bend it cuts slightly inside rather
// than sticking out along the tangent. A lorry is articulated: the cab and the trailer each lie
// along their own chord, the trailer following the cab round a corner.

export type Kind = 'car' | 'lorry' | 'bus';
// metres in front of and behind the reference point, and half the width (the widest drawn part)
export const DIMS: Record<Kind, { front: number; back: number; hw: number }> = {
  car: { front: 2.15, back: 2.15, hw: 0.9 }, // body 4.3 × 1.8
  lorry: { front: 6.6, back: 6.9, hw: 1.25 }, // trailer from -6.9 to 4.1, cab 4.2 to 6.6, 2.5 wide
  bus: { front: 5.5, back: 5.5, hw: 1.28 }, // 11 long, windows 2.56 wide
};
// the rigid parts of each kind: from `a` to `b` metres along the course from the reference point
export const PARTS: Record<Kind, { a: number; b: number; hw: number }[]> = {
  car: [{ a: -2.15, b: 2.15, hw: 0.9 }],
  lorry: [{ a: -6.9, b: 4.1, hw: 1.25 }, { a: 4.2, b: 6.6, hw: 1.25 }],
  bus: [{ a: -5.5, b: 5.5, hw: 1.28 }],
};

// The bodies the traffic knows: 0–2 are the three kinds above, and the fleet (game/fleet.ts)
// registers each real vehicle's body, at its true length and width, when it first takes to the
// road. An articulated body (an artic, a bendy bus) is its first rigid part plus a trailer that
// swings round on the hitch behind it, the way the vehicle library's follow() drags one, rather
// than lying along the course: so it cuts the corner as a real semi-trailer does.
export interface Part { a: number; b: number; hw: number }
// hitch: the hitch point, metres ahead of the first part's middle (negative: behind it); front:
// the trailer's hitch ahead of the trailer's middle; axle: its axle group, from its middle
export interface Trailer { hitch: number; front: number; axle: number; len: number; hw: number }
export interface Body { parts: Part[]; trailer?: Trailer; front: number; back: number; hw: number }
export const BODIES: Body[] = (['car', 'lorry', 'bus'] as Kind[]).map((k) => ({ parts: PARTS[k], ...DIMS[k] }));
const bodyIds = new Map<string, number>();
// the body's number (the same one for bodies that are the same shape, so they share conflict tables)
export function registerBody(b: Body): number {
  const key = JSON.stringify([b.parts, b.trailer ?? null]);
  let id = bodyIds.get(key);
  if (id === undefined) { id = BODIES.push(b) - 1; bodyIds.set(key, id); }
  return id;
}

// a rectangle: its centre, the way it points (unit), half its length and half its width
export interface Rect { x: number; z: number; hx: number; hz: number; hl: number; hw: number }
// Where a vehicle was drawn: its reference point, height, grow/fade scale and body parts.
export interface Pose { x: number; z: number; y: number; k: number; kind: Kind; id: number; parts: Rect[] }

// The parts of a vehicle's body, given where the course is `d` metres along from the reference
// point (d may be negative), with each part scaled by k about its own middle.
// (Pass `out` to have its rectangles filled in rather than new ones made.) A trailer follows on
// from `prev`, where it was a moment ago; without one it lines up straight behind.
export function bodyOf(kind: Kind | number, at: (d: number) => { x: number; z: number }, k = 1, out: Rect[] = [], prev?: Rect): Rect[] {
  const B = typeof kind === 'number' ? BODIES[kind] : undefined, parts: Part[] = B ? B.parts : PARTS[kind as Kind];
  // (read before `out` is written: prev is usually last frame's trailer in the same array)
  const px = prev?.x ?? 0, pz = prev?.z ?? 0, phx = prev?.hx ?? 0, phz = prev?.hz ?? 0;
  out.length = parts.length + (B?.trailer ? 1 : 0);
  parts.forEach(({ a, b, hw }, i) => {
    const p = at(a), q = at(b), dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    const r = (out[i] ??= { x: 0, z: 0, hx: 1, hz: 0, hl: 0, hw: 0 });
    r.x = (p.x + q.x) / 2; r.z = (p.z + q.z) / 2; r.hx = dx / l; r.hz = dz / l; r.hl = ((b - a) / 2) * k; r.hw = hw * k;
  });
  const T = B?.trailer;
  if (T) {
    // the trailer's axles are dragged towards the hitch: it swings round without sliding sideways
    const c = out[0], hx = c.x + c.hx * T.hitch, hz = c.z + c.hz * T.hitch;
    let ux = c.hx, uz = c.hz;
    if (prev) {
      const rx = px + phx * T.axle, rz = pz + phz * T.axle, dx = hx - rx, dz = hz - rz, d = Math.hypot(dx, dz);
      // (unless it has jumped: a bus turning round at a dead end lines straight up again)
      if (Math.abs(d - (T.front - T.axle)) < 3 && dx * c.hx + dz * c.hz > 0) { ux = dx / d; uz = dz / d; }
    }
    const r = (out[parts.length] ??= { x: 0, z: 0, hx: 1, hz: 0, hl: 0, hw: 0 });
    r.x = hx - ux * T.front; r.z = hz - uz * T.front; r.hx = ux; r.hz = uz; r.hl = (T.len / 2) * k; r.hw = T.hw * k;
  }
  return out;
}

// A course through a junction or round a bend (conflicts.ts's Track): its point t metres along.
export interface Course { point(t: number): { x: number; z: number }; len: number; n: number }
// An articulated body's trailer every quarter metre along a course, having driven it from the
// start (lined up straight there, on the approach). The conflict tables sample it, and traffic.ts
// draws a vehicle on the course with it, so what's drawn is exactly what the tables allowed for.
const SUB = 0.25;
const trails = new WeakMap<Course, Map<number, Float32Array>>();
function trailAlong(c: Course, kind: number) {
  let m = trails.get(c);
  if (!m) trails.set(c, (m = new Map()));
  let a = m.get(kind);
  if (!a) {
    const n = Math.ceil(c.len / SUB) + 1, parts: Rect[] = [];
    a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const t = Math.min(i * SUB, c.len);
      const r = bodyOf(kind, (d) => c.point(t + d), 1, parts, i ? parts[parts.length - 1] : undefined)[parts.length - 1];
      a[i * 4] = r.x; a[i * 4 + 1] = r.z; a[i * 4 + 2] = r.hx; a[i * 4 + 3] = r.hz;
    }
    m.set(kind, a);
  }
  return a;
}
// the trailer of a vehicle t along a course, into `out` (scaled by k, as bodyOf does)
export function trailerOn(c: Course, kind: number, t: number, k: number, out: Rect) {
  const T = BODIES[kind].trailer!, a = trailAlong(c, kind), n = a.length / 4;
  const f = Math.max(0, Math.min(n - 1, t / SUB)), i = Math.min(n - 2, Math.floor(f)), u = n > 1 ? f - i : 0, j = n > 1 ? i + 1 : i;
  const hx = a[i * 4 + 2] * (1 - u) + a[j * 4 + 2] * u, hz = a[i * 4 + 3] * (1 - u) + a[j * 4 + 3] * u, l = Math.hypot(hx, hz) || 1;
  out.x = a[i * 4] * (1 - u) + a[j * 4] * u; out.z = a[i * 4 + 1] * (1 - u) + a[j * 4 + 1] * u; out.hx = hx / l; out.hz = hz / l;
  out.hl = (T.len / 2) * k; out.hw = T.hw * k;
  return out;
}

// A body at every sample along a course (step apart), as the conflict tables need it.
export function bodiesAlong(kind: number, c: Course, step: number): Rect[][] {
  const out: Rect[][] = [], art = !!BODIES[kind].trailer;
  for (let i = 0; i < c.n; i++) {
    const t = Math.min(i * step, c.len), r = bodyOf(kind, (d) => c.point(t + d));
    if (art) trailerOn(c, kind, t, 1, r[r.length - 1]);
    out.push(r);
  }
  return out;
}

// Oriented rectangle overlap by separating axes, each grown all round by `grow` (negative to shrink).
export function rectsTouch(a: Rect, b: Rect, grow = 0) {
  const al = a.hl + grow, aw = a.hw + grow, bl = b.hl + grow, bw = b.hw + grow;
  if (al <= 0 || aw <= 0 || bl <= 0 || bw <= 0) return false;
  const dx = b.x - a.x, dz = b.z - a.z;
  for (let k = 0; k < 4; k++) {
    const ux = k === 0 ? a.hx : k === 1 ? -a.hz : k === 2 ? b.hx : -b.hz, uz = k === 0 ? a.hz : k === 1 ? a.hx : k === 2 ? b.hz : b.hx;
    const ra = al * Math.abs(a.hx * ux + a.hz * uz) + aw * Math.abs(-a.hz * ux + a.hx * uz);
    const rb = bl * Math.abs(b.hx * ux + b.hz * uz) + bw * Math.abs(-b.hz * ux + b.hx * uz);
    if (Math.abs(dx * ux + dz * uz) >= ra + rb) return false;
  }
  return true;
}
// Do two drawn vehicles overlap? Each part is shrunk by tol / 2 all round, so only a real
// interpenetration deeper than `tol` counts.
export function posesOverlap(a: Pose, b: Pose, tol = 0.3) {
  for (const p of a.parts) for (const q of b.parts) if (rectsTouch(p, q, -tol / 2)) return true;
  return false;
}

// Every pair of vehicles overlapping at the same level (a bridge over a road doesn't count),
// found through a coarse grid so it stays linear in the number of vehicles.
export function overlapping(poses: Pose[], tol = 0.3): [Pose, Pose][] {
  const cell = 16, grid = new Map<number, Pose[]>();
  const key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
  for (const p of poses) {
    const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(p);
  }
  const out: [Pose, Pose][] = [];
  for (const p of poses) {
    const i = Math.floor(p.x / cell), j = Math.floor(p.z / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const q of grid.get(key(i + di, j + dj)) ?? []) {
        if (q.id <= p.id || Math.abs(q.y - p.y) > 2.5) continue;
        if (Math.hypot(q.x - p.x, q.z - p.z) > 16) continue;
        if (posesOverlap(p, q, tol)) out.push([p, q]);
      }
    }
  }
  return out;
}
