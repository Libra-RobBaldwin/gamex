import { describe, expect, it } from 'vitest';
import { FloatingOrigin, type Rebase } from './origin';

const f32 = Math.fround;

describe('floating origin', () => {
  it('stays put near the camera and rebases to a tile corner when it wanders', () => {
    const o = new FloatingOrigin(2000, 1000);
    const seen: Rebase[] = [];
    o.on('rebase', (e) => seen.push(e));
    expect(o.update(1500, -1900)).toBe(false);
    expect(o.update(2600, 0)).toBe(true);
    expect([o.x, o.z]).toEqual([3000, 0]);
    expect(seen).toEqual([{ from: { x: 0, z: 0 }, to: { x: 3000, z: 0 }, dx: 3000, dz: 0 }]);
    // hysteresis: small moves back and forth past the old edge don't rebase again
    for (const x of [2100, 1100, 2900, 4900]) o.update(x, 0);
    expect(seen.length).toBe(1);
  });
  it('keeps float32 render positions sub-millimetre 50 km out, where raw ones are not', () => {
    const o = new FloatingOrigin();
    const cam = { x: 50321.7, z: -48766.2 };
    o.update(cam.x, cam.z);
    let rawWorst = 0, rebasedWorst = 0;
    for (let k = 0; k < 200; k++) {
      const p = { x: cam.x + ((k * 37.123456) % 800) - 400, z: cam.z + ((k * 91.654321) % 800) - 400 };
      rawWorst = Math.max(rawWorst, Math.abs(f32(p.x) - p.x), Math.abs(f32(p.z) - p.z));
      const r = o.toRender(p), back = o.toWorld({ x: f32(r.x), z: f32(r.z) });
      rebasedWorst = Math.max(rebasedWorst, Math.abs(back.x - p.x), Math.abs(back.z - p.z));
    }
    expect(rawWorst).toBeGreaterThan(5e-4); // float32 at 50 km: ~2 mm steps
    expect(rebasedWorst).toBeLessThan(1e-4); // within 2 km of the render origin: < 0.1 mm
  });
  it('a subscriber that shifts its groups keeps everything where it was on screen', () => {
    const o = new FloatingOrigin();
    // a "tile group" placed at its corner relative to the render origin, as three.js would hold it
    const corner = { x: 49000, z: 12000 };
    const group = { ...o.toRender(corner) };
    o.on('rebase', (e) => { group.x -= e.dx; group.z -= e.dz; });
    for (const x of [3000, 9000, 20000, 48800]) o.update(x, 11900);
    expect(o.toWorld(group)).toEqual(corner);
    expect(Math.hypot(group.x, group.z)).toBeLessThan(2000);
  });
});
