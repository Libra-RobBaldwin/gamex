// An adversarial review of the railway (27 Sep 2026, the coordinator's round 3): shared track,
// doors on the platform side at every layout, a station on a curve, a save and reload
// mid-journey, and a slow frame against fine steps. Each test reproduces something a player could
// meet on the real modules; one that passes is a claim refuted.
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, type RoadOpts } from '../roads';
import { TRAINS } from '../catalog';
import { Railway } from './railway';
import { EDGE, type Layout } from './track';
import type { Train } from './sim';

const rail = (type: 'rail-main' | 'rail-branch', o: Partial<RoadOpts> = {}): RoadOpts => ({ ...DEFAULT_OPTS, type, cross: 'bridge', grade: 0.025, ...o });
const DAY = 360; // sim seconds in a game day

// a straight line, 3 km
function straight(type: 'rail-main' | 'rail-branch') {
  const net = new Network(() => false, 4000);
  net.build({ x: -1500, z: 0 }, { x: 1500, z: 0 }, undefined, rail(type));
  const rw = new Railway(net);
  rw.rebuild();
  const seg = [...net.segs.values()][0];
  return { net, rw, seg, L: net.length(seg) };
}
// the shortest distance from a point to a station's platform edges
function edgeDist(rw: Railway, station: number, p: { x: number; z: number }) {
  const sh = rw.shapes.get(station);
  let best = Infinity;
  // (an island platform has a face on each side: its edge and its back)
  for (const pl of sh?.platforms ?? []) for (const line of pl.twoFaced ? [pl.edge, pl.back] : [pl.edge]) for (let i = 1; i < line.length; i++) {
    const A = line[i - 1], B = line[i], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.z - A.z) * dz) / L2));
    best = Math.min(best, Math.hypot(A.x + dx * t - p.x, A.z + dz * t - p.z));
  }
  return best;
}
// a dwelling train: is a platform edge where its doors open (left, +1, or right of the way it faces), and on the other side?
function platformAtDoors(rw: Railway, t: Train) {
  const sim = rw.sim, c = sim.pose(t, Math.min(t.length / 2, 12));
  const q = (side: number) => ({ x: c.x + c.uz * side * EDGE, z: c.z - c.ux * side * EDGE });
  return { doors: edgeDist(rw, t.station!, q(t.doorSide)) < 0.6, other: edgeDist(rw, t.station!, q(-t.doorSide)) < 0.6 };
}
function run(rw: Railway, seconds: number, dt = 0.1, each?: (t: number) => void) { for (let i = 0; i < seconds / dt; i++) { rw.update(dt); each?.(i * dt); } }
// no two trains in one block, ever
function apart(rw: Railway) {
  const seen = new Map<number, number>();
  for (const t of rw.trains) for (const b of rw.sim.occupied(t)) { if (seen.has(b) && seen.get(b) !== t.id) return false; seen.set(b, t.id); }
  return true;
}

describe('doors on the platform side', () => {
  // every layout the sheet offers, on a single and a double line: the train's doors open on the
  // side the platform is on, and (bar platforms both sides) not on the other
  const cases: { type: 'rail-main' | 'rail-branch'; tracks: number; layout: Layout; side: 1 | -1 }[] = [];
  for (const type of ['rail-branch', 'rail-main'] as const) for (const tracks of [1, 2, 3, 4]) for (const layout of ['side', 'island', 'both'] as Layout[]) for (const side of [1, -1] as const) cases.push({ type, tracks, layout, side });
  let checked = 0;
  for (const cs of cases) {
    it(`${cs.type === 'rail-main' ? 'double' : 'single'} line, ${cs.tracks} track${cs.tracks > 1 ? 's' : ''}, ${cs.layout}, tapped on side ${cs.side}`, () => {
      const { rw, seg, L } = straight(cs.type);
      const pa = rw.plan(seg.id, 400, cs.side, 130, { tracks: cs.tracks, layout: cs.layout });
      if (!pa.plans.length) return; // (not a layout this line offers)
      const a = rw.build(pa.plans[0]).station;
      const pb = rw.plan(seg.id, L - 400, 1, 130);
      expect(pb.plans.length, pb.reason).toBeGreaterThan(0);
      const b = rw.build(pb.plans[0]).station;
      const l = rw.addLine([a.id, b.id], false, [TRAINS.dmu], { depot: false });
      expect(typeof l, String(l)).toBe('object');
      const seenAt = new Set<number>();
      run(rw, 900, 0.1, () => {
        for (const t of rw.trains) {
          if (t.state !== 'dwell' || t.doors !== 1 || t.station === undefined || seenAt.has(t.station * 2 + (t.flipped ? 1 : 0))) continue;
          seenAt.add(t.station * 2 + (t.flipped ? 1 : 0));
          const at = platformAtDoors(rw, t);
          expect(at.doors, `a platform on the doors' side at station ${t.station} (doorSide ${t.doorSide}, facing ${t.flipped ? 'back' : 'forward'})`).toBe(true);
          // (side platforms: one face per track; islands between three or four tracks put a platform each side of a middle track)
          if (cs.layout === 'side' || t.station !== a.id) expect(at.other, `no platform on the other side at station ${t.station}`).toBe(false);
          checked++;
        }
      });
      expect(seenAt.has(a.id * 2) || seenAt.has(a.id * 2 + 1), 'the train called at the station under test with its doors open').toBe(true);
      expect(rw.sim.stats.redPassed).toBe(0);
    }, 60_000);
  }
  it('were checked at all', () => { expect(checked).toBeGreaterThan(8); });
  // on a curve: the platforms follow it, set back for the overhang; the doors still meet them
  it('on a station on a curve', () => {
    const net = new Network(() => false, 3000);
    net.build(net.snapStart({ x: -800, z: 0 }, 2, 'rail'), net.snapStart({ x: 800, z: 0 }, 2, 'rail'), { x: 0, z: 200 }, rail('rail-main'));
    const rw = new Railway(net);
    rw.rebuild();
    const seg = [...net.segs.values()][0], L = net.length(seg);
    const pm = rw.plan(seg.id, L / 2, 1, 130);
    expect(pm.plans.length, pm.reason).toBeGreaterThan(0);
    const mid = rw.build(pm.plans[0]).station;
    expect(rw.shapes.get(mid.id)!.radius).toBeLessThan(5000);
    const pa = rw.plan(seg.id, 150, 1, 130), pb = rw.plan(seg.id, L - 150, 1, 130);
    expect(pa.plans.length, pa.reason).toBeGreaterThan(0); expect(pb.plans.length, pb.reason).toBeGreaterThan(0);
    const a = rw.build(pa.plans[0]).station, b = rw.build(pb.plans[0]).station;
    const l = rw.addLine([a.id, mid.id, b.id], false, [TRAINS.dmu, TRAINS.dmu], { depot: false });
    expect(typeof l, String(l)).toBe('object');
    let atMid = 0;
    run(rw, 1200, 0.1, () => {
      for (const t of rw.trains) if (t.state === 'dwell' && t.doors === 1 && t.station === mid.id && t.dwell < 3) {
        const at = platformAtDoors(rw, t);
        expect(at.doors, `doors meet the curved platform (train ${t.id}, doorSide ${t.doorSide})`).toBe(true);
        expect(at.other).toBe(false);
        atMid++;
      }
    });
    expect(atMid).toBeGreaterThan(0);
    expect(rw.sim.stats.redPassed).toBe(0);
  }, 60_000);
});

describe('a line that shares track with another', () => {
  it('two lines over the same double line: no red passed, no shared block, every train keeps calling', () => {
    const { rw, seg, L } = straight('rail-main');
    const st = [400, L / 2, L - 400].map((s) => { const p = rw.plan(seg.id, s, 1, 130); expect(p.plans.length, p.reason).toBeGreaterThan(0); return rw.build(p.plans[0]).station; });
    const l1 = rw.addLine([st[0].id, st[1].id], false, [TRAINS.dmu, TRAINS.dmu], { depot: false });
    const l2 = rw.addLine([st[0].id, st[2].id], false, [TRAINS.dmu, TRAINS.dmu], { depot: false });
    expect(typeof l1, String(l1)).toBe('object'); expect(typeof l2, String(l2)).toBe('object');
    let shared = 0;
    run(rw, 2 * DAY, 0.1, () => { if (!apart(rw)) shared++; });
    expect(rw.sim.stats.redPassed).toBe(0);
    expect(shared, 'steps with two trains in one block').toBe(0);
    expect(rw.trains.length + rw.sim.waiting).toBe(4);
    // (four trains reversing at one two-platform terminus: two or three calls a day each is congestion, not a stop)
    const half = rw.sim.log.filter((e) => e.t > DAY);
    for (const t of rw.trains) expect(half.filter((e) => e.train === t.id).length, `train ${t.id} still calling in the second day`).toBeGreaterThanOrEqual(2);
  }, 120_000);
  it('a branch off the main line: the junction is one block, no red passed, every train keeps calling', () => {
    const net = new Network(() => false, 4000);
    net.build({ x: -1500, z: 0 }, { x: 1500, z: 0 }, undefined, rail('rail-main'));
    // (leaving the main line at about 22°, as points do)
    const br = net.check(net.snapStart({ x: 0, z: 0 }, 2, 'rail'), { x: 1500, z: 600 }, undefined, rail('rail-branch'));
    expect(br.ok, br.reason).toBe(true);
    net.build(net.snapStart({ x: 0, z: 0 }, 2, 'rail'), { x: 1500, z: 600 }, undefined, rail('rail-branch'));
    const rw = new Railway(net);
    rw.rebuild();
    const segs = [...net.segs.values()];
    const west = segs.find((s) => net.path(s).every((p) => p.x <= 1) && net.path(s).some((p) => p.x < -100))!;
    const east = segs.find((s) => net.path(s).every((p) => Math.abs(p.z) < 1) && net.path(s).some((p) => p.x > 100))!;
    const branch = segs.find((s) => net.path(s).some((p) => p.z > 100))!;
    const build = (s: typeof west, at: number) => { const p = rw.plan(s.id, at, 1, 130); expect(p.plans.length, `${p.reason} (seg ${s.id} at ${at})`).toBeGreaterThan(0); return rw.build(p.plans[0]).station; };
    const A = build(west, 300), B = build(east, net.length(east) - 300), D = build(branch, net.length(branch) - 300);
    const l1 = rw.addLine([A.id, B.id], false, [TRAINS.dmu, TRAINS.dmu], { depot: false });
    const l2 = rw.addLine([A.id, D.id], false, [TRAINS.dmu], { depot: false });
    expect(typeof l1, String(l1)).toBe('object'); expect(typeof l2, String(l2)).toBe('object');
    let shared = 0;
    run(rw, 2 * DAY, 0.1, () => { if (!apart(rw)) shared++; });
    expect(rw.sim.stats.redPassed).toBe(0);
    expect(shared, 'steps with two trains in one block').toBe(0);
    const half = rw.sim.log.filter((e) => e.t > DAY);
    for (const t of rw.trains) expect(half.filter((e) => e.train === t.id).length, `train ${t.id} still calling in the second day`).toBeGreaterThanOrEqual(2);
    expect(half.some((e) => e.station === D.id), 'the branch station is served').toBe(true);
  }, 120_000);
  // A branch joined at a right angle: points can't turn a train through that (track.ts exits,
  // 60° at most), so a line over it would never run, its trains standing at the platform for
  // ever with the money gone. The track tool refuses the join; and a line whose stations have no
  // way by rail between them is refused too, by name.
  it('a right-angle junction is refused by the track tool, and a line with no way between its stations by the line tool', () => {
    const net = new Network(() => false, 4000);
    net.build({ x: -1500, z: 0 }, { x: 1500, z: 0 }, undefined, rail('rail-main'));
    const sharp = net.check(net.snapStart({ x: 0, z: 0 }, 2, 'rail'), { x: 0, z: 1500 }, undefined, rail('rail-branch'));
    expect(sharp.ok).toBe(false);
    expect(sharp.reason).toMatch(/junction/);
    const shallow = net.check(net.snapStart({ x: 0, z: 0 }, 2, 'rail'), { x: 1500, z: 600 }, undefined, rail('rail-branch'));
    expect(shallow.ok, shallow.reason).toBe(true);
    // (the join forced through regardless, as an old save might hold it)
    const main = [...net.segs.values()][0];
    const n = net.split(main.id, { x: 0, z: 0 }), far = net.addNode(0, 1500);
    net.addSeg(n, far, [], 'rail-branch');
    const rw = new Railway(net);
    rw.rebuild();
    const segs = [...net.segs.values()];
    const west = segs.find((s) => net.path(s).every((p) => p.x <= 1) && net.path(s).some((p) => p.x < -100))!, branch = segs.find((s) => net.path(s).some((p) => p.z > 100))!;
    const A = rw.build(rw.plan(west.id, 300, 1, 130).plans[0]).station, D = rw.build(rw.plan(branch.id, net.length(branch) - 300, 1, 130).plans[0]).station;
    const l = rw.addLine([A.id, D.id], false, [TRAINS.dmu], { depot: false });
    expect(typeof l).toBe('string');
    expect(l).toMatch(new RegExp(`No way by rail from ${A.name} to ${D.name}`));
    expect(rw.lines.length).toBe(0);
    expect(rw.trains.length + rw.sim.waiting).toBe(0);
  });
});

describe('a save and reload mid-journey', () => {
  it('brings every line and train back running, calling as before', () => {
    const { net, rw, seg, L } = straight('rail-main');
    const st = [400, L / 2, L - 400].map((s) => { const p = rw.plan(seg.id, s, 1, 130); expect(p.plans.length, p.reason).toBeGreaterThan(0); return rw.build(p.plans[0]).station; });
    rw.addLine([st[0].id, st[1].id], false, [TRAINS.dmu, TRAINS.dmu]);
    rw.addLine([st[0].id, st[2].id], false, [TRAINS.dmu]);
    run(rw, 300);
    expect(rw.trains.some((t) => t.v > 5), 'a train is under way when the game is saved').toBe(true);
    const saved = structuredClone(rw.save());
    const rw2 = new Railway(net);
    rw2.restore(saved);
    expect(rw2.stations.map((s) => s.id)).toEqual(rw.stations.map((s) => s.id));
    expect(rw2.lines.map((l) => [l.id, ...l.stops])).toEqual(rw.lines.map((l) => [l.id, ...l.stops]));
    expect(rw2.trains.length + rw2.sim.waiting, 'as many trains').toBe(rw.trains.length + rw.sim.waiting);
    run(rw2, DAY);
    expect(rw2.sim.waiting, 'every train is out of the depot within a day').toBe(0);
    expect(rw2.sim.stats.redPassed).toBe(0);
    for (const t of rw2.trains) expect(rw2.sim.log.filter((e) => e.train === t.id).length, `train ${t.id} calls after the reload`).toBeGreaterThanOrEqual(2);
    // and saving again says the same
    const again = rw2.save();
    expect(again.trains.length).toBe(saved.trains.length);
    expect(again.lines.map((l) => l.id)).toEqual(saved.lines.map((l) => l.id));
  }, 120_000);
});

describe('a slow frame against fine steps', () => {
  // at 1x the railway steps once a frame, a quarter of a second on a slow phone; at 4x in steps
  // of 1/30 s. The same line must run the same either way: as many calls, no red, nothing shared.
  it('calls as often at 0.25 s steps as at 1/30 s, with no red passed and no shared block', () => {
    const calls = (dt: number) => {
      const { rw, seg, L } = straight('rail-main');
      const st = [400, L - 400].map((s) => { const p = rw.plan(seg.id, s, 1, 130); expect(p.plans.length, p.reason).toBeGreaterThan(0); return rw.build(p.plans[0]).station; });
      const l = rw.addLine([st[0].id, st[1].id], false, [TRAINS.dmu, TRAINS.dmu], { depot: false });
      expect(typeof l, String(l)).toBe('object');
      let shared = 0, over = 0;
      run(rw, 2 * DAY, dt, () => { if (!apart(rw)) shared++; for (const t of rw.trains) if (t.stop && t.stop.k === -1 && t.u > t.stop.u + 0.5) over++; });
      return { n: rw.sim.log.length, red: rw.sim.stats.redPassed, shared, over };
    };
    const fine = calls(1 / 30), slow = calls(0.25);
    expect(fine.red).toBe(0); expect(slow.red).toBe(0);
    expect(fine.shared).toBe(0); expect(slow.shared).toBe(0);
    expect(slow.over, 'a train run past its stopping point at a platform').toBe(0);
    expect(Math.abs(fine.n - slow.n), `calls in two days: ${fine.n} at 1/30 s, ${slow.n} at 0.25 s`).toBeLessThanOrEqual(2);
  }, 120_000);
});
