// A settlement's kind and streets, as every place on the 50 km map is laid out (worldmap/plan.ts places
// the settlements, towns.ts and spec.ts lay their streets through `layStreets`, routes.ts joins them
// from `suggestLinks`):
//
//   KINDS               // how big a city, a town and a village is, and the road types of its streets
//   layStreets(s, mw, bound)   // net.build calls with catalogue road types (see apply.ts) for one settlement
//   suggestLinks(ss, mw)       // which places to join by A and B roads (a trimmed Gabriel graph)
//   reach(kind, r)             // how far a settlement's land reaches: its built-up area and industrial edge
//
// Pure: no three.js, no DOM, no Network. Plots, infill and buildings come from the game's own
// Network and buildgen once the streets are built (docs/region.md).
import { rng, range, pick, type Rand } from './random';
import { MapWater, type XZ } from '../worldmap/water';
import { GRID_PLAN, PRIORS } from './priors';

export type Kind = 'city' | 'town' | 'village';
export type Plan = 'grid' | 'organic';
export interface Settlement {
  id: number;
  name: string;
  kind: Kind;
  x: number; z: number; // the centre: where the high street and the main cross street meet
  r: number; // radius of the built-up area (the industrial edge lies beyond it)
  axis: number; // the high street's direction (radians from +x)
  plan: Plan;
  seed: number;
  gates: XZ[]; // the ends of the high street: where roads from other places should come in
  spokes?: Spoke[]; // every way out: the ends of the high street and the main cross street, with the way each faces
}
// A way out of a settlement: where one of its main streets reaches its edge, and the direction that
// street faces there (a unit vector, outward). A road from elsewhere comes in along it, straight,
// as real roads do (priors.ts PRIORS.exits: the roads out of a real place leave radially, through
// its main streets, and bend towards where they're going only once they're clear of it).
export interface Spoke extends XZ { ux: number; uz: number; along: 'high' | 'main' }
export type Role = 'high' | 'main' | 'street' | 'industrial';
// One street, as the game builds it: net.build(snap(a), snap(b), c, { type }).
export interface StreetCall { settlement: number; a: XZ; b: XZ; c?: XZ; type: string; role: Role }
// an industrial area: inside a polygon, or strictly inside a box (either may be given)
export interface ZoneRule { kind: 'industrial'; poly?: XZ[]; box?: { x0: number; z0: number; x1: number; z1: number }; settlement?: number }
export interface Link { a: number; b: number; length: number; road: 'A' | 'B'; water: boolean }
// How big each kind is, and how its streets are laid out. Today's town is about 250 m from its
// centre to its edge with an industrial estate beyond: a market town is that, the city twice it.
interface KindSpec { r: [number, number]; spacing: number; high: string[]; main: string; street: string[]; industrial: { width: number; rows: number } | null; grid: number }
export const KINDS: Record<Kind, KindSpec> = {
  city: { r: [440, 480], spacing: 90, high: ['boulevard-30-0-0', 'avenue'], main: 'arterial-1-30-0-0-2.2', street: ['street', 'street-30-2.4-2.2-0'], industrial: { width: 380, rows: 3 }, grid: GRID_PLAN.city },
  town: { r: [230, 270], spacing: 85, high: ['avenue', 'avenue'], main: 'street-30-2.4-2.2-0', street: ['street', 'street-20-2.4-0-0'], industrial: { width: 200, rows: 2 }, grid: GRID_PLAN.town },
  village: { r: [110, 160], spacing: 80, high: ['street-30-4-0-0', 'street-30-4-0-0'], main: 'street', street: ['street-20-2.4-0-0', 'street'], industrial: null, grid: GRID_PLAN.village },
};
const INDUSTRIAL_ROAD = 'arterial-1-40-0-0-0';
// how far a settlement's land reaches from its centre: the built-up area and its industrial edge
export const reach = (kind: Kind, r: number) => r + (KINDS[kind].industrial ? KINDS[kind].spacing * (KINDS[kind].industrial!.rows + 1) : 0) + 30;

// ---------------- streets ----------------
// A place grown along its roads, as real ones are (PRIORS.towns, measured from OS maps): its radials
// meet at the middle (the high street is one pair, running along `axis`; a village has 2–4, a town
// 4–6, a city 6–8, the next one 30° or more on); the houses run further out along the radials than
// between them, so the edge follows the roads, ragged; cross streets join neighbouring radials as
// T-junctions part way out; side streets and closes branch off every 60–80 m (a village's every
// 120 m), about one in five a close; the city and the towns have an industrial estate, a small grid
// of wide blocks, on one radial's outer end. Streets that would touch water or leave the map are
// dropped, then only what's joined to the centre is kept, and the calls come out in the order they're
// reached from there, each starting on a street already built: so every place is one connected piece.
interface LNode { x: number; z: number }
interface LEdge { a: LNode; b: LNode; role: Role; curve: number; type?: string }
const NODE = (n: Map<string, LNode>, x: number, z: number) => { const k = `${Math.round(x)},${Math.round(z)}`; let v = n.get(k); if (!v) n.set(k, (v = { x, z })); return v; };
const pickQ = (r: Rand, qsv: readonly number[]) => { // a draw between a prior's quartiles (the 25th to the 75th)
  return qsv[1] + (qsv[3] - qsv[1]) * r();
};
export function layStreets(s: Settlement, mw: MapWater, bound: number): { streets: StreetCall[]; zone: ZoneRule | null } {
  const K = KINDS[s.kind], S = K.spacing, r = rng(s.seed), organic = s.plan === 'organic';
  const T = s.kind === 'village' ? 'village' : 'town', P = PRIORS.towns;
  const nodes = new Map<string, LNode>(), edges: LEdge[] = [];
  const centre = NODE(nodes, s.x, s.z);
  const add = (a: LNode, b: LNode, role: Role, curve = 0, type?: string) => { if (a !== b) edges.push({ a, b, role, curve, type }); };
  // 1. the radials: the high street's two ways, then the rest spread round, none within `minGap` of another
  const nRad = s.kind === 'village' ? 2 + Math.floor(r() * 3) : s.kind === 'town' ? 4 + Math.floor(r() * 3) : 6 + Math.floor(r() * 3);
  const minGap = (s.kind === 'village' ? 40 : 28) * (Math.PI / 180), offHigh = 45 * (Math.PI / 180);
  const angles = [s.axis, s.axis + Math.PI];
  const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (let tries = 0; angles.length < nRad && tries < 80; tries++) {
    const a = range(r, 0, 2 * Math.PI);
    // (45° or more off the high street's line, so a radial's first piece never runs alongside it)
    if (angles.every((b, k) => apart(a, b) >= (k < 2 ? offHigh : minGap))) angles.push(a);
  }
  // how far the edge reaches along a radial (the ribbon) against between them (the built circle, r)
  const along = Math.max(1.05, pickQ(r, P.edgeAlongOverBetween[T]));
  // side streets and closes: how often they branch off a radial, how many are closes, how long they run
  const every = pickQ(r, [0, 1000 / P.sideStreetsPerKm[T][3], 1000 / P.sideStreetsPerKm[T][2], 1000 / P.sideStreetsPerKm[T][1], 0]);
  const closeShare = pickQ(r, P.closeShare[T]);
  const sideLen = () => Math.min(s.r * 0.6, Math.max(40, pickQ(r, P.sideStreetLengthM[T])));
  const closeLen = () => Math.min(s.r * 0.5, Math.max(40, pickQ(r, P.closeLengthM[T])));
  const grid = !organic;
  // where the line p→q meets u→v: how far along p→q (0..1), or -1 when they don't meet
  const meet = (p: LNode, q: LNode, u: LNode, v: LNode) => {
    const d = (q.x - p.x) * (v.z - u.z) - (q.z - p.z) * (v.x - u.x);
    if (Math.abs(d) < 1e-9) return -1;
    const t = ((u.x - p.x) * (v.z - u.z) - (u.z - p.z) * (v.x - u.x)) / d, w = ((u.x - p.x) * (q.z - p.z) - (u.z - p.z) * (q.x - p.x)) / d;
    return t > 0 && t < 1 && w > 0 && w < 1 ? t : -1;
  };
  interface Radial { angle: number; high: boolean; pts: LNode[]; dist: number[]; len: number; joins: number[] }
  const branchNodes = new Set<LNode>(); // (where a side street leaves a radial: no cross street joins there too)
  let side = 1;
  // the far ends of the through side streets, by radial and side: consecutive ones on the same side are
  // joined by a back street, so they end on a street (a T), as real ones do; closes end free
  const backs: LNode[][] = [];
  // (the others start on the high street a block or two off the middle, staggered either side, as
  // roads meet a market town's high street: T-junctions, not one great crossroads)
  const radials: Radial[] = [];
  const sideCount = [0, 0];
  const startFor = (i: number, angle: number, L: number): LNode => {
    if (i < 2) return centre;
    const w = Math.cos(angle - s.axis) >= 0 ? 0 : 1, H = radials[w], k0 = 1 + (sideCount[w]++ % 2);
    // (and from where its line crosses none of the radials laid before it: two mains meet at the
    // high street, not out in the houses)
    const clear = (n: LNode) => { const q = { x: n.x + Math.cos(angle) * L, z: n.z + Math.sin(angle) * L }; return !edges.some((e) => e.role !== 'street' && e.a !== n && e.b !== n && meet(n, q, e.a, e.b) >= 0); };
    for (let k = k0; k < H.pts.length; k++) if (!branchNodes.has(H.pts[k]) && H.dist[k] < s.r * 0.7 && clear(H.pts[k])) return H.pts[k];
    for (let k = k0; k < H.pts.length; k++) if (!branchNodes.has(H.pts[k]) && H.dist[k] < s.r * 0.7) return H.pts[k];
    return H.pts[Math.min(1, H.pts.length - 1)];
  };
  angles.forEach((angle, i) => {
    const high = i < 2, L = s.r * along * range(r, 0.85, 1.15) + (high ? S * 0.6 : 0);
    const start = startFor(i, angle, L);
    // the line: vertices a block or so apart, wandering a little
    const verts: { x: number; z: number; d: number; h: number }[] = [{ x: start.x, z: start.z, d: 0, h: angle }];
    let x = start.x, z = start.z, h = angle, run = 0;
    const bend = organic ? range(r, -0.05, 0.05) : 0;
    while (run < L - 20) {
      const step = Math.min(S * range(r, 0.8, 1.2), L - run);
      if (organic && !(high && run < 1.7 * S)) h += bend + range(r, -0.06, 0.06); // (the high street runs straight through the middle)
      x += Math.cos(h) * step; z += Math.sin(h) * step; run += step;
      verts.push({ x, z, d: run, h });
    }
    // where the side streets branch: every `every` metres from a block out, well short of the end
    const branches: number[] = [];
    // (a radial longer than a block always has one, even in the smallest village)
    for (let d = run > 1.2 * S ? Math.min(S * 0.6 + range(r, 0, every), run - 40) : run; d < run - 30; d += every * range(r, 0.7, 1.3)) branches.push(d);
    // the nodes along it: the vertices, the branch points and (on the high street) where the other
    // radials start, in order, none within 12 m of the last
    const marks: { d: number; branch: boolean; node?: LNode }[] = [...verts.map((v) => ({ d: v.d, branch: false })), ...branches.map((d) => ({ d, branch: true }))].sort((p, q) => p.d - q.d);
    const posAt = (d: number) => { let k = 1; while (k < verts.length - 1 && verts[k].d < d) k++; const a = verts[k - 1], b = verts[k], t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, h: b.h }; };
    const pts: LNode[] = [start], dist = [0], heads = [angle];
    const ends: Record<number, LNode[]> = { 1: [], [-1]: [] };
    for (const m of marks) {
      if (m.d <= 0 || (m.d - dist[dist.length - 1] < 12 && !m.node)) { if (m.branch && m.d - dist[dist.length - 1] < 12 && dist.length > 1) branchAt(pts[pts.length - 1], heads[heads.length - 1]); continue; }
      const q = posAt(m.d), n = m.node ?? NODE(nodes, q.x, q.z);
      if (n === pts[pts.length - 1]) continue;
      add(pts[pts.length - 1], n, high ? 'high' : 'main', 0);
      pts.push(n); dist.push(m.d); heads.push(q.h);
      if (m.branch) branchAt(n, q.h);
    }
    backs.push(ends[1], ends[-1]);
    radials.push({ angle, high, pts, dist, len: dist[dist.length - 1], joins: [] });
    function branchAt(from: LNode, hr: number) {
      const hs = hr + (side * Math.PI) / 2 + (grid ? 0 : range(r, -0.25, 0.25));
      const isClose = r() < closeShare, len = isClose ? closeLen() : sideLen();
      const to = NODE(nodes, from.x + Math.cos(hs) * len, from.z + Math.sin(hs) * len);
      add(from, to, 'street', organic && !isClose ? range(r, -0.1, 0.1) : 0);
      branchNodes.add(from);
      if (!isClose) ends[side].push(to);
      if (grid || r() > 0.25) side = -side;
    }
  });
  for (const list of backs) for (let k = 1; k < list.length; k++) {
    const a = list[k - 1], b = list[k], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L >= 40 && L <= 3 * S) add(a, b, 'street', organic ? range(r, -0.1, 0.1) : 0);
  }
  const at = (R: Radial, d: number, k0 = 0): LNode => { // the radial's node nearest `d` out from the centre (`k0`: one further out), not a branch point
    let best = 0, bd = Infinity;
    for (let k = 1; k < R.pts.length; k++) { if (branchNodes.has(R.pts[k])) continue; const e = Math.abs(R.dist[k] - d); if (e < bd) { bd = e; best = k; } }
    for (let k = best + k0; k < R.pts.length; k++) if (!branchNodes.has(R.pts[k])) return R.pts[k];
    return R.pts[best];
  };
  // 2. cross streets between neighbouring radials, part way out (each a T on both radials, offset so
  // the two never line up across a radial as a crossroads)
  const byAngle = [...radials].sort((p, q) => norm2(p.angle) - norm2(q.angle));
  const rings = s.kind === 'village' ? [0.6] : s.kind === 'town' ? [0.45, 0.8] : [0.35, 0.6, 0.85];
  for (let i = 0; i < byAngle.length && byAngle.length > 2; i++) {
    const A = byAngle[i], B = byAngle[(i + 1) % byAngle.length];
    let gap = norm2(B.angle) - norm2(A.angle); if (gap <= 0) gap += 2 * Math.PI;
    if (gap < 0.6 || gap > 2.6) continue; // (too narrow a wedge for a street between, or the far side of a linear place)
    rings.forEach((f, ri) => {
      // (on a radial, the wedge on each side takes a different node at each ring: a T each, never a crossroads)
      const d = s.r * f, a = at(A, d * range(r, 0.9, 1.1), (A.joins[ri] ?? 0) % 2), b = at(B, d * range(r, 0.9, 1.1), (B.joins[ri] ?? 0) % 2);
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 50 || L > 4 * S || a === centre || b === centre || a === b) return;
      // (clear of the streets already laid: no end of another street within 30 m of its line, but its own)
      const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const near = (q: LNode) => { if (q === a || q === b) return false; const t = (q.x - a.x) * ux + (q.z - a.z) * uz; if (t < -5 || t > L + 5) return false; return Math.abs(-(q.x - a.x) * uz + (q.z - a.z) * ux) < 30; };
      if (edges.some((e) => near(e.a) || near(e.b))) return;
      add(a, b, 'street', organic ? range(r, -0.12, 0.12) : 0);
      A.joins[ri] = (A.joins[ri] ?? 0) + 1; B.joins[ri] = (B.joins[ri] ?? 0) + 1;
    });
  }
  // keep off water and the map's edge (the whole road band, with the water's gap for the bank)
  const pathOf = (e: LEdge) => { const A: XZ = { x: e.a.x, z: e.a.z }, B: XZ = { x: e.b.x, z: e.b.z }; return { A, B, c: e.curve ? ctrlOf(A, B, e.curve) : undefined }; };
  const dry = (e: LEdge) => {
    const { A, B, c } = pathOf(e), L = Math.hypot(B.x - A.x, B.z - A.z), n = Math.max(1, Math.ceil(L / 5));
    for (let k = 0; k <= n; k++) {
      const t = k / n, p = c ? quad(A, c, B, t) : { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t };
      if (Math.abs(p.x) > bound - 60 || Math.abs(p.z) > bound - 60) return false;
      if (mw.edgeDistance(p, 60) < 30) return false; // (a road's band, the 9.5 m bank gap and room for plots)
    }
    return true;
  };
  // 4. the industrial estate (city and towns): a small grid of wide blocks beside one radial's outer
  // end, its way in a T off the radial, its rows running along the radial, as estates sit on the main
  // road out of a market town
  let zone: ZoneRule | null = null;
  const tryEstate = (R: Radial): boolean => {
    const W = K.industrial!.width, rows = K.industrial!.rows, cols = Math.max(1, Math.round(W / (2 * S)));
    // (its frame: the radial's node a little short of the houses' end, and the radial's line there;
    // the side the rest of the town's streets leave clear, else the other)
    const base = at(R, s.r * 0.9), bi = R.pts.indexOf(base), prevN = R.pts[Math.max(0, bi - 1)];
    if (base === centre || bi < 1) return false;
    const hd = Math.atan2(base.z - prevN.z, base.x - prevN.x), vx = Math.cos(hd), vz = Math.sin(hd);
    const sides = r() < 0.5 ? [1, -1] : [-1, 1];
    for (const sg of sides) {
      const made: LEdge[] = [];
      const addE = (a: LNode, b: LNode, type?: string) => { if (a !== b) made.push({ a, b, role: 'industrial', curve: 0, type }); };
      const ux = -vz * sg, uz = vx * sg;
      const world = (u: number, v: number): XZ => ({ x: base.x + ux * u + vx * v, z: base.z + uz * u + vz * v });
      // the way in, square off the radial, then the rows along it and the links between them
      addE(base, NODE(nodes, world(S, 0).x, world(S, 0).z), INDUSTRIAL_ROAD);
      for (let j = 1; j <= rows + 1; j++) for (let c = -cols; c < cols; c++) {
        const a = NODE(nodes, world(j * S, c * 2 * S).x, world(j * S, c * 2 * S).z), b = NODE(nodes, world(j * S, (c + 1) * 2 * S).x, world(j * S, (c + 1) * 2 * S).z);
        addE(a, b);
        // (the links between the rows: on alternate columns row by row, never straight across a row)
        if (j <= rows && (c + j) % 2 === 0 && c !== 0) addE(a, NODE(nodes, world((j + 1) * S, c * 2 * S).x, world((j + 1) * S, c * 2 * S).z));
      }
      // (it must cross no other main street, its way in must be dry, and most of it: what's wet is left out)
      if (made.some((e) => edges.some((f) => f.role !== 'street' && f.a !== e.a && f.b !== e.a && f.a !== e.b && f.b !== e.b && meet(e.a, e.b, f.a, f.b) >= 0))) continue;
      if (!dry(made[0]) || made.filter(dry).length < made.length * 0.6) continue;
      // (the radial's side streets on that side, alongside the estate, make way for it)
      const span = cols * 2 * S + S;
      for (let k = edges.length - 1; k >= 0; k--) {
        const e = edges[k];
        if (e.role !== 'street' || !R.pts.includes(e.a)) continue;
        const d = R.dist[R.pts.indexOf(e.a)] - R.dist[bi];
        if (Math.abs(d) <= span && (e.b.x - e.a.x) * ux + (e.b.z - e.a.z) * uz > 0) edges.splice(k, 1);
      }
      edges.push(...made);
      const v0 = -cols * 2 * S - S * 0.55, v1 = cols * 2 * S + S * 0.55, u0 = S * 0.5, u1 = (rows + 1) * S + S * 0.75;
      zone = { kind: 'industrial', settlement: s.id, poly: [world(u0, v0), world(u1, v0), world(u1, v1), world(u0, v1)] };
      return true;
    }
    return false;
  };
  if (K.industrial) {
    const want = s.axis + Math.PI / 2, off = (q: Radial) => Math.abs(Math.atan2(Math.sin(q.angle - want), Math.cos(q.angle - want)));
    for (const R of [...radials].sort((a, b) => off(a) - off(b))) if (R.len > s.r * 0.8 && tryEstate(R)) break;
  }
  // 5. no street crosses another: a side, back or cross street that meets a radial (or the estate)
  // ends on it, a T (the network splits the road there); one that would cross another street, meet
  // a road too flat to make a junction, or pass within 25 m of a node not its own, is left out
  const trunk = edges.filter((e) => e.role !== 'street'), laid: LEdge[] = [...trunk];
  for (const e of edges) {
    if (e.role !== 'street') continue;
    let t0 = 1, hit: LEdge | undefined;
    for (const f of trunk) { if (f.a === e.a || f.b === e.a || f.a === e.b || f.b === e.b) continue; const t = meet(e.a, e.b, f.a, f.b); if (t >= 0 && t < t0) { t0 = t; hit = f; } }
    let b = e.b;
    if (hit) {
      const L0 = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z), Lf = Math.hypot(hit.b.x - hit.a.x, hit.b.z - hit.a.z);
      const sin = Math.abs(((e.b.x - e.a.x) * (hit.b.z - hit.a.z) - (e.b.z - e.a.z) * (hit.b.x - hit.a.x)) / (L0 * Lf));
      if (sin < 0.35 || L0 * t0 < 40) continue;
      b = NODE(nodes, e.a.x + (e.b.x - e.a.x) * t0, e.a.z + (e.b.z - e.a.z) * t0);
    }
    const L = Math.hypot(b.x - e.a.x, b.z - e.a.z), ux = (b.x - e.a.x) / L, uz = (b.z - e.a.z) / L;
    if (laid.some((f) => f.role === 'street' && f.a !== e.a && f.b !== e.a && f.a !== b && f.b !== b && meet(e.a, b, f.a, f.b) >= 0)) continue;
    const tooNear = (q: LNode) => { if (q === e.a || q === b) return false; const t = (q.x - e.a.x) * ux + (q.z - e.a.z) * uz; return t > 15 && t < L + 15 && Math.abs(-(q.x - e.a.x) * uz + (q.z - e.a.z) * ux) < 25; };
    if (laid.some((f) => tooNear(f.a) || tooNear(f.b))) continue;
    laid.push(b === e.b ? e : { ...e, b, curve: 0 });
  }
  edges.length = 0; edges.push(...laid);
  const kept = edges.filter(dry);
  // only what's joined to the centre, in the order it's reached from there
  const order = reachOrder(kept, centre);
  const high = pick(r, [K.high[0], K.high[1]]);
  const streetType = () => (organic ? K.street[r() < 0.5 ? 1 : 0] : K.street[0]);
  const streets: StreetCall[] = order.map(({ e, from }) => {
    const { A, B, c } = pathOf(e), fwd = from === e.a;
    const far = Math.max(Math.hypot(A.x - s.x, A.z - s.z), Math.hypot(B.x - s.x, B.z - s.z));
    // the city's boulevard only through its centre, then an avenue; a radial is its main type near the
    // middle and a street further out
    const type = e.type ?? (e.role === 'high' ? (s.kind === 'city' && far > 2.5 * S ? 'avenue' : high) : e.role === 'main' ? (far > s.r * 0.9 ? K.street[0] : K.main) : e.role === 'industrial' ? 'street' : streetType());
    return { settlement: s.id, a: fwd ? A : B, b: fwd ? B : A, c, type, role: e.role };
  });
  // the ways out: each radial's end, facing out along it; the gates are the high street's two
  const reached = new Set<LNode>(); for (const { e } of order) { reached.add(e.a); reached.add(e.b); }
  const spokes: Spoke[] = [];
  for (const R of radials) {
    let k = R.pts.length - 1;
    while (k > 1 && !reached.has(R.pts[k])) k--; // (a radial cut short by water ends where it got to)
    if (k < 1 || !reached.has(R.pts[k])) continue;
    const end = R.pts[k], o = R.pts[k - 1], dl = Math.hypot(end.x - o.x, end.z - o.z);
    if (dl < 1) continue;
    spokes.push({ x: end.x, z: end.z, ux: (end.x - o.x) / dl, uz: (end.z - o.z) / dl, along: R.high ? 'high' : 'main' });
  }
  s.spokes = spokes;
  const hs = spokes.filter((k) => k.along === 'high');
  s.gates = hs.map(({ x, z }) => ({ x, z }));
  return { streets, zone };
}
const norm2 = (a: number) => { a %= 2 * Math.PI; if (a < 0) a += 2 * Math.PI; return a; };
// a curve's control point: off the middle, square to the chord, by `k` of its length
function ctrlOf(A: XZ, B: XZ, k: number): XZ {
  const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, dx = B.x - A.x, dz = B.z - A.z;
  return { x: mx - dz * k, z: mz + dx * k };
}
const quad = (a: XZ, c: XZ, b: XZ, t: number): XZ => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, z: (1 - t) * (1 - t) * a.z + 2 * (1 - t) * t * c.z + t * t * b.z });

function adjacency(edges: LEdge[]) {
  const adj = new Map<LNode, LEdge[]>();
  for (const e of edges) for (const x of [e.a, e.b]) { let l = adj.get(x); if (!l) adj.set(x, (l = [])); l.push(e); }
  return adj;
}
const rank = (e: LEdge) => (e.role === 'high' ? 0 : e.role === 'main' ? 1 : 2);
// every edge joined to the root, each with the end it's reached from (already built when it's laid):
// nearest the centre first, by distance along the streets, a side street counting half as long again
// as a radial, so a radial's pieces are reached along the radial (a refused side street then never
// leaves the rest of the radial with nothing to start on)
function reachOrder(edges: LEdge[], root: LNode) {
  const adj = adjacency(edges), best = new Map<LNode, number>([[root, 0]]), done = new Set<LEdge>(), out: { e: LEdge; from: LNode }[] = [];
  const open: { n: LNode; d: number }[] = [{ n: root, d: 0 }], closed = new Set<LNode>();
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
    const { n: x, d } = open.splice(bi, 1)[0];
    if (closed.has(x)) continue;
    closed.add(x);
    for (const e of [...(adj.get(x) ?? [])].sort((p, q) => rank(p) - rank(q))) {
      if (done.has(e)) continue;
      done.add(e);
      out.push({ e, from: x });
      const y = e.a === x ? e.b : e.a, nd = d + Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z) * (e.role === 'street' ? 1.5 : 1);
      if (nd < (best.get(y) ?? Infinity)) { best.set(y, nd); open.push({ n: y, d: nd }); }
    }
  }
  return out;
}

// ---------------- links ----------------
// Suggested links for the roads and railways between places, in two tiers:
//   - A roads join the city and the towns: the Gabriel graph of their centres (a link is kept when
//     no other of them lies inside the circle it's the diameter of);
//   - B roads bring each village in: the Gabriel graph of every centre, the links with a village at
//     one end, trimmed to each village's two shortest, plus whatever keeps everywhere reachable.
// `water` says the straight line crosses water (a bridge is needed, or a way round).
export function suggestLinks(ss: Settlement[], mw: MapWater): Link[] {
  const d = (a: Settlement, b: Settlement) => Math.hypot(a.x - b.x, a.z - b.z);
  const gabriel = (set: Settlement[]) => {
    const out: [Settlement, Settlement][] = [];
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
      const a = set[i], b = set[j], m = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, R = d(a, b) / 2;
      if (!set.some((c) => c !== a && c !== b && Math.hypot(c.x - m.x, c.z - m.z) < R)) out.push([a, b]);
    }
    return out.sort((p, q) => d(...p) - d(...q));
  };
  const major = gabriel(ss.filter((s) => s.kind !== 'village'));
  const all = gabriel(ss).filter(([a, b]) => a.kind === 'village' || b.kind === 'village');
  const keep: [Settlement, Settlement][] = [...major];
  const count = new Map<number, number>();
  for (const e of all) {
    const v = e.filter((x) => x.kind === 'village');
    if (v.some((x) => (count.get(x.id) ?? 0) < 2)) { keep.push(e); for (const x of v) count.set(x.id, (count.get(x.id) ?? 0) + 1); }
  }
  // (and whatever joins up pieces the trimming left apart: Kruskal over the rest, shortest first)
  const parent = ss.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of keep) parent[find(a.id)] = find(b.id);
  for (const e of gabriel(ss)) { const x = find(e[0].id), y = find(e[1].id); if (x !== y && !keep.includes(e)) { parent[x] = y; keep.push(e); } }
  return keep.map(([a, b]) => {
    let wet = false;
    const L = d(a, b);
    for (let t = 0; t <= L && !wet; t += 10) wet = mw.edgeDistance({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L }, 50) < 0;
    return { a: a.id, b: b.id, length: Math.round(L), road: a.kind === 'village' || b.kind === 'village' ? 'B' : 'A', water: wet };
  });
}
