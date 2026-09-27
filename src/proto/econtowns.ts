// Towns: what each use of building is in demand for, and what the town does about it.
// Each month, for every town and every use (homes, shops, offices, works):
//  - demand is worked out from what the town is fed and what its people can reach:
//      homes   follow reach: can residents get to work, shops and leisure in reasonable time?
//      shops   follow customers who can reach them and workers, capped by goods supplied
//      offices follow workers who can reach them, capped by passengers arriving
//      works   follow workers who can reach them, capped by building materials supplied
//    (a town finds some of what it needs for itself, a share of what it started with, and some
//    people live there whatever they can reach, so an unserved town shrinks towards a floor)
//  - demand is smoothed, and set against capacity with hysteresis: only months of demand above
//    capacity build (a free plot, or a denser building where people most want to be), the uses
//    that want land most keenly first, and only months well below it abandon the emptiest
//    buildings, which are cleared later still, their plots kept for the same use while it's
//    wanted (a use short of land may redevelop the buildings of one giving some up);
//  - occupancy drifts towards demand, faster in than out.
// Everything that happens is explained in plain words for the town panel.
import { BUILDINGS, ENTRY, GROWN, USES, USE_NAME, type BuildingKind, type Reason, type TownReport, type TownStatus, type Tune, type Use, type UseReport } from './econdefs';
import type { Reach, ZoneGeo } from './econaccess';

export interface BState {
  id: number; zone: ZState; x: number; z: number; kind: BuildingKind; use: Use; cap: number;
  occ: number; // share of capacity in use
  abandoned: boolean; since: number; // month it was abandoned
  site: number; // 0..1, how well placed: near a served stop and the middle of town
  shown: number; // vacancy last reported to the game
  densify: number; // outstanding request, 0 if none
  rest: number; // the game couldn't rebuild it: not asked again before this month
}
export type PerUse = Record<Use, number>;
export const perUse = (v = 0): PerUse => ({ home: v, shop: v, office: v, works: v, civic: v });

export interface ZState extends ZoneGeo {
  idx: number; town: TState; plots: number; reserved: number; blocked: number; allow: Set<BuildingKind> | null;
  // Plots cleared of abandoned buildings, kept for the use they were cleared from (as planning
  // would: a cleared housing site is rebuilt as housing), so a town doesn't empty its homes only
  // to fill their land with offices and then want the homes back. Once that use is wanted no
  // more than it stands, other uses may build on them (see decide).
  cleared: PerUse;
  buildings: BState[]; indJobs: number;
  cov: number; // share of the zone (by capacity) near a served bus or rail stop
  covHome: number; // the same of its homes alone: who can set out from home by your lines
  centre: number; // 0..1, how central in its town
  cap: PerUse; occCap: PerUse; // this review's tallies
  pHome: number; labour: number; customers: number;
}
// `settled`: the demand at which it last had nothing more worth giving up (0 if it hasn't)
export interface UState { demand: number; raw: number; up: number; down: number; grew: number; shrank: number; stuck: boolean; settled: number }
export interface Facts {
  residents: number; homes: number; vacancy: number; jobs: number; workers: number;
  reachWork: number; workCar: number; workNoCar: number; workTransit: number; reachShop: number; reachLeisure: number;
  goods: number; materials: number; visitors: number; // supplied share of need (NaN when nothing needs it)
  stops: number; lines: number; homesNearStop: number; plots: number; abandoned: number;
  crowding: Crowding;
  ratio: PerUse; built: number; lost: number;
}
export interface TState {
  id: number; name: string; x: number; z: number; carShare: number; zones: ZState[];
  // What calibration found, per use: `cal`, the factor that put the town as the map made it in
  // balance, and `at`, the demand the model explained then; `bias` is what they come to this
  // review, as a factor on the demand the model explains.
  base: PerUse; cal: PerUse; at: PerUse; bias: PerUse; calibrated: boolean; primed: boolean;
  assessed: boolean; // its first review has taken it as it stands (see Economy.review)
  labour: number; customers: number; // town-wide: workers per job, customers per shop place
  supply: { goods: number; materials: number; visitors: number }; // smoothed, per hour
  month: { goods: number; materials: number; visitors: number }; // delivered so far this month
  // What was there for it last month, per hour: what your lines delivered and what the town was
  // taken to be fed from off the map when it was made (fading as the smoothed view does)
  got: { goods: number; materials: number; visitors: number };
  offmap: { goods: number; materials: number; visitors: number };
  // What your lines alone delivered last month, per hour: what the town panel says is arriving
  // (the smoothed `supply` also remembers earlier months and what the town started with)
  delivered: { goods: number; materials: number; visitors: number };
  // Goods and materials the town takes, per hour: as much as its businesses can make use of,
  // however well supplied (set at each review). What's delivered goes into a store of a couple of
  // days' worth that empties at that rate; beyond it the town takes no more, and isn't paid for.
  accept: { goods: number; materials: number };
  held: { goods: number; materials: number };
  use: Record<Use, UState>;
  health: PerUse; // how much of each use's capacity businesses want to keep going
  history: number[];
  recent: { built: number[]; lost: number[] }; // capacity built and lost at the last few reviews
  done: { built: number; lost: number }; // since the last review: built once the game has put it up
  facts: Facts | null;
  report: TownReport | null;
}

export function newTown(id: number, name: string, x: number, z: number, carShare: number): TState {
  const u = (): UState => ({ demand: 0, raw: 0, up: 0, down: 0, grew: -99, shrank: -99, stuck: false, settled: 0 });
  return {
    id, name, x, z, carShare, zones: [], base: perUse(), cal: perUse(1), at: perUse(), bias: perUse(1), calibrated: false, primed: false, assessed: false, labour: 1, customers: 1,
    supply: { goods: 0, materials: 0, visitors: 0 }, month: { goods: 0, materials: 0, visitors: 0 }, got: { goods: 0, materials: 0, visitors: 0 }, offmap: { goods: 0, materials: 0, visitors: 0 }, delivered: { goods: 0, materials: 0, visitors: 0 },
    accept: { goods: 0, materials: 0 }, held: { goods: 0, materials: 0 },
    use: { home: u(), shop: u(), office: u(), works: u(), civic: u() }, health: perUse(1), history: [], recent: { built: [], lost: [] },
    done: { built: 0, lost: 0 }, facts: null, report: null,
  };
}

// What the economy lends the town review: this month's reach, and hands to act with.
// Of those who came to board your lines at a town's stops, the share who found no room, and the
// line that turned most away (with its own share).
export interface Crowding { share: number; line: { name: string; rail: boolean; share: number } | null }
export interface TownCtx {
  tune: Tune; month: number; calibrate: boolean; assess: boolean; // assess: work out demand but change nothing
  work: Reach; shop: Reach; leisure: Reach;
  workSupply: Float64Array; shopSupply: Float64Array;
  pendingCap(t: TState, use: Use): number;
  // `cleared`: the use whose cleared plot this takes, or null for a free plot
  add(z: ZState, kind: BuildingKind, cleared: Use | null): void;
  densify(b: BState, kind: BuildingKind): void;
  abandon(b: BState): void; restore(b: BState): void; demolish(b: BState): void; vacate(b: BState, fraction: number): void;
  service(t: TState): { stops: number; lines: number };
  crowding(t: TState): Crowding;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// What a town finds for itself of a supply: the tune's share of what it started with. A share of
// one means it finds all its businesses need (the game runs its town so until freight exists), and
// then nothing the town finds caps how far those businesses grow: only their workers and custom do.
// (A town that started with none of a use finds nothing for it, as before: the use isn't started
// from nothing by supplies it can't have.)
const found = (share: number, base: number) => (share >= 1 && base > 0 ? Infinity : share * base);
export const allowed = (z: ZState, kind: BuildingKind) =>
  z.allow ? z.allow.has(kind) : kind !== 'industry' || z.buildings.some((b) => b.kind === 'industry');

export function reviewTown(t: TState, c: TownCtx) {
  const T = c.tune;
  // ---- tallies ----
  const C = perUse();
  tally(t);
  for (const z of t.zones) for (const u of USES) C[u] += z.cap[u];
  // ---- what each zone's people can reach, and who reaches each zone's jobs ----
  const cs = t.carShare, cap = T.reachCap;
  const mix = (r: Reach, i: number) => cs * Math.min(cap, r.car[i]) + (1 - cs) * Math.min(cap, r.nc[i]);
  let alloc = 0, supplyW = 0, allocS = 0, supplyS = 0, lostW = 0, lostS = 0;
  for (const z of t.zones) {
    const i = z.idx, w = T.homeWeights;
    const k = (r: Reach) => Math.max(0.05, mix(r, i));
    z.pHome = T.homeBase + (1 - T.homeBase) * k(c.work) ** w.work * k(c.shop) ** w.shop * k(c.leisure) ** w.leisure;
    z.labour = c.work.ratio[i];
    z.customers = c.shop.ratio[i];
    alloc += c.work.ratio[i] * c.workSupply[i]; supplyW += c.workSupply[i]; lostW += c.work.lost[i];
    allocS += c.shop.ratio[i] * c.shopSupply[i]; supplyS += c.shopSupply[i]; lostS += c.shop.lost[i];
  }
  // town-wide ratios, for zones (or towns) that have none of a use yet
  t.labour = supplyW > 0 ? (alloc + lostW) / supplyW : T.jobCap;
  t.customers = supplyS > 0 ? (allocS + lostS) / supplyS : T.jobCap;
  const factor = (z: ZState, u: Use) => factorOf(t, z, u, T);
  // ---- demand ----
  const struct = perUse(), supplyB = perUse(Infinity);
  for (const u of GROWN) {
    if (C[u] > 0) for (const z of t.zones) struct[u] += z.cap[u] * factor(z, u);
    else struct[u] = BUILDINGS[ENTRY[u]].cap * (u === 'home' ? 1 : clamp(Math.min(t.labour, u === 'shop' ? t.customers : Infinity), 0, T.jobCap));
  }
  if (!t.primed) {
    // the town as it stands has been fed well enough to stand: start from there
    for (const u of USES) t.base[u] = C[u];
    t.supply.goods = (1 - T.local.goods) * t.base.shop * T.goodsPerShopJobHour;
    t.supply.materials = (1 - T.local.materials) * t.base.works * T.materialsPerWorksJobHour;
    t.supply.visitors = (1 - T.local.visitors) * t.base.office * (T.visitsPerOfficeJobDay / 24);
    t.got = { ...t.supply };
    t.offmap = { ...t.supply };
    t.primed = true;
  }
  supplyB.shop = found(T.local.goods, t.base.shop) + t.supply.goods / T.goodsPerShopJobHour;
  supplyB.office = found(T.local.visitors, t.base.office) + t.supply.visitors / (T.visitsPerOfficeJobDay / 24);
  supplyB.works = found(T.local.materials, t.base.works) + t.supply.materials / T.materialsPerWorksJobHour;
  // the same from last month's deliveries alone, without the town's memory of earlier months
  const gotB = fedJobs(t, T);
  // A building the town has asked for and is waiting on counts as part of the town its people
  // size their demand by, as decide() counts it as had: then how soon the game answers changes
  // when things go up, not how much.
  for (const u of GROWN) {
    const pend = c.pendingCap(t, u);
    if (pend > 0 && C[u] > 0) struct[u] *= (C[u] + pend) / C[u];
  }
  // The town as the map made it is taken to be in balance, so it neither shrinks nor grows just
  // because of how it was laid out: one short of what its size needs is lifted, one with more
  // is held back, within limits (so a town far short, like an estate with no jobs in reach,
  // still shrinks, if only towards its floor). One held back stays held back in proportion; one
  // lifted is lifted in proportion only as far as it started. Past that, the lift doesn't multiply what service brings, or a town short
  // of jobs and one short of workers joined by a railway would lift each other without end:
  //  - homes keep it as a fixed number: people who live there for what the model doesn't see
  //    (work off the map, family) stay, and newcomers come for what it does;
  //  - jobs lose it as the model comes to explain them: the lift stands for workers or custom
  //    the model doesn't see, and once service brings those it can see, firms staff up from
  //    them rather than keep phantom ones on top.
  if (c.calibrate && !t.calibrated) {
    for (const u of GROWN) {
      t.cal[u] = C[u] > 0 && struct[u] > 0 ? clamp(C[u] / struct[u], T.calibrateMin, T.calibrateMax) : 1;
      t.at[u] = struct[u];
    }
    t.calibrated = true;
  }
  for (const u of GROWN) {
    const r = t.cal[u], s0 = t.at[u], x = struct[u];
    const lifted = r <= 1 || x <= s0 ? r * x : u === 'home' ? x + (r - 1) * s0 : Math.max(x, r * s0);
    t.bias[u] = x > 0 ? lifted / x : 1;
  }
  const D = perUse();
  for (const u of GROWN) {
    const us = t.use[u];
    if (u === 'home') {
      // some people live here whatever they can reach (the retired, those working from home)
      us.raw = Math.max(t.bias.home * struct.home, T.local.homes * t.base.home);
    } else {
      // Firms open a little ahead of the workers they'll need, and further when what they need
      // is delivered to spare: well-supplied businesses draw workers, and homes follow the jobs.
      const staffed = t.bias[u] * struct[u], ahead = staffed * (1 + T.labourSlack);
      // What's to spare is judged on what actually came last month: firms don't take on staff on
      // the memory of deliveries that have stopped (the smoothed view still caps what they keep).
      // (a supply the town finds all of for itself is not to spare: it finds what its businesses
      // need, no more, so it draws no growth of its own)
      const spare = ahead > 0 && Number.isFinite(supplyB[u]) ? clamp(Math.min(supplyB[u], gotB[u]) / ahead - 1, 0, 1) : 0;
      us.raw = Math.min(ahead + staffed * T.supplySlack * spare, supplyB[u]);
      // Supply beyond twice `ahead` changes nothing above, so that (less what the town finds for
      // itself) is all it takes delivered: never less than what the businesses standing use, nor
      // than one new building's worth.
      const most = (local: number, per: number) => (local >= 1 ? 0 : per * Math.max(0, Math.max(2 * ahead, C[u], BUILDINGS[ENTRY[u]].cap) - local * t.base[u]));
      if (u === 'shop') t.accept.goods = most(T.local.goods, T.goodsPerShopJobHour);
      else if (u === 'works') t.accept.materials = most(T.local.materials, T.materialsPerWorksJobHour);
    }
    D[u] = us.raw;
    us.demand = c.assess && us.demand === 0 ? C[u] : us.demand + T.demandAlpha * (D[u] - us.demand);
    if (c.assess && C[u] === 0) us.demand = 0;
  }
  if (!c.assess) {
    decide(t, C, c);
    // clear what has stood empty long enough (filtering each zone once, however many go)
    for (const z of t.zones) {
      const gone = new Set<BState>();
      for (const b of z.buildings)
        if (b.abandoned && c.month - b.since >= T.demolishAfter && t.use[b.use].up === 0) { c.demolish(b); gone.add(b); }
      if (gone.size) z.buildings = z.buildings.filter((b) => !gone.has(b));
    }
  }
  // built counts what the game has put up (and what was brought back), not what was asked for
  const built = c.assess ? 0 : t.done.built, lost = c.assess ? 0 : t.done.lost;
  if (!c.assess) t.done = { built: 0, lost: 0 };
  // ---- occupancy follows demand, zone by zone ----
  for (const u of GROWN) {
    let cu = 0, wsum = 0;
    for (const z of t.zones) {
      z.cap[u] = 0;
      for (const b of z.buildings) if (!b.abandoned && b.use === u) z.cap[u] += b.cap;
      cu += z.cap[u];
      wsum += z.cap[u] * Math.max(0.05, factor(z, u));
    }
    const d = t.use[u].demand;
    // people move in as soon as there's room, but only start leaving once demand has stayed low
    const leaving = t.use[u].down >= 2;
    for (const z of t.zones) {
      if (!z.cap[u]) continue;
      const Dz = wsum > 0 ? (d * z.cap[u] * Math.max(0.05, factor(z, u))) / wsum : 0;
      const tz = Math.min(1, Dz / z.cap[u]);
      let sMean = 0, n = 0;
      for (const b of z.buildings) if (!b.abandoned && b.use === u) { sMean += b.site; n++; }
      sMean /= Math.max(1, n);
      const spread = T.siteSpread * Math.min(1, (1 - tz) * 4); // a full zone is full everywhere
      for (const b of z.buildings) {
        if (b.abandoned || b.use !== u) continue;
        const tb = clamp(tz + spread * (b.site - sMean), 0, 1);
        if (!c.assess && (tb > b.occ || leaving)) b.occ += (tb - b.occ) * (tb > b.occ ? T.moveIn : T.moveOut);
        const vac = 1 - b.occ;
        if (Math.abs(vac - b.shown) >= 0.1 || (vac < 0.02 && b.shown >= 0.02)) { b.shown = Math.round(vac * 100) / 100; c.vacate(b, b.shown); }
      }
    }
    // What businesses keep going, which is what the town's people see as jobs and shops in
    // reach: no more than they're wanted, and no more than this month's workers and last month's
    // deliveries keep going. Jobs whose workers or supplies have gone stop counting at once, so a
    // town whose service is cut doesn't draw people to jobs that are only fading out.
    t.health[u] = cu > 0 ? Math.min(1, d / cu, t.use[u].raw / cu, gotB[u] / cu) : 1;
  }
  // ---- the facts for the town panel ----
  t.facts = facts(t, c, tally(t), built, lost);
  if (!c.assess) {
    t.history.push(Math.round(t.facts.residents));
    if (t.history.length > 24) t.history.shift();
    t.recent.built.push(built); t.recent.lost.push(lost);
    if (t.recent.built.length > 3) { t.recent.built.shift(); t.recent.lost.shift(); }
  }
  t.report = report(t, T);
}

// The jobs of each use that last month's deliveries (and what the town finds for itself) keep
// going: the businesses standing beyond these have lost their supplies, whatever the town's
// smoothed view still says.
export function fedJobs(t: TState, T: Tune, got = t.got): PerUse {
  const b = perUse(Infinity);
  b.shop = found(T.local.goods, t.base.shop) + got.goods / T.goodsPerShopJobHour;
  b.office = found(T.local.visitors, t.base.office) + got.visitors / (T.visitsPerOfficeJobDay / 24);
  b.works = found(T.local.materials, t.base.works) + got.materials / T.materialsPerWorksJobHour;
  return b;
}

// capacity and occupied places by use in each zone; returns how many buildings stand abandoned
function tally(t: TState) {
  let abandoned = 0;
  for (const z of t.zones) {
    z.cap = perUse(); z.occCap = perUse();
    for (const b of z.buildings) {
      if (b.abandoned) { abandoned++; continue; }
      z.cap[b.use] += b.cap; z.occCap[b.use] += b.cap * b.occ;
    }
  }
  return abandoned;
}

// Grow, hold or shrink each use of one town.
function decide(t: TState, C: PerUse, c: TownCtx) {
  const T = c.tune;
  const growers: Grower[] = [], wants = perUse(), yields = perUse();
  for (const u of GROWN) {
    const us = t.use[u], cap = C[u];
    const have = cap + c.pendingCap(t, u);
    const r = have > 0 ? us.demand / have : us.demand >= BUILDINGS[ENTRY[u]].cap * 0.7 ? T.growAt : 0;
    if (r >= T.growAt) us.up++; else if (r < T.stopGrowBelow) us.up = 0;
    if (r <= T.declineAt && have > 0) us.down++; else if (r >= T.recoverAt) us.down = 0;
    // settled until demand recovers or falls on further
    if (us.settled && (r >= T.recoverAt || us.demand < us.settled * 0.95)) us.settled = 0;
    us.stuck = false;
    // a use wanted no more than it stands lets other uses build on plots cleared of it
    wants[u] = r >= T.stopGrowBelow ? 1 : 0;
    // and one about to give buildings up can give them over to a use that has no land
    yields[u] = us.down >= T.declineAfter && !us.settled ? 1 : 0;
    if (us.up < T.growAfter) continue;
    const g: Grower = { u, budget: Math.min(us.demand - have, Math.max(T.growMax * have, BUILDINGS[ENTRY[u]].cap)), actions: 0, total: have, empty: 0, cands: [], next: 0 };
    // bring abandoned buildings back first: they're standing already
    const empty = t.zones.flatMap((z) => z.buildings.filter((b) => b.abandoned && b.use === u)).sort((a, b) => b.site - a.site || a.id - b.id);
    g.empty = empty.length;
    for (const b of empty) {
      if (g.budget <= 0 || g.actions >= T.maxActions) break;
      if (!fits(t, g, b.cap, T)) continue;
      c.restore(b); g.budget -= b.cap; g.total += b.cap; g.actions++;
    }
    growers.push(g);
  }
  for (const g of growers) g.cands = candidates(t, g.u, c, wants, yields);
  // what stands of each use as buildings are redeveloped for another
  const stands = perUse();
  for (const z of t.zones) for (const b of z.buildings) if (!b.abandoned) stands[b.use] += b.cap;
  // The uses share the free plots: each new building goes to the use that wants more most
  // keenly just then (demand over what it has, counting what it's building), not to whichever
  // is looked at first, so how soon the game answers changes when things go up, not what.
  for (;;) {
    let best: Grower | null = null, keen = 0;
    for (const g of growers) {
      if (g.budget <= 0 || g.actions >= T.maxActions || g.next >= g.cands.length) continue;
      const k = t.use[g.u].demand / Math.max(1, g.total);
      if (!best || k > keen) { best = g; keen = k; }
    }
    if (!best) break;
    const g = best, cand = g.cands[g.next++];
    if (!fits(t, g, cand.gain, T)) continue;
    if (cand.b) c.densify(cand.b, cand.kind);
    else if (cand.from) {
      // Redevelop a building of a use that isn't wanted (the emptiest first) for one that is and
      // has no land, rather than let the first empty for want of the second: only while what's
      // left of the old use is still no less than it's wanted.
      const b = cand.from, w = b.use as Exclude<Use, 'civic'>;
      if (b.abandoned || b.densify || !yields[w] || t.use[w].demand > (stands[w] - b.cap) * T.stopGrowBelow) continue;
      const movers = b.cap * b.occ;
      stands[w] -= b.cap;
      t.done.lost += b.cap;
      c.demolish(b);
      b.zone.buildings = b.zone.buildings.filter((x) => x !== b);
      rehouse(b.zone.town.zones.flatMap((z) => z.buildings.filter((x) => !x.abandoned && x.use === w)), movers);
      c.add(cand.z, cand.kind, w);
    } else {
      // a plot cleared of this use, else a free one, else one cleared of a use not wanted
      const src = cand.z.cleared[g.u] > 0 ? g.u : cand.z.plots - cand.z.reserved > 0 ? null : GROWN.find((w) => w !== g.u && !wants[w] && cand.z.cleared[w] > 0);
      if (src === undefined) continue;
      c.add(cand.z, cand.kind, src);
    }
    g.budget -= cand.gain; g.total += cand.gain; g.actions++;
  }
  for (const g of growers) {
    const us = t.use[g.u];
    if (g.actions) { us.grew = c.month; us.up = T.growAfter - 1; } else us.stuck = !g.empty && !g.cands.length;
  }
  for (const u of GROWN) shrink(t, u, Math.min(C[u], stands[u]), c);
}

interface Grower { u: Exclude<Use, 'civic'>; budget: number; actions: number; total: number; empty: number; cands: Cand[]; next: number }
// Buildings come in lumps. Only add one if demand would still fill it well enough not to tip the
// town straight into decline, or a town could build, empty and rebuild for ever.
const fits = (t: TState, g: Grower, gain: number, T: Tune) =>
  t.use[g.u].demand / (g.total + gain) >= T.recoverAt && (gain <= g.budget * 1.5 || (g.actions === 0 && gain <= g.budget * 2));

function shrink(t: TState, u: Exclude<Use, 'civic'>, cap: number, c: TownCtx) {
  const T = c.tune, us = t.use[u];
  if (us.down >= T.declineAfter && !us.settled) {
    // people leave the emptiest, worst-placed buildings first; those left move to vacancies
    const live = t.zones.flatMap((z) => z.buildings.filter((b) => !b.abandoned && b.use === u && !b.densify))
      .sort((a, b) => a.occ - b.occ || a.site - b.site || a.id - b.id);
    // at most a few per cent a month, but always room for one building, or big ones never go
    const smallest = live.reduce((m, b) => Math.min(m, b.cap), Infinity);
    let excess = Math.min(cap - us.demand / T.recoverAt, Math.max(T.declineMax * cap, smallest));
    let n = 0, left = cap, movers = 0;
    for (const b of live) {
      if (excess <= 0 || live.length - n <= 1) break;
      if (b.cap > excess * 1.5 && n > 0) continue;
      if (b.cap > excess * 2) continue;
      // and never abandon so much that what's left is wanted enough to grow again
      if (left - b.cap <= 0 || us.demand / (left - b.cap) > T.stopGrowBelow) continue;
      left -= b.cap;
      movers += b.cap * b.occ;
      b.occ = 0;
      c.abandon(b);
      excess -= b.cap; n++;
    }
    if (n) {
      rehouse(live.filter((x) => !x.abandoned), movers);
      us.shrank = c.month;
    } else us.settled = us.demand; // what's left is too lumpy to give up any more: it has settled
  }
}

function rehouse(into: BState[], movers: number) {
  let room = 0;
  for (const b of into) room += b.cap * (1 - b.occ);
  if (room <= 0 || movers <= 0) return;
  const f = Math.min(1, movers / room);
  for (const b of into) b.occ += (1 - b.occ) * f;
}

interface Cand { z: ZState; b?: BState; from?: BState; kind: BuildingKind; gain: number; score: number }
// Where to build: a free plot (or one cleared of this use, or of a use not wanted) where demand
// is keenest, or a denser building where people most want to be (near a station, with nowhere
// left to spread), like land values rising.
function candidates(t: TState, u: Exclude<Use, 'civic'>, c: TownCtx, wants: PerUse, yields: PerUse): Cand[] {
  const out: Cand[] = [];
  const T = c.tune;
  for (const z of t.zones) {
    const f = factorOf(t, z, u, T);
    const free = Math.max(0, z.plots - z.reserved);
    let land = free + z.cleared[u];
    for (const w of GROWN) if (w !== u && !wants[w]) land += z.cleared[w];
    const kind = ENTRY[u];
    if (land > 0 && z.blocked <= 0 && allowed(z, kind))
      for (let n = 0; n < Math.min(land, T.maxActions); n++)
        out.push({ z, kind, gain: BUILDINGS[kind].cap, score: f + (u === 'office' ? 0.2 : 0.1) * z.cov + 0.05 * z.centre - 0.01 * n });
    // failing all else, a building of a use about to give some up, to redevelop (see decide)
    if (z.blocked <= 0 && allowed(z, kind))
      for (const b of z.buildings)
        if (!b.abandoned && !b.densify && b.use !== u && yields[b.use] && b.cap < BUILDINGS[kind].cap)
          out.push({ z, from: b, kind, gain: BUILDINGS[kind].cap, score: f - 2 - b.occ - 0.1 * b.site });
    // densify only where people want more than there is
    if (f * t.bias[u] < 1) continue;
    for (const b of z.buildings) {
      if (b.abandoned || b.use !== u || b.densify || b.occ < 0.85 || b.rest > c.month) continue;
      const next = BUILDINGS[b.kind].next;
      if (!next || !allowed(z, next)) continue;
      out.push({ z, b, kind: next, gain: BUILDINGS[next].cap - b.cap, score: f + 0.15 * z.cov + (free > 0 ? -0.05 : 0.1) + 0.1 * (b.site - 0.5) });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.z.id - b.z.id || (a.b?.id ?? -1) - (b.b?.id ?? -1));
}

// How keen demand is in a zone, relative to what's there: residents' reach for homes; for jobs,
// the workers (and for shops the customers) who get there per place. Zones with none of a use
// yet borrow the town's figures.
export function factorOf(t: TState, z: ZState, u: Use, T: Tune) {
  if (u === 'home') return z.pHome;
  const L = z.cap.shop + z.cap.office + z.cap.works + z.cap.civic + z.indJobs > 0 ? z.labour : t.labour;
  if (u === 'shop') return clamp(Math.min(L, z.cap.shop > 0 ? z.customers : t.customers), 0, T.jobCap);
  return clamp(L, 0, T.jobCap);
}

// ---------------- explaining it ----------------
function facts(t: TState, c: TownCtx, abandoned: number, built: number, lost: number): Facts {
  const T = c.tune;
  let R = 0, homes = 0, jobs = 0, near = 0, plots = 0;
  let w = 0, wc = 0, wn = 0, wp = 0, s = 0, l = 0;
  const cs = t.carShare;
  for (const z of t.zones) {
    const i = z.idx, res = z.occCap.home;
    R += res; homes += z.cap.home; near += z.cap.home * z.covHome; plots += Math.max(0, z.plots - z.reserved);
    for (const u of GROWN) plots += z.cleared[u];
    jobs += z.cap.shop + z.cap.office + z.cap.works + z.cap.civic + z.indJobs;
    wc += res * Math.min(1, c.work.car[i]); wn += res * Math.min(1, c.work.nc[i]); wp += res * Math.min(1, c.work.pt[i]);
    w += res * (cs * Math.min(1, c.work.car[i]) + (1 - cs) * Math.min(1, c.work.nc[i]));
    s += res * (cs * Math.min(1, c.shop.car[i]) + (1 - cs) * Math.min(1, c.shop.nc[i]));
    l += res * (cs * Math.min(1, c.leisure.car[i]) + (1 - cs) * Math.min(1, c.leisure.nc[i]));
  }
  const d = Math.max(1, R), cap = (u: Use) => t.zones.reduce((a, z) => a + z.cap[u], 0);
  const need = (have: number, per: number) => (have > 0 ? have * per : 0);
  const share = (local: number, sup: number, n: number) => (n > 0 && Number.isFinite(local) ? (local + sup) / n : NaN); // (NaN: nothing to say: no such businesses, or the town finds all they need)
  const gN = need(cap('shop'), T.goodsPerShopJobHour), mN = need(cap('works'), T.materialsPerWorksJobHour), vN = need(cap('office'), T.visitsPerOfficeJobDay / 24);
  const ratio = perUse();
  for (const u of GROWN) { const cu = cap(u) + c.pendingCap(t, u); ratio[u] = cu > 0 ? t.use[u].demand / cu : 0; }
  const svc = c.service(t);
  return {
    residents: R, homes, vacancy: homes > 0 ? 1 - R / homes : 0, jobs, workers: R * T.workerShare,
    reachWork: w / d, workCar: wc / d, workNoCar: wn / d, workTransit: wp / d, reachShop: s / d, reachLeisure: l / d,
    goods: share(found(T.local.goods, t.base.shop) * T.goodsPerShopJobHour, t.supply.goods, gN),
    materials: share(found(T.local.materials, t.base.works) * T.materialsPerWorksJobHour, t.supply.materials, mN),
    visitors: share(found(T.local.visitors, t.base.office) * (T.visitsPerOfficeJobDay / 24), t.supply.visitors, vN),
    stops: svc.stops, lines: svc.lines, homesNearStop: homes > 0 ? near / homes : 0, plots, abandoned, ratio, built, lost, crowding: c.crowding(t),
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function report(t: TState, T: Tune): TownReport {
  const f = t.facts!;
  const reasons: Reason[] = [];
  const add = (text: string, good: boolean, weight: number) => reasons.push({ text, good, weight });
  // getting about
  if (f.stops === 0) add('no bus or rail service', false, 0.3 * (1 - t.carShare) + 0.1);
  else if (f.homesNearStop < 0.5) add(`only ${pct(f.homesNearStop)} of homes are near a bus or rail stop`, false, 0.2 * (1 - f.homesNearStop));
  else add(`${pct(f.homesNearStop)} of homes are near a bus or rail stop`, true, 0.1 * f.homesNearStop);
  if (f.reachWork >= 0.8) add(`${pct(f.reachWork)} of workers can get to a job within ${T.workMin} min`, true, 0.3 * f.reachWork);
  else add(`only ${pct(f.reachWork)} of workers can get to a job within ${T.workMin} min`, false, 0.55 * (1 - f.reachWork));
  if (f.workNoCar < 0.6 && f.reachWork < 0.95) add(`only ${pct(f.workNoCar)} of people without a car can get to work in ${T.workMin} min`, false, 0.3 * (1 - f.workNoCar) * (1 - t.carShare));
  if (f.workers > f.jobs * 1.15 && f.reachWork < 0.9) add(`not enough jobs: ${Math.round(f.workers).toLocaleString('en-GB')} workers for ${Math.round(f.jobs).toLocaleString('en-GB')} jobs`, false, 0.2);
  // full vehicles: a journey on your lines counts towards reach only for those who find room
  const cr = f.crowding;
  if (cr.line && cr.share >= 0.1)
    add(`${cr.line.rail ? 'trains' : 'buses'} on ${cr.line.name} are full: ${pct(cr.line.share)} of people waiting couldn't get on`, false, 0.5 * cr.share);
  if (f.reachShop < 0.8) add(`shops within ${T.shopMin} min can serve only ${pct(f.reachShop)} of residents`, false, 0.3 * (1 - f.reachShop));
  // what it's fed
  // How well supplied is judged on the town's memory of deliveries (as growth is), but what it
  // says is arriving is what your lines brought last month, so a town nothing comes to says so.
  const fed = (v: number, what: string, stuff: string, per: number) => {
    if (Number.isNaN(v)) return;
    if (v < 0.9) add(`${what} only ${pct(Math.min(v, 9.99))} supplied with ${stuff}${per < 0.01 ? `, no ${stuff} delivered` : ''}`, false, 0.5 * (1 - v));
    else if (v >= 1.05) add(`${what} well supplied with ${stuff} (${pct(Math.min(v, 9.99))})`, true, 0.3 * Math.min(1, v - 1) + 0.05);
  };
  fed(f.goods, 'shops', 'goods', t.delivered.goods);
  fed(f.materials, 'works', 'building materials', t.delivered.materials);
  if (!Number.isNaN(f.visitors)) {
    const day = Math.round(t.delivered.visitors * 24);
    const arriving = day < 1 ? 'no passengers arriving by your lines' : `${day.toLocaleString('en-GB')} passenger${day === 1 ? '' : 's'} a day`;
    if (f.visitors < 0.9) add(`offices get ${pct(f.visitors)} of the visitors they need (${arriving})`, false, 0.5 * (1 - f.visitors));
    else if (f.visitors >= 1.05) add(`offices busy with visitors (${arriving})`, true, 0.3 * Math.min(1, f.visitors - 1) + 0.05);
  }
  // what it's doing: symptoms, so they rank below the causes
  if (f.vacancy > 0.1) add(`${pct(f.vacancy)} of homes empty`, false, Math.min(0.12, f.vacancy / 2));
  if (f.abandoned) add(`${f.abandoned} building${f.abandoned > 1 ? 's' : ''} abandoned`, false, Math.min(0.1, 0.01 * f.abandoned));
  for (const u of GROWN) if (t.use[u].stuck) add(`nowhere left to build ${USE_NAME[u][1]}`, false, 0.15);
  reasons.sort((a, b) => b.weight - a.weight || a.text.localeCompare(b.text));
  const status = statusOf(t, T);
  // lead with what's driving it; a thriving town still says what's holding it back
  const upbeat = status === 'growing' || status === 'stable';
  const top = reasons.filter((r) => r.good === upbeat).slice(0, 2);
  const worst = upbeat ? reasons.find((r) => !r.good && r.weight >= 0.1) : undefined;
  const lead = { growing: 'Growing', stable: 'Stable', stalling: 'Stalling', declining: 'Declining' }[status];
  const headline = (top.length ? `${lead}: ${top.map((r) => r.text).join('; ')}` : lead) + (worst ? `, but ${worst.text}` : '');
  const uses = {} as Record<Use, UseReport>;
  for (const u of USES) {
    let capacity = 0, occupied = 0, buildings = 0, ab = 0;
    for (const z of t.zones) for (const b of z.buildings) {
      if (b.use !== u) continue;
      if (b.abandoned) { ab++; continue; }
      buildings++; capacity += b.cap; occupied += b.cap * b.occ;
    }
    const demand = u === 'civic' ? capacity : t.use[u].demand;
    uses[u] = { capacity, occupied, demand, pressure: capacity > 0 ? demand / capacity : 0, buildings, abandoned: ab };
  }
  return {
    id: t.id, name: t.name, status, headline, reasons,
    residents: Math.round(f.residents), homes: f.homes, vacancy: f.vacancy, jobs: Math.round(f.jobs), workers: Math.round(f.workers), uses,
    reach: { work: f.reachWork, workCar: f.workCar, workNoCar: f.workNoCar, workTransit: f.workTransit, shop: f.reachShop, leisure: f.reachLeisure },
    supply: {
      goods: f.goods, materials: f.materials, visitors: f.visitors,
      goodsPerHour: t.delivered.goods, materialsPerHour: t.delivered.materials, visitorsPerDay: t.delivered.visitors * 24,
    },
    service: { stops: f.stops, lines: f.lines, homesNearStop: f.homesNearStop, plots: f.plots, turnedAway: f.crowding.share },
    history: [...t.history],
  };
}

// Growing or declining is judged on what was built (and put up by the game) against what was
// lost lately and on where the population is heading, so a town adding homes while its shops
// close still reads growing. Demand for more that nothing comes of (it wouldn't fill another
// building, or there's nowhere to put one) isn't growth; demand that has fallen and settled
// isn't stalling.
function statusOf(t: TState, T: Tune): TownStatus {
  const h = t.history, f = t.facts!;
  const built = t.recent.built.reduce((a, v) => a + v, 0), lost = t.recent.lost.reduce((a, v) => a + v, 0);
  const trend = h.length >= 4 && h[h.length - 4] > 0 ? h[h.length - 1] / h[h.length - 4] - 1 : 0;
  // demand well below what's there, counting towards giving some up
  const falling = (u: Exclude<Use, 'civic'>) => t.use[u].down > 0 && !t.use[u].settled && f.ratio[u] <= T.declineAt;
  if (trend < -0.03 || (lost > built && trend < 0.01)) return 'declining';
  // people no longer want to live here as much: whatever went up lately, it's stalled
  if (falling('home')) return 'stalling';
  if (built > lost || trend > 0.01) return 'growing';
  if (GROWN.some(falling)) return 'stalling';
  return 'stable';
}
