import { describe, expect, it } from 'vitest';
import { gapTrial, queueTrial, ringTrial } from './trafficsim';

// How quick drivers are to go when a gap opens (trafficsim.ts's gap trials): time from gap to go.
const W = { x: -250, z: 0 }, E = { x: 250, z: 0 }, S = { x: 0, z: 250 }, N = { x: 0, z: -250 };

describe('drivers go when a gap opens', () => {
  it('a queue at a give-way line moves off briskly, each driver soon after the one in front', () => {
    for (const form of ['priority', 'roundabout', 'mini'] as const) for (const to of form === 'priority' ? [W, E] : [W, N, E]) {
      const q = queueTrial(form, { from: S, to }, 6);
      const name = `${form} to ${to.x},${to.z}: ${JSON.stringify(q)}`;
      expect(q.headway.length, name).toBe(5);
      // (about 2.5 s a vehicle over the line from a standing start; each moving off within a second.
      // Going right round a mini-roundabout, whose ring only holds four cars or so, the ring sets the
      // pace instead: every car waits for room on it)
      expect(Math.max(...q.react), name).toBeLessThanOrEqual(1);
      const most = form === 'mini' && to === E ? 3.6 : 2.8;
      expect(q.headway.slice(0, 3).every((h) => h <= most), name).toBe(true);
    }
  });
  it('once the vehicle it gave way to has gone by, a driver is on the move within a second and a half', () => {
    for (const form of ['priority', 'roundabout', 'mini'] as const) {
      const cases = form === 'priority' ? [[{ from: S, to: E }, { from: E, to: W }], [{ from: S, to: W }, { from: E, to: W }]] : [[{ from: S, to: N }, { from: E, to: W }], [{ from: S, to: E }, { from: N, to: W }]];
      for (const [me, it] of cases) {
        const r = gapTrial(form, me, it, { lead: 1 });
        expect(r.went, r.name).toBe(true);
        expect(r.overlaps, r.name).toBe(0);
        expect(r.delay, r.name).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe('pulling out onto a roundabout (UK rules)', () => {
  for (const form of ['roundabout', 'mini'] as const) {
    it(`${form}: gives way to traffic from the right, but not to traffic leaving before its arm or already past`, () => {
      for (const to of [W, N, E]) {
        // coming round from the right towards our entry, a second off: we wait, then go promptly
        const near = ringTrial(form, { from: S, to }, { from: N, to: W }, 1);
        expect(near.waited, `${form} to ${to.x},${to.z}: from the right`).toBe(true);
        expect(near.delay).toBeLessThanOrEqual(1.5);
        // leaving before our arm, or at it: no reason to wait at all
        for (const it of [{ from: N, to: E }, { from: E, to: S }]) {
          const r = ringTrial(form, { from: S, to }, it, 1);
          expect(r.waited, `${form}: ${JSON.stringify(it)}`).toBe(false);
          expect(r.idle).toBeLessThan(0.5);
        }
        // already past our entry: no wait
        const past = ringTrial(form, { from: S, to }, { from: N, to: W }, -2);
        expect(past.waited).toBe(false);
        expect(past.idle).toBeLessThan(0.5);
        for (const r of [near, past]) expect(r.overlaps).toBe(0);
      }
    });
  }
});
