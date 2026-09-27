import { describe, expect, it } from 'vitest';
import { edgeRuns, inGate, parkEntrances, parkPaths, parkPond, type EdgePiece } from './parkplan';

// a square park 30 m across, its edge along two roads (north and east sides), in 1.5 m pieces
function sides(): EdgePiece[] {
  const out: EdgePiece[] = [];
  for (let x = 0; x < 30; x += 1.5) out.push([x, 0, x + 1.5, 0]);
  for (let z = 0; z < 30; z += 1.5) out.push([30, z, 30, z + 1.5]);
  return out;
}

describe('a park’s entrances and paths', () => {
  it('chains the edge pieces into one run per road side', () => {
    const runs = edgeRuns(sides());
    expect(runs.length).toBe(1); // (the two sides meet at the corner, so they chain into one run)
    expect(runs[0].length).toBe(41);
  });
  it('puts a gate in the middle of a side and steps it into the park', () => {
    const shuffled = [...sides()].reverse(); // (whatever order the pieces come in)
    const e = parkEntrances(shuffled, { x: 15, z: 15 });
    expect(e.length).toBe(1);
    expect(Math.abs(e[0].at.x - 30) < 0.01 || Math.abs(e[0].at.z) < 0.01).toBe(true); // (on the edge)
    const d = Math.hypot(e[0].in.x - 15, e[0].in.z - 15), d0 = Math.hypot(e[0].at.x - 15, e[0].at.z - 15);
    expect(d).toBeLessThan(d0); // (the step goes inwards)
    expect(inGate(e[0].at, e)).toBe(true);
    expect(inGate({ x: e[0].at.x + 5, z: e[0].at.z + 5 }, e)).toBe(false);
  });
  it('runs a path from each gate to the centre, or between two gates', () => {
    const north: EdgePiece[] = [], south: EdgePiece[] = [];
    for (let x = 0; x < 30; x += 1.5) { north.push([x, 0, x + 1.5, 0]); south.push([x, 30, x + 1.5, 30]); }
    const e = parkEntrances([...north, ...south], { x: 15, z: 15 });
    expect(e.length).toBe(2);
    const paths = parkPaths(e, { x: 15, z: 15 });
    expect(paths.length).toBe(1);
    expect(paths[0][0]).toEqual(e[0].in);
    expect(paths[0][1]).toEqual(e[1].in);
    const one = parkPaths(e.slice(0, 1), { x: 15, z: 15 });
    expect(one).toEqual([[e[0].in, { x: 15, z: 15 }]]);
  });
  it('gives a short edge no gate', () => {
    expect(parkEntrances([[0, 0, 1.5, 0], [1.5, 0, 3, 0]], { x: 1, z: 5 })).toEqual([]);
  });
});

describe('a park’s pond (parkPond)', () => {
  const S = 5;
  // a 100 m × 100 m park (400 cells), the ground falling to the east, a path across its middle
  const cells: { x: number; z: number }[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) cells.push({ x: i * S + S / 2, z: j * S + S / 2 });
  const slope = (x: number) => 20 - x * 0.02;
  const path = [{ x: 2, z: 50 }, { x: 98, z: 50 }];
  const road: EdgePiece[] = [[100, 0, 100, 100]]; // (a road along the east side)
  const pond = parkPond(cells, S, [path], road, slope, 1)!;
  it('is inside the park, its bank clear of the road and the path', () => {
    expect(pond).not.toBeNull();
    expect(pond.r).toBeGreaterThanOrEqual(8);
    expect(pond.r).toBeLessThanOrEqual(30);
    expect(pond.x - pond.r - 1).toBeGreaterThanOrEqual(0);
    expect(pond.z - pond.r - 1).toBeGreaterThanOrEqual(0);
    expect(pond.z + pond.r + 1).toBeLessThanOrEqual(100);
    expect(100 - pond.x).toBeGreaterThanOrEqual(pond.r + 4);
    expect(Math.abs(pond.z - 50)).toBeGreaterThanOrEqual(pond.r + 4);
  });
  it('takes the lowest spot that fits', () => {
    // the ground falls to the east: the pond sits as far east as the road's bank allows
    expect(pond.x + pond.r + 4).toBeGreaterThan(95);
  });
  it('gives a small park none', () => {
    expect(parkPond(cells.slice(0, 60), S, [], [], slope, 1)).toBeNull();
  });
  it('gives none when nothing fits: a park all path', () => {
    const paths = Array.from({ length: 10 }, (_, k) => [{ x: 0, z: k * 10 + 5 }, { x: 100, z: k * 10 + 5 }]);
    expect(parkPond(cells, S, paths, [], slope, 1)).toBeNull();
  });
});
