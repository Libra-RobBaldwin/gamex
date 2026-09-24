// Trains keep apart until the track is signalled: on no frame do two trains share the same stretch
// of the same track (each direction of a double track is its own; a single track is shared), and
// a line's trains still get round their stations.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, rng, closestOnPath } from '../roads';
import { Traffic, type RailLine } from '../traffic';
import { TRAINS } from '../catalog';

type Body = { seg: { id: number }; dir: number; x0: number; x1: number };
function railway(type: string) {
  const net = new Network(() => false, 900);
  net.build({ x: -600, z: 0 }, { x: 600, z: 0 }, undefined, { ...DEFAULT_OPTS, type });
  const traffic = new Traffic(net, new THREE.Scene(), rng(4));
  return { net, traffic };
}
// the worst overlap between two trains on the same track this frame (metres; 0 if none)
function worst(traffic: Traffic, net: Network) {
  const bodies = (traffic as unknown as { bodies(): Map<unknown, Body[]> }).bodies(), all = [...bodies.values()];
  let w = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) for (const a of all[i]) for (const b of all[j]) {
    if (a.seg.id !== b.seg.id) continue;
    const seg = net.segs.get(a.seg.id)!;
    if (net.def(seg).tracks === 2 && a.dir !== b.dir) continue;
    w = Math.max(w, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  }
  return w;
}
function run(traffic: Traffic, net: Network, seconds: number, dt = 1 / 30) {
  let w = 0;
  for (let i = 0; i < seconds / dt; i++) { traffic.update(dt, i * dt * 1000); w = Math.max(w, worst(traffic, net)); }
  return w;
}

describe('trains keep apart', () => {
  it('two wandering trains of different speeds on a double-track main line', () => {
    const { net, traffic } = railway('rail-main');
    traffic.addTrain('intercity'); traffic.addTrain('dmu');
    expect(run(traffic, net, 600)).toBe(0);
  }, 120_000);
  it('two wandering trains on a single-track branch', () => {
    const { net, traffic } = railway('rail-branch');
    traffic.addTrain('dmu'); traffic.addTrain('dmu');
    expect(run(traffic, net, 600)).toBe(0);
  }, 120_000);
  it('two trains on one line between two stations, calling and turning round; a third refused', () => {
    const { net, traffic } = railway('rail-main');
    const seg = [...net.segs.values()][0], at = (x: number) => ({ seg, s: closestOnPath({ x, z: 0 }, net.path(seg)).s, len: 110 });
    const spots = new Map([[1, at(-300)], [2, at(300)]]);
    traffic.stationAt = (id) => spots.get(id) ?? null;
    const calls: number[] = [];
    traffic.onTrainStop = (st) => { calls.push(st); return 20; };
    const line: RailLine = { id: 1, seq: [1, 2] };
    // (a third can't start at a platform where one already stands: it's refused, not stacked)
    const made = [0, 1, 2].map((i) => traffic.addLineTrain(TRAINS.dmu, line, i));
    expect(made.filter(Boolean).length).toBe(2);
    expect(run(traffic, net, 900)).toBe(0);
    expect(new Set(calls).size).toBe(2);
    expect(calls.length).toBeGreaterThanOrEqual(6);
  }, 120_000);
});
