// Bus lines: a bus on a line drives the shortest way to each of its stops in turn and calls at
// nothing else, arriving on whichever side of the road it comes along.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { rng } from '../roads';
import { Traffic, type BusLine } from '../traffic';
import { SCENARIOS, town } from '../trafficsim';
import { starterStops } from './crowdsites';

function run(stopsAt: { x: number; z: number }[], seconds: number, buses = 2) {
  const sc = SCENARIOS.find((s) => s.name === 'the starter town')!;
  const { net, junctions, places } = town({ ...sc, buses: 0 });
  starterStops(net);
  const traffic = new Traffic(net, new THREE.Scene(), rng(3));
  traffic.junctions = junctions;
  // the stop nearest each point, then its place (it and the stop facing it)
  const all = [...net.segs.values()].flatMap((seg) => seg.stops.map((st) => ({ seg, st, p: net.path(seg) })));
  const near = (q: { x: number; z: number }) => all.map((o) => {
    const L = net.length(o.seg); let best = Infinity;
    for (let i = 0; i < o.p.length; i++) best = Math.min(best, Math.hypot(o.p[i].x - q.x, o.p[i].z - q.z));
    return { o, d: best + Math.abs(o.st.s - L / 2) * 0 };
  }).sort((a, b) => a.d - b.d)[0].o.st.id;
  const ids = stopsAt.map(near);
  const line: BusLine = { id: 1, seq: [...ids, ...ids.slice(1, -1).reverse()] };
  const calls = new Map<number, number[]>();
  traffic.onBusStop = (_seg, st, bus) => { let l = calls.get(bus); if (!l) calls.set(bus, (l = [])); l.push(st.id); return 5; };
  const mine = new Set<number>();
  for (let i = 0; i < buses; i++) { const c = traffic.addBus(undefined, line); if (c) mine.add(c.id); }
  traffic.addBus(); // and one wandering, off any line
  const dt = 1 / 30, level = (60 * 16) / Math.max(1, places.homes.length) / 1.25;
  for (let i = 0; i < seconds / dt; i++) { const now = i * dt * 1000; traffic.generate(places, 8.2, level, now); traffic.update(dt, now); }
  const placeOf = (id: number) => ids.findIndex((k) => traffic.place(k)!.stops.some((s) => s.id === id));
  return { traffic, line, ids, calls, mine, placeOf };
}

describe('bus lines', () => {
  it('call only at their stops, in order, both ways along the line', () => {
    const { calls, mine, placeOf, line } = run([{ x: -85, z: 0 }, { x: 120, z: 0 }, { x: 0, z: 150 }], 600);
    expect(mine.size).toBe(2);
    for (const id of mine) {
      const seq = (calls.get(id) ?? []).map(placeOf);
      expect(seq.length, `calls by bus ${id}`).toBeGreaterThanOrEqual(4);
      expect(seq.every((k) => k >= 0), `bus ${id} called only at its line's stops: ${seq}`).toBe(true);
      // each call is the next in the line's order (A B C B A B ...), from wherever it started
      const order = line.seq.map((k) => placeOf(k));
      const start = order.indexOf(seq[0]);
      seq.forEach((k, i) => expect(k, `call ${i} of bus ${id}: ${seq}`).toBe(order[(start + i) % order.length]));
    }
  }, 120_000);
  it('route round a loop to reach a stop on the far side of the road', () => {
    // two stops: after calling at one side, the far side of the same road needs a way round
    const { calls, mine, placeOf } = run([{ x: -85, z: 0 }, { x: 0, z: 150 }], 300, 1);
    const seq = (calls.get([...mine][0]) ?? []).map(placeOf);
    expect(seq.length).toBeGreaterThanOrEqual(3);
    expect(seq.every((k) => k >= 0)).toBe(true);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  }, 120_000);
});
