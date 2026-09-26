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
import { rng, range, pick } from './random';
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
interface LNode { i: number; j: number; u: number; v: number; ind: boolean }
interface LEdge { a: LNode; b: LNode; role: Role; curve: number; tree?: boolean }

// A settlement's streets: a lattice in its own frame (u along the high street, v across it), its
// outline a wobbly circle. Row 0 is the high street and column 0 the main cross street; the city
// and the towns have an industrial edge of wider blocks on one side. A grid plan keeps the lattice
// square; an organic one jitters it, bends the streets and leaves some out (keeping every place
// reachable). Streets that would touch water or leave the map are dropped, then only what's joined
// to the centre is kept, and the calls come out in that order, each starting on a street already
// built: so every settlement's streets are one connected piece, whatever the water took.
export function layStreets(s: Settlement, mw: MapWater, bound: number): { streets: StreetCall[]; zone: ZoneRule | null } {
  const K = KINDS[s.kind], S = K.spacing, r = rng(s.seed), organic = s.plan === 'organic';
  const w1 = range(r, 0, 6.28), w2 = range(r, 0, 6.28);
  const edgeAt = (th: number) => s.r * (1 + 0.12 * Math.sin(3 * th + w1) + 0.07 * Math.sin(5 * th + w2));
  const ca = Math.cos(s.axis), sa = Math.sin(s.axis);
  const world = (u: number, v: number): XZ => ({ x: s.x + u * ca - v * sa, z: s.z + u * sa + v * ca });
  const n = Math.ceil((s.r * 1.25) / S) + 1;
  const indRows = K.industrial ? K.industrial.rows : 0;
  const j0 = Math.floor(s.r / S) + 1; // the first industrial row (on the +v side)
  const nodes = new Map<string, LNode>();
  const id = (i: number, j: number) => `${i},${j}`;
  for (let j = -n; j <= n + indRows; j++) for (let i = -n - 1; i <= n + 1; i++) {
    const ind = K.industrial !== null && j >= j0 && j < j0 + indRows;
    let u = i * S, v = j * S;
    if (ind) { if (Math.abs(u) > K.industrial!.width) continue; }
    else if (j >= j0 && K.industrial) continue;
    else {
      const d = Math.hypot(u, v), inside = d <= edgeAt(Math.atan2(v, u));
      // the high street runs a block past the edge each way; the cross street to the edge
      const spine = (j === 0 && Math.abs(u) <= s.r + S * 0.6) || (i === 0 && Math.abs(v) <= s.r);
      if (!inside && !spine) continue;
    }
    if (organic && !(i === 0 && j === 0)) {
      const k = j === 0 ? 0.05 : 0.18; // (the high street keeps nearly straight)
      u += range(r, -k, k) * S; v += range(r, -k, k) * S;
    }
    nodes.set(id(i, j), { i, j, u, v, ind });
  }
  // the lattice's streets
  const edges: LEdge[] = [];
  for (const a of nodes.values()) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const b = nodes.get(id(a.i + di, a.j + dj));
      if (!b) continue;
      const ind = a.ind || b.ind;
      // industrial blocks are twice as long: cross streets only on every other column (and the spine)
      if (ind && dj === 1 && a.i % 2 !== 0 && a.ind && b.ind) continue;
      const role: Role = dj === 0 && a.j === 0 ? 'high' : di === 0 && a.i === 0 ? (ind ? 'industrial' : 'main') : ind ? 'industrial' : 'street';
      edges.push({ a, b, role, curve: organic && role === 'street' ? range(r, -0.14, 0.14) : 0 });
    }
  }
  // Keep off water and the map's edge (the whole road band, with the water's gap for the bank).
  const pathOf = (e: LEdge) => {
    const A = world(e.a.u, e.a.v), B = world(e.b.u, e.b.v);
    const c = e.curve ? ctrlOf(A, B, e.curve) : undefined;
    return { A, B, c };
  };
  const dry = (e: LEdge) => {
    const { A, B, c } = pathOf(e);
    const L = Math.hypot(B.x - A.x, B.z - A.z);
    for (let k = 0; k <= Math.ceil(L / 5); k++) {
      const t = k / Math.ceil(L / 5), p = c ? quad(A, c, B, t) : { x: A.x + (B.x - A.x) * t, z: A.z + (B.z - A.z) * t };
      if (Math.abs(p.x) > bound - 60 || Math.abs(p.z) > bound - 60) return false;
      if (mw.edgeDistance(p, 60) < 30) return false; // (a road's band, the 9.5 m bank gap and room for plots)
    }
    return true;
  };
  let kept = edges.filter(dry);
  // An organic plan leaves some streets out, but never one that would cut a place off: a spanning
  // tree from the centre (along the high street and the cross street first) always stays.
  if (organic) {
    const tree = spanningTree(kept, nodes.get(id(0, 0))!);
    kept = kept.filter((e) => tree.has(e) || e.role !== 'street' || r() > PRIORS.roads.junctions.deadEnd); // (about as many dead ends as real towns have: priors.ts)
  }
  // then only what's joined to the centre, in the order it's reached from there
  const order = reachOrder(kept, nodes.get(id(0, 0))!);
  const high = pick(r, [K.high[0], K.high[1]]);
  const streetType = () => (organic ? K.street[r() < 0.5 ? 1 : 0] : K.street[0]);
  const streets: StreetCall[] = order.map(({ e, from }) => {
    const [p, q] = from === e.a ? [e.a, e.b] : [e.b, e.a];
    const { A, B, c } = pathOf(e);
    const fwd = p === e.a;
    // the city's boulevard only through its centre, then an avenue
    const type = e.role === 'high' ? (s.kind === 'city' && Math.max(Math.abs(p.i), Math.abs(q.i)) > 2 ? 'avenue' : high)
      : e.role === 'main' ? K.main : e.role === 'industrial' ? (e.a.i === 0 && e.b.i === 0 ? INDUSTRIAL_ROAD : 'street') : streetType();
    return { settlement: s.id, a: fwd ? A : B, b: fwd ? B : A, c, type, role: e.role };
  });
  // where the high street leaves town, each way: the gates; and with the main cross street's two
  // ends, the four ways out (spokes), each facing out along its street
  const built = (x: LNode) => order.some(({ e }) => e.a === x || e.b === x);
  const hs = [...nodes.values()].filter((x) => x.j === 0 && built(x)), ms = [...nodes.values()].filter((x) => x.i === 0 && built(x));
  const spokes: Spoke[] = [];
  const spoke = (x: LNode, du: number, dv: number, along: Spoke['along']) => { const p = world(x.u, x.v); spokes.push({ ...p, ux: du * ca - dv * sa, uz: du * sa + dv * ca, along }); return p; };
  if (hs.length) {
    const lo = hs.reduce((m, x) => (x.i < m.i ? x : m)), hi = hs.reduce((m, x) => (x.i > m.i ? x : m));
    s.gates = [spoke(lo, -1, 0, 'high'), spoke(hi, 1, 0, 'high')];
  }
  if (ms.length) {
    const lo = ms.reduce((m, x) => (x.j < m.j ? x : m)), hi = ms.reduce((m, x) => (x.j > m.j ? x : m));
    if (lo !== hi) { spoke(lo, 0, -1, 'main'); spoke(hi, 0, 1, 'main'); }
  }
  s.spokes = spokes;
  let zone: ZoneRule | null = null;
  if (K.industrial) {
    const W = K.industrial.width + S * 0.55, v0 = (j0 - 0.5) * S, v1 = (j0 + indRows - 1) * S + S * 0.75;
    zone = { kind: 'industrial', settlement: s.id, poly: [world(-W, v0), world(W, v0), world(W, v1), world(-W, v1)] };
  }
  return { streets, zone };
}
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
// breadth first from the centre, the main streets before the rest
function spanningTree(edges: LEdge[], root: LNode) {
  const adj = adjacency(edges), seen = new Set([root]), tree = new Set<LEdge>();
  let frontier = [root];
  while (frontier.length) {
    const next: LNode[] = [];
    for (const x of frontier) for (const e of [...(adj.get(x) ?? [])].sort((p, q) => rank(p) - rank(q))) {
      const y = e.a === x ? e.b : e.a;
      if (seen.has(y)) continue;
      seen.add(y); tree.add(e); next.push(y);
    }
    frontier = next;
  }
  return tree;
}
// every edge joined to the root, each with the end it's reached from (already built when it's laid)
function reachOrder(edges: LEdge[], root: LNode) {
  const adj = adjacency(edges), seen = new Set([root]), done = new Set<LEdge>(), out: { e: LEdge; from: LNode }[] = [];
  let frontier = [root];
  while (frontier.length) {
    const next: LNode[] = [];
    for (const x of frontier) for (const e of [...(adj.get(x) ?? [])].sort((p, q) => rank(p) - rank(q))) {
      if (done.has(e)) continue;
      done.add(e);
      out.push({ e, from: x });
      const y = e.a === x ? e.b : e.a;
      if (!seen.has(y)) { seen.add(y); next.push(y); }
    }
    frontier = next;
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
