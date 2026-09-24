// Towns: what each use of building is in demand for, and what the town does about it.
// Each month, for every town and every use (homes, shops, offices, works):
//  - demand is worked out from what the town is fed and what its people can reach:
//      homes   follow reach: can residents get to work, shops and leisure in reasonable time?
//      shops   follow customers who can reach them and workers, capped by goods supplied
//      offices follow workers who can reach them, capped by passengers arriving
//      works   follow workers who can reach them, capped by building materials supplied
//    (a town finds some of what it needs for itself: a share of what it started with)
//  - demand is smoothed, and set against capacity with hysteresis: only months of demand above
//    capacity build (a free plot, or a denser building where people most want to be), and only
//    months well below it abandon the emptiest buildings, which are cleared later still;
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
}
export type PerUse = Record<Use, number>;
export const perUse = (v = 0): PerUse => ({ home: v, shop: v, office: v, works: v, civic: v });

export interface ZState extends ZoneGeo {
  idx: number; town: TState; plots: number; reserved: number; blocked: number; allow: Set<BuildingKind> | null;
  buildings: BState[]; indJobs: number;
  cov: number; // share of the zone (by capacity) near a served bus or rail stop
  centre: number; // 0..1, how central in its town
  cap: PerUse; occCap: PerUse; // this review's tallies
  pHome: number; labour: number; customers: number;
}
export interface UState { demand: number; raw: number; up: number; down: number; grew: number; shrank: number; stuck: boolean }
export interface Facts {
  residents: number; homes: number; vacancy: number; jobs: number; workers: number;
  reachWork: number; workCar: number; workNoCar: number; workTransit: number; reachShop: number; reachLeisure: number;
  goods: number; materials: number; visitors: number; // supplied share of need (NaN when nothing needs it)
  stops: number; lines: number; homesNearStop: number; plots: number; abandoned: number;
  ratio: PerUse; built: number; lost: number;
}
export interface TState {
  id: number; name: string; x: number; z: number; carShare: number; zones: ZState[];
  base: PerUse; bias: PerUse; calibrated: boolean; primed: boolean;
  labour: number; customers: number; // town-wide: workers per job, customers per shop place
  supply: { goods: number; materials: number; visitors: number }; // smoothed, per hour
  month: { goods: number; materials: number; visitors: number }; // delivered so far this month
  use: Record<Use, UState>;
  health: PerUse; // how much of each use's capacity businesses want to keep going
  history: number[];
  recent: { built: number[]; lost: number[] }; // capacity built and lost at the last few reviews
  facts: Facts | null;
  report: TownReport | null;
}

export function newTown(id: number, name: string, x: number, z: number, carShare: number): TState {
  const u = (): UState => ({ demand: 0, raw: 0, up: 0, down: 0, grew: -99, shrank: -99, stuck: false });
  return {
    id, name, x, z, carShare, zones: [], base: perUse(), bias: perUse(1), calibrated: false, primed: false, labour: 1, customers: 1,
    supply: { goods: 0, materials: 0, visitors: 0 }, month: { goods: 0, materials: 0, visitors: 0 },
    use: { home: u(), shop: u(), office: u(), works: u(), civic: u() }, health: perUse(1), history: [], recent: { built: [], lost: [] }, facts: null, report: null,
  };
}

// What the economy lends the town review: this month's reach, and hands to act with.
export interface TownCtx {
  tune: Tune; month: number; calibrate: boolean; assess: boolean; // assess: work out demand but change nothing
  work: Reach; shop: Reach; leisure: Reach;
  workSupply: Float64Array; shopSupply: Float64Array;
  pendingCap(t: TState, use: Use): number;
  add(z: ZState, kind: BuildingKind): void;
  densify(b: BState, kind: BuildingKind): void;
  abandon(b: BState): void; restore(b: BState): void; demolish(b: BState): void; vacate(b: BState, fraction: number): void;
  service(t: TState): { stops: number; lines: number };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
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
    t.primed = true;
  }
  supplyB.shop = T.local.goods * t.base.shop + t.supply.goods / T.goodsPerShopJobHour;
  supplyB.office = T.local.visitors * t.base.office + t.supply.visitors / (T.visitsPerOfficeJobDay / 24);
  supplyB.works = T.local.materials * t.base.works + t.supply.materials / T.materialsPerWorksJobHour;
  // A town that starts short of what its size needs is lifted to balance, so it doesn't shrink
  // just because of how the map was made. One that starts with more than it needs keeps the
  // headroom and grows into it.
  if (c.calibrate && !t.calibrated) {
    for (const u of GROWN) t.bias[u] = C[u] > 0 && struct[u] > 0 ? clamp(C[u] / struct[u], 1, 1.6) : 1;
    t.calibrated = true;
  }
  const D = perUse();
  for (const u of GROWN) {
    const us = t.use[u];
    us.raw = u === 'home' ? t.bias.home * struct.home : Math.min(t.bias[u] * struct[u] * (1 + T.labourSlack), supplyB[u]);
    D[u] = us.raw;
    us.demand = c.assess && us.demand === 0 ? C[u] : us.demand + T.demandAlpha * (D[u] - us.demand);
    if (c.assess && C[u] === 0) us.demand = 0;
  }
  let built = 0, lost = 0;
  if (!c.assess) {
    for (const u of GROWN) {
      const r = decide(t, u, C[u], c);
      built += r.built; lost += r.lost;
    }
    for (const z of t.zones) for (const b of z.buildings)
      if (b.abandoned && c.month - b.since >= T.demolishAfter && t.use[b.use].up === 0) c.demolish(b);
  }
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
    t.health[u] = cu > 0 ? Math.min(1, d / cu) : 1;
  }
  // a town that stays bigger comes to find more for itself (only upwards: shrinking doesn't
  // lower the floor, or an unserved town would fade away for ever)
  for (const u of GROWN) {
    const now = t.zones.reduce((s, z) => s + z.cap[u], 0);
    if (now > t.base[u]) t.base[u] += T.baseDrift * (now - t.base[u]);
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

// Grow, hold or shrink one use of one town.
function decide(t: TState, u: Exclude<Use, 'civic'>, cap: number, c: TownCtx) {
  const T = c.tune, us = t.use[u];
  const have = cap + c.pendingCap(t, u);
  const r = have > 0 ? us.demand / have : us.demand >= BUILDINGS[ENTRY[u]].cap * 0.7 ? T.growAt : 0;
  if (r >= T.growAt) us.up++; else if (r < T.stopGrowBelow) us.up = 0;
  if (r <= T.declineAt && have > 0) us.down++; else if (r >= T.recoverAt) us.down = 0;
  us.stuck = false;
  let built = 0, lost = 0;
  if (us.up >= T.growAfter) {
    let budget = Math.min(us.demand - have, Math.max(T.growMax * have, BUILDINGS[ENTRY[u]].cap));
    let actions = 0, total = have;
    // Buildings come in lumps. Only add one if demand would still fill it well enough not to
    // tip the town straight into decline, or a town could build, empty and rebuild for ever.
    const fits = (gain: number) => us.demand / (total + gain) >= T.recoverAt && (gain <= budget * 1.5 || (actions === 0 && gain <= budget * 2));
    // bring abandoned buildings back first: they're standing already
    const empty = t.zones.flatMap((z) => z.buildings.filter((b) => b.abandoned && b.use === u)).sort((a, b) => b.site - a.site || a.id - b.id);
    for (const b of empty) {
      if (budget <= 0 || actions >= T.maxActions) break;
      if (!fits(b.cap)) continue;
      c.restore(b); budget -= b.cap; total += b.cap; built += b.cap; actions++;
    }
    const cands = candidates(t, u, c);
    for (const cand of cands) {
      if (budget <= 0 || actions >= T.maxActions) break;
      if (!fits(cand.gain)) continue;
      if (cand.b) c.densify(cand.b, cand.kind); else c.add(cand.z, cand.kind);
      budget -= cand.gain; total += cand.gain; built += cand.gain; actions++;
    }
    if (actions) { us.grew = c.month; us.up = T.growAfter - 1; } else us.stuck = !empty.length && !cands.length;
  }
  if (us.down >= T.declineAfter) {
    // people leave the emptiest, worst-placed buildings first; those left move to vacancies
    const live = t.zones.flatMap((z) => z.buildings.filter((b) => !b.abandoned && b.use === u && !b.densify))
      .sort((a, b) => a.occ - b.occ || a.site - b.site || a.id - b.id);
    // at most a few per cent a month, but always room for one building, or big ones never go
    const smallest = live.reduce((m, b) => Math.min(m, b.cap), Infinity);
    let excess = Math.min(cap - us.demand / T.recoverAt, Math.max(T.declineMax * cap, smallest));
    let n = 0, left = cap;
    for (const b of live) {
      if (excess <= 0 || live.length - n <= 1) break;
      if (b.cap > excess * 1.5 && n > 0) continue;
      if (b.cap > excess * 2) continue;
      // and never abandon so much that what's left is wanted enough to grow again
      if (left - b.cap <= 0 || us.demand / (left - b.cap) > T.stopGrowBelow) continue;
      left -= b.cap;
      const movers = b.cap * b.occ;
      b.occ = 0;
      c.abandon(b);
      excess -= b.cap; lost += b.cap; n++;
      rehouse(live.filter((x) => !x.abandoned), movers);
    }
    if (n) us.shrank = c.month;
  }
  return { built, lost };
}

function rehouse(into: BState[], movers: number) {
  let room = 0;
  for (const b of into) room += b.cap * (1 - b.occ);
  if (room <= 0 || movers <= 0) return;
  const f = Math.min(1, movers / room);
  for (const b of into) b.occ += (1 - b.occ) * f;
}

interface Cand { z: ZState; b?: BState; kind: BuildingKind; gain: number; score: number }
// Where to build: a free plot where demand is keenest, or a denser building where people most
// want to be (near a station, with nowhere left to spread), like land values rising.
function candidates(t: TState, u: Exclude<Use, 'civic'>, c: TownCtx): Cand[] {
  const out: Cand[] = [];
  const T = c.tune;
  for (const z of t.zones) {
    const f = factorOf(t, z, u, T);
    const free = z.plots - z.reserved;
    const kind = ENTRY[u];
    if (free > 0 && z.blocked <= 0 && allowed(z, kind))
      for (let n = 0; n < Math.min(free, T.maxActions); n++)
        out.push({ z, kind, gain: BUILDINGS[kind].cap, score: f + (u === 'office' ? 0.2 : 0.1) * z.cov + 0.05 * z.centre - 0.01 * n });
    if (f < 1) continue;
    for (const b of z.buildings) {
      if (b.abandoned || b.use !== u || b.densify || b.occ < 0.85) continue;
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
    R += res; homes += z.cap.home; near += z.cap.home * z.cov; plots += Math.max(0, z.plots - z.reserved);
    jobs += z.cap.shop + z.cap.office + z.cap.works + z.cap.civic + z.indJobs;
    wc += res * Math.min(1, c.work.car[i]); wn += res * Math.min(1, c.work.nc[i]); wp += res * Math.min(1, c.work.pt[i]);
    w += res * (cs * Math.min(1, c.work.car[i]) + (1 - cs) * Math.min(1, c.work.nc[i]));
    s += res * (cs * Math.min(1, c.shop.car[i]) + (1 - cs) * Math.min(1, c.shop.nc[i]));
    l += res * (cs * Math.min(1, c.leisure.car[i]) + (1 - cs) * Math.min(1, c.leisure.nc[i]));
  }
  const d = Math.max(1, R), cap = (u: Use) => t.zones.reduce((a, z) => a + z.cap[u], 0);
  const need = (have: number, per: number) => (have > 0 ? have * per : 0);
  const share = (local: number, sup: number, n: number) => (n > 0 ? (local + sup) / n : NaN);
  const gN = need(cap('shop'), T.goodsPerShopJobHour), mN = need(cap('works'), T.materialsPerWorksJobHour), vN = need(cap('office'), T.visitsPerOfficeJobDay / 24);
  const ratio = perUse();
  for (const u of GROWN) { const cu = cap(u) + c.pendingCap(t, u); ratio[u] = cu > 0 ? t.use[u].demand / cu : 0; }
  const svc = c.service(t);
  return {
    residents: R, homes, vacancy: homes > 0 ? 1 - R / homes : 0, jobs, workers: R * T.workerShare,
    reachWork: w / d, workCar: wc / d, workNoCar: wn / d, workTransit: wp / d, reachShop: s / d, reachLeisure: l / d,
    goods: share(T.local.goods * t.base.shop * T.goodsPerShopJobHour, t.supply.goods, gN),
    materials: share(T.local.materials * t.base.works * T.materialsPerWorksJobHour, t.supply.materials, mN),
    visitors: share(T.local.visitors * t.base.office * (T.visitsPerOfficeJobDay / 24), t.supply.visitors, vN),
    stops: svc.stops, lines: svc.lines, homesNearStop: homes > 0 ? near / homes : 0, plots, abandoned, ratio, built, lost,
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
  if (f.reachShop < 0.8) add(`shops within ${T.shopMin} min can serve only ${pct(f.reachShop)} of residents`, false, 0.3 * (1 - f.reachShop));
  // what it's fed
  const fed = (v: number, what: string, stuff: string, per: number) => {
    if (Number.isNaN(v)) return;
    if (v < 0.9) add(`${what} only ${pct(Math.min(v, 9.99))} supplied with ${stuff}${per < 0.01 ? ` (no ${stuff} delivered)` : ''}`, false, 0.5 * (1 - v));
    else if (v >= 1.05) add(`${what} well supplied with ${stuff} (${pct(Math.min(v, 9.99))})`, true, 0.3 * Math.min(1, v - 1) + 0.05);
  };
  fed(f.goods, 'shops', 'goods', t.supply.goods);
  fed(f.materials, 'works', 'building materials', t.supply.materials);
  if (!Number.isNaN(f.visitors)) {
    const day = Math.round(t.supply.visitors * 24);
    const arriving = day < 1 ? 'no passengers arriving' : `${day.toLocaleString('en-GB')} passenger${day === 1 ? '' : 's'} a day`;
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
      goodsPerHour: t.supply.goods, materialsPerHour: t.supply.materials, visitorsPerDay: t.supply.visitors * 24,
    },
    service: { stops: f.stops, lines: f.lines, homesNearStop: f.homesNearStop, plots: f.plots },
    history: [...t.history],
  };
}

// Growing or declining is judged on what was built against what was lost lately and on where
// the population is heading, so a town adding homes while its shops close still reads growing.
function statusOf(t: TState, T: Tune): TownStatus {
  const f = t.facts!, h = t.history;
  const built = t.recent.built.reduce((a, v) => a + v, 0), lost = t.recent.lost.reduce((a, v) => a + v, 0);
  const trend = h.length >= 4 && h[h.length - 4] > 0 ? h[h.length - 1] / h[h.length - 4] - 1 : 0;
  if (trend < -0.03 || (lost > built && trend < 0.01)) return 'declining';
  // people no longer want to live here as much: whatever went up lately, it's stalled
  if (t.use.home.down > 0 || f.ratio.home < T.recoverAt) return 'stalling';
  if (built > lost || trend > 0.01 || GROWN.some((u) => t.use[u].up > 0 && f.ratio[u] >= T.growAt && !t.use[u].stuck)) return 'growing';
  if (GROWN.some((u) => t.use[u].down > 0)) return 'stalling';
  return 'stable';
}
