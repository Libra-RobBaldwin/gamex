// An adversarial review of the shared camera kit: each test here is something a phone user
// (a Pixel in portrait, 412 x 915 CSS px) can do that the kit gets wrong. They fail against the
// kit as it stands; each one's name says what the user would see.
import { describe, expect, it } from 'vitest';
import { NavCore, type NavOptions, type NavTouch } from './camera';
import { wrapAngle, type View } from './viewmath';

const LENS = { width: 412, height: 915 };
const START: View = { x: 0, z: 20, h: 300, az: Math.PI / 4, el: 0.6 };
const make = (o: NavOptions = {}) => new NavCore({ view: { ...START }, ...o }, () => LENS);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// a scripted finger: t is in ms and moves on with each event (as in camera.test.ts)
class Script {
  t = 1000;
  nav: NavCore;
  constructor(nav: NavCore) { this.nav = nav; }
  down(id: number, x: number, y: number, extra: object = {}) { this.nav.down({ id, x, y, t: this.t, ...extra }); }
  move(id: number, x: number, y: number) { this.t += 16; this.nav.move({ id, x, y, t: this.t }); }
  up(id: number, x: number, y: number, why: 'up' | 'cancel' = 'up') { this.t += 16; this.nav.up({ id, x, y, t: this.t }, why); }
  wait(ms: number) { this.t += ms; }
  /** move fingers along straight lines in n steps */
  drag(fingers: [number, number, number, number, number][], n = 10) {
    for (let k = 1; k <= n; k++) {
      this.t += 16;
      for (const [id, x0, y0, x1, y1] of fingers) this.nav.move({ id, x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n, t: this.t });
    }
  }
  /** a frame: the time moves on and the view updates (animations and glides run) */
  frame() { this.t += 16; this.nav.update(0.016, this.t); }
  settle(ms = 1000) { for (let i = 0; i < ms / 16; i++) this.frame(); }
}

describe('fast flicks', () => {
  it('a fast flick leaves the ground 200 px behind the finger when the lift lands past the last move', () => {
    // A quick flick delivers few events; the pointerup carries the finger's last position.
    const nav = make({ fling: false });
    const s = new Script(nav);
    const w = nav.screenToGround(200, 700)!;
    s.down(1, 200, 700); s.move(1, 200, 600); s.move(1, 200, 500); s.up(1, 200, 300);
    const p = nav.groundToScreen(w);
    expect(Math.hypot(p.x - 200, p.y - 300)).toBeLessThan(1);
  });

  it('a quick flick with only one move event does not glide at all', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 200, 750); s.move(1, 200, 450); s.up(1, 200, 450); // 300 px in 16 ms, lifted at once
    const at = { ...nav.view };
    s.settle(2500);
    expect(dist(nav.view, at)).toBeGreaterThan(20);
  });

  it('a flick with no move events between down and up (60 px apart) counts as a tap', () => {
    const taps: NavTouch[] = [];
    const nav = make({ onTap: (p) => taps.push(p) });
    const s = new Script(nav);
    s.down(1, 200, 400); s.up(1, 260, 400);
    expect(taps.length).toBe(0);
  });

  it('touching the map to stop a glide also taps whatever is under the finger', () => {
    const taps: NavTouch[] = [];
    const nav = make({ onTap: (p) => taps.push(p) });
    const s = new Script(nav);
    s.down(1, 200, 700); s.drag([[1, 200, 700, 200, 400]], 6); s.up(1, 200, 400);
    s.settle(200);
    expect(nav.busy).toBe(true); // still gliding
    s.down(2, 200, 400); s.up(2, 200, 400); // a touch to stop it
    expect(nav.busy).toBe(false);
    expect(taps.length).toBe(0);
  });
});

describe('two fingers', () => {
  it('holding one finger and tapping another zooms out under the held finger, so the ground slides away from it', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 200, 500); s.wait(1000); // one finger resting on the map
    s.down(2, 300, 650); s.up(2, 300, 650); // a second finger brushes the screen
    const w = nav.screenToGround(200, 500)!;
    for (let k = 1; k <= 20; k++) { s.move(1, 200, 500 - 10 * k); s.frame(); } // then the held finger pans
    const p = nav.groundToScreen(w);
    expect(Math.hypot(p.x - 200, p.y - 300)).toBeLessThan(1);
  });

  it('after pinching in past the closest zoom, closing the fingers does nothing until they are back where it hit the limit', () => {
    const nav = make({ limits: { hMin: 35, hMax: 900 } });
    const s = new Script(nav);
    s.down(1, 196, 500); s.down(2, 216, 500);
    s.drag([[1, 196, 500, 6, 500], [2, 216, 500, 406, 500]], 10); // 20 px to 400 px apart: well past hMin
    expect(nav.view.h).toBe(35);
    s.drag([[1, 6, 500, 56, 500], [2, 406, 500, 356, 500]], 5); // close them a quarter: 400 -> 300 px
    expect(nav.view.h).toBeGreaterThan(40); // zooming out straight away would give 35 * 400 / 300 = 46.7
  });

  it('after tilting past the steepest tilt, sliding the fingers back down does nothing for a long way', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 146, 800); s.down(2, 266, 800);
    for (let k = 1; k <= 100; k++) { s.move(1, 146, 800 - 5 * k); s.move(2, 266, 800 - 5 * k); } // up 500 px
    expect(nav.view.el).toBe(1.52);
    for (let k = 1; k <= 6; k++) { s.move(1, 146, 300 + 5 * k); s.move(2, 266, 300 + 5 * k); } // back down 30 px
    expect(nav.view.el).toBeLessThan(1.52 - 0.1); // 30 px at 0.006 a px is 0.18
  });
});

describe('the map bounds', () => {
  it('after dragging into the edge of the map, dragging back does not move the map until the finger retraces the overshoot', () => {
    const nav = make({ limits: { hMin: 35, hMax: 900, bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 } } });
    const s = new Script(nav);
    s.down(1, 206, 150);
    s.drag([[1, 206, 150, 206, 880]], 20); // drags the view well past the bound
    const turn = nav.screenToGround(206, 880)!;
    s.drag([[1, 206, 880, 206, 840]], 4); // and back 40 px
    const p = nav.groundToScreen(turn);
    expect(880 - p.y).toBeGreaterThan(30); // the ground under the finger comes back with it
  });

  it('on hilly ground, letting go at the edge of the map makes the picture jump', () => {
    // as the water demo: terrain, and bounds round the tiles that were built
    const hills = (x: number, z: number) => 60 * Math.sin(x / 150) + 60 * Math.cos(z / 130);
    const nav = make({ view: { x: 0, z: 0, h: 300, az: 0, el: 0.35 }, groundAt: hills, limits: { hMin: 35, hMax: 900, bounds: { minX: -300, maxX: 300, minZ: -300, maxZ: 300 } } });
    const s = new Script(nav);
    s.settle(50);
    let worst = 0;
    for (let r = 0; r < 4; r++) {
      s.down(1, 206, 157); s.drag([[1, 206, 157, 206, 757]], 10);
      s.wait(200); s.up(1, 206, 757); // held still, lifted: no glide
      const w = nav.screenToGround(206, 457)!;
      s.settle(50); // at rest the view sits down on the ground
      const p = nav.groundToScreen(w);
      worst = Math.max(worst, Math.hypot(p.x - 206, p.y - 457));
    }
    expect(worst).toBeLessThan(1);
  });
});

describe('buttons and presets', () => {
  it('pressing zoom in twice quickly zooms in less than pressing it twice slowly', () => {
    const nav = make();
    nav.zoomBy(1 / 1.6);
    nav.update(0.05);
    nav.zoomBy(1 / 1.6);
    for (let i = 0; i < 40; i++) nav.update(0.016);
    expect(nav.view.h).toBeCloseTo(300 / 1.6 / 1.6, 3);
  });

  it('after turning the map a full circle with the buttons, a preset view spins a whole turn to face the same way', () => {
    const nav = make();
    for (let i = 0; i < 8; i++) { nav.rotateBy(Math.PI / 4, 100); nav.update(0.2); }
    expect(wrapAngle(nav.view.az - START.az)).toBeCloseTo(0, 9); // facing the way it started
    // a demo's preset (industries, bridges): the usual angle, somewhere else
    nav.animateTo({ x: 50, z: 50, az: START.az }, 500);
    let turned = 0;
    for (let i = 0; i < 40; i++) { nav.update(0.016); turned = Math.max(turned, Math.abs(wrapAngle(nav.view.az - START.az))); }
    expect(turned).toBeLessThan(1e-6);
  });
});
