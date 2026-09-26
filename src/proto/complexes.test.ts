import { describe, expect, it } from 'vitest';
import { groupShops } from './complexes';
import { rectCorners, type Lot } from './roads';
import { unitsOf } from './buildgen';

// a street of plots along x, fronting +z (as the Network lays them out on side -1)
function street(kinds: Lot['kind'][], w = 14, gap = 4): Lot[] {
  let t = 0;
  return kinds.map((kind, i) => {
    const l: Lot = { id: i + 1, x: t + w / 2, z: -(4 + 6), rot: 0, w, d: 12, h: 10, kind, seg: 1, seed: 0.3, row: 7, front: 4, back: 7, px: gap / 2, pw: w + gap };
    t += w + gap;
    return l;
  });
}
const overlap = (a: Lot, b: Lot) => {
  const A = rectCorners(a.x, a.z, a.rot, a.w, a.d), B = rectCorners(b.x, b.z, b.rot, b.w, b.d);
  const xs = (P: { x: number }[]) => [Math.min(...P.map((p) => p.x)), Math.max(...P.map((p) => p.x))];
  const [a0, a1] = xs(A), [b0, b1] = xs(B);
  return Math.min(a1, b1) - Math.max(a0, b0) > 0.01;
};

describe('shopping complexes from plots', () => {
  it('merge a run of shops into one plot holding as many shops', () => {
    const g = groupShops(street(['shop', 'shop', 'shop']));
    expect(g).toHaveLength(1);
    expect(g[0].arch).toBe('parade');
    expect(unitsOf(g[0])).toBe(3);
    // (it spans the three buildings, keeps the street's front line, and ends where they ended)
    expect(g[0].w).toBeCloseTo(14 * 3 + 4 * 2, 5);
    expect(g[0].x - g[0].w / 2).toBeCloseTo(0, 5);
    expect(g[0].z + g[0].d / 2 + g[0].front).toBeCloseTo(-10 + 6 + 4, 5);
  });
  it('leave lone shops and other kinds alone, and never overlap what they keep', () => {
    const lots = street(['shop', 'house', 'shop', 'shop', 'shop', 'shop', 'flats', 'shop']);
    const g = groupShops(lots);
    expect(g.map((l) => l.arch ?? l.kind)).toEqual(['shop', 'house', 'arcade', 'flats', 'shop']);
    expect(g.reduce((n, l) => n + unitsOf(l), 0)).toBe(lots.length);
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) expect(overlap(g[i], g[j])).toBe(false);
  });
  it('break a run where the street turns or the plots step apart', () => {
    const lots = street(['shop', 'shop', 'shop', 'shop']);
    lots[2] = { ...lots[2], x: lots[2].x + 30 };
    lots[3] = { ...lots[3], x: lots[3].x + 30 };
    expect(groupShops(lots).map((l) => l.arch)).toEqual(['parade', 'parade']);
    const bent = street(['shop', 'shop']);
    bent[1] = { ...bent[1], rot: 0.3 };
    expect(groupShops(bent).every((l) => !l.arch)).toBe(true);
  });
});
