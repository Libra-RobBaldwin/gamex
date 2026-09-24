// Review checks for the demo pages' move onto the shared camera kit that need no browser. Each one
// failed when it was written (see the review report); it describes what the user sees.
import { describe, expect, it } from 'vitest';
import { NavCore } from './camera';

const LENS = { width: 412, height: 915 };

describe('terrain with bounds (the water demo: setGround plus bounds round the built tiles)', () => {
  it('coming to rest near the edge of the bounds does not make the picture jump', () => {
    // gently rising ground, like a fellside at the edge of the tiles the water demo built
    const heightAt = (x: number, z: number) => 0.2 * (x + z);
    const nav = new NavCore({
      view: { x: 150, z: 150, h: 520, az: Math.PI / 4, el: 0.6 },
      groundAt: heightAt, heightRange: [-400, 400],
      limits: { hMin: 60, hMax: 1400, bounds: { minX: -190, maxX: 190, minZ: -190, maxZ: 190 } },
    }, () => LENS);
    let t = 1000;
    const step = () => { t += 16; nav.update(0.016, t); };
    step();
    // one finger drags the ground a little up and to the left, towards the corner
    const x0 = 206, y0 = 600, x1 = 206 - 15, y1 = 600 - 35;
    nav.down({ id: 1, x: x0, y: y0, t });
    for (let k = 1; k <= 10; k++) { t += 16; nav.move({ id: 1, x: x0 + ((x1 - x0) * k) / 10, y: y0 + ((y1 - y0) * k) / 10, t }); }
    const grabbed = nav.groundUnder(x1, y1);
    const before = nav.groundToScreen(grabbed);
    // the pan itself stayed inside the bounds (nothing was clamped while the finger was down)
    expect(nav.view.x).toBeLessThan(189);
    expect(nav.view.z).toBeLessThan(189);
    t += 300; // held still, so no glide
    nav.up({ id: 1, x: x1, y: y1, t });
    // the view comes to rest: the kit sits the target on the ground, then clamps it to the bounds
    for (let i = 0; i < 30; i++) step();
    const after = nav.groundToScreen(grabbed);
    // the ground that was under the finger should still be under it once the view is at rest
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(1);
  });
});
