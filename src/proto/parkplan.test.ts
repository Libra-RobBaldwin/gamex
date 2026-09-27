import { describe, expect, it } from 'vitest';
import { edgeRuns, inGate, parkEntrances, parkPaths, type EdgePiece } from './parkplan';

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
