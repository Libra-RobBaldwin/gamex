// The region's roads between places (docs/region.md, R2): one motorway right across the map with
// three or four junctions near the biggest places, A roads between the city and the towns, and B
// roads out to the villages. It takes the region as a few plain facts, the shape the region
// generator (src/proto/region, `map.settlements` and `map.links`) gives them in, so it can be laid
// over a generated region or a test one alike.
import { DEFAULT_OPTS, closestOnPath, type End, type Network, type P } from '../roads';
import { buildJunction, buildPair, type Interchange, type IxForm, type SlipStyle } from './build';

export interface RegionPlace { id: number; name?: string; kind: 'city' | 'town' | 'village'; x: number; z: number; r: number; gates?: P[] }
export interface RegionLink { a: number; b: number; road: 'A' | 'B' }
export interface RegionIn { bound: number; settlements: RegionPlace[]; links: RegionLink[] }
export interface RegionRoads { motorway: P[]; interchanges: Interchange[]; aRoads: number[]; bRoads: number[]; failed: string[] }

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
  const out: RegionRoads = { motorway: [], interchanges: [], aRoads: [], bRoads: [], failed: [] };
  const mw = motorwayLine(region), L = dist(mw[0], mw[1]);
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
  return out;
}
