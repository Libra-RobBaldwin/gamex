// A motorway junction as a blueprint: drawing a motorway across a road offers "Junction here", and
// the junction is tried on a copy of the network (build.scratch) so the card can say what it costs,
// what it knocks down and why it can't be built, and the ghost can show every piece, before
// anything changes. Building it for real is then the same call on the real network.
import { CLEAR_COST, RAISE_COST, closestOnPath, pathLength, type Lot, type Network, type P, type RSeg } from '../roads';
import { crossingOf, motorwayWithJunction, scratch, type IxForm, type IxSize, type SlipStyle } from './build';

export interface IxPlan { ok: boolean; reason?: string; cost: number; clears: Lot[]; ghost: { path: P[]; half: number }[] }

// The road a motorway blueprint crosses that a junction could serve: the first one along it (an
// ordinary two-way road, not another motorway or a railway), and where.
export function roadCrossed(net: Network, mw: P[]): RSeg | null {
  let best: { seg: RSeg; s: number } | null = null;
  for (const s of net.segs.values()) {
    const d = net.def(s);
    if (d.cls !== 'road' || d.family === 'Motorway' || s.oneway) continue;
    const x = crossingOf(mw, net.path(s));
    if (x && (!best || x.s < best.s)) best = { seg: s, s: x.s };
  }
  return best?.seg ?? null;
}

export function planJunction(net: Network, form: IxForm, style: SlipStyle, mw: P[], type: string, road: RSeg, size: IxSize = 'open'): IxPlan {
  const s = scratch(net), had = new Set(net.segs.keys());
  const r = motorwayWithJunction(s, form, mw, type, s.segs.get(road.id)!, 0, style, size);
  if (!r.ok) return { ok: false, reason: r.reason, cost: 0, clears: [], ghost: [] };
  // every new road's price by the metre, and its embankments and bridges as check() prices a raised road
  let cost = 0;
  const ghost: IxPlan['ghost'] = [];
  const old = net.path(road);
  for (const x of s.segs.values()) {
    if (had.has(x.id)) continue;
    const path = s.path(x), d = s.def(x);
    // (what's left of the local road, split where the junction meets it, is already paid for)
    if (x.type === road.type && !x.oneway && path.every((p) => closestOnPath(p, old).d < 1 && Math.abs(p.y ?? 0) < 0.1)) continue;
    cost += pathLength(path) * d.cost;
    for (let i = 1; i < path.length; i++) { const ym = ((path[i].y ?? 0) + (path[i - 1].y ?? 0)) / 2; if (ym > 0) cost += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) * ym * RAISE_COST; }
    ghost.push({ path, half: s.half(x) });
  }
  const clears = net.lots.filter((l) => !s.lots.includes(l));
  return { ok: true, cost: Math.round(cost + clears.length * CLEAR_COST), clears, ghost };
}
