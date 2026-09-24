// Passenger doors: where they are on every car, bus and coach, how they're drawn, how they open,
// and where they are in the world so passengers can walk to them.
//
//   doorsOf(model)        – the doors, in model space (the single source for the geometry too)
//   drawDoors(kit, model) – the door leaves, frames, windows, handles, buttons and lamps
//   DoorStates            – setDoors(id, open) per vehicle, animated at each door kind's own speed
//   dwellDoors(t, dwell)  – the same without state: open and close through a stop
//   doorPositions(...)    – each door's world position and which side it's on, for a placed vehicle
//
// Kinds follow the stock: hinged slam doors on old carriages and units (many of them, one per
// compartment on non-corridor stock); pocket doors that slide into the body on 1980s–90s units
// and metro cars (bi-parting, three a side on a metro car); plug doors that step out then slide
// on modern units, trams and buses; folding (jack-knife) doors on older buses; and open platforms
// with no door at all on half-cab buses and balcony trams.
import { Kit, C, paint, fixed, type Style } from './kit';
import type { Model } from './types';
import { LIGHT } from './types';
import { MOTION, DOOR_SECONDS, ease, type DoorKind as MovingKind } from './motion';

export type Side = 'left' | 'right'; // the driver's left (−z) and right (+z); left is the kerb side in Britain
export type DoorKind = MovingKind | 'open';
export interface Door {
  x: number; // middle of the doorway, metres forward of the model's middle
  width: number; // clear opening
  y0: number; y1: number; // sill and head, metres above the ground
  leaves: 1 | 2;
  kind: DoorKind;
  sides: Side[];
  // a single leaf slides (or, for a slam door, is hinged) towards this end: 1 front, −1 back
  dir: 1 | -1;
}

// ---------------- layouts ----------------

type Nose = 'flat' | 'raked' | 'curved' | 'short' | 'angled' | 'wedge' | 'needle' | 'none';
const num = (m: Model, k: string, d: number) => (typeof m.design[k] === 'number' ? (m.design[k] as number) : d);
const str = (m: Model, k: string, d: string) => (typeof m.design[k] === 'string' ? (m.design[k] as string) : d);
const yearOf = (m: Model) => num(m, 'year', m.from);

// The shape of a locomotive, unit car, coach or tram body: floor height, noses, and the stretch of
// straight side (bx0..bx1) where windows and doors go. rail.ts builds the body from this.
export function railLayout(m: Model) {
  const g = m.design, style = m.style, L = m.dims.length, H = m.dims.height;
  const tram = style === 'tram';
  const metro = style === 'metro-car';
  const loco = style === 'diesel-loco' || style === 'electric-loco';
  const floor = tram ? 0.35 : style === 'hs-power' || loco || metro ? 1.0 : 1.15;
  const cab = loco || style === 'hs-power' || g.cab === true || style === 'rack-car';
  const nose0 = str(m, 'nose', 'flat') as Nose;
  let front: Nose = 'flat', back: Nose = 'flat';
  if (loco) { front = back = nose0; }
  else if (style === 'hs-power') { front = yearOf(m) >= 2008 ? 'needle' : 'wedge'; back = 'flat'; }
  else if (style === 'rack-car') { front = back = 'raked'; }
  else if (cab) { front = tram ? 'curved' : nose0; back = 'flat'; }
  const x0 = -L / 2, x1 = L / 2;
  const nl = front === 'wedge' || front === 'needle' ? num(m, 'noseLen', 4) : front === 'curved' || front === 'short' ? 1.9 : 0.9;
  const bx0 = x0 + (cab && back !== 'flat' ? nl : 0.3), bx1 = x1 - (cab ? nl + 0.3 : 0.3);
  const h = H - floor;
  const wy0 = floor + h * (tram ? 0.26 : 0.3), wy1 = floor + h * (tram ? 0.78 : 0.62);
  return { tram, metro, loco, floor, cab, front, back, x0, x1, nl, bx0, bx1, h, wy0, wy1 };
}

// The bus and coach door openings (model space), shared with buses.ts.
export function busLayout(m: Model) {
  const d = m.dims, style = m.style, L = d.length, H = d.height;
  const coach = style === 'coach', decker = style === 'bus-double';
  const front = str(m, 'front', 'flat');
  const rake = front === 'flat' ? 0.08 : front === 'raked' ? (coach ? 0.9 : 0.35) : 0.5;
  const xN = L / 2;
  const rearHalf = style === 'bus-bendy-rear', frontHalf = style === 'bus-bendy';
  const lowFloor = m.design.lowFloor === true;
  // the back of the front half and the front of the rear half stop short of the turntable, and
  // the bellows fill the gap
  const bodyX0 = frontHalf ? -L / 2 + 0.85 : -L / 2;
  const bodyX1 = rearHalf ? L / 2 - 0.25 : xN;
  const x0 = bodyX0 + (rearHalf ? 0.1 : 0.4), x1 = rearHalf ? bodyX1 - 0.1 : xN - rake - 0.35;
  const sill = coach ? 1.55 : style === 'bus-single' || frontHalf || rearHalf ? (lowFloor ? 1.05 : 1.2) : 1.05;
  const y0 = coach ? 0.42 : lowFloor ? 0.3 : 0.38;
  const y1 = decker ? 2.3 : coach ? Math.min(H - 0.4, 2.45) : Math.min(H - 0.45, 2.6);
  const doorFront: [number, number] | null = rearHalf ? null : coach ? [xN - 1.5, xN - 0.5] : [xN - rake - 1.35, xN - rake - 0.2];
  const year = yearOf(m);
  const midDoor = (style === 'bus-single' && L > 11) || rearHalf || frontHalf || (decker && year >= 1968 && L >= 9.6 && m.seed % 2 === 0);
  const mid = (x0 + x1) / 2 - (frontHalf ? 0.4 : 0);
  const doorMid: [number, number] | null = midDoor ? [mid - 0.62, mid + 0.62] : null;
  return { coach, decker, rake, xN, rearHalf, frontHalf, bodyX0, bodyX1, x0, x1, sill, y0, y1, doorFront, doorMid };
}

const cache = new Map<string, Door[]>();
// Every passenger door on a model, front to back.
export function doorsOf(m: Model): Door[] {
  let d = cache.get(m.id);
  if (!d) { d = compute(m).sort((a, b) => b.x - a.x); cache.set(m.id, d); }
  return d;
}

function compute(m: Model): Door[] {
  const both: Side[] = ['left', 'right'];
  const year = yearOf(m), style = m.style;
  if (m.category === 'bus') {
    if (style === 'bus-halfcab') {
      // the open platform at the back, nearside
      const L = m.dims.length;
      return [{ x: -L / 2 + 0.6, width: 0.95, y0: 0.4, y1: 2.2, leaves: 1, kind: 'open', sides: ['left'], dir: -1 }];
    }
    if (style === 'bus-heritage') {
      const xS = m.dims.length / 2 - num(m, 'bonnet', 1.6);
      return [{ x: xS - 0.62, width: 0.8, y0: 0.5, y1: 2.35, leaves: 1, kind: 'fold', sides: ['left'], dir: 1 }];
    }
    const b = busLayout(m);
    const kind: DoorKind = year < 1990 ? 'fold' : 'plug';
    const out: Door[] = [];
    const add = (span: [number, number], leaves: 1 | 2, k: DoorKind = kind) => out.push({ x: (span[0] + span[1]) / 2, width: span[1] - span[0], y0: b.y0, y1: b.y1, leaves, kind: k, sides: ['left'], dir: -1 });
    if (b.doorFront) add(b.doorFront, b.coach ? 1 : 2, b.coach ? (year < 1980 ? 'fold' : 'plug') : kind);
    if (b.doorMid) add(b.doorMid, 2);
    return out;
  }
  if (m.category !== 'rail') return [];
  if (style === 'tram-heritage') {
    // open platforms at both ends, boarded from either side
    const L = m.dims.length;
    return [1, -1].map((s) => ({ x: s * (L / 2 - 0.8), width: 0.9, y0: 0.4, y1: 2.6, leaves: 1 as const, kind: 'open' as const, sides: both, dir: s as 1 | -1 }));
  }
  const passenger = ['dmu-car', 'emu-car', 'coach-stock', 'hs-coach', 'tram', 'metro-car', 'rack-car'].includes(style) || (style === 'hs-power' && year >= 2008);
  if (!passenger) return [];
  const r = railLayout(m);
  const top = r.floor + Math.min(r.tram ? 2.05 : 1.95, r.h * 0.72);
  const sill = r.floor + 0.02;
  const out: Door[] = [];
  const add = (x: number, width: number, leaves: 1 | 2, kind: DoorKind, dir: 1 | -1 = x >= 0 ? 1 : -1) =>
    out.push({ x, width, y0: sill, y1: kind === 'slam' ? Math.min(top, r.wy1 + 0.12) : top, leaves, kind, sides: both, dir });
  const span = r.bx1 - r.bx0;
  const slam = m.design.slam === true;
  if (style === 'hs-power') { add(r.bx0 + 1.2, 0.9, 1, 'plug', -1); return out; }
  if (slam) {
    const compartment = (style === 'coach-stock' && m.design.panelled === true) || style === 'emu-car';
    if (compartment) {
      // a door to every compartment (or every seating bay on a slam-door electric)
      const pitch = style === 'emu-car' ? 2.2 : 2.05;
      const n = Math.max(3, Math.floor((span - 0.4) / pitch));
      const p = (span - 0.4) / n;
      for (let i = 0; i < n; i++) add(r.bx0 + 0.2 + (i + 0.5) * p, 0.64, 1, 'slam');
    } else {
      // corridor stock and slam-door railcars: vestibules at each end, and two more along the side
      const e = 0.65;
      for (const x of [r.bx1 - e, r.bx0 + e + (span - 2 * e) * (2 / 3), r.bx0 + e + (span - 2 * e) / 3, r.bx0 + e]) add(x, 0.66, 1, 'slam');
      if (style === 'hs-coach') out.splice(1, 2); // high-speed coaches: only the end vestibules
    }
    return out;
  }
  switch (style) {
    case 'metro-car': for (let i = 0; i < 3; i++) add(r.bx0 + span * (i + 0.5) / 3, 1.6, 2, 'pocket'); break;
    case 'tram': for (const f of [0.28, 0.72]) add(r.x0 + m.dims.length * f, 1.3, 2, 'plug'); break;
    case 'rack-car': for (const f of [0.25, 0.75]) add(r.bx0 + span * f, 1.2, 2, 'pocket'); break;
    case 'emu-car': for (const f of [1 / 3, 2 / 3]) add(r.bx0 + span * f, 1.3, 2, year < 2000 ? 'pocket' : 'plug'); break;
    default:
      // diesel units, coaches and high-speed coaches: single-leaf doors at the vestibules by each end
      for (const x of [r.bx1 - 0.85, r.bx0 + 0.85]) add(x, 0.9, 1, year < 2000 && style === 'dmu-car' ? 'pocket' : 'plug', x >= 0 ? -1 : 1);
  }
  return out;
}

// ---------------- drawing ----------------

// Offsets from the body side, far enough apart that nothing z-fights: livery bands sit at 0.008,
// windows at 0.012.
const RECESS = 0.013, FRAME = 0.017, LEAF = 0.023, DETAIL = 0.028;
const vestibule = fixed('#1d1b19', LIGHT.interior); // the dark doorway, lit at night
const tread = fixed('#8d9196');
const seal = C.rubber;
const handle = C.chrome;

// The door leaves' colour: modern trains paint doors in the accent colour, older stock the body
// colour; bus doors are glazed with a painted frame.
function leafStyle(m: Model, d: Door): Style {
  if (m.category === 'bus') return paint(1, 0.92);
  if (d.kind === 'slam') return paint(1);
  return paint(4);
}

// A thin box standing on the body side (for leaves that swing out, so they read from both sides).
function slab(k: Kit, xa: number, xb: number, y0: number, y1: number, zIn: number, zOut: number, st: Style) {
  k.box(Math.min(xa, xb), Math.max(xa, xb), y0, y1, Math.min(zIn, zOut), Math.max(zIn, zOut), st, { ny: st });
}

// Draw the doors of a model on its sides at half-width hw. Near level: the full doorway; middle
// level: a flat panel in the door colour (rail) or nothing (buses, whose glazing already reads).
export function drawDoors(k: Kit, m: Model, hw: number) {
  const doors = doorsOf(m);
  if (!doors.length || k.lod === 2) return;
  const rail = m.category === 'rail';
  for (const d of doors) for (const sideName of d.sides) {
    const s: 1 | -1 = sideName === 'right' ? 1 : -1;
    const xa = d.x - d.width / 2, xb = d.x + d.width / 2;
    if (k.lod === 1) {
      // a suggestion only: a panel in the door colour on modern stock; slam doors and bus doors
      // are left to the body and the glazing at this distance
      if (!rail || d.kind === 'open' || d.kind === 'slam') continue;
      k.sideRect(xa, xb, d.y0, d.y1, hw, leafStyle(m, d), s, RECESS);
      continue;
    }
    // the doorway: dark, with a tread plate at the sill
    k.sideRect(xa, xb, d.y0, d.y1, hw, vestibule, s, RECESS);
    if (d.kind === 'open') { k.sideRect(xa, xb, d.y0, d.y0 + 0.06, hw, tread, s, FRAME); continue; }
    // behind a wide doorway: the vestibule floor and a grab pole, seen when the doors are open
    if (d.width > 1.1) {
      k.sideRect(xa, xb, d.y0, d.y0 + 0.16, hw, fixed('#4a4640'), s, RECESS + 0.002);
      k.sideRect(d.x - 0.025, d.x + 0.025, d.y0 + 0.16, d.y1, hw, fixed('#b9bdc0'), s, RECESS + 0.002);
    }
    // slam doors are hung in the body itself: the gap round the door is the seam
    if (d.kind === 'slam') { slamLeaf(k, m, d, s, hw, leafStyle(m, d)); continue; }
    k.sideRect(xa, xb, d.y0, d.y0 + 0.07, hw, tread, s, FRAME);
    // the frame: a dark seal round the opening, which is what makes the door read as set in
    const fw = rail ? 0.05 : 0.06;
    k.sideRect(xa - fw, xa, d.y0, d.y1 + fw, hw, seal, s, FRAME);
    k.sideRect(xb, xb + fw, d.y0, d.y1 + fw, hw, seal, s, FRAME);
    k.sideRect(xa, xb, d.y1, d.y1 + fw, hw, seal, s, FRAME);
    // an amber lamp over train doors, lit while they're open
    if (rail) k.sideRect(d.x - 0.09, d.x + 0.09, d.y1 + fw + 0.04, d.y1 + fw + 0.12, hw, fixed('#6a4a12', LIGHT.doorOpen), s, FRAME);
    const st = leafStyle(m, d);
    const h = d.y1 - d.y0;
    switch (d.kind) {
      case 'fold': foldLeaves(k, d, s, hw, st); break;
      default: {
        // sliding leaves: plug doors step out then slide over the body; pocket doors slide into it
        const n = d.leaves;
        const lw = d.width / n;
        for (let i = 0; i < n; i++) {
          // which way this leaf goes: bi-parting leaves part from the middle
          const dir = n === 2 ? (i === 0 ? -1 : 1) : d.dir;
          const la = n === 2 ? (i === 0 ? xa : d.x) : xa, lb = n === 2 ? (i === 0 ? d.x : xb) : xb;
          const travel = dir * (lw + (n === 2 ? 0.02 : 0.04));
          const tag = d.kind === 'plug'
            ? [MOTION.plug, travel, s * 0.09, 0] as const
            : [MOTION.pocket, travel, 0, dir > 0 ? xb : xa] as const;
          // the second leaf of a pair sits a hair further out, since the two overlap where they meet
          const base = LEAF + (i === 1 ? 0.003 : 0), det = base + 0.005;
          k.moving(tag, () => {
            // leaves meet with a small overlap so there's never a slit of light between them
            const ma = n === 2 && i === 1 ? la - 0.01 : la, mb = n === 2 && i === 0 ? lb + 0.01 : lb;
            const edge = dir < 0 ? mb : ma;
            k.sideRect(ma, mb, d.y0 + 0.02, d.y1 - 0.01, hw, st, s, base);
            if (rail) {
              // the leaf's window in its rubber, the seal on the meeting (or leading) edge, and the
              // passengers' open button beside it
              const wa = ma + 0.1, wb = mb - 0.1;
              k.sideRect(wa - 0.03, wb + 0.03, d.y0 + h * 0.46 - 0.03, d.y1 - 0.2, hw, seal, s, det);
              k.sideRect(wa, wb, d.y0 + h * 0.46, d.y1 - 0.23, hw, C.glass, s, det + 0.003);
              k.sideRect(edge - 0.025, edge + 0.025, d.y0 + 0.02, d.y1 - 0.01, hw, seal, s, det);
              const bx = dir < 0 ? mb - 0.14 : ma + 0.14;
              k.sideRect(bx - 0.05, bx + 0.05, d.y0 + h * 0.36, d.y0 + h * 0.36 + 0.1, hw, fixed('#2a4a2c', LIGHT.doorButton), s, det);
            } else {
              // a glazed bus door: a painted frame round a big pane
              k.sideRect(ma + 0.07, mb - 0.07, d.y0 + 0.28, d.y1 - 0.1, hw, C.glass, s, det);
              k.sideRect(edge - 0.02, edge + 0.02, d.y0 + 0.02, d.y1 - 0.01, hw, seal, s, det);
            }
          });
        }
      }
    }
  }
}

// A hinged slam door: a thin slab (so it reads edge-on when it swings open), a droplight window,
// a handle by the free edge and the hinge side's straps.
function slamLeaf(k: Kit, m: Model, d: Door, s: 1 | -1, hw: number, st: Style) {
  const xa = d.x - d.width / 2 + 0.02, xb = d.x + d.width / 2 - 0.02;
  const hingeX = d.dir > 0 ? xb : xa, free = d.dir > 0 ? xa : xb;
  const z0 = s * (hw + LEAF - 0.035), z1 = s * (hw + LEAF);
  // swing outward about the hinge: the free edge moves out by sin(angle)
  const swing = s * Math.sign(free - hingeX) * 1.45;
  const r = railLayout(m);
  k.moving([MOTION.hinge, hingeX, z1, swing], () => {
    k.box(xa, xb, d.y0 + 0.02, d.y1 - 0.02, Math.min(z0, z1), Math.max(z0, z1), st);
    // the droplight: a window that drops into the door, in its frame
    k.sideRect(xa + 0.1, xb - 0.1, r.wy0 + 0.05, d.y1 - 0.14, hw, seal, s, DETAIL - 0.001);
    k.sideRect(xa + 0.13, xb - 0.13, r.wy0 + 0.08, d.y1 - 0.17, hw, C.glass, s, DETAIL + 0.002);
    // the handle, just under the droplight by the free edge
    const hx = free + (d.dir > 0 ? 0.1 : -0.1);
    k.sideRect(hx - 0.06, hx + 0.06, r.wy0 - 0.12, r.wy0 - 0.06, hw, handle, s, DETAIL);
  });
}

// A folding door: each leaf is two glazed panels that fold inward towards its jamb.
function foldLeaves(k: Kit, d: Door, s: 1 | -1, hw: number, st: Style) {
  const xa = d.x - d.width / 2, xb = d.x + d.width / 2;
  // two leaves fold to either jamb; a single leaf folds to the back jamb
  const leaves: { jamb: number; w: number }[] = d.leaves === 2
    ? [{ jamb: xb, w: -d.width / 4 }, { jamb: xa, w: d.width / 4 }]
    : [{ jamb: xa, w: d.width / 2 }];
  const zb = s * (hw + LEAF);
  for (const { jamb, w } of leaves) for (const panel of [0, 1]) {
    const pa = jamb + w * panel, pb = jamb + w * (panel + 1);
    k.moving([panel === 0 ? MOTION.foldA : MOTION.foldB, jamb, zb, w], () => {
      const lo = Math.min(pa, pb) + 0.005, hi = Math.max(pa, pb) - 0.005;
      slab(k, lo, hi, d.y0 + 0.02, d.y1 - 0.02, zb - s * 0.03, zb, st);
      k.sideRect(lo + 0.05, hi - 0.05, d.y0 + 0.3, d.y1 - 0.1, hw, C.glass, s, LEAF + 0.004);
    });
  }
}

// ---------------- animation ----------------

const kindOf = (m: Model): keyof typeof DOOR_SECONDS => {
  const k = doorsOf(m).find((d) => d.kind !== 'open')?.kind;
  return (k && k !== 'open' ? k : 'plug');
};
export const doorSeconds = (m: Model) => DOOR_SECONDS[kindOf(m)];

// Doors through a stop, without any state: t seconds since the vehicle came to rest, dwell the
// seconds it will stand. The doors start to open 0.6 s after it stops (plus a stagger per car, so
// a train's doors don't all move at once), and are shut again 0.8 s before it leaves.
export function dwellDoors(t: number, dwell: number, m: Model, car = 0) {
  const T = doorSeconds(m);
  const lag = 0.6 + (car % 8) * 0.18;
  const shutBy = dwell - 0.8 - (car % 8) * 0.06;
  const opening = (t - lag) / T;
  const closing = (shutBy - t) / T;
  return Math.max(0, Math.min(1, opening, closing));
}

interface DoorState { l: number; r: number; tl: number; tr: number; secs: number; wait: number }
// Door state for a fleet, keyed by whatever id the caller uses: setDoors(id, open, side) sets
// where the doors are heading and update(dt) moves them there at the door kind's own speed.
export class DoorStates {
  private map = new Map<string | number, DoorState>();
  // open: 0 shut, 1 fully open; side: the doors to move ('both' for trams at island platforms);
  // delay: seconds before they start (stagger the cars of a train with it)
  setDoors(id: string | number, open: number, side: Side | 'both' = 'left', opts: { model?: Model; delay?: number } = {}) {
    let s = this.map.get(id);
    if (!s) { s = { l: 0, r: 0, tl: 0, tr: 0, secs: opts.model ? doorSeconds(opts.model) : DOOR_SECONDS.plug, wait: 0 }; this.map.set(id, s); }
    if (opts.model) s.secs = doorSeconds(opts.model);
    const v = Math.max(0, Math.min(1, open));
    if (side !== 'right') s.tl = v;
    if (side !== 'left') s.tr = v;
    s.wait = opts.delay ?? 0;
  }
  update(dt: number) {
    for (const [id, s] of this.map) {
      if (s.wait > 0) { s.wait -= dt; continue; }
      const step = dt / s.secs;
      s.l += Math.max(-step, Math.min(step, s.tl - s.l));
      s.r += Math.max(-step, Math.min(step, s.tr - s.r));
      if (!s.l && !s.r && !s.tl && !s.tr) this.map.delete(id);
    }
  }
  // how far open the doors are on the left and right, [0, 0] if the id isn't known
  get(id: string | number): [number, number] { const s = this.map.get(id); return s ? [s.l, s.r] : [0, 0]; }
  // the doors' animation phase is linear; ease it for anything drawn outside the shader
  eased(id: string | number): [number, number] { const [l, r] = this.get(id); return [ease(l), ease(r)]; }
  forget(id: string | number) { this.map.delete(id); }
  get size() { return this.map.size; }
}

// ---------------- in the world ----------------

export interface Placed { x: number; z: number; heading: number; y?: number }
export interface DoorPlace {
  index: number; // into doorsOf(model)
  side: Side;
  x: number; y: number; z: number; // the middle of the doorway's sill, just outside the body
  nx: number; nz: number; // outward normal
  width: number;
  kind: DoorKind;
}
// Which side of a placed vehicle a point (a platform, a bus stop) is on.
export function platformSide(pose: Placed, point: { x: number; z: number }): Side {
  // local +z is (−sin h, cos h) in the world
  const lz = -(point.x - pose.x) * Math.sin(pose.heading) + (point.z - pose.z) * Math.cos(pose.heading);
  return lz > 0 ? 'right' : 'left';
}
// Every door of a placed vehicle in world space. `pose` is where the vehicle's middle is and the
// way its front points (as VehicleRenderer is given it; turn a reversed car's heading by π).
// `side` narrows it to one side, or to the side facing a point such as a platform.
export function doorPositions(m: Model, pose: Placed, side?: Side | { x: number; z: number }): DoorPlace[] {
  const want = side === undefined ? undefined : typeof side === 'string' ? side : platformSide(pose, side);
  const c = Math.cos(pose.heading), sn = Math.sin(pose.heading), hw = m.dims.width / 2;
  const out: DoorPlace[] = [];
  doorsOf(m).forEach((d, i) => {
    for (const sd of d.sides) {
      if (want && sd !== want) continue;
      const lz = (sd === 'right' ? 1 : -1) * (hw + 0.12);
      out.push({
        index: i, side: sd, width: d.width, kind: d.kind,
        x: pose.x + c * d.x - sn * lz, z: pose.z + sn * d.x + c * lz, y: (pose.y ?? 0) + d.y0,
        nx: -sn * Math.sign(lz), nz: c * Math.sign(lz),
      });
    }
  });
  return out;
}
