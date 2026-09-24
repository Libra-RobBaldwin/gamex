import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, RAISE_COST, TUNNEL_COST, type Check, type P } from '../roads';
import { ROADS, kerbOf } from '../catalog';
import { BridgeLayer } from './bridges';
import { Solid, structures } from '../roaddraw';

const over = { ...DEFAULT_OPTS, cross: 'bridge' as const };
const build = (net: Network, a: P, b: P, o = DEFAULT_OPTS) => net.build(net.snapStart(a, 3), net.snapStart(b, 3), undefined, o);

// distance from point to a polyline (plan)
function distTo(p: P, path: P[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}
// does a convex quad footprint overlap the strip of half-width h about a polyline? (samples its area)
function footHits(foot: P[], path: P[], h: number) {
  for (let u = 0; u <= 1.0001; u += 0.1) for (let v = 0; v <= 1.0001; v += 0.1) {
    const a = { x: foot[0].x + (foot[1].x - foot[0].x) * u, z: foot[0].z + (foot[1].z - foot[0].z) * u };
    const b = { x: foot[3].x + (foot[2].x - foot[3].x) * u, z: foot[3].z + (foot[2].z - foot[3].z) * u };
    const p = { x: a.x + (b.x - a.x) * v, z: a.z + (b.z - a.z) * v };
    if (distTo(p, path) < h) return true;
  }
  return false;
}
function piersOnRoads(net: Network, layer: BridgeLayer) {
  const bad: string[] = [];
  for (const b of layer.list()) for (const q of b.layout.supports) {
    for (const s of net.segs.values()) {
      if (s.id === b.seg) continue;
      const path = net.path(s);
      // only roads underneath (at ground level where the support stands)
      if (!path.some((p) => (p.y ?? 0) < q.top - 2)) continue;
      const low = path.filter((p) => (p.y ?? 0) < 2);
      if (low.length < 2) continue;
      const k = kerbOf(net.def(s)); // the carriageway (piers on the pavement are not counted)
      if (footHits(q.foot, path, k)) bad.push(`${q.kind}@${q.s.toFixed(1)} of bridge ${b.seg} (${b.layout.def.id}) stands in the carriageway of ${s.type} ${s.id} (kerb ${k.toFixed(1)} m, footprint reaches ${Math.min(...q.foot.map((f) => distTo(f, path))).toFixed(1)} m from its centreline, centre ${distTo(q, path).toFixed(1)} m)`);
    }
  }
  return bad;
}

describe('review: piers vs roads underneath', () => {
  for (const under of ['street', 'avenue', 'dual', 'motorway']) for (const deg of [90, 60, 45, 30, 20]) {
    it(`no support stands in the carriageway of a ${under} crossed at ${deg} degrees`, () => {
      const net = new Network();
      build(net, { x: -300, z: 0 }, { x: 300, z: 0 }, { ...DEFAULT_OPTS, type: under as never });
      const r = (deg * Math.PI) / 180, L = 250;
      build(net, { x: -Math.cos(r) * L, z: -Math.sin(r) * L }, { x: Math.cos(r) * L, z: Math.sin(r) * L }, over);
      const layer = new BridgeLayer();
      layer.sync(net);
      expect(layer.list().length).toBeGreaterThan(0);
      expect(piersOnRoads(net, layer)).toEqual([]);
    });
  }
});

describe('review: roads built after the bridge, underneath it', () => {
  it('a street built later across under a flyover gets no pier in it', () => {
    const net = new Network();
    build(net, { x: -300, z: 0 }, { x: 300, z: 0 });
    build(net, { x: 0, z: -300 }, { x: 0, z: 300 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    const before = layer.list()[0];
    // under each pier in turn
    const piers = before.layout.supports.filter((q) => q.kind !== 'abutment');
    expect(piers.length).toBeGreaterThan(0);
    const q = piers[0];
    const c = net.check(net.snapStart({ x: -120, z: q.z }, 3), net.snapStart({ x: 120, z: q.z }, 3), undefined, { ...DEFAULT_OPTS, cross: 'tunnel' });
    expect(c.ok, c.reason).toBe(true);
    build(net, { x: -120, z: q.z }, { x: 120, z: q.z }, { ...DEFAULT_OPTS, cross: 'tunnel' });
    layer.sync(net);
    expect(piersOnRoads(net, layer)).toEqual([]);
  });

  it('a street built later running along under a viaduct is refused or kept clear of the piers', () => {
    const net = new Network();
    build(net, { x: -60, z: -300 }, { x: -60, z: 300 });
    build(net, { x: 60, z: -300 }, { x: 60, z: 300 });
    build(net, { x: -300, z: 0 }, { x: 300, z: 0 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    expect(layer.list()).toHaveLength(1);
    const b = layer.list()[0];
    const pts = b.layout.supports.filter((q) => q.kind !== 'abutment');
    // a street beside the bridge's centreline, under its deck
    const a = { x: -40, z: 3.5 }, e = { x: 40, z: 3.5 };
    const c = net.check(net.snapStart(a, 3), net.snapStart(e, 3), undefined, DEFAULT_OPTS);
    if (!c.ok) return; // refused: fine
    build(net, a, e);
    layer.sync(net);
    expect({ piers: pts.length, bad: piersOnRoads(net, layer) }).toEqual({ piers: pts.length, bad: [] });
  });
});

describe('review: a road built later under a flyover', () => {
  // A flyover over a street, then a second street 9 m away, under the deck (check() lets it through
  // as passing under "the flyover"). No type fits the wider gap without raising the deck, and
  // sync() has no resolve, so the bridge vanishes: s.bridges becomes undefined, and roaddraw
  // (given [] rather than undefined) draws retaining walls to the ground across BOTH streets.
  it('a street built later under a flyover leaves both streets bridged (or is refused)', () => {
    const net = new Network();
    build(net, { x: -300, z: 0 }, { x: 300, z: 0 });
    build(net, { x: 0, z: -300 }, { x: 0, z: 300 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    expect(layer.list()).toHaveLength(1);
    const c = net.check(net.snapStart({ x: -150, z: 9 }, 3), net.snapStart({ x: 150, z: 9 }, 3), undefined, DEFAULT_OPTS);
    if (!c.ok) return; // refusing it would be fine
    build(net, { x: -150, z: 9 }, { x: 150, z: 9 });
    layer.sync(net);
    const fly = [...net.segs.values()].find((s) => net.path(s).some((p) => (p.y ?? 0) > 3))!;
    // both streets pass under the flyover at s ~ 300 and ~ 309 along it
    const b = layer.list().find((x) => x.seg === fly.id);
    expect(b, 'the flyover has no bridge any more').toBeDefined();
    expect(b!.s0).toBeLessThan(295);
    expect(b!.s1).toBeGreaterThan(314);
    expect(piersOnRoads(net, layer)).toEqual([]);
  });
});

// the walls roaddraw draws down to y = 0 inside a strip about a road: a wall across it
function wallsAcross(body: Solid, road: P[], h: number) {
  let n = 0;
  for (let i = 0; i < body.pos.length; i += 9) {
    const tri = [0, 1, 2].map((k) => ({ x: body.pos[i + k * 3], y: body.pos[i + k * 3 + 1], z: body.pos[i + k * 3 + 2] }));
    if (!tri.some((v) => v.y < 0.01) || !tri.some((v) => v.y > 4)) continue;
    const c = { x: (tri[0].x + tri[1].x + tri[2].x) / 3, z: (tri[0].z + tri[1].z + tri[2].z) / 3 };
    if (distTo(c, road) < h) n++;
  }
  return n;
}

describe('review: roaddraw where the library draws no bridge', () => {
  it('a raised segment with no library bridge keeps its old deck (no walls to the ground over the road below)', () => {
    const net = new Network();
    build(net, { x: -300, z: 0 }, { x: 300, z: 0 });
    build(net, { x: 0, z: -300 }, { x: 0, z: 300 }, over);
    build(net, { x: -150, z: 9 }, { x: 150, z: 9 });
    const layer = new BridgeLayer();
    layer.sync(net);
    const fly = [...net.segs.values()].find((s) => net.path(s).some((p) => (p.y ?? 0) > 3))!;
    const body = new Solid(), rails = new Solid();
    // exactly as drawRoads() calls it
    structures(net.path(fly), body, rails, net.half(fly), (fly.bridges ?? []).map((b) => [b.s0, b.s1] as [number, number]));
    const street = net.path([...net.segs.values()].find((s) => s.id !== fly.id && Math.abs(net.path(s)[0].z) < 1)!);
    expect(wallsAcross(body, street, 3)).toBe(0);
  });
});

// what check() should charge: the road, RAISE_COST (or TUNNEL_COST) on the path it will build
// outside the bridges (as laid out on that path), each bridge at the chooser's price, and the demolitions
function expectedCost(c: Check, type: string) {
  let cost = Math.round(c.length * ROADS[type].cost), acc = 0;
  for (let i = 1; i < c.path.length; i++) {
    const L = Math.hypot(c.path[i].x - c.path[i - 1].x, c.path[i].z - c.path[i - 1].z), m = acc + L / 2;
    acc += L;
    const ym = ((c.path[i].y ?? 0) + (c.path[i - 1].y ?? 0)) / 2;
    if (!c.choices.some((ch) => { const lay = ch.options.find((x) => x.def.id === ch.chosen)?.layout; return lay && m >= lay.s0 && m <= lay.s1; })) cost += ym > 0 ? L * ym * RAISE_COST : L * Math.min(-ym, 14) * TUNNEL_COST;
  }
  for (const ch of c.choices) cost += ch.options.find((x) => x.def.id === ch.chosen)?.cost ?? 0;
  return Math.round(cost + c.clears.length * 6000);
}

describe('review: check() costs', () => {
  it('a plain flyover is priced road + ramps + bridge', () => {
    const net = new Network((p) => Math.hypot(p.x - 200, p.z + 150) < 80);
    const c = net.check(net.snapStart({ x: 0, z: -150 }, 3), net.snapStart({ x: 400, z: -150 }, 3), undefined, over);
    expect(c.ok).toBe(true);
    expect(c.choices.length).toBe(1);
    expect(Math.abs(c.cost - expectedCost(c, 'street'))).toBeLessThan(2);
  });
  // When the chosen type needs the deck raised (a deeper structure), check() builds the lifted
  // path, but the RAISE_COST it charged was worked out on the old, lower profile: the longer,
  // higher ramps it actually builds are not paid for (~50-66k short here, 10-15% of the total).
  for (const [under, top] of [['motorway', 'street'], ['rail-main', 'street']] as const) {
    it(`a ${top} over a ${under} whose bridge needed the deck raised pays for the ramps it builds`, () => {
      const net = new Network();
      build(net, { x: -300, z: 0 }, { x: 300, z: 0 }, { ...DEFAULT_OPTS, type: under as never });
      const c = net.check(net.snapStart({ x: 0, z: -280 }, 3), net.snapStart({ x: 0, z: 280 }, 3), undefined, { ...over, type: top as never });
      expect(c.ok).toBe(true);
      const o = c.choices[0].options.find((x) => x.def.id === c.choices[0].chosen)!;
      expect(o.lift).toBeGreaterThan(0); // (the case under test)
      expect(c.cost).toBe(expectedCost(c, top));
    });
  }
  // bridgeLines() in main.ts shows `ch.s1 - ch.s0` as the bridge's length, storeBridges() stores
  // ch.s0..ch.s1, and priceBridges() takes RAISE_COST back off over ch.s0..ch.s1; but when the deck
  // was raised, the chosen layout (and its price) is for a longer stretch of the lifted path.
  it('a lifted bridge: the extent in the choice is the extent that was priced and will be built', () => {
    const net = new Network();
    build(net, { x: -300, z: 0 }, { x: 300, z: 0 }, { ...DEFAULT_OPTS, type: 'rail-main' as never });
    const c = net.check(net.snapStart({ x: 0, z: -150 }, 3), net.snapStart({ x: 0, z: 150 }, 3), undefined, over);
    const ch = c.choices[0], lay = ch.options.find((x) => x.def.id === ch.chosen)!.layout!;
    expect([Math.round(ch.s0), Math.round(ch.s1)]).toEqual([Math.round(lay.s0), Math.round(lay.s1)]);
  });
  it('what build() stores and sync() draws is the type the blueprint chose and priced', () => {
    const net = new Network();
    build(net, { x: -300, z: 0 }, { x: 300, z: 0 }, { ...DEFAULT_OPTS, type: 'motorway' as never });
    const c = net.check(net.snapStart({ x: 0, z: -280 }, 3), net.snapStart({ x: 0, z: 280 }, 3), undefined, over);
    build(net, { x: 0, z: -280 }, { x: 0, z: 280 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    expect(layer.list().map((b) => b.layout.def.id)).toEqual([c.choices[0].chosen]);
    const o = c.choices[0].options.find((x) => x.def.id === c.choices[0].chosen)!;
    expect(Math.abs(layer.list()[0].layout.cost - o.cost) / o.cost).toBeLessThan(0.05);
  });
});

describe('review: overrides through splits and rebuilds', () => {
  const lake = (p: P) => Math.hypot(p.x - 200, p.z) < 70;
  const setup = () => {
    const net = new Network(lake);
    build(net, { x: -100, z: 0 }, { x: 420, z: 0 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    const b = layer.list()[0];
    const alt = layer.options(b).options.find((o) => o.ok && o.def.id !== b.layout.def.id)!;
    expect(layer.setType(net, b, alt.def.id)).toBe(true);
    layer.sync(net);
    return { net, layer, alt };
  };
  it('a street crossing the approach at grade (a split) keeps the player’s type', () => {
    const { net, layer, alt } = setup();
    build(net, { x: -60, z: -150 }, { x: -60, z: 150 }); // crosses the flat approach: a junction
    layer.sync(net);
    expect(layer.list().map((b) => [b.layout.def.id, net.segs.get(b.seg)!.bridges![b.idx].override])).toEqual([[alt.def.id, true]]);
  });
  it('picking the recommended type again clears the override', () => {
    const { net, layer } = setup();
    const b = layer.list()[0], rec = layer.options(b).recommended!;
    expect(layer.setType(net, b, rec)).toBe(true);
    layer.sync(net);
    const nb = layer.list()[0];
    expect(nb.layout.def.id).toBe(rec);
    expect(net.segs.get(nb.seg)!.bridges![nb.idx].override).toBe(false);
  });
  it('the bridge stored on the segment is where it is drawn', () => {
    const { net, layer } = setup();
    for (const b of layer.list()) {
      const st = net.segs.get(b.seg)!.bridges![b.idx];
      expect([st.s0, st.s1]).toEqual([b.s0, b.s1]);
      expect(st.type).toBe(b.layout.def.id);
    }
  });
});

describe('review: traffic speed cap', () => {
  it('capAt measures s from seg.a, and is Infinity off the bridge', () => {
    const net = new Network((p) => Math.hypot(p.x - 200, p.z) < 70);
    build(net, { x: -100, z: 0 }, { x: 420, z: 0 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    const b = layer.list()[0], seg = net.segs.get(b.seg)!;
    // put a cap on it whatever the type
    const slow = layer.options(b).options.find((o) => o.ok && o.def.roadMph);
    if (slow) { layer.setType(net, b, slow.def.id); layer.sync(net); }
    const nb = layer.list()[0];
    if (!nb.layout.def.roadMph) return;
    expect(layer.capAt(seg, nb.s0 + 1)).toBeLessThan(Infinity);
    expect(layer.capAt(seg, nb.s0 - 5)).toBe(Infinity);
    expect(layer.capAt(seg, nb.s1 + 5)).toBe(Infinity);
  });
});

describe('review: a blueprint no bridge type fits', () => {
  // A street over a main line with just enough run-up for the solver's 6.5 m, but not enough to
  // raise the deck for the 6.6 m headroom over a railway (+ structure) the library wants: every
  // type is refused, check() still says ok, build() stores no bridge, and roaddraw then draws the
  // raised stretch as retaining walls down to the ground ACROSS THE RAILWAY (a dam; screenshot
  // rv-g-rail-wall.png in the game at x -300, z 60..300).
  for (const half of [110, 115, 125]) {
    it(`a street over a railway with ${half} m run-ups is refused, or bridged`, () => {
      const net = new Network();
      build(net, { x: -300, z: 0 }, { x: 300, z: 0 }, { ...DEFAULT_OPTS, type: 'rail-main' as never });
      const c = net.check(net.snapStart({ x: 0, z: -half }, 3), net.snapStart({ x: 0, z: half }, 3), undefined, over);
      if (!c.ok) return;
      expect(c.choices.every((ch) => ch.chosen), 'check() ok with no bridge type chosen').toBe(true);
      build(net, { x: 0, z: -half }, { x: 0, z: half }, over);
      const layer = new BridgeLayer();
      layer.sync(net);
      expect(layer.list()).toHaveLength(1);
    });
  }
});

describe('review: a bridge over a junction', () => {
  for (const deg of [60, 45, 30]) {
    it(`no support stands in the roads of a crossroads the bridge passes over at ${deg} degrees`, () => {
      const net = new Network();
      build(net, { x: -300, z: 0 }, { x: 300, z: 0 });
      build(net, { x: 0, z: -300 }, { x: 0, z: 300 }); // a crossroads at the origin
      const r = (deg * Math.PI) / 180, L = 260;
      const c = net.check(net.snapStart({ x: -Math.cos(r) * L, z: -Math.sin(r) * L }, 3), net.snapStart({ x: Math.cos(r) * L, z: Math.sin(r) * L }, 3), undefined, over);
      if (!c.ok) return;
      build(net, { x: -Math.cos(r) * L, z: -Math.sin(r) * L }, { x: Math.cos(r) * L, z: Math.sin(r) * L }, over);
      const layer = new BridgeLayer();
      layer.sync(net);
      expect(layer.list().length).toBeGreaterThan(0);
      expect(piersOnRoads(net, layer)).toEqual([]);
    });
  }
});
