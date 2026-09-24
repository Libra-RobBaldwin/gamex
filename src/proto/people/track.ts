// Where a figure is at any moment, worked out from a handful of numbers rather than stepped
// each frame. A route is a chain of legs; each leg is a straight line or a circular arc
// (start, heading, curvature, length). A figure walks along the route at its own speed from
// its own offset, looping or once, so the GPU can place it from the clock alone. This file is
// the CPU twin of the vertex shader's maths (shaders.ts), used by tests and by the placement
// layer when it needs to know where someone is (for example to hand them over to a bus).
import { clamp, polyLength, smooth, wrapAngle, type XZ } from './util';

// Heading `h` is measured in the x–z plane: direction (cos h, sin h). Positive curvature turns
// towards +h. "Left" of travel is (sin a, −cos a), looking down on the map.
export interface Leg { x: number; z: number; h: number; k: number; L: number; S: number }
export interface Route { legs: Leg[]; length: number; closed: boolean }

export function legPoint(l: Leg, s: number) {
  const a = l.h + l.k * s;
  if (Math.abs(l.k) < 1e-6) return { x: l.x + Math.cos(l.h) * s, z: l.z + Math.sin(l.h) * s, a };
  return { x: l.x + (Math.sin(a) - Math.sin(l.h)) / l.k, z: l.z + (Math.cos(l.h) - Math.cos(a)) / l.k, a };
}
export function routePoint(r: Route, s: number) {
  let leg = r.legs[r.legs.length - 1];
  for (const l of r.legs) if (s < l.S + l.L) { leg = l; break; }
  return legPoint(leg, clamp(s - leg.S, 0, leg.L));
}

// Fits a polyline with a chain of arcs, each starting on the heading the last one ended on, so
// people turn smoothly and a gently curving footway needs only one or two legs (every leg
// costs a full draw of each figure on it, so few legs matter more than a perfect fit).
export function fitRoute(pts: XZ[], tol = 0.25, closed = false): Route {
  const p = pts.filter((q, i) => i === 0 || Math.hypot(q.x - pts[i - 1].x, q.z - pts[i - 1].z) > 1e-6);
  if (closed && p.length > 2 && Math.hypot(p[0].x - p[p.length - 1].x, p[0].z - p[p.length - 1].z) > 1e-6) p.push(p[0]);
  if (p.length < 2) return { legs: [{ x: p[0]?.x ?? 0, z: p[0]?.z ?? 0, h: 0, k: 0, L: 0.01, S: 0 }], length: 0.01, closed };
  const legs: Leg[] = [];
  let i = 0, h = Math.atan2(p[1].z - p[0].z, p[1].x - p[0].x), S = 0;
  if (closed && p.length > 3) {
    // start on the heading that the closing corner averages to, so the loop joins smoothly
    const a = p[p.length - 2], b = p[0], c = p[1];
    h = Math.atan2(Math.sin(Math.atan2(b.z - a.z, b.x - a.x)) + Math.sin(Math.atan2(c.z - b.z, c.x - b.x)), Math.cos(Math.atan2(b.z - a.z, b.x - a.x)) + Math.cos(Math.atan2(c.z - b.z, c.x - b.x)));
  }
  while (i < p.length - 1) {
    let best = arcTo(p[i], h, p[i + 1]), bestJ = i + 1;
    for (let j = i + 2; j < p.length; j++) {
      const a = arcTo(p[i], h, p[j]);
      // a leg can't swing round more than half a turn, or bulge off the points it covers
      if (Math.abs(a.k * a.L) > Math.PI * 0.9) break;
      let ok = true;
      for (let q = i + 1; q < j && ok; q++) if (arcDev(p[i], h, a.k, p[q]) > tol) ok = false;
      if (!ok) break;
      best = a; bestJ = j;
    }
    // a corner sharper than the arc can follow: turn on the spot (a zero-length leg is free)
    if (Math.abs(best.k * best.L) > Math.PI * 0.9) {
      const chord = Math.atan2(p[bestJ].z - p[i].z, p[bestJ].x - p[i].x);
      best = { k: 0, L: Math.hypot(p[bestJ].x - p[i].x, p[bestJ].z - p[i].z) };
      h = chord;
    }
    legs.push({ x: p[i].x, z: p[i].z, h, k: best.k, L: best.L, S });
    S += best.L;
    h = h + best.k * best.L;
    i = bestJ;
  }
  return { legs, length: S, closed };
}
function arcTo(a: XZ, h: number, b: XZ) {
  const dx = b.x - a.x, dz = b.z - a.z, c = Math.hypot(dx, dz);
  const th = wrapAngle(Math.atan2(dz, dx) - h);
  if (Math.abs(th) < 1e-5) return { k: 0, L: c };
  const L = (c * th) / Math.sin(th);
  return { k: (2 * th) / L, L };
}
function arcDev(a: XZ, h: number, k: number, q: XZ) {
  if (Math.abs(k) < 1e-6) return Math.abs((q.x - a.x) * Math.sin(h) - (q.z - a.z) * Math.cos(h));
  const cx = a.x - Math.sin(h) / k, cz = a.z + Math.cos(h) / k;
  return Math.abs(Math.hypot(q.x - cx, q.z - cz) - 1 / Math.abs(k));
}
// A route straight from the points given, one leg per piece (for short fixed paths: a walk to
// a bus door, across a road).
export function straightRoute(pts: XZ[]): Route {
  const legs: Leg[] = [];
  let S = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    legs.push({ x: a.x, z: a.z, h: Math.atan2(b.z - a.z, b.x - a.x), k: 0, L, S });
    S += L;
  }
  if (!legs.length) legs.push({ x: pts[0].x, z: pts[0].z, h: 0, k: 0, L: 0.01, S: 0 });
  return { legs, length: Math.max(S, 0.01), closed: false };
}
export function circleRoute(c: XZ, R: number, start = 0, ccw = true): Route {
  const h = start + (ccw ? Math.PI / 2 : -Math.PI / 2);
  const x = c.x + Math.cos(start) * R, z = c.z + Math.sin(start) * R;
  const L = 2 * Math.PI * R;
  return { legs: [{ x, z, h, k: (ccw ? 1 : -1) / R, L, S: 0 }], length: L, closed: true };
}
export function reverseRoute(r: Route): Route {
  const legs: Leg[] = [];
  let S = 0;
  for (let i = r.legs.length - 1; i >= 0; i--) {
    const l = r.legs[i], e = legPoint(l, l.L);
    legs.push({ x: e.x, z: e.z, h: e.a + Math.PI, k: -l.k, L: l.L, S });
    S += l.L;
  }
  return { legs, length: r.length, closed: r.closed };
}
export const routeLengthOf = (pts: XZ[]) => polyLength(pts);

// ---------- a figure's motion, as the shader sees it ----------
export const Mode = { Loop: 0, Closed: 1, Once: 2, Still: 3 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];
export const LEG_FIRST = 1, LEG_LAST = 2, NO_FADE_IN = 4, NO_FADE_OUT = 8;
export interface Motion {
  mode: Mode; v: number; s0: number; lat: number; t0: number; tShow: number; tHide: number; y: number;
}
export const FADE_S = 0.6; // seconds a figure takes to fade in or out

// Distance along the whole route at time t, whether moving, and the time-window and route-end
// fades. Mirrors `routeS()` and `motionAlpha()` in the shader.
export function routeS(m: Motion, total: number, t: number) {
  if (m.mode === Mode.Loop || m.mode === Mode.Closed) {
    const sr = (((m.s0 + m.v * t) % total) + total) % total;
    return { sr, moving: m.v > 0.01 };
  }
  if (m.mode === Mode.Once) {
    const raw = m.s0 + m.v * Math.max(0, t - m.t0);
    return { sr: Math.min(raw, total), moving: t > m.t0 && raw < total && m.v > 0.01 };
  }
  return { sr: m.s0, moving: false };
}
export function motionAlpha(m: Motion, total: number, sr: number, t: number, flags = 0) {
  let a = 1;
  if (m.mode === Mode.Loop) a *= smooth(0, 1.2, sr) * smooth(0, 1.2, total - sr);
  if (m.tHide > m.tShow) {
    a *= flags & NO_FADE_IN ? (t >= m.tShow ? 1 : 0) : smooth(m.tShow, m.tShow + FADE_S, t);
    a *= flags & NO_FADE_OUT ? (t < m.tHide ? 1 : 0) : 1 - smooth(m.tHide - FADE_S, m.tHide, t);
  }
  return a;
}
// Where a figure on a route is at time t: position, heading and how visible (0–1).
export function figureAt(r: Route, m: Motion, t: number) {
  const { sr, moving } = routeS(m, r.length, t);
  const p = routePoint(r, sr);
  const x = p.x + Math.sin(p.a) * m.lat, z = p.z - Math.cos(p.a) * m.lat;
  return { x, z, y: m.y, a: p.a, sr, moving, alpha: motionAlpha(m, r.length, sr, t) };
}
