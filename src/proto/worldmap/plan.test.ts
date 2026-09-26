import { describe, expect, test } from 'vitest';
import { planWorld } from './plan';

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
});
