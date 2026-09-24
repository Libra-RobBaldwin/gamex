// From flows to crowds. The economy says how many people are doing what, where ("12 waiting
// at this stop", "300 walking from the station to the works gate between 05:40 and 06:10",
// "40 shoppers on this stretch of high street", "6 dog walkers in this park"); this turns
// those numbers into believable figures and hands them to the store. Nobody here is
// simulated: each figure is sampled from a seed (the flow's id and its own number), so the
// same place always shows the same people, and a count going from 12 to 13 adds one person
// rather than reshuffling the lot.
import { PeopleStore, emitAnimal, emitBird, emitPerson, NO_FADE_IN, type AnimalLook, type BirdLook, type GroupSpec } from './store';
import { circleRoute, fitRoute, legPoint, reverseRoute, routePoint, straightRoute, Mode, type Motion, type Route } from './track';
import { clamp, dist, edgeDist, hashStr, hex, inPoly, mix, offsetLine, pick, pickW, pointIn, polyBounds, polyCentre, polyLength, range, rng, vdc, type Rand, type XZ } from './util';
import { DOGS, SPECIES } from './shaders';
import { Idle, MIXES, dress, roleOf, type Mix, type Role } from './wardrobe';

// ---------- the flows ----------
// Where people wait: a bus stop (a queue running back along the pavement from the flag) or a
// platform (spread along its length, back from the edge).
export interface QueueSite {
  id: string; kind: 'stop' | 'platform';
  at: XZ; // the stop flag, or the middle of the platform edge
  along: number; // heading the queue (or platform) runs along, radians (direction (cos, sin))
  facing: number; // heading people look towards (the road, the track)
  y?: number; // ground height (a platform is raised)
  length?: number; // platform length
  depth?: [number, number]; // platform: how far back from the edge people stand
  shelter?: { at: XZ; along: number; seats: number }; // a shelter bench (the first to arrive sit)
  away?: XZ[][]; // footway lines people leave along after getting off
}
export interface QueueFlow { kind: 'queue'; id: string; site: QueueSite; waiting: number; mix?: Mix }
// A footway: the band between kerb and back of pavement, as its centre line and width.
export interface Footway { line: XZ[]; width: number; y?: number }
export interface WalkFlow { kind: 'walk'; id: string; footway: Footway; count: number; mix?: Mix; dogs?: number }
export interface RideFlow { kind: 'ride'; id: string; line: XZ[]; count: number; y?: number }
// A scheduled stream (a shift change): `total` people set off along `path` between the
// window's two times (minutes after midnight), each walking the whole way.
export interface CommuteFlow { kind: 'commute'; id: string; path: XZ[]; total: number; window: [number, number]; mix?: Mix; width?: number; y?: number }
export interface CrossFlow { kind: 'cross'; id: string; a: XZ; b: XZ; count: number; width?: number; mix?: Mix }
export type Venue = 'shop' | 'pub' | 'cafe' | 'gate' | 'square';
// People standing about in front of a building: `at` is the middle of its frontage, `facing`
// the heading from the pavement towards the building.
export interface LoiterFlow { kind: 'loiter'; id: string; at: XZ; facing: number; width: number; count: number; venue: Venue; mix?: Mix; y?: number }
export interface Bench { at: XZ; facing: number }
export interface ParkFlow {
  kind: 'park'; id: string; area: XZ[]; paths?: XZ[][]; benches?: Bench[];
  walkers: number; dogWalkers: number; looseDogs?: number; joggers?: number; sitters?: number; kids?: number; play?: XZ;
  avoid?: XZ[][]; // ponds, flower beds, the bandstand: nobody stands or runs about in these
}
export interface SchoolFlow {
  kind: 'school'; id: string; gate: XZ; yard: XZ[]; approaches: XZ[][]; pupils: number;
  arrive: [number, number]; leave: [number, number]; school?: number; door?: XZ;
}
export type AnimalKind = 'sheep' | 'cow' | 'pigeon' | 'duck' | 'cat';
export interface AnimalFlow { kind: 'animals'; id: string; species: AnimalKind; count: number; area?: XZ[]; spots?: { at: XZ; facing: number; y: number }[]; lines?: { line: XZ[]; y: number }[]; y?: number }
export type Flow = QueueFlow | WalkFlow | RideFlow | CommuteFlow | CrossFlow | LoiterFlow | ParkFlow | SchoolFlow | AnimalFlow;

// ---------- helpers ----------
const TAU = Math.PI * 2;
const still = (y = 0, s0 = 0): Motion => ({ mode: Mode.Still, v: 0, s0, lat: 0, t0: 0, tShow: 0, tHide: 0, y });
const spot = (p: XZ, heading: number): Route => ({ legs: [{ x: p.x, z: p.z, h: heading, k: 0, L: 0.01, S: 0 }], length: 0.01, closed: false });
const along = (p: XZ, h: number, d: number, side = 0): XZ => ({ x: p.x + Math.cos(h) * d + Math.sin(h) * side, z: p.z + Math.sin(h) * d - Math.cos(h) * side });
const personRand = (id: string, k: number) => rng(mix(hashStr(id), k));
const capFor = (n: number) => Math.max(4, Math.ceil(n * 1.25 + 2));

function dogLook(r: Rand): AnimalLook {
  const species = SPECIES.indexOf(pick(r, DOGS));
  const coats: Record<string, string[]> = {
    labrador: ['#1c1a18', '#d9b46a', '#5a3a22'], dachshund: ['#6a3a1e', '#1c1a18'], terrier: ['#f2f0ea', '#c9a46a', '#8a6a4a'], spaniel: ['#6a3a1e', '#e8e0d0'],
    whippet: ['#9a9590', '#c9b8a0', '#2b2b2b'], collie: ['#1c1a18'], bulldog: ['#c9a46a', '#e8e0d0'], poodle: ['#f2f0ea', '#2b2b2b', '#c98a5a'],
  };
  const name = SPECIES[species];
  const coat = hex(pick(r, coats[name]));
  const pattern = name === 'collie' ? 2 : name === 'spaniel' || (name === 'terrier' && r() < 0.4) ? 1 : 0;
  return { species, size: range(r, 0.9, 1.1), idle: pick(r, [0, 1, 1, 2]), coat, second: hex(name === 'spaniel' ? '#e8e0d0' : '#f2f0ea'), pattern, dark: hex('#1c1a18') };
}
// does a ring of radius R round p touch any of the areas to avoid?
function clash(p: XZ, R: number, avoid?: XZ[][]) {
  return !!avoid?.some((a) => inPoly(p, a) || edgeDist(p, a) < R);
}
// Chaikin rounding of a closed outline, so paths round corners rather than turning on the spot.
function roundClosed(p: XZ[], passes = 3) {
  let q = p;
  for (let k = 0; k < passes; k++) {
    const o: XZ[] = [];
    for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length]; o.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 }); }
    q = o;
  }
  return q;
}
function signedArea(p: XZ[]) { let a = 0; for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; a += u.x * v.z - v.x * u.z; } return a / 2; }
// A loop path inside a park, `inset` metres in from its edge.
// Every leg costs a full draw of each figure on it, so a park that is roughly a rectangle gets a
// running-track loop (two straights, two half-circles: four legs); odd shapes follow the outline.
export function parkLoop(area: XZ[], inset: number): Route {
  const c = polyCentre(area), b = polyBounds(area);
  const w = b.x1 - b.x0, d = b.z1 - b.z0;
  const small = Math.min(w, d) < inset * 2 + 6;
  if (small) return circleRoute(c, Math.max(2, Math.min(w, d) / 2 - 1.5));
  let a = 0;
  for (let i = 0; i < area.length; i++) { const u = area[i], v = area[(i + 1) % area.length]; a += u.x * v.z - v.x * u.z; }
  if (Math.abs(a / 2) > w * d * 0.85) return stadium(c, w / 2 - inset, d / 2 - inset);
  // offsetting to the left of travel moves inwards on a clockwise (negative-area) outline
  const inward = signedArea(area) > 0 ? -inset : inset;
  const ring = offsetLine([...area, area[0]], inward).slice(0, -1);
  return fitRoute(roundClosed(ring), 0.3, true);
}
function stadium(c: XZ, hx: number, hz: number): Route {
  const alongX = hx >= hz, R = Math.min(hx, hz), L = Math.max(hx, hz) - R;
  // anticlockwise looking down: straight, half-turn, straight back, half-turn
  const h0 = alongX ? 0 : Math.PI / 2;
  const u = { x: Math.cos(h0), z: Math.sin(h0) }, n = { x: Math.sin(h0), z: -Math.cos(h0) };
  const start = { x: c.x - u.x * L + n.x * R, z: c.z - u.z * L + n.z * R };
  const legs = [];
  let S = 0, p = start, h = h0;
  for (const [k, len] of [[0, 2 * L], [-1 / R, Math.PI * R], [0, 2 * L], [-1 / R, Math.PI * R]] as const) {
    legs.push({ x: p.x, z: p.z, h, k, L: len, S });
    const e = legPoint({ x: p.x, z: p.z, h, k, L: len, S }, len);
    p = { x: e.x, z: e.z }; h = e.a; S += len;
  }
  return { legs, length: S, closed: true };
}
// Cut a line into pieces of about `len` metres (each becomes its own group, culled on its own).
function pieces(line: XZ[], len: number): XZ[][] {
  const L = polyLength(line);
  const n = Math.max(1, Math.round(L / len));
  if (n === 1) return [line];
  const out: XZ[][] = [];
  const route = straightRoute(line);
  for (let i = 0; i < n; i++) {
    const s0 = (L * i) / n, s1 = (L * (i + 1)) / n, pts: XZ[] = [routePoint(route, s0)];
    let acc = 0;
    for (let j = 1; j < line.length - 1; j++) { acc += dist(line[j - 1], line[j]); if (acc > s0 && acc < s1) pts.push(line[j]); }
    pts.push(routePoint(route, s1));
    out.push(pts.map((p) => ({ x: p.x, z: p.z })));
  }
  return out;
}
const routeCentre = (r: Route) => { const a = routePoint(r, 0), b = routePoint(r, r.length / 2), c = routePoint(r, r.length); return { x: (a.x + b.x + c.x) / 3, z: (a.z + b.z + c.z) / 3 }; };
const routeRadius = (r: Route) => r.length / 2 + 3;

// ---------- the crowds ----------
interface Part { spec: GroupSpec; count: (clock: number) => number }
interface QueueState { base: number; shuffle?: { n: number; at: number }; seq: number; slots: (j: number) => { p: XZ; h: number; sit: boolean } }

export class Crowds {
  year = 2025;
  // game seconds per second of simulated (shader) time: 240 in the game, where a day takes six minutes
  timeScale = 60;
  private flows = new Map<string, { key: string; flow: Flow; parts: Part[] }>();
  private queues = new Map<string, QueueState>();
  constructor(public store: PeopleStore) {
    store.onRebase = (T) => { for (const q of this.queues.values()) if (q.shuffle) q.shuffle.at -= T; };
  }
  get time() { return this.store.time; }

  // Give the current flows and clock (game minutes since the start, or since midnight). Flows
  // are matched by id: new ones are built, changed shapes rebuilt, counts eased, missing ones removed.
  set(flows: Flow[], clock: number) {
    const seen = new Set<string>();
    for (const given of flows) {
      seen.add(given.id);
      const key = shapeKey(given, this.year);
      let e = this.flows.get(given.id);
      if (e && e.key === key) {
        // same place, new numbers: the crowd's count closures read the stored copy, so refresh it
        Object.assign(e.flow, given);
        const grow = e.parts.some((p) => { const cap = (p.spec as GroupSpec & { cap?: number }).cap; return cap !== undefined && p.count(clock) > cap; });
        if (grow) {
          // more people than were made for it: make more in place (the first ones come out the
          // same, so nobody already standing there changes)
          e.parts = this.build(e.flow);
          for (const p of e.parts) { p.spec.count = p.count(clock); this.store.add(p.spec); }
        } else for (const p of e.parts) this.store.setCount(p.spec.id, p.count(clock));
        continue;
      }
      if (e) for (const p of e.parts) this.store.remove(p.spec.id);
      const flow = { ...given } as Flow;
      e = { key, flow, parts: this.build(flow) };
      this.flows.set(given.id, e);
      for (const p of e.parts) { p.spec.count = p.count(clock); this.store.add(p.spec); }
    }
    for (const [id, e] of this.flows) if (!seen.has(id)) { for (const p of e.parts) this.store.remove(p.spec.id); this.flows.delete(id); if (this.queues.has(id)) this.queues.delete(id); }
  }

  private build(f: Flow): Part[] {
    switch (f.kind) {
      case 'queue': return this.queue(f);
      case 'walk': return this.walk(f);
      case 'ride': return this.ride(f);
      case 'commute': return this.commute(f);
      case 'cross': return this.cross(f);
      case 'loiter': return this.loiter(f);
      case 'park': return this.park(f);
      case 'school': return this.school(f);
      case 'animals': return this.animals(f);
    }
  }

  // ----- waiting: queues at stops, crowds on platforms -----
  private queue(f: QueueFlow): Part[] {
    const s = f.site, y = s.y ?? 0, cap = capFor(Math.max(f.waiting, 8));
    const sr = personRand(f.id + ':slots', 0);
    const jit = Array.from({ length: cap + 64 }, () => [sr() - 0.5, sr() - 0.5, sr() - 0.5]);
    const seats = s.shelter?.seats ?? 0;
    const slots = (j: number) => {
      const [a, b, c] = jit[j % jit.length];
      if (s.kind === 'platform') {
        // spread along the platform, thicker near the middle where the way in is
        const u = (vdc(j) - 0.5) * (0.35 + 0.65 * Math.min(1, j / 20));
        const [d0, d1] = s.depth ?? [1.3, 3.5];
        const p = along(s.at, s.along, u * (s.length ?? 40), -(d0 + (d1 - d0) * (b + 0.5)));
        return { p, h: s.facing + a * 1.4, sit: false };
      }
      if (j < seats && s.shelter) return { p: along(s.shelter.at, s.shelter.along, (j - (seats - 1) / 2) * 0.6), h: s.facing, sit: true };
      const q = j - seats, rank = q >= 14 ? 1 : 0, d = 0.9 + (q - rank * 14) * 0.7 + a * 0.25;
      return { p: along(s.at, s.along, d, (rank ? 0.7 : 0) + b * 0.35 - 0.2), h: s.facing + c * 1.3 + (q % 5 === 2 ? 0.9 : 0), sit: false };
    };
    const st: QueueState = this.queues.get(f.id) ?? { base: 0, seq: 0, slots };
    st.slots = slots;
    this.queues.set(f.id, st);
    const spec: GroupSpec & { cap: number } = {
      id: f.id, centre: s.at, radius: s.kind === 'platform' ? (s.length ?? 40) / 2 + 4 : 16, y, count: 0, cap,
      build: (b) => {
        const sh = st.shuffle && this.time - st.shuffle.at < 20 ? st.shuffle : undefined;
        for (let j = 0; j < cap; j++) {
          const sl = slots(j), { look, ph, r } = this.waiter(f, st.base + j, sl.sit);
          if (sh && s.kind === 'stop') {
            // shuffle up the queue after the front has boarded
            const from = slots(j + sh.n).p, route = straightRoute([from, sl.p]);
            emitPerson(b, j, route, { mode: Mode.Once, v: 0.9, s0: 0, lat: 0, t0: sh.at + j * 0.12, tShow: 0, tHide: 0, y }, look, ph);
          } else emitPerson(b, j, spot(sl.p, sl.h), still(y), look, ph);
          if (look.role === 'dogwalker' || r() < 0.05) {
            // sat at their feet: on the owner's own spot, to one side, on a short lead
            const d = dogLook(r);
            d.idle = pick(r, [0, 1, 2, 2, 4]);
            emitAnimal(b, j, spot(sl.p, sl.h), { ...still(y), lat: r() < 0.5 ? 0.5 : -0.5 }, d, r(), { lag: 0.01, lat: 0 });
          }
        }
      },
    };
    return [{ spec, count: () => f.waiting }];
  }

  // Someone waiting: the same person whether they're queueing, walking to the door or boarding.
  private waiter(f: QueueFlow, who: number, seat: boolean) {
    const r = personRand(f.id, who);
    const look = dress(roleOf(r, f.mix ?? (f.site.kind === 'platform' ? MIXES.station : MIXES.street), this.year), this.year, r);
    if (look.prop === 1) look.prop = 0; // bikes don't queue for buses
    look.idle = (seat && look.prop !== 2) || look.prop === 3 ? Idle.Sit : look.idle === Idle.Phone ? Idle.Phone : Idle.Wait;
    return { look, ph: r(), r };
  }

  // A bus or train is at the site: the first `n` waiting walk to the doors and get on. Returns
  // how many board and when the last is aboard (so the vehicle can wait that long).
  board(siteId: string, doors: XZ[], n: number) {
    const e = this.flows.get(siteId), st = this.queues.get(siteId);
    const f = e?.flow as QueueFlow | undefined;
    if (!e || !st || !f) return { n: 0, until: this.time };
    const spec = this.store.spec(siteId)!;
    const k = Math.min(Math.floor(spec.count), Math.max(0, n));
    if (!k) return { n: 0, until: this.time };
    const now = this.time, y = f.site.y ?? 0, gap = f.site.kind === 'platform' ? 0.5 : 1.1;
    let until = now;
    const walkers: { j: number; route: Route; t0: number; tHide: number }[] = [];
    // front of the queue first; on a platform everyone heads for the nearest door at once
    for (let j = 0; j < k; j++) {
      const sl = st.slots(j).p;
      const door = doors.reduce((a, d) => (dist(d, sl) < dist(a, sl) ? d : a), doors[0]);
      const route = straightRoute([sl, door]);
      const t0 = now + (f.site.kind === 'platform' ? (j % 6) * gap * 0.3 : j * gap);
      const tHide = t0 + route.length / 1.3 + 0.3;
      until = Math.max(until, tHide);
      walkers.push({ j, route, t0, tHide });
    }
    const base = st.base;
    st.seq++;
    this.store.add({
      id: `${siteId}#board${st.seq}`, centre: f.site.at, radius: 20, y, count: k, expires: until + 1,
      build: (b) => {
        for (const w of walkers) {
          const { look, ph } = this.waiter(f, base + w.j, st.slots(w.j).sit);
          emitPerson(b, w.j, w.route, { mode: Mode.Once, v: 1.3, s0: 0, lat: 0, t0: w.t0, tShow: now - 1, tHide: w.tHide, y }, look, ph, NO_FADE_IN);
        }
      },
    });
    st.base += k;
    st.shuffle = f.site.kind === 'stop' ? { n: k, at: now + 0.4 } : undefined;
    f.waiting = Math.max(0, f.waiting - k);
    this.store.setCount(siteId, f.waiting, true);
    this.store.rebuild(siteId);
    return { n: k, until };
  }
  // `n` people step off at the doors and walk away (along the site's `away` lines if given).
  alight(siteId: string, doors: XZ[], n: number) {
    const e = this.flows.get(siteId), st = this.queues.get(siteId);
    const f = e?.flow as QueueFlow | undefined;
    if (!f || !st || n <= 0) return { until: this.time };
    const now = this.time, y = f.site.y ?? 0, seq = ++st.seq, id = `${siteId}#alight${seq}`;
    let until = now;
    const plans: { route: Route; t0: number; tHide: number; door: number }[] = [];
    const r0 = personRand(id, 0);
    for (let j = 0; j < n; j++) {
      const di = j % doors.length, door = doors[di], t0 = now + 0.6 + Math.floor(j / doors.length) * 0.9;
      const away = f.site.away?.length ? pick(r0, f.site.away) : null;
      // step off towards the back of the pavement (or platform), then away along it
      const off = along(door, f.site.facing + Math.PI, 1.6 + r0() * 1.4, (r0() - 0.5) * 2);
      const pts = [door, off];
      if (away) { const start = away.reduce((a, p) => (dist(p, off) < dist(a, off) ? p : a), away[0]); const i = away.indexOf(start); pts.push(...(r0() < 0.5 ? away.slice(i) : away.slice(0, i + 1).reverse()).slice(0, 12)); }
      else pts.push(along(off, f.site.along + (r0() < 0.5 ? 0 : Math.PI), 18 + r0() * 10));
      const route = fitRoute(pts, 0.3);
      const L = Math.min(route.length, 45), tHide = t0 + L / 1.3;
      until = Math.max(until, t0);
      plans.push({ route, t0, tHide, door: di });
    }
    this.store.add({
      id, centre: f.site.at, radius: 40, y, count: n, expires: Math.max(...plans.map((p) => p.tHide)) + 1,
      build: (b) => plans.forEach((p, j) => {
        const r = personRand(id, j + 1);
        const look = dress(roleOf(r, f.mix ?? (f.site.kind === 'platform' ? MIXES.station : MIXES.street), this.year), this.year, r);
        if (look.prop === 1) look.prop = 0;
        emitPerson(b, j, p.route, { mode: Mode.Once, v: Math.max(1.1, look.speed), s0: 0, lat: 0, t0: p.t0, tShow: p.t0, tHide: p.tHide, y }, look, r());
      }),
    });
    return { until };
  }

  // ----- walking along footways, in both directions, keeping loosely to the left -----
  private walk(f: WalkFlow): Part[] {
    const pcs = pieces(f.footway.line, 90), total = polyLength(f.footway.line);
    return pcs.map((line, pi) => {
      const share = polyLength(line) / total;
      const fwd = fitRoute(line, 0.25), rev = reverseRoute(fwd), w = f.footway.width, y = f.footway.y ?? 0, id = `${f.id}:${pi}`;
      const cap = capFor(f.count * share);
      const spec: GroupSpec & { cap: number } = {
        id, centre: routeCentre(fwd), radius: routeRadius(fwd), y, count: 0, cap,
        build: (b) => {
          for (let k = 0; k < cap; k++) {
            const r = personRand(id, k);
            let role = roleOf(r, f.mix ?? MIXES.street, this.year);
            if (role === 'cyclist') role = 'public'; // cyclists belong on the road
            const look = dress(role, this.year, r);
            const back = r() < 0.5, route = back ? rev : fwd;
            const half = Math.max(0.1, w / 2 - 0.4);
            // keep left of the direction of travel, loosely; pushchairs and wheelchairs nearer the middle
            const lat = clamp(w * 0.18 + (r() - 0.5) * w * 0.45, -half, half) * (look.prop ? 0.4 : 1);
            const s0 = ((vdc(k) + (r() - 0.5) * 0.04 + 1) % 1) * route.length;
            const m: Motion = { mode: Mode.Loop, v: look.speed, s0, lat, t0: 0, tShow: 0, tHide: 0, y };
            emitPerson(b, k, route, m, look, r());
            if (look.role === 'dogwalker' || r() < (f.dogs ?? 0.04)) {
              const d = dogLook(r), dl = lat + (lat > 0 ? -0.5 : 0.5);
              emitAnimal(b, k, route, { ...m, s0: s0 + 1.4, lat: dl, v: look.speed }, d, r(), { lag: 1.4, lat });
            }
          }
        },
      };
      return { spec, count: () => f.count * share };
    });
  }
  private ride(f: RideFlow): Part[] {
    return pieces(f.line, 150).map((line, pi) => {
      const route = fitRoute(line, 0.3), id = `${f.id}:${pi}`, y = f.y ?? 0, share = polyLength(line) / polyLength(f.line), cap = capFor(f.count * share);
      const spec: GroupSpec & { cap: number } = {
        id, centre: routeCentre(route), radius: routeRadius(route), y, count: 0, cap,
        build: (b) => { for (let k = 0; k < cap; k++) { const r = personRand(id, k), look = dress('cyclist', this.year, r); emitPerson(b, k, route, { mode: Mode.Loop, v: look.speed, s0: vdc(k) * route.length, lat: (r() - 0.5) * 0.4, t0: 0, tShow: 0, tHide: 0, y }, look, r()); } },
      };
      return { spec, count: () => f.count * share };
    });
  }

  // ----- a shift change: a stream along the path while the window is open -----
  // The game's clock runs far faster than people walk (a day in minutes), so a real-speed
  // walker can't cover a route inside a half-hour window. So, as with traffic, the stream is
  // sampled from its rate: the path carries as many people at once as the flow implies
  // (rate × time to walk it, never more than the total), easing up as the window opens and
  // away as it closes. People appear at one end and are gone at the other.
  private commute(f: CommuteFlow): Part[] {
    const route = fitRoute(f.path, 0.3), y = f.y ?? 0, w = f.width ?? 2;
    const span = Math.max(1, (((f.window[1] - f.window[0]) % 1440) + 1440) % 1440);
    const conc = () => Math.min(f.total, (f.total / span) * this.walkMinutes(route.length));
    const cap = capFor(Math.min(f.total, (f.total / span) * this.walkMinutes(route.length)));
    const spec: GroupSpec & { cap: number } = {
      id: f.id, centre: routeCentre(route), radius: routeRadius(route), y, count: 0, cap,
      build: (b) => {
        for (let k = 0; k < cap; k++) {
          const r = personRand(f.id, k);
          const look = dress(roleOf(r, f.mix ?? MIXES.works, this.year), this.year, r);
          emitPerson(b, k, route, { mode: Mode.Loop, v: look.speed, s0: vdc(k) * route.length, lat: (r() - 0.5) * w * 0.7, t0: 0, tShow: 0, tHide: 0, y }, look, r());
        }
      },
    };
    return [{ spec, count: (c) => conc() * windowRamp(c, f.window[0], span) }];
  }
  // how long, in game minutes, a walk of `L` metres takes
  walkMinutes(L: number) { return ((L / 1.3) * this.timeScale) / 60; }

  private cross(f: CrossFlow): Part[] {
    const w = f.width ?? 2.4, fwd = straightRoute([f.a, f.b]), rev = reverseRoute(fwd), cap = capFor(f.count);
    const spec: GroupSpec & { cap: number } = {
      id: f.id, centre: { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 }, radius: fwd.length / 2 + 3, count: 0, cap,
      build: (b) => {
        for (let k = 0; k < cap; k++) {
          const r = personRand(f.id, k), look = dress(roleOf(r, f.mix ?? MIXES.street, this.year), this.year, r);
          if (look.prop === 1) look.prop = 0;
          const route = k % 2 ? rev : fwd;
          emitPerson(b, k, route, { mode: Mode.Loop, v: look.speed * 1.1, s0: vdc(k >> 1) * route.length, lat: (r() - 0.5) * w * 0.8, t0: 0, tShow: 0, tHide: 0, y: 0 }, look, r());
        }
      },
    };
    return [{ spec, count: () => f.count }];
  }

  // ----- standing about: window shoppers, drinkers outside the pub, parents at the gate -----
  private loiter(f: LoiterFlow): Part[] {
    const cap = capFor(f.count), y = f.y ?? 0, side = f.facing + Math.PI / 2;
    const spec: GroupSpec & { cap: number } = {
      id: f.id, centre: f.at, radius: f.width / 2 + 5, y, count: 0, cap,
      build: (b) => {
        const r0 = personRand(f.id + ':clusters', 0);
        let k = 0;
        while (k < cap) {
          const size = f.venue === 'shop' ? pickW(r0, [[1, 5], [2, 3]] as const) : pickW(r0, [[1, 1], [2, 3], [3, 3], [4, 2]] as const);
          const u = (vdc(k) - 0.5) * f.width;
          const back = f.venue === 'shop' ? range(r0, 0.6, 1.2) : f.venue === 'gate' ? range(r0, 1.5, 4) : range(r0, 1.4, 3.2);
          const c = along(along(f.at, side, u), f.facing + Math.PI, back);
          for (let i = 0; i < size && k < cap; i++, k++) {
            const r = personRand(f.id, k);
            const role: Role = f.venue === 'pub' ? 'drinker' : f.venue === 'gate' ? (r() < 0.2 ? 'parent' : 'public') : roleOf(r, f.mix ?? MIXES.highStreet, this.year);
            const look = dress(role, this.year, r);
            if (look.prop === 1) look.prop = 0;
            let p = c, h = f.facing + (r() - 0.5) * 0.6;
            if (size > 1) {
              // stand round in a ring, facing in
              const a = (i / size) * TAU + r0() * 0.5, R = 0.45 + size * 0.1;
              p = { x: c.x + Math.cos(a) * R, z: c.z + Math.sin(a) * R }; h = a + Math.PI + (r() - 0.5) * 0.4;
              look.idle = pick(r, [Idle.Chat, Idle.Chat, Idle.Stand, look.idle === Idle.Phone ? Idle.Phone : Idle.Chat]);
            } else if (f.venue === 'shop') look.idle = Idle.Stand;
            emitPerson(b, k, spot(p, h), still(y), look, r());
          }
        }
      },
    };
    return [{ spec, count: () => f.count }];
  }

  // ----- parks: strolls round the paths, dog walkers, dogs off the lead, benches, children -----
  private park(f: ParkFlow): Part[] {
    const c = polyCentre(f.area), bb = polyBounds(f.area), R = Math.hypot(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2 + 2;
    const loops: Route[] = f.paths?.length ? f.paths.flatMap((p) => { const r = fitRoute(p, 0.3); return [r, reverseRoute(r)]; }) : [parkLoop(f.area, 4), reverseRoute(parkLoop(f.area, 4))];
    const parts: Part[] = [];
    const nWalk = f.walkers + f.dogWalkers + (f.joggers ?? 0), capW = capFor(nWalk);
    const walkSpec: GroupSpec & { cap: number } = {
      id: `${f.id}:walk`, centre: c, radius: R, count: 0, cap: capW,
      build: (b) => {
        for (let k = 0; k < capW; k++) {
          const r = personRand(`${f.id}:walk`, k);
          const tot = f.walkers + f.dogWalkers + (f.joggers ?? 0) || 1;
          const x = r() * tot, role: Role = x < f.dogWalkers ? 'dogwalker' : x < f.dogWalkers + (f.joggers ?? 0) ? 'jogger' : roleOf(r, MIXES.park, this.year);
          const look = dress(role === 'dogwalker' ? 'dogwalker' : role, this.year, r);
          if (look.prop === 1 && r() < 0.7) { look.prop = 0; look.speed = 1.3; }
          const route = loops[k % loops.length], s0 = vdc(k) * route.length, lat = (r() - 0.5) * 0.8;
          const m: Motion = { mode: Mode.Closed, v: look.role === 'dogwalker' ? Math.min(look.speed, 1.15) : look.speed, s0, lat, t0: 0, tShow: 0, tHide: 0, y: 0 };
          if (!route.closed) m.mode = Mode.Loop;
          emitPerson(b, k, route, m, look, r());
          if (role === 'dogwalker') {
            const d = dogLook(r);
            emitAnimal(b, k, route, { ...m, s0: s0 + 1.5, lat: lat + (r() < 0.5 ? 0.6 : -0.6) }, d, r(), { lag: 1.5, lat });
          }
        }
      },
    };
    parts.push({ spec: walkSpec, count: () => f.walkers + f.dogWalkers + (f.joggers ?? 0) });
    // dogs off the lead: running rings round a standing owner, or nosing about near them
    const nLoose = f.looseDogs ?? 0, capL = capFor(nLoose);
    parts.push({
      spec: {
        id: `${f.id}:loose`, centre: c, radius: R, count: 0, cap: capL,
        build: (b) => {
          for (let k = 0; k < capL; k++) {
            const r = personRand(`${f.id}:loose`, k), h = r() * TAU;
            // somewhere a dog can run a ring round its owner without going through the pond
            let o = pointIn(r, f.area, 5), rad = range(r, 2.5, 5);
            for (let i = 0; i < 12 && clash(o, rad + 1.5, f.avoid); i++) { o = pointIn(r, f.area, 5); rad = range(r, 2.5, 5); }
            const look = dress('dogwalker', this.year, r);
            look.idle = pick(r, [Idle.Stand, Idle.Phone, Idle.Wait]);
            emitPerson(b, k, spot(o, h), still(), look, r());
            const d = dogLook(r);
            if (r() < 0.6) {
              const route = circleRoute(o, rad, r() * TAU, r() < 0.5);
              d.idle = 0;
              emitAnimal(b, k, route, { mode: Mode.Closed, v: range(r, 2.6, 3.6), s0: 0, lat: 0, t0: 0, tShow: 0, tHide: 0, y: 0 }, d, r());
            } else {
              d.idle = 1;
              emitAnimal(b, k, spot(along(o, h, range(r, 1.5, 4), (r() - 0.5) * 4), r() * TAU), still(), d, r());
            }
          }
        },
      } as GroupSpec & { cap: number },
      count: () => nLoose,
    });
    if (f.benches?.length) {
      const seats = f.benches.length * 2;
      parts.push({
        spec: {
          id: `${f.id}:sit`, centre: c, radius: R, count: 0, cap: seats,
          build: (b) => {
            for (let k = 0; k < seats; k++) {
              const bench = f.benches![k % f.benches!.length], r = personRand(`${f.id}:sit`, k);
              const look = dress(roleOf(r, { elderly: 3, public: 2, parent: 0.3, shopper: 1, office: 0.6 }, this.year), this.year, r);
              if (look.prop === 1 || look.prop === 2) look.prop = 0;
              look.idle = Idle.Sit;
              // along the bench, the first person on one end and the second on the other
              const u = k < f.benches!.length ? -0.45 : 0.45;
              emitPerson(b, k, spot(along(bench.at, bench.facing + Math.PI / 2, u), bench.facing), still(), look, r());
            }
          },
        } as GroupSpec & { cap: number },
        count: () => Math.min(seats, f.sitters ?? 0),
      });
    }
    const kids = f.kids ?? 0;
    if (kids) parts.push(this.playground(`${f.id}:kids`, f.play ?? c, 6, kids, 'child'));
    return parts;
  }
  // Children playing: tearing round in rings (tag), jumping about, standing in twos.
  private playground(id: string, at: XZ, radius: number, count: number, role: Role, school?: number, area?: XZ[]): Part {
    const cap = capFor(count);
    return {
      spec: {
        id, centre: at, radius: radius + 4, count: 0, cap,
        build: (b) => {
          for (let k = 0; k < cap; k++) {
            const r = personRand(id, k), look = dress(role, this.year, r, { school });
            look.prop = 0;
            const o = area ? pointIn(r, area, 2.5) : { x: at.x + (r() - 0.5) * radius * 1.6, z: at.z + (r() - 0.5) * radius * 1.6 };
            if (r() < 0.45) {
              const route = circleRoute(o, range(r, 1.5, 3.5), r() * TAU, r() < 0.5);
              emitPerson(b, k, route, { mode: Mode.Closed, v: range(r, 2.3, 3.2), s0: r() * route.length, lat: 0, t0: 0, tShow: 0, tHide: 0, y: 0 }, look, r());
            } else {
              look.idle = pick(r, [Idle.Play, Idle.Play, Idle.Chat, Idle.Stand]);
              emitPerson(b, k, spot(o, r() * TAU), still(), look, r());
            }
          }
        },
      } as GroupSpec & { cap: number },
      count: () => count,
    };
  }

  // ----- the school run: pupils (some with a parent) arrive, play in the yard until the bell,
  // go in; at home time they come out and parents wait at the gate -----
  private school(f: SchoolFlow): Part[] {
    const parts: Part[] = [];
    const [a0, a1] = f.arrive, [l0, l1] = f.leave;
    const each = f.pupils / Math.max(1, f.approaches.length);
    f.approaches.forEach((path, i) => {
      const inRoute = fitRoute(path, 0.3), outRoute = reverseRoute(inRoute);
      for (const [dir, route, w0, w1] of [['in', inRoute, a0, a1], ['out', outRoute, l0, l1]] as const) {
        const id = `${f.id}:${dir}:${i}`, span = Math.max(1, w1 - w0);
        const conc = Math.min(each, (each / span) * this.walkMinutes(route.length)), cap = capFor(conc);
        const spec: GroupSpec & { cap: number } = {
          id, centre: routeCentre(route), radius: routeRadius(route), count: 0, cap,
          build: (b) => {
            for (let k = 0; k < cap; k++) {
              const r = personRand(id, k), look = dress('pupil', this.year, r, { school: f.school });
              const young = look.height < 1.3, v = young ? 1.05 : Math.min(1.4, look.speed), lat = (r() - 0.5) * 1.2;
              const m: Motion = { mode: Mode.Loop, v, s0: vdc(k) * route.length, lat, t0: 0, tShow: 0, tHide: 0, y: 0 };
              emitPerson(b, k, route, m, look, r());
              if (young && r() < 0.6) {
                // walked to school by a parent (who turns for home at the gate), keeping the child's pace
                const p = dress(r() < 0.25 ? 'parent' : 'public', this.year, r);
                if (p.prop === 1) p.prop = 0;
                emitPerson(b, k, route, { ...m, lat: lat + (lat > 0 ? -0.55 : 0.55), s0: m.s0 + (dir === 'in' ? -0.3 : 0.3) }, p, r());
              }
            }
          },
        };
        parts.push({ spec, count: (c) => conc * windowRamp(c, w0, span) });
      }
    });
    // the yard fills as they arrive, empties at the bell; it fills again briefly at home time
    const yard = this.playground(`${f.id}:yard`, polyCentre(f.yard), 8, f.pupils * 0.6, 'pupil', f.school, f.yard);
    const base = yard.count;
    yard.count = (c) => {
      const m = ((c % 1440) + 1440) % 1440, n = base(c);
      if (m >= a0 && m < a1) return n * clamp((m - a0) / (a1 - a0), 0, 1);
      if (m >= a1 && m < a1 + 3) return n * (1 - (m - a1) / 3);
      if (m >= 10.5 * 60 && m < 10.5 * 60 + 15) return n; // morning break
      if (m >= 12.25 * 60 && m < 13 * 60) return n; // dinner time
      if (m >= l0 - 2 && m < l1) return n * 0.3 * (1 - (m - l0) / (l1 - l0));
      return 0;
    };
    parts.push(yard);
    const gate = this.loiter({ kind: 'loiter', id: `${f.id}:gate`, at: f.gate, facing: Math.atan2(polyCentre(f.yard).z - f.gate.z, polyCentre(f.yard).x - f.gate.x), width: 10, count: Math.ceil(f.pupils * 0.12), venue: 'gate' })[0];
    const gBase = gate.count;
    gate.count = (c) => { const m = ((c % 1440) + 1440) % 1440; return (m >= l0 - 12 && m < l0 + 4) || (m >= a0 && m < a1 + 4) ? gBase(c) : 0; };
    parts.push(gate);
    return parts;
  }

  // ----- animals: livestock in fields, pigeons in squares, ducks on ponds, cats on walls -----
  private animals(f: AnimalFlow): Part[] {
    const cap = capFor(f.count), y = f.y ?? 0;
    const centre = f.area ? polyCentre(f.area) : f.spots?.[0]?.at ?? f.lines?.[0]?.line[0] ?? { x: 0, z: 0 };
    const bb = f.area ? polyBounds(f.area) : null;
    const R = bb ? Math.hypot(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2 + 3 : 30;
    const spec: GroupSpec & { cap: number } = {
      id: f.id, centre, radius: R, y, count: 0, cap,
      build: (b) => {
        const r0 = personRand(f.id + ':herd', 0);
        // a few loose knots of animals, not an even scatter
        const knots = f.area ? Array.from({ length: Math.max(1, Math.round(cap / 7)) }, () => pointIn(r0, f.area!, 3)) : [];
        for (let k = 0; k < cap; k++) {
          const r = personRand(f.id, k);
          const near = () => { const kn = pick(r, knots); for (let i = 0; i < 8; i++) { const p = { x: kn.x + (r() - 0.5) * 12, z: kn.z + (r() - 0.5) * 12 }; if (inPoly(p, f.area!)) return p; } return kn; };
          if (f.species === 'sheep' || f.species === 'cow') {
            const sheep = f.species === 'sheep';
            const coat = sheep ? hex(pick(r, ['#ece6d8', '#e4dccb', '#f2eee4', '#d9d0bd'])) : hex(pick(r, ['#f2f0ea', '#f2f0ea', '#7a3a1e', '#b0642a', '#1c1a18']));
            const look: AnimalLook = { species: SPECIES.indexOf(f.species), size: range(r, 0.9, 1.08), idle: 3, coat, second: hex(sheep ? '#2b2522' : '#1c1a18'), pattern: sheep ? 0 : coat === hex('#f2f0ea') ? 1 : 0, dark: hex(sheep ? (r() < 0.7 ? '#2b2522' : '#e8e2d6') : '#3a2a22') };
            const p = near();
            if (r() < 0.3) emitAnimal(b, k, circleRoute(p, range(r, 2.5, 5), r() * TAU, r() < 0.5), { mode: Mode.Closed, v: range(r, 0.12, 0.25), s0: 0, lat: 0, t0: 0, tShow: 0, tHide: 0, y }, look, r());
            else { look.idle = r() < 0.8 ? 3 : r() < 0.5 ? 4 : 0; emitAnimal(b, k, spot(p, r() * TAU), still(y), look, r()); }
          } else if (f.species === 'cat') {
            const coat = hex(pick(r, ['#1c1a18', '#c97a3a', '#8a7a6a', '#6a5a4a', '#e8e4dc']));
            const look: AnimalLook = { species: SPECIES.indexOf('cat'), size: range(r, 0.9, 1.1), idle: 2, coat, second: hex('#f2f0ea'), pattern: r() < 0.3 ? 1 : 0, dark: hex('#e0a0a0') };
            if (f.lines?.length && r() < 0.3) { const ln = pick(r, f.lines), route = fitRoute(ln.line); emitAnimal(b, k, route, { mode: Mode.Loop, v: 0.5, s0: r() * route.length, lat: 0, t0: 0, tShow: 0, tHide: 0, y: ln.y }, { ...look, idle: 0 }, r()); }
            else if (f.spots?.length) { const s = f.spots[k % f.spots.length]; emitAnimal(b, k, spot(s.at, s.facing + (r() - 0.5) * 0.8), still(s.y), { ...look, idle: pick(r, [2, 2, 4]) }, r()); }
            else if (f.area) emitAnimal(b, k, spot(near(), r() * TAU), still(y), look, r());
          } else {
            const duck = f.species === 'duck', drake = r() < 0.5;
            const look: BirdLook = duck
              ? { species: 1, size: range(r, 0.9, 1.05), idle: 1, body: hex(drake ? '#8a8378' : '#8a6a4a'), head: hex(drake ? '#1f5a2e' : '#7a5a3a'), wing: hex(drake ? '#6a5a4a' : '#6a4a2e'), beak: hex(drake ? '#d9c22a' : '#d98a2a') }
              : { species: 0, size: range(r, 0.9, 1.1), idle: 0, body: hex(pick(r, ['#8a8d95', '#7a7d85', '#9a9ca2', '#5a5a60'])), head: hex('#4f6070'), wing: hex(pick(r, ['#a0a4aa', '#8a8d95'])), beak: hex('#2b2b2b') };
            const p = f.area ? (duck ? pointIn(r, f.area, 1.5) : near()) : centre;
            if (duck || r() < 0.4) emitBird(b, k, circleRoute(p, range(r, 0.6, duck ? 3 : 1.5), r() * TAU, r() < 0.5), { mode: Mode.Closed, v: duck ? range(r, 0.15, 0.3) : range(r, 0.25, 0.4), s0: 0, lat: 0, t0: 0, tShow: 0, tHide: 0, y }, look, r());
            else emitBird(b, k, spot(p, r() * TAU), still(y), look, r());
          }
        }
      },
    };
    return [{ spec, count: () => f.count }];
  }
}

// 0 before a window opens, easing to 1 over its first tenth, back to 0 over the minutes after it
// closes (the last to set off are still on their way).
export function windowRamp(clock: number, start: number, span: number) {
  const t = (((clock - start) % 1440) + 1440) % 1440;
  const up = Math.max(2, span * 0.1), down = Math.max(3, span * 0.25);
  if (t < up) return t / up;
  if (t < span) return 1;
  if (t < span + down) return 1 - (t - span) / down;
  return 0;
}

// Everything about a flow except its counts: when this changes, its crowd is rebuilt.
function shapeKey(f: Flow, year: number) {
  const o = { ...f } as Record<string, unknown>;
  for (const k of ['waiting', 'count', 'walkers', 'dogWalkers', 'looseDogs', 'joggers', 'sitters', 'kids', 'pupils', 'total']) delete o[k];
  return `${year}|${JSON.stringify(o)}`;
}

// ---------- building flows from the game's geometry ----------
// The two footways of a road, from its centreline and cross-section (kerb and back of
// pavement, measured from the centreline, as catalog.ts kerbOf()/halfOf() give them).
// Side +1 is the left of the direction the points run in.
export function footwaysOf(path: XZ[], kerb: number, back: number, y = 0): Footway[] {
  if (back - kerb < 0.8) return [];
  const mid = (kerb + back) / 2, width = back - kerb;
  return [{ line: offsetLine(path, mid), width, y }, { line: offsetLine(path, -mid), width, y }];
}
// A bus stop site from a point on a road: `side` +1 is the left of the road's direction.
// People queue back along the pavement from the flag, facing the road.
export function stopSite(id: string, p: XZ, heading: number, side: 1 | -1, kerb: number, back: number, o: { shelter?: boolean; y?: number } = {}): QueueSite {
  const n = { x: Math.sin(heading) * side, z: -Math.cos(heading) * side }; // towards this side's pavement
  const d = kerb + Math.min(0.9, (back - kerb) * 0.35);
  const at = { x: p.x + n.x * d, z: p.z + n.z * d };
  const facing = Math.atan2(-n.z, -n.x);
  // the queue runs back against the direction the bus comes from (it arrives travelling `heading`
  // on the left side, or the reverse on the right)
  const busDir = side === 1 ? heading : heading + Math.PI;
  const alongQ = busDir + Math.PI;
  const sd = back - 0.8;
  const shelter = o.shelter && back - kerb >= 2.4 ? { at: { x: p.x + n.x * sd + Math.cos(alongQ) * 2.5, z: p.z + n.z * sd + Math.sin(alongQ) * 2.5 }, along: alongQ, seats: 3 } : undefined;
  const away = footwaysOf([{ x: p.x - Math.cos(heading) * 40, z: p.z - Math.sin(heading) * 40 }, { x: p.x + Math.cos(heading) * 40, z: p.z + Math.sin(heading) * 40 }], kerb, back)[side === 1 ? 0 : 1].line;
  return { id, kind: 'stop', at, along: alongQ, facing, y: o.y, shelter, away: [away] };
}
export { legPoint };
