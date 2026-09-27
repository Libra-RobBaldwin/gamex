// Culling on the hills: the drape (drape.ts) lifts every vehicle onto the map's relief in its
// shader, so a car the traffic places at height 0 in a town 245 m up is drawn at 245 m. The
// fleet's own culling must look there too: before it did, on such a town every car, bus, train
// and parked car failed the test and none was drawn (the user saw the road drawer's parked
// boxes and nothing else).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Network } from '../roads';
import { Fleet } from './fleet';
import type { Rect } from '../footprint';

function scene(lift: number) {
  const net = new Network(() => false, 900);
  net.build({ x: -200, z: 0 }, { x: 200, z: 0 });
  const f = new Fleet(net, 3);
  const cam = new THREE.PerspectiveCamera(50, 412 / 915, 1, 4000);
  cam.position.set(0, lift + 60, 45); cam.lookAt(0, lift, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  f.frame(cam, 2, 12);
  let drawn = 0;
  (f.vr as unknown as { add: () => void }).add = () => { drawn++; };
  const dm = f.dress([...net.segs.values()][0], false);
  const parts: Rect[] = [{ x: 0, z: 0, hx: 1, hz: 0, hl: 2, hw: 0.9 }];
  const draw = () => { drawn = 0; f.drawCar({ id: 1, v: 0, s: 0, lane: 0, dress: dm.dress, parked: true }, parts, -0.21, 0, 1, 0.016); return drawn; };
  return { f, draw };
}

describe('the fleet culls where the drape draws', () => {
  it('a car under the camera on a town 245 m up is drawn once the fleet knows the hills', () => {
    const w = scene(245);
    expect(w.draw(), 'without the hills: culled (the bug)').toBe(0);
    w.f.lift = () => 245;
    expect(w.draw(), 'with them: drawn').toBeGreaterThan(0);
  });
  it('on a flat map nothing changes', () => {
    const w = scene(0);
    expect(w.draw()).toBeGreaterThan(0);
    w.f.lift = () => 0;
    expect(w.draw()).toBeGreaterThan(0);
  });
});
