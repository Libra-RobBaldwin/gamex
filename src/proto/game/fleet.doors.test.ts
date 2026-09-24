// Buses' doors from the traffic: open on the kerb side while standing at a stop, shut on the move,
// and where people board (front) and get off (furthest back) is on the kerb side of the bus.
import { expect, it } from 'vitest';
import { SCENARIOS, simulate } from '../trafficsim';

it('a bus at a stop opens its kerb-side doors, and has them shut whenever it moves', () => {
  const sc = SCENARIOS.find((s) => s.name === 'roundabout, single-lane approaches')!;
  let opened = 0, movingOpen = 0, kerbChecked = 0;
  simulate({ ...sc, stops: true, buses: 3 }, 90, 1 / 30, (tr) => {
    for (const c of tr.cars) {
      if (!c.bus || !c.pose) continue;
      const [l, r] = tr.fleet.doors.get(c.id);
      expect(r).toBe(0);
      if (l > 0.99 && c.dwell !== undefined) {
        opened++;
        const ds = tr.fleet.kerbDoors(c, c.pose.parts), p = c.pose.parts[0];
        expect(ds.length).toBeGreaterThan(0);
        for (const d of ds) {
          // left of the way it faces: (hx, hz) turned a quarter to the left is (hz, -hx)
          expect((d.x - p.x) * p.hz - (d.z - p.z) * p.hx).toBeGreaterThan(0);
        }
        const along = (d: { x: number; z: number }) => (d.x - p.x) * p.hx + (d.z - p.z) * p.hz;
        expect(along(ds[0])).toBeGreaterThanOrEqual(along(ds[ds.length - 1]));
        kerbChecked++;
      }
      if (c.v > 1 && l > 0) movingOpen++;
    }
  });
  expect(opened).toBeGreaterThan(0);
  expect(kerbChecked).toBeGreaterThan(0);
  expect(movingOpen).toBe(0);
}, 120_000);
