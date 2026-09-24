// Stations, level crossings and the region's railway (docs/rail.md).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng } from '../roads';
import { TRAINS } from '../catalog';
import { Traffic, type Places } from '../traffic';
import { Railway } from './railway';
import { planRegionRail, layRegionRail, type RailSettlement } from './region';
import { callOrder } from './sim';

const rail = (net: Network, a: { x: number; z: number }, b: { x: number; z: number }, type = 'rail-main', o: Partial<typeof DEFAULT_OPTS> = {}) =>
  net.build(net.snapStart(a, 2, 'rail'), net.snapStart(b, 2, 'rail'), undefined, { ...DEFAULT_OPTS, type, cross: 'bridge', grade: 0.03, ...o });

describe('stations', () => {
  it('go on straight, level track, with a layout for each kind of line', () => {
    const net = new Network(() => false, 3000);
    rail(net, { x: -1200, z: 0 }, { x: 1200, z: 0 });
    rail(net, { x: -1200, z: 400 }, { x: 1200, z: 400 }, 'rail-branch');
    const rw = new Railway(net);
    rw.rebuild();
    const [dbl, sgl] = [...net.segs.values()];
    const d = rw.plan(dbl.id, 1200, 1), s = rw.plan(sgl.id, 1200, -1);
    expect(d.plans.map((p) => p.title)).toEqual(['Two side platforms', 'Island platform']);
    expect(s.plans.map((p) => p.title)).toEqual(['Passing loop, island platform', 'Passing loop, two platforms', 'One platform']);
    for (const p of [...d.plans, ...s.plans]) { expect(p.ok).toBe(true); expect(p.cost).toBeGreaterThan(300_000); }
    // and it takes its land: nothing else can be built on it
    const st = rw.build(s.plans[0]).station;
    expect(net.land.at({ x: st.x, z: st.z + 7 })?.owner).toBe('station');
    expect(net.land.at({ x: st.x, z: st.z - 7 })?.owner).toBe('station');
    expect(rw.plan(sgl.id, 1210, 1).reason).toMatch(/already a station/);
  });
  it('refuse a gradient, a curve, a bridge, and the ends of the track', () => {
    const net = new Network(() => false, 3000);
    // a line lifted over a road: on its ramps, and on the bridge
    net.build({ x: 0, z: -300 }, { x: 0, z: 300 }, undefined, { ...DEFAULT_OPTS, type: 'street' });
    rail(net, { x: -1000, z: 0 }, { x: 1000, z: 0 }, 'rail-branch', { grade: 0.025 });
    const rw = new Railway(net);
    rw.rebuild();
    const up = [...net.segs.values()].find((s) => net.def(s).cls === 'rail')!;
    for (const s of [1000, 800, 700]) {
      const r1 = rw.plan(up.id, s, 1);
      expect(r1.plans.length, `at ${s}`).toBe(0);
      expect(r1.reason).toMatch(/level|bridge|embankment/);
    }
    // a curve (a 700 m radius, sharper than a platform can stand)
    const n2 = new Network(() => false, 3000);
    n2.build({ x: -800, z: 0 }, { x: 800, z: 0 }, { x: 0, z: 900 }, { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' });
    const rw2 = new Railway(n2);
    rw2.rebuild();
    const cv = [...n2.segs.values()][0];
    const r2 = rw2.plan(cv.id, n2.length(cv) / 2, 1);
    expect(r2.reason).toMatch(/straight/);
    // right at the end of the line there isn't room for the loop's points
    const n3 = new Network(() => false, 3000);
    rail(n3, { x: 0, z: 0 }, { x: 300, z: 0 }, 'rail-branch');
    const rw3 = new Railway(n3);
    rw3.rebuild();
    expect(rw3.plan([...n3.segs.values()][0].id, 40, 1).plans.filter((p) => p.loop).length).toBe(0);
  });
  it('won’t take a train longer than its platforms', () => {
    const net = new Network(() => false, 3000);
    rail(net, { x: -1200, z: 0 }, { x: 1200, z: 0 });
    const rw = new Railway(net);
    rw.rebuild();
    const seg = [...net.segs.values()][0];
    const a = rw.build(rw.plan(seg.id, 400, 1, 60).plans[0]).station, b = rw.build(rw.plan(seg.id, 2000, 1, 60).plans[0]).station;
    expect(rw.addLine([a.id, b.id], false, [TRAINS.intercity])).toMatch(/Too long/);
    expect(typeof rw.addLine([a.id, b.id], false, [TRAINS.dmu])).toBe('object');
  });
});

describe('level crossings', () => {
  it('never let a car onto the track while a train holds its block', () => {
    const net = new Network(() => false, 2000);
    // a branch line north–south, and a street crossing it east–west on the level
    rail(net, { x: 0, z: -1400 }, { x: 0, z: 1400 }, 'rail-branch');
    const ids = net.build({ x: -600, z: 30 }, { x: 600, z: 30 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    expect(ids.length).toBe(1); // (not split: road and rail cross without joining)
    for (const id of net.segs.keys()) for (const l of net.plotsFor(id, { x: 999, z: 999 })) if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
    const rw = new Railway(net);
    rw.rebuild();
    expect(rw.crossings.length).toBe(1);
    const railSeg = [...net.segs.values()].find((s) => net.def(s).cls === 'rail')!;
    const L = net.length(railSeg);
    const a = rw.build(rw.plan(railSeg.id, 200, 1, 60).plans[0]).station, b = rw.build(rw.plan(railSeg.id, L - 200, 1, 60).plans[0]).station;
    const traffic = new Traffic(net, new THREE.Scene(), rng(5));
    rw.useRoads(traffic);
    const line = rw.addLine([a.id, b.id], false, [TRAINS.dmu, TRAINS.dmu]);
    expect(typeof line).toBe('object');
    const lots = net.lots;
    const places: Places = { homes: lots.filter((_, i) => i % 2 === 0), jobs: lots.filter((_, i) => i % 2 === 1), shops: [], works: [], weight: () => 1 };
    const c = rw.crossings[0];
    let onTrack = 0, heldFrames = 0, crossedWhileOpen = 0, closures = 0, was = false;
    const dt = 1 / 20;
    for (let i = 0; i < (360 * 2) / dt; i++) {
      const now = i * dt * 1000;
      traffic.generate(places, 8.2, 3, now);
      traffic.update(dt, now);
      rw.update(dt);
      const held = rw.graph.blocks.some((bk) => bk.crossings.includes(0) && rw.sim.owner[bk.id] !== 0);
      if (held) { heldFrames++; if (traffic.onStretch(c.road, c.z0, c.z1)) onTrack++; }
      else if (traffic.onStretch(c.road, c.z0, c.z1)) crossedWhileOpen++;
      if (held && !was) closures++;
      was = held;
    }
    expect(closures).toBeGreaterThan(3); // trains went over it, again and again
    expect(crossedWhileOpen).toBeGreaterThan(20); // cars used it in between
    expect(heldFrames).toBeGreaterThan(100);
    expect(onTrack).toBe(0);
    expect(rw.sim.stats.redPassed).toBe(0);
  }, 120_000);
  it('work where the road curves over the line', () => {
    const net = new Network(() => false, 2000);
    rail(net, { x: 0, z: -1400 }, { x: 0, z: 1400 }, 'rail-branch');
    // a road bending across the track (about square to it where they cross)
    const ids = net.build({ x: -400, z: -150 }, { x: 400, z: -150 }, { x: 0, z: 150 }, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    expect(ids.length).toBe(1);
    for (const id of net.segs.keys()) for (const l of net.plotsFor(id, { x: 999, z: 999 })) if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
    const rw = new Railway(net);
    rw.rebuild();
    expect(rw.crossings.length).toBe(1);
    const c = rw.crossings[0];
    expect(c.sin).toBeGreaterThan(0.9);
    expect(c.z1 - c.z0).toBeGreaterThan(5);
    const seg = [...net.segs.values()].find((s) => net.def(s).cls === 'rail')!, L = net.length(seg);
    const a = rw.build(rw.plan(seg.id, 300, 1, 60).plans[0]).station, b = rw.build(rw.plan(seg.id, L - 300, 1, 60).plans[0]).station;
    const traffic = new Traffic(net, new THREE.Scene(), rng(9));
    rw.useRoads(traffic);
    rw.addLine([a.id, b.id], false, [TRAINS.dmu]);
    const lots = net.lots, places: Places = { homes: lots.filter((_, i) => i % 2 === 0), jobs: lots.filter((_, i) => i % 2 === 1), shops: [], works: [], weight: () => 1 };
    let onTrack = 0, closures = 0, was = false, open = 0;
    for (let i = 0; i < 600 / 0.05; i++) {
      traffic.generate(places, 8.2, 3, i * 50); traffic.update(0.05, i * 50); rw.update(0.05);
      const held = rw.graph.blocks.some((bk) => bk.crossings.includes(0) && rw.sim.owner[bk.id] !== 0), on = traffic.onStretch(c.road, c.z0, c.z1);
      if (held && on) onTrack++;
      if (!held && on) open++;
      if (held && !was) closures++;
      was = held;
    }
    expect(closures).toBeGreaterThan(2);
    expect(open).toBeGreaterThan(20);
    expect(onTrack).toBe(0);
  }, 120_000);
  it('keep depot sidings off the road: a siding never runs over a crossing', () => {
    const net = new Network(() => false, 2000);
    rail(net, { x: 0, z: -1400 }, { x: 0, z: 1400 }, 'rail-branch');
    net.build({ x: -600, z: 30 }, { x: 600, z: 30 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    const rw = new Railway(net);
    rw.rebuild();
    const seg = [...net.segs.values()].find((s) => net.def(s).cls === 'rail')!;
    // a station just past the crossing: its siding would run back over the road
    const s = rw.build(rw.plan(seg.id, 1400 + 200, 1, 60).plans[0]).station, t = rw.build(rw.plan(seg.id, 2600, 1, 60).plans[0]).station;
    const line = rw.addLine([s.id, t.id], false, [TRAINS.dmu]);
    expect(typeof line).toBe('object');
    const c = rw.crossings[0], dp = rw.graph.depots.get(s.id);
    if (dp !== undefined) for (const q of rw.graph.pieces[dp].pts) expect(Math.hypot(q.x - c.x, q.z - c.z)).toBeGreaterThan(15);
    const sh = rw.shapes.get(s.id)!;
    if (sh.depot) expect(sh.land.slice(-sh.depot.pts.length).some((poly) => net.land.hits(poly, (k) => k.key === `road:${seg.id}` || k.key === `station:${s.id}`).length)).toBe(false);
  });
});

describe('the region’s railway', () => {
  // a fake region: a city between two towns, a village off to one side, and some villages elsewhere
  const region: RailSettlement[] = [
    { id: 'c', name: 'Easterby', kind: 'city', x: 0, z: 0, r: 600 },
    { id: 't1', name: 'Wendle', kind: 'town', x: -1900, z: 300, r: 350 },
    { id: 't2', name: 'Carrow', kind: 'town', x: 2000, z: -200, r: 350 },
    { id: 't3', name: 'Hapsby', kind: 'town', x: 300, z: 2400, r: 300 },
    { id: 'v1', name: 'Oxlow', kind: 'village', x: 1500, z: 1500, r: 150 },
    { id: 'v2', name: 'Pinmere', kind: 'village', x: -1500, z: -2200, r: 150 },
  ];
  it('lays a main line through the city and two towns, a branch to a village, and a line on each', () => {
    const plan = planRegionRail(region, { bound: 3000 })!;
    expect(plan).not.toBeNull();
    expect(plan.stations.filter((s) => s.route === 'main').map((s) => s.settlement.id)).toEqual(['t1', 'c', 't2']);
    expect(plan.stations.find((s) => s.route === 'branch')?.settlement.id).toBe('v1');
    const net = new Network(() => false, 3000);
    const rw = new Railway(net);
    const made = layRegionRail(rw, plan);
    expect(made.problems, JSON.stringify(plan)).toEqual([]);
    expect(made.stations.length).toBe(4);
    expect(made.lines.length).toBe(2);
    // and the trains run them, calling at each station in order
    for (let i = 0; i < (360 * 3) / 0.1; i++) rw.update(0.1);
    expect(rw.sim.stats.redPassed).toBe(0);
    for (const l of made.lines) {
      const order = callOrder(l.stops, false);
      for (const t of rw.trainsOn(l)) {
        const seq = rw.sim.log.filter((c) => c.train === t.id).map((c) => c.station);
        expect(seq.length, `train ${t.id} on line ${l.num}`).toBeGreaterThanOrEqual(3);
        const start = order.indexOf(seq[0]);
        seq.forEach((s, k) => expect(s).toBe(order[(start + k) % order.length]));
      }
    }
  }, 120_000);
  it('is the same railway for the same region', () => {
    expect(JSON.stringify(planRegionRail(region, { bound: 3000 }))).toBe(JSON.stringify(planRegionRail(region, { bound: 3000 })));
  });
});
