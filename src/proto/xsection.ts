// Where a road changes type part-way (two roads of different kinds meeting end to end, with no
// junction), the wider one tapers into the narrower one instead of stopping dead. This module is
// the single description of that taper: drawing, the land it takes, and traffic (which lane
// ends where) all read it, so a lane that visibly ends is the lane cars have to leave.
//
// Measured as `u`, metres back from the join along the wider road, over its taper length Lt:
//   u ∈ [0, HOLD·Lt]            exactly the narrower road's cross-section (so the two meet cleanly)
//   u ∈ [HOLD·Lt, MEDIAN·Lt]    the reservation opens from the narrower road's width to the wider's,
//                               drawn as hatching (a ghost island), kerbs moving out to suit
//   u ∈ [MEDIAN·Lt, Lt]         the extra lanes (offside first) taper in from nothing to full width
// Beyond Lt the wider road is its own cross-section.
import { ROADS, halfOf, kerbOf, type RoadDef } from './catalog';
import type { Network, RSeg } from './roads';
import { STD } from './standards';

export const TAPER = { hold: 0.12, median: 0.5 };

export interface Taper { node: number; atA: boolean; len: number; to: RoadDef }
export interface Ends2 { A: Taper | null; B: Taper | null }

// Two roads of different kinds meeting end to end at a node (and nothing else there).
function partner(net: Network, s: RSeg, node: number): RSeg | null {
  const at = net.segsAt(node).filter((x) => net.def(x).cls === 'road');
  if (at.length !== 2) return null;
  const o = at[0].id === s.id ? at[1] : at[0];
  return o.id === s.id ? null : o;
}
const wider = (a: RoadDef, b: RoadDef) => a.lanes > b.lanes || (a.lanes === b.lanes && (a.median > b.median || halfOf(a) > halfOf(b) + 0.05));

export function taperOf(net: Network, s: RSeg): Ends2 {
  const d = net.def(s), L = net.length(s);
  const at = (node: number, atA: boolean): Taper | null => {
    if (d.cls !== 'road') return null;
    const o = partner(net, s, node);
    if (!o) return null;
    const od = net.def(o);
    if (od.id === d.id || !wider(d, od)) return null;
    return { node, atA, to: od, len: Math.max(12, Math.min(STD.taperLength(d.mph), L * 0.45)) };
  };
  return { A: at(s.a, true), B: at(s.b, false) };
}

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// The cross-section at distance t along s (from its a end), per side of the centreline.
export interface Section2 {
  median: number; // half-width of the reservation (hatched while it's opening)
  hatched: boolean; // the reservation here is a painted ghost island, not a kerbed one
  lanes: number; // general lanes each way, counting a tapering lane as a fraction
  lane: number; // lane width
  kerb: number; // centreline to kerb
  back: number; // centreline to back of footway / verge
}
export function sectionAt(net: Network, s: RSeg, t: number, ends: Ends2 = taperOf(net, s)): Section2 {
  const d = net.def(s), L = net.length(s);
  const own = { median: d.median / 2, lanes: d.lanes, lane: d.lane, extra: kerbOf(d) - d.median / 2 - d.lanes * d.lane, back: halfOf(d) - kerbOf(d) };
  let T: Taper | null = null, u = Infinity;
  if (ends.A && t < ends.A.len) { T = ends.A; u = t; }
  if (ends.B && L - t < ends.B.len && L - t < u) { T = ends.B; u = L - t; }
  if (!T) return { median: own.median, hatched: false, lanes: own.lanes, lane: own.lane, kerb: kerbOf(d), back: halfOf(d) };
  const n = T.to, x = u / T.len;
  const to = { median: n.median / 2, lanes: n.lanes, lane: n.lane, extra: kerbOf(n) - n.median / 2 - n.lanes * n.lane, back: halfOf(n) - kerbOf(n) };
  const km = smooth((x - TAPER.hold) / (TAPER.median - TAPER.hold)), kl = smooth((x - TAPER.median) / (1 - TAPER.median));
  const median = to.median + (own.median - to.median) * km;
  const lanes = to.lanes + (own.lanes - to.lanes) * kl;
  const lane = to.lane + (own.lane - to.lane) * km;
  const extra = to.extra + (own.extra - to.extra) * km;
  const kerb = median + lanes * lane + extra;
  return { median, hatched: km < 0.999 && own.median > to.median, lanes, lane, kerb, back: kerb + to.back + (own.back - to.back) * km };
}

// Where general lane `lane` (0 = nearside) is usable when driving along s away from node `from`:
// [start, end] in metres from `from`. A lane that tapers away is usable until it's half gone.
export function laneSpan(net: Network, s: RSeg, from: number, lane: number, ends: Ends2 = taperOf(net, s)): [number, number] {
  const d = net.def(s), L = net.length(s);
  if (lane >= d.lanes) return [L, L];
  let s0 = 0, s1 = L;
  const half = TAPER.median + (1 - TAPER.median) / 2;
  for (const T of [ends.A, ends.B]) {
    if (!T || lane < T.to.lanes) continue;
    const gone = T.len * half; // metres from the join where the lane is half its width
    const nearFrom = (T.atA && from === s.a) || (!T.atA && from === s.b);
    if (nearFrom) s0 = Math.max(s0, gone); // the lane opens up after the join
    else s1 = Math.min(s1, L - gone); // the lane ends before the join
  }
  return [s0, Math.max(s0, s1)];
}
export const roadDef = (id: string) => ROADS[id];
