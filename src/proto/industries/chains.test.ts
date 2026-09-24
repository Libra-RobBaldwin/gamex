import { afterEach, describe, expect, it } from 'vitest';
import { CARGO, INDUSTRY_IDS, INDUSTRY_TYPES, TOWN_ACCEPTS, type CargoId, type IndustryId, type IndustryType } from './catalogue';
import {
  MAX_SUPPLIERS, REPORT_YEARS, THIN_MARGIN, audit, chainGraph, chainPay, chainSites, chains, chainsIn, chainsTo, explainIndustry,
  feedable, links, makers, runCycles, stepValues, suppliers, takers, whyClosed,
} from './chains';
import { buildIndustry, defaultPlot } from './models';
import { overlayFor } from './overlay';
import { DEFAULT_STATE } from './state';

const CARGOS = Object.keys(CARGO) as CargoId[];
const T = INDUSTRY_TYPES;
const byId = (id: string) => chains().find((c) => c.id === id)!;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

// Some tests break the catalogue on purpose to prove the checks catch it; put it back after.
const saved = new Map<IndustryId, string>();
const tamper = (id: IndustryId, change: (t: IndustryType) => void) => { if (!saved.has(id)) saved.set(id, JSON.stringify(T[id])); change(T[id]); };
afterEach(() => { for (const [id, json] of saved) Object.assign(T[id], JSON.parse(json)); saved.clear(); });
const errors = () => audit().filter((f) => f.level === 'error');

describe('the graph', () => {
  const g = chainGraph();

  it('has a node for every industry, every cargo and towns', () => {
    expect(g.nodes.filter((n) => n.kind === 'industry')).toHaveLength(INDUSTRY_IDS.length);
    expect(g.nodes.filter((n) => n.kind === 'cargo')).toHaveLength(CARGOS.length);
    expect(g.nodes.filter((n) => n.kind === 'town')).toHaveLength(1);
  });

  it('gives every cargo at least one producer and one consumer', () => {
    for (const c of CARGOS) {
      expect(g.edges.some((e) => e.kind === 'produce' && e.cargo === c), `${c} made`).toBe(true);
      expect(g.edges.some((e) => e.kind === 'consume' && e.cargo === c), `${c} taken`).toBe(true);
    }
  });

  it('carries the per-cycle ratios from the catalogue', () => {
    const into = (id: IndustryId, c: CargoId) => g.edges.find((e) => e.kind === 'consume' && e.to === id && e.cargo === c)!;
    expect(into('steelworks', 'iron_ore').amount).toBe(2);
    expect(into('steelworks', 'iron_ore').needsBoth).toBe(true);
    expect(into('steelworks', 'stone').optional).toBe(true);
    expect(into('steelworks', 'stone').needsBoth).toBe(false);
    const out = g.edges.find((e) => e.kind === 'produce' && e.from === 'steelworks')!;
    expect([out.cargo, out.amount, out.perSecond]).toEqual(['steel', 1.5, 1.5]);
    // only the steelworks needs two things at once
    expect([...new Set(g.edges.filter((e) => e.needsBoth).map((e) => e.to))]).toEqual(['steelworks']);
  });

  it('follows the docks trade by year', () => {
    const coal = (y: number) => chainGraph(y).edges.filter((e) => e.cargo === 'coal' && (e.from === 'port' || e.to === 'port')).map((e) => e.kind);
    expect(coal(1900)).toEqual(['consume']); // exported
    expect(coal(2000)).toEqual(['produce']); // imported
    expect(chainGraph(1900).edges.some((e) => e.from === 'port' && e.cargo === 'oil')).toBe(false);
    expect(chainGraph(1930).edges.some((e) => e.from === 'port' && e.cargo === 'oil')).toBe(true);
  });

  it('links industries directly, never docks to docks, and hubs only to towns', () => {
    const ls = links();
    expect(ls.some((l) => l.from === 'coal_mine' && l.to === 'steelworks' && l.needsBoth)).toBe(true);
    expect(ls.some((l) => l.from === 'quarry' && l.to === 'steelworks' && l.optional)).toBe(true);
    expect(ls.some((l) => l.from === 'port' && l.to === 'port')).toBe(false);
    expect(ls.filter((l) => l.from === 'warehouse').every((l) => l.to === 'town')).toBe(true);
    // the docks' coal reaches steelworks only once it's imported
    expect(ls.find((l) => l.from === 'port' && l.to === 'steelworks' && l.cargo === 'coal')!.era).toEqual([1985, null]);
  });
});

describe('chains', () => {
  it('finds every way to a final customer', () => {
    expect(chains().map((c) => c.id).sort()).toEqual([
      'beer', 'coal', 'food<grain', 'food<livestock', 'fuel', 'goods<chemicals', 'goods<planks', 'goods<steel', 'planks', 'steel', 'stone',
    ]);
    expect(new Set(chains().map((c) => c.id)).size).toBe(chains().length);
  });

  it('ends every chain at towns, a sink or the docks', () => {
    for (const c of chains()) {
      expect(c.ends.length, c.id).toBeGreaterThan(0);
      for (const e of c.ends) expect(e.to === 'town' || ['sink', 'gateway'].includes(T[e.to].role), `${c.id} -> ${e.to}`).toBe(true);
    }
    expect(chainsTo('power_station').map((c) => c.id)).toEqual(['coal']);
    expect(chainsTo('port').map((c) => c.id).sort()).toEqual(['coal', 'goods<chemicals', 'goods<planks', 'goods<steel', 'steel']);
    expect(chainsTo('town').map((c) => c.product).sort()).toEqual(['beer', 'food', 'food', 'fuel', 'goods', 'goods', 'goods', 'planks', 'stone']);
  });

  it('delivers every final product to towns or a sink, and nothing else is left over', () => {
    // a final product is one no processor takes on as a need
    const finals = CARGOS.filter((c) => makers(c).length && !takers(c).industries.some((id) => T[id].role === 'processor' && T[id].inputs.some((f) => f.cargo === c && !f.optional)));
    for (const c of finals) expect(takers(c).towns || takers(c).industries.some((id) => T[id].role === 'sink'), c).toBe(true);
    expect(errors().filter((f) => /never reaches|in no chain|nobody/.test(f.text))).toEqual([]);
  });

  it('reaches every processor from the ground', () => {
    for (const id of INDUSTRY_IDS.filter((x) => T[x].role === 'processor')) {
      expect(chains().some((c) => c.step && JSON.stringify(c.step).includes(`"id":"${id}"`)), id).toBe(true);
      expect(REPORT_YEARS.some((y) => feedable(id, y)), id).toBe(true);
    }
  });

  it('knows how deep each chain goes and where two inputs are needed at once', () => {
    expect(Object.fromEntries(chains().map((c) => [c.id, c.legs]))).toEqual({
      coal: 1, stone: 1, beer: 2, 'food<grain': 2, 'food<livestock': 2, fuel: 2, planks: 2, steel: 2, 'goods<chemicals': 3, 'goods<planks': 3, 'goods<steel': 3,
    });
    for (const c of chains()) {
      const steel = c.id === 'steel' || c.id === 'goods<steel';
      expect(c.needsBoth, c.id).toEqual(steel ? ['steelworks'] : []);
      expect(c.boosted, c.id).toEqual(steel ? ['steelworks'] : []);
    }
    expect(byId('fuel').step!.also.map((f) => f.cargo)).toEqual(['chemicals']);
    expect(byId('goods<steel').relays).toEqual(['warehouse']);
  });

  it('explains each chain and industry in words that match the data', () => {
    const name = (id: IndustryId) => T[id].name.toLowerCase();
    for (const c of chains()) {
      const line = c.line.toLowerCase();
      expect(line, c.id).toContain(CARGO[c.product].name.toLowerCase());
      expect(line.includes('needs both'), c.id).toBe(c.needsBoth.length > 0);
      const walk = (s: NonNullable<typeof c.step>): IndustryId[] => [s.id, ...s.needs.flatMap((n) => [...n.from, ...n.made.flatMap(walk)])];
      for (const id of c.step ? walk(c.step) : c.from) expect(line, `${c.id} names ${id}`).toContain(id === 'port' ? 'docks' : name(id));
      expect(c.line).toMatch(/^[A-Z].*\.$/);
    }
    for (const id of INDUSTRY_IDS) {
      const line = explainIndustry(id).toLowerCase();
      for (const f of [...T[id].inputs, ...T[id].outputs]) expect(line, `${id} mentions ${f.cargo}`).toContain(CARGO[f.cargo].name.toLowerCase());
      if (T[id].role === 'primary') for (const f of T[id].outputs) for (const to of takers(f.cargo).industries) expect(line, `${id} sends to ${to}`).toContain(to === 'port' ? 'docks' : name(to));
    }
    expect(explainIndustry('steelworks')).toBe('A steelworks needs both coal and iron ore to make steel for factories and export; stone is optional and adds 25%.');
    expect(byId('goods<planks').line).toBe('Timber from a forest goes to a sawmill; its sawn timber goes to a factory, which makes goods for towns or export.');
  });
});

describe('value added', () => {
  it('never loses value at a step, and only the sawmill runs thin', () => {
    for (const v of stepValues()) expect(v.ratio, `${v.id} ${v.on ?? ''}`).toBeGreaterThan(1);
    // left for the economy to tune: 1 t of timber (3.2) becomes 0.8 t of sawn timber (3.6)
    expect(stepValues().filter((v) => v.ratio < THIN_MARGIN).map((v) => v.id)).toEqual(['sawmill']);
    const steel = stepValues().find((v) => v.id === 'steelworks')!;
    near(steel.ratio, 1.2);
    expect(steel.boosted!.ratio).toBeGreaterThan(steel.ratio); // limestone is worth bringing
  });

  it('pays more for longer chains', () => {
    const pay = (id: string) => chainPay(byId(id));
    near(pay('coal'), 3.2);
    near(pay('goods<steel'), 14.83);
    expect(pay('goods<steel')).toBeGreaterThan(pay('steel'));
    expect(pay('goods<planks')).toBeGreaterThan(pay('planks'));
    expect(pay('goods<chemicals')).toBeGreaterThan(CARGO.oil.pay);
    for (const c of chains().filter((x) => x.step)) for (const n of c.step!.needs) expect(chainPay(c), c.id).toBeGreaterThan(CARGO[n.cargo].pay);
  });
});

describe('unit rates', () => {
  it('counts the suppliers that keep a processor busy', () => {
    const need = (id: IndustryId, c: CargoId, level: number) => suppliers(id, level).find((n) => n.cargo === c)!.options;
    near(need('steelworks', 'coal', 1).find((o) => o.id === 'coal_mine')!.sites, 1 / 1.1);
    near(need('steelworks', 'iron_ore', 1).find((o) => o.id === 'iron_ore_mine')!.sites, 2);
    near(need('steelworks', 'iron_ore', 4).find((o) => o.id === 'iron_ore_mine')!.sites, 8);
    // a livestock farm is the best source of livestock
    const stock = need('food_plant', 'livestock', 1)[0];
    expect(stock.variant).toBe('livestock');
    near(stock.sites, 1.5 / 0.9);
  });

  it('never needs an absurd number of suppliers', () => {
    for (const id of INDUSTRY_IDS.filter((x) => T[x].role === 'processor'))
      for (const n of suppliers(id, 1)) if (!n.optional) expect(Math.min(...n.options.map((o) => o.sites)), `${id} ${n.cargo}`).toBeLessThanOrEqual(MAX_SUPPLIERS);
  });

  it('adds up a whole chain', () => {
    const s = chainSites(byId('goods<steel'), 1);
    expect(s.processors.map((p) => [p.id, p.sites])).toEqual([['goods_factory', 1], ['steelworks', 0.5]]);
    const opt = (c: CargoId, id: IndustryId) => s.raw.find((r) => r.cargo === c)!.options.find((o) => o.id === id)!.sites;
    near(opt('coal', 'coal_mine'), 0.5 / 1.1);
    near(opt('iron_ore', 'iron_ore_mine'), 1);
    expect(s.raw.find((r) => r.cargo === 'stone')!.optional).toBe(true);
    near(chainSites(byId('goods<chemicals'), 3).raw[0].options.find((o) => o.id === 'oil_well')!.sites, 12);
  });
});

describe('eras', () => {
  it('opens these chains in the report years', () => {
    const open = Object.fromEntries(REPORT_YEARS.map((y) => [y, chainsIn(y).map((c) => c.id).sort()]));
    const early = ['beer', 'coal', 'food<grain', 'food<livestock', 'goods<planks', 'goods<steel', 'planks', 'steel', 'stone'];
    const all = chains().map((c) => c.id).sort();
    expect(open).toEqual({ 1850: early, 1900: early, 1950: all, 2000: all });
    expect(whyClosed(byId('fuel'), 1900)).toContain('no refineries until 1920');
    // coal alone has nowhere to go once power stations stop being built and exports have ended
    expect(chainsIn(2030).map((c) => c.id)).not.toContain('coal');
    expect(chainsIn(2030).map((c) => c.id)).toContain('goods<steel');
  });

  it('never makes what nobody takes, or needs what nobody makes, in any year', () => {
    expect(errors()).toEqual([]);
  });

  it('keeps the docks trade in step with who can use it', () => {
    const port = T.port, coalOut = port.outputs.find((f) => f.cargo === 'coal')!.era!, coalIn = port.inputs.find((f) => f.cargo === 'coal')!.era!;
    expect(coalIn[1]! < coalOut[0]).toBe(true); // coal export ends before imports begin
    for (const f of port.outputs) {
      const from = f.era?.[0] ?? 1800;
      expect(takers(f.cargo, from).industries.filter((id) => id !== 'port').length, `${f.cargo} import in ${from}`).toBeGreaterThan(0);
    }
  });

  it('catches a consumer that arrives after its supply', () => {
    tamper('food_plant', (t) => { t.era = [1850, null]; });
    expect(errors().some((f) => f.about === 'farm' && /livestock in 1800/.test(f.text))).toBe(true);
  });

  it('catches a processor left without supply when the pits close', () => {
    tamper('port', (t) => { t.outputs = t.outputs.filter((f) => f.cargo !== 'coal'); });
    const e = errors();
    expect(e.some((f) => f.about === 'steelworks' && /2016/.test(f.text))).toBe(true);
    expect(e.some((f) => f.about === 'power_station' && /2016/.test(f.text))).toBe(true);
  });

  it('catches an import nobody can take yet', () => {
    tamper('port', (t) => { t.outputs = t.outputs.map((f) => (f.cargo === 'oil' ? { cargo: 'oil', amount: 1 } : f)); });
    expect(errors().some((f) => f.about === 'port' && /crude oil in 1800/.test(f.text))).toBe(true);
  });

  it('knows which processors need the coast in which years', () => {
    expect(feedable('refinery', 1930, (id) => id !== 'port')).toBe(false); // no oil fields until 1950
    expect(feedable('refinery', 1930)).toBe(true);
    expect(feedable('steelworks', 2020, (id) => id !== 'port')).toBe(false);
    expect(feedable('steelworks', 1960, (id) => id !== 'port')).toBe(true);
    expect(feedable('goods_factory', 1800, (id) => id === 'sawmill')).toBe(true); // any one input will do
  });
});

describe('running a site', () => {
  it('needs both inputs at a steelworks, and limestone boosts it', () => {
    expect(runCycles('steelworks', { coal: 10 }, 1, 1).cycles).toBe(0);
    const r = runCycles('steelworks', { coal: 10, iron_ore: 1 }, 1, 1);
    expect(r.cycles).toBe(0.5); // ore is the scarcer
    expect(r.used).toEqual({ coal: 0.5, iron_ore: 1 });
    expect(r.made).toEqual({ steel: 0.75 });
    const b = runCycles('steelworks', { coal: 10, iron_ore: 10, stone: 10 }, 2, 1);
    expect([b.cycles, b.boosted, b.used.stone, b.made.steel]).toEqual([2, true, 1, 2 * 1.5 * 1.25]);
    expect(runCycles('steelworks', { coal: 10, iron_ore: 10, stone: 0.1 }, 2, 1).boosted).toBe(false);
  });

  it('runs a food plant on either input, shared by what is in stock', () => {
    expect(runCycles('food_plant', { livestock: 5 }, 1, 1).made.food).toBeCloseTo(1.5 * 0.8);
    const r = runCycles('food_plant', { grain: 3, livestock: 1 }, 1, 1);
    expect(r.cycles).toBe(1.5);
    near(r.used.grain!, 1.125);
    near(r.used.livestock!, 0.375);
  });

  it('digs at the rate and level, scaled by variant', () => {
    expect(runCycles('coal_mine', {}, 2, 10).made.coal).toBeCloseTo(22);
    const arable = T.farm.variants.find((v) => v.id === 'arable')!;
    const r = runCycles('farm', {}, 1, 10, { variant: arable });
    near(r.made.grain!, 9 * 1.2);
    near(r.made.livestock!, 4.5 * 0.3);
  });

  it('trades at the docks by year, burns at a sink and relays at a hub', () => {
    expect(Object.keys(runCycles('port', { coal: 5 }, 1, 1, { year: 1900 }).made).sort()).toEqual(['iron_ore']);
    expect(runCycles('port', { coal: 5 }, 1, 1, { year: 1900 }).used.coal).toBe(5);
    const modern = runCycles('port', { coal: 5 }, 1, 1, { year: 2000 });
    expect(Object.keys(modern.made).sort()).toEqual(['coal', 'iron_ore', 'oil']);
    expect(modern.used.coal).toBeUndefined();
    const burn = runCycles('power_station', { coal: 10 }, 1, 1);
    expect([burn.used.coal, burn.made]).toEqual([4, {}]);
    const hub = runCycles('warehouse', { goods: 2, food: 2 }, 1, 1);
    expect(hub.made).toEqual({ goods: 1.5, food: 1.5 });
  });

  it('never uses more than is in stock', () => {
    for (const id of INDUSTRY_IDS) {
      const stock = Object.fromEntries(CARGOS.map((c, i) => [c, (i % 3) * 0.7])) as Record<CargoId, number>;
      const r = runCycles(id, stock, 3, 2, { year: 1960 });
      for (const [c, u] of Object.entries(r.used)) expect(u!, `${id} ${c}`).toBeLessThanOrEqual(stock[c as CargoId] + 1e-9);
    }
  });
});

describe('the docks on the ground', () => {
  it('show and pile what they trade that year', () => {
    const icons = (year: number) => overlayFor(buildIndustry('port', defaultPlot('port', 'bulk'), { seed: 1, variant: 'bulk', year }), { ...DEFAULT_STATE, year }).icons.filter((i) => i.cargo === 'coal').map((i) => i.role);
    expect(icons(1900)).toEqual(['in']);
    expect(icons(2000)).toEqual(['out']);
    const heap = (year: number) => buildIndustry('port', defaultPlot('port', 'bulk'), { seed: 1, variant: 'bulk', year }).dyn.piles.find((p) => p.cargo === 'coal')!.role;
    expect([heap(1900), heap(2000)]).toEqual(['in', 'out']);
    expect(TOWN_ACCEPTS).not.toContain('coal');
  });
});
