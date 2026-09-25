// Stations on curves, on viaducts and underground (docs/rail.md): where each can go, what each
// claims and costs, and trains calling at them like anywhere else.
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, type RoadOpts } from '../roads';
import { TRAINS } from '../catalog';
import { Railway } from './railway';
import { EDGE, stationTracks } from './track';
import { MIN_RADIUS, throwIn, throwOut } from './station';

const main = (o: Partial<RoadOpts> = {}): RoadOpts => ({ ...DEFAULT_OPTS, type: 'rail-main', cross: 'bridge', grade: 0.025, ...o });
// a straight main line, 3 km, with a stretch held at a height (a viaduct, or a deep tunnel), and
// a kilometre of plain line on the level at each end (for the stations either side)
function line(o: Partial<RoadOpts> = {}) {
  const net = new Network(() => false, 4000);
  const P = [-2500, -1500, 1500, 2500].map((x) => ({ x, z: 0 }));
  net.build(net.snapStart(P[0], 2, 'rail'), net.snapStart(P[1], 2, 'rail'), undefined, main());
  net.build(net.snapStart(P[2], 2, 'rail'), net.snapStart(P[3], 2, 'rail'), undefined, main());
  net.build(net.snapStart(P[1], 2, 'rail'), net.snapStart(P[2], 2, 'rail'), undefined, main(o)); // (last: it joins both, so comes back up to meet them)
  const rw = new Railway(net);
  rw.rebuild();
  const segs = [...net.segs.values()].filter((s) => net.def(s).cls === 'rail');
  const seg = segs.find((s) => Math.abs((net.path(s)[0].x + net.path(s)[net.path(s).length - 1].x) / 2) < 1)!;
  const ends = segs.filter((s) => s !== seg);
  return { net, rw, seg, L: net.length(seg), ends };
}
// a station on each plain end, a line between them calling at the one in the middle, run for a while
function runs(rw: Railway, ends: { id: number }[], mid: number) {
  const [a, b] = ends.map((s) => { const r = rw.plan(s.id, 500, 1, 130); expect(r.plans.length, r.reason).toBeGreaterThan(0); return rw.build(r.plans[0]).station; });
  const l = rw.addLine([a.id, mid, b.id], false, [TRAINS.dmu, TRAINS.dmu], { depot: false });
  expect(typeof l).toBe('object');
  for (let i = 0; i < 1800 / 0.1; i++) rw.update(0.1);
  expect(rw.sim.stats.redPassed).toBe(0);
  return rw.sim.log.filter((e) => e.station === mid).length;
}

describe('stations on a curve', () => {
  // a main line bending round a curve of about 1,250 m radius at its middle
  const curve = (h: number) => {
    const net = new Network(() => false, 3000);
    net.build(net.snapStart({ x: -800, z: 0 }, 2, 'rail'), net.snapStart({ x: 800, z: 0 }, 2, 'rail'), { x: 0, z: h }, main());
    const rw = new Railway(net);
    rw.rebuild();
    const seg = [...net.segs.values()][0];
    return { net, rw, seg, L: net.length(seg) };
  };
  it('follow it, their edges set back for the trains’ overhang, and trains call there', () => {
    const { rw, seg, L } = curve(512);
    const r = rw.plan(seg.id, L / 2, 1, 130);
    expect(r.plans.map((p) => p.ok)).toEqual([true, true]);
    for (const p of r.plans) {
      expect(p.shape.radius).toBeGreaterThan(MIN_RADIUS);
      expect(p.shape.radius).toBeLessThan(1400);
      expect(p.notes.join(' ')).toMatch(/curve/);
      expect(stationTracks(p.works, 2).tracks.length).toBe(2);
    }
    // each platform edge stands off the track it faces by the straight's gap plus the overhang on
    // its side of the curve: never less (a train would strike it), and never much more (a wide step
    // at the doors). Measured along each platform track, from its rails' centre to the nearest edge.
    const plan = r.plans[0], st = rw.build(plan).station, g = rw.graph;
    for (const pid of g.platforms.get(st.id)!) {
      const pc = g.pieces[pid], pl = pc.plat!;
      for (let u = pl.u0 + 10; u < pl.u1 - 10; u += 10) {
        const q = at(pc, u), sh = rw.shapes.get(st.id)!;
        let gap = Infinity;
        for (const p of sh.platforms) for (let i = 1; i < p.edge.length; i++) gap = Math.min(gap, segDist(q, p.edge[i - 1], p.edge[i]));
        expect(gap, `platform track ${pid} at ${u}`).toBeGreaterThanOrEqual(EDGE - 0.02);
        expect(gap).toBeLessThanOrEqual(EDGE + throwOut(MIN_RADIUS) + 0.03);
      }
    }
    expect(throwIn(1250)).toBeGreaterThan(0.02);
    // and the trains call there
    const { rw: rw2, seg: s2, L: L2 } = curve(512);
    const mid = rw2.build(rw2.plan(s2.id, L2 / 2, 1, 130).plans[0]).station;
    const a = rw2.build(rw2.plan(s2.id, 110, 1, 60).plans[0]).station, b = rw2.build(rw2.plan(s2.id, L2 - 110, 1, 60).plans[0]).station;
    expect(typeof rw2.addLine([a.id, mid.id, b.id], false, [TRAINS.dmu], { depot: false })).toBe('object');
    for (let i = 0; i < 1500 / 0.1; i++) rw2.update(0.1);
    expect(rw2.sim.stats.redPassed).toBe(0);
    expect(rw2.sim.log.filter((e) => e.station === mid.id).length).toBeGreaterThan(1);
  }, 120_000);
  it('are refused on a curve tighter than 1,000 m', () => {
    const { rw, seg, L } = curve(800); // (about 800 m radius)
    expect(rw.plan(seg.id, L / 2, 1, 130).reason).toMatch(/radius \d+ m; at least 1,000 m/);
  });
});

describe('viaduct stations', () => {
  // the middle 900 m held 9 m up: a viaduct
  const viaduct = () => line({ limits: [{ s0: 1050, s1: 1950, lo: 9, hi: 9, why: 'the viaduct' }] });
  it('go on a viaduct, cost more than on the ground, and let roads pass under', () => {
    const { net, rw, seg, L } = viaduct();
    expect(seg.bridges?.length).toBeGreaterThan(0);
    const r = rw.plan(seg.id, L / 2, 1, 130);
    expect(r.plans.length, r.reason).toBe(2);
    for (const p of r.plans) { expect(p.ok, p.blocked).toBe(true); expect(p.station.structure).toBe('viaduct'); expect(p.notes[0]).toMatch(/viaduct.*stairs and lifts/); }
    const flat = line(), ground = flat.rw.plan(flat.seg.id, L / 2, 1, 130).plans[0];
    expect(r.plans[0].cost).toBeGreaterThan(ground.cost * 1.5);
    // the platforms are up on the deck, the booking hall at street level
    const p = r.plans[0];
    for (const pl of p.shape.platforms) expect(pl.y).toBeGreaterThan(9);
    expect(p.shape.building.y).toBe(0);
    const st = rw.build(p).station;
    // the hall is the station's; the deck is the railway's (like a bridge), so a street can pass
    // under it, but nothing can be built on the ground there
    expect(net.land.at({ x: p.shape.building.x, z: p.shape.building.z })?.owner).toBe('station');
    expect(net.land.at({ x: st.x + 40, z: st.z })?.key).toMatch(/^(station:\d+:deck|road:\d+)$/);
    const under = net.check(net.snapStart({ x: st.x + 45, z: -300 }, 2), net.snapStart({ x: st.x + 45, z: 300 }, 2), undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'junction' });
    expect(under.ok, under.reason).toBe(true);
  });
  it('are refused where the bridge can’t carry platforms, and off the level top', () => {
    const { rw, seg, L } = viaduct();
    // on the ramp up to it
    expect(rw.plan(seg.id, 800, 1, 130).reason).toMatch(/ramp|embankment/);
    for (const [type, why] of [['trestle', /timber trestle/], ['truss-through', /trusses/], ['suspension', /long-span/]] as const) {
      const was = seg.bridges!.map((b) => ({ ...b }));
      for (const b of seg.bridges!) b.type = type;
      expect(rw.plan(seg.id, L / 2, 1, 130).reason).toMatch(why);
      seg.bridges = was;
    }
    expect(rw.plan(seg.id, L / 2, 1, 130).plans.length).toBe(2);
  });
  it('get trains calling like anywhere else, but no depot siding', () => {
    const { rw, seg, L, ends } = viaduct();
    const mid = rw.build(rw.plan(seg.id, L / 2, 1, 130).plans[0]).station;
    expect(runs(rw, ends, mid.id)).toBeGreaterThan(1);
    const l = rw.addLine([mid.id, rw.stations[1].id], false, [TRAINS.dmu]);
    expect(typeof l === 'object' && l.depot).toBeFalsy();
  }, 120_000);
});

describe('underground stations', () => {
  const deep = () => line({ cross: 'tunnel', height: 'deep' });
  it('go in a deep tunnel, with only their entrance on the ground', () => {
    const { net, rw, seg, L, ends } = deep();
    expect(net.path(seg).some((p) => (p.y ?? 0) < -13)).toBe(true);
    const r = rw.plan(seg.id, L / 2, -1, 130);
    expect(r.plans.length, r.reason).toBe(2);
    const p = r.plans[0];
    expect(p.ok, p.blocked).toBe(true);
    expect(p.station.structure).toBe('underground');
    expect(p.notes[0]).toMatch(/Underground.*\d+ m down.*lifts/);
    for (const pl of p.shape.platforms) expect(pl.y).toBeLessThan(-10);
    // it costs more than the same station on a viaduct, which costs more than on the ground
    const v = line({ limits: [{ s0: 1050, s1: 1950, lo: 9, hi: 9, why: 'the viaduct' }] });
    const vp = v.rw.plan(v.seg.id, L / 2, -1, 130).plans[0];
    expect(p.cost).toBeGreaterThan(vp.cost);
    expect(p.shape.canopy).toBe(false);
    const st = rw.build(p).station;
    // the entrance is the station's; the ground over the platforms is free for building
    expect(net.land.at({ x: p.shape.building.x, z: p.shape.building.z })?.owner).toBe('station');
    expect(net.land.at({ x: st.x + 30, z: st.z })?.owner).not.toBe('station');
    // and a tap there finds it in the underground view, but not on the surface (a building over it)
    expect(rw.stationAt({ x: st.x + 30, z: st.z }, true)?.id).toBe(st.id);
    expect(rw.stationAt({ x: st.x + 30, z: st.z })).toBeUndefined();
    expect(rw.stationAt({ x: p.shape.building.x, z: p.shape.building.z })?.id).toBe(st.id);
    expect(runs(rw, ends, st.id)).toBeGreaterThan(1);
  }, 120_000);
  it('are refused in a cutting or a shallow tunnel', () => {
    const { rw, seg, L } = line({ cross: 'tunnel', limits: [{ s0: 1200, s1: 1800, lo: -6, hi: -6, why: 'the cutting' }] });
    expect(rw.plan(seg.id, L / 2, 1, 130).reason).toMatch(/cutting/);
  });
});

import { at, type P3 } from './track';
function segDist(q: { x: number; z: number }, a: P3, b: P3) {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / L2));
  return Math.hypot(a.x + dx * t - q.x, a.z + dz * t - q.z);
}
