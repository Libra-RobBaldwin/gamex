// Even gaps (anti-bunching): a bus whose dwell is done holds on at the stop while the bus ahead
// of it on its line is closer than a third of the loop (or the line's even spacing, with more
// than three buses), up to a minute; off with the line's switch. Buses started bunched spread
// out; with the switch off they stay bunched (they queue behind one another at every stop).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { rng } from './roads';
import { Traffic } from './traffic';
import { SCENARIOS, town } from './trafficsim';
import { starterStops } from './game/crowdsites';
import { Lines } from './game/lines';

function bunched(spacing: boolean, seed = 3) {
  const sc = SCENARIOS.find((s) => s.name === 'the starter town')!;
  const { net, junctions, places } = town({ ...sc, buses: 0 });
  starterStops(net);
  const traffic = new Traffic(net, new THREE.Scene(), rng(seed));
  traffic.junctions = junctions;
  const lines = new Lines(traffic);
  const all = [...net.segs.values()].flatMap((seg) => seg.stops.map((st) => ({ seg, st, p: net.path(seg) })));
  const near = (q: { x: number; z: number }) => all.map((o) => { let best = Infinity; for (const p of o.p) best = Math.min(best, Math.hypot(p.x - q.x, p.z - q.z)); return { o, d: best }; }).sort((a, b) => a.d - b.d)[0].o.st.id;
  const l = lines.add([near({ x: -85, z: 0 }), near({ x: 120, z: 0 }), near({ x: 0, z: 150 })], false, 0);
  lines.setSpacing(l, spacing);
  // three buses all starting at the first call: as bunched as can be
  const ids: number[] = [];
  for (let i = 0; i < 3; i++) { const c = traffic.addBus(undefined, l.bus, 0); if (c) ids.push(c.id); }
  expect(traffic.busesOn(l.id).length).toBe(3);
  // every call: when, which bus, and which of the line's calls it was (a there-and-back line
  // calls at its middle stops out and back, and those two intervals needn't match each other)
  const calls: { t: number; bus: number; place: number }[] = [];
  let now = 0;
  traffic.onBusStop = (_seg, _st, bus) => { const c = (traffic.cars as unknown as { id: number; leg?: number }[]).find((x) => x.id === bus); calls.push({ t: now / 1000, bus, place: c?.leg ?? -1 }); return 7; };
  const dt = 1 / 30, level = (60 * 16) / Math.max(1, places.homes.length) / 1.25;
  let i = 0;
  const run = (seconds: number) => { for (const end = i + Math.round(seconds / dt); i < end; i++) { now = i * dt * 1000; traffic.generate(places, 8.2, level, now); traffic.update(dt, now); } };
  // headways at each of the line's calls over a window: the time between one bus calling and the next, and
  // how uneven they are (standard deviation over mean, 0 when perfectly even)
  const headways = (from: number, to: number) => {
    const out: Record<number, { mean: number; cv: number; n: number }> = {};
    for (const place of [...new Set(calls.map((c) => c.place))]) {
      const ts = calls.filter((c) => c.place === place && c.t >= from && c.t < to).map((c) => c.t).sort((a, b) => a - b);
      const h: number[] = [];
      for (let k = 1; k < ts.length; k++) h.push(ts[k] - ts[k - 1]);
      if (h.length < 2) continue;
      const mean = h.reduce((a, b) => a + b, 0) / h.length, sd = Math.sqrt(h.reduce((a, b) => a + (b - mean) ** 2, 0) / h.length);
      out[place] = { mean, cv: sd / mean, n: h.length };
    }
    return out;
  };
  return { traffic, lines, l, ids, run, headways, calls };
}
const worst = (h: Record<number, { cv: number }>) => Math.max(...Object.values(h).map((x) => x.cv));
const show = (h: Record<number, { mean: number; cv: number; n: number }>) => Object.entries(h).map(([p, x]) => `call ${p}: ${x.n} headways, mean ${x.mean.toFixed(0)} s, cv ${x.cv.toFixed(2)}`).join('; ');

describe('even gaps on a line', () => {
  it('buses started bunched end up calling at even intervals, holding at stops to get there', () => {
    const w = bunched(true);
    w.run(20 * 60);
    const h = w.headways(10 * 60, 20 * 60);
    expect(w.traffic.stats.holds, 'a bus held at a stop').toBeGreaterThan(0);
    expect(Object.keys(h).length, 'places with headways to measure').toBeGreaterThanOrEqual(2);
    expect(worst(h), `headways in the second ten minutes: ${show(h)}`).toBeLessThan(0.3);
    expect(w.traffic.busesOn(w.l.id).length).toBe(3);
    expect(w.traffic.depot.length).toBe(0);
  }, 180_000);
  it('with the switch off they stay bunched: uneven headways, no holds', () => {
    const w = bunched(false);
    w.run(20 * 60);
    const h = w.headways(10 * 60, 20 * 60);
    expect(w.traffic.stats.holds).toBe(0);
    expect(worst(h), `headways in the second ten minutes: ${show(h)}`).toBeGreaterThan(0.6);
  }, 180_000);
  it('the switch is saved with the line', () => {
    const w = bunched(false);
    const s = w.lines.save();
    expect(s.list[0].spacing).toBe(false);
    const l2 = new Lines(w.traffic);
    l2.restore(s);
    expect(l2.spacing(l2.list[0])).toBe(false);
    const w2 = bunched(true);
    expect(w2.lines.save().list[0].spacing).toBeUndefined();
  });
});
