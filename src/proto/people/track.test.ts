import { describe, expect, it } from 'vitest';
import { circleRoute, figureAt, fitRoute, legPoint, Mode, reverseRoute, routePoint, straightRoute, type Motion } from './track';
import { offsetLine, vdc } from './util';

const loop = (o: Partial<Motion> = {}): Motion => ({ mode: Mode.Loop, v: 1.4, s0: 0, lat: 0, t0: 0, tShow: 0, tHide: 0, y: 0, ...o });

describe('routes: legs of lines and arcs', () => {
  it('an arc leg ends where the circle says, heading turned by k·L', () => {
    const l = { x: 10, z: 0, h: Math.PI / 2, k: 1 / 10, L: (Math.PI / 2) * 10, S: 0 };
    const e = legPoint(l, l.L);
    expect(e.x).toBeCloseTo(0);
    expect(e.z).toBeCloseTo(10);
    expect(e.a).toBeCloseTo(Math.PI);
  });

  it('fits a sampled curve with a few smooth arcs that stay on it', () => {
    const pts = Array.from({ length: 41 }, (_, i) => { const a = (i / 40) * Math.PI * 0.8; return { x: Math.cos(a) * 30, z: Math.sin(a) * 30 }; });
    const r = fitRoute(pts, 0.25);
    expect(r.legs.length).toBeLessThanOrEqual(2);
    expect(r.length).toBeCloseTo(30 * Math.PI * 0.8, 0);
    for (let s = 0; s <= r.length; s += 1) { const p = routePoint(r, s); expect(Math.abs(Math.hypot(p.x, p.z) - 30)).toBeLessThan(0.3); }
    // each leg starts on the heading the last one ended on
    for (let i = 1; i < r.legs.length; i++) { const e = legPoint(r.legs[i - 1], r.legs[i - 1].L); expect(Math.cos(e.a - r.legs[i].h)).toBeCloseTo(1, 4); }
  });

  it('a straight footway is one leg, however many points it has', () => {
    const r = fitRoute([{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 45, z: 0 }, { x: 90, z: 0 }]);
    expect(r.legs).toHaveLength(1);
    expect(r.length).toBeCloseTo(90);
  });

  it('reversing swaps the ends and turns every heading round', () => {
    const r = fitRoute(Array.from({ length: 21 }, (_, i) => ({ x: i * 3, z: Math.sin(i / 6) * 8 })), 0.2);
    const b = reverseRoute(r);
    const a0 = routePoint(r, 0), a1 = routePoint(r, r.length), b0 = routePoint(b, 0), b1 = routePoint(b, b.length);
    expect(b0.x).toBeCloseTo(a1.x, 3); expect(b0.z).toBeCloseTo(a1.z, 3);
    expect(b1.x).toBeCloseTo(a0.x, 3); expect(b1.z).toBeCloseTo(a0.z, 3);
    expect(Math.cos(b0.a - (a1.a + Math.PI))).toBeCloseTo(1, 4);
  });

  it('offsets to the left of travel', () => {
    const l = offsetLine([{ x: 0, z: 0 }, { x: 10, z: 0 }], 2);
    // travelling +x, left (looking down on the map) is −z
    expect(l[0]).toEqual({ x: 0, z: -2 });
    expect(l[1].z).toBeCloseTo(-2);
  });
});

describe('figures on routes', () => {
  it('a looping walker wraps round and fades only near the route ends', () => {
    const r = straightRoute([{ x: 0, z: 0 }, { x: 50, z: 0 }]);
    const m = loop({ s0: 10 });
    expect(figureAt(r, m, 0).x).toBeCloseTo(10);
    expect(figureAt(r, m, 10).x).toBeCloseTo(24);
    expect(figureAt(r, m, 30).x).toBeCloseTo((10 + 42) % 50);
    expect(figureAt(r, m, 0).alpha).toBe(1);
    expect(figureAt(r, loop({ s0: 49.8 }), 0).alpha).toBeLessThan(0.1);
  });

  it('keeps its side of the path as the path turns (left of this ring is outwards)', () => {
    const c = circleRoute({ x: 0, z: 0 }, 10);
    for (const t of [0, 3, 11]) { const f = figureAt(c, { ...loop(), mode: Mode.Closed, lat: 1 }, t); expect(Math.hypot(f.x, f.z)).toBeCloseTo(11, 4); }
  });

  it('a one-off walk waits at the start, walks, then stands at the end', () => {
    const r = straightRoute([{ x: 0, z: 0 }, { x: 10, z: 0 }]);
    const m: Motion = { mode: Mode.Once, v: 2, s0: 0, lat: 0, t0: 5, tShow: 0, tHide: 20, y: 0 };
    expect(figureAt(r, m, 2)).toMatchObject({ x: 0, moving: false });
    expect(figureAt(r, m, 7).x).toBeCloseTo(4);
    expect(figureAt(r, m, 7).moving).toBe(true);
    expect(figureAt(r, m, 15)).toMatchObject({ x: 10, moving: false });
    expect(figureAt(r, m, 20).alpha).toBe(0);
  });

  it('the first n of a stream are spread along it, whatever n is', () => {
    for (const n of [3, 7, 20]) {
      const s = Array.from({ length: n }, (_, k) => vdc(k)).sort((a, b) => a - b);
      const gaps = s.map((x, i) => (i ? x - s[i - 1] : x + 1 - s[s.length - 1]));
      expect(Math.max(...gaps)).toBeLessThanOrEqual(2 / n + 1e-9);
    }
  });
});
