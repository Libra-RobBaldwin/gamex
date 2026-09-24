// Test towns for the traffic: roads, their junctions designed the way main.ts does it, plots along
// the roads for trips to start and end at, then heavy traffic driven for a few simulated minutes,
// counting every frame in which two vehicles overlap as drawn. Used by traffic.test.ts.
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng, type P } from './roads';
import { design, landFits, legsAt, type Form, type Junction } from './junction';
import { Traffic, type Places } from './traffic';
import { laneSpan } from './xsection';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
const geo = (n: Network, node: number) => ({ fits: (polys: Parameters<typeof landFits>[2]) => landFits(n, node, polys) });

export interface Scenario { name: string; build: (n: Network) => void; forms?: string[]; prefer?: Form; cars: number; buses?: number; stops?: boolean; minTrips: number; minChanges?: number }

export function town(sc: Scenario) {
  const net = new Network(() => false, 900);
  sc.build(net);
  const junctions = new Map<number, Junction>();
  for (const nd of net.nodes.values()) {
    if (legsAt(net, nd.id).length < 3) continue;
    const j = design(net, nd.id, geo(net, nd.id), undefined, sc.prefer ? { form: sc.prefer } : undefined);
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
    works: lots.filter((_, i) => i % 9 === 5), weight: () => 1,
  };
  return { net, junctions, places };
}

export interface RunResult {
  overlapFrames: number; overlapPairs: number; worst: number; spawned: number; arrived: number; gaveUp: number; live: number; msPerUpdate: number; forms: string[]; sample?: string;
  laneChanges: number; outOfLane: number; // vehicles in a lane where xsection.laneSpan says it isn't usable (vehicle-frames)
}
export function simulate(sc: Scenario, seconds = 180, dt = 1 / 30, onStep?: (traffic: Traffic, t: number, ov: ReturnType<Traffic['overlaps']>) => void, seed = 11): RunResult {
  const { net, junctions, places } = town(sc);
  const traffic = new Traffic(net, new THREE.Scene(), rng(seed));
  traffic.junctions = junctions;
  for (let i = 0; i < (sc.buses ?? 0); i++) traffic.addBus();
  // enough demand to keep about sc.cars vehicles on the roads
  const people = places.homes.length;
  const level = (sc.cars * 16) / Math.max(1, people) / 1.25;
  let overlapFrames = 0, worst = 0, ms = 0, outOfLane = 0, sample: string | undefined;
  const seen = new Set<string>();
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const now = i * dt * 1000;
    for (let k = 0; k < 3; k++) traffic.generate(places, 8.2, level, now);
    const t0 = performance.now();
    traffic.update(dt, now);
    ms += performance.now() - t0;
    const ov = traffic.overlaps();
    onStep?.(traffic, i * dt, ov);
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
  return { overlapFrames, overlapPairs: seen.size, worst, spawned: traffic.stats.spawned, arrived: traffic.stats.arrived, gaveUp: traffic.stats.gaveUp, live: traffic.live, msPerUpdate: ms / steps, laneChanges: traffic.stats.laneChanges, outOfLane, forms: [...junctions.values()].map((j) => j.form + (j.slip ? '+slip' : '')), sample };
}

const cross = (type: string) => (n: Network) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as(type)); n.build({ x: 0, z: -250 }, { x: 0, z: 250 }, undefined, as(type)); };
const tee = (main: string, side = 'street') => (n: Network) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as(main)); n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 250 }, undefined, as(side)); };

// minTrips: a floor on trips completed in three minutes (about 60% of what each manages); give-ups
// (drivers stuck for 90 s) must stay rare; minChanges: lane changes that have to happen there.
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
    },
  },
  {
    name: 'long multi-lane road with a side road', cars: 120, minTrips: 150, buses: 2, stops: true, forms: ['signals+slip'], minChanges: 30,
    build: (n) => {
      n.build({ x: -450, z: 0 }, { x: 450, z: 0 }, undefined, as('dual-3-40-0'));
      n.build(n.snapStart({ x: 100, z: 0 }, 3), { x: 100, z: 250 });
    },
  },
];

