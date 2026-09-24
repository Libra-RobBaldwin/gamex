import { it } from 'vitest';
import { Economy } from '../src/proto/economy';
import { Kit } from '../src/proto/econkit';
import { Pairs, reach, assignTrips } from '../src/proto/econaccess';
it('bench', () => {
  const k = new Kit();
  for (let t = 0; t < 144; t++) k.town({ id: t + 1, x: (t % 12) * 2000, z: Math.floor(t / 12) * 2000, grid: 4, mix: { house: 16, terrace: 6 }, centre: { office: 2, shop: 5, civic: 2 } });
  for (let a = 1; a <= 144; a++) for (let b = a + 1; b <= 144; b++) k.road(a, b);
  const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x = e as any;
  const cpu = (f: () => void, n = 5) => { const c0 = process.cpuUsage(); for (let i = 0; i < n; i++) f(); return ((process.cpuUsage().user - c0.user) / 1000 / n).toFixed(1); };
  const za = x.zoneArrays();
  const T = e.tune;
  console.log('pairs', cpu(() => new Pairs(x.zoneList, x.skim, e.oracles, T, x.cars)));
  const p = x.pairs;
  console.log('reach', cpu(() => reach(p, za.workers, za.work, za.car, T.workMin, true, T.reachCap)));
  console.log('trips', cpu(() => assignTrips(p, x.skim, za.residents, za.attraction, za.visit, za.car, za.cover, T)));
  console.log('cover', cpu(() => x.cover()));
  console.log('zoneArrays', cpu(() => x.zoneArrays()));
  console.log('review', cpu(() => x.review(false), 3));
  console.log('month', cpu(() => e.advance(30 * 1440), 2));
});
