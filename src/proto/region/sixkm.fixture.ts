// A test fixture: a seeded 6 km spread of settlements, links and water, made whole (the first region
// map, before the game became one 50 km map). The game never runs this; `region/fields.test.ts` lays
// its fields over it, because the field layout wants a few places, the lanes between them and a
// river, at the scale a fields test can afford. Delete it when that test builds its own input.
import { KINDS, layStreets, reach, suggestLinks, type Kind, type Plan, type Settlement, type StreetCall, type ZoneRule, type Link } from './generate';
import { rng, mix, range, type Rand } from './random';
import { placeName } from './names';
import { regionOptions, type RegionOptions } from './options';
import { MapWater, type LakeSpec, type RiverSpec, type WaterSpec, type XZ } from '../worldmap/water';

export interface Region {
  seed: number;
  options: RegionOptions; // what it was made from: the same options always make the same region
  bound: number; // half the map's width
  water: WaterSpec;
  settlements: Settlement[];
  streets: StreetCall[];
  zones: ZoneRule[];
  links: Link[];
}

export const REGION_BOUND = 3000;

// (a seed alone is the default options with that seed: docs/regiongen.md)
export function generateRegion(opts: number | Partial<RegionOptions>, bound = REGION_BOUND): Region {
  // (the first region's defaults and limits: one river, one or two lakes, a city, three towns, six to eight villages)
  const asked = typeof opts === 'number' ? { seed: opts } : opts;
  const o: RegionOptions = { ...regionOptions({ rivers: 1, lakes: -1, city: true, towns: 3, villages: -1, ...asked }), size: 6 }, seed = o.seed;
  o.rivers = Math.min(3, o.rivers); o.lakes = Math.min(4, o.lakes); o.towns = Math.min(6, Math.max(0, o.towns)); o.villages = Math.min(12, o.villages);
  const water = makeWater(rng(mix(seed, 2)), bound, o);
  const mw = new MapWater(water);
  const settlements = placeSettlements(rng(mix(seed, 3)), seed, bound, mw, o);
  const streets: StreetCall[] = [], zones: ZoneRule[] = [];
  for (const s of settlements) {
    const out = layStreets(s, mw, bound);
    streets.push(...out.streets);
    if (out.zone) zones.push(out.zone);
  }
  return { seed, options: o, bound, water, settlements, streets, zones, links: suggestLinks(settlements, mw) };
}

// ---------------- water ----------------
// Rivers right across the map (they run off both edges, past the ground's edge at 1.5× the bound),
// meandering on two slow waves, and lakes clear of them. More than one river run the same way,
// each in its own band of the map, never crossing another.
function makeWater(r: Rand, B: number, o: RegionOptions): WaterSpec {
  const eastWest = r() < 0.5, n = o.rivers, rivers: RiverSpec[] = [];
  const band = (1.2 * B) / Math.max(1, n);
  let drift = 0;
  for (let k = 0; k < n; k++) {
    let base = range(r, -0.55, 0.55) * B, a1 = range(r, 150, 320);
    const w1 = range(r, 1300, 2000), p1 = range(r, 0, 6.28);
    let a2 = range(r, 50, 120);
    const w2 = range(r, 500, 800), p2 = range(r, 0, 6.28), d = range(r, -0.12, 0.12);
    if (k === 0) drift = d;
    if (n > 1) {
      // (its own band, with a little play, and meanders small enough to stay in it; all drift alike)
      base = -0.6 * B + band * (k + 0.5) + (base / (0.55 * B)) * band * 0.08;
      const room = band / 2 - 150 - band * 0.08, f = Math.min(1, room / (a1 + a2));
      a1 *= f; a2 *= f;
    }
    const path: XZ[] = [];
    for (let t = -1.65 * B; t <= 1.65 * B + 1e-6; t += 20) {
      const off = base + drift * t + a1 * Math.sin((t / w1) * 2 * Math.PI + p1) + a2 * Math.sin((t / w2) * 2 * Math.PI + p2);
      path.push(eastWest ? { x: t, z: off } : { x: off, z: t });
    }
    rivers.push({ path, width: Math.round(range(r, 16, 22)) });
  }
  const riverOnly = new MapWater({ lakes: [], rivers });
  const lakes: LakeSpec[] = [];
  const want = o.lakes === -1 ? (r() < 0.5 ? 1 : 2) : o.lakes;
  for (let tries = 0; tries < 800 && lakes.length < want; tries++) {
    const L: LakeSpec = { x: range(r, -B + 450, B - 450), z: range(r, -B + 450, B - 450), r: Math.round(range(r, 110, 170)), waves: [range(r, 0, 6.28), range(r, 0, 6.28), range(r, 0, 6.28)] };
    if (riverOnly.edgeDistance(L) < L.r * 1.35 + 350) continue;
    if (lakes.some((q) => Math.hypot(q.x - L.x, q.z - L.z) < (q.r + L.r) * 1.35 + (want > 2 ? 500 : 900))) continue;
    lakes.push(L);
  }
  return { lakes, rivers };
}

// Poisson-disc sampling (dart throwing): each new place lands at random, and is kept only if it's
// far enough from every place already there (by both their sizes) and from the water. The city
// goes first, near the middle; then the towns; then the villages in the gaps.
function placeSettlements(r: Rand, seed: number, B: number, mw: MapWater, o: RegionOptions): Settlement[] {
  const nVillages = o.villages === -1 ? 6 + Math.floor(r() * 3) : o.villages;
  const kinds: Kind[] = [...(o.city ? ['city' as const] : []), ...Array<Kind>(o.towns).fill('town'), ...Array<Kind>(nVillages).fill('village')];
  const out: Settlement[] = [];
  const taken = new Set<string>();
  const names = rng(mix(seed, 4)); // (a stream of their own: a change to the names never moves a place)
  const gapFor = (a: Kind, b: Kind) => (a === 'village' || b === 'village' ? 420 : 750);
  kinds.forEach((kind, n) => {
    const K = KINDS[kind];
    const radius = Math.round(range(r, K.r[0], K.r[1]));
    const R = reach(kind, radius);
    let slack = 1;
    for (let tries = 0; ; tries++) {
      if (tries > 0 && tries % 150 === 0) slack *= 0.85; // (a crowded map: squeeze the gaps a little)
      if (tries > 3000) return; // no room at all (never on a 6 km map; the tests check the count)
      // (the city near the middle, moving further out only if the water leaves it no room there)
      const span = Math.min(B - R - 120, kind === 'city' ? 0.3 * B + tries : B);
      const p = { x: range(r, -span, span), z: range(r, -span, span) };
      if (mw.edgeDistance(p, R + 100) < R + 40) continue;
      if (out.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < (reach(o.kind, o.r) + R + gapFor(o.kind, kind)) * slack)) continue;
      const axis = range(r, 0, Math.PI);
      const plan: Plan = r() < K.grid ? 'grid' : 'organic';
      const id = out.length;
      const s: Settlement = { id, name: placeName(names, kind === 'village', taken), kind, x: Math.round(p.x), z: Math.round(p.z), r: radius, axis, plan, seed: mix(seed, 100 + n), gates: [] };
      out.push(s);
      return;
    }
  });
  return out;
}
