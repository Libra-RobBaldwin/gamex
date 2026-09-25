import { describe, expect, it } from 'vitest';
import { Track } from './conflicts';
import { BODIES, bodiesAlong, bodyOf, registerBody, steered, type Axles } from './footprint';

// Vehicles steer like real ones (a bicycle model): the front axle follows the course, the rear axle
// is dragged after it and cuts the corner, the body points along the line between them, and an
// articulated vehicle's trailer hangs on its hitch and cuts in further still.
const R = 12;
// a quarter turn to the left round (0, R) from the origin, heading +x, with straight road either side
const course = (d: number) => {
  if (d <= 0) return { x: d, z: 0 };
  const a = d / R;
  if (a <= Math.PI / 2) return { x: R * Math.sin(a), z: R - R * Math.cos(a) };
  const e = d - (R * Math.PI) / 2;
  return { x: R, z: R + e };
};
const dist = (p: { x: number; z: number }) => Math.hypot(p.x, p.z - R);
const axles = (): Axles => ({ fx: 0, fz: 0, rx: 0, rz: 0, tx: 0, tz: 0, body: NaN });
// an artic, measured from its middle: a 6 m tractor (3.6 m wheelbase, the fifth wheel just ahead of
// its rear axle) and a 13.6 m trailer on it, its kingpin 1.6 m from its nose and its axles 7.7 m behind that
const ARTIC = registerBody({ parts: [{ a: 2.25, b: 8.25, hw: 1.25, fa: 6.9, ra: 3.3 }], trailer: { hitch: -1.65, front: 5.2, axle: -2.5, len: 13.6, hw: 1.28 }, front: 8.25, back: 8.4, hw: 1.28 });

describe('bicycle-model steering', () => {
  it('round a bend a car\'s front follows the course and its rear cuts inside, pointing along its axles', () => {
    // halfway round: drive it there from well back along the straight
    const s = axles(), mid = (R * Math.PI) / 4;
    for (let d = -20; d <= mid; d += 0.5) steered(0, (x) => course(d + x), s);
    const [body] = steered(0, (x) => course(mid + x), s);
    expect(dist({ x: s.fx, z: s.fz })).toBeCloseTo(R, 1); // the front axle on the course
    expect(dist({ x: s.rx, z: s.rz })).toBeLessThan(R - 0.1); // the rear axle inside it
    // the body lies along the axle line
    const ux = s.fx - s.rx, uz = s.fz - s.rz, l = Math.hypot(ux, uz);
    expect(body.hx * (ux / l) + body.hz * (uz / l)).toBeGreaterThan(0.9999);
  });
  it('an artic\'s trailer cuts in further than its tractor, and it straightens up out of the turn', () => {
    const s = axles(), end = (R * Math.PI) / 2;
    let most = 0;
    for (let d = -40; d <= end; d += 0.5) {
      const [tractor, trailer] = steered(ARTIC, (x) => course(d + x), s);
      most = Math.max(most, R - dist(trailer));
      if (d > end - 2) expect(dist(trailer)).toBeLessThan(dist(tractor));
    }
    // (a 13.6 m trailer round a 12 m radius cuts in by a couple of metres)
    expect(most).toBeGreaterThan(1.5);
    // well down the road beyond, it's straight behind its tractor again
    for (let d = end; d <= end + 30; d += 0.5) steered(ARTIC, (x) => course(d + x), s, 1, [], true);
    const [tractor, trailer] = steered(ARTIC, (x) => course(end + 30 + x), s, 1, [], true);
    expect(Math.abs(trailer.x - R)).toBeLessThan(0.1);
    expect(tractor.hx * trailer.hx + tractor.hz * trailer.hz).toBeGreaterThan(0.999);
  });
  it('the conflict tables have exactly the bodies the vehicles are drawn with along a course', () => {
    const pts = Array.from({ length: 80 }, (_, i) => course(i - 10));
    const tr = new Track(pts), along = bodiesAlong(ARTIC, tr, 1);
    const s = axles();
    for (let t = 0; t <= 60; t += 0.25) {
      const parts = steered(ARTIC, (x) => tr.point(t + x), s);
      if (Number.isInteger(t)) for (let k = 0; k < parts.length; k++) {
        expect(Math.hypot(parts[k].x - along[t][k].x, parts[k].z - along[t][k].z)).toBeLessThan(0.1);
      }
    }
  });
  it('a stateless body worked out from the course behind it matches one driven there', () => {
    const s = axles(), at = 14;
    for (let d = -20; d <= at; d += 0.25) steered(BODIES.length - 1, (x) => course(d + x), s);
    const a = steered(BODIES.length - 1, (x) => course(at + x), s), b = bodyOf(BODIES.length - 1, (x) => course(at + x));
    for (let k = 0; k < a.length; k++) expect(Math.hypot(a[k].x - b[k].x, a[k].z - b[k].z)).toBeLessThan(0.1);
  });
});
