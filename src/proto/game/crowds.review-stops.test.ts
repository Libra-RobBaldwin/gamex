// Review of the people at bus stops and junction kerbs (adversarial): each test here captures a
// bug seen in the game, and fails until it's fixed. Headless, like crowds.test.ts and buses.test.ts.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, closestOnPath, rng, type RSeg } from '../roads';
import { design, landFits, legsAt, type Junction } from '../junction';
import { Traffic } from '../traffic';
import { courseOf } from '../xsection';
import { section } from '../roaddraw';
import { DIMS, type Rect } from '../footprint';
import { starterStops, type StopSite } from './crowdsites';
import { TownCrowds } from './crowds';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
function junctionsOf(net: Network) {
  const junctions = new Map<number, Junction>();
  for (const nd of net.nodes.values()) {
    if (legsAt(net, nd.id).length < 3) continue;
    const j = design(net, nd.id, { fits: (p) => landFits(net, nd.id, p) });
    if (j) { junctions.set(nd.id, j); net.land.claim(`junction:${nd.id}`, 'junction', j.shape?.claims ?? []); }
  }
  return junctions;
}
// crowds.test.ts's town: a crossroads of avenues with a street off one arm, plots along everything,
// the starter stops (lay-bys on the avenues, kerbside stops on the street)
function town() {
  const net = new Network(() => false, 900);
  net.zoneAt = (p) => (p.z < -150 ? 'industrial' : 'town');
  net.build({ x: -300, z: 0 }, { x: 300, z: 0 }, undefined, as('avenue'));
  net.build({ x: 0, z: -300 }, { x: 0, z: 300 }, undefined, as('avenue'));
  net.build(net.snapStart({ x: 0, z: -200 }, 3), { x: 200, z: -200 }, undefined, as('street'));
  const junctions = junctionsOf(net);
  for (const id of net.segs.keys()) for (const l of net.plotsFor(id, { x: 0, z: 0 })) if (net.lotFree(l)) { net.fitParcel(l); net.lots.push(l); }
  starterStops(net, [{ x: -150, z: 0 }, { x: 100, z: -200 }, { x: 0, z: 150 }]);
  return { net, junctions };
}
function game(net: Network, junctions: Map<number, Junction>, buses: number, seed = 4) {
  const scene = new THREE.Scene(), traffic = new Traffic(net, scene, rng(seed));
  traffic.junctions = junctions;
  const crowds = new TownCrowds({ scene, net, junctions, traffic, regions: () => [] }, 4);
  const cam = new THREE.OrthographicCamera(-50, 50, 100, -100, 1, 4000);
  cam.position.set(500, 600, 500); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  for (let i = 0; i < buses; i++) traffic.addBus();
  return { traffic, crowds, cam };
}
const sites = (crowds: TownCrowds) => (crowds as unknown as { roads: { stops: StopSite[] } }).roads.stops;
// a point in a vehicle body's frame: metres ahead of its middle, and out to its left (the kerb side)
const inFrame = (r: Rect, p: { x: number; z: number }) => {
  const dx = p.x - r.x, dz = p.z - r.z;
  return { al: dx * r.hx + dz * r.hz, lat: dx * r.hz - dz * r.hx };
};
// the drawn kerb and back of the pavement on the side of a road a point is on, level with it
function edgesAt(net: Network, seg: RSeg, p: { x: number; z: number }) {
  const C = courseOf(net, seg), c = closestOnPath(p, C.path), sd = section(net, seg, C, c.s);
  const side = net.sideOf(seg, p) === 1 ? sd.L : sd.R;
  return { off: c.d, kerb: side.kerb, back: side.back };
}

describe('people crossing at junction kerbs', () => {
  it('never walk through a moving vehicle', () => {
    // (buses only, so it's quick; they come through the junctions at 8-10 m/s)
    const { net, junctions } = town();
    const { traffic, crowds, cam } = game(net, junctions, 6);
    const hits: string[] = [];
    for (let i = 0; i < 30 * 120; i++) {
      traffic.update(1 / 30, (i * 1000) / 30);
      crowds.update(cam, 915, 1 / 30, 1 / 30, 8 * 60 + (i / 30) * 4);
      if (i % 3) continue;
      crowds.store.buildAll();
      const figs = crowds.store.figures().filter((f) => f.alpha > 0.5 && f.group.startsWith('cross:'));
      for (const p of traffic.poses()) {
        const c = traffic.cars.find((x) => x.id === p.id)!;
        if (c.v < 0.5) continue;
        for (const r of p.parts) for (const f of figs) {
          const q = inFrame(r, f);
          if (Math.abs(q.al) < r.hl * p.k && Math.abs(q.lat) < r.hw * p.k) hits.push(`t=${crowds.store.time.toFixed(1)} ${f.group} inside ${p.kind}#${p.id} at ${c.v.toFixed(1)} m/s`);
        }
      }
    }
    expect(hits.slice(0, 5)).toEqual([]);
  }, 120_000);
});

describe('buses and the people at their stops', () => {
  it("keep a bus on its own road after it has called at a lay-by (it doesn't swerve out onto the pavement further on)", () => {
    const { net, junctions } = town();
    const { traffic } = game(net, junctions, 8);
    const out: string[] = [];
    for (let i = 0; i < 30 * 600 && out.length < 5; i++) {
      traffic.update(1 / 30, (i * 1000) / 30);
      if (i % 10) continue;
      for (const c of traffic.cars) {
        if (!c.bus || c.turn || !c.pose || c.gone !== undefined) continue;
        // (on a road with no lay-by on its side of the road: a lay-by's own swing is fine)
        const side = c.from === c.seg.a ? 1 : -1;
        if (c.seg.stops.some((st) => st.side === side && st.kind === 'layby')) continue;
        const e = edgesAt(net, c.seg, c.pose), L = net.length(c.seg), at = closestOnPath(c.pose, net.path(c.seg)).s;
        if (at < 20 || at > L - 20) continue; // (clear of the junctions and road ends)
        if (e.off + DIMS.bus.hw > e.kerb + 0.3) out.push(`bus#${c.id} ${(e.off + DIMS.bus.hw - e.kerb).toFixed(2)} m over the kerb, ${traffic.describe(c.id)}; last lay-by: stop ${c.bay?.id} on seg ${[...net.segs.values()].find((s) => c.bay && s.stops.includes(c.bay))?.id}`);
      }
    }
    expect(out).toEqual([]);
  }, 120_000);

  // The people walk to a fixed point at the kerb (crowdsites: the kerb less 0.35 m) while traffic.ts
  // stands the bus in its lane, or its lane plus the full 3 m of a lay-by. Wherever the two differ
  // (parking or a cycle lane between the lane and the kerb, a lay-by that narrows the lanes or
  // takes the parking, a bus in the offside lane) they board thin air beside the bus, or its side.
  it.each([
    ['street', 'layby'], // takes 0.5 m of lane: the door is 0.5 m inside the bus, which is 0.15 m over the kerb
    ['street-30-2.4-2.2-0', 'kerb'], // parking: the door is 2.2 m out from the bus's side
    ['street-30-2.4-2.2-0', 'layby'],
    ['street-30-4-0-1.5', 'kerb'], // a cycle lane: 1.5 m out
    ['street-30-4-0-1.5', 'layby'],
    ['avenue-2.2-1.8', 'kerb'], // parking and a cycle lane: 4.1 m out
    ['avenue-2.2-1.8', 'layby'],
    ['arterial-2-30-0-0-0', 'kerb'], // two lanes each way: the bus calls from the offside lane
    ['arterial-2-30-0-0-0', 'layby'],
  ])('stands a bus with its front door at the stop’s door (%s, %s stop)', (type, kind) => {
    const net = new Network(() => false, 900);
    net.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as(type));
    for (const x of [-150, 150]) net.build(net.snapStart({ x, z: 0 }, 3), { x, z: 200 }, undefined, as('street'));
    const junctions = junctionsOf(net);
    const mid = [...net.segs.values()].find((s) => { const p = net.path(s); return p[0].z === 0 && p[p.length - 1].z === 0 && Math.abs(p[0].x) === 150 && Math.abs(p[p.length - 1].x) === 150; })!;
    expect(net.def(mid).id).toBe(type);
    for (const side of [1, -1] as const) {
      const plan = net.planStop(mid.id, net.length(mid) / 2, side).plans.find((p) => p.kind === kind && p.ok)!;
      net.addStop(mid.id, net.length(mid) / 2, side, plan);
    }
    const { traffic, crowds, cam } = game(net, junctions, 3, 3);
    const seen: string[] = [], bad: string[] = [];
    const hook = traffic.onBusStop!;
    traffic.onBusStop = (seg, st, bus) => {
      const c = traffic.cars.find((x) => x.id === bus)!, r = c.pose!.parts[0], s = sites(crowds).find((x) => x.id === `stop:${seg.id}:${st.id}`)!;
      const door = inFrame(r, s.door), exit = inFrame(r, s.exit), hw = DIMS.bus.hw;
      const over = closestOnPath(r, net.path(seg)).d + hw - edgesAt(net, seg, s.door).kerb;
      const say = `side ${st.side}: door ${door.al.toFixed(2)} ahead, ${door.lat.toFixed(2)} out; exit ${exit.lat.toFixed(2)} out; bus ${over.toFixed(2)} over the kerb`;
      seen.push(say);
      // both doors just outside the bus's kerb side (not inside it, not out in the road), the front
      // door by its front; and the bus not up on the pavement
      if (door.lat < hw - 0.05 || door.lat > hw + 0.6 || exit.lat < hw - 0.05 || exit.lat > hw + 0.6 || door.al > DIMS.bus.front || door.al < DIMS.bus.front - 2.5 || over > 0.05) bad.push(say);
      return hook(seg, st, bus);
    };
    for (let i = 0; i < 30 * 200 && seen.length < 2; i++) { traffic.update(1 / 30, (i * 1000) / 30); crowds.update(cam, 915, 1 / 30, 1 / 30, 8 * 60 + (i / 30) * 4); }
    expect(seen.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  }, 60_000);

  it('lets people off onto the pavement, not beyond the back of it', () => {
    const { net, junctions } = town();
    const { traffic, crowds, cam } = game(net, junctions, 0);
    for (let i = 0; i < 8; i++) crowds.update(cam, 915, 0.25, 0.25, 17 * 60 + i);
    const bad: string[] = [];
    for (const seg of net.segs.values()) for (const st of seg.stops) {
      // a few buses call, each with a good load (most get off in the evening where the homes are)
      for (let bus = 100; bus < 106; bus++) traffic.onBusStop!(seg, st, bus);
      const t0 = crowds.store.time;
      crowds.store.buildAll();
      for (let t = t0; t < t0 + 20; t += 0.25) {
        for (const f of crowds.store.figures('people', t)) {
          if (!f.group.startsWith(`stop:${seg.id}:${st.id}#alight`) || f.alpha < 0.5) continue;
          const e = edgesAt(net, seg, f);
          if (e.off > e.back + 0.05) bad.push(`${f.group}#${f.k} at t+${(t - t0).toFixed(2)}: ${(e.off - e.back).toFixed(2)} m behind the back of the pavement`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  }, 60_000);
});
