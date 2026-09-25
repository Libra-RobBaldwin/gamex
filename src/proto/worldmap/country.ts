// The country as scenery, a tile at a time (docs/streaming.md, "Per-tile generators": country):
// the ground's cover (fields and their crops, woods, rough grass, gardens, verges, wet grass by the
// water), the trees in the woods, hedgerows, and farmsteads. It's the game's own ground (ground/:
// the world-anchored field layout and the cover painter), fed from the plan instead of the Network,
// so the fields run on seamlessly into the live play area and across every tile border: a field is
// a field of the world, not of a tile.
//
// The countryside session (claude/work-country) owns how fields, hedges and woods are laid out;
// this is where a tile asks for them (`countryInput`, `paintCover`, `woodTrees`, `farms`, `hedges`).
// Pure: no three.js.
import { CoverMap } from '../ground/paint';
import { Layout, STRAIGHT_FIELDS, setParcelStyle, type GroundInput } from '../ground/layout';
import { Occupancy, planHedges, type HedgeTree, type Piece } from '../ground/hedgerows';
import { hash2 } from '../ground/noise';
import { lakeRadiusOf, type XZ } from '../region/water';
import { ROUTE_HALF } from './routes';
import { rectPoly, settlementScene, type SceneBuilding, type ScenePlot } from './towns';
import type { WorldPlan } from './plan';

export interface Box { x0: number; z0: number; x1: number; z1: number }
// The fields' layout for a 50 km map: its own seed, with straight-edged, near-square fields (the
// live area's ground uses the same: main.ts GameGround), set up wherever this module loads (the
// main thread and the workers alike).
export const GROUND_SEED = 12;
setParcelStyle(GROUND_SEED, STRAIGHT_FIELDS);

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
  const farms = fine ? farmsIn(plan, B) : [];
  for (const f of farms) if (f.kind === 'farm') plots.push({ poly: rectPoly(f.x, f.z, 46, 40, f.rot), kind: 'yard' });
  return { seed: GROUND_SEED, blocked, lanes, plots, water, town, industrial, farms };
}

// Paint a tile's cover (the ground's RGBA cover map: ground/covers.ts) at `texel` metres.
export function paintCover(input: GroundInput, box: Box, texel: number) {
  const size = box.x1 - box.x0, n = Math.round(size / texel);
  const layout = new Layout(input);
  const cover = new CoverMap({ x0: box.x0, z0: box.z0, size, n });
  cover.paint(layout);
  return { layout, data: cover.a, n };
}

// The trees in the woods: a jittered grid over the tile, a tree wherever it lands inside a wood,
// clear of its edge. x, z, scale, kind (0 broadleaf, 1 conifer) per tree.
export function woodTrees(layout: Layout, box: Box, spacing: number, pines: number, seed: number): Float32Array {
  const out: number[] = [], h = { id: 0, cell: layout.parcels.cell(0, 0), edge: 0 };
  for (let x = box.x0 + spacing / 2; x < box.x1; x += spacing) for (let z = box.z0 + spacing / 2; z < box.z1; z += spacing) {
    const i = Math.round(x / spacing), j = Math.round(z / spacing);
    const px = x + (hash2(i, j, seed + 1) - 0.5) * spacing * 0.9, pz = z + (hash2(i, j, seed + 2) - 0.5) * spacing * 0.9;
    layout.parcels.hit(px, pz, h);
    if (h.edge < 2.5 || layout.about(h).kind !== 'wood') continue;
    out.push(px, pz, 0.8 + hash2(i, j, seed + 3) * 0.7, hash2(i, j, seed + 4) < pines ? 1 : 0);
  }
  return new Float32Array(out);
}

// Farmsteads: in about a third of the 700 m squares of open country (away from the places and the
// water), a farmhouse and two or three barns round a yard, facing the same way.
export function farmsIn(plan: WorldPlan, box: Box): SceneBuilding[] {
  const C = 700, out: SceneBuilding[] = [], seed = plan.seed;
  for (let i = Math.floor(box.x0 / C); i <= Math.floor(box.x1 / C); i++) for (let j = Math.floor(box.z0 / C); j <= Math.floor(box.z1 / C); j++) {
    if (hash2(i, j, seed + 501) > 0.36) continue;
    const x = (i + 0.2 + hash2(i, j, seed + 502) * 0.6) * C, z = (j + 0.2 + hash2(i, j, seed + 503) * 0.6) * C;
    if (x < box.x0 || x >= box.x1 || z < box.z0 || z >= box.z1) continue;
    if (Math.abs(x) > plan.half - 300 || Math.abs(z) > plan.half - 300) continue;
    if (plan.grid.near(x, z).some((s) => Math.hypot(x - s.x, z - s.z) < s.reach + 250)) continue;
    if (plan.water.edgeDistance({ x, z }, 120) < 90) continue;
    if (nearRoute(plan, x, z, 45)) continue;
    const rot = hash2(i, j, seed + 504) * Math.PI, co = Math.cos(rot), si = Math.sin(rot);
    const at = (u: number, v: number) => ({ x: x + u * co - v * si, z: z + u * si + v * co });
    const walls = [0, 1, 7, 5], roofs = [2, 3, 0];
    const house = at(-12, -8);
    out.push({ ...house, w: 11, d: 8, rot, h: 5.6, ridge: 3.2, wall: walls[Math.floor(hash2(i, j, seed + 505) * 4)], roof: roofs[Math.floor(hash2(i, j, seed + 506) * 3)], kind: 'farm', settlement: -1 });
    const b1 = at(9, -6), b2 = at(8, 12);
    out.push({ ...b1, w: 24, d: 13, rot, h: 6.5, ridge: 2.4, wall: 13, roof: hash2(i, j, seed + 507) < 0.5 ? 5 : 8, kind: 'barn', settlement: -1 });
    out.push({ ...b2, w: 18, d: 11, rot: rot + Math.PI / 2, h: 5, ridge: 2, wall: 9, roof: 6, kind: 'barn', settlement: -1 });
    if (hash2(i, j, seed + 508) < 0.5) { const b3 = at(-10, 12); out.push({ ...b3, w: 12, d: 9, rot, h: 4.2, ridge: 1.6, wall: 1, roof: 4, kind: 'barn', settlement: -1 }); }
  }
  return out;
}
function nearRoute(plan: WorldPlan, x: number, z: number, m: number) {
  for (const r of [...plan.roads, ...plan.rails]) {
    const P = r.path;
    for (let i = 0; i < P.length; i += 4) if (Math.abs(P[i].x - x) < m + 100 && Math.abs(P[i].z - z) < m + 100) {
      for (let k = Math.max(0, i - 4); k < Math.min(P.length, i + 5); k++) if (Math.hypot(P[k].x - x, P[k].z - z) < m) return true;
    }
  }
  return false;
}

// Hedgerows for a near tile: the ground's own planner, over the tile (pieces whose middles are in it).
export function hedges(layout: Layout, input: GroundInput, box: Box): { pieces: Piece[]; trees: HedgeTree[] } {
  const occ = new Occupancy(input), pieces: Piece[] = [], trees: HedgeTree[] = [];
  const inside = (p: XZ) => p.x >= box.x0 && p.x < box.x1 && p.z >= box.z0 && p.z < box.z1;
  for (const g of planHedges(layout, box, occ, true, null)) { for (const p of g.pieces) if (inside(p)) pieces.push(p); for (const t of g.trees) if (inside(t)) trees.push(t); }
  return { pieces, trees };
}
