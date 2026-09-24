// Signalling: trains on one line never share a block, never pass a red, and call at every
// station of their line in order.
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network } from '../roads';
import { TRAINS } from '../catalog';
import { TrackGraph, type StationWorks } from './track';
import { RailSim, callOrder, type RailLine } from './sim';

const DAY = 360; // sim seconds in a game day (the game's clock runs 4 game minutes a second)

// a single line 3 km long: a terminus at each end, a passing loop in the middle
function singleLine(loop = true) {
  const net = new Network(() => false, 5000);
  net.build({ x: -1500, z: 0 }, { x: 1500, z: 0 }, undefined, { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' });
  const seg = [...net.segs.values()][0], L = net.length(seg);
  const works: StationWorks[] = [
    { id: 1, seg: seg.id, s0: 20, s1: 150, layout: 'side', loop: false, side: 1, depot: undefined },
    { id: 2, seg: seg.id, s0: L / 2 - 70, s1: L / 2 + 70, layout: 'island', loop, side: 1 },
    { id: 3, seg: seg.id, s0: L - 150, s1: L - 20, layout: 'side', loop: false, side: -1 },
  ];
  return { net, works };
}
function run(sim: RailSim, seconds: number, dt: number, each?: (t: number) => void) {
  for (let i = 0; i < seconds / dt; i++) { sim.update(dt); each?.(i * dt); }
}

describe('rail signalling', () => {
  it('builds a single line with a passing loop into blocks', () => {
    const { net, works } = singleLine();
    const g = new TrackGraph(net, works);
    expect(g.broken.size).toBe(0);
    expect(g.platforms.get(2)!.length).toBe(2);
    expect(g.platforms.get(1)!.length).toBe(1);
    const loopBlocks = g.platforms.get(2)!.map((i) => g.blocks[g.pieces[i].block]);
    expect(loopBlocks.every((b) => b.safe)).toBe(true);
    // the plain single line between stations is not a safe place to stand
    const plain = g.blocks.filter((b) => b.kind === 'plain');
    expect(plain.some((b) => !b.safe)).toBe(true);
    // termini are
    for (const s of [1, 3]) expect(g.blocks[g.pieces[g.platforms.get(s)![0]].block].safe).toBe(true);
  });

  it('two trains on a single line with a passing loop never share a block, never pass a red, over two game days', () => {
    const { net, works } = singleLine();
    const sim = new RailSim(new TrackGraph(net, works));
    const line: RailLine = { id: 1, num: 1, stops: [1, 2, 3], loop: false };
    sim.lines.push(line);
    const a = sim.addTrain(TRAINS.dmu, line), b = sim.addTrain(TRAINS.dmu, { ...line, stops: [3, 2, 1] });
    expect(typeof a).not.toBe('string');
    expect(typeof b).not.toBe('string');
    let shared = 0, maxOverlap = '';
    run(sim, 2 * DAY * 3, 0.1, (t) => {
      const [p, q] = sim.trains;
      if (!p || !q) return;
      const A = sim.occupied(p), B = sim.occupied(q);
      for (const x of A) if (B.has(x)) { shared++; maxOverlap ||= `block ${x} at ${t.toFixed(1)}`; }
    });
    expect(sim.trains.length).toBe(2);
    expect(shared, maxOverlap).toBe(0);
    expect(sim.stats.redPassed).toBe(0);
    // both kept running: many calls each
    for (const t of sim.trains) expect(t.calls, `train ${t.id} calls`).toBeGreaterThan(8);
  }, 60_000);

  it('three trains on a single line with two passing loops keep running (no deadlock), and a fourth is refused', () => {
    const net = new Network(() => false, 5000);
    net.build({ x: -2000, z: 0 }, { x: 2000, z: 0 }, undefined, { ...DEFAULT_OPTS, type: 'rail-branch', cross: 'bridge' });
    const seg = [...net.segs.values()][0], L = net.length(seg);
    const works: StationWorks[] = [
      { id: 1, seg: seg.id, s0: 20, s1: 150, layout: 'side', loop: false, side: 1, depot: { end: 1, side: 1, len: 60 } },
      { id: 2, seg: seg.id, s0: L * 0.35 - 70, s1: L * 0.35 + 70, layout: 'island', loop: true, side: 1 },
      { id: 3, seg: seg.id, s0: L * 0.65 - 70, s1: L * 0.65 + 70, layout: 'side', loop: true, side: 1 },
      { id: 4, seg: seg.id, s0: L - 150, s1: L - 20, layout: 'side', loop: false, side: -1 },
    ];
    const sim = new RailSim(new TrackGraph(net, works));
    const line: RailLine = { id: 1, num: 1, stops: [1, 2, 3, 4], loop: false, depot: 1 };
    sim.lines.push(line);
    for (let i = 0; i < 3; i++) expect(typeof sim.addTrain(TRAINS.dmu, line)).toBe('object');
    expect(sim.addTrain(TRAINS.dmu, line)).toMatch(/can only run 3 trains/);
    let shared = 0;
    const before = new Map<number, number>();
    run(sim, DAY * 4, 0.1, (t) => {
      if (Math.abs(t - DAY * 3) < 0.05) for (const x of sim.trains) before.set(x.id, x.calls);
      const occ = sim.trains.map((x) => sim.occupied(x));
      for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) for (const b of occ[i]) if (occ[j].has(b)) shared++;
    });
    expect(sim.trains.length).toBe(3);
    expect(shared).toBe(0);
    expect(sim.stats.redPassed).toBe(0);
    // still calling in the last day
    for (const x of sim.trains) expect(x.calls - (before.get(x.id) ?? 0), `train ${x.id} in the last day`).toBeGreaterThan(2);
  }, 60_000);

  it('trains call at every station of their line, in order', () => {
    const { net, works } = singleLine();
    const sim = new RailSim(new TrackGraph(net, works));
    const line: RailLine = { id: 1, num: 1, stops: [1, 2, 3], loop: false };
    sim.addTrain(TRAINS.dmu, line);
    run(sim, DAY * 2, 0.1);
    const order = callOrder(line.stops, false);
    const seq = sim.log.filter((c) => c.train === sim.trains[0].id).map((c) => c.station);
    expect(seq.length).toBeGreaterThan(6);
    const start = order.indexOf(seq[0]);
    seq.forEach((s, i) => expect(s, `call ${i}: ${seq}`).toBe(order[(start + i) % order.length]));
  }, 60_000);
});
