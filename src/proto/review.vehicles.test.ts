// Adversarial review of vehicles on the network: bus lines, their stops, and trains. Each test
// here reproduces a suspected logic bug on the real modules; one that passes is a claim refuted.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng, stopSpan } from './roads';
import { Traffic } from './traffic';
import { SCENARIOS, town } from './trafficsim';
import { starterStops } from './game/crowdsites';
import { Lines } from './game/lines';
import { TRAINS } from './catalog';
import { TrackGraph, type StationWorks } from './rail/track';
import { RailSim, type RailLine } from './rail/sim';

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
  return { net, traffic, lines, near, run, dt, now: () => i * dt * 1000 };
}
const cars = (traffic: Traffic) => traffic.cars as unknown as { id: number; bus?: boolean; seg: { id: number; a: number; b: number; stops: { s: number }[] }; from: number; s: number; v: number; dwell?: number; gone?: number; leg?: number; line?: { seq: number[] } }[];

describe('bus lines under the player’s edits', () => {
  // Network.split() (roads.ts:383) deletes the road and makes two new ones with new ids; every
  // road built onto or across another does that. Traffic.update (traffic.ts:1622) then drops every
  // vehicle whose road id is gone: the line's buses vanish, unpaid for, and the line runs short.
  it('keeps a line’s buses when a side road is built onto the road they are driving along', () => {
    const { net, traffic, lines, near, run } = setup();
    const l = lines.add([near({ x: -85, z: 0 }), near({ x: 120, z: 0 })], false, 2);
    expect(traffic.busesOn(l.id).length).toBe(2);
    run(60);
    expect(traffic.busesOn(l.id).length).toBe(2);
    // a bus on the road, and a point on that road clear of its stops to build a side road from
    const c = cars(traffic).find((x) => x.bus && x.gone === undefined && traffic.busesOn(l.id).includes(x.id))!;
    const seg = net.segs.get(c.seg.id)!, path = net.path(seg), L = net.length(seg);
    let at = -1;
    for (let s = 12; s < L - 12 && at < 0; s += 2) if (!seg.stops.some((st) => { const [a, b] = stopSpan(st); return s > a - 6 && s < b + 6; })) at = s;
    expect(at, 'a place on the road clear of its stops').toBeGreaterThan(0);
    const p = (() => { let d = 0; for (let k = 1; k < path.length; k++) { const dd = Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z); if (d + dd >= at) { const f = (at - d) / dd; return { x: path[k - 1].x + (path[k].x - path[k - 1].x) * f, z: path[k - 1].z + (path[k].z - path[k - 1].z) * f }; } d += dd; } return path[path.length - 1]; })();
    const before = [...net.segs.keys()];
    net.build(net.snapStart(p, 3), { x: p.x + 40, z: p.z + 60 }, undefined, { ...DEFAULT_OPTS, type: 'street' });
    expect(net.segs.has(seg.id), 'the road was split (its id is gone)').toBe(false);
    expect([...net.segs.keys()].length).toBeGreaterThan(before.length);
    traffic.invalidate(); lines.prune();
    run(1);
    expect(lines.list).toContain(l);
    expect(l.stops.length).toBe(2);
    expect(traffic.busesOn(l.id).length, 'the line still has both buses').toBe(2);
  }, 120_000);

  // A bus standing at a stop keeps `dwell` only ticking down while nextStop() finds the stop it is
  // at (traffic.ts:1821-1827). When the line loses a stop elsewhere (Lines.prune after a road is
  // built through it), the bus's `leg` now points at a different call on another road, nextStop()
  // returns null, and the dwell is never finished: the bus drives off with its doors open and its
  // sheet saying it is dwelling, all the way to the next stop.
  it('a bus at a stop finishes its dwell when the line loses a different stop', () => {
    const { net, traffic, lines, near, run } = setup(5);
    const A = near({ x: -85, z: 0 }), B = near({ x: 120, z: 0 }), C = near({ x: 0, z: 150 });
    const l = lines.add([A, B, C], false, 1);
    const id = traffic.busesOn(l.id)[0];
    // wait for the bus to be standing at C
    const cPlace = traffic.place(C)!;
    const dwellingAtC = () => { const c = cars(traffic).find((x) => x.id === id)!; return c.dwell !== undefined && c.seg.id === cPlace.seg.id && c.v < 0.1; };
    const got = run(900, () => dwellingAtC());
    expect(got, 'the bus called at C within 15 minutes').toBe(true);
    // stop A is lost (as when a road is built through it): its road keeps the others
    const lost = new Set(traffic.place(A)!.stops.map((x) => x.id));
    for (const seg of net.segs.values()) seg.stops = seg.stops.filter((st) => !lost.has(st.id));
    traffic.invalidate(); lines.prune();
    expect(l.stops).toEqual([B, C]);
    // within a minute the bus must have finished its dwell before it moves off: never driving while dwelling
    let drivingWhileDwelling = 0;
    run(60, () => { const c = cars(traffic).find((x) => x.id === id)!; if (c.dwell !== undefined && c.v > 2) drivingWhileDwelling++; });
    const c = cars(traffic).find((x) => x.id === id)!;
    expect(drivingWhileDwelling, 'frames driving with the dwell still on (doors open, sheet says dwelling)').toBe(0);
    expect(traffic.bus(id)!.dwelling && c.v > 2, 'moving and dwelling at once').toBe(false);
  }, 120_000);

});

describe('trains under the player’s edits', () => {
  // Railway.rebuild() is called from commitRoads on every road edit anywhere (main.ts:422-439),
  // and RailSim.rebuild (sim.ts:474) stops every moving train dead (v = 0), drops its reservations
  // and replans it, even when the track is exactly as it was.
  it('a train running at speed is not stopped by a rebuild that leaves its track unchanged', () => {
    const net = new Network(() => false, 5000);
    net.build({ x: -1500, z: 0 }, { x: 1500, z: 0 }, undefined, { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' });
    const seg = [...net.segs.values()][0], L = net.length(seg);
    const works: StationWorks[] = [
      { id: 1, seg: seg.id, s0: 20, s1: 150, layout: 'side', loop: false, side: 1, depot: undefined },
      { id: 2, seg: seg.id, s0: L - 150, s1: L - 20, layout: 'side', loop: false, side: -1 },
    ];
    const sim = new RailSim(new TrackGraph(net, works));
    const line: RailLine = { id: 1, num: 1, stops: [1, 2], loop: false };
    sim.lines.push(line);
    const t = sim.addTrain(TRAINS.dmu, line);
    expect(typeof t).not.toBe('string');
    const tr = t as Exclude<typeof t, string>;
    for (let i = 0; i < 600; i++) sim.update(0.1); // 60 s: well under way
    expect(tr.v).toBeGreaterThan(10);
    const vBefore = tr.v;
    // a road built elsewhere: the railway rebuilds its graph from the same track
    sim.rebuild(new TrackGraph(net, works), []);
    sim.update(0.1);
    expect(tr.v, 'speed the step after the rebuild').toBeGreaterThan(vBefore - 2);
  });
});

