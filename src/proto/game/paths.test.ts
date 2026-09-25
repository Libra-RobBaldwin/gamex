import { describe, expect, it } from 'vitest';
import { Network, type Lot } from '../roads';
import { DeadEndPaths, deadEndPaths } from './paths';

const lot = (x: number, z: number, w = 10, d = 10): Lot => ({ id: -1, x, z, rot: 0, w, d, h: 7, kind: 'house', seg: -1, seed: 1, row: 0, front: 0, back: 0, px: 0, pw: w });

describe('paths at dead ends', () => {
  it('runs a path from a cul-de-sac through to the street ahead of it', () => {
    const n = new Network();
    n.build({ x: -200, z: 0 }, { x: 200, z: 0 }); // the street
    n.build(n.snapStart({ x: 0, z: 0 }, 2), { x: 0, z: 100 }); // the cul-de-sac, ending 100 m south
    n.build({ x: -200, z: 160 }, { x: 200, z: 160 }); // the next street, 60 m on
    const ps = deadEndPaths(n, []);
    const p = ps.find((q) => Math.abs(q.a.z - 100) < 1)!;
    expect(p.through).toBe(true);
    expect(p.b.z).toBeGreaterThan(145);
    expect(p.b.z).toBeLessThan(160);
    const paths = new DeadEndPaths();
    paths.update(n, []);
    expect(n.land.at({ x: 0, z: 130 })?.key).toMatch(/^path:/);
  });
  it('makes a short stub when no street is near, and none over a building', () => {
    const n = new Network();
    n.build({ x: -200, z: 0 }, { x: 200, z: 0 });
    n.build(n.snapStart({ x: 0, z: 0 }, 2), { x: 0, z: 100 });
    const [p] = deadEndPaths(n, []).filter((q) => Math.abs(q.a.z - 100) < 1);
    expect(p.through).toBe(false);
    expect(Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z)).toBeCloseTo(12, 0);
    expect(deadEndPaths(n, [lot(0, 108)]).filter((q) => Math.abs(q.a.z - 100) < 1)).toEqual([]);
  });
});
