// A saved game carries on exactly as the one it was saved from. The starter town runs with its
// stops, two bus lines and the economy for five game days; it's saved (copied as IndexedDB copies
// it: a structured clone), loaded into a fresh world, and both run on for five more days side by
// side, the same steps in the same order. The economy's whole state, the purse, the buildings standing
// and the plots still free must come out the same.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Network, rng, type Lot } from '../roads';
import { Traffic } from '../traffic';
import { SCENARIOS, town } from '../trafficsim';
import { starterStops } from './crowdsites';
import { Lines } from './lines';
import { Purse } from './money';
import { TownEconomy } from './econ';
import { MIGRATIONS, SAVE_VERSION, SaveError, migrate, restoreNetwork, saveNetwork, type GameSave } from './save';
import { saveSearch } from './savedb';

const SC = SCENARIOS.find((s) => s.name === 'the starter town')!;

// the game's world as main.ts wires it, without the drawing: roads, stops, traffic, lines, purse, town
function world(from?: Pick<GameSave, 'net' | 'queue' | 'lines' | 'town' | 'purse' | 'clock'>) {
  const made = town({ ...SC, buses: 0 });
  let net = made.net, queue: Lot[] = [];
  if (from) {
    net = new Network(() => false, SC.bound ?? 900);
    restoreNetwork(net, from.net);
    queue = from.queue;
  } else {
    starterStops(net);
    // plots laid out from the town's centre, as the game does (homes outside, shops and offices
    // in the middle); most are built on at the start, the rest are free for the town to grow onto
    net.lots = [];
    const plots = [...net.segs.keys()].flatMap((id) => net.plotsFor(id, { x: 0, z: 0 })).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z));
    for (const [i, l] of plots.entries()) if (i % 5 === 4) queue.push(l); else if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
  }
  const traffic = new Traffic(net, new THREE.Scene(), rng(5));
  traffic.junctions = made.junctions;
  const lines = new Lines(traffic);
  const purse = new Purse();
  let clock = from?.clock ?? 7 * 60;
  if (from) { lines.restore(from.lines); purse.load(from.purse); }
  else {
    const stops = [...net.segs.values()].flatMap((s) => s.stops.map((st) => st.id));
    const places = [...new Set(stops.map((id) => Math.min(...traffic.place(id)!.stops.map((s) => s.id))))];
    lines.add(places.slice(0, 3), false, 2);
    lines.add([places[places.length - 1], places[1], places[places.length - 2]], false, 1);
  }
  const t = new TownEconomy({
    net, traffic, lines, purse, industrial: () => false, clock: () => clock,
    standing: () => net.lots.filter((l) => l.id >= 0),
    free: () => queue,
    build: (l) => { queue = queue.filter((x) => x !== l); if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); } },
    rebuild: (l, kind) => { l.kind = kind; },
    clear: (l) => { net.lots = net.lots.filter((x) => x !== l); queue.push(l); },
  }, 1, from?.town);
  return {
    net, lines, purse, town: t, get queue() { return queue; }, get clock() { return clock; },
    // game minutes, in the chunks a frame would hand over, with a sync every so often
    run(minutes: number) { for (let m = 0; m < minutes; m += 10) { clock += 10; t.advance(10); if (m % 30 === 0) t.sync(); } },
    save() {
      return structuredClone({ net: saveNetwork(net), queue, lines: lines.save(), town: t.save(), purse: purse.save(), clock }) as Pick<GameSave, 'net' | 'queue' | 'lines' | 'town' | 'purse' | 'clock'>;
    },
  };
}
const state = (w: ReturnType<typeof world>) => ({
  econ: w.town.econ.save(), purse: w.purse.save(), clock: w.clock, report: w.town.report, stats: w.town.stats && { ...w.town.stats, ms: 0 },
  lots: w.net.lots.map((l) => `${l.id}:${l.kind}`).sort(), queue: w.queue.map((l) => `${l.id}:${l.kind}`),
  lines: w.lines.list.map((l) => [l.id, l.stops, w.lines.buses(l).length]),
});

// Numbers the same to a millionth (the library rebuilds some working figures on load in a
// different order, which moves the last digits), and everything else exactly.
function near(x: unknown, y: unknown, path = ''): string | null {
  if (typeof x === 'number' && typeof y === 'number') return x === y || (Number.isNaN(x) && Number.isNaN(y)) || Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y)) ? null : `${path}: ${x} vs ${y}`;
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) { const d = near((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return x === y ? null : `${path}: ${String(x)} vs ${String(y)}`;
}

describe('a saved game', () => {
  it('carries on exactly as the game it was saved from, and as if it had never been saved', () => {
    const a = world(), never = world();
    a.run(5 * 1440 + 370); // (saved part way through a day)
    never.run(5 * 1440 + 370);
    const saved = a.save();
    const b = world(saved);
    expect(state(b)).toEqual(state(a));
    a.run(5 * 1440);
    b.run(5 * 1440);
    never.run(5 * 1440);
    const sa = state(a), sb = state(b);
    // (the town did something in those days, so the comparison means something)
    expect(sa.econ.month).toBeGreaterThan(8);
    expect(sa.purse.balance).not.toBe(saved.purse.balance);
    expect(sa.stats.builds + sa.stats.densified + sa.stats.cleared).toBeGreaterThan(saved.town.stats.builds + saved.town.stats.densified + saved.town.stats.cleared);
    // the loaded game and the one that was saved: alike to the last digit
    expect(sb).toEqual(sa);
    // and saving lost nothing: the same buildings, plots and decisions as a game never saved
    const sn = state(never);
    expect(sa.lots).toEqual(sn.lots);
    expect(sa.queue).toEqual(sn.queue);
    expect(sa.stats).toEqual(sn.stats);
    expect(near(sa, sn)).toBe(null);
  }, 120_000);

  it('keeps its roads, stops, one-way carriageways, bridges and land as they were', () => {
    const a = world();
    const s = a.save();
    const net = new Network(() => false, SC.bound ?? 900);
    restoreNetwork(net, s.net);
    expect(structuredClone(saveNetwork(net))).toEqual(s.net);
    expect([...net.segs.values()].some((sg) => sg.stops.length)).toBe(true);
    // and the network draws the same random numbers after as before
    const plots = (n: Network) => n.plotsFor([...n.segs.keys()][0]).map((l) => [l.id, l.w, l.seed]);
    expect(plots(net)).toEqual(plots(a.net));
  });
});

describe('save versions', () => {
  const v1 = { v: 1, id: 'x' };
  it('reads a save of this version as it is, and copies it', () => {
    const s = migrate(v1);
    expect(s).toEqual(v1);
    expect(s).not.toBe(v1);
    expect(SAVE_VERSION).toBe(1);
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });
  it('brings an older save up to date one version at a time', () => {
    const steps = { 1: (s: Record<string, unknown>) => ({ ...s, speed: 1 }), 2: (s: Record<string, unknown>) => ({ ...s, rate: s.speed }) };
    expect(migrate(v1, steps, 3)).toEqual({ v: 3, id: 'x', speed: 1, rate: 1 });
  });
  it('refuses a save from a newer game, one with no way up, and one that is not a save', () => {
    expect(() => migrate({ v: 2 })).toThrow(SaveError);
    expect(() => migrate({ v: 0 })).toThrow(/old version/);
    expect(() => migrate('hello')).toThrow(SaveError);
  });
  it('plays a save at its map’s own address', () => {
    expect(saveSearch({ id: 'abc', map: { id: 'region', query: 'map=region&seed=42&guide=1' } })).toBe('?map=region&seed=42&save=abc');
  });
});
