// Level crossings: where a road crosses the railway at the same height (docs/rail.md).
//
// UK automatic half-barrier practice, simplified: when a train's reservation is about to take in
// the crossing, the amber light shows (3 s), then the red lights flash and the barriers come down
// (6 s). The signal protecting the crossing only clears once the barriers are down and nothing is
// left on the crossing, so no car is ever on the track while a train holds its block. Once no
// train holds a block over the crossing any more, the barriers rise and the road opens again.
import { closestOnPath, intersect, pathLength, type Network, type P } from '../roads';
import { kerbOf } from '../catalog';

export interface CrossingSite {
  id: number; x: number; z: number; y: number;
  road: number; rail: number; // the network segs
  s: number; z0: number; z1: number; // along the road from its a end: the crossing's middle, and where the road is on the track (plus a margin)
  railS: number; // along the railway from its a end
  sin: number; // how square the road crosses (1: at right angles)
  ux: number; uz: number; // the railway's direction there
  rx: number; rz: number; // the road's
}
export type CrossingState = 'open' | 'amber' | 'lowering' | 'closed' | 'raising';
export const AMBER = 3, LOWER = 6, RAISE = 5;
export { MIN_SIN } from './rules';
const MARGIN = 1.5; // past the ballast, each side

export class LevelCrossing {
  state: CrossingState = 'open';
  t = 0; // seconds in this state
  closedFor = 0; // how long the road has been shut, this time
  constructor(readonly site: CrossingSite) {}
  // wanted: a train wants its block (or holds it)
  update(dt: number, wanted: boolean) {
    this.t += dt;
    if (this.state !== 'open') this.closedFor += dt;
    const go = (s: CrossingState) => { this.state = s; this.t = 0; };
    switch (this.state) {
      case 'open': if (wanted) { go('amber'); this.closedFor = 0; } break;
      case 'amber': if (this.t >= AMBER) go('lowering'); break;
      case 'lowering': if (this.t >= LOWER) go('closed'); break;
      case 'closed': if (!wanted) go('raising'); break;
      case 'raising': if (wanted) go('lowering'); else if (this.t >= RAISE) go('open'); break;
    }
  }
  // the road is told to stop (amber on, or barriers moving or down)
  get holding() { return this.state !== 'open'; }
  // 0 up … 1 down
  get barrier() {
    if (this.state === 'lowering') return Math.min(1, this.t / LOWER);
    if (this.state === 'closed') return 1;
    if (this.state === 'raising') return Math.max(0, 1 - this.t / RAISE);
    return 0;
  }
  // the barriers are down: a train may be let through once the crossing is clear
  get down() { return this.state === 'closed'; }
}

// Every place a railway crosses a road at the same height.
export function findCrossings(net: Network): CrossingSite[] {
  const segs = [...net.segs.values()];
  const rails = segs.filter((s) => net.def(s).cls === 'rail'), roads = segs.filter((s) => net.def(s).cls === 'road');
  const out: CrossingSite[] = [];
  const box = (p: P[]) => p.reduce((b, q) => [Math.min(b[0], q.x), Math.min(b[1], q.z), Math.max(b[2], q.x), Math.max(b[3], q.z)], [Infinity, Infinity, -Infinity, -Infinity]);
  const roadBox = new Map(roads.map((d) => [d.id, box(net.path(d))]));
  for (const r of rails) {
    const rp = net.path(r), half = kerbOf(net.def(r)), rb = box(rp);
    for (const d of roads) {
      const db = roadBox.get(d.id)!;
      if (db[0] > rb[2] || db[2] < rb[0] || db[1] > rb[3] || db[3] < rb[1]) continue;
      const dp = net.path(d);
      let acc = 0;
      for (let i = 1; i < rp.length; i++) {
        const A = rp[i - 1], B = rp[i], LA = Math.hypot(B.x - A.x, B.z - A.z);
        for (let j = 1; j < dp.length; j++) {
          const h = intersect(A, B, dp[j - 1], dp[j], true);
          if (!h) continue;
          const yr = (A.y ?? 0) + ((B.y ?? 0) - (A.y ?? 0)) * h.t, yd = (dp[j - 1].y ?? 0) + ((dp[j].y ?? 0) - (dp[j - 1].y ?? 0)) * h.u;
          if (Math.abs(yr - yd) > 0.5) continue; // one passes over the other
          const q = closestOnPath(h, dp), ux = (B.x - A.x) / (LA || 1), uz = (B.z - A.z) / (LA || 1);
          const sin = Math.abs(ux * q.uz - uz * q.ux), w = (half + MARGIN) / Math.max(0.3, sin);
          const railS = acc + h.t * LA;
          if (out.some((o) => o.rail === r.id && o.road === d.id && Math.abs(o.railS - railS) < 2)) continue;
          out.push({ id: out.length + 1, x: h.x, z: h.z, y: yr, road: d.id, rail: r.id, s: q.s, z0: q.s - w, z1: q.s + w, railS, sin, ux, uz, rx: q.ux, rz: q.uz });
        }
        acc += LA;
      }
    }
  }
  return out;
}

export { levelCrossingOk } from './rules';

// Where a car must stop for the crossing, going along its road from `from`, and where it's clear
// of it again (both measured from `from`).
export function zoneFrom(site: CrossingSite, L: number, fromA: boolean): [number, number] {
  return fromA ? [site.z0, site.z1] : [L - site.z1, L - site.z0];
}
export const roadLength = (net: Network, seg: number) => { const s = net.segs.get(seg); return s ? pathLength(net.path(s)) : 0; };
export type { P };
