// The region's roads between places (docs/region.md, R2): one motorway right across the map with
// three or four junctions near the biggest places, A roads between the city and the towns, and B
// roads out to the villages. It takes the region as a few plain facts, the shape the region
// generator (src/proto/region, `map.settlements` and `map.links`) gives them in, so it can be laid
// over a generated region or a test one alike.
import { DEFAULT_OPTS, closestOnPath, pathLength, pointAt, type End, type Network, type P } from '../roads';
import { buildJunction, buildPair, pairGap, type Interchange, type IxForm, type SlipStyle } from './build';

export interface RegionPlace { id: number; name?: string; kind: 'city' | 'town' | 'village'; x: number; z: number; r: number; gates?: P[] }
export interface RegionLink { a: number; b: number; road: 'A' | 'B' }
// `edge`: where the ground ends (past `bound`, where nothing's built): given, the motorway runs on
// out to it at both ends, and an A road leaves the map on each side the motorway doesn't, so there
// are ways in and out of the map for traffic (game/portals.ts)
export interface RegionIn { bound: number; settlements: RegionPlace[]; links: RegionLink[]; edge?: number }
export interface RegionRoads { motorway: P[]; interchanges: Interchange[]; aRoads: number[]; bRoads: number[]; failed: string[]; out: number[] }

// Road types: the catalogue's rural roads (their speed limits come with them)
export const REGION_ROADS = { motorway: 'motorway', A: 'rural-60', B: 'rural-50', link: 'dual' };
const SIZE = { city: 3, town: 2, village: 1 };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);

// The motorway's line: straight across the map, along the way the big places lie, and set off to
// one side of them so it runs past rather than through them (clear of every place's edge by at
// least `clear`), as close to the biggest as it can be.
export function motorwayLine(region: RegionIn, clear = 300): P[] {
  const big = region.settlements.filter((s) => s.kind !== 'village');
  const w = (s: RegionPlace) => SIZE[s.kind] * s.r;
  const W = big.reduce((t, s) => t + w(s), 0) || 1;
  const c = { x: big.reduce((t, s) => t + s.x * w(s), 0) / W, z: big.reduce((t, s) => t + s.z * w(s), 0) / W };
  // the principal axis of the big places
  let sxx = 0, szz = 0, sxz = 0;
  for (const s of big) { const dx = s.x - c.x, dz = s.z - c.z; sxx += w(s) * dx * dx; szz += w(s) * dz * dz; sxz += w(s) * dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), u = { x: Math.cos(ang), z: Math.sin(ang) }, n = { x: -u.z, z: u.x };
  const B = region.bound - 15;
  // across the whole map: where the line through p along u meets the edge either way
  const across = (p: P): P[] => {
    const k = (sgn: number) => Math.min(...[u.x ? (sgn * Math.sign(u.x) * B - p.x) / u.x : Infinity, u.z ? (sgn * Math.sign(u.z) * B - p.z) / u.z : Infinity].map(Math.abs));
    const t1 = k(1), t0 = k(-1);
    return [{ x: p.x - u.x * t0, z: p.z - u.z * t0 }, { x: p.x + u.x * t1, z: p.z + u.z * t1 }];
  };
  let best: P[] | null = null, bestScore = Infinity;
  for (let d = -region.bound * 0.8; d <= region.bound * 0.8; d += 25) {
    const p = { x: c.x + n.x * d, z: c.z + n.z * d }, line = across(p);
    const gap = (s: RegionPlace) => closestOnPath(s, line).d - s.r;
    if (region.settlements.some((s) => gap(s) < clear)) continue;
    // (near the big places, the biggest counting most)
    const score = big.reduce((t, s) => t + w(s) * (gap(s) - clear), 0);
    if (score < bestScore) { bestScore = score; best = line; }
  }
  return best ?? across(c);
}

// Lay out the region's roads on the network. Junctions are dumbbells (or `form`), each with a link
// road from its roundabout nearer the place it serves; anything that can't be built is left out and
// said why in `failed`.
export function layRegionRoads(net: Network, region: RegionIn, opts: { form?: IxForm; style?: SlipStyle; junctions?: number } = {}): RegionRoads {
  const out: RegionRoads = { motorway: [], interchanges: [], aRoads: [], bRoads: [], failed: [], out: [] };
  const mw = motorwayLine(region), L = dist(mw[0], mw[1]), E = region.edge;
  out.motorway = mw;
  const pair = buildPair(net, mw, REGION_ROADS.motorway);
  if (!pair.ok) { out.failed.push(`The motorway: ${pair.reason}`); return out; }
  // the junctions: level with the biggest places, far enough apart (and from the map's edge) for
  // their slip roads, three or four of them
  const spacing = 1300, edge = 650, want = opts.junctions ?? 4;
  const cand = region.settlements.filter((s) => s.kind !== 'village').sort((a, b) => SIZE[b.kind] * b.r - SIZE[a.kind] * a.r);
  const sites: { s: number; place: RegionPlace }[] = [];
  for (const place of cand) {
    const s = closestOnPath(place, mw).s;
    if (s < edge || s > L - edge || sites.some((x) => Math.abs(x.s - s) < spacing)) continue;
    sites.push({ s, place });
    if (sites.length >= want) break;
  }
  const hub = new Map<number, End>(); // where each place's roads out start: a gate, or its centre
  const ends = (p: RegionPlace, toward: P): End => {
    const g = p.gates?.length ? p.gates.reduce((b, q) => (dist(q, toward) < dist(b, toward) ? q : b)) : null;
    const at = g ?? { x: p.x, z: p.z };
    return net.snapStart(at, 20);
  };
  for (const { s, place } of sites) {
    const r = buildJunction(net, opts.form ?? 'dumbbell', { mw, type: REGION_ROADS.motorway, s, road: null, roadType: REGION_ROADS.link, style: opts.style }, out.interchanges.length + 1);
    if (!r.ok) { out.failed.push(`The junction for ${place.name ?? `place ${place.id}`}: ${r.reason}`); continue; }
    out.interchanges.push(r.ix);
    // the link from the place to the junction's roundabout on its side
    const [n1, n2] = r.ix.nodes, R = [n1, n2].map((id) => net.node(id)).sort((a, b) => dist(a, place) - dist(b, place))[0];
    const a = ends(place, R), b: End = { x: R.x, z: R.z, node: R.id };
    const c = net.check(a, b, undefined, { ...DEFAULT_OPTS, type: REGION_ROADS.A });
    if (c.ok) out.aRoads.push(...net.build(a, b, undefined, { ...DEFAULT_OPTS, type: REGION_ROADS.A }));
    else out.failed.push(`The road from ${place.name ?? `place ${place.id}`} to its junction: ${c.reason}`);
    hub.set(place.id, a);
  }
  // A roads between the city and the towns, B roads out to the villages (crossing the motorway on a
  // bridge where they cross it: the network grade-separates anything that crosses a motorway)
  const byId = new Map(region.settlements.map((s) => [s.id, s]));
  for (const link of [...region.links].sort((x, y) => (x.road === y.road ? 0 : x.road === 'A' ? -1 : 1))) {
    const pa = byId.get(link.a), pb = byId.get(link.b);
    if (!pa || !pb) continue;
    const type = link.road === 'A' ? REGION_ROADS.A : REGION_ROADS.B;
    const a = ends(pa, pb), b = ends(pb, pa);
    const o = { ...DEFAULT_OPTS, type };
    const c = net.check(a, b, undefined, o);
    if (!c.ok) { out.failed.push(`The ${link.road} road ${pa.name ?? pa.id}–${pb.name ?? pb.id}: ${c.reason}`); continue; }
    (link.road === 'A' ? out.aRoads : out.bRoads).push(...net.build(a, b, undefined, o));
  }
  if (E) { out.motorway = runOn(net, mw, E, out); roadsOut(net, region, E, mw, hub, ends, out); }
  splitLong(net, 450, new Set(out.interchanges.flatMap((ix) => [...ix.segs, ...ix.slips.map((x) => x.seg)])));
  densify(net);
  return out;
}

// Points along every road and track at least every `step` metres. The region's hills are added as
// it's drawn, vertex by vertex (drape.ts), so a straight road between two points kilometres apart
// would be drawn as one straight line through the hills, under the ground. (The same line: only
// points on it are added, so nothing the network worked out along it moves.)
export function densify(net: Network, step = 20) {
  for (const s of net.segs.values()) {
    const d = net.def(s);
    if (d.cls !== 'road' && d.cls !== 'rail') continue;
    const p = net.path(s);
    if (p.every((q, i) => !i || Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z) <= step + 1e-6)) continue;
    const mid: P[] = [];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(L / step);
      for (let k = i === 1 ? 1 : 0; k < n; k++) {
        if (k === 0) { mid.push(a); continue; }
        const t = k / n;
        mid.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * t });
      }
    }
    s.mid = mid;
  }
}

// Cut every road longer than `max` into pieces at plain joins: the map is drawn a cell at a time,
// each road by the cell its middle's in (game/regionview.ts), so a road kilometres long would go
// when that cell's out of sight however much of it is in view. (Not the railway, whose stations
// need their straight in one piece: rail/region.ts cuts only its runs out to the edge, `only`.)
export function splitLong(net: Network, max = 450, keep = new Set<number>(), only?: number[]) {
  for (const s of only ? only.map((id) => net.segs.get(id)!).filter(Boolean) : [...net.segs.values()]) {
    const d = net.def(s);
    if ((only ? d.cls !== 'rail' : d.cls !== 'road') || keep.has(s.id) || s.aux) continue;
    // (not the railway's stretch off the map, past the ground's edge: its station stands on it whole)
    if (net.path(s).every((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) >= net.edge - 0.5)) continue;
    const L = pathLength(net.path(s)), n = Math.floor(L / max);
    if (n < 1) continue;
    let id = s.id;
    // (from the far end back, so each cut's on what's left of the first piece)
    for (let k = n; k >= 1; k--) {
      const at = pointAt(net.path(net.segs.get(id)!), (L * k) / (n + 1));
      const node = net.split(id, at);
      id = net.segsAt(node).find((x) => x.b === node)?.id ?? id;
    }
  }
}

// The motorway on out to the ground's edge at both ends: each carriageway straight on from its end
// (built once the junctions are, so they and the roads between places are checked against the
// map's own stretch of it, not one half as long again). Returns the line edge to edge.
function runOn(net: Network, mw: P[], E: number, out: RegionRoads): P[] {
  const g = pairGap(REGION_ROADS.motorway) / 2, L = dist(mw[0], mw[1]), u = { x: (mw[1].x - mw[0].x) / L, z: (mw[1].z - mw[0].z) / L }, n = { x: -u.z, z: u.x };
  const ext = edgeWards(mw, E - 4), o = { ...DEFAULT_OPTS, type: REGION_ROADS.motorway, oneway: true };
  const off = (p: P, k: number) => ({ x: p.x + n.x * k, z: p.z + n.z * k });
  // (each end's node, on either side of the line, and which way along the line is out)
  const legs: [P, number, 1 | -1][] = [[off(mw[0], g), ext.before, -1], [off(mw[1], g), ext.after, 1], [off(mw[1], -g), ext.after, 1], [off(mw[0], -g), ext.before, -1]];
  legs.forEach(([p, t, dir]) => {
    const node = net.nearestNode(p, 2, 'road');
    if (!node || t < 5) return;
    const far = { x: node.x + u.x * dir * t, z: node.z + u.z * dir * t };
    // (in off the edge if the carriageway leaves this end, out to it if it arrives here)
    const cw = net.segsAt(node.id).find((x) => x.oneway);
    if (!cw) return;
    const inward = cw.a === node.id;
    const [a, b]: [End, End] = inward ? [far, { x: node.x, z: node.z, node: node.id }] : [{ x: node.x, z: node.z, node: node.id }, far];
    const ok = beyond(net, E, () => { const c = net.check(a, b, undefined, o); if (!c.ok) return false; net.build(a, b, undefined, o); return true; });
    if (!ok) out.failed.push('The motorway out to the edge');
  });
  return ext.line;
}
// A straight line's ends moved out along it to the square of half-width `e`; how far each moved.
function edgeWards(line: P[], e: number) {
  const [a, b] = line, L = dist(a, b) || 1, u = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
  const to = (p: P, sgn: number) => {
    const dx = u.x * sgn, dz = u.z * sgn;
    return Math.min(dx ? (Math.sign(dx) * e - p.x) / dx : Infinity, dz ? (Math.sign(dz) * e - p.z) / dz : Infinity);
  };
  const t0 = Math.max(0, to(a, -1)), t1 = Math.max(0, to(b, 1));
  return { line: [{ x: a.x - u.x * t0, z: a.z - u.z * t0 }, { x: b.x + u.x * t1, z: b.z + u.z * t1 }], before: t0, after: t1 };
}
// Build past the map's edge, out to the ground's (the network's own bound keeps everything else in)
function beyond<T>(net: Network, e: number | undefined, f: () => T): T {
  const was = net.bound;
  if (e) net.bound = e;
  try { return f(); } finally { net.bound = was; }
}
// The side of the map a point is nearest (0: +x, 1: +z, 2: -x, 3: -z), and the way out through it
const SIDES: P[] = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }, { x: 0, z: -1 }];
export const sideOf = (p: P) => (Math.abs(p.x) >= Math.abs(p.z) ? (p.x >= 0 ? 0 : 2) : p.z >= 0 ? 1 : 3);

// An A road out of the map on each side the motorway doesn't leave by: from the place (a town, or
// the city) that can reach that side most directly, straight out from its gate to the ground's edge,
// clear of every other place. A village takes a B road out where no town can.
function roadsOut(net: Network, region: RegionIn, E: number, mw: P[], hub: Map<number, End>, ends: (p: RegionPlace, toward: P) => End, out: RegionRoads) {
  const used = new Set([sideOf(mw[0]), sideOf(mw[1])]);
  for (let k = 0; k < 4; k++) {
    if (used.has(k)) continue;
    const n = SIDES[k], B = region.bound;
    // (each candidate's gate nearest the side, and the straight run out from it)
    const cands = region.settlements.map((p) => {
      const far = { x: p.x + n.x * B * 4, z: p.z + n.z * B * 4 };
      const g = p.gates?.length ? p.gates.reduce((b, q) => (q.x * n.x + q.z * n.z > b.x * n.x + b.z * n.z ? q : b)) : { x: p.x, z: p.z };
      const run = E - (g.x * n.x + g.z * n.z);
      const exit = { x: n.x ? n.x * (E - 4) : g.x, z: n.z ? n.z * (E - 4) : g.z };
      // (clear of every other place by a margin, and of the motorway's junctions)
      const clear = region.settlements.every((q) => q === p || closestOn(q, g, exit) > q.r + 120);
      return { p, g, run, exit, clear, far, score: run / (p.kind === 'village' ? 0.45 : p.kind === 'town' ? 1 : 1.3) };
    }).filter((c) => c.clear && c.run > 200).sort((a, b) => a.score - b.score);
    for (const c of cands) {
      const type = c.p.kind === 'village' ? REGION_ROADS.B : REGION_ROADS.A;
      const a = hub.get(c.p.id) && dist(hub.get(c.p.id)!, c.g) < 5 ? hub.get(c.p.id)! : ends(c.p, c.far);
      const b = { x: c.exit.x, z: c.exit.z };
      const o = { ...DEFAULT_OPTS, type };
      const ok = beyond(net, E, () => { const ch = net.check(a, b, undefined, o); if (!ch.ok) return false; out.out.push(...net.build(a, b, undefined, o)); return true; });
      if (ok) break;
    }
    if (!out.out.length && k === 3) out.failed.push('no road out of the map');
  }
}
const closestOn = (p: P, a: P, b: P) => closestOnPath(p, [a, b]).d;
