import { it } from 'vitest';
import { Economy } from './orig/src/proto/economy';
import { BALANCED, Kit } from './orig/src/proto/econkit';
import type { LineIn } from './orig/src/proto/econdefs';
const MONTH = 30 * 1440;

function servedTown(plots = 1) {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED, plots, carShare: 0.5 }).town({ id: 2, x: 6000, z: 0, ...BALANCED });
  k.stop(1, 'bus_stop', -220, -220).stop(2, 'bus_stop', 220, -220).stop(3, 'bus_stop', 220, 220).stop(4, 'bus_stop', -220, 220);
  k.stop(5, 'rail_station', 0, 0).stop(6, 'rail_station', 6000, 0);
  k.industry(1, 'forest', 3000, 3000).industry(2, 'sawmill', 1500, 1500).industry(3, 'quarry', -3000, 3000).industry(4, 'brickworks', -1500, 1500);
  k.stop(10, 'lorry_depot', 3000, 3000).stop(11, 'lorry_depot', 1500, 1500).stop(12, 'lorry_depot', 0, 0);
  k.stop(13, 'lorry_depot', -3000, 3000).stop(14, 'lorry_depot', -1500, 1500).stop(15, 'lorry_depot', 220, 220);
  const lines: LineIn[] = [
    { id: 1, stops: [1, 2, 3, 4], vehicle: 'bus', count: 2 },
    { id: 2, stops: [5, 6], vehicle: 'dmu', count: 2 },
    { id: 3, stops: [10, 11], vehicle: 'lorry', count: 2 },
    { id: 4, stops: [11, 12], vehicle: 'lorry', count: 2 },
    { id: 5, stops: [13, 14], vehicle: 'lorry', count: 2 },
    { id: 6, stops: [14, 15], vehicle: 'lorry', count: 2 },
  ];
  return { k, lines };
}

it('served', () => {
  const { k, lines } = servedTown();
  const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
  e.setLines(lines);
  if (process.env.NOLINES) e.setLines([]);
  for (let m = 0; m < 18; m++) {
    e.advance(MONTH);
    const r = e.town(1)!;
    const acts = e.takeActions();
    const cnt: Record<string, number> = {};
    for (const a of acts) cnt[a.t] = (cnt[a.t] ?? 0) + 1;
    const u = r.uses; const T1 = (e as any).townMap.get(1); console.log("   bias", JSON.stringify(T1.bias, (_k, v) => (typeof v === "number" ? +v.toFixed(3) : v)), "zones", T1.zones.map((z: any) => z.pHome.toFixed(2) + "/" + z.indJobs.toFixed(0)).join(" "), "rates", [1,2,3,4].map((i) => e.industry(i)!.rate.toFixed(2)).join(" "));
    console.log(m, r.residents, r.status, r.headline, JSON.stringify(cnt));
    console.log('   pressure', Object.entries(u).map(([k, v]) => `${k}:${v.capacity}/${v.demand.toFixed(0)}`).join(' '), 'reach', JSON.stringify(r.reach, (_k, v) => typeof v === 'number' ? +v.toFixed(2) : v), 'supply', JSON.stringify(r.supply, (_k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
    console.log('   lines', e.lineStats().map((l) => `${l.id}:${Math.round(l.carriedLastMonth)} lf${l.loadFactor.toFixed(2)} £${Math.round(l.profitLastMonth)}`).join(' '));
  }
});
