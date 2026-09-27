// Farmsteads in the live play area (country.ts): the countryside's farms inside the 8 km square, their
// yards on the land registry and painted, their buildings built in a few frames into a few meshes.
import { describe, expect, it } from 'vitest';
import { planWorld } from '../worldmap/plan';
import { countryFor } from '../worldmap/country';
import * as THREE from 'three';
import { Network, type Lot } from '../roads';
import { farmGround, LIVE_BOX, LiveFarms } from './country';

// (a stand-in for buildgen's makeBuilding, which needs a browser's canvas: one box a lot, one material for all)
const boxMat = new THREE.MeshLambertMaterial();
const make = (l: Lot) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(l.w, l.h, l.d), boxMat); m.position.set(l.x, l.h / 2, l.z); m.rotation.y = -l.rot; g.add(m); return { group: g }; };

const plan = planWorld({ seed: 42 });
const inside = (p: { x: number; z: number }) => p.x >= LIVE_BOX.x0 && p.x < LIVE_BOX.x1 && p.z >= LIVE_BOX.z0 && p.z < LIVE_BOX.z1;

describe('the live area has its farmsteads', () => {
  it('gives the ground a yard for every farm in the live area, and a track for those that stand back', () => {
    const farms = countryFor(plan).farmsNear(LIVE_BOX).filter(inside), g = farmGround(plan);
    expect(farms.length).toBeGreaterThan(20);
    expect(g.plots.filter((p) => p.kind === 'yard').length).toBe(farms.length);
    expect(g.plots.filter((p) => p.kind === 'track').length).toBe(farms.filter((f) => f.track && f.track.length > 1).length);
    // (a track may run to a road up to 700 m off, past the live area's edge; the yards are inside it)
    for (const p of g.plots) for (const q of p.poly) expect(Math.max(Math.abs(q.x), Math.abs(q.z))).toBeLessThan(LIVE_BOX.x1 + (p.kind === 'track' ? 800 : 50));
    expect(farmGround(plan)).toBe(g); // (once a plan)
  });
  it('claims every yard on the land registry and builds the farms into a few meshes', () => {
    const net = new Network(() => false, LIVE_BOX.x1, 11);
    const lf = new LiveFarms(plan, net, make);
    expect(lf.count).toBe(countryFor(plan).farmsNear(LIVE_BOX).filter(inside).length);
    expect([...net.land.all()].filter((c) => c.key.startsWith('farm:')).length).toBe(lf.count);
    for (let k = 0; k < 400 && !lf.done; k++) lf.update(50);
    expect(lf.done).toBe(true);
    expect(lf.built).toBeGreaterThan(lf.count * 2); // (a house and a barn each, most a shed too)
    expect(lf.group.children.length).toBeGreaterThan(0);
    expect(lf.group.children.length).toBe(2); // (one mesh a material, not one a building: the houses' and the barns')
    lf.dispose();
  });
});
