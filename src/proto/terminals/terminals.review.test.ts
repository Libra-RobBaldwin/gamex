// Adversarial review of the terminals rules: exploits, unlocking, capacity, dwell times, eras and
// balance against the 2D game and the chains analysis. Each test says what ought to hold, so a
// failing one is a finding; the passing ones are the attacks that didn't get through.
import { describe, expect, it } from 'vitest';
import { INDUSTRIES, STATIONS, VEHICLES, type IndustryKind } from '../../defs';
import { INDUSTRY_IDS, INDUSTRY_TYPES, type IndustryType } from '../industries/catalogue';
import { FITS, LADDER, MODES, REFERENCE_LOAD, SIM_SECONDS_PER_HOUR, TIERS, TIER_IDS, inEra, tierCost, type FitId, type Mode, type TierId } from './catalogue';
import {
  REMOVE_REFUND, apply, dwellFactor, estimateFlows, levelsAt, offers, outAt, review, shareOutput, specFor, startingTerminals, terminalFor, tick,
  type SiteContext, type SiteFlows, type SiteSpec, type SiteTerminals, type Terminal,
} from './rules';

const open = (mode: Mode, tier: TierId, fit: FitId = 'standard', extra: Partial<Terminal> = {}): Terminal => ({ mode, tier, fit, status: 'open', ready: 0, idle: 0, ...extra });
const withT = (grade: 1 | 2 | 3, ...terminals: Terminal[]): SiteTerminals => ({ grade, terminals });
const CTX: SiteContext = { year: 1975, rail: true };
const colliery = specFor('coal_mine');
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(`refused: ${(r as unknown as { reason: string }).reason}`); return r as Extract<T, { ok: true }>; };
// the 2D game's stop time (src/sim.ts LOAD_TIME, not exported): every vehicle, any load
const LOAD_TIME_2D = 2;
// the 2D review: x1.12 a minute from level 1 to 4
const GROWTH_REVIEWS = Math.ceil(Math.log(4) / Math.log(1.12));

describe('exploits: money', () => {
  it('never pays out more than was put in, whatever is built, upgraded, refitted and demolished', () => {
    // the attack that didn't get through: every build-then-demolish and upgrade-then-demolish
    for (const mode of MODES) for (const tier of LADDER[mode]) for (const fit of TIERS[tier].fits) {
      const spec = specFor(mode === 'water' ? 'steelworks' : 'coal_mine');
      const ctx = { ...CTX, year: 2000, water: true };
      let st = withT(3), spent = 0;
      const b = ok(apply(spec, st, ctx, { kind: 'build', mode, tier, fit }));
      spent += b.cost; st = tick(spec, b.st, 0, {}, 10000).st;
      for (const up of LADDER[mode].filter((t) => TIERS[t].rank > TIERS[tier].rank)) {
        const u = ok(apply(spec, st, ctx, { kind: 'build', mode, tier: up }));
        spent += u.cost; st = tick(spec, u.st, 0, {}, 10000).st;
      }
      const r = ok(apply(spec, st, ctx, { kind: 'remove', mode }));
      expect(spent + r.cost, `${tier} ${fit}`).toBeGreaterThan(0);
    }
  });

  it('refunds some of an upgrade that is demolished before it opens, as it would once open', () => {
    // a rail freight terminal (£40,000) upgrading to a marshalling yard (£120,000 after trade-in),
    // demolished the next day: the refund is 25% of the old terminal only, and the £120,000 vanishes
    const st0 = withT(3, open('rail', 'rail_terminal'));
    const up = ok(apply(colliery, st0, CTX, { kind: 'build', mode: 'rail', tier: 'marshalling_yard', fit: 'standard' }));
    const rm = ok(apply(colliery, up.st, { ...CTX, day: 1 }, { kind: 'remove', mode: 'rail' }));
    const paid = tierCost('rail_terminal') + up.cost;
    expect(-rm.cost, 'refund on demolishing an upgrade under way').toBeGreaterThanOrEqual(REMOVE_REFUND * paid - 1);
  });

  it("doesn't discount the docks' first bigger terminal by half the price of a quay they got free", () => {
    const docks = specFor('port');
    const o = offers(docks, { ...startingTerminals('port'), grade: 3 }, { ...CTX, year: 1980 }).find((x) => x.tier === 'port_terminal')!;
    expect(o.status).toBe('available');
    expect(o.cost, 'port terminal price at the docks').toBe(tierCost('port_terminal', o.fit));
  });
});

describe('exploits: stacking and ownership', () => {
  it('never ends up with two terminals in one mode, however many are ordered', () => {
    const ctx = { ...CTX, year: 2000, water: true };
    let st = withT(3);
    const steel = specFor('steelworks');
    for (let round = 0; round < 3; round++) for (const tier of TIER_IDS) {
      const r = apply(steel, st, { ...ctx, day: round * 1000 }, { kind: 'build', mode: TIERS[tier].mode, tier });
      if (r.ok) st = tick(steel, r.st, 0, {}, round * 1000 + 999).st;
    }
    for (const mode of MODES) expect(st.terminals.filter((t) => t.mode === mode).length, mode).toBeLessThanOrEqual(1);
  });

  it("lets only the docks' own quay escape demolition and cut-backs, not a terminal the player bought there", () => {
    const docks = specFor('port'), ctx = { ...CTX, year: 1980 };
    const up = ok(apply(docks, { ...startingTerminals('port'), grade: 3 }, ctx, { kind: 'build', mode: 'water', tier: 'port_terminal', fit: 'grab_cranes' }));
    const st = tick(docks, up.st, 0, {}, 1000).st;
    expect(terminalFor(st, 'water')!.tier).toBe('port_terminal');
    // the bought terminal inherits builtIn from the quay: it can't be demolished...
    expect(apply(docks, st, ctx, { kind: 'remove', mode: 'water' }).ok, 'demolish a bought port terminal').toBe(true);
    // ...and left idle for two years it is never cut back, costing a fifth of £2,800 a day for ever
    let idle = st;
    for (let d = 0; d < 800; d += 10) idle = tick(docks, idle, 10, {}, 1000 + d).st;
    expect(terminalFor(idle, 'water')!.tier, 'an abandoned port terminal after two years').not.toBe('port_terminal');
  });
});

describe('exploits: idle and closure', () => {
  it('never throws away an upgrade the player paid for when a mothballed terminal is cut back', () => {
    // a mothballed rail freight terminal nearly a year idle; the player orders a marshalling yard
    const st0 = withT(3, open('rail', 'rail_terminal', 'standard', { status: 'mothballed', idle: 350, warned: true }));
    const up = ok(apply(colliery, st0, { ...CTX, day: 0 }, { kind: 'build', mode: 'rail', tier: 'marshalling_yard', fit: 'standard' }));
    expect(up.cost).toBe(120000);
    const t = tick(colliery, up.st, 20, {}, 20); // 20 days on: the yard is still 40 days from opening
    const rail = terminalFor(t.st, 'rail')!;
    expect(rail.pending?.tier ?? rail.tier, 'what the player will get for £120,000').toBe('marshalling_yard');
  });
});

describe('unlocking', () => {
  it('only counts a terminal of the current rank that has worked, not one still being built or mothballed', () => {
    // growth capped by the loading bay; a rail freight terminal ordered but not yet open
    const capped: SiteFlows = { produced: 66, moved: 50, stockFill: 0.95, queue: { road: 1 } };
    const building = withT(2, open('road', 'loading_bay'), { mode: 'rail', tier: 'rail_terminal', fit: 'standard', status: 'building', ready: 30, idle: 0 });
    expect(review(colliery, building, CTX, 1, capped).st.grade, 'grade with the rank-2 terminal still being built').toBe(2);
    const mothballed = withT(2, open('road', 'loading_bay'), open('rail', 'rail_terminal', 'standard', { status: 'mothballed', idle: 120 }));
    expect(review(colliery, mothballed, CTX, 1, capped).st.grade, 'grade with the rank-2 terminal mothballed').toBe(2);
  });

  it('never opens a bigger rank at a site no vehicle calls at', () => {
    // estimateFlows with nothing lifting reports lorries queueing, so the review presses
    const st = withT(1, open('road', 'loading_bay'));
    const f = estimateFlows(colliery, st, 1, { lift: 0 });
    expect(f.moved).toBe(0);
    expect(f.queue?.road ?? 0, 'lorries queueing at a colliery no lorry calls at').toBeLessThan(0.5);
    expect(f.served?.road, 'served, with nothing lifting').toBe(false);
    expect(review(colliery, st, CTX, 1, f).st.grade).toBe(1);
  });

  it("can't be walked up to a rank-3 terminal without a single vehicle ever calling", () => {
    const ctx = { ...CTX, year: 1980 };
    let st = ok(apply(colliery, withT(1), ctx, { kind: 'build', mode: 'road', tier: 'loading_bay', fit: 'standard' })).st;
    st = tick(colliery, st, 0, {}, 10).st;
    st = review(colliery, st, ctx, 1, estimateFlows(colliery, st, 1, { lift: 0 })).st; // grade 2
    st = ok(apply(colliery, st, { ...ctx, day: 11 }, { kind: 'build', mode: 'rail', tier: 'rail_terminal' })).st; // still building
    st = review(colliery, st, ctx, 1, estimateFlows(colliery, st, 1, { lift: 0 })).st; // grade 3
    const top = offers(colliery, st, ctx).find((o) => o.tier === 'road_terminal')!;
    expect(top.status, 'road freight terminal at a colliery nobody has ever served').toBe('locked');
  });

  it('never reports vehicles queueing at a power station nobody delivers to', () => {
    const ps = specFor('power_station'), st = withT(1, open('road', 'loading_bay', 'conveyor'));
    const f = estimateFlows(ps, st, 1, { supply: 0 });
    expect(f.unloaded).toBe(0);
    expect(f.queue?.road ?? 0, 'lorries queueing to unload nothing').toBeLessThan(0.5);
    expect(review(ps, st, CTX, 1, f).unlocked, 'tiers unlocked with no coal delivered').toEqual([]);
  });

  it('presses at a sink whose berths are saturated, as it does at a primary', () => {
    // a power station's loading bay (80 t/h) unloading 78 t/h, a third of a vehicle waiting on
    // average: it can never be "capped" (it would need 144 t/h, 60% of its level-1 intake, through
    // an 80 t/h bay), and it has no output store to fill, so it never presses
    const ps = specFor('power_station'), st = withT(1, open('road', 'loading_bay', 'conveyor'));
    const sink = review(ps, st, CTX, 1, { produced: 0, moved: 0, arrived: 78, unloaded: 78, stockFill: 0, queue: { road: 0.3 } });
    const prim = review(colliery, withT(1, open('road', 'loading_bay', 'conveyor')), CTX, 1, { produced: 90, moved: 78, stockFill: 0.95, queue: { road: 0.3 } });
    expect(prim.pressure.pressing).toBe(true);
    expect(sink.pressure.utilisation).toBeGreaterThan(0.95);
    expect(sink.pressure.pressing, 'power station unloading at 97% of its bay').toBe(true);
  });

  it('announces only tiers the site could buy: no rail freight terminal without a rail line', () => {
    const flows: SiteFlows = { produced: 66, moved: 50, stockFill: 0.95, queue: { road: 1 } };
    const r = review(colliery, withT(1, open('road', 'loading_bay')), { ...CTX, rail: false }, 1, flows);
    expect(r.st.grade).toBe(2);
    expect(r.events[0]?.text ?? '', 'the unlock news').not.toContain('rail freight terminal');
  });
});

describe('capacity: no growth without transport', () => {
  it("holds growth to what's actually moved: an open terminal no vehicle can reach adds nothing", () => {
    // lorries through a conveyor loading bay (80 t/h) are the only transport: the marshalling
    // yard has no rail line and no train calls. Honest flows: never more than 80 t/h moved.
    const st = withT(3, open('road', 'loading_bay', 'conveyor'), open('rail', 'marshalling_yard', 'rapid_loader'));
    const bay = levelsAt(colliery, st.terminals[0]);
    let level = 1;
    for (let i = 0; i < 40; i++) {
      const produced = outAt(colliery, level), moved = Math.min(produced, 80);
      const flows: SiteFlows = { produced, moved, stockFill: produced > moved ? 0.95 : 0.4, queue: { road: produced > moved ? 1 : 0, rail: 0 }, served: { road: true, rail: false } };
      level = review(colliery, st, { ...CTX, rail: false }, level, flows).level;
    }
    expect(level, `level with only ${bay.toFixed(2)} levels of it moveable`).toBeLessThanOrEqual(bay * 1.12 + 1e-6);
  });

  it("brings production back down towards what the terminals can move once they're gone", () => {
    // a level-4 colliery whose marshalling yard was demolished, left with a standard loading bay
    // moving 50 of its 264 t/h (19%, above the 15% at which the 2D rule lets it fall)
    const st = withT(3, open('road', 'loading_bay'));
    let level = 4;
    for (let i = 0; i < 60; i++) level = review(colliery, st, CTX, level, { produced: outAt(colliery, level), moved: 50, stockFill: 1, queue: { road: 2 } }).level;
    expect(level, 'level after 60 reviews on a loading bay').toBeLessThan(2);
  });

  it('sends what one terminal can’t take to another with vehicles and berths to spare', () => {
    // 500 t/h of coal; a few lorries at the road terminal (20 t/h), trains queueing for more at a
    // marshalling yard with 3,500 t/h of berths: nothing should be left in the stockyard
    const st = withT(3, open('road', 'road_terminal', 'conveyor'), open('rail', 'marshalling_yard', 'rapid_loader'));
    const r = shareOutput(st, { coal: 500 }, { road: 20, rail: 10000 });
    expect(r.byMode.road?.coal).toBeCloseTo(20, 6);
    expect(r.left.coal ?? 0, 't/h of coal stranded in the stockyard').toBeLessThan(1);
  });
});

describe('dwell times against the 2D clock', () => {
  it('puts a factor on LOAD_TIME that gives the throughput the berths are rated at', () => {
    // dwellFactor is documented as "the factor to put on the 2D game's LOAD_TIME". A berth that
    // turns a reference vehicle round in LOAD_TIME x factor seconds moves this many t/h:
    const bad: string[] = [];
    for (const tier of TIER_IDS.filter((t) => TIERS[t].mode !== 'water')) {
      const T = TIERS[tier], h = { tier, fit: 'standard' as FitId };
      const implied = REFERENCE_LOAD[T.mode] / ((LOAD_TIME_2D * dwellFactor(h, 'coal')) / SIM_SECONDS_PER_HOUR);
      const rated = T.perBerth;
      if (implied > rated * 2 || implied < rated / 2) bad.push(`${tier}: ${Math.round(implied)} t/h a berth by LOAD_TIME, ${rated} rated`);
    }
    expect(bad).toEqual([]);
  });

  it('keeps the slow handling of liquids in drums in the stop-time factor', () => {
    // at a standard loading bay a 20 kl tanker takes 2.4 h and a 20 t coal lorry 0.95 h, but both
    // get a factor of 1, so on the 2D clock they stand the same 2 seconds
    const bay = { tier: 'loading_bay' as TierId, fit: 'standard' as FitId };
    expect(dwellFactor(bay, 'fuel'), 'fuel at a standard bay, against coal').toBeGreaterThan(dwellFactor(bay, 'coal') * 1.5);
  });
});

describe('proportion with the 2D game', () => {
  it("moves a level-1 site of every 2D industry through the 2D station it had", () => {
    // the starters keep the 2D stations' cost and cap "so the economy can port over", but not
    // their throughput: in the 2D game one loading bay with lorries takes a colliery to level 4
    const as2D: Record<string, TierId> = { loading_bay: 'loading_bay', lorry_depot: 'lorry_depot', rail: 'sidings' };
    const short: string[] = [];
    for (const id of Object.keys(INDUSTRIES) as IndustryKind[]) for (const [kind, tier] of Object.entries(as2D)) {
      const lv = levelsAt(specFor(id), { tier, fit: 'standard' });
      if (lv < 1) short.push(`${id} at a 2D ${STATIONS[kind as keyof typeof STATIONS].name.toLowerCase()}: ${lv.toFixed(2)}`);
    }
    expect(short).toEqual([]);
  });

  it('opens a starter terminal before a site could have grown to full production', () => {
    // docs: a review each game hour (the 2D minute); the 2D rule takes a site from 1 to 4 in 13
    // reviews. Build and idle times are in game days, 24 reviews each.
    const slow = LADDER.road.concat(LADDER.rail, LADDER.water).filter((t) => TIERS[t].rank === 1 && TIERS[t].buildDays * 24 > GROWTH_REVIEWS)
      .map((t) => `${t}: ${TIERS[t].buildDays * 24} reviews`);
    expect(slow).toEqual([]);
  });

  it('keeps upkeep a real cost beside the vehicles that use a terminal', () => {
    // 2D running costs are per minute, a game hour here, so per game day x24. The idle rules warn
    // "costs £40 a day" about a loading bay whose single lorry costs £7,200 a day to run.
    const vehicle: Record<'road' | 'rail', number> = { road: VEHICLES.truck.running * 24, rail: VEHICLES.freight.running * 24 };
    const cheap = TIER_IDS.filter((t) => TIERS[t].mode !== 'water').map((t) => ({ t, share: TIERS[t].upkeep / vehicle[TIERS[t].mode as 'road' | 'rail'] }))
      .filter((x) => x.share < 0.01).map((x) => `${x.t}: ${(x.share * 100).toFixed(2)}% of one vehicle`);
    expect(cheap).toEqual([]);
  });
});

describe('eras', () => {
  it('never offers a tier or a fit before its time', () => {
    for (const id of INDUSTRY_IDS) for (let year = 1800; year <= 2050; year += 5) {
      for (const o of offers(specFor(id), withT(3), { year, rail: true, water: true })) {
        if (o.status !== 'available') continue;
        expect(inEra(TIERS[o.tier].era, year), `${id} ${o.tier} ${year}`).toBe(true);
        expect(inEra(FITS[o.fit].era, year), `${id} ${o.fit} ${year}`).toBe(true);
      }
    }
  });

  it('lets every industry take a level-1 supply with the terminals of its first years', () => {
    // the best in-era tier and fit per mode, all modes together, grade 3, a rail line, no water
    // unless the type needs it. Before 1830 there is only the standard loading bay; a Bessemer
    // steelworks (1850) waits for rail freight terminals (1870) or conveyors (1880).
    const stuck: string[] = [];
    for (const id of INDUSTRY_IDS) {
      const t = INDUSTRY_TYPES[id], spec = specFor(id);
      const modes = spec.modes.filter((m) => m !== 'water' || t.waterside === 'required');
      const years: number[] = [];
      let worst = Infinity;
      for (let year = t.era[0]; year < t.era[0] + 100; year++) {
        const best = modes.map((m) => Math.max(0, ...LADDER[m].filter((tier) => inEra(TIERS[tier].era, year))
          .flatMap((tier) => TIERS[tier].fits.filter((f) => inEra(FITS[f].era, year)).map((fit) => levelsAt(spec, { tier, fit })))));
        const total = best.reduce((a, b) => a + b, 0);
        if (total < 1) { years.push(year); worst = Math.min(worst, total); }
      }
      if (years.length) stuck.push(`${id} ${years[0]}-${years[years.length - 1]}: ${worst.toFixed(2)} of level 1`);
    }
    expect(stuck).toEqual([]);
  });
});

describe('consistency with the chains analysis', () => {
  // The chains branch gives the docks' trades their own years: iron ore imports from 1850, crude
  // from 1920, coal exported until 1984 and imported from 1985. A docks type written that way:
  const P = INDUSTRY_TYPES.port;
  const docksWithYears = {
    ...P,
    inputs: [{ cargo: 'steel', amount: 1 }, { cargo: 'goods', amount: 1 }, { cargo: 'coal', amount: 1, era: [1800, 1984] }],
    outputs: [{ cargo: 'iron_ore', amount: 1, era: [1850, null] }, { cargo: 'oil', amount: 1, era: [1920, null] }, { cargo: 'coal', amount: 1, era: [1985, null] }],
  } as unknown as IndustryType;
  const specIn = specFor as unknown as (t: IndustryType, v: undefined, year: number) => SiteSpec;

  it("sizes the docks' terminals on the trades that run that year", () => {
    const early = specIn(docksWithYears, undefined, 1820), late = specIn(docksWithYears, undefined, 2000);
    expect(early.out.oil ?? 0, 'crude imported in 1820').toBe(0);
    expect(early.out.iron_ore ?? 0, 'iron ore imported in 1820').toBe(0);
    expect((late.in.coal ?? 0) * (late.out.coal ?? 0), 'coal both exported and imported in 2000').toBe(0);
  });
});
