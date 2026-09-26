import { describe, expect, it } from 'vitest';
import { pointInPoly } from '../land';
import { FlatHeight, FnHeight } from './height';
import { cutHoles, drapeStrip, raycast, tileMesh, waterMesh, type MeshData } from './mesh';
import { landSource } from '../worldmap/land';

const bumpy = new FnHeight((x, z) => 20 * Math.sin(x / 37) * Math.cos(z / 53) + 0.01 * x);
const vert = (m: MeshData, v: number) => [m.positions[v * 3] + m.offset[0], m.positions[v * 3 + 1], m.positions[v * 3 + 2] + m.offset[1]];
// every triangle's face normal should point up (the ground is seen from above)
const facesUp = (m: MeshData, tris: number) => {
  const P = m.positions, I = m.indices;
  for (let t = 0; t < tris * 3; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const ux = P[b * 3] - P[a * 3], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vz = P[c * 3 + 2] - P[a * 3 + 2];
    if (uz * vx - ux * vz <= 0) return false;
  }
  return true;
};
// height along a tile's edge polyline at world z (for the east edge, i = N)
const edgeHeight = (m: MeshData, N: number, i: number, z: number) => {
  const M = N + 1, step = (vert(m, M * M - 1)[2] - vert(m, 0)[2]) / N, j = Math.min(N - 1, Math.floor((z - m.offset[1]) / step)), t = (z - m.offset[1]) / step - j;
  return m.positions[(j * M + i) * 3 + 1] * (1 - t) + m.positions[((j + 1) * M + i) * 3 + 1] * t;
};

describe('terrain meshing', () => {
  it('vertex and triangle counts per level of detail, with and without skirts', () => {
    for (const lod of [0, 1, 2, 3]) {
      const N = 64 >> lod, m = tileMesh(bumpy, 0, 0, { cells: 64, lod });
      expect(m.vertexCount).toBe((N + 1) ** 2 + 4 * (N + 1));
      expect(m.triangleCount).toBe(2 * N * N + 8 * N);
      expect(m.indices.length).toBe(m.triangleCount * 3);
      expect(m.positions.length).toBe(m.vertexCount * 3);
      const bare = tileMesh(bumpy, 0, 0, { cells: 64, lod, skirt: 0 });
      expect(bare.vertexCount).toBe((N + 1) ** 2);
      expect(bare.triangleCount).toBe(2 * N * N);
      expect(facesUp(bare, bare.triangleCount)).toBe(true);
    }
    expect(tileMesh(bumpy, 0, 0, { cells: 128 }).indices).toBeInstanceOf(Uint16Array);
    expect(tileMesh(bumpy, 0, 0, { cells: 256 }).indices).toBeInstanceOf(Uint32Array);
  });

  it('vertices sit on the ground, normals are unit length and lean away from the rise', () => {
    const m = tileMesh(bumpy, 2, -1, { cells: 32, skirt: 0 });
    for (const v of [0, 100, 500, 1088]) {
      const [x, y, z] = vert(m, v);
      expect(y).toBeCloseTo(bumpy.heightAt(x, z), 4);
      const [nx, ny, nz] = [m.normals[v * 3], m.normals[v * 3 + 1], m.normals[v * 3 + 2]], [ex, ey, ez] = bumpy.normalAt(x, z);
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
      expect(nx * ex + ny * ey + nz * ez).toBeGreaterThan(0.99);
    }
    expect(m.offset).toEqual([2000, -1000]);
  });

  it('same level: neighbouring tiles share their edge exactly, normals included', () => {
    const src = landSource({ landform: 'uplands', seed: 7 }).source;
    const a = tileMesh(src, 0, 0, { cells: 32, skirt: 0 }), b = tileMesh(src, 1, 0, { cells: 32, skirt: 0 }), M = 33;
    for (let j = 0; j < M; j++) {
      const va = j * M + 32, vb = j * M;
      expect(vert(a, va)).toEqual(vert(b, vb));
      for (let c = 0; c < 3; c++) expect(a.normals[va * 3 + c]).toBeCloseTo(b.normals[vb * 3 + c], 5);
    }
  });

  it('different levels: stitching makes the edges one polyline; without it there are cracks', () => {
    const fine = { cells: 64, lod: 0, skirt: 0 }, coarse = { cells: 64, lod: 2, skirt: 0 };
    const b = tileMesh(bumpy, 1, 0, coarse); // east neighbour, 16 cells
    const raw = tileMesh(bumpy, 0, 0, fine), sewn = tileMesh(bumpy, 0, 0, { ...fine, stitch: { e: 2 } });
    let crack = 0, gap = 0;
    for (let z = 0.5; z < 1000; z += 7.3) {
      const hb = edgeHeight(b, 16, 0, z);
      crack = Math.max(crack, Math.abs(edgeHeight(raw, 64, 64, z) - hb));
      gap = Math.max(gap, Math.abs(edgeHeight(sewn, 64, 64, z) - hb));
    }
    expect(crack).toBeGreaterThan(0.1);
    expect(gap).toBeLessThan(1e-3);
    // the other edges are untouched
    expect(sewn.positions.slice(0, 65 * 3)).toEqual(raw.positions.slice(0, 65 * 3));
  });

  it('skirts hang below every edge and face outwards', () => {
    const m = tileMesh(new FlatHeight(5), 0, 0, { cells: 8, skirt: 12 }), M = 9;
    for (let v = M * M; v < m.vertexCount; v++) expect(m.positions[v * 3 + 1]).toBe(-7);
    expect(m.min).toBe(-7);
    // the north skirt (first after the grid) faces −z
    const I = m.indices, t = 2 * 8 * 8 * 3, P = m.positions;
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const u = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]], w = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    expect(u[0] * w[1] - u[1] * w[0]).toBeLessThan(0); // z of the cross product
  });

  it('water surfaces where there is water, nothing where there is none', () => {
    const lake = new FnHeight((x, z) => Math.hypot(x - 500, z - 500) / 20 - 5, (x, z) => (Math.hypot(x - 500, z - 500) < 150 ? 0 : null));
    const w = waterMesh(lake, 0, 0, { cells: 50 })!;
    expect(w.triangleCount).toBeGreaterThan(50);
    for (let v = 0; v < w.vertexCount; v++) expect(w.positions[v * 3 + 1]).toBe(0);
    expect(waterMesh(new FlatHeight(3), 0, 0)).toBeNull();
  });

  it('draped strips follow the ground; holes can also be cut out of the mesh', () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: 100 + i * 10, z: 300 }));
    const s = drapeStrip(bumpy, pts, () => [8, 8], 0.05);
    for (let v = 0; v < s.vertexCount; v++) {
      const [x, y, z] = vert(s, v);
      expect(y).toBeCloseTo(bumpy.heightAt(x, z) + 0.05, 4);
    }
    expect(facesUp(s, s.triangleCount)).toBe(true);
    const m = tileMesh(bumpy, 0, 0, { cells: 50, skirt: 0 });
    const hole = [{ x: 100, z: 292 }, { x: 300, z: 292 }, { x: 300, z: 308 }, { x: 100, z: 308 }];
    const kept = cutHoles(m, [hole], pointInPoly);
    expect(kept.length).toBeLessThan(m.indices.length);
    expect(m.indices.length - kept.length).toBeGreaterThanOrEqual(3 * 2 * 10); // the cells under the strip
  });

  it('picks the ground under a ray, hills included', () => {
    const hill = new FnHeight((x) => (x > 100 ? 50 : 0));
    const hit = raycast(hill, [0, 100, 0], [1, -0.2, 0])!;
    expect(hit.x).toBeCloseTo(250, 0); // it flies over the plain and hits the hill's top at y = 50
    expect(hit.y).toBeCloseTo(50, 1);
    expect(raycast(hill, [0, 100, 0], [0, 1, 0])).toBeNull();
  });
});
