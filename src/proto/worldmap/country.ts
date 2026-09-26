// The country as scenery, a tile at a time (docs/streaming.md, "Per-tile generators": country):
// the ground's cover (fields and their crops, woods, rough grass, gardens, verges, wet grass by the
// water), the trees in the woods, hedgerows, and farmsteads. It's the game's own ground (ground/:
// the world-anchored field layout and the cover painter), fed from the plan instead of the Network,
// so the fields run on seamlessly into the live play area and across every tile border: a field is
// a field of the world, not of a tile.
//
// The fields are the countryside's farm blocks (region/fields.ts), laid out a block at a time from
// the plan (its roads, rivers, hills and places: `countryFor`), so a tile, the worker and the live
// area's ground all agree. This is where a tile asks for them (`countryInput`, `paintCover`,
// `woodTrees`, `canopyIn`, `farmsIn`, `hedges`). Owned by the countryside session. Pure: no three.js.
import { CoverMap } from '../ground/paint';
import { Layout, type GroundInput } from '../ground/layout';
import { Countryside, type CountryInput } from '../region/fields';
import { canopy, fringe, type CanopyArrays, type CoverData } from '../ground/canopy';
import { farmTrack, farmYard } from '../ground/farms';
import { Occupancy, planHedges, type HedgeTree, type Piece } from '../ground/hedgerows';
import { hash2 } from '../ground/noise';
import { lakeRadiusOf, type XZ } from '../region/water';
import { ROUTE_HALF } from './routes';
import { STYLE_LOOKS } from '../region/styles';
import { settlementScene, type SceneBuilding, type ScenePlot } from './towns';
import type { WorldPlan } from './plan';

export interface Box { x0: number; z0: number; x1: number; z1: number }
// The fields' seed for a 50 km map (the live area's ground uses the same: main.ts GameGround).
export const GROUND_SEED = 12;

// The map's fields, woods and farms: farm blocks that follow its roads, rivers and contours, laid
// out lazily (region/fields.ts). One per plan, on the main thread and in each worker alike, and the
// same everywhere, as it depends only on the plan.
const sources = new WeakMap<WorldPlan, Countryside>();
export function countryFor(plan: WorldPlan): Countryside {
  let c = sources.get(plan);
  if (!c) sources.set(plan, (c = new Countryside(countryInputOf(plan))));
  return c;
}
// what the map's countryside is laid out from (its roads, rivers, hills and places)
export function countryInputOf(plan: WorldPlan): CountryInput {
  const H = plan.half, heightAt = plan.terrain.heightAt;
  // (the land's heights, from a kilometre grid: what counts as its high ground is the top of them,
  // whatever the map's lie: a plateau cut by valleys as much as a plain with a few hills)
  const land: number[] = [];
  for (let x = -H + 500; x < H; x += 1000) for (let z = -H + 500; z < H; z += 1000) if (!plan.water.wet({ x, z }, 0)) land.push(heightAt(x, z));
  land.sort((a, b) => a - b);
  const hMax = land.length ? land[land.length - 1] : 0, flat = !land.length || hMax - land[0] < 35;
  const heightRank = (h: number) => {
    if (flat) return 0;
    let lo = 0, hi = land.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (land[m] < h) lo = m + 1; else hi = m; }
    return lo / land.length;
  };
  const look = STYLE_LOOKS[plan.options.style];
  return {
    seed: GROUND_SEED,
    bounds: { x0: -H, z0: -H, x1: H, z1: H },
    settlements: plan.settlements.map((s) => ({ x: s.x, z: s.z, r: s.r, reach: s.reach, kind: s.kind })),
    lanes: [...plan.roads.map((r) => r.path), ...plan.rails.map((r) => r.path)],
    farmLanes: plan.roads.filter((r) => r.kind !== 'motorway').map((r) => r.path),
    rivers: plan.water.world.rivers.map((r) => r.path),
    waterDist: (x, z) => plan.water.edgeDistance({ x, z }, 400),
    heightAt,
    hMax,
    heightRank,
    woods: look.trees.density * (plan.options.woods >= 0 ? plan.options.woods / 50 : 1), // (the setup's woods: 50 as the style has them)
    pines: look.trees.pines,
  };
}

// A band round a centre line, as a polygon (left side out, right side back).
export function bandPoly(path: XZ[], half: number): XZ[] {
  const L: XZ[] = [], R: XZ[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / d, nz = (b.x - a.x) / d;
    L.push({ x: path[i].x + nx * half, z: path[i].z + nz * half });
    R.push({ x: path[i].x - nx * half, z: path[i].z - nz * half });
  }
  return [...L, ...R.reverse()];
}
// the runs of a path inside a box (each run with a point either side, so bands reach the edges)
export function clipPath(path: XZ[], b: Box): XZ[][] {
  const out: XZ[][] = [];
  let run: XZ[] = [];
  const inside = (p: XZ) => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;
  for (let i = 0; i < path.length; i++) {
    if (inside(path[i])) { if (!run.length && i > 0) run.push(path[i - 1]); run.push(path[i]); }
    else if (run.length) { run.push(path[i]); out.push(run); run = []; }
  }
  if (run.length > 1) out.push(run);
  return out;
}
const meets = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;
const boxOfPoly = (p: XZ[]): Box => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of p) { if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x; if (q.z < z0) z0 = q.z; if (q.z > z1) z1 = q.z; } return { x0, z0, x1, z1 }; };

// Everything the ground painter needs to know about a box of the world (with `fine`, the plots
// and streets of the places in it; without, only where they are: a far tile's).
export function countryInput(plan: WorldPlan, box: Box, fine: boolean, skip: (settlement: number) => boolean = () => false): GroundInput & { farms: SceneBuilding[] } {
  const blocked: XZ[][] = [], lanes: GroundInput['lanes'] = [], plots: GroundInput['plots'] = [], water: XZ[][] = [], town: XZ[] = [], industrial: XZ[] = [];
  const pad = 80, B = { x0: box.x0 - pad, z0: box.z0 - pad, x1: box.x1 + pad, z1: box.z1 + pad };
  // places
  for (const s of plan.grid.inBox(B)) {
    if (skip(s.id)) continue;
    if (fine) {
      const sc = settlementScene(plan, s);
      for (const st of sc.streets) { const bp = bandPoly(st.path, st.half); if (meets(boxOfPoly(bp), B)) blocked.push(bp); }
      for (const p of sc.plots as ScenePlot[]) if (meets(boxOfPoly(p.poly), B)) plots.push({ poly: p.poly, kind: p.kind });
    } else {
      // (far: the built-up area marked as town, on a 60 m grid)
      for (let x = s.x - s.r; x <= s.x + s.r; x += 60) for (let z = s.z - s.r; z <= s.z + s.r; z += 60) if (Math.hypot(x - s.x, z - s.z) < s.r * 0.95 && x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1) town.push({ x, z });
    }
  }
  // the trunk routes: their footprint is verge, and the country ones have hedges either side
  for (const r of plan.roads) for (const run of clipPath(r.path, B)) {
    blocked.push(bandPoly(run, ROUTE_HALF[r.kind]));
    if (r.kind !== 'motorway') lanes.push({ path: run, half: ROUTE_HALF[r.kind] + 1.5 });
  }
  for (const r of plan.rails) for (const run of clipPath(r.path, B)) { blocked.push(bandPoly(run, ROUTE_HALF.rail)); lanes.push({ path: run, half: ROUTE_HALF.rail + 2 }); }
  // water: lakes' outlines, rivers' banks, the sea
  for (const L of plan.water.spec.lakes) {
    if (!meets({ x0: L.x - L.r * 1.3, z0: L.z - L.r * 1.3, x1: L.x + L.r * 1.3, z1: L.z + L.r * 1.3 }, B)) continue;
    const poly: XZ[] = [];
    for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2, rr = lakeRadiusOf(L, a) + 4; poly.push({ x: L.x + Math.cos(a) * rr, z: L.z + Math.sin(a) * rr }); }
    water.push(poly);
  }
  for (const rv of plan.water.world.rivers) for (const run of clipPath(rv.path, B)) { const w = plan.water.riverWidth(run[Math.floor(run.length / 2)].x, run[Math.floor(run.length / 2)].z); water.push(bandPoly(run, w / 2 + 3)); }
  const sea = plan.water.world.sea;
  if (sea) for (const run of clipPath(sea.coast, { x0: B.x0 - 400, z0: B.z0 - 400, x1: B.x1 + 400, z1: B.z1 + 400 })) {
    // (the coast, closed round the sea side of the box)
    const far = 4000, off = sea.side === 's' ? { x: 0, z: far } : sea.side === 'n' ? { x: 0, z: -far } : sea.side === 'e' ? { x: far, z: 0 } : { x: -far, z: 0 };
    water.push([...run, ...[...run].reverse().map((p) => ({ x: p.x + off.x, z: p.z + off.z }))]);
  }
  // farmsteads: their yards worn, their tracks to the road
  const farms = fine ? farmsIn(plan, B) : [];
  if (fine) for (const f of countryFor(plan).farmsNear(B)) { plots.push({ poly: farmYard(f), kind: 'yard' }); const t = farmTrack(f); if (t) plots.push({ poly: t, kind: 'track' }); }
  return { seed: GROUND_SEED, blocked, lanes, plots, water, town, industrial, farms };
}

// Paint a tile's cover (the ground's RGBA cover map: ground/covers.ts) at `texel` metres.
export function paintCover(plan: WorldPlan, input: GroundInput, box: Box, texel: number) {
  const size = box.x1 - box.x0, n = Math.round(size / texel);
  const layout = new Layout(input, countryFor(plan));
  const cover = new CoverMap({ x0: box.x0, z0: box.z0, size, n });
  cover.paint(layout);
  return { layout, data: cover.a, n };
}

// The trees in the woods: along their edges, where they stand out of the canopy (`canopyIn`), and a
// few inside it. x, z, scale, kind (0 broadleaf, 1 conifer) per tree.
export function woodTrees(layout: Layout, cover: CoverData, box: Box, spacing: number): Float32Array {
  return fringe(layout, cover, box, spacing);
}
// The woods' canopy over a tile, on a grid fine enough for its detail (ground/canopy.ts)
export function canopyIn(plan: WorldPlan, layout: Layout, cover: CoverData, box: Box, g: number, own: (p: XZ) => boolean): CanopyArrays | null {
  const look = STYLE_LOOKS[plan.options.style];
  return canopy(layout, cover, box, g, { broadleaf: look.trees.crown, conifer: look.trees.pine }, own);
}

// Farmsteads (the countryside's: region/fields.ts, a block at a time): a farmhouse, a barn and a
// shed round a yard, beside a road or down a track to one.
export function farmsIn(plan: WorldPlan, box: Box): SceneBuilding[] {
  const out: SceneBuilding[] = [];
  for (const f of countryFor(plan).farmsNear(box)) {
    if (f.x < box.x0 || f.x >= box.x1 || f.z < box.z0 || f.z >= box.z1) continue;
    const ux = Math.cos(f.a), uz = Math.sin(f.a), vx = -uz * f.side, vz = ux * f.side, rot = f.a;
    const at = (u: number, v: number) => ({ x: f.x + u * ux + v * vx, z: f.z + u * uz + v * vz });
    const r = (k: number) => hash2(f.seed & 0xffff, f.seed >>> 16, k), m = r(1) < 0.5 ? 1 : -1;
    const walls = [0, 1, 7, 5], roofs = [2, 3, 0];
    out.push({ ...at(-12 * m, -7), w: 10 + r(2) * 3, d: 7.5, rot, h: 5.6, ridge: 3.1, wall: walls[Math.floor(r(3) * 4)], roof: roofs[Math.floor(r(4) * 3)], kind: 'farm', settlement: -1 });
    out.push({ ...at(9 * m, 5), w: 22 + r(5) * 8, d: 12 + r(6) * 3, rot, h: 6.3, ridge: 2.6, wall: 13, roof: r(7) < 0.5 ? 5 : 8, kind: 'barn', settlement: -1 });
    if (r(11) >= 0.3) out.push({ ...at(-8 * m, 13), w: 14 + r(9) * 6, d: 7, rot, h: 4.2, ridge: 1.4, wall: 9, roof: 6, kind: 'barn', settlement: -1 });
  }
  return out;
}
// Hedgerows for a near tile: the ground's own planner, over the tile (pieces whose middles are in it).
export function hedges(layout: Layout, input: GroundInput, box: Box): { pieces: Piece[]; trees: HedgeTree[] } {
  const occ = new Occupancy(input), pieces: Piece[] = [], trees: HedgeTree[] = [];
  const inside = (p: XZ) => p.x >= box.x0 && p.x < box.x1 && p.z >= box.z0 && p.z < box.z1;
  for (const g of planHedges(layout, box, occ, true, null)) { for (const p of g.pieces) if (inside(p)) pieces.push(p); for (const t of g.trees) if (inside(t)) trees.push(t); }
  return { pieces, trees };
}
