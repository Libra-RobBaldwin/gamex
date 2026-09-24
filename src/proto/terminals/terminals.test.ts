import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STATIONS } from '../../defs';
import { CARGO, INDUSTRY_IDS, INDUSTRY_TYPES, type CargoId, type IndustryId } from '../industries/catalogue';
import { IndustryFx } from '../industries/fx';
import { buildIndustry, defaultPlot, type IndustryModel } from '../industries/models';
import {
  CARGO_CLASS, FITS, LADDER, LOAD_TIME_2D, MODES, MODE_OF, SIM_SECONDS_PER_HOUR, TIERS, TIER_IDS, inEra, suitOf, throughput, tierCost, type FitId, type Mode, type TierId,
} from './catalogue';
import { bounds, overlaps, place, roomCheck, waterline, type Box } from './layout';
import { buildTerminals, fxModel } from './models';
import {
  IDLE_CUT_DAYS, IDLE_MOTHBALL_DAYS, IDLE_WARN_DAYS, MOTHBALL_UPKEEP, REMOVE_REFUND, apply, berthRate, capacity, dwellFactor, dwellHours, estimateFlows,
  levelCap, levelsAt, offers, outAt, report, review, shareOutput, shownFor, specFor, startingTerminals, suggest, terminalFor, tick, townSpec,
  type SiteContext, type SiteFlows, type SiteTerminals, type Terminal,
} from './rules';

const open = (mode: Mode, tier: TierId, fit: FitId = 'standard', extra: Partial<Terminal> = {}): Terminal => ({ mode, tier, fit, status: 'open', ready: 0, idle: 0, ...extra });
const withT = (grade: 1 | 2 | 3, ...terminals: Terminal[]): SiteTerminals => ({ grade, terminals });
const CTX: SiteContext = { year: 1975, rail: true };
const colliery = specFor('coal_mine');
// a big works: every rank of every ladder is worth having here, where a colliery stops at rank 2
const steel = specFor('steelworks');
const flows = (f: Partial<SiteFlows>): SiteFlows => ({ produced: 66, moved: 66, stockFill: 0.5, ...f });
const bare = new Map<IndustryId, IndustryModel>(INDUSTRY_IDS.map((id) => [id, buildIndustry(id, defaultPlot(id), { seed: 1, bare: true })]));
// modes a site can use, with water for the waterside-optional ones
const usable = (id: IndustryId) => [...new Set(INDUSTRY_TYPES[id].serve.map((k) => MODE_OF[k]))];

describe('catalogue', () => {
  it('has three ranks per mode that grow in every way that matters', () => {
    for (const mode of MODES) {
      const [a, b, c] = LADDER[mode].map((id) => TIERS[id]);
      expect([a.rank, b.rank, c.rank]).toEqual([1, 2, 3]);
      for (const [p, q] of [[a, b], [b, c]]) {
        expect(q.cost, q.id).toBeGreaterThan(p.cost);
        expect(q.upkeep, q.id).toBeGreaterThan(p.upkeep);
        expect(throughput(q.id), q.id).toBeGreaterThan(throughput(p.id) * 2);
        expect(q.berths, q.id).toBeGreaterThan(p.berths);
        expect(q.stock, q.id).toBeGreaterThan(p.stock);
        expect(q.catchment, q.id).toBeGreaterThan(p.catchment);
        expect(q.manoeuvre, q.id).toBeLessThan(p.manoeuvre);
        expect(q.buildDays, q.id).toBeGreaterThan(p.buildDays);
        expect(q.era[0], q.id).toBeGreaterThanOrEqual(p.era[0]);
        expect(q.mode).toBe(mode);
      }
    }
  });

  it('starts where the 2D stations left off, so the economy can port over', () => {
    for (const id of TIER_IDS) {
      const T = TIERS[id], k = T.station2D;
      if (!k) continue;
      expect(T.stock, id).toBe(STATIONS[k].cap);
      expect(T.cost, id).toBe(STATIONS[k].cost);
    }
    expect(TIERS.loading_bay.station2D).toBe('loading_bay');
    expect(TIERS.sidings.station2D).toBe('rail');
  });

  it('gives every cargo a class, and every fit suits one class better than standard without ruling any out', () => {
    for (const c of Object.keys(CARGO) as CargoId[]) expect(CARGO_CLASS[c], c).toBeDefined();
    expect(['oil', 'fuel', 'chemicals'].every((c) => CARGO_CLASS[c as CargoId] === 'liquid')).toBe(true);
    expect(['coal', 'iron_ore', 'stone'].every((c) => CARGO_CLASS[c as CargoId] === 'bulk')).toBe(true);
    for (const f of Object.values(FITS)) {
      for (const cls of ['bulk', 'general', 'liquid'] as const) expect(suitOf(f.id, cls), `${f.id} ${cls}`).toBeGreaterThan(0.2);
      if (f.id === 'standard') continue;
      const better = (['bulk', 'general', 'liquid'] as const).filter((cls) => suitOf(f.id, cls) > suitOf('standard', cls));
      expect(better.length, f.id).toBe(1);
      expect(f.dwell, f.id).toBeLessThan(1);
    }
    for (const T of Object.values(TIERS)) { expect(T.fits[0]).toBe('standard'); for (const f of T.fits) expect(FITS[f], `${T.id} ${f}`).toBeDefined(); }
    // conveyors for coal and ore, a tank farm for oil and fuel, as the brief says
    expect(suitOf('conveyor', CARGO_CLASS.coal)).toBeGreaterThan(1);
    expect(suitOf('tank_farm', CARGO_CLASS.oil)).toBeGreaterThan(suitOf('standard', CARGO_CLASS.oil) * 3);
  });
});

describe('capacity and growth', () => {
  it('caps a site at what its terminals move, and adds terminals up', () => {
    const bay = withT(1, open('road', 'loading_bay'));
    // berths times what each turns round an hour, stops and all
    expect(levelCap(colliery, bay)).toBeCloseTo((TIERS.loading_bay.berths * berthRate(bay.terminals[0], 'coal')) / outAt(colliery, 1), 6);
    expect(berthRate(bay.terminals[0], 'coal')).toBeLessThan(TIERS.loading_bay.perBerth); // the fixed part of each stop costs berth time
    // a loading bay moves a small pit's level-1 output, as the 2D loading bay did, but not a full one
    expect(levelCap(colliery, bay)).toBeGreaterThan(1);
    expect(levelCap(colliery, bay)).toBeLessThan(4);
    const both = withT(2, open('road', 'lorry_depot'), open('rail', 'sidings'));
    expect(levelCap(colliery, both)).toBeCloseTo(levelsAt(colliery, both.terminals[0]) + levelsAt(colliery, both.terminals[1]), 9);
    expect(levelCap(colliery, both)).toBeGreaterThan(4);
    // only open terminals count, and only those vehicles can reach
    expect(levelCap(colliery, withT(1, { ...open('road', 'loading_bay'), status: 'building' }))).toBe(0);
    expect(levelCap(colliery, both, { rail: false })).toBeCloseTo(levelsAt(colliery, both.terminals[0]), 9);
    const cap = capacity(colliery, both);
    expect(cap.load).toBeCloseTo(cap.levelCap * 66, 6);
    expect(cap.berths).toBe(TIERS.lorry_depot.berths + TIERS.sidings.berths);
    expect(cap.catchment).toBe(INDUSTRY_TYPES.coal_mine.catchment + TIERS.lorry_depot.catchment);
  });

  it('lets every industry reach level 4 by climbing its ladders, and no starter alone gets any there', () => {
    for (const id of INDUSTRY_IDS) {
      const spec = specFor(id), modes = usable(id);
      const top = withT(3, ...modes.map((m) => {
        const tier = LADDER[m][2], fit = TIERS[tier].fits.reduce((a, b) => (levelsAt(spec, { tier, fit: b }) > levelsAt(spec, { tier, fit: a }) ? b : a));
        return open(m, tier, fit);
      }));
      expect(levelCap(spec, top), id).toBeGreaterThanOrEqual(4);
      for (const m of modes) expect(levelsAt(spec, { tier: LADDER[m][0], fit: 'standard' }), `${id} ${m}`).toBeLessThan(4);
    }
    // and the big works need the big terminals: no rank 2 alone, even with its best kit, takes a
    // steelworks to level 4. (Three of them together now can: the starters had to grow to carry
    // a level-1 site of every 2D industry, and each rank is more than twice the one below.)
    for (const tier of ['lorry_depot', 'rail_terminal', 'quay'] as TierId[]) {
      expect(Math.max(...TIERS[tier].fits.map((fit) => levelsAt(steel, { tier, fit }))), tier).toBeLessThan(4);
    }
  });

  it('handles each class best with the kit made for it', () => {
    const rate = (tier: TierId, fit: FitId, c: CargoId) => levelsAt({ ...colliery, out: { [c]: 60 } }, { tier, fit });
    expect(rate('rail_terminal', 'rapid_loader', 'coal')).toBeGreaterThan(rate('rail_terminal', 'standard', 'coal') * 2);
    expect(rate('rail_terminal', 'rapid_loader', 'goods')).toBeLessThan(rate('rail_terminal', 'standard', 'goods'));
    expect(rate('rail_terminal', 'gantry', 'steel')).toBeGreaterThan(rate('rail_terminal', 'standard', 'steel'));
    expect(rate('lorry_depot', 'tank_farm', 'fuel')).toBeGreaterThan(rate('lorry_depot', 'standard', 'fuel') * 3);
    expect(rate('port_terminal', 'container_cranes', 'goods')).toBeGreaterThan(rate('port_terminal', 'grab_cranes', 'goods'));
    // the offers pick it: a refinery's road terminal comes with a tank farm, a colliery's sidings with a conveyor
    const refinery = specFor('refinery');
    expect(offers(refinery, withT(3), CTX).find((o) => o.tier === 'road_terminal')!.fit).toBe('tank_farm');
    expect(offers(colliery, withT(1), CTX).find((o) => o.tier === 'sidings')!.fit).toBe('conveyor');
  });

  it('shortens stops up the ladder and with the right kit', () => {
    const bay = { tier: 'loading_bay' as TierId, fit: 'standard' as FitId };
    // the factor is the stop itself on the 2D clock (a game hour is 60 of its seconds), not a
    // ratio to a starter's stop: a lorry of coal at a loading bay stands for 6.2 LOAD_TIMEs
    expect(dwellFactor(bay, 'coal')).toBeCloseTo((dwellHours(bay, 'coal', 20) * SIM_SECONDS_PER_HOUR) / LOAD_TIME_2D, 9);
    expect(dwellHours({ tier: 'road_terminal', fit: 'standard' }, 'goods', 20)).toBeLessThan(dwellHours({ tier: 'lorry_depot', fit: 'standard' }, 'goods', 20));
    expect(dwellHours({ tier: 'lorry_depot', fit: 'standard' }, 'goods', 20)).toBeLessThan(dwellHours(bay, 'goods', 20));
    const mgr = dwellHours({ tier: 'rail_terminal', fit: 'rapid_loader' }, 'coal', 1000), old = dwellHours({ tier: 'sidings', fit: 'standard' }, 'coal', 1000);
    expect(mgr).toBeLessThan(old / 3);
    expect(dwellFactor({ tier: 'marshalling_yard', fit: 'standard' }, 'steel')).toBeLessThan(dwellFactor({ tier: 'sidings', fit: 'standard' }, 'steel'));
    // bulk tips out quicker than it's loaded, by road and rail; a ship's hold has to be grabbed out
    expect(dwellHours(bay, 'coal', 20, 'unload')).toBeLessThan(dwellHours(bay, 'coal', 20, 'load'));
    expect(dwellHours(bay, 'goods', 20, 'unload')).toBeCloseTo(dwellHours(bay, 'goods', 20, 'load'), 9);
    expect(dwellHours({ tier: 'quay', fit: 'standard' }, 'coal', 1000, 'unload')).toBeCloseTo(dwellHours({ tier: 'quay', fit: 'standard' }, 'coal', 1000), 9);
    for (const id of TIER_IDS) expect(dwellHours({ tier: id, fit: 'standard' }, 'coal', 20)).toBeGreaterThan(0);
  });

  it('grows by the 2D rule, held to what the terminals can move', () => {
    const big = withT(2, open('road', 'lorry_depot'), open('rail', 'sidings')); // cap > 4
    expect(review(colliery, big, CTX, 1, flows({ moved: 50 })).level).toBeCloseTo(1.12, 9); // over 60% collected
    expect(review(colliery, big, CTX, 3.9, flows({ produced: 257, moved: 250 })).level).toBe(4); // capped at 4
    expect(review(colliery, big, CTX, 2, flows({ produced: 132, moved: 60 })).level).toBe(2); // in between: steady
    expect(review(colliery, big, CTX, 2, flows({ produced: 132, moved: 10 })).level).toBeCloseTo(1.92, 9); // under 15%: falls
    expect(review(colliery, big, CTX, 1.02, flows({ moved: 0 })).level).toBe(1); // never below 1
    const bay = withT(1, open('road', 'loading_bay')); // enough for about level 3
    const cap = levelCap(colliery, bay);
    const r = review(colliery, bay, CTX, cap - 0.05, flows({ produced: outAt(colliery, cap - 0.05), moved: outAt(colliery, cap - 0.1) }));
    expect(r.capped).toBe(true);
    expect(r.level).toBeCloseTo(cap, 9);
    expect(r.level).toBeLessThan((cap - 0.05) * 1.12);
    // a stockyard filling while 45% is collected: it eases back until 60% is
    const full = review(colliery, big, CTX, 2, flows({ produced: 132, moved: 60, stockFill: 1 }));
    expect(full.level).toBeCloseTo(2 * 0.96, 9);
    expect(review(colliery, big, CTX, 1.55, flows({ produced: 102.3, moved: 60, stockFill: 1 })).level).toBeCloseTo(60 / 66 / 0.6, 9);
    // more than the terminals can move (the bigger one demolished): it eases back to what they can
    const over = review(colliery, bay, CTX, 4, flows({ produced: 264, moved: outAt(colliery, cap), stockFill: 1 }));
    expect(over.level).toBeCloseTo(4 * 0.96, 9);
    expect(over.capped).toBe(true);
  });

  it('opens up the next rank when output presses against the terminals, and says why', () => {
    // a colliery grown a little past what its loading bay moves (about level 3)
    const bay = withT(1, open('road', 'loading_bay'));
    const level = levelCap(colliery, bay) * 1.1;
    const f = estimateFlows(colliery, bay, level, { stockFill: 0.8 });
    expect(f.stockFill).toBe(1);
    const r = review(colliery, bay, CTX, level, f);
    expect(r.pressure.pressing).toBe(true);
    expect(r.st.grade).toBe(2);
    expect(r.unlocked).toEqual(['lorry_depot', 'rail_terminal']); // no water at a colliery
    expect(r.suggestion?.reason).toBe('stockpiling');
    expect(r.suggestion?.text).toMatch(/^Colliery output is stockpiling: an? [a-z ]+ would move [\d.]+x more$/);
    expect(r.events[0].kind).toBe('unlocked');
    expect(r.events[0].text).toContain('Now available: lorry depot, rail freight terminal');
    // and rank 2 must be bought and used before rank 3 opens (at a steelworks, which needs one)
    const steelBay = withT(2, open('road', 'loading_bay'));
    const steelLevel = levelCap(steel, steelBay) * 1.2;
    const again = review(steel, steelBay, CTX, steelLevel, estimateFlows(steel, steelBay, steelLevel, { stockFill: 0.95 }));
    expect(again.pressure.pressing).toBe(true);
    expect(again.st.grade).toBe(2);
    expect(again.unlocked).toEqual([]);
    expect(offers(steel, again.st, CTX).find((o) => o.tier === 'road_terminal')!.status).toBe('locked');
    const depot = withT(2, open('road', 'lorry_depot')), depotLevel = levelCap(steel, depot) * 1.1;
    const pressed = review(steel, depot, CTX, depotLevel, estimateFlows(steel, depot, depotLevel, { stockFill: 0.95 }));
    expect(pressed.st.grade).toBe(3);
    expect(pressed.unlocked).toEqual(['road_terminal', 'marshalling_yard']); // the steelworks isn't on the water here
  });

  it("doesn't open anything up without pressure", () => {
    const both = withT(2, open('road', 'lorry_depot'), open('rail', 'sidings'));
    const r = review(colliery, both, CTX, 2, estimateFlows(colliery, both, 2, { stockFill: 0.2 }));
    expect(r.pressure.pressing).toBe(false);
    expect(r.st.grade).toBe(2);
    expect(r.suggestion).toBeNull();
  });

  it('says what stands in the way when nothing bigger can be built', () => {
    // a steelworks outgrowing its lorry depot, with no land either side for a bigger one
    const depot = withT(3, open('road', 'lorry_depot'));
    const room = roomCheck(bare.get('steelworks')!, [{ mode: 'road', tier: 'lorry_depot' }], {}, () => false);
    const level = levelCap(steel, depot) * 1.1;
    const f = estimateFlows(steel, depot, level, { stockFill: 0.95 });
    const s = suggest(steel, depot, { ...CTX, rail: false, room }, level, f);
    expect(s?.reason).toBe('stuck');
    expect(s?.text).toBe('Steelworks output is stockpiling. Private sidings: needs a rail line to the site'); // the smallest thing that would help
    expect(suggest(steel, depot, { ...CTX, room }, level, f)?.text).toMatch(/^Steelworks output is stockpiling: private sidings would move/);
  });

  it('tells vehicles from concrete: a full stockyard with idle berths wants more lorries', () => {
    const depot = withT(2, open('road', 'lorry_depot'));
    const f = estimateFlows(colliery, depot, 1, { lift: 0.3, stockFill: 0.95 });
    const s = suggest(colliery, depot, CTX, 1, f);
    expect(s?.reason).toBe('underused');
    expect(s?.text).toMatch(/^Add lorries: the lorry depot is only \d+% used$/);
    expect(review(colliery, depot, CTX, 1, f).st.grade).toBe(2);
  });

  it('shows queueing where a site only takes things in', () => {
    // private sidings unload a level-1 power station's coal with a little to spare; at 1.2 the
    // trains wait
    const ps = specFor('power_station'), st = withT(1, open('rail', 'sidings'));
    expect(levelCap(ps, st)).toBeGreaterThan(1);
    const f = estimateFlows(ps, st, 1.2, { supply: 1 });
    const r = review(ps, st, CTX, 1.2, f);
    expect(r.pressure.queueing).toBe('rail');
    expect(r.suggestion?.text).toBe('Trains are queueing at the private sidings: a rail freight terminal serves 2 at once');
  });

  it('only offers the modes a site can use, and says why not', () => {
    const find = (id: IndustryId, tier: TierId, ctx: SiteContext = CTX, st = startingTerminals(id)) => offers(specFor(id), st, ctx).find((o) => o.tier === tier)!;
    expect(find('coal_mine', 'jetty').status).toBe('not_offered');
    expect(find('coal_mine', 'jetty').reason).toBe("A colliery isn't built by the water");
    expect(find('refinery', 'jetty').status).toBe('not_offered'); // waterside optional, not on the water
    expect(find('refinery', 'jetty').reason).toMatch(/^Not on the water/);
    expect(find('refinery', 'jetty', { ...CTX, water: true }).status).toBe('available');
    expect(find('sawmill', 'jetty', { ...CTX, water: true }).reason).toBe("A sawmill can't be served by ships"); // riverside, but no quay
    expect(find('port', 'quay').status).toBe('owned'); // the docks come with one
    expect(find('port', 'jetty').status).toBe('superseded');
    expect(find('port', 'port_terminal').status).toBe('locked');
    expect(find('coal_mine', 'sidings', { ...CTX, rail: false }).status).toBe('blocked');
    expect(find('coal_mine', 'sidings', { ...CTX, rail: false }).reason).toBe('Needs a rail line to the site');
    expect(find('coal_mine', 'loading_bay', { ...CTX, road: false }).reason).toBe('Needs a road to the site');
    expect(find('steelworks', 'road_terminal', { ...CTX, year: 1930 }, withT(3)).status).toBe('era');
    expect(find('steelworks', 'road_terminal', { ...CTX, year: 1930 }, withT(3)).reason).toBe('From 1955');
    // nothing bigger than the smallest that moves all a site will ever make
    expect(find('coal_mine', 'road_terminal').status).toBe('not_offered');
    expect(find('coal_mine', 'road_terminal').reason).toBe('Not needed: a lorry depot with conveyor and hopper can move all the colliery makes at full production');
    expect(find('coal_mine', 'marshalling_yard').block).toBe('oversized');
    expect(find('coal_mine', 'rail_terminal').block).toBe('grade'); // private sidings don't: a colliery can use one
    // a fit from a later era isn't recommended early
    expect(find('coal_mine', 'rail_terminal', { ...CTX, year: 1950 }, withT(2)).fit).not.toBe('rapid_loader');
    expect(find('coal_mine', 'rail_terminal', { ...CTX, year: 1970 }, withT(2)).fit).toBe('rapid_loader');
    // and each refusal carries a code a UI can turn into an icon or a short label
    expect(find('coal_mine', 'jetty').block).toBe('mode');
    expect(find('refinery', 'jetty').block).toBe('water');
    expect(find('coal_mine', 'sidings', { ...CTX, rail: false }).block).toBe('rail');
    expect(find('steelworks', 'road_terminal', { ...CTX, year: 1930 }, withT(3)).block).toBe('era');
    expect(find('steelworks', 'road_terminal').block).toBe('grade');
    expect(find('coal_mine', 'loading_bay').block).toBeUndefined();
  });

  it('sums it all up for the economy in one call', () => {
    const st = withT(2, open('road', 'lorry_depot'), open('rail', 'rail_terminal', 'rapid_loader'));
    const r = report(colliery, st, CTX, 2);
    expect(r.production).toEqual({ level: 2, out: 132, in: 0 });
    expect(r.capacity.levelCap).toBeCloseTo(levelCap(colliery, st), 9);
    expect(r.capacity.byMode.rail?.fit).toBe('rapid_loader');
    expect(r.dwell('rail', 'coal', 1000)).toBeCloseTo(dwellHours(st.terminals[1], 'coal', 1000), 9);
    expect(r.dwell('water', 'coal', 1000)).toBeNull();
    expect(r.offers.length).toBe(9);
    expect(r.suggestion).toBeNull(); // plenty of room: nothing to say
  });

  it('asks whether there is land for the bigger tiers', () => {
    const m = bare.get('coal_mine')!;
    const room = roomCheck(m, [], {}, () => false); // every bit of land outside the plot is taken
    const o = offers(colliery, withT(3), { ...CTX, room });
    expect(o.find((x) => x.tier === 'loading_bay')!.status).toBe('available'); // inside the plot
    expect(o.find((x) => x.tier === 'sidings')!.status).toBe('available'); // on the site's own siding line
    const depot = o.find((x) => x.tier === 'lorry_depot')!;
    expect(depot.status).toBe('blocked');
    expect(depot.reason).toBe('No room beside the site (it needs 38 × 42 m)');
    expect(o.find((x) => x.tier === 'rail_terminal')!.reason).toMatch(/^No room behind the site/);
    // a brewery too small for sidings of its own needs land behind even for those
    const small = buildIndustry('brewery', defaultPlot('brewery', 'tower', 0, 0), { seed: 1, bare: true, variant: 'tower' });
    const tiny = buildIndustry('brewery', { poly: [{ x: -25, z: -20 }, { x: 25, z: -20 }, { x: 25, z: 20 }, { x: -25, z: 20 }], facing: { x: 0, z: 1 } }, { seed: 1, bare: true });
    expect(small.anchors.rail.length).toBeGreaterThan(0);
    expect(tiny.anchors.rail.length).toBe(0);
    expect(roomCheck(tiny, [], {}, () => false)('rail', 'sidings')).toMatch(/^No room behind the site \(it needs \d+ × 12 m\)$/);
  });

  it('serves a town goods depot, which only unloads', () => {
    const town = townSpec('Kingsbury', 8000);
    expect(outAt(town, 1)).toBe(0);
    expect(Object.keys(town.in).sort()).toEqual(['beer', 'food', 'fuel', 'goods', 'planks', 'stone']);
    expect(suggest(town, withT(1), CTX, 1)?.text).toMatch(/^Nothing can unload at the kingsbury goods depot yet: /);
    const st = withT(1, open('road', 'loading_bay'));
    expect(levelCap(town, st)).toBeGreaterThan(0);
    expect(offers(town, st, CTX).find((o) => o.tier === 'jetty')!.status).toBe('not_offered');
    expect(offers(townSpec('Portsea', 8000, true), st, { ...CTX, water: true }).find((o) => o.tier === 'jetty')!.status).toBe('available');
  });
});

describe('buying, upgrading and removing', () => {
  it('builds, then opens after its build time', () => {
    const r = apply(colliery, startingTerminals('coal_mine'), { ...CTX, day: 10 }, { kind: 'build', mode: 'rail', tier: 'sidings', fit: 'standard' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cost).toBe(6000);
    const t = terminalFor(r.st, 'rail')!;
    expect(t.status).toBe('building');
    expect(t.ready).toBe(10 + TIERS.sidings.buildDays);
    expect(levelCap(colliery, r.st)).toBe(0);
    const early = tick(colliery, r.st, 1, {}, 11);
    expect(terminalFor(early.st, 'rail')!.status).toBe('building');
    expect(early.upkeep).toBe(0); // nothing to keep up until it opens
    const done = tick(colliery, r.st, 8, {}, 18);
    expect(terminalFor(done.st, 'rail')!.status).toBe('open');
    expect(done.events.map((e) => e.kind)).toEqual(['opened']);
  });

  it('upgrades alongside the old terminal, for the new price less half the old', () => {
    const st = withT(2, open('road', 'loading_bay'));
    const r = apply(colliery, st, { ...CTX, day: 100 }, { kind: 'build', mode: 'road', tier: 'lorry_depot' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.cost).toBe(tierCost('lorry_depot', 'conveyor') - 0.5 * tierCost('loading_bay'));
    const t = terminalFor(r.st, 'road')!;
    expect(t.tier).toBe('loading_bay'); // still loading lorries while the depot is built
    expect(t.pending?.tier).toBe('lorry_depot');
    expect(levelCap(colliery, r.st)).toBeCloseTo(levelCap(colliery, st), 9);
    expect(shownFor(r.st)[0].tier).toBe('lorry_depot'); // the model shows what's being built
    const after = tick(colliery, r.st, 6, { road: true }, 106);
    expect(terminalFor(after.st, 'road')!.tier).toBe('lorry_depot');
    expect(after.events[0].kind).toBe('upgraded');
    // nothing more in that mode until it opens (at a steelworks, which a road freight terminal suits)
    const up = apply(steel, withT(3, open('road', 'loading_bay')), { ...CTX, day: 100 }, { kind: 'build', mode: 'road', tier: 'lorry_depot' });
    if (!up.ok) throw new Error(up.reason);
    const blocked = apply(steel, up.st, CTX, { kind: 'build', mode: 'road', tier: 'road_terminal' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.reason).toBe('Wait for the lorry depot to open');
  });

  it('refuses what is locked or blocked, with the reason', () => {
    const r = apply(steel, withT(1), CTX, { kind: 'build', mode: 'rail', tier: 'marshalling_yard' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('Unlocks as the site grows');
    const big = apply(colliery, withT(3), CTX, { kind: 'build', mode: 'rail', tier: 'marshalling_yard' });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.reason).toMatch(/^Not needed: a rail freight terminal/);
    const f = apply(colliery, withT(2), { ...CTX, year: 1950 }, { kind: 'build', mode: 'rail', tier: 'rail_terminal', fit: 'rapid_loader' });
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.reason).toBe('Rapid loader: From 1965');
    const g = apply(colliery, withT(2), CTX, { kind: 'build', mode: 'road', tier: 'lorry_depot', fit: 'gantry' });
    expect(g.ok).toBe(false);
  });

  it('refits, removes for a refund, and reopens a mothballed terminal', () => {
    const st = withT(2, open('rail', 'rail_terminal'));
    const rf = apply(colliery, st, { ...CTX, day: 0 }, { kind: 'refit', mode: 'rail', fit: 'rapid_loader' });
    if (!rf.ok) throw new Error(rf.reason);
    expect(rf.cost).toBe(Math.round(TIERS.rail_terminal.cost * FITS.rapid_loader.extra));
    const done = tick(colliery, rf.st, 10, { rail: true }, 10);
    expect(terminalFor(done.st, 'rail')!.fit).toBe('rapid_loader');
    const rm = apply(colliery, done.st, CTX, { kind: 'remove', mode: 'rail' });
    if (!rm.ok) throw new Error(rm.reason);
    expect(rm.cost).toBe(-Math.round(REMOVE_REFUND * tierCost('rail_terminal', 'rapid_loader')));
    expect(rm.st.terminals).toEqual([]);
    const shut = withT(1, open('road', 'loading_bay', 'standard', { status: 'mothballed', idle: 100 }));
    const re = apply(colliery, shut, CTX, { kind: 'reopen', mode: 'road' });
    if (!re.ok) throw new Error(re.reason);
    expect(terminalFor(re.st, 'road')).toMatchObject({ status: 'open', idle: 0 });
    expect(re.cost).toBe(100);
    const dock = apply(specFor('port'), startingTerminals('port'), CTX, { kind: 'remove', mode: 'water' });
    expect(dock.ok).toBe(false);
  });

  it('never changes the state it was given', () => {
    const st = withT(2, open('road', 'loading_bay'), open('rail', 'sidings', 'standard', { idle: 20 }));
    const before = JSON.stringify(st);
    apply(colliery, st, CTX, { kind: 'build', mode: 'road', tier: 'lorry_depot' });
    apply(colliery, st, CTX, { kind: 'remove', mode: 'rail' });
    tick(colliery, st, 400, {}, 400);
    review(colliery, st, CTX, 1, estimateFlows(colliery, st, 1, { stockFill: 1 }));
    expect(JSON.stringify(st)).toBe(before);
  });
});

describe('terminals left idle', () => {
  it('warns, mothballs, cuts back a rank, and finally closes a starter', () => {
    let st = withT(3, open('rail', 'marshalling_yard'));
    const kinds: string[] = [];
    let day = 0, upkeep = 0;
    for (let i = 0; i < 40; i++) {
      day += 30;
      const r = tick(colliery, st, 30, {}, day);
      st = r.st; upkeep += r.upkeep;
      kinds.push(...r.events.map((e) => `${Math.round(day)}:${e.kind}:${e.tier}`));
    }
    expect(kinds[0]).toBe(`${IDLE_WARN_DAYS}:idle:marshalling_yard`);
    expect(kinds[1]).toBe(`${IDLE_MOTHBALL_DAYS}:mothballed:marshalling_yard`);
    expect(kinds).toContain(`390:downgraded:rail_terminal`);
    expect(kinds.filter((k) => k.includes('downgraded')).length).toBe(2);
    expect(kinds[kinds.length - 1]).toMatch(/closed:sidings$/);
    expect(st.terminals).toEqual([]);
    expect(st.grade).toBe(3); // what growth earned stays earned
    // mothballed upkeep is a fifth
    const m = tick(colliery, withT(1, open('rail', 'sidings', 'standard', { status: 'mothballed', idle: 100 })), 10, {}, 0);
    expect(m.upkeep).toBeCloseTo(TIERS.sidings.upkeep * MOTHBALL_UPKEEP * 10, 9);
    expect(IDLE_CUT_DAYS).toBeGreaterThan(IDLE_MOTHBALL_DAYS);
    void upkeep;
  });

  it('keeps a served terminal open and forgives its idle days', () => {
    const st = withT(1, open('road', 'loading_bay', 'standard', { idle: 80, warned: true }));
    const r = tick(colliery, st, 30, { road: true }, 30);
    expect(terminalFor(r.st, 'road')).toMatchObject({ status: 'open', idle: 0, warned: false });
    expect(r.upkeep).toBe(TIERS.loading_bay.upkeep * 30);
    const s = suggest(colliery, withT(1, open('road', 'loading_bay', 'standard', { idle: 45 })), CTX, 1);
    expect(s?.reason).toBe('idle');
    expect(s?.text).toBe('The loading bay has had no lorries for 45 days and costs £150 a day');
  });

  it("never closes the docks' own quay", () => {
    let st = startingTerminals('port');
    for (let d = 30; d <= 900; d += 30) st = tick(specFor('port'), st, 30, {}, d).st;
    expect(terminalFor(st, 'water')).toMatchObject({ tier: 'quay', status: 'mothballed', builtIn: true });
  });
});

describe('sharing output between terminals', () => {
  const st = withT(2, open('road', 'lorry_depot'), open('rail', 'rail_terminal', 'rapid_loader'));
  const hours = (t: Terminal, f: Partial<Record<CargoId, number>>) => (Object.entries(f) as [CargoId, number][]).reduce((s, [c, v]) => s + v / (TIERS[t.tier].perBerth * suitOf(t.fit, CARGO_CLASS[c])), 0);

  it('moves everything when there is room, leaning each cargo to the terminal that handles it best', () => {
    const r = shareOutput(st, { coal: 200, goods: 40 }, { road: 1000, rail: 1000 });
    const road = r.byMode.road!, rail = r.byMode.rail!;
    expect((road.coal ?? 0) + (rail.coal ?? 0)).toBeCloseTo(200, 6);
    expect(r.left.coal).toBeCloseTo(0, 6);
    // the rapid loader takes most of the coal: over three quarters, now that a lorry's fixed stop
    // is shorter and the depot's four bays turn lorries round faster than they did
    expect(rail.coal! / 200).toBeGreaterThan(0.75);
    expect(road.goods! / 40).toBeGreaterThan(rail.goods! / 40); // the depot most of the crates
  });

  it('gives nothing to a mode with no vehicles calling, and never more than berths or vehicles take', () => {
    const r = shareOutput(st, { coal: 5000 }, { road: 100 });
    expect(r.byMode.rail).toBeUndefined();
    expect(r.byMode.road!.coal).toBeLessThanOrEqual(100 + 1e-9);
    const big = shareOutput(st, { coal: 100000 }, { road: 1e9, rail: 1e9 });
    for (const t of st.terminals) expect(hours(t, big.byMode[t.mode]!)).toBeLessThanOrEqual(TIERS[t.tier].berths + 1e-9);
    expect(big.left.coal).toBeGreaterThan(0);
    const none = shareOutput(st, { coal: 100 }, {});
    expect(none.left.coal).toBe(100);
  });
});

describe('layout', () => {
  const inside = (b: Box, B: Box, tol = 0.6) => b.x0 >= B.x0 - tol && b.x1 <= B.x1 + tol && b.z0 >= B.z0 - tol && b.z1 <= B.z1 + tol;

  it('puts starters on the site, and bigger terminals on land beside it, clear of each other', () => {
    for (const id of INDUSTRY_IDS) {
      const m = bare.get(id)!, B = bounds(m), modes = usable(id);
      for (const rank of [0, 1, 2]) for (const water of [false, true]) {
        const wanted = modes.filter((md) => md !== 'water' || water || INDUSTRY_TYPES[id].waterside === 'required').map((md) => ({ mode: md, tier: LADDER[md][rank] }));
        const P = place(m, wanted, { water });
        const annexes = P.filter((p) => p.side !== 'plot');
        for (const p of P) {
          if (p.side === 'plot') { expect(inside(p.pad, B), `${id} ${p.tier} in plot`).toBe(true); expect(p.land).toBeNull(); }
          else { expect(overlaps(p.pad, B), `${id} ${p.tier} clear of plot`).toBe(false); expect(p.land!.length).toBe(4); }
          if (p.mode === 'water') { expect(p.pad.z1).toBeLessThanOrEqual(waterline(m) + 1e-9); expect(p.spine.z).toBeCloseTo(p.pad.z0, 9); }
        }
        for (let i = 0; i < annexes.length; i++) for (let j = i + 1; j < annexes.length; j++) expect(overlaps(annexes[i].pad, annexes[j].pad), `${id} ${annexes[i].tier}/${annexes[j].tier}`).toBe(false);
      }
    }
  });

  it("uses the site's own anchors", () => {
    const m = bare.get('coal_mine')!;
    const [bay] = place(m, [{ mode: 'road', tier: 'loading_bay' }]);
    const L = m.anchors.lorry;
    expect(bay.spine.z).toBeCloseTo(L.reduce((s, a) => s + a.z, 0) / L.length, 9);
    const [sid] = place(m, [{ mode: 'rail', tier: 'sidings' }]);
    expect(sid.side).toBe('plot');
    expect(sid.tracks).toEqual(m.anchors.rail.slice(0, 2).map((r) => r.z));
    // with water behind, rail goes off the side away from the road instead
    const steel = bare.get('steelworks')!;
    const wet = place(steel, [{ mode: 'rail', tier: 'rail_terminal' }, { mode: 'water', tier: 'quay' }], { water: true });
    expect(wet.find((p) => p.mode === 'rail')!.side).not.toBe('back');
    expect(place(steel, [{ mode: 'rail', tier: 'rail_terminal' }])[0].side).toBe('back');
  });

  it('builds bare sites with the same anchors and none of their own bays or sidings', () => {
    for (const id of INDUSTRY_IDS) {
      const full = buildIndustry(id, defaultPlot(id), { seed: 1 }), b = bare.get(id)!;
      expect(b.anchors, id).toEqual(full.anchors);
      expect(b.tris, id).toBeLessThan(full.tris);
      expect(b.dyn.berths.filter((x) => x.kind !== 'ship').length, id).toBe(0);
      expect(b.bare).toBe(true);
      expect(full.bare).toBe(false);
    }
  });
});

describe('models', () => {
  const RANK_BUDGET = [0, 700, 1600, 2600];
  const all = INDUSTRY_IDS.flatMap((id) => usable(id).flatMap((mode) => LADDER[mode].flatMap((tier) => TIERS[tier].fits.map((fit) => ({ id, mode, tier, fit })))));

  it('builds every tier and fit at every site as one mesh within its triangle budget, on its own ground', () => {
    const sizes: number[] = [];
    for (const { id, mode, tier, fit } of all) {
      const m = bare.get(id)!;
      const t = buildTerminals(m, [{ mode, tier, fit }], { water: true, year: 2000 });
      const label = `${id} ${tier} ${fit}`;
      expect(t.group.children.length, label).toBe(1);
      if (id === 'port' && tier === 'quay') { expect(t.tris).toBe(0); continue; } // the docks draw their own
      expect(t.tris, label).toBeGreaterThan(20);
      expect(t.tris, label).toBeLessThanOrEqual(RANK_BUDGET[TIERS[tier].rank]);
      expect(t.height, label).toBeLessThan(45);
      sizes.push(t.tris);
      // every vertex stands on the plot, on the terminal's own pad, or reaches out over its water
      const B = bounds(m), P = t.placements[0], pos = (t.group.children[0] as THREE.Mesh).geometry.getAttribute('position');
      const zones = [B, P.pad, ...(P.over ? [P.over] : [])].map((b) => ({ ...b, x0: b.x0 - 3, x1: b.x1 + 3, z0: b.z0 - (P.water ? 30 : 3), z1: b.z1 + 3 }));
      let stray: string | null = null;
      for (let i = 0; i < pos.count && !stray; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        if (!zones.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1)) stray = `${x.toFixed(1)},${z.toFixed(1)}`;
      }
      expect(stray, `${label}: a vertex off its ground`).toBeNull();
    }
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2600);
  });

  it('is the same from the same inputs, and changes with the fit', () => {
    const m = bare.get('coal_mine')!;
    const shown = [{ mode: 'road' as Mode, tier: 'road_terminal' as TierId, fit: 'conveyor' as FitId }, { mode: 'rail' as Mode, tier: 'marshalling_yard' as TierId, fit: 'rapid_loader' as FitId }];
    const a = buildTerminals(m, shown, { year: 1980 }), b = buildTerminals(m, shown, { year: 1980 });
    const arr = (t: typeof a) => Array.from((t.group.children[0] as THREE.Mesh).geometry.getAttribute('position').array);
    expect(arr(a)).toEqual(arr(b));
    expect(a.dyn).toEqual(b.dyn);
    const c = buildTerminals(m, [shown[0], { ...shown[1], fit: 'gantry' }], { year: 1980 });
    expect(arr(c)).not.toEqual(arr(a));
  });

  it('gives each tier the berths and moving parts it promises', () => {
    const m = bare.get('coal_mine')!, port = bare.get('port')!, steel = bare.get('steelworks')!;
    const berths = (mm: IndustryModel, mode: Mode, tier: TierId, fit: FitId = 'standard', kind?: string) => buildTerminals(mm, [{ mode, tier, fit }], { water: true }).dyn.berths.filter((b) => !kind || b.kind === kind).length;
    expect(berths(m, 'road', 'loading_bay', 'standard', 'lorry')).toBe(2);
    expect(berths(m, 'road', 'lorry_depot', 'standard', 'lorry')).toBe(4);
    expect(berths(m, 'road', 'road_terminal', 'standard', 'lorry')).toBeGreaterThanOrEqual(8 + 4); // bays and the lorry park
    expect(berths(m, 'rail', 'marshalling_yard', 'standard', 'wagon')).toBeGreaterThan(berths(m, 'rail', 'rail_terminal', 'standard', 'wagon'));
    expect(berths(m, 'rail', 'rail_terminal', 'standard', 'wagon')).toBeGreaterThan(berths(m, 'rail', 'sidings', 'standard', 'wagon'));
    for (const tier of LADDER.water) if (tier !== 'quay') expect(berths(port, 'water', tier, 'standard', 'ship'), tier).toBe(TIERS[tier].berths);
    expect(berths(steel, 'water', 'quay', 'standard', 'ship')).toBe(TIERS.quay.berths);
    const movers = (mm: IndustryModel, mode: Mode, tier: TierId, fit: FitId) => buildTerminals(mm, [{ mode, tier, fit }], { water: true }).dyn.movers.map((x) => x.kind);
    expect(movers(m, 'rail', 'rail_terminal', 'gantry')).toContain('gantry');
    expect(movers(m, 'rail', 'rail_terminal', 'rapid_loader')).toContain('conveyor');
    expect(movers(port, 'water', 'port_terminal', 'container_cranes').filter((k) => k === 'gantry').length).toBe(3);
    expect(movers(steel, 'water', 'quay', 'grab_cranes').filter((k) => k === 'jib').length).toBe(3);
    // a power station takes coal in, so it gets hopper houses rather than a loading silo
    const ps = buildTerminals(bare.get('power_station')!, [{ mode: 'rail', tier: 'rail_terminal', fit: 'rapid_loader' }]);
    expect(ps.detail).toContain('hopper houses');
    expect(ps.detail).not.toContain('silo');
  });

  it('draws the moving parts through the same few draw calls as the sites', () => {
    const fx = new IndustryFx();
    const m = bare.get('port')!;
    fx.add(m);
    const t = buildTerminals(m, [{ mode: 'water', tier: 'port_terminal', fit: 'container_cranes' }, { mode: 'rail', tier: 'rail_terminal', fit: 'gantry' }]);
    const h = fx.add(fxModel(m, t), { production: 2, input: 0.5, output: 0.8, running: true, recentlyDelivered: true, year: 1990 });
    expect(fx.stats().drawCalls).toBe(9);
    expect(h.movers.length).toBe(t.dyn.movers.length);
    fx.remove(h);
    fx.dispose();
  });

  it('skips nothing a site can be offered: every offered tier has a drawing', () => {
    for (const id of INDUSTRY_IDS) {
      const o = offers(specFor(id), withT(3), { ...CTX, year: 2000, water: true }).filter((x) => x.status === 'available');
      for (const x of o) expect(() => buildTerminals(bare.get(id)!, [{ mode: x.mode, tier: x.tier, fit: x.fit }], { water: true }), `${id} ${x.tier}`).not.toThrow();
      expect(inEra(TIERS.loading_bay.era, 2000)).toBe(true);
    }
  });
});
