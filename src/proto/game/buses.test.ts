// The buses the crowds board: they must keep running after calling at a lay-by, and a stop can
// hold one while its passengers walk to the door.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng } from '../roads';
import { design, landFits, legsAt, type Junction } from '../junction';
import { Traffic } from '../traffic';

const as = (type: string) => ({ ...DEFAULT_OPTS, type });
// an avenue with a side road at each end, and a lay-by on each side halfway along
function avenue() {
  const net = new Network(() => false, 900);
  net.build({ x: -250, z: 0 }, { x: 250, z: 0 }, undefined, as('avenue'));
  for (const x of [-150, 150]) net.build(net.snapStart({ x, z: 0 }, 3), { x, z: 200 }, undefined, as('street'));
  const junctions = new Map<number, Junction>();
  for (const nd of net.nodes.values()) {
    if (legsAt(net, nd.id).length < 3) continue;
    const j = design(net, nd.id, { fits: (p) => landFits(net, nd.id, p) });
    if (j) { junctions.set(nd.id, j); net.land.claim(`junction:${nd.id}`, 'junction', j.shape?.claims ?? []); }
  }
  const mid = [...net.segs.values()].find((s) => { const p = net.path(s); return Math.abs(p[0].x) === 150 && Math.abs(p[p.length - 1].x) === 150; })!;
  for (const side of [1, -1] as const) {
    const plan = net.planStop(mid.id, net.length(mid) / 2, side).plans.find((p) => p.kind === 'layby' && p.ok)!;
    net.addStop(mid.id, net.length(mid) / 2, side, plan);
  }
  return { net, junctions, mid };
}

describe('buses at stops', () => {
  it('keep running after calling at a lay-by with a junction ahead', () => {
    const { net, junctions, mid } = avenue();
    const traffic = new Traffic(net, new THREE.Scene(), rng(3));
    traffic.junctions = junctions;
    for (let i = 0; i < 3; i++) traffic.addBus();
    const calls: number[] = [];
    traffic.onBusStop = (seg) => { calls.push(seg.id); return 7; };
    for (let i = 0; i < 30 * 600; i++) traffic.update(1 / 30, (i * 1000) / 30);
    expect(calls.filter((id) => id === mid.id).length).toBeGreaterThan(2);
    expect(traffic.buses).toBe(3);
    expect(traffic.stats.gaveUp).toBe(0);
  }, 60_000);

  it('wait at the stop for as long as the crowds ask', () => {
    const { net, junctions } = avenue();
    const traffic = new Traffic(net, new THREE.Scene(), rng(3));
    traffic.junctions = junctions;
    traffic.addBus();
    let arrived = -1, left = -1;
    traffic.onBusStop = () => { arrived = t; return 25; };
    let t = 0;
    for (let i = 0; i < 30 * 400 && left < 0; i++) {
      t = i / 30;
      traffic.update(1 / 30, t * 1000);
      const bus = traffic.cars.find((c) => c.bus)!;
      if (arrived >= 0 && left < 0 && bus.dwell === undefined) left = t;
    }
    expect(arrived).toBeGreaterThanOrEqual(0);
    expect(left - arrived).toBeGreaterThan(24);
    expect(left - arrived).toBeLessThan(26);
  }, 60_000);
});
