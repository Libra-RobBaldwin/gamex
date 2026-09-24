import { it } from 'vitest';
import { Economy } from '../src/proto/economy';
import { BALANCED, Kit } from '../src/proto/econkit';
import type { LineIn } from '../src/proto/econdefs';
const MONTH = 30 * 1440;
it('scale', () => {
  const k = new Kit();
  const lines: LineIn[] = [];
  let sid = 1, lid = 1;
  const station = new Map<number, number>();
  for (let t = 0; t < 50; t++) {
    const x = (t % 10) * 5000, z = Math.floor(t / 10) * 5000;
    k.town({ id: t + 1, x, z, ...BALANCED });
    const ring: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, r = i % 2 ? 250 : 400;
      k.stop(sid, 'bus_stop', x + Math.cos(a) * r, z + Math.sin(a) * r);
      ring.push(sid++);
    }
    station.set(t, sid);
    k.stop(sid++, 'rail_station', x + 30, z);
    k.stop(sid++, 'lorry_depot', x - 30, z);
    for (let b = 0; b < 3; b++) lines.push({ id: lid++, stops: [ring[b], ring[b + 2], ring[b + 4], ring[(b + 6) % 8]], vehicle: b ? 'bus' : 'decker', count: 5 });
  }
  for (let t = 0; t < 50; t++) {
    const east = t % 10 < 9 ? t + 1 : t - 9;
    lines.push({ id: lid++, stops: [station.get(t)!, station.get(east)!], vehicle: 'dmu', count: 5 });
  }
  for (let i = 0; i < 20; i++) k.industry(i + 1, i % 2 ? 'farm' : 'forest', (i % 10) * 5000 + 2500, Math.floor(i / 10) * 5000 + 2500);
  const t0 = performance.now();
  const e = new Economy(k.world(), k.oracles(), { seed: 7, autoBuild: true });
  e.setLines(lines);
  const t1 = performance.now();
  e.advance(MONTH);
  const t2 = performance.now();
  const x = e as unknown as { pairs: { n: number }; skim: { S: number } };
  const w0 = e.work, s0 = performance.now(); e.advance(1440 * 3); console.log("3 days", (performance.now() - s0).toFixed(0), "work", e.work - w0, "gen", (e as any).lineList.reduce((a: number, L: any) => a + L.genIdx.length, 0));
  { const E = e as any; let tg = 0, ts = 0, on = 0; for (const L of E.lineList) for (const o of L.onward) on += o.length; for (let h = 0; h < 72; h++) { let a = performance.now(); for (const L of E.lineList) if (L.pax && L.running) L.generate(60, 1); tg += performance.now() - a; a = performance.now(); for (const L of E.lineList) L.step(60, E.ctx); ts += performance.now() - a; } console.log("gen", tg.toFixed(1), "step", ts.toFixed(1), "onward", on); }
  console.log(`set-up ${(t1 - t0).toFixed(0)} month ${(t2 - t1).toFixed(0)}`, JSON.stringify(e.timing, (_k, v) => (typeof v === 'number' ? Math.round(v) : v)), x.pairs.n, x.skim.S);
});
