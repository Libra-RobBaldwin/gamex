import { describe, expect, it } from 'vitest';
import { Economy, type EconomyOptions } from './economy';
import { BALANCED, Kit } from './econkit';
import { VEHICLES, type Action, type LineIn } from './econdefs';
import { TRAINS } from './catalog';

const DAY = 1440, MONTH = 30 * DAY;
const opts: EconomyOptions = { seed: 7, autoBuild: true };

// Run month by month, keeping the actions and each month's report for a town.
function months(e: Economy, n: number, town = 1, each?: (m: number) => void) {
  const acts: Action[][] = [], reports = [];
  for (let m = 0; m < n; m++) {
    each?.(m);
    e.advance(MONTH);
    acts.push(e.takeActions());
    reports.push(e.town(town)!);
  }
  return { acts, reports, count: (t: Action['t']) => acts.flat().filter((a) => a.t === t).length };
}

// Two balanced towns 4 km apart with no road between them, a bus stop in the middle of each.
function twinTowns() {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED }).town({ id: 2, x: 4000, z: 0, ...BALANCED });
  k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 4000, 0);
  return k;
}

// A town fed well: buses round it, a railway to the next town, timber made into goods and stone
// into building materials, all brought in by lorry.
function servedTown(plots = 1) {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED, plots, carShare: 0.5 }).town({ id: 2, x: 6000, z: 0, ...BALANCED });
  k.stop(1, 'bus_stop', -220, -220).stop(2, 'bus_stop', 220, -220).stop(3, 'bus_stop', 220, 220).stop(4, 'bus_stop', -220, 220);
  k.stop(5, 'rail_station', 0, 0).stop(6, 'rail_station', 6000, 0);
  k.industry(1, 'forest', 3000, 3000).industry(2, 'sawmill', 1500, 1500).industry(3, 'quarry', -3000, 3000).industry(4, 'brickworks', -1500, 1500);
  k.stop(10, 'lorry_depot', 3000, 3000).stop(11, 'lorry_depot', 1500, 1500).stop(12, 'lorry_depot', 0, 0);
  k.stop(13, 'lorry_depot', -3000, 3000).stop(14, 'lorry_depot', -1500, 1500).stop(15, 'lorry_depot', 220, 220);
  const lines: LineIn[] = [
    { id: 1, stops: [1, 2, 3, 4], vehicle: 'bus', count: 2 },
    { id: 2, stops: [5, 6], vehicle: 'dmu', count: 2 },
    { id: 3, stops: [10, 11], vehicle: 'lorry', count: 2 },
    { id: 4, stops: [11, 12], vehicle: 'lorry', count: 2 },
    { id: 5, stops: [13, 14], vehicle: 'lorry', count: 2 },
    { id: 6, stops: [14, 15], vehicle: 'lorry', count: 2 },
  ];
  return { k, lines };
}

// Built as the map is made, then served: the towns start in balance, and the lines come after.
function served(o: EconomyOptions = opts) {
  const { k, lines } = servedTown();
  const e = new Economy(k.world(), k.oracles(), o);
  e.setLines(lines);
  return e;
}

describe('lines carry passengers (ported from the 2D game)', () => {
  it('buses carry passengers between towns and pay their way', () => {
    const k = twinTowns();
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }]);
    e.advance(7 * DAY);
    const l = e.line(1)!;
    expect(l.ok).toBe(true);
    expect(e.totals.delivered.pax ?? 0).toBeGreaterThan(1000);
    expect(l.carried).toBeGreaterThan(1000);
    expect(l.revenue).toBeGreaterThan(l.running);
    expect(l.loadFactor).toBeGreaterThan(0);
    const events = e.takeEvents();
    expect(events.some((ev) => ev.t === 'money' && ev.kind === 'fare' && ev.stop === 1 && ev.amount > 0)).toBe(true);
    expect(events.some((ev) => ev.t === 'money' && ev.kind === 'running' && ev.amount < 0)).toBe(true);
    // fares and running costs add up to the line's books
    expect(e.totals.fares).toBeCloseTo(l.revenue, 6);
  });

  it('a multi-stop line visits every stop in order, standing at each', () => {
    const k = twinTowns().stop(3, 'bus_stop', 2000, 1500);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 3, 2], vehicle: 'decker', count: 1 }]);
    e.advance(60);
    const seen: number[] = [];
    let dwelt = false;
    for (let t = 0; t < 240; t += 0.5) {
      const [v] = e.vehicles(1, e.time + t);
      if (seen[seen.length - 1] !== v.from) seen.push(v.from);
      if (v.dwelling) dwelt = true;
      expect(v.load).toBeLessThanOrEqual(VEHICLES.decker.capacity);
    }
    const start = seen.indexOf(1);
    expect(seen.slice(start, start + 4)).toEqual([1, 3, 2, 1]);
    expect(dwelt).toBe(true);
  });

  it('passengers change lines where two lines meet', () => {
    // nobody lives by the stop in the middle, so everyone on the second line has changed there
    const k = twinTowns().stop(3, 'bus_stop', 2000, 0);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 3], vehicle: 'bus', count: 2 }, { id: 2, stops: [3, 2], vehicle: 'bus', count: 2 }]);
    e.advance(7 * DAY);
    expect(e.line(1)!.carried).toBeGreaterThan(500);
    expect(e.line(2)!.carried).toBeGreaterThan(500);
    expect(e.stop(3)!.alighted).toBeGreaterThan(500);
    expect(e.stop(2)!.alighted).toBeGreaterThan(200);
  });

  it('the game’s journey times set the timetable, and slower roads mean fewer trips', () => {
    const k = twinTowns();
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }]);
    e.advance(DAY);
    const quick = e.line(1)!;
    k.slow = 2;
    e.networkChanged();
    e.advance(DAY);
    const slow = e.line(1)!;
    expect(slow.cycleMin).toBeGreaterThan(quick.cycleMin * 1.6);
    expect(slow.capacityPerHour).toBeLessThan(quick.capacityPerHour * 0.65);
  });

  it('a line that loses its route says why and stops carrying, then picks up again', () => {
    const k = twinTowns();
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }]);
    e.advance(DAY);
    k.sever(2);
    e.networkChanged();
    e.advance(DAY);
    const broken = e.line(1)!;
    expect(broken.ok).toBe(false);
    expect(broken.problem).toMatch(/No route/);
    const carried = broken.carried;
    e.advance(DAY);
    expect(e.line(1)!.carried).toBe(carried);
    expect(e.vehicles(1)).toEqual([]);
    k['cut'].clear();
    e.networkChanged();
    e.advance(DAY);
    expect(e.line(1)!.ok).toBe(true);
    expect(e.line(1)!.carried).toBeGreaterThan(carried);
  });

  it('refuses vehicles at stops they can’t use', () => {
    const k = twinTowns().stop(3, 'lorry_depot', 2000, 0);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 3], vehicle: 'bus', count: 1 }, { id: 2, stops: [1, 2], vehicle: 'lorry', count: 1 }]);
    e.advance(60);
    expect(e.line(1)!.problem).toMatch(/can't use/);
    expect(e.line(2)!.problem).toMatch(/can't use/);
  });
});

describe('freight chains (ported from the 2D game)', () => {
  it('lorries haul coal from a mine to a power station', () => {
    const k = new Kit().industry(1, 'coal_mine', 0, 0).industry(2, 'power_station', 6000, 0);
    k.stop(1, 'lorry_depot', 50, 0).stop(2, 'lorry_depot', 5950, 0).line(1, [1, 2], 'lorry', 2);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.advance(3 * DAY);
    expect(e.totals.delivered.coal ?? 0).toBeGreaterThan(1000);
    expect(e.industry(2)!.received).toBeGreaterThan(1000);
    expect(e.industry(1)!.collected).toBeGreaterThan(0.9);
    expect(e.line(1)!.revenue).toBeGreaterThan(0);
  });

  it('coal goes by lorry to a railhead and on by train', () => {
    const k = new Kit().industry(1, 'coal_mine', 0, 0).industry(2, 'power_station', 20000, 0);
    k.stop(1, 'lorry_depot', 50, 0).stop(2, 'lorry_depot', 3000, 0).stop(3, 'goods_yard', 3100, 0).stop(4, 'goods_yard', 19950, 0);
    k.line(1, [1, 2], 'lorry', 2).line(2, [3, 4], 'freight', 1);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.advance(5 * DAY);
    expect(e.line(1)!.carried).toBeGreaterThan(1000);
    expect(e.line(2)!.carried).toBeGreaterThan(1000);
    expect(e.industry(2)!.received).toBeGreaterThan(1000);
  });

  it('a sawmill turns timber into goods, and goods feed a town’s shops', () => {
    const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED }).industry(1, 'forest', 5000, 0).industry(2, 'sawmill', 2500, 0);
    k.stop(1, 'lorry_depot', 5000, 0).stop(2, 'lorry_depot', 2500, 0).stop(3, 'lorry_depot', 0, 0);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'lorry', count: 2 }, { id: 2, stops: [2, 3], vehicle: 'lorry', count: 2 }]);
    months(e, 2);
    expect(e.industry(2)!.produced).toBeGreaterThan(0);
    expect(e.totals.delivered.goods ?? 0).toBeGreaterThan(1000);
    const r = e.town(1)!;
    expect(r.supply.goods).toBeGreaterThan(1);
    expect(r.reasons.some((x) => x.good && /shops well supplied with goods/.test(x.text))).toBe(true);
  });
});

describe('industry production (ported from the 2D game)', () => {
  it('collecting most of an industry’s output raises its production; leaving it lowers it', () => {
    const k = new Kit().industry(1, 'coal_mine', 0, 0).industry(2, 'power_station', 6000, 0).industry(3, 'coal_mine', 0, 9000);
    k.stop(1, 'lorry_depot', 50, 0).stop(2, 'lorry_depot', 5950, 0).line(1, [1, 2], 'lorry', 3);
    const e = new Economy(k.world(), k.oracles(), opts);
    months(e, 3);
    expect(e.industry(1)!.rate).toBeGreaterThan(1.3);
    expect(e.industry(3)!.rate).toBeLessThan(1);
    expect(e.takeEvents().some((ev) => ev.t === 'news' && /increases production/.test(ev.text))).toBe(true);
    // the power station, kept busy, grows too
    expect(e.industry(2)!.rate).toBeGreaterThan(1);
  });
});

describe('towns grow and shrink with how well they are fed', () => {
  it('an unserved town stagnates, then declines and shrinks', () => {
    const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED });
    const e = new Economy(k.world(), k.oracles(), opts);
    const start = e.town(1)!.residents;
    const run = months(e, 30);
    // first it stalls: nobody leaves, nothing is abandoned
    for (let m = 0; m < 3; m++) {
      expect(run.acts[m].filter((a) => a.t === 'abandon')).toEqual([]);
      expect(run.reports[m].residents).toBeGreaterThanOrEqual(start * 0.99);
    }
    expect(['stable', 'stalling']).toContain(run.reports[1].status);
    // then it declines: homes empty, buildings are abandoned and later cleared
    expect(run.reports.some((r) => r.status === 'declining')).toBe(true);
    expect(run.count('abandon')).toBeGreaterThan(5);
    expect(run.count('demolish')).toBeGreaterThan(0);
    expect(run.count('vacate')).toBeGreaterThan(0);
    const end = run.reports[run.reports.length - 1];
    expect(end.residents).toBeLessThan(start * 0.8);
    expect(end.homes).toBeLessThan(e.town(1)!.history[0] * 1.2);
    // and says why
    const words = run.reports.flatMap((r) => r.reasons.map((x) => x.text));
    expect(words).toContain('no bus or rail service');
    expect(words.some((w) => /^shops only \d+% supplied with goods/.test(w))).toBe(true);
  });

  it('a well-served town grows and gets denser', () => {
    const e = served();
    const start = e.town(1)!.residents;
    const run = months(e, 18);
    const end = run.reports[run.reports.length - 1];
    expect(end.residents).toBeGreaterThan(start * 1.25);
    expect(run.count('add')).toBeGreaterThan(3);
    expect(run.count('densify')).toBeGreaterThan(3);
    expect(run.reports.slice(0, 12).filter((r) => r.status === 'growing').length).toBeGreaterThan(6);
    expect(run.reports[6].headline).toMatch(/^Growing: /);
    // flats have gone up where there were terraces
    const flats = e.buildingIds().map((id) => e.buildingState(id)!).filter((b) => b.kind === 'flats' && b.zone < 2000);
    expect(flats.length).toBeGreaterThan(0);
  });

  it('supplying goods raises what shops can do', () => {
    const make = (goods: boolean) => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED, plots: 3 }).industry(1, 'forest', 5000, 0).industry(2, 'sawmill', 2500, 0);
      k.stop(1, 'lorry_depot', 5000, 0).stop(2, 'lorry_depot', 2500, 0).stop(3, 'lorry_depot', 0, 0);
      const e = new Economy(k.world(), k.oracles(), opts);
      if (goods) e.setLines([{ id: 1, stops: [1, 2], vehicle: 'lorry', count: 2 }, { id: 2, stops: [2, 3], vehicle: 'lorry', count: 2 }]);
      months(e, 6);
      return e.town(1)!;
    };
    const without = make(false), withGoods = make(true);
    expect(withGoods.uses.shop.demand).toBeGreaterThan(without.uses.shop.demand * 1.5);
    expect(withGoods.uses.shop.capacity).toBeGreaterThan(without.uses.shop.capacity);
    expect(withGoods.supply.goods).toBeGreaterThan(1);
    expect(without.supply.goods).toBeLessThan(0.9);
    expect(without.reasons.some((r) => /^shops only \d+% supplied with goods/.test(r.text))).toBe(true);
  });

  it('cutting a line makes a town decline, but only after a delay', () => {
    const k = new Kit()
      .town({ id: 1, x: 0, z: 0, mix: { house: 20, terrace: 8 }, centre: { shop: 5, civic: 2 }, carShare: 0.3 })
      .town({ id: 2, x: 8000, z: 0, mix: { house: 6, office: 1 }, centre: { shop: 4, civic: 2 }, carShare: 0.3 });
    k.stop(1, 'rail_station', 0, 0).stop(2, 'rail_station', 8000, 0).line(1, [1, 2], 'dmu', 3);
    // the commuter town was built round its railway
    const e = new Economy(k.world(), k.oracles(), opts);
    months(e, 4);
    const before = e.town(1)!.residents;
    e.setLines([]);
    const after = months(e, 10);
    // a month on, people are unhappy but haven't gone, and no homes are abandoned yet (its
    // unsupplied shops were closing anyway)
    const homesLost = (m: number) => after.acts[m].filter((a) => a.t === 'abandon' && e.buildingState(a.building)?.use === 'home');
    expect(after.reports[0].residents).toBeGreaterThanOrEqual(before * 0.98);
    expect(homesLost(0)).toEqual([]);
    expect(homesLost(1)).toEqual([]);
    expect(['stalling', 'declining']).toContain(after.reports[0].status);
    expect(after.reports[0].reasons.some((r) => /get to a job/.test(r.text) && !r.good)).toBe(true);
    // months later it has shrunk
    expect(after.reports[9].residents).toBeLessThan(before * 0.8);
    expect(after.count('abandon')).toBeGreaterThan(3);
    expect(after.reports[9].status).toBe('declining');
  });

  it('settles instead of swinging between building and abandoning', () => {
    for (const e of [new Economy(new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED }).world(), new Kit().oracles(), opts), served()]) {
      const run = months(e, 36);
      const res = run.reports.map((r) => r.residents);
      // monotone, give or take a little, once it's under way
      let ups = 0, downs = 0;
      for (let m = 4; m < res.length; m++) {
        if (res[m] > res[m - 1] * 1.005) ups++;
        if (res[m] < res[m - 1] * 0.995) downs++;
      }
      expect(Math.min(ups, downs)).toBe(0);
      // and still by the end
      const tail = res.slice(-8);
      expect(Math.max(...tail) / Math.min(...tail)).toBeLessThan(1.01);
      // nothing is abandoned and brought back and abandoned again
      const flips = new Map<number, string[]>();
      for (const a of run.acts.flat()) if (a.t === 'abandon' || a.t === 'restore') flips.set(a.building, [...(flips.get(a.building) ?? []), a.t]);
      for (const f of flips.values()) expect(f.filter((x) => x === 'abandon').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('what the game gets back', () => {
  it('each town explains itself in plain words, with numbers for its panel', () => {
    const e = served();
    months(e, 8);
    const r = e.town(1)!;
    expect(r.name).toBe('Town 1');
    expect(r.headline).toMatch(/^(Growing|Stable): /);
    for (const x of r.reasons) expect(x.text).toMatch(/^[a-z0-9]/);
    expect(r.reasons.some((x) => /\d+% of workers can get to a job within 30 min/.test(x.text))).toBe(true);
    expect(r.reach.work).toBeGreaterThan(0.8);
    expect(r.reach.work).toBeLessThanOrEqual(1);
    expect(r.supply.goods).toBeGreaterThan(1);
    expect(r.supply.visitorsPerDay).toBeGreaterThan(100);
    expect(r.service.stops).toBeGreaterThan(0);
    expect(r.service.lines).toBe(2);
    expect(r.history.length).toBe(8);
    expect(r.uses.home.capacity).toBe(r.homes);
    expect(r.residents).toBeLessThanOrEqual(r.homes);
  });

  it('building is asked of the game, which answers or declines', () => {
    const { k, lines } = servedTown(3);
    const e = new Economy(k.world(), k.oracles(), { seed: 7 });
    e.setLines(lines);
    let adds: Extract<Action, { t: 'add' }>[] = [];
    for (let m = 0; m < 6 && adds.length < 2; m++) { e.advance(MONTH); adds = e.takeActions().filter((a): a is Extract<Action, { t: 'add' }> => a.t === 'add'); }
    expect(adds.length).toBeGreaterThanOrEqual(2);
    // the game builds the first where it likes, and says so
    const [yes, no] = adds;
    e.addBuilding({ id: 9_000_001, zone: yes.zone, x: 10, z: 10, kind: yes.kind }, yes.req);
    const b = e.buildingState(9_000_001)!;
    expect(b.kind).toBe(yes.kind);
    expect(b.occupancy).toBeCloseTo(0.3);
    // and can't fit the second: that zone rests for a while
    e.decline(no.req);
    e.advance(MONTH);
    expect(e.takeActions().some((a) => a.t === 'add' && a.zone === no.zone)).toBe(false);
    // requests nobody answers lapse rather than piling up
    for (let m = 0; m < 3; m++) e.advance(MONTH);
    expect(e.save().pending.filter((p) => p.month < e.month - 2)).toEqual([]);
  });

  it('vehicles can be placed along their lines at any moment', () => {
    const e = served();
    e.advance(5 * DAY + 37);
    const all = e.vehicles();
    expect(all.length).toBe(12);
    for (const v of all) {
      expect(v.t).toBeGreaterThanOrEqual(0);
      expect(v.t).toBeLessThanOrEqual(1);
      expect(v.load).toBeLessThanOrEqual(v.capacity);
      expect(Number.isFinite(v.x) && Number.isFinite(v.z)).toBe(true);
    }
    // a moment later they've moved on, smoothly
    const [a] = e.vehicles(2), [b] = e.vehicles(2, e.time + 0.5);
    expect(a.leg === b.leg ? b.t >= a.t : true).toBe(true);
    // timber lorries run loaded to the sawmill and empty back
    const lorries = e.vehicles(3);
    expect(lorries.some((v) => v.from === 10 && !v.dwelling && v.load > 0)).toBe(true);
    for (const v of lorries) if (v.from === 11 && !v.dwelling) expect(v.load).toBe(0);
    expect(e.line(3)!.loadFactor).toBeGreaterThan(0);
    expect(e.line(3)!.loadFactor).toBeLessThan(0.5);
  });

  it('every train the game can run has figures here', () => {
    for (const id of Object.keys(TRAINS)) expect(VEHICLES[id as keyof typeof VEHICLES]?.mode).toBe('rail');
  });
});

describe('deterministic, saveable and cheap', () => {
  it('the same seed and world give the same result', () => {
    const a = served(), b = served();
    months(a, 8); months(b, 8);
    expect(JSON.stringify(a.save())).toBe(JSON.stringify(b.save()));
    const c = served({ ...opts, seed: 8 });
    months(c, 8);
    expect(JSON.stringify(c.save())).not.toBe(JSON.stringify(a.save()));
  });

  it('saves, loads and carries on', () => {
    const { k, lines } = servedTown();
    const a = new Economy(k.world(), k.oracles(), opts);
    a.setLines(lines);
    months(a, 6);
    a.advance(3 * DAY + 5);
    const saved = a.save();
    const w = k.world();
    w.lines = lines;
    const b = Economy.load(w, k.oracles(), JSON.parse(JSON.stringify(saved)), opts);
    expect(JSON.stringify(b.save())).toBe(JSON.stringify(saved));
    months(a, 3); months(b, 3);
    expect(b.town(1)!.residents).toBeGreaterThan(a.town(1)!.residents * 0.98);
    expect(b.town(1)!.residents).toBeLessThan(a.town(1)!.residents * 1.02);
  });

  it('a step costs the same however many people live in the towns', () => {
    const work = (scale: number) => {
      const mix = { house: 16 * scale, terrace: 6 * scale };
      const k = new Kit().town({ id: 1, x: 0, z: 0, mix, centre: { office: 2 * scale, shop: 5 * scale, civic: 2 * scale } })
        .town({ id: 2, x: 4000, z: 0, mix, centre: { office: 2 * scale, shop: 5 * scale } });
      k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 4000, 0).line(1, [1, 2], 'bus', 3);
      const e = new Economy(k.world(), k.oracles(), opts);
      e.advance(60);
      const w0 = e.work;
      e.advance(DAY);
      return { steps: e.work - w0, people: e.population().residents };
    };
    const small = work(1), big = work(4);
    expect(big.people).toBeGreaterThan(small.people * 3.5);
    expect(big.steps).toBe(small.steps);
  });

  it('a game month for 50 towns, 500 stops, 200 lines and 1,000 vehicles runs well under a second', () => {
    const k = new Kit();
    const lines: LineIn[] = [];
    let sid = 1, lid = 1;
    const station = new Map<number, number>();
    for (let t = 0; t < 50; t++) {
      const x = (t % 10) * 5000, z = Math.floor(t / 10) * 5000;
      k.town({ id: t + 1, x, z, ...BALANCED });
      // eight bus stops on two rings, a station and a lorry depot
      const ring: number[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, r = i % 2 ? 250 : 400;
        k.stop(sid, 'bus_stop', x + Math.cos(a) * r, z + Math.sin(a) * r);
        ring.push(sid++);
      }
      station.set(t, sid);
      k.stop(sid++, 'rail_station', x + 30, z);
      k.stop(sid++, 'lorry_depot', x - 30, z);
      for (let b = 0; b < 3; b++) lines.push({ id: lid++, stops: [ring[b], ring[b + 2], ring[b + 4], ring[(b + 6) % 8]], vehicle: b ? 'bus' : 'decker', count: 5 });
    }
    for (let t = 0; t < 50; t++) {
      const east = t % 10 < 9 ? t + 1 : t - 9;
      lines.push({ id: lid++, stops: [station.get(t)!, station.get(east)!], vehicle: 'dmu', count: 5 });
    }
    for (let i = 0; i < 20; i++) k.industry(i + 1, i % 2 ? 'farm' : 'forest', (i % 10) * 5000 + 2500, Math.floor(i / 10) * 5000 + 2500);
    expect(k.stops.length).toBe(500);
    expect(lines.length).toBe(200);
    expect(lines.reduce((s, l) => s + l.count, 0)).toBe(1000);
    const t0 = performance.now();
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines(lines);
    const t1 = performance.now();
    e.advance(MONTH);
    const t2 = performance.now();
    console.log(`scale: set-up ${(t1 - t0).toFixed(0)} ms, a month ${(t2 - t1).toFixed(0)} ms, ${Math.round(e.population().residents)} people, ${Math.round(e.totals.delivered.pax ?? 0)} journeys`);
    expect(e.totals.delivered.pax ?? 0).toBeGreaterThan(100000);
    expect(e.vehicles().length).toBe(1000);
    expect(t2 - t1).toBeLessThan(1000);
  });
});
