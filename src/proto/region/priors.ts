// What real Britain looks like, in numbers, for the seeded generator (docs/real.md, "Priors").
// Every number here was measured by tools/os/measure.mjs from Ordnance Survey OpenData over the two
// baked 50 km regions (public/regions): the Exe estuary in Devon (coast, a cathedral city, market
// towns, villages; 1,783 km² of land) and the Teme valley in Shropshire and Herefordshire (inland
// hills, market towns, villages and hamlets; 2,500 km²), unless its note says otherwise. Where the
// two differ, both are given as [exe, teme] and the generator takes a figure between them.
// Re-measure after baking another region: node tools/os/measure.mjs.
//
// Pure: no three.js, no DOM. Contains OS data © Crown copyright and database right (OGL).
import type { Rand } from './random';

export const PRIORS = {
  // ---------------- settlements (OS Open Names places; people from footprints, see PEOPLE) ----------------
  settlements: {
    // places per 1,000 km² of land
    perThousandKm2: { cityOrTown: [11.8, 5.2], village: [74, 71.2], hamlet: [65.1, 170] },
    // distance to the nearest place of the same size or bigger (m): quartiles
    nearestM: { town: [[4411, 5493, 6419], [10574, 11104, 11504]], village: [[1097, 1775, 2535], [1298, 1855, 2747]], hamlet: [[776, 1240, 1472], [797, 1097, 1386]] },
    // rank–size (people ∝ rank^−exponent, places of 300 people or more): a coast of resort towns is
    // steeper than a thinly settled inland valley
    rankSizeExponent: [1.33, 0.8],
    // Open Names' extent of a place against its people: r ≈ a · people^b (m)
    radius: { a: [24.1, 47.3], b: [0.43, 0.37] },
    // people in a town and a village: quartiles
    people: { town: [[5720, 11780, 20570], [3690, 4270, 6380]], village: [[400, 610, 1270], [350, 490, 820]] },
  },
  // ---------------- roads (OS OpenMap Local classes) ----------------
  roads: {
    // km of road per km² of land, by class (a: A roads; primary: A roads on the primary route
    // network, green signs; minor: classified unnumbered roads, the country lanes; local: streets)
    kmPerKm2: {
      motorway: [0.011, 0], primary: [0.102, 0.077], a: [0.147, 0.076], b: [0.129, 0.178], minor: [1.5, 0.877], local: [0.868, 0.162],
      restricted: [0.741, 0.735], // (private and estate roads, farm tracks)
    },
    // where streets meet: dead ends (cul-de-sacs and closes), T-junctions and crossroads, as shares
    // of every junction and end in a place's built-up area (outside: 0.25, 0.71, 0.04)
    junctions: { deadEnd: 0.31, tee: 0.65, cross: 0.04 },
    // length of a street between junctions in a place (m): quartiles
    streetPieceM: [[44, 71, 122], [47, 79, 146]],
    // orientation order (Boeing 2019: 1 a perfect grid, 0 every bearing alike), by street length:
    // British towns are organic, even at their core
    orientationOrder: { core: [0.01, 0.05], suburb: [0.0, 0.01], country: [0, 0] },
    // ribbon development: outside places, the share of buildings within 60 m of an A or B road,
    // against the share of the land that close; lift = how many times likelier a building is there
    ribbon: { buildings: [0.07, 0.11], land: [0.03, 0.03], lift: [2.46, 3.53] },
  },
  // ---------------- how roads follow the land (OpenMap Local roads over Terrain 50) ----------------
  // every 50 m along each class: its grade (median, 90th percentile, share over 10%), and on ground
  // steeper than 4% its grade over the ground's steepest slope (1: straight up the hill, 0: along
  // the contour); and how far it runs above the lowest ground within 1 km. The bigger the road,
  // the lower it runs: trunk roads and motorways keep to the valleys, lanes go over the hills.
  // ---------------- the roads out of a place (tools/os/exits.mjs) ----------------
  // Measured over 31 market towns and 330 villages: where a road (A, B or a lane; not streets, drives
  // or tracks) runs out of a place's built-up area (its buildings, 4 or more within 150 m, joined to
  // the centre) and on into open country. The pictures (node tools/os/exits.mjs --svg) show the rule:
  // roads leave radially, through the main streets, straight out, and bend towards where they're
  // going only once clear of the houses; where two roads want the same way out they share it and
  // fork outside. Quantiles are the 10th, 25th, 50th, 75th and 90th.
  exits: {
    perPlace: { town: [7, 9, 11, 13, 15], village: [3, 3, 5, 6, 8] }, // ways out of a place
    // the angle a road meets the edge at (0°: straight out, radial; 90°: along the edge)
    edgeAngleDeg: { town: [4, 11, 25, 48, 79], village: [3, 10, 23, 45, 68] },
    edgeAngleUnder30: { town: 0.58, village: 0.6 }, // the share leaving within 30° of straight out
    // inside the place, over its last 400 m, how far the road's heading is off the line to the centre
    insideOffCentreDeg: { town: [10, 17, 29, 59, 88], village: [11, 19, 36, 61, 91] },
    reachesCentre: { town: 0.27, village: 0.58 }, // the share that, followed straight on, reach the middle
    // how much a road turns in its first kilometre outside (net: the change of heading)
    netTurnFirstKmDeg: { town: [5, 16, 40, 66, 109], village: [8, 19, 42, 83, 138] },
    // the angles round the place between one way out and the next
    gapDeg: { town: [4, 11, 24, 43, 67], village: [13, 28, 59, 101, 144] },
    smallestGapDeg: { town: [1, 2, 4, 8, 11], village: [4, 10, 22, 48, 87] },
    // what the ways out are: most of a village's are lanes
    byClass: { town: { primary: 32, a: 42, b: 65, minor: 196 }, village: { primary: 109, a: 112, b: 206, minor: 1202 } },
    // the B roads and lanes out of a place, per place (byClass over the 31 towns and 330 villages):
    // what a seeded map, which starts with lanes only, should give each
    minorPerPlace: { town: 8, village: 4 },
  },
  // ---------------- how a place is put together (tools/os/towns.mjs) ----------------
  // Over the same 31 towns and 330 villages: the ways out that, followed in, reach the middle are the
  // radials (the roads the place grew along); the built-up edge reaches further along them than
  // between them (ribbons); inside, streets branch off the radials as T-junctions, some of them
  // closes (dead ends), at these rates and lengths. Quantiles are the 10th, 25th, 50th, 75th, 90th.
  towns: {
    radials: { town: [2, 4, 5, 7, 9], village: [1, 2, 3, 4, 5] }, // radials a place has
    radialShare: { town: 0.45, village: 0.59 }, // the share of its ways out that are radials
    radialGapDeg: { town: [11, 20, 43, 82, 142], village: [23, 48, 87, 138, 197] }, // between one radial and the next
    areaHa: { town: [205, 291, 468, 720, 1034], village: [33, 47, 76, 126, 238] }, // built-up area (100 m cells)
    // the built-up area's long axis over its short one (over 2: linear, strung along a road)
    elongation: { town: [1.3, 1.36, 1.63, 1.92, 2.2], village: [1.2, 1.36, 1.65, 2.2, 2.66] },
    linearShare: { town: 0.19, village: 0.29 },
    // how far the edge reaches along a radial, against between radials (the ribbons)
    edgeAlongOverBetween: { town: [0.87, 1.15, 1.71, 2.77, 3.22], village: [0.63, 0.96, 1.35, 1.95, 2.62] },
    // streets off the radials, inside the place: how many a kilometre of radial, how many are closes,
    // and how long they run before they end or meet another street
    sideStreetsPerKm: { town: [10, 12, 15, 18, 24], village: [3, 5, 8, 11, 15] },
    closeShare: { town: [0.09, 0.14, 0.18, 0.22, 0.26], village: [0, 0, 0.15, 0.33, 0.5] },
    sideStreetLengthM: { town: [33, 55, 98, 191, 373], village: [31, 60, 133, 413, 1144] },
    closeLengthM: { town: [49, 67, 103, 165, 270], village: [49, 66, 106, 177, 430] },
    // a radial bends: from the edge in to the middle its heading turns this much net, per km of its
    // run inside, and wanders this much from one 100 m to the next; over its first 600 m outside
    // it turns this much net (the stems: routes.ts)
    radialTurnInsideDegPerKm: { town: [5.4, 11.7, 24.2, 45.8, 66.8], village: [5.7, 15.1, 39.3, 72, 117] },
    radialWanderInsideDegPer100m: { town: [6.1, 8.5, 11.3, 13.5, 17.4], village: [4.5, 7.7, 11.3, 15.6, 20.2] },
    radialNetTurnOutsideDeg: { town: [3.5, 7.8, 16.5, 28.9, 44.4], village: [2.9, 7.9, 18.4, 34.4, 55.9] },
    // the houses along a radial (buildings within 40 m of it, per 100 m), medians by quarter of its
    // run from the middle to the edge: the ribbon thins over its last quarter to half the middle's;
    // beyond the edge the median is none (a quarter of radials straggle on at 0.5–1.5 per 100 m)
    housesPer100mByQuarter: { town: [4.67, 6.27, 5.6, 3.02], village: [3.27, 5.67, 5.33, 2.4] },
  },
  follow: {
    motorway: { gradeMedian: 0.018, gradeP90: 0.064, over10: 0.043, gradeOverSlope: 0.45, aboveValleyM: 13 }, // (Exe only: the M5)
    primary: { gradeMedian: [0.032, 0.02], gradeP90: [0.092, 0.074], over10: [0.072, 0.044], gradeOverSlope: [0.49, 0.46], aboveValleyM: [30, 16] },
    a: { gradeMedian: [0.034, 0.028], gradeP90: [0.106, 0.094], over10: [0.11, 0.082], gradeOverSlope: [0.52, 0.53], aboveValleyM: [32, 24] },
    b: { gradeMedian: [0.032, 0.026], gradeP90: [0.106, 0.088], over10: [0.113, 0.071], gradeOverSlope: [0.54, 0.52], aboveValleyM: [37, 28] },
    minor: { gradeMedian: [0.042, 0.032], gradeP90: [0.126, 0.102], over10: [0.169, 0.104], gradeOverSlope: [0.6, 0.6], aboveValleyM: [48, 36] },
    local: { gradeMedian: [0.04, 0.032], gradeP90: [0.122, 0.104], over10: [0.158, 0.107], gradeOverSlope: [0.61, 0.63], aboveValleyM: [34, 33] },
    // the land itself, and where places stand (they sit low, by rivers and in valleys)
    land: { aboveValleyM: [51, 40], slopeMedian: [0.094, 0.07] },
    placesAboveValleyM: [22, 29],
  },
  // ---------------- the coast (OS OpenMap Local tidal water) ----------------
  coast: {
    // box-counting dimension of the high-water line over boxes of 50 m to 3.2 km (Exe only)
    fractalDimension: 1.15,
    // the coast inside the 50 km square, and the tidal rivers (estuaries) running inland from it
    lengthKm: 336, tidalRiverKm: 96,
    // a tidal river's width at the waterline (m): quartiles (the Exe and Teign estuaries widen to 1–2 km)
    tidalRiverWidthM: [12, 39, 213],
  },
  // ---------------- woods (OS OpenMap Local woodland) ----------------
  woods: {
    // share of the land outside places that's woodland
    cover: [0.156, 0.132],
    // patches per km² of land, and their sizes: log-normal in m² (median about half a hectare,
    // one in ten over 4 ha)
    perKm2: [8.2, 7.3],
    areaLnM2: { mu: 8.58, sigma: 1.4 },
    // perimeter over a circle's of the same area: quartiles (a circle is 1; long shaws and
    // hanging woods along valley sides are 2 and more)
    shapeIndex: [1.37, 1.72, 2.3],
    // the share of land that's wooded, by slope (rise over run), pooled: woods keep to the ground
    // too steep to plough, and much less to the flat
    bySlope: [[0, 0.081], [0.05, 0.098], [0.1, 0.134], [0.15, 0.195], [0.2, 0.332], [0.3, 0.588]] as [number, number][],
    // median distance from a stream or river (m): woods sit nearer the water than the land does
    streamM: { woods: [99, 143], land: [146, 158] },
  },
  // ---------------- buildings (OS OpenMap Local footprints) ----------------
  buildings: {
    footprintM2: [[76, 132, 214, 581], [60, 122, 204, 692]], // quartiles and the 95th percentile
    perKm2: [88, 33],
  },
  // ---------------- not measured here ----------------
  // Field boundaries aren't in OS OpenData. OpenStreetMap's landuse=farmland (from
  // download.geofabrik.de, which this environment can't reach yet) would give them. Until then:
  // hedged fields in the South West and the Welsh Marches are small, mostly 1–5 ha, and bigger in
  // the arable east (a rough figure, not a measurement).
  fields: { haTypical: [1, 5] as [number, number], note: 'estimate: not measured (needs OSM)' },
} as const;

// People from building footprints (tools/os/bake.mjs): OS draws terraces as one footprint, so a
// place's people are its footprint area over this. Calibrated on Exeter's 2021 census population
// (about 130,000) against its 5.1 km² of footprints; Exmouth and Newton Abbot come out within 10%.
export const PEOPLE = { footprintPerPerson: 42 };

// How often the generator lays a settlement out as a square grid rather than an organic plan. Its
// grid is a lattice (orientation order about 1); real British cores measure 0.01–0.05 and their
// suburbs about 0, so a grid is the exception: a planned town, a Georgian new town, a garden city.
export const GRID_PLAN = { city: 0.2, town: 0.1, village: 0.05 };

// ---------------- helpers ----------------
// a figure between the regions' two (t: 0 the first, 1 the second)
export const between = (v: readonly [number, number] | readonly number[], t = 0.5) => v[0] + (v[1] - v[0]) * t;
const lerpCurve = (c: readonly (readonly [number, number])[], x: number) => {
  if (x <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (x <= c[i][0]) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return c[c.length - 1][1];
};
// How likely a spot is to be wooded, from its slope (rise over run): the real share at that slope.
export const woodShareAt = (slope: number) => lerpCurve(PRIORS.woods.bySlope, slope);
// A settlement's radius for its people (m).
export const radiusFor = (people: number, t = 0.5) => between(PRIORS.settlements.radius.a, t) * people ** between(PRIORS.settlements.radius.b, t);
// How many places of each kind a map of this much land has (a real mix, before any options).
export function placesFor(landKm2: number, t = 0.5) {
  const p = PRIORS.settlements.perThousandKm2, k = landKm2 / 1000;
  return { towns: Math.round(between(p.cityOrTown, t) * k), villages: Math.round(between(p.village, t) * k), hamlets: Math.round(between(p.hamlet, t) * k) };
}
// A standard normal (Box–Muller).
const gauss = (r: Rand) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
// One wood's area (m²), from the real log-normal.
export const woodArea = (r: Rand) => Math.exp(PRIORS.woods.areaLnM2.mu + PRIORS.woods.areaLnM2.sigma * gauss(r));

export interface XZ { x: number; z: number }
// Woods as real ones are: patches with the real sizes (log-normal), as many to the km² as the real
// land has, sited where the real share at that slope says (steep ground and valley sides), and
// drawn out along the slope's contour into the long shapes real woods have. Returns the trees'
// spots (one per `perTree` m² of wood), for MapSpec.trees.spots.
//   box: the land to fill; heightAt: the hills (null on a flat map); keep(p): false where no wood
//   goes (in a town, on water, off the map). `cover` scales the real cover (a map's style).
export function woodSpots(r: Rand, box: { x0: number; z0: number; x1: number; z1: number }, heightAt: ((x: number, z: number) => number) | null, keep: (p: XZ) => boolean, o: { cover?: number; perTree?: number; max?: number } = {}): XZ[] {
  const km2 = ((box.x1 - box.x0) * (box.z1 - box.z0)) / 1e6, perTree = o.perTree ?? 600, max = o.max ?? 20000;
  const want = Math.round(between(PRIORS.woods.perKm2) * km2 * (o.cover ?? 1));
  const top = woodShareAt(1);
  const out: XZ[] = [];
  let made = 0;
  for (let tries = 0; made < want && tries < want * 40 && out.length < max; tries++) {
    const c = { x: box.x0 + r() * (box.x1 - box.x0), z: box.z0 + r() * (box.z1 - box.z0) };
    if (!keep(c)) continue;
    // the slope here, and across it (the contour: woods run along it)
    let s = 0, ang = r() * Math.PI;
    if (heightAt) {
      const e = 25, gx = (heightAt(c.x + e, c.z) - heightAt(c.x - e, c.z)) / (2 * e), gz = (heightAt(c.x, c.z + e) - heightAt(c.x, c.z - e)) / (2 * e);
      s = Math.hypot(gx, gz);
      if (s > 1e-4) ang = Math.atan2(gz, gx) + Math.PI / 2;
    }
    // (sited by the real share at this slope, against the steepest's)
    if (r() > woodShareAt(s) / top) continue;
    made++;
    const A = Math.min(woodArea(r), 400000), k = 1.4 + r() * 2.2; // (long and thin, as real shape indices say)
    const a = Math.sqrt((A * k) / Math.PI), b = A / (Math.PI * a), ca = Math.cos(ang), sa = Math.sin(ang);
    const n = Math.max(1, Math.round(A / perTree));
    for (let i = 0; i < n && out.length < max; i++) {
      // (a ragged edge: points fill the ellipse more thinly towards it)
      const t = Math.sqrt(r()) * (0.75 + 0.25 * r()), th = r() * 2 * Math.PI, u = a * t * Math.cos(th), v = b * t * Math.sin(th);
      const p = { x: c.x + u * ca - v * sa, z: c.z + u * sa + v * ca };
      if (keep(p)) out.push(p);
    }
  }
  return out;
}

// How a road of this class should climb, from the real ones: the grade it keeps under most of the
// way (its 90th percentile, the generator's limit), and how directly it takes a slope (the share of
// the ground's steepest slope it climbs at: about half, so a road angles across the contours).
export type FollowClass = 'motorway' | 'primary' | 'a' | 'b' | 'minor' | 'local';
export function roadClimb(c: FollowClass, t = 0.5) {
  const f = PRIORS.follow[c] as { gradeP90: number | readonly number[]; gradeOverSlope: number | readonly number[]; aboveValleyM: number | readonly number[] };
  const v = (x: number | readonly number[]) => (typeof x === 'number' ? x : between(x, t));
  return { maxGrade: v(f.gradeP90), acrossSlope: v(f.gradeOverSlope), aboveValleyM: v(f.aboveValleyM) };
}
// How much a route of this class should prefer low ground: its height above the valley against the
// land's (0.3 for a motorway, which keeps to the valleys, near 1 for a lane).
export const valleyPreference = (c: FollowClass, t = 0.5) => roadClimb(c, t).aboveValleyM / between(PRIORS.follow.land.aboveValleyM, t);

// A coastline between two points, as rough as the real one: midpoint displacement with the
// roughness the measured fractal dimension gives (Hurst exponent 2 − D), down to `step` metres.
// For the terrain and sea work (claude/work-terrain-2): the sea's edge, bays and headlands.
export function fractalCoast(r: Rand, a: XZ, b: XZ, step = 25, D = PRIORS.coast.fractalDimension, amp = 0.18): XZ[] {
  const H = 2 - D;
  let pts: XZ[] = [a, b];
  let scale = amp * Math.hypot(b.x - a.x, b.z - a.z);
  while (Math.hypot(pts[1].x - pts[0].x, pts[1].z - pts[0].z) > step) {
    const next: XZ[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i], L = Math.hypot(q.x - p.x, q.z - p.z) || 1, d = gauss(r) * scale;
      next.push({ x: (p.x + q.x) / 2 - ((q.z - p.z) / L) * d, z: (p.z + q.z) / 2 + ((q.x - p.x) / L) * d }, q);
    }
    pts = next;
    scale *= 0.5 ** H;
  }
  return pts;
}
