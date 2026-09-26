import { describe, expect, test } from 'vitest';
import { planWorld } from './plan';
import { PROFILES, planRoutes } from './routes';
import type { XZ } from '../region/water';

// The trunk network (off at the start of a game: the player builds it, but the planner is the same)
// follows the land: motorways within their grade nearly everywhere, railways far flatter than the
// ground they cross, and none of it ruler-straight.
describe('trunk routes follow the land (docs/streaming.md)', () => {
  const p = planWorld({ seed: 42 });
  const { roads, rails } = planRoutes({ seed: 42, half: p.half, settlements: p.settlements, links: p.links, water: p.water, grid: p.grid, heightAt: p.terrain.heightAt }, true);
  const h = p.terrain.heightAt;
  const steep = (path: XZ[], grade: number) => {
    let over = 0, L = 0;
    for (let i = 8; i < path.length; i += 8) { const a = path[i - 8], b = path[i], d = Math.hypot(b.x - a.x, b.z - a.z); L += d; if (Math.abs(h(b.x, b.z) - h(a.x, a.z)) / d > grade) over += d; }
    return over / L;
  };
  test('motorways keep to their grade, railways to far less than the land', () => {
    const mw = roads.filter((r) => r.kind === 'motorway');
    expect(mw.length).toBeGreaterThan(0);
    for (const r of mw) expect(steep(r.path, PROFILES.motorway.grade)).toBeLessThan(0.06);
    let o = 0, n = 0;
    for (let x = -20000; x < 20000; x += 997) for (let z = -20000; z < 20000; z += 1009) { n++; if (Math.abs(h(x + 200, z) - h(x, z)) / 200 > PROFILES.rail.grade) o++; }
    expect(rails.length).toBeGreaterThan(0);
    for (const r of rails) expect(steep(r.path, PROFILES.rail.grade)).toBeLessThan((0.85 * o) / n);
  });
  test('no trunk route is ruler-straight', () => {
    for (const r of [...roads.filter((q) => q.kind !== 'B'), ...rails]) {
      const P = r.path; if (P.length < 120) continue;
      // (somewhere along it, it's more than 40 m off the straight line between its ends' 3 km pieces)
      let bent = false;
      for (let i = 0; i + 120 < P.length && !bent; i += 40) {
        const a = P[i], b = P[i + 120], L = Math.hypot(b.x - a.x, b.z - a.z);
        for (let k = i; k <= i + 120; k++) if (Math.abs((P[k].x - a.x) * (b.z - a.z) - (P[k].z - a.z) * (b.x - a.x)) / L > 40) { bent = true; break; }
      }
      expect(bent, `${'kind' in r ? r.kind : 'rail'} ${r.id}`).toBe(true);
    }
  });
});
