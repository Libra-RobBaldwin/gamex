// The machine factor the timing budgets scale by (speed.ts). It prints how this machine compares
// with the reference at each kind of work, so a CI log shows why a budget came out as it did.
import { describe, expect, it } from 'vitest';
import { factorOf, ratios } from './speed';

describe('the machine factor', () => {
  it('is the slowest kind of work against the reference, within 0.5–4', () => {
    const r = ratios(), f = factorOf(r);
    console.log(`machine factor ${f.toFixed(2)} (${Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')})`);
    expect(f).toBeGreaterThanOrEqual(0.5);
    expect(f).toBeLessThanOrEqual(4);
    expect(f).toBe(Math.min(4, Math.max(0.5, ...Object.values(r))));
    expect(factorOf({ a: 0.2 })).toBe(0.5);
    expect(factorOf({ a: 9, b: 1 })).toBe(4);
  });
});
