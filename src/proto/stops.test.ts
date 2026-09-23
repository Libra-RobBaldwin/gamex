import { describe, expect, it } from 'vitest';
import { BAY, DEFAULT_OPTS, MIN_FOOTWAY, Network, ROADS } from './roads';

const as = (type: keyof typeof ROADS) => ({ ...DEFAULT_OPTS, type });

describe('road types and bus stops', () => {
  it('a lay-by on a narrow street takes pavement, then lane width, then front gardens', () => {
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: 200, z: 0 });
    for (const l of n.plotsFor(id, { x: 999, z: 999 })) if (n.lotFree(l)) { n.fitParcel(l); n.lots.push(l); }
    const { plans, reason } = n.planStop(id, 100, 1);
    expect(reason).toBeUndefined();
    expect(plans.map((p) => p.kind)).toEqual(['kerb', 'layby']);
    const lay = plans[1];
    const d = ROADS.street;
    expect(lay.take.pave).toBeCloseTo(d.pave - MIN_FOOTWAY);
    expect(lay.take.lane).toBeCloseTo((d.lane - 3) * 2);
    expect(lay.take.pave + lay.take.lane + lay.take.land).toBeCloseTo(BAY.depth);
    expect(lay.lots.length).toBeGreaterThan(0);
    const fronts = lay.lots.map((l) => l.front);
    n.addStop(id, 100, 1, lay);
    lay.lots.forEach((l, i) => expect(l.front).toBeCloseTo(fronts[i] - lay.take.land));
  });

  it('an avenue has room in its pavement alone; motorways get no stops', () => {
    const n = new Network();
    const [a] = n.build({ x: 0, z: 0 }, { x: 200, z: 0 }, undefined, as('avenue'));
    const lay = n.planStop(a, 100, -1).plans[1];
    expect(lay.take).toMatchObject({ pave: 3, lane: 0, land: 0 });
    const [m] = n.build({ x: 0, z: 300 }, { x: 400, z: 300 }, undefined, as('motorway'));
    expect(n.planStop(m, 200, 1).reason).toMatch(/motorway/);
    expect(n.planStop(a, 5, 1).reason).toMatch(/junction|end/);
  });

  it('motorways cross other roads on bridges, and streets cannot join them', () => {
    const n = new Network();
    n.build({ x: -300, z: 0 }, { x: 300, z: 0 }, undefined, as('motorway'));
    const c = n.check({ x: 0, z: -200 }, { x: 0, z: 200 });
    expect(c.ok).toBe(true);
    expect(c.bridges).toBe(1);
    n.build({ x: 0, z: -200 }, { x: 0, z: 200 });
    expect(n.segs.size).toBe(2); // no junction on the motorway
    expect(n.check(n.snapStart({ x: 100, z: 1 }, 5), { x: 100, z: 150 }).reason).toMatch(/motorway/);
    expect(n.check(n.snapStart({ x: 100, z: 1 }, 5), { x: 100, z: 150 }, undefined, as('dual')).reason ?? '').not.toMatch(/motorway/);
  });

  it('stops stay on their half when a road is split by a new junction', () => {
    const n = new Network();
    const [id] = n.build({ x: 0, z: 0 }, { x: 300, z: 0 });
    n.addStop(id, 60, 1, n.planStop(id, 60, 1).plans[0]);
    n.addStop(id, 240, -1, n.planStop(id, 240, -1).plans[0]);
    n.build({ x: 150, z: -100 }, { x: 150, z: 100 });
    const stops = [...n.segs.values()].flatMap((s) => s.stops.map((st) => ({ s: st.s, len: n.length(s) })));
    expect(stops.length).toBe(2);
    for (const st of stops) expect(st.s).toBeLessThan(st.len);
  });
});
