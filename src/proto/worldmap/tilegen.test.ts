import { describe, expect, test } from 'vitest';
import { planWorld } from './plan';
import { generateTile, type Detail } from './tilegen';

describe('world tiles (docs/streaming.md)', () => {
  const plan = planWorld({ seed: 7 });
  test('a tile of each level, quickly, the same every time', () => {
    // (a tile near a town outside the live play area)
    const s = plan.settlements.find((x) => x.kind === 'town' && Math.max(Math.abs(x.x), Math.abs(x.z)) > 5000)!;
    const i = Math.floor(s.x / 1000), j = Math.floor(s.z / 1000);
    for (const [level, detail, ii, jj] of [[0, 'near', i, j], [0, 'mid', i + 1, j], [1, 'far', Math.floor(s.x / 4000), Math.floor(s.z / 4000)], [2, 'vast', Math.floor(s.x / 16000), Math.floor(s.z / 16000)]] as [number, Detail, number, number][]) {
      const t0 = performance.now(), t = generateTile(plan, { level, i: ii, j: jj, detail });
      console.log(detail, Math.round(performance.now() - t0), 'ms', JSON.stringify(t.stats), 'cover', t.ground?.n, 'water', !!t.water, 'hedges', t.hedges ? t.hedges.pieces.length / 6 : 0);
      expect(t.ground).not.toBeNull();
    }
    const a = generateTile(plan, { level: 0, i, j, detail: 'near' }), b = generateTile(plan, { level: 0, i, j, detail: 'near' });
    expect(a.solid!.pos).toEqual(b.solid!.pos);
    expect(a.ground!.cover).toEqual(b.ground!.cover);
  });
});
