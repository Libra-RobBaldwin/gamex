// Test towns for the traffic: roads, their junctions designed the way main.ts does it, plots along
// the roads for trips to start and end at, then heavy traffic driven for a few simulated minutes,
// counting every frame in which two vehicles overlap as drawn. Used by traffic.test.ts.
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng, type P } from './roads';
import { design, landFits, legsAt, type Form, type Junction } from './junction';
import { Traffic, type Places } from './traffic';
import { laneSpan } from './xsection';
import { motorwayCloverleaf, motorwayWithJunction, pairToNode, pairUpMotorways, type IxForm, type IxSize, type SlipStyle } from './interchange/build';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
const geo = (n: Network, node: number) => ({ fits: (polys: Parameters<typeof landFits>[2]) => landFits(n, node, polys) });

// build: lays the roads out; it may say which form some junctions must take (an interchange's)
// through: no works on the map, so its lorries come from roads off the map (along a motorway, say)
// (bound: the map's half-size, for a scenario that needs more room than most)
export interface Scenario { name: string; build: (n: Network) => void | { prefer?: Record<number, Form> }; bound?: number; through?: boolean; forms?: string[]; prefer?: Form; cars: number; buses?: number; stops?: boolean; minTrips: number; minChanges?: number }

export function town(sc: Scenario) {
  const net = new Network(() => false, sc.bound ?? 900);
  const built = sc.build(net) ?? {};
  const junctions = new Map<number, Junction>();
  for (const nd of net.nodes.values()) {
    if (legsAt(net, nd.id).length < 3) continue;
    // (an interchange's junctions take the form it built them for, without slip lanes of their own)
    const ixf = built.prefer?.[nd.id], pf = ixf ? { form: ixf, slip: false } : sc.prefer ? { form: sc.prefer } : undefined;
    const j = design(net, nd.id, geo(net, nd.id), undefined, pf);
    if (j) { junctions.set(nd.id, j); net.land.claim(`junction:${nd.id}`, 'junction', j.shape?.claims ?? []); }
  }
  for (const id of net.segs.keys()) for (const l of net.plotsFor(id, { x: 999, z: 999 })) if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
  if (sc.stops) {
    // a kerbside stop and a lay-by on the longest road
    const s = [...net.segs.values()].sort((a, b) => net.length(b) - net.length(a))[0], L = net.length(s);
    const k = net.planStop(s.id, L * 0.35, 1), b = net.planStop(s.id, L * 0.6, -1);
    if (k.plans[0]) net.addStop(s.id, L * 0.35, 1, k.plans[0]);
    const lay = b.plans.find((p) => p.kind === 'layby' && p.ok);
    if (lay) net.addStop(s.id, L * 0.6, -1, lay);
  }
  const lots = net.lots;
  const places: Places = {
    homes: lots.filter((_, i) => i % 3 !== 2), jobs: lots.filter((_, i) => i % 3 === 2), shops: lots.filter((_, i) => i % 6 === 2),
    works: sc.through ? [] : lots.filter((_, i) => i % 9 === 5), weight: () => 1,
  };
  return { net, junctions, places };
}

export interface RunResult {
  overlapFrames: number; overlapPairs: number; worst: number; spawned: number; arrived: number; gaveUp: number; live: number; msPerUpdate: number; forms: string[]; sample?: string;
  laneChanges: number; outOfLane: number; // vehicles in a lane where xsection.laneSpan says it isn't usable (vehicle-frames)
  gaps?: { priority: GapStats; ring: GapStats };
}
// Time from gap to go at give-way lines (with `gaps`): for each driver standing at the line
// (Traffic.gapProbe), from the moment the last vehicle in their way got clear to moving off at
// 1 m/s (go: split by whether that was traffic they gave way to, or the one ahead from their own
// approach); stretches of 3 s or more with nobody in the way that ended with someone in the way
// again, the driver still standing (missed); and waits with nobody in the way at all (idle), with
// what the driver said it was waiting for.
// all: every standing episode's time from the way being clear (or from drawing up, if it always was)
// to moving off, whichever kind: what a player sees as how quick drivers are to go
export interface GapStats { n: number; go50: number; go90: number; goMax: number; own50: number; nOwn: number; missed: number; idle: number; idle50: number; all: { n: number; p50: number; p90: number; p99: number; sum: number }; why: Record<string, number> }
const pct = (a: number[], p: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
function gapTracker(dt: number) {
  type W = { ring: boolean; since: number; clearAt?: number; own?: boolean; blockedEver: boolean; why: Record<string, number> };
  const st = new Map<number, W>();
  const mk = () => ({ go: [] as number[], own: [] as number[], missed: 0, idle: [] as number[], why: {} as Record<string, number> });
  const acc = { priority: mk(), ring: mk() };
  return {
    step(tr: Traffic, t: number) {
      const seen = new Set<number>();
      for (const w of tr.gapProbe()) {
        seen.add(w.id);
        let s = st.get(w.id);
        if (!s) { if (w.v >= 0.3) continue; st.set(w.id, (s = { ring: w.ring, since: t, blockedEver: false, why: {} })); }
        const a = w.ring ? acc.ring : acc.priority;
        if (w.v > 1) continue;
        if (w.blocked) {
          if (s.clearAt !== undefined && t - s.clearAt >= 3) a.missed++;
          s.clearAt = undefined; s.own = w.own; s.blockedEver = true;
        } else {
          s.clearAt ??= t;
          const k = (w.committed ? 'committed' : w.why ?? '?').replace(/#\d+/g, '#');
          s.why[k] = (s.why[k] ?? 0) + dt;
        }
      }
      for (const [id, s] of st) {
        const c = tr.cars.find((x) => x.id === id);
        const went = !!c && (c.v > 1 || !!c.turn);
        if (seen.has(id) && !went) continue;
        st.delete(id);
        if (!went) continue;
        const a = s.ring ? acc.ring : acc.priority;
        if (!s.blockedEver) a.idle.push(t - s.since);
        else if (s.own) a.own.push(t - (s.clearAt ?? t));
        else a.go.push(t - (s.clearAt ?? t));
        // (what it waited for with nobody in its way)
        if (s.clearAt !== undefined && t - s.clearAt > 1.5) for (const [k, v] of Object.entries(s.why)) a.why[k] = +((a.why[k] ?? 0) + v).toFixed(1);
      }
    },
    result(): { priority: GapStats; ring: GapStats } {
      const f = (a: ReturnType<typeof mk>): GapStats => ({ all: ((x) => ({ n: x.length, p50: pct(x, 0.5), p90: pct(x, 0.9), p99: pct(x, 0.99), sum: +x.reduce((t, v) => t + v, 0).toFixed(1) }))([...a.go, ...a.own, ...a.idle]), n: a.go.length, go50: pct(a.go, 0.5), go90: pct(a.go, 0.9), goMax: pct(a.go, 1), own50: pct(a.own, 0.5), nOwn: a.own.length, missed: a.missed, idle: a.idle.length, idle50: pct(a.idle, 0.5), why: a.why });
      return { priority: f(acc.priority), ring: f(acc.ring) };
    },
  };
}
export function simulate(sc: Scenario, seconds = 180, dt = 1 / 30, onStep?: (traffic: Traffic, t: number, ov: ReturnType<Traffic['overlaps']>) => void, seed = 11, opts: { gaps?: boolean } = {}): RunResult {
  const { net, junctions, places } = town(sc);
  const traffic = new Traffic(net, new THREE.Scene(), rng(seed));
  traffic.junctions = junctions;
  for (let i = 0; i < (sc.buses ?? 0); i++) traffic.addBus();
  // enough demand to keep about sc.cars vehicles on the roads
  const people = places.homes.length;
  const level = (sc.cars * 16) / Math.max(1, people) / 1.25;
  let overlapFrames = 0, worst = 0, ms = 0, outOfLane = 0, sample: string | undefined;
  const seen = new Set<string>(), gaps = opts.gaps ? gapTracker(dt) : undefined;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const now = i * dt * 1000;
    for (let k = 0; k < 3; k++) traffic.generate(places, 8.2, level, now);
    const t0 = performance.now();
    traffic.update(dt, now);
    ms += performance.now() - t0;
    const ov = traffic.overlaps();
    onStep?.(traffic, i * dt, ov);
    gaps?.step(traffic, i * dt);
    // the taper contract: nobody is ever in a lane before it opens or after it has ended
    for (const c of traffic.cars) {
      if (c.turn || c.gone !== undefined || c.inBay || (c.bus && net.def(c.seg).bus)) continue;
      const [a, b] = laneSpan(net, c.seg, c.from, c.lane), L = net.length(c.seg);
      if ((a > 0.5 && c.s - c.back < a - 0.5) || (b < L - 0.5 && c.s + c.front > b + 0.5)) outOfLane++;
    }
    if (ov.length) {
      overlapFrames++;
      worst = Math.max(worst, ov.length);
      for (const [a, b] of ov) {
        const key = `${a.id}:${b.id}`;
        if (!seen.has(key) && !sample) sample = `t=${(i * dt).toFixed(1)} ${a.kind}#${a.id} (${a.x.toFixed(1)},${a.z.toFixed(1)}) vs ${b.kind}#${b.id} (${b.x.toFixed(1)},${b.z.toFixed(1)}) ${traffic.describe(a.id)} | ${traffic.describe(b.id)}`;
        seen.add(key);
      }
    }
  }
  return { overlapFrames, overlapPairs: seen.size, worst, spawned: traffic.stats.spawned, arrived: traffic.stats.arrived, gaveUp: traffic.stats.gaveUp, live: traffic.live, msPerUpdate: ms / steps, laneChanges: traffic.stats.laneChanges, outOfLane, forms: [...junctions.values()].map((j) => j.form + (j.slip ? '+slip' : '')), sample, gaps: gaps?.result() };
}

const cross = (type: string) => (n: Network) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as(type)); n.build({ x: 0, z: -250 }, { x: 0, z: 250 }, undefined, as(type)); };
const tee = (main: string, side = 'street') => (n: Network) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as(main)); n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 250 }, undefined, as(side)); };

// minTrips: a floor on trips completed in three minutes (about 60% of what each manages); give-ups
// (drivers stuck for 90 s) must stay under one trip in a hundred; minChanges: lane changes that have to happen there.
export const SCENARIOS: Scenario[] = [
  { name: 'roundabout, single-lane approaches', build: cross('rural-40'), prefer: 'roundabout', forms: ['roundabout'], cars: 90, minTrips: 80 },
  { name: 'roundabout, dual-lane approaches', build: cross('dual'), forms: ['roundabout'], cars: 130, minTrips: 90 },
  { name: 'priority T', build: tee('street'), forms: ['priority'], cars: 60, buses: 1, minTrips: 90 },
  { name: 'signals with a slip lane', build: tee('arterial-2-30-0-0-0'), forms: ['signals+slip'], cars: 90, minTrips: 110 },
  { name: 'mini-roundabout', build: cross('street'), forms: ['mini'], cars: 70, minTrips: 75 },
  {
    // the offside lane ends before the join: everyone in it has to merge
    name: 'dual carriageway tapering into a street', cars: 70, minTrips: 120, forms: [], minChanges: 20,
    build: (n) => { n.build({ x: -300, z: 0 }, { x: 0, z: 0 }); n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 300, z: 0 }, undefined, as('dual')); },
  },
  {
    name: 'plain join at a bend', cars: 50, minTrips: 140, forms: [], buses: 1,
    build: (n) => { n.build({ x: -260, z: 0 }, { x: 0, z: 0 }); n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 130, z: 225 }); },
  },
  {
    name: 'dual carriageway tapering into a street round a bend', cars: 70, minTrips: 100, forms: [], minChanges: 10,
    build: (n) => { n.build({ x: -300, z: 0 }, { x: 0, z: 0 }); n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 212, z: 212 }, undefined, as('dual')); },
  },
  {
    // the starter town's roads (as main.ts lays them out): every kind of junction at once, a bypass
    // running on into streets, flyovers, a tunnel, an estate full of lorries, roads off the map
    name: 'the starter town', cars: 180, minTrips: 75, buses: 4, forms: undefined, build: (n) => {
      const road = (a: P, b: P, c?: P, o = DEFAULT_OPTS) => n.build(n.snapStart(a, 3), n.snapStart(b, 3), c, o);
      const over = { ...DEFAULT_OPTS, cross: 'bridge' as const };
      const bypass = n.makePath({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 });
      const k = bypass.findIndex((p) => p.z < 0), [p0, p1] = [bypass[k - 1], bypass[k]];
      road({ x: -230, z: 0 }, { x: p0.x + ((p1.x - p0.x) * p0.z) / (p0.z - p1.z), z: 0 }, undefined, as('avenue'));
      road({ x: 0, z: -200 }, { x: 0, z: 200 });
      road({ x: 0, z: 0 }, { x: 170, z: -98 });
      road({ x: -185, z: -96 }, { x: 0, z: -96 });
      road({ x: -110, z: -96 }, { x: -170, z: 0 });
      road({ x: 0, z: 70 }, { x: -80, z: 150 }, { x: -80, z: 70 });
      road({ x: 60, z: 0 }, { x: 60, z: 110 });
      road({ x: 0, z: 110 }, { x: 110, z: 110 });
      road({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 }, as('dual'));
      road({ x: -215, z: -150 }, { x: -215, z: 150 }, undefined, over);
      road({ x: 0, z: -150 }, { x: 510, z: -200 }, undefined, over);
      road({ x: 0, z: -200 }, { x: 0, z: -380 });
      road({ x: -190, z: -290 }, { x: 150, z: -290 });
      road({ x: 0, z: -380 }, { x: -170, z: -370 }, { x: -110, z: -420 });
      road({ x: -510, z: -470 }, { x: 0, z: -470 }, undefined, as('motorway'));
      road({ x: 0, z: -470 }, { x: 510, z: -470 }, undefined, as('dual-2-70-0'));
      road({ x: 0, z: -380 }, { x: 0, z: -470 }, undefined, as('dual'));
      n.build({ x: -500, z: 185 }, { x: 500, z: 185 }, undefined, { ...DEFAULT_OPTS, type: 'rail-main', cross: 'bridge', grade: 0.025 });
      road({ x: 250, z: -470 }, { x: 250, z: 90 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'tunnel', grade: 0.08 });
      road({ x: -230, z: 0 }, { x: -510, z: 0 }, undefined, as('rural-60'));
      road({ x: 0, z: 200 }, { x: 0, z: 510 }, undefined, as('rural-60'));
      pairUpMotorways(n); // (as main.ts does: the motorway a pair of carriageways splaying into its roundabout)
    },
  },
  // a mini-roundabout well past what it can take: queues on every arm, and nobody stuck for good
  { name: 'mini-roundabout, heavy demand', build: cross('street'), forms: ['mini'], cars: 150, minTrips: 190 },
  {
    // the offside lane ends with both lanes queued back through the taper from a give-way beyond
    // (a busy road the street meets): the zip merge has to work at a crawl, and nobody stops dead
    name: 'lane drop with queues in both lanes', cars: 150, minTrips: 200, forms: ['priority+slip'], minChanges: 100,
    build: (n) => {
      n.build({ x: -80, z: 0 }, { x: 0, z: 0 });
      n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 320, z: 0 }, undefined, as('dual'));
      n.build({ x: -80, z: -250 }, { x: -80, z: 250 }, undefined, as('rural-40'));
    },
  },
  // motorway junctions (interchange/build.ts): a pair of one-way carriageways, slip roads leaving and
  // joining them, and the local road they meet; trips run on and off the motorway at both ends
  ...([['dumbbell', 'taper', 'open'], ['gsr', 'taper', 'open'], ['diamond', 'taper', 'open'], ['dumbbell', 'parallel', 'open'], ['dumbbell', 'taper', 'tight'], ['gsr', 'taper', 'tight'], ['trumpet', 'taper', 'tight'], ['trumpet', 'taper', 'open']] as [IxForm, SlipStyle, IxSize][]).map(([form, style, size]): Scenario => ({
    name: `motorway junction: ${form}${style === 'parallel' ? ', parallel slip lanes' : ''}${size === 'tight' ? ', tight' : form === 'trumpet' ? ', open' : ''}`, cars: 170, minTrips: 60, forms: undefined, through: true,
    build: (n) => {
      n.build({ x: 0, z: -880 }, { x: 0, z: 880 }, undefined, as('dual'));
      const r = motorwayWithJunction(n, form, [{ x: -880, z: 0 }, { x: 880, z: 0 }], 'motorway', [...n.segs.values()][0], 0, style, size);
      if (!r.ok) throw new Error(r.reason);
      return { prefer: r.ix.prefer };
    },
  })),
  // a cloverleaf: two motorways, trips on and off both at every end
  ...(['tight', 'open'] as IxSize[]).map((size): Scenario => ({
    name: `motorway junction: cloverleaf, ${size}`, cars: 200, minTrips: 60, forms: undefined, through: true, bound: 1600,
    build: (n) => {
      // (the motorway it crosses ends at a roundabout into a town of streets: its trips to and from
      // the motorways' other ends all go through the cloverleaf)
      const end = { x: 1400, z: 0 };
      pairToNode(n, [{ x: -1500, z: 0 }, end], 'motorway', end);
      const town = n.nearestNode(end, 1)!;
      for (const [x, z] of [[1400, 450], [1400, -450]]) n.build({ x: town.x, z: town.z, node: town.id }, { x, z }, undefined, { ...DEFAULT_OPTS, type: 'street' });
      const r = motorwayCloverleaf(n, [{ x: 0, z: -1500 }, { x: 0, z: 1500 }], 'motorway', 0, size);
      if (!r.ok) throw new Error(r.reason);
      return { prefer: { ...r.ix.prefer, [town.id]: 'roundabout' } };
    },
  })),
  {
    name: 'long multi-lane road with a side road', cars: 120, minTrips: 150, buses: 2, stops: true, forms: ['signals+slip'], minChanges: 30,
    build: (n) => {
      n.build({ x: -450, z: 0 }, { x: 450, z: 0 }, undefined, as('dual-3-40-0'));
      n.build(n.snapStart({ x: 100, z: 0 }, 3), { x: 100, z: 250 });
    },
  },
];


// ---- Gap trials: one driver standing at the line, and the traffic it gives way to going by ----
// A controlled measure of time from gap to go at each kind of give-way (Traffic.gapProbe says when
// the one going by is out of the way): for each turn the waiting driver makes, and each way the
// other vehicle comes and goes, one vehicle going by (or two, `headway` seconds apart), then how
// long the driver takes to be on the move at 1 m/s after the way is clear. `idle`: seconds it
// stood while nobody was in its way before it went (a vehicle leaving before its arm, or already
// past, is no reason to wait; about half a second of it is only pulling away).
export interface TrialResult { name: string; conflict: boolean; went: boolean; between?: boolean; delay: number; idle: number; overlaps: number }
type Arm = { x: number; z: number };
// put a vehicle down on the road from `far` towards the junction at `node`, `back` metres before
// its line, bound for the road towards `to`
function placeCar(tr: Traffic, net: Network, node: number, far: Arm, to: Arm, back: number, v: number) {
  const t = tr as unknown as Record<string, any>;
  const seg = net.nearestSeg({ x: (far.x * 2) / 3, z: (far.z * 2) / 3 }, 3)!.seg, from = net.other(seg, node);
  const out = net.nearestSeg({ x: (to.x * 2) / 3, z: (to.z * 2) / 3 }, 3)!.seg;
  const j = tr.junctions.get(node)!, reach = j.form === 'roundabout' || j.form === 'mini' ? Math.max(j.R + 1.5, j.reach[seg.id] ?? 0) : Math.max(t.nodeHalf(node) + 1, j.reach[seg.id] ?? 0);
  const L = net.length(seg), s = L - reach - 2.15 - 0.4 - back;
  const c: any = { id: t.ids++, kind: 'car', front: 2.15, back: 2.15, seg, from, s, v, vmax: 30, route: [out.id], goal: 150, lorry: false, heading: 0, born: -1e6, wait: 0, lane: 0, off: 0, uref: [] };
  c.off = t.laneOff(seg, from, s, 0);
  tr.cars.push(c);
  return c;
}
export function gapTrial(form: 'priority' | 'roundabout' | 'mini', me: { from: Arm; to: Arm }, it: { from: Arm; to: Arm }, opts: { lead?: number; headway?: number; v?: number; dt?: number } = {}): TrialResult {
  const road = form === 'priority' ? 'street' : form === 'mini' ? 'street' : 'rural-40';
  const { net, junctions } = town({ name: 'trial', prefer: form, cars: 0, minTrips: 0, build: form === 'priority' ? tee('street') : cross(road) });
  const tr = new Traffic(net, new THREE.Scene(), rng(1));
  tr.junctions = junctions;
  const node = net.nearestNode({ x: 0, z: 0 }, 3)!.id, v = opts.v ?? (form === 'mini' ? 8 : 11), dt = opts.dt ?? 1 / 30;
  const a = placeCar(tr, net, node, me.from, me.to, 0, 0);
  // the other: `lead` seconds from the junction, and a second one `headway` seconds behind it
  const lead = opts.lead ?? 1;
  const others = [placeCar(tr, net, node, it.from, it.to, v * lead, v)];
  if (opts.headway) others.push(placeCar(tr, net, node, it.from, it.to, v * (lead + opts.headway), v));
  let conflict = false, blocked = false, clearAt = 0, idle = 0, went = false, t = 0, overlaps = 0, between: boolean | undefined;
  for (let i = 0; i < Math.round(25 / dt) && !went; i++) {
    t = i * dt;
    tr.update(dt, t * 1000);
    overlaps += tr.overlaps().length;
    const w = tr.gapProbe().find((x) => x.id === a.id);
    const b = !!w?.blocked;
    if (b) { conflict = true; blocked = true; } else if (blocked) { blocked = false; clearAt = t; }
    if (!b && a.v < 0.3) idle += dt;
    if (a.v > 1 || a.turn) {
      went = true;
      // (between the two: the second hadn't reached the junction yet)
      if (opts.headway) between = !others[1].turn && others[1].after === undefined && others[1].gone === undefined;
    }
  }
  const name = `${form}: ${me.from.x},${me.from.z}>${me.to.x},${me.to.z} past ${it.from.x},${it.from.z}>${it.to.x},${it.to.z}${opts.headway ? ` +${opts.headway}s` : ''}`;
  return { name, conflict, went, between, delay: went ? (conflict ? t - clearAt : 0) : Infinity, idle: +idle.toFixed(2), overlaps };
}
// A queue of `n` cars standing at a give-way line with nobody to give way to: the seconds between
// each crossing the line and the next (queue discharge; real drivers manage about 2 s a vehicle)
export function queueTrial(form: 'priority' | 'roundabout' | 'mini', me: { from: Arm; to: Arm }, n = 5, dt = 1 / 30) {
  const { net, junctions } = town({ name: 'trial', prefer: form, cars: 0, minTrips: 0, build: form === 'priority' ? tee('street') : cross(form === 'mini' ? 'street' : 'rural-40') });
  const tr = new Traffic(net, new THREE.Scene(), rng(1));
  tr.junctions = junctions;
  const node = net.nearestNode({ x: 0, z: 0 }, 3)!.id;
  const cars = Array.from({ length: n }, (_, i) => placeCar(tr, net, node, me.from, me.to, i * (4.3 + 2), 0));
  const crossed: number[] = [], start: number[] = [], vAt: number[] = [];
  for (let i = 0; i < Math.round(40 / dt) && crossed.length < n; i++) {
    tr.update(dt, i * dt * 1000);
    cars.forEach((c, k) => {
      if (start[k] === undefined && c.v > 1) start[k] = i * dt;
      if (!c.counted && c.turn) { c.counted = true; crossed.push(i * dt); vAt.push(+c.v.toFixed(1)); }
    });
  }
  // headways at the line; how long each driver took to move off (1 m/s) after the one in front did; speeds over the line
  return { headway: crossed.slice(1).map((t, i) => +(t - crossed[i]).toFixed(2)), react: start.slice(1).map((t, i) => +(t - start[i]).toFixed(2)), first: start[0], v: vAt };
}
// Pulling out onto a roundabout past one vehicle already going round: it entered from `it.from` and
// leaves for `it.to`, and is `ahead` seconds (at its speed) short of the point on its course nearest
// our line (negative: already that far past it). How long we stand with the way clear (idle), how
// long after it has gone by we go (delay), and whether we waited for it at all.
export function ringTrial(form: 'roundabout' | 'mini', me: { from: Arm; to: Arm }, it: { from: Arm; to: Arm }, ahead: number, opts: { v?: number; dt?: number } = {}) {
  const { net, junctions } = town({ name: 'trial', prefer: form, cars: 0, minTrips: 0, build: cross(form === 'mini' ? 'street' : 'rural-40') });
  const tr = new Traffic(net, new THREE.Scene(), rng(1)), t = tr as unknown as Record<string, any>;
  tr.junctions = junctions;
  const node = net.nearestNode({ x: 0, z: 0 }, 3)!.id, dt = opts.dt ?? 1 / 30;
  const a = placeCar(tr, net, node, me.from, me.to, 0, 0);
  const b = placeCar(tr, net, node, it.from, it.to, 0, 0);
  // b onto its course round the ring, where it's `ahead` seconds from our line
  const pl = t.planOf(b), P = pl.path, line = t.lanePoint(a.seg, a.from, t.planOf(a).path.lineS, 0);
  let tn = P.ext0, dn = Infinity;
  for (let q = P.ext0; q <= P.ext1; q += 0.25) { const p = P.track.point(q), d = Math.hypot(p.x - line.x, p.z - line.z); if (d < dn) { dn = d; tn = q; } }
  const v = opts.v ?? Math.min(8, P.env[Math.floor(tn)]);
  b.v = v; b.turn = { path: P, t: Math.max(P.ext0 + 0.5, Math.min(P.ext1 - 0.5, tn - ahead * v)), node, next: pl.next };
  b.route.shift(); b.adm = 0; b.admNode = node; b.plan = undefined; b.nextSeg = undefined;
  let blocked = false, clearAt = 0, idle = 0, went = false, waited = false, time = 0, overlaps = 0;
  for (let i = 0; i < Math.round(20 / dt) && !went; i++) {
    time = i * dt;
    tr.update(dt, time * 1000);
    overlaps += tr.overlaps().length;
    const w = tr.gapProbe().find((x) => x.id === a.id), bl = !!w?.blocked;
    if (bl) { blocked = true; waited = true; } else if (blocked) { blocked = false; clearAt = time; }
    if (!bl && a.v < 0.3) idle += dt;
    if (a.v > 1 || a.turn) went = true;
  }
  return { waited, went, delay: went && waited ? +(time - clearAt).toFixed(2) : 0, idle: +idle.toFixed(2), overlaps, bOn: +(b.turn ? b.turn.t : -1).toFixed(1) };
}
