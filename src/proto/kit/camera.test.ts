import { describe, expect, it } from 'vitest';
import { NavCore, type NavOptions, type NavTouch } from './camera';
import type { View } from './viewmath';

const LENS = { width: 412, height: 915 };
const START: View = { x: 0, z: 20, h: 300, az: Math.PI / 4, el: 0.6 };
const make = (o: NavOptions = {}) => new NavCore({ view: { ...START }, ...o }, () => LENS);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// a scripted finger: t is in ms and moves on with each event
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
  settle(ms = 1000) { for (let i = 0; i < ms / 16; i++) { this.t += 16; this.nav.update(0.016, this.t); } }
}

describe('one finger', () => {
  it('pans with the ground under the finger, at any tilt, turn and position', () => {
    let worst = 0;
    for (const el of [0.35, 0.8, 1.52]) for (const az of [-2.5, 0, 0.785, 2]) for (const x of [0, 100000]) {
      const nav = make({ view: { x, z: -x, h: 150, az, el }, limits: { hMin: 35, hMax: 900 } });
      const s = new Script(nav);
      const w = nav.screenToGround(100, 700)!;
      s.down(1, 100, 700);
      s.drag([[1, 100, 700, 330, 180]], 12);
      const g = nav.screenToGround(330, 180)!;
      worst = Math.max(worst, dist(g, w));
      s.wait(200); s.up(1, 330, 180); // held still before lifting: no fling
      s.settle(300);
      expect(dist(nav.screenToGround(330, 180)!, w)).toBeLessThan(1e-6);
      expect(nav.view).toMatchObject({ h: 150, az, el });
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('a small wobble is still a tap, and a pointercancel is never one', () => {
    const taps: NavTouch[] = [];
    const nav = make({ onTap: (p) => taps.push(p) });
    const s = new Script(nav);
    s.down(1, 200, 400); s.move(1, 205, 403); s.up(1, 205, 403);
    expect(taps.length).toBe(1);
    expect(nav.view).toMatchObject(START);
    s.wait(1000);
    s.down(2, 200, 400); s.up(2, 200, 400, 'cancel');
    expect(taps.length).toBe(1);
    s.down(3, 200, 400); s.wait(600); s.up(3, 200, 400); // too long for a tap
    expect(taps.length).toBe(1);
  });

  it('double tap zooms in on the spot unless the host handles it', () => {
    const nav = make();
    const s = new Script(nav);
    const w = nav.screenToGround(120, 300)!;
    s.down(1, 120, 300); s.up(1, 120, 300); s.wait(100);
    s.down(2, 122, 302); s.up(2, 122, 302);
    s.settle(600);
    expect(nav.view.h).toBeCloseTo(150, 6);
    const g = nav.screenToGround(122, 302)!, w2 = nav.groundToScreen(w);
    expect(Math.hypot(w2.x - 120, w2.y - 300)).toBeLessThan(3); // the second tap was 2 px away
    expect(g).toBeTruthy();

    const nav2 = make({ onDoubleTap: () => true });
    const s2 = new Script(nav2);
    s2.down(1, 120, 300); s2.up(1, 120, 300); s2.wait(100); s2.down(2, 120, 300); s2.up(2, 120, 300);
    s2.settle(600);
    expect(nav2.view.h).toBe(300);
  });

  it('long press fires once and the lift is not a tap', () => {
    let long = 0, taps = 0;
    const nav = make({ onLongPress: () => long++, onTap: () => taps++ });
    const s = new Script(nav);
    s.down(1, 200, 400);
    nav.checkLongPress(s.t + 300);
    expect(long).toBe(0);
    nav.checkLongPress(s.t + 600);
    nav.checkLongPress(s.t + 700);
    expect(long).toBe(1);
    s.wait(700); s.up(1, 200, 400);
    expect(taps).toBe(0);
  });

  it('flings after a quick flick, and not when held still or turned off', () => {
    for (const fling of [true, false]) {
      const nav = make({ fling });
      const s = new Script(nav);
      s.down(1, 200, 700); s.drag([[1, 200, 700, 200, 400]], 6); s.up(1, 200, 400);
      const at = { ...nav.view };
      // (the game's glide: it decays by e^-4 a second from ~1.8 km/s here, so it takes ~1.7 s)
      s.settle(2500);
      const moved = dist(nav.view, at);
      if (fling) expect(moved).toBeGreaterThan(20); else expect(moved).toBe(0);
      expect(nav.busy).toBe(false); // it comes to rest
    }
  });
});

describe('two fingers', () => {
  it('pinch zooms about the midpoint, far from the origin too', () => {
    for (const x of [0, 100000]) {
      const nav = make({ view: { ...START, x, z: x } });
      const s = new Script(nav);
      const w = nav.screenToGround(206, 500)!;
      s.down(1, 146, 500); s.down(2, 266, 500);
      s.drag([[1, 146, 500, 86, 480], [2, 266, 500, 326, 480]], 10); // spread 2x and drift up 20 px
      expect(nav.view.h).toBeCloseTo(150, 6);
      expect(nav.view.az).toBe(START.az);
      expect(dist(nav.screenToGround(206, 480)!, w)).toBeLessThan(1e-6);
    }
  });

  it('twist turns only past the threshold, then smoothly, about the fingers', () => {
    const nav = make();
    const s = new Script(nav);
    const at = (deg: number): [number, number, number, number] => {
      const a = (deg * Math.PI) / 180;
      return [206 - 80 * Math.cos(a), 450 - 80 * Math.sin(a), 206 + 80 * Math.cos(a), 450 + 80 * Math.sin(a)];
    };
    const w = nav.screenToGround(206, 450)!;
    s.down(1, 126, 450); s.down(2, 286, 450);
    for (let d = 1; d <= 10; d++) { const [ax, ay, bx, by] = at(d); s.move(1, ax, ay); s.move(2, bx, by); }
    expect(nav.view.az).toBe(START.az); // 10° is under the 12° threshold
    let prev = nav.view.az, jump = 0;
    for (let d = 11; d <= 40; d++) {
      const [ax, ay, bx, by] = at(d); s.move(1, ax, ay); s.move(2, bx, by);
      jump = Math.max(jump, Math.abs(nav.view.az - prev)); prev = nav.view.az;
    }
    expect(nav.view.az - START.az).toBeCloseTo((28 * Math.PI) / 180, 6);
    expect(jump).toBeLessThan((1.01 * Math.PI) / 180); // never more than the fingers turned
    expect(dist(nav.screenToGround(206, 450)!, w)).toBeLessThan(1e-6);
  });

  it('sliding up together tilts, with no jump as it takes over, and the ground under the fingers stays put', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 146, 600); s.down(2, 266, 600);
    let prevEl = nav.view.el, jump = 0, engagedAt: { x: number; z: number } | null = null, screen = { x: 0, y: 0 };
    for (let k = 1; k <= 20; k++) {
      const y = 600 - k * 5;
      s.move(1, 146, y); s.move(2, 266, y);
      jump = Math.max(jump, Math.abs(nav.view.el - prevEl)); prevEl = nav.view.el;
      if (!engagedAt && nav.view.el !== START.el) { engagedAt = nav.screenToGround(206, y + 5)!; screen = { x: 206, y: y + 5 }; }
    }
    expect(nav.view.el).toBeGreaterThan(START.el + 0.4);
    expect(jump).toBeLessThan(5 * 0.006 + 1e-9); // one step's worth, never a lurch
    expect(nav.view.h).toBe(300);
    expect(dist(nav.screenToGround(screen.x, screen.y)!, engagedAt!)).toBeLessThan(1e-6);
    // and it stops at the limit
    for (let k = 1; k <= 40; k++) { s.move(1, 146, 500 - k * 10); s.move(2, 266, 500 - k * 10); }
    expect(nav.view.el).toBe(1.52);
  });

  it('a third finger, and lifting the first of three, do not make the view jump', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 150, 500); s.down(2, 260, 500);
    s.drag([[1, 150, 500, 120, 500], [2, 260, 500, 290, 500]], 5);
    s.down(3, 300, 800);
    const before = { ...nav.view };
    s.move(3, 320, 700); // the spare finger does nothing
    expect(nav.view).toEqual(before);
    s.up(1, 120, 500); // the pair is now 2 and 3
    expect(nav.view).toEqual(before);
    s.move(2, 292, 500);
    expect(Math.abs(nav.view.az - before.az)).toBeLessThan(0.01);
    expect(Math.abs(nav.view.h / before.h - 1)).toBeLessThan(0.05);
  });

  it('fingers lifting and landing again in another order do not flip the rotation', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 150, 500); s.down(2, 260, 500);
    s.up(1, 150, 500); s.down(1, 150, 500); // now the map order is 2, 1
    const before = { ...nav.view };
    s.move(2, 262, 500); s.move(1, 148, 500);
    expect(Math.abs(nav.view.az - before.az)).toBeLessThan(1e-9);
  });

  it('lifting one of two carries on panning with the other without a jump', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 150, 500); s.down(2, 260, 500);
    s.drag([[1, 150, 500, 140, 480], [2, 260, 500, 270, 480]], 4);
    s.up(1, 140, 480);
    const w = nav.screenToGround(270, 480)!, before = { ...nav.view };
    expect(nav.view).toEqual(before);
    s.drag([[2, 270, 480, 300, 300]], 6);
    expect(dist(nav.screenToGround(300, 300)!, w)).toBeLessThan(1e-6);
  });

  it('a quick two-finger tap zooms out', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 150, 500); s.down(2, 260, 500); s.up(1, 150, 500); s.up(2, 260, 500);
    s.settle(600);
    expect(nav.view.h).toBeCloseTo(600, 6);
  });

  it('a pointer the browser took away (cancel) does not stay stuck down', () => {
    const nav = make();
    const s = new Script(nav);
    s.down(1, 150, 500); s.up(1, 150, 500, 'cancel');
    expect(nav.pointers).toBe(0);
    const w = nav.screenToGround(200, 400)!;
    s.down(2, 200, 400); s.drag([[2, 200, 400, 250, 300]]);
    expect(nav.gesture).toBe('pan');
    expect(dist(nav.screenToGround(250, 300)!, w)).toBeLessThan(1e-6);
  });
});

describe('the host can claim a gesture', () => {
  it('claimed at pointer down: moves go to the host and the view stays put', () => {
    const moves: NavTouch[] = [], ends: string[] = [];
    const nav = make({ onPointerDown: (p) => p.sx < 100, onClaimMove: (p) => moves.push(p), onClaimEnd: (_p, why) => ends.push(why) });
    const s = new Script(nav);
    s.down(1, 50, 400); s.drag([[1, 50, 400, 90, 300]], 5); s.up(1, 90, 300);
    expect(moves.length).toBe(5);
    expect(ends).toEqual(['up']);
    expect(nav.view).toMatchObject(START);
    expect(dist(moves[4].ground, nav.screenToGround(90, 300)!)).toBeLessThan(1e-9);
  });

  it('claimed at drag start (drawing), handed back when a second finger lands', () => {
    const moves: NavTouch[] = [], ends: string[] = [];
    let starts = 0;
    const nav = make({ onDragStart: (p) => { starts++; expect(p.start.sx).toBe(200); return true; }, onClaimMove: (p) => moves.push(p), onClaimEnd: (_p, why) => ends.push(why) });
    const s = new Script(nav);
    s.down(1, 200, 400); s.move(1, 203, 400); // inside the slop: nothing yet
    expect(starts).toBe(0);
    s.drag([[1, 203, 400, 260, 400]], 4);
    expect(starts).toBe(1);
    expect(moves.length).toBe(4); // including the move that started it
    expect(nav.view).toMatchObject(START);
    s.down(2, 100, 600);
    expect(ends).toEqual(['second-finger']);
    s.drag([[1, 260, 400, 300, 380], [2, 100, 600, 60, 620]], 5);
    expect(nav.view.h).toBeLessThan(300); // the pinch zooms
    expect(moves.length).toBe(4);
  });
});

describe('mouse, wheel and keys', () => {
  it('wheel zooms at the cursor, 1.12 per notch', () => {
    const nav = make();
    const w = nav.screenToGround(80, 200)!;
    nav.wheel(80, 200, 100); nav.wheel(80, 200, 100); nav.wheel(80, 200, -100);
    expect(nav.view.h).toBeCloseTo(300 * 1.12, 6);
    expect(dist(nav.screenToGround(80, 200)!, w)).toBeLessThan(1e-6);
  });

  it('right-drag turns and tilts about where it started, and is never a tap', () => {
    let taps = 0;
    const nav = make({ onTap: () => taps++ });
    const s = new Script(nav);
    const w = nav.screenToGround(200, 500)!;
    s.down(1, 200, 500, { type: 'mouse', button: 2 }); s.drag([[1, 200, 500, 260, 460]]); s.up(1, 260, 460);
    expect(nav.view.az).toBeCloseTo(START.az - 60 * 0.008, 9);
    expect(nav.view.el).toBeCloseTo(START.el + 40 * 0.006, 9);
    expect(dist(nav.screenToGround(200, 500)!, w)).toBeLessThan(1e-6);
    s.down(2, 200, 500, { type: 'mouse', button: 2 }); s.up(2, 200, 500);
    expect(taps).toBe(0);
  });

  it('keys pan along the screen, turn and zoom', () => {
    const nav = make();
    const w = nav.screenToGround(206, 457.5)!;
    nav.key('right', true);
    for (let i = 0; i < 10; i++) nav.update(0.1);
    nav.key('right', false);
    const p = nav.groundToScreen(w);
    expect(p.x).toBeCloseTo(206 - 0.9 * 915, 3); // the ground slid left: the view moved right
    expect(p.y).toBeCloseTo(457.5, 6);
    nav.key('rotr', true); nav.update(0.5); nav.key('rotr', false);
    expect(nav.view.az).toBeCloseTo(START.az + 0.75, 9);
    nav.key('in', true); nav.update(0.5); nav.key('in', false);
    expect(nav.view.h).toBeCloseTo(300 * Math.exp(-0.75), 6);
  });
});

describe('limits and animation', () => {
  it('pinching and panning stop at the limits', () => {
    const nav = make({ limits: { hMin: 35, hMax: 900, bounds: { minX: -520, maxX: 520, minZ: -520, maxZ: 520 } } });
    const s = new Script(nav);
    s.down(1, 196, 500); s.down(2, 216, 500);
    s.drag([[1, 196, 500, 6, 500], [2, 216, 500, 406, 500]], 10); // 20x
    expect(nav.view.h).toBe(35);
    s.up(1, 6, 500); s.up(2, 406, 500);
    s.wait(1000);
    for (let i = 0; i < 20; i++) { s.down(3, 206, 100); s.drag([[3, 206, 100, 206, 900]], 4); s.wait(200); s.up(3, 206, 900); }
    s.settle(100);
    expect(Math.abs(nav.view.z)).toBeLessThanOrEqual(520);
    expect(Math.abs(nav.view.x)).toBeLessThanOrEqual(520);
  });

  it('animateTo arrives exactly, on time, and a touch interrupts it', async () => {
    const nav = make();
    const to = { x: 120, z: -80, h: 90, az: 2, el: 1.1 };
    const done = nav.animateTo(to, 500);
    nav.update(0.25);
    expect(nav.view.x).toBeGreaterThan(0);
    expect(nav.view.x).toBeLessThan(120);
    nav.update(0.25);
    expect(nav.view).toEqual(to);
    expect(await done).toBe(true);
    const again = nav.animateTo({ x: 0 }, 500);
    nav.update(0.1);
    nav.down({ id: 9, x: 10, y: 10, t: 0 });
    expect(await again).toBe(false);
    nav.update(0.5);
    expect(nav.view.x).toBeGreaterThan(0); // it stopped where it was
  });

  it('reset north goes the short way round and back to the home tilt, about the centre', async () => {
    // (home defaults to the starting view, so name it: the game's usual angle and tilt)
    const nav = make({ view: { ...START, az: START.az + 2 * Math.PI - 0.3, el: 1.3 }, home: { az: START.az, el: START.el } });
    const c = nav.screenToGround(206, 457.5)!;
    const p = nav.resetNorth(400);
    nav.update(0.2); nav.update(0.2);
    expect(await p).toBe(true);
    expect(nav.view.az).toBeCloseTo(START.az + 2 * Math.PI, 9);
    expect(nav.view.el).toBe(START.el);
    expect(dist(nav.screenToGround(206, 457.5)!, c)).toBeLessThan(1e-6);
  });
});
