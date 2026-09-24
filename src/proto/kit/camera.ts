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
// leaves it alone, and hears about taps, double taps, long presses and mouse hover.
// Object viewers (a bridge, a vehicle on a turntable) can make one finger turn and tilt instead.
import * as THREE from 'three';
import {
  DEFAULT_LIMITS, ORTHO_DISTANCE, basis, clampView, easeOutCubic, eyeDistance, fitView, groundToScreen, keepUnder, lerpView,
  nearestAz, reseat, screenRay, screenToGround, shadowFrame, wrapAngle,
  type Box, type GroundPoint, type HeightAt, type Lens, type Limits, type Pad, type ShadowOpts, type V3, type View,
} from './viewmath';

export type { View, Limits, Lens, V3, GroundPoint, HeightAt, Box, Pad } from './viewmath';

/** Why a claimed pointer stopped: lifted, cancelled by the browser, or a second finger landed
 * (the camera takes over for the pinch). */
export type ClaimEnd = 'up' | 'cancel' | 'second-finger';
export type Gesture = 'idle' | 'maybe' | 'pan' | 'orbit' | 'claim' | 'two';

/** A pointer as the host sees it: screen position relative to the element, in CSS pixels. */
export interface NavTouch {
  id: number;
  sx: number;
  sy: number;
  /** how far it moved since the last event for this pointer */
  dx: number;
  dy: number;
  t: number;
  type: string;
  button: number;
  /** the ground under the pointer (terrain-aware), worked out when first asked for */
  readonly ground: V3;
  /** where this pointer went down, and the ground that was under it then */
  start: { sx: number; sy: number; t: number; readonly ground: V3 };
  event?: Event;
}

export interface NavHooks {
  /** First finger down. Return true to take the pointer (the camera won't pan with it). */
  onPointerDown?(p: NavTouch): boolean | void;
  /** Two fingers became one (a pinch ended with one finger lifted). Return true to take the
   * finger that is left (a turntable turning its model); otherwise it pans. */
  onRemaining?(p: NavTouch): boolean | void;
  /** The finger has moved past the tap slop. Return true to take it (e.g. to draw a road). */
  onDragStart?(p: NavTouch): boolean | void;
  /** A claimed pointer moved (also called straight after a successful onDragStart). */
  onClaimMove?(p: NavTouch): void;
  onClaimEnd?(p: NavTouch, why: ClaimEnd): void;
  onTap?(p: NavTouch): void;
  /** Return true to say you've handled it; otherwise the camera zooms in on the spot. */
  onDoubleTap?(p: NavTouch): boolean | void;
  onLongPress?(p: NavTouch): void;
  /** A mouse moving with no button down (a desktop probe or hover highlight). */
  onHover?(p: NavTouch): void;
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
  /** with terrain: once the view comes to rest, slide the target down the line of sight onto
   * the ground so turning and tilting pivot on what's in the middle of the screen (default on
   * when there's a groundAt) */
  follow?: boolean;
  /** what one finger (or a plain mouse drag) does: 'pan' for maps (default), 'orbit' for object
   * viewers, where it turns and tilts; the right mouse button does the other one */
  oneFinger?: 'pan' | 'orbit';
  /** what turning and tilting with a drag pivots on: the ground where the drag began ('pointer',
   * default) or the view target, the middle of the screen ('target', for object viewers) */
  pivot?: 'pointer' | 'target';
  /** carry on gliding after a flick (default true, as the game always has) */
  fling?: boolean;
  rotate?: boolean;
  tilt?: boolean;
  /** a twist must pass this angle before the view turns, so pinches don't wobble (default 12°) */
  rotateThreshold?: number;
  /** radians of tilt per pixel of two-finger vertical drag; positive: fingers up, steeper (default 0.006) */
  tiltPerPx?: number;
  /** radians of turn per pixel of orbit drag (default 0.008) */
  turnPerPx?: number;
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

interface Ptr { id: number; x: number; y: number; px: number; py: number; t: number; pt: number; stopper?: boolean; x0: number; y0: number; t0: number; v0: View; type: string; button: number }
export interface PointerIn { id: number; x: number; y: number; t: number; type?: string; button?: number; orbit?: boolean }

type Anim =
  | { kind: 'to'; from: View; to: View; ms: number; t: number; done: (ok: boolean) => void }
  | { kind: 'about'; from: View; to: View; w: V3; sx: number; sy: number; ms: number; t: number; done: (ok: boolean) => void };

type Tuning = Required<Omit<NavOptions, keyof NavHooks | 'view' | 'home' | 'limits' | 'groundAt' | 'heightRange' | 'follow'>>;

const DEG = Math.PI / 180;
const same = (a: View, b: View) => a.x === b.x && a.z === b.z && a.h === b.h && a.az === b.az && a.el === b.el && a.y === b.y;

/**
 * The gesture state machine and view, with no DOM and no three.js: feed it pointer events and
 * it moves `view`. NavRig wires it to an element and a camera.
 */
export class NavCore {
  /** the live view; the host may read it any time, and write it (the next update clamps it) */
  readonly view: View;
  limits: Limits;
  o: Tuning;
  hooks: NavHooks;
  home: { az: number; el: number };
  ground: { heightAt?: HeightAt; range?: [number, number] } | undefined;
  follow: boolean;
  private followSet: boolean;
  /** turn the view slowly about the middle of the screen, radians a second (a turntable);
   * it waits while a finger is down */
  spin = 0;
  /** false: ignore new touches, the wheel and keys (a modal is open); fingers already down finish */
  enabled = true;

  private ptrs = new Map<number, Ptr>();
  private mode: Gesture = 'idle';
  private primary = -1;
  private anchor: V3 = { x: 0, y: 0, z: 0 };
  private vel: { x: number; z: number; t: number }[] = [];
  private flingV = { x: 0, z: 0 };
  private orb: { x0: number; y0: number; ty0: number; az0: number; el0: number; w: V3 | null } | null = null;
  private two: {
    a: number; b: number; d0: number; a0: number; m0: { x: number; y: number }; anchor: V3; h0: number; az0: number;
    rotating: boolean; rotOff: number; tilting: boolean; tiltDy: number; tiltEl: number; tiltAt: { x: number; y: number };
    moved: boolean; t: number; t0: number;
  } | null = null;
  private anim: Anim | null = null;
  private keys = new Set<string>();
  private lastTap = { x: 0, y: 0, t: -Infinity };
  private longFired = false;
  private listeners = new Set<(v: View) => void>();
  private shown: View | null = null;
  private seated: View | null = null;
  private lensFn?: () => Lens;

  constructor(o: NavOptions = {}, lens?: () => Lens) {
    this.lensFn = lens;
    this.limits = { ...DEFAULT_LIMITS, ...o.limits };
    this.ground = o.groundAt ? { heightAt: o.groundAt, range: o.heightRange } : undefined;
    this.follow = o.follow ?? !!o.groundAt;
    this.followSet = o.follow !== undefined;
    this.view = clampView(this.onGround({ x: 0, z: 0, h: 300, az: Math.PI / 4, el: 0.6, ...o.view }), this.limits);
    this.home = { az: o.home?.az ?? this.view.az, el: o.home?.el ?? this.view.el };
    this.hooks = o;
    this.o = {
      oneFinger: o.oneFinger ?? 'pan', pivot: o.pivot ?? 'pointer',
      fling: o.fling ?? true, rotate: o.rotate ?? true, tilt: o.tilt ?? true,
      rotateThreshold: o.rotateThreshold ?? 12 * DEG, tiltPerPx: o.tiltPerPx ?? 0.006, turnPerPx: o.turnPerPx ?? 0.008,
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
  groundUnder(sx: number, sy: number, v: View = this.view): V3 {
    const L = this.lens(), g = screenToGround(v, L, sx, sy, this.ground);
    if (g) return g;
    const r = screenRay(v, L, sx, sy);
    const dy = Math.min(r.dir.y, -0.02), t = r.origin.y / -dy;
    return { x: r.origin.x + r.dir.x * t, y: 0, z: r.origin.z + r.dir.z * t };
  }
  groundToScreen(p: GroundPoint) { return groundToScreen(this.view, this.lens(), p); }
  /** which way north (-z) points on the screen, radians clockwise from pointing right */
  northAngle() {
    const y = this.view.y ?? 0;
    const a = this.groundToScreen({ x: this.view.x, y, z: this.view.z }), b = this.groundToScreen({ x: this.view.x, y, z: this.view.z - 50 });
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
  setGround(heightAt?: HeightAt, range?: [number, number]) {
    this.ground = heightAt ? { heightAt, range } : undefined;
    // terrain arriving later settles the view onto it too, unless the host said otherwise
    if (!this.followSet) this.follow = !!heightAt;
    this.seated = null;
  }
  setLimits(l: Partial<Limits>) { this.limits = { ...this.limits, ...l }; this.put({ ...this.view }); }

  // ---------------- view changes ----------------
  // a view given by where it looks (x, z) but not how high that is looks at the ground there
  private onGround(v: View): View {
    if (v.y === undefined && this.ground?.heightAt) v.y = this.ground.heightAt(v.x, v.z);
    return v;
  }
  private fill(to: Partial<View>): View {
    const v = { ...this.view, ...to };
    if ((to.x !== undefined || to.z !== undefined) && to.y === undefined) delete v.y;
    return clampView(this.onGround(v), this.limits);
  }
  /** jump straight to a view (clamped) */
  setView(v: Partial<View>) { this.stop(); this.put(this.fill(v)); }
  private put(v: View) {
    Object.assign(this.view, clampView(v, this.limits));
    this.apply();
  }
  onChange(fn: (v: View) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** the view (current, with `patch` applied) that shows world point w at screen point (sx, sy) */
  framing(w: GroundPoint, sx: number, sy: number, patch: Partial<View> = {}): View {
    return keepUnder(clampView({ ...this.view, ...patch }, this.limits), this.lens(), w, sx, sy);
  }
  /** the view that fits a box into the part of the screen `pad` leaves clear (see fitView) */
  fitting(box: Box, pad: Pad = {}, patch: { az?: number; el?: number } = {}, margin = 1.1): View {
    return fitView(box, this.lens(), patch.az ?? this.view.az, patch.el ?? this.view.el, pad, margin);
  }
  /** move to show the whole box; ms 0 jumps */
  fit(box: Box, pad: Pad = {}, ms = this.o.animMs, patch: { az?: number; el?: number } = {}) {
    const v = this.fitting(box, pad, patch);
    if (ms <= 0) { this.setView(v); return Promise.resolve(true); }
    return this.animateTo(v, ms);
  }

  /** stop any animation and glide */
  stop() {
    if (this.anim) { const a = this.anim; this.anim = null; a.done(false); }
    this.flingV = { x: 0, z: 0 };
  }

  /** move to a view over `ms`; resolves true when it arrives, false if interrupted */
  animateTo(to: Partial<View>, ms = this.o.animMs): Promise<boolean> {
    this.stop();
    const target = this.fill(to);
    // turn the short way round, however many turns the view has made
    if (to.az !== undefined) target.az = nearestAz(this.view.az, target.az);
    return new Promise((done) => { this.anim = { kind: 'to', from: { ...this.view }, to: target, ms: Math.max(1, ms), t: 0, done }; });
  }
  /** zoom by a factor keeping the ground under (sx, sy) where it is, all the way */
  zoomAt(sx: number, sy: number, factor: number, ms = 400): Promise<boolean> {
    // presses in quick succession add up exactly
    const a = this.anim, from = a && a.kind === 'about' && a.sx === sx && a.sy === sy ? a.to.h : this.view.h;
    return this.about({ h: from * factor }, sx, sy, ms);
  }
  /** zoom about the middle of the screen */
  zoomBy(factor: number, ms = 300) { const L = this.lens(); return this.zoomAt(L.width / 2, L.height / 2, factor, ms); }
  /** turn about the middle of the screen; presses in quick succession add up exactly */
  rotateBy(d: number, ms = this.o.animMs) {
    const L = this.lens(), a = this.anim;
    const from = a && a.kind === 'about' && a.sx === L.width / 2 && a.sy === L.height / 2 ? a.to.az : this.view.az;
    return this.about({ az: from + d }, L.width / 2, L.height / 2, ms);
  }
  /** tilt to an elevation about the middle of the screen */
  tiltTo(el: number, ms = this.o.animMs) { const L = this.lens(); return this.about({ el }, L.width / 2, L.height / 2, ms); }
  /** face the home direction (north, or the game's usual angle) the short way round and return
   * to the home tilt */
  resetNorth(ms = this.o.animMs) {
    const L = this.lens();
    return this.about({ az: nearestAz(this.view.az, this.home.az), el: this.home.el }, L.width / 2, L.height / 2, ms);
  }
  private about(to: Partial<View>, sx: number, sy: number, ms: number): Promise<boolean> {
    const w = this.groundUnder(sx, sy);
    this.stop();
    const target = clampView({ ...this.view, ...to }, this.limits);
    return new Promise((done) => { this.anim = { kind: 'about', from: { ...this.view }, to: target, w, sx, sy, ms: Math.max(1, ms), t: 0, done }; });
  }

  // ---------------- pointers ----------------
  private touch(p: Ptr, event?: Event): NavTouch {
    const sx = p.x, sy = p.y, x0 = p.x0, y0 = p.y0, v0 = p.v0;
    let g: V3 | undefined, g0: V3 | undefined;
    const self = this;
    return {
      id: p.id, sx, sy, dx: p.x - p.px, dy: p.y - p.py, t: p.t, type: p.type, button: p.button, event,
      get ground() { return (g ??= self.groundUnder(sx, sy)); },
      // (with the view as it was when the finger went down)
      start: { sx: x0, sy: y0, t: p.t0, get ground() { return (g0 ??= self.groundUnder(x0, y0, v0)); } },
    };
  }
  private interact() { this.stop(); this.hooks.onInteract?.(); }

  down(e: PointerIn, event?: Event) {
    if (!this.enabled) return;
    // a touch that stops a glide only stops it: its lift is not a tap
    const gliding = !!(this.flingV.x || this.flingV.z);
    this.interact();
    const p: Ptr = { id: e.id, x: e.x, y: e.y, px: e.x, py: e.y, t: e.t, pt: e.t, x0: e.x, y0: e.y, t0: e.t, v0: { ...this.view }, type: e.type ?? 'touch', button: e.button ?? 0 };
    if (gliding) p.stopper = true;
    this.ptrs.delete(e.id);
    this.ptrs.set(e.id, p);
    const n = this.ptrs.size;
    if (n === 1) {
      this.primary = e.id;
      this.longFired = false;
      // the right or middle mouse button (or a modifier) does whichever of pan and orbit a plain drag doesn't
      const other = p.type === 'mouse' && (p.button === 1 || p.button === 2 || !!e.orbit);
      if (other && this.o.oneFinger === 'pan') { this.startOrbit(p); return; }
      if (other) { this.startPan(p, p.x, p.y); this.mode = 'pan'; return; }
      if (this.hooks.onPointerDown?.(this.touch(p, event)) === true) { this.mode = 'claim'; return; }
      this.mode = 'maybe';
      this.startPan(p, p.x, p.y);
    } else if (n === 2 && this.ptrs.get(this.primary)?.type !== 'mouse') {
      if (this.mode === 'claim') {
        const q = this.ptrs.get(this.primary);
        if (q) this.hooks.onClaimEnd?.(this.touch(q, event), 'second-finger');
      }
      const [a, b] = [...this.ptrs.keys()];
      this.startTwo(a, b, e.t);
    }
    // a third finger is ignored: the pair that started the gesture carries on
  }

  private startPan(p: Ptr, x: number, y: number) {
    this.primary = p.id;
    this.anchor = this.groundUnder(x, y);
    this.vel = [];
  }
  private startOrbit(p: Ptr) {
    this.mode = 'orbit';
    this.primary = p.id;
    this.orb = { x0: p.x, y0: p.y, ty0: p.y, az0: this.view.az, el0: this.view.el, w: this.o.pivot === 'target' ? null : this.groundUnder(p.x, p.y) };
  }

  private startTwo(a: number, b: number, t: number) {
    const A = this.ptrs.get(a)!, B = this.ptrs.get(b)!;
    const m = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    this.mode = 'two';
    this.orb = null;
    this.two = {
      a, b, d0: Math.hypot(A.x - B.x, A.y - B.y) || 1, a0: Math.atan2(B.y - A.y, B.x - A.x), m0: m,
      anchor: this.groundUnder(m.x, m.y), h0: this.view.h, az0: this.view.az,
      rotating: false, rotOff: 0, tilting: false, tiltDy: 0, tiltEl: this.view.el, tiltAt: m, moved: false, t, t0: Math.min(A.t0, B.t0),
    };
  }

  move(e: PointerIn, event?: Event) {
    const p = this.ptrs.get(e.id);
    if (!p) return;
    p.px = p.x; p.py = p.y;
    p.x = e.x; p.y = e.y; p.pt = p.t; p.t = e.t;
    const L = this.lens();
    // fingers moving the map take over from any animation (a two-finger-tap zoom, a preset)
    if (this.anim && (this.mode === 'pan' || this.mode === 'two' || this.mode === 'orbit')) this.stop();
    if (this.mode === 'claim') {
      if (e.id === this.primary) this.hooks.onClaimMove?.(this.touch(p, event));
      return;
    }
    if (this.mode === 'two') {
      if (e.id === this.two!.a || e.id === this.two!.b) this.moveTwo(L);
      return;
    }
    if (e.id !== this.primary) return;
    if (this.mode === 'orbit') {
      const o = this.orb!;
      const v = { ...this.view };
      if (this.o.rotate) v.az = o.az0 - (p.x - o.x0) * this.o.turnPerPx;
      if (this.o.tilt) v.el = o.el0 - (p.y - o.ty0) * this.o.tiltPerPx;
      const c = clampView(v, this.limits);
      this.put(o.w ? keepUnder(c, L, o.w, o.x0, o.y0) : c);
      // at the tilt limit: count from here, so dragging back tilts back at once
      if (c.el !== v.el) { o.el0 = c.el; o.ty0 = p.y; }
      return;
    }
    if (this.mode === 'maybe') {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) <= this.o.tapSlop) return;
      const t = this.touch(p, event);
      if (this.hooks.onDragStart?.(t) === true) { this.mode = 'claim'; this.hooks.onClaimMove?.(t); return; }
      // an object viewer turns from here, without a jump; a map pans so the ground grabbed at the
      // start catches up with the finger
      if (this.o.oneFinger === 'orbit') { this.startOrbit(p); return; }
      this.mode = 'pan'; // and the pan starts with this move
      // where the view was before it, so even a flick of a single move can glide
      this.vel = [{ x: this.view.x, z: this.view.z, t: p.pt }];
    }
    if (this.mode === 'pan') {
      const want = keepUnder(this.view, L, this.anchor, p.x, p.y);
      this.put(want);
      // held at the edge of the map: grab the ground that's under the finger now, so dragging
      // back moves the map straight away
      if (this.view.x !== want.x || this.view.z !== want.z) this.anchor = this.groundUnder(p.x, p.y);
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
    if (g.tilting) {
      const el = g.tiltEl - (dy - g.tiltDy) * this.o.tiltPerPx;
      this.put(keepUnder(clampView({ ...this.view, el }, this.limits), L, g.anchor, g.tiltAt.x, g.tiltAt.y));
      // at the tilt limit: count from here, so sliding back tilts back straight away
      if (this.view.el !== el) { g.tiltDy = dy; g.tiltEl = this.view.el; }
      return;
    }
    // rotation only starts after a deliberate twist, then carries on from there
    if (this.o.rotate && !g.rotating && Math.abs(rot) > this.o.rotateThreshold) { g.rotating = true; g.rotOff = Math.sign(rot) * this.o.rotateThreshold; }
    const h = g.h0 / scale;
    const v = clampView({ ...this.view, h, az: g.az0 + (g.rotating ? rot - g.rotOff : 0) }, this.limits);
    const want = keepUnder(v, L, g.anchor, m.x, m.y);
    this.put(want);
    // at the zoom limit: count from here, so the fingers work straight away when they turn back
    if (v.h !== h) g.h0 = this.view.h * scale;
    // at the edge of the map: grab the ground now under the fingers
    if (this.view.x !== want.x || this.view.z !== want.z) g.anchor = this.groundUnder(m.x, m.y);
    // Two fingers sliding up or down together (not pinching or turning) tilts. It takes over
    // from the view this very move gave, with the fingers where they are now, so nothing jumps
    // (deciding before this move's pinch was applied left a half-moved pair's zoom behind).
    if (this.o.tilt && !g.rotating && Math.abs(dy) > 14 && Math.abs(scale - 1) < 0.08 && Math.abs(rot) < 0.1 && Math.abs(m.x - g.m0.x) < Math.abs(dy) * 0.6) {
      g.tilting = true; g.tiltDy = dy; g.tiltEl = this.view.el; g.tiltAt = m;
    }
  }

  up(e: PointerIn, why: 'up' | 'cancel' = 'up', event?: Event) {
    const p = this.ptrs.get(e.id);
    if (!p) return;
    // a quick flick can lift well past its last move: the lift is where the finger got to
    if (why === 'up' && (e.x !== p.x || e.y !== p.y)) this.move(e, event);
    p.px = p.x; p.py = p.y;
    p.x = e.x; p.y = e.y; p.t = e.t;
    this.ptrs.delete(e.id);
    if (this.mode === 'two') {
      const g = this.two!;
      if (e.id !== g.a && e.id !== g.b) return; // a spare finger lifted
      if (this.ptrs.size >= 2) { const [a, b] = [...this.ptrs.keys()]; this.startTwo(a, b, e.t); this.two!.moved = true; return; }
      if (this.ptrs.size === 1) {
        // a quick two-finger tap zooms out
        // (both fingers quick: not a finger resting on the map while another brushes the screen)
        if (why === 'up' && !g.moved && e.t - g.t0 < 300 && this.o.twoFingerTapZoom) this.zoomAt(g.m0.x, g.m0.y, this.o.twoFingerTapZoom);
        // carry on with the finger that's left, without a jump
        const [q] = [...this.ptrs.values()];
        if (this.hooks.onRemaining?.(this.touch(q, event)) === true) { this.mode = 'claim'; this.primary = q.id; return; }
        if (this.o.oneFinger === 'orbit') this.startOrbit(q);
        else { this.mode = 'pan'; this.startPan(q, q.x, q.y); }
        return;
      }
      this.mode = 'idle';
      return;
    }
    if (this.ptrs.size) {
      // only possible after a pair has become one finger and others land and lift
      if (e.id === this.primary) {
        const [q] = [...this.ptrs.values()];
        if (this.mode === 'orbit') this.startOrbit(q); else this.startPan(q, q.x, q.y);
      }
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
    if (mode === 'maybe' && why === 'up' && !this.longFired && !p.stopper && e.t - p.t0 < this.o.tapMs) this.tap(p, event);
  }

  private tap(p: Ptr, event?: Event) {
    const t = this.touch(p, event);
    this.hooks.onTap?.(t);
    if (p.t - this.lastTap.t < this.o.doubleTapMs && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < this.o.doubleTapSlop) {
      this.lastTap.t = -Infinity;
      if (this.hooks.onDoubleTap?.(t) !== true && this.o.doubleTapZoom) this.zoomAt(p.x, p.y, this.o.doubleTapZoom);
    } else this.lastTap = { x: p.x, y: p.y, t: p.t };
  }

  /** a mouse moving with no button down */
  hover(e: PointerIn, event?: Event) {
    if (!this.hooks.onHover || this.ptrs.size) return;
    const v0 = { ...this.view };
    this.hooks.onHover(this.touch({ id: e.id, x: e.x, y: e.y, px: e.x, py: e.y, t: e.t, pt: e.t, x0: e.x, y0: e.y, t0: e.t, v0, type: e.type ?? 'mouse', button: -1 }, event));
  }

  /** fire a long press if a still finger has been down long enough (update() calls this) */
  checkLongPress(now: number) {
    if (this.mode !== 'maybe' || this.longFired || !this.hooks.onLongPress) return;
    const p = this.ptrs.get(this.primary);
    if (p && now - p.t0 >= this.o.longPressMs) { this.longFired = true; this.hooks.onLongPress(this.touch(p)); }
  }

  /** the mouse wheel (or a trackpad pinch), in pixels: positive zooms out */
  wheel(sx: number, sy: number, deltaPx: number) {
    if (!this.enabled) return;
    this.interact();
    const f = Math.min(2, Math.max(0.5, Math.pow(this.o.wheelZoom, deltaPx / 100)));
    const w = this.groundUnder(sx, sy);
    this.put(keepUnder(clampView({ ...this.view, h: this.view.h * f }, this.limits), this.lens(), w, sx, sy));
  }

  /** held keys: 'left' 'right' 'up' 'down' 'rotl' 'rotr' 'in' 'out' */
  key(k: string, down: boolean) {
    if (down) { if (!this.enabled) return; if (!this.keys.has(k)) this.interact(); this.keys.add(k); } else this.keys.delete(k);
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
    if (this.spin && !this.ptrs.size && !this.anim) {
      const cx = L.width / 2, cy = L.height / 2;
      Object.assign(this.view, keepUnder({ ...this.view, az: this.view.az + this.spin * dt }, L, this.groundUnder(cx, cy), cx, cy));
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
    // on terrain, once everything has come to rest, sit the target on the ground (the picture
    // doesn't move); not mid-gesture, where it would upset a pinch or a glide
    if (this.follow && this.ground?.heightAt && !this.busy && !(this.seated && same(this.seated, this.view))) {
      const r = reseat(this.view, L, this.ground), c = clampView(r, this.limits);
      // the ground on the centre line lies outside the bounds: leave the view as it is rather
      // than let the clamp move the picture
      if (c.x === r.x && c.z === r.z && c.h === r.h) Object.assign(this.view, c);
      this.seated = { ...this.view };
    }
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
  /** re-centre the floating origin on the view once it strays this far (metres); the host moves
   * its world by -delta in onRebase (or keeps its world root at -origin) */
  rebaseAt?: number;
  onRebase?(origin: { x: number; z: number }, delta: { x: number; z: number }): void;
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
  private rebaseAt: number;
  private onRebase?: NavRigOptions['onRebase'];
  private rect = { left: 0, top: 0 };
  private off: (() => void)[] = [];

  constructor(camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, element: HTMLElement, o: NavRigOptions = {}) {
    super(o);
    this.camera = camera;
    this.element = element;
    this.origin = o.origin ?? { x: 0, z: 0 };
    this.shadow = o.shadow;
    this.distance = o.distance ?? ORTHO_DISTANCE;
    this.rebaseAt = o.rebaseAt ?? Infinity;
    this.onRebase = o.onRebase;
    if (!element.style.touchAction) element.style.touchAction = 'none';
    const on = (t: EventTarget, type: string, f: (e: never) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(type, f as EventListener, opt);
      this.off.push(() => t.removeEventListener(type, f as EventListener, opt));
    };
    const measure = () => { const r = element.getBoundingClientRect(); this.rect = { left: r.left, top: r.top }; };
    const at = (e: PointerEvent | WheelEvent) => ({ x: e.clientX - this.rect.left, y: e.clientY - this.rect.top });
    const pin = (e: PointerEvent) => ({ id: e.pointerId, ...at(e), t: e.timeStamp || performance.now(), type: e.pointerType, button: e.button, orbit: e.ctrlKey || e.altKey || e.metaKey });
    on(element, 'pointerdown', (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && this.pointers) return; // a second mouse button while dragging
      if (!this.enabled) return;
      measure();
      try { element.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      this.down(pin(e), e);
      if (this.hooks.onLongPress) setTimeout(() => this.checkLongPress(performance.now()), this.o.longPressMs + 5);
    });
    on(element, 'pointermove', (e: PointerEvent) => {
      // (re-measured: turning the phone can move the element under a finger that's down)
      if (this.pointers) { measure(); this.move(pin(e), e); return; }
      if (e.pointerType === 'mouse' && !e.buttons && this.hooks.onHover) { measure(); this.hover(pin(e), e); }
    });
    on(element, 'pointerup', (e: PointerEvent) => { measure(); this.up(pin(e), 'up', e); });
    on(element, 'pointercancel', (e: PointerEvent) => this.up(pin(e), 'cancel', e));
    // the browser took the pointer away (a system gesture, the element went away): no stuck fingers
    on(element, 'lostpointercapture', (e: PointerEvent) => this.up(pin(e), 'cancel', e));
    on(element, 'contextmenu', (e: Event) => e.preventDefault());
    if (o.wheel ?? true) {
      on(element, 'wheel', (e: WheelEvent) => {
        e.preventDefault();
        measure();
        let px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * element.clientHeight : e.deltaY;
        // a trackpad pinch arrives as ctrl+wheel with small deltas: make it track the fingers
        if (e.ctrlKey) px *= 8.8;
        // a mouse wheel's notch (lines or pages, or a big pixel step, which some browsers halve
        // on high-density screens) is always at least one whole step, as the game has always had;
        // a trackpad's small smooth deltas zoom smoothly
        else if (e.deltaMode !== 0 || Math.abs(px) >= 50) px = Math.sign(px) * Math.max(100, Math.abs(px));
        const p = at(e);
        this.wheel(p.x, p.y, px);
      }, { passive: false });
    }
    const kt = o.keyboard === false ? null : o.keyboard === true || o.keyboard === undefined ? window : o.keyboard;
    if (kt) {
      // keys belong to whatever has focus when it's a text box, or inside something that
      // scrolls (a side panel's list: arrows and Page Down scroll it, not the map)
      const typing = (e: KeyboardEvent) => {
        const t = e.target as HTMLElement | null;
        if (!t || !t.tagName) return false;
        if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return true;
        for (let n: HTMLElement | null = t; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
          if (n === element) return false;
          const oy = getComputedStyle(n).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return true;
        }
        return false;
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
    if (Math.abs(v.x - this.origin.x) > this.rebaseAt || Math.abs(v.z - this.origin.z) > this.rebaseAt) {
      const o = { x: Math.round(v.x), z: Math.round(v.z) }, d = { x: o.x - this.origin.x, z: o.z - this.origin.z };
      this.origin = o;
      this.onRebase?.(o, d);
    }
    const c = this.camera;
    if ((c as THREE.OrthographicCamera).isOrthographicCamera) {
      const o = c as THREE.OrthographicCamera;
      o.left = (-v.h * aspect) / 2; o.right = (v.h * aspect) / 2; o.top = v.h / 2; o.bottom = -v.h / 2;
    } else (c as THREE.PerspectiveCamera).aspect = aspect;
    c.updateProjectionMatrix();
    const { back } = basis(v.az, v.el), D = eyeDistance(v, L);
    const tx = v.x - this.origin.x, ty = v.y ?? 0, tz = v.z - this.origin.z;
    c.position.set(tx + back.x * D, ty + back.y * D, tz + back.z * D);
    c.lookAt(tx, ty, tz);
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

// Icons for the on-screen controls: Tabler Icons (MIT, tabler.io/icons), rotate-2,
// rotate-clockwise-2, plus and minus, inlined so the kit needs no icon package. The needle is our
// own: red to the north, white to the south.
const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
const ICON = {
  rotL: svg('<path d="M15 4.55a8 8 0 0 0 -6 14.9m0 -4.45v5h-5"/><path d="M18.37 7.16l0 .01"/><path d="M13 19.94l0 .01"/><path d="M16.84 18.37l0 .01"/><path d="M19.37 15.1l0 .01"/><path d="M19.94 11l0 .01"/>'),
  rotR: svg('<path d="M9 4.55a8 8 0 0 1 6 14.9m0 -4.45v5h5"/><path d="M5.63 7.16l0 .01"/><path d="M4.06 11l0 .01"/><path d="M4.63 15.1l0 .01"/><path d="M7.16 18.37l0 .01"/><path d="M11 19.94l0 .01"/>'),
  plus: svg('<path d="M12 5l0 14"/><path d="M5 12l14 0"/>'),
  minus: svg('<path d="M5 12l14 0"/>'),
  needle: `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false"><path fill="#ff5a44" d="M12 1.5L16.2 12H7.8Z"/><path fill="#f4f1e8" d="M7.8 12H16.2L12 22.5Z"/><circle cx="12" cy="12" r="1.6" fill="#0f3322"/></svg>`,
};

/**
 * Optional on-screen buttons any page can mount: a compass that shows north and resets the view,
 * rotate left and right, zoom in and out. In the brand's colours (forest panels, lime when
 * pressed), 44 px targets. Returns the element and a function to remove it.
 */
export function mountNavControls(rig: NavCore, o: {
  parent?: HTMLElement; side?: 'left' | 'right'; top?: number; bottom?: number; zoom?: boolean; rotate?: boolean; step?: number;
  /** keep the buttons just below this element (a page's title panel), however tall it grows */
  below?: HTMLElement;
} = {}) {
  const box = document.createElement('div');
  box.className = 'kit-nav';
  const side = o.side ?? 'right';
  Object.assign(box.style, {
    // inside a host element (a phone frame) it sits in that element's corner
    position: o.parent ? 'absolute' : 'fixed', [side]: `calc(8px + env(safe-area-inset-${side}, 0px))`,
    ...(o.top !== undefined ? { top: `calc(${o.top}px + env(safe-area-inset-top, 0px))` } : { bottom: `calc(${o.bottom ?? 16}px + env(safe-area-inset-bottom, 0px))` }),
    display: 'flex', flexDirection: 'column', gap: '6px', zIndex: '20', userSelect: 'none', touchAction: 'manipulation',
  });
  const btn = (html: string, title: string, f: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = html;
    Object.assign(b.style, {
      // (every property the page's own button styles might set, so they can't reach these)
      width: '44px', height: '44px', minWidth: '0', minHeight: '0', flex: '0 0 auto', margin: '0', padding: '0', borderRadius: '0',
      font: 'inherit', lineHeight: '0', boxSizing: 'border-box', display: 'grid', placeItems: 'center', cursor: 'pointer',
      border: '1px solid rgba(255,255,255,0.12)', color: '#ffffff', background: 'rgba(15,51,34,0.9)',
      // the brand's faceted corner
      clipPath: 'polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%)', boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
    });
    b.addEventListener('pointerdown', () => { b.style.background = '#5cb83a'; b.style.color = '#0a2414'; });
    const off = () => { b.style.background = 'rgba(15,51,34,0.9)'; b.style.color = '#ffffff'; };
    b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    b.addEventListener('click', f);
    box.appendChild(b);
    return b;
  };
  const step = o.step ?? Math.PI / 4;
  const compass = btn(ICON.needle, 'Reset north and tilt', () => rig.resetNorth());
  const needle = compass.firstElementChild as SVGElement;
  if (o.rotate ?? true) { btn(ICON.rotL, 'Rotate left', () => rig.rotateBy(-step)); btn(ICON.rotR, 'Rotate right', () => rig.rotateBy(step)); }
  if (o.zoom ?? true) { btn(ICON.plus, 'Zoom in', () => rig.zoomBy(1 / 1.6)); btn(ICON.minus, 'Zoom out', () => rig.zoomBy(1.6)); }
  // (the needle is drawn pointing up, a quarter turn on from an angle measured from pointing right)
  const show = () => { needle.style.transform = `rotate(${rig.northAngle() + Math.PI / 2}rad)`; };
  const unsub = rig.onChange(show);
  show();
  const parent = o.parent ?? document.body;
  parent.appendChild(box);
  // below a panel: re-measured whenever the panel or the page changes size
  let ro: ResizeObserver | null = null;
  const place = () => {
    if (!o.below) return;
    const top = o.below.getBoundingClientRect().bottom - (o.parent ? o.parent.getBoundingClientRect().top : 0);
    box.style.top = `${Math.round(top + 8)}px`;
    box.style.bottom = '';
  };
  if (o.below) {
    place();
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(place); ro.observe(o.below); }
    window.addEventListener('resize', place);
  }
  return { el: box, place, dispose: () => { unsub(); ro?.disconnect(); window.removeEventListener('resize', place); box.remove(); } };
}
