import { describe, expect, it } from 'vitest';
import { Game, newGame, type GameState } from './sim';
import { Scenarios, byId } from './scenarios';
import { Curve } from './geo';
import { makeIndustry } from './world';

// Flat 30x14 grass map with two small towns and a coal mine / power station pair.
function flat(): GameState {
  const s = newGame(7);
  const w = 30, h = 14;
  s.w = w; s.h = h;
  s.terrain = new Uint8Array(w * h);
  s.bld = new Uint8Array(w * h);
  s.bldTown = new Int16Array(w * h).fill(-1);
  s.road = new Uint8Array(w * h * 4);
  s.rail = new Uint8Array(w * h * 4);
  s.metro = new Uint8Array(w * h * 4);
  s.towns = [
    { id: 0, name: 'West', cx: 3, cy: 3, growth: 0, served: 0 },
    { id: 1, name: 'East', cx: 26, cy: 3, growth: 0, served: 0 },
  ];
  for (const [t, cx] of [[0, 3], [1, 26]] as const)
    for (let y = 1; y <= 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { s.bld[y * w + x] = 2; s.bldTown[y * w + x] = t; }
  s.industries = [makeIndustry(0, 'coal_mine', 2, 10, 'West'), makeIndustry(1, 'power_station', 25, 10, 'East')];
  s.money = 2_000_000;
  s.tech.push('rail', 'train', 'freight', 'metro', 'motorway', 'coach');
  return s;
}

const line = (g: Game, y: number, x0: number, x1: number) => {
  const out: number[] = [];
  for (let x = x0; x0 <= x1 ? x <= x1 : x >= x1; x += x0 <= x1 ? 1 : -1) out.push(g.idx(x, y));
  return out;
};

describe('geometry', () => {
  it('curves are continuous and about the right length', () => {
    const c = new Curve([{ x: 0.5, y: 0.5 }, { x: 1.5, y: 0.5 }, { x: 2.5, y: 1.5 }, { x: 3.5, y: 2.5 }]);
    expect(c.length).toBeGreaterThan(1 + 2 * Math.SQRT2 - 0.2);
    expect(c.length).toBeLessThan(1 + 2 * Math.SQRT2 + 0.01);
    const end = c.at(c.length);
    expect(end.x).toBeCloseTo(3.5);
    expect(end.y).toBeCloseTo(2.5);
  });
});

describe('network rules', () => {
  it('rail refuses 90° turns but allows 45° curves', () => {
    const g = new Game(flat());
    // right-angle stroke: east then south
    const bad = [g.idx(5, 6), g.idx(6, 6), g.idx(7, 6), g.idx(7, 7), g.idx(7, 8)];
    const p = g.planStroke(bad, 'rail');
    expect(p.bad).toBe(2);
    // gentle: east, south-east, south
    const ok = [g.idx(5, 6), g.idx(6, 6), g.idx(7, 7), g.idx(7, 8)];
    expect(g.planStroke(ok, 'rail').bad).toBe(-1);
    // streets may turn freely
    expect(g.planStroke(bad, 'street').bad).toBe(-1);
  });

  it('train paths respect turn limits', () => {
    const g = new Game(flat());
    g.buildStroke(line(g, 6, 5, 10), 'rail');
    g.buildStroke([g.idx(10, 6), g.idx(10, 7), g.idx(10, 8)], 'street'); // irrelevant layer
    // a 90° branch in rail built as two strokes
    g.buildStroke([g.idx(10, 6), g.idx(10, 7)].reverse(), 'rail');
    expect(g.findPath('rail', g.idx(5, 6), g.idx(10, 7))).toBeNull();
    expect(g.findPath('road', g.idx(10, 6), g.idx(10, 8))).not.toBeNull();
  });

  it('blocks diagonals that cross another diagonal', () => {
    const g = new Game(flat());
    expect(g.buildStroke([g.idx(5, 5), g.idx(6, 6)], 'rail')).toBeNull();
    expect(g.planStroke([g.idx(6, 5), g.idx(5, 6)], 'street').bad).toBe(0);
  });

  it('buildings block surface building but not metro', () => {
    const g = new Game(flat());
    expect(g.planStroke(line(g, 1, 0, 6), 'street').bad).toBeGreaterThanOrEqual(0);
    expect(g.planStroke(line(g, 1, 0, 6), 'metro').bad).toBe(-1);
  });
});

describe('economy', () => {
  it('buses carry passengers between towns and towns grow', () => {
    const g = new Game(flat());
    expect(g.buildStroke(line(g, 3, 3, 26), 'street')).toBeNull();
    expect(g.placeStation(3, 3, 'bus_stop')).toBeNull();
    expect(g.placeStation(26, 3, 'bus_stop')).toBeNull();
    const [a, b] = g.s.stations;
    expect(g.catchment(a).towns.has(0)).toBe(true);
    expect(g.buyVehicle('bus', [a, b])).toBeNull();
    expect(g.buyVehicle('bus', [b, a])).toBeNull();
    const pop0 = g.pop(g.s.towns[0]) + g.pop(g.s.towns[1]);
    const money0 = g.s.money;
    for (let i = 0; i < 2400; i++) g.tick(0.25);
    expect(g.s.delivered.pax ?? 0).toBeGreaterThan(100);
    expect(g.s.money).toBeGreaterThan(money0);
    expect(g.pop(g.s.towns[0]) + g.pop(g.s.towns[1])).toBeGreaterThan(pop0);
  });

  it('freight trains haul coal and vehicles reroute after damage', () => {
    const g = new Game(flat());
    g.buildStroke(line(g, 12, 3, 25), 'rail');
    expect(g.placeStation(4, 12, 'rail')).toBeNull();
    expect(g.placeStation(24, 12, 'rail')).toBeNull();
    const [a, b] = g.s.stations;
    expect(g.buyVehicle('freight', [a, b])).toBeNull();
    for (let i = 0; i < 800; i++) g.tick(0.25);
    expect(g.s.delivered.coal ?? 0).toBeGreaterThan(0);
    g.wreck([g.idx(14, 12)]);
    for (let i = 0; i < 80; i++) g.tick(0.25);
    expect(g.s.vehicles[0].state).toBe('lost');
    g.buildStroke(line(g, 12, 13, 15), 'rail');
    for (let i = 0; i < 40; i++) g.tick(0.25);
    expect(g.s.vehicles[0].state).not.toBe('lost');
  });

  it('road congestion slows traffic', () => {
    const g = new Game(flat());
    g.buildStroke(line(g, 3, 3, 26), 'street');
    g.placeStation(3, 3, 'bus_stop');
    g.placeStation(26, 3, 'bus_stop');
    const [a, b] = g.s.stations;
    for (let i = 0; i < 12; i++) g.buyVehicle('bus', [a, b]);
    for (let i = 0; i < 40; i++) g.tick(0.25);
    const avg = g.s.vehicles.reduce((s, v) => s + v.dist, 0) / g.s.vehicles.length;
    expect(avg).toBeLessThan(1.4 * 10 * 0.8);
  });
});

describe('road stops and stations', () => {
  // A 3x3 block loop: streets around x 8..12, y 5..9, with a spur west to a dead end at x 3.
  function block(g: Game) {
    g.buildStroke([...line(g, 5, 8, 12)], 'street');
    g.buildStroke([g.idx(12, 5), g.idx(12, 6), g.idx(12, 7), g.idx(12, 8), g.idx(12, 9)], 'street');
    g.buildStroke(line(g, 9, 12, 8), 'street');
    g.buildStroke([g.idx(8, 9), g.idx(8, 8), g.idx(8, 7), g.idx(8, 6), g.idx(8, 5)], 'street');
    g.buildStroke(line(g, 7, 8, 3), 'street');
  }

  it('buses at kerb stops keep going the same way round a loop', () => {
    const g = new Game(flat());
    block(g);
    expect(g.placeStation(10, 5, 'bus_stop')).toBeNull();
    expect(g.placeStation(10, 9, 'bus_stop')).toBeNull();
    const [a, b] = g.s.stations;
    expect(g.buyVehicle('bus', [a, b])).toBeNull();
    const v = g.s.vehicles[0];
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      g.tick(0.1);
      if (v.state === 'move' && v.path.length > 1) seen.add(v.path.join(','));
    }
    expect(v.state).not.toBe('lost');
    // No leg should reverse along the edge it arrived on.
    for (const key of seen) {
      const p = key.split(',').map(Number);
      for (let i = 2; i < p.length; i++) expect(p[i]).not.toBe(p[i - 2]);
    }
    expect(v.trips).toBeGreaterThan(1);
  });

  it('refuses kerb stops at junctions and on motorways', () => {
    const g = new Game(flat());
    block(g);
    expect(g.placeStation(8, 7, 'bus_stop')).toMatch(/junction/);
    g.buildStroke(line(g, 12, 14, 20), 'motorway');
    expect(g.placeStation(16, 12, 'bus_stop')).toMatch(/motorway/);
  });

  it('U-turns only at dead ends when there is no loop', () => {
    const g = new Game(flat());
    g.buildStroke(line(g, 7, 3, 20), 'street');
    g.placeStation(6, 7, 'bus_stop');
    g.placeStation(15, 7, 'bus_stop');
    const [a, b] = g.s.stations;
    g.buyVehicle('bus', [a, b]);
    const v = g.s.vehicles[0];
    let reachedEnd = false;
    for (let i = 0; i < 600; i++) {
      g.tick(0.1);
      if (v.path.includes(g.idx(20, 7)) || v.path.includes(g.idx(3, 7))) reachedEnd = true;
    }
    expect(v.state).not.toBe('lost');
    expect(reachedEnd).toBe(true);
  });

  it('off-road bus stations get a driveway and let buses turn round', () => {
    const g = new Game(flat());
    g.buildStroke(line(g, 7, 3, 20), 'street');
    expect(g.placeStation(10, 7, 'bus_station')).toMatch(/beside a street|next to a street/);
    expect(g.placeStation(10, 8, 'bus_station')).toBeNull();
    const st = g.s.stations[0];
    expect(st.link).toBe(g.idx(10, 7));
    expect(g.road.any(g.idx(10, 8))).toBe(true);
    g.placeStation(16, 7, 'bus_stop');
    const v0 = g.buyVehicle('minibus', [st, g.s.stations[1]]);
    expect(v0).toBeNull();
    for (let i = 0; i < 400; i++) g.tick(0.1);
    expect(g.s.vehicles[0].state).not.toBe('lost');
    // demolishing removes the driveway
    g.removeStation(st);
    expect(g.road.any(g.idx(10, 8))).toBe(false);
  });

  it('interchanges take a 2x2 site', () => {
    const g = new Game(flat());
    g.buildStroke(line(g, 7, 3, 20), 'street');
    expect(g.placeStation(10, 6, 'bus_interchange')).toBeNull();
    expect(g.s.stations[0].foot!.length).toBe(4);
  });

  it('freight stations refuse buses and vice versa', () => {
    const g = new Game(flat());
    g.buildStroke(line(g, 7, 3, 20), 'street');
    g.placeStation(5, 7, 'loading_bay');
    g.placeStation(15, 7, 'bus_stop');
    const [a, b] = g.s.stations;
    expect(g.buyVehicle('bus', [a, b])).toMatch(/can't use/);
    expect(g.buyVehicle('truck', [a, b])).toMatch(/can't use/);
  });

  it('multi-stop lines visit every stop in order', () => {
    const g = new Game(flat());
    expect(g.buildStroke(line(g, 3, 3, 26), 'street')).toBeNull();
    g.buildStroke([g.idx(14, 3), g.idx(14, 4)], 'street');
    g.placeStation(3, 3, 'bus_stop');
    g.placeStation(14, 4, 'bus_stop');
    g.placeStation(26, 3, 'bus_stop');
    const [a, m, b] = g.s.stations;
    expect(g.buyVehicle('decker', [a, m, b])).toBeNull();
    const v = g.s.vehicles[0];
    const visited: number[] = [];
    let last = -1;
    for (let i = 0; i < 3000; i++) {
      g.tick(0.1);
      if (v.state === 'load' && v.target !== last) { visited.push(v.stops[v.target]); last = v.target; }
    }
    expect(visited.slice(0, 4)).toEqual([a.id, m.id, b.id, a.id]);
    expect(g.s.delivered.pax ?? 0).toBeGreaterThan(0);
  });
});

describe('scenarios', () => {
  it('twin towns completes and pays out', () => {
    const g = new Game(flat());
    const sc = new Scenarios(g);
    const offer = sc.offers.find((o) => o.def.id === 'twin_towns')!;
    expect(offer).toBeTruthy();
    const m0 = g.s.money;
    expect(sc.accept(offer)).toBeNull();
    expect(g.s.money).toBe(m0 + 20000);
    g.buildStroke(line(g, 3, 3, 26), 'street');
    g.placeStation(3, 3, 'bus_stop');
    g.placeStation(26, 3, 'bus_stop');
    const [a, b] = g.s.stations;
    g.buyVehicle('bus', [a, b]);
    g.buyVehicle('bus', [b, a]);
    let completed = '';
    sc.onComplete = (d) => { completed = d.id; };
    for (let i = 0; i < 4000 && !completed; i++) { g.tick(0.25); sc.update(0.25); }
    expect(completed).toBe('twin_towns');
    expect(g.s.completed).toContain('twin_towns');
    expect(sc.offers.some((o) => o.def.id === 'iron_road')).toBe(true);
  });

  it('disaster wrecks the busiest line and is restorable', () => {
    const g = new Game(flat());
    const sc = new Scenarios(g);
    g.s.completed.push('a', 'b');
    g.buildStroke(line(g, 12, 3, 25), 'rail');
    g.placeStation(4, 12, 'rail');
    g.placeStation(24, 12, 'rail');
    g.buyVehicle('freight', [g.s.stations[0], g.s.stations[1]]);
    for (let i = 0; i < 600; i++) g.tick(0.25);
    const def = byId('disaster');
    const p = def.pick(g)!;
    expect(p).toBeTruthy();
    expect(sc.accept({ def, params: p })).toBeNull();
    expect(g.s.rubble.length).toBeGreaterThan(0);
    g.buildStroke(line(g, 12, 3, 25), 'rail');
    let completed = '';
    sc.onComplete = (d) => { completed = d.id; };
    for (let i = 0; i < 1200 && !completed; i++) { g.tick(0.25); sc.update(0.25); }
    expect(completed).toBe('disaster');
  });
});
