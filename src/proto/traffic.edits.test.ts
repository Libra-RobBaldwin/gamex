// The player's edits under the traffic (docs/reports/review-2026-09-26.md, the vehicles rows): a
// road split by a new junction carries everyone on it over onto the right half; a road taken
// away under a line's bus sends the bus to the depot, not out of existence; a bus bought with no
// room to start waits and comes out when there is; a line that loses a call keeps its buses on
// the same call or the next one made.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng } from './roads';
import { Traffic } from './traffic';
import { SCENARIOS, town } from './trafficsim';
import { starterStops } from './game/crowdsites';
import { Lines } from './game/lines';

type CarView = { id: number; bus?: boolean; seg: { id: number; a: number; b: number }; from: number; s: number; v: number; route: number[]; goal: number; gone?: number; turn?: { next: { id: number } }; line?: { seq: number[] }; leg?: number };
const cars = (traffic: Traffic) => traffic.cars as unknown as CarView[];

// the starter town with its stops, a Lines ledger on its traffic, and the stop nearest each point
function setup(seed = 3) {
  const sc = SCENARIOS.find((s) => s.name === 'the starter town')!;
  const { net, junctions, places } = town({ ...sc, buses: 0 });
  starterStops(net);
  const traffic = new Traffic(net, new THREE.Scene(), rng(seed));
  traffic.junctions = junctions;
  const lines = new Lines(traffic);
  const all = [...net.segs.values()].flatMap((seg) => seg.stops.map((st) => ({ seg, st, p: net.path(seg) })));
  const near = (q: { x: number; z: number }) => all.map((o) => {
    let best = Infinity;
    for (const p of o.p) best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z));
    return { o, d: best };
  }).sort((a, b) => a.d - b.d)[0].o.st.id;
  const dt = 1 / 30, level = (60 * 16) / Math.max(1, places.homes.length) / 1.25;
  let i = 0;
  const run = (seconds: number, each?: (now: number) => boolean | void, quiet = false) => {
    for (const end = i + Math.round(seconds / dt); i < end; i++) {
      const now = i * dt * 1000;
      if (!quiet) traffic.generate(places, 8.2, level, now);
      traffic.update(dt, now);
      if (each?.(now)) return true;
    }
    return false;
  };
  const midOf = (segId: number) => { const seg = net.segs.get(segId)!, p = net.path(seg), L = net.length(seg); let d = 0; for (let k = 1; k < p.length; k++) { const dd = Math.hypot(p[k].x - p[k - 1].x, p[k].z - p[k - 1].z); if (d + dd >= L / 2) { const f = (L / 2 - d) / dd; return { x: p[k - 1].x + (p[k].x - p[k - 1].x) * f, z: p[k - 1].z + (p[k].z - p[k - 1].z) * f }; } d += dd; } return p[0]; };
  return { net, traffic, lines, near, run, midOf };
}

describe('a road split under the traffic', () => {
  it('carries every car over onto the half it is on, and their ways through it onto both halves', () => {
    const { net, traffic, run, midOf } = setup(4);
    run(90);
    // a road with cars on it and cars routed through it, clear of stops, long enough to split
    const on = new Map<number, number>(), through = new Map<number, number>();
    for (const c of cars(traffic)) {
      if (c.gone !== undefined || c.bus) continue;
      on.set(c.seg.id, (on.get(c.seg.id) ?? 0) + 1);
      for (const id of c.route) through.set(id, (through.get(id) ?? 0) + 1);
    }
    const pick = [...net.segs.values()].filter((s) => !s.stops.length && net.def(s).cls === 'road' && net.length(s) > 60 && (on.get(s.id) ?? 0) > 0 && (through.get(s.id) ?? 0) > 0).sort((a, b) => (on.get(b.id)! + through.get(b.id)!) - (on.get(a.id)! + through.get(a.id)!))[0];
    expect(pick, 'a road with cars on it and routed through it').toBeTruthy();
    const affected = cars(traffic).filter((c) => c.gone === undefined && (c.seg.id === pick.id || c.route.includes(pick.id)));
    const was = new Map(affected.map((c) => [c.id, { seg: c.seg.id, s: c.s, from: c.from, route: [...c.route], goal: c.goal }]));
    const m = midOf(pick.id), p = net.path(pick), dx = p[p.length - 1].x - p[0].x, dz = p[p.length - 1].z - p[0].z, n = Math.hypot(dx, dz) || 1;
    const c = net.check(net.snapStart(m, 3), { x: m.x - (dz / n) * 70, z: m.z + (dx / n) * 70 }, undefined, { ...DEFAULT_OPTS, type: 'street' });
    expect(c.ok, c.reason).toBe(true);
    net.build(net.snapStart(m, 3), { x: m.x - (dz / n) * 70, z: m.z + (dx / n) * 70 }, undefined, { ...DEFAULT_OPTS, type: 'street' });
    expect(net.segs.has(pick.id)).toBe(false);
    traffic.invalidate();
    const halves = [...net.segs.values()].filter((s) => (s.a === pick.a && s.b !== pick.b) || (s.b === pick.b && s.a !== pick.a)).filter((s) => s.type === pick.type);
    expect(halves.length).toBeGreaterThanOrEqual(2);
    for (const c of affected) {
      const w = was.get(c.id)!;
      expect(c.gone, `car ${c.id} (was on ${w.seg} at ${w.s.toFixed(1)}, route ${w.route}) is still here`).toBeUndefined();
      expect(net.segs.has(c.seg.id)).toBe(true);
      for (const id of c.route) expect(net.segs.has(id), `route seg ${id} of car ${c.id} exists`).toBe(true);
      if (w.seg === pick.id) {
        // on one half, no further along than it was, measured from an end of that half
        expect(halves.map((h) => h.id)).toContain(c.seg.id);
        expect(c.s).toBeLessThanOrEqual(w.s + 1e-6);
        expect(c.s).toBeLessThanOrEqual(net.length(c.seg as never) + 1e-6);
        expect([c.seg.a, c.seg.b]).toContain(c.from);
      }
      if (w.route.includes(pick.id)) {
        // its way on: the old road's place taken by its halves, in order, and the goal on the last still on it
        const i = w.route.indexOf(pick.id);
        expect(c.route.slice(0, i)).toEqual(w.route.slice(0, i));
        expect(halves.map((h) => h.id)).toContain(c.route[i]);
        if (i === w.route.length - 1) expect(c.goal).toBeLessThanOrEqual(w.goal + 1e-6);
      }
    }
    // and they all drive on: nobody gives up for want of a road
    const gaveUp = traffic.stats.gaveUp;
    run(30);
    expect(traffic.stats.gaveUp - gaveUp).toBeLessThanOrEqual(2);
  }, 120_000);
});

describe('a line’s buses when their road goes', () => {
  it('a road bulldozed under a bus sends it to the depot, and it comes back at its next call', () => {
    const { net, traffic, lines, near, run } = setup(6);
    const l = lines.add([near({ x: -85, z: 0 }), near({ x: 120, z: 0 })], false, 2);
    run(60);
    const bus = cars(traffic).find((c) => c.bus && c.gone === undefined && !c.turn && !c.seg.a && false) ?? cars(traffic).find((c) => c.bus && c.gone === undefined && !c.turn && !net.segs.get(c.seg.id)!.stops.length);
    expect(bus, 'a bus on a road with no stops').toBeTruthy();
    net.removeSeg(bus!.seg.id);
    traffic.invalidate(); lines.prune();
    expect(lines.list).toContain(l);
    expect(traffic.busesOn(l.id).length, 'the line still has both buses').toBe(2);
    expect(traffic.depot.map((c) => c.id)).toContain(bus!.id);
    expect(traffic.bus(bus!.id)?.waiting).toBe(true);
    const back = run(60, () => !traffic.depot.length);
    expect(back, 'the bus is back on the road within a minute').toBe(true);
    expect(traffic.busesOn(l.id).length).toBe(2);
    expect(cars(traffic).find((c) => c.id === bus!.id && c.gone === undefined)).toBeTruthy();
    run(30);
    expect(traffic.busesOn(l.id).length).toBe(2);
  }, 120_000);

  it('a bus bought with no room to start waits in the depot and comes out when there is', () => {
    // one short road: room for a few buses, not more
    const net = new Network();
    const [id] = net.build({ x: 0, z: 0 }, { x: 80, z: 0 });
    net.addStop(id, 40, 1, net.planStop(id, 40, 1).plans[0]);
    net.addStop(id, 40, -1, net.planStop(id, 40, -1).plans[0]);
    const traffic = new Traffic(net, new THREE.Scene(), rng(1));
    const lines = new Lines(traffic);
    const stops = net.segs.get(id)!.stops.map((s) => s.id);
    const l = lines.add([stops[0], stops[1]], false, 0);
    const got: number[] = [];
    for (let i = 0; i < 12; i++) { const c = lines.addBus(l); expect(c, 'a bus for a line always comes').toBeTruthy(); got.push(c!.id); }
    expect(traffic.depot.length, 'some had no room').toBeGreaterThan(0);
    expect(traffic.busesOn(l.id).length).toBe(12);
    const onRoad = got.filter((x) => !traffic.depot.some((c) => c.id === x));
    // sell the ones on the road: the waiting ones take their places
    for (const x of onRoad) traffic.removeBus(x);
    let now = 0;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 60 && traffic.depot.length > 12 - onRoad.length - 1; i++) { now = i * dt * 1000; traffic.update(dt, now); }
    expect(traffic.busesOn(l.id).length).toBe(12 - onRoad.length);
    expect(traffic.cars.filter((c) => (c as unknown as CarView).gone === undefined).length).toBeGreaterThan(0);
  });
});

describe('a line that loses a call', () => {
  it('keeps each bus on the same call, or the next one still made', () => {
    const { traffic, lines, near } = setup(5);
    const A = near({ x: -85, z: 0 }), B = near({ x: 120, z: 0 }), C = near({ x: 0, z: 150 });
    const l = lines.add([A, B, C], false, 0);
    expect(l.bus.seq).toEqual([A, B, C, B]);
    const buses = [0, 1, 2, 3].map((leg) => traffic.addBus(undefined, l.bus, leg)!);
    for (const [i, c] of buses.entries()) expect((c as unknown as CarView).leg).toBe(i);
    traffic.setLineSeq(l.bus, [B, C]); // A lost
    expect(buses.map((c) => (c as unknown as CarView).leg)).toEqual([0, 0, 1, 0]); // A→B out, B out, C, B back→B out (the line now turns at C)
    traffic.setLineSeq(l.bus, [B, C, A, C]); // back to A, B, C order with A last: [B, C, A, C]
    // heading for B (0), B (0), C out (1), B (0) stay where they point
    expect(buses.map((c) => (c as unknown as CarView).leg)).toEqual([0, 0, 1, 0]);
  });
});
