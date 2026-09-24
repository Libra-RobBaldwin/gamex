import { it } from 'vitest';
import { DEFAULT_OPTS, Network } from '../roads';
import { motorwayWithJunction } from './build';

it('try', () => {
  for (const form of ['dumbbell', 'diamond', 'gsr'] as const) {
    const net = new Network(() => false, 1400);
    net.build({ x: 0, z: -600 }, { x: 0, z: 600 }, undefined, { ...DEFAULT_OPTS, type: 'dual' });
    const road = [...net.segs.values()][0];
    const r = motorwayWithJunction(net, form, [{ x: -1300, z: 0 }, { x: 1300, z: 0 }], 'motorway', road);
    if (!r.ok) { console.log(form, r.reason); continue; }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const id of r.ix.segs) for (const p of net.path(net.segs.get(id)!)) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const merges = r.ix.nodes.map((n) => net.node(n)).filter((n) => Math.abs(n.z) < 30).map((n) => Math.round(n.x));
    console.log(form, `x ${x0.toFixed(0)}..${x1.toFixed(0)} z ${z0.toFixed(0)}..${z1.toFixed(0)} slip nodes x=${merges.join(',')}`);
  }
});
