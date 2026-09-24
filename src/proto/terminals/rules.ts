// The rules that make terminals the upgrade path. Pure functions over plain data, so the economy,
// the UI and the tests share them and a save only needs SiteTerminals.
//
// The idea: an industry's production level (1 to 4, rising x1.12 a review while over 60% of its
// output is collected, as in the 2D game) can't rise past what the terminals its vehicles can
// reach are able to move, and eases back when they can't move what it makes. When output presses
// against that limit (stock piling up with the berths busy, berths flat out, vehicles queueing, or
// growth held back), the next rank of terminal becomes available to buy, and suggest() says why in
// plain words. Terminals left without traffic are warned about, mothballed, then cut back a rank,
// and a starter terminal is finally closed.
//
// The clock is the economy layer's: flows per game hour, a review each game month (REVIEW_DAYS),
// and tick() once a game day. What a site sends and takes comes from the chains' production rule
// (runCycles in industries/chains.ts), for the year, so no terminal is sized on a trade that isn't
// running or a supply that nobody can make.
import { makers, takers } from '../industries/chains';
import { INDUSTRY_TYPES, TOWN_ACCEPTS, flowLive, type CargoId, type Flow, type IndustryId, type IndustryType, type Role, type Variant } from '../industries/catalogue';
import {
  CARGO_CLASS, FITS, LADDER, LOAD_TIME_2D, MODE_NAME, MODE_OF, MODES, REFERENCE_LOAD, SIM_SECONDS_PER_HOUR, STOP_HOURS, TIERS,
  inEra, suitOf, tierAt, tierCost, unloadOf, type FitId, type Mode, type Rank, type TierId,
} from './catalogue';

type Flows = Partial<Record<CargoId, number>>;

// The 2D review, as the economy layer runs it once a game month.
export const MAX_LEVEL = 4;
export const GROW_ABOVE = 0.6; // share of output collected above which the level rises
export const FALL_BELOW = 0.15; // and below which it falls
export const GROWTH = 1.12;
export const DECLINE = 0.96;

// ---------------- what a site moves ----------------
// A site as the terminal rules see it: what it sends and receives an hour at production level 1.
// Built from an industry type, or from a town for a goods depot.
export interface SiteSpec {
  id: IndustryId | 'town';
  name: string;
  role: Role | 'town';
  modes: Mode[]; // modes that could ever serve it
  waterside?: 'required' | 'optional';
  out: Flows; // t/h at level 1, with every input the chain can supply
  in: Flows; // t/h at level 1; for 'any' mixes, sinks and hubs, the expected share of each
  catchment: number;
  year?: number; // the year the flows are for; none means every flow the type ever has
}

const perHour = (amount: number, rate: number) => amount * rate * SIM_SECONDS_PER_HOUR;

// An industry type's traffic at level 1, as the chains' runCycles makes it in a game hour with
// every input the chain can supply in `year`:
//  - only flows running that year, only inputs someone else makes and outputs someone else takes
//    (the docks export coal until 1984 and import it from 1985; a factory in 1800 has only planks)
//  - an 'all' processor needs every input; an optional boost counts, with its extra output, when
//    something supplies it
//  - an 'any' processor's cycles are shared equally between the inputs it can get
//  - sinks and hubs move rate x level in all, shared between what they take
//  - the docks import rate x level of each import; exports are taken in full, sized as a level's
//    worth of each
// With no year every flow counts, as in the chains' era-blind helpers.
export function specFor(type: IndustryType | IndustryId, variant?: Variant, year?: number): SiteSpec {
  const t = typeof type === 'string' ? INDUSTRY_TYPES[type] : type;
  const live = (f: Flow) => flowLive(f, year);
  const fed = (f: Flow) => live(f) && (year === undefined || makers(f.cargo, year, true).some((m) => m !== t.id));
  const taken = (f: Flow) => {
    if (!live(f) || year === undefined) return live(f);
    const k = takers(f.cargo, year);
    return k.towns || k.industries.some((m) => m !== t.id);
  };
  // what it can get, or failing that what runs that year: a site built before its suppliers
  // stopped being built still runs on what's left
  const some = (fs: Flow[], ok: (f: Flow) => boolean) => { const x = fs.filter(ok); return x.length ? x : fs.filter(live); };
  const need = t.inputs.filter((f) => !f.optional), opt = t.inputs.filter((f) => f.optional && fed(f));
  const outs = some(t.outputs, taken);
  const inn: Flows = {}, out: Flows = {};
  const add = (to: Flows, c: CargoId, v: number) => { to[c] = (to[c] ?? 0) + v; };
  if (t.role === 'primary') {
    for (const f of outs) add(out, f.cargo, perHour(f.amount, t.rate) * (variant?.outputScale?.[f.cargo] ?? 1));
  } else if (t.role === 'gateway') {
    for (const f of t.inputs.filter(fed)) add(inn, f.cargo, perHour(f.amount, t.rate));
    for (const f of outs) add(out, f.cargo, perHour(f.amount, t.rate));
  } else if (t.role === 'sink' || t.role === 'hub') {
    const ins = some(need, fed), each = perHour(1, t.rate) / Math.max(1, ins.length);
    for (const f of ins) {
      add(inn, f.cargo, each);
      if (t.role === 'hub' && outs.some((o) => o.cargo === f.cargo)) add(out, f.cargo, each);
    }
  } else {
    const any = t.mix === 'any', ins = any ? some(need, fed) : need.filter(live);
    const share = any ? 1 / Math.max(1, ins.length) : 1, boost = !any && opt.length && t.boost ? t.boost : 1;
    for (const f of ins) add(inn, f.cargo, perHour(f.amount, t.rate) * share);
    if (boost > 1) for (const f of opt) add(inn, f.cargo, perHour(f.amount, t.rate));
    for (const f of outs) add(out, f.cargo, perHour(f.amount, t.rate) * boost);
  }
  return { id: t.id, name: t.name, role: t.role, modes: [...new Set(t.serve.map((k) => MODE_OF[k]))], waterside: t.waterside, out, in: inn, catchment: t.catchment, year };
}

// A town's goods depot: what the shops, pubs, garages and builders' merchants take in an hour, per
// thousand people. It only unloads, and its "level" is how much of that demand is being met.
const TOWN_DEMAND: Partial<Record<CargoId, number>> = { goods: 6, food: 5, beer: 2, fuel: 3, stone: 2, planks: 2 };
export function townSpec(name: string, population: number, waterside = false): SiteSpec {
  const inn: Flows = {};
  for (const c of TOWN_ACCEPTS) inn[c] = ((TOWN_DEMAND[c] ?? 1) * population) / 1000;
  return { id: 'town', name: `${name} goods depot`, role: 'town', modes: waterside ? ['road', 'rail', 'water'] : ['road', 'rail'], waterside: waterside ? 'optional' : undefined, out: {}, in: inn, catchment: 60 };
}

const sum = (f: Flows) => Object.values(f).reduce<number>((s, v) => s + (v ?? 0), 0);
export const outAt = (spec: SiteSpec, level: number) => sum(spec.out) * level;
export const inAt = (spec: SiteSpec, level: number) => sum(spec.in) * level;
const makesAny = (spec: SiteSpec) => sum(spec.out) > 0;

// ---------------- terminals owned ----------------
export type TerminalStatus = 'building' | 'open' | 'mothballed';
export interface Terminal {
  mode: Mode;
  tier: TierId;
  fit: FitId;
  status: TerminalStatus;
  ready: number; // game day it opens (while building)
  idle: number; // days since a vehicle last loaded or unloaded here
  warned?: boolean; // the idle warning has been given
  builtIn?: boolean; // the terminal the site came with (the docks' quay), at the tier it came as: never removed or closed
  paid?: number; // what a terminal still being built cost, for the refund if it's cancelled
  pending?: { tier: TierId; fit: FitId; ready: number; paid?: number }; // an upgrade or refit being built; this one works meanwhile
}
// Everything a save needs per site. `grade` is the highest rank growth has made available; it
// only ever rises, so a dip in trade doesn't take an option away.
export interface SiteTerminals { terminals: Terminal[]; grade: Rank }

export function startingTerminals(id: IndustryId | 'town'): SiteTerminals {
  // the docks are a quay already: they come with one, and can grow to a bulk or container terminal
  if (id === 'port') return { terminals: [{ mode: 'water', tier: 'quay', fit: 'standard', status: 'open', ready: 0, idle: 0, builtIn: true }], grade: 2 };
  return { terminals: [], grade: 1 };
}
// The terminal a site came with in a mode, if any: what a bigger one is demolished or cut back to.
const baseOf = (id: IndustryId | 'town', mode: Mode) => startingTerminals(id).terminals.find((t) => t.mode === mode);

export const terminalFor = (st: SiteTerminals, mode: Mode) => st.terminals.find((t) => t.mode === mode);
// What to draw for each terminal: the tier being built when an upgrade or refit is under way.
export const shownFor = (st: SiteTerminals) => st.terminals.map((t) => ({ mode: t.mode, tier: t.pending?.tier ?? t.tier, fit: t.pending?.fit ?? t.fit }));
const openOnes = (st: SiteTerminals) => st.terminals.filter((t) => t.status === 'open');

// ---------------- capacity ----------------
// A tier and its handling kit: all the rates need to know about a terminal.
export type Handling = { tier: TierId; fit: FitId };
// Loading the site's outputs onto vehicles, or unloading its inputs from them.
export type Dir = 'load' | 'unload';

// t/h one berth handles a cargo while a vehicle stands under it.
export const handlingRate = (h: Handling, c: CargoId, dir: Dir = 'load') => {
  const T = TIERS[h.tier], cls = CARGO_CLASS[c];
  return T.perBerth * suitOf(h.fit, cls) * (dir === 'unload' ? unloadOf(T.mode, cls) : 1);
};
// How long a vehicle with `load` tonnes stands at the terminal: a fixed part (positioning, running
// round, hoses, which better tiers and kit shorten) plus the time its berth takes to fill or empty it.
export function dwellHours(h: Handling, cargo: CargoId, load: number, dir: Dir = 'load') {
  const T = TIERS[h.tier];
  // kit shortens the stop only for the cargo it's built for: a gantry doesn't speed up a coal train
  const kit = FITS[h.fit].suits[CARGO_CLASS[cargo]] !== undefined ? FITS[h.fit].dwell : 1;
  return STOP_HOURS[T.mode] * T.manoeuvre * kit + load / handlingRate(h, cargo, dir);
}
// What one berth moves an hour, stops and all, turning round the mode's typical vehicle. Capacity
// and growth use this, so a berth's rating and the time vehicles stand in it are the same number.
export const berthRate = (h: Handling, c: CargoId, dir: Dir = 'load') => {
  const ref = REFERENCE_LOAD[TIERS[h.tier].mode];
  return ref / dwellHours(h, c, ref, dir);
};
// The same stop as a multiple of the 2D game's LOAD_TIME, for anything still on the 2D clock (a
// game hour is 60 of its seconds): a lorry of coal at a loading bay stands for about 12 game
// minutes, which is 6.2 LOAD_TIMEs, where the 2D game gave every vehicle one.
export const dwellFactor = (h: Handling, cargo: CargoId, dir: Dir = 'load') =>
  (dwellHours(h, cargo, REFERENCE_LOAD[TIERS[h.tier].mode], dir) * SIM_SECONDS_PER_HOUR) / LOAD_TIME_2D;

// How many production levels' worth of this site's traffic (in and out together: a berth is either
// loading or unloading) a terminal can handle an hour. Terminals work in parallel, so they add.
export function levelsAt(spec: SiteSpec, h: Handling) {
  let hours = 0;
  for (const [c, v] of Object.entries(spec.out) as [CargoId, number][]) hours += v / berthRate(h, c, 'load');
  for (const [c, v] of Object.entries(spec.in) as [CargoId, number][]) hours += v / berthRate(h, c, 'unload');
  return hours > 0 ? TIERS[h.tier].berths / hours : 0;
}
// t/h of this site's own mix a terminal moves, in and out together
export const tphAt = (spec: SiteSpec, h: Handling) => levelsAt(spec, h) * (sum(spec.out) + sum(spec.in));

// Which modes' terminals can work: their vehicles can get there (a rail line, a road, the water)
// and, where the economy says, some called. A terminal nothing reaches moves nothing, so it must
// not let the site grow. Missing entries count as reachable.
export type Reach = Partial<Record<Mode, boolean>>;
export function reachOf(spec: SiteSpec, ctx?: Pick<SiteContext, 'rail' | 'road' | 'water'>, served?: Partial<Record<Mode, boolean>>): Reach {
  const can: Reach = {};
  for (const m of MODES) {
    const there = !ctx || (m === 'rail' ? ctx.rail : m === 'road' ? ctx.road !== false : spec.waterside === 'required' || !!ctx.water);
    can[m] = there && served?.[m] !== false;
  }
  return can;
}
const working = (st: SiteTerminals, can: Reach = {}) => openOnes(st).filter((t) => can[t.mode] !== false);
// The production level the working terminals keep up with; above 4 means room to spare.
export const levelCap = (spec: SiteSpec, st: SiteTerminals, can: Reach = {}) => working(st, can).reduce((s, t) => s + levelsAt(spec, t), 0);

export interface ModeCapacity { tier: TierId; fit: FitId; status: TerminalStatus; reached: boolean; levels: number; tph: number; berths: number; stock: number }
export interface SiteCapacity {
  levelCap: number; // the production level the working terminals keep up with; above 4 means room to spare
  load: number; // t/h they can load of the site's outputs at that level
  unload: number; // t/h they can unload of its inputs
  perCargo: Flows; // t/h of each cargo at that level
  byMode: Partial<Record<Mode, ModeCapacity>>;
  berths: number;
  stock: number;
  catchment: number; // the industry's own plus the best terminal's bonus
}

export function capacity(spec: SiteSpec, st: SiteTerminals, can: Reach = {}): SiteCapacity {
  const cap = levelCap(spec, st, can);
  const perCargo: Flows = {};
  for (const [c, v] of [...Object.entries(spec.out), ...Object.entries(spec.in)] as [CargoId, number][]) perCargo[c] = (perCargo[c] ?? 0) + v * cap;
  const byMode: Partial<Record<Mode, ModeCapacity>> = {};
  for (const t of st.terminals) {
    const reached = can[t.mode] !== false, on = t.status === 'open' && reached, T = TIERS[t.tier];
    byMode[t.mode] = { tier: t.tier, fit: t.fit, status: t.status, reached, levels: on ? levelsAt(spec, t) : 0, tph: on ? tphAt(spec, t) : 0, berths: on ? T.berths : 0, stock: on ? T.stock : 0 };
  }
  const w = working(st, can);
  return {
    levelCap: cap, load: outAt(spec, cap), unload: inAt(spec, cap), perCargo, byMode,
    berths: w.reduce((s, t) => s + TIERS[t.tier].berths, 0),
    stock: w.reduce((s, t) => s + TIERS[t.tier].stock, 0),
    catchment: spec.catchment + Math.max(0, ...w.map((t) => TIERS[t.tier].catchment)),
  };
}

// ---------------- sharing output between terminals ----------------
// How an hour's output (or what's in the stockyard) splits between the terminals vehicles are
// calling at. Each cargo leans towards the terminal that is comparatively best at it, not just
// fastest: a rapid loader outpaces a lorry depot at crates too, but it's far better at coal, so the
// coal goes by rail and the crates by road. No terminal is given more than its berths can move or
// its vehicles want to lift, and what one can't take is offered again to those with berths and
// vehicles to spare; only what none of them can take stays in the stockyard. `demand` is t/h the
// vehicles calling at each mode would lift; a mode with no vehicles gets nothing.
export function shareOutput(st: SiteTerminals, available: Flows, demand: Partial<Record<Mode, number>>) {
  const byMode: Partial<Record<Mode, Flows>> = {};
  const left: Flows = { ...available };
  const live = openOnes(st).filter((t) => (demand[t.mode] ?? 0) > 0);
  const hoursLeft = new Map(live.map((t) => [t, TIERS[t.tier].berths]));
  const wantLeft = new Map(live.map((t) => [t, demand[t.mode] ?? 0]));
  for (let pass = 0; pass < 6; pass++) {
    const cargos = (Object.keys(left) as CargoId[]).filter((c) => (left[c] ?? 0) > 1e-9);
    const room = live.filter((t) => hoursLeft.get(t)! > 1e-9 && wantLeft.get(t)! > 1e-9);
    if (!cargos.length || !room.length) break;
    // each cargo split by how fast each terminal handles it, times how much better it is at this
    // cargo than at the others on offer (comparative advantage)
    const want = new Map<Terminal, Flows>(room.map((t) => [t, {}]));
    const mean = new Map(room.map((t) => [t, cargos.reduce((s, c) => s + berthRate(t, c), 0) / cargos.length]));
    for (const c of cargos) {
      const w = room.map((t) => (TIERS[t.tier].berths * berthRate(t, c) ** 2) / mean.get(t)!);
      const W = w.reduce((a, b) => a + b, 0);
      room.forEach((t, i) => { want.get(t)![c] = (left[c]! * w[i]) / W; });
    }
    // then scale each terminal down to what its berths and its vehicles can still take
    let moved = 0;
    for (const t of room) {
      const f = want.get(t)!;
      const hours = (Object.entries(f) as [CargoId, number][]).reduce((s, [c, v]) => s + v / berthRate(t, c), 0);
      const k = Math.min(1, hoursLeft.get(t)! / Math.max(1e-9, hours), wantLeft.get(t)! / Math.max(1e-9, sum(f)));
      const got = (byMode[t.mode] ??= {});
      for (const [c, v] of Object.entries(f) as [CargoId, number][]) { got[c] = (got[c] ?? 0) + v * k; left[c] = (left[c] ?? 0) - v * k; }
      hoursLeft.set(t, hoursLeft.get(t)! - hours * k);
      wantLeft.set(t, wantLeft.get(t)! - sum(f) * k);
      moved += sum(f) * k;
    }
    if (moved < 1e-9) break;
  }
  for (const c of Object.keys(left) as CargoId[]) left[c] = Math.max(0, left[c] ?? 0);
  return { byMode, left };
}

// ---------------- what the economy observed ----------------
// Hourly averages over the last review window. The economy fills this from its own counters;
// estimateFlows() below makes a stand-in for previews and the demo.
export interface SiteFlows {
  produced: number; // t/h made (all outputs together)
  moved: number; // t/h loaded onto vehicles
  arrived?: number; // t/h vehicles brought in
  unloaded?: number; // t/h unloaded from them
  stockFill: number; // 0..1, how full the site's output store and the terminals' stock are
  queue?: Partial<Record<Mode, number>>; // vehicles waiting for a berth, on average
  served?: Partial<Record<Mode, boolean>>; // whether any vehicle called, per mode
}

export interface Pressure {
  utilisation: number; // share of the working terminals' berth time in use (can pass 1 when vehicles queue)
  stockpiling: boolean; // the output store is nearly full
  queueing: Mode | null; // where vehicles are waiting for a berth
  capped: boolean; // growth held back by what the terminals can move
  pressing: boolean; // growth is waiting on terminals: the next rank should open up
  underused: boolean; // stock piling up with the terminals mostly idle: it wants vehicles, not concrete
}

export function pressure(spec: SiteSpec, st: SiteTerminals, flows: SiteFlows, capped = false, can: Reach = {}): Pressure {
  const cap = levelCap(spec, st, can), traffic = sum(spec.out) + sum(spec.in);
  const used = flows.moved + (flows.unloaded ?? 0);
  const utilisation = cap > 0 && traffic > 0 ? used / (cap * traffic) : 0;
  const queues = Object.entries(flows.queue ?? {}) as [Mode, number][];
  const waiting = queues.reduce((s, [, v]) => s + (v ?? 0), 0);
  const q = queues.filter(([, v]) => (v ?? 0) >= 0.5).sort((a, b) => b[1] - a[1])[0];
  const queueing = q?.[0] ?? null;
  const stockpiling = flows.stockFill >= 0.9;
  // Berths flat out: nearly always busy, or busy with vehicles waiting their turn. A site that
  // only takes things in has no stockyard to fill, so this is how it shows it needs more.
  const saturated = utilisation >= 0.95 || (utilisation >= 0.85 && waiting > 0.1);
  return {
    utilisation, stockpiling, queueing, capped,
    pressing: (stockpiling && utilisation >= 0.85) || saturated || !!queueing || capped,
    underused: stockpiling && cap > 0 && utilisation < 0.5,
  };
}

// A plausible month of traffic for a site, from its level, its terminals and how hard the player
// is working it: `lift` is how much of the output the vehicles calling try to take (1 = all of it),
// `supply` how much of what the site takes in arrives. Only terminals vehicles can reach (ctx)
// work, and none of them is served or queued at when nothing calls. A stand-in until the economy
// reports its own.
export interface Service { lift?: number; supply?: number; hours?: number; stockFill?: number; store?: number }
export function estimateFlows(spec: SiteSpec, st: SiteTerminals, level: number, s: Service = {}, ctx?: Pick<SiteContext, 'rail' | 'road' | 'water'>): SiteFlows {
  const lift = s.lift ?? 1, supply = s.supply ?? 1, hours = s.hours ?? 30 * 24;
  const can = reachOf(spec, ctx), cap = levelCap(spec, st, can);
  const out1 = sum(spec.out), in1 = sum(spec.in);
  // a processor or hub makes only what its inputs let it
  const makes = spec.role === 'processor' || spec.role === 'hub' ? supply : 1;
  const produced = outAt(spec, level) * makes;
  const arrived = inAt(spec, level) * supply;
  // berth time asked for, in levels of the site's own mix: what vehicles try to lift, and what
  // they bring; the berths are shared, so both get the same share of it when that's too much
  const asked = out1 + in1 > 0 ? level * ((out1 * makes * lift + in1 * supply) / (out1 + in1)) : 0;
  const q = asked > 0 ? Math.min(1, cap / asked) : 0;
  const store = (s.store ?? 600) + capacity(spec, st, can).stock; // 600: the 2D industry's own stockyard
  const prev = s.stockFill ?? 0.5;
  // what's collected: this month's output as far as vehicles and berths allow, plus some of the
  // stockyard when there's room to spare
  const lifted = produced * lift * q;
  const spare = lift > 0 ? Math.max(0, cap * out1 - lifted) : 0;
  const drain = Math.min(prev * store, spare * hours) / hours;
  const moved = lifted + drain;
  const stockFill = Math.max(0, Math.min(1, prev + ((produced - moved) * hours) / store));
  const util = cap > 0 ? asked / cap : 0;
  const queue: Partial<Record<Mode, number>> = {}, served: Partial<Record<Mode, boolean>> = {};
  for (const t of openOnes(st)) {
    const on = can[t.mode] !== false && asked > 0;
    queue[t.mode] = on ? Math.max(0, util - 0.9) * 2 * TIERS[t.tier].berths : 0;
    served[t.mode] = on;
  }
  return { produced, moved, arrived, unloaded: arrived * q, stockFill, queue, served };
}

// ---------------- offers and suggestions ----------------
export interface SiteContext {
  year: number;
  day?: number; // today in game days, for build times
  rail: boolean; // a rail line reaches the site
  road?: boolean; // a road reaches it (default: yes, every site fronts one)
  water?: boolean; // it has navigable water along one side (the docks always do)
  room?: (mode: Mode, tier: TierId) => string | null; // why the tier won't fit on or beside the site, or null
}

export type OfferStatus = 'owned' | 'building' | 'superseded' | 'available' | 'locked' | 'era' | 'blocked' | 'not_offered';
// Why an offer can't be bought, for a UI that wants an icon or a short label rather than the sentence.
export type BlockCode = 'mode' | 'water' | 'oversized' | 'superseded' | 'era' | 'grade' | 'rail' | 'road' | 'room' | 'busy';
export interface FitOffer { fit: FitId; cost: number; tph: number; ok: boolean; reason?: string }
export interface Offer {
  mode: Mode;
  tier: TierId;
  rank: Rank;
  status: OfferStatus;
  fit: FitId; // the kit that suits this site best
  cost: number; // what buying it costs now: less half the current tier's price when upgrading one the player bought
  upkeep: number;
  buildDays: number;
  tph: number; // what it would move of this site's traffic
  gain: number; // the site's throughput with it (in place of this mode's current terminal) over without
  reason: string; // plain words for the UI
  block?: BlockCode;
  fits: FitOffer[];
}

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// "a lorry depot", "private sidings"
export const called = (tier: TierId) => (tier === 'sidings' ? lc(TIERS[tier].name) : `a ${lc(TIERS[tier].name)}`);
const times = (g: number) => (g >= 10 ? `${Math.round(g)}x` : `${(Math.round(g * 10) / 10).toString()}x`);
const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const tph = (n: number) => `${Math.round(n).toLocaleString('en-GB')} t/h`;

export function modeOffered(spec: SiteSpec, ctx: SiteContext, mode: Mode): string | null {
  const who = spec.role === 'town' ? spec.name : `A ${lc(spec.name)}`;
  if (!spec.modes.includes(mode)) return mode === 'water' && !spec.waterside ? `${who} isn't built by the water` : `${who} can't be served by ${MODE_NAME[mode].vehicles}`;
  if (mode === 'water' && spec.waterside !== 'required' && !ctx.water) return 'Not on the water: the plot needs a waterside edge';
  return null;
}

function fitOffers(spec: SiteSpec, tier: TierId, ctx: SiteContext): FitOffer[] {
  return TIERS[tier].fits.map((fit) => {
    const era = FITS[fit].era, ok = inEra(era, ctx.year);
    return { fit, cost: tierCost(tier, fit), tph: tphAt(spec, { tier, fit }), ok, reason: ok ? undefined : `From ${era[0]}` };
  });
}
// the fit that moves most of this site's traffic, and the cheaper one when it's no better
function bestFit(fits: FitOffer[]) {
  const ok = fits.filter((f) => f.ok);
  return (ok.length ? ok : fits).reduce((a, b) => (b.tph > a.tph * 1.05 ? b : a));
}

// The smallest tier in a mode that, with the best kit of the year, moves everything the site will
// ever make or take (its traffic at level 4). Anything bigger is sized for more than the chain can
// supply there, so it isn't offered: a colliery never needs a marshalling yard.
export function enoughIn(spec: SiteSpec, mode: Mode, year: number): { tier: TierId; fit: FitId } | null {
  for (const tier of LADDER[mode]) {
    if (!inEra(TIERS[tier].era, year)) continue;
    const fits = TIERS[tier].fits.filter((f) => inEra(FITS[f].era, year));
    const fit = fits.reduce((a, b) => (levelsAt(spec, { tier, fit: b }) > levelsAt(spec, { tier, fit: a }) ? b : a), fits[0]);
    if (levelsAt(spec, { tier, fit }) >= MAX_LEVEL) return { tier, fit };
  }
  return null;
}

// Every tier of every mode for this site, and whether it can be bought now and why not.
export function offers(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext): Offer[] {
  const out: Offer[] = [];
  const can = reachOf(spec, ctx), now = levelCap(spec, st, can);
  const verb = makesAny(spec) ? 'makes' : 'takes';
  for (const mode of MODES) {
    const cur = terminalFor(st, mode), curRank = cur ? TIERS[cur.tier].rank : 0;
    const notHere = modeOffered(spec, ctx, mode), enough = enoughIn(spec, mode, ctx.year);
    for (const tier of LADDER[mode]) {
      const T = TIERS[tier], fits = fitOffers(spec, tier, ctx), best = bestFit(fits);
      const without = cur && cur.status === 'open' && can[mode] !== false ? now - levelsAt(spec, cur) : now;
      const withIt = without + levelsAt(spec, { tier, fit: best.fit });
      const gain = now > 0 ? withIt / now : Infinity;
      // half the current terminal comes off the price (ground works and track are reused), but
      // not for one the site came with: the player never paid for it
      const trade = cur && !cur.builtIn ? 0.5 * tierCost(cur.tier, cur.fit) : 0;
      const o: Offer = { mode, tier, rank: T.rank, status: 'available', fit: best.fit, cost: Math.max(0, best.cost - trade), upkeep: T.upkeep, buildDays: T.buildDays, tph: best.tph, gain, reason: '', fits };
      const pendingHere = cur?.pending?.tier === tier;
      if (notHere) { o.status = 'not_offered'; o.reason = notHere; o.block = spec.modes.includes(mode) ? 'water' : 'mode'; }
      else if (cur && (cur.tier === tier || pendingHere)) {
        o.fit = pendingHere ? cur.pending!.fit : cur.fit;
        o.cost = 0;
        o.status = cur.status === 'building' || pendingHere ? 'building' : 'owned';
        const ready = pendingHere ? cur.pending!.ready : cur.ready;
        o.reason = o.status === 'building' ? `Being built: opens on day ${ready}` : cur.status === 'mothballed' ? 'Mothballed: reopen it to use it' : `Moves ${tph(tphAt(spec, cur))}`;
      } else if (T.rank < curRank) { o.status = 'superseded'; o.block = 'superseded'; o.reason = `Part of the ${lc(TIERS[cur!.tier].name)}`; }
      else if (enough && T.rank > TIERS[enough.tier].rank) {
        o.status = 'not_offered'; o.block = 'oversized';
        const kit = enough.fit === 'standard' ? '' : ` with ${lc(FITS[enough.fit].name)}`;
        o.reason = `Not needed: ${called(enough.tier)}${kit} can move all the ${lc(spec.name)} ${verb} at full production`;
      } else if (!inEra(T.era, ctx.year)) { o.status = 'era'; o.block = 'era'; o.reason = `From ${T.era[0]}`; }
      else if (T.rank > st.grade) {
        o.status = 'locked'; o.block = 'grade';
        o.reason = T.rank > st.grade + 1 ? 'Unlocks as the site grows' : 'Unlocks when output presses against what the terminals can move';
      } else if (mode === 'rail' && !ctx.rail) { o.status = 'blocked'; o.block = 'rail'; o.reason = 'Needs a rail line to the site'; }
      else if (mode === 'road' && ctx.road === false) { o.status = 'blocked'; o.block = 'road'; o.reason = 'Needs a road to the site'; }
      else {
        const room = ctx.room?.(mode, tier);
        if (room) { o.status = 'blocked'; o.block = 'room'; o.reason = room; }
        else o.reason = now > 0 ? `Moves ${tph(o.tph)}: ${times(gain)} what the site can move now` : `Moves ${tph(o.tph)}`;
      }
      const busy = cur?.pending?.tier ?? (cur?.status === 'building' ? cur.tier : null);
      if (busy && !pendingHere && o.status === 'available') { o.status = 'blocked'; o.block = 'busy'; o.reason = `Wait for the ${lc(TIERS[busy].name)} to open`; }
      out.push(o);
    }
  }
  return out;
}

export type SuggestReason = 'unserved' | 'stockpiling' | 'queueing' | 'capped' | 'stuck' | 'underused' | 'idle' | 'unreached';
export interface Suggestion { reason: SuggestReason; text: string; offer?: Offer }

// The one thing worth telling the player about this site's terminals now, if anything.
export function suggest(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext, level: number, flows?: SiteFlows, p?: Pressure): Suggestion | null {
  const name = spec.name;
  const idle = st.terminals.find((t) => t.status === 'open' && t.idle >= IDLE_WARN_DAYS);
  if (idle) {
    const T = TIERS[idle.tier];
    return { reason: 'idle', text: `The ${lc(T.name)} has had no ${MODE_NAME[idle.mode].vehicles} for ${Math.floor(idle.idle)} days and costs ${money(T.upkeep)} a day` };
  }
  const shut = st.terminals.find((t) => t.status === 'mothballed');
  if (shut && !openOnes(st).length) {
    return { reason: 'idle', text: `The ${lc(TIERS[shut.tier].name)} is mothballed: reopening it costs ${money(REOPEN_COST * tierCost(shut.tier, shut.fit))}` };
  }
  const can = reachOf(spec, ctx);
  const cut = openOnes(st).find((t) => can[t.mode] === false);
  if (cut && !working(st, can).length) {
    return { reason: 'unreached', text: `No ${MODE_NAME[cut.mode].vehicle} can reach the ${lc(TIERS[cut.tier].name)}: ${cut.mode === 'rail' ? 'it needs a rail line to the site' : cut.mode === 'road' ? 'it needs a road to the site' : 'it needs water to the site'}` };
  }
  const pr = p ?? (flows ? pressure(spec, st, flows, false, reachOf(spec, ctx, flows.served)) : null);
  if (pr?.underused) {
    const t = working(st, can).sort((a, b) => TIERS[b.tier].rank - TIERS[a.tier].rank)[0] ?? openOnes(st)[0];
    return { reason: 'underused', text: `Add ${MODE_NAME[t.mode].vehicles}: the ${lc(TIERS[t.tier].name)} is only ${Math.round(pr.utilisation * 100)}% used` };
  }
  const all = offers(spec, st, ctx), avail = all.filter((o) => o.status === 'available');
  const cap = levelCap(spec, st, can);
  // What's holding the site back. A site that makes things is held back by its stockyard
  // filling; one that only takes them in (a power station, a town) by vehicles waiting to unload.
  const why = !pr?.pressing ? null
    : pr.stockpiling && makesAny(spec) ? { reason: 'stockpiling' as const, head: `${name} output is stockpiling` }
    : pr.queueing ? { reason: 'queueing' as const, head: `${upper(MODE_NAME[pr.queueing].vehicles)} are queueing at the ${lc(TIERS[terminalFor(st, pr.queueing)!.tier].name)}` }
    : { reason: 'capped' as const, head: `${name} can't grow past ${Math.round(Math.min(MAX_LEVEL, cap) * 100)}% until more can be moved` };
  if (!avail.length) {
    if (!why || cap === 0) return null;
    // nothing can be bought: say what stands in the way of the smallest bigger terminal
    const stuck = all.filter((o) => (o.status === 'blocked' || o.status === 'era') && o.gain > 1).sort((a, b) => a.rank - b.rank || b.gain - a.gain)[0];
    return { reason: 'stuck', text: stuck ? `${why.head}. ${TIERS[stuck.tier].name}: ${lc(stuck.reason)}` : `${why.head}, and its terminals are as big as they come` };
  }
  // the cheapest that lets the site keep growing; failing that, the one that moves most. Vehicles
  // queueing at one terminal are answered with a bigger one of the same mode where there is one.
  const nextStep = Math.min(MAX_LEVEL, Math.max(1, level) * GROWTH);
  const pick = (list: Offer[]) => {
    const clears = list.filter((o) => (cap > 0 ? cap * o.gain : levelsAt(spec, o)) >= nextStep).sort((a, b) => a.cost - b.cost);
    return clears[0] ?? [...list].sort((a, b) => b.gain - a.gain || a.cost - b.cost)[0];
  };
  const sameMode = why?.reason === 'queueing' ? avail.filter((o) => o.mode === pr!.queueing) : [];
  const best = pick(sameMode.length ? sameMode : avail);
  const would = cap > 0 ? `would move ${times(best.gain)} more` : `would move ${tph(best.tph)}`;
  const what = `${called(best.tier)} ${would}`;
  if (cap === 0 && makesAny(spec)) return { reason: 'unserved', offer: best, text: `Nothing collects from the ${lc(name)} yet: ${what}` };
  if (cap === 0) return { reason: 'unserved', offer: best, text: `Nothing can unload at the ${lc(name)} yet: ${what}` };
  if (!why) return null;
  if (why.reason === 'queueing') return { reason: 'queueing', offer: best, text: sameMode.length ? `${why.head}: ${called(best.tier)} serves ${TIERS[best.tier].berths} at once` : `${why.head}: ${what}` };
  return { reason: why.reason, offer: best, text: `${why.head}: ${what}` };
}

// ---------------- reviews: growth and unlocking ----------------
export type EventKind = 'unlocked' | 'bought' | 'opened' | 'upgraded' | 'refitted' | 'cancelled' | 'removed' | 'reopened' | 'idle' | 'mothballed' | 'downgraded' | 'closed';
export interface TerminalEvent { kind: EventKind; mode: Mode; tier?: TierId; text: string }

export interface ReviewResult {
  level: number;
  frac: number; // share of output collected (of input capacity taken, for sinks and towns)
  capped: boolean;
  pressure: Pressure;
  st: SiteTerminals;
  unlocked: TierId[];
  events: TerminalEvent[];
  suggestion: Suggestion | null;
}

// The 2D game's review, held to what the terminals vehicles can reach are able to move:
//  - more than the terminals can move: it eases back x0.96 a review to what they can, and counts
//    as capped (a terminal demolished or cut off)
//  - over 60% collected: x1.12, up to 4, but not past what they can move (capped when it would)
//  - under 15% collected: x0.96, not below 1
//  - otherwise steady, unless the stockyard is full: then what's made is going to waste, so it
//    eases back x0.96 until what's collected is 60% of it
// and the next rank opened up when that's what's holding it back.
export function review(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext, level: number, flows: SiteFlows): ReviewResult {
  const makes = makesAny(spec);
  const frac = makes ? (flows.produced > 0 ? flows.moved / flows.produced : 0) : (flows.unloaded ?? 0) / Math.max(1e-9, inAt(spec, Math.max(1, level)));
  const can = reachOf(spec, ctx, flows.served);
  const cap = levelCap(spec, st, can), room = Math.max(1, cap);
  let next = level, capped = false;
  if (level > room + 1e-9) { next = Math.max(room, level * DECLINE); capped = true; }
  else if (frac > GROW_ABOVE && level < MAX_LEVEL) {
    const want = Math.min(MAX_LEVEL, level * GROWTH);
    if (want > room + 1e-9) { next = Math.max(level, room); capped = true; } else next = want;
  } else if (frac < FALL_BELOW && level > 1) next = Math.max(1, level * DECLINE);
  else if (makes && flows.stockFill >= 0.9 && level > 1) {
    const target = Math.max(1, (frac * level) / GROW_ABOVE);
    if (level > target + 1e-9) next = Math.max(target, level * DECLINE);
  }
  const pr = pressure(spec, st, flows, capped, can);
  const events: TerminalEvent[] = [];
  let out = st;
  let unlocked: TierId[] = [];
  // open up the next rank once a terminal of the current one has worked: open, reachable and
  // called at (by the economy's word, or failing that not idle for a month). One being built or
  // mothballed hasn't, so a site nobody serves can't be walked up the ladder.
  const worked = working(st, can).filter((t) => flows.served?.[t.mode] ?? t.idle < IDLE_WARN_DAYS);
  if (pr.pressing && st.grade < 3 && Math.max(0, ...worked.map((t) => TIERS[t.tier].rank)) >= st.grade) {
    const grade = (st.grade + 1) as Rank;
    out = { ...st, grade };
    // only what the site could buy now: not a rail tier without a rail line, nor one it'll never need
    unlocked = offers(spec, out, ctx).filter((o) => o.rank === grade && o.status === 'available').map((o) => o.tier);
  }
  const suggestion = suggest(spec, out, ctx, next, flows, pr);
  if (unlocked.length) {
    const why = suggestion?.text ?? `${spec.name} is outgrowing its terminals`;
    events.push({ kind: 'unlocked', mode: TIERS[unlocked[0]].mode, tier: unlocked[0], text: `${why}. Now available: ${unlocked.map((id) => lc(TIERS[id].name)).join(', ')}.` });
  }
  return { level: next, frac, capped, pressure: pr, st: out, unlocked, events, suggestion };
}

// ---------------- buying, refitting and removing ----------------
export type Purchase =
  | { kind: 'build'; mode: Mode; tier: TierId; fit?: FitId }
  | { kind: 'refit'; mode: Mode; fit: FitId }
  | { kind: 'cancel'; mode: Mode }
  | { kind: 'remove'; mode: Mode }
  | { kind: 'reopen'; mode: Mode };
export type ApplyResult = { ok: true; st: SiteTerminals; cost: number; events: TerminalEvent[] } | { ok: false; reason: string };

export const REMOVE_REFUND = 0.25; // of the list price of a working terminal demolished
export const CANCEL_REFUND = 0.5; // of what was paid for work not yet finished
export const REOPEN_COST = 0.1;

// Apply a purchase to a site's terminals. Returns the new state and what it cost (negative for a
// refund); never mutates `st`. Upgrades and refits are built alongside: the old terminal works
// until the new one opens. Work not yet finished can be cancelled for half what it cost, and
// demolishing a terminal with an upgrade under way cancels the upgrade too.
export function apply(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext, p: Purchase): ApplyResult {
  const day = ctx.day ?? 0;
  const cur = terminalFor(st, p.mode);
  const others = st.terminals.filter((t) => t !== cur);
  const T = (tier: TierId) => TIERS[tier];
  if (p.kind === 'build') {
    const o = offers(spec, st, ctx).find((x) => x.mode === p.mode && x.tier === p.tier);
    if (!o) return { ok: false, reason: 'No such terminal' };
    if (o.status !== 'available') return { ok: false, reason: o.reason };
    const fit = p.fit ?? o.fit, fo = o.fits.find((f) => f.fit === fit);
    if (!fo) return { ok: false, reason: `A ${lc(T(p.tier).name)} can't take a ${lc(FITS[fit].name)}` };
    if (!fo.ok) return { ok: false, reason: `${FITS[fit].name}: ${fo.reason}` };
    const cost = Math.max(0, fo.cost - (cur && !cur.builtIn ? 0.5 * tierCost(cur.tier, cur.fit) : 0));
    const ready = day + T(p.tier).buildDays;
    const t: Terminal = cur ? { ...cur, pending: { tier: p.tier, fit, ready, paid: cost } } : { mode: p.mode, tier: p.tier, fit, status: 'building', ready, idle: 0, paid: cost };
    return { ok: true, st: { ...st, terminals: [...others, t] }, cost, events: [{ kind: 'bought', mode: p.mode, tier: p.tier, text: `${T(p.tier).name} ordered: opens in ${T(p.tier).buildDays} days` }] };
  }
  if (!cur) return { ok: false, reason: `There's no ${MODE_NAME[p.mode].name.toLowerCase()} terminal here` };
  const unfinished = (t: Terminal) => (t.status === 'building' ? CANCEL_REFUND * (t.paid ?? tierCost(t.tier, t.fit)) : 0);
  const pendingBack = (t: Terminal) => CANCEL_REFUND * (t.pending?.paid ?? 0);
  if (p.kind === 'refit') {
    const tier = cur.pending?.tier ?? cur.tier, fo = fitOffers(spec, tier, ctx).find((f) => f.fit === p.fit);
    if (!fo) return { ok: false, reason: `A ${lc(T(tier).name)} can't take a ${lc(FITS[p.fit].name)}` };
    if (!fo.ok) return { ok: false, reason: `${FITS[p.fit].name}: ${fo.reason}` };
    if (cur.status !== 'open' && !cur.pending) return { ok: false, reason: cur.status === 'building' ? 'Wait for it to open' : 'Reopen it first' };
    if (cur.pending) {
      // switching an unfinished refit back to the kit already fitted is cancelling it
      if (cur.pending.tier === cur.tier && p.fit === cur.fit) return apply(spec, st, ctx, { kind: 'cancel', mode: p.mode });
      // dearer kit is paid for in full; cheaper kit gives back only what cancelling would
      const diff = T(tier).cost * (FITS[p.fit].extra - FITS[cur.pending.fit].extra);
      const extra = Math.round(diff >= 0 ? diff : CANCEL_REFUND * diff);
      return { ok: true, st: { ...st, terminals: [...others, { ...cur, pending: { ...cur.pending, fit: p.fit, paid: (cur.pending.paid ?? 0) + extra } }] }, cost: extra, events: [] };
    }
    if (cur.fit === p.fit) return { ok: false, reason: 'Already fitted' };
    const ready = day + Math.ceil(T(tier).buildDays / 3), cost = Math.round(T(tier).cost * FITS[p.fit].extra);
    return { ok: true, st: { ...st, terminals: [...others, { ...cur, pending: { tier, fit: p.fit, ready, paid: cost } }] }, cost, events: [{ kind: 'refitted', mode: p.mode, tier, text: `${FITS[p.fit].name} ordered for the ${lc(T(tier).name)}` }] };
  }
  if (p.kind === 'cancel') {
    if (cur.pending) {
      const what = cur.pending.tier === cur.tier ? `The ${lc(FITS[cur.pending.fit].name)}` : `The ${lc(T(cur.pending.tier).name)}`;
      return { ok: true, st: { ...st, terminals: [...others, { ...cur, pending: undefined }] }, cost: -Math.round(pendingBack(cur)), events: [{ kind: 'cancelled', mode: p.mode, tier: cur.pending.tier, text: `${what} was cancelled; half its cost is back` }] };
    }
    if (cur.status === 'building') return { ok: true, st: { ...st, terminals: others }, cost: -Math.round(unfinished(cur)), events: [{ kind: 'cancelled', mode: p.mode, tier: cur.tier, text: `${T(cur.tier).name} cancelled; half its cost is back` }] };
    return { ok: false, reason: 'Nothing is being built there' };
  }
  if (p.kind === 'remove') {
    if (cur.builtIn) return { ok: false, reason: `The ${lc(T(cur.tier).name)} is part of the ${lc(spec.name)}` };
    const refund = (cur.status === 'building' ? unfinished(cur) : REMOVE_REFUND * tierCost(cur.tier, cur.fit)) + pendingBack(cur);
    // a site that came with a terminal in this mode keeps it: what's demolished is what was built on
    const base = spec.id === 'town' ? undefined : baseOf(spec.id, p.mode);
    const left = base ? [...others, { ...base, idle: cur.idle, warned: cur.warned, status: cur.status === 'mothballed' ? 'mothballed' as const : 'open' as const }] : others;
    return { ok: true, st: { ...st, terminals: left }, cost: -Math.round(refund), events: [{ kind: 'removed', mode: p.mode, tier: cur.tier, text: `${T(cur.tier).name} demolished${base ? `; the ${lc(spec.name)}' own ${lc(T(base.tier).name)} is still there` : ''}` }] };
  }
  if (cur.status !== 'mothballed') return { ok: false, reason: 'It is not mothballed' };
  return { ok: true, st: { ...st, terminals: [...others, { ...cur, status: 'open', idle: 0, warned: false }] }, cost: Math.round(REOPEN_COST * tierCost(cur.tier, cur.fit)), events: [{ kind: 'reopened', mode: p.mode, tier: cur.tier, text: `${T(cur.tier).name} reopened` }] };
}

// ---------------- the passing of days: building, upkeep, and idle terminals ----------------
export const IDLE_WARN_DAYS = 30;
export const IDLE_MOTHBALL_DAYS = 90;
export const IDLE_CUT_DAYS = 365; // a year without traffic and a mothballed terminal is cut back a rank
export const MOTHBALL_UPKEEP = 0.2;

export function tick(spec: SiteSpec, st: SiteTerminals, days: number, served: Partial<Record<Mode, boolean>>, day: number) {
  const events: TerminalEvent[] = [];
  let upkeep = 0;
  const keep: Terminal[] = [];
  // a day's upkeep: none for what the site came with, a fifth while mothballed
  const cost = (t: Terminal) => (t.builtIn ? 0 : TIERS[t.tier].upkeep * (t.status === 'mothballed' ? MOTHBALL_UPKEEP : 1));
  for (const t0 of st.terminals) {
    let t = { ...t0 };
    const name = () => TIERS[t.tier].name;
    // days of this tick after `ready`: only those are charged and aged at what opened then
    const since = (ready: number) => Math.max(0, Math.min(days, day - ready));
    let live = days; // days this tick the terminal was open (or mothballed) as it now stands
    if (t.status === 'building') {
      if (day < t.ready) { keep.push(t); continue; } // a building site: no upkeep, doesn't age
      live = since(t.ready);
      t.status = 'open'; t.idle = 0; delete t.paid;
      events.push({ kind: 'opened', mode: t.mode, tier: t.tier, text: `${name()} open at the ${lc(spec.name)}` });
    }
    if (t.pending && day >= t.pending.ready) {
      const up = t.pending.tier !== t.tier, after = since(t.pending.ready);
      // the old terminal worked, and cost its upkeep, until the new one took over
      upkeep += cost(t) * (live - after);
      live = after;
      // an upgrade the player paid for is theirs, even on top of a terminal the site came with; new
      // kit on the same terminal changes nothing about how long it has stood unused
      t = up
        ? { ...t, tier: t.pending.tier, fit: t.pending.fit, status: 'open', idle: 0, warned: false, pending: undefined, builtIn: undefined }
        : { ...t, fit: t.pending.fit, pending: undefined };
      events.push({ kind: up ? 'upgraded' : 'refitted', mode: t.mode, tier: t.tier, text: up ? `${name()} open at the ${lc(spec.name)}` : `${FITS[t.fit].name} working at the ${lc(name())}` });
    }
    const T = TIERS[t.tier];
    upkeep += cost(t) * live;
    // an upgrade under way: the old terminal keeps its place and its idle clock until it opens
    if (t.pending && t.pending.tier !== t.tier) { keep.push(t); continue; }
    // the docks' own quay is the docks' to run: it neither costs the player nor ages
    if (t.builtIn) { keep.push(t); continue; }
    if (t.status === 'open' && served[t.mode]) { t.idle = 0; t.warned = false; keep.push(t); continue; }
    t.idle += live;
    const v = MODE_NAME[t.mode].vehicles;
    if (t.status === 'open' && t.idle >= IDLE_WARN_DAYS && !t.warned) {
      t.warned = true;
      events.push({ kind: 'idle', mode: t.mode, tier: t.tier, text: `The ${lc(spec.name)}'s ${lc(T.name)} has had no ${v} for ${Math.floor(t.idle)} days; it costs ${money(T.upkeep)} a day` });
    }
    if (t.status === 'open' && t.idle >= IDLE_MOTHBALL_DAYS) {
      t.status = 'mothballed';
      events.push({ kind: 'mothballed', mode: t.mode, tier: t.tier, text: `The ${lc(spec.name)}'s ${lc(T.name)} has been mothballed after ${Math.floor(t.idle)} days without ${v}` });
    }
    if (t.status === 'mothballed' && t.idle >= IDLE_CUT_DAYS && !t.builtIn) {
      const base = spec.id === 'town' ? undefined : baseOf(spec.id, t.mode);
      if (T.rank > 1) {
        const lower = tierAt(t.mode, (T.rank - 1) as Rank);
        const fit = lower.fits.includes(t.fit) ? t.fit : 'standard';
        events.push({ kind: 'downgraded', mode: t.mode, tier: lower.id, text: `The ${lc(spec.name)}'s unused ${lc(T.name)} has been cut back to ${called(lower.id)}` });
        // back to what the site came with, it's the site's own again and goes no further
        t = { ...t, tier: lower.id, fit, idle: IDLE_MOTHBALL_DAYS, builtIn: base?.tier === lower.id ? true : undefined };
      } else {
        events.push({ kind: 'closed', mode: t.mode, tier: t.tier, text: `The ${lc(spec.name)}'s ${lc(T.name)} has closed after a year without ${v}` });
        continue;
      }
    }
    keep.push(t);
  }
  return { st: { ...st, terminals: keep }, upkeep, events };
}

// ---------------- the economy-facing summary ----------------
export interface TerminalReport {
  capacity: SiteCapacity;
  production: { level: number; out: number; in: number }; // t/h at the current level
  dwell: (mode: Mode, cargo: CargoId, load: number, dir?: Dir) => number | null; // hours, or null with no working terminal there
  offers: Offer[];
  suggestion: Suggestion | null;
}
// Everything the economy and the station UI need about one site's terminals, in one call.
export function report(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext, level: number, flows?: SiteFlows): TerminalReport {
  const can = reachOf(spec, ctx, flows?.served);
  return {
    capacity: capacity(spec, st, can),
    production: { level, out: outAt(spec, level), in: inAt(spec, level) },
    dwell: (mode, cargo, load, dir = 'load') => { const t = terminalFor(st, mode); return t && t.status === 'open' && can[mode] !== false ? dwellHours(t, cargo, load, dir) : null; },
    offers: offers(spec, st, ctx),
    suggestion: suggest(spec, st, ctx, level, flows),
  };
}
