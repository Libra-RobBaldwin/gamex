// Pedestrian crossings along a road, away from its junctions: zebras on the town's 30 mph streets,
// pelicans (signal controlled) on the bigger roads, where people walking along it want to get
// across: behind each bus stop, where people off the bus cross behind it, and along a long street.
// Laid out the way the Traffic Signs Regulations (TSRGD) and LTN 2/95 have them: clear of junctions
// and stops by the length of the zig-zags (diagram 1001.1) either side, and at grade. A pure
// function of the road, so the drawing (roaddraw), the people (game/crowdsites) and traffic all agree.
import { pointAt, stopSpan, type Network, type RSeg } from './roads';
import type { Course } from './xsection';

export type PedXKind = 'zebra' | 'pelican';
// r: along the road's course; w: the crossing's width, along the road
export interface PedX { id: string; seg: number; r: number; kind: PedXKind; w: number }
// the ends of the road where the junction's markings take over (roaddraw's endsOf, as far as it matters here)
export interface PedXEnds { line: [number, number]; L: [number, number]; R: [number, number] }

export const PEDX = {
  width: { zebra: 3, pelican: 3 }, // TSRGD: 2.4 m at least, wider where it's busy
  zigzags: 8, zig: 2, // marks of diagram 1001.1 either side: normally 8, 2 m each
  clear: 22, // a crossing's middle from a junction's line or a road's join (its zig-zags and a car)
  apart: 80, // between crossings on one road
  fromStop: 21, // past the end of a stop's markings (clear of its zig-zags)
};

// the kind a road gets, or null for a road that doesn't get one (dual carriageways, fast roads,
// roads without footways, motorways)
export function pedxKind(net: Network, s: RSeg): PedXKind | null {
  const d = net.def(s);
  if (d.cls !== 'road' || d.pave <= 0 || d.family === 'Motorway' || d.mph > 40 || d.oneway) return null;
  if (d.medianKind === 'barrier' || d.medianKind === 'grass') return null;
  // a plain town street gets a zebra; an avenue, a two-lane road, a 40 mph road, a reservation to cross: lights
  return d.lanes === 1 && d.mph <= 30 && d.median <= 0 && d.family !== 'Avenue' ? 'zebra' : 'pelican';
}

export function pedCrossingsOn(net: Network, s: RSeg, C: Course, ends: PedXEnds): PedX[] {
  const kind = pedxKind(net, s);
  if (!kind) return [];
  const CL = C.len, w = PEDX.width[kind];
  const r0 = Math.max(ends.line[0], ends.L[0], ends.R[0]) + PEDX.clear, r1 = CL - Math.max(ends.line[1], ends.L[1], ends.R[1]) - PEDX.clear;
  if (r1 < r0) return [];
  // stops, as stretches of the course (with their markings' clearance)
  const stops = s.stops.map((st) => stopSpan(st).map((t) => C.rhoOf(t)).sort((a, b) => a - b) as [number, number]);
  const ok = (r: number) => {
    if (r < r0 || r > r1) return false;
    if (stops.some(([a, b]) => r > a - PEDX.fromStop && r < b + PEDX.fromStop)) return false;
    // at grade all the way across its zig-zags
    for (let q = r - 10; q <= r + 10; q += 5) if (Math.abs(pointAt(C.path, Math.max(0, Math.min(CL, q))).y ?? 0) > 0.3) return false;
    // and where the road is its own full width (not in a taper)
    return Math.abs(C.sec(r).lanes - net.def(s).lanes) < 0.05;
  };
  const want: number[] = [];
  // behind each stop in the bus's direction (people off the bus cross behind it, where they can see)
  for (const st of s.stops) {
    const [a, b] = stopSpan(st);
    want.push(C.rhoOf(st.side === 1 ? a - PEDX.fromStop - w / 2 : b + PEDX.fromStop + w / 2));
  }
  // and halfway along a long stretch
  if (r1 - r0 > 90) want.push((r0 + r1) / 2);
  const out: PedX[] = [];
  for (const r of want) {
    if (!ok(r) || out.some((x) => Math.abs(x.r - r) < PEDX.apart)) continue;
    out.push({ id: `pedx:${s.id}:${Math.round(r)}`, seg: s.id, r, kind, w });
  }
  return out;
}
