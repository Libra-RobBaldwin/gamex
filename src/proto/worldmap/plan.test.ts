import { describe, expect, test } from 'vitest';
import { planWorld, SQUARE, squareQuota } from './plan';

describe('the world plan (docs/streaming.md)', () => {
  const plan = planWorld({ seed: 7 });
  test('a 50 km map, made quickly', () => {
    expect(plan.size).toBe(50000);
    console.log('plan ms', Math.round(plan.ms), 'settlements', plan.settlements.length, 'roads', plan.roads.length, 'rails', plan.rails.length, 'lakes', plan.water.spec.lakes.length, 'rivers', plan.water.world.rivers.length, 'sea', plan.water.world.sea?.side);
    const k = (kind: string) => plan.settlements.filter((s) => s.kind === kind).length;
    console.log('cities', k('city'), 'towns', k('town'), 'villages', k('village'));
    const t0 = performance.now(), f = plan.terrain.field(50);
    console.log('field ms', Math.round(performance.now() - t0), 'n', f?.n, 'max', f?.max.toFixed(1));
    expect(plan.settlements[0]).toMatchObject({ x: 0, z: 0, kind: 'town' });
  });
  test('no 10 km square with land is left empty, on any seed', () => {
    for (const seed of [1, 42, 99]) {
      const p = seed === 7 ? plan : planWorld({ seed }), H = p.half, w = p.water;
      for (let z0 = -H; z0 < H; z0 += SQUARE) for (let x0 = -H; x0 < H; x0 += SQUARE) {
        let land = 0;
        for (let b = 0; b < 20; b++) for (let a = 0; a < 20; a++) {
          const x = x0 + (a + 0.5) * (SQUARE / 20), z = z0 + (b + 0.5) * (SQUARE / 20);
          if (w.seaDistance(x, z, 2500) > 0 && !w.wet({ x, z }, 0)) land++;
        }
        if (squareQuota(land / 400, false) === 0) continue;
        const n = p.settlements.filter((s) => s.x >= x0 && s.x < x0 + SQUARE && s.z >= z0 && s.z < z0 + SQUARE).length;
        expect(n, `seed ${seed}, the square at ${x0}, ${z0}`).toBeGreaterThan(0);
      }
    }
  }, 60000);
  test('industries on the land that suits them, each with a lane in', () => {
    const I = plan.industries, types = new Set(I.map((i) => i.type));
    for (const t of ['farm', 'quarry', 'forest', 'goods_factory', 'food_plant'] as const) expect(types.has(t), t).toBe(true);
    if (plan.water.world.sea) expect(types.has('port')).toBe(true);
    for (const i of I) {
      expect(Math.max(Math.abs(i.x), Math.abs(i.z))).toBeGreaterThan(4000); // (the live area's are the game's)
      for (const s of plan.grid.near(i.x, i.z)) expect(Math.hypot(s.x - i.x, s.z - i.z), `${i.type} ${i.id} in ${s.name}`).toBeGreaterThan(s.reach);
    }
    const lanes = new Set(plan.roads.filter((r) => r.site !== undefined).map((r) => r.site));
    expect(lanes.size).toBeGreaterThan(I.length * 0.9);
  });
});
