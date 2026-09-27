// From the logic review of 26 Sep 2026 (docs/reports/review-2026-09-26.md, bug 2): a road joined
// onto a stop's road where the stop stands. Network.split used to drop every stop straddling the
// join, both poles of a pair, with no warning; Lines.prune then took the call off the line, a
// two-stop line went altogether, and its buses with it, unpaid. The stops now stay on the half each
// lies on (hard against the new junction), and Network.check reports them (`stops`) so the road tool
// can warn. These are the two tests the review wrote, on the game's real modules.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, rng, subPath } from '../roads';
import { Traffic } from '../traffic';
import { SCENARIOS, town } from '../trafficsim';
import { starterStops } from './crowdsites';
import { Lines } from './lines';
import { Purse } from './money';

const SC = SCENARIOS.find((s) => s.name === 'the starter town')!;

// the starter town with its stops, a two-stop line with two buses, and a purse
function world() {
  const made = town({ ...SC, buses: 0 });
  const net = made.net;
  starterStops(net);
  const traffic = new Traffic(net, new THREE.Scene(), rng(5));
  traffic.junctions = made.junctions;
  const lines = new Lines(traffic);
  const purse = new Purse();
  const stops = [...net.segs.values()].flatMap((s) => s.stops.map((st) => st.id));
  const places = [...new Set(stops.map((id) => Math.min(...traffic.place(id)!.stops.map((s) => s.id))))];
  lines.add([places[0], places[1]], false, 2);
  return { net, traffic, lines, purse };
}

describe('a road joined where a stop stands', () => {
  function join(w: ReturnType<typeof world>) {
    const l = w.lines.list[0], tapped = l.stops[0], pl = w.traffic.place(tapped)!;
    const path = w.net.path(pl.seg), at = subPath(path, Math.max(0, pl.stops[0].s - 0.5), pl.stops[0].s + 0.5)[0];
    const dx = path[path.length - 1].x - path[0].x, dz = path[path.length - 1].z - path[0].z, n = Math.hypot(dx, dz) || 1;
    const a = w.net.snapStart({ x: at.x, z: at.z }, 6), b = { x: at.x - (dz / n) * 120, z: at.z + (dx / n) * 120 }; // (a street off it, at right angles)
    const c = w.net.check(a, b, undefined, { ...DEFAULT_OPTS, type: 'street' });
    const before = w.lines.buses(l).length, balance = w.purse.balance, stops = [...w.net.segs.values()].reduce((k, s) => k + s.stops.length, 0);
    if (c.ok) w.net.build(a, b, undefined, { ...DEFAULT_OPTS, type: 'street' });
    w.traffic.invalidate();
    w.lines.prune();
    const stopsAfter = [...w.net.segs.values()].reduce((k, s) => k + s.stops.length, 0);
    return { l, check: c, before, balance, stops, stopsAfter, pl };
  }
  it('warns, or keeps the stop and the line', () => {
    const w = world();
    const r = join(w);
    expect(r.check.ok, `Network.check: ${r.check.reason}`).toBe(true); // (nothing stops the road being built there)
    expect(r.stopsAfter, `${r.stops} stops before the road, ${r.stopsAfter} after`).toBe(r.stops);
    expect(w.lines.list).toContain(r.l);
  });
  it('or at least refunds the buses the line loses', () => {
    const w = world();
    const r = join(w);
    const after = w.lines.list.includes(r.l) ? w.lines.buses(r.l).length : 0;
    expect(r.before).toBe(2);
    expect(after === r.before || w.purse.balance > r.balance || w.purse.today.sold > 0, `${r.before} buses before, ${after} after, balance ${r.balance} -> ${w.purse.balance}, sold ${w.purse.today.sold}`).toBe(true);
  });
  // (the road tool's warning: check() names the stops the road would land on, both poles of the pair)
  it('check() reports the stops the road would land on, and they stay a pair on one half', async () => {
    const w = world();
    const r = join(w);
    expect(r.check.stops.map((s) => s.id).sort()).toEqual(r.pl.stops.map((s) => s.id).sort());
    const again = w.traffic.place(r.pl.stops[0].id)!;
    expect(again.stops.length).toBe(r.pl.stops.length);
    for (const st of again.stops) { expect(st.s).toBeGreaterThan(0); expect(st.s).toBeLessThan(w.net.length(again.seg)); }
    // moved clear of the new junction, as a new stop must be (the road's half-width and 6 m), the pair together
    const { stopSpan } = await import('../roads');
    const L = w.net.length(again.seg), half = w.net.half(again.seg), atA = w.net.segsAt(again.seg.a).length > 2, atB = w.net.segsAt(again.seg.b).length > 2;
    for (const st of again.stops) {
      const [s0, s1] = stopSpan(st);
      if (atA) expect(s0, `stop ${st.id} clear of the junction at a`).toBeGreaterThanOrEqual(half + 6 - 1e-6);
      if (atB) expect(L - s1, `stop ${st.id} clear of the junction at b`).toBeGreaterThanOrEqual(half + 6 - 1e-6);
    }
    const gap = Math.abs(again.stops[0].s - again.stops[1].s), was = Math.abs(r.pl.stops[0].s - r.pl.stops[1].s);
    expect(gap).toBeCloseTo(was, 3);
    // and a road joined clear of every stop reports none, one across a stop's road at the stop reports it
    const { Network } = await import('../roads');
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: 300, z: 0 });
    n.addStop(id, 60, 1, n.planStop(id, 60, 1).plans[0]);
    expect(n.check(n.snapStart({ x: 200, z: 0 }, 3), { x: 200, z: 120 }, undefined, { ...DEFAULT_OPTS, type: 'street' }).stops).toEqual([]);
    expect(n.check(n.snapStart({ x: 60, z: 0 }, 3), { x: 60, z: 120 }, undefined, { ...DEFAULT_OPTS, type: 'street' }).stops.map((st) => st.s)).toEqual([60]);
    expect(n.check({ x: 60, z: -120 }, { x: 60, z: 120 }, undefined, { ...DEFAULT_OPTS, type: 'street' }).stops.map((st) => st.s)).toEqual([60]);
  });
});
