// Adversarial review of the gesture state machine (NavCore) with scripted fingers. Each test here
// failed when it was written; it describes what the navigation should do. The browser versions of
// the first three are in e2e/touch.review.e2e.mjs.
import { describe, expect, it } from 'vitest';
import { NavCore, type NavOptions, type NavTouch } from './camera';
import type { View } from './viewmath';

const LENS = { width: 412, height: 915 };
const START: View = { x: 0, z: 20, h: 300, az: Math.PI / 4, el: 0.6 };
const make = (o: NavOptions = {}) => new NavCore({ view: { ...START }, ...o }, () => LENS);

class Script {
  t = 1000;
  nav: NavCore;
  constructor(nav: NavCore) { this.nav = nav; }
  down(id: number, x: number, y: number) { this.nav.down({ id, x, y, t: this.t }); }
  move(id: number, x: number, y: number) { this.t += 16; this.nav.move({ id, x, y, t: this.t }); }
  up(id: number, x: number, y: number, why: 'up' | 'cancel' = 'up') { this.t += 16; this.nav.up({ id, x, y, t: this.t }, why); }
  wait(ms: number) { this.t += ms; }
  frame() { this.t += 16; this.nav.update(0.016, this.t); }
  settle(ms = 1000) { for (let i = 0; i < ms / 16; i++) this.frame(); }
}
// where a ground point is on the screen now, in px from (sx, sy)
const off = (nav: NavCore, g: { x: number; y: number; z: number }, sx: number, sy: number) => {
  const s = nav.groundToScreen(g);
  return Math.hypot(s.x - sx, s.y - sy);
};

describe('two fingers land, one lifts at once', () => {
  it('the finger left down pans without the view zooming out under it', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 150, 500); s.down(2, 260, 500);
    s.up(1, 150, 500); // quick, unmoved: but finger 2 is still down, so it isn't a two-finger tap
    const g = nav.groundUnder(260, 500);
    let worst = 0;
    for (let i = 1; i <= 40; i++) {
      s.move(2, 260 - i, 500 + i);
      s.frame();
      worst = Math.max(worst, off(nav, g, 260 - i, 500 + i));
    }
    expect(worst).toBeLessThan(1e-6);
    expect(nav.view.h).toBeCloseTo(START.h, 9);
  });
});

describe('pressing against a limit, then back', () => {
  // (az 0, looking straight down: screen right is world +x, metres per px = h / 915)
  it('panning back off the edge of the bounds moves the map at once', () => {
    const nav = make({ view: { x: 480, z: 0, h: 300, az: 0, el: 1.5 }, limits: { bounds: { minX: -520, maxX: 520, minZ: -520, maxZ: 520 } } });
    const s = new Script(nav);
    s.down(1, 206, 500);
    for (let i = 1; i <= 10; i++) s.move(1, 206 - 15 * i, 500); // pushes the view to x = 520 and on
    expect(nav.view.x).toBe(520);
    const g = nav.groundUnder(56, 500);
    for (let i = 1; i <= 5; i++) s.move(1, 56 + 10 * i, 500); // 50 px back
    expect(off(nav, g, 106, 500)).toBeLessThan(1e-6);
    expect(520 - nav.view.x).toBeCloseTo((50 * 300) / 915, 6);
  });

  it('pinching back out from the closest zoom zooms out at once', () => {
    const nav = make({ view: { ...START, h: 60 }, limits: { hMin: 35, hMax: 900 } });
    const s = new Script(nav);
    s.down(1, 166, 500); s.down(2, 246, 500); // 80 px apart
    for (let i = 1; i <= 10; i++) { s.move(1, 166 - 14 * i, 500); s.move(2, 246 + 14 * i, 500); } // 360 apart: h would be 13
    expect(nav.view.h).toBe(35);
    for (let i = 1; i <= 3; i++) { s.move(1, 26 + 14 * i, 500); s.move(2, 386 - 14 * i, 500); } // back to 276 apart
    // the fingers came together by 360/276: the view should widen by that much from the limit
    expect(nav.view.h).toBeCloseTo((35 * 360) / 276, 6);
  });

  it('tilting back down from the steepest tilt tilts at once', () => {
    const nav = make({ view: { ...START, el: 1.2 }, limits: { elMax: 1.52 } });
    const s = new Script(nav);
    s.down(1, 146, 700); s.down(2, 266, 700);
    for (let i = 1; i <= 12; i++) { s.move(1, 146, 700 - 20 * i); s.move(2, 266, 700 - 20 * i); } // up 240 px: past elMax
    expect(nav.view.el).toBe(1.52);
    for (let i = 1; i <= 5; i++) { s.move(1, 146, 460 + 20 * i); s.move(2, 266, 460 + 20 * i); } // down 100 px
    expect(nav.view.el).toBeCloseTo(1.52 - 100 * nav.o.tiltPerPx, 6);
  });
});

describe('catching a glide', () => {
  it('a finger put down to stop a glide is not a tap', () => {
    const taps: NavTouch[] = [];
    const nav = make({ onTap: (p) => taps.push(p) });
    const s = new Script(nav);
    s.down(1, 200, 700);
    for (let i = 1; i <= 6; i++) s.move(1, 200, 700 - 50 * i);
    s.up(1, 200, 400);
    s.settle(200);
    expect(nav.busy).toBe(true); // still gliding
    s.down(2, 230, 500); s.up(2, 230, 500);
    expect(taps.length).toBe(0);
  });
});

describe('terrain added after start', () => {
  it('setGround makes the view settle onto the ground, as groundAt does (docs/kit.md, Terrain)', () => {
    const hill = () => 80;
    const a = make({ groundAt: hill }), b = make();
    b.setGround(hill);
    for (const nav of [a, b]) {
      const s = new Script(nav);
      s.down(1, 200, 500);
      for (let i = 1; i <= 5; i++) s.move(1, 200 + 10 * i, 500);
      s.wait(200); s.up(1, 250, 500);
      s.settle(300);
    }
    expect(a.view.y).toBeCloseTo(80, 6);
    expect(b.view.y).toBeCloseTo(80, 6);
  });
});
