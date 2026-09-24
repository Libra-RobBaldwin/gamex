// Vehicle bodies, exactly as the instanced meshes in traffic.ts draw them, and a counter of
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

// a rectangle: its centre, the way it points (unit), half its length and half its width
export interface Rect { x: number; z: number; hx: number; hz: number; hl: number; hw: number }
// Where a vehicle was drawn: its reference point, height, grow/fade scale and body parts.
export interface Pose { x: number; z: number; y: number; k: number; kind: Kind; id: number; parts: Rect[] }

// The parts of a vehicle's body, given where the course is `d` metres along from the reference
// point (d may be negative), with each part scaled by k about its own middle.
// (Pass `out` to have its rectangles filled in rather than new ones made.)
export function bodyOf(kind: Kind, at: (d: number) => { x: number; z: number }, k = 1, out: Rect[] = []): Rect[] {
  const parts = PARTS[kind];
  out.length = parts.length;
  parts.forEach(({ a, b, hw }, i) => {
    const p = at(a), q = at(b), dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    const r = (out[i] ??= { x: 0, z: 0, hx: 1, hz: 0, hl: 0, hw: 0 });
    r.x = (p.x + q.x) / 2; r.z = (p.z + q.z) / 2; r.hx = dx / l; r.hz = dz / l; r.hl = ((b - a) / 2) * k; r.hw = hw * k;
  });
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
