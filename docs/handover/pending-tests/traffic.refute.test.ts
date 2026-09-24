import { describe, expect, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng, type RSeg } from './roads';
import { Traffic } from './traffic';
import { DIMS, type Kind } from './footprint';
import { laneSpan } from './xsection';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
const OUT = '/tmp/claude-0/-home-user-gamex/77896564-364e-5bd3-afef-740e87f2acff/scratchpad/refute/explore.log';
const log = (s: string) => appendFileSync(OUT, s + '\n');

// ---- putting vehicles exactly where a scenario needs them ----
type T = Traffic & Record<string, any>;
interface Place { seg: RSeg; from: number; s: number; lane: number; v?: number; kind?: Kind; bus?: boolean; route?: number[]; goal?: number }
function place(tr: T, p: Place) {
  const kind: Kind = p.bus ? 'bus' : p.kind ?? 'car', dm = DIMS[kind];
  const c: any = {
    id: tr.ids++, kind, front: dm.front, back: dm.back, seg: p.seg, from: p.from, s: p.s, v: p.v ?? 0, vmax: p.bus ? 11 : 30,
    route: p.route ?? [], goal: p.goal ?? Infinity, lorry: kind === 'lorry', bus: !!p.bus, col: new THREE.Color(), heading: 0, born: -1e6, wait: 0,
    lane: p.lane, off: 0, uref: [],
  };
  c.off = tr.laneOff(p.seg, p.from, p.s, tr.laneIdx(c));
  tr.cars.push(c);
  return c;
}
const segAt = (net: Network, x: number, z: number) => net.nearestSeg({ x, z }, 3)!.seg;
const nodeAt = (net: Network, x: number, z: number) => net.nearestNode({ x, z }, 3)!.id;
function run(tr: T, seconds: number, dt = 1 / 30, t0 = 0, each?: (t: number) => void) {
  let worst = 0, frames = 0;
  const pairs = new Set<string>();
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const now = t0 + i * dt * 1000;
    tr.update(dt, now);
    const ov = tr.overlaps();
    if (ov.length) frames++;
    for (const [a, b] of ov) pairs.add(`${a.id}:${b.id}`);
    worst = Math.max(worst, ov.length);
    each?.(now);
  }
  return { frames, pairs: [...pairs], worst };
}

describe('lane drop: a queue alongside the lane that ends', () => {
  it('the car at the end of the closing lane gets in, and the queue beside it moves off', () => {
    const net = new Network(() => false, 900);
    net.build({ x: -300, z: 0 }, { x: 0, z: 0 });
    net.build(net.snapStart({ x: 0, z: 0 }, 3), { x: 300, z: 0 }, undefined, as('dual'));
    const tr = new Traffic(net, new THREE.Scene(), rng(3)) as T;
    const dual = segAt(net, 150, 0), street = segAt(net, -150, 0), east = nodeAt(net, 300, 0);
    const end = laneSpan(net, dual, east, 1)[1];
    // the offside car has driven up to where its lane ends and stopped; the nearside car is
    // standing a metre behind it (a queue in the nearside lane that is just moving off)
    const a = place(tr, { seg: dual, from: east, s: end - DIMS.car.front - 0.5, lane: 1, route: [street.id], goal: 200 });
    const b = place(tr, { seg: dual, from: east, s: a.s - 1, lane: 0, route: [street.id], goal: 200 });
    const b0 = b.s;
    run(tr, 30);
    log(`lane drop: a ${tr.describe(a.id)} why=${a.why} | b ${tr.describe(b.id)} moved ${(b.s - b0).toFixed(1)}`);
    // within 30 s both should be well on their way
    expect(b.seg.id !== dual.id || b.s - b0 > 20, `nearside car frozen alongside the merging one: ${tr.describe(b.id)}`).toBe(true);
    expect(a.seg.id !== dual.id || a.lane === 0, `offside car never got in: ${tr.describe(a.id)}`).toBe(true);
  });
});

import { simulate, type Scenario } from './trafficsim';
import { town } from './trafficsim';
describe('explore natural', () => {
  it('exit with room for one, two committing from different arms', () => {
    const { net, junctions } = town({ name: 'x', prefer: 'roundabout', cars: 0, minTrips: 0, build: (n) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as('rural-40')); n.build({ x: 0, z: -250 }, { x: 0, z: 250 }, undefined, as('rural-40')); } });
    const tr = new Traffic(net, new THREE.Scene(), rng(5)) as T;
    tr.junctions = junctions;
    const c0 = nodeAt(net, 0, 0), j = junctions.get(c0)!;
    const E = segAt(net, 120, 0), N = segAt(net, 0, -120), S = segAt(net, 0, 120);
    const far = (sg: RSeg) => net.other(sg, c0);
    const reachE = Math.max(j.R + 1.5, j.reach[E.id] ?? 0);
    // a standing queue in the exit, leaving room for one car
    const pins = [12, 18.5, 25, 31.5].map((d) => place(tr, { seg: E, from: c0, s: reachE + d, lane: 0, route: [], goal: 1e9 }));
    const LN = net.length(N), LS = net.length(S);
    const reachN = Math.max(j.R + 1.5, j.reach[N.id] ?? 0), reachS = Math.max(j.R + 1.5, j.reach[S.id] ?? 0);
    const a = place(tr, { seg: N, from: far(N), s: LN - reachN - 45, lane: 0, v: 12, route: [E.id], goal: 200 });
    const b = place(tr, { seg: S, from: far(S), s: LS - reachS - 45, lane: 0, v: 12, route: [E.id], goal: 200 });
    let inBox = 0, worst = 0;
    const W = segAt(net, -120, 0), LW = net.length(W), reachW = Math.max(j.R + 1.5, j.reach[W.id] ?? 0);
    const ring: any[] = [];
    const r = run(tr, 40, 1 / 30, 0, (now) => {
      // circulating traffic that passes the blocked exit: every few seconds a car from the west going north (through the east side)
      if (now > 8000 && now % 3000 < 34 && ring.length < 6) ring.push(place(tr, { seg: W, from: far(W), s: LW - reachW - 60, lane: 0, v: 10, route: [N.id], goal: 200 }));
      for (const p of pins) { p.s = p._s ??= p.s; p.v = 0; }
      for (const c of [a, b]) if (c.turn && c.turn.t > c.turn.path.ext0 + 2 && c.turn.t < c.turn.path.ext1 && c.v < 0.3) { inBox += 1 / 30; worst = Math.max(worst, inBox); }
    });
    log(`exit room: a ${tr.describe(a.id)} | b ${tr.describe(b.id)} standing in the junction ${worst.toFixed(1)} s; overlaps ${r.pairs}`);
    for (const c of ring) log(`   ring ${tr.describe(c.id)} wait=${c.wait.toFixed(1)} :: ${tr.explain(c.id)}`);
  });
});
import { design, landFits, type Form } from './junction';
describe.skip('explore natural2', () => {
  const cases: { name: string; build: (n: Network) => void; from: Form; to: Form; at: number }[] = [
    { name: 'priority T -> roundabout', build: (n) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as('rural-40')); n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 250 }, undefined, as('rural-40')); }, from: 'priority', to: 'roundabout', at: 60 },
    { name: 'mini -> roundabout', build: (n) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as('street')); n.build({ x: 0, z: -250 }, { x: 0, z: 250 }, undefined, as('street')); }, from: 'mini', to: 'roundabout', at: 60 },
    { name: 'signals -> priority', build: (n) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as('arterial-2-30-0-0-0')); n.build(n.snapStart({ x: 0, z: 0 }, 3), { x: 0, z: 250 }, undefined, as('street')); }, from: 'signals', to: 'priority', at: 60 },
    { name: 'roundabout -> signals', build: (n) => { n.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as('dual')); n.build({ x: 0, z: -250 }, { x: 0, z: 250 }, undefined, as('dual')); }, from: 'roundabout', to: 'signals', at: 60 },
  ];
  for (const k0 of cases) for (const same of [true, false]) it(k0.name + (same ? ' (baseline)' : ''), () => {
    const k = same ? { ...k0, to: k0.from } : k0;
    const { net, junctions, places } = town({ name: k.name, build: k.build, prefer: k.from, cars: 100, minTrips: 0 });
    const tr = new Traffic(net, new THREE.Scene(), rng(5)) as T;
    tr.junctions = junctions;
    const level = (100 * 16) / Math.max(1, places.homes.length) / 1.25;
    let frames = 0, maxStuck = 0, firstAfter = '';
    const pairs = new Set<string>();
    const dt = 1 / 30;
    for (let i = 0; i < 150 * 30; i++) {
      const now = i * dt * 1000;
      if (i === k.at * 30) {
        for (const [node] of junctions) { const j = design(net, node, { fits: (p: any) => landFits(net, node, p) }, undefined, { form: k.to }); if (j) junctions.set(node, j); }
        tr.invalidate();
        log(`${k.name}: redesigned to ${[...junctions.values()].map((j) => j.form)}; ${tr.cars.filter((c: any) => c.turn).length} vehicles mid-junction`);
      }
      for (let q = 0; q < 3; q++) tr.generate(places, 8.2, level, now);
      tr.update(dt, now);
      const ov = tr.overlaps();
      if (ov.length && i >= k.at * 30) { frames++; for (const [a, b] of ov) { const key = `${a.id}:${b.id}`; if (!pairs.size) firstAfter = `t=${(i * dt).toFixed(1)} ${tr.describe(a.id)} | ${tr.describe(b.id)}`; pairs.add(key); } }
      if (i > k.at * 30) for (const c of tr.cars as any[]) if (c.gone === undefined && !c.bus) { maxStuck = Math.max(maxStuck, c.wait); if (!same && c.wait > 45 && c.wait < 45 + dt * 1.5) log(`  t=${(i * dt).toFixed(1)} STUCK ${tr.describe(c.id)} why=${c.why} :: ${tr.explain(c.id)}`.slice(0, 700)); }
    }
    log(`${(k0.name + (same ? ' (baseline)' : '')).padEnd(40)} after redesign: overlapFrames=${frames} pairs=${pairs.size} maxStuck=${maxStuck.toFixed(0)} gaveUp=${tr.stats.gaveUp} arrived=${tr.stats.arrived}${firstAfter ? `\n    first: ${firstAfter}` : ''}`);
  }, 600_000);
});
