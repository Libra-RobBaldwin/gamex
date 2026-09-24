import { describe, expect, it } from 'vitest';
import { ROADS } from '../catalog';
import { BRIDGES, COST_SCALE } from './catalogue';
import { extents, headroomOf, type Crossing } from './crossing';
import { layoutBridge, underside, type BridgeLayout } from './layout';
import { scenario } from './scenario';

// a flat deck at height y over flat ground, straight along x
function flat(L: number, y: number, obstacles: Crossing['obstacles'], road = ROADS.dual, year = 2000, ground?: (s: number) => number): Crossing {
  const path = Array.from({ length: Math.ceil(L / 3) + 1 }, (_, i) => ({ x: (L * i) / Math.ceil(L / 3), z: 0, y }));
  return { path, obstacles, road, year, ground };
}
const piers = (l: BridgeLayout) => l.supports.filter((q) => q.kind !== 'abutment' && q.kind !== 'anchorage');

describe('support placement', () => {
  const river = (): Crossing['obstacles'] => [{ kind: 'water', s0: 40, s1: 160, level: -1, channel: { s0: 80, s1: 120, clear: 5 } }];

  it('spaces piers within the span and keeps them out of the navigation channel', () => {
    const c = flat(200, 9, river(), ROADS.dual, 2000, (s) => (s > 40 && s < 160 ? -5 : 0));
    const l = layoutBridge(c, BRIDGES.beam, 0, 200);
    expect(l.ok).toBe(true);
    for (const sp of l.spans) expect(sp.len).toBeLessThanOrEqual(BRIDGES.beam.span.max + 1e-6);
    for (const q of piers(l)) expect(q.s + q.along <= 80 || q.s - q.along >= 120).toBe(true);
    // the span over the channel clears the boats
    const over = l.spans.find((sp) => sp.s0 <= 80 && sp.s1 >= 120)!;
    for (const s of [80, 100, 120]) expect(underside(c, over, s)).toBeGreaterThanOrEqual(-1 + 5 - 1e-6);
    // abutments at both ends, where the deck meets the embankment
    expect(l.supports[0].kind).toBe('abutment');
    expect(l.supports[l.supports.length - 1].kind).toBe('abutment');
  });

  it('stands piers in the water on footings, which cost more than on land', () => {
    const c = flat(200, 9, river(), ROADS.dual, 2000, (s) => (s > 40 && s < 160 ? -5 : 0));
    const l = layoutBridge(c, BRIDGES.beam, 0, 200);
    const wet = piers(l).filter((q) => q.inWater), dry = piers(l).filter((q) => !q.inWater);
    expect(wet.length).toBeGreaterThan(0);
    expect(dry.length).toBeGreaterThan(0);
    for (const q of wet) expect(q.level).toBe(-1);
    const perM = (q: (typeof wet)[0]) => q.cost / Math.max(1, q.top - q.base);
    expect(Math.min(...wet.map(perM))).toBeGreaterThan(Math.max(...dry.map(perM)) * 0.9);
  });

  it('keeps piers off a road underneath and leaves it its headroom', () => {
    const road = { kind: 'road' as const, s0: 70, s1: 84, surface: 0, name: 'the road' };
    const c = flat(160, 7.5, [road]);
    const l = layoutBridge(c, BRIDGES.beam, 0, 160);
    expect(l.ok).toBe(true);
    for (const q of piers(l)) expect(q.s + q.along <= 70 || q.s - q.along >= 84).toBe(true);
    const over = l.spans.find((sp) => sp.s0 <= 70 && sp.s1 >= 84)!;
    for (const s of [70, 77, 84]) expect(underside(c, over, s)).toBeGreaterThanOrEqual(headroomOf(road) - 1e-6);
    // a deep deck truss wouldn't leave the headroom: refused, saying how much higher it'd need to be
    const t = layoutBridge(c, BRIDGES['truss-deck'], 0, 160);
    expect(t.ok).toBe(false);
    expect(t.lift).toBeGreaterThan(0);
  });

  it('refuses a span the type cannot reach', () => {
    const c = flat(200, 9, river());
    const l = layoutBridge(c, BRIDGES.trestle, 0, 200);
    expect(l.ok).toBe(false);
    expect(l.reason).toMatch(/spans 12 m at most/);
  });

  it('refuses piers taller than the type can stand on', () => {
    const c = flat(300, 6, [], ROADS['rail-main'], 1880, (s) => -80 * Math.sin((Math.PI * s) / 300));
    const l = layoutBridge(c, BRIDGES.masonry, 0, 300);
    expect(l.ok).toBe(false);
    expect(l.reason).toMatch(/Piers would be/);
  });

  it('fits masonry arches so the channel sits under the crown, not the haunches', () => {
    const water = [{ kind: 'water' as const, s0: 40, s1: 160, level: -1, channel: { s0: 90, s1: 110, clear: 5 } }];
    const c = flat(200, 14, water, ROADS['rail-main'], 1880, (s) => (s > 40 && s < 160 ? -5 : 0));
    const l = layoutBridge(c, BRIDGES.masonry, 0, 200);
    expect(l.ok, l.reason).toBe(true);
    const over = l.spans.filter((sp) => sp.s1 > 90 && sp.s0 < 110);
    expect(over).toHaveLength(1);
    for (const s of [90, 100, 110]) expect(underside(c, over[0], s)).toBeGreaterThanOrEqual(4 - 1e-6);
    // the arch is wider than the channel, so its low haunches fall outside it
    expect(over[0].len).toBeGreaterThan(20);
  });

  it('puts a suspension bridge\'s towers either side of the channel, with anchorages beyond', () => {
    const sc = scenario({ length: 3500, road: ROADS.motorway, year: 1975, river: { s0: 1150, s1: 2350, depth: 14, channel: { width: 700, clear: 38 } } }, { raise: 3, grade: 0.04 });
    const c = sc.crossing;
    const [a, b] = extents(c)[0];
    const l = layoutBridge(c, BRIDGES.suspension, a, b);
    expect(l.ok).toBe(true);
    const ch = (c.obstacles[0] as { channel: { s0: number; s1: number } }).channel;
    const towers = l.supports.filter((q) => q.kind === 'tower');
    expect(towers).toHaveLength(2);
    expect(towers[0].s).toBeLessThan(ch.s0);
    expect(towers[1].s).toBeGreaterThan(ch.s1);
    expect(l.supports.filter((q) => q.kind === 'anchorage')).toHaveLength(2);
    expect(l.spans.find((sp) => sp.role === 'main')!.len).toBeLessThanOrEqual(BRIDGES.suspension.span.max);
  });

  it('adds up its cost from the actual layout, and says what land the supports need', () => {
    const c = flat(200, 9, river(), ROADS.dual, 2000, (s) => (s > 40 && s < 160 ? -5 : 0));
    const l = layoutBridge(c, BRIDGES.beam, 0, 200);
    expect(l.real.total).toBeCloseTo(l.real.deck + l.real.supports + l.real.ends, -1);
    expect(l.cost).toBe(Math.round(l.real.total * COST_SCALE));
    expect(l.maint).toBeGreaterThan(0);
    // more piers (a narrower span type) cost more in supports
    const g = layoutBridge(c, BRIDGES.trestle, 0, 200);
    expect(g.ok).toBe(false); // the channel is too wide for timber anyway
    for (const q of l.supports) {
      expect(q.foot).toHaveLength(4);
      const xs = q.foot.map((p) => p.x), zs = q.foot.map((p) => p.z);
      expect(Math.min(...xs)).toBeLessThanOrEqual(q.x);
      expect(Math.max(...zs)).toBeGreaterThanOrEqual(q.z + l.width / 2 - 1e-6);
    }
  });

  it('works out how long a lifting bridge shuts the road for tall boats', () => {
    const c = flat(120, 6.5, [{ kind: 'water', s0: 30, s1: 90, level: -1, channel: { s0: 45, s1: 75, clear: 20, tallPerHour: 2 } }], ROADS.street, 1905, (s) => (s > 30 && s < 90 ? -5 : 0));
    const l = layoutBridge(c, BRIDGES.bascule, 0, 120);
    expect(l.ok).toBe(true);
    expect(l.supports.filter((q) => q.kind === 'leaf-pier')).toHaveLength(2);
    expect(l.closedMinPerHour).toBeGreaterThan(5);
    expect(l.notes.join()).toMatch(/shuts/);
    // and a fixed bridge that low can't be built over the channel at all
    expect(layoutBridge(c, BRIDGES.girder, 0, 120).ok).toBe(false);
  });
});
