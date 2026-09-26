import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GameWater } from './water';
import { MapWater, lakeRadiusOf, type RiverSpec, type WaterSpec } from '../worldmap/water';

// The game's water on a map with lakes and a river across it, as a region's live area has them
// (worldmap/water.ts waterInBox): the same spec shape the 50 km plan's water comes in.
const B = 3000; // the map's half-width; its ground reaches 1.5 times that
function river(): RiverSpec {
  const path = [];
  for (let t = -1.65 * B; t <= 1.65 * B + 1e-6; t += 20) path.push({ x: t, z: 300 + 250 * Math.sin(t / 1600) + 80 * Math.sin(t / 620 + 1) });
  return { path, width: 18 };
}
const spec: WaterSpec = { lakes: [{ x: -1500, z: -1400, r: 150, waves: [0.7, 2.1, 0.4] }, { x: 1800, z: 1900, r: 120, waves: [1.3, 0.2, 2.8] }], rivers: [river()] };
const settlements = [{ x: -200, z: -900 }, { x: 1700, z: -1200 }, { x: -1900, z: 1500 }]; // (places on dry land)
describe('game water on a map’s lakes and river', () => {
  const g = { bound: B, settlements }, mw = new MapWater(spec);
  const gw = new GameWater(g.bound * 1.5, spec);
  const R = spec.rivers[0], mid = R.path[Math.floor(R.path.length / 2)], next = R.path[Math.floor(R.path.length / 2) + 1];
  const L = Math.hypot(next.x - mid.x, next.z - mid.z), nx = -(next.z - mid.z) / L, nz = (next.x - mid.x) / L;
  const across = (d: number) => ({ x: mid.x + nx * d, z: mid.z + nz * d });

  it('fills every lake and the river, and nothing else', () => {
    for (const lake of spec.lakes) {
      expect(gw.water.isWater(lake.x, lake.z)).toBe(true);
      for (let a = 0; a < Math.PI * 2; a += 0.3) {
        const r = lakeRadiusOf(lake, a);
        expect(gw.water.isWater(lake.x + Math.cos(a) * r * 1.08, lake.z + Math.sin(a) * r * 1.08)).toBe(false);
      }
    }
    expect(gw.water.isWater(mid.x, mid.z)).toBe(true);
    for (const s of g.settlements) expect(gw.isWater(s)).toBe(false);
  });

  it('isWater keeps roads 9.5 m off the river bank, as off a lake', () => {
    const half = R.width / 2;
    expect(gw.isWater(across(half + 5))).toBe(true);
    expect(gw.isWater(across(-(half + 5)))).toBe(true);
    expect(gw.isWater(across(half + 9))).toBe(true);
    expect(gw.isWater(across(half + 14))).toBe(false);
  });

  it('the river bed is a strip that meets the flat ground at its edges, facing up', () => {
    const beds = gw.beds(() => new THREE.MeshLambertMaterial());
    expect(beds).toHaveLength(1);
    const m = beds[0], pos = m.geometry.getAttribute('position'), idx = m.geometry.getIndex()!;
    const mat = m.material as THREE.MeshLambertMaterial;
    // it marks the stencil, drawn before the ground (which leaves out what it marks)
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilRef).toBe(1);
    expect(mat.stencilZPass).toBe(THREE.ReplaceStencilOp);
    expect(m.renderOrder).toBeLessThan(-9);
    // (plane frame: x, −z, height) the lowest point is down in the channel, nothing above the flat
    let lo = 0, hi = -1;
    for (let v = 0; v < pos.count; v++) { lo = Math.min(lo, pos.getZ(v)); hi = Math.max(hi, pos.getZ(v)); }
    expect(lo).toBeLessThan(-1.5);
    expect(hi).toBeLessThanOrEqual(1e-6);
    // every triangle faces up (its normal's height part, in the plane frame, is positive)
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t)); b.fromBufferAttribute(pos, idx.getX(t + 1)); c.fromBufferAttribute(pos, idx.getX(t + 2));
      expect(b.sub(a).cross(c.sub(a)).z).toBeGreaterThanOrEqual(0);
    }
    // the ground function it follows is the one the water system fills
    expect(mw.ground(mid.x, mid.z)).toBeLessThan(-1.5);
  });

  it('the ground mesh has a bank ring for every lake, and is flat elsewhere', () => {
    const geo = gw.groundGeometry(g.bound * 3), pos = geo.getAttribute('position');
    let deep = 0;
    for (let v = 0; v < pos.count; v++) if (pos.getZ(v) < -3) deep++;
    expect(deep).toBeGreaterThan(spec.lakes.length * 100); // (each lake's shelf and bed)
    // and no vertex dips where there's no lake (the river's bed is its own strip)
    for (let v = 0; v < pos.count; v++) {
      if (pos.getZ(v) > -0.01) continue;
      const x = pos.getX(v), z = -pos.getY(v);
      expect(spec.lakes.some((lake) => Math.hypot(x - lake.x, z - lake.z) < lake.r * 1.4)).toBe(true);
    }
  });
});
