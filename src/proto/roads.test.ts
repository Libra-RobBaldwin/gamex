import { describe, expect, it } from 'vitest';
import { Network, polysOverlap, rectCorners } from './roads';

describe('free-form roads', () => {
  it('snaps angles to 15° and lengths to 4 m', () => {
    const n = new Network();
    const e = n.snapEnd({ x: 0, z: 0 }, { x: 50, z: 13 }, 6);
    const ang = (Math.atan2(e.z, e.x) * 180) / Math.PI;
    expect(Math.round(ang) % 15).toBe(0);
    expect(Math.round(Math.hypot(e.x, e.z)) % 4).toBe(0);
  });

  it('joins onto existing nodes and splits roads to make junctions', () => {
    const n = new Network();
    n.build({ x: -50, z: 0 }, { x: 50, z: 0 });
    expect(n.segs.size).toBe(1);
    // a road starting on the middle of the first one creates a T junction
    const s = n.snapStart({ x: 1, z: 2 }, 6);
    expect(s.seg).toBeDefined();
    n.build(s, { x: 0, z: 60 });
    expect(n.segs.size).toBe(3);
    const junction = n.nearestNode({ x: 1, z: 0 }, 3)!;
    expect(n.segsAt(junction.id).length).toBe(3);
  });

  it('crossing roads become crossroads', () => {
    const n = new Network();
    n.build({ x: -50, z: 0 }, { x: 50, z: 0 });
    n.build({ x: 0, z: -50 }, { x: 0, z: 50 });
    expect(n.segs.size).toBe(4);
    const c = n.nearestNode({ x: 0, z: 0 }, 1)!;
    expect(n.segsAt(c.id).length).toBe(4);
  });

  it('lays plots along diagonal roads facing the street, without overlaps', () => {
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: 140, z: 80 });
    const lots = n.plotsFor(id, { x: 999, z: 999 });
    expect(lots.length).toBeGreaterThan(6);
    const rot = Math.atan2(80, 140);
    for (const l of lots) expect(Math.abs(Math.sin(l.rot - rot))).toBeLessThan(1e-9);
    for (let i = 0; i < lots.length; i++)
      for (let j = i + 1; j < lots.length; j++)
        expect(polysOverlap(rectCorners(lots[i].x, lots[i].z, lots[i].rot, lots[i].w, lots[i].d), rectCorners(lots[j].x, lots[j].z, lots[j].rot, lots[j].w, lots[j].d))).toBe(false);
  });

  it('clears buildings in the way (at a cost) but refuses water', () => {
    const n = new Network((p) => p.x > 100 && p.x < 140);
    const [id] = n.build({ x: 0, z: 0 }, { x: 90, z: 0 });
    n.lots.push(...n.plotsFor(id, { x: 999, z: 999 }));
    const l = n.lots[0];
    const c = n.check({ x: l.x, z: l.z - 40 }, { x: l.x, z: l.z + 40 });
    expect(c.ok).toBe(true);
    expect(c.clears.map((x) => x.id)).toContain(l.id);
    const before = n.lots.length;
    n.build({ x: l.x, z: l.z - 40 }, { x: l.x, z: l.z + 40 });
    expect(n.lots.length).toBeLessThan(before);
    expect(n.check({ x: 90, z: 20 }, { x: 160, z: 20 }).reason).toMatch(/Water/);
  });
});
