// Adversarial review: bendy buses bought from the Buy vehicles tab, and the overlap yardstick
// (footprint.overlapping) with the new long bodies.
import { describe, expect, it } from 'vitest';
import { SCENARIOS, simulate } from '../trafficsim';
import { BODIES, overlapping, posesOverlap, bodyOf, type Pose } from '../footprint';
import { Fleet } from './fleet';
import { Network } from '../roads';
import { setGameYear } from './era';

describe('bendy buses at stops', () => {
  it('a bendy bus standing in a lay-by is clear of the traffic passing it', () => {
    setGameYear(2025);
    const sc = SCENARIOS.find((s) => s.name === 'roundabout, single-lane approaches')!;
    let added = 0;
    const r = simulate({ ...sc, stops: true }, 40, 1 / 30, (tr, t) => {
      if (added < 4 && t > added * 3 && tr.addBus('kronhagen-lindwurm-4-bus-bendy')) added++;
    });
    expect(added).toBe(4);
    expect(r.overlapPairs, r.sample).toBe(0);
  }, 120_000);
});

describe('the overlap yardstick sees long vehicles', () => {
  it('overlapping() reports two bendy buses nose to tail with a metre of interpenetration', () => {
    setGameYear(2025);
    const f = new Fleet(new Network(() => false, 900));
    const d = f.dressBus('kronhagen-lindwurm-4-bus-bendy'), B = BODIES[d.cls];
    expect(B.trailer).toBeDefined();
    const at = (x0: number) => (s: number) => ({ x: x0 + s, z: 0 });
    const gap = B.back + B.front - 1; // one metre into each other
    const a: Pose = { x: 0, z: 0, y: 0, k: 1, kind: 'bus', id: 1, parts: bodyOf(d.cls, at(0)) };
    const b: Pose = { x: gap, z: 0, y: 0, k: 1, kind: 'bus', id: 2, parts: bodyOf(d.cls, at(gap)) };
    expect(posesOverlap(a, b)).toBe(true);
    expect(overlapping([a, b]).length).toBe(1);
  });
});
