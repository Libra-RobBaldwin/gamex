// The OSM road and rail graph, reshaped into something the game's network can hold. OSM and the
// game disagree in three ways, and each gets its own pass here:
//   1. OSM splits roads wherever a tag changes and joins them wherever two ways share a node;
//      the game wants a segment from junction to junction. Ways are cut at shared nodes, then
//      runs that only changed tags are joined back up.
//   2. OSM draws a roundabout as a ring of one-way ways; the game draws one node and lets the
//      junction designer shape it. Rings are collapsed to their centre, keeping the real radius
//      as a hint.
//   3. OSM draws dual carriageways, motorways and double-track railways as two parallel ways;
//      the game draws one centreline of a two-sided cross-section. Parallel pairs are found and
//      replaced by their centreline, and every side road that met either half is moved onto it.
// Whatever still can't be represented (one-way streets, slip roads, gyratories) is listed in
// `unsupported` with where it is, and kept in the network in the nearest form the game has.

import { closestOnPath, pathLength, pointAt, subPath, type P } from '../roads';
import { classify, onewayOf, railTypeFor, roadTypeFor } from './tags';
import type { OsmData, Tags } from './overpass';

export type GCls = 'road' | 'rail';
export interface GNode { id: number; x: number; z: number; osm: number[] }
export interface GEdge {
  id: number; a: number; b: number;
  pts: P[]; // a to b, both ends included
  cls: GCls; tags: Tags;
  dir: 0 | 1; // 1: traffic only runs a → b
  ways: Set<number>; // the OSM ways it came from
  paired: boolean; // the centreline of a pair of carriageways (or tracks)
  pairTags?: Tags; // the other carriageway's tags, when paired
}
export interface FormHint { node: number; form: 'roundabout' | 'mini'; radius: number; complete: boolean; name?: string; ways: number[]; at: P }
export type UnsupportedKind = 'one-way street' | 'slip road' | 'interchange' | 'gyratory' | 'large roundabout' | 'incomplete roundabout' | 'level crossing' | 'pedestrian street' | 'busway' | 'railway siding' | 'loop dropped' | 'road area';
export interface Unsupported { kind: UnsupportedKind; at: P; ways: number[]; note: string; path?: P[] }

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);

export class Graph {
  nodes = new Map<number, GNode>();
  edges = new Map<number, GEdge>();
  adj = new Map<number, Set<number>>();
  hints = new Map<number, FormHint>();
  // OSM ways folded into a junction (slivers, stubs across a central reservation): kept so every
  // way can still be traced to the roads at that node
  absorbed = new Map<number, Set<number>>();
  private next = 1;

  addNode(x: number, z: number, osm: number[] = []) {
    const n = { id: this.next++, x, z, osm };
    this.nodes.set(n.id, n);
    this.adj.set(n.id, new Set());
    return n.id;
  }
  node(id: number) { return this.nodes.get(id)!; }
  absorb(n: number, ways: Iterable<number>) {
    if (!this.absorbed.has(n)) this.absorbed.set(n, new Set());
    for (const w of ways) this.absorbed.get(n)!.add(w);
  }
  addEdge(e: Omit<GEdge, 'id'>) {
    const id = this.next++;
    this.edges.set(id, { ...e, id });
    this.adj.get(e.a)!.add(id);
    this.adj.get(e.b)!.add(id);
    return id;
  }
  removeEdge(id: number) {
    const e = this.edges.get(id);
    if (!e) return;
    this.adj.get(e.a)?.delete(id);
    this.adj.get(e.b)?.delete(id);
    this.edges.delete(id);
  }
  removeNode(id: number) { for (const e of [...(this.adj.get(id) ?? [])]) this.removeEdge(e); this.nodes.delete(id); this.adj.delete(id); }
  at(n: number) { return [...(this.adj.get(n) ?? [])].map((e) => this.edges.get(e)!); }
  degree(n: number) { return this.adj.get(n)?.size ?? 0; }

  // Split an edge at arc length s (snapping to its ends when close), returning the node there.
  splitEdge(id: number, s: number, snap = 1) {
    const e = this.edges.get(id)!, L = pathLength(e.pts);
    if (s <= snap) return e.a;
    if (s >= L - snap) return e.b;
    const p = pointAt(e.pts, s);
    const n = this.addNode(p.x, p.z);
    const first = subPath(e.pts, 0, s), second = subPath(e.pts, s, L);
    this.removeEdge(id);
    const base = { cls: e.cls, tags: e.tags, dir: e.dir, paired: e.paired, pairTags: e.pairTags };
    this.addEdge({ ...base, a: e.a, b: n, pts: first, ways: new Set(e.ways) });
    this.addEdge({ ...base, a: n, b: e.b, pts: second, ways: new Set(e.ways) });
    return n;
  }

  // Move everything at node `from` onto node `into`. Roads that ended at `from` are carried on
  // to `into` in a straight line; any that now start and end at the same node are dropped.
  mergeNode(from: number, into: number, dropped?: (e: GEdge) => void) {
    if (from === into) return;
    const f = this.node(from), t = this.node(into);
    // (edges keep their ids, so chains of edges held elsewhere stay valid)
    for (const e of this.at(from)) {
      const pts = [...e.pts];
      if (e.a === from) { if (dist(pts[0], t) > 0.05) pts.unshift({ x: t.x, z: t.z }); else pts[0] = { x: t.x, z: t.z }; }
      if (e.b === from) { if (dist(pts[pts.length - 1], t) > 0.05) pts.push({ x: t.x, z: t.z }); else pts[pts.length - 1] = { x: t.x, z: t.z }; }
      const a = e.a === from ? into : e.a, b = e.b === from ? into : e.b;
      if (a === b) { this.removeEdge(e.id); this.absorb(into, e.ways); dropped?.(e); continue; }
      e.a = a; e.b = b; e.pts = pts;
      this.adj.get(into)!.add(e.id);
    }
    t.osm.push(...f.osm);
    this.absorb(into, this.absorbed.get(from) ?? []);
    this.absorbed.delete(from);
    if (this.hints.has(from) && !this.hints.has(into)) { const h = this.hints.get(from)!; this.hints.set(into, { ...h, node: into }); }
    this.hints.delete(from);
    this.nodes.delete(from);
    this.adj.delete(from);
  }
}

// ---------- 1. cutting ways into edges ----------

export interface BuildResult { g: Graph; unsupported: Unsupported[]; dropped: Map<number, string> }

export function buildGraph(d: OsmData, local: (lat: number, lon: number) => P): BuildResult {
  const g = new Graph();
  const unsupported: Unsupported[] = [];
  const dropped = new Map<number, string>(); // OSM way → why it isn't in the network
  const pos = (id: number) => { const n = d.nodes.get(id); return n ? local(n.lat, n.lon) : undefined; };
  const wayPath = (nodes: number[]) => nodes.map(pos).filter((p): p is P => !!p);
  const mid = (pts: P[]) => { const p = pointAt(pts, pathLength(pts) / 2); return { x: p.x, z: p.z }; };

  const picked: { w: number; nodes: number[]; cls: GCls; tags: Tags; dir: 0 | 1 }[] = [];
  for (const w of d.ways.values()) {
    const t = w.tags;
    if (!t || w.nodes.length < 2) continue;
    const c = classify(t);
    if (c.kind === 'skip') {
      if (c.why) {
        const kind: UnsupportedKind = c.why === 'pedestrian street' ? 'pedestrian street' : c.why === 'busway' ? 'busway' : c.why === 'road area' ? 'road area' : 'railway siding';
        const path = wayPath(w.nodes);
        if (path.length >= 2) unsupported.push({ kind, at: mid(path), ways: [w.id], note: `${t.name ?? t.highway ?? t.railway}: not imported (${c.why})`, path });
        dropped.set(w.id, c.why);
      }
      continue;
    }
    const ow = onewayOf(t);
    const nodes = ow === -1 ? [...w.nodes].reverse() : w.nodes;
    // one-way slip roads are the junction designer's job: list them, leave them out
    if (c.kind === 'link' && ow !== 0) {
      const path = wayPath(nodes);
      if (path.length >= 2) unsupported.push({ kind: 'slip road', at: mid(path), ways: [w.id], note: `${t.highway}${t.name ? ` (${t.name})` : ''}: one-way slip roads aren't modelled yet; the junction designer adds its own`, path });
      dropped.set(w.id, 'slip road');
      continue;
    }
    picked.push({ w: w.id, nodes, cls: c.kind === 'rail' ? 'rail' : 'road', tags: t, dir: ow !== 0 ? 1 : 0 });
  }

  // where ways meet (or a way meets itself) the network needs a node
  const uses = new Map<string, number>();
  for (const p of picked) {
    p.nodes.forEach((n, i) => {
      const k = `${p.cls}:${n}`;
      const end = i === 0 || i === p.nodes.length - 1;
      uses.set(k, (uses.get(k) ?? 0) + (end ? 2 : 1));
    });
  }
  // a node on both a road and a railway is a level crossing: the game keeps road and rail apart
  const roadNodes = new Set(picked.filter((p) => p.cls === 'road').flatMap((p) => p.nodes));
  for (const p of picked) if (p.cls === 'rail') for (const n of p.nodes) if (roadNodes.has(n)) {
    const q = pos(n);
    if (q) unsupported.push({ kind: 'level crossing', at: q, ways: [p.w], note: 'road and railway share a node: imported as a crossing without a junction' });
  }

  const gnode = new Map<string, number>();
  const nodeFor = (cls: GCls, n: number, q: P) => {
    const k = `${cls}:${n}`;
    let id = gnode.get(k);
    if (id === undefined) { id = g.addNode(q.x, q.z, [n]); gnode.set(k, id); }
    return id;
  };
  for (const p of picked) {
    let run: P[] = [], start = -1;
    // a closed way (a loop road, a ring) is cut in thirds so no piece starts and ends on one node
    const L = p.nodes.length, closed = L > 3 && p.nodes[0] === p.nodes[L - 1];
    const thirds = closed ? [Math.floor((L - 1) / 3), Math.floor((2 * (L - 1)) / 3)] : [];
    for (let i = 0; i < L; i++) {
      const q = pos(p.nodes[i]);
      if (!q) { run = []; start = -1; continue; } // a node missing from the download: break the way there
      run.push(q);
      const cut = i === L - 1 || thirds.includes(i) || (uses.get(`${p.cls}:${p.nodes[i]}`) ?? 0) >= 2 || p.nodes.indexOf(p.nodes[i]) !== i;
      if (start < 0) { start = nodeFor(p.cls, p.nodes[i], q); run = [q]; continue; }
      if (!cut) continue;
      const end = nodeFor(p.cls, p.nodes[i], q);
      if (end !== start) g.addEdge({ a: start, b: end, pts: run, cls: p.cls, tags: p.tags, dir: p.dir, ways: new Set([p.w]), paired: false });
      start = end; run = [q];
    }
  }
  return { g, unsupported, dropped };
}

// ---------- 2. roundabouts ----------

const isRing = (e: GEdge) => e.cls === 'road' && (e.tags.junction === 'roundabout' || e.tags.junction === 'circular');

export function collapseRoundabouts(g: Graph, d: OsmData, local: (lat: number, lon: number) => P, unsupported: Unsupported[]) {
  // group ring pieces that share nodes: one group per roundabout
  const ring = [...g.edges.values()].filter(isRing);
  const parent = new Map<number, number>();
  const find = (n: number): number => { let r = n; while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!; parent.set(n, r); return r; };
  for (const e of ring) { if (!parent.has(e.a)) parent.set(e.a, e.a); if (!parent.has(e.b)) parent.set(e.b, e.b); parent.set(find(e.a), find(e.b)); }
  const groups = new Map<number, GEdge[]>();
  for (const e of ring) { const r = find(e.a); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(e); }
  let n = 0;
  for (const edges of groups.values()) {
    const nodes = new Set(edges.flatMap((e) => [e.a, e.b]));
    // complete when every ring node has one way in and one out
    const complete = [...nodes].every((v) => edges.filter((e) => e.a === v).length === 1 && edges.filter((e) => e.b === v).length === 1);
    // centre and radius from the ring's line, weighted by length so dense corners don't pull it
    let sx = 0, sz = 0, W = 0;
    for (const e of edges) for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1], b = e.pts[i], L = dist(a, b); sx += ((a.x + b.x) / 2) * L; sz += ((a.z + b.z) / 2) * L; W += L; }
    const c = { x: sx / W, z: sz / W };
    let rs = 0;
    for (const e of edges) for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1], b = e.pts[i], L = dist(a, b); rs += dist(c, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }) * L; }
    const radius = rs / W;
    const ways = [...new Set(edges.flatMap((e) => [...e.ways]))];
    const name = edges.map((e) => e.tags.name).find(Boolean);
    const path = edges.flatMap((e) => e.pts);
    for (const e of edges) g.removeEdge(e.id);
    const centre = g.addNode(c.x, c.z);
    for (const v of nodes) g.mergeNode(v, centre, (e) => {
      if (pathLength(e.pts) > 4 * radius) unsupported.push({ kind: 'loop dropped', at: c, ways: [...e.ways], note: `${e.tags.name ?? e.tags.highway} left and rejoined the same roundabout` });
    });
    const form = radius < 6 ? 'mini' : 'roundabout';
    g.hints.set(centre, { node: centre, form, radius, complete, name, ways, at: c });
    if (!complete) unsupported.push({ kind: 'incomplete roundabout', at: c, ways, note: `${name ?? 'roundabout'} (r ≈ ${radius.toFixed(0)} m): ring not closed in OSM (clipped, or through-roads cross it); collapsed anyway`, path });
    else if (radius > 45) unsupported.push({ kind: 'large roundabout', at: c, ways, note: `${name ?? 'roundabout'} (r ≈ ${radius.toFixed(0)} m): big enough to be a gyratory with its own junctions; collapsed to one node`, path });
    n++;
  }
  // mini-roundabouts are a node in OSM already
  for (const node of d.nodes.values()) {
    if (node.tags?.highway !== 'mini_roundabout') continue;
    const id = [...g.nodes.values()].find((v) => v.osm.includes(node.id) && g.at(v.id).some((e) => e.cls === 'road'))?.id;
    if (id === undefined) continue;
    g.hints.set(id, { node: id, form: 'mini', radius: 4, complete: true, ways: [], at: local(node.lat, node.lon) });
    n++;
  }
  return n;
}

// ---------- 3. pairing parallel carriageways and tracks ----------

interface Chain { cls: GCls; edges: number[]; key: string }
const chainPath = (g: Graph, c: Chain) => {
  const out: P[] = [];
  for (const id of c.edges) { const e = g.edges.get(id)!; out.push(...(out.length ? e.pts.slice(1) : e.pts)); }
  return out;
};
// names are the surest sign two carriageways are one road; unnamed pieces pair by class
const roadKey = (t: Tags) => t.ref || t.name || `~${t.highway}`;

// Runs of edges joined end to end where nothing else of their kind branches off.
function chains(g: Graph, want: (e: GEdge) => boolean, directed: boolean): Chain[] {
  const ok = new Set([...g.edges.values()].filter(want).map((e) => e.id));
  const ins = (n: number) => g.at(n).filter((e) => ok.has(e.id) && (!directed || e.b === n));
  const outs = (n: number) => g.at(n).filter((e) => ok.has(e.id) && (!directed || e.a === n));
  // can a chain pass through this node? only when exactly one of its kind comes in and one goes out
  const through = (n: number) => (directed ? ins(n).length === 1 && outs(n).length === 1 : g.at(n).filter((e) => ok.has(e.id)).length === 2) && !g.hints.has(n);
  const seen = new Set<number>(), out: Chain[] = [];
  const walk = (first: GEdge) => {
    // undirected edges are turned round as needed so each chain reads start to end
    const ids: number[] = [first.id];
    seen.add(first.id);
    let at = first.b;
    while (through(at)) {
      const nx = (directed ? outs(at) : g.at(at).filter((e) => ok.has(e.id))).find((e) => !seen.has(e.id));
      if (!nx) break;
      // a chain never doubles back: the two halves of a road that splits round an island meet
      // head to tail at its tip, and they're a pair, not one run
      const cur = g.edges.get(ids[ids.length - 1])!, p = cur.pts, q = nx.a === at ? nx.pts : [...nx.pts].reverse();
      const u = unit(p[p.length - 2], p[p.length - 1]), v = unit(q[0], q[1]);
      if (u.x * v.x + u.z * v.z < -0.3) break;
      if (!directed && nx.a !== at) flip(g, nx);
      if (directed && roadKey(nx.tags) !== roadKey(first.tags)) break;
      seen.add(nx.id);
      ids.push(nx.id);
      at = nx.b;
    }
    out.push({ cls: first.cls, edges: ids, key: roadKey(first.tags) });
  };
  for (const id of ok) {
    const e = g.edges.get(id)!;
    if (seen.has(id)) continue;
    // start from a chain's true beginning where there is one
    if (directed) { if (through(e.a) && roadKey(ins(e.a)[0].tags) === roadKey(e.tags)) continue; }
    else if (through(e.a)) { if (through(e.b)) continue; flip(g, e); }
    walk(g.edges.get(id)!);
  }
  for (const id of ok) if (!seen.has(id)) walk(g.edges.get(id)!); // loops with no beginning
  return out;
}

function flip(g: Graph, e: GEdge) {
  g.removeEdge(e.id);
  const id = g.addEdge({ ...e, a: e.b, b: e.a, pts: [...e.pts].reverse() });
  // keep the id stable for callers holding it
  const ne = g.edges.get(id)!;
  g.edges.delete(id); g.adj.get(ne.a)!.delete(id); g.adj.get(ne.b)!.delete(id);
  ne.id = e.id;
  g.edges.set(e.id, ne); g.adj.get(ne.a)!.add(e.id); g.adj.get(ne.b)!.add(e.id);
}

const unit = (a: P, b: P) => { const L = dist(a, b) || 1; return { x: (b.x - a.x) / L, z: (b.z - a.z) / L }; };
const box = (pts: P[]) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return [x0, z0, x1, z1];
};

interface Match { A: Chain; B: Chain; a0: number; a1: number; len: number; same: boolean }

// Where along chain A does chain B run beside it, within `gap` metres and roughly parallel?
function overlap(pa: P[], pb: P[], gap: number, want: 'opposite' | 'any', step = 4) {
  const La = pathLength(pa);
  let best = { a0: 0, a1: 0, len: 0, same: false }, run0 = -1, miss = 0, votes = 0;
  const close = (s: number) => { if (run0 >= 0) { const len = s - run0; if (len > best.len) best = { a0: run0, a1: s, len, same: votes > 0 }; } run0 = -1; miss = 0; votes = 0; };
  let last = 0;
  for (let s = 0; s <= La + 1e-6; s += step) {
    const p = pointAt(pa, Math.min(s, La)), c = closestOnPath(p, pb);
    const dot = p.ux * c.ux + p.uz * c.uz;
    const hit = c.d <= gap && (want === 'opposite' ? dot < -0.75 : Math.abs(dot) > 0.9);
    if (hit) { if (run0 < 0) run0 = s; last = s; miss = 0; votes += Math.sign(dot); }
    else if (run0 >= 0 && ++miss > 3) close(last);
  }
  close(Math.min(last, La));
  return best;
}

export interface PairOpts { roadGap: number; fastGap: number; railGap: number; minLen: number }
export const PAIR: PairOpts = { roadGap: 40, fastGap: 60, railGap: 6.5, minLen: 25 };

export function pairCarriageways(g: Graph, unsupported: Unsupported[], opts: PairOpts = PAIR) {
  let made = 0;
  // Each pass pairs every chain at most once (pairing rewrites the chain's edges); later passes
  // pick up the other stretches of long chains.
  const run = (cls: GCls) => {
    const cs = cls === 'road'
      ? chains(g, (e) => e.cls === 'road' && e.dir === 1 && !e.paired, true)
      : chains(g, (e) => e.cls === 'rail' && !e.paired, false);
    const paths = new Map(cs.map((c) => [c, chainPath(g, c)]));
    const boxes = new Map(cs.map((c) => [c, box(paths.get(c)!)]));
    const matches: Match[] = [];
    for (const A of cs) for (const B of cs) {
      if (A === B || (cls === 'road' && A.key !== B.key)) continue;
      const pa = paths.get(A)!, pb = paths.get(B)!;
      const fast = cls === 'road' && ['motorway', 'trunk'].includes(g.edges.get(A.edges[0])!.tags.highway);
      const gap = cls === 'rail' ? opts.railGap : fast ? opts.fastGap : opts.roadGap;
      const ba = boxes.get(A)!, bb = boxes.get(B)!;
      if (ba[0] > bb[2] + gap || bb[0] > ba[2] + gap || ba[1] > bb[3] + gap || bb[1] > ba[3] + gap) continue;
      const o = overlap(pa, pb, gap, cls === 'road' ? 'opposite' : 'any');
      if (o.len >= opts.minLen) matches.push({ A, B, ...o });
    }
    // longest first
    matches.sort((x, y) => y.len - x.len);
    const used = new Set<Chain>();
    let n = 0;
    for (const m of matches) {
      if (used.has(m.A) || used.has(m.B)) continue;
      // an earlier pair this pass may have dropped one of its edges: leave it for the next pass
      if (![...m.A.edges, ...m.B.edges].every((id) => g.edges.has(id))) continue;
      const pa = chainPath(g, m.A), pb = chainPath(g, m.B);
      const La = pathLength(pa), Lb = pathLength(pb);
      // snap to the chain ends when close: carriageways flare apart just before a roundabout
      const a0 = m.a0 < 15 ? 0 : m.a0, a1 = m.a1 > La - 15 ? La : m.a1;
      let b0 = closestOnPath(pointAt(pa, a0), pb).s, b1 = closestOnPath(pointAt(pa, a1), pb).s;
      if (Math.min(b0, b1) < 15) { if (b0 < b1) b0 = 0; else b1 = 0; }
      if (Math.max(b0, b1) > Lb - 15) { if (b0 > b1) b0 = Lb; else b1 = Lb; }
      if (Math.abs(b1 - b0) < opts.minLen / 2) continue;
      used.add(m.A); used.add(m.B);
      if (pairStretch(g, m.A, a0, a1, m.B, Math.min(b0, b1), Math.max(b0, b1), unsupported)) n++;
    }
    return n;
  };
  for (const cls of ['road', 'rail'] as const) for (let pass = 0; pass < 6; pass++) {
    const n = run(cls);
    made += n;
    if (!n) break;
  }
  return made;
}

// Cut a chain at arc length s, keeping the chain's edge list up to date; returns the node there.
function cutChain(g: Graph, c: Chain, s: number) {
  let acc = 0;
  for (let i = 0; i < c.edges.length; i++) {
    const e = g.edges.get(c.edges[i])!, L = pathLength(e.pts);
    if (s <= acc + L + 1e-6 || i === c.edges.length - 1) {
      const local = s - acc;
      if (local <= 1) return e.a;
      if (local >= L - 1) return e.b;
      const n = g.splitEdge(e.id, local, 0);
      const first = g.at(n).find((q) => q.b === n && q.a === e.a)!, second = g.at(n).find((q) => q.a === n && q.b === e.b)!;
      c.edges.splice(i, 1, first.id, second.id);
      return n;
    }
    acc += L;
  }
  return g.edges.get(c.edges[c.edges.length - 1])!.b;
}
// the chain's edges between two of its nodes
function between(g: Graph, c: Chain, n0: number, n1: number) {
  const out: number[] = [];
  let on = false;
  for (const id of c.edges) {
    const e = g.edges.get(id)!;
    if (e.a === n0) on = true;
    if (on) out.push(id);
    if (e.b === n1 && on) break;
  }
  return out;
}

function pairStretch(g: Graph, A: Chain, a0: number, a1: number, B: Chain, b0: number, b1: number, unsupported: Unsupported[]) {
  const nA0 = cutChain(g, A, a0), nA1 = cutChain(g, A, a1);
  const nB0 = cutChain(g, B, b0), nB1 = cutChain(g, B, b1);
  const EA = between(g, A, nA0, nA1), EB = between(g, B, nB0, nB1);
  if (!EA.length || !EB.length) return false;
  const pa = EA.flatMap((id, i) => (i ? g.edges.get(id)!.pts.slice(1) : g.edges.get(id)!.pts));
  const pb = EB.flatMap((id, i) => (i ? g.edges.get(id)!.pts.slice(1) : g.edges.get(id)!.pts));
  // which end of B lies at A's start (opposite for carriageways; either way for track)
  const bFlip = dist(pb[0], pa[0]) + dist(pb[pb.length - 1], pa[pa.length - 1]) > dist(pb[pb.length - 1], pa[0]) + dist(pb[0], pa[pa.length - 1]);
  const bStart = bFlip ? nB1 : nB0, bEnd = bFlip ? nB0 : nB1;
  // the centreline: halfway between the two, sampled along A
  const La = pathLength(pa), C: P[] = [];
  const steps = Math.max(2, Math.ceil(La / 5));
  for (let i = 0; i <= steps; i++) {
    const p = pointAt(pa, (La * i) / steps), q = closestOnPath(p, pb);
    C.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 });
  }
  // at the ends, meet the node both halves already share (a roundabout's centre, say)
  if (nA0 === bStart) C[0] = { x: g.node(nA0).x, z: g.node(nA0).z };
  if (nA1 === bEnd) C[C.length - 1] = { x: g.node(nA1).x, z: g.node(nA1).z };
  const Lc = pathLength(C);
  const inPair = new Set([...EA, ...EB]);
  const gapW = dist(pointAt(pa, La / 2), closestOnPath(pointAt(pa, La / 2), pb));
  // every node along either half that something else meets goes onto the centreline
  const stops: { t: number; n: number }[] = [];
  const consider = (ids: number[], ends: number[]) => {
    const nodes = new Set(ids.flatMap((id) => [g.edges.get(id)!.a, g.edges.get(id)!.b]));
    for (const n of nodes) {
      const other = g.at(n).some((e) => !inPair.has(e.id));
      if (!other && !ends.includes(n)) continue;
      const t = ends.indexOf(n) === 0 ? 0 : ends.indexOf(n) === 1 ? Lc : closestOnPath(g.node(n), C).s;
      stops.push({ t, n });
    }
  };
  consider(EA, [nA0, nA1]);
  consider(EB, [bStart, bEnd]);
  stops.sort((x, y) => x.t - y.t);
  // nodes close together along the centreline (a side road crossing both halves) become one
  const merge = Math.max(8, gapW * 1.2);
  const clusters: { t: number; ns: number[] }[] = [];
  for (const s of stops) {
    const last = clusters[clusters.length - 1];
    // (the two ends of a short pair stay apart)
    if (last && s.t - last.t <= merge && !(last.t === 0 && s.t === Lc)) { last.ns.push(s.n); if (s.t === Lc) last.t = Lc; }
    else clusters.push({ t: s.t, ns: [s.n] });
  }
  const eA = g.edges.get(EA[0])!, eB = g.edges.get(EB[0])!;
  const ways = new Set([...EA, ...EB].flatMap((id) => [...g.edges.get(id)!.ways]));
  const tags = eA.tags, pairTags = eB.tags;
  for (const id of inPair) g.removeEdge(id);
  // the node for each cluster: a roundabout centre or a node both halves share if there is one
  const targets = clusters.map((cl) => {
    const keep = cl.ns.find((n) => g.hints.has(n)) ?? cl.ns.find((n, i) => cl.ns.indexOf(n) !== i);
    const p = pointAt(C, cl.t);
    const target = keep ?? g.addNode(p.x, p.z);
    const dropped: GEdge[] = [];
    for (const n of new Set(cl.ns)) if (g.nodes.has(n)) g.mergeNode(n, target, (e) => dropped.push(e));
    for (const e of dropped) {
      // a stub of either carriageway folds into the centreline; anything else is a real loss
      if (roadKey(e.tags) === roadKey(tags)) for (const w of e.ways) ways.add(w);
      else if (pathLength(e.pts) > 3 * merge) unsupported.push({ kind: 'loop dropped', at: g.node(target), ways: [...e.ways], note: `${e.tags.name ?? e.tags.highway ?? e.tags.railway} ran from one carriageway to the other and became a loop` });
    }
    return { t: cl.t, n: target };
  });
  for (let i = 1; i < targets.length; i++) {
    const t0 = targets[i - 1], t1 = targets[i];
    if (t0.n === t1.n) continue;
    const pts = subPath(C, t0.t, t1.t);
    pts[0] = { x: g.node(t0.n).x, z: g.node(t0.n).z };
    pts[pts.length - 1] = { x: g.node(t1.n).x, z: g.node(t1.n).z };
    g.addEdge({ a: t0.n, b: t1.n, pts, cls: eA.cls, tags, pairTags, dir: 0, ways: new Set(ways), paired: true });
  }
  return true;
}

// ---------- 4. tidying ----------

// The catalogue type an edge will be built as, and what was rounded to get there.
export function typeOf(e: GEdge) {
  if (e.cls === 'rail') return railTypeFor(e.tags, e.paired);
  if (!e.paired) return roadTypeFor(e.tags, false);
  // a pair's lanes: the wider carriageway's
  const la = +(e.tags.lanes ?? 0), lb = +(e.pairTags?.lanes ?? 0);
  return roadTypeFor(lb > la ? { ...e.tags, lanes: e.pairTags!.lanes } : e.tags, true);
}

// Join edges that meet end to end at a node nothing else uses, when they'd be built the same.
export function joinRuns(g: Graph, keep: (n: number) => boolean = () => false) {
  let joined = 0;
  for (const n of [...g.nodes.keys()]) {
    if (!g.nodes.has(n) || g.degree(n) !== 2 || g.hints.has(n) || keep(n)) continue;
    const [e, f] = g.at(n);
    if (e.cls !== f.cls || e.paired !== f.paired || e.dir !== f.dir || typeOf(e).id !== typeOf(f).id) continue;
    if (e.dir === 1 && !((e.b === n && f.a === n) || (f.b === n && e.a === n))) continue;
    if ((e.tags.bridge ?? '') !== (f.tags.bridge ?? '') || (e.tags.tunnel ?? '') !== (f.tags.tunnel ?? '')) continue;
    // lay them out as first then second through n
    const first = e.b === n ? e : f.b === n ? f : e, second = first === e ? f : e;
    const p1 = first.b === n ? first.pts : [...first.pts].reverse(), a = first.b === n ? first.a : first.b;
    const p2 = second.a === n ? second.pts : [...second.pts].reverse(), b = second.a === n ? second.b : second.a;
    if (a === b) continue; // would close a loop onto one node
    g.removeEdge(e.id); g.removeEdge(f.id);
    g.addEdge({ ...first, a, b, pts: [...p1, ...p2.slice(1)], ways: new Set([...first.ways, ...second.ways, ...(g.absorbed.get(n) ?? [])]) });
    g.nodes.delete(n); g.adj.delete(n); g.absorbed.delete(n);
    joined++;
  }
  return joined;
}

// Merge the two ends of any edge shorter than `min` metres (OSM's slivers between close nodes).
export function dropSlivers(g: Graph, min = 3) {
  let n = 0;
  for (const e of [...g.edges.values()]) {
    if (!g.edges.has(e.id) || pathLength(e.pts) >= min) continue;
    const keepB = g.hints.has(e.b) || (!g.hints.has(e.a) && g.degree(e.b) >= g.degree(e.a));
    const [from, into] = keepB ? [e.a, e.b] : [e.b, e.a];
    g.removeEdge(e.id);
    g.mergeNode(from, into);
    g.absorb(into, e.ways);
    n++;
  }
  return n;
}

// Two edges between the same nodes along the same line are one road drawn twice.
export function dropDuplicates(g: Graph) {
  let n = 0;
  const byEnds = new Map<string, GEdge[]>();
  for (const e of g.edges.values()) { const k = `${e.cls}:${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`; if (!byEnds.has(k)) byEnds.set(k, []); byEnds.get(k)!.push(e); }
  for (const list of byEnds.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const x = list[i], y = list[j];
    if (!g.edges.has(x.id) || !g.edges.has(y.id)) continue;
    const far = Math.max(...y.pts.map((p) => closestOnPath(p, x.pts).d));
    if (far > 6) continue;
    for (const w of y.ways) x.ways.add(w);
    g.removeEdge(y.id);
    n++;
  }
  return n;
}

// One-way edges that weren't paired: the game has no one-way roads yet, so they're built two-way.
// A loop of them is a gyratory (or a one-way system), listed as one.
export function reportOneWays(g: Graph, unsupported: Unsupported[]) {
  const ow = [...g.edges.values()].filter((e) => e.cls === 'road' && e.dir === 1);
  const set = new Set(ow.map((e) => e.id));
  const inLoop = new Set<number>();
  for (const e of ow) {
    if (inLoop.has(e.id)) continue;
    // a short walk forward along one-way edges: does it come back?
    const stack: { at: number; path: number[] }[] = [{ at: e.b, path: [e.id] }];
    while (stack.length) {
      const { at, path } = stack.pop()!;
      if (at === e.a && path.length > 1) {
        const pts = path.flatMap((id) => g.edges.get(id)!.pts);
        const L = pathLength(pts);
        // a loop round a car park or a traffic island is just one-way streets; a big one that
        // overlaps one already found is the same system seen from another edge
        const service = path.every((id) => g.edges.get(id)!.tags.highway === 'service');
        const seenBefore = path.filter((id) => inLoop.has(id)).length >= path.length / 2;
        if (L >= 150 && L < 2500 && !service && !seenBefore) {
          for (const id of path) inLoop.add(id);
          const c = pts.reduce((s, p) => ({ x: s.x + p.x / pts.length, z: s.z + p.z / pts.length }), { x: 0, z: 0 });
          const names = [...new Set(path.map((id) => g.edges.get(id)!.tags.name).filter(Boolean))];
          unsupported.push({ kind: 'gyratory', at: c, ways: [...new Set(path.flatMap((id) => [...g.edges.get(id)!.ways]))], note: `one-way loop of ${L.toFixed(0)} m${names.length ? ` (${names.join(', ')})` : ''}: built as two-way roads`, path: pts });
        }
        break;
      }
      if (path.length >= 14) continue;
      for (const f of g.at(at)) if (set.has(f.id) && f.a === at && !path.includes(f.id)) stack.push({ at: f.b, path: [...path, f.id] });
    }
  }
  // the rest, one entry per OSM way
  const byWay = new Map<number, GEdge[]>();
  for (const e of ow) if (!inLoop.has(e.id)) for (const w of e.ways) { if (!byWay.has(w)) byWay.set(w, []); byWay.get(w)!.push(e); }
  const done = new Set<number>();
  for (const [w, es] of byWay) {
    if (done.has(w)) continue;
    const pts = es[0].pts, p = pointAt(pts, pathLength(pts) / 2);
    for (const e of es) for (const x of e.ways) done.add(x);
    unsupported.push({ kind: 'one-way street', at: { x: p.x, z: p.z }, ways: [...new Set(es.flatMap((e) => [...e.ways]))], note: `${es[0].tags.name ?? es[0].tags.highway}: built as a two-way road`, path: pts });
  }
  // several slip roads close together are an interchange
  const slips = unsupported.filter((u) => u.kind === 'slip road');
  const grouped = new Set<Unsupported>();
  for (const s of slips) {
    if (grouped.has(s)) continue;
    const near = slips.filter((o) => !grouped.has(o) && dist(o.at, s.at) < 250);
    if (near.length >= 4) {
      for (const o of near) grouped.add(o);
      const c = near.reduce((q, o) => ({ x: q.x + o.at.x / near.length, z: q.z + o.at.z / near.length }), { x: 0, z: 0 });
      unsupported.push({ kind: 'interchange', at: c, ways: near.flatMap((o) => o.ways), note: `${near.length} slip roads within 250 m: a grade-separated junction` });
    }
  }
}
