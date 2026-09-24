// One camera and one set of gestures for the game and every demo page. See docs/kit.md.
//
//   const nav = new NavRig(camera, canvas, { view: { x: 0, z: 0, h: 120, az: Math.PI / 4, el: 0.6 } });
//   function frame() { nav.update(dt); renderer.render(scene, camera); }
//
// Touch: one finger pans (the ground under the finger stays under it), two fingers pinch-zoom
// about their midpoint, twist to rotate (after a deliberate twist), slide up/down together to
// tilt; double tap zooms in, a quick two-finger tap zooms out. Mouse: drag pans, right/middle
// drag (or ctrl/alt-drag) turns and tilts, the wheel zooms at the cursor. Keys: arrows/WASD pan,
// Q/E rotate, +/- zoom. The host can claim a pointer (build tools, dragging handles) so the camera
// leaves it alone, and hears about taps, double taps and long presses.
import * as THREE from 'three';
import {
  DEFAULT_LIMITS, ORTHO_DISTANCE, basis, clampView, easeOutCubic, eyeDistance, groundToScreen, keepUnder, lerpView,
  nearestAz, screenRay, screenToGround, shadowFrame, wrapAngle,
  type GroundPoint, type HeightAt, type Lens, type Limits, type ShadowOpts, type V3, type View,
} from './viewmath';

export type { View, Limits, Lens, V3, GroundPoint, HeightAt } from './viewmath';

/** Why a claimed pointer stopped: lifted, cancelled by the browser, or a second finger landed
 * (the camera takes over for the pinch). */
export type ClaimEnd = 'up' | 'cancel' | 'second-finger';
export type Gesture = 'idle' | 'maybe' | 'pan' | 'orbit' | 'claim' | 'two';

/** A pointer as the host sees it: screen position relative to the element, in CSS pixels. */
export interface NavTouch {
  id: number;
  sx: number;
  sy: number;
  t: number;
  type: string;
  button: number;
  /** the ground under the pointer (terrain-aware), worked out when first asked for */
  readonly ground: V3;
  /** where this pointer went down */
  start: { sx: number; sy: number; t: number; readonly ground: V3 };
  event?: Event;
}

export interface NavHooks {
  /** First finger down. Return true to take the pointer (the camera won't pan with it). */
  onPointerDown?(p: NavTouch): boolean | void;
  /** The finger has moved past the tap slop. Return true to take it (e.g. to draw a road). */
  onDragStart?(p: NavTouch): boolean | void;
  /** A claimed pointer moved (also called straight after a successful onDragStart). */
  onClaimMove?(p: NavTouch): void;
  onClaimEnd?(p: NavTouch, why: ClaimEnd): void;
  onTap?(p: NavTouch): void;
  /** Return true to say you've handled it; otherwise the camera zooms in on the spot. */
  onDoubleTap?(p: NavTouch): boolean | void;
  onLongPress?(p: NavTouch): void;
  /** Any pointer down, wheel or key: the user has taken the controls. */
  onInteract?(): void;
}

export interface NavOptions extends NavHooks {
  view?: Partial<View>;
  /** where "reset north" returns az and el to (default: the starting view) */
  home?: { az?: number; el?: number };
  limits?: Partial<Limits>;
  /** height of the ground at a world point, for terrain; flat y = 0 without it */
  groundAt?: HeightAt;
  heightRange?: [number, number];
  /** carry on gliding after a flick (default true, as the game always has) */
  fling?: boolean;
  rotate?: boolean;
  tilt?: boolean;
  /** a twist must pass this angle before the view turns, so pinches don't wobble (default 12°) */
  rotateThreshold?: number;
  /** radians of tilt per pixel of two-finger vertical drag; positive: fingers up, steeper (default 0.006) */
  tiltPerPx?: number;
  tapSlop?: number;
  tapMs?: number;
  doubleTapMs?: number;
  doubleTapSlop?: number;
  longPressMs?: number;
  /** zoom factor for a double tap (default 0.5; 0 to turn off) */
  doubleTapZoom?: number;
  /** zoom factor for a quick two-finger tap (default 2; 0 to turn off) */
  twoFingerTapZoom?: number;
  /** zoom factor per 100 px of wheel (default 1.12) */
  wheelZoom?: number;
  /** how long preset moves take, ms (default 450) */
  animMs?: number;
}

interface Ptr { id: number; x: number; y: number; t: number; x0: number; y0: number; t0: number; type: string; button: number }
export interface PointerIn { id: number; x: number; y: number; t: number; type?: string; button?: number; orbit?: boolean }

type Anim =
  | { kind: 'to'; from: View; to: View; ms: number; t: number; done: (ok: boolean) => void }
  | { kind: 'about'; from: View; to: View; w: V3; sx: number; sy: number; ms: number; t: number; done: (ok: boolean) => void };

const DEG = Math.PI / 180;
const same = (a: View, b: View) => a.x === b.x && a.z === b.z && a.h === b.h && a.az === b.az && a.el === b.el;

/**
 * The gesture state machine and view, with no DOM and no three.js: feed it pointer events and
 * it moves `view`. NavRig wires it to an element and a camera.
 */
export class NavCore {
  /** the live view; the host may read it any time, and write it (the next update clamps it) */
  readonly view: View;
  limits: Limits;
  o: Required<Omit<NavOptions, keyof NavHooks | 'view' | 'home' | 'limits' | 'groundAt' | 'heightRange'>>;
  hooks: NavHooks;
  home: { az: number; el: number };
  ground: { heightAt?: HeightAt; range?: [number, number] } | undefined;

  private ptrs = new Map<number, Ptr>();
  private mode: Gesture = 'idle';
  private primary = -1;
  private anchor: V3 = { x: 0, y: 0, z: 0 };
  private vel: { x: number; z: number; t: number }[] = [];
  private flingV = { x: 0, z: 0 };
  private orb: { x0: number; y0: number; az0: number; el0: number; w: V3 } | null = null;
  private two: {
    a: number; b: number; d0: number; a0: number; m0: { x: number; y: number }; anchor: V3; h0: number; az0: number;
    rotating: boolean; rotOff: number; tilting: boolean; tiltDy: number; tiltEl: number; tiltAt: { x: number; y: number };
    moved: boolean; t: number;
  } | null = null;
  private anim: Anim | null = null;
  private keys = new Set<string>();
  private lastTap = { x: 0, y: 0, t: -Infinity };
  private longFired = false;
  private listeners = new Set<(v: View) => void>();
  private shown: View | null = null;
  private lensFn?: () => Lens;

  constructor(o: NavOptions = {}, lens?: () => Lens) {
    this.lensFn = lens;
    this.limits = { ...DEFAULT_LIMITS, ...o.limits };
    this.view = clampView({ x: 0, z: 0, h: 300, az: Math.PI / 4, el: 0.6, ...o.view }, this.limits);
    this.home = { az: o.home?.az ?? this.view.az, el: o.home?.el ?? this.view.el };
    this.ground = o.groundAt ? { heightAt: o.groundAt, range: o.heightRange } : undefined;
    this.hooks = o;
    this.o = {
      fling: o.fling ?? true, rotate: o.rotate ?? true, tilt: o.tilt ?? true,
      rotateThreshold: o.rotateThreshold ?? 12 * DEG, tiltPerPx: o.tiltPerPx ?? 0.006,
      tapSlop: o.tapSlop ?? 8, tapMs: o.tapMs ?? 400, doubleTapMs: o.doubleTapMs ?? 320, doubleTapSlop: o.doubleTapSlop ?? 30,
      longPressMs: o.longPressMs ?? 550, doubleTapZoom: o.doubleTapZoom ?? 0.5, twoFingerTapZoom: o.twoFingerTapZoom ?? 2,
      wheelZoom: o.wheelZoom ?? 1.12, animMs: o.animMs ?? 450,
    };
  }

  /** the screen, in CSS pixels, and the kind of camera */
  lens(): Lens { return this.lensFn ? this.lensFn() : { width: 1, height: 1 }; }
  /** put the camera where the view says (NavRig positions the three.js camera) */
  apply(): void { /* no camera here */ }

  get gesture(): Gesture { return this.mode; }
  /** a finger is down, or the view is still moving on its own */
  get busy() { return this.ptrs.size > 0 || !!this.anim || !!(this.flingV.x || this.flingV.z) || this.keys.size > 0; }
  get pointers() { return this.ptrs.size; }

  // ---------------- screen <-> world ----------------
  screenToGround(sx: number, sy: number): V3 | null { return screenToGround(this.view, this.lens(), sx, sy, this.ground); }
  /** like screenToGround but never null: a ray above the horizon lands just below it instead */
  groundUnder(sx: number, sy: number): V3 {
    const g = this.screenToGround(sx, sy);
    if (g) return g;
    const r = screenRay(this.view, this.lens(), sx, sy);
    const dy = Math.min(r.dir.y, -0.02), t = r.origin.y / -dy;
    return { x: r.origin.x + r.dir.x * t, y: 0, z: r.origin.z + r.dir.z * t };
  }
  groundToScreen(p: GroundPoint) { return groundToScreen(this.view, this.lens(), p); }
  /** which way north (-z) points on the screen, radians clockwise from pointing right */
  northAngle() {
    const a = this.groundToScreen({ x: this.view.x, z: this.view.z }), b = this.groundToScreen({ x: this.view.x, z: this.view.z - 50 });
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
  setGround(heightAt?: HeightAt, range?: [number, number]) { this.ground = heightAt ? { heightAt, range } : undefined; }

  // ---------------- view changes ----------------
  /** jump straight to a view (clamped) */
  setView(v: Partial<View>) { this.put({ ...this.view, ...v }); }
  private put(v: View) {
    Object.assign(this.view, clampView(v, this.limits));
    this.apply();
  }
  onChange(fn: (v: View) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** stop any animation and glide */
  stop() {
    if (this.anim) { const a = this.anim; this.anim = null; a.done(false); }
    this.flingV = { x: 0, z: 0 };
  }

  /** move to a view over `ms`; resolves true when it arrives, false if interrupted */
  animateTo(to: Partial<View>, ms = this.o.animMs): Promise<boolean> {
    this.stop();
    const target = clampView({ ...this.view, ...to }, this.limits);
    return new Promise((done) => { this.anim = { kind: 'to', from: { ...this.view }, to: target, ms: Math.max(1, ms), t: 0, done }; });
  }
  /** zoom by a factor keeping the ground under (sx, sy) where it is, all the way */
  zoomAt(sx: number, sy: number, factor: number, ms = 400): Promise<boolean> {
    return this.about({ h: this.view.h * factor }, sx, sy, ms);
  }
  /** zoom about the middle of the screen */
  zoomBy(factor: number, ms = 300) { const L = this.lens(); return this.zoomAt(L.width / 2, L.height / 2, factor, ms); }
  /** turn about the middle of the screen */
  rotateBy(d: number, ms = this.o.animMs) { const L = this.lens(); return this.about({ az: this.view.az + d }, L.width / 2, L.height / 2, ms); }
  /** tilt to an elevation about the middle of the screen */
  tiltTo(el: number, ms = this.o.animMs) { const L = this.lens(); return this.about({ el }, L.width / 2, L.height / 2, ms); }
  /** face north (the home azimuth) the short way round and return to the home tilt */
  resetNorth(ms = this.o.animMs) {
    const L = this.lens();
    return this.about({ az: nearestAz(this.view.az, this.home.az), el: this.home.el }, L.width / 2, L.height / 2, ms);
  }
  private about(to: Partial<View>, sx: number, sy: number, ms: number): Promise<boolean> {
    this.stop();
    const target = clampView({ ...this.view, ...to }, this.limits);
    const w = this.groundUnder(sx, sy);
    return new Promise((done) => { this.anim = { kind: 'about', from: { ...this.view }, to: target, w, sx, sy, ms: Math.max(1, ms), t: 0, done }; });
  }

  // ---------------- pointers ----------------
  private touch(p: Ptr, event?: Event): NavTouch {
    const sx = p.x, sy = p.y, x0 = p.x0, y0 = p.y0;
    let g: V3 | undefined, g0: V3 | undefined;
    const self = this;
    return {
      id: p.id, sx, sy, t: p.t, type: p.type, button: p.button, event,
      get ground() { return (g ??= self.groundUnder(sx, sy)); },
      start: { sx: x0, sy: y0, t: p.t0, get ground() { return (g0 ??= self.groundUnder(x0, y0)); } },
    };
  }
  private interact() { this.stop(); this.hooks.onInteract?.(); }

  down(e: PointerIn, event?: Event) {
    this.interact();
    const p: Ptr = { id: e.id, x: e.x, y: e.y, t: e.t, x0: e.x, y0: e.y, t0: e.t, type: e.type ?? 'touch', button: e.button ?? 0 };
    this.ptrs.delete(e.id);
    this.ptrs.set(e.id, p);
    const n = this.ptrs.size;
    if (n === 1) {
      this.primary = e.id;
      this.longFired = false;
      if (p.type === 'mouse' && (p.button === 1 || p.button === 2 || e.orbit)) {
        this.mode = 'orbit';
        this.orb = { x0: p.x, y0: p.y, az0: this.view.az, el0: this.view.el, w: this.groundUnder(p.x, p.y) };
        return;
      }
      if (this.hooks.onPointerDown?.(this.touch(p, event)) === true) { this.mode = 'claim'; return; }
      this.mode = 'maybe';
      this.anchor = this.groundUnder(p.x, p.y);
      this.vel = [];
    } else if (n === 2 && this.mode !== 'orbit') {
      if (this.mode === 'claim') {
        const q = this.ptrs.get(this.primary);
        if (q) this.hooks.onClaimEnd?.(this.touch(q, event), 'second-finger');
      }
      const [a, b] = [...this.ptrs.keys()];
      this.startTwo(a, b, e.t);
    }
    // a third finger is ignored: the pair that started the gesture carries on
  }

  private startTwo(a: number, b: number, t: number) {
    const A = this.ptrs.get(a)!, B = this.ptrs.get(b)!;
    const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    this.mode = 'two';
    this.two = {
      a, b, d0: Math.hypot(A.x - B.x, A.y - B.y) || 1, a0: Math.atan2(B.y - A.y, B.x - A.x), m0: m,
      anchor: this.groundUnder(m.x, m.y), h0: this.view.h, az0: this.view.az,
      rotating: false, rotOff: 0, tilting: false, tiltDy: 0, tiltEl: this.view.el, tiltAt: m, moved: false, t,
    };
  }

  move(e: PointerIn, event?: Event) {
    const p = this.ptrs.get(e.id);
    if (!p) return;
    p.x = e.x; p.y = e.y; p.t = e.t;
    const L = this.lens();
    if (this.mode === 'claim') {
      if (e.id === this.primary) this.hooks.onClaimMove?.(this.touch(p, event));
      return;
    }
    if (this.mode === 'orbit') {
      const o = this.orb!;
      const v = { ...this.view };
      if (this.o.rotate) v.az = o.az0 - (p.x - o.x0) * 0.008;
      if (this.o.tilt) v.el = o.el0 - (p.y - o.y0) * this.o.tiltPerPx;
      this.put(keepUnder(clampView(v, this.limits), L, o.w, o.x0, o.y0));
      return;
    }
    if (this.mode === 'two') {
      if (e.id === this.two!.a || e.id === this.two!.b) this.moveTwo(L);
      return;
    }
    if (e.id !== this.primary) return;
    if (this.mode === 'maybe') {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) <= this.o.tapSlop) return;
      const t = this.touch(p, event);
      if (this.hooks.onDragStart?.(t) === true) { this.mode = 'claim'; this.hooks.onClaimMove?.(t); return; }
      this.mode = 'pan'; // and the pan starts with this move
    }
    if (this.mode === 'pan') {
      this.put(keepUnder(this.view, L, this.anchor, p.x, p.y));
      this.vel.push({ x: this.view.x, z: this.view.z, t: p.t });
      if (this.vel.length > 6) this.vel.shift();
    }
  }

  private moveTwo(L: Lens) {
    const g = this.two!, A = this.ptrs.get(g.a)!, B = this.ptrs.get(g.b)!;
    const d = Math.hypot(A.x - B.x, A.y - B.y);
    const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const rot = wrapAngle(Math.atan2(B.y - A.y, B.x - A.x) - g.a0);
    const scale = d / g.d0, dy = m.y - g.m0.y;
    if (Math.abs(scale - 1) > 0.04 || Math.abs(rot) > 0.05 || Math.hypot(m.x - g.m0.x, dy) > 8) g.moved = true;
    // two fingers sliding up or down together (not pinching or turning) tilts
    if (this.o.tilt && !g.rotating && !g.tilting && Math.abs(dy) > 14 && Math.abs(scale - 1) < 0.08 && Math.abs(rot) < 0.1 && Math.abs(m.x - g.m0.x) < Math.abs(dy) * 0.6) {
      // carry on from exactly where the view is, so nothing jumps as the tilt takes over
      g.tilting = true; g.tiltDy = dy; g.tiltEl = this.view.el; g.tiltAt = m;
    }
    if (g.tilting) {
      const el = g.tiltEl - (dy - g.tiltDy) * this.o.tiltPerPx;
      this.put(keepUnder(clampView({ ...this.view, el }, this.limits), L, g.anchor, g.tiltAt.x, g.tiltAt.y));
      return;
    }
    // rotation only starts after a deliberate twist, then carries on from there
    if (this.o.rotate && !g.rotating && Math.abs(rot) > this.o.rotateThreshold) { g.rotating = true; g.rotOff = Math.sign(rot) * this.o.rotateThreshold; }
    const v = clampView({ ...this.view, h: g.h0 / scale, az: g.az0 + (g.rotating ? rot - g.rotOff : 0) }, this.limits);
    this.put(keepUnder(v, L, g.anchor, m.x, m.y));
  }

  up(e: PointerIn, why: 'up' | 'cancel' = 'up', event?: Event) {
    const p = this.ptrs.get(e.id);
    if (!p) return;
    p.x = e.x; p.y = e.y; p.t = e.t;
    this.ptrs.delete(e.id);
    if (this.mode === 'two') {
      const g = this.two!;
      if (e.id !== g.a && e.id !== g.b) return; // a spare finger lifted
      if (this.ptrs.size >= 2) { const [a, b] = [...this.ptrs.keys()]; this.startTwo(a, b, e.t); this.two!.moved = true; return; }
      if (this.ptrs.size === 1) {
        // a quick two-finger tap zooms out
        if (why === 'up' && !g.moved && e.t - g.t < 300 && this.o.twoFingerTapZoom) this.zoomAt(g.m0.x, g.m0.y, this.o.twoFingerTapZoom);
        // carry on panning with the finger that's left, without a jump
        const [q] = [...this.ptrs.values()];
        this.primary = q.id; this.mode = 'pan'; this.anchor = this.groundUnder(q.x, q.y); this.vel = [];
        return;
      }
      this.mode = 'idle';
      return;
    }
    if (this.ptrs.size) {
      // only possible after a pair has become one finger and others land and lift
      if (e.id === this.primary) { const [q] = [...this.ptrs.values()]; this.primary = q.id; this.anchor = this.groundUnder(q.x, q.y); this.vel = []; }
      return;
    }
    const mode = this.mode;
    this.mode = 'idle';
    this.orb = null;
    if (mode === 'claim') { this.hooks.onClaimEnd?.(this.touch(p, event), why); return; }
    if (mode === 'pan' && why === 'up' && this.o.fling && this.vel.length >= 2) {
      const a = this.vel[0], b = this.vel[this.vel.length - 1], dt = (b.t - a.t) / 1000;
      if (dt > 0 && e.t - b.t < 80) {
        let vx = (b.x - a.x) / dt, vz = (b.z - a.z) / dt;
        // gentle: never faster than a few screen heights a second
        const cap = (4 * this.view.h) / Math.sin(this.view.el), s = Math.hypot(vx, vz);
        if (s > cap) { vx *= cap / s; vz *= cap / s; }
        this.flingV = { x: vx, z: vz };
      }
    }
    if (mode === 'maybe' && why === 'up' && !this.longFired && e.t - p.t0 < this.o.tapMs) this.tap(p, event);
  }

  private tap(p: Ptr, event?: Event) {
    const t = this.touch(p, event);
    this.hooks.onTap?.(t);
    if (p.t - this.lastTap.t < this.o.doubleTapMs && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < this.o.doubleTapSlop) {
      this.lastTap.t = -Infinity;
      if (this.hooks.onDoubleTap?.(t) !== true && this.o.doubleTapZoom) this.zoomAt(p.x, p.y, this.o.doubleTapZoom);
    } else this.lastTap = { x: p.x, y: p.y, t: p.t };
  }

  /** fire a long press if a still finger has been down long enough (update() calls this) */
  checkLongPress(now: number) {
    if (this.mode !== 'maybe' || this.longFired || !this.hooks.onLongPress) return;
    const p = this.ptrs.get(this.primary);
    if (p && now - p.t0 >= this.o.longPressMs) { this.longFired = true; this.hooks.onLongPress(this.touch(p)); }
  }

  /** the mouse wheel (or a trackpad pinch), in pixels: positive zooms out */
  wheel(sx: number, sy: number, deltaPx: number) {
    this.interact();
    const f = Math.min(2, Math.max(0.5, Math.pow(this.o.wheelZoom, deltaPx / 100)));
    const w = this.groundUnder(sx, sy);
    this.put(keepUnder(clampView({ ...this.view, h: this.view.h * f }, this.limits), this.lens(), w, sx, sy));
  }

  /** held keys: 'left' 'right' 'up' 'down' 'rotl' 'rotr' 'in' 'out' */
  key(k: string, down: boolean) {
    if (down) { if (!this.keys.has(k)) this.interact(); this.keys.add(k); } else this.keys.delete(k);
  }
  clearKeys() { this.keys.clear(); }

  // ---------------- per frame ----------------
  /** Advance animations, glides and held keys by dt seconds, clamp, and place the camera.
   * Returns true if the view changed since the last call. */
  update(dt: number, now = typeof performance !== 'undefined' ? performance.now() : Date.now()): boolean {
    this.checkLongPress(now);
    const L = this.lens();
    if (this.keys.size) {
      const k = (n: string) => (this.keys.has(n) ? 1 : 0);
      const mx = k('right') - k('left'), my = k('down') - k('up'), r = k('rotr') - k('rotl'), z = k('out') - k('in');
      const cx = L.width / 2, cy = L.height / 2, w = this.groundUnder(cx, cy);
      const step = 0.9 * L.height * dt;
      let v: View = { ...this.view, h: this.view.h * Math.exp(z * 1.5 * dt), az: this.view.az + (this.o.rotate ? r * 1.5 * dt : 0) };
      v = keepUnder(clampView(v, this.limits), L, w, cx - mx * step, cy - my * step);
      Object.assign(this.view, v);
    }
    const a = this.anim;
    if (a) {
      a.t += dt * 1000;
      const k = easeOutCubic(a.t / a.ms);
      const v = lerpView(a.from, a.to, k);
      Object.assign(this.view, a.kind === 'about' ? keepUnder(v, L, a.w, a.sx, a.sy) : v);
      if (a.t >= a.ms) { this.anim = null; a.done(true); }
    }
    if (this.mode !== 'pan' && this.mode !== 'two' && (this.flingV.x || this.flingV.z)) {
      this.view.x += this.flingV.x * dt;
      this.view.z += this.flingV.z * dt;
      const decay = Math.exp(-dt * 4);
      this.flingV.x *= decay; this.flingV.z *= decay;
      // stop once it's creeping slower than a few pixels a second
      if (Math.hypot(this.flingV.x, this.flingV.z) < (6 * this.view.h) / L.height) this.flingV = { x: 0, z: 0 };
    }
    Object.assign(this.view, clampView(this.view, this.limits));
    this.apply();
    const changed = !this.shown || !same(this.shown, this.view);
    if (changed) {
      this.shown = { ...this.view };
      for (const f of this.listeners) f(this.view);
    }
    return changed;
  }
}

// ---------------- the DOM and three.js side ----------------
export interface NavRigOptions extends NavOptions {
  /** listen for keys on this target (default window); false for none */
  keyboard?: boolean | Window | HTMLElement;
  wheel?: boolean;
  /** orthographic cameras: how far back the camera stands (default 1200; affects clipping only) */
  distance?: number;
  /** floating origin: three.js coordinates are world coordinates minus this */
  origin?: { x: number; z: number };
  /** keep a directional light's shadow on the view */
  shadow?: SunFollow;
}

const KEYS: Record<string, string> = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  KeyQ: 'rotl', KeyE: 'rotr', Equal: 'in', NumpadAdd: 'in', Minus: 'out', NumpadSubtract: 'out', PageUp: 'in', PageDown: 'out',
};

/**
 * The shared camera rig: a NavCore bound to a DOM element's pointer, wheel and key events,
 * driving an orthographic (or perspective) three.js camera.
 */
export class NavRig extends NavCore {
  readonly camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  readonly element: HTMLElement;
  origin: { x: number; z: number };
  shadow?: SunFollow;
  private distance: number;
  private rect = { left: 0, top: 0 };
  private off: (() => void)[] = [];

  constructor(camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, element: HTMLElement, o: NavRigOptions = {}) {
    super(o);
    this.camera = camera;
    this.element = element;
    this.origin = o.origin ?? { x: 0, z: 0 };
    this.shadow = o.shadow;
    this.distance = o.distance ?? ORTHO_DISTANCE;
    if (!element.style.touchAction) element.style.touchAction = 'none';
    const on = (t: EventTarget, type: string, f: (e: never) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(type, f as EventListener, opt);
      this.off.push(() => t.removeEventListener(type, f as EventListener, opt));
    };
    const at = (e: PointerEvent | WheelEvent) => ({ x: e.clientX - this.rect.left, y: e.clientY - this.rect.top });
    const pin = (e: PointerEvent) => ({ id: e.pointerId, ...at(e), t: e.timeStamp || performance.now(), type: e.pointerType, button: e.button, orbit: e.ctrlKey || e.altKey || e.metaKey });
    on(element, 'pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && this.pointers) return; // a second mouse button while dragging
      const r = element.getBoundingClientRect();
      this.rect = { left: r.left, top: r.top };
      try { element.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      this.down(pin(e), e);
      if (this.hooks.onLongPress) setTimeout(() => this.checkLongPress(performance.now()), this.o.longPressMs + 5);
    });
    on(element, 'pointermove', (e: PointerEvent) => this.move(pin(e), e));
    on(element, 'pointerup', (e: PointerEvent) => this.up(pin(e), 'up', e));
    on(element, 'pointercancel', (e: PointerEvent) => this.up(pin(e), 'cancel', e));
    // the browser took the pointer away (a system gesture, the element went away): no stuck fingers
    on(element, 'lostpointercapture', (e: PointerEvent) => this.up(pin(e), 'cancel', e));
    on(element, 'contextmenu', (e: Event) => e.preventDefault());
    if (o.wheel ?? true) {
      on(element, 'wheel', (e: WheelEvent) => {
        e.preventDefault();
        const r = element.getBoundingClientRect();
        this.rect = { left: r.left, top: r.top };
        let px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * element.clientHeight : e.deltaY;
        // a trackpad pinch arrives as ctrl+wheel with small deltas: make it track the fingers
        if (e.ctrlKey) px *= 8.8;
        const p = at(e);
        this.wheel(p.x, p.y, px);
      }, { passive: false });
    }
    const kt = o.keyboard === false ? null : o.keyboard === true || o.keyboard === undefined ? window : o.keyboard;
    if (kt) {
      const typing = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      };
      const name = (e: KeyboardEvent) => KEYS[e.code] ?? (e.key === '+' ? 'in' : e.key === '-' || e.key === '_' ? 'out' : undefined);
      on(kt, 'keydown', (e: KeyboardEvent) => {
        if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = name(e);
        if (!k) return;
        e.preventDefault();
        this.key(k, true);
      });
      on(kt, 'keyup', (e: KeyboardEvent) => { const k = name(e); if (k) this.key(k, false); });
      on(window, 'blur', () => this.clearKeys());
    }
    this.apply();
  }

  lens(): Lens {
    const c = this.camera as THREE.PerspectiveCamera;
    return {
      width: this.element.clientWidth || window.innerWidth,
      height: this.element.clientHeight || window.innerHeight,
      fov: c.isPerspectiveCamera ? (c.fov * Math.PI) / 180 : undefined,
      distance: this.distance,
    };
  }

  /** place the three.js camera (and the sun's shadow) for the current view */
  apply() {
    if (!this.camera) return; // still constructing
    const v = this.view, L = this.lens(), aspect = L.width / L.height;
    const c = this.camera;
    if ((c as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = c as THREE.OrthographicCamera;
      o.left = (-v.h * aspect) / 2; o.right = (v.h * aspect) / 2; o.top = v.h / 2; o.bottom = -v.h / 2;
    } else (c as THREE.PerspectiveCamera).aspect = aspect;
    c.updateProjectionMatrix();
    const { back } = basis(v.az, v.el), D = eyeDistance(v, L);
    const tx = v.x - this.origin.x, tz = v.z - this.origin.z;
    c.position.set(tx + back.x * D, back.y * D, tz + back.z * D);
    c.lookAt(tx, 0, tz);
    c.updateMatrixWorld();
    this.shadow?.update(v, this.origin);
  }

  dispose() { for (const f of this.off.splice(0)) f(); }
}

/**
 * A directional light's shadow that follows the view: the shadow box grows in big steps as you
 * zoom out and slides in whole shadow-map texels as you pan, so edges stay sharp and don't shimmer.
 */
export class SunFollow {
  light: THREE.DirectionalLight;
  o: ShadowOpts & { back?: number; near?: number; far?: number };
  constructor(light: THREE.DirectionalLight, o: ShadowOpts & { back?: number; near?: number; far?: number }) {
    this.light = light;
    this.o = o;
  }
  update(v: View, origin = { x: 0, z: 0 }) {
    const L = this.light, f = shadowFrame(v, this.o, L.shadow.mapSize.x), back = this.o.back ?? 320;
    const cx = f.centre.x - origin.x, cz = f.centre.z - origin.z;
    L.target.position.set(cx, f.centre.y, cz);
    L.position.set(cx + f.dir.x * back, f.centre.y + f.dir.y * back, cz + f.dir.z * back);
    const sc = L.shadow.camera;
    if (sc.right !== f.r) {
      sc.left = -f.r; sc.right = f.r; sc.top = f.r; sc.bottom = -f.r;
      sc.near = this.o.near ?? 10; sc.far = this.o.far ?? 900;
      sc.updateProjectionMatrix();
    }
  }
}

/**
 * Optional on-screen buttons any page can mount: rotate left and right, zoom in and out, and a
 * compass that shows north and resets it. Returns the element and a function to remove it.
 */
export function mountNavControls(rig: NavCore, o: { parent?: HTMLElement; side?: 'left' | 'right'; bottom?: number; zoom?: boolean; rotate?: boolean; step?: number } = {}) {
  const box = document.createElement('div');
  box.className = 'kit-nav';
  const side = o.side ?? 'right';
  Object.assign(box.style, {
    position: 'fixed', [side]: 'calc(12px + env(safe-area-inset-' + side + ', 0px))', bottom: `calc(${o.bottom ?? 16}px + env(safe-area-inset-bottom, 0px))`,
    display: 'flex', flexDirection: 'column', gap: '8px', zIndex: '20', userSelect: 'none', touchAction: 'manipulation',
  });
  const btn = (label: string, title: string, f: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = label;
    Object.assign(b.style, {
      width: '44px', height: '44px', borderRadius: '22px', border: '1px solid rgba(255,255,255,0.14)', padding: '0',
      background: 'rgba(18,22,30,0.72)', color: '#f2f4f8', font: '600 20px/1 Inter, system-ui, sans-serif',
      backdropFilter: 'blur(8px)', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', cursor: 'pointer',
    });
    b.addEventListener('click', f);
    box.appendChild(b);
    return b;
  };
  const step = o.step ?? Math.PI / 4;
  const compass = btn('<span style="display:inline-block;color:#ff5a4d">➤</span>', 'Reset north and tilt', () => rig.resetNorth());
  const needle = compass.firstElementChild as HTMLElement;
  if (o.rotate ?? true) { btn('⟲', 'Rotate left', () => rig.rotateBy(-step)); btn('⟳', 'Rotate right', () => rig.rotateBy(step)); }
  if (o.zoom ?? true) { btn('+', 'Zoom in', () => rig.zoomBy(1 / 1.6)); btn('−', 'Zoom out', () => rig.zoomBy(1.6)); }
  const show = () => { needle.style.transform = `rotate(${rig.northAngle()}rad)`; };
  const unsub = rig.onChange(show);
  show();
  (o.parent ?? document.body).appendChild(box);
  return { el: box, dispose: () => { unsub(); box.remove(); } };
}
