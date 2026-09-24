// The world interface, for both towns: the invented seed town and the real one (Banbury standing
// in for Horley until its snapshot can be fetched; see real.ts).
import { describe, expect, it } from 'vitest';
import { design, landFits, legsAt, type Junction } from '../junction';
import { closestOnPath, rectCorners, rng, type Network } from '../roads';
import { inventedWorld } from './invented';
import { REAL_TOWN, realWorld, settleStanding } from './real';
import type { World } from './world';

// what main.ts does at start-up, without drawing: every junction designs itself (from the map's
// hint where there is one) and claims its land, then the standing buildings go up
function start(w: World) {
  const { net } = w;
  const junctions = new Map<number, Junction>();
  const failed: number[] = [];
  for (const n of net.nodes.values()) {
    if (legsAt(net, n.id).length < 3) continue;
    try {
      const j = design(net, n.id, { fits: (p) => landFits(net, n.id, p) }, undefined, w.hints.get(n.id));
      if (j) junctions.set(n.id, j); else failed.push(n.id);
    } catch { failed.push(n.id); }
  }
  for (const j of junctions.values()) net.land.claim(`junction:${j.node}`, 'junction', j.shape?.claims ?? []);
  const settled = settleStanding(net, w.standing);
  return { junctions, failed, ...settled };
}

// every contract a World makes, whichever town it is
function contract(w: World) {
  expect(w.name.length).toBeGreaterThan(0);
  expect(w.bound).toBeGreaterThan(300);
  expect(w.net.bound).toBe(w.bound);
  expect(w.net.segs.size).toBeGreaterThan(10);
  expect(Math.abs(w.centre.x)).toBeLessThan(w.bound);
  expect(Math.abs(w.view.x)).toBeLessThan(w.bound);
  for (const poly of w.water.polys) for (const p of poly) expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true);
  // the network's water test and the world's agree, and the water polygons are water
  const probe = rng(3);
  for (let i = 0; i < 400; i++) { const p = { x: (probe() * 2 - 1) * w.bound, z: (probe() * 2 - 1) * w.bound }; expect(w.net.isWater(p)).toBe(w.water.isWater(p)); }
  // industrial land is the network's industrial zone
  for (let i = 0; i < 400; i++) { const p = { x: (probe() * 2 - 1) * w.bound, z: (probe() * 2 - 1) * w.bound }; expect(w.net.zoneAt(p) === 'industrial').toBe(w.industrial(p)); }
  for (const [node] of w.hints) expect(w.net.nodes.has(node)).toBe(true);
  for (const id of w.growAlong()) expect(w.net.segs.has(id)).toBe(true);
  for (const t of w.trees) expect(Math.abs(t.x) <= w.bound + 1 && Math.abs(t.z) <= w.bound + 1).toBe(true);
  expect(w.trees.length).toBeLessThanOrEqual(1600); // the instanced tree meshes' size
  expect(w.real ? w.attribution : null).toBe(w.real ? '© OpenStreetMap contributors' : null);
}

// A dead end that stops within a couple of metres of another road it doesn't meet is a join the
// import missed. (Dead ends at the map's edge are where the snapshot was cut.)
function brokenJoins(net: Network, bound: number) {
  const out: { node: number; d: number }[] = [];
  for (const n of net.nodes.values()) {
    const at = net.segsAt(n.id);
    if (at.length !== 1 || Math.max(Math.abs(n.x), Math.abs(n.z)) > bound - 5) continue;
    const mine = at[0];
    for (const s of net.segs.values()) {
      if (s.id === mine.id || net.def(s).cls !== net.def(mine).cls) continue;
      const d = closestOnPath(n, net.path(s)).d;
      if (d < 2) { out.push({ node: n.id, d }); break; }
    }
  }
  return out;
}

describe('the invented town', () => {
  const w = inventedWorld(rng(99));
  it('keeps the World contract', () => contract(w));
  it('is the seed town it always was', () => {
    expect(w.bound).toBe(520);
    expect(w.water.isWater({ x: 250, z: -190 })).toBe(true);
    expect(w.industrial({ x: 0, z: -300 })).toBe(true);
    expect(w.zoneAt({ x: 0, z: -300 })).toBe('industrial');
    expect(w.growNow).toBe(0.8);
    expect(w.standing.length).toBe(0);
  });
  it('designs every junction', () => {
    const r = start(w);
    expect(r.failed).toEqual([]);
    expect(r.junctions.size).toBeGreaterThan(8);
  });
});

describe(`the real town (${REAL_TOWN.name})`, () => {
  const t0 = performance.now();
  const w = realWorld();
  const importMs = performance.now() - t0;
  it('keeps the World contract', () => contract(w));
  it('credits OpenStreetMap', () => {
    expect(w.attribution).toBe('© OpenStreetMap contributors');
    expect(w.attributionUrl).toMatch(/openstreetmap\.org\/copyright/);
    expect(REAL_TOWN.data.attribution).toMatch(/OpenStreetMap contributors.*ODbL|Open Database Licence/);
  });
  it('is cut to its map: no road runs far past the edge', () => {
    for (const n of w.net.nodes.values()) expect(Math.max(Math.abs(n.x), Math.abs(n.z))).toBeLessThan(w.bound + 80);
  });
  it('has its water, industry, stations and roundabouts', () => {
    expect(w.water.polys.length).toBeGreaterThan(10);
    expect(w.zones.some((z) => z.kind === 'industrial')).toBe(true);
    expect(w.stations.length).toBeGreaterThanOrEqual(1);
    expect(w.stations.every((s) => s.seg !== undefined && w.net.segs.has(s.seg))).toBe(true);
    expect([...w.hints.values()].filter((h) => h.form === 'roundabout').length).toBeGreaterThanOrEqual(3);
    expect(w.names.size).toBeGreaterThan(50);
  });
  it('imports with no broken joins', () => {
    expect(brokenJoins(w.net, w.bound)).toEqual([]);
  });
  const t1 = performance.now();
  const r = start(w);
  const startMs = importMs + performance.now() - t1;
  it('designs every junction, and keeps the map’s roundabouts', () => {
    expect(r.failed).toEqual([]);
    expect(r.junctions.size).toBeGreaterThan(150);
    for (const [node, h] of w.hints) { const j = r.junctions.get(node); if (j) expect(j.form).toBe(h.form); }
  });
  it('puts its buildings up clear of the roads, dropping few', () => {
    expect(r.placed.length).toBeGreaterThan(w.standing.length * 0.92);
    for (const l of r.placed) expect(w.net.land.free(rectCorners(l.x, l.z, l.rot, l.w, l.d))).toBe(true);
  });
  it('starts within budget', () => {
    // import, junction design and the standing buildings, headless (the browser adds drawing:
    // see docs/world-start.md for the measured start-up in the game)
    expect(startMs).toBeLessThan(5000);
  });
});
