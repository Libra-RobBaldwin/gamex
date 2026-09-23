import { describe, expect, it } from 'vitest';
import { Game, newGame, type GameState } from './sim';
import { T_GRASS, generateWorld, type Building } from './world';
import { levelForXp, xpForLevel } from './data';

// A flat 20x10 test map with a tree at (2,2), a sawmill at (16,2) and a town at (16,6).
function testState(): GameState {
  const s = newGame(1);
  s.w = 20;
  s.h = 10;
  s.terrain = new Uint8Array(200).fill(T_GRASS);
  s.infra = new Uint8Array(200);
  const b = (id: number, kind: Building['kind'], x: number, y: number, w = 1, h = 1): Building =>
    ({ id, kind, x, y, w, h, name: kind, stock: {}, input: {}, progress: [] });
  s.buildings = [b(1, 'tree', 2, 2), b(2, 'sawmill', 16, 2), b(3, 'town', 16, 7, 2, 2)];
  s.coins = 5000;
  return s;
}

const row = (g: Game, y: number, x0: number, x1: number) => {
  const out: number[] = [];
  for (let x = x0; x <= x1; x++) out.push(g.idx(x, y));
  return out;
};

describe('xp table', () => {
  it('matches OSRS breakpoints', () => {
    expect(xpForLevel(2)).toBe(83);
    expect(xpForLevel(99)).toBe(13034431);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(83)).toBe(2);
    expect(levelForXp(13034431)).toBe(99);
  });
});

describe('world generation', () => {
  it('is deterministic and has a starter chain', () => {
    const a = generateWorld(42), b = generateWorld(42);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    const kinds = new Set(a.buildings.map((x) => x.kind));
    for (const k of ['town', 'sawmill', 'tree', 'furnace', 'copper_rock', 'tin_rock']) expect(kinds).toContain(k);
  });
});

describe('logistics', () => {
  it('hauls logs to the sawmill, then planks to town, earning coins and xp', () => {
    const g = new Game(testState());
    expect(g.buildInfra(row(g, 4, 3, 15), 'road')).toBeNull();
    // vertical spur from (15,4) down to (15,6)
    expect(g.buildInfra([g.idx(15, 5), g.idx(15, 6)], 'road')).toBeNull();
    expect(g.placeStation(3, 4, 'road')).toBeNull(); // near tree
    expect(g.placeStation(15, 4, 'road')).toBeNull(); // near sawmill
    expect(g.placeStation(15, 6, 'road')).toBeNull(); // near town
    const [treeStop, millStop, townStop] = g.s.stations;
    expect(g.catchmentOf(treeStop).map((b) => b.kind)).toEqual(['tree']);
    expect(g.catchmentOf(millStop).map((b) => b.kind)).toContain('sawmill');
    expect(g.catchmentOf(townStop).map((b) => b.kind)).toContain('town');

    expect(g.buyVehicle('ox_cart', treeStop, millStop)).toBeNull();
    expect(g.buyVehicle('ox_cart', millStop, townStop)).toBeNull();
    const coins0 = g.s.coins;
    for (let i = 0; i < 1200; i++) g.tick(0.25);
    expect(g.s.stats.produced.planks ?? 0).toBeGreaterThan(5);
    expect(g.s.stats.delivered.planks ?? 0).toBeGreaterThan(0);
    expect(g.s.coins).toBeGreaterThan(coins0);
    expect(g.s.xp.woodcutting).toBeGreaterThan(0);
    expect(g.s.xp.transport).toBeGreaterThan(0);
  });

  it('refuses vehicles between unconnected stations and reroutes when road is cut', () => {
    const g = new Game(testState());
    g.placeStation(3, 4, 'road');
    g.placeStation(15, 4, 'road');
    const [a, b] = g.s.stations;
    expect(g.buyVehicle('ox_cart', a, b)).toMatch(/connected/);
    g.buildInfra(row(g, 4, 3, 15), 'road');
    expect(g.buyVehicle('ox_cart', a, b)).toBeNull();
    for (let i = 0; i < 10; i++) g.tick(0.25);
    g.bulldoze(9, 4);
    for (let i = 0; i < 10; i++) g.tick(0.25);
    expect(g.s.vehicles[0].state).toBe('lost');
    g.buildInfra([g.idx(9, 4)], 'road');
    for (let i = 0; i < 20; i++) g.tick(0.25);
    expect(g.s.vehicles[0].state).not.toBe('lost');
  });

  it('gates rail behind Transport 12', () => {
    const g = new Game(testState());
    expect(g.buildInfra(row(g, 4, 3, 8), 'rail')).toMatch(/Transport level 12/);
  });

  it('transfers cargo between routes', () => {
    const g = new Game(testState());
    g.buildInfra(row(g, 4, 3, 15), 'road');
    g.placeStation(3, 4, 'road'); // tree
    g.placeStation(9, 4, 'road'); // hub, nothing nearby
    g.placeStation(15, 4, 'road'); // sawmill
    const [a, hub, c] = g.s.stations;
    g.buyVehicle('ox_cart', hub, c);
    g.buyVehicle('ox_cart', a, hub);
    for (let i = 0; i < 1200; i++) g.tick(0.25);
    expect(g.s.stats.produced.planks ?? 0).toBeGreaterThan(0);
  });

  it('catches up offline time', () => {
    const g = new Game(testState());
    g.buildInfra(row(g, 4, 3, 15), 'road');
    g.placeStation(3, 4, 'road');
    g.placeStation(15, 4, 'road');
    g.buyVehicle('ox_cart', g.s.stations[0], g.s.stations[1]);
    const r = g.catchUp(600);
    expect(r.coins).toBeGreaterThan(0);
    expect(r.xp.woodcutting).toBeGreaterThan(0);
  });
});
