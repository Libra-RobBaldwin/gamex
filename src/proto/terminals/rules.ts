// The rules that make terminals the upgrade path. Pure functions over plain data, so the economy,
// the UI and the tests share them and a save only needs SiteTerminals.
//
// The idea: an industry's production level (1 to 4, rising x1.12 a review while over 60% of its
// output is collected, as in the 2D game) can't rise past what its terminals can move. When output
// presses against that limit (stock piling up with the terminals busy, vehicles queueing for a
// berth, or growth held back), the next rank of terminal becomes available to buy, and suggest()
// says why in plain words. Terminals left without traffic are warned about, mothballed, then cut
// back a rank, and a starter terminal is finally closed.
import { INDUSTRY_TYPES, TOWN_ACCEPTS, type CargoId, type IndustryId, type IndustryType, type Role, type Variant } from '../industries/catalogue';
import {
  CARGO_CLASS, FITS, LADDER, MODE_NAME, MODE_OF, MODES, REFERENCE_LOAD, SIM_SECONDS_PER_HOUR, STOP_HOURS, TIERS,
  inEra, suitOf, tierAt, tierCost, type FitId, type Mode, type Rank, type TierId,
} from './catalogue';

type Flows = Partial<Record<CargoId, number>>;

// ---------------- what a site moves ----------------
// A site as the terminal rules see it: what it sends and receives an hour at production level 1.
// Built from an industry type, or from a town for a goods depot.
export interface SiteSpec {
  id: IndustryId | 'town';
  name: string;
  role: Role | 'town';
  modes: Mode[]; // modes that could ever serve it
  waterside?: 'required' | 'optional';
  out: Flows; // t/h at level 1, with full inputs for a processor
  in: Flows; // t/h at level 1; for 'any' mixes and hubs, the expected share of each
  catchment: number;
}

const perHour = (amount: number, rate: number) => amount * rate * SIM_SECONDS_PER_HOUR;

export function specFor(type: IndustryType | IndustryId, variant?: Variant): SiteSpec {
  const t = typeof type === 'string' ? INDUSTRY_TYPES[type] : type;
  // A cycle of an 'any' processor, a hub or a gateway's exports takes one of its inputs, so each
  // input's expected share is split between them; 'all' needs every one each cycle.
  const oneOf = t.mix === 'any' || t.role === 'hub' || t.role === 'gateway';
  const inn: Flows = {}, out: Flows = {};
  for (const f of t.inputs) inn[f.cargo] = perHour(f.amount, t.rate) / (oneOf ? t.inputs.length : 1);
  for (const f of t.outputs) out[f.cargo] = (perHour(f.amount, t.rate) * (variant?.outputScale?.[f.cargo] ?? 1)) / (t.role === 'hub' ? t.outputs.length : 1);
  return { id: t.id, name: t.name, role: t.role, modes: [...new Set(t.serve.map((k) => MODE_OF[k]))], waterside: t.waterside, out, in: inn, catchment: t.catchment };
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
  builtIn?: boolean; // came with the site (the docks' quay); can't be removed or closed
  pending?: { tier: TierId; fit: FitId; ready: number }; // an upgrade or refit being built; this one works meanwhile
}
// Everything a save needs per site. `grade` is the highest rank growth has made available; it
// only ever rises, so a dip in trade doesn't take an option away.
export interface SiteTerminals { terminals: Terminal[]; grade: Rank }

export function startingTerminals(id: IndustryId | 'town'): SiteTerminals {
  // the docks are a quay already: they come with one, and can grow to a bulk or container terminal
  if (id === 'port') return { terminals: [{ mode: 'water', tier: 'quay', fit: 'standard', status: 'open', ready: 0, idle: 0, builtIn: true }], grade: 2 };
  return { terminals: [], grade: 1 };
}

export const terminalFor = (st: SiteTerminals, mode: Mode) => st.terminals.find((t) => t.mode === mode);
// What to draw for each terminal: the tier being built when an upgrade or refit is under way.
export const shownFor = (st: SiteTerminals) => st.terminals.map((t) => ({ mode: t.mode, tier: t.pending?.tier ?? t.tier, fit: t.pending?.fit ?? t.fit }));
const openOnes = (st: SiteTerminals) => st.terminals.filter((t) => t.status === 'open');
const ownedRank = (st: SiteTerminals) => Math.max(0, ...st.terminals.map((t) => TIERS[t.tier].rank));

// ---------------- capacity ----------------
// A tier and its handling kit: all the rates need to know about a terminal.
export type Handling = { tier: TierId; fit: FitId };
// t/h one berth moves of a cargo
export const berthRate = (h: Handling, c: CargoId) => TIERS[h.tier].perBerth * suitOf(h.fit, CARGO_CLASS[c]);

// How many production levels' worth of this site's traffic (in and out together: a berth is either
// loading or unloading) a terminal can handle an hour. Terminals work in parallel, so they add.
export function levelsAt(spec: SiteSpec, h: Handling) {
  let hours = 0;
  for (const [c, v] of Object.entries(spec.out) as [CargoId, number][]) hours += v / berthRate(h, c);
  for (const [c, v] of Object.entries(spec.in) as [CargoId, number][]) hours += v / berthRate(h, c);
  return hours > 0 ? TIERS[h.tier].berths / hours : 0;
}
export const levelCap = (spec: SiteSpec, st: SiteTerminals) => openOnes(st).reduce((s, t) => s + levelsAt(spec, t), 0);
// t/h of this site's own mix a terminal moves, in and out together
export const tphAt = (spec: SiteSpec, h: Handling) => levelsAt(spec, h) * (sum(spec.out) + sum(spec.in));

export interface ModeCapacity { tier: TierId; fit: FitId; status: TerminalStatus; levels: number; tph: number; berths: number; stock: number }
export interface SiteCapacity {
  levelCap: number; // the production level the open terminals keep up with; above 4 means room to spare
  load: number; // t/h they can load of the site's outputs at that level
  unload: number; // t/h they can unload of its inputs
  perCargo: Flows; // t/h of each cargo at that level
  byMode: Partial<Record<Mode, ModeCapacity>>;
  berths: number;
  stock: number;
  catchment: number; // the industry's own plus the best terminal's bonus
}

export function capacity(spec: SiteSpec, st: SiteTerminals): SiteCapacity {
  const cap = levelCap(spec, st);
  const perCargo: Flows = {};
  for (const [c, v] of [...Object.entries(spec.out), ...Object.entries(spec.in)] as [CargoId, number][]) perCargo[c] = (perCargo[c] ?? 0) + v * cap;
  const byMode: Partial<Record<Mode, ModeCapacity>> = {};
  for (const t of st.terminals) {
    const on = t.status === 'open', T = TIERS[t.tier];
    byMode[t.mode] = { tier: t.tier, fit: t.fit, status: t.status, levels: on ? levelsAt(spec, t) : 0, tph: on ? tphAt(spec, t) : 0, berths: on ? T.berths : 0, stock: on ? T.stock : 0 };
  }
  const open = openOnes(st);
  return {
    levelCap: cap, load: outAt(spec, cap), unload: inAt(spec, cap), perCargo, byMode,
    berths: open.reduce((s, t) => s + TIERS[t.tier].berths, 0),
    stock: open.reduce((s, t) => s + TIERS[t.tier].stock, 0),
    catchment: spec.catchment + Math.max(0, ...open.map((t) => TIERS[t.tier].catchment)),
  };
}

// How long a vehicle with `load` tonnes stands at the terminal: a fixed part (positioning, running
// round, hoses, which better tiers and kit shorten) plus the time its berth takes to fill it.
export function dwellHours(h: Handling, cargo: CargoId, load: number) {
  const T = TIERS[h.tier];
  return STOP_HOURS[T.mode] * T.manoeuvre * FITS[h.fit].dwell + load / berthRate(h, cargo);
}
// The same as a multiple of a starter terminal's stop, for a typical vehicle: the factor to put
// on the 2D game's LOAD_TIME.
export function dwellFactor(h: Handling, cargo: CargoId) {
  const mode = TIERS[h.tier].mode, ref: Handling = { tier: LADDER[mode][0], fit: 'standard' };
  return dwellHours(h, cargo, REFERENCE_LOAD[mode]) / dwellHours(ref, cargo, REFERENCE_LOAD[mode]);
}

// ---------------- sharing output between terminals ----------------
// How an hour's output (or what's in the stockyard) splits between the terminals vehicles are
// calling at. Each cargo leans towards the terminal that is comparatively best at it, not just
// fastest: a rapid loader outpaces a lorry depot at crates too, but it's far better at coal, so the
// coal goes by rail and the crates by road. No terminal is given more than its berths can move or
// its vehicles want to lift; whatever's left stays in the site's stockyard. `demand` is t/h the
// vehicles calling at each mode would lift; a mode with no vehicles gets nothing.
export function shareOutput(st: SiteTerminals, available: Flows, demand: Partial<Record<Mode, number>>) {
  const byMode: Partial<Record<Mode, Flows>> = {};
  const left: Flows = { ...available };
  const live = openOnes(st).filter((t) => (demand[t.mode] ?? 0) > 0);
  const cargos = (Object.keys(available) as CargoId[]).filter((c) => (available[c] ?? 0) > 0);
  if (!live.length || !cargos.length) return { byMode, left };
  // first pass: each cargo split by how fast each terminal handles it, times how much better it
  // is at this cargo than at the others on offer (comparative advantage)
  const want = new Map<Terminal, Flows>(live.map((t) => [t, {}]));
  const mean = new Map(live.map((t) => [t, cargos.reduce((s, c) => s + berthRate(t, c), 0) / cargos.length]));
  for (const c of cargos) {
    const w = live.map((t) => (TIERS[t.tier].berths * berthRate(t, c) ** 2) / mean.get(t)!);
    const W = w.reduce((a, b) => a + b, 0);
    live.forEach((t, i) => { want.get(t)![c] = (available[c]! * w[i]) / W; });
  }
  // then scale each terminal down to what its berths and its vehicles can take
  for (const t of live) {
    const f = want.get(t)!;
    const hours = (Object.entries(f) as [CargoId, number][]).reduce((s, [c, v]) => s + v / berthRate(t, c), 0);
    const tonnes = sum(f);
    const k = Math.min(1, TIERS[t.tier].berths / Math.max(1e-9, hours), (demand[t.mode] ?? 0) / Math.max(1e-9, tonnes));
    const got: Flows = {};
    for (const [c, v] of Object.entries(f) as [CargoId, number][]) { got[c] = v * k; left[c] = (left[c] ?? 0) - v * k; }
    byMode[t.mode] = got;
  }
  for (const c of cargos) left[c] = Math.max(0, left[c] ?? 0);
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
  utilisation: number; // share of the terminals' berth time in use (can pass 1 when vehicles queue)
  stockpiling: boolean; // the output store is nearly full
  queueing: Mode | null; // where vehicles are waiting for a berth
  capped: boolean; // growth held back by what the terminals can move
  pressing: boolean; // growth is waiting on terminals: the next rank should open up
  underused: boolean; // stock piling up with the terminals mostly idle: it wants vehicles, not concrete
}

export function pressure(spec: SiteSpec, st: SiteTerminals, flows: SiteFlows, capped = false): Pressure {
  const cap = levelCap(spec, st), traffic = sum(spec.out) + sum(spec.in);
  const used = flows.moved + (flows.unloaded ?? 0);
  const utilisation = cap > 0 && traffic > 0 ? used / (cap * traffic) : 0;
  const q = Object.entries(flows.queue ?? {}).filter(([, v]) => (v ?? 0) >= 0.5).sort((a, b) => b[1]! - a[1]!)[0];
  const queueing = (q?.[0] as Mode | undefined) ?? null;
  const stockpiling = flows.stockFill >= 0.9;
  return {
    utilisation, stockpiling, queueing, capped,
    pressing: (stockpiling && utilisation >= 0.85) || !!queueing || capped,
    underused: stockpiling && cap > 0 && utilisation < 0.5,
  };
}

// A plausible month of traffic for a site, from its level, its terminals and how hard the player
// is working it: `lift` is how much of the output the vehicles calling try to take (1 = all of it),
// `supply` how much of a processor's inputs arrives. A stand-in until the economy reports its own.
export interface Service { lift?: number; supply?: number; hours?: number; stockFill?: number; store?: number }
export function estimateFlows(spec: SiteSpec, st: SiteTerminals, level: number, s: Service = {}): SiteFlows {
  const lift = s.lift ?? 1, supply = s.supply ?? 1, hours = s.hours ?? 30 * 24;
  const cap = levelCap(spec, st);
  const makes = spec.role === 'processor' || spec.role === 'hub' ? supply : 1;
  const produced = outAt(spec, level) * makes;
  const arrived = inAt(spec, level) * supply;
  // the berths are shared by loading and unloading, so both are held to the same share of demand
  const demandLevels = level * Math.max(makes * lift, supply);
  const q = demandLevels > 0 ? Math.min(1, cap / demandLevels) : 1;
  const store = (s.store ?? 600) + capacity(spec, st).stock; // 600: the 2D industry's own stockyard
  const prev = s.stockFill ?? 0.5;
  // what's collected: this month's output as far as vehicles and berths allow, plus some of the
  // stockyard when there's room to spare
  const lifted = produced * lift * q;
  const spare = Math.max(0, cap * (sum(spec.out) || 0) - lifted) * (lift > 0 ? 1 : 0);
  const drain = Math.min(prev * store, spare * hours) / hours;
  const moved = lifted + drain;
  const stockFill = Math.max(0, Math.min(1, prev + ((produced - moved) * hours) / store));
  const util = cap > 0 ? demandLevels / cap : 0;
  const queue: Partial<Record<Mode, number>> = {}, served: Partial<Record<Mode, boolean>> = {};
  for (const t of openOnes(st)) {
    queue[t.mode] = Math.max(0, util - 0.9) * 2 * TIERS[t.tier].berths;
    served[t.mode] = lift > 0 || supply > 0;
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
export type BlockCode = 'mode' | 'water' | 'superseded' | 'era' | 'grade' | 'rail' | 'road' | 'room' | 'busy';
export interface FitOffer { fit: FitId; cost: number; tph: number; ok: boolean; reason?: string }
export interface Offer {
  mode: Mode;
  tier: TierId;
  rank: Rank;
  status: OfferStatus;
  fit: FitId; // the kit that suits this site best
  cost: number; // what buying it costs now: less half the current tier's price when upgrading
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

// Every tier of every mode for this site, and whether it can be bought now and why not.
export function offers(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext): Offer[] {
  const out: Offer[] = [];
  const now = levelCap(spec, st);
  for (const mode of MODES) {
    const cur = terminalFor(st, mode), curRank = cur ? TIERS[cur.tier].rank : 0;
    const notHere = modeOffered(spec, ctx, mode);
    for (const tier of LADDER[mode]) {
      const T = TIERS[tier], fits = fitOffers(spec, tier, ctx), best = bestFit(fits);
      const without = cur && cur.status === 'open' ? now - levelsAt(spec, cur) : now;
      const withIt = without + levelsAt(spec, { tier, fit: best.fit });
      const gain = now > 0 ? withIt / now : Infinity;
      const trade = cur ? 0.5 * tierCost(cur.tier, cur.fit) : 0;
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
      else if (!inEra(T.era, ctx.year)) { o.status = 'era'; o.block = 'era'; o.reason = `From ${T.era[0]}`; }
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

export type SuggestReason = 'unserved' | 'stockpiling' | 'queueing' | 'capped' | 'stuck' | 'underused' | 'idle';
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
  const pr = p ?? (flows ? pressure(spec, st, flows) : null);
  if (pr?.underused) {
    const t = openOnes(st).sort((a, b) => TIERS[b.tier].rank - TIERS[a.tier].rank)[0];
    return { reason: 'underused', text: `Add ${MODE_NAME[t.mode].vehicles}: the ${lc(TIERS[t.tier].name)} is only ${Math.round(pr.utilisation * 100)}% used` };
  }
  const all = offers(spec, st, ctx), avail = all.filter((o) => o.status === 'available');
  const cap = levelCap(spec, st);
  // What's holding the site back. A site that makes things is held back by its stockyard
  // filling; one that only takes them in (a power station, a town) by vehicles waiting to unload.
  const why = !pr?.pressing ? null
    : pr.stockpiling && makesAny(spec) ? { reason: 'stockpiling' as const, head: `${name} output is stockpiling` }
    : pr.queueing ? { reason: 'queueing' as const, head: `${upper(MODE_NAME[pr.queueing].vehicles)} are queueing at the ${lc(TIERS[terminalFor(st, pr.queueing)!.tier].name)}` }
    : { reason: 'capped' as const, head: `${name} can't grow past ${Math.round(Math.min(4, cap) * 100)}% until more can be moved` };
  if (!avail.length) {
    if (!why || cap === 0) return null;
    // nothing can be bought: say what stands in the way of the smallest bigger terminal
    const stuck = all.filter((o) => (o.status === 'blocked' || o.status === 'era') && o.gain > 1).sort((a, b) => a.rank - b.rank || b.gain - a.gain)[0];
    return { reason: 'stuck', text: stuck ? `${why.head}. ${TIERS[stuck.tier].name}: ${lc(stuck.reason)}` : `${why.head}, and its terminals are as big as they come` };
  }
  // the cheapest that lets the site keep growing; failing that, the one that moves most. Vehicles
  // queueing at one terminal are answered with a bigger one of the same mode where there is one.
  const nextStep = Math.min(4, Math.max(1, level) * 1.12);
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
export type EventKind = 'unlocked' | 'bought' | 'opened' | 'upgraded' | 'refitted' | 'removed' | 'reopened' | 'idle' | 'mothballed' | 'downgraded' | 'closed';
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

// The 2D game's review (x1.12 above 60% collected, x0.96 below 15%, between 1 and 4), held to what
// the terminals can move, and the next rank opened up when that's what's holding it back.
export function review(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext, level: number, flows: SiteFlows): ReviewResult {
  const frac = makesAny(spec) ? (flows.produced > 0 ? flows.moved / flows.produced : 0) : (flows.unloaded ?? 0) / Math.max(1e-9, inAt(spec, Math.max(1, level)));
  const cap = levelCap(spec, st);
  let next = level, capped = false;
  if (frac > 0.6 && level < 4) {
    const want = Math.min(4, level * 1.12), room = Math.max(1, cap);
    if (want > room + 1e-9) { next = Math.max(level, Math.min(want, room)); capped = true; } else next = want;
  } else if (frac < 0.15 && level > 1) next = Math.max(1, level * 0.96);
  const pr = pressure(spec, st, flows, capped);
  const events: TerminalEvent[] = [];
  let out = st;
  const unlocked: TierId[] = [];
  // open up the next rank once the player has used the one they have
  if (pr.pressing && st.grade < 3 && ownedRank(st) >= st.grade) {
    const grade = (st.grade + 1) as Rank;
    out = { ...st, grade };
    for (const mode of MODES) {
      const t = tierAt(mode, grade);
      if (!modeOffered(spec, ctx, mode) && inEra(t.era, ctx.year)) unlocked.push(t.id);
    }
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
  | { kind: 'remove'; mode: Mode }
  | { kind: 'reopen'; mode: Mode };
export type ApplyResult = { ok: true; st: SiteTerminals; cost: number; events: TerminalEvent[] } | { ok: false; reason: string };

export const REMOVE_REFUND = 0.25;
export const REOPEN_COST = 0.1;

// Apply a purchase to a site's terminals. Returns the new state and what it cost (negative for a
// refund); never mutates `st`. Upgrades and refits are built alongside: the old terminal works
// until the new one opens.
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
    const cost = Math.max(0, fo.cost - (cur ? 0.5 * tierCost(cur.tier, cur.fit) : 0));
    const ready = day + T(p.tier).buildDays;
    const t: Terminal = cur ? { ...cur, pending: { tier: p.tier, fit, ready } } : { mode: p.mode, tier: p.tier, fit, status: 'building', ready, idle: 0 };
    return { ok: true, st: { ...st, terminals: [...others, t] }, cost, events: [{ kind: 'bought', mode: p.mode, tier: p.tier, text: `${T(p.tier).name} ordered: opens in ${T(p.tier).buildDays} days` }] };
  }
  if (!cur) return { ok: false, reason: `There's no ${MODE_NAME[p.mode].name.toLowerCase()} terminal here` };
  if (p.kind === 'refit') {
    const tier = cur.pending?.tier ?? cur.tier, fo = fitOffers(spec, tier, ctx).find((f) => f.fit === p.fit);
    if (!fo) return { ok: false, reason: `A ${lc(T(tier).name)} can't take a ${lc(FITS[p.fit].name)}` };
    if (!fo.ok) return { ok: false, reason: `${FITS[p.fit].name}: ${fo.reason}` };
    if (cur.status !== 'open' && !cur.pending) return { ok: false, reason: cur.status === 'building' ? 'Wait for it to open' : 'Reopen it first' };
    if (cur.pending) return { ok: true, st: { ...st, terminals: [...others, { ...cur, pending: { ...cur.pending, fit: p.fit } }] }, cost: Math.round(T(tier).cost * (FITS[p.fit].extra - FITS[cur.pending.fit].extra)), events: [] };
    if (cur.fit === p.fit) return { ok: false, reason: 'Already fitted' };
    const ready = day + Math.ceil(T(tier).buildDays / 3);
    return { ok: true, st: { ...st, terminals: [...others, { ...cur, pending: { tier, fit: p.fit, ready } }] }, cost: Math.round(T(tier).cost * FITS[p.fit].extra), events: [{ kind: 'refitted', mode: p.mode, tier, text: `${FITS[p.fit].name} ordered for the ${lc(T(tier).name)}` }] };
  }
  if (p.kind === 'remove') {
    if (cur.builtIn) return { ok: false, reason: `The ${lc(T(cur.tier).name)} is part of the ${lc(spec.name)}` };
    return { ok: true, st: { ...st, terminals: others }, cost: -Math.round(REMOVE_REFUND * tierCost(cur.tier, cur.fit)), events: [{ kind: 'removed', mode: p.mode, tier: cur.tier, text: `${T(cur.tier).name} demolished` }] };
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
  for (const t0 of st.terminals) {
    let t = { ...t0 };
    const name = () => TIERS[t.tier].name;
    if (t.status === 'building' && day >= t.ready) { t.status = 'open'; t.idle = 0; events.push({ kind: 'opened', mode: t.mode, tier: t.tier, text: `${name()} open at the ${lc(spec.name)}` }); }
    if (t.pending && day >= t.pending.ready) {
      const up = t.pending.tier !== t.tier;
      t = { ...t, tier: t.pending.tier, fit: t.pending.fit, status: 'open', idle: 0, warned: false, pending: undefined };
      events.push({ kind: up ? 'upgraded' : 'refitted', mode: t.mode, tier: t.tier, text: up ? `${name()} open at the ${lc(spec.name)}` : `${FITS[t.fit].name} working at the ${lc(name())}` });
    }
    const T = TIERS[t.tier];
    if (t.status === 'open') upkeep += T.upkeep * days;
    else if (t.status === 'mothballed') upkeep += T.upkeep * MOTHBALL_UPKEEP * days;
    if (t.status === 'building') { keep.push(t); continue; }
    if (t.status === 'open' && served[t.mode]) { t.idle = 0; t.warned = false; keep.push(t); continue; }
    t.idle += days;
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
      if (T.rank > 1) {
        const lower = tierAt(t.mode, (T.rank - 1) as Rank);
        const fit = lower.fits.includes(t.fit) ? t.fit : 'standard';
        events.push({ kind: 'downgraded', mode: t.mode, tier: lower.id, text: `The ${lc(spec.name)}'s unused ${lc(T.name)} has been cut back to ${called(lower.id)}` });
        t = { ...t, tier: lower.id, fit, idle: IDLE_MOTHBALL_DAYS, pending: undefined };
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
  dwell: (mode: Mode, cargo: CargoId, load: number) => number | null; // hours, or null with no open terminal
  offers: Offer[];
  suggestion: Suggestion | null;
}
// Everything the economy and the station UI need about one site's terminals, in one call.
export function report(spec: SiteSpec, st: SiteTerminals, ctx: SiteContext, level: number, flows?: SiteFlows): TerminalReport {
  return {
    capacity: capacity(spec, st),
    production: { level, out: outAt(spec, level), in: inAt(spec, level) },
    dwell: (mode, cargo, load) => { const t = terminalFor(st, mode); return t && t.status === 'open' ? dwellHours(t, cargo, load) : null; },
    offers: offers(spec, st, ctx),
    suggestion: suggest(spec, st, ctx, level, flows),
  };
}
