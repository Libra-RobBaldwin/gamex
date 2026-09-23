import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, pointAt, type RoadOpts } from './roads';
import { GRADES, solveProfile } from './grade';

const bridge = (grade = 0.06): RoadOpts => ({ ...DEFAULT_OPTS, cross: 'bridge', grade });

describe('heights and gradients', () => {
  it('lowest profile: ramps at the gradient limit, flat deck over the obstacle', () => {
    const p = solveProfile(300, 0, undefined, 0.05, [{ s0: 140, s1: 160, lo: 6.5, why: 'the road below' }], 'auto');
    expect(p.ok).toBe(true);
    expect(p.maxY).toBeCloseTo(6.5);
    expect(p.maxGrade).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(p.y[0]).toBe(0);
    expect(p.y[p.y.length - 1]).toBe(0); // back down to the ground afterwards
  });

  it('flies over a road it crosses, with clearance, without making a junction', () => {
    const n = new Network();
    n.build({ x: -100, z: 0 }, { x: 100, z: 0 });
    const c = n.check({ x: 0, z: -150 }, { x: 0, z: 150 }, undefined, bridge());
    expect(c.ok).toBe(true);
    expect(c.bridges).toBe(1);
    for (const z of [-6, 0, 6]) {
      const s = 150 + z;
      expect(pointAt(c.path, s).y).toBeGreaterThanOrEqual(GRADES.road.clear - 1e-6);
    }
    expect(c.profile!.maxGrade).toBeLessThanOrEqual(0.06 + 1e-9);
    n.build({ x: 0, z: -150 }, { x: 0, z: 150 }, undefined, bridge());
    expect(n.segs.size).toBe(2); // neither road was split
  });

  it('refuses when the clearance cannot be reached in time, and a steeper gradient fixes it', () => {
    const n = new Network();
    n.build({ x: -100, z: 0 }, { x: 100, z: 0 });
    const tight = n.check({ x: 0, z: -100 }, { x: 0, z: 150 }, undefined, bridge(0.06));
    expect(tight.ok).toBe(false);
    expect(tight.reason).toMatch(/Can't climb/);
    expect(n.check({ x: 0, z: -100 }, { x: 0, z: 150 }, undefined, bridge(0.08)).ok).toBe(true);
    // never steeper than the road limit, whatever is asked for
    expect(n.check({ x: 0, z: -40 }, { x: 0, z: 150 }, undefined, bridge(0.5)).ok).toBe(false);
  });

  it('passes under a road that is already high enough, and junctions still form at ground level', () => {
    const n = new Network();
    const a = n.addNode(-60, 0, 8), b = n.addNode(60, 0, 8);
    n.addSeg(a, b);
    n.build({ x: -100, z: 30 }, { x: 100, z: 30 }); // an ordinary street
    const c = n.check({ x: 0, z: -100 }, { x: 0, z: 100 });
    expect(c.ok).toBe(true);
    expect(c.profile!.maxY).toBe(0);
    n.build({ x: 0, z: -100 }, { x: 0, z: 100 });
    expect([...n.nodes.values()].filter((x) => n.segsAt(x.id).length === 4).length).toBe(1); // only with the street
  });

  it('bridges water when there is room to climb to boat clearance', () => {
    const n = new Network((p) => p.x > 100 && p.x < 140);
    expect(n.check({ x: 0, z: 20 }, { x: 250, z: 20 }, undefined, { ...DEFAULT_OPTS, grade: 0.06 }).reason).toMatch(/water/);
    const c = n.check({ x: 0, z: 20 }, { x: 250, z: 20 }, undefined, { ...DEFAULT_OPTS, grade: 0.08 });
    expect(c.ok).toBe(true);
    expect(pointAt(c.path, 120).y).toBeGreaterThanOrEqual(GRADES.road.water);
  });

  it('a slip road off a raised road starts at its height and ramps down', () => {
    const n = new Network();
    n.addSeg(n.addNode(-100, 0, 8), n.addNode(100, 0, 8));
    const s = n.snapStart({ x: 0, z: 1 }, 5);
    const c = n.check(s, { x: 40, z: 200 });
    expect(c.ok).toBe(true);
    expect(c.path[0].y).toBeCloseTo(8);
    expect(c.path[c.path.length - 1].y).toBe(0);
    expect(c.profile!.maxGrade).toBeLessThanOrEqual(DEFAULT_OPTS.grade + 1e-9);
  });

  it('level and up modes', () => {
    const lvl = solveProfile(200, 5, undefined, 0.04, [], 'level');
    expect(Math.min(...lvl.y)).toBeCloseTo(5);
    const up = solveProfile(100, 0, undefined, 0.04, [], 'up');
    expect(up.y[up.y.length - 1]).toBeCloseTo(4);
  });
});
