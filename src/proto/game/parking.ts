// Parking: the town's drives, car parks and kerbside bays in use. Each building's parking spaces
// (buildgen.ts hands them over as Bays) and each street's kerbside spaces (roaddraw.ts
// kerbsideBays, kept by the traffic) hold real vehicles from the traffic's own fleet, drawn with
// the same instanced models, so a parked car costs no draw call of its own. A car whose trip ends
// at a plot with a free space leaves the road and drives in (the traffic hands it over at the
// kerb); one whose plot has no room pulls in nose first to a kerbside space on its street. A trip
// starting from a plot with a car parked there begins with that car pulling out and waiting at the
// gate (or at the kerb) until the traffic has room for it. Off screen, drives, car parks and
// streets fill and empty with the time of day (homes and their streets at night, offices and
// surgeries by day), so they look right wherever you look.
import type { Lot, LotKind, RSeg } from '../roads';
import type { Bay } from '../buildgen';
import type { KerbBay } from '../roaddraw';
import type { Rect } from '../footprint';
import type { Dressed, Driven, Fleet } from './fleet';

export interface ParkedCar { dressed: Dressed }
// a plot's spaces, or one side of a street's kerbside spaces (kerb: bays are KerbBays, nose along the kerb)
interface Spot { key: number; kind: LotKind; lot?: Lot; seg?: RSeg; side?: 1 | -1; kerb: boolean; bays: Bay[]; cars: (ParkedCar | null)[]; busy: boolean[]; cx: number; cz: number; cell: string }
// Kerbside spots have keys of their own, far above any plot's id (plots count up from 1, industrial sites down from -1000).
export const KERB_KEY = 1_000_000_000;
export const kerbKey = (segId: number, side: 1 | -1) => KERB_KEY + segId * 2 + (side === 1 ? 0 : 1);
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
export type PullOut = { dressed: Dressed; start: (target: () => { x: number; z: number; hx: number; hz: number } | null, done: () => void) => void; abandon: () => void };
export class Parking {
  private spots = new Map<number, Spot>();
  private grid = new Map<string, Set<Spot>>();
  private movers: Mover[] = [];
  private ids = 1;
  private tick = 0;
  // cars from kerbside spots just dropped (a road rebuilt or split), for the spots that replace them to take back by position
  private orphans: { x: number; z: number; car: ParkedCar; at: number }[] = [];
  private now = 0;
  hour = 12;
  // the view, for what's on screen (set by the game each frame)
  view = { x: 0, z: 0, r: 400 };
  stats = { parkedIn: 0, pulledOut: 0, kerbIn: 0, kerbOut: 0 };

  // (carFor: a car of the area's mix for a plot, or for a street's kerb: the road, with no plot)
  constructor(private fleet: Fleet, private rand: () => number, private carFor: (lot: Lot | null, heavy: boolean, seg?: RSeg) => Dressed | null) {}

  // a building's spaces (again, if it was rebuilt: the cars still fit are kept)
  set(lot: Lot, bays: Bay[] | undefined) {
    const old = this.spots.get(lot.id);
    if (old) this.drop(lot.id, true);
    if (!bays?.length) return;
    const sp = this.make({ key: lot.id, kind: lot.kind, lot, kerb: false }, bays);
    if (old) for (let i = 0; i < Math.min(old.cars.length, bays.length); i++) sp.cars[i] = old.cars[i];
    else this.fillTo(sp, wanted(lot.kind, this.hour));
    this.add(sp);
  }
  // One side of a street's kerbside spaces (roaddraw.ts kerbsideBays), filled like the plots along
  // it (`kind`: the street's, homes' streets fill at night). Again after the road is rebuilt or
  // split: the cars are kept by where they stand, from the spot as it was and from spots just
  // dropped (a split road's halves take the old road's cars back), so nothing vanishes on screen.
  setKerb(seg: RSeg, side: 1 | -1, kind: LotKind, bays: KerbBay[]) {
    const key = kerbKey(seg.id, side), old = this.spots.get(key);
    if (old) this.dropKerb(key, true);
    if (!bays.length) return;
    const sp = this.make({ key, kind, seg, side, kerb: true }, bays);
    // (each waiting car to the nearest new space within half a space's length: the halves of a
    // split road lay their spaces out from their own ends, so the grid can shift a little)
    let adopted = 0;
    const near = this.orphans.flatMap((o) => bays.map((b, i) => ({ o, i, d: Math.hypot(o.x - b.x, o.z - b.z) })).filter((x) => x.d < 3.5)).sort((p, q) => p.d - q.d);
    for (const { o, i } of near) {
      if (sp.cars[i] || !this.orphans.includes(o)) continue;
      sp.cars[i] = o.car; this.orphans.splice(this.orphans.indexOf(o), 1); adopted++;
    }
    if (!old && !adopted) this.fillTo(sp, wanted(kind, this.hour));
    this.add(sp);
  }
  private make(base: { key: number; kind: LotKind; lot?: Lot; seg?: RSeg; side?: 1 | -1; kerb: boolean }, bays: Bay[]): Spot {
    let cx = 0, cz = 0;
    for (const b of bays) { cx += b.x / bays.length; cz += b.z / bays.length; }
    return { ...base, bays, cars: bays.map(() => null), busy: bays.map(() => false), cx, cz, cell: cellOf(cx, cz) };
  }
  private add(sp: Spot) {
    this.spots.set(sp.key, sp);
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
  // a kerbside spot goes (its road did): its cars wait a moment for the spots that replace it
  dropKerb(key: number, keepMovers = false) {
    const sp = this.spots.get(key);
    if (!sp) return;
    for (let i = 0; i < sp.bays.length; i++) { const c = sp.cars[i]; if (c && !sp.busy[i]) this.orphans.push({ x: sp.bays[i].x, z: sp.bays[i].z, car: c, at: this.now }); }
    this.drop(key, keepMovers);
  }
  has(id: number) { return this.spots.has(id); }
  hasKerb(segId: number, side: 1 | -1) { return this.spots.has(kerbKey(segId, side)); }
  // the kerbside spots there are, by road (for the traffic to drop those whose roads are gone or far away)
  kerbs(): { key: number; seg: RSeg; side: 1 | -1; cx: number; cz: number }[] {
    const out: { key: number; seg: RSeg; side: 1 | -1; cx: number; cz: number }[] = [];
    for (const sp of this.spots.values()) if (sp.kerb && sp.seg && sp.side) out.push({ key: sp.key, seg: sp.seg, side: sp.side, cx: sp.cx, cz: sp.cz });
    return out;
  }
  parkedAt(id: number) { const sp = this.spots.get(id); return sp ? sp.cars.filter(Boolean).length : 0; }
  // the cars in a kerbside spot and where they stand (for tests)
  kerbCars(key: number): { x: number; z: number; car: ParkedCar }[] {
    const sp = this.spots.get(key);
    return sp ? sp.cars.flatMap((c, i) => (c ? [{ x: sp.bays[i].x, z: sp.bays[i].z, car: c }] : [])) : [];
  }
  get parked() { let n = 0; for (const sp of this.spots.values()) for (const c of sp.cars) if (c) n++; return n; }
  get kerbParked() { let n = 0; for (const sp of this.spots.values()) if (sp.kerb) for (const c of sp.cars) if (c) n++; return n; }
  get moving() { return this.movers.length; }
  // has this plot a free space of its own? (else a car arriving there looks for a kerbside one)
  hasRoom(lot: Lot) { const sp = this.spots.get(lot.id); return !!sp && sp.bays.some((b, i) => !b.heavy && !sp.cars[i] && !sp.busy[i]); }
  // a street side's free kerbside spaces: each with its distance along the road from its a end
  kerbFree(segId: number, side: 1 | -1): { i: number; s: number }[] {
    const sp = this.spots.get(kerbKey(segId, side));
    if (!sp) return [];
    return sp.bays.map((b, i) => ({ i, s: (b as KerbBay).s })).filter(({ i }) => !sp.cars[i] && !sp.busy[i]);
  }

  private fillTo(sp: Spot, share: number) {
    for (let i = 0; i < sp.bays.length; i++) if (!sp.cars[i] && this.rand() < share) { const d = this.carFor(sp.lot ?? null, !!sp.bays[i].heavy, sp.seg); if (d) sp.cars[i] = { dressed: d }; }
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
    return this.arriveAt(sp, this.freeBay(sp), dressed, at, v);
  }
  // Into this kerbside space (chosen on the way: kerbFree), if it's still free: the car pulls in
  // nose first from the running lane, along the space's way in.
  arriveKerb(key: number, i: number, dressed: Dressed, at: { x: number; z: number; hx: number; hz: number }, v: number) {
    const sp = this.spots.get(key);
    if (!sp || !sp.kerb || dressed.heavy || dressed.front + dressed.back > 6.2 || sp.cars[i] || sp.busy[i]) return false;
    const ok = this.arriveAt(sp, i, dressed, at, v);
    if (ok) this.stats.kerbIn++;
    return ok;
  }
  private arriveAt(sp: Spot, i: number, dressed: Dressed, at: { x: number; z: number; hx: number; hz: number }, v: number) {
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
  pullOut(lot: Lot): PullOut | null {
    const sp = this.spots.get(lot.id);
    if (!sp) return null;
    const full = sp.cars.map((c, i) => (c && !sp.busy[i] && !sp.bays[i].heavy ? i : -1)).filter((i) => i >= 0);
    if (!full.length) return null;
    return this.pullFrom(sp, full[Math.floor(this.rand() * full.length)]);
  }
  // A trip starting at a plot with no car of its own: one parked at the kerb on its street, on the
  // side the trip sets off along (`side`), within `within` metres of the plot's way in (`s` along
  // the road from its a end), pulls out forwards into the lane. With `s` along the road of the space it left.
  pullOutKerb(segId: number, side: 1 | -1, s: number, within: number): (PullOut & { s: number }) | null {
    const sp = this.spots.get(kerbKey(segId, side));
    if (!sp) return null;
    const full = sp.cars.map((c, i) => (c && !sp.busy[i] && Math.abs((sp.bays[i] as KerbBay).s - s) <= within ? i : -1)).filter((i) => i >= 0);
    if (!full.length) return null;
    const i = full[Math.floor(this.rand() * full.length)];
    return { ...this.pullFrom(sp, i), s: (sp.bays[i] as KerbBay).s };
  }
  private pullFrom(sp: Spot, i: number): PullOut {
    const b = sp.bays[i], car = sp.cars[i]!;
    return {
      dressed: car.dressed,
      start: (target, done) => {
        sp.cars[i] = null; sp.busy[i] = true;
        let pts: { x: number; z: number }[], rev: number;
        if (sp.kerb) {
          // (forwards out of the space and over into the lane, to the point its way in came from)
          const out = (b as KerbBay).out;
          pts = smooth([{ x: b.x, z: b.z }, { x: b.x + b.hx * 2.5, z: b.z + b.hz * 2.5 }, { x: out.x, z: out.z }]); rev = 0;
        } else {
          // (out backwards to the aisle, then forwards to the gate: drawn nose first, as it turns)
          const back = { x: b.x - b.hx * 4.5, z: b.z - b.hz * 4.5 };
          pts = [{ x: b.x, z: b.z }, ...smooth([back, ...[...b.via].reverse()])]; rev = 4.5;
        }
        this.movers.push({ id: -1 - this.ids++, spot: sp, bay: i, dressed: car.dressed, pts, len: lengthOf(pts), s: 0, v: 0, dir: 'out', target, done: () => { sp.busy[i] = false; done(); }, rev, ang: Math.atan2(b.hz, b.hx) });
        this.stats.pulledOut++;
        if (sp.kerb) this.stats.kerbOut++;
      },
      abandon: () => { /* the trip didn't start: the car stays where it is */ },
    };
  }

  // Each frame: moving cars along, the parked ones drawn, and (every so often) a plot off screen
  // brought towards its share of cars for the hour.
  draw(dt: number) {
    this.now += dt;
    if (this.orphans.length && this.orphans[0].at < this.now - 5) this.orphans = this.orphans.filter((o) => o.at >= this.now - 5);
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
          m.done = undefined; m.target = undefined; m.dir = 'in'; m.s = 0;
          // (a kerbside space is behind it: it reverses back in)
          m.pts = m.spot.kerb ? smooth([{ x: e.x, z: e.z }, { x: b.x + b.hx * 3, z: b.z + b.hz * 3 }, { x: b.x, z: b.z }]) : smooth([{ x: e.x, z: e.z }, ...b.via.slice(1), { x: b.x - b.hx * 4, z: b.z - b.hz * 4 }, { x: b.x, z: b.z }]);
          m.len = lengthOf(m.pts); m.rev = m.spot.kerb ? m.len + 1 : 0;
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
        if (this.spots.get(sp.key) === sp) sp.cars[m.bay] = { dressed: m.dressed };
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
        put(sp.key * 64 + k, car.dressed, b.x, b.z, b.hx, b.hz, 0, true, 0);
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
        const want = wanted(sp.kind, this.hour), have = sp.cars.filter(Boolean).length / sp.bays.length;
        if (have < want - 0.15) { const heavy = this.rand() < sp.bays.filter((b) => b.heavy).length / sp.bays.length, i = this.freeBay(sp, heavy); if (i >= 0) { const d = this.carFor(sp.lot ?? null, heavy, sp.seg); if (d) sp.cars[i] = { dressed: d }; } }
        else if (have > want + 0.15) { const i = sp.cars.findIndex((c, k) => c && !sp.busy[k]); if (i >= 0) sp.cars[i] = null; }
      }
    }
  }
}
