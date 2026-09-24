// The railway as trains see it: every track as its own piece of line, joined at track nodes, and
// grouped into signalling blocks (docs/rail.md).
//
// The road network (roads.ts) holds a railway as a centre line with one or two tracks. Here each
// track becomes a piece: a single line is one piece trains use both ways; a double line is two,
// one each way, and we run on the left like the roads (the track on the left of a→b carries
// a→b). Stations reshape the track they stand on: a single line opens into a passing loop, a
// double line's tracks spread round an island platform. Depot sidings leave the line beside a
// station. Everything is rebuilt from the network whenever it changes; nothing here is saved.
//
// Blocks: a train may only enter a block that is reserved for it (signals.ts). The line is cut
// into blocks at stations, at points (every piece within JUNCTION metres of a junction is one
// block, so crossing moves never meet) and at intervals of at most BLOCK metres. A block is
// "safe" if a train can stand in it without cutting anyone else off: one-way track, a passing
// loop's platform, a dead end. On a single line a train's reservation always runs on to a safe
// block, so two trains never meet head on between loops.
import { pathLength, pointAt, type Network, type RSeg } from '../roads';
import { ROADS } from '../catalog';

export interface P3 { x: number; y: number; z: number }
export type Dir = 1 | -1; // along a piece's points, or against them
// Platforms either side of the tracks, islands between pairs of them, or a platform on both sides of
// every track (people get off one side and on the other).
export type Layout = 'side' | 'island' | 'both';
// Where a station stands on a railway, as the track graph needs it: the platform's span along
// its seg (from seg.a), the platform layout, and whether a single line gets a passing loop.
export interface StationWorks {
  id: number; seg: number; s0: number; s1: number; layout: Layout; loop: boolean;
  tracks?: number; // tracks through the station (default: the line's own, or two on a single line with a loop)
  side: 1 | -1; // a single platform without a loop: on the left (+1, of a→b) or the right
  depot?: { end: 1 | -1; side: 1 | -1; len: number }; // a siding off the line past the platform's s1 end (1) or s0 end (-1)
}
export interface Plat { station: number; u0: number; u1: number; side: 1 | -1; edge: number } // the platform along [u0, u1] of the piece, on its left (+1) or right; its edge `edge` m from the rails' centre
export interface Piece {
  id: number; pts: P3[]; cum: number[]; len: number;
  a: number; b: number; // track nodes at its first and last point
  oneWay: 0 | Dir; // 0: both ways; otherwise the only way trains run on it
  seg: number; off: number; // the network seg it's on, and how far left of its centre line (at its ends)
  block: number;
  mph: number; grade: number; electric: boolean; rack: boolean;
  plat?: Plat; station?: number; depot?: number; // a station's platform track (or its throat), a depot siding (the station's id)
  junction?: number; // within JUNCTION of the points at this track node
  curvy?: boolean; // a station's track moving over to its platform and back (taken slowly)
  laid?: boolean; // the station lays this track itself (roaddraw leaves the stretch out: rail/draw.ts draws it)
  clearA: number; clearB: number; // the clearance point: how far from each end a train must stand to be clear of every track meeting it there
}
export interface TNode { id: number; x: number; z: number; pieces: number[] }
export type BlockKind = 'plain' | 'junction' | 'platform' | 'siding';
export interface Block { id: number; pieces: number[]; kind: BlockKind; safe: boolean; len: number; station?: number; crossings: number[] }
export interface Step { piece: number; dir: Dir }

export const JUNCTION = 40; // how far from points their block reaches
export const CLEAR_GAP = 3.8; // track centres at a clearance point (a train standing there is clear of the other line)
export const BLOCK = 400; // the longest block on plain line
export const EDGE = 1.45; // rails' centre to the platform edge (UK: 730 mm past the rail, plus half the gauge)
export const ISLAND = 6; // an island platform's width
export const SIDE_W = 4; // a side platform's width
export const TRACKS = 4; // track centres on a double line (the network draws its tracks at ±2)
export const DEPOT_OFF = 6.5; // a depot siding's centre line from the outermost running track
const RAMP_DEPOT = 45;
const THROAT = 20; // the points between a station and its depot siding: one block, so moves in and out never cross
const STEP = 8; // sampling along curves and ramps

const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
// Where a station's tracks lie: each track's centre across its platforms, from its centre outside
// the station, the way it runs, and the side of it a platform is on (none for a line straight
// through without one); and where the platforms are, as offsets from the centre line (a > b), with
// which of their long sides face a track.
export interface TrackAt { from: number; to: number; oneWay: 0 | Dir; plat?: 1 | -1 }
export interface PlatAt { a: number; b: number; trackA: boolean; trackB: boolean }
export const stationTrackCount = (w: Pick<StationWorks, 'loop' | 'tracks'>, lineTracks: number) => Math.max(lineTracks === 2 ? 2 : 1, Math.min(4, w.tracks ?? (lineTracks === 2 ? 2 : w.loop ? 2 : 1)));
export function stationTracks(w: Pick<StationWorks, 'layout' | 'loop' | 'side' | 'tracks'>, lineTracks: number): { ramp: number; tracks: TrackAt[]; plats: PlatAt[] } {
  const n = stationTrackCount(w, lineTracks);
  // the cross-section from left (+) to right: T a track, P a platform
  let seq: ('T' | 'P')[];
  if (n === 1) seq = w.layout === 'both' ? ['P', 'T', 'P'] : w.side === 1 ? ['P', 'T'] : ['T', 'P'];
  else if (w.layout === 'side') seq = ['P', ...Array<'T'>(n).fill('T'), 'P'];
  else if (w.layout === 'both') { seq = ['P']; for (let i = 0; i < n; i++) seq.push('T', 'P'); }
  else seq = n === 2 ? ['T', 'P', 'T'] : n === 3 ? ['T', 'P', 'T', 'P', 'T'] : ['T', 'P', 'T', 'T', 'P', 'T'];
  // measured rightwards: TRACKS between neighbouring tracks, EDGE from a track to a platform's edge
  const at: number[] = [], widths: number[] = [];
  let x = 0;
  seq.forEach((e, i) => {
    const prev = seq[i - 1];
    if (e === 'T') { if (prev === 'T') x += TRACKS; else if (prev === 'P') x += EDGE; at.push(x); widths.push(0); }
    else { if (prev === 'T') x += EDGE; const w2 = prev === 'T' && seq[i + 1] === 'T' ? ISLAND : SIDE_W; at.push(x); widths.push(w2); x += w2; }
  });
  const ts = seq.map((e, i) => (e === 'T' ? at[i] : NaN)).filter((v) => !Number.isNaN(v));
  const mid = (Math.min(...ts) + Math.max(...ts)) / 2, off = (r: number) => mid - r;
  const tracks: TrackAt[] = [], plats: PlatAt[] = [];
  seq.forEach((e, i) => {
    if (e === 'P') { plats.push({ a: off(at[i]), b: off(at[i] + widths[i]), trackA: seq[i - 1] === 'T', trackB: seq[i + 1] === 'T' }); return; }
    const to = off(at[i]), plat: 1 | -1 | undefined = seq[i - 1] === 'P' ? 1 : seq[i + 1] === 'P' ? -1 : undefined;
    // (on a double line, tracks left of the middle run a→b and right of it b→a; one in the middle takes either)
    if (lineTracks === 2) tracks.push({ from: to > 0.01 ? 2 : to < -0.01 ? -2 : 2, to, oneWay: to > 0.01 ? 1 : to < -0.01 ? -1 : 0, plat });
    else tracks.push({ from: 0, to, oneWay: 0, plat });
  });
  const moved = Math.max(...tracks.map((t) => Math.abs(t.to - t.from)));
  return { ramp: moved < 0.01 ? 0 : Math.max(45, moved * 13.5), tracks, plats };
}
const depotRun = (len: number) => THROAT + RAMP_DEPOT + len + 5;
// the space a station's track needs along its seg, ramps included
export function worksSpan(w: StationWorks, tracks: number): [number, number] {
  const r = stationTracks(w, tracks).ramp;
  let a = w.s0 - r, b = w.s1 + r;
  if (w.depot) { const d = depotRun(w.depot.len); if (w.depot.end === 1) b += d; else a -= d; }
  return [a, b];
}

// Along a piece: the point u metres from its start, and the direction of its points there.
export function at(p: Piece, u: number) {
  const pts = p.pts, cum = p.cum;
  const s = Math.max(0, Math.min(p.len, u));
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const A = pts[lo], B = pts[hi], L = cum[hi] - cum[lo] || 1, t = (s - cum[lo]) / L;
  return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z: A.z + (B.z - A.z) * t, ux: (B.x - A.x) / L, uz: (B.z - A.z) / L, grade: (B.y - A.y) / L };
}
// the same, for a train going `dir` with u measured the way it goes
export function atDir(p: Piece, dir: Dir, u: number) {
  const q = at(p, dir === 1 ? u : p.len - u);
  if (dir === -1) { q.ux = -q.ux; q.uz = -q.uz; q.grade = -q.grade; }
  return q;
}
// the heading a train has leaving the node at a piece's end (going `dir`)
function endDir(p: Piece, dir: Dir, leaving: boolean) {
  const n = p.pts.length, [A, B] = (dir === 1) === leaving ? [p.pts[0], p.pts[1]] : [p.pts[n - 2], p.pts[n - 1]];
  const L = Math.hypot(B.x - A.x, B.z - A.z) || 1, k = dir === 1 ? 1 : -1;
  return { x: ((B.x - A.x) / L) * k, z: ((B.z - A.z) / L) * k };
}

export class TrackGraph {
  pieces: Piece[] = [];
  nodes = new Map<number, TNode>();
  blocks: Block[] = [];
  // for each station: its platform pieces, and its depot siding if it has one
  platforms = new Map<number, number[]>();
  depots = new Map<number, number>();
  bySeg = new Map<number, number[]>();
  // stations that couldn't be laid out on the track as it now is (a junction built through them)
  broken = new Set<number>();
  private nextNode = 0;
  private nexts = new Map<number, Step[]>(); // cached exits, by piece * 2 + (dir === 1)

  constructor(readonly net: Network, works: StationWorks[] = []) {
    const rail = [...net.segs.values()].filter((s) => net.def(s).cls === 'rail');
    this.nextNode = Math.max(0, ...net.nodes.keys()) + 1;
    const degree = new Map<number, number>();
    for (const s of rail) for (const n of [s.a, s.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
    const bySeg = new Map<number, StationWorks[]>();
    for (const w of works) { const l = bySeg.get(w.seg) ?? []; l.push(w); bySeg.set(w.seg, l); }
    for (const s of rail) this.layOut(s, bySeg.get(s.id) ?? [], degree);
    for (const w of works) if (!rail.some((s) => s.id === w.seg)) this.broken.add(w.id);
    this.makeBlocks();
    this.clearances();
  }
  // Where each piece's clearance points are: along from each end, the first place it's CLEAR_GAP
  // from every other track at that node (where points diverge slowly, well back from the node).
  private clearances() {
    const near = (p: Piece, x: number, z: number) => {
      let d = Infinity;
      for (let i = 1; i < p.pts.length; i++) {
        const A = p.pts[i - 1], B = p.pts[i];
        if (Math.min(A.x, B.x) > x + 60 || Math.max(A.x, B.x) < x - 60 || Math.min(A.z, B.z) > z + 60 || Math.max(A.z, B.z) < z - 60) continue;
        const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2));
        d = Math.min(d, Math.hypot(A.x + dx * t - x, A.z + dz * t - z));
      }
      return d;
    };
    for (const p of this.pieces) for (const end of ['a', 'b'] as const) {
      const others = this.nodes.get(p[end])!.pieces.filter((i) => i !== p.id).map((i) => this.pieces[i]);
      let c = 0;
      if (others.length) for (let u = 0; u <= p.len * 0.6; u += 2) {
        const q = at(p, end === 'a' ? u : p.len - u);
        c = u;
        if (others.every((o) => near(o, q.x, q.z) >= CLEAR_GAP)) break;
      }
      if (end === 'a') p.clearA = c; else p.clearB = c;
    }
  }

  // ---------- building ----------
  private node(x: number, z: number, id = this.nextNode++) {
    let n = this.nodes.get(id);
    if (!n) this.nodes.set(id, (n = { id, x, z, pieces: [] }));
    return n.id;
  }
  private layOut(seg: RSeg, works: StationWorks[], degree: Map<number, number>) {
    const net = this.net, def = net.def(seg), path = net.path(seg), L = pathLength(path), tracks = def.tracks === 2 ? 2 : 1;
    const jA = (degree.get(seg.a) ?? 0) >= 3, jB = (degree.get(seg.b) ?? 0) >= 3;
    // the stretches the station works take, in order; any that overlap another, or the points, can't be built
    const spans: { a: number; b: number; w?: StationWorks }[] = [];
    for (const w of [...works].sort((p, q) => p.s0 - q.s0)) {
      const [a, b] = worksSpan(w, tracks);
      const prev = spans[spans.length - 1];
      if (a < (jA ? JUNCTION : 0) - 1e-6 || b > L - (jB ? JUNCTION : 0) + 1e-6 || (prev && a < prev.b)) { this.broken.add(w.id); continue; }
      spans.push({ a, b, w });
    }
    // plain line between them, cut at the points and at intervals
    const cuts: { a: number; b: number; w?: StationWorks; j?: number }[] = [];
    const plain = (a: number, b: number) => {
      if (b - a < 1e-6) return;
      let x = a;
      if (jA && a < JUNCTION - 1e-6) { const e = Math.min(b, JUNCTION); cuts.push({ a: x, b: e, j: seg.a }); x = e; }
      const endJ = jB && b > L - JUNCTION + 1e-6 ? Math.max(x, L - JUNCTION) : b;
      const n = Math.max(1, Math.ceil((endJ - x) / BLOCK - 1e-9));
      if (endJ - x > 1e-6) for (let i = 0; i < n; i++) cuts.push({ a: x + ((endJ - x) * i) / n, b: x + ((endJ - x) * (i + 1)) / n });
      if (endJ < b - 1e-6) cuts.push({ a: endJ, b, j: seg.b });
    };
    let x = 0;
    for (const sp of spans) { plain(x, sp.a); cuts.push(sp); x = sp.b; }
    plain(x, L);
    // (a very short seg between two sets of points is all one junction)
    for (const c of cuts) if (c.j === undefined && ((jA && c.a < JUNCTION) || (jB && c.b > L - JUNCTION))) c.j = jA && c.a < JUNCTION ? seg.a : seg.b;
    // track nodes at the cuts: the seg's own nodes at its ends, new ones between
    const ends = [path[0], path[path.length - 1]];
    const nodeAt = new Map<number, number>();
    const cutNode = (s: number) => {
      if (s < 1e-6) return this.node(ends[0].x, ends[0].z, seg.a);
      if (s > L - 1e-6) return this.node(ends[1].x, ends[1].z, seg.b);
      const k = Math.round(s * 1000);
      let id = nodeAt.get(k);
      if (id === undefined) { const q = pointAt(path, s); nodeAt.set(k, (id = this.node(q.x, q.z))); }
      return id;
    };
    const base = { seg: seg.id, mph: def.mph, electric: def.electric, rack: def.rack };
    const std: TrackAt[] = tracks === 2 ? [{ from: 2, to: 2, oneWay: 1, plat: 1 }, { from: -2, to: -2, oneWay: -1, plat: -1 }] : [{ from: 0, to: 0, oneWay: 0, plat: 1 }];
    const ids: number[] = [];
    for (const c of cuts) {
      const na = cutNode(c.a), nb = cutNode(c.b);
      if (!c.w) {
        for (const t of std) ids.push(this.addPiece(path, c.a, c.b, () => t.from, na, nb, { ...base, oneWay: t.oneWay, off: t.from, junction: c.j }));
        continue;
      }
      // a station: its tracks move over to their platforms and back
      const w = c.w, st = stationTracks(w, tracks), r = st.ramp;
      let pa = c.a, pb = c.b;
      if (w.depot) { const d = depotRun(w.depot.len); if (w.depot.end === 1) pb -= d; else pa += d; }
      const nA = pa === c.a ? na : cutNode(pa), nB = pb === c.b ? nb : cutNode(pb);
      const plats: number[] = [];
      for (const t of st.tracks) {
        const off = (s: number) => t.from + (t.to - t.from) * (s < w.s0 ? smooth((s - (w.s0 - r)) / (r || 1)) : s > w.s1 ? smooth(((w.s1 + r) - s) / (r || 1)) : 1);
        const id = this.addPiece(path, pa, pb, off, nA, nB, { ...base, oneWay: t.oneWay, off: t.from, station: w.id, curvy: Math.abs(t.to - t.from) > 0.01, laid: r > 0, plat: t.plat ? { station: w.id, u0: w.s0 - pa, u1: w.s1 - pa, side: t.plat, edge: EDGE } : undefined });
        if (t.plat) plats.push(id);
        ids.push(id);
      }
      if (w.depot) {
        // past the platforms: the points (one block), then the line on beside the siding
        const e = w.depot.end, sIn = e === 1 ? pb : pa, sPts = sIn + e * THROAT, sOut = e === 1 ? c.b : c.a;
        const nIn = e === 1 ? nB : nA, nPts = cutNode(sPts), nOut = e === 1 ? nb : na;
        const piece = (s0: number, s1: number, n0: number, n1: number, o: Partial<Piece>) => (e === 1 ? this.addPiece(path, s0, s1, o.off !== undefined ? () => o.off! : () => 0, n0, n1, { ...base, oneWay: 0, off: 0, ...o }) : this.addPiece(path, s1, s0, o.off !== undefined ? () => o.off! : () => 0, n1, n0, { ...base, oneWay: 0, off: 0, ...o }));
        for (const t of std) {
          ids.push(piece(sIn, sPts, nIn, nPts, { oneWay: t.oneWay, off: t.from, station: w.id, junction: -1 - w.id }));
          ids.push(piece(sPts, sOut, nPts, nOut, { oneWay: t.oneWay, off: t.from, station: w.id }));
        }
        // the siding: off the running track on its side, out alongside, to the buffers
        const dp = w.depot, run = std.reduce((m, t) => (Math.sign(t.from || dp.side) === dp.side ? t : m), std[0]);
        const outer = Math.max(...st.tracks.map((t) => Math.abs(t.to)), ...std.map((t) => Math.abs(t.from)));
        const target = dp.side * (outer + DEPOT_OFF), sEnd = sPts + e * (RAMP_DEPOT + dp.len);
        const off = (s: number) => run.from + (target - run.from) * smooth(Math.abs(s - sPts) / RAMP_DEPOT);
        const buffers = this.node(0, 0);
        const id = e === 1
          ? this.addPiece(path, sPts, sEnd, off, nPts, buffers, { ...base, oneWay: 0, off: run.from, depot: w.id, station: w.id })
          : this.addPiece(path, sEnd, sPts, off, buffers, nPts, { ...base, oneWay: 0, off: run.from, depot: w.id, station: w.id });
        const bp = this.pieces[id], bq = e === 1 ? bp.pts[bp.pts.length - 1] : bp.pts[0], bn = this.nodes.get(buffers)!;
        bn.x = bq.x; bn.z = bq.z;
        this.depots.set(w.id, id); ids.push(id);
      }
      this.platforms.set(w.id, plats);
    }
    this.bySeg.set(seg.id, ids);
  }
  private addPiece(path: { x: number; z: number; y?: number }[], s0: number, s1: number, off: (s: number) => number, a: number, b: number, o: Omit<Piece, 'id' | 'pts' | 'cum' | 'len' | 'a' | 'b' | 'block' | 'grade' | 'clearA' | 'clearB'>) {
    const n = Math.max(1, Math.ceil((s1 - s0) / STEP)), pts: P3[] = [];
    // (straight track needs no more points than its ends)
    const bendy = path.length > 2 || Math.abs(off(s0) - off((s0 + s1) / 2)) > 1e-6 || Math.abs(off(s1) - off((s0 + s1) / 2)) > 1e-6;
    const steps = bendy ? n : 1;
    for (let i = 0; i <= steps; i++) {
      const s = s0 + ((s1 - s0) * i) / steps, q = pointAt(path, s), d = off(s);
      pts.push({ x: q.x + q.uz * d, y: q.y, z: q.z - q.ux * d });
    }
    // points every few metres on a straight, so heights carried along it (ramps to a bridge) keep their shape
    const full: P3[] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i && !bendy) {
        const A = pts[i - 1], B = pts[i], k = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.z - A.z) / STEP));
        for (let j = 1; j < k; j++) { const s = s0 + ((s1 - s0) * j) / k, q = pointAt(path, s); full.push({ x: A.x + ((B.x - A.x) * j) / k, y: q.y, z: A.z + ((B.z - A.z) * j) / k }); }
      }
      full.push(pts[i]);
    }
    const cum = [0];
    let grade = 0;
    for (let i = 1; i < full.length; i++) {
      const h = Math.hypot(full[i].x - full[i - 1].x, full[i].z - full[i - 1].z);
      cum.push(cum[i - 1] + h);
      grade = Math.max(grade, Math.abs(full[i].y - full[i - 1].y) / (h || 1));
    }
    const p: Piece = { ...o, id: this.pieces.length, pts: full, cum, len: cum[cum.length - 1], a, b, block: -1, grade, clearA: 0, clearB: 0 };
    this.pieces.push(p);
    this.nodes.get(a)!.pieces.push(p.id);
    this.nodes.get(b)!.pieces.push(p.id);
    return p.id;
  }

  private makeBlocks() {
    // pieces round the same points share a block; so do a station's throat and its platform-less ends
    const parent = this.pieces.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const byJ = new Map<number, number>();
    for (const p of this.pieces) if (p.junction !== undefined) {
      const o = byJ.get(p.junction);
      if (o === undefined) byJ.set(p.junction, p.id); else parent[find(p.id)] = find(o);
    }
    const groups = new Map<number, number[]>();
    for (const p of this.pieces) { const r = find(p.id); const g = groups.get(r) ?? []; g.push(p.id); groups.set(r, g); }
    for (const g of groups.values()) {
      const ps = g.map((i) => this.pieces[i]), first = ps[0];
      const kind: BlockKind = ps.some((p) => p.depot !== undefined) ? 'siding' : ps.some((p) => p.junction !== undefined) ? 'junction' : ps.some((p) => p.plat) ? 'platform' : 'plain';
      const id = this.blocks.length;
      const deadEnd = ps.some((p) => this.toBuffers(p.id, p.a) || this.toBuffers(p.id, p.b));
      let safe = false;
      if (kind === 'siding' || deadEnd) safe = true;
      else if (kind === 'plain') safe = ps.every((p) => p.oneWay !== 0);
      else if (kind === 'platform') safe = first.oneWay !== 0 || (this.platforms.get(first.station!)?.length ?? 0) >= 2;
      this.blocks.push({ id, pieces: g, kind, safe: kind !== 'junction' && safe, len: ps.reduce((s, p) => Math.max(s, p.len), 0), station: first.station, crossings: [] });
      for (const p of ps) p.block = id;
    }
  }

  // does the line from this end of a piece run on, without points, only to buffers a few metres
  // on? (a terminus: a train standing there is in nobody's way)
  private toBuffers(piece: number, node: number) {
    for (let k = 0, run = 0; k < 50 && run < 60; k++) {
      const n = this.nodes.get(node)!;
      if (n.pieces.length === 1) return true;
      if (n.pieces.length !== 2) return false;
      const q = this.pieces[n.pieces[0] === piece ? n.pieces[1] : n.pieces[0]];
      if (q.oneWay !== 0) return false;
      piece = q.id; node = q.a === node ? q.b : q.a; run += q.len;
    }
    return false;
  }

  // ---------- getting about ----------
  // Where a train can go on from the end of a piece: every piece at the node there that it can
  // run onto without turning back on itself (so through points both ways, never a reversal).
  exits(piece: number, dir: Dir): Step[] {
    const key = piece * 2 + (dir === 1 ? 1 : 0);
    let out = this.nexts.get(key);
    if (out) return out;
    out = [];
    const p = this.pieces[piece], node = this.nodes.get(dir === 1 ? p.b : p.a)!, h = endDir(p, dir, false);
    for (const qi of node.pieces) {
      if (qi === piece) continue;
      const q = this.pieces[qi];
      for (const d of [1, -1] as Dir[]) {
        if ((d === 1 ? q.a : q.b) !== node.id || (q.oneWay !== 0 && q.oneWay !== d)) continue;
        const g = endDir(q, d, true);
        if (h.x * g.x + h.z * g.z > 0.5) out.push({ piece: qi, dir: d });
      }
    }
    this.nexts.set(key, out);
    return out;
  }
  // the way back: pieces a train could have come from onto this one
  entries(piece: number, dir: Dir): Step[] {
    return this.exits(piece, dir === 1 ? -1 : 1).map((s) => ({ piece: s.piece, dir: (s.dir === 1 ? -1 : 1) as Dir }));
  }
  // Turning round: a train standing on this piece may set off the other way on it (single line),
  // or on the track alongside (a double line's other track, by the crossover at a terminus).
  reversals(piece: number, dir: Dir): Step[] {
    const p = this.pieces[piece], back: Dir = dir === 1 ? -1 : 1;
    if (p.oneWay === 0) return [{ piece, dir: back }];
    // the other track of a double line, alongside at the same place
    const mates = (this.bySeg.get(p.seg) ?? []).map((i) => this.pieces[i]).filter((q) => q.id !== p.id && q.oneWay === back && q.depot === undefined
      && Math.abs(q.pts[0].x - p.pts[0].x) + Math.abs(q.pts[0].z - p.pts[0].z) < 12 && Math.abs(q.len - p.len) < 1);
    return mates.map((q) => ({ piece: q.id, dir: back }));
  }
  // Can a train of this kind run on this piece? (wires, a rack, how steep it is)
  usable(p: Piece, t: { needsWires: boolean; rack: boolean; maxGrade: number }) {
    if (p.rack && !t.rack) return false;
    if (t.needsWires && !p.electric) return false;
    return p.grade <= t.maxGrade + 0.002;
  }
  // The nearest piece to a point that runs roughly along a heading (for putting trains back on the
  // track after it's rebuilt), and where along it.
  nearest(x: number, z: number, hx?: number, hz?: number, max = 12): { step: Step; u: number; d: number } | null {
    let best: { step: Step; u: number; d: number } | null = null;
    for (const p of this.pieces) {
      for (let i = 1; i < p.pts.length; i++) {
        const A = p.pts[i - 1], B = p.pts[i], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / L2)), d = Math.hypot(A.x + dx * t - x, A.z + dz * t - z);
        if (d > max || (best && d >= best.d)) continue;
        let dir: Dir = 1;
        if (hx !== undefined && hz !== undefined) {
          const dot = (dx * hx + dz * hz) / Math.sqrt(L2);
          dir = dot >= 0 ? 1 : -1;
          if (p.oneWay !== 0 && p.oneWay !== dir) continue;
        } else if (p.oneWay !== 0) dir = p.oneWay;
        const u = p.cum[i - 1] + t * (p.cum[i] - p.cum[i - 1]);
        best = { step: { piece: p.id, dir }, u: dir === 1 ? u : p.len - u, d };
      }
    }
    return best;
  }
  railSegs() { return [...this.net.segs.values()].filter((s) => ROADS[s.type]?.cls === 'rail'); }
}
