import { describe, expect, it } from 'vitest';
import { accumulate, edt, label, priorityFlood } from './flood';

const edges = (nx: number, nz: number) => {
  const o = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) o[j * nx + i] = 1;
  return o;
};

describe('priority-flood', () => {
  it('fills a closed hollow to its spill point and drains everything to an outlet', () => {
    // a 9×9 dome of rim with a pit in the middle, and a notch in the rim at height 4
    const n = 9, h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = Math.max(Math.abs(i - 4), Math.abs(j - 4));
      h[j * n + i] = r === 4 ? 1 : r === 3 ? 6 : 2 - (3 - r) * 0.5;
    }
    h[3 * n + 1] = 4; // the notch
    const f = priorityFlood(h, n, n, edges(n, n));
    expect(f.filled[4 * n + 4]).toBeCloseTo(4); // the pit fills to the notch
    expect(f.filled[2 * n + 2]).toBeCloseTo(4);
    expect(f.filled[0]).toBe(1); // the edge is its own level
    // following parents from any cell reaches an outlet without looping
    for (let k = 0; k < n * n; k++) {
      let c = k, steps = 0;
      while (f.parent[c] >= 0 && steps++ < n * n) c = f.parent[c];
      expect(steps).toBeLessThan(n * n);
      expect(edges(n, n)[c]).toBe(1);
    }
    // water drains downhill on the filled surface
    for (let k = 0; k < n * n; k++) if (f.parent[k] >= 0) expect(f.filled[f.parent[k]]).toBeLessThanOrEqual(f.filled[k] + 1e-6);
    // every cell's catchment ends up at an outlet
    const acc = accumulate(f);
    let total = 0;
    for (let k = 0; k < n * n; k++) if (f.parent[k] < 0) total += acc[k];
    expect(total).toBe(n * n);
  });

  it('labels connected groups and measures distances exactly', () => {
    const nx = 7, nz = 5, wet = (k: number) => [0, 1, 7, 12, 13, 20].includes(k);
    const { lab, sizes } = label(nx, nz, wet);
    expect(sizes).toEqual([3, 3]); // {0,1,7} and {12,13,20}
    expect(lab[0]).toBe(lab[7]); expect(lab[12]).toBe(lab[20]); expect(lab[0]).not.toBe(lab[12]); expect(lab[2]).toBe(-1);
    // distance transform against brute force
    const mask = new Uint8Array(nx * nz);
    [3, 18, 30].forEach((k) => (mask[k] = 1));
    const d = edt(mask, 1, nx, nz);
    for (let k = 0; k < nx * nz; k++) {
      const i = k % nx, j = Math.floor(k / nx);
      const b = Math.min(...[3, 18, 30].map((t) => Math.hypot(i - (t % nx), j - Math.floor(t / nx))));
      expect(d[k]).toBeCloseTo(b, 5);
    }
  });
});
