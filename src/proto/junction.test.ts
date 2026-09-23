import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network } from './roads';
import { assignLanes, design, landFits, legsAt, moveOf, rescore } from './junction';

const geo = (n: Network, node: number) => ({ fits: (polys: Parameters<typeof landFits>[2]) => landFits(n, node, polys) });
const as = (type: string) => ({ ...DEFAULT_OPTS, type });

describe('junction design', () => {
  it('knows left from right (we drive on the left)', () => {
    const n = new Network();
    n.build({ x: -100, z: 0 }, { x: 100, z: 0 });
    n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 100 });
    const node = n.nearestNode({ x: 0, z: 0 }, 1)!.id;
    const legs = legsAt(n, node);
    const east = legs.find((l) => l.dir.x > 0.9)!, west = legs.find((l) => l.dir.x < -0.9)!, south = legs.find((l) => l.dir.z > 0.9)!;
    // arriving from the east (heading west), the leg towards +z is on the left
    expect(moveOf(east, south)).toBe('L');
    expect(moveOf(east, west)).toBe('S');
    expect(moveOf(west, south)).toBe('R');
    // round the junction, the next leg is the first exit on the left
    const i = legs.indexOf(east);
    expect(legs[(i + 1) % legs.length]).toBe(south);
  });

  it('a T junction gives way, with a slip lane for the busiest left turn when there is room', () => {
    const n = new Network();
    n.build({ x: -150, z: 0 }, { x: 150, z: 0 }, undefined, as('arterial-2-30-0-0-0'));
    n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 150 });
    const node = n.nearestNode({ x: 0, z: 0 }, 1)!.id;
    const j = design(n, node, geo(n, node))!;
    // a side street onto a busy four-lane road would jam at a plain give-way: it's signalled
    expect(j.form).toBe('signals');
    expect(j.slip).not.toBeNull();
    // onto a fast dual carriageway, a roundabout
    const f = new Network();
    f.build({ x: -150, z: 0 }, { x: 150, z: 0 }, undefined, as('dual'));
    f.build(f.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 150 });
    const fn = f.nearestNode({ x: 0, z: 0 }, 1)!.id;
    expect(design(f, fn, geo(f, fn))!.form).toBe('roundabout');
    // on ordinary streets it's a give-way T, still with the slip
    const m = new Network();
    m.build({ x: -150, z: 0 }, { x: 150, z: 0 });
    m.build(m.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 150 });
    const k = m.nearestNode({ x: 0, z: 0 }, 1)!.id;
    const t = design(m, k, geo(m, k))!;
    expect(t.form).toBe('priority');
    expect(t.major.length).toBe(2);
    expect(t.slip).toBeNull(); // a back-street T doesn't need a slip
    expect(t.score.dos).toBeGreaterThan(0);
    expect(t.score.dos).toBeLessThan(1);
  });

  it('crossroads on the flat become roundabouts: mini for back streets, full for bigger roads', () => {
    const n = new Network();
    n.build({ x: -150, z: 0 }, { x: 150, z: 0 });
    n.build({ x: 0, z: -150 }, { x: 0, z: 150 });
    const a = n.nearestNode({ x: 0, z: 0 }, 1)!.id;
    expect(design(n, a, geo(n, a))!.form).toBe('mini');
    const m = new Network();
    m.build({ x: -200, z: 0 }, { x: 200, z: 0 }, undefined, as('dual'));
    m.build({ x: 0, z: -200 }, { x: 0, z: 200 }, undefined, as('dual'));
    const b = m.nearestNode({ x: 0, z: 0 }, 1)!.id;
    const j = design(m, b, geo(m, b))!;
    expect(j.form).toBe('roundabout');
    expect(j.R).toBeGreaterThan(20);
    // the player can still choose signals; the score says how it compares
    const sig = rescore(m, j, geo(m, b), { form: 'signals' });
    expect(sig.form).toBe('signals');
    expect(sig.auto).toBe(false);
  });

  it('lanes go to whichever movements balance the load best', () => {
    const cap = () => 1000;
    // two lanes, lots of right turners: one lane for the right turn, the other shared
    const heavyRight = assignLanes(2, ['L', 'S', 'R'], { L: 100, S: 300, R: 500 }, { L: 1, S: 2, R: 2 }, cap);
    expect(heavyRight.lanes[1]).toEqual(['R']);
    // mostly straight on: both lanes carry straight-ahead traffic
    const straight = assignLanes(2, ['L', 'S', 'R'], { L: 50, S: 900, R: 50 }, { L: 1, S: 2, R: 1 }, cap);
    expect(straight.lanes.every((l) => l.includes('S'))).toBe(true);
    // an exit with one lane can't take two turning lanes
    const narrow = assignLanes(2, ['L', 'S'], { L: 800, S: 100, R: 0 }, { L: 1, S: 1, R: 0 }, cap);
    expect(narrow.lanes.filter((l) => l.includes('L')).length).toBe(1);
  });
});
