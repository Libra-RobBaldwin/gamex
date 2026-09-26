// Parked cars stand on the ground (the user saw them "floating in the sky"): every car the
// parking draws is placed at its height above the ground, which the drape (drape.ts) then lifts
// onto the hills with everything else. A car given the ground's own height too would stand twice
// as high as the hill under it.
import { describe, expect, it } from 'vitest';
import { Parking, PARK_Y } from './parking';
import type { Lot } from '../roads';
import type { Bay } from '../buildgen';

// a hill: the start town on the 50 km map sits about 245 m up
const ground = (x: number, z: number) => 245 + 0.02 * x - 0.01 * z;
// what the drape does to a vertex: its height above the ground plus the ground under it
const drawnAt = (x: number, z: number, y: number) => y + ground(x, z);

describe('parked cars', () => {
  it('stand on the ground under them (within 0.5 m), on a hill', () => {
    const drawn: { x: number; z: number; y: number }[] = [];
    const fleet = { drawCar: (_d: unknown, parts: { x: number; z: number }[], y: number) => { drawn.push({ x: parts[0].x, z: parts[0].z, y }); } };
    const lot = { id: 1, x: 300, z: -200, rot: 0, w: 20, d: 20, h: 6, kind: 'office', seg: 1, seed: 0.3, row: 1, front: 5, back: 10, px: 0, pw: 20 } as Lot;
    const bays: Bay[] = Array.from({ length: 12 }, (_, i) => ({ x: 290 + i * 2.6, z: -190, hx: 0, hz: -1, via: [{ x: 290 + i * 2.6, z: -180 }, { x: 290 + i * 2.6, z: -186 }], heavy: false }));
    const p = new Parking(fleet as never, () => 0.1, () => ({ dress: { chain: [{}] } }) as never);
    p.hour = 12;
    p.view = { x: 300, z: -200, r: 400 };
    p.set(lot, bays);
    p.draw(0.016);
    expect(drawn.length).toBeGreaterThan(0);
    for (const c of drawn) {
      expect(Math.abs(c.y - PARK_Y)).toBeLessThan(1e-9);
      expect(Math.abs(drawnAt(c.x, c.z, c.y) - ground(c.x, c.z))).toBeLessThan(0.5);
    }
  });
});
