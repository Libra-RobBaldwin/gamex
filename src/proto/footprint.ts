// Vehicle bodies, exactly as traffic.ts draws them (with the vehicle library), and a counter of
// vehicles overlapping each other. It's the yardstick for "nobody drives through anybody": the
// traffic's junction conflicts are worked out from the same bodies (conflicts.ts), and the tests
// and the browser checks count overlaps with it.
//
// A body steers like a real vehicle (a bicycle model): its front axle follows the course, its rear
// axle is dragged along behind at the wheelbase, never sliding sideways, so on a bend it cuts the
// corner, and the body points along the line from the rear axle to the front one. An articulated
// vehicle (an artic, a bendy bus) hangs its trailer on the hitch in the same way: the trailer's
// axles are dragged after the hitch, so the trailer cuts in further still.
//
// Where the rear axle is depends on the way the vehicle has come, so the traffic keeps it for each
// vehicle as it goes (Axles), and the conflict tables work it out along each course from the road
// before it, running straight into the course (bodiesAlong): a vehicle arriving along its lane is
// where the tables have it. Out of the junction the rear settles back onto the lane over a few
// metres (so a long vehicle is straight by the time the tables stop following it). A part with no axles (the generic lorry's) lies along the chord
// between the points of the course under its two ends, as bodies used to.

export type Kind = 'car' | 'lorry' | 'bus';
// metres in front of and behind the reference point, and half the width (the widest drawn part)
export const DIMS: Record<Kind, { front: number; back: number; hw: number }> = {
  car: { front: 2.15, back: 2.15, hw: 0.9 }, // body 4.3 × 1.8
  lorry: { front: 6.6, back: 6.9, hw: 1.25 }, // trailer from -6.9 to 4.1, cab 4.2 to 6.6, 2.5 wide
  bus: { front: 5.5, back: 5.5, hw: 1.28 }, // 11 long, windows 2.56 wide
};
// A rigid part: from `a` to `b` metres along the vehicle from the reference point, half its width,
// and its axles: the steered front axle `fa` and the middle of the rear axle group `ra`, likewise
// measured from the reference point
export interface Part { a: number; b: number; hw: number; fa?: number; ra?: number }
// the rigid parts of each kind
export const PARTS: Record<Kind, Part[]> = {
  car: [{ a: -2.15, b: 2.15, hw: 0.9, fa: 1.3, ra: -1.25 }], // (2.55 m wheelbase)
  lorry: [{ a: -6.9, b: 4.1, hw: 1.25 }, { a: 4.2, b: 6.6, hw: 1.25 }],
  bus: [{ a: -5.5, b: 5.5, hw: 1.28, fa: 3.0, ra: -2.4 }],
};

// The bodies the traffic knows: 0–2 are the three kinds above, and the fleet (game/fleet.ts)
// registers each real vehicle's body, at its true length and width, when it first takes to the
// road. An articulated body (an artic, a bendy bus) is its first rigid part plus a trailer hung on
// the hitch behind it.
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
// the furthest any part of a body reaches from its reference point on the course: its length each
// way and half its width, and a margin for the rear cutting in on a bend (the rear is nearer the
// middle of the bend than the course, never further from the reference point than its length)
export const reachOf = (b: Body) => Math.max(b.front, b.back) + b.hw + 1;

// a rectangle: its centre, the way it points (unit), half its length and half its width
export interface Rect { x: number; z: number; hx: number; hz: number; hl: number; hw: number }
// Where a vehicle was drawn: its reference point, height, grow/fade scale and body parts.
export interface Pose { x: number; z: number; y: number; k: number; kind: Kind; id: number; parts: Rect[] }

// Where a vehicle's axles are: the front axle (where the course had it last), the rear axle
// dragged after it, and the trailer's axle group dragged after the hitch (for an articulated body).
export interface Axles { fx: number; fz: number; rx: number; rz: number; tx: number; tz: number; body: number }

type At = (d: number) => { x: number; z: number };
const DRAG = 0.25; // metres: the front axle's move is taken in steps this long (the same at 10 fps as at 60)
const FOLD = 1.3, COS_FOLD = Math.cos(FOLD); // radians: the most a trailer is angled to what pulls it
// the body's steering: the first part's wheelbase (0 for a part with no axles), and the trailer's
// hitch-to-axles arm
interface Geom { p: Part; wb: number; T?: Trailer; arm: number; mid: number; hk: number }
const geoms = new WeakMap<Body, Geom>();
function geomOf(B: Body): Geom {
  let g = geoms.get(B);
  if (!g) {
    const p = B.parts[0], T = B.trailer, mid = (p.a + p.b) / 2;
    const wb = p.fa !== undefined && p.ra !== undefined ? p.fa - p.ra : 0;
    // (hk: the hitch from the front axle, along the first part)
    geoms.set(B, (g = { p, wb, T, arm: T ? T.front - T.axle : 0, mid, hk: T ? mid + T.hitch - (p.fa ?? 0) : 0 }));
  }
  return g;
}
const bodyCache = new Map<Kind, Body>();
const bodyAt = (kind: Kind | number): Body => {
  if (typeof kind === 'number') return BODIES[kind];
  let b = bodyCache.get(kind);
  if (!b) bodyCache.set(kind, (b = { parts: PARTS[kind], ...DIMS[kind] }));
  return b;
};

// Pull a point (x, z) after `to` so it stays `len` behind it, sliding only along the line between.
const dragOut: [number, number] = [0, 0];
function drag(px: number, pz: number, tx: number, tz: number, len: number): [number, number] {
  const dx = tx - px, dz = tz - pz, l = Math.hypot(dx, dz);
  if (l < 1e-9) { dragOut[0] = px; dragOut[1] = pz; }
  else { dragOut[0] = tx - (dx / l) * len; dragOut[1] = tz - (dz / l) * len; }
  return dragOut;
}

// Axles as if the vehicle had come straight along the course to where it is (the start, or after a jump).
function lineUp(B: Body, at: At, s: Axles) {
  const g = geomOf(B), f = at(g.p.fa ?? 0), r = at(g.p.ra ?? 0);
  s.fx = f.x; s.fz = f.z; s.rx = r.x; s.rz = r.z;
  if (g.T) { const t = at(g.mid + g.T.hitch - g.arm); s.tx = t.x; s.tz = t.z; } else { s.tx = r.x; s.tz = r.z; }
}
// the hitch, on the first part's axis: from the front axle towards the rear one (into hx, hz)
let hx = 0, hz = 0;
function hitchOf(g: Geom, s: Axles) {
  const ux = s.fx - s.rx, uz = s.fz - s.rz, l = Math.hypot(ux, uz) || 1;
  hx = s.fx + (ux / l) * g.hk; hz = s.fz + (uz / l) * g.hk;
}
// Out of a junction (and along a lane) the rear axle and a trailer's axles settle back onto the
// course over this distance, rather than trailing across the road for a few trailer lengths as they
// would on their own. So a long vehicle is straight again by the end of the course the conflict
// tables follow it along, and nothing it swings across is anywhere the tables don't cover.
const SETTLE = 1.5; // metres
function settleOnto(B: Body, s: Axles, at: At, moved: number) {
  const g = geomOf(B), f = 1 - Math.exp(-moved / SETTLE);
  if (f <= 0) return;
  if (g.wb > 0) {
    const r = at(g.p.ra!);
    [s.rx, s.rz] = drag(s.rx + (r.x - s.rx) * f, s.rz + (r.z - s.rz) * f, s.fx, s.fz, g.wb);
  }
  if (g.T && g.arm > 0) {
    const t = at(g.mid + g.T.hitch - g.arm);
    hitchOf(g, s);
    [s.tx, s.tz] = drag(s.tx + (t.x - s.tx) * f, s.tz + (t.z - s.tz) * f, hx, hz, g.arm);
  }
}

// Move the front axle to (fx, fz), in short steps, dragging the rear axle and the trailer after it.
function steer(B: Body, s: Axles, fx: number, fz: number) {
  const g = geomOf(B), dx = fx - s.fx, dz = fz - s.fz, n = Math.min(400, Math.max(1, Math.ceil(Math.hypot(dx, dz) / DRAG)));
  const x0 = s.fx, z0 = s.fz;
  for (let i = 1; i <= n; i++) {
    s.fx = x0 + (dx * i) / n; s.fz = z0 + (dz * i) / n;
    if (g.wb > 0) [s.rx, s.rz] = drag(s.rx, s.rz, s.fx, s.fz, g.wb);
    if (g.T && g.arm > 0) { hitchOf(g, s); [s.tx, s.tz] = drag(s.tx, s.tz, hx, hz, g.arm); }
  }
}

// The parts of a body from where its axles are (scaled by k about each part's own middle), the
// trailer's last; a part with no axles, along the course's chord under its two ends.
function place(B: Body, s: Axles, at: At, k: number, out: Rect[]): Rect[] {
  out.length = B.parts.length + (B.trailer ? 1 : 0);
  let ux = s.fx - s.rx, uz = s.fz - s.rz;
  const l = Math.hypot(ux, uz);
  if (l > 1e-9) { ux /= l; uz /= l; }
  for (let i = 0; i < B.parts.length; i++) {
    const pt = B.parts[i], r = (out[i] ??= { x: 0, z: 0, hx: 1, hz: 0, hl: 0, hw: 0 });
    if (pt.fa !== undefined && pt.ra !== undefined && l > 1e-9) {
      const c = (pt.a + pt.b) / 2 - pt.fa;
      r.x = s.fx + ux * c; r.z = s.fz + uz * c; r.hx = ux; r.hz = uz;
    } else {
      const p = at(pt.a), q = at(pt.b), dx = q.x - p.x, dz = q.z - p.z, m = Math.hypot(dx, dz) || 1;
      r.x = (p.x + q.x) / 2; r.z = (p.z + q.z) / 2; r.hx = dx / m; r.hz = dz / m;
    }
    r.hl = ((pt.b - pt.a) / 2) * k; r.hw = pt.hw * k;
  }
  const T = B.trailer;
  if (T) {
    const c = out[0], g = geomOf(B);
    // the hitch on the first part, and the trailer pointing from its axles to it (never folded back
    // past FOLD against what pulls it)
    const hx = c.x + c.hx * T.hitch, hz = c.z + c.hz * T.hitch;
    let vx = hx - s.tx, vz = hz - s.tz;
    const m = Math.hypot(vx, vz);
    if (m > 1e-9 && g.arm > 0) { vx /= m; vz /= m; } else { vx = c.hx; vz = c.hz; }
    if (c.hx * vx + c.hz * vz < COS_FOLD) {
      const a = Math.sign(c.hx * vz - c.hz * vx) * FOLD, ca = Math.cos(a), sa = Math.sin(a);
      vx = c.hx * ca - c.hz * sa; vz = c.hx * sa + c.hz * ca;
    }
    const r = (out[B.parts.length] ??= { x: 0, z: 0, hx: 1, hz: 0, hl: 0, hw: 0 });
    r.x = hx - vx * T.front; r.z = hz - vz * T.front; r.hx = vx; r.hz = vz; r.hl = (T.len / 2) * k; r.hw = T.hw * k;
  }
  return out;
}

// How far back along a course the axles are worked out from, as if it ran straight until then
// (enough for them to have settled onto the course: a few wheelbases)
const settle = (B: Body) => { const g = geomOf(B); return Math.min(60, 4 * Math.max(g.wb, g.arm, 1)); };

// The parts of a vehicle's body, given where the course is `d` metres along from the reference
// point (d may be negative): its axles worked out from the course behind it, with each part scaled
// by k about its own middle. (Pass `out` to have its rectangles filled in rather than new ones made.)
export function bodyOf(kind: Kind | number, at: At, k = 1, out: Rect[] = []): Rect[] {
  const B = bodyAt(kind), s = { fx: 0, fz: 0, rx: 0, rz: 0, tx: 0, tz: 0, body: -1 };
  const back = settle(B), fa = B.parts[0].fa ?? 0;
  const from = (d: number) => at(d - back);
  lineUp(B, from, s);
  for (let d = DRAG; d <= back + 1e-9; d += DRAG) { const f = at(fa - back + d); steer(B, s, f.x, f.z); }
  return place(B, s, at, k, out);
}

// The same for a vehicle the traffic moves along, keeping its axles from frame to frame (`s`, filled
// in the first time): the front axle goes to the course under it and drags the rest after it. A
// jump (a vehicle put down somewhere, turning round at a dead end) lines it up on the course again.
// is the line from an axle to the one ahead of it (ux, uz) out of line with the way it just moved?
function swungOut(ux: number, uz: number, mx: number, mz: number, m: number) {
  const l = Math.hypot(ux, uz);
  return l > 1e-9 && Math.abs(ux * mz - uz * mx) / (l * m) > 0.01;
}
// (`settle`: it's out of the junction, or on a lane: its rear settles back onto the course)
export function steered(kind: Kind | number, at: At, s: Axles, k = 1, out: Rect[] = [], settle = false): Rect[] {
  const B = bodyAt(kind), body = typeof kind === 'number' ? kind : -1 - ['car', 'lorry', 'bus'].indexOf(kind);
  const f = at(B.parts[0].fa ?? 0), mx = f.x - s.fx, mz = f.z - s.fz, moved = Math.hypot(mx, mz);
  if (s.body !== body || moved > 8) { s.body = body; lineUp(B, at, s); }
  else if (moved > 1e-6) {
    steer(B, s, f.x, f.z);
    // (only one out of line with the way it's going has anything to settle: most are straight already)
    if (settle && (swungOut(s.fx - s.rx, s.fz - s.rz, mx, mz, moved) || (B.trailer && swungOut(s.rx - s.tx, s.rz - s.tz, mx, mz, moved)))) settleOnto(B, s, at, moved);
  }
  return place(B, s, at, k, out);
}

// A course through a junction or round a bend (conflicts.ts's Track): its point t metres along, and
// from where along it the rear axles settle back onto it
export interface Course { point(t: number): { x: number; z: number }; len: number; n: number; settle?: number }
// A body at every sample along a course (step apart), as the conflict tables need it: its axles
// dragged along the course from a few wheelbases before its start, where it runs straight.
export function bodiesAlong(kind: number, c: Course, step: number): Rect[][] {
  const B = BODIES[kind], fa = B.parts[0].fa ?? 0, back = settle(B);
  const s = { fx: 0, fz: 0, rx: 0, rz: 0, tx: 0, tz: 0, body: kind };
  lineUp(B, (d) => c.point(d - back), s);
  for (let d = DRAG; d <= back + 1e-9; d += DRAG) { const f = c.point(fa - back + d); steer(B, s, f.x, f.z); }
  const out: Rect[][] = [];
  let t0 = 0;
  for (let i = 0; i < c.n; i++) {
    const t = Math.min(i * step, c.len);
    // (in steps no longer than DRAG along the course itself, which bends)
    for (let q = t0 + DRAG; q < t - 1e-9; q += DRAG) { const f = c.point(q + fa); steer(B, s, f.x, f.z); }
    const f = c.point(t + fa);
    steer(B, s, f.x, f.z);
    if (t > (c.settle ?? Infinity)) settleOnto(B, s, (d) => c.point(t + d), t - Math.max(t0, c.settle!));
    t0 = t;
    out.push(place(B, s, (d) => c.point(t + d), 1, []));
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
  // (two vehicles can touch with their reference points as far apart as the two longest reaches)
  let reach = 0;
  for (const b of BODIES) reach = Math.max(reach, reachOf(b));
  const cell = Math.max(16, 2 * reach), grid = new Map<number, Pose[]>();
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
        if (Math.hypot(q.x - p.x, q.z - p.z) > cell) continue;
        if (posesOverlap(p, q, tol)) out.push([p, q]);
      }
    }
  }
  return out;
}
