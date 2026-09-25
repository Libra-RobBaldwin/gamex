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
    it(`${form}: gives way to traffic from the right, by when it will get there, and to nobody else`, () => {
      for (const to of [W, N, E]) {
        const name = `${form} to ${to.x},${to.z}`;
        // coming round from the right, a second or two off: we let it by, then go promptly
        for (const ah of [1, 2]) {
          const near = ringTrial(form, { from: S, to }, { from: N, to: W }, ah);
          expect(near.first, `${name}: ${ah} s off`).toBe(false);
          expect(near.went, name).toBe(true);
          expect(near.delay, name).toBeLessThanOrEqual(1.5);
          expect(near.overlaps, name).toBe(0);
        }
        // leaving before our arm, or at it: no reason to wait at all
        for (const it of [{ from: N, to: E }, { from: E, to: S }]) {
          const r = ringTrial(form, { from: S, to }, it, 1);
          expect(r.waited, `${name}: ${JSON.stringify(it)}`).toBe(false);
          expect(r.idle, name).toBeLessThan(0.5);
        }
        // already past our entry: no wait
        const past = ringTrial(form, { from: S, to }, { from: N, to: W }, -2);
        expect(past.waited, name).toBe(false);
        expect(past.idle, name).toBeLessThan(0.5);
        // one standing still well round the ring behind us (in a queue for its exit, say) is no reason
        // to wait (unless we're going right round to where it stands)
        if (to === E) continue;
        const still = ringTrial(form, { from: S, to }, { from: N, to: W }, 15, { v: 0 });
        expect(still.went && still.first, `${name}: standing 15 m back`).toBe(true);
        expect(still.idle, name).toBeLessThan(0.5);
      }
    });
  }
  it('pulls out ahead of traffic on the ring that is far enough off in time (not distance)', () => {
    // on the roundabout, one coming round from the far arm 5 s off: we go first, without it braking
    const r = ringTrial('roundabout', { from: S, to: N }, { from: N, to: W }, 5);
    expect(r.first).toBe(true);
    expect(r.overlaps).toBe(0);
  });
});
