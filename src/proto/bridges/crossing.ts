// What a bridge has to cross. The height solver (grade.ts) has already decided where the deck is
// and how high; this describes the ground and what lies underneath it, in distance along the
// route, so the chooser and the support layout can work in one dimension.
import { GRADES } from '../grade';
import { halfOf, kerbOf, type RoadDef } from '../catalog';
import type { P } from '../roads';

// the solver's clearances allow ~1.2 m of deck (GRADES.clear = headroom + deck); headroom is what's left
export const ASSUMED_DECK = 1.2;
export const HEADROOM = { road: GRADES.road.clear - ASSUMED_DECK, rail: GRADES.rail.clear - ASSUMED_DECK };

// A navigation channel: where boats pass, how wide, and the air draft they need above the water.
// `tallPerHour` is how many boats an hour are too tall for a fixed low bridge (for movable ones).
export interface Channel { s0: number; s1: number; clear: number; tallPerHour?: number }
export type Obstacle =
  // water between s0 and s1, its surface at `level`; the bed is whatever ground() says there
  | { kind: 'water'; s0: number; s1: number; level: number; channel?: Channel; name?: string }
  // a road or railway underneath: no piers between s0 and s1, and `clear` headroom over `surface`
  | { kind: 'road' | 'rail'; s0: number; s1: number; surface: number; clear?: number; name?: string }
  // anything else supports mustn't stand on (a building, someone else's land)
  | { kind: 'keepout'; s0: number; s1: number; name: string };

export interface Crossing {
  path: P[]; // plan position with y = road surface height, from the height solver
  ground?: (s: number) => number; // ground (or river bed) height along the route; flat 0 if missing
  obstacles: Obstacle[];
  road: RoadDef; // what the bridge carries
  year: number;
  heavy?: boolean; // heavy freight: abnormal road loads, 25.5 t rail axles
  // Re-run the height solver with every clearance raised by `raise` metres (for a structure deeper
  // than the solver assumed) and the gradient held to `grade`. The game passes a closure over
  // roads.ts check(); without one, a type that doesn't fit the given profile is simply refused.
  resolve?: (need: { raise: number; grade?: number }) => Crossing | undefined;
}

export const groundAt = (c: Crossing, s: number) => (c.ground ? c.ground(s) : 0);
export const deckAt = (c: Crossing, s: number) => pointOn(c.path, s).y;

// Point and direction at distance s along a path: the same answer as roads.ts pointAt, but with
// the running lengths cached per path and a binary search, because layout and geometry ask
// thousands of times along paths of a thousand points.
const runs = new WeakMap<P[], number[]>();
export function pointOn(path: P[], s: number) {
  let cum = runs.get(path);
  if (!cum) {
    cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
    runs.set(path, cum);
  }
  if (path.length < 2) { const p = path[0]; return { x: p.x, z: p.z, y: p.y ?? 0, ux: 1, uz: 0 }; }
  let lo = 1, hi = path.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
  const a = path[lo - 1], b = path[lo], L = cum[lo] - cum[lo - 1];
  const t = L ? Math.max(0, Math.min(1, (s - cum[lo - 1]) / L)) : 0, ya = a.y ?? 0, yb = b.y ?? 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: ya + (yb - ya) * t, ux: (b.x - a.x) / (L || 1), uz: (b.z - a.z) / (L || 1) };
}
// parapet to parapet: the road's full width (pavements or verges) or the track bed with a walkway
export const deckWidth = (d: RoadDef) => (d.cls === 'rail' ? kerbOf(d) * 2 + 1.6 : halfOf(d) * 2 + 0.6);

// What the bridge must carry: gross road vehicle (t), or rail axle load (t).
export function demand(c: Crossing) {
  const d = c.road;
  if (d.cls === 'road') return { road: c.heavy ? 150 : 44, rail: 0, mph: d.mph };
  const axle = c.heavy ? 25.5 : d.rack ? 14 : d.id === 'rail-light' ? 12 : d.mph >= 150 ? 17 : d.mph >= 90 ? 22.5 : 20;
  return { road: 0, rail: axle, mph: d.mph };
}

export function headroomOf(o: Obstacle) {
  if (o.kind === 'road') return o.clear ?? HEADROOM.road;
  if (o.kind === 'rail') return o.clear ?? HEADROOM.rail;
  return 0;
}

// Beyond this height above the ground an embankment costs more than a bridge (and takes more land).
export const EMBANK_MAX = 6;
const MARGIN = 2;

// Where along the route the bridges are: every obstacle must be spanned, and anywhere the deck is
// higher than an embankment should go. Stretches closer than `join` metres become one bridge.
export function extents(c: Crossing, join = 40): [number, number][] {
  const L = pathLengthOf(c);
  const need: [number, number][] = c.obstacles.map((o) => [Math.max(0, o.s0 - MARGIN), Math.min(L, o.s1 + MARGIN)]);
  const step = 2;
  let open = -1;
  for (let s = 0; s <= L + 1e-6; s += step) {
    const high = deckAt(c, s) - groundAt(c, s) > EMBANK_MAX;
    if (high && open < 0) open = s;
    if (open >= 0 && (!high || s + step > L)) { need.push([open, Math.min(L, s)]); open = -1; }
  }
  need.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of need) {
    const last = out[out.length - 1];
    if (last && r[0] - last[1] < join) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

export function pathLengthOf(c: Crossing) {
  let L = 0;
  for (let i = 1; i < c.path.length; i++) L += Math.hypot(c.path[i].x - c.path[i - 1].x, c.path[i].z - c.path[i - 1].z);
  return L;
}

// Steepest the deck gets between s0 and s1.
export function gradeOver(c: Crossing, s0: number, s1: number) {
  let g = 0;
  for (let s = s0; s < s1; s += 2) g = Math.max(g, Math.abs(deckAt(c, Math.min(s1, s + 2)) - deckAt(c, s)) / Math.max(1e-6, Math.min(2, s1 - s)));
  return g;
}
