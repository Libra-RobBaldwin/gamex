import { describe, expect, it } from 'vitest';
import { Track, View, table } from './conflicts';
import { bodyOf, overlapping, type Pose } from './footprint';

const line = (x0: number, z0: number, x1: number, z1: number) => new Track([{ x: x0, z: z0 }, { x: x1, z: z1 }]);
const pose = (id: number, kind: Pose['kind'], x: number, z: number, hx = 1, hz = 0): Pose =>
  ({ id, kind, x, z, y: 0, k: 1, parts: bodyOf(kind, (d) => ({ x: x + hx * d, z: z + hz * d })) });

describe('vehicle bodies', () => {
  it('overlap only when they really touch', () => {
    // two cars nose to tail along x: 4.3 m long, so 3.5 m apart they overlap, 5 m apart they don't
    expect(overlapping([pose(1, 'car', 0, 0), pose(2, 'car', 3.5, 0)]).length).toBe(1);
    expect(overlapping([pose(1, 'car', 0, 0), pose(2, 'car', 5, 0)]).length).toBe(0);
    // side by side in lanes 3.25 m apart: even two lorries clear each other
    expect(overlapping([pose(1, 'lorry', 0, 0), pose(2, 'lorry', 0, 3.25)]).length).toBe(0);
    // one over the other on a bridge doesn't count
    const up = pose(2, 'car', 1, 0);
    up.y = 6;
    expect(overlapping([pose(1, 'car', 0, 0), up]).length).toBe(0);
  });
  it('a lorry bends round a corner: its cab points where it is going, its trailer follows', () => {
    // round a bend of radius 15 m, curving from heading +x towards +z
    const R = 15, at = (d: number) => { const a = (10 + d) / R; return { x: R * Math.sin(a), z: R - R * Math.cos(a) }; };
    const [trailer, cab] = bodyOf('lorry', at);
    const ang = (r: { hx: number; hz: number }) => Math.atan2(r.hz, r.hx);
    expect(ang(cab) - ang(trailer)).toBeGreaterThan(0.3);
    // and the trailer lies inside the curve rather than sticking out past it
    expect(Math.hypot(trailer.x, trailer.z - R)).toBeLessThan(R);
  });
});

describe('conflicts between courses', () => {
  it('a crossing: whoever goes second waits short of it until the other is across', () => {
    const A = line(-30, 0, 30, 0), B = line(0, -30, 0, 30);
    const t = table(A, 0, B, 0);
    expect(t.empty).toBe(false);
    const onB = new View(t, false); // me on B, it on A
    // with the car on A still 30 m short of the crossing, the car on B must stop before it
    const lim = onB.limitMe(0);
    expect(lim).toBeLessThan(30 - 2);
    expect(lim).toBeGreaterThan(20);
    // it doesn't move along with the other car: this is a crossing, not a queue
    expect(onB.limitMe(20)).toBeCloseTo(lim, 0);
    // once the car on A is across, nothing holds the car on B
    expect(onB.apart(40, lim - 1)).toBe(true);
  });
  it('the same course: the limit follows the vehicle in front', () => {
    const A = line(0, 0, 60, 0), t = table(A, 0, A, 0), v = new View(t, true);
    const l1 = v.limitMe(20), l2 = v.limitMe(30);
    expect(l1).toBeLessThan(20 - 4.3);
    expect(l2 - l1).toBeCloseTo(10, 0);
  });
  it('lanes side by side never conflict, even for lorries', () => {
    expect(table(line(0, 0, 60, 0), 1, line(0, 3.5, 60, 3.5), 1).empty).toBe(true);
    expect(table(line(0, 0, 60, 0), 0, line(0, 3.25, 60, 3.25), 2).empty).toBe(true);
  });
});
