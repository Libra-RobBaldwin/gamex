// Where two vehicles' courses through a junction get in each other's way, worked out from their
// footprints rather than from lines: a lorry's body swings wide on a tight corner, a car merging
// onto a roundabout shares the ring with the one ahead of it, two turns cross in the middle.
//
// A course (Track) is a polyline measured in metres along it. For two courses A and B, and the
// sizes of vehicle on each, we sample both every STEP metres and note every pair of positions at
// which the two footprints would touch. That table answers, cheaply, the only two questions the
// traffic needs: if the vehicle on A goes first, how far along B may the other one come (a limit
// that stays put for a crossing and moves along behind it for a merge), and has either of them
// already got past everything the other could hit?
import type { P } from './roads';
import { DIMS, bodyOf, rectsTouch, type Kind, type Rect } from './footprint';

export type Cls = 0 | 1 | 2; // a car, a lorry, a bus
export const KINDS: Kind[] = ['car', 'lorry', 'bus'];
export const STEP = 1;
const MARGIN = 0.25; // clearance kept all round each footprint

let nextId = 1;

export interface At { x: number; z: number; y: number; hx: number; hz: number }

export class Track {
  id = nextId++;
  pts: P[];
  cum: number[];
  len: number;
  n: number; // samples at 0, STEP, 2·STEP … and one at the end
  sx: Float32Array; sz: Float32Array; shx: Float32Array; shz: Float32Array;
  box: [number, number, number, number];
  constructor(pts: P[]) {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.len = this.cum[this.cum.length - 1];
    this.n = Math.floor(this.len / STEP) + 2;
    this.sx = new Float32Array(this.n); this.sz = new Float32Array(this.n); this.shx = new Float32Array(this.n); this.shz = new Float32Array(this.n);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < this.n; i++) {
      const q = this.at(Math.min(i * STEP, this.len));
      this.sx[i] = q.x; this.sz[i] = q.z; this.shx[i] = q.hx; this.shz[i] = q.hz;
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z);
    }
    this.box = [x0, x1, z0, z1];
  }
  // the bodies of a vehicle of each class at every sample (worked out when first needed)
  private bodies: (Rect[][] | undefined)[] = [];
  body(k: Cls) {
    let b = this.bodies[k];
    if (!b) {
      b = [];
      for (let i = 0; i < this.n; i++) { const t = Math.min(i * STEP, this.len); b.push(bodyOf(KINDS[k], (d) => this.point(t + d))); }
      this.bodies[k] = b;
    }
    return b;
  }
  // the point t along the course (carried straight on past either end, so a body near an end
  // still has somewhere to sit)
  point(t: number) {
    const c = this.cum, p = this.pts, n = p.length;
    if (t <= 0 || t >= this.len) {
      const [a, b] = t <= 0 ? [p[0], p[1]] : [p[n - 2], p[n - 1]], l = Math.hypot(b.x - a.x, b.z - a.z) || 1, o = t <= 0 ? t : t - this.len, e = t <= 0 ? a : b;
      return { x: e.x + ((b.x - a.x) / l) * o, z: e.z + ((b.z - a.z) / l) * o, y: e.y ?? 0 };
    }
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= t) lo = m; else hi = m; }
    const a = p[lo], b = p[hi], k = (t - c[lo]) / (c[hi] - c[lo] || 1);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * k };
  }
  // position, and heading along the chord a metre either side (so corners of the polyline don't jerk)
  at(t: number): At {
    const q = this.point(t), a = this.point(Math.min(t - 1, this.len - 2)), b = this.point(Math.max(t + 1, 2));
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    return { x: q.x, z: q.z, y: q.y, hx: dx / l, hz: dz / l };
  }
}

// The conflict table for vehicles of classes ca on A and cb on B. Per sample of A: the lowest and
// highest position on B that touches it from there on (suffix min / max), and the same the other way.
export interface Table { lowB: Float32Array; hiB: Float32Array; lowA: Float32Array; hiA: Float32Array; nA: number; nB: number; empty: boolean }

// how many tables have been worked out, and the time it took (ms): for performance readouts
export const tableStats = { n: 0, ms: 0, worst: 0 };
export function table(A: Track, ca: Cls, B: Track, cb: Cls): Table {
  const t0 = performance.now();
  const t = work(A, ca, B, cb), d = performance.now() - t0;
  tableStats.n++; tableStats.ms += d; tableStats.worst = Math.max(tableStats.worst, d);
  return t;
}
function work(A: Track, ca: Cls, B: Track, cb: Cls): Table {
  const nA = A.n, nB = B.n;
  const lowB = new Float32Array(nA + 1).fill(Infinity), hiB = new Float32Array(nA + 1).fill(-Infinity);
  const lowA = new Float32Array(nB + 1).fill(Infinity), hiA = new Float32Array(nB + 1).fill(-Infinity);
  const da = DIMS[KINDS[ca]], db = DIMS[KINDS[cb]];
  // (every part of a body is within this of its reference point)
  const reach = Math.max(da.front, da.back) + da.hw + Math.max(db.front, db.back) + db.hw + 2 * MARGIN;
  let empty = A.box[0] - reach > B.box[1] || B.box[0] - reach > A.box[1] || A.box[2] - reach > B.box[3] || B.box[2] - reach > A.box[3];
  if (!empty) {
    empty = true;
    const bA = A.body(ca), bB = B.body(cb);
    for (let i = 0; i < nA; i++) {
      const ax = A.sx[i], az = A.sz[i], pa = bA[i];
      const p = Math.min(i * STEP, A.len);
      for (let j = 0; j < nB; j++) {
        const dx = B.sx[j] - ax, dz = B.sz[j] - az;
        if (dx * dx + dz * dz > reach * reach) continue;
        const pb = bB[j];
        let hit = false;
        for (const r of pa) { for (const q of pb) if (rectsTouch(r, q, MARGIN)) { hit = true; break; } if (hit) break; }
        if (!hit) continue;
        const q = Math.min(j * STEP, B.len);
        empty = false;
        if (q < lowB[i]) lowB[i] = q;
        if (q > hiB[i]) hiB[i] = q;
        if (p < lowA[j]) lowA[j] = p;
        if (p > hiA[j]) hiA[j] = p;
      }
    }
    for (let i = nA - 1; i >= 0; i--) { lowB[i] = Math.min(lowB[i], lowB[i + 1]); hiB[i] = Math.max(hiB[i], hiB[i + 1]); }
    for (let j = nB - 1; j >= 0; j--) { lowA[j] = Math.min(lowA[j], lowA[j + 1]); hiA[j] = Math.max(hiA[j], hiA[j + 1]); }
  }
  return { lowB, hiB, lowA, hiA, nA, nB, empty };
}

// One vehicle's view of a table: `me` on one course, `it` on the other.
export class View {
  constructor(private t: Table, private swap: boolean) {}
  get empty() { return this.t.empty; }
  private idx(x: number, n: number) { return x <= 0 ? 0 : Math.min(n, Math.floor(x / STEP)); }
  // with `it` at `p` going first: the furthest `me` may come (Infinity when it no longer matters)
  limitMe(p: number) {
    const v = this.swap ? this.t.lowA[this.idx(p, this.t.nB)] : this.t.lowB[this.idx(p, this.t.nA)];
    return v === Infinity ? Infinity : v - STEP;
  }
  // with `me` at `q` going first: the furthest `it` may come
  limitIt(q: number) {
    const v = this.swap ? this.t.lowB[this.idx(q, this.t.nA)] : this.t.lowA[this.idx(q, this.t.nB)];
    return v === Infinity ? Infinity : v - STEP;
  }
  // the furthest along my course that `it`, at p or beyond, can still touch
  reachMe(p: number) {
    const v = this.swap ? this.t.hiA[this.idx(p, this.t.nB)] : this.t.hiB[this.idx(p, this.t.nA)];
    return v === -Infinity ? -Infinity : v + STEP;
  }
  reachIt(q: number) {
    const v = this.swap ? this.t.hiB[this.idx(q, this.t.nA)] : this.t.hiA[this.idx(q, this.t.nB)];
    return v === -Infinity ? -Infinity : v + STEP;
  }
  // nothing left between them: one of the two is past everything the other could still hit
  apart(p: number, q: number) { return q > this.reachMe(p) || p > this.reachIt(q); }
}
