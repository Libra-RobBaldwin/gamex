import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, ROADS, kerbOf, halfOf } from './roads';
import { laneSpan, sectionAt, taperOf } from './xsection';

describe('where a dual carriageway becomes a single road', () => {
  const n = new Network();
  const [st] = n.build({ x: -200, z: 0 }, { x: 0, z: 0 });
  const [du] = n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 300, z: 0 }, undefined, { ...DEFAULT_OPTS, type: 'dual' });
  const dual = n.segs.get(du)!, street = n.segs.get(st)!;
  const join = dual.a;
  it('only the wider road tapers, at the end where they meet', () => {
    expect(taperOf(n, street).A).toBeNull();
    expect(taperOf(n, street).B).toBeNull();
    const t = taperOf(n, dual);
    expect(t.A?.to.id).toBe('street');
    expect(t.B).toBeNull();
  });
  it('matches the street exactly at the join and is a full dual beyond the taper', () => {
    const at0 = sectionAt(n, dual, 0), T = taperOf(n, dual).A!;
    expect(at0.kerb).toBeCloseTo(kerbOf(ROADS.street), 5);
    expect(at0.back).toBeCloseTo(halfOf(ROADS.street), 5);
    expect(at0.lanes).toBe(1);
    const far = sectionAt(n, dual, T.len + 1);
    expect(far.kerb).toBeCloseTo(kerbOf(ROADS.dual), 5);
    expect(far.lanes).toBe(2);
    // the reservation opens as hatching, before the second lane appears
    const mid = sectionAt(n, dual, T.len * 0.35);
    expect(mid.hatched).toBe(true);
    expect(mid.lanes).toBe(1);
  });
  it('the offside lane ends before the join, and opens after it the other way', () => {
    const L = n.length(dual);
    const towardJoin = laneSpan(n, dual, dual.b, 1), awayFromJoin = laneSpan(n, dual, join, 1);
    expect(towardJoin[0]).toBe(0);
    expect(towardJoin[1]).toBeLessThan(L - 20);
    expect(awayFromJoin[0]).toBeGreaterThan(20);
    expect(awayFromJoin[1]).toBe(L);
    expect(laneSpan(n, dual, dual.b, 0)).toEqual([0, L]);
  });
});
