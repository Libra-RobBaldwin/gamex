import { it } from 'vitest';
import { Economy } from './orig/src/proto/economy';
import { BALANCED, Kit } from './orig/src/proto/econkit';
import type { LineIn } from './orig/src/proto/econdefs';
const MONTH = 30 * 1440;
function servedTown(plots = 1) {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED, plots, carShare: 0.5 }).town({ id: 2, x: 6000, z: 0, ...BALANCED });
  k.stop(1, 'bus_stop', -220, -220).stop(2, 'bus_stop', 220, -220).stop(3, 'bus_stop', 220, 220).stop(4, 'bus_stop', -220, 220);
  k.stop(5, 'rail_station', 0, 0).stop(6, 'rail_station', 6000, 0);
  const lines: LineIn[] = [
    { id: 1, stops: [1, 2, 3, 4], vehicle: 'bus', count: 2 },
    { id: 2, stops: [5, 6], vehicle: 'dmu', count: 2 },
  ];
  return { k, lines };
}
it('served2', () => {
  const { k, lines } = servedTown();
  const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
  const show = (tag: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (e as any).townMap.get(1);
    console.log(tag, 'bias', JSON.stringify(t.bias, (_k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)), 'home demand', t.use.home.demand.toFixed(0), t.use.home.raw.toFixed(0));
    for (const z of t.zones) {
      const r = e.zoneReach(z.id)!;
      console.log('  zone', z.id, 'pHome', r.homes.toFixed(3), 'work', r.work.car.toFixed(2), r.work.noCar.toFixed(2), r.work.transit.toFixed(2), 'shop', r.shop.car.toFixed(2), r.shop.noCar.toFixed(2), 'leis', r.leisure.car.toFixed(2), r.leisure.noCar.toFixed(2));
    }
  };
  show('start');
  e.setLines(lines);
  e.advance(MONTH);
  show('m1');
  e.advance(MONTH);
  show('m2');
});
