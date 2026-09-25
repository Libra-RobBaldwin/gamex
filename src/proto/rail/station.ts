// Railway stations (docs/rail.md): where one can go, the layouts on offer and what each costs,
// and the ground it stands on.
//
// A station needs a level run of track, straight or gently curving, clear of points: at ground
// level, on a viaduct that can be widened for platforms, or deep enough underground for a station
// box (a bored tunnel). Its
// platforms are as long as the longest train that should call there. On a double line the
// platforms are either side of the tracks, or the tracks spread round an island between them; on
// a single line the track opens into a passing loop (so trains can cross there), with an island
// or a platform either side, or it keeps one track and one platform. The station building stands
// on the side you tapped, with a footbridge over the tracks where there's more than one
// platform. Like a bus stop, a station takes its land in the land registry, buying out anything
// built there.
import { CLEAR_COST, closestOnPath, pathLength, pointAt, polysOverlap, rectCorners, subPath, type Lot, type Network, type P, type RSeg } from '../roads';
import { bandPolys, type XZ } from '../land';
import { TrackGraph, stationTracks, worksSpan, type Layout, type P3, type StationWorks } from './track';
import type { CrossingSite } from './crossing';
import { BRIDGES, type BridgeId } from '../bridges/catalogue';

// A station as the player built it. It's kept by where it is and which way its track runs, so it
// finds its track again after the network is rebuilt (a seg split by a new junction elsewhere).
// Sides are relative to (hx, hz): +1 on its left.
export interface Station {
  id: number; name: string; x: number; z: number; hx: number; hz: number;
  len: number; layout: Layout; loop: boolean; side: 1 | -1; building: 1 | -1;
  tracks?: number; style?: StationStyle; access?: Access; canopy?: boolean;
  depot?: { end: 1 | -1; side: 1 | -1; len: number };
  structure?: Structure; // (ground level when missing)
  y?: number; // the rails' height where it was built: it only finds track at that height again (not a line laid over a tunnel)
  cost: number;
}
// Where a station stands: on the ground, up on a viaduct (platforms on the deck, stairs and lifts
// down to a booking hall at street level), or below ground in a station box (stairs, escalators
// and lifts up to an entrance building).
export type Structure = 'surface' | 'viaduct' | 'underground';
// What the station looks like: a brick booking hall, a modern glass one, or an unstaffed halt
// with shelters on its platforms; and how people cross the tracks: a footbridge or a subway.
export type StationStyle = 'victorian' | 'modern' | 'halt';
export type Access = 'footbridge' | 'subway';
export const STYLES: Record<StationStyle, { label: string; cost: number }> = { victorian: { label: 'Brick booking hall', cost: 350_000 }, modern: { label: 'Glass booking hall', cost: 500_000 }, halt: { label: 'Halt (shelters only)', cost: 40_000 } };
export const ACCESS: Record<Access, { label: string; cost: number }> = { footbridge: { label: 'Footbridge', cost: 220_000 }, subway: { label: 'Subway', cost: 380_000 } };
export interface StationConfig { tracks: number; layout: Layout; style: StationStyle; access: Access; canopy: boolean }
export const MAX_GRADE = 0.005; // 1 in 200
// Platforms on a curve: no tighter than 1,000 m (UK practice for new platforms: sharper and the
// gap between the train and the platform edge gets too wide at the doors). On a curve the edge is
// set back by the train's overhang, so the gap is never less than it is on the straight: a car's
// middle hangs in towards the inside of the curve (the centre throw) and its ends out (the end throw).
export const MIN_RADIUS = 1000;
const CAR = 23, BOGIES = 16; // (a 23 m coach on bogies 16 m apart: the longest the game runs)
export const throwIn = (r: number) => (BOGIES * BOGIES) / (8 * r);
export const throwOut = (r: number) => (CAR * CAR - BOGIES * BOGIES) / (8 * r);
// A viaduct station's deck stands high enough for a concourse under it; an underground station's
// rails are deep enough for the box round its platforms (and the passage over its tracks) to stay
// under the ground: in a bored tunnel, not an open cutting.
export const VIADUCT_MIN = 4.5;
export const UNDER_MIN = 10;
// the bridges that can be widened to carry platforms: beams and arches on piers, not a trestle,
// trusses either side of the tracks, a long main span or a bridge that lifts
export const CARRIES: BridgeId[] = ['masonry', 'girder', 'beam', 'box'];
const NO_CARRY: Partial<Record<BridgeId, string>> = {
  trestle: 'a timber trestle is too light to carry platforms',
  'truss-through': 'the trusses stand either side of the tracks, where the platforms would go',
  'truss-deck': 'its long truss spans can’t be widened for platforms',
  bascule: 'it lifts to let boats through',
};
const noCarry = (id: BridgeId) => NO_CARRY[id] ?? 'a long-span bridge can’t be widened for platforms';
export const DEPOT_LEN = 140; // a siding for the longest train that runs from it, with room to spare
// platform lengths: long enough for the longest train of each kind, and a few metres more
export const LENGTHS = [{ len: 60, label: 'Short', fits: 'local trains of 2 cars' }, { len: 130, label: 'Long', fits: 'intercity trains of 5 cars' }, { len: 215, label: 'Very long', fits: 'high-speed trains of 8 cars' }];
export function lengthFor(trainLen: number) { return Math.ceil((trainLen + 8) / 5) * 5; }
const COST = { platform: 2500, points: 120_000, depot: 400_000 };
// what the structure adds: a viaduct's widened deck (per m²) and its stairs and lifts (each
// platform); an underground station's box (per m² of plan), its shafts, escalators and lifts
// (each platform) and the entrance's shaft down to them
export const STRUCTURE_COST = { deck: 650, lifts: 320_000, box: 2400, shafts: 450_000, entrance: 900_000 };

// Where a station is on the network now (null if its track has gone).
export function worksFor(net: Network, st: Station): StationWorks | null {
  let best: { seg: number; s: number; d: number; sign: 1 | -1 } | null = null;
  for (const seg of net.segs.values()) {
    if (net.def(seg).cls !== 'rail') continue;
    const c = closestOnPath(st, net.path(seg));
    const dot = c.ux * st.hx + c.uz * st.hz;
    if (c.d > 6 || Math.abs(dot) < 0.95 || (best && c.d >= best.d) || (st.y !== undefined && Math.abs(c.y - st.y) > 4)) continue;
    best = { seg: seg.id, s: c.s, d: c.d, sign: dot >= 0 ? 1 : -1 };
  }
  if (!best) return null;
  const k = best.sign;
  return {
    id: st.id, seg: best.seg, s0: best.s - st.len / 2, s1: best.s + st.len / 2, layout: st.layout, loop: st.loop, tracks: st.tracks, side: (st.side * k) as 1 | -1,
    depot: st.depot ? { end: (st.depot.end * k) as 1 | -1, side: (st.depot.side * k) as 1 | -1, len: st.depot.len } : undefined,
  };
}

// ---------- what a station looks like on the ground ----------
// a platform: its edge along a track and its other long side (`back`, also an edge when `twoFaced`)
export interface PlatformShape { edge: P3[]; back: P3[]; width: number; y: number; station: number; twoFaced: boolean }
export interface StationShape {
  platforms: PlatformShape[];
  building: { x: number; z: number; y: number; rot: number; w: number; d: number }; // (on a viaduct or underground: at street level)
  footbridge?: { a: XZ; b: XZ; y: number; rot: number }; // (or, with a subway, where its stairs go down; underground, the passage over the tracks)
  access: Access; style: StationStyle; canopy: boolean;
  structure: Structure;
  // the structure round the tracks: a viaduct's deck, or an underground station's box, along the
  // centre line (with its height) between offsets l (left, +) and r (right, −) of it
  bed?: { pts: P3[]; l: number; r: number };
  radius: number; // the tightest curve the platforms stand on (Infinity: straight)
  depot?: { pts: P3[]; shed: { x: number; z: number; y: number; rot: number; w: number; d: number } }; // its siding, and a shed over the far end
  land: XZ[][]; // the ground the station claims as its own (its platforms, building and forecourt, and its depot's siding last)
  deckLand?: XZ[][]; // a viaduct's deck, over the ground: roads may pass under it, buildings can't
  area: XZ[][]; // all of the station, above or below ground (its platforms, building and depot), for a tap in the underground view
  mid: P3; ux: number; uz: number; // the middle of the platforms, and the track's direction there (along its seg)
  outer: [number, number]; // how far the platforms reach right (−) and left (+) of the centre line
}
const PLAT_H = 0.92; // platform surface above the rail head
export const BED_PAST = 1.5; // a viaduct's deck or a station box, past its track's own span at each end
export const RAIL_TOP = 0.44;
// how sharply the path turns at s, towards its left (+, the side offsets are measured to) or right:
// the circle through the points 75 m either side (a curve is a polyline of pieces tens of metres
// long: a narrower window would see its corners, not its bend)
function curveAt(path: P[], L: number, s: number) {
  const h = 75, p = pointAt(path, Math.max(0, s - h)), q = pointAt(path, s), r = pointAt(path, Math.min(L, s + h));
  const cross = (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x), abc = Math.hypot(q.x - p.x, q.z - p.z) * Math.hypot(r.x - q.x, r.z - q.z) * Math.hypot(r.x - p.x, r.z - p.z);
  // (the left of heading (ux, uz) is (uz, −ux): turning that way makes the cross product negative)
  return abc < 1e-9 ? 0 : (-2 * cross) / abc;
}
export function stationShape(net: Network, g: TrackGraph, w: StationWorks, look: Partial<Pick<StationConfig, 'style' | 'access' | 'canopy'>> & { structure?: Structure } = {}): StationShape | null {
  const seg = net.segs.get(w.seg);
  if (!seg || !g.platforms.get(w.id)) return null;
  const structure = look.structure ?? 'surface', raised = structure === 'viaduct', deep = structure === 'underground';
  const path = net.path(seg), tracks = net.def(seg).tracks === 2 ? 2 : 1;
  const st = stationTracks(w, tracks);
  const platforms: PlatformShape[] = [];
  let lo = Infinity, hi = -Infinity, radius = Infinity;
  // each platform along the seg between its two offsets, its edge on a track's side; on a curve,
  // each edge facing a track is set back from it by the train's overhang there
  const L = pathLength(path), n = Math.max(2, Math.ceil((w.s1 - w.s0) / 8));
  for (const pl of st.plats) {
    const edge: P3[] = [], back: P3[] = [];
    let y = 0;
    for (let i = 0; i <= n; i++) {
      const s = Math.max(0, Math.min(L, w.s0 + ((w.s1 - w.s0) * i) / n)), q = pointAt(path, s), k = curveAt(path, L, s), r = 1 / Math.max(1e-9, Math.abs(k));
      radius = Math.min(radius, r);
      // (a track on the platform's left, a: the platform is on the right of that track, on the inside of a right-hand curve)
      const set = (side: 1 | -1) => (Math.abs(k) < 1e-7 ? 0 : side * k > 0 ? throwIn(r) : throwOut(r));
      const a = pl.trackA ? pl.a - set(-1) : pl.a, b = pl.trackB ? pl.b + set(1) : pl.b;
      const [eo, bo] = pl.trackB && !pl.trackA ? [b, a] : [a, b];
      edge.push({ x: q.x + q.uz * eo, y: q.y, z: q.z - q.ux * eo });
      back.push({ x: q.x + q.uz * bo, y: q.y, z: q.z - q.ux * bo });
      y = Math.max(y, q.y);
    }
    if (deep || raised) y = Math.max(...edge.map((e) => e.y)); // (below ground, y is negative: the highest point, not 0)
    platforms.push({ edge, back, width: Math.abs(pl.a - pl.b), y: y + RAIL_TOP + PLAT_H, station: w.id, twoFaced: pl.trackA && pl.trackB });
    lo = Math.min(lo, pl.b); hi = Math.max(hi, pl.a);
  }
  // how far out the tracks and platforms reach, either side of the centre line
  for (const t of st.tracks) { lo = Math.min(lo, t.to - 2.5); hi = Math.max(hi, t.to + 2.5); }
  const sm = (w.s0 + w.s1) / 2, m = pointAt(path, sm), rot = Math.atan2(m.uz, m.ux);
  // the building on its side, at the middle of the platforms, its front to the road side (on a
  // viaduct or over an underground station, it's at street level beside the line)
  const bSide = w.side, bw = Math.min(26, (w.s1 - w.s0) * 0.4), bd = 10;
  const bo = (bSide === 1 ? hi : -lo) + 1 + bd / 2 + (raised ? 1.5 : 0);
  const building = { x: m.x + m.uz * bo * bSide, z: m.z - m.ux * bo * bSide, y: raised || deep ? 0 : m.y, rot, w: bw, d: bd };
  // a footbridge over the tracks, a quarter of the way from one end, from the building's side to
  // the far platform, square to the track there
  let footbridge: StationShape['footbridge'];
  if (platforms.length >= 2 || st.tracks.length >= 2) {
    const fq = pointAt(path, sm + (w.s1 - w.s0) * 0.25);
    // (from the building's side out to the platform furthest from it)
    const far = bSide === 1 ? Math.min(...st.plats.map((p) => (p.a + p.b) / 2)) : Math.max(...st.plats.map((p) => (p.a + p.b) / 2));
    const a = bSide === 1 ? hi : lo, b = far;
    footbridge = { a: { x: fq.x + fq.uz * a, z: fq.z - fq.ux * a }, b: { x: fq.x + fq.uz * b, z: fq.z - fq.ux * b }, y: fq.y, rot: Math.atan2(fq.uz, fq.ux) };
  }
  const [a, b] = worksSpan({ ...w, depot: undefined }, tracks);
  const bed = subPath(path, Math.max(0, a), Math.min(pathLength(path), b));
  // (bandPolys measures its first offset to the other side from ours: left here is its right)
  const band = bandPolys(bed, -lo + 1, hi + 1), hall = rectCorners(building.x, building.z, rot, bw + 8, bd + 4);
  const land: XZ[][] = raised || deep ? [hall] : [...band, hall];
  let depot: StationShape['depot'];
  const dp = g.depots.get(w.id);
  if (dp !== undefined) {
    const pc = g.pieces[dp], buffersAtEnd = g.nodes.get(pc.b)!.pieces.length === 1, n = pc.pts.length;
    const far = buffersAtEnd ? pc.pts[n - 1] : pc.pts[0], near = buffersAtEnd ? pc.pts[Math.max(0, n - 8)] : pc.pts[Math.min(n - 1, 7)];
    const drot = Math.atan2(far.z - near.z, far.x - near.x), sl = 34;
    const shed = { x: far.x - Math.cos(drot) * (sl / 2 + 2), z: far.z - Math.sin(drot) * (sl / 2 + 2), y: far.y, rot: drot, w: sl, d: 8 };
    depot = { pts: pc.pts, shed };
    land.push(...bandPolys(pc.pts, 3, 3), rectCorners(shed.x, shed.z, drot, sl + 2, 10));
  }
  const area = [...band, hall, ...(depot ? land.slice(-(depot.pts.length)) : [])];
  return {
    platforms, building, footbridge, depot, land, deckLand: raised ? band : undefined, area,
    access: look.access ?? 'footbridge', style: look.style ?? 'victorian', canopy: deep ? false : look.canopy ?? true, structure,
    // (a little past the station's own track at each end: the bridge stops short of it, the box's
    // end walls stand clear of the platforms' ends, and no face of one lies in the plane of another)
    bed: raised || deep ? { pts: subPath(path, Math.max(0, a - BED_PAST), Math.min(L, b + BED_PAST)).map((p) => ({ x: p.x, y: p.y ?? 0, z: p.z })), l: hi + (raised ? 0.3 : 1.2), r: lo - (raised ? 0.3 : 1.2) } : undefined,
    radius, mid: { x: m.x, y: m.y, z: m.z }, ux: m.ux, uz: m.uz, outer: [lo, hi],
  };
}

// ---------- planning ----------
export interface StationPlan {
  layout: Layout; loop: boolean; title: string; notes: string[]; cost: number; ok: boolean; blocked?: string;
  station: Station; works: StationWorks; shape: StationShape; clears: Lot[]; recommended?: boolean; config: StationConfig;
}
export interface StationOptions { len?: number; name?: string; crossings?: CrossingSite[]; stations?: Station[]; config?: Partial<StationConfig> & { tracks: number; layout: Layout } }

// Every way a station could be built on this track at this spot, or why none can.
export function planStation(net: Network, segId: number, s: number, tapSide: 1 | -1, o: StationOptions = {}): { plans: StationPlan[]; reason?: string } {
  const seg = net.segs.get(segId);
  if (!seg) return { plans: [], reason: 'No track here' };
  const def = net.def(seg);
  if (def.cls !== 'rail') return { plans: [], reason: 'Stations go on railway track · tap a railway' };
  const path = net.path(seg), L = pathLength(path), tracks = def.tracks === 2 ? 2 : 1;
  const len = o.len ?? (def.mph >= 150 ? 215 : def.mph >= 90 ? 130 : 60);
  const q = pointAt(path, s), hx = q.ux, hz = q.uz;
  const others = (o.stations ?? []).map((x) => worksFor(net, x)).filter((x): x is StationWorks => !!x);
  // the presets on offer, or just the one asked for
  const look = { style: o.config?.style ?? 'victorian' as StationStyle, access: o.config?.access ?? 'footbridge' as Access, canopy: o.config?.canopy ?? true };
  const presets: (StationConfig & { title?: string; recommended?: boolean })[] = o.config ? [{ ...look, ...o.config }] : tracks === 2
    ? [{ tracks: 2, layout: 'side', ...look, title: 'Two side platforms', recommended: true }, { tracks: 2, layout: 'island', ...look, title: 'Island platform' }]
    : [{ tracks: 2, layout: 'island', ...look, title: 'Passing loop, island platform', recommended: true }, { tracks: 2, layout: 'side', ...look, title: 'Passing loop, two platforms' }, { tracks: 1, layout: 'side', ...look, title: 'One platform' }];
  const plans: StationPlan[] = [];
  let reason: string | undefined;
  const id = -1;
  for (const c of presets) {
    const n = Math.max(tracks, Math.min(4, c.tracks)), loop = tracks === 1 && n >= 2, layout: Layout = n === 1 && c.layout === 'island' ? 'side' : c.layout;
    const w: StationWorks = { id, seg: segId, s0: s - len / 2, s1: s + len / 2, layout, loop, tracks: n, side: tapSide };
    const [a, b] = worksSpan(w, tracks);
    const run = checkRun(seg, path, L, a, b, s, len, others, o.crossings ?? [], segId);
    if (typeof run === 'string') { reason ??= run; continue; }
    const structure = run.structure, raised = structure === 'viaduct', deep = structure === 'underground';
    const g = new TrackGraph(net, [...others.filter((x) => x.seg === segId), w]);
    if (g.broken.has(id)) { reason ??= `Too close to points, the end of the track or another station · it needs about ${Math.round(b - a)} m of plain line`; continue; }
    const shape = stationShape(net, g, w, { ...c, structure })!;
    // anything else on its ground (roads, junctions, sites, other stations) stops it; buildings are
    // bought out. A viaduct's deck only minds other stations and industrial sites under it: roads
    // pass beneath, and its piers stand clear of them.
    const own = (k: string) => k === `road:${segId}`;
    const hit = [...shape.land.map((poly) => net.land.hits(poly, (cl) => own(cl.key))), ...(shape.deckLand ?? []).map((poly) => net.land.hits(poly, (cl) => own(cl.key) || (cl.owner !== 'station' && cl.owner !== 'industry')))].flat();
    const ground = [...shape.land, ...(shape.deckLand ?? [])];
    const clears = net.lots.filter((l) => ground.some((poly) => polysOverlap(rectCorners(l.x, l.z, l.rot, l.w, l.d), poly)));
    const wet = (raised || deep) && net.isWater(shape.building);
    const blocked = wet ? `The street entrance would be in the water · build it on the other side, or where the ${raised ? 'viaduct' : 'tunnel'} runs over dry land`
      : hit.length ? `In the way: ${hit[0].owner === 'station' ? 'another station' : hit[0].owner === 'road' ? 'a road or railway' : hit[0].owner === 'junction' ? 'a junction' : hit[0].owner === 'industry' ? 'an industrial site' : 'something already built'}` : undefined;
    const sec = stationTracks(w, tracks), platforms = shape.platforms.length;
    // track: every station track moved or new is relaid, with a set of points each end for each one added
    const perTrack = def.cost / tracks, relaid = sec.tracks.filter((t) => Math.abs(t.to - t.from) > 0.01).length + Math.max(0, n - tracks);
    const trackCost = Math.min(n, relaid) * perTrack * (len + 2 * sec.ramp) + Math.max(0, n - tracks) * 2 * COST.points + (layout === 'island' && tracks === 2 ? 2 * COST.points : 0);
    // (up on a viaduct or down below, people reach the platforms by the stairs and lifts that come with it)
    const reach = raised || deep ? 0 : platforms >= 2 || n >= 2 ? ACCESS[c.access].cost : 0;
    const bedArea = shape.bed ? (shape.bed.l - shape.bed.r) * (raised ? b - a : len + 20) : 0;
    const struct = raised ? bedArea * STRUCTURE_COST.deck + platforms * STRUCTURE_COST.lifts : deep ? bedArea * STRUCTURE_COST.box + platforms * STRUCTURE_COST.shafts + STRUCTURE_COST.entrance : 0;
    const canopy = c.canopy && !deep;
    const cost = Math.round((platforms * len * COST.platform * (canopy ? 1.25 : 1) + STYLES[c.style].cost + reach + struct + trackCost + clears.length * CLEAR_COST) / 1000) * 1000;
    const through = sec.tracks.filter((t) => !t.plat).length;
    const where = raised ? `On the viaduct: its deck widened for the platforms, with stairs and lifts down to a booking hall at street level`
      : deep ? `Underground: platforms in a station box ${Math.round(-shape.mid.y)} m down, with stairs, escalators and lifts up to ${c.style === 'halt' ? 'an entrance' : 'the booking hall'} at street level` : '';
    const notes = [
      ...(where ? [where] : []),
      loop ? `The single line opens into ${n} tracks, so trains can pass here` : n > tracks ? `${n} tracks through the station, ${n - tracks} more than the line` : `${n === 1 ? 'One track' : `${n} tracks`} through the station`,
      `${platforms} platform${platforms === 1 ? '' : 's'}: ${layout === 'side' ? 'at the sides' : layout === 'island' ? (platforms === 1 ? 'an island between the tracks' : 'islands between the tracks') : 'on both sides of every track'} · ${len} m long, room for ${LENGTHS.find((x) => x.len >= len)?.fits ?? 'the longest trains'}`,
      ...(shape.radius < 20_000 ? [`On a curve (radius ${Math.round(shape.radius / 10) * 10 >= 1000 ? (Math.round(shape.radius / 10) * 10).toLocaleString('en-GB') : Math.round(shape.radius)} m): the platform edges are set back ${Math.round(throwOut(shape.radius) * 1000)} mm on the outside of it and ${Math.round(throwIn(shape.radius) * 1000)} mm on the inside, for the trains’ overhang`] : []),
      ...(through ? [`${through} track${through === 1 ? '' : 's'} without a platform: trains not calling run straight through`] : []),
      `${STYLES[c.style].label}${reach ? ` · ${ACCESS[c.access].label.toLowerCase()} over the tracks` : ''}${canopy ? ' · canopies' : ''}`,
    ];
    if (clears.length) notes.push(`${clears.length} building${clears.length === 1 ? '' : 's'} in the way ${clears.length === 1 ? 'is' : 'are'} bought and cleared`);
    const title = c.title ?? (loop ? `Passing loop, ${n} tracks` : `${n} track${n === 1 ? '' : 's'}`) + ` · ${layout === 'side' ? 'side platforms' : layout === 'island' ? 'island' : 'platforms both sides'}`;
    const station: Station = { id, name: o.name ?? '', x: q.x, z: q.z, hx, hz, len, layout, loop, tracks: n, side: tapSide, building: tapSide, cost, style: c.style, access: c.access, canopy: c.canopy, y: q.y, ...(structure !== 'surface' ? { structure } : {}) };
    plans.push({ layout, loop, title, notes, cost, ok: !blocked, blocked, station, works: w, shape, clears, recommended: c.recommended, config: { tracks: n, layout, style: c.style, access: c.access, canopy: c.canopy } });
  }
  if (!plans.length) return { plans, reason: reason ?? 'A station can’t go here' };
  return { plans };
}

// Is the track level, straight or gently curving, and on the ground, on a viaduct that can carry
// platforms, or deep underground? (What it stands on, or a reason it can't be built.)
function checkRun(seg: RSeg, path: P[], L: number, a: number, b: number, s: number, len: number, others: StationWorks[], crossings: CrossingSite[], segId: number): { structure: Structure } | string {
  if (a < 0 || b > L) return `Not enough track here · a station needs about ${Math.round(b - a)} m of level line`;
  const run = subPath(path, a, b);
  let steep = 0;
  for (let i = 1; i < run.length; i++) {
    const h = Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z) || 1;
    steep = Math.max(steep, Math.abs((run[i].y ?? 0) - (run[i - 1].y ?? 0)) / h);
  }
  // (sample the height along it too: a straight piece of track only has points at its ends)
  let top = -Infinity, bottom = Infinity;
  for (let t = a; t <= b; t += 5) { const y = pointAt(path, t).y; top = Math.max(top, y); bottom = Math.min(bottom, y); }
  let structure: Structure;
  if (top <= 1 && bottom >= -1) structure = 'surface';
  else if (bottom >= VIADUCT_MIN) {
    // all of it on bridges that can be widened for platforms
    const on = (seg.bridges ?? []).filter((x) => x.s1 > a && x.s0 < b).sort((x, y) => x.s0 - y.s0);
    let reach = a;
    for (const x of on) { if (x.s0 > reach + 1) break; reach = Math.max(reach, x.s1); }
    if (!on.length || reach < b - 1) return 'Part of this stretch is on an embankment or its ramps · a viaduct station needs all of it on the bridge, level';
    const no = on.find((x) => !CARRIES.includes(x.type));
    if (no) return `This bridge can’t carry a station: ${noCarry(no.type)} (${BRIDGES[no.type].label.toLowerCase()}) · a masonry, girder, beam or box-girder viaduct can`;
    structure = 'viaduct';
  } else if (top <= -UNDER_MIN) structure = 'underground';
  else if (top < -1 && bottom > -UNDER_MIN) return `Stations can’t go in a cutting or a shallow tunnel · go deeper, ${UNDER_MIN} m down at least (Build a railway with Under and Deep), or build at ground level`;
  else return 'Stations can’t go on a ramp, an embankment or where the line climbs into a cutting · find level track at ground level, on a viaduct or deep in a tunnel';
  if (steep > MAX_GRADE) return `Platforms need level track · it climbs 1 in ${Math.round(1 / steep)} here (at most 1 in ${Math.round(1 / MAX_GRADE)})`;
  // (measured every 10 m along it: minRadius on a cut-out piece of a polyline reads its corners)
  let r = Infinity;
  for (let t = a; t <= b + 1e-6; t += 10) r = Math.min(r, 1 / Math.max(1e-9, Math.abs(curveAt(path, L, Math.min(t, b)))));
  if (r < MIN_RADIUS) return `Platforms need straight track or a gentle curve · this curves too tightly (radius ${Math.round(r)} m; at least ${MIN_RADIUS.toLocaleString('en-GB')} m)`;
  for (const o of others) if (o.seg === segId && o.s1 > s - len / 2 - 40 && o.s0 < s + len / 2 + 40) return 'There’s already a station here';
  for (const c of crossings) if (c.rail === segId && c.railS > a - 10 && c.railS < b + 10) return 'A level crossing is in the way';
  return { structure };
}
