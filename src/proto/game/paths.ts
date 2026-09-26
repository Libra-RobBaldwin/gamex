// Footpaths at dead ends. A UK cul-de-sac just stops (no turning circle), and a path carries on
// from its end: through to the next street when one lies ahead within walking reach and the way is
// clear, or a short stub into the ground beyond. Each path claims its land ('road'), so nothing is
// built on it, and all of them are drawn as one draped mesh (a tarmac strip a little above the
// ground). Worked out again whenever the roads change (main.ts commitRoads).
import * as THREE from 'three';
import { polysOverlap, rectCorners, type Lot, type Network, type P, type RSeg } from '../roads';

export const PATH = { width: 2, reach: 90, stub: 12, cone: Math.cos((40 * Math.PI) / 180), y: 0.06 };
export interface FootPath { node: number; a: P; b: P; through: boolean }

interface Piece { seg: RSeg; a: P; b: P }
const C = 40;
const key = (i: number, j: number) => `${i},${j}`;

// Where each dead end's path runs.
export function deadEndPaths(net: Network, lots: Iterable<Lot>): FootPath[] {
  // every road and railway's pieces, and every building's footprint, on a grid
  const pieces = new Map<string, Piece[]>(), feet = new Map<string, P[][]>();
  const add = <T>(m: Map<string, T[]>, x0: number, z0: number, x1: number, z1: number, v: T) => {
    for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) (m.get(key(i, j)) ?? m.set(key(i, j), []).get(key(i, j))!).push(v);
  };
  for (const s of net.segs.values()) {
    const p = net.path(s);
    for (let k = 1; k < p.length; k++) add(pieces, Math.min(p[k - 1].x, p[k].x), Math.min(p[k - 1].z, p[k].z), Math.max(p[k - 1].x, p[k].x), Math.max(p[k - 1].z, p[k].z), { seg: s, a: p[k - 1], b: p[k] });
  }
  for (const l of lots) { const f = rectCorners(l.x, l.z, l.rot, l.w, l.d), r = Math.hypot(l.w, l.d) / 2; add(feet, l.x - r, l.z - r, l.x + r, l.z + r, f); }
  const near = <T>(m: Map<string, T[]>, p: P, r: number) => { const out = new Set<T>(); for (let i = Math.floor((p.x - r) / C); i <= Math.floor((p.x + r) / C); i++) for (let j = Math.floor((p.z - r) / C); j <= Math.floor((p.z + r) / C); j++) for (const v of m.get(key(i, j)) ?? []) out.add(v); return out; };
  const onPiece = (q: Piece, p: P) => { const ux = q.b.x - q.a.x, uz = q.b.z - q.a.z, L2 = ux * ux + uz * uz || 1, t = Math.max(0, Math.min(1, ((p.x - q.a.x) * ux + (p.z - q.a.z) * uz) / L2)); const x = q.a.x + ux * t, z = q.a.z + uz * t; return { x, z, d: Math.hypot(p.x - x, p.z - z) }; };
  // is the strip from a to b clear of buildings, water and every road but these?
  const clear = (a: P, b: P, skip: Set<number>) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1) return false;
    const band = rectCorners((a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(b.z - a.z, b.x - a.x), L, PATH.width + 0.6);
    for (let s = 0; s <= L; s += 3) {
      const p = { x: a.x + ((b.x - a.x) * s) / L, z: a.z + ((b.z - a.z) * s) / L };
      if (net.isWater(p) || Math.abs(p.x) > net.bound || Math.abs(p.z) > net.bound) return false;
      for (const q of near(pieces, p, 30)) if (!skip.has(q.seg.id) && onPiece(q, p).d < net.half(q.seg) + PATH.width / 2) return false;
    }
    for (const f of near(feet, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, L / 2 + 20)) if (polysOverlap(band, f)) return false;
    return true;
  };
  const out: FootPath[] = [];
  for (const n of net.nodes.values()) {
    const at = net.segsAt(n.id);
    if (at.length !== 1) continue;
    const s = at[0], d = net.def(s);
    if (d.cls !== 'road' || d.family === 'Motorway') continue;
    const from = net.pathFrom(s, n.id), q1 = from[1] ?? from[0], L0 = Math.hypot(n.x - q1.x, n.z - q1.z);
    if (L0 < 1e-6) continue;
    const u = { x: (n.x - q1.x) / L0, z: (n.z - q1.z) / L0 };
    // (a road running off the map's edge has no end to walk from)
    if (Math.abs(n.x + u.x * 40) > net.bound || Math.abs(n.z + u.z * 40) > net.bound) continue;
    if (Math.abs(n.y ?? 0) > 0.5) continue;
    const a = { x: n.x, z: n.z };
    // the nearest street ahead, within reach and inside the cone: its footway's outer edge
    let best: { b: P; seg: RSeg; d: number } | null = null;
    for (const q of near(pieces, { x: a.x + u.x * PATH.reach / 2, z: a.z + u.z * PATH.reach / 2 }, PATH.reach / 2 + 10)) {
      // (only a street with a footway, at ground level: not a dual carriageway's verge or an embankment's side)
      if (q.seg.id === s.id || net.def(q.seg).cls !== 'road' || net.def(q.seg).family === 'Motorway' || !(net.def(q.seg).pave > 0)) continue;
      if (Math.abs(q.a.y ?? 0) > 0.5 || Math.abs(q.b.y ?? 0) > 0.5) continue;
      const c = onPiece(q, a), vx = c.x - a.x, vz = c.z - a.z, D = Math.hypot(vx, vz);
      if (D > PATH.reach || D < 4 || (vx * u.x + vz * u.z) / D < PATH.cone) continue;
      const stop = D - net.half(q.seg) + 0.2;
      if (stop < 3) continue;
      if (!best || stop < best.d) best = { b: { x: a.x + (vx / D) * stop, z: a.z + (vz / D) * stop }, seg: q.seg, d: stop };
    }
    if (best && clear(a, best.b, new Set([s.id, best.seg.id]))) { out.push({ node: n.id, a, b: best.b, through: true }); continue; }
    const b = { x: a.x + u.x * PATH.stub, z: a.z + u.z * PATH.stub };
    if (clear(a, b, new Set([s.id]))) out.push({ node: n.id, a, b, through: false });
  }
  return out;
}

// The paths on the map: their land and their mesh.
export class DeadEndPaths {
  readonly mesh: THREE.Mesh;
  list: FootPath[] = [];
  private sig = '';
  constructor(material = new THREE.MeshLambertMaterial({ color: '#8f8b84', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.name = 'footpaths';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; // (spread over the whole map; one small mesh)
  }
  // Take them all away (their land too): before a real map's buildings go up, which the paths then avoid.
  clear(net: Network) { net.land.releaseWhere((k) => k.startsWith('path:')); this.sig = '#'; this.roads = ''; this.list = []; }
  // Work them out again (claims released and made again; the mesh rebuilt only if they changed).
  private roads = '';
  update(net: Network, lots: Iterable<Lot>) {
    // (only when the roads have changed since: a path depends on the dead ends and what's round them,
    // and buildings keep off the paths' land anyway)
    let n = 0, sx = 0, sz = 0;
    for (const s of net.segs.values()) { n++; const a = net.node(s.a), b = net.node(s.b); sx += s.id * 0.37 + a.x + b.x + s.mid.length; sz += a.z + b.z; }
    const roads = `${n}:${sx.toFixed(1)}:${sz.toFixed(1)}`;
    if (roads === this.roads) return false;
    this.roads = roads;
    return this.set(net, deadEndPaths(net, lots));
  }
  // Take these paths (a real map's, worked out ahead of time: real/live.ts), as update would.
  set(net: Network, next: FootPath[], roads?: string) {
    if (roads !== undefined) this.roads = roads;
    const sig = next.map((p) => `${p.node}:${p.b.x.toFixed(1)},${p.b.z.toFixed(1)}`).join('|');
    if (sig === this.sig) return false;
    this.sig = sig;
    net.land.releaseWhere((k) => k.startsWith('path:'));
    for (const p of next) {
      const L = Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z);
      net.land.claim(`path:${p.node}`, 'road', [rectCorners((p.a.x + p.b.x) / 2, (p.a.z + p.b.z) / 2, Math.atan2(p.b.z - p.a.z, p.b.x - p.a.x), L, PATH.width)]);
    }
    this.list = next;
    // a strip a vertex every 4 m (so it follows the hills when draped)
    const pos: number[] = [], idx: number[] = [];
    for (const p of next) {
      const L = Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z), ux = (p.b.x - p.a.x) / L, uz = (p.b.z - p.a.z) / L, h = PATH.width / 2;
      const n = Math.max(1, Math.ceil(L / 4)), v0 = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const x = p.a.x + ux * ((L * i) / n), z = p.a.z + uz * ((L * i) / n);
        pos.push(x - uz * h, PATH.y, z + ux * h, x + uz * h, PATH.y, z - ux * h);
        if (i) { const k = v0 + 2 * i; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    return true;
  }
}
