// Fixes from the adversarial review of the railway (docs/rail.md): each test is one of the ways it
// could be broken.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng } from '../roads';
import { TRAINS } from '../catalog';
import { Traffic, type Places } from '../traffic';
import { TrackGraph, type StationWorks } from './track';
import { RailSim, type RailLine, type Train } from './sim';
import { Railway } from './railway';

const DAY = 360;
function branch(len = 4000) {
  const net = new Network(() => false, 6000);
  net.build({ x: -len / 2, z: 0 }, { x: len / 2, z: 0 }, undefined, { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' });
  const seg = [...net.segs.values()][0];
  return { net, seg, L: net.length(seg) };
}
// every train keeps calling: its calls over the last day, and whether any two ever shared a block
function run(sim: RailSim, days: number) {
  let shared = 0;
  const before = new Map<number, number>();
  for (let i = 0; i < (days * DAY) / 0.1; i++) {
    sim.update(0.1);
    if (i === Math.round(((days - 1) * DAY) / 0.1)) for (const t of sim.trains) before.set(t.id, t.calls);
    const occ = sim.trains.map((x) => sim.occupied(x));
    for (let a = 0; a < occ.length; a++) for (let b = a + 1; b < occ.length; b++) for (const k of occ[a]) if (occ[b].has(k)) shared++;
  }
  return { shared, lastDay: sim.trains.map((t) => t.calls - (before.get(t.id) ?? 0)) };
}

describe('rail review', () => {
  it('counts every line sharing a single line against its passing places (two lines, one loop)', () => {
    const { net, seg, L } = branch();
    const works: StationWorks[] = [
      { id: 1, seg: seg.id, s0: 20, s1: 150, layout: 'side', loop: false, side: 1, depot: { end: 1, side: 1, len: 60 } },
      { id: 2, seg: seg.id, s0: L / 2 - 70, s1: L / 2 + 70, layout: 'island', loop: true, side: 1 },
      { id: 3, seg: seg.id, s0: L - 360, s1: L - 230, layout: 'side', loop: false, side: -1, depot: { end: 1, side: 1, len: 60 } },
    ];
    const sim = new RailSim(new TrackGraph(net, works));
    const a: RailLine = { id: 1, num: 1, stops: [1, 2, 3], loop: false, depot: 1 }, b: RailLine = { id: 2, num: 2, stops: [3, 2, 1], loop: false, depot: 3 };
    sim.lines.push(a, b);
    const got = [sim.addTrain(TRAINS.dmu, a), sim.addTrain(TRAINS.dmu, a), sim.addTrain(TRAINS.dmu, b), sim.addTrain(TRAINS.dmu, b)];
    expect(got.filter((x) => typeof x !== 'string').length).toBe(2);
    expect(got.find((x) => typeof x === 'string')).toMatch(/share a single line/);
    const r = run(sim, 4);
    expect(r.shared).toBe(0);
    expect(sim.stats.redPassed).toBe(0);
    for (const n of r.lastDay) expect(n).toBeGreaterThan(2);
  }, 60_000);

  it('keeps a circular line with a halt running (three trains, two loops)', () => {
    const net = new Network(() => false, 6000);
    const o = { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' as const, grade: 0.03 };
    const P = [{ x: -1200, z: -500 }, { x: 1200, z: -500 }, { x: 1200, z: 500 }, { x: -1200, z: 500 }];
    net.build(net.snapStart(P[0], 2, 'rail'), net.snapStart(P[1], 2, 'rail'), undefined, o);
    net.build(net.snapStart(P[1], 2, 'rail'), net.snapStart(P[2], 2, 'rail'), { x: 1800, z: 0 }, o);
    net.build(net.snapStart(P[2], 2, 'rail'), net.snapStart(P[3], 2, 'rail'), undefined, o);
    net.build(net.snapStart(P[3], 2, 'rail'), net.snapStart(P[0], 2, 'rail'), { x: -1800, z: 0 }, o);
    const segs = [...net.segs.values()], s1 = segs[0], s3 = segs[2], L1 = net.length(s1), L3 = net.length(s3);
    const works: StationWorks[] = [
      { id: 1, seg: s1.id, s0: L1 / 2 - 70, s1: L1 / 2 + 70, layout: 'island', loop: true, side: 1 },
      { id: 2, seg: s3.id, s0: L3 / 2 - 70, s1: L3 / 2 + 70, layout: 'island', loop: true, side: 1 },
      { id: 3, seg: s3.id, s0: L3 * 0.2 - 30, s1: L3 * 0.2 + 30, layout: 'side', loop: false, side: 1 },
    ];
    const sim = new RailSim(new TrackGraph(net, works));
    const a: RailLine = { id: 1, num: 1, stops: [1, 3, 2], loop: true };
    sim.lines.push(a);
    for (let i = 0; i < 3; i++) expect(typeof sim.addTrain(TRAINS.dmu, a)).toBe('object');
    const r = run(sim, 4);
    expect(r.shared).toBe(0);
    // (a lap of the 7.5 km ring takes most of a game day: still calling on the last one)
    for (const n of r.lastDay) expect(n).toBeGreaterThan(0);
  }, 60_000);

  it('takes trains still waiting in the depot away with their line, and frees every block', () => {
    const { net, seg, L } = branch();
    const rw = new Railway(net);
    rw.rebuild();
    const A = rw.build(rw.plan(seg.id, 200, 1, 60).plans[0]).station, B = rw.build(rw.plan(seg.id, L - 400, 1, 60).plans[0]).station;
    const line = rw.addLine([A.id, B.id], false, [TRAINS.dmu, TRAINS.dmu]);
    expect(typeof line).toBe('object');
    for (let i = 0; i < 100; i++) rw.update(0.1);
    rw.removeLine(line as RailLine);
    for (let i = 0; i < 3000; i++) rw.update(0.1);
    expect(rw.trains.length).toBe(0);
    expect(rw.sim.waiting).toBe(0);
    expect([...rw.sim.owner].every((o) => o === 0)).toBe(true);
  });

  it('keeps level crossings clear of road junctions, both ways round', () => {
    const net = new Network(() => false, 3000);
    net.build({ x: 0, z: -1000 }, { x: 0, z: 1000 }, undefined, { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' });
    net.build({ x: 12, z: -300 }, { x: 12, z: 300 }, undefined, { ...DEFAULT_OPTS, type: 'street' });
    // a street across the railway and, 12 m on, the other street: never a level crossing there
    const c1 = net.check({ x: -300, z: 0 }, { x: 300, z: 0 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    expect(c1.ok && c1.bridges === 0 && c1.raised === 0).toBe(false);
    // a crossing well clear of it, then a side street joining that road right by the crossing: refused
    net.build({ x: -300, z: 500 }, { x: 300, z: 500 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    const road = [...net.segs.values()].find((s) => net.def(s).cls === 'road' && Math.abs(net.path(s)[0].z - 500) < 1 && net.path(s)[0].x < 0)!;
    const side = net.check(net.snapStart({ x: -8, z: 500 }, 2), { x: -8, z: 800 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    expect(road).toBeTruthy();
    expect(side.ok).toBe(false);
    expect(side.reason).toMatch(/level crossing/);
  });

  it('holds trains at signals clear of the points, so bodies never overlap', () => {
    const { net, seg, L } = branch();
    const works: StationWorks[] = [
      { id: 1, seg: seg.id, s0: 20, s1: 150, layout: 'side', loop: false, side: 1, depot: { end: 1, side: 1, len: 60 } },
      { id: 2, seg: seg.id, s0: L / 2 - 70, s1: L / 2 + 70, layout: 'island', loop: true, side: 1 },
      { id: 3, seg: seg.id, s0: L - 150, s1: L - 20, layout: 'side', loop: false, side: -1 },
    ];
    const sim = new RailSim(new TrackGraph(net, works));
    const a: RailLine = { id: 1, num: 1, stops: [1, 2, 3], loop: false, depot: 1 };
    sim.lines.push(a);
    sim.addTrain(TRAINS.dmu, a); sim.addTrain(TRAINS.dmu, a);
    const pts = (t: Train) => Array.from({ length: Math.ceil(t.length / 4) + 1 }, (_, i) => sim.pose(t, Math.min(t.length, i * 4)));
    let close = Infinity;
    for (let i = 0; i < (DAY * 3) / 0.1; i++) {
      sim.update(0.1);
      if (sim.trains.length < 2 || i % 5) continue;
      const [p, q] = sim.trains.map(pts);
      for (const x of p) for (const y of q) close = Math.min(close, Math.hypot(x.x - y.x, x.z - y.z));
    }
    // (two tracks of a loop are 8.9 m apart; a train fouling the points would come within a couple of metres)
    expect(close).toBeGreaterThan(3.5);
  }, 60_000);

  it('never shuts the road for long because a car stopped on the crossing', () => {
    const net = new Network(() => false, 2000);
    net.build({ x: 0, z: -1400 }, { x: 0, z: 1400 }, undefined, { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' });
    net.build({ x: -600, z: 30 }, { x: 600, z: 30 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    for (const id of net.segs.keys()) for (const l of net.plotsFor(id, { x: 999, z: 999 })) if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
    const rw = new Railway(net);
    rw.rebuild();
    const rs = [...net.segs.values()].find((s) => net.def(s).cls === 'rail')!, L = net.length(rs);
    const a = rw.build(rw.plan(rs.id, 200, 1, 60).plans[0]).station, b = rw.build(rw.plan(rs.id, L - 200, 1, 60).plans[0]).station;
    const traffic = new Traffic(net, new THREE.Scene(), rng(5));
    rw.useRoads(traffic);
    rw.addLine([a.id, b.id], false, [TRAINS.dmu, TRAINS.dmu]);
    const lots = net.lots, places: Places = { homes: lots.filter((_, i) => i % 2 === 0), jobs: lots.filter((_, i) => i % 2 === 1), shops: [], works: [], weight: () => 1 };
    let shut = 0, longest = 0;
    for (let i = 0; i < (DAY * 2) / 0.05; i++) {
      traffic.generate(places, 8.2, 4, i * 50); traffic.update(0.05, i * 50); rw.update(0.05);
      shut = rw.sim.crossings[0].holding ? shut + 0.05 : 0;
      longest = Math.max(longest, shut);
    }
    expect(longest).toBeLessThan(75);
  }, 120_000);
});
