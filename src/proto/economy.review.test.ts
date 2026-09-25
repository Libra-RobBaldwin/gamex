// Adversarial review of the economy model. Each test states what the model should do and fails
// where it doesn't; the comment above each says what goes wrong and why.
import { describe, expect, it } from 'vitest';
import { budget, cpuMs } from './test/speed';
import { Economy, type EconomyOptions } from './economy';
import { BALANCED, Kit } from './econkit';
import { VEHICLES, type Action, type LineIn, type TownStatus } from './econdefs';

const DAY = 1440, MONTH = 30 * DAY;
const opts: EconomyOptions = { seed: 7, autoBuild: true };

// run month by month, keeping each month's actions and a town's report
function months(e: Economy, n: number, town = 1) {
  const acts: Action[][] = [], reports = [];
  for (let m = 0; m < n; m++) {
    e.advance(MONTH);
    acts.push(e.takeActions());
    reports.push(e.town(town)!);
  }
  return { acts, reports, res: reports.map((r) => r.residents) };
}

function twinTowns() {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED }).town({ id: 2, x: 4000, z: 0, ...BALANCED });
  k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 4000, 0);
  return k;
}

// as economy.test.ts: buses round the town, a railway, timber and stone brought in by lorry
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

describe('exploits', () => {
  // freightRoutes() lets a line take cargo to any stop next to one with an onward line, and
  // freightArrives() drops what nobody consumes into that stop's pool, where the same line picks
  // it up again. A lorry shuttling 200 m between two depots carries the same coal back and forth,
  // paid every leg, and steals it from the line that actually delivers it.
  it('a lorry shuttling between two neighbouring depots can’t farm fares on the same coal', () => {
    const k = new Kit().industry(1, 'coal_mine', 0, 0).industry(2, 'power_station', 6000, 0);
    k.stop(1, 'lorry_depot', 50, 0).stop(2, 'lorry_depot', 5950, 0).stop(3, 'lorry_depot', 50, 200);
    const haul: LineIn = { id: 1, stops: [1, 2], vehicle: 'lorry', count: 2 };
    const base = new Economy(k.world(), k.oracles(), opts);
    base.setLines([haul]);
    base.advance(10 * DAY);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([haul, { id: 2, stops: [1, 3], vehicle: 'lorry', count: 1 }]);
    e.advance(10 * DAY);
    const shuttle = e.line(2)!, mined = e.industry(1)!.produced;
    // nothing can carry more coal than was dug, or earn more than a lorry costs on a 200 m hop
    expect(shuttle.carried).toBeLessThanOrEqual(mined);
    expect(shuttle.profit).toBeLessThan(0);
    // and the power station still gets its coal
    expect(e.industry(2)!.received).toBeGreaterThan(base.industry(2)!.received * 0.9);
  });

  // Mode choice is a logit on minutes with no constant against boarding, and every ride pays
  // the £1 base fare, so a one-minibus hop between stops 300 m apart (just beyond the 250 m
  // walk link) takes a quarter of all the village's trips and pays handsomely. Everyone getting
  // off near any workplace counts as an office "visitor", so offices read 5x supplied too.
  it('a 300 m minibus hop inside a village neither pays nor takes a big share of trips', () => {
    const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED });
    k.stop(1, 'bus_stop', -150, 0).stop(2, 'bus_stop', 150, 0);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'minibus', count: 1 }]);
    const run = months(e, 2);
    const l = e.line(1)!, trips = run.reports[1].residents * 2.2 * 30;
    expect(l.carriedLastMonth / trips).toBeLessThan(0.1);
    expect(l.profitLastMonth).toBeLessThan(0);
    expect(run.reports[1].supply.visitors).toBeLessThan(1.5);
  });

  // The skim keeps one best edge per stop pair (strict `<`), and trips follow only that path, so
  // a second line on the same stops gets no passengers at all and its frequency isn't added to
  // the first's. In the 2D game anyone waiting boarded whichever vehicle came first.
  it('two lines on the same stops share the passengers', () => {
    const k = twinTowns();
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }, { id: 2, stops: [1, 2], vehicle: 'bus', count: 2 }]);
    e.advance(7 * DAY);
    const a = e.line(1)!.carried, b = e.line(2)!.carried;
    expect(a).toBeGreaterThan(1000);
    expect(b).toBeGreaterThan(a * 0.3);
  });
});

describe('ported 2D behaviour', () => {
  // The 2D `wants` looks two lines ahead, so lorry → train → lorry works. freightRoutes() only
  // looks one ahead (`onward` is built from lines that reach a consumer directly), so the first
  // lorry line never loads and nothing moves.
  it('coal goes lorry → train → lorry to a power station', () => {
    const k = new Kit().industry(1, 'coal_mine', 0, 0).industry(2, 'power_station', 20000, 3000);
    k.stop(1, 'lorry_depot', 50, 0).stop(2, 'lorry_depot', 3000, 0).stop(3, 'goods_yard', 3100, 0).stop(4, 'goods_yard', 19950, 0);
    k.stop(5, 'lorry_depot', 20050, 0).stop(6, 'lorry_depot', 20000, 2950);
    k.line(1, [1, 2], 'lorry', 2).line(2, [3, 4], 'freight', 1).line(3, [5, 6], 'lorry', 2);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.advance(5 * DAY);
    expect(e.line(1)!.carried).toBeGreaterThan(1000);
    expect(e.industry(2)!.received).toBeGreaterThan(1000);
  });

  // 2D: production only falls back to 100% (`Math.max(1, ...)`). Here TUNE.industry.min is 0.5,
  // so an unserved colliery halves, and with it the jobs it gives the towns round it.
  it('an unserved industry falls back to its starting production, not below', () => {
    const k = new Kit().industry(1, 'coal_mine', 0, 0);
    const e = new Economy(k.world(), k.oracles(), opts);
    for (let m = 0; m < 24; m++) e.advance(MONTH);
    expect(e.industry(1)!.rate).toBeGreaterThanOrEqual(1);
  });
});

describe('towns and service', () => {
  // Reach (and so home demand) uses the skim's times, which know headways but not seats; queues
  // over a stop's capacity are just dropped. Buses with one seat each give a dormitory exactly
  // the same growth as 60-seaters, though they carry only a third of those who want to ride.
  it('a line far over capacity doesn’t give a town the growth of one with room', () => {
    const run = (seats: number) => {
      const was = VEHICLES.bus.capacity;
      VEHICLES.bus.capacity = seats;
      try {
        const k = new Kit()
          .town({ id: 1, x: 0, z: 0, mix: { house: 20, terrace: 10 }, centre: { shop: 3, civic: 1 }, carShare: 0.1 })
          .town({ id: 2, x: 5000, z: 0, mix: { house: 2, office: 2 }, centre: { shop: 4, civic: 2 }, carShare: 0.1 });
        k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 5000, 0);
        const e = new Economy(k.world(), k.oracles(), opts);
        e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 6 }]);
        const r = months(e, 12);
        return { res: r.res[11], lf: e.line(1)!.loadFactor, workTransit: r.reports[11].reach.workTransit };
      } finally { VEHICLES.bus.capacity = was; }
    };
    const roomy = run(60), full = run(1);
    expect(full.lf).toBeGreaterThan(0.95); // it really is full
    expect(full.res).toBeLessThan(roomy.res * 0.95);
    expect(full.workTransit).toBeLessThan(0.9);
  });

  // ENGINE.md: "a town finds some of what it needs for itself ... so an unserved town shrinks
  // towards a floor rather than vanishing". The local shares only cap shops, offices and works;
  // homes follow reach, and an estate with no jobs in reach has low reach at any size, so it
  // loses 6% a month for ever. 720 people become about 20 in five years.
  it('an unserved housing estate shrinks towards a floor rather than vanishing', () => {
    const k = new Kit().town({ id: 1, x: 0, z: 0, mix: { house: 20 }, centre: { civic: 1 } });
    const e = new Economy(k.world(), k.oracles(), opts);
    const start = e.town(1)!.residents;
    const run = months(e, 60);
    expect(run.res[59]).toBeGreaterThan(start * 0.25);
    expect(run.res[59]).toBeGreaterThan(run.res[47] * 0.97); // and has stopped falling
  });

  // "Towns are treated as in balance when the map is made": calibration only lifts a town that
  // starts short (bias clamped to 1..1.6), so one with more jobs than homes grows on its own,
  // with no stop, no line and no road to anywhere: +110% in two years.
  it('a town with no service at all doesn’t grow', () => {
    const k = new Kit().town({ id: 1, x: 0, z: 0, mix: { office: 1, house: 2 }, centre: { shop: 5, civic: 2 }, plots: 3 });
    const e = new Economy(k.world(), k.oracles(), opts);
    const start = e.town(1)!.residents;
    const run = months(e, 24);
    expect(run.res[23]).toBeLessThanOrEqual(start * 1.1);
    expect(run.reports.filter((r) => r.status === 'growing').length).toBeLessThan(3);
  });

  // Found by fuzzing random worlds. A served town with no free plots wants offices (passengers
  // arrive by rail) but can't build them, so its homes empty for want of jobs. Six months after
  // they're abandoned they're cleared, the freed plots become offices, and homes come back: down
  // 40%, then up 40%, with nothing changed. The builder's own "settles" test forbids exactly this.
  it('a served town without free plots doesn’t fall and then climb back', () => {
    const k = new Kit()
      .town({ id: 2, x: 4600, z: 0, grid: 3, mix: { house: 14, flats: 1 }, centre: { shop: 7, office: 1 }, plots: 1, carShare: 0.34 })
      .town({ id: 3, x: 12600, z: 0, grid: 4, mix: { house: 22, terrace: 2, flats: 2 }, centre: { shop: 4, office: 3, civic: 2 }, edge: { industry: 1 }, plots: 0, carShare: 0.3 });
    k.stop(2, 'rail_station', 4600, 0).stop(3, 'rail_station', 12600, 0);
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 2, stops: [2, 3], vehicle: 'dmu', count: 4 }]);
    const { res } = months(e, 36, 3);
    let ups = 0, downs = 0;
    for (let m = 4; m < res.length; m++) {
      if (res[m] > res[m - 1] * 1.005) ups++;
      if (res[m] < res[m - 1] * 0.995) downs++;
    }
    expect(Math.min(ups, downs)).toBe(0);
  });
});

describe('what the town panel says', () => {
  // statusOf() calls a town growing while any use has demand over capacity (`up > 0`) and isn't
  // `stuck`. decide()'s lumpiness guard won't add a 120-job office for 40 jobs of demand, but
  // there are still candidates, so it's never stuck: the builder's own twin towns read "Growing:
  // offices busy with visitors" for a year and more while nothing is built and nobody moves.
  it('a town where nothing is built and nobody moves for eight months isn’t "Growing"', () => {
    const k = twinTowns();
    const e = new Economy(k.world(), k.oracles(), opts);
    e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }]);
    months(e, 22);
    const zones = new Set(k.zones.filter((z) => z.town === 1).map((z) => z.id));
    const ours = new Set(e.buildingIds().filter((id) => zones.has(e.buildingState(id)!.zone)));
    const tail = months(e, 8);
    const acts = tail.acts.flat().filter((a) => a.t !== 'vacate' && (a.t === 'add' ? zones.has(a.zone) : ours.has(a.building)));
    expect(acts).toEqual([]); // nothing happened
    expect(new Set(tail.res).size).toBe(1);
    expect(tail.reports.map((r) => r.status)).not.toContain('growing' as TownStatus);
  });

  // A town that has settled (residents unchanged for a year, nothing built or lost) still reads
  // "Stalling" for ever, because its home demand sits below `recoverAt` at the floor.
  it('a town that has settled reads "Stable"', () => {
    const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED });
    const e = new Economy(k.world(), k.oracles(), opts);
    const run = months(e, 40);
    const tail = run.res.slice(-12);
    expect(Math.max(...tail)).toBe(Math.min(...tail)); // settled
    expect(run.reports[39].status).toBe('stable');
  });

  // save() leaves out each town's `recent` built/lost, which statusOf() reads, so a loaded game
  // reads "Stalling" where the running one reads "Declining", and townNews() announces both
  // changes for every town: four news items the game that wasn't reloaded never shows.
  it('a loaded game gives the same town status and news as the one that was saved', () => {
    const k = twinTowns();
    const lines: LineIn[] = [{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }];
    const a = new Economy(k.world(), k.oracles(), opts);
    a.setLines(lines);
    months(a, 4);
    a.takeEvents();
    const w = k.world();
    w.lines = lines;
    const b = Economy.load(w, k.oracles(), JSON.parse(JSON.stringify(a.save())), opts);
    const sa = months(a, 3).reports.map((r) => r.status), sb = months(b, 3).reports.map((r) => r.status);
    const news = (e: Economy) => e.takeEvents().filter((ev) => ev.t === 'news');
    expect.soft(sb).toEqual(sa);
    expect.soft(news(b)).toEqual(news(a));
  });
});

describe('what the live game can supply', () => {
  // roads.ts lots are fixed-size plots chosen by kind (a terrace 6–7.5 m wide, flats 12–18 m),
  // so the game often can't rebuild a lot as the next kind and must decline. A declined densify
  // doesn't rest anything (only a declined add blocks its zone), so the same buildings are asked
  // again every month, decide() counts the requested gain as built, and the town reads
  // "Growing" for a year with not one new home.
  it('when the game declines every densify, it isn’t asked again at once and the town doesn’t read "Growing"', () => {
    const { k, lines } = servedTown(0);
    const e = new Economy(k.world(), k.oracles(), { seed: 7 });
    e.setLines(lines);
    const asked = new Map<number, number[]>(), statuses: TownStatus[] = [], res: number[] = [];
    for (let m = 0; m < 12; m++) {
      e.advance(MONTH);
      for (const a of e.takeActions()) {
        if (a.t === 'densify') asked.set(a.building, [...(asked.get(a.building) ?? []), m]);
        if (a.t === 'add' || a.t === 'densify') e.decline(a.req);
      }
      statuses.push(e.town(1)!.status);
      res.push(e.town(1)!.residents);
    }
    const again = [...asked.values()].filter((ms) => ms.some((m, i) => i > 0 && m - ms[i - 1] < 3));
    expect(again.length).toBe(0);
    expect(new Set(res).size).toBe(1); // nothing was built
    expect(statuses.slice(-6)).not.toContain('growing' as TownStatus);
  });
});

describe('cost', () => {
  // decide() re-filters the whole list of a use's buildings and rehouses into all of them for
  // every building it abandons, and a month may abandon 6% of them, so a declining town costs
  // the square of its size: 4x the buildings takes 13-20x the time.
  it('a declining town’s review costs in proportion to its size, not its square', () => {
    const cost = (scale: number) => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, grid: 3, mix: { house: 100 * scale }, centre: { shop: 10 * scale, office: 3 * scale } });
      const e = new Economy(k.world(), k.oracles(), opts);
      months(e, 12);
      return e.timing.parts.towns;
    };
    cost(2); // warm up
    const small = cost(4), big = cost(16);
    console.log(`declining town review: ${small.toFixed(0)} ms at 7k people, ${big.toFixed(0)} ms at 30k`);
    expect(big / small).toBeLessThan(8);
  }, 60_000);

  // Zone pairs are every zone with every other within 25 km, so a conurbation (144 towns 2 km
  // apart, 16 zones each, about 220,000 people) makes 5 million pairs and a month takes several
  // seconds, against the 1 s the builder's own scale test allows.
  it('a month for a conurbation of 144 towns runs well under a second', () => {
    const k = new Kit();
    for (let t = 0; t < 144; t++) k.town({ id: t + 1, x: (t % 12) * 2000, z: Math.floor(t / 12) * 2000, grid: 4, mix: { house: 16, terrace: 6 }, centre: { office: 2, shop: 5, civic: 2 } });
    for (let a = 1; a <= 144; a++) for (let b = a + 1; b <= 144; b++) k.road(a, b);
    const e = new Economy(k.world(), k.oracles(), opts);
    const ms = cpuMs(() => e.advance(MONTH));
    console.log(`conurbation: ${k.zones.length} zones, a month ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(budget(1000)); // (on the reference machine, scaled to this one's speed: test/speed.ts)
  }, 120_000);
});
