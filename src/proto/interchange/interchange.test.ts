import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, closestOnPath, pointAt, type P } from '../roads';
import { design, landFits, legsAt, type Junction } from '../junction';
import { laneBase } from '../catalog';
import { STD } from '../standards';
import { simulate, type Scenario } from '../trafficsim';
import { IX_FORMS, buildPair, motorwayWithJunction, type IxSize, type SlipStyle } from './build';
import { buildSlip, planSlip } from './plan';
import * as THREE from 'three';
import { SURFACES, drawRoads } from '../roaddraw';
import { TriIndex, checkWindow, trisOf, type Defect, type Mat } from '../drawcheck';

// (roundabouts' chevron boards paint a canvas: a stand-in for drawing them in node)
const g0 = globalThis as unknown as { document?: unknown };
g0.document ??= { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => undefined }) }) };
const geo = (net: Network, node: number) => ({ fits: (p: P[][]) => landFits(net, node, p) });
const as = (type: string, oneway = false) => ({ ...DEFAULT_OPTS, type, oneway });

function junctionTown(form: (typeof IX_FORMS)[number], style: SlipStyle = 'taper', size: IxSize = 'open') {
  const net = new Network(() => false, 900);
  net.build({ x: 0, z: -880 }, { x: 0, z: 880 }, undefined, as('dual'));
  const r = motorwayWithJunction(net, form, [{ x: -880, z: 0 }, { x: 880, z: 0 }], 'motorway', [...net.segs.values()][0], 0, style, size);
  if (!r.ok) throw new Error(r.reason);
  const js = new Map<number, Junction>();
  for (const n of net.nodes.values()) if (legsAt(net, n.id).length >= 3) { const j = design(net, n.id, geo(net, n.id), undefined, r.ix.prefer[n.id] ? { form: r.ix.prefer[n.id], slip: false } : undefined); if (j) js.set(n.id, j); }
  return { net, ix: r.ix, js };
}

describe('motorway junctions', () => {
  for (const [form, style, size] of [...IX_FORMS.map((f) => [f, 'taper', 'open'] as const), ...IX_FORMS.map((f) => [f, 'taper', 'tight'] as const), ['dumbbell', 'parallel', 'open'] as const]) it(`${form} (${style}, ${size}): every slip road meets the carriageway as a merge or diverge, with DMRB tapers and noses`, () => {
    const { net, ix, js } = junctionTown(form, style, size);
    const slips = [...js.values()].filter((j) => j.form === 'merge' || j.form === 'diverge');
    // (four on the motorway; a trumpet's links have a merge and a diverge of their own as well)
    const extra = form === 'trumpet' ? 2 : 0;
    expect(slips.length).toBe(4 + extra);
    expect(slips.filter((j) => j.form === 'merge').length).toBe(2 + extra / 2);
    expect(ix.slips.length).toBe(4);
    for (const j of slips) {
      // measured from the course the traffic drives: along the carriageway, where the slip lane runs
      // alongside the nearside lane, closes into it (the taper), and where it parts (the nose)
      const sl = j.slip!, merge = j.form === 'merge';
      const main = net.segs.get(j.major[merge ? 1 : 0])!, M = net.def(main), lane0 = laneBase(M) + (M.lanes - 0.5) * M.lane;
      const path = net.path(main);
      const off = sl.path.map((p) => { const c = closestOnPath(p, path); return { s: c.s, e: (p.x - c.x) * c.uz - (p.z - c.z) * c.ux }; });
      // (for a merge the out road starts at the node: s runs on from it; a diverge's in road ends there)
      const tapering = off.filter((q) => q.e > lane0 + 0.005 && q.e < lane0 + M.lane - 0.005);
      const taper = Math.max(...tapering.map((q) => q.s)) - Math.min(...tapering.map((q) => q.s));
      const par = style === 'parallel' ? STD.parallel(M.mph) : null;
      const std = { ...(merge ? STD.merge(M.mph) : STD.diverge(M.mph)), ...(par ? { taper: par.taper } : {}) };
      // (with an auxiliary lane, it runs alongside at full width for the standard's length first)
      if (par) { const full = off.filter((q) => Math.abs(q.e - (lane0 + M.lane)) < 0.005); expect(Math.max(...full.map((q) => q.s)) - Math.min(...full.map((q) => q.s))).toBeGreaterThanOrEqual(par.length - 4.01); }
      expect(taper, `${j.form} taper`).toBeGreaterThanOrEqual(std.taper - 4.01); // (its course is sampled every 2 m)
      // the nose: from where the slip road's own drawing stops (its kerb clear of the carriageway's) to
      // the node, where the lanes touch (measured along the carriageway on the nose's side of the node)
      const slipSeg = net.segs.get(merge ? sl.from : sl.to)!, mouth = j.shape!.mouth[slipSeg.id];
      const other = net.segs.get(j.major[merge ? 0 : 1])!, op = net.path(other);
      const m = closestOnPath(pointAt(net.pathFrom(slipSeg, j.node), mouth), op);
      expect(merge ? net.length(other) - m.s : m.s, `${j.form} nose`).toBeGreaterThanOrEqual(std.nose);
      expect(sl.len!).toBeGreaterThanOrEqual(std.taper + std.nose + (par?.length ?? 0) - 1);
      // it starts (or ends) in the nearside lane itself, and never crosses to the offside of it
      const ends = merge ? off[off.length - 1] : off[0];
      expect(Math.abs(ends.e - lane0)).toBeLessThan(0.05);
      expect(Math.min(...off.map((q) => q.e))).toBeGreaterThan(lane0 - 0.05);
    }
    // the slip roads are one way, and nothing joins a carriageway except at its merges and diverges
    for (const s of ix.slips) expect(net.segs.get(s.seg)?.oneway).toBe(true);
    for (const n of net.nodes.values()) {
      const at = net.segsAt(n.id);
      if (at.some((s) => s.type === 'motorway') && at.length > 2) expect(['merge', 'diverge']).toContain(js.get(n.id)?.form);
    }
  });

  for (const [form, size] of [...IX_FORMS.map((f) => [f, 'open'] as const), ...IX_FORMS.map((f) => [f, 'tight'] as const)]) it(`${form} (${size}): drawn with no holes, stray markings or surfaces fighting`, () => {
    const { net, ix, js } = junctionTown(form, 'taper', size);
    const g = new THREE.Group(), m = new THREE.MeshLambertMaterial();
    drawRoads(net, g, js, m, m);
    const mats = new Map<THREE.Material, Mat>();
    for (const [k, list] of Object.entries(SURFACES)) for (const x of list) mats.set(x, k as Mat);
    const idx = new TriIndex(trisOf(g, mats));
    const bad: Defect[] = [];
    for (const n of ix.nodes) {
      const j = js.get(n)!, c = net.node(n);
      // a merge or diverge: windows all along its nose and taper; the others round the node
      const at = j.slip?.kind ? j.slip.path.filter((_, i) => i % 15 === 0) : [c];
      for (const p of at) bad.push(...checkWindow(idx, n, p, j.slip?.kind ? 30 : Math.max(45, j.R + 20), c.y, 0.1, 2));
    }
    // (specks under 0.05 m², a few cells of the raster, are its resolution: the town's own junctions have
    // them; and a give-way corner on the ring's curve leaves a hairline of asphalt, 5 cm wide, along it)
    expect(bad.filter((d) => d.area >= (d.kind === 'spur' ? 0.15 : 0.05)).map((d) => `${d.kind} at ${d.at.x.toFixed(0)},${d.at.z.toFixed(0)} (${d.area.toFixed(2)} m²) node ${d.node}`)).toEqual([]);
  }, 60_000);

  it('a junction that can’t be built is not built at all', () => {
    // (a motorway too short for its slip roads: found only after its carriageways are built)
    const net = new Network(() => false, 900);
    net.build({ x: 0, z: -880 }, { x: 0, z: 880 }, undefined, as('dual'));
    const before = JSON.stringify([...net.segs.values()].map((s) => [s.id, s.a, s.b]));
    const r = motorwayWithJunction(net, 'dumbbell', [{ x: -380, z: 0 }, { x: 380, z: 0 }], 'motorway', [...net.segs.values()][0]);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(/further/);
    expect(JSON.stringify([...net.segs.values()].map((s) => [s.id, s.a, s.b]))).toBe(before);
  });

  it('the dumbbell has a roundabout either side and the local road bridges the motorway', () => {
    const { net, js, ix } = junctionTown('dumbbell');
    expect(ix.nodes.slice(0, 2).map((n) => js.get(n)?.form)).toEqual(['roundabout', 'roundabout']);
    const bridge = [...net.segs.values()].find((s) => s.type === 'dual' && s.bridges?.length);
    expect(bridge).toBeTruthy();
    // high enough over both carriageways
    const top = Math.max(...net.path(bridge!).map((p) => p.y ?? 0));
    expect(top).toBeGreaterThan(6);
  });
});

// A block of one-way streets round a square, with two-way streets off it: nobody ever drives the
// wrong way along a one-way street, or turns into one against it.
const oneWayTown: Scenario = {
  name: 'one-way streets', cars: 90, minTrips: 30, build: (n) => {
    const c = [{ x: -150, z: -150 }, { x: 150, z: -150 }, { x: 150, z: 150 }, { x: -150, z: 150 }];
    for (let i = 0; i < 4; i++) n.build(n.snapStart(c[i], 3), n.snapStart(c[(i + 1) % 4], 3), undefined, as('street', true));
    for (const [a, b] of [[{ x: 0, z: -150 }, { x: 0, z: -500 }], [{ x: 150, z: 0 }, { x: 500, z: 0 }], [{ x: 0, z: 150 }, { x: 0, z: 500 }], [{ x: -150, z: 0 }, { x: -500, z: 0 }]] as P[][])
      n.build(n.snapStart(a, 3), b, undefined, as('street'));
  },
};
describe('one-way roads', () => {
  it('traffic never goes the wrong way, and still gets about', () => {
    let wrong = 0, onOneWay = 0;
    const r = simulate(oneWayTown, 150, 1 / 30, (t) => {
      for (const c of (t as unknown as { cars: { gone?: number; seg: { oneway?: boolean; a: number }; from: number; turn?: { next: { oneway?: boolean; a: number }; node: number } }[] }).cars) {
        if (c.gone !== undefined) continue;
        if (c.seg.oneway) { onOneWay++; if (c.from !== c.seg.a) wrong++; }
        if (c.turn?.next.oneway && c.turn.node !== c.turn.next.a) wrong++;
      }
    });
    expect(wrong).toBe(0);
    expect(onOneWay).toBeGreaterThan(1000);
    expect(r.overlapPairs).toBe(0);
    expect(r.arrived).toBeGreaterThan(oneWayTown.minTrips);
    expect(r.gaveUp).toBeLessThanOrEqual(Math.max(1, r.arrived * 0.01));
  }, 120_000);
  it('a one-way road has no centre line, and its lanes all run one way', () => {
    const net = new Network(() => false, 900);
    net.build({ x: -200, z: 0 }, { x: 200, z: 0 }, undefined, as('motorway', true));
    const s = [...net.segs.values()][0], d = net.def(s);
    expect(d.oneway).toBe(true);
    expect(d.lanes).toBe(3);
    // the lanes and the hard shoulder fill the carriageway, offside strip to nearside kerb
    expect(laneBase(d) + d.lanes * d.lane + d.shoulder).toBeCloseTo(net.half(s) - d.verge, 5);
  });
});

describe('slip roads drawn off a motorway', () => {
  // a pair of carriageways east–west; the one running east is on the north side (z < 0: keep left)
  const pairTown = () => { const net = new Network(() => false, 900); buildPair(net, [{ x: -800, z: 0 }, { x: 800, z: 0 }], 'motorway'); return net; };
  const east = (net: Network) => [...net.segs.values()].find((s) => s.oneway && net.path(s)[0].x < net.path(s).at(-1)!.x)!;
  const designAll = (net: Network) => { const js = new Map<number, Junction>(); for (const n of net.nodes.values()) if (legsAt(net, n.id).length >= 3) { const j = design(net, n.id, geo(net, n.id)); if (j) js.set(n.id, j); } return js; };
  for (const lanes of [1, 2] as const) for (const kind of ['diverge', 'merge'] as const) it(`${kind}, ${lanes} lane${lanes > 1 ? 's' : ''}: dragged off a carriageway, it leaves (or joins) it as a ${kind}`, () => {
    const net = pairTown(), cw = east(net), p = pointAt(net.path(cw), 800), side = { x: p.uz, z: -p.ux }; // (its nearside)
    const from = { x: p.x, z: p.z }, to = { x: p.x + p.ux * (kind === 'diverge' ? 260 : -260) + side.x * 90, z: p.z + p.uz * (kind === 'diverge' ? 260 : -260) + side.z * 90 };
    const plan = planSlip(net, from, to, lanes)!;
    expect(plan.ok, plan.reason).toBe(true);
    expect(plan.kind).toBe(kind);
    buildSlip(net, plan);
    const js = designAll(net);
    const j = [...js.values()].find((x) => x.form === kind)!;
    expect(j, 'a merge or diverge where it meets the carriageway').toBeTruthy();
    expect(j.slip!.len).toBeGreaterThan((kind === 'merge' ? STD.merge(70) : STD.diverge(70)).taper);
    // one way, the right way: away from the carriageway leaving it, towards it joining
    const slip = net.segs.get(kind === 'diverge' ? j.slip!.to : j.slip!.from)!;
    expect(slip.oneway).toBe(true);
    expect(kind === 'diverge' ? slip.a : slip.b).toBe(j.node);
    if (lanes === 2) expect([...net.segs.values()].some((s) => s.type === 'slip-2')).toBe(true);
  });
  it('refuses one off the offside, or with no room for its taper', () => {
    const net = pairTown(), cw = east(net), p = pointAt(net.path(cw), 800), side = { x: p.uz, z: -p.ux };
    const off = planSlip(net, { x: p.x, z: p.z }, { x: p.x + p.ux * 200 - side.x * 90, z: p.z + p.uz * 200 - side.z * 90 }, 1)!;
    expect(off.ok).toBe(false);
    expect(off.reason).toMatch(/left/);
    const q = pointAt(net.path(cw), 60), s2 = { x: q.uz, z: -q.ux };
    const early = planSlip(net, { x: q.x, z: q.z }, { x: q.x + q.ux * 200 + s2.x * 90, z: q.z + q.uz * 200 + s2.z * 90 }, 1)!;
    expect(early.ok).toBe(false);
    expect(early.reason).toMatch(/taper/);
    // and a drag that doesn't start on a carriageway isn't a slip road at all
    expect(planSlip(net, { x: 0, z: 200 }, { x: 100, z: 300 }, 1)).toBeNull();
  });
});
