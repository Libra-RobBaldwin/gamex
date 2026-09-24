import { describe, expect, it } from 'vitest';
import { bike, bird, personCard, personMid, personNear, pushchair, quadruped, triangles, wheelchair, P } from './geometry';

// triangles in parts a figure shows only sometimes (the shader collapses the rest)
const optional = (g: ReturnType<typeof personNear>, parts: number[]) => {
  const part = g.getAttribute('aPart'), idx = g.index!;
  let n = 0;
  for (let i = 0; i < idx.count; i += 3) if (parts.includes(part.getX(idx.getX(i)))) n++;
  return n;
};

describe('triangle budgets', () => {
  it('a near person is 60–150 triangles, fewer at middle distance, a card far off', () => {
    const near = personNear(), mid = personMid(), card = personCard();
    const extras = optional(near, [P.Crown, P.Brim, P.Bag, P.Pack, P.Umbrella, P.Stick]);
    expect(triangles(near)).toBeLessThanOrEqual(150);
    expect(triangles(near) - extras).toBeGreaterThanOrEqual(60);
    expect(triangles(mid)).toBeLessThan(triangles(near) / 2);
    expect(triangles(card)).toBe(2);
  });
  it('animals and things people push or ride stay small', () => {
    expect(triangles(quadruped(false))).toBeLessThanOrEqual(120);
    expect(triangles(quadruped(true))).toBeLessThanOrEqual(60);
    expect(triangles(bird())).toBeLessThanOrEqual(60);
    for (const g of [bike(), pushchair(), wheelchair()]) expect(triangles(g)).toBeLessThanOrEqual(140);
  });
});
