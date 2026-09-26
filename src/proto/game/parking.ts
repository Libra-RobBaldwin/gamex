// Parking: the town's drives and car parks in use. Each building's parking spaces (buildgen.ts
// hands them over as Bays) hold real vehicles from the traffic's own fleet, drawn with the same
// instanced models, so a parked car costs no draw call of its own. A car whose trip ends at a plot
// with a free space leaves the road and drives in (the traffic hands it over at the kerb); a trip
// starting from a plot with a car parked there begins with that car pulling out and waiting at the
// gate until the traffic has room for it. Off screen, drives and car parks fill and empty with the
// time of day (homes at night, offices and surgeries by day), so they look right wherever you look.
import type { Lot } from '../roads';
import type { Bay } from '../buildgen';
import type { Rect } from '../footprint';
import type { Dressed, Driven, Fleet } from './fleet';

export interface ParkedCar { dressed: Dressed }
interface Spot { lot: Lot; bays: Bay[]; cars: (ParkedCar | null)[]; busy: boolean[]; cx: number; cz: number; cell: string }
// a car moving between the road and a space, along a smoothed path
interface Mover {
  id: number; spot: Spot; bay: number; dressed: Dressed; pts: { x: number; z: number }[]; len: number; s: number; v: number;
  dir: 'in' | 'out';
  target?: () => { x: number; z: number; hx: number; hz: number } | null; // (out: where the traffic put the car, once it has)
  done?: () => void; // (out: hands the car back to the traffic)
  waiting?: boolean;
  rev: number; // (the first metres are driven backwards: out of a space)
  ang?: number; // the heading drawn, easing round (a car doesn't spin on the spot)
}

const CELL = 96;
const SPEED = 3.2; // m/s, creeping in and out
const cellOf = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

// the share of a plot's spaces in use at an hour
export function wanted(kind: Lot['kind'], hour: number) {
  const day = hour >= 8 && hour < 18, evening = hour >= 18 && hour < 23;
  if (kind === 'house' || kind === 'terrace' || kind === 'flats') return day ? 0.45 : evening ? 0.8 : 0.88;
  if (kind === 'office' || kind === 'industry') return day ? 0.85 : hour >= 7 && hour < 19 ? 0.4 : 0.08;
  if (kind === 'civic') return day ? 0.6 : evening ? 0.3 : 0.05;
  return day ? 0.6 : 0.2;
}

// a path through points, its corners rounded (Chaikin), for a car to follow
function smooth(pts: { x: number; z: number }[], rounds = 2) {
  let p = pts;
  for (let k = 0; k < rounds; k++) {
    const q = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
const lengthOf = (p: { x: number; z: number }[]) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); return L; };
function along(p: { x: number; z: number }[], s: number) {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === p.length - 1) { const t = L > 1e-6 ? Math.min(1, s / L) : 1; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, hx: L > 1e-6 ? (b.x - a.x) / L : 1, hz: L > 1e-6 ? (b.z - a.z) / L : 0 }; }
    s -= L;
  }
  const e = p[p.length - 1];
  return { x: e.x, z: e.z, hx: 1, hz: 0 };
}

export const PARK_Y = -0.21;
export class Parking {
  private spots = new Map<number, Spot>();
  private grid = new Map<string, Set<Spot>>();
  private movers: Mover[] = [];
  private ids = 1;
  private tick = 0;
  hour = 12;
  // the view, for what's on screen (set by the game each frame)
  view = { x: 0, z: 0, r: 400 };
  stats = { parkedIn: 0, pulledOut: 0 };

  constructor(private fleet: Fleet, private rand: () => number, private carFor: (lot: Lot, heavy: boolean) => Dressed | null) {}

  // a building's spaces (again, if it was rebuilt: the cars still fit are kept)
  set(lot: Lot, bays: Bay[] | undefined) {
    const old = this.spots.get(lot.id);
    if (old) this.drop(lot.id, true);
    if (!bays?.length) return;
    let cx = 0, cz = 0;
    for (const b of bays) { cx += b.x / bays.length; cz += b.z / bays.length; }
    const sp: Spot = { lot, bays, cars: bays.map(() => null), busy: bays.map(() => false), cx, cz, cell: cellOf(cx, cz) };
    if (old) for (let i = 0; i < Math.min(old.cars.length, bays.length); i++) sp.cars[i] = old.cars[i];
    else this.fillTo(sp, wanted(lot.kind, this.hour));
    this.spots.set(lot.id, sp);
    let g = this.grid.get(sp.cell);
    if (!g) this.grid.set(sp.cell, (g = new Set()));
    g.add(sp);
  }
  drop(id: number, keepMovers = false) {
    const sp = this.spots.get(id);
    if (!sp) return;
    this.spots.delete(id);
    this.grid.get(sp.cell)?.delete(sp);
    if (!keepMovers) this.movers = this.movers.filter((m) => m.spot !== sp || (m.dir === 'out' && (m.done?.(), false)));
  }
  has(id: number) { return this.spots.has(id); }
  parkedAt(id: number) { const sp = this.spots.get(id); return sp ? sp.cars.filter(Boolean).length : 0; }
  get parked() { let n = 0; for (const sp of this.spots.values()) for (const c of sp.cars) if (c) n++; return n; }
  get moving() { return this.movers.length; }

  private fillTo(sp: Spot, share: number) {
    for (let i = 0; i < sp.bays.length; i++) if (!sp.cars[i] && this.rand() < share) { const d = this.carFor(sp.lot, !!sp.bays[i].heavy); if (d) sp.cars[i] = { dressed: d }; }
  }
  private freeBay(sp: Spot, heavy = false) {
    const free = sp.bays.map((_, i) => i).filter((i) => !sp.cars[i] && !sp.busy[i] && !!sp.bays[i].heavy === heavy);
    return free.length ? free[Math.floor(this.rand() * free.length)] : -1;
  }

  // A car at the end of its trip, where the traffic has it (its body's middle and heading): into a
  // free space at the plot, if there is one. Returns whether it took it.
  arrive(lot: Lot, dressed: Dressed, at: { x: number; z: number; hx: number; hz: number }, v: number) {
    const sp = this.spots.get(lot.id);
    if (!sp || dressed.heavy || dressed.front + dressed.back > 6.2) return false;
    const i = this.freeBay(sp);
    if (i < 0) return false;
    const b = sp.bays[i];
    sp.busy[i] = true;
    const pts = smooth([{ x: at.x, z: at.z }, { x: at.x + at.hx * 3, z: at.z + at.hz * 3 }, ...b.via, { x: b.x - b.hx * 4, z: b.z - b.hz * 4 }, { x: b.x, z: b.z }]);
    this.movers.push({ id: -1 - this.ids++, spot: sp, bay: i, dressed, pts, len: lengthOf(pts), s: 0, v: Math.min(v, SPEED), dir: 'in', rev: 0, ang: Math.atan2(at.hz, at.hx) });
    this.stats.parkedIn++;
    return true;
  }

  // A trip starting at this plot: a car parked here pulls out to the gate. `target` is where the
  // traffic has put the car once it has found room for it (null until then); `done` is called
  // once it's there, to hand it back. Returns its vehicle, or null if nobody is parked here.
  pullOut(lot: Lot): { dressed: Dressed; start: (target: () => { x: number; z: number; hx: number; hz: number } | null, done: () => void) => void; abandon: () => void } | null {
    const sp = this.spots.get(lot.id);
    if (!sp) return null;
    const full = sp.cars.map((c, i) => (c && !sp.busy[i] && !sp.bays[i].heavy ? i : -1)).filter((i) => i >= 0);
    if (!full.length) return null;
    const i = full[Math.floor(this.rand() * full.length)], b = sp.bays[i], car = sp.cars[i]!;
    return {
      dressed: car.dressed,
      start: (target, done) => {
        sp.cars[i] = null; sp.busy[i] = true;
        // (out backwards to the aisle, then forwards to the gate: drawn nose first, as it turns)
        const back = { x: b.x - b.hx * 4.5, z: b.z - b.hz * 4.5 };
        const pts = [{ x: b.x, z: b.z }, ...smooth([back, ...[...b.via].reverse()])];
        this.movers.push({ id: -1 - this.ids++, spot: sp, bay: i, dressed: car.dressed, pts, len: lengthOf(pts), s: 0, v: 0, dir: 'out', target, done: () => { sp.busy[i] = false; done(); }, rev: 4.5, ang: Math.atan2(b.hz, b.hx) });
        this.stats.pulledOut++;
      },
      abandon: () => { /* the trip didn't start: the car stays where it is */ },
    };
  }

  // Each frame: moving cars along, the parked ones drawn, and (every so often) a plot off screen
  // brought towards its share of cars for the hour.
  draw(dt: number) {
    const parts: Rect[] = [{ x: 0, z: 0, hx: 1, hz: 0, hl: 2, hw: 0.9 }];
    // (height above the ground: the drape lifts everything onto the hills, as it does the traffic;
    // the fleet lifts cars to the carriageway, and car parks and drives are a little lower)
    const y = (_x: number, _z: number) => PARK_Y;
    const put = (id: number, d: Dressed, x: number, z: number, hx: number, hz: number, v: number, parked: boolean, step: number) => {
      parts[0].x = x; parts[0].z = z; parts[0].hx = hx; parts[0].hz = hz;
      const drv: Driven = { id, v, s: 0, lane: 0, dress: d.dress, parked };
      this.fleet.drawCar(drv, parts, y(x, z), 0, 1, step);
    };
    // moving
    this.movers = this.movers.filter((m) => {
      if (m.dir === 'out' && m.s >= m.len - 0.05) {
        // at the gate: wait for the traffic to find it room, then drive out to where it put it
        const t = m.target?.();
        if (!t) { m.v = 0; const e = along(m.pts, m.len), a = m.ang ?? Math.atan2(e.hz, e.hx); put(m.id, m.dressed, e.x, e.z, Math.cos(a), Math.sin(a), 0, false, dt); return true; }
        if (Number.isNaN(t.x)) {
          // (the traffic never had room for it: back into its space)
          const b = m.spot.bays[m.bay], e = along(m.pts, m.len);
          m.done?.(); m.spot.busy[m.bay] = true; // (the traffic forgets the trip; the space stays its)
          m.done = undefined; m.target = undefined; m.dir = 'in'; m.rev = 0; m.s = 0;
          m.pts = smooth([{ x: e.x, z: e.z }, ...b.via.slice(1), { x: b.x - b.hx * 4, z: b.z - b.hz * 4 }, { x: b.x, z: b.z }]);
          m.len = lengthOf(m.pts);
          return true;
        }
        if (!m.waiting) {
          m.waiting = true;
          const e = along(m.pts, m.len);
          m.pts = smooth([{ x: e.x, z: e.z }, { x: e.x + e.hx * 2, z: e.z + e.hz * 2 }, { x: t.x - t.hx * 3.5, z: t.z - t.hz * 3.5 }, { x: t.x, z: t.z }]);
          m.len = lengthOf(m.pts); m.s = 0;
        }
        if (m.s >= m.len - 0.05) { m.done?.(); return false; }
      }
      const left = m.len - m.s, stop = m.dir === 'in' || m.waiting ? left : left + 2;
      m.v = Math.min(SPEED, m.v + dt * 1.5, Math.sqrt(Math.max(0, 2 * 1.2 * stop)) + 0.3);
      m.s = Math.min(m.len, m.s + m.v * dt);
      const p = along(m.pts, m.s), back = m.s < m.rev;
      // (reversing out of a space the nose points the other way; and the heading eases round)
      const want = Math.atan2(back ? -p.hz : p.hz, back ? -p.hx : p.hx);
      let a = m.ang ?? want, da = Math.atan2(Math.sin(want - a), Math.cos(want - a));
      a += Math.sign(da) * Math.min(Math.abs(da), dt * (0.6 + m.v * 0.9));
      m.ang = a;
      put(m.id, m.dressed, p.x, p.z, Math.cos(a), Math.sin(a), m.v, false, dt);
      if (m.dir === 'in' && m.s >= m.len - 0.05) {
        const sp = m.spot;
        sp.busy[m.bay] = false;
        if (this.spots.get(sp.lot.id) === sp) sp.cars[m.bay] = { dressed: m.dressed };
        return false;
      }
      return true;
    });
    // parked, in the cells round the view
    const { x: vx, z: vz, r } = this.view, c0 = Math.floor((vx - r) / CELL), c1 = Math.floor((vx + r) / CELL), r0 = Math.floor((vz - r) / CELL), r1 = Math.floor((vz + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
      const g = this.grid.get(`${i},${j}`);
      if (g) for (const sp of g) for (let k = 0; k < sp.bays.length; k++) {
        const car = sp.cars[k];
        if (!car) continue;
        const b = sp.bays[k];
        put(sp.lot.id * 64 + k, car.dressed, b.x, b.z, b.hx, b.hz, 0, true, 0);
      }
    }
    // off screen, a plot at a time, towards the hour's share
    this.tick += dt;
    if (this.tick > 0.25 && this.spots.size) {
      this.tick = 0;
      const all = [...this.spots.values()];
      for (let n = 0; n < 6; n++) {
        const sp = all[Math.floor(this.rand() * all.length)];
        if (Math.hypot(sp.cx - vx, sp.cz - vz) < r * 1.15) continue;
        const want = wanted(sp.lot.kind, this.hour), have = sp.cars.filter(Boolean).length / sp.bays.length;
        if (have < want - 0.15) { const heavy = this.rand() < sp.bays.filter((b) => b.heavy).length / sp.bays.length, i = this.freeBay(sp, heavy); if (i >= 0) { const d = this.carFor(sp.lot, heavy); if (d) sp.cars[i] = { dressed: d }; } }
        else if (have > want + 0.15) { const i = sp.cars.findIndex((c, k) => c && !sp.busy[k]); if (i >= 0) sp.cars[i] = null; }
      }
    }
  }
}
