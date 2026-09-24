import { it } from 'vitest';
import { Economy } from '../src/proto/economy';
import { Kit } from '../src/proto/econkit';
const MONTH = 30 * 1440;
it('climb', () => {
  const k = new Kit()
    .town({ id: 2, x: 4600, z: 0, grid: 3, mix: { house: 14, flats: 1 }, centre: { shop: 7, office: 1 }, plots: 1, carShare: 0.34 })
    .town({ id: 3, x: 12600, z: 0, grid: 4, mix: { house: 22, terrace: 2, flats: 2 }, centre: { shop: 4, office: 3, civic: 2 }, edge: { industry: 1 }, plots: 0, carShare: 0.3 });
  k.stop(2, 'rail_station', 4600, 0).stop(3, 'rail_station', 12600, 0);
  const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const show = (m: number, id: number) => {
    const r = e.town(id)!;
    const t = (e as any).townMap.get(id);
    const u = (x: string) => `${x}:${r.uses[x as 'home'].capacity}/${r.uses[x as 'home'].demand.toFixed(0)} u${t.use[x].up}d${t.use[x].down}${t.use[x].settled ? 's' : ''}`;
    console.log(id, m, r.residents, r.status, ['home', 'shop', 'office', 'works'].map(u).join(' '), 'bias', t.bias.home.toFixed(2), 'pH', (t.zones.reduce((a: number, z: any) => a + z.pHome, 0) / t.zones.length).toFixed(2), 'vis', r.supply.visitors.toFixed(2), '|', r.headline.slice(0, 90));
  };
  show(-1, 3);
  e.setLines([{ id: 2, stops: [2, 3], vehicle: 'dmu', count: 4 }]);
  for (let m = 0; m < 36; m++) {
    e.advance(MONTH);
    const acts = e.takeActions();
    const cnt: Record<string, number> = {};
    for (const a of acts) cnt[a.t] = (cnt[a.t] ?? 0) + 1;
    show(m, 3);
    console.log('   ', JSON.stringify(cnt));
  }
});
