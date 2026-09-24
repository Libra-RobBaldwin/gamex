import { it } from 'vitest';
import { Economy } from '../src/proto/economy';
import { BALANCED, Kit } from '../src/proto/econkit';
const MONTH = 30 * 1440;
it('settle', () => {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED });
  const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
  for (let m = 0; m < 40; m++) {
    e.advance(MONTH);
    const acts = e.takeActions();
    const cnt: Record<string, number> = {};
    for (const a of acts) cnt[a.t] = (cnt[a.t] ?? 0) + 1;
    const r = e.town(1)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = (e as any).townMap.get(1);
    const u = (x: string) => `${x}:${r.uses[x as 'home'].capacity}/${r.uses[x as 'home'].demand.toFixed(0)} up${t.use[x].up} dn${t.use[x].down}`;
    console.log(m, r.residents, r.status, JSON.stringify(cnt), ['home', 'shop', 'office', 'works'].map(u).join(' '), '|', r.headline);
  }
});
