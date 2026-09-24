// Railway stations (docs/rail.md): where one can go, the layouts on offer and what each costs,
// and the ground it stands on.
//
// A station needs a straight, level run of track, clear of points, bridges and cuttings. Its
// platforms are as long as the longest train that should call there. On a double line the
// platforms are either side of the tracks, or the tracks spread round an island between them; on
// a single line the track opens into a passing loop (so trains can cross there), with an island
// or a platform either side, or it keeps one track and one platform. The station building stands
// on the side you tapped, with a footbridge over the tracks where there's more than one
// platform. Like a bus stop, a station takes its land in the land registry, buying out anything
// built there.
import { CLEAR_COST, closestOnPath, minRadius, pathLength, pointAt, polysOverlap, rectCorners, subPath, type Lot, type Network, type P } from '../roads';
import { bandPolys, type XZ } from '../land';
import { EDGE, ISLAND, SIDE_W, TrackGraph, at, stationTracks, worksSpan, type Layout, type P3, type StationWorks } from './track';
import type { CrossingSite } from './crossing';

// A station as the player built it. It's kept by where it is and which way its track runs, so it
// finds its track again after the network is rebuilt (a seg split by a new junction elsewhere).
// Sides are relative to (hx, hz): +1 on its left.
export interface Station {
  id: number; name: string; x: number; z: number; hx: number; hz: number;
  len: number; layout: Layout; loop: boolean; side: 1 | -1; building: 1 | -1;
  depot?: { end: 1 | -1; side: 1 | -1; len: number };
  cost: number;
}
export const MAX_GRADE = 0.005; // 1 in 200
export const MIN_RADIUS = 1000;
export const DEPOT_LEN = 140; // a siding for the longest train that runs from it, with room to spare
// platform lengths: long enough for the longest train of each kind, and a few metres more
export const LENGTHS = [{ len: 60, label: 'Short', fits: 'local trains of 2 cars' }, { len: 130, label: 'Long', fits: 'intercity trains of 5 cars' }, { len: 215, label: 'Very long', fits: 'high-speed trains of 8 cars' }];
export function lengthFor(trainLen: number) { return Math.ceil((trainLen + 8) / 5) * 5; }
const COST = { platform: 2500, building: 350_000, footbridge: 220_000, points: 120_000, depot: 400_000 };

// Where a station is on the network now (null if its track has gone).
export function worksFor(net: Network, st: Station): StationWorks | null {
  let best: { seg: number; s: number; d: number; sign: 1 | -1 } | null = null;
  for (const seg of net.segs.values()) {
    if (net.def(seg).cls !== 'rail') continue;
    const c = closestOnPath(st, net.path(seg));
    const dot = c.ux * st.hx + c.uz * st.hz;
    if (c.d > 6 || Math.abs(dot) < 0.95 || (best && c.d >= best.d)) continue;
    best = { seg: seg.id, s: c.s, d: c.d, sign: dot >= 0 ? 1 : -1 };
  }
  if (!best) return null;
  const k = best.sign;
  return {
    id: st.id, seg: best.seg, s0: best.s - st.len / 2, s1: best.s + st.len / 2, layout: st.layout, loop: st.loop, side: (st.side * k) as 1 | -1,
    depot: st.depot ? { end: (st.depot.end * k) as 1 | -1, side: (st.depot.side * k) as 1 | -1, len: st.depot.len } : undefined,
  };
}

// ---------- what a station looks like on the ground ----------
export interface PlatformShape { edge: P3[]; back: P3[]; width: number; y: number; station: number } // the edge (along the track) and the back, in order
export interface StationShape {
  platforms: PlatformShape[];
  building: { x: number; z: number; y: number; rot: number; w: number; d: number };
  footbridge?: { a: XZ; b: XZ; y: number; rot: number };
  depot?: { pts: P3[]; shed: { x: number; z: number; y: number; rot: number; w: number; d: number } }; // its siding, and a shed over the far end
  land: XZ[][];
  mid: P3; ux: number; uz: number; // the middle of the platforms, and the track's direction there (along its seg)
  outer: [number, number]; // how far the platforms reach right (−) and left (+) of the centre line
}
const PLAT_H = 0.92; // platform surface above the rail head
export const RAIL_TOP = 0.44;
export function stationShape(net: Network, g: TrackGraph, w: StationWorks): StationShape | null {
  const seg = net.segs.get(w.seg), plats = g.platforms.get(w.id);
  if (!seg || !plats) return null;
  const path = net.path(seg), tracks = net.def(seg).tracks === 2 ? 2 : 1;
  const st = stationTracks(w, tracks);
  const platforms: PlatformShape[] = [];
  let lo = Infinity, hi = -Infinity;
  for (const id of plats) {
    const p = g.pieces[id], pl = p.plat!;
    const island = w.layout === 'island' && plats.length === 2;
    if (island && pl.side === -1) continue; // (one island between the two tracks, drawn from the right-hand one)
    const width = island ? ISLAND : SIDE_W, edge: P3[] = [], back: P3[] = [];
    const n = Math.max(2, Math.ceil((pl.u1 - pl.u0) / 8));
    let y = 0;
    for (let i = 0; i <= n; i++) {
      const u = pl.u0 + ((pl.u1 - pl.u0) * i) / n, q = at(p, u), lx = q.uz * pl.side, lz = -q.ux * pl.side;
      edge.push({ x: q.x + lx * pl.edge, y: q.y, z: q.z + lz * pl.edge });
      back.push({ x: q.x + lx * (pl.edge + width), y: q.y, z: q.z + lz * (pl.edge + width) });
      y = Math.max(y, q.y);
    }
    platforms.push({ edge, back, width, y: y + RAIL_TOP + PLAT_H, station: w.id });
  }
  // how far out the platforms reach, either side of the centre line
  for (const t of st.tracks) {
    const sideOut = t.to + t.plat * (EDGE + (w.layout === 'island' && st.tracks.length === 2 ? 0 : SIDE_W));
    lo = Math.min(lo, t.to - 2.5, sideOut); hi = Math.max(hi, t.to + 2.5, sideOut);
  }
  const sm = (w.s0 + w.s1) / 2, m = pointAt(path, sm), rot = Math.atan2(m.uz, m.ux);
  // the building on its side, at the middle of the platforms, its front to the road side
  const bSide = w.side, bw = Math.min(26, (w.s1 - w.s0) * 0.4), bd = 10;
  const bo = (bSide === 1 ? hi : -lo) + 1 + bd / 2;
  const building = { x: m.x + m.uz * bo * bSide, z: m.z - m.ux * bo * bSide, y: m.y, rot, w: bw, d: bd };
  // a footbridge over the tracks, a third of the way along, from the building's side to the far platform
  let footbridge: StationShape['footbridge'];
  if (plats.length >= 2) {
    const fq = pointAt(path, sm + (w.s1 - w.s0) * 0.25);
    const a = bSide === 1 ? hi : lo, b = w.layout === 'island' ? 0 : bSide === 1 ? lo : hi;
    footbridge = { a: { x: fq.x + fq.uz * a, z: fq.z - fq.ux * a }, b: { x: fq.x + fq.uz * b, z: fq.z - fq.ux * b }, y: fq.y, rot };
  }
  const [a, b] = worksSpan({ ...w, depot: undefined }, tracks);
  const bed = subPath(path, Math.max(0, a), Math.min(pathLength(path), b));
  const land: XZ[][] = [...bandPolys(bed, hi + 1, -lo + 1), rectCorners(building.x, building.z, rot, bw + 8, bd + 4)];
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
  return { platforms, building, footbridge, depot, land, mid: { x: m.x, y: m.y, z: m.z }, ux: m.ux, uz: m.uz, outer: [lo, hi] };
}

// ---------- planning ----------
export interface StationPlan {
  layout: Layout; loop: boolean; title: string; notes: string[]; cost: number; ok: boolean; blocked?: string;
  station: Station; works: StationWorks; shape: StationShape; clears: Lot[]; recommended?: boolean;
}
export interface StationOptions { len?: number; name?: string; crossings?: CrossingSite[]; stations?: Station[] }

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
  const layouts: { layout: Layout; loop: boolean; title: string; notes: string[]; extra: number; recommended?: boolean }[] = tracks === 2
    ? [
      { layout: 'side', loop: false, title: 'Two side platforms', notes: ['A platform either side of the double track', 'A footbridge between them'], extra: COST.footbridge, recommended: true },
      { layout: 'island', loop: false, title: 'Island platform', notes: ['The tracks spread apart round one platform between them', 'Both directions share the platform, reached by a footbridge'], extra: COST.footbridge + COST.points },
    ]
    : [
      { layout: 'island', loop: true, title: 'Passing loop, island platform', notes: ['The single line opens into two tracks, so trains can pass here', 'One platform between the tracks, reached by a footbridge'], extra: COST.footbridge + 2 * COST.points, recommended: true },
      { layout: 'side', loop: true, title: 'Passing loop, two platforms', notes: ['The single line opens into two tracks, so trains can pass here', 'A platform on each side, with a footbridge between'], extra: COST.footbridge + 2 * COST.points },
      { layout: 'side', loop: false, title: 'One platform', notes: ['One platform beside the single track', 'Trains can’t pass each other here'], extra: 0 },
    ];
  const plans: StationPlan[] = [];
  let reason: string | undefined;
  const id = -1;
  for (const lay of layouts) {
    const w: StationWorks = { id, seg: segId, s0: s - len / 2, s1: s + len / 2, layout: lay.layout, loop: lay.loop, side: tapSide };
    const [a, b] = worksSpan(w, tracks);
    const why = checkRun(path, L, a, b, s, len, others, o.crossings ?? [], segId);
    if (why) { reason ??= why; continue; }
    const g = new TrackGraph(net, [...others.filter((x) => x.seg === segId), w]);
    if (g.broken.has(id)) { reason ??= `Too close to points, the end of the track or another station · it needs about ${Math.round(b - a)} m of plain line`; continue; }
    const shape = stationShape(net, g, w)!;
    // anything else on its ground (roads, junctions, sites, other stations) stops it; buildings are bought out
    const own = (k: string) => k === `road:${segId}`;
    const hit = shape.land.map((poly) => net.land.hits(poly, (c) => own(c.key))).flat();
    const clears = net.lots.filter((l) => shape.land.some((poly) => polysOverlap(rectCorners(l.x, l.z, l.rot, l.w, l.d), poly)));
    const blocked = hit.length ? `In the way: ${hit[0].owner === 'station' ? 'another station' : hit[0].owner === 'road' ? 'a road or railway' : hit[0].owner === 'junction' ? 'a junction' : hit[0].owner === 'industry' ? 'an industrial site' : 'something already built'}` : undefined;
    const platforms = shape.platforms.length;
    const ramp = stationTracks(w, tracks).ramp;
    const trackCost = lay.loop ? (len + 2 * ramp) * def.cost : lay.layout === 'island' ? (len + 2 * ramp) * def.cost : 0;
    const cost = Math.round((platforms * len * COST.platform + COST.building + lay.extra + trackCost + clears.length * CLEAR_COST) / 1000) * 1000;
    const notes = [...lay.notes, `${platforms === 1 ? 'The platform is' : 'Platforms are'} ${len} m long: room for ${LENGTHS.find((x) => x.len >= len)?.fits ?? 'the longest trains'}`];
    if (clears.length) notes.push(`${clears.length} building${clears.length === 1 ? '' : 's'} in the way ${clears.length === 1 ? 'is' : 'are'} bought and cleared`);
    const station: Station = { id, name: o.name ?? '', x: q.x, z: q.z, hx, hz, len, layout: lay.layout, loop: lay.loop, side: tapSide, building: tapSide, cost };
    plans.push({ layout: lay.layout, loop: lay.loop, title: lay.title, notes, cost, ok: !blocked, blocked, station, works: w, shape, clears, recommended: lay.recommended });
  }
  if (!plans.length) return { plans, reason: reason ?? 'A station can’t go here' };
  return { plans };
}

// Is the track straight, level and on the ground here? (A reason if not.)
function checkRun(path: P[], L: number, a: number, b: number, s: number, len: number, others: StationWorks[], crossings: CrossingSite[], segId: number): string | null {
  if (a < 0 || b > L) return `Not enough track here · a station needs about ${Math.round(b - a)} m of straight, level line`;
  const run = subPath(path, a, b);
  let steep = 0, high = 0;
  for (let i = 1; i < run.length; i++) {
    const h = Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z) || 1;
    steep = Math.max(steep, Math.abs((run[i].y ?? 0) - (run[i - 1].y ?? 0)) / h);
  }
  // (sample the height along it too: a straight piece of track only has points at its ends)
  for (let t = a; t <= b; t += 5) high = Math.max(high, Math.abs(pointAt(path, t).y));
  if (high > 1) return 'Stations can’t go on a bridge, an embankment or in a cutting · find track at ground level';
  if (steep > MAX_GRADE) return `Platforms need level track · it climbs 1 in ${Math.round(1 / steep)} here (at most 1 in ${Math.round(1 / MAX_GRADE)})`;
  const r = minRadius(run);
  if (r < MIN_RADIUS) return `Platforms need straight track · this curves (radius ${Math.round(r)} m; at least ${MIN_RADIUS.toLocaleString('en-GB')} m)`;
  for (const o of others) if (o.seg === segId && o.s1 > s - len / 2 - 40 && o.s0 < s + len / 2 + 40) return 'There’s already a station here';
  for (const c of crossings) if (c.rail === segId && c.railS > a - 10 && c.railS < b + 10) return 'A level crossing is in the way';
  return null;
}
