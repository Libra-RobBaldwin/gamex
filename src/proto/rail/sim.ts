// Trains that run lines under signals (docs/rail.md).
//
// Every train holds the blocks its body stands in, plus the blocks reserved ahead of it: its
// movement authority. It may only enter a block reserved for it, and a block is reserved for one
// train at a time, only once it is clear. Reservations are made in chunks that run on to a safe
// block (track.ts), all or nothing, so on a single line two trains never set off towards each
// other: the second waits at its loop until the first has arrived. Points are "set" by the
// reservation: the route the train was given is the way it goes through them.
//
// A train brakes for the end of its authority (the next red signal) with its own service brake
// (catalog.ts trainBraking), and can never move past it: each step is cut short at the signal. It
// runs its line A→B→C→B→A (or round a loop) from a depot siding, stopping at each station's
// platform with the right dwell and its doors open on the platform side.
import { trainBraking, trainSpeed, type RoadDef, type TrainDef } from '../catalog';
import { atDir, type Dir, type Piece, type Step, type TrackGraph } from './track';
import { LevelCrossing, type CrossingSite } from './crossing';

// The same shape as a bus line (game/lines.ts): stops in order, looping or there and back. Here the
// stops are stations, and `depot` names the station whose siding the line's trains come from.
// (`other`: run by another company, through the map between its ways off (game/portals.ts): not the player's)
// (`spacing`: false when the line's even-gaps switch is off, see holdOn; on otherwise)
export interface RailLine { id: number; num: number; stops: number[]; loop: boolean; offer?: string; depot?: number; colour?: string; other?: string; spacing?: boolean }
export function callOrder(stops: number[], loop: boolean) { return loop || stops.length < 3 ? [...stops] : [...stops, ...stops.slice(1, -1).reverse()]; }

export type TrainState = 'run' | 'dwell' | 'held';
interface StopAt { k: number; u: number; station: number; depot?: boolean } // k: index into the route (-1: on the front piece)
export interface Train {
  id: number; def: TrainDef; length: number; line: RailLine | null; leg: number;
  body: Step[]; u: number; v: number; // the pieces it's on, tail's first; its front u along the last
  route: Step[]; stop: StopAt | null; resv: number; later: Step[]; // the way ahead; how much of it is reserved; blocks held beyond its stop
  state: TrainState; dwell: number; dwellFor: number; doors: 0 | 1; doorSide: 1 | -1; // doors: open on the left (+1) or right of the way it's facing
  flipped: boolean; // the driver has changed ends: its first car is now at the back
  waited: number; replanAt: number; station?: number; // standing at this station
  lastCall?: { k: number; t: number }; // its last call: which of the line's calls, and when (for the even-gaps rule)
  holdSince?: number; heldLeg?: number; // holding at this platform to open the gap to the train ahead (sim time the hold began); the call it last held at
  held: Set<number>;
  dress?: unknown; // how the game draws it (game/fleet.ts)
  calls: number; // calls made
}
export interface CallEvent { train: number; line: number; station: number; call: number; t: number } // (call: which of the line's calls, in callOrder)
const LA_MIN = 250; // reserve at least this far ahead
const PLAT_MPH = 40, DEPOT_MPH = 15, POINTS_MPH = 50;
const DWELL = 15; // seconds at a platform, before anyone boards (onCall adds to it)
const REVERSE_COST = 400;
export const SIGNAL_BACK = 12; // a signal stands this far short of the end of its block (clear of the points beyond)
const STOP_BACK = 2; // a train calling draws up this far short of the platform's end
const HOLD_MAX = 60; // seconds a train will hold at a platform to let the train ahead of it get away
const HOLD_LOOK = 4; // seconds between looks, while holding, at whether the train ahead is far enough away yet

export class RailSim {
  owner: Int32Array;
  // a block over a level crossing, claimed by a train with the rest of its run but not yet held:
  // it's held (owner) only once the train is near, the barriers are down and the road is clear
  claim: Int32Array;
  trains: Train[] = [];
  lines: RailLine[] = [];
  crossings: LevelCrossing[] = [];
  crossingSites: CrossingSite[] = [];
  time = 0;
  log: CallEvent[] = [];
  stats = { redPassed: 0, reservations: 0, calls: 0, replans: 0, holds: 0 };
  // how long each of a line's legs takes (call to next call, dwell included), by line id: measured
  // as its trains run them, estimated from the planned route until one has
  private legT = new Map<number, (number | undefined)[]>();
  private legEst = new Map<number, (number | undefined)[]>();
  // is the road over this crossing clear of vehicles? (the traffic says; nothing on it in tests)
  roadClear: (c: CrossingSite) => boolean = () => true;
  // a train has pulled up at a platform: how long it should stand (the crowds board it)
  onCall?: (t: Train, station: number, side: 1 | -1) => number;
  private nextId = 1;
  private pending: { train: Train; station: number }[] = []; // trains waiting to come out of a full depot

  constructor(public graph: TrackGraph, crossings: CrossingSite[] = []) {
    this.owner = new Int32Array(graph.blocks.length);
    this.claim = new Int32Array(graph.blocks.length);
    this.attach(crossings);
  }
  // the level crossings changed (a road built across the line) on track that didn't
  setCrossings(sites: CrossingSite[]) { this.attach(sites); }
  private attach(sites: CrossingSite[]) {
    const old = new Map(this.crossings.map((c) => [`${c.site.rail}:${c.site.road}:${Math.round(c.site.railS)}`, c]));
    this.crossingSites = sites;
    this.crossings = sites.map((s) => { const o = old.get(`${s.rail}:${s.road}:${Math.round(s.railS)}`); const c = new LevelCrossing(s); if (o) { c.state = o.state; c.t = o.t; } return c; });
    for (const b of this.graph.blocks) b.crossings = [];
    sites.forEach((s, i) => {
      for (const id of this.graph.bySeg.get(s.rail) ?? []) {
        const p = this.graph.pieces[id];
        if (p.pts.some((q, j) => j && distToSeg(s, p.pts[j - 1], q) < 4.5) && !this.graph.blocks[p.block].crossings.includes(i)) this.graph.blocks[p.block].crossings.push(i);
      }
    });
  }

  // is a block held or claimed by a train other than this one?
  taken(b: number, id = 0) { const o = this.owner[b], c = this.claim[b]; return (o !== 0 && o !== id) || (c !== 0 && c !== id); }

  // ---------- trains ----------
  piece(s: Step) { return this.graph.pieces[s.piece]; }
  front(t: Train) { return t.body[t.body.length - 1]; }
  // where the train's front is, and a point `back` metres behind it along the track
  pose(t: Train, back = 0) {
    let i = t.body.length - 1, u = t.u - back;
    while (u < 0 && i > 0) { i--; u += this.piece(t.body[i]).len; }
    const s = t.body[i], uu = Math.max(0, u);
    return { ...atDir(this.piece(s), s.dir, uu), piece: s.piece, dir: s.dir, u: uu };
  }
  // A train for a line: it comes out of the depot (or, with none, starts at the first station)
  // and runs to the first call. Refused, with the reason, if it can't use the line's track.
  addTrain(def: TrainDef, line: RailLine, dress?: unknown): Train | string {
    const length = def.cars * def.carLen + (def.cars - 1) * 0.9;
    const fits = this.fits(def, length, line, true);
    if (fits) return fits;
    const t: Train = {
      id: this.nextId++, def, length, line, leg: 0, body: [], u: 0, v: 0, route: [], stop: null, resv: 0, later: [],
      state: 'held', dwell: 0, dwellFor: 0, doors: 0, doorSide: 1, flipped: false, waited: 0, replanAt: 0, held: new Set(), dress, calls: 0,
    };
    const st = line.depot ?? line.stops[0];
    this.pending.push({ train: t, station: st });
    this.release();
    return t;
  }
  // How many trains a line can run without them blocking each other for good: on a single line,
  // one more than the places they can pass (its passing loops); on double track, any number.
  // Lines that share a single-track station share its line, so they're counted together: the
  // group of lines linked that way, all their stations, and how many trains they may run between them.
  capacity(line: RailLine) { return this.group(line).cap; }
  group(line: RailLine) {
    const g = this.graph, single = (s: number) => (g.platforms.get(s) ?? []).some((i) => g.pieces[i].oneWay === 0);
    const lines = new Set<RailLine>([line]), all = [...new Set([...this.lines, line])];
    for (let grew = true; grew;) {
      grew = false;
      for (const l of all) if (!lines.has(l) && l.stops.some((s) => single(s) && [...lines].some((m) => m.stops.includes(s)))) { lines.add(l); grew = true; }
    }
    const stations = new Set([...lines].flatMap((l) => l.stops));
    if (![...stations].some(single)) return { lines, cap: Infinity };
    const loops = [...stations].filter((s) => { const ps = (g.platforms.get(s) ?? []).map((i) => g.pieces[i]); return ps.length >= 2 && ps.every((p) => p.oneWay === 0); }).length;
    return { lines, cap: 1 + loops };
  }
  // Is there a way by rail for a train of this kind from one station's platforms to another's,
  // through the points as trains take them (track.ts exits), setting off either way (reversals)?
  reachable(from: number, to: number, def: TrainDef) {
    const g = this.graph, goal = new Set((g.platforms.get(to) ?? []).filter((i) => g.usable(g.pieces[i], def)));
    if (!goal.size) return false;
    const key = (s: Step) => s.piece * 2 + (s.dir === 1 ? 1 : 0), seen = new Set<number>(), open: Step[] = [];
    for (const i of g.platforms.get(from) ?? []) {
      const p = g.pieces[i];
      if (!g.usable(p, def)) continue;
      for (const d of (p.oneWay ? [p.oneWay] : [1, -1]) as Dir[]) { open.push({ piece: i, dir: d }); open.push(...g.reversals(i, d)); }
    }
    while (open.length) {
      const s = open.pop()!;
      if (seen.has(key(s))) continue;
      seen.add(key(s));
      if (goal.has(s.piece)) return true;
      for (const e of g.exits(s.piece, s.dir)) if (g.usable(g.pieces[e.piece], def) && g.pieces[e.piece].depot === undefined) open.push(e);
    }
    return false;
  }
  // Why a train can't run a line (null if it can): too long for a platform, track it can't use,
  // or no way by rail between two of its calls.
  fits(def: TrainDef, length: number, line: RailLine, adding = false): string | null {
    if (adding) {
      const { lines, cap } = this.group(line), n = this.trains.filter((t) => t.line && lines.has(t.line)).length + this.pending.filter((p) => p.train.line && lines.has(p.train.line)).length;
      const loops = cap - 1 === 0 ? 'no passing loops' : cap - 1 === 1 ? 'one passing loop' : `${cap - 1} passing loops`, trains = `${cap} train${cap === 1 ? '' : 's'}`;
      if (n >= cap) return lines.size > 1 ? `These lines share a single line with ${loops}: together they can only run ${trains} · add a station with a loop` : `A single line with ${loops} can only run ${trains} · add a station with a loop`;
    }
    for (const s of line.stops) {
      const plats = this.graph.platforms.get(s);
      if (!plats?.length) return 'One of its stations isn’t on the track any more';
      const longest = Math.max(...plats.map((i) => { const p = this.graph.pieces[i]; return p.plat ? p.plat.u1 - p.plat.u0 : 0; }));
      if (length > longest - STOP_BACK + 0.5) return `Too long for the platforms (${Math.round(length)} m train, ${Math.round(longest)} m platform)`;
      if (!plats.some((i) => this.graph.usable(this.graph.pieces[i], def))) return def.needsWires ? 'It needs electrified line' : def.rack ? 'Rack track only at one of the stations' : 'The line is too steep for it';
    }
    const calls = callOrder(line.stops, line.loop);
    for (let i = 0; i < calls.length; i++) {
      const a = calls[i], b = calls[(i + 1) % calls.length];
      if (a !== b && !this.reachable(a, b, def)) return `No way by rail from station ${a} to station ${b}`;
    }
    return null;
  }
  // a line withdrawn: its trains leave the track, and any still waiting to come out of the depot go too
  removeLine(line: RailLine) {
    for (const t of [...this.trains, ...this.pending.map((p) => p.train)]) if (t.line === line) this.removeTrain(t);
    this.lines = this.lines.filter((l) => l !== line);
    this.legT.delete(line.id); this.legEst.delete(line.id);
  }
  removeTrain(t: Train) {
    this.trains = this.trains.filter((x) => x !== t);
    this.pending = this.pending.filter((p) => p.train !== t);
    for (const b of t.held) { if (this.owner[b] === t.id) this.owner[b] = 0; if (this.claim[b] === t.id) this.claim[b] = 0; }
    t.held.clear();
  }
  // bring waiting trains out onto the track where there's room
  private release() {
    for (const p of [...this.pending]) {
      const t = p.train, g = this.graph;
      const depot = g.depots.get(p.station);
      let place: { step: Step; u: number } | null = null;
      if (depot !== undefined) {
        const dp = g.pieces[depot], dir: Dir = g.nodes.get(dp.b)!.pieces.length === 1 ? 1 : -1;
        place = { step: { piece: depot, dir }, u: dp.len - 6 };
      } else {
        for (const pi of g.platforms.get(p.station) ?? []) {
          const pc = g.pieces[pi];
          if (!g.usable(pc, t.def) || this.taken(pc.block)) continue;
          const dir: Dir = pc.oneWay || 1, u = dir === 1 ? pc.plat!.u1 - STOP_BACK : pc.len - pc.plat!.u0 - STOP_BACK;
          place = { step: { piece: pi, dir }, u };
          break;
        }
      }
      if (!place) continue;
      const body = this.backFrom(place.step, place.u, t.length);
      const blocks = new Set(body.map((s) => g.pieces[s.piece].block));
      if ([...blocks].some((b) => this.taken(b))) continue;
      t.body = body; t.u = place.u; t.v = 0; t.held = blocks;
      for (const b of blocks) this.owner[b] = t.id;
      t.state = 'held'; t.station = depot === undefined ? p.station : undefined;
      if (depot === undefined) t.leg = Math.max(0, callOrder(t.line!.stops, t.line!.loop).indexOf(p.station)) + 1;
      this.trains.push(t);
      this.pending = this.pending.filter((x) => x !== p);
      this.plan(t);
    }
  }
  // the pieces behind a point, far enough back for a train of this length (the straightest way)
  private backFrom(step: Step, u: number, length: number): Step[] {
    const out = [step];
    let acc = u;
    while (acc < length) {
      const prev = this.graph.entries(out[0].piece, out[0].dir)[0];
      if (!prev || out.some((s) => s.piece === prev.piece)) break;
      out.unshift(prev);
      acc += this.piece(prev).len;
    }
    return out;
  }
  get waiting() { return this.pending.length; }

  // ---------- routes ----------
  private next(t: Train) { const calls = callOrder(t.line!.stops, t.line!.loop); return calls[t.leg % calls.length]; }
  // Plan the way to the train's next call: the shortest way through the track it can use, keeping
  // off blocks other trains hold where there's another way (the other platform of a loop). From a
  // standstill it may set off the other way first (from a terminus, or back out of the depot).
  plan(t: Train): boolean {
    if (!t.line) return false;
    this.stats.replans++;
    const g = this.graph, target = this.next(t), plats = new Set(g.platforms.get(target) ?? []);
    const standing = t.v < 0.05;
    const penal = (p: Piece) => { return this.taken(p.block, t.id) ? (g.blocks[p.block].kind === 'platform' ? 3000 : 400) : 0; };
    const stopU = (p: Piece, d: Dir) => (d === 1 ? p.plat!.u1 - STOP_BACK : p.len - p.plat!.u0 - STOP_BACK);
    // states: a piece and the way along it; the cost is the distance to its start
    type Node = { key: number; step: Step; g: number; prev: number; rev: boolean };
    const best = new Map<number, Node>(), heap: Node[] = [];
    const key = (s: Step) => s.piece * 2 + (s.dir === 1 ? 1 : 0);
    const push = (n: Node) => { const o = best.get(n.key); if (o && o.g <= n.g) return; best.set(n.key, n); heapPush(heap, n); };
    const f = this.front(t);
    push({ key: key(f), step: f, g: -t.u, prev: -1, rev: false });
    let flip: { body: Step[]; u: number } | null = null;
    if (standing) {
      const tail = t.body[0], tp = this.piece(tail), tailU = this.tailU(t);
      const rs = g.reversals(tail.piece, tail.dir);
      if (rs.length) {
        const nb = [...t.body].reverse().map((s) => g.reversals(s.piece, s.dir)[0]);
        if (nb.every(Boolean)) { flip = { body: nb, u: tp.len - tailU }; push({ key: key(nb[nb.length - 1]) + 1e7, step: nb[nb.length - 1], g: REVERSE_COST - flip.u, prev: -1, rev: true }); }
      }
    }
    let goal: { n: Node; u: number; cost: number } | null = null;
    while (heap.length) {
      const n = heapPop(heap);
      if (best.get(n.key) !== n) continue;
      if (goal && n.g >= goal.cost) break;
      const p = this.piece(n.step);
      if (plats.has(p.id) && p.plat && g.usable(p, t.def)) {
        // (on the piece it starts on, only a stop still ahead of the front)
        const su = stopU(p, n.step.dir), here = n.prev === -1 ? (n.rev ? flip!.u : t.u) : 0;
        if (su >= here - 0.5 && (!goal || n.g + su < goal.cost)) goal = { n, u: su, cost: n.g + su };
      }
      for (const e of g.exits(n.step.piece, n.step.dir)) {
        const q = this.piece(e);
        if (!g.usable(q, t.def) || (q.depot !== undefined)) continue;
        push({ key: key(e) + (n.rev ? 1e7 : 0), step: e, g: n.g + p.len + penal(q), prev: n.key, rev: n.rev });
      }
    }
    if (!goal) return false;
    const steps: Step[] = [];
    for (let n: Node | undefined = goal.n; n && n.prev !== -1; n = best.get(n.prev)) steps.unshift(n.step);
    if (goal.n.rev) {
      if (!flip) return false;
      // the driver changes ends: the train now faces the other way, on the same track (or the one alongside)
      const blocks = new Set(flip.body.map((s) => g.pieces[s.piece].block));
      if ([...blocks].some((b) => this.taken(b, t.id))) return false;
      t.body = flip.body; t.u = flip.u; t.flipped = !t.flipped;
      for (const b of blocks) { this.owner[b] = t.id; t.held.add(b); }
    }
    t.route = steps; t.resv = 0; t.later = [];
    t.stop = { k: steps.length - 1, u: goal.u, station: target };
    this.dropHeld(t);
    return true;
  }
  private stationAt(t: Train) { return this.piece(this.front(t)).plat?.station; }
  private tailU(t: Train) {
    let acc = t.u;
    for (let i = t.body.length - 2; i >= 0; i--) acc += this.piece(t.body[i]).len;
    return acc - t.length; // along the tail piece, the way the train faces
  }

  // ---------- signalling ----------
  // Extend the train's authority: chunk by chunk, each running on to a safe block, all its blocks
  // free (or ours) and every level crossing in it down and clear.
  private reserve(t: Train, want: Set<number>) {
    const g = this.graph, b = trainBraking(t.def).brake;
    const la = Math.max(LA_MIN, (t.v * t.v) / (2 * b) + 150);
    for (let guard = 0; guard < 20; guard++) {
      if (t.resv >= t.route.length) break;
      if (this.authority(t, true) >= la) break;
      // a chunk: on to the end of the next safe block
      let j = t.resv;
      const chunk: number[] = [];
      while (j < t.route.length) {
        const blk = this.piece(t.route[j]).block;
        if (!chunk.includes(blk)) chunk.push(blk);
        j++;
        const nextBlk = j < t.route.length ? this.piece(t.route[j]).block : -1;
        if (g.blocks[blk].safe && nextBlk !== blk) break;
      }
      const fresh = chunk.filter((x) => this.owner[x] !== t.id && this.claim[x] !== t.id);
      if (fresh.some((x) => this.taken(x, t.id))) break;
      if (this.lastTrackAtLoop(t, t.route[j - 1])) break;
      // (a block over a level crossing is only claimed now: see approach())
      for (const x of fresh) { if (g.blocks[x].crossings.length) this.claim[x] = t.id; else this.owner[x] = t.id; t.held.add(x); }
      void want;
      this.stats.reservations++;
      t.resv = j;
    }
  }
  // Would this take the last free track at a passing loop while a train going our way holds the
  // other? Then a train coming the other way would have nowhere to pass us: wait where we are.
  private lastTrackAtLoop(t: Train, last: Step) {
    const g = this.graph, p = this.piece(last);
    if (!p.plat || p.oneWay !== 0) return false;
    const plats = g.platforms.get(p.plat.station) ?? [];
    if (plats.length < 2) return false;
    // (only where trains come the other way: on a ring every line runs round one way, and holding
    // back there would only stop the trains ahead leaving)
    const st = p.plat.station, both = this.lines.some((l) => !l.loop && l.stops.includes(st)) || this.trains.some((o) => o !== t && o.route.concat(o.body).some((x) => plats.includes(x.piece) && x.dir !== last.dir));
    if (!both) return false;
    let sameWay = false;
    for (const i of plats) {
      if (i === p.id) continue;
      const o = this.owner[g.pieces[i].block] || this.claim[g.pieces[i].block];
      if (!o || o === t.id) return false; // a track is still free
      const ot = this.trains.find((x) => x.id === o), st = ot?.body.find((s) => s.piece === i) ?? ot?.route.find((s) => s.piece === i);
      if (st && st.dir === last.dir) sameWay = true;
    }
    return sameWay;
  }
  // Nearing a level crossing it has claimed: the barriers come down in time for it to run on at
  // speed (their 9 s, and its braking distance), and once they're down and the road is clear the
  // block is the train's.
  private approach(t: Train, want: Set<number>) {
    const b = trainBraking(t.def).brake, reach = (t.v * t.v) / (2 * b) + t.v * 11 + 80;
    let d = this.piece(this.front(t)).len - t.u;
    for (let i = 0; i < t.resv && d < reach + 1000; i++) {
      const blk = this.piece(t.route[i]).block;
      if (this.claim[blk] === t.id && this.owner[blk] !== t.id) {
        if (d > reach) break;
        const xs = this.graph.blocks[blk].crossings;
        for (const c of xs) want.add(c);
        if (xs.every((c) => this.crossings[c].down && this.roadClear(this.crossings[c].site)) && this.owner[blk] === 0) { this.owner[blk] = t.id; this.claim[blk] = 0; }
        else break;
      }
      d += this.piece(t.route[i]).len;
    }
  }
  // how far the train may go: to its stop, or to the signal at the end of what's reserved, which
  // stands SIGNAL_BACK short of the block's end so a train held there is clear of the points
  authority(t: Train, ignoreStop = false) {
    let d = this.piece(this.front(t)).len - t.u;
    if (!ignoreStop && t.stop && t.stop.k === -1) return t.stop.u - t.u;
    for (let i = 0; i < t.resv; i++) {
      const b = this.piece(t.route[i]).block;
      // (the signal before a level crossing stays red until the barriers are down and the road clear)
      if (!ignoreStop && this.owner[b] !== t.id && this.claim[b] === t.id) return d - this.signalBack(i ? t.route[i - 1] : this.front(t));
      if (!ignoreStop && t.stop && t.stop.k === i) return d + t.stop.u;
      d += this.piece(t.route[i]).len;
    }
    if (ignoreStop || (t.resv >= t.route.length && t.stop)) return d;
    return d - this.signalBack(t.resv ? t.route[t.resv - 1] : this.front(t));
  }
  // how far short of a piece's end its signal stands: clear of the points beyond (at least SIGNAL_BACK)
  signalBack(s: Step) { const p = this.piece(s); return Math.min(p.len * 0.6, Math.max(SIGNAL_BACK, s.dir === 1 ? p.clearB : p.clearA)); }
  // release blocks the train is clear of and no longer needs
  private dropHeld(t: Train) {
    const need = new Set<number>();
    for (const s of t.body) need.add(this.piece(s).block);
    for (let i = 0; i < t.resv; i++) need.add(this.piece(t.route[i]).block);
    for (const s of t.later) need.add(this.piece(s).block);
    for (const b of t.held) if (!need.has(b)) { t.held.delete(b); if (this.owner[b] === t.id) this.owner[b] = 0; if (this.claim[b] === t.id) this.claim[b] = 0; }
  }
  // The aspect each signal shows, by the piece and direction it stands at the end of: 0 red, 1 single
  // yellow, 2 double yellow, 3 green (UK four-aspect: how many blocks ahead are clear for the train).
  aspects(): Map<number, number> {
    const out = new Map<number, number>();
    for (const t of this.trains) {
      const steps = [this.front(t), ...t.route.slice(0, t.resv)];
      const trans: number[] = [];
      for (let i = 0; i + 1 < steps.length; i++) if (this.piece(steps[i]).block !== this.piece(steps[i + 1]).block) trans.push(i);
      trans.forEach((i, n) => { const s = steps[i]; out.set(s.piece * 2 + (s.dir === 1 ? 1 : 0), Math.min(3, trans.length - n)); });
    }
    return out;
  }
  // where signals stand: the end of every piece a train leaves into another block
  signals(): Step[] {
    const g = this.graph, out: Step[] = [];
    for (const p of g.pieces) for (const d of [1, -1] as Dir[]) {
      if (p.oneWay !== 0 && p.oneWay !== d) continue;
      const ex = g.exits(p.id, d);
      if (ex.some((e) => g.pieces[e.piece].block !== p.block)) out.push({ piece: p.id, dir: d });
    }
    return out;
  }

  // ---------- moving ----------
  update(dt: number) {
    this.time += dt;
    this.release();
    const want = new Set<number>();
    for (const t of this.trains) this.step(t, dt, want);
    // a crossing stays down while any train holds a block over it
    this.crossings.forEach((c, i) => {
      const held = this.graph.blocks.some((b) => b.crossings.includes(i) && this.owner[b.id] !== 0);
      c.update(dt, held || want.has(i));
    });
  }
  private step(t: Train, dt: number, want: Set<number>) {
    if (t.state === 'dwell') {
      t.dwell += dt;
      // its boarding done (the doors would shut now): hold on, doors open, while the train ahead
      // on its line is too close (holdOn), looking again every few seconds; then the doors shut and it's off
      if (t.dwell >= t.dwellFor - 3 && (t.holdSince !== undefined || t.heldLeg !== t.leg)) {
        if (this.holdOn(t)) { if (t.holdSince === undefined) { t.holdSince = this.time; this.stats.holds++; } t.dwellFor = t.dwell + 3 + HOLD_LOOK; }
        else if (t.holdSince !== undefined) { t.holdSince = undefined; t.heldLeg = t.leg; }
        else t.heldLeg = t.leg;
      }
      t.doors = t.dwell > 1 && t.dwell < t.dwellFor - 3 ? 1 : 0;
      if (t.dwell < t.dwellFor) return;
      t.doors = 0;
      t.leg++;
      t.state = 'held';
      t.station = undefined;
      if (!this.plan(t)) { t.leg--; t.state = 'dwell'; t.dwell = t.dwellFor - 2; t.station = t.stop?.station ?? this.stationAt(t); return; }
      this.estimateLeg(t);
    }
    if (t.state === 'held') {
      if (!t.route.length && !t.stop && this.time >= t.replanAt) { t.replanAt = this.time + 5; this.plan(t); }
      if (t.route.length || t.stop) t.state = 'run';
      else return;
    }
    this.reserve(t, want);
    this.approach(t, want);
    const { accel, brake } = trainBraking(t.def);
    const f = this.front(t), fp = this.piece(f), q = atDir(fp, f.dir, t.u);
    const lim = (p: Piece) => {
      let v = trainSpeed(t.def, { mph: p.mph, rack: p.rack } as RoadDef, 0);
      if (p.depot !== undefined) v = Math.min(v, DEPOT_MPH * 0.447);
      else if (p.junction !== undefined) v = Math.min(v, POINTS_MPH * 0.447);
      else if (p.curvy) v = Math.min(v, PLAT_MPH * 0.447); // through a loop's or an island's points
      return v;
    };
    let target = Math.min(lim(fp), trainSpeed(t.def, { mph: fp.mph, rack: fp.rack } as RoadDef, q.grade));
    // the pieces ahead: brake in time for their speed limits, and for the end of the authority
    let x = fp.len - t.u;
    for (let i = 0; i < t.resv && x < 3000; i++) { const p = this.piece(t.route[i]); target = Math.min(target, Math.sqrt(lim(p) ** 2 + 2 * brake * x)); x += p.len; }
    const D = this.authority(t);
    target = Math.min(target, Math.sqrt(2 * brake * Math.max(0, D - 0.5)));
    t.v = target > t.v ? Math.min(target, t.v + accel * dt) : Math.max(target, t.v - brake * 1.6 * dt);
    let ds = t.v * dt;
    if (ds > D - 0.05) { ds = Math.max(0, D - 0.05); t.v = Math.min(t.v, ds / dt); }
    t.u += ds;
    // onto the next pieces (never one that isn't ours)
    while (t.u > this.piece(this.front(t)).len && t.resv > 0) {
      t.u -= this.piece(this.front(t)).len;
      const nx = t.route.shift()!;
      t.resv--;
      if (t.stop) t.stop.k--;
      if (this.owner[this.piece(nx).block] !== t.id) this.stats.redPassed++;
      t.body.push(nx);
    }
    t.u = Math.min(t.u, this.piece(this.front(t)).len);
    // the tail: pieces it has left behind
    let acc = t.u, i = t.body.length - 1;
    while (i > 0 && acc < t.length) { i--; acc += this.piece(t.body[i]).len; }
    if (i > 0) t.body = t.body.slice(i);
    this.dropHeld(t);
    t.waited = t.v < 0.05 ? t.waited + dt : 0;
    // arrived at the platform
    if (t.stop && t.stop.k === -1 && t.stop.u - t.u < 0.6 && t.v < 0.3) {
      const st = t.stop.station, fp2 = this.piece(this.front(t));
      t.v = 0; t.state = 'dwell'; t.dwell = 0; t.station = st; t.calls++; t.stop = null; t.route = []; t.resv = 0;
      t.doorSide = ((fp2.plat?.side ?? 1) * this.front(t).dir) as 1 | -1;
      t.dwellFor = Math.max(8, DWELL + (this.onCall?.(t, st, t.doorSide) ?? 0));
      this.stats.calls++;
      const k = t.line ? t.leg % callOrder(t.line.stops, t.line.loop).length : 0;
      if (t.line && t.lastCall && (t.lastCall.k + 1) % callOrder(t.line.stops, t.line.loop).length === k) this.noteLeg(this.legT, t.line, t.lastCall.k, this.time - t.lastCall.t);
      t.lastCall = { k, t: this.time };
      this.log.push({ train: t.id, line: t.line?.id ?? 0, station: st, call: k, t: this.time });
      if (this.log.length > 2000) this.log.splice(0, 1000);
      this.dropHeld(t);
      return;
    }
    // held at a signal a long while: look for another way (another platform)
    if (t.waited > 20 && this.time >= t.replanAt) { t.replanAt = this.time + 10; if (t.resv === 0) this.plan(t); }
  }

  // ---------- even gaps (anti-bunching) ----------
  // A line's cycle in time: how long each leg (one call to the next, its dwell included) takes.
  // Measured as the line's trains run it; until a leg has been run, estimated from its planned
  // route at two thirds of line speed plus a dwell; a leg with neither takes the mean of the rest.
  private noteLeg(m: Map<number, (number | undefined)[]>, l: RailLine, k: number, secs: number) {
    const n = callOrder(l.stops, l.loop).length;
    let a = m.get(l.id);
    if (!a || a.length !== n) { a = new Array<number | undefined>(n).fill(undefined); m.set(l.id, a); }
    a[k] = m === this.legT && a[k] !== undefined ? a[k]! * 0.5 + secs * 0.5 : secs;
  }
  private estimateLeg(t: Train) {
    if (!t.line || !t.stop) return;
    const n = callOrder(t.line.stops, t.line.loop).length, k = (t.leg - 1 + n) % n;
    if (this.legEst.get(t.line.id)?.[k] !== undefined) return;
    let d = this.piece(this.front(t)).len - t.u, mph = 0;
    for (const s of t.route) { const p = this.piece(s); d += p.len; mph = Math.max(mph, p.mph); }
    d += t.stop.k >= 0 ? t.stop.u - this.piece(t.route[t.route.length - 1]).len : 0;
    const v = trainSpeed(t.def, { mph: mph || 60, rack: false } as RoadDef, 0) * 0.67;
    this.noteLeg(this.legEst, t.line, k, Math.max(1, d) / Math.max(1, v) + DWELL);
  }
  private legTimes(l: RailLine): number[] | null {
    const n = callOrder(l.stops, l.loop).length, m = this.legT.get(l.id), e = this.legEst.get(l.id);
    const legs: (number | undefined)[] = [];
    for (let k = 0; k < n; k++) legs.push(m?.[k] ?? e?.[k]);
    const known = legs.filter((x): x is number => x !== undefined);
    if (!known.length) return null;
    const mean = known.reduce((a, b) => a + b, 0) / known.length;
    return legs.map((x) => x ?? mean);
  }
  // Where each of a line's trains is round its cycle (0 to 1, from the first call, in time), and
  // the gaps to the trains ahead of and behind each, as fractions of the cycle. A train at a
  // platform is at its call; one running is past its last call by the time since. For the line's
  // sheet and the spacing rule; empty until a leg of the line has been planned or run.
  spacing(l: RailLine): { cycle: number; trains: { id: number; at: number; ahead: number; behind: number; holding: boolean }[] } {
    const on = this.trains.filter((t) => t.line === l), legs = this.legTimes(l);
    if (!on.length || !legs) return { cycle: 0, trains: [] };
    const n = legs.length, start = [0];
    for (const x of legs) start.push(start[start.length - 1] + x);
    const cycle = start[n] || 1;
    const pos = on.map((t) => {
      const lc = t.lastCall;
      let p = start[t.leg % n];
      if (t.state !== 'dwell' && lc) p = start[lc.k] + Math.min(this.time - lc.t, legs[lc.k] * 0.999);
      return { id: t.id, at: (p % cycle) / cycle, ahead: 1, behind: 1, holding: t.holdSince !== undefined };
    });
    for (const b of pos) {
      let fwd = 1, back = 1;
      for (const o of pos) {
        if (o === b) continue;
        let g = (o.at - b.at + 1) % 1, h = (b.at - o.at + 1) % 1;
        // (two trains at the very same place, as when both start at one station: the lower id counts as the one ahead)
        if (g < 1e-9 || h < 1e-9) { if (o.id < b.id) { g = 0; h = 1; } else { g = 1; h = 0; } }
        if (g < fwd) fwd = g;
        if (h < back) back = h;
      }
      if (on.length > 1) { b.ahead = fwd; b.behind = back; }
    }
    return { cycle, trains: pos };
  }
  // Should this train, its dwell done, hold on at the platform? Only on a line with spacing on,
  // once per call, only while the train ahead is closer than the line's even spacing (half the
  // cycle with two trains, a third with three) and closer than the train behind (holding for a
  // leader while a follower closes in only moves the bunch), and for at most HOLD_MAX seconds in all. A hold is bounded, so it can never lock a line up: the train behind waits at
  // its signal a minute at the worst.
  private holdOn(t: Train) {
    const l = t.line;
    if (!l || l.spacing === false || t.heldLeg === t.leg) return false;
    if (t.holdSince !== undefined && this.time - t.holdSince >= HOLD_MAX) return false;
    const sp = this.spacing(l), me = sp.trains.find((x) => x.id === t.id);
    if (!me || sp.trains.length < 2) return false;
    const want = 1 / sp.trains.length;
    return me.ahead < want - 1e-6 && me.ahead < me.behind;
  }

  // ---------- the track changed ----------
  // Put every train back on the rebuilt track where it stood. A train whose track (the pieces its
  // body, its way ahead and its held blocks are on, and how those pieces are blocked) is the same
  // as before keeps its speed, its route and its reservations, only re-numbered: a road drawn across
  // town, or a station built on another line, doesn't stop it dead. Anywhere else it's put back
  // on the nearest track, stopped, and plans afresh; one that no longer fits goes back to its depot.
  rebuild(graph: TrackGraph, crossings: CrossingSite[]) {
    const old = this.graph;
    const olds = this.trains.map((t) => ({
      t, at: this.pose(t), tail: this.pose(t, Math.min(t.length, 20)),
      owned: new Set([...t.held].filter((b) => this.owner[b] === t.id)),
    }));
    // the same piece of track in both graphs, blocked the same way: keyed by what it's made of
    const key = (p: Piece) => { const q = p.pts[p.pts.length - 1]; return `${p.seg}|${p.off.toFixed(2)}|${p.pts[0].x.toFixed(1)},${p.pts[0].z.toFixed(1)}|${q.x.toFixed(1)},${q.z.toFixed(1)}|${p.len.toFixed(1)}|${p.oneWay}|${p.mph}|${p.electric ? 1 : 0}${p.rack ? 'r' : ''}|${p.plat ? `${p.plat.station}:${p.plat.side}` : ''}|${p.station ?? ''}|${p.depot ?? ''}|${p.junction ?? ''}`; };
    const newByKey = new Map(graph.pieces.map((p) => [key(p), p.id]));
    const blockKey = (g: TrackGraph, b: number) => `${g.blocks[b].kind}|${g.blocks[b].safe ? 1 : 0}|${g.blocks[b].pieces.map((i) => key(g.pieces[i])).sort().join(';')}`;
    const same = new Map<number, number>(); // old piece → new piece
    for (const p of old.pieces) {
      const n = newByKey.get(key(p));
      if (n !== undefined && blockKey(old, p.block) === blockKey(graph, graph.pieces[n].block)) same.set(p.id, n);
    }
    this.graph = graph;
    this.owner = new Int32Array(graph.blocks.length);
    this.claim = new Int32Array(graph.blocks.length);
    this.attach(crossings);
    this.trains = [];
    for (const { t, at: p, tail, owned } of olds) {
      // its track as it was: carry on
      const steps = [...t.body, ...t.route, ...t.later];
      if (steps.length && steps.every((s) => same.has(s.piece))) {
        const map = (s: Step): Step => ({ piece: same.get(s.piece)!, dir: s.dir });
        const body = t.body.map(map), route = t.route.map(map), later = t.later.map(map);
        const blk = (s: Step) => graph.pieces[s.piece].block;
        // which of its blocks were held outright, which only claimed (over a level crossing not yet down)
        const want = new Map<number, boolean>();
        for (const s of [...body, ...route.slice(0, t.resv), ...later]) want.set(blk(s), true);
        for (const s of [...t.route.slice(0, t.resv), ...t.later]) if (!owned.has(old.pieces[s.piece].block) && !t.body.some((b) => old.pieces[b.piece].block === old.pieces[s.piece].block)) want.set(blk(map(s)), false);
        if ([...want.keys()].every((b) => !this.owner[b] && !this.claim[b])) {
          t.body = body; t.route = route; t.later = later; t.held = new Set(want.keys());
          for (const [b, outright] of want) { if (outright) this.owner[b] = t.id; else this.claim[b] = t.id; }
          this.trains.push(t);
          continue;
        }
      }
      const hit = graph.nearest(p.x, p.z, p.x - tail.x, p.z - tail.z, 6);
      t.held = new Set(); t.route = []; t.resv = 0; t.later = []; t.stop = null;
      const body = hit && graph.usable(graph.pieces[hit.step.piece], t.def) ? this.backFrom(hit.step, hit.u, t.length) : null;
      const blocks = body ? new Set(body.map((s) => graph.pieces[s.piece].block)) : null;
      if (!body || !blocks || [...blocks].some((b) => this.taken(b))) {
        // (nowhere to put it: it waits in its depot, or at its first station, until there's room or the track is back)
        if (t.line && this.lines.includes(t.line)) { t.state = 'held'; this.pending.push({ train: t, station: t.line.depot ?? t.line.stops[0] }); }
        continue;
      }
      t.body = body; t.u = hit!.u;
      for (const b of blocks) { this.owner[b] = t.id; t.held.add(b); }
      this.trains.push(t);
      if (t.state !== 'dwell') { t.state = 'held'; if (t.v > 0.05) t.v = 0; this.plan(t); }
    }
    // (lines are kept whatever happened to their stations: a train waits until its next station is back)
  }

  // blocks each train's body is in now (for tests: no two trains ever share one)
  occupied(t: Train) { return new Set(t.body.map((s) => this.piece(s).block)); }
}

function distToSeg(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
  return Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z);
}
// a small binary heap on g
function heapPush<T extends { g: number }>(h: T[], n: T) {
  h.push(n);
  let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (h[p].g <= h[i].g) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
}
function heapPop<T extends { g: number }>(h: T[]): T {
  const top = h[0], last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l].g < h[m].g) m = l;
      if (r < h.length && h[r].g < h[m].g) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}
