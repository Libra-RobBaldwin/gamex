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

  it("doesn't dip between two obstacles close together, or hump between two tunnels", () => {
    // a river and then a road 40 m apart: a real deck stays up rather than diving in between
    const p = solveProfile(500, 0, 0, 0.06, [{ s0: 150, s1: 220, lo: 6.8, why: 'the water' }, { s0: 260, s1: 280, lo: 7.3, why: 'the road below' }], 'auto');
    expect(p.ok).toBe(true);
    const at = (t: number) => p.y[Math.round(t / 2)];
    for (let t = 220; t <= 260; t += 2) expect(at(t)).toBeGreaterThanOrEqual(6.8 - 1e-6);
    expect(p.maxGrade).toBeLessThanOrEqual(0.06 + 1e-9);
    // and far apart, it does come back down to the ground between them
    const q = solveProfile(900, 0, 0, 0.06, [{ s0: 150, s1: 220, lo: 6.8, why: 'the water' }, { s0: 660, s1: 680, lo: 7.3, why: 'the road below' }], 'auto');
    expect(q.y[Math.round(440 / 2)]).toBe(0);
    // two tunnels: no hump up towards the surface between them
    const r = solveProfile(500, 0, 0, 0.06, [{ s0: 150, s1: 200, hi: -12, why: 'the lake' }, { s0: 240, s1: 280, hi: -12, why: 'the canal' }], 'auto', -60);
    for (let t = 200; t <= 240; t += 2) expect(r.y[Math.round(t / 2)]).toBeLessThanOrEqual(-12 + 1e-6);
  });

  it('level and up modes', () => {
    const lvl = solveProfile(200, 5, undefined, 0.04, [], 'level');
    expect(Math.min(...lvl.y)).toBeCloseTo(5);
    const up = solveProfile(100, 0, undefined, 0.04, [], 'up');
    expect(up.y[up.y.length - 1]).toBeCloseTo(4);
  });

  it('tunnels: under a road it crosses, and deep under water', () => {
    const n = new Network((p) => p.x > 100 && p.x < 180);
    n.build({ x: -100, z: 0 }, { x: 100, z: 0 });
    const under = n.check({ x: 0, z: -150 }, { x: 0, z: 150 }, undefined, { ...DEFAULT_OPTS, cross: 'tunnel' });
    expect(under.ok).toBe(true);
    expect(pointAt(under.path, 150).y).toBeLessThanOrEqual(-GRADES.road.clear + 1e-6);
    expect(under.tunnels).toBe(1);
    const lake = n.check({ x: -150, z: 60 }, { x: 420, z: 60 }, undefined, { ...DEFAULT_OPTS, cross: 'tunnel', grade: 0.08 });
    expect(lake.ok).toBe(true);
    expect(pointAt(lake.path, 290).y).toBeLessThanOrEqual(-GRADES.road.under + 1e-6);
    expect(lake.path[0].y).toBe(0);
  });

  it('railways climb far less steeply than roads, unless they are rack railways', () => {
    const n = new Network();
    n.build({ x: -200, z: 0 }, { x: 200, z: 0 });
    const opts = (type: string, grade: number) => ({ ...DEFAULT_OPTS, cross: 'bridge' as const, type, grade });
    // 7.8 m of clearance for the wires at 2.5% needs 312 m of run-up; we only have ~130 m
    expect(n.check({ x: 0, z: -140 }, { x: 0, z: 400 }, undefined, opts('rail-main', 0.08)).reason).toMatch(/Can't climb/);
    const rack = n.check({ x: 0, z: -140 }, { x: 0, z: 400 }, undefined, opts('rail-rack', 0.2));
    expect(rack.ok).toBe(true);
    expect(rack.profile!.maxY).toBeGreaterThanOrEqual(GRADES.rail.clear - 1e-6);
    // road and rail never meet at a junction
    const s = n.snapStart({ x: 50, z: 1 }, 5, 'rail');
    expect(s.seg).toBeUndefined();
  });
});
