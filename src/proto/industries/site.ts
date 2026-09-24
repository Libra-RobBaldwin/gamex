// Fitting an industrial site to a plot, and the parts every site is made from: yards, internal
// roads, fences, rail sidings, lorry bays, sheds, chimneys, tanks, stockpiles and floodlights.
// Coordinates are site-local metres: x runs along the road frontage, +z faces the road, and the
// origin is the centre of the largest rectangle that fits inside the plot.
import type { Lot } from '../roads';
import { rectCorners } from '../roads';
import { Kit, rect, shadeHex, type XZ } from './kit';
import type { CargoId } from './catalogue';
import { CARGO } from './catalogue';
import { emptyDynamics, type Anchors, type Dynamics, type Pile } from './state';

export interface WXZ { x: number; z: number }

// A plot to build on: a simple polygon in world metres, and which way the road is.
export interface Plot {
  poly: WXZ[];
  facing?: WXZ; // direction from the site towards its road; otherwise the longest edge faces out
}

// Where a site sits in the world and the usable rectangle inside its plot.
export interface SiteFrame {
  cx: number; cz: number; rot: number; // world position of the local origin; local x = (cos rot, sin rot)
  w: number; d: number; // the inscribed rectangle, centred on the origin
  outline: XZ[]; // the plot itself, in local coordinates
}

// Same convention as a Lot: group.rotation.y = -rot puts local +z on the road side.
export const plotFromLot = (l: Lot): Plot => ({ poly: rectCorners(l.x, l.z, l.rot, l.w, l.d), facing: { x: -Math.sin(l.rot), z: Math.cos(l.rot) } });
export const plotRect = (cx: number, cz: number, rot: number, w: number, d: number): Plot => ({ poly: rectCorners(cx, cz, rot, w, d), facing: { x: -Math.sin(rot), z: Math.cos(rot) } });

export function toWorld(f: SiteFrame, x: number, z: number): WXZ {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  return { x: f.cx + x * c - z * s, z: f.cz + x * s + z * c };
}
export function toLocal(f: SiteFrame, p: WXZ): XZ {
  const c = Math.cos(f.rot), s = Math.sin(f.rot), dx = p.x - f.cx, dz = p.z - f.cz;
  return [dx * c + dz * s, -dx * s + dz * c];
}

function inPoly(x: number, z: number, poly: XZ[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function crosses(a: XZ, b: XZ, c: XZ, d: XZ) {
  const o = (p: XZ, q: XZ, r: XZ) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0;
}
// Is the axis-aligned rectangle [x0,x1] x [z0,z1] wholly inside the polygon?
function rectInside(x0: number, z0: number, x1: number, z1: number, poly: XZ[]) {
  const R: XZ[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  if (!R.every(([x, z]) => inPoly(x, z, poly))) return false;
  if (poly.some(([x, z]) => x > x0 + 1e-6 && x < x1 - 1e-6 && z > z0 + 1e-6 && z < z1 - 1e-6)) return false;
  for (let i = 0; i < 4; i++) for (let j = 0; j < poly.length; j++) if (crosses(R[i], R[(i + 1) % 4], poly[j], poly[(j + 1) % poly.length])) return false;
  return true;
}

// Orient the site to face its road, then find a large rectangle inside the plot: shrink the
// plot's bounding box until it fits, then push each side out again while it still fits. Not the
// true largest rectangle, but close for the near-convex plots roads leave, and cheap.
export function fitPlot(plot: Plot): SiteFrame {
  const P = plot.poly;
  let ax = 0, az = 0, A = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], k = p.x * q.z - q.x * p.z;
    A += k; ax += (p.x + q.x) * k; az += (p.z + q.z) * k;
  }
  const c = Math.abs(A) > 1e-9 ? { x: ax / (3 * A), z: az / (3 * A) } : { x: P.reduce((s, p) => s + p.x, 0) / P.length, z: P.reduce((s, p) => s + p.z, 0) / P.length };
  let n = plot.facing;
  if (!n) {
    let best = -1;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], L = Math.hypot(q.x - p.x, q.z - p.z);
      if (L <= best) continue;
      best = L;
      let nx = -(q.z - p.z) / L, nz = (q.x - p.x) / L;
      const mx = (p.x + q.x) / 2 - c.x, mz = (p.z + q.z) / 2 - c.z;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      n = { x: nx, z: nz };
    }
  }
  const nl = Math.hypot(n!.x, n!.z) || 1;
  const rot = Math.atan2(-n!.x / nl, n!.z / nl);
  const f0: SiteFrame = { cx: c.x, cz: c.z, rot, w: 0, d: 0, outline: [] };
  const L = P.map((p) => toLocal(f0, p));
  let x0 = Math.min(...L.map((p) => p[0])), x1 = Math.max(...L.map((p) => p[0])), z0 = Math.min(...L.map((p) => p[1])), z1 = Math.max(...L.map((p) => p[1]));
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
  let ok = false;
  for (let s = 1; s > 0.05; s -= 0.02) {
    x0 = mx - hw * s; x1 = mx + hw * s; z0 = mz - hd * s; z1 = mz + hd * s;
    if (rectInside(x0, z0, x1, z1, L)) { ok = true; break; }
  }
  if (ok) {
    const step = Math.max(0.25, Math.max(hw, hd) / 80);
    for (let moved = true, guard = 0; moved && guard < 400; guard++) {
      moved = false;
      if (rectInside(x0 - step, z0, x1, z1, L)) { x0 -= step; moved = true; }
      if (rectInside(x0, z0, x1 + step, z1, L)) { x1 += step; moved = true; }
      if (rectInside(x0, z0 - step, x1, z1, L)) { z0 -= step; moved = true; }
      if (rectInside(x0, z0, x1, z1 + step, L)) { z1 += step; moved = true; }
    }
  }
  const rc = toWorld(f0, (x0 + x1) / 2, (z0 + z1) / 2);
  const f: SiteFrame = { cx: rc.x, cz: rc.z, rot, w: x1 - x0, d: z1 - z0, outline: [] };
  f.outline = P.map((p) => toLocal(f, p));
  return f;
}

// ---------------- palette ----------------
export const PAL = {
  grass: '#7da35a', rough: '#8f9c5e', yard: '#b4afa4', concrete: '#c6c1b6', tarmac: '#56595e', gravel: '#a89f8b', ballast: '#8b847a',
  rail: '#5d5853', sleeper: '#5a4636', water: '#3d6c89', fence: '#34453a', line: '#e9e4d0', yellow: '#e2b93b',
  brick: '#9a4b35', darkBrick: '#7a3b2e', stone: '#cfc4ad', steel: '#7f8a93', rust: '#8e5a3c', white: '#e9e7e1', roof: '#5b636b',
  cladding: '#8a969e', green: '#4e7a58', blue: '#3f6d93', glass: '#3e5366', soot: '#3a3836', timber: '#8a6446',
};

// ---------------- the site builder ----------------
export class Site {
  k = new Kit();
  dyn: Dynamics = emptyDynamics();
  anchors: Anchors = { gate: { x: 0, z: 0 }, lorry: [], rail: [], quay: [] };
  notes: string[] = [];
  readonly W: number;
  readonly D: number;
  readonly front: number; // z of the frontage
  readonly back: number;
  constructor(public frame: SiteFrame, public r: () => number, public year: number) {
    this.W = frame.w; this.D = frame.d; this.front = frame.d / 2; this.back = -frame.d / 2;
  }
  pick<T>(arr: readonly T[]) { return arr[Math.floor(this.r() * arr.length) % arr.length]; }
  range(a: number, b: number) { return a + this.r() * (b - a); }

  // grass over the whole plot, so the parts of an odd-shaped plot outside the rectangle aren't bare
  ground(hex = PAL.grass) { this.k.flat(this.frame.outline, 0.02, hex); }
  pad(x: number, z: number, w: number, d: number, hex: string, y = 0.05) { this.k.flat(rect(x, z, w, d), y, hex); }
  // An internal road along a path, with a slightly wider patch at each joint to hide the seams.
  road(path: XZ[], width = 7, hex = PAL.tarmac) {
    for (let i = 1; i < path.length; i++) {
      const [ax, az] = path[i - 1], [bx, bz] = path[i], L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      this.k.at((ax + bx) / 2, (az + bz) / 2, -Math.atan2(bz - az, bx - ax), () => this.k.flat(rect(0, 0, L + width, width), 0.07, hex));
    }
  }
  // Palisade fence round the plot, with a gate gap on the frontage where the site road leaves.
  fence(gateX: number, gateW = 9, hex = PAL.fence) {
    const O = this.frame.outline;
    const cz = O.reduce((s, p) => s + p[1], 0) / O.length;
    let frontEdge = 0, bestZ = -Infinity;
    for (let i = 0; i < O.length; i++) { const zz = (O[i][1] + O[(i + 1) % O.length][1]) / 2; if (zz > bestZ) { bestZ = zz; frontEdge = i; } }
    for (let i = 0; i < O.length; i++) {
      let [ax, az] = O[i], [bx, bz] = O[(i + 1) % O.length];
      // pull the fence half a metre inside the plot line
      const inset = (x: number, z: number): XZ => { const L = Math.hypot(x, z - cz) || 1; return [x - (x / L) * 0.5, z - ((z - cz) / L) * 0.5]; };
      [ax, az] = inset(ax, az); [bx, bz] = inset(bx, bz);
      if (i !== frontEdge) { this.k.beam(ax, az, bx, bz, 0, 2, 0.12, hex); continue; }
      const L = Math.hypot(bx - ax, bz - az), t = ((gateX - ax) * (bx - ax) + (this.front - az) * (bz - az)) / (L * L), g = gateW / 2 / L;
      const lerp = (u: number): XZ => [ax + (bx - ax) * u, az + (bz - az) * u];
      const t0 = Math.max(0, t - g), t1 = Math.min(1, t + g);
      if (t0 > 0.01) { const p = lerp(t0); this.k.beam(ax, az, p[0], p[1], 0, 2, 0.12, hex); this.k.box(p[0], 0, p[1], 0.4, 2.4, 0.4, PAL.yellow); }
      if (t1 < 0.99) { const p = lerp(t1); this.k.beam(p[0], p[1], bx, bz, 0, 2, 0.12, hex); this.k.box(p[0], 0, p[1], 0.4, 2.4, 0.4, PAL.yellow); }
    }
    this.anchors.gate = { x: gateX, z: this.front };
  }
  // The usual way in: a road from the gate to a point inside, and the fence round it all.
  entrance(gateX: number, to: XZ[], width = 7) {
    this.road([[gateX, this.front - width / 2], ...to], width); // road patches overrun their ends by half a width
    this.fence(gateX, width + 2);
  }
  // Rail sidings along x at z, with buffer stops. Each track is ballast and two rails.
  siding(z: number, x0: number, x1: number, tracks = 1, wagons = 0, wagonCol = '#5a4a3a') {
    const k = this.k;
    for (let t = 0; t < tracks; t++) {
      const zz = z + t * 4.5;
      k.flat(rect((x0 + x1) / 2, zz, x1 - x0, 3.4), 0.06, PAL.ballast);
      for (const s of [-0.72, 0.72]) k.beam(x0, zz + s, x1, zz + s, 0.06, 0.16, 0.1, PAL.rail);
      k.box(x0 + 0.6, 0, zz, 0.8, 1.1, 2.6, '#b03a2e');
      this.anchors.rail.push({ x0, x1, z: zz });
      for (let i = 0; i < wagons; i++) this.dyn.berths.push({ kind: 'wagon', x: x0 + 8 + i * 11, z: zz, rot: 0, len: 10 });
      void wagonCol;
    }
    this.notes.push(tracks > 1 ? `${tracks} rail sidings` : 'rail siding');
  }
  // Lorry bays: painted stands on a hard standing, with the lorry berth the economy can fill.
  bays(x: number, z: number, n: number, rot = 0, spacing = 4.5) {
    const k = this.k;
    k.at(x, z, rot, () => {
      k.flat(rect(0, 0, n * spacing + 1, 18), 0.06, PAL.tarmac);
      for (let i = 0; i <= n; i++) k.flat(rect(-(n * spacing) / 2 + i * spacing, 0, 0.15, 16), 0.08, PAL.line);
    });
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const lx = -(n * spacing) / 2 + (i + 0.5) * spacing;
      const bx = x + lx * c, bz = z - lx * s;
      this.dyn.berths.push({ kind: 'lorry', x: bx, z: bz, rot, len: 12 });
      this.anchors.lorry.push({ x: bx, z: bz, rot });
    }
    this.notes.push(`${n} lorry bay${n === 1 ? '' : 's'}`);
  }
  quay(z: number, x0: number, x1: number) {
    const k = this.k;
    k.flat(rect((x0 + x1) / 2, (z + this.back) / 2 - 1, x1 - x0, z - this.back + 2), 0.04, PAL.water); // above the plot's grass
    k.box((x0 + x1) / 2, -1.2, z + 0.6, x1 - x0, 1.35, 1.2, PAL.stone);
    for (let x = x0 + 4; x < x1 - 2; x += 12) k.prism(x, z + 1.6, 0.3, 6, 0.15, 0.6, '#2b2b2b');
    this.anchors.quay.push({ x0, x1, z });
    this.dyn.berths.push({ kind: 'ship', x: (x0 + x1) / 2, z: z - 9, rot: 0, len: Math.min(90, x1 - x0 - 10) });
    this.notes.push('quay');
  }

  // ---------------- buildings ----------------
  // Horizontal window bands on the faces a top-down camera sees, and a lit window or two at night.
  bands(x: number, z: number, w: number, d: number, y0: number, floors: number, fh: number, hex = PAL.glass, lit = true) {
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh + fh * 0.35;
      this.k.box(x, y, z + d / 2 + 0.03, w * 0.86, fh * 0.35, 0.08, hex);
      this.k.box(x + w / 2 + 0.03, y, z, 0.08, fh * 0.35, d * 0.86, hex);
      if (lit && this.r() < 0.6) this.dyn.lamps.push({ x: x + (this.r() - 0.5) * w * 0.7, y: y + fh * 0.17, z: z + d / 2 + 0.12, glow: 0 });
    }
  }
  // A shed with a gable roof. Ridge along x unless `alongZ`.
  shed(x: number, z: number, w: number, d: number, h: number, wall: string, roof: string, rise = 2.2, alongZ = false) {
    const k = this.k;
    k.box(x, 0, z, w, h, d, wall, false);
    if (alongZ) k.at(x, z, Math.PI / 2, () => k.gable(0, 0, d, w, h, rise, roof, wall));
    else k.gable(x, z, w, d, h, rise, roof, wall);
  }
  // A flat-roofed block with a parapet line.
  block(x: number, z: number, w: number, d: number, h: number, wall: string, roof = PAL.roof, floors = 0) {
    this.k.box(x, 0, z, w, h, d, wall);
    this.k.flat(rect(x, z, w - 0.6, d - 0.6), h + 0.02, roof);
    if (floors) this.bands(x, z, w, d, 0, floors, h / floors);
  }
  office(x: number, z: number, w = 14, d = 8, floors = 2, wall = PAL.brick) {
    this.block(x, z, w, d, floors * 3.2, wall, PAL.roof, floors);
    this.notes.push(floors > 1 ? `${floors}-storey offices` : 'site office');
  }
  // Big doors on the front of a shed (loading doors, or a lorry-sized arch).
  doors(x: number, z: number, n: number, span: number, h = 4.5, hex = '#4d5258') {
    for (let i = 0; i < n; i++) this.k.box(x - span / 2 + (i + 0.5) * (span / n), 0, z + 0.05, Math.min(4, (span / n) * 0.7), h, 0.12, hex);
  }
  chimney(x: number, z: number, r: number, h: number, hex = PAL.brick, smoke: 'smoke' | 'steam' | 'none' = 'smoke', n = 8) {
    this.k.prism(x, z, r, n, 0, h, hex, r * 0.72);
    this.k.prism(x, z, r * 0.8, n, h - 1.2, 1.3, PAL.soot, r * 0.8);
    if (smoke !== 'none') this.dyn.emitters.push({ kind: smoke, x, y: h + 0.4, z, r: r * 0.9, rise: 14 + h * 0.4, puffs: 6 });
    this.dyn.lamps.push({ x, y: h - 2, z: z + r * 0.75, glow: 0 }); // aircraft warning light
  }
  // Hyperbolic cooling tower, open at the top with a steam plume.
  coolingTower(x: number, z: number, r: number, h: number, hex = '#c9c3b6') {
    const prof: [number, number][] = [[r, 0], [r * 0.9, h * 0.22], [r * 0.72, h * 0.55], [r * 0.64, h * 0.8], [r * 0.67, h]];
    this.k.lathe(x, z, prof, 14, hex, '#5f5b55');
    for (let i = 0; i < 14; i += 2) { const a = (i / 14) * Math.PI * 2; this.k.box(x + Math.cos(a) * r, 0, z + Math.sin(a) * r, 1.2, 2.4, 1.2, shadeHex(hex, 0.8)); }
    this.dyn.emitters.push({ kind: 'steam', x, y: h, z, r: r * 0.6, rise: h * 0.9, puffs: 7 });
  }
  // An open-topped tank or silo; the floating roof or grain surface inside is a stockpile.
  tank(x: number, z: number, r: number, h: number, cargo: CargoId, role: 'in' | 'out', hex = '#d9d6cf', n = 12) {
    this.k.lathe(x, z, [[r, 0], [r, h]], n, hex, '#403d3a');
    this.k.prism(x, z, r * 0.98, n, 0, 0.08, '#4a4744');
    this.k.prism(x, z, r + 0.15, n, h - 0.25, 0.3, shadeHex(hex, 0.8), r + 0.15, false);
    this.dyn.piles.push({ kind: 'tank', cargo, role, x, z, rot: 0, w: r * 1.9, d: r * 1.9, h: h - 0.9, y: 0.1, colour: CARGO[cargo].colour });
  }
  silo(x: number, z: number, r: number, h: number, cargo: CargoId, role: 'in' | 'out', hex = '#c9ccce') {
    this.k.prism(x, z, r * 0.5, 8, 0, 2.5, '#6c6f72', r); // hopper
    this.k.lathe(x, z, [[r, 2.5], [r, h]], 10, hex, '#403d3a');
    this.dyn.piles.push({ kind: 'tank', cargo, role, x, z, rot: 0, w: r * 1.9, d: r * 1.9, h: h - 3.2, y: 2.4, colour: CARGO[cargo].colour });
  }
  // Stockpiles: a hard standing, low bay walls, and the pile fx.ts scales with stock.
  heap(x: number, z: number, w: number, d: number, h: number, cargo: CargoId, role: 'in' | 'out', walls = true, rot = 0) {
    const k = this.k;
    k.at(x, z, rot, () => {
      k.flat(rect(0, 0, w + 3, d + 3), 0.05, PAL.concrete);
      if (walls) { k.box(0, 0, -d / 2 - 1, w + 3, 1.6, 0.6, PAL.concrete); for (const s of [-1, 1]) k.box(s * (w / 2 + 1.2), 0, 0, 0.6, 1.6, d + 2, PAL.concrete); }
    });
    this.dyn.piles.push({ kind: 'heap', cargo, role, x, z, rot, w, d, h, colour: CARGO[cargo].colour });
  }
  logs(x: number, z: number, w: number, d: number, cargo: CargoId, role: 'in' | 'out', slots = 6, rot = 0) {
    this.k.at(x, z, rot, () => this.k.flat(rect(0, 0, w + 2, d + 2), 0.05, PAL.gravel));
    this.dyn.piles.push({ kind: 'logs', cargo, role, x, z, rot, w, d, h: 3, slots, colour: CARGO[cargo].colour });
  }
  stack(x: number, z: number, w: number, d: number, cargo: CargoId, role: 'in' | 'out', slots = 6, layers = 3, h = 1.2, palette?: string[], rot = 0) {
    this.k.at(x, z, rot, () => this.k.flat(rect(0, 0, w + 1.5, d + 1.5), 0.05, PAL.concrete));
    this.dyn.piles.push({ kind: 'stack', cargo, role, x, z, rot, w, d, h, slots, layers, palette, colour: CARGO[cargo].colour });
  }
  herd(x: number, z: number, w: number, d: number, n: number) {
    this.dyn.piles.push({ kind: 'herd', cargo: 'livestock', role: 'out', x, z, rot: 0, w, d, h: 1.4, slots: n, colour: CARGO.livestock.colour });
  }
  // An inclined conveyor on trestles, with loads running along it.
  conveyor(x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, load: string, hex = '#6a6f74') {
    const k = this.k;
    k.beam(x0, z0, x1, z1, y0, 1.1, 1.8, hex, y1);
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.floor(L / 9));
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1), y = y0 + (y1 - y0) * t;
      k.box(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, 0.5, y, 0.5, shadeHex(hex, 0.8));
    }
    this.dyn.movers.push({ kind: 'conveyor', x: x0, y: y0 + 1.1, z: z0, rot: Math.atan2(-(z1 - z0), x1 - x0), len: L, rise: y1 - y0, colour: hex, load, phase: this.r() });
    this.notes.push('conveyor');
  }
  // Pithead frame: two legs, a back stay and the winding wheels on top.
  headframe(x: number, z: number, h: number, hex: string, wheels = 2, rot = 0, lattice = false) {
    const k = this.k;
    k.at(x, z, rot, () => {
      for (const s of [-1, 1]) {
        k.beam(s * 2.2, 1.8, s * 1.2, 0.8, 0, 0.6, 0.6, hex, h);
        k.beam(s * 2, -h * 0.55, s * 1.2, -0.4, 0, 0.5, 0.5, hex, h * 0.95); // back stay towards the engine house
      }
      if (lattice) for (let y = 4; y < h - 2; y += 4) k.box(0, y, 1.3, 3.6, 0.3, 0.3, hex);
      k.box(0, h, 0.2, 3.4, 0.6, 2.8, hex);
    });
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < wheels; i++) {
      const lz = wheels === 1 ? 0.2 : -0.5 + i * 1.4;
      this.dyn.rotors.push({ kind: 'wheel', x: x + lz * s, y: h + 2.4, z: z + lz * c, r: 2.4, rot, speed: i % 2 ? -1.6 : 1.6, colour: '#3b3f44' });
    }
    this.notes.push(wheels > 1 ? 'headframe with twin winding wheels' : 'headframe');
  }
  floodlight(x: number, z: number, h = 12) {
    this.k.box(x, 0, z, 0.35, h, 0.35, '#5c6166');
    this.k.box(x, h, z, 1.4, 0.5, 0.8, '#3c4045');
    this.dyn.lamps.push({ x, y: h - 0.1, z, glow: h * 1.1 });
  }
  tree(x: number, z: number, s: number, kind: 'conifer' | 'broadleaf' | 'young', hex?: string) {
    const k = this.k;
    k.box(x, 0, z, 0.35 * s, 1.2 * s, 0.35 * s, '#5a4330');
    if (kind === 'conifer') k.prism(x, z, 1.5 * s, 6, 0.9 * s, 5.5 * s, hex ?? '#35613a', 0);
    else if (kind === 'young') k.prism(x, z, 0.8 * s, 5, 0.6 * s, 2.2 * s, hex ?? '#6a9a42', 0);
    else { k.prism(x, z, 1.1 * s, 6, 1 * s, 1.6 * s, hex ?? '#4f8a36', 2 * s, false); k.prism(x, z, 2 * s, 6, 2.6 * s, 2.2 * s, hex ?? '#4f8a36', 0.6 * s); }
  }
  // Slewing jib crane on a tower or portal.
  jibCrane(x: number, z: number, h: number, len: number, hex = PAL.yellow, portal = false) {
    const k = this.k;
    if (portal) { for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(x + a * 2.5, 0, z + b * 2.5, 0.6, h * 0.5, 0.6, hex); k.box(x, h * 0.5, z, 6, 1, 6, hex); k.box(x, h * 0.5 + 1, z, 2.4, h * 0.5 - 1, 2.4, hex); }
    else k.box(x, 0, z, 1.6, h, 1.6, hex);
    this.dyn.movers.push({ kind: 'jib', x, y: h, z, rot: this.r() * Math.PI * 2, len, colour: hex, phase: this.r() });
  }
  // Ship-to-shore gantry crane straddling the quay; the trolley and its box travel out and back.
  gantry(x: number, z: number, h: number, span: number, reach: number, hex = '#c8452f', load = '#2f6f9e') {
    const k = this.k;
    for (const s of [-1, 1]) for (const zz of [z + span / 2, z - span / 2]) k.box(x + s * 5, 0, zz, 0.9, h, 0.9, hex);
    for (const s of [-1, 1]) k.beam(x + s * 5, z + span / 2 + 4, x + s * 5, z - span / 2 - reach, h, 1.2, 0.9, hex);
    k.box(x, h + 1.2, z, 11, 0.8, 1.2, hex);
    this.dyn.movers.push({ kind: 'gantry', x, y: h, z: z + span / 2, rot: Math.PI / 2, len: span + reach, colour: '#3a3a3a', load, phase: this.r() });
  }
  // Scatter weeds and rubble over the yards; they appear as the site is neglected.
  decay(n: number) {
    for (let i = 0; i < n; i++) this.dyn.decay.push({ x: (this.r() - 0.5) * this.W * 0.9, z: (this.r() - 0.5) * this.D * 0.9, s: 0.6 + this.r() * 1.4 });
  }
  pile(p: Pile) { this.dyn.piles.push(p); }
}
