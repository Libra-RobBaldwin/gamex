import { it } from 'vitest';
import { Economy } from '../src/proto/economy';
import { Kit } from '../src/proto/econkit';
import { VEHICLES } from '../src/proto/econdefs';
const MONTH = 30 * 1440;
it('dorm', () => {
  for (const seats of [60, 1]) {
    const was = VEHICLES.bus.capacity;
    VEHICLES.bus.capacity = seats;
    const k = new Kit()
      .town({ id: 1, x: 0, z: 0, mix: { house: 20, terrace: 10 }, centre: { shop: 3, civic: 1 }, carShare: 0.1 })
      .town({ id: 2, x: 5000, z: 0, mix: { house: 2, office: 2 }, centre: { shop: 4, civic: 2 }, carShare: 0.1 });
    k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 5000, 0);
    const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 6 }]);
    for (let m = 0; m < 12; m++) {
      e.advance(MONTH);
      e.takeActions();
      const r = e.town(1)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (e as any).lineMap.get(1);
      const t = (e as any).townMap.get(1);
      console.log(seats, m, r.residents, r.status, 'room', [...L.room].map((v: number) => v.toFixed(2)).join(','), 'lf', e.line(1)!.loadFactor.toFixed(2), 'carried', Math.round(e.line(1)!.carriedLastMonth), 'reach', r.reach.work.toFixed(2), r.reach.workTransit.toFixed(2), 'pHome', t.zones.map((z: any) => z.pHome.toFixed(2)).join(' '), 'bias', t.bias.home.toFixed(2), 'home', r.uses.home.capacity, r.uses.home.demand.toFixed(0));
    }
    VEHICLES.bus.capacity = was;
  }
});
