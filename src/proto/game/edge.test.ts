import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { beyondEdge, edgeDepth, edgeMesh, farCountry } from './edge';

// the face's triangles, by side (0: +x ... 3: -z), each as its three points' (u along the side, y)
function faces(m: THREE.Mesh, edge: number) {
  const p = m.geometry.getAttribute('position'), out: { side: number; pts: [number, number][] }[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const v = [0, 1, 2].map((k) => ({ x: p.getX(i + k), y: p.getY(i + k), z: p.getZ(i + k) }));
    // (the side whose plane all three lie in)
    const on = [(q: typeof v[0]) => Math.abs(q.x - edge) < 1e-3, (q: typeof v[0]) => Math.abs(q.z - edge) < 1e-3, (q: typeof v[0]) => Math.abs(q.x + edge) < 1e-3, (q: typeof v[0]) => Math.abs(q.z + edge) < 1e-3];
    const side = on.findIndex((f) => v.every(f));
    out.push({ side, pts: v.map((q) => [[-q.z, q.x, q.z, -q.x][side], q.y] as [number, number]) });
  }
  return out;
}
const area = (t: [number, number][]) => Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;

describe('the map edge: a cut face through the ground', () => {
  const E = 400, hills = (x: number, z: number) => 12 * Math.sin(x / 90) * Math.cos(z / 70) + 4; // (on a 25 m grid it'd be exact; here, fine columns)
  const river = (x: number, z: number) => hills(x, z) - (Math.abs(z - 40) < 30 && x > 0 ? 9 * (1 - ((z - 40) / 30) ** 2) + hills(x, z) : 0);

  test('its top is the ground all the way round, and it goes down to a level base', () => {
    const m = edgeMesh(E, [], hills, { base: -60, step: 5, level: -100 });
    const pos = m.geometry.getAttribute('position');
    let top = 0, low = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      expect(y).toBeLessThanOrEqual(hills(x, z) + 1e-4); // (never above the ground: no lip)
      if (Math.abs(y - hills(x, z)) < 1e-4) top++;
      low = Math.min(low, y);
    }
    expect(top).toBeGreaterThan(4 * ((2 * E) / 5));
    expect(low).toBeCloseTo(-60, 5);
  });

  test('no two pieces of the face overlap (nothing to fight over the same pixels), and there are no gaps', () => {
    const m = edgeMesh(E, [{ side: 0, u: 30, half: 12, kerb: 8, y: 0, rail: false }, { side: 1, u: -100, half: 5, kerb: 5, y: 0, rail: true }], river, { base: -60, step: 5, level: 0 });
    const tris = faces(m, E);
    // the face's area on each side is exactly the area between the ground (or the water, or the
    // road on it) and the base: any overlap or gap would change it
    for (let side = 0; side < 4; side++) {
      const mine = tris.filter((t) => t.side === side), sum = mine.reduce((a, t) => a + area(t.pts), 0);
      const P = (u: number): [number, number] => (side === 0 ? [E, -u] : side === 1 ? [u, E] : side === 2 ? [-E, u] : [-u, -E]);
      let want = 0;
      for (let u = -E; u < E; u += 0.05) {
        const [x, z] = P(u + 0.025), g = river(x, z);
        let top = Math.max(g, g < 0 ? 0 : g);
        if (side === 0 && Math.abs(u + 0.025 - 30) < 12) top = g + (Math.abs(u + 0.025 - 30) <= 8 ? 0.25 : 0.15);
        if (side === 1 && Math.abs(u + 0.025 + 100) < 5) top = g + 0.35;
        want += (top + 60) * 0.05;
      }
      expect(Math.abs(sum - want) / want).toBeLessThan(0.004);
    }
  });

  test('where the ground dips under the water, the water shows in section, standing at its level', () => {
    const m = edgeMesh(E, [], river, { base: -60, step: 5, level: 0 });
    const col = m.geometry.getAttribute('color'), pos = m.geometry.getAttribute('position');
    let wet = 0;
    for (let i = 0; i < pos.count; i++) if (col.getZ(i) > col.getX(i) * 1.5 && pos.getY(i) > -9.5) { wet++; expect(pos.getY(i)).toBeLessThanOrEqual(1e-4); }
    expect(wet).toBeGreaterThan(6);
  });

  test('a big map goes deeper; the town keeps its slice', () => {
    expect(edgeDepth(600)).toBe(26);
    expect(edgeDepth(4500)).toBeGreaterThan(80);
    expect(edgeDepth(14250)).toBeLessThanOrEqual(260);
  });

  test('the far country is one mesh round the map, never inside it, drawn first and never cut off by the far plane', () => {
    const f = farCountry(E, -60, ['#6f9150', '#4f7338']);
    const p = f.mesh.geometry.getAttribute('position'), idx = f.mesh.geometry.index!;
    for (let i = 0; i < idx.count; i += 3) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += p.getX(idx.getX(i + k)) / 3; cz += p.getZ(idx.getX(i + k)) / 3; }
      expect(Math.max(Math.abs(cx), Math.abs(cz))).toBeGreaterThan(E - 1e-6);
    }
    expect(f.mesh.renderOrder).toBeLessThan(-50);
    expect((f.mesh.material as THREE.Material).depthWrite).toBe(false);
    // (at the foot of the cut it starts at the base)
    let foot = Infinity;
    for (let i = 0; i < p.count; i++) if (Math.abs(Math.max(Math.abs(p.getX(i)), Math.abs(p.getZ(i))) - E) < 1e-6) foot = Math.min(foot, Math.abs(p.getY(i) + 60));
    expect(foot).toBeLessThan(1e-6);
  });

  test('beyond the edge means wholly past it', () => {
    expect(beyondEdge(100, [{ x: 100, z: 0 }, { x: 150, z: 10 }])).toBe(true);
    expect(beyondEdge(100, [{ x: 90, z: 0 }, { x: 150, z: 10 }])).toBe(false);
    expect(beyondEdge(100, [])).toBe(false);
  });
});
