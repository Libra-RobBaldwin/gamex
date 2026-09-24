// The view maths behind the shared camera (kit/camera.ts): pure functions, no three.js, no DOM.
//
// A view is the point the camera looks at (x, z, and y, the height of that point: 0 on flat
// ground, the terrain's height on hills), how much of the world is visible top to bottom (h, in
// metres), which way round the camera stands (az) and how steeply it looks down (el: 0 is the
// horizon, π/2 straight down). The camera stands at
//   target + (sin az·cos el, sin el, cos az·cos el) · distance
// looking back at the target, so at az = 0 north (-z) is up the screen.
//
// Everything is worked out relative to the view target and only added back on at the end,
// so a view 100 km from the origin is exactly as precise as one at the origin.

export interface View { x: number; z: number; h: number; az: number; el: number; y?: number }
export interface V3 { x: number; y: number; z: number }
export interface GroundPoint { x: number; z: number; y?: number }
/** What the screen looks like: its size in CSS pixels and the kind of camera. */
export interface Lens {
  width: number;
  height: number;
  /** vertical field of view in radians for a perspective camera; leave unset for orthographic */
  fov?: number;
  /** orthographic only: how far back the camera stands (affects clipping, not the picture) */
  distance?: number;
}
/** Height of the ground at a world point, for terrain. */
export type HeightAt = (x: number, z: number) => number;
export interface Ground {
  heightAt?: HeightAt;
  /** lowest and highest ground the terrain can have, to bracket the search (default -100..600) */
  range?: [number, number];
}
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface Limits { hMin: number; hMax: number; elMin: number; elMax: number; bounds?: Bounds | null }

export const DEFAULT_LIMITS: Limits = { hMin: 35, hMax: 900, elMin: 0.35, elMax: 1.52, bounds: null };
export const ORTHO_DISTANCE = 1200;

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The camera's axes: back (from the target towards the eye), right and up on the screen. */
export function basis(az: number, el: number) {
  const sa = Math.sin(az), ca = Math.cos(az), se = Math.sin(el), ce = Math.cos(el);
  return {
    back: { x: sa * ce, y: se, z: ca * ce },
    right: { x: ca, y: 0, z: -sa },
    up: { x: -se * sa, y: ce, z: -se * ca },
  };
}

/** How far the eye stands from the target. For a perspective camera this is what makes h the
 * visible height at the target. */
export function eyeDistance(v: View, lens: Lens) {
  return lens.fov ? v.h / (2 * Math.tan(lens.fov / 2)) : (lens.distance ?? ORTHO_DISTANCE);
}

interface Ray { o: V3; d: V3 }
// the ray through a screen point, with its origin relative to the view target (x, y, z)
function rayRel(v: View, lens: Lens, sx: number, sy: number): Ray {
  const { back, right, up } = basis(v.az, v.el);
  const D = eyeDistance(v, lens);
  if (lens.fov) {
    const t = Math.tan(lens.fov / 2), aspect = lens.width / lens.height;
    const u = ((2 * sx) / lens.width - 1) * t * aspect, w = (1 - (2 * sy) / lens.height) * t;
    const d = { x: -back.x + right.x * u + up.x * w, y: -back.y + right.y * u + up.y * w, z: -back.z + right.z * u + up.z * w };
    const n = Math.hypot(d.x, d.y, d.z);
    return { o: { x: back.x * D, y: back.y * D, z: back.z * D }, d: { x: d.x / n, y: d.y / n, z: d.z / n } };
  }
  const k = v.h / lens.height;
  const U = (sx - lens.width / 2) * k, W = (lens.height / 2 - sy) * k;
  return {
    o: { x: back.x * D + right.x * U + up.x * W, y: back.y * D + right.y * U + up.y * W, z: back.z * D + right.z * U + up.z * W },
    d: { x: -back.x, y: -back.y, z: -back.z },
  };
}

/** The ray through a screen point, in world coordinates. */
export function screenRay(v: View, lens: Lens, sx: number, sy: number) {
  const r = rayRel(v, lens, sx, sy);
  return { origin: { x: v.x + r.o.x, y: (v.y ?? 0) + r.o.y, z: v.z + r.o.z }, dir: r.d };
}

// where a relative ray reaches height y (relative x/z), or null if it never does
function atHeight(r: Ray, y: number): V3 | null {
  if (r.d.y > -1e-9) {
    // a ray pointing at or above the horizon (perspective, top of the screen) never lands
    if (Math.abs(r.o.y - y) < 1e-9) return { x: r.o.x, y, z: r.o.z };
    return null;
  }
  const t = (r.o.y - y) / -r.d.y;
  return { x: r.o.x + r.d.x * t, y, z: r.o.z + r.d.z * t };
}

/** The ground under a screen point: the flat plane y = 0, or the terrain if there is one.
 * Returns null only when the ray misses the ground altogether (a perspective ray above the horizon). */
export function screenToGround(v: View, lens: Lens, sx: number, sy: number, ground?: Ground): V3 | null {
  const r = rayRel(v, lens, sx, sy), vy = v.y ?? 0;
  if (!ground?.heightAt) {
    const p = atHeight(r, -vy);
    return p && { x: v.x + p.x, y: 0, z: v.z + p.z };
  }
  const H = ground.heightAt, [lo, hi] = ground.range ?? [-100, 600];
  if (r.d.y > -1e-9) return null;
  // march down the ray from where it enters the height range to where it leaves it, then bisect
  // (heights here are relative to the view target, like the ray)
  const tTop = Math.max(0, (r.o.y + vy - hi) / -r.d.y), tBot = (r.o.y + vy - lo) / -r.d.y;
  if (tBot <= tTop) return null;
  const f = (t: number) => vy + r.o.y + r.d.y * t - H(v.x + r.o.x + r.d.x * t, v.z + r.o.z + r.d.z * t);
  const at = (t: number): V3 => ({ x: v.x + r.o.x + r.d.x * t, y: vy + r.o.y + r.d.y * t, z: v.z + r.o.z + r.d.z * t });
  const horiz = Math.hypot(r.d.x, r.d.z) * (tBot - tTop);
  const n = clamp(Math.ceil(horiz / Math.max(0.5, v.h / 200)), 8, 400);
  let t0 = tTop;
  if (f(t0) <= 0) return at(t0);
  for (let i = 1; i <= n; i++) {
    const t1 = tTop + ((tBot - tTop) * i) / n;
    if (f(t1) <= 0) {
      let a = t0, b = t1;
      for (let j = 0; j < 40 && b - a > 1e-7; j++) { const m = (a + b) / 2; if (f(m) > 0) a = m; else b = m; }
      return at(b);
    }
    t0 = t1;
  }
  return at(tBot);
}

/** Where a world point appears on the screen (CSS pixels). depth > 0 means in front of the camera. */
export function groundToScreen(v: View, lens: Lens, p: GroundPoint): { x: number; y: number; depth: number } {
  const { back, right, up } = basis(v.az, v.el);
  const D = eyeDistance(v, lens);
  // relative to the target first, then to the eye
  const qx = p.x - v.x, qy = (p.y ?? 0) - (v.y ?? 0), qz = p.z - v.z;
  const ex = qx - back.x * D, ey = qy - back.y * D, ez = qz - back.z * D;
  const cx = ex * right.x + ey * right.y + ez * right.z;
  const cy = ex * up.x + ey * up.y + ez * up.z;
  const depth = -(ex * back.x + ey * back.y + ez * back.z);
  if (lens.fov) {
    const t = Math.tan(lens.fov / 2), aspect = lens.width / lens.height;
    const d = Math.abs(depth) < 1e-9 ? 1e-9 : depth;
    return { x: ((cx / d / (t * aspect) + 1) / 2) * lens.width, y: ((1 - cy / d / t) / 2) * lens.height, depth };
  }
  const k = lens.height / v.h;
  return { x: lens.width / 2 + cx * k, y: lens.height / 2 - cy * k, depth };
}

/** Move the view (x, z only) so world point w sits under screen point (sx, sy). Exact in one step
 * for both kinds of camera: sliding the camera across the ground slides the whole picture. */
export function keepUnder(v: View, lens: Lens, w: GroundPoint, sx: number, sy: number): View {
  const p = atHeight(rayRel(v, lens, sx, sy), (w.y ?? 0) - (v.y ?? 0));
  if (!p) return { ...v };
  return { ...v, x: v.x + ((w.x - v.x) - p.x), z: v.z + ((w.z - v.z) - p.z) };
}

/** Clamp zoom and tilt, and keep the target inside the bounds. */
export function clampView(v: View, l: Limits): View {
  const o = { ...v, h: clamp(v.h, l.hMin, l.hMax), el: clamp(v.el, l.elMin, l.elMax) };
  if (l.bounds) { o.x = clamp(o.x, l.bounds.minX, l.bounds.maxX); o.z = clamp(o.z, l.bounds.minZ, l.bounds.maxZ); }
  return o;
}

/** Zoom to height h (clamped) keeping w under (sx, sy). */
export function zoomAbout(v: View, lens: Lens, l: Limits, w: GroundPoint, sx: number, sy: number, h: number) {
  return keepUnder({ ...v, h: clamp(h, l.hMin, l.hMax) }, lens, w, sx, sy);
}
/** Turn to azimuth az keeping w under (sx, sy). */
export function rotateAbout(v: View, lens: Lens, w: GroundPoint, sx: number, sy: number, az: number) {
  return keepUnder({ ...v, az }, lens, w, sx, sy);
}
/** Tilt to elevation el (clamped) keeping w under (sx, sy). */
export function tiltAbout(v: View, lens: Lens, l: Limits, w: GroundPoint, sx: number, sy: number, el: number) {
  return keepUnder({ ...v, el: clamp(el, l.elMin, l.elMax) }, lens, w, sx, sy);
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOutCubic = (t: number) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

/** Part way from a to b: position and angles linearly (az literally, so pass the angle you want
 * to turn through), zoom geometrically so it feels even. */
export function lerpView(a: View, b: View, k: number): View {
  if (k >= 1) return { ...b };
  if (k <= 0) return { ...a };
  const o: View = {
    x: a.x + (b.x - a.x) * k,
    z: a.z + (b.z - a.z) * k,
    h: a.h * Math.pow(b.h / a.h, k),
    az: a.az + (b.az - a.az) * k,
    el: a.el + (b.el - a.el) * k,
  };
  if (a.y !== undefined || b.y !== undefined) o.y = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * k;
  return o;
}

/** The nearest azimuth to `from` that faces the same way as `to`. */
export const nearestAz = (from: number, to: number) => from + wrapAngle(to - from);

/** The same picture, but with the target moved down the line of sight onto the ground (terrain),
 * so the camera turns and tilts about what's in the middle of the screen and stands clear of hills.
 * Orthographic: nothing on screen moves. Perspective: the eye stays put and h changes to match. */
export function reseat(v: View, lens: Lens, ground?: Ground): View {
  const g = screenToGround(v, lens, lens.width / 2, lens.height / 2, ground);
  if (!g) return { ...v };
  const o: View = { ...v, x: g.x, y: g.y, z: g.z };
  if (lens.fov) {
    // the eye is target + back·D; the new target is on the centre line, so D' = D + (target - g)·back
    const { back } = basis(v.az, v.el), D = eyeDistance(v, lens);
    const D2 = D + (v.x - g.x) * back.x + ((v.y ?? 0) - g.y) * back.y + (v.z - g.z) * back.z;
    o.h = v.h * (D2 / D);
  }
  return o;
}

export interface Box { min: V3; max: V3 }
/** Space to keep clear at each edge of the screen, in CSS pixels (panels, buttons). */
export interface Pad { top?: number; bottom?: number; left?: number; right?: number }
/** The view, facing az and tilted el, that shows the whole box in the part of the screen the
 * padding leaves clear, with a margin round it. Exact for orthographic cameras; near enough for
 * perspective ones (the near side of the box looks a little bigger). */
export function fitView(box: Box, lens: Lens, az: number, el: number, pad: Pad = {}, margin = 1.1): View {
  const { right, up } = basis(az, el);
  const c = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
  let ex = 0, ey = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    ex = Math.max(ex, Math.abs(dx * right.x + dy * right.y + dz * right.z));
    ey = Math.max(ey, Math.abs(dx * up.x + dy * up.y + dz * up.z));
  }
  const l = pad.left ?? 0, t = pad.top ?? 0;
  const fw = Math.max(1, lens.width - l - (pad.right ?? 0)), fh = Math.max(1, lens.height - t - (pad.bottom ?? 0));
  // on screen the box is 2·ex by 2·ey metres at lens.height / h pixels a metre
  const h = Math.max((2 * ey * lens.height) / fh, (2 * ex * lens.height) / fw, 1e-3) * margin;
  return keepUnder({ x: c.x, y: c.y, z: c.z, h, az, el }, lens, c, l + fw / 2, t + fh / 2);
}

// ---------------- the sun's shadow following the view ----------------
export interface ShadowOpts {
  /** direction towards the sun (any length) */
  dir: V3;
  /** smallest shadow half-width, metres (default 120) */
  radius?: number;
  /** the half-width grows in steps of this factor (default 1.6), so it rarely changes */
  grow?: number;
  /** fraction of the view height the shadow must cover (default 0.9) */
  cover?: number;
}
export function sunAxes(dir: V3) {
  const n = Math.hypot(dir.x, dir.y, dir.z);
  const d = { x: dir.x / n, y: dir.y / n, z: dir.z / n };
  // X = up × d, Y = d × X
  let X = { x: d.z, y: 0, z: -d.x };
  const m = Math.hypot(X.x, X.z) || 1;
  X = { x: X.x / m, y: 0, z: X.z / m };
  const Y = { x: d.y * X.z - d.z * X.y, y: d.z * X.x - d.x * X.z, z: d.x * X.y - d.y * X.x };
  return { d, X, Y };
}
/** Where the shadow box sits for a view: its half-width steps up in big jumps and its centre slides
 * in whole shadow-map texels (in light space), so edges don't shimmer as you pan and zoom. */
export function shadowFrame(v: View, o: ShadowOpts, mapSize: number) {
  const r0 = o.radius ?? 120, g = o.grow ?? 1.6, cover = o.cover ?? 0.9;
  const r = r0 * Math.pow(g, Math.max(0, Math.ceil(Math.log((v.h * cover) / r0) / Math.log(g))));
  const texel = (2 * r) / mapSize;
  const { d, X, Y } = sunAxes(o.dir);
  const vy = v.y ?? 0;
  const u = v.x * X.x + v.z * X.z, w = v.x * Y.x + vy * Y.y + v.z * Y.z;
  const du = Math.round(u / texel) * texel - u, dw = Math.round(w / texel) * texel - w;
  return { r, texel, dir: d, centre: { x: v.x + X.x * du + Y.x * dw, y: vy + X.y * du + Y.y * dw, z: v.z + X.z * du + Y.z * dw } };
}
