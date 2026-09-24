// Trips between towns (docs/region.md, R5): with more than one town the economy says where each
// town's people go, by any means and by your lines, and a railway between two raises both.
import { describe, expect, it } from 'vitest';
import { Economy } from './economy';
import { BALANCED, Kit } from './econkit';

const MONTH = 30 * 1440;
function twoTowns() {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED, carShare: 0.4 }).town({ id: 2, x: 6000, z: 0, ...BALANCED, carShare: 0.4 });
  k.stop(5, 'rail_station', 0, 0).stop(6, 'rail_station', 6000, 0).road(1, 2); // (and a road between them)
  return k;
}
const between = (e: Economy, a: number, b: number) => e.townTrips(a).find((t) => t.town === b);

describe('trips between towns', () => {
  it('each town says where its people go, the other town among them', () => {
    const k = twoTowns(), e = new Economy(k.world(), k.oracles(), { seed: 3 });
    e.advance(MONTH);
    const ab = between(e, 1, 2), ba = between(e, 2, 1);
    expect(ab?.name).toBeDefined();
    expect(ab!.all).toBeGreaterThan(0);
    expect(ba!.all).toBeGreaterThan(0);
    expect(ab!.lines).toBe(0); // (no service of yours yet)
    expect(e.townTrips(1).some((t) => t.town === 1)).toBe(false); // (not its own)
  });
  it('linking them by rail raises the trips between them, and some of them go by train', () => {
    const k = twoTowns();
    const a = new Economy(k.world(), k.oracles(), { seed: 3 }), b = new Economy(k.world(), k.oracles(), { seed: 3 });
    b.setLines([{ id: 1, stops: [5, 6], vehicle: 'dmu', count: 3 }]);
    a.advance(MONTH); b.advance(MONTH);
    for (const [x, y] of [[1, 2], [2, 1]]) {
      const off = between(a, x, y)!, on = between(b, x, y)!;
      expect(on.all).toBeGreaterThan(off.all);
      expect(on.lines).toBeGreaterThan(0);
    }
  });
  it('one town alone has no list (and pays nothing for it)', () => {
    const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED });
    const e = new Economy(k.world(), k.oracles(), { seed: 3 });
    e.advance(MONTH);
    expect(e.townTrips(1)).toEqual([]);
  });
});
