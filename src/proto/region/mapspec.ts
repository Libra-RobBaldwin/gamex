// A map is data (docs/region.md, R0): its size, water, zone rules, settlements, streets and a seed.
// The game reads everything map-specific from one of these: the ground's size, the water, where
// trees are scattered, the Network's bounds, the camera's limits, and which settlement each new
// plot belongs to (plots are queued nearest a settlement's centre first). Pure: no three.js.
import type { Kind, Link, StreetCall, ZoneRule } from './generate';
import type { WaterSpec, XZ } from '../worldmap/water';
import type { RegionOptions, Relief, Style } from './options';
import type { WorldPlan } from '../worldmap/plan';

export interface SettlementInfo { id: number; name: string; kind: Kind; x: number; z: number; r: number; gates?: XZ[] } // (gates: where its high street leaves it)
// A street as the map describes it: the region's calls, plus the few options the town's
// hand-drawn roads use (a bridge over, a tunnel under, a steeper grade, a railway not snapped).
export interface MapStreet extends Omit<StreetCall, 'settlement' | 'role'> {
  settlement?: number;
  cross?: 'junction' | 'bridge' | 'tunnel';
  grade?: number;
  snap?: boolean; // snap the ends onto roads within 3 m (true)
}
export interface MapSpec {
  id: string;
  name: string;
  seed: number;
  bound: number; // half the map's width: the Network's bound and the camera's
  water: WaterSpec;
  zones: ZoneRule[];
  settlements: SettlementInfo[];
  streets: MapStreet[];
  generated: boolean; // streets from the generator: each is checked, and left out if the Network refuses it (apply.ts)
  links: Link[]; // suggested links between settlements (for the road and rail sessions)
  view: { x: number; z: number; h: number; y?: number }; // where the camera starts (y: the ground's height there, on a map with hills)
  stops: XZ[]; // a few bus stops to start with, near these points
  line: XZ[]; // the starter bus line: the stops nearest these, in order
  industries: boolean; // library industrial sites on the town's estate (game/industry.ts townWishes)
  trees: { count: number; clear?: number; spots?: XZ[] }; // woodland trees scattered, and the radius mostly kept clear round each centre (else 55% of its radius); a real map's trees stand at `spots`
  ground?: { x0: number; z0: number; step: number; n: number; h: Float32Array; max: number }; // a real map's hills (real/map.ts): the relief grid itself, for worldmap/terrain.ts
  credit?: { text: string; href: string }; // a real map's data credit, shown on the map
  placeBy?: 'edge'; // a spot belongs to the settlement whose edge is nearest, not its centre (a real map: a city's suburbs are the city's, not the next village's)
  style: Style; // how it looks (region/styles.ts): temperate, desert, arctic
  relief: Relief; // how hilly (not drawn yet: docs/regiongen.md, "Hills")
  options?: RegionOptions; // a generated map's options: they make it again
  world?: WorldPlan; // a 50 km map's plan (worldmap/): this spec is its live play area, the rest is streamed scenery
}

const inPoly = (p: XZ, poly: XZ[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};
// the zone a spot is in: industrial inside an industrial rule's polygon, else town
const inZone = (z: ZoneRule, p: XZ) => (z.box ? p.x > z.box.x0 && p.x < z.box.x1 && p.z > z.box.z0 && p.z < z.box.z1 : !!z.poly && inPoly(p, z.poly));
export const zoneOf = (m: MapSpec, p: XZ): 'industrial' | 'town' => (m.zones.some((z) => z.kind === 'industrial' && inZone(z, p)) ? 'industrial' : 'town');

// the settlement whose centre is nearest (a map always has at least one)
export function settlementAt(m: MapSpec, p: XZ): SettlementInfo {
  let best = m.settlements[0], bd = Infinity;
  for (const s of m.settlements) { const d = Math.hypot(p.x - s.x, p.z - s.z) - (m.placeBy === 'edge' ? s.r : 0); if (d < bd) { bd = d; best = s; } }
  return best;
}
// how far a plot is from the nearest centre: the order plots are built in
export const centreDistance = (m: MapSpec, p: XZ) => { const s = settlementAt(m, p); return Math.hypot(p.x - s.x, p.z - s.z); };

// How "central" a spot is, in today's town's metres: the Network picks towers, shops, terraces and
// houses by distance from the centre it's given (under 60, 110, 170 m), sized for a market town.
// A city is twice the size, so its bands are twice as wide; a village has a few shops and terraces
// on its high street and houses beyond, never towers.
const scaleOf: Record<Kind, (d: number) => number> = { town: (d) => d, city: (d) => d / 2, village: (d) => 70 + 1.2 * d };
export const centrality = (m: MapSpec, p: XZ) => { const s = settlementAt(m, p); return scaleOf[s.kind](Math.hypot(p.x - s.x, p.z - s.z)); };

// The centre to give Network.plotsFor for a street from `a` to `b`, so its plots come out as
// central as `centrality` says. For a town that's its own centre. Otherwise it's a stand-in point
// square to the street's middle, that far away (a street's plots then all lie about that far from
// it: the along-street spread only adds to it as the square of its length).
export function plotCentre(m: MapSpec, a: XZ, b: XZ): XZ {
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, s = settlementAt(m, mid);
  if (s.kind === 'town') return { x: s.x, z: s.z };
  const d = centrality(m, mid), L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: mid.x - ((b.z - a.z) / L) * d, z: mid.z + ((b.x - a.x) / L) * d };
}

// Is this spot in the middle of a settlement, where the woods mostly keep clear?
export const inCentre = (m: MapSpec, p: XZ) => { const s = settlementAt(m, p); return Math.hypot(p.x - s.x, p.z - s.z) < (m.trees.clear ?? s.r * 0.55); };
