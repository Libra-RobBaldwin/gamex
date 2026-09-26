// Stations, level crossings and the region's railway (docs/rail.md).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng } from '../roads';
import { TRAINS } from '../catalog';
import { Traffic, type Places } from '../traffic';
import { Railway } from './railway';

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
  it('come with up to four tracks: side platforms, islands or both, with fast lines through the middle', () => {
    const net = new Network(() => false, 4000);
    rail(net, { x: -1800, z: 0 }, { x: 1800, z: 0 });
    const rw = new Railway(net);
    rw.rebuild();
    const seg = [...net.segs.values()][0], L = net.length(seg);
    const cfg = (tracks: number, layout: 'side' | 'island' | 'both') => ({ tracks, layout, style: 'modern' as const, access: 'subway' as const, canopy: true });
    // every combination plans, with the platforms it should have
    const want: Record<string, number> = { '2side': 2, '2island': 1, '2both': 3, '3side': 2, '3island': 2, '3both': 4, '4side': 2, '4island': 2, '4both': 5 };
    for (const n of [2, 3, 4]) for (const lay of ['side', 'island', 'both'] as const) {
      const r = rw.plan(seg.id, L / 2, 1, 130, cfg(n, lay));
      expect(r.plans.length, `${n} ${lay}: ${r.reason}`).toBe(1);
      expect(r.plans[0].shape.platforms.length, `${n} ${lay}`).toBe(want[`${n}${lay}`]);
      expect(r.plans[0].ok).toBe(true);
    }
    // a four-track station with side platforms: a stopping line calls there, an express runs through on the middle tracks
    const a = rw.build(rw.plan(seg.id, 200, 1, 130).plans[0]).station;
    const b = rw.build(rw.plan(seg.id, L / 2, 1, 130, cfg(4, 'side')).plans[0]).station;
    const c = rw.build(rw.plan(seg.id, L - 200, 1, 130).plans[0]).station;
    expect(rw.graph.platforms.get(b.id)!.length).toBe(2);
    const stopper = rw.addLine([a.id, b.id, c.id], false, [TRAINS.dmu], { depot: false }), fast = rw.addLine([a.id, c.id], false, [TRAINS.intercity], { depot: false });
    expect(typeof stopper).toBe('object'); expect(typeof fast).toBe('object');
    const through = new Set(rw.graph.bySeg.get(seg.id)!.filter((i) => rw.graph.pieces[i].station === b.id && !rw.graph.pieces[i].plat && rw.graph.pieces[i].curvy === false || (rw.graph.pieces[i].station === b.id && !rw.graph.pieces[i].plat && Math.abs(rw.graph.pieces[i].off) === 2)));
    let fastThrough = false, shared = 0;
    for (let i = 0; i < 1800 / 0.1; i++) {
      rw.update(0.1);
      const [p, q] = rw.trains;
      if (p && q) { const A = rw.sim.occupied(p), B = rw.sim.occupied(q); for (const x of A) if (B.has(x)) shared++; }
      const f = rw.trainsOn(fast as never)[0];
      if (f && through.has(rw.sim.front(f).piece)) fastThrough = true;
    }
    expect(shared).toBe(0);
    expect(rw.sim.stats.redPassed).toBe(0);
    expect(fastThrough).toBe(true);
    const calls = (l: unknown) => rw.sim.log.filter((e) => e.line === (l as { id: number }).id).map((e) => e.station);
    expect(calls(stopper)).toContain(b.id);
    expect(calls(fast)).not.toContain(b.id);
    expect(new Set(calls(fast))).toEqual(new Set([a.id, c.id]));
  }, 120_000);
  it('on a single line: three tracks with platforms both sides of each, and trains still pass there', () => {
    const net = new Network(() => false, 4000);
    rail(net, { x: -1500, z: 0 }, { x: 1500, z: 0 }, 'rail-branch');
    const rw = new Railway(net);
    rw.rebuild();
    const seg = [...net.segs.values()][0], L = net.length(seg);
    const a = rw.build(rw.plan(seg.id, 120, 1, 60).plans.find((p) => !p.loop)!).station;
    const m = rw.build(rw.plan(seg.id, L / 2, 1, 60, { tracks: 3, layout: 'both', style: 'halt', access: 'footbridge', canopy: false }).plans[0]).station;
    const c = rw.build(rw.plan(seg.id, L - 120, 1, 60).plans.find((p) => !p.loop)!).station;
    expect(rw.graph.platforms.get(m.id)!.length).toBe(3);
    const line = rw.addLine([a.id, m.id, c.id], false, [TRAINS.dmu, TRAINS.dmu], { depot: false });
    expect(typeof line).toBe('object');
    for (let i = 0; i < 1800 / 0.1; i++) rw.update(0.1);
    expect(rw.sim.stats.redPassed).toBe(0);
    for (const t of rw.trains) expect(t.calls, `train ${t.id}`).toBeGreaterThan(6);
  }, 120_000);
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
