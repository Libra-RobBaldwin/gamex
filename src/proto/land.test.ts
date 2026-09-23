import { describe, expect, it } from 'vitest';
import { Land, circlePoly, polysTouch } from './land';
import { DEFAULT_OPTS, Network, ROADS, rectCorners } from './roads';
import { design, landFits, legsAt } from './junction';
import { pointInPoly } from './land';
import { kerbOf } from './catalog';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
const geo = (n: Network, node: number) => ({ fits: (polys: Parameters<typeof landFits>[2]) => landFits(n, node, polys) });

describe('land registry', () => {
  it('knows who owns what, and forgets released claims', () => {
    const land = new Land();
    land.claim('junction:1', 'junction', [circlePoly({ x: 0, z: 0 }, 10)]);
    expect(land.at({ x: 3, z: 3 })?.key).toBe('junction:1');
    expect(land.at({ x: 30, z: 0 })).toBeUndefined();
    expect(land.free(rectCorners(15, 0, 0, 4, 4))).toBe(true);
    expect(land.free(rectCorners(9, 0, 0, 4, 4))).toBe(false);
    land.release('junction:1');
    expect(land.free(rectCorners(0, 0, 0, 4, 4))).toBe(true);
  });
  it('overlap works for concave shapes too', () => {
    const L = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 10 }, { x: 0, z: 10 }];
    expect(polysTouch(L, rectCorners(6, 6, 0, 3, 3))).toBe(false); // in the notch
    expect(polysTouch(L, rectCorners(1, 5, 0, 1, 1))).toBe(true);
  });
  it('roads claim their land, so plots keep off them', () => {
    const n = new Network();
    const [id] = n.build({ x: -100, z: 0 }, { x: 100, z: 0 });
    expect(n.land.get(`road:${id}`)).toBeDefined();
    expect(n.clearOfWorks(rectCorners(0, 3, 0, 4, 4))).toBe(false);
    expect(n.clearOfWorks(rectCorners(0, 20, 0, 4, 4))).toBe(true);
  });
});

describe('junction shapes', () => {
  it('a T gets rounded kerbs, its side road stops at the mouth, and the shape covers the centre', () => {
    const n = new Network();
    n.build({ x: -150, z: 0 }, { x: 150, z: 0 });
    n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 150 });
    const node = n.nearestNode({ x: 0, z: 0 }, 1)!.id;
    const j = design(n, node, geo(n, node))!;
    const sh = j.shape!;
    expect(pointInPoly({ x: 0, z: 0 }, sh.apron)).toBe(true);
    const side = legsAt(n, node).find((l) => !j.major.includes(l.seg.id))!;
    // the give-way line sits past the major road's kerb plus the corner radius
    expect(sh.line[side.seg.id]).toBeGreaterThan(kerbOf(ROADS.street) + 4);
    // the corner is rounded: a point just inside the kerb corner is carriageway
    expect(pointInPoly({ x: 4.5, z: 4.5 }, sh.apron)).toBe(true);
    expect(pointInPoly({ x: 12, z: 12 }, sh.apron)).toBe(false);
  });
  it('a slip lane cuts the corner with an island inside it, on land nobody else has', () => {
    const n = new Network();
    n.build({ x: -150, z: 0 }, { x: 150, z: 0 }, undefined, as('arterial-2-30-0-0-0'));
    n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 150 });
    const node = n.nearestNode({ x: 0, z: 0 }, 1)!.id;
    const j = design(n, node, geo(n, node))!;
    expect(j.slip).not.toBeNull();
    const isl = j.shape!.islands[0];
    // the island is in a corner, outside both kerbs
    const c = isl.reduce((a, p) => ({ x: a.x + p.x / isl.length, z: a.z + p.z / isl.length }), { x: 0, z: 0 });
    expect(Math.abs(c.x)).toBeGreaterThan(kerbOf(ROADS.street));
    expect(Math.abs(c.z)).toBeGreaterThan(kerbOf(ROADS['arterial-2-30-0-0-0']));
    // and the slip road's ends run along the two roads it joins
    const p0 = j.slip!.path[0], p1 = j.slip!.path[j.slip!.path.length - 1];
    expect(Math.min(Math.abs(p0.x), Math.abs(p0.z))).toBeLessThan(kerbOf(ROADS['arterial-2-30-0-0-0']));
    expect(Math.min(Math.abs(p1.x), Math.abs(p1.z))).toBeLessThan(kerbOf(ROADS['arterial-2-30-0-0-0']));
  });
  it('once a roundabout claims its land, no plot can be laid on it', () => {
    const n = new Network();
    n.build({ x: -150, z: 0 }, { x: 150, z: 0 }, undefined, as('dual'));
    n.build({ x: 0, z: -150 }, { x: 0, z: 150 }, undefined, as('dual'));
    const node = n.nearestNode({ x: 0, z: 0 }, 1)!.id;
    const j = design(n, node, geo(n, node))!;
    expect(j.form).toBe('roundabout');
    n.land.claim(`junction:${node}`, 'junction', j.shape!.claims);
    // a lot on the ring's corner land, between two of its roads
    const corner = { x: (j.R - 2) * 0.72, z: (j.R - 2) * 0.72 };
    const lot = { id: 1, x: corner.x, z: corner.z, rot: Math.PI / 4, w: 8, d: 8, h: 6, kind: 'house' as const, seg: 0, seed: 0, row: 0, front: 3, back: 5, px: 0, pw: 8 };
    expect(n.lotFree(lot)).toBe(false);
    // and plots along the roads start beyond it
    for (const s of n.segs.values()) for (const l of n.plotsFor(s.id)) expect(Math.hypot(l.x, l.z)).toBeGreaterThan(j.R);
  });
  it('motorways end at a roundabout rather than a side-road T', () => {
    const n = new Network();
    n.build({ x: -300, z: 0 }, { x: 0, z: 0 }, undefined, as('motorway'));
    n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 300, z: 0 }, undefined, as('dual-2-70-0'));
    n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 200 }, undefined, as('dual'));
    const node = n.nearestNode({ x: 0, z: 0 }, 1)!.id;
    expect(design(n, node, geo(n, node))!.form).toBe('roundabout');
  });
});
