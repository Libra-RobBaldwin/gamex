import { describe, expect, it } from 'vitest';
import { Region, RegionGrid, slippyAt, slippyCorner, slippyCover, slippyZoomFor } from './geo';
import { keyAt, keysAlong, parseKey, tileAt } from './tiles';

// Meridian arc length from the equator, integrated numerically (Simpson), as an independent check
// on the projection's northings.
function meridianArc(latDeg: number) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const phi = (latDeg * Math.PI) / 180, n = 20000, h = phi / n;
  const M = (p: number) => (a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(p) ** 2, 1.5);
  let s = M(0) + M(phi);
  for (let k = 1; k < n; k++) s += (k % 2 ? 4 : 2) * M(k * h);
  return (s * h) / 3;
}

const york = { lat: 53.959, lon: -1.0815 };

describe('regional projection', () => {
  it('round-trips lat/lon ↔ metres to well under a centimetre within 50 km', () => {
    const r = new Region('york', york);
    let worst = 0;
    for (let a = -50; a <= 50; a += 5) for (let b = -50; b <= 50; b += 5) {
      const p = { x: a * 1000 + 0.37, z: b * 1000 - 0.61 };
      const q = r.toWorld(r.fromWorld(p));
      worst = Math.max(worst, Math.hypot(q.x - p.x, q.z - p.z));
    }
    expect(worst).toBeLessThan(1e-6); // a micrometre; the requirement is 1 cm
    const o = r.toWorld(york);
    expect(Math.hypot(o.x, o.z)).toBeLessThan(1e-9);
  });
  it('northings along the origin meridian are true meridian arc lengths', () => {
    const r = new Region('york', york);
    for (const dLat of [-0.45, -0.1, 0.2, 0.45]) {
      const want = meridianArc(york.lat + dLat) - meridianArc(york.lat);
      expect(-r.toWorld({ lat: york.lat + dLat, lon: york.lon }).z).toBeCloseTo(want, 3);
    }
  });
  it('east is +x, north is −z, and scale stays within 1 + 3·10⁻⁵ at 50 km', () => {
    const r = new Region('york', york);
    const e = r.toWorld({ lat: york.lat, lon: york.lon + 0.1 }), n = r.toWorld({ lat: york.lat + 0.1, lon: york.lon });
    expect(e.x).toBeGreaterThan(6000); expect(Math.abs(e.z)).toBeLessThan(40); // parallels curve a little
    expect(n.z).toBeLessThan(-11000); expect(Math.abs(n.x)).toBeLessThan(1e-6);
    expect(r.scaleAt({ x: 0, z: 0 })).toBeCloseTo(1, 7);
    const k = r.scaleAt({ x: 50000, z: 0 });
    expect(k - 1).toBeGreaterThan(2.5e-5); expect(k - 1).toBeLessThan(3.5e-5);
  });
  it('handles the antimeridian and the southern hemisphere', () => {
    const r = new Region('fiji', { lat: -17.7, lon: 179.95 });
    const p = r.toWorld({ lat: -17.72, lon: -179.98 });
    expect(p.x).toBeGreaterThan(7000); expect(p.x).toBeLessThan(8000);
    const back = r.fromWorld(p);
    expect(back.lon).toBeCloseTo(-179.98, 9);
  });
});

describe('region grid (maps bigger than one projection)', () => {
  it('puts places in the right region and hands over without loss', () => {
    const g = new RegionGrid(york);
    expect(g.regionAt(york).id).toBe('0,0');
    const far = { lat: york.lat + 0.9, lon: york.lon + 1.6 }; // ~100 km N, ~105 km E
    const r = g.regionAt(far);
    expect(r.id).toBe('2,2');
    // a point known in region 0,0's metres, handed to 2,2 and back
    const p0 = g.anchor.toWorld(far), p1 = g.transfer(p0, g.anchor, r), p2 = g.transfer(p1, r, g.anchor);
    expect(Math.hypot(p2.x - p0.x, p2.z - p0.z)).toBeLessThan(1e-6);
    expect(Math.hypot(p1.x, p1.z)).toBeLessThan(30000); // near its own region's origin
  });
  it('a local rigid transform draws a neighbour region to within centimetres near the border', () => {
    const g = new RegionGrid(york);
    const a = g.region(0, 0), b = g.region(1, 0);
    const at = { x: 25000, z: 0 }, T = g.localTransform(at, a, b);
    expect(Math.abs(T.rot)).toBeGreaterThan(0.005); // meridian convergence is real
    for (const d of [[0, 0], [500, 300], [-800, -600]]) {
      const p = { x: at.x + d[0], z: at.z + d[1] }, exact = g.transfer(p, a, b), approx = T.apply(p);
      expect(Math.hypot(exact.x - approx.x, exact.z - approx.z)).toBeLessThan(0.05);
    }
  });
});

describe('tiles and slippy tiles', () => {
  it('keys tiles on a 1 km grid, negative side included', () => {
    expect(tileAt(999.9, -0.1)).toEqual({ i: 0, j: -1 });
    expect(keyAt(-1000, 2500)).toBe('-1,2');
    expect(parseKey('-3,12')).toEqual({ i: -3, j: 12 });
    expect(keysAlong([{ x: 10, z: 10 }, { x: 2100, z: 10 }]).sort()).toEqual(['0,0', '1,0', '2,0']);
  });
  it('matches known slippy tile numbers', () => {
    // central London at z=10 is (511, 340) in OSM's scheme
    expect(slippyAt({ lat: 51.5074, lon: -0.1278 }, 10)).toEqual({ z: 10, x: 511, y: 340 });
    const c = slippyCorner({ z: 10, x: 511, y: 340 });
    expect(slippyAt({ lat: c.lat - 1e-6, lon: c.lon + 1e-6 }, 10)).toEqual({ z: 10, x: 511, y: 340 });
  });
  it('covers each of our tiles with the web tiles that overlap it', () => {
    const r = new Region('york', york);
    const z = slippyZoomFor(1000, york.lat);
    expect(z).toBe(15); // ~717 m tiles at 54°N
    const cover = slippyCover(r, 3, -2, z);
    expect(cover.length).toBeGreaterThanOrEqual(4); expect(cover.length).toBeLessThanOrEqual(9);
    // every sampled point of our tile falls in one of them
    const keys = new Set(cover.map((t) => `${t.x},${t.y}`));
    for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) {
      const t = slippyAt(r.fromWorld({ x: 3000 + a * 99.9, z: -2000 + b * 99.9 }), z);
      expect(keys.has(`${t.x},${t.y}`)).toBe(true);
    }
  });
});
