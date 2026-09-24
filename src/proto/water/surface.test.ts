import { describe, expect, it } from 'vitest';
import { FnHeight, ProceduralTerrain, TERRAIN_PRESETS, tileMesh } from '../terrain';
import { reedSpots, shoreColours, waterSurface } from './surface';
import { KIND_CODE } from './types';
import { WaterSystem } from './water';

describe('the water mesh', () => {
  it('covers the water at its level, faces up, and merges open water', () => {
    // the sea to the west, deep well offshore
    const w = new WaterSystem(new FnHeight((x) => (x - 600) / 20), { region: 2000, margin: 400, cell: 16, sea: 0 });
    const t = w.tile(0, 0), m = waterSurface(t)!;
    expect(m).not.toBeNull();
    const P = m.positions, I = m.indices;
    for (let q = 0; q < I.length; q += 3) {
      const [a, b, c] = [I[q], I[q + 1], I[q + 2]].map((v) => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
      expect(uz * vx - ux * vz).toBeGreaterThan(0); // up
    }
    // wet sea vertices are at sea level
    let wet = 0;
    for (let v = 0; v < m.vertexCount; v++) if (m.water[v * 4] > 0.01 && m.kind[v] === KIND_CODE.sea) { expect(P[v * 3 + 1]).toBeCloseTo(0, 5); wet++; }
    expect(wet).toBeGreaterThan(100);
    // the open sea is drawn in fans: far fewer triangles than two per 4 m cell of water
    const cells = t.wet;
    expect(m.triangleCount).toBeLessThan(cells * 2 * 0.5);
    // dry ground has no water mesh (a flat plain still drains into streams: no rivers here)
    expect(waterSurface(new WaterSystem(new FnHeight(() => 10), { region: 2000, margin: 400, cell: 16, riverArea: 1e9 }).tile(0, 0))).toBeNull();
  });
  it('colours the ground by the water and puts reeds on lake and river edges only', () => {
    const w = new WaterSystem(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }));
    const t = w.tile(2, 4), m = tileMesh(w.terrain, 2, 4, { cells: 128, skirt: 0 }), c = shoreColours(t, m);
    let bed = 0, far = 0;
    for (let v = 0; v < m.vertexCount; v++) {
      const a = c[v * 4 + 3];
      expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(1);
      const x = m.offset[0] + m.positions[v * 3], z = m.offset[1] + m.positions[v * 3 + 2];
      if (w.isWater(x, z) && a > 0.99) bed++;
      if (w.distanceToShore(x, z) < -40 && a > 0) far++;
    }
    expect(bed).toBeGreaterThan(10);
    expect(far).toBe(0);
    const r = reedSpots(t);
    expect(r.length % 5).toBe(0);
    expect(r.length / 5).toBeGreaterThan(5);
    for (let i = 0; i < r.length; i += 5) {
      expect(r[i]).toBeGreaterThanOrEqual(2000 - 2); expect(r[i]).toBeLessThanOrEqual(3000 + 2); // (jittered up to half a cell)
      expect(Math.abs(w.distanceToShore(r[i], r[i + 2]))).toBeLessThan(8);
      expect(w.kindAt(r[i], r[i + 2]) === 'sea').toBe(false);
    }
    expect(reedSpots(t)).toEqual(r); // deterministic
  });
});
