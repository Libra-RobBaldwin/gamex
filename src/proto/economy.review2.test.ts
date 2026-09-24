// Second review of the economy model, all lenses in one file: stability, exploits, fidelity,
// integration, and variants of the 15 original findings. Each test states the correct behaviour
// and fails today for the reason in the comment above it.
import { describe, expect, it } from 'vitest';
import { Economy, type EconomyOptions } from './economy';
import { BALANCED, Kit } from './econkit';
import { TUNE, VEHICLES, type Action, type EconEvent, type LineIn, type WorldIn } from './econdefs';

const DAY = 1440, MONTH = 30 * DAY;
const opts: EconomyOptions = { seed: 7, autoBuild: true };

type TownReport = NonNullable<ReturnType<Economy['town']>>;

// Run n months, taking the actions each month and recording the town's report.
function months(e: Economy, n: number, town = 1) {
  const res: number[] = [], acts: Action[][] = [], status: string[] = [], reports: TownReport[] = [];
  for (let m = 0; m < n; m++) {
    e.advance(MONTH);
    acts.push(e.takeActions());
    const r = e.town(town)!;
    reports.push(r);
    res.push(r.residents);
    status.push(r.status);
  }
  return { res, acts, status, reports };
}

// As in economy.test.ts: a town fed by buses, a railway and two freight chains, with room to grow.
function servedTown(plots = 3) {
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

// A small office town and a dormitory 6 km off, no road between them, plenty of free plots.
function officeAndDormitory() {
  const k = new Kit()
    .town({ id: 1, x: 0, z: 0, mix: { house: 6 }, centre: { office: 3, shop: 5, civic: 2 }, plots: 30 })
    .town({ id: 2, x: 6000, z: 0, mix: { house: 20, terrace: 6 }, centre: { shop: 4, civic: 2 }, plots: 30 });
  k.stop(5, 'rail_station', 0, 0).stop(6, 'rail_station', 6000, 0);
  return k;
}

// A town short of homes for the jobs a railway brings in, with free plots: it asks to build.
function growingTown() {
  const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED, plots: 3, carShare: 0.3 })
    .town({ id: 2, x: 6000, z: 0, mix: { house: 4 }, centre: { office: 8, shop: 6, civic: 2 }, carShare: 0.3 });
  k.stop(1, 'rail_station', 0, 0).stop(2, 'rail_station', 6000, 0);
  for (const [i, x, z] of [[3, -220, -220], [4, 220, -220], [5, 220, 220], [6, -220, 220]]) k.stop(i, 'bus_stop', x, z);
  return { k, lines: [{ id: 1, stops: [1, 2], vehicle: 'dmu' as const, count: 4 }, { id: 2, stops: [3, 4, 5, 6], vehicle: 'bus' as const, count: 3 }] };
}

// Where two saves differ, ignoring rounding noise (relative 1e-6) and the order of lists by id.
function differences(a: ReturnType<Economy['save']>, b: ReturnType<Economy['save']>) {
  const byId = <T extends { id: number }>(x: T[]) => [...x].sort((p, q) => p.id - q.id);
  const norm = (s: ReturnType<Economy['save']>) => ({ ...s, towns: byId(s.towns), zones: byId(s.zones), buildings: byId(s.buildings), industries: byId(s.industries), stops: byId(s.stops), lines: byId(s.lines) });
  const out: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (typeof x === 'number' && typeof y === 'number') {
      if (Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x), Math.abs(y))) out.push(`${path}: ${x} vs ${y}`);
    } else if (x && y && typeof x === 'object' && typeof y === 'object') {
      const X = x as Record<string, unknown>, Y = y as Record<string, unknown>;
      for (const k of new Set([...Object.keys(X), ...Object.keys(Y)])) walk(X[k], Y[k], `${path}.${k}`);
    } else if (x !== y) out.push(`${path}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  };
  walk(norm(a), norm(b), '');
  return out;
}

const texts = (e: Economy, town = 1) => e.town(town)!.reasons.map((r) => r.text);

// Second review, stability lens: runaway growth, collapse, oscillation, shrinkage that never
// comes, and sensitivity to how the game steps the clock. Each test states the correct
// behaviour and fails today for the reason in the comment above it.
describe('Stability', () => {
  describe('runaway growth', () => {
    // Suspected root cause: econaccess.ts:575 counts every trip out to a job-heavy zone as a
    // visit (V/A), and econdefs.ts:159 asks only 0.25 visits a day per office job, while each
    // commuter brings ~1 a day (2.2 trips a day per resident). So once commuters arrive by rail the
    // office cap (supplyB.office, econtowns.ts:131) never binds: offices open at the full
    // labourSlack+supplySlack (econtowns.ts:150-152, 1.5x the workers who reach them), the
    // dormitory's homes follow the new jobs, and the loop gain is over 1. One 150-seat train at 40%
    // load takes the office town from 360 office jobs to 7,440 and the dormitory from 990 people to
    // 6,459 in three years; the only brake is running out of plots (and towers, for homes).
    it('R2-STAB-1: one train between an office town and a dormitory doesn’t grow them without bound', () => {
      const k = officeAndDormitory();
      const e = new Economy(k.world(), k.oracles(), opts);
      const offices0 = e.town(1)!.uses.office.capacity, dorm0 = e.town(2)!.residents;
      e.setLines([{ id: 1, stops: [5, 6], vehicle: 'dmu', count: 1 }]);
      const run = months(e, 36, 2);
      expect(e.line(1)!.loadFactor).toBeLessThan(0.6); // the train isn't what stops it
      expect(e.town(1)!.uses.office.capacity).toBeLessThan(offices0 * 4);
      expect(run.res[35]).toBeLessThan(dorm0 * 3);
      // and it has levelled off rather than still climbing
      expect(run.res[35]).toBeLessThan(run.res[29] * 1.05);
    });
  });

  describe('service removed', () => {
    // Suspected root cause: jobs are shared out among everyone who can reach them (econaccess.ts
    // reach(), used for pHome at econtowns.ts:106), and the jobs themselves only fade as their
    // supplies decay (supplyAlpha, economy.ts:770) and health falls (economy.ts:738). Cutting the
    // railway removes the neighbour's commuters from the competition at once, so every job in town
    // is suddenly "in reach" of the locals alone: home demand jumps from 1,319 to 1,828 the month
    // service goes, and a town with no buses, no trains and no deliveries grows from 1,468 to 2,627
    // (reading "Growing" for a year) before it starts to decline.
    it('R2-STAB-2: cutting every line doesn’t make a served town boom', () => {
      const { k, lines } = servedTown(5);
      const e = new Economy(k.world(), k.oracles(), opts);
      e.setLines(lines);
      const before = months(e, 30).res[29];
      e.setLines([]);
      const after = months(e, 14);
      expect(Math.max(...after.res)).toBeLessThan(before * 1.05);
      expect(after.status.filter((s) => s === 'growing').length).toBeLessThanOrEqual(1);
    });

    // Suspected root cause: econtowns.ts:203-206 lets `base` (what a town finds for itself) only
    // rise, and it sets the floors: homes at local.homes x base.home (econtowns.ts:142) and 55-60%
    // of base shops/offices/works (supplyB, econtowns.ts:130-132). A town that was fed and grew keeps half
    // its peak for ever with nothing fed to it. The served town started at 752 people, grew to
    // 1,468, and four years after every line is cut settles at 1,870, over three times the 556 the
    // same town reaches when it was never served.
    it('R2-STAB-3: a town that loses all service shrinks back towards where an unserved town settles', () => {
      const never = (() => {
        const { k } = servedTown(5);
        const e = new Economy(k.world(), k.oracles(), opts);
        return months(e, 78).res[77];
      })();
      const { k, lines } = servedTown(5);
      const e = new Economy(k.world(), k.oracles(), opts);
      const start = e.town(1)!.residents;
      e.setLines(lines);
      months(e, 30);
      e.setLines([]);
      const end = months(e, 48).res[47];
      expect(end).toBeLessThan(Math.max(never, start) * 1.5);
    });
  });

  describe('how the game steps the clock', () => {
    // Suspected root cause: the uses of a town compete for the same free plots first come, first
    // served (candidates() reads z.plots - z.reserved for every use, econtowns.ts:307, and
    // decide() runs home, shop, office, works in turn, econtowns.ts:159), with no weighing of which
    // use wants the land most. So how quickly the game answers changes who gets the plots: when the
    // game answers every two months (advance() two months at a time, or construction that takes
    // longer than a month when a month is a game day) offices take 1,440 jobs' worth of plots
    // instead of 1,320 and the homes that would have gone there never do. The same world ends 20%
    // smaller (1,177 people against 1,474; answering every half month gives 1,474 too). Requests
    // don't lapse here: pendingMonths 4 gives the identical result.
    it('R2-STAB-4: a game that answers requests every two months gets the same town as one that answers monthly', () => {
      const grow = (chunk: number) => {
        const { k, lines } = servedTown(3);
        const e = new Economy(k.world(), k.oracles(), { seed: 7 });
        e.setLines(lines);
        const zone = new Map(k.zones.map((z) => [z.id, z]));
        let id = 5_000_000;
        for (let m = 0; m < 24; m += chunk) {
          e.advance(chunk * MONTH);
          // a game that answers every request it's handed
          for (const a of e.takeActions()) {
            if (a.t === 'add') { const z = zone.get(a.zone)!; e.addBuilding({ id: id++, zone: a.zone, x: z.x, z: z.z, kind: a.kind }, a.req); }
            else if (a.t === 'densify') e.updateBuilding(a.building, { kind: a.kind }, a.req);
          }
        }
        return e.town(1)!.residents;
      };
      const monthly = grow(1), bimonthly = grow(2);
      expect(Math.abs(bimonthly - monthly) / monthly).toBeLessThan(0.1);
    });
  });
});

// Second review, exploits lens: ways a player could farm money or town growth. Each test states
// what the model should do and fails where it doesn't; the comment above each gives the cause.
describe('Exploits', () => {
  describe('exploits (review 2)', () => {
    // economy.ts:455-457: an industry's input is clamped to its store (`Math.min(cap, ...)`) but
    // `received`, totals.delivered and (econlines.ts:269) the fare are counted for everything that
    // arrives, so coal beyond what the power station can ever burn is paid for in full and thrown
    // away: four collieries into one power station earn four times one, though it burns only 60 t/h.
    it('R2-EXPL-2: coal a full power station can’t take isn’t paid for', () => {
      const run = (mines: number) => {
        const k = new Kit().industry(10, 'power_station', 8000, 0);
        for (let m = 0; m < mines; m++) k.industry(m + 1, 'coal_mine', 100 * Math.cos(m * 1.6), 100 * Math.sin(m * 1.6));
        k.stop(1, 'lorry_depot', 0, 0).stop(2, 'lorry_depot', 7950, 0);
        const e = new Economy(k.world(), k.oracles(), opts);
        e.setLines([{ id: 1, stops: [1, 2], vehicle: 'hgv', count: 40 }]);
        for (let i = 0; i < 3; i++) e.advance(MONTH);
        return { rev: e.line(1)!.revenueLastMonth, e };
      };
      const one = run(1), four = run(4);
      // one colliery makes 30 t/h, half what the power station burns; four make twice what it burns
      expect(four.rev).toBeLessThan(one.rev * 2.6);
    }, 20_000);

    // economy.ts:458: goods reaching a town's depot are all added to its month (no cap at its
    // need) and paid for (econlines.ts:269), so a whole sawmill's output poured into a village of
    // a few shops is paid in full, though the shops need a tiny fraction of it.
    it('R2-EXPL-3: goods poured into a village far beyond what its shops need aren’t all paid for', () => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, mix: { house: 6 }, centre: { shop: 2 }, grid: 1 });
      k.industry(1, 'forest', 9000, 0).industry(2, 'sawmill', 6000, 0);
      k.stop(3, 'lorry_depot', 9000, 0).stop(1, 'lorry_depot', 6000, 0).stop(2, 'lorry_depot', 0, 0);
      const e = new Economy(k.world(), k.oracles(), opts);
      e.setLines([{ id: 1, stops: [1, 2], vehicle: 'hgv', count: 10 }, { id: 2, stops: [3, 1], vehicle: 'hgv', count: 10 }]);
      for (let i = 0; i < 3; i++) e.advance(MONTH);
      const r = e.town(1)!;
      const need = r.uses.shop.capacity * TUNE.goodsPerShopJobHour * 720; // goods a month its shops can use
      const l = e.line(1)!;
      // pay at most for what's needed (with generous slack), at the line's own rate per crate
      const perCrate = l.revenueLastMonth / Math.max(1, l.carriedLastMonth);
      expect(l.revenueLastMonth).toBeLessThan(perCrate * need * 3);
    }, 20_000);

    // econlines.ts:275-293: a freight line loads whatever waits at a stop for a stop nearer its
    // consumer, and freightArrives() (economy.ts:465-468) drops what doesn't fit in the transfer
    // stop's pool, after the leg was paid. So twenty HGVs feeding a transfer depot with one
    // slow onward lorry are paid for every tonne, most of which vanishes, and the colliery grows on it.
    it('R2-EXPL-4: freight isn’t paid for (and vanishes) when the transfer stop it’s taken to is full', () => {
      // three collieries (90 t/h) by the first depot; the onward lorry manages about 40 t/h
      const k = new Kit().industry(2, 'power_station', 12000, 0);
      for (let m = 0; m < 3; m++) k.industry(m + 10, 'coal_mine', 100 * Math.cos(m * 2), 100 * Math.sin(m * 2));
      k.stop(1, 'lorry_depot', 50, 0).stop(2, 'lorry_depot', 6000, 0).stop(3, 'lorry_depot', 11950, 0);
      const e = new Economy(k.world(), k.oracles(), opts);
      const lines: LineIn[] = [
        { id: 1, stops: [1, 2], vehicle: 'hgv', count: 20 },
        { id: 2, stops: [2, 3], vehicle: 'lorry', count: 1 },
      ];
      e.setLines(lines);
      e.advance(20 * DAY);
      const feeder = e.line(1)!.carried, onward = e.line(2)!.carried;
      // what the feeder brought either went on or is still waiting at the depot (up to 800 t)
      expect(feeder).toBeLessThan(onward + 800 + 50);
    });

    // econlines.ts:166: every leg pays the fixed part (`base * min(1, km / fullKm)`) afresh, and
    // pax reach it in full at 2 km, so a 10 km trip split into five 2 km lines, each changing, pays
    // far more per journey than one line the whole way.
    it('R2-EXPL-5: splitting a route into short lines doesn’t multiply the fare per journey', () => {
      const run = (split: boolean) => {
        const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED }).town({ id: 2, x: 10000, z: 0, ...BALANCED });
        for (let s = 0; s <= 5; s++) k.stop(s + 1, 'bus_stop', s * 2000, 0);
        const e = new Economy(k.world(), k.oracles(), opts);
        const lines: LineIn[] = split
          ? [0, 1, 2, 3, 4].map((s) => ({ id: s + 1, stops: [s + 1, s + 2], vehicle: 'bus', count: 4 }))
          : [{ id: 1, stops: [1, 2, 3, 4, 5, 6], vehicle: 'bus', count: 20 }];
        e.setLines(lines);
        e.advance(MONTH);
        e.advance(10 * DAY);
        const st = e.lineStats();
        const rev = st.reduce((a, l) => a + l.revenue, 0);
        // journeys between the two end towns: those getting off at the far ends
        const ends = (e.stop(1)!.alighted + e.stop(6)!.alighted);
        return { rev, ends, perEnd: rev / Math.max(1, ends) };
      };
      const one = run(false), five = run(true);
      expect(five.perEnd).toBeLessThan(one.perEnd * 1.4);
    }, 20_000);
  });
});

// Review 2, lens: fidelity (against the 2D game in src/sim.ts) and cost. Each test states the
// correct behaviour and fails today for the reason in the comment above it.
describe('Fidelity', () => {
  describe('save and load (review 2)', () => {
    // economy.ts:779/808: the monthly review works out catchments (cover) before the towns change,
    // then builds next month's trip tables from them, so buildings added or abandoned at the review
    // don't count until the next rebuild. Load (economy.ts:967) rebuilds from the post-review
    // buildings, so a game loaded straight after a review runs on different trip tables and
    // drifts from the one that was saved (visitors, boardings, fares differ by 0.1% in the first
    // hour and never come back together).
    it('R2-FID-1: a game loaded straight after a review carries on exactly as the one that was saved', () => {
      const { k, lines } = servedTown();
      const a = new Economy(k.world(), k.oracles(), opts);
      a.setLines(lines);
      for (let m = 0; m < 5; m++) a.advance(MONTH);
      const w = k.world();
      w.lines = lines;
      const b = Economy.load(w, k.oracles(), JSON.parse(JSON.stringify(a.save())), opts);
      a.advance(DAY); b.advance(DAY);
      expect(differences(a.save(), b.save()).slice(0, 5)).toEqual([]);
    });

    // economy.ts:967 (with econlines.ts:122 refresh): loading marks times and service dirty, so the
    // loaded game rebuilds ride times and fares from the dwell of the moment, and the skim and trip
    // tables from the headways of the moment, where the saved game was still running on those
    // worked out at the last day boundary and the last review. Nothing that shapes them is saved.
    it('R2-FID-2: a game loaded mid-month carries on exactly as the one that was saved', () => {
      const { k, lines } = servedTown();
      const a = new Economy(k.world(), k.oracles(), opts);
      a.setLines(lines);
      for (let m = 0; m < 5; m++) a.advance(MONTH);
      a.advance(3 * DAY + 5 * 60);
      const w = k.world();
      w.lines = lines;
      const b = Economy.load(w, k.oracles(), JSON.parse(JSON.stringify(a.save())), opts);
      a.advance(DAY); b.advance(DAY);
      expect(differences(a.save(), b.save()).slice(0, 5)).toEqual([]);
    });

    // economy.ts:128/351/920: the time of day is `clock + time`, but `clock` (the start time) isn't
    // in the save, so a game loaded without restating it runs its rush hours at the wrong time.
    it('R2-FID-3: the time of day survives a save and load', () => {
      const { k, lines } = servedTown();
      const o = { ...opts, clock: 12 * 60 };
      const a = new Economy(k.world(), k.oracles(), o);
      a.setLines(lines);
      a.advance(MONTH + 60);
      const w = k.world();
      w.lines = lines;
      const b = Economy.load(w, k.oracles(), JSON.parse(JSON.stringify(a.save())), opts);
      // the next three hours: any difference is left over from R2-FID-2; running the rush hour
      // twelve hours out is far bigger
      const a0 = a.stop(1)!.boarded, b0 = b.stop(1)!.boarded;
      a.advance(180); b.advance(180);
      const boardedA = a.stop(1)!.boarded - a0, boardedB = b.stop(1)!.boarded - b0;
      expect(boardedA).toBeGreaterThan(1);
      expect(Math.abs(boardedB - boardedA) / boardedA).toBeLessThan(0.05);
    });
  });

  describe('money (review 2)', () => {
    // economy.ts:380-385: fares are emitted per stop per step rounded to the pound, and a stop that
    // took under £1 that step emits nothing before its takings are zeroed, so on a quiet rural
    // line (and at night everywhere) the money events the HUD and the game's bank balance are fed
    // come to several per cent less than `totals.fares`. The 2D game rounds each payment and
    // credits exactly what it shows (sim.ts:455-461).
    it('R2-FID-4: the fare events add up to the fares taken', () => {
      const k = new Kit()
        .town({ id: 1, x: 0, z: 0, grid: 2, mix: { house: 6 }, centre: { shop: 2, civic: 1 } })
        .town({ id: 2, x: 5000, z: 0, grid: 2, mix: { house: 6 }, centre: { shop: 2, office: 1 } });
      for (let i = 0; i < 6; i++) k.stop(i + 1, 'bus_stop', i * 1000, 0);
      k.line(1, [1, 2, 3, 4, 5, 6], 'minibus', 1);
      const e = new Economy(k.world(), k.oracles(), { seed: 1 });
      e.advance(MONTH);
      e.takeEvents();
      const f0 = e.totals.fares;
      let shown = 0;
      for (let d = 0; d < 30; d++) {
        e.advance(DAY);
        for (const x of e.takeEvents()) if (x.t === 'money' && x.kind === 'fare') shown += x.amount;
      }
      const taken = e.totals.fares - f0;
      expect(taken).toBeGreaterThan(1000);
      expect(Math.abs(shown - taken) / taken).toBeLessThan(0.01);
    });
  });

  describe('cost (review 2)', () => {
    // econaccess.ts:81-84 and 153: the skim allocates four S x S arrays and clears a row of S for
    // every origin stop, whether or not the stops are connected. Towns far apart, each with its
    // own buses, never trade trips, yet 4x the towns (and stops) makes the skim about 10x as
    // dear: 600 villages of five stops take ~150 ms and 144 MB per rebuild, and every service
    // change rebuilds it. (`reviewWork` counts only the edges walked, so the work test misses it.)
    it('R2-FID-5: adding far-off towns with their own buses costs in proportion, not the square', () => {
      const skimMs = (N: number) => {
        const k = new Kit();
        let sid = 1;
        for (let t = 0; t < N; t++) {
          const x = (t % 20) * 40000, z = Math.floor(t / 20) * 40000;
          k.town({ id: t + 1, x, z, grid: 1, mix: { house: 3 }, centre: { shop: 1 } });
          const ss: number[] = [];
          for (let i = 0; i < 5; i++) { k.stop(sid, 'bus_stop', x + i * 300 - 600, z); ss.push(sid++); }
          k.line(t + 1, ss, 'bus', 1);
        }
        const e = new Economy(k.world(), k.oracles(), { seed: 1 });
        let best = Infinity;
        for (let r = 0; r < 3; r++) {
          const s0 = e.timing.parts.skim;
          e.networkChanged();
          e.advance(60);
          best = Math.min(best, e.timing.parts.skim - s0);
        }
        return best;
      };
      skimMs(40); // warm up
      const small = skimMs(150), big = skimMs(600);
      console.log(`skim rebuild: ${small.toFixed(1)} ms for 750 stops, ${big.toFixed(1)} ms for 3,000`);
      expect(big / small).toBeLessThan(6);
    }, 30_000);
  });
});

// Second review, integration lens: can the live game feed the economy what it needs and use
// what it hands back, and does the town panel's explanation match what is really going on?
// Each test asserts what the model should do and fails where it doesn't; the comment above each
// gives the suspected cause. (Integration gaps that no unit test can show go in the report.)
describe('Integration', () => {
  describe('integration (review 2)', () => {
    // econtowns.ts:137-139 primes t.supply.visitors with the need of the town as it stands, and
    // report() (econtowns.ts:387-389) prints that smoothed figure as "N passengers a day" arriving,
    // so a town with no stop and no line tells the player 16 passengers a day come to its offices.
    it('R2-INTG-1: a town with no service at all isn’t told passengers are arriving at its offices', () => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED });
      const e = new Economy(k.world(), k.oracles(), opts);
      for (let m = 0; m < 3; m++) {
        e.advance(MONTH);
        expect(texts(e).filter((t) => /[1-9][\d,]* passengers? a day/.test(t))).toEqual([]);
      }
    });

    // econtowns.ts:383 `fed()` only adds "(no goods delivered)" when the smoothed supply, primed at
    // start (econtowns.ts:137-138) and decaying by supplyAlpha a month, falls under 0.01/h: about a
    // year. Until then an unserved town reads "shops only 74% supplied with goods", as if some came.
    it('R2-INTG-2: a town nothing is delivered to says so, not just that it is part supplied', () => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED });
      const e = new Economy(k.world(), k.oracles(), opts);
      for (let m = 0; m < 3; m++) e.advance(MONTH);
      const goods = texts(e).filter((t) => /supplied with goods/.test(t));
      const materials = texts(e).filter((t) => /supplied with building materials/.test(t));
      expect(goods.length + materials.length).toBeGreaterThan(0);
      for (const t of [...goods, ...materials]) expect(t).toMatch(/no (goods|building materials) delivered|none delivered|nothing delivered/);
    });

    // economy.ts:154 (cover) counts a building as covered whatever its use and z.cov is covered
    // capacity over all capacity; econtowns.ts:357 then takes homes near a stop as z.cap.home *
    // z.cov. A 120-job office by the stop makes homes 700 m away read "75% of homes are near a
    // stop". (z.cov also feeds a.cover in zoneArrays, the transit share of the zone's trips.)
    it('R2-INTG-4: "homes near a stop" counts homes, not offices that happen to share their zone', () => {
      const w: WorldIn = {
        towns: [{ id: 1, name: 'Ribbon', x: 0, z: 0 }],
        zones: [{ id: 1, town: 1, x: 350, z: 0, r: 450, plots: 0 }],
        buildings: [
          { id: 1, zone: 1, x: 0, z: 0, kind: 'office' },
          ...Array.from({ length: 10 }, (_, i) => ({ id: 10 + i, zone: 1, x: 700 + (i % 5) * 12, z: (Math.floor(i / 5) - 0.5) * 20, kind: 'house' as const })),
        ],
        stops: [{ id: 1, kind: 'bus_stop', x: 0, z: 0 }, { id: 2, kind: 'bus_stop', x: 4000, z: 0 }],
        lines: [{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }],
      };
      const e = new Economy(w, { travelTime: () => 12, carTime: () => 5 }, opts);
      e.advance(MONTH);
      // every home is 700 m or more from the only stop, beyond a bus stop's 400 m
      expect(e.town(1)!.service.homesNearStop).toBeLessThan(0.1);
    });

    // econtowns.ts:352-397: nothing in facts() or report() looks at the lines' room (LineState.room)
    // or load, so a dormitory whose only bus is full every trip, with reach cut for want of seats,
    // is never told the buses are full: the player sees no reason to add vehicles.
    it('R2-INTG-5: a town held back by a full line is told its buses are full', () => {
      const was = VEHICLES.bus.capacity;
      VEHICLES.bus.capacity = 1;
      try {
        const k = new Kit()
          .town({ id: 1, x: 0, z: 0, mix: { house: 20, terrace: 10 }, centre: { shop: 3, civic: 1 }, carShare: 0.1 })
          .town({ id: 2, x: 5000, z: 0, mix: { house: 2, office: 2 }, centre: { shop: 4, civic: 2 }, carShare: 0.1 });
        k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 5000, 0);
        const e = new Economy(k.world(), k.oracles(), opts);
        e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 6 }]);
        for (let m = 0; m < 4; m++) e.advance(MONTH);
        expect(e.line(1)!.loadFactor).toBeGreaterThan(0.95); // it really is full
        const r = e.town(1)!;
        expect(r.reach.workTransit).toBeLessThan(0.9); // and it holds the town back
        expect([r.headline, ...texts(e)].some((t) => /full|crowd|no room|seats|overcrowd|capacity/i.test(t))).toBe(true);
      } finally { VEHICLES.bus.capacity = was; }
    });

    // economy.ts:386-389: fares under £1 at a stop in a step are dropped from the money events (st.fare
    // is zeroed whether or not it was emitted) and every amount is rounded, though totals.fares and
    // the line's revenue keep them. A HUD balance summed from events (shell.setMoney) drifts from the
    // lines' own books: a village minibus route earns in pennies an hour and shows almost nothing.
    it('R2-INTG-6: money events add up to what the lines earned and cost', () => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, mix: { house: 4 }, centre: { shop: 1, civic: 1 }, grid: 2 })
        .town({ id: 2, x: 2500, z: 0, mix: { house: 4 }, centre: { shop: 1, office: 1 }, grid: 2 });
      k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 2500, 0);
      const e = new Economy(k.world(), k.oracles(), opts);
      e.setLines([{ id: 1, stops: [1, 2], vehicle: 'minibus', count: 1 }]);
      const ev: EconEvent[] = [];
      const f0 = e.totals.fares, r0 = e.totals.running;
      for (let d = 0; d < 20; d++) { e.advance(DAY); ev.push(...e.takeEvents()); }
      const fares = ev.reduce((s, x) => s + (x.t === 'money' && x.kind === 'fare' ? x.amount : 0), 0);
      const running = -ev.reduce((s, x) => s + (x.t === 'money' && x.kind === 'running' ? x.amount : 0), 0);
      const bookFares = e.totals.fares - f0, bookRunning = e.totals.running - r0;
      expect(bookFares).toBeGreaterThan(20); // it does earn something
      expect(Math.abs(fares - bookFares)).toBeLessThan(0.01 * bookFares + 2);
      expect(Math.abs(running - bookRunning)).toBeLessThan(0.01 * bookRunning + 2);
    });

    // economy.ts:176 setZone overwrites `blocked: 0` on every update. The live game will re-send a
    // zone whenever its plot queue changes (docs/ENGINE.md "Plugging it in" 1), so a zone the game
    // just declined is asked again at once, instead of resting restMonths.
    it('R2-INTG-7: re-sending an unchanged zone doesn’t lift the rest after a declined request', () => {
      const run = (resend: boolean) => {
        const { k, lines } = growingTown();
        const w = k.world();
        const e = new Economy(w, k.oracles(), { seed: 7 });
        e.setLines(lines);
        let asked = 0, months = 0;
        for (let m = 0; m < 10; m++) {
          e.advance(MONTH);
          const adds = e.takeActions().filter((a): a is Extract<Action, { t: 'add' }> => a.t === 'add');
          if (adds.length) months++;
          asked += adds.length;
          for (const a of adds) e.decline(a.req);
          if (resend) for (const z of w.zones) e.setZone(z);
        }
        return { asked, months };
      };
      const quiet = run(false), resent = run(true);
      expect(quiet.asked).toBeGreaterThan(0); // it does want to build
      expect(resent.asked).toBeLessThanOrEqual(quiet.asked);
    });

    // economy.ts:198-203 reindexZones() renumbers every zone by id when one is added, but
    // lastReach (economy.ts:366) keeps the arrays of the last review, which zoneReach()
    // (economy.ts:473-478) reads by the new index: a demand overlay shows another zone's figures
    // until the next review. Live zone ids (a street `row`, roads.ts:590) are hashes, not in order.
    it('R2-INTG-8: adding a zone mid-month doesn’t shift the reach overlay of the others', () => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED, carShare: 0.3 }).town({ id: 2, x: 9000, z: 0, mix: { house: 30 }, carShare: 0.3 });
      k.stop(1, 'bus_stop', 0, 0).stop(2, 'bus_stop', 9000, 0);
      const e = new Economy(k.world(), k.oracles(), opts);
      e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }]);
      e.advance(MONTH);
      const ids = k.zones.map((z) => z.id);
      const before = ids.map((id) => e.zoneReach(id));
      e.setZone({ id: 5, town: 1, x: 300, z: 300, r: 100, plots: 2 }); // a new street on the edge of town 1
      const after = ids.map((id) => e.zoneReach(id));
      expect(after).toEqual(before);
    });

    // econtowns.ts:155: a use's smoothed demand starts from its capacity only on the constructor's
    // `assess` review; a town added later (the map streaming in a town, the player founding one)
    // starts from 0, so its first reviews see half the demand, t.health halves its jobs
    // (economy.ts:319) and reach with them ("only 49% of workers can get to a job"), and people leave.
    it('R2-INTG-10: a town added mid-game starts as the same town would have at the start', () => {
      const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED }).town({ id: 2, x: 9000, z: 0, ...BALANCED });
      const w = k.world(), of2 = (zone: number) => Math.floor(zone / 1000) === 2;
      const a = new Economy(k.world(), k.oracles(), opts);
      const b = new Economy({ ...w, towns: w.towns.filter((t) => t.id === 1), zones: w.zones.filter((z) => z.town === 1), buildings: w.buildings.filter((x) => !of2(x.zone)) }, k.oracles(), opts);
      a.advance(MONTH); b.advance(MONTH);
      b.setTown(w.towns[1]);
      for (const z of w.zones.filter((z) => z.town === 2)) b.setZone(z);
      for (const x of w.buildings.filter((x) => of2(x.zone))) b.addBuilding(x);
      for (let m = 0; m < 2; m++) {
        a.advance(MONTH); b.advance(MONTH);
        expect(b.town(2)!.residents).toBeGreaterThan(a.town(2)!.residents * 0.98);
        expect(b.town(2)!.reach.work).toBeGreaterThan(a.town(2)!.reach.work - 0.05);
      }
    });
  });
});

// Second review, lens "were the 15 original findings fixed at the root?". Each test is a variant
// of an original finding (economy.review.test.ts) with different numbers or geometry, states the
// correct behaviour, and fails today for the reason in the comment above it.
describe('Original-15 variants', () => {
  describe('variants of the original findings', () => {
    // Original "two lines on the same stops share the passengers". Root cause remains at
    // econaccess.ts:86-123 + 150-183 + 350-378: lines are only pooled (combined frequency, shares
    // by headway) when they run between the *same two stop ids*; everything else is still one best
    // path per zone pair (strict `<` in Pairs and in the skim's Dijkstra). Two parallel lines whose
    // poles stand 5 m apart (each route with its own stop, the usual case in the game) are
    // all-or-nothing: the one with 4 buses takes every rider (~3,100 a week) and the one with 2
    // carries none, where on shared stop ids the 2-bus line does get its share.
    it('R2-ORIG-3a: two parallel lines from neighbouring stops share the passengers', () => {
      const run = (apart: boolean) => {
        const k = new Kit().town({ id: 1, x: 0, z: 0, ...BALANCED }).town({ id: 2, x: 4000, z: 0, ...BALANCED });
        k.stop(1, 'bus_stop', 300, 0).stop(2, 'bus_stop', 3700, 0).stop(4, 'bus_stop', 300, 5).stop(5, 'bus_stop', 3700, 5);
        const e = new Economy(k.world(), k.oracles(), opts);
        e.setLines([{ id: 1, stops: [1, 2], vehicle: 'bus', count: 2 }, { id: 2, stops: apart ? [4, 5] : [1, 2], vehicle: 'bus', count: 4 }]);
        e.advance(7 * DAY);
        return { a: e.line(1)!.carried, b: e.line(2)!.carried };
      };
      const shared = run(false), apart = run(true);
      // control: on the same stop ids the slower-frequency line does get its share
      expect(shared.a).toBeGreaterThan(shared.b * 0.25);
      expect(apart.b).toBeGreaterThan(1000);
      expect(apart.a).toBeGreaterThan(apart.b * 0.25);
    });

    // Original "a served town without free plots doesn't fall and then climb back". The fix
    // (econtowns.ts:30-36, 305-311; economy.ts:494 demolish -> z.cleared[b.use]++) stops the climb
    // back by reserving a cleared plot for the use it was cleared of, for ever, rather than
    // removing the cause (homes emptied because offices that are wanted can't be built). In the
    // same world the town now falls from 2,910 to 1,568 and stays there: offices are wanted (540
    // against 360, visitors 2.6x what they need), 168 cleared plots stand empty, and nothing is
    // ever built on them because they're earmarked for the homes nobody wants. The panel reads
    // "Stable" with "168 plots free". (Give the same town one free plot per zone and it builds
    // offices and ends at 2,636.)
    it('R2-ORIG-9a: a served town doesn’t sit half empty beside vacant land its wanted offices may not use', () => {
      const k = new Kit()
        .town({ id: 2, x: 4600, z: 0, grid: 3, mix: { house: 14, flats: 1 }, centre: { shop: 7, office: 1 }, plots: 1, carShare: 0.34 })
        .town({ id: 3, x: 12600, z: 0, grid: 4, mix: { house: 22, terrace: 2, flats: 2 }, centre: { shop: 4, office: 3, civic: 2 }, edge: { industry: 1 }, plots: 0, carShare: 0.3 });
      k.stop(2, 'rail_station', 4600, 0).stop(3, 'rail_station', 12600, 0);
      const e = new Economy(k.world(), k.oracles(), opts);
      const offices0 = e.town(3)!.uses.office.capacity;
      e.setLines([{ id: 2, stops: [2, 3], vehicle: 'dmu', count: 4 }]);
      const { reports } = months(e, 36, 3);
      const last = reports[35];
      // the deadlock: offices wanted well beyond what stands, land free, and nothing built for a year
      const deadlocked = (r: typeof last) => r.uses.office.demand > r.uses.office.capacity * 1.3 && r.service.plots > 0;
      expect(reports.slice(-12).every(deadlocked)).toBe(false);
      expect(last.uses.office.capacity).toBeGreaterThan(offices0);
    });
  });
});
