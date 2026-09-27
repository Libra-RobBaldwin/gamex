// Even gaps on a train line (anti-bunching): a train whose dwell is done holds on at the platform
// while the train ahead of it on its line is closer than a third of the line's cycle (or the
// line's even spacing, with more than three trains) and closer than the train behind, up to a
// minute at a stop; off with the line's switch. Two trains that set off together from one
// terminus of a double line spread out; with the switch off they run nose to tail all day.
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, type RoadOpts } from '../roads';
import { TRAINS } from '../catalog';
import { Railway } from './railway';
import { callOrder } from './sim';

const rail = (type: 'rail-main' | 'rail-branch', o: Partial<RoadOpts> = {}): RoadOpts => ({ ...DEFAULT_OPTS, type, cross: 'bridge', grade: 0.025, ...o });
const DAY = 360; // sim seconds in a game day

// a 3 km double line with three stations, a there-and-back line over all three, and its trains
// all starting at the first station: as bunched as can be
function bunched(spacing: boolean, trains = 2) {
  const net = new Network(() => false, 4000);
  net.build({ x: -1500, z: 0 }, { x: 1500, z: 0 }, undefined, rail('rail-main'));
  const rw = new Railway(net);
  rw.rebuild();
  const seg = [...net.segs.values()][0], L = net.length(seg);
  const st = [400, L / 2, L - 400].map((s) => { const p = rw.plan(seg.id, s, 1, 130); expect(p.plans.length, p.reason).toBeGreaterThan(0); return rw.build(p.plans[0]).station; });
  const l = rw.addLine(st.map((s) => s.id), false, Array.from({ length: trains }, () => TRAINS.dmu), { depot: false });
  expect(typeof l, String(l)).toBe('object');
  if (typeof l === 'string') throw new Error(l);
  rw.setSpacing(l, spacing);
  const run = (seconds: number, dt = 0.1) => { for (let i = 0; i < seconds / dt; i++) rw.update(dt); };
  // the headways at each of the line's calls over a window (the time between one train calling
  // and the next), and how uneven they are: standard deviation over mean, 0 when perfectly even
  const headways = (from: number, to: number) => {
    const out: Record<number, { mean: number; cv: number; n: number }> = {};
    for (let call = 0; call < callOrder(l.stops, l.loop).length; call++) {
      const ts = rw.sim.log.filter((e) => e.line === l.id && e.call === call && e.t >= from && e.t < to).map((e) => e.t).sort((a, b) => a - b);
      const h: number[] = [];
      for (let k = 1; k < ts.length; k++) h.push(ts[k] - ts[k - 1]);
      if (h.length < 2) continue;
      const mean = h.reduce((a, b) => a + b, 0) / h.length, sd = Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length);
      out[call] = { mean, cv: sd / mean, n: h.length };
    }
    return out;
  };
  // no two trains in one block
  const apart = () => {
    const seen = new Map<number, number>();
    for (const t of rw.trains) for (const b of rw.sim.occupied(t)) { if (seen.has(b) && seen.get(b) !== t.id) return false; seen.set(b, t.id); }
    return true;
  };
  return { net, rw, l, run, headways, apart };
}
const worst = (h: Record<number, { cv: number }>) => Math.max(...Object.values(h).map((x) => x.cv));
const show = (h: Record<number, { mean: number; cv: number; n: number }>) => Object.entries(h).map(([p, x]) => `call ${p}: ${x.n} headways, mean ${x.mean.toFixed(0)} s, cv ${x.cv.toFixed(2)}`).join('; ');

describe('even gaps on a train line', () => {
  it('two trains started together end up calling at even intervals, holding at platforms to get there', () => {
    const w = bunched(true);
    let shared = 0;
    for (let i = 0; i < 4 * DAY; i += 10) { w.run(10); if (!w.apart()) shared++; }
    const h = w.headways(2 * DAY, 4 * DAY);
    expect(w.rw.sim.stats.holds, 'a train held at a platform').toBeGreaterThan(0);
    expect(w.rw.sim.stats.redPassed).toBe(0);
    expect(shared, 'two trains in one block').toBe(0);
    expect(Object.keys(h).length, 'calls with headways to measure').toBeGreaterThanOrEqual(3);
    expect(worst(h), `headways in the second two days: ${show(h)}`).toBeLessThan(0.3);
    for (const t of w.rw.trains) expect(w.rw.sim.log.filter((e) => e.train === t.id && e.t > 2 * DAY).length, `train ${t.id} still calling`).toBeGreaterThanOrEqual(4);
  }, 120_000);
  it('three trains too, at a third of the cycle apart', () => {
    const w = bunched(true, 3);
    w.run(4 * DAY);
    const h = w.headways(2 * DAY, 4 * DAY);
    expect(w.rw.sim.stats.holds).toBeGreaterThan(0);
    expect(w.rw.sim.stats.redPassed).toBe(0);
    expect(w.rw.trains.length).toBe(3);
    expect(worst(h), `headways in the second two days: ${show(h)}`).toBeLessThan(0.3);
  }, 120_000);
  it('with the switch off they run nose to tail: uneven headways, no holds', () => {
    const w = bunched(false);
    w.run(4 * DAY);
    const h = w.headways(2 * DAY, 4 * DAY);
    expect(w.rw.sim.stats.holds).toBe(0);
    expect(worst(h), `headways in the second two days: ${show(h)}`).toBeGreaterThan(0.6);
  }, 120_000);
  it('a hold never lasts more than a minute, and the doors stay open through it', () => {
    const w = bunched(true);
    let longest = 0, doorsShutWhileHolding = 0;
    for (let i = 0; i < 4 * DAY; i += 1) {
      w.run(1);
      for (const t of w.rw.trains) if (t.holdSince !== undefined) { longest = Math.max(longest, w.rw.sim.time - t.holdSince); if (t.state !== 'dwell' || !t.doors) doorsShutWhileHolding++; }
    }
    expect(w.rw.sim.stats.holds).toBeGreaterThan(0);
    expect(longest).toBeLessThanOrEqual(61);
    expect(doorsShutWhileHolding).toBe(0);
  }, 120_000);
  it('the switch is saved with the line, and a line runs with it on unless it was turned off', () => {
    const w = bunched(false);
    const s = structuredClone(w.rw.save());
    expect(s.lines[0].spacing).toBe(false);
    const rw2 = new Railway(w.net);
    rw2.restore(s);
    expect(rw2.spacing(rw2.lines[0])).toBe(false);
    const w2 = bunched(true);
    expect(w2.rw.save().lines[0].spacing).toBeUndefined();
    expect(w2.rw.spacing(w2.l)).toBe(true);
  });
});
