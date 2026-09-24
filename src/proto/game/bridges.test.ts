import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTS, Network, RAISE_COST, pointAt, type P } from '../roads';
import { BridgeLayer, crossingOf } from './bridges';

const over = { ...DEFAULT_OPTS, cross: 'bridge' as const };
const lake = (p: P) => Math.hypot(p.x - 200, p.z) < 70;
const build = (net: Network, a: P, b: P, o = DEFAULT_OPTS) => net.build(net.snapStart(a, 3), net.snapStart(b, 3), undefined, o);

describe('bridges in the game', () => {
  it('a flyover gets a library bridge with no pier on the road underneath', () => {
    const net = new Network();
    build(net, { x: -200, z: 0 }, { x: 200, z: 0 });
    build(net, { x: 0, z: -200 }, { x: 0, z: 200 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    const [b] = layer.list();
    expect(b).toBeDefined();
    expect(net.segs.get(b.seg)!.bridges![0].type).toBe(b.layout.def.id);
    for (const q of b.layout.supports) expect(Math.abs(q.z) - q.along).toBeGreaterThan(net.half([...net.segs.values()][0]));
  });

  it('prices the bridge with the chooser, not RAISE_COST', () => {
    const net = new Network();
    build(net, { x: -200, z: 0 }, { x: 200, z: 0 });
    const c = net.check(net.snapStart({ x: 0, z: -200 }, 3), net.snapStart({ x: 0, z: 200 }, 3), undefined, over);
    expect(c.ok).toBe(true);
    expect(c.choices).toHaveLength(1);
    expect(c.bridges).toBe(1);
    const o = c.choices[0].options.find((x) => x.def.id === c.choices[0].chosen)!;
    // the whole cost: road, ramps outside the bridge at RAISE_COST, and the bridge itself
    let ramps = 0, acc = 0;
    for (let i = 1; i < c.path.length; i++) {
      const L = Math.hypot(c.path[i].x - c.path[i - 1].x, c.path[i].z - c.path[i - 1].z), m = acc + L / 2;
      acc += L;
      const ym = ((c.path[i].y ?? 0) + (c.path[i - 1].y ?? 0)) / 2;
      if ((m < c.choices[0].s0 || m > c.choices[0].s1) && ym > 0) ramps += L * ym * RAISE_COST;
    }
    expect(o.cost).toBeGreaterThan(0);
    expect(c.cost).toBeGreaterThan(o.cost + ramps * 0.9);
  });

  it('a lake crossing puts piers in the water, and the drawn bridge is one mesh per material', () => {
    const net = new Network(lake);
    build(net, { x: -60, z: 0 }, { x: 460, z: 0 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    expect(layer.list()).toHaveLength(1);
    expect(layer.list()[0].layout.supports.some((q) => q.inWater)).toBe(true);
    const mats = layer.group.children.map((m) => m.name);
    expect(new Set(mats).size).toBe(mats.length);
  });

  it('keeps the player’s override through a rebuild, and speed limits follow the type', () => {
    const net = new Network(lake);
    build(net, { x: -60, z: 0 }, { x: 460, z: 0 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    const b = layer.list()[0], opts = layer.options(b);
    const alt = opts.options.find((o) => o.ok && o.def.id !== b.layout.def.id)!;
    expect(layer.setType(net, b, alt.def.id)).toBe(true);
    layer.sync(net);
    const nb = layer.list()[0];
    expect(nb.layout.def.id).toBe(alt.def.id);
    expect(net.segs.get(nb.seg)!.bridges![0].override).toBe(true);
    // a road built under it later: the bridge is laid out again, keeping the type
    const seg = net.segs.get(nb.seg)!, mid = pointAt(net.path(seg), (nb.s0 + nb.s1) / 2);
    expect(mid.y).toBeGreaterThan(5);
    expect(layer.capAt(seg, (nb.s0 + nb.s1) / 2)).toBe(alt.def.roadMph ? alt.def.roadMph * 0.44704 : Infinity);
    expect(layer.capAt(seg, 1)).toBe(Infinity);
  });

  it('refuses a type that doesn’t fit', () => {
    const net = new Network(lake);
    build(net, { x: -60, z: 0 }, { x: 460, z: 0 }, over);
    const layer = new BridgeLayer();
    layer.sync(net);
    const b = layer.list()[0], no = layer.options(b).options.find((o) => !o.ok)!;
    expect(layer.setType(net, b, no.def.id)).toBe(false);
  });

  it('describes roads underneath as obstacles, and nothing for roads at the same level', () => {
    const net = new Network();
    build(net, { x: -200, z: 0 }, { x: 200, z: 0 });
    const path = [{ x: 0, z: -100, y: 7 }, { x: 0, z: 100, y: 7 }];
    const c = crossingOf(net, path, net.def([...net.segs.values()][0]));
    expect(c.obstacles.map((o) => o.kind)).toEqual(['road']);
    const flat = crossingOf(net, path.map((p) => ({ ...p, y: 0 })), net.def([...net.segs.values()][0]));
    expect(flat.obstacles).toHaveLength(0);
  });
});
