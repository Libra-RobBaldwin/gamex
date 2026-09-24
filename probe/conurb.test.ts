import { it } from 'vitest';
import { Economy } from '../src/proto/economy';
import { Kit } from '../src/proto/econkit';
const MONTH = 30 * 1440;
it('conurbation', () => {
  const k = new Kit();
  for (let t = 0; t < 144; t++) k.town({ id: t + 1, x: (t % 12) * 2000, z: Math.floor(t / 12) * 2000, grid: 4, mix: { house: 16, terrace: 6 }, centre: { office: 2, shop: 5, civic: 2 } });
  for (let a = 1; a <= 144; a++) for (let b = a + 1; b <= 144; b++) k.road(a, b);
  const t0 = performance.now(), c0 = process.cpuUsage();
  const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
  const t1 = performance.now(), c1 = process.cpuUsage();
  e.advance(MONTH);
  const t2 = performance.now(), c2 = process.cpuUsage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const x = e as any;
  console.log(`set-up ${(t1 - t0).toFixed(0)} (cpu ${((c1.user - c0.user) / 1000).toFixed(0)}) month ${(t2 - t1).toFixed(0)} (cpu ${((c2.user - c1.user) / 1000).toFixed(0)})`, JSON.stringify(e.timing, (_k, v) => (typeof v === 'number' ? Math.round(v) : v)), 'pairs', x.pairs.n, 'N', x.pairs.N);
});
