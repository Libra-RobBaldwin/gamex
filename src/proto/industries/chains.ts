// How industries link together, derived from the catalogue so it stays right when the numbers
// change: the supply-chain graph, the chains that end at towns, power stations and the docks,
// what each step adds, how many suppliers keep a processor busy, which chains are open in a
// given year, a plain-English line for each, and the production rule itself (mix, boosts, the
// docks' trades) for the economy to run. Pure data and functions; nothing here touches three.js.
import {
  CARGO, INDUSTRY_IDS, INDUSTRY_TYPES, TOWN_ACCEPTS, flowLive, inEra,
  type CargoId, type Flow, type IndustryId, type Role, type Variant,
} from './catalogue';

export type Era = [number, number | null];

const T = INDUSTRY_TYPES;
const CARGOS = Object.keys(CARGO) as CargoId[];

// The span the eras cover. Open-ended eras are reported up to LAST_YEAR.
export const FIRST_YEAR = Math.min(...INDUSTRY_IDS.map((id) => T[id].era[0]));
export const LAST_YEAR = 2050;
export const REPORT_YEARS = [1850, 1900, 1950, 2000];

// ---------------- era questions ----------------
// Can a new one be built in a year? A type's era limits new building only, so sites built earlier
// may run on; that only ever adds supply, so this is the strict test. No year means "ever".
export const buildable = (id: IndustryId, year?: number) => year === undefined || inEra(T[id].era, year);
export const inputsIn = (id: IndustryId, year?: number) => T[id].inputs.filter((f) => flowLive(f, year));
export const outputsIn = (id: IndustryId, year?: number) => T[id].outputs.filter((f) => flowLive(f, year));

// Who makes a cargo, and who takes it. Hubs pass cargo on rather than make it, so they only count
// as makers when asked.
export function makers(c: CargoId, year?: number, hubs = false): IndustryId[] {
  return INDUSTRY_IDS.filter((id) => (hubs || T[id].role !== 'hub') && buildable(id, year) && outputsIn(id, year).some((f) => f.cargo === c));
}
export function takers(c: CargoId, year?: number): { industries: IndustryId[]; towns: boolean } {
  return { industries: INDUSTRY_IDS.filter((id) => buildable(id, year) && inputsIn(id, year).some((f) => f.cargo === c)), towns: TOWN_ACCEPTS.includes(c) };
}

const overlap = (a: Era, b: Era): Era | null => {
  const s = Math.max(a[0], b[0]);
  const e = a[1] === null ? b[1] : b[1] === null ? a[1] : Math.min(a[1], b[1]);
  return e !== null && e < s ? null : [s, e];
};
const ALWAYS: Era = [FIRST_YEAR, null];
const flowEra = (id: IndustryId, f: Flow): Era | null => overlap(T[id].era, f.era ?? ALWAYS);

// ---------------- the graph ----------------
// Nodes are industry types, cargoes and 'town'. Produce edges run industry -> cargo, consume edges
// cargo -> industry or town, with the amounts per production cycle.
export type NodeId = IndustryId | 'town' | `cargo:${CargoId}`;

export interface ChainNode {
  id: NodeId;
  kind: 'industry' | 'cargo' | 'town';
  name: string;
  role?: Role;
  era: Era; // for an industry, the years new ones are built
}

export interface ChainEdge {
  kind: 'produce' | 'consume';
  from: NodeId;
  to: NodeId;
  cargo: CargoId;
  amount: number; // per cycle; 0 for towns, which take whatever arrives
  perSecond: number; // at production level 1
  optional: boolean; // a boost, not a need
  needsBoth: boolean; // one of two or more inputs a cycle needs at once (mix 'all')
  era: Era; // the years a site built then runs this edge: its type's era and the flow's, overlapped
}

export interface ChainGraph { nodes: ChainNode[]; edges: ChainEdge[] }

const required = (id: IndustryId) => T[id].inputs.filter((f) => !f.optional);
const needsBothAt = (id: IndustryId) => T[id].role === 'processor' && T[id].mix === 'all' && required(id).length >= 2;

// The whole graph, or only what can run in a year.
export function chainGraph(year?: number): ChainGraph {
  const nodes: ChainNode[] = [];
  const edges: ChainEdge[] = [];
  for (const id of INDUSTRY_IDS) {
    if (!buildable(id, year)) continue;
    const t = T[id];
    nodes.push({ id, kind: 'industry', name: t.name, role: t.role, era: t.era });
    for (const f of outputsIn(id, year)) {
      const era = flowEra(id, f);
      if (era) edges.push({ kind: 'produce', from: id, to: `cargo:${f.cargo}`, cargo: f.cargo, amount: f.amount, perSecond: f.amount * t.rate, optional: false, needsBoth: false, era });
    }
    for (const f of inputsIn(id, year)) {
      const era = flowEra(id, f);
      if (era) edges.push({ kind: 'consume', from: `cargo:${f.cargo}`, to: id, cargo: f.cargo, amount: f.amount, perSecond: f.amount * t.rate, optional: !!f.optional, needsBoth: !f.optional && needsBothAt(id), era });
    }
  }
  for (const c of CARGOS) nodes.push({ id: `cargo:${c}`, kind: 'cargo', name: CARGO[c].name, era: ALWAYS });
  nodes.push({ id: 'town', kind: 'town', name: 'Towns', era: ALWAYS });
  for (const c of TOWN_ACCEPTS) edges.push({ kind: 'consume', from: `cargo:${c}`, to: 'town', cargo: c, amount: 0, perSecond: 0, optional: false, needsBoth: false, era: ALWAYS });
  return { nodes, edges };
}

// Industry-to-industry links: what one can send another directly. A hub serves towns only, and
// the docks never ship to themselves (imports and exports of one cargo never overlap anyway).
export interface Link {
  from: IndustryId;
  to: IndustryId | 'town';
  cargo: CargoId;
  out: number; // made per cycle at `from`
  in: number; // used per cycle at `to` (0 for towns)
  optional: boolean;
  needsBoth: boolean;
  era: Era; // when both ends can be built with this flow running
}

export function links(year?: number): Link[] {
  const out: Link[] = [];
  for (const a of INDUSTRY_IDS) {
    if (!buildable(a, year)) continue;
    for (const f of outputsIn(a, year)) {
      const ea = flowEra(a, f);
      if (!ea) continue;
      for (const b of INDUSTRY_IDS) {
        if (a === b || !buildable(b, year) || T[a].role === 'hub' || (T[a].role === 'gateway' && T[b].role === 'gateway')) continue;
        const g = inputsIn(b, year).find((x) => x.cargo === f.cargo);
        const eb = g && flowEra(b, g);
        const era = eb && overlap(ea, eb);
        if (g && era) out.push({ from: a, to: b, cargo: f.cargo, out: f.amount, in: g.amount, optional: !!g.optional, needsBoth: !g.optional && needsBothAt(b), era });
      }
      if (TOWN_ACCEPTS.includes(f.cargo)) out.push({ from: a, to: 'town', cargo: f.cargo, out: f.amount, in: 0, optional: false, needsBoth: false, era: ea });
    }
  }
  return out;
}

// ---------------- chains ----------------
// A chain is one way of getting a product to someone who takes it for good: towns, a sink (the
// power station) or the docks for export. A processor with mix 'any' starts one chain per input
// it can run on; one with mix 'all' needs every required input, so they sit in one chain.

export interface Supply {
  cargo: CargoId;
  amount: number; // per cycle of the step it feeds
  optional: boolean;
  from: IndustryId[]; // primaries and the docks that dig it or ship it in
  made: Step[]; // or the processors that make it
}

export interface Step {
  id: IndustryId;
  mix: 'all' | 'any';
  needs: Supply[]; // a cycle takes all of these ('all'), or the one this chain runs on ('any')
  boosts: Supply[]; // optional inputs that multiply output by the type's boost
  makes: CargoId; // the output this chain follows
  amount: number; // of it per cycle
  also: Flow[]; // co-products made in the same cycle (a refinery's chemicals)
}

export interface ChainEnd { to: IndustryId | 'town'; era: Era }

export interface Chain {
  id: string; // the product, then '<' and the input an 'any' step runs on: 'goods<steel'
  name: string;
  product: CargoId;
  step: Step | null; // the last processor, or null for a raw cargo sent straight on
  from: IndustryId[]; // for a raw chain, who digs it or ships it in
  ends: ChainEnd[]; // who takes the product for good
  relays: IndustryId[]; // hubs it can pass through on the way to towns
  legs: number; // journeys from the ground to the end
  needsBoth: IndustryId[]; // steps that need two inputs at once
  boosted: IndustryId[]; // steps with an optional boost
  open: Era[]; // year ranges in which every part can be built and something takes the product
  line: string; // one plain-English line
}

const isSource = (id: IndustryId) => T[id].role === 'primary' || T[id].role === 'gateway';

function supplyOf(f: Flow, seen: Set<IndustryId>): Supply {
  const all = makers(f.cargo);
  return {
    cargo: f.cargo, amount: f.amount, optional: !!f.optional,
    from: all.filter(isSource),
    made: all.filter((id) => T[id].role === 'processor' && !seen.has(id)).flatMap((id) => stepsFor(id, f.cargo, seen)),
  };
}

function stepsFor(id: IndustryId, makes: CargoId, seen = new Set<IndustryId>()): Step[] {
  const t = T[id], s = new Set(seen).add(id);
  const out = t.outputs.find((f) => f.cargo === makes)!;
  const boosts = t.inputs.filter((f) => f.optional).map((f) => supplyOf(f, s));
  const also = t.outputs.filter((f) => f.cargo !== makes);
  const mk = (fs: Flow[]): Step => ({ id, mix: t.mix ?? 'all', needs: fs.map((f) => supplyOf(f, s)), boosts, makes, amount: out.amount, also });
  return t.mix === 'any' ? required(id).map((f) => mk([f])) : [mk(required(id))];
}

// Everyone who takes a cargo for good, and the hubs that relay it to towns.
function endsOf(c: CargoId): { ends: ChainEnd[]; relays: IndustryId[] } {
  const ends: ChainEnd[] = TOWN_ACCEPTS.includes(c) ? [{ to: 'town', era: ALWAYS }] : [];
  const relays: IndustryId[] = [];
  for (const id of INDUSTRY_IDS) {
    const f = T[id].inputs.find((x) => x.cargo === c);
    if (!f) continue;
    const r = T[id].role, era = flowEra(id, f);
    if ((r === 'sink' || r === 'gateway') && era) ends.push({ to: id, era });
    if (r === 'hub' && TOWN_ACCEPTS.includes(c) && T[id].outputs.some((x) => x.cargo === c)) relays.push(id);
  }
  return { ends, relays };
}

const supplyLegs = (s: Supply): number => (s.from.length ? 1 : 1 + Math.min(...s.made.map(stepLegs)));
const stepLegs = (s: Step): number => Math.max(...s.needs.map(supplyLegs));
const stepsIn = (s: Step): Step[] => [s, ...s.needs.flatMap((n) => n.made.flatMap(stepsIn))];

// Is each part there in a year?
const sourceOk = (id: IndustryId, c: CargoId, y: number) => buildable(id, y) && outputsIn(id, y).some((f) => f.cargo === c);
const supplyOk = (s: Supply, y: number): boolean => s.from.some((id) => sourceOk(id, s.cargo, y)) || s.made.some((m) => stepOk(m, y));
const stepOk = (s: Step, y: number): boolean => buildable(s.id, y) && s.needs.every((n) => supplyOk(n, y));

export function openIn(ch: Chain, year: number): boolean {
  if (!ch.ends.some((e) => inEra(e.era, year))) return false;
  return ch.step ? stepOk(ch.step, year) : ch.from.some((id) => sourceOk(id, ch.product, year));
}

// Year ranges in which a test holds, scanning FIRST_YEAR..LAST_YEAR.
function ranges(ok: (y: number) => boolean): Era[] {
  const out: Era[] = [];
  let start: number | null = null;
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    if (ok(y) && start === null) start = y;
    if (!ok(y) && start !== null) { out.push([start, y - 1]); start = null; }
  }
  if (start !== null) out.push([start, null]);
  return out;
}

function build(): Chain[] {
  const finals = CARGOS.filter((c) => endsOf(c).ends.length);
  const out: Chain[] = [];
  for (const product of finals) {
    const { ends, relays } = endsOf(product);
    const all = makers(product);
    const raw = all.filter(isSource);
    const steps = all.filter((id) => T[id].role === 'processor').flatMap((id) => stepsFor(id, product));
    const pname = CARGO[product].name;
    const mk = (id: string, name: string, step: Step | null, from: IndustryId[]): Chain => {
      const inner = step ? stepsIn(step) : [];
      const ch: Chain = {
        id, name, product, step, from, ends, relays,
        legs: step ? stepLegs(step) + 1 : 1,
        needsBoth: [...new Set(inner.filter((s) => s.mix === 'all' && s.needs.length >= 2).map((s) => s.id))],
        boosted: [...new Set(inner.filter((s) => s.boosts.length).map((s) => s.id))],
        open: [], line: '',
      };
      ch.open = ranges((y) => openIn(ch, y));
      ch.line = explainChain(ch);
      return ch;
    };
    if (raw.length) out.push(mk(product, pname, null, raw));
    for (const s of steps) {
      const alt = steps.length > 1 && s.mix === 'any' ? s.needs[0].cargo : null;
      out.push(mk(alt ? `${product}<${alt}` : product, alt ? `${pname} from ${lower(alt)}` : pname, s, []));
    }
  }
  // shortest first, then by name, so lists read from the simple chains up
  return out.sort((a, b) => a.legs - b.legs || a.name.localeCompare(b.name));
}

// Built fresh each call (it takes well under a millisecond), so a changed catalogue shows at once.
export const chains = (): Chain[] => build();
export const chainsIn = (year: number) => chains().filter((c) => openIn(c, year));
export const chainsTo = (to: IndustryId | 'town') => chains().filter((c) => c.ends.some((e) => e.to === to));
export const chainsThrough = (id: IndustryId) => chains().filter((c) => (c.step ? stepsIn(c.step).some((s) => s.id === id || s.needs.some((n) => n.from.includes(id)) || s.boosts.some((n) => n.from.includes(id))) : c.from.includes(id)) || c.ends.some((e) => e.to === id));

// Why a chain is shut in a year, in words: what can't be built yet, or any more.
export function whyClosed(ch: Chain, y: number): string[] {
  const why = new Set<string>();
  const type = (id: IndustryId) => {
    const e = T[id].era;
    if (y < e[0]) why.add(`no ${plural(id)} until ${e[0]}`);
    else if (e[1] !== null && y > e[1]) why.add(`no new ${plural(id)} after ${e[1]}`);
  };
  const flow = (id: IndustryId, c: CargoId, dir: 'in' | 'out') => {
    const f = (dir === 'in' ? T[id].inputs : T[id].outputs).find((x) => x.cargo === c);
    if (!f?.era || flowLive(f, y)) return;
    const what = id === 'port' ? `the docks ${dir === 'in' ? 'export' : 'import'} ${lower(c)}` : `${a(id)} ${dir === 'in' ? 'takes' : 'makes'} ${lower(c)}`;
    why.add(y < f.era[0] ? `${what} from ${f.era[0]}` : `${what} until ${f.era[1]}`);
  };
  const source = (id: IndustryId, c: CargoId) => { type(id); if (buildable(id, y)) flow(id, c, 'out'); };
  const supply = (s: Supply) => { if (supplyOk(s, y)) return; s.from.forEach((id) => source(id, s.cargo)); s.made.forEach(step); };
  const step = (s: Step) => { type(s.id); s.needs.forEach(supply); };
  if (!ch.ends.some((e) => inEra(e.era, y))) for (const e of ch.ends) if (e.to !== 'town') { type(e.to); if (buildable(e.to, y)) flow(e.to, ch.product, 'in'); }
  if (ch.step) { if (!stepOk(ch.step, y)) step(ch.step); } else if (!ch.from.some((id) => sourceOk(id, ch.product, y))) ch.from.forEach((id) => source(id, ch.product));
  return [...why];
}

// ---------------- value ----------------
// What a cycle's cargo is worth at the pay rates. Every leg pays by distance, so this is the
// money per unit of distance for carrying what goes in against what comes out.
const worth = (fs: Flow[]) => fs.reduce((s, f) => s + CARGO[f.cargo].pay * f.amount, 0);

export interface StepValue {
  id: IndustryId;
  on?: CargoId; // for mix 'any', the input this recipe runs on
  recipe: string; // '1 coal + 2 iron ore -> 1.5 steel'
  in: number; // pay-rate worth of the needed inputs per cycle
  out: number; // of everything made per cycle
  ratio: number;
  boosted?: { in: number; out: number; ratio: number };
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const recipeOf = (need: Flow[], outs: Flow[]) => `${need.map((f) => `${fmt(f.amount)} ${lower(f.cargo)}`).join(' + ')} → ${outs.map((f) => `${fmt(f.amount)} ${lower(f.cargo)}`).join(' + ')}`;

export function stepValues(): StepValue[] {
  const out: StepValue[] = [];
  for (const id of INDUSTRY_IDS) {
    const t = T[id];
    if (t.role !== 'processor') continue;
    const opt = t.inputs.filter((f) => f.optional);
    const recipes = t.mix === 'any' ? required(id).map((f) => [f]) : [required(id)];
    for (const need of recipes) {
      const i = worth(need), o = worth(t.outputs);
      const v: StepValue = { id, recipe: recipeOf(need, t.outputs), in: i, out: o, ratio: o / i };
      if (t.mix === 'any') v.on = need[0].cargo;
      if (opt.length && t.boost) { const bi = i + worth(opt), bo = o * t.boost; v.boosted = { in: bi, out: bo, ratio: bo / bi }; }
      out.push(v);
    }
  }
  return out;
}

// Pay per unit of raw material over the whole chain, if every leg were the same length: a rough
// measure of what a chain is worth to run. Co-products aren't counted; they're a bonus.
export function chainPay(ch: Chain): number {
  if (!ch.step) return CARGO[ch.product].pay;
  const walk = (s: Step, cycles: number): { pay: number; raw: number } => {
    let pay = 0, raw = 0;
    for (const n of s.needs) {
      const units = n.amount * cycles;
      pay += units * CARGO[n.cargo].pay;
      if (n.from.length || !n.made.length) raw += units;
      else { const m = n.made[0], r = walk(m, units / m.amount); pay += r.pay; raw += r.raw; }
    }
    return { pay, raw };
  };
  const r = walk(ch.step, 1);
  return (r.pay + ch.step.amount * CARGO[ch.product].pay) / r.raw;
}

// ---------------- unit rates ----------------
// How many sites, each at production level 1, keep one processor busy at a level. Suppliers grow
// too, so with both at the same level the level-1 numbers hold.

// What one site makes of a cargo per second at level 1, from its most suitable variant.
export function perSite(id: IndustryId, c: CargoId): { perSecond: number; variant?: Variant } {
  const t = T[id], f = t.outputs.find((x) => x.cargo === c);
  if (!f) return { perSecond: 0 };
  let best: Variant | undefined, scale = 1;
  for (const v of t.variants) { const s = v.outputScale?.[c]; if (s !== undefined && s > scale) { scale = s; best = v; } }
  return { perSecond: f.amount * t.rate * scale, variant: best };
}

export interface Option { id: IndustryId; variant?: string; perSite: number; sites: number }
export interface InputNeed { cargo: CargoId; optional: boolean; perSecond: number; options: Option[] }

export function suppliers(id: IndustryId, level = 1, year?: number): InputNeed[] {
  const t = T[id];
  return inputsIn(id, year).map((f) => {
    const perSecond = f.amount * t.rate * level;
    const options = makers(f.cargo, year).map((m) => { const p = perSite(m, f.cargo); return { id: m, variant: p.variant?.id, perSite: p.perSecond, sites: perSecond / p.perSecond }; });
    return { cargo: f.cargo, optional: !!f.optional, perSecond, options };
  });
}

// Every site a chain's last step needs at a level: its processors, and for each raw cargo the
// sources that could supply it (any one of them, in that number).
export interface ChainSites {
  processors: { id: IndustryId; sites: number }[];
  raw: { cargo: CargoId; optional: boolean; options: Option[] }[];
}

export function chainSites(ch: Chain, level = 1): ChainSites {
  const processors = new Map<IndustryId, number>();
  const raw = new Map<string, { cargo: CargoId; optional: boolean; perSecond: number }>();
  const need = (s: Supply, perSecond: number, optional: boolean) => {
    if (s.from.length || !s.made.length) {
      const k = `${s.cargo}|${optional}`, r = raw.get(k);
      raw.set(k, { cargo: s.cargo, optional, perSecond: (r?.perSecond ?? 0) + perSecond });
    } else run(s.made[0], perSecond / s.made[0].amount, optional);
  };
  const run = (s: Step, cycles: number, optional: boolean) => {
    processors.set(s.id, (processors.get(s.id) ?? 0) + cycles / T[s.id].rate);
    for (const n of s.needs) need(n, n.amount * cycles, optional);
    for (const n of s.boosts) need(n, n.amount * cycles, true);
  };
  if (ch.step) run(ch.step, T[ch.step.id].rate * level, false);
  return {
    processors: [...processors].map(([id, sites]) => ({ id, sites })),
    raw: [...raw.values()].map(({ cargo, optional, perSecond }) => ({
      cargo, optional,
      options: makers(cargo).filter(isSource).map((m) => { const p = perSite(m, cargo); return { id: m, variant: p.variant?.id, perSite: p.perSecond, sites: perSecond / p.perSecond }; }),
    })),
  };
}

// ---------------- running a site ----------------
// The production rule, for the economy to adopt. Given what's in the input stockyards, how many
// cycles run in dt seconds at a level, what they use and what they make.
//  primary    rate x level cycles, each making its outputs (scaled by the variant)
//  processor  'all': limited by the scarcest required input; 'any': each cycle uses one input,
//             shared between those in stock in proportion to how many cycles each could run.
//             Output is multiplied by `boost` when every optional input covers those cycles
//  sink       uses up to rate x level of whatever it takes; it never refuses a delivery
//  hub        moves up to rate x level units from its inputs to the same cargo out
//  gateway    imports rate x level of each live import; exports are taken in full
export interface CycleResult { cycles: number; used: Partial<Record<CargoId, number>>; made: Partial<Record<CargoId, number>>; boosted: boolean }

export function runCycles(
  id: IndustryId, stock: Partial<Record<CargoId, number>>, level: number, dt: number,
  opts: { variant?: Variant; year?: number } = {},
): CycleResult {
  const t = T[id], cap = t.rate * level * dt, year = opts.year;
  const used: Partial<Record<CargoId, number>> = {}, made: Partial<Record<CargoId, number>> = {};
  const have = (c: CargoId) => Math.max(0, stock[c] ?? 0);
  const ins = inputsIn(id, year), outs = outputsIn(id, year);
  const scale = (c: CargoId) => opts.variant?.outputScale?.[c] ?? 1;
  const res = (cycles: number, boosted = false): CycleResult => ({ cycles, used, made, boosted });

  if (t.role === 'primary') {
    for (const f of outs) made[f.cargo] = f.amount * cap * scale(f.cargo);
    return res(cap);
  }
  if (t.role === 'gateway') {
    for (const f of outs) made[f.cargo] = f.amount * cap;
    for (const f of ins) if (have(f.cargo) > 0) used[f.cargo] = have(f.cargo);
    return res(cap);
  }
  if (t.role === 'sink' || t.role === 'hub') {
    // share the throughput between the cargoes in stock, in proportion to how much of each
    const total = ins.reduce((s, f) => s + have(f.cargo), 0), move = Math.min(cap, total);
    for (const f of ins) {
      const u = total > 0 ? (have(f.cargo) / total) * move : 0;
      if (u <= 0) continue;
      used[f.cargo] = u;
      if (t.role === 'hub' && outs.some((o) => o.cargo === f.cargo)) made[f.cargo] = u;
    }
    return res(move);
  }
  // processors
  const need = ins.filter((f) => !f.optional), opt = ins.filter((f) => f.optional);
  let cycles: number;
  if (t.mix === 'any') {
    const each = need.map((f) => have(f.cargo) / f.amount), sum = each.reduce((s, x) => s + x, 0);
    cycles = Math.min(cap, sum);
    need.forEach((f, i) => { const c = sum > 0 ? (each[i] / sum) * cycles : 0; if (c > 0) used[f.cargo] = c * f.amount; });
  } else {
    cycles = Math.min(cap, ...need.map((f) => have(f.cargo) / f.amount));
    if (cycles > 0) for (const f of need) used[f.cargo] = cycles * f.amount;
  }
  const boosted = cycles > 0 && opt.length > 0 && !!t.boost && opt.every((f) => have(f.cargo) >= f.amount * cycles);
  if (boosted) for (const f of opt) used[f.cargo] = f.amount * cycles;
  if (cycles > 0) for (const f of outs) made[f.cargo] = f.amount * cycles * (boosted ? t.boost! : 1);
  return res(cycles, boosted);
}

// Can a type run on what's there? For world generation: don't found a processor whose needs
// nobody on the map can meet. `present` is the types on the map (default: any buildable type).
export function feedable(id: IndustryId, year: number, present: (m: IndustryId) => boolean = () => true): boolean {
  const t = T[id], ins = inputsIn(id, year);
  const ok = (f: Flow) => makers(f.cargo, year, true).some((m) => m !== id && present(m));
  if (t.role === 'primary' || t.role === 'gateway') return true;
  if (t.role === 'processor' && t.mix !== 'any') return ins.filter((f) => !f.optional).every(ok);
  return ins.some((f) => !f.optional && ok(f));
}

// ---------------- plain English ----------------
const lower = (c: CargoId) => CARGO[c].name.toLowerCase();
const nameOf = (id: IndustryId) => T[id].name.toLowerCase();
export const a = (id: IndustryId) => (id === 'port' ? 'the docks' : `${/^[aeiou]/.test(nameOf(id)) ? 'an' : 'a'} ${nameOf(id)}`);
export const plural = (id: IndustryId) => { const n = nameOf(id); return /s$/.test(n) ? n : /[^aeiou]y$/.test(n) ? `${n.slice(0, -1)}ies` : `${n}s`; };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const list = (xs: string[], join = 'and') => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} ${join} ${xs[xs.length - 1]}`);
const isPlural = (c: CargoId) => /s$/.test(lower(c));
const goes = (c: CargoId | CargoId[]) => (Array.isArray(c) ? c.length > 1 || isPlural(c[0]) : isPlural(c)) ? 'go' : 'goes';
const pct = (id: IndustryId) => `${Math.round(((T[id].boost ?? 1) - 1) * 100)}%`;
// A flow's own era, as words: " (from 1985)", " (until 1984)".
// Within a chain, `span` drops what the chain's own years already say.
const when = (f?: Flow, span?: Era[]) => {
  if (!f?.era) return '';
  const first = span?.[0]?.[0] ?? FIRST_YEAR, last = span?.[span.length - 1]?.[1];
  if (f.era[0] > first) return ` (from ${f.era[0]})`;
  if (f.era[1] !== null && (last === null || last === undefined || f.era[1] < last)) return ` (until ${f.era[1]})`;
  return '';
};
const outFlow = (id: IndustryId, c: CargoId) => T[id].outputs.find((f) => f.cargo === c);
const inFlow = (id: IndustryId, c: CargoId) => T[id].inputs.find((f) => f.cargo === c);
const sourceName = (id: IndustryId, c: CargoId, span?: Era[]) => `${a(id)}${when(outFlow(id, c), span)}`;
// Who a product is "for": towns, a power station, export.
const forWhom = (c: CargoId, hubs = false) => {
  const t = takers(c);
  const xs = t.towns ? ['towns'] : [];
  for (const id of t.industries) {
    const r = T[id].role;
    if (r === 'gateway') xs.push(`export${when(inFlow(id, c))}`);
    else if (r === 'hub' && !hubs) continue;
    else xs.push(r === 'sink' ? a(id) : plural(id));
  }
  return list(xs);
};

// Where one output goes, followed one step further when it's made into something else.
function destinations(c: CargoId, from: IndustryId): string[] {
  const t = takers(c), xs: string[] = t.towns ? ['towns'] : [];
  const later: string[] = [];
  for (const id of t.industries) {
    if (id === from) continue;
    const type = T[id], f = inFlow(id, c)!;
    if (type.role === 'sink') xs.push(a(id));
    else if (type.role === 'gateway') xs.push(`the docks for export${when(f)}`);
    else if (type.role === 'processor') {
      const outs = type.outputs.map((o) => o.cargo);
      if (f.optional) { later.push(`${a(id)} as an optional boost (${pct(id)} more ${list(outs.map(lower))})`); continue; }
      const others = required(id).filter((x) => x.cargo !== c).map((x) => lower(x.cargo));
      const withOthers = type.mix === 'all' && others.length ? ` with ${list(others)}` : '';
      const onward = outs.map((o) => {
        const tk = takers(o), next = tk.industries.find((n) => T[n].role === 'processor' && !inFlow(n, o)!.optional);
        const into = next && `${a(next)} ${tk.towns ? 'to turn' : 'turns'} into ${list(T[next].outputs.map((x) => lower(x.cargo)))}`;
        if (tk.towns) return `${lower(o)} for towns${into ? `, or for ${into}` : ''}`;
        return into ? `${lower(o)}, which ${into} for ${forWhom(T[next!].outputs[0].cargo)}` : `${lower(o)} for ${forWhom(o)}`;
      });
      later.push(`${a(id)}${withOthers} to make ${list(onward)}`);
    }
  }
  return [...xs, ...later];
}

export function explainIndustry(id: IndustryId): string {
  const t = T[id];
  const ins = (fs: Flow[], join = 'and') => list(fs.map((f) => `${lower(f.cargo)}${when(f)}`), join);
  switch (t.role) {
    case 'primary':
      return `${t.outputs.map((f, i) => `${i === 0 ? `${cap(a(id))}'s` : 'its'} ${lower(f.cargo)} ${goes(f.cargo)} to ${list(destinations(f.cargo, id).map((d, j) => (j ? `to ${d}` : d)), 'or')}`).join('; ')}.`;
    case 'processor': {
      const need = required(id), opt = t.inputs.filter((f) => f.optional);
      const boost = opt.length ? `; ${ins(opt)} ${opt.length > 1 || isPlural(opt[0].cargo) ? 'are' : 'is'} optional and adds ${pct(id)}` : '';
      const outs = list(t.outputs.map((f) => `${lower(f.cargo)} for ${forWhom(f.cargo)}`));
      if (t.mix === 'any' && need.length > 1) return `${cap(a(id))} makes ${list(t.outputs.map((f) => lower(f.cargo)))} from ${ins(need, 'or')}, whichever arrives, for ${forWhom(t.outputs[0].cargo)}${boost}.`;
      if (need.length > 1) return `${cap(a(id))} needs both ${ins(need)} to make ${outs}${boost}.`;
      return `${cap(a(id))} turns ${ins(need)} into ${outs}${boost}.`;
    }
    case 'sink':
      return `${cap(a(id))} uses up ${ins(t.inputs, 'or')} and sends nothing on, so it takes all you bring.`;
    case 'hub':
      return `${cap(a(id))} takes ${ins(t.inputs)} in bulk and sends the same on to towns.`;
    case 'gateway':
      return `${cap(a(id))} export ${ins(t.inputs)}, and import ${ins(t.outputs)}.`;
  }
}

// Build a chain's line from the ground up: raw supplies into the first step, then each product on.
export function explainChain(ch: Chain): string {
  const endsText = (c: CargoId) => {
    const xs = ch.ends.map((e) => (e.to === 'town' ? 'towns' : T[e.to].role === 'gateway' ? `export${when(inFlow(e.to, c), ch.open)}` : a(e.to)));
    return list(xs, 'or');
  };
  const supplyText = (s: Supply) => `${lower(s.cargo)} from ${list(s.from.map((id) => sourceName(id, s.cargo, ch.open)), 'or')}`;
  const boostText = (s: Step) => (s.boosts.length ? ` (${list(s.boosts.map(supplyText))} adds ${pct(s.id)})` : '');
  if (!ch.step) {
    const to = ch.ends.map((e) => (e.to === 'town' ? 'towns' : T[e.to].role === 'gateway' ? `the docks for export${when(inFlow(e.to, ch.product), ch.open)}` : a(e.to)));
    return `${cap(supplyText({ cargo: ch.product, amount: 1, optional: false, from: ch.from, made: [] }))} ${goes(ch.product)} to ${list(to, 'or to')}.`;
  }
  const both = (s: Step) => s.mix === 'all' && s.needs.length >= 2;
  const clause = (s: Step, top: boolean): string => {
    const made = s.needs.find((n) => !n.from.length && n.made.length);
    const head = made
      ? `${clause(made.made[0], false)}; its ${lower(made.cargo)} ${goes(made.cargo)} to ${a(s.id)}`
      : `${cap(list(s.needs.map(supplyText)))} ${goes(s.needs.map((n) => n.cargo))} to ${a(s.id)}`;
    if (!top) return `${head}${both(s) ? ', which needs both' : ''}${boostText(s)}`;
    const also = s.also.length ? ` (with ${list(s.also.map((f) => lower(f.cargo)))} as a by-product)` : '';
    return `${head}, which ${both(s) ? 'needs both to make' : 'makes'} ${lower(s.makes)} for ${endsText(s.makes)}${also}${boostText(s)}`;
  };
  return `${clause(ch.step, true)}.`;
}

// ---------------- audit ----------------
// Checks a catalogue change should keep passing, and the balance questions left to the economy.
//  error  the chains are broken: something is made that nobody takes, or needed that nobody makes
//  warn   it works, but a number looks off
//  note   worth knowing when wiring up the economy or world generation
export interface Finding { level: 'error' | 'warn' | 'note'; about: string; text: string }

export const THIN_MARGIN = 1.15; // a step should add at least this much at the pay rates
export const MAX_SUPPLIERS = 4; // level-1 suppliers of one kind to keep a level-1 processor busy

export function audit(): Finding[] {
  const out: Finding[] = [];
  const push = (level: Finding['level'], about: string, text: string) => { if (!out.some((f) => f.about === about && f.text === text)) out.push({ level, about, text }); };
  for (const c of CARGOS) {
    if (!makers(c, undefined, true).length) push('error', c, `nobody makes ${lower(c)}`);
    const t = takers(c);
    if (!t.towns && !t.industries.length) push('error', c, `nobody takes ${lower(c)}`);
  }
  // every cargo reaches a town, a sink or the docks; every processor can be fed from the ground
  const finals = new Set(chains().map((ch) => ch.product));
  const reaches = (c: CargoId, seen: CargoId[] = []): boolean => finals.has(c) || (!seen.includes(c) && takers(c).industries.some((id) => T[id].role === 'processor' && T[id].outputs.some((o) => reaches(o.cargo, [...seen, c]))));
  for (const c of CARGOS) if (!reaches(c)) push('error', c, `${lower(c)} never reaches towns, a sink or the docks`);
  for (const id of INDUSTRY_IDS) if (T[id].role === 'processor' && !chainsThrough(id).length) push('error', id, `${a(id)} is in no chain`);

  // year by year: nothing built that year makes what nobody takes, or needs what nobody makes
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    for (const id of INDUSTRY_IDS) {
      if (!buildable(id, y)) continue;
      const r = T[id].role;
      if (r !== 'hub') for (const f of outputsIn(id, y)) {
        const t = takers(f.cargo, y);
        if (!t.towns && !t.industries.some((x) => x !== id)) push('error', id, `${a(id)} makes ${lower(f.cargo)} in ${y}, and nobody takes it then`);
      }
      if (!feedable(id, y)) push('error', id, `${a(id)} can be built in ${y}, but nothing then makes what it needs`);
      else if (r === 'processor' || r === 'sink') {
        const need = inputsIn(id, y).filter((f) => !f.optional);
        const docksOnly = need.filter((f) => { const m = makers(f.cargo, y); return m.length > 0 && m.every((x) => x === 'port'); });
        const allNeeded = r === 'processor' && T[id].mix !== 'any';
        if (docksOnly.length && (allNeeded || docksOnly.length === need.length))
          push('note', id, `${cap(plural(id))} rely on the docks for ${list(docksOnly.map((f) => lower(f.cargo)))} ${spanOf(id, docksOnly.map((f) => f.cargo))}, so only found them near the coast then`);
      }
    }
  }

  for (const v of stepValues()) {
    const what = `${a(v.id)}${v.on ? ` running on ${lower(v.on)}` : ''}`;
    if (v.ratio < 1) push('error', v.id, `${what} loses value (${v.ratio.toFixed(2)}×)`);
    else if (v.ratio < THIN_MARGIN) push('warn', v.id, `${what} adds only ${Math.round((v.ratio - 1) * 100)}% at the pay rates (${fmt(v.in)} in, ${fmt(v.out)} out)`);
  }
  for (const id of INDUSTRY_IDS) {
    if (T[id].role !== 'processor') continue;
    for (const n of suppliers(id, 1)) {
      if (n.optional) continue;
      const best = Math.min(...n.options.map((o) => o.sites));
      if (best > MAX_SUPPLIERS) push('warn', id, `${a(id)} needs ${fmt(best)} suppliers of ${lower(n.cargo)} to run flat out`);
    }
  }
  // a processor fed by two recipes where one always pays better
  for (const c of CARGOS) {
    const vs = stepValues().filter((v) => T[v.id].inputs.some((f) => f.cargo === c && !f.optional) && (v.on === undefined || v.on === c));
    if (vs.length < 2) continue;
    const s = [...vs].sort((p, q) => q.ratio - p.ratio);
    push('note', c, `${cap(lower(c))} is worth more at ${a(s[0].id)} (${s[0].ratio.toFixed(2)}×) than at ${list(s.slice(1).map((v) => `${a(v.id)} (${v.ratio.toFixed(2)}×)`))}; town demand has to make the others worth it`);
  }
  // a sink at level 1 takes less than one busy supplier makes
  for (const id of INDUSTRY_IDS) {
    if (T[id].role !== 'sink') continue;
    for (const f of T[id].inputs) {
      const most = Math.max(...makers(f.cargo).map((m) => perSite(m, f.cargo).perSecond * 4));
      if (f.amount * T[id].rate < most) push('note', id, `${cap(a(id))} burns ${fmt(f.amount * T[id].rate)} ${lower(f.cargo)}/s at level 1, less than one level-4 supplier makes (${fmt(most)}/s); it should never refuse a delivery`);
    }
  }
  for (const id of INDUSTRY_IDS) {
    const outs = T[id].outputs;
    if (T[id].role !== 'hub' && T[id].role !== 'gateway' && outs.length > 1)
      push('note', id, `${cap(a(id))} makes ${list(outs.map((f) => lower(f.cargo)))} in the same cycle; if one isn't collected it shouldn't stop the other`);
  }
  return out;
}

// The years in which a type's needs come only from the docks, as words.
function spanOf(id: IndustryId, cs: CargoId[]): string {
  const rs = ranges((y) => buildable(id, y) && cs.every((c) => { const m = makers(c, y); return m.length > 0 && m.every((x) => x === 'port'); }));
  return list(rs.map(([s, e]) => (e === null ? `from ${s}` : s === e ? `in ${s}` : `in ${s}–${e}`)));
}
