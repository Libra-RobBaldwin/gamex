// Bridges in the game: the glue between the road network (roads.ts) and the bridges library
// (src/proto/bridges/, docs/bridges.md). Everything here is derived from the network except the
// one fact the player owns: which type each bridge is (RSeg.bridges), as with junction overrides.
//
// - crossingOf(): what a stretch of road has to cross (water, roads and railways underneath,
//   other junctions' land), as the library's Crossing.
// - priceBridges(): used by Network.check() to put a type and a price on every bridge in a
//   blueprint (the chooser's cost instead of RAISE_COST inside a bridge).
// - BridgeLayer: keeps each built segment's bridges laid out and draws all of them as one mesh
//   per material, so every bridge in the town costs about a dozen draw calls.
import * as THREE from 'three';
import {
  BRIDGES, bridgeMaterials, buildBridge, chooseBridge, extents, layoutBridge, override,
  type BridgeChoice, type BridgeGeometry, type BridgeId, type BridgeLayout, type Crossing, type Mat, type Obstacle,
} from '../bridges';
import type { RoadDef } from '../catalog';
import { RAISE_COST, pathLength, pointAt, type Network, type P, type RSeg } from '../roads';
import { gameYear } from './era';

// What's stored on a segment (RSeg.bridges): where each bridge is and its type. `override` is the
// player's pick in the bridge editor; otherwise the type is the chooser's at the time it was built,
// and stays that way (a bridge isn't rebuilt when its type's era ends).
export interface SegBridge { s0: number; s1: number; type: BridgeId; override: boolean }

const MPH = 0.44704;

// Everything under a road that a pier mustn't stand on, by distance along `path` (whose y is the
// road's height). `skip` leaves out the segment itself (and the ones it's made from).
export function obstaclesOf(net: Network, path: P[], skip: (seg: number) => boolean = () => false): Obstacle[] {
  const L = pathLength(path), out: Obstacle[] = [];
  // water, sampled as roads.ts check() does
  const step = 2;
  let w0 = -1;
  for (let s = 0; s <= L + 1e-6; s += step) {
    const wet = net.isWater(pointAt(path, s));
    if (wet && w0 < 0) w0 = Math.max(0, s - step);
    if (w0 >= 0 && (!wet || s + step > L)) { out.push({ kind: 'water', s0: w0, s1: Math.min(L, s), level: 0, name: 'the water' }); w0 = -1; }
  }
  // roads and railways passing underneath: no piers on them, and headroom over them
  for (const c of net.crossings(path)) {
    if (c.seg !== undefined && skip(c.seg)) continue;
    const y = pointAt(path, c.s).y;
    if (y - c.e < 2) continue; // joined, or it's the one going over
    const other = c.seg !== undefined ? net.segs.get(c.seg) : c.node !== undefined ? net.segsAt(c.node).find((s) => !skip(s.id)) : undefined;
    if (!other) continue;
    const oh = c.node !== undefined ? net.nodeHalf(c.node) : net.half(other);
    const span = Math.min(60, (oh + 1.5) / Math.max(0.25, c.sin));
    const od = net.def(other);
    out.push({ kind: od.cls === 'rail' ? 'rail' : 'road', s0: Math.max(0, c.s - span), s1: Math.min(L, c.s + span), surface: c.e, name: od.cls === 'rail' ? 'the railway' : 'the road' });
  }
  // keep-outs: other junctions' land (their islands and slip roads) under a raised deck
  let k0 = -1, key = '';
  for (let s = 0; s <= L + 1e-6; s += step) {
    const p = pointAt(path, s);
    const cl = p.y > 3 ? net.land.at(p) : undefined;
    const hit = cl && cl.owner !== 'road' && !out.some((o) => o.kind !== 'water' && s >= o.s0 && s <= o.s1) ? cl.key : '';
    if (hit && k0 < 0) { k0 = s; key = hit; }
    if (k0 >= 0 && (!hit || s + step > L)) { out.push({ kind: 'keepout', s0: k0, s1: Math.min(L, s), name: key.startsWith('junction') ? 'a junction' : 'someone’s land' }); k0 = -1; }
  }
  return out.sort((a, b) => a.s0 - b.s0);
}

export function crossingOf(net: Network, path: P[], road: RoadDef, skip?: (seg: number) => boolean, resolve?: Crossing['resolve']): Crossing {
  const p = path.map((q) => ({ x: q.x, z: q.z, y: q.y ?? 0 }));
  return { path: p, obstacles: obstaclesOf(net, p, skip), road, year: gameYear(), resolve };
}

// ---------- pricing a blueprint (Network.check) ----------

export interface Priced {
  choices: BridgeChoice[];
  cost: number; // what the bridges cost (game money)
  raise: number; // what RAISE_COST charged inside them, to take back off
  lifted?: Crossing; // the profile to build, when the chosen type needed the deck raised or the ramps eased
}

// Tiny memo: the blueprint is re-checked on every drag move, and the chooser is the slow part.
const memo: { key: string; out: Priced }[] = [];
const keyOf = (c: Crossing) => `${c.road.id}|${c.year}|${c.path.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)},${p.y!.toFixed(2)}`).join(';')}|${JSON.stringify(c.obstacles)}`;

export function priceBridges(c: Crossing): Priced {
  if (!c.path.some((p) => (p.y ?? 0) > 3)) return { choices: [], cost: 0, raise: 0 };
  const key = keyOf(c), hit = memo.find((m) => m.key === key);
  if (hit) return hit.out;
  const choices = extents(c).map((ex) => chooseBridge(c, ex));
  let cost = 0, raise = 0, lifted: Crossing | undefined, lift = -1;
  for (const ch of choices) {
    const o = ch.options.find((x) => x.def.id === ch.chosen);
    if (!o) continue; // nothing fits: the old embankment price stands
    cost += o.cost;
    raise += raiseCost(c.path, ch.s0, ch.s1);
    if (o.crossing && o.crossing !== c && o.lift > lift) { lift = o.lift; lifted = o.crossing; }
  }
  const out = { choices, cost: Math.round(cost), raise: Math.round(raise), lifted };
  memo.unshift({ key, out });
  memo.length = Math.min(memo.length, 6);
  return out;
}

// what roads.ts charged for raising the road between s0 and s1
function raiseCost(path: P[], s0: number, s1: number) {
  let acc = 0, out = 0;
  for (let i = 1; i < path.length; i++) {
    const L = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z), m = acc + L / 2;
    acc += L;
    const ym = ((path[i].y ?? 0) + (path[i - 1].y ?? 0)) / 2;
    if (m >= s0 && m <= s1 && ym > 0) out += L * ym * RAISE_COST;
  }
  return out;
}

// Carry a blueprint's bridges onto the segments build() made from it: `from` is where each
// segment starts along the blueprint's path.
export function storeBridges(seg: RSeg, choices: BridgeChoice[], from: number, to: number) {
  const mine = choices.filter((ch) => ch.chosen && ch.s1 > from + 1 && ch.s0 < to - 1);
  seg.bridges = mine.length ? mine.map((ch) => ({ s0: Math.max(0, ch.s0 - from), s1: Math.min(to, ch.s1) - from, type: ch.chosen!, override: false })) : undefined;
}

// ---------- the built bridges ----------

export type BuiltBridge = Built;
interface Built {
  seg: number; idx: number; s0: number; s1: number;
  crossing: Crossing; layout: BridgeLayout; geo: BridgeGeometry;
}
interface SegState { sig: string; bridges: Built[] }

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

export class BridgeLayer {
  group = new THREE.Group();
  private segs = new Map<number, SegState>();
  private dirty = true;
  constructor() { this.group.name = 'bridges'; }

  // Lay out every bridge whose segment (or what's under it) changed, and store the types on the
  // segments; roaddraw.ts reads RSeg.bridges to leave those stretches to the library. Returns
  // whether anything changed. Call before drawRoads().
  sync(net: Network) {
    for (const id of [...this.segs.keys()]) if (!net.segs.has(id)) { this.drop(id); this.dirty = true; }
    for (const s of net.segs.values()) {
      const path = net.path(s);
      if (!path.some((p) => (p.y ?? 0) > 3)) { if (s.bridges || this.segs.has(s.id)) { s.bridges = undefined; this.drop(s.id); this.dirty = true; } continue; }
      const c = crossingOf(net, path, net.def(s), (id) => id === s.id);
      const sig = `${keyOf(c)}|${JSON.stringify(s.bridges ?? null)}`;
      if (this.segs.get(s.id)?.sig === sig) continue;
      this.drop(s.id);
      this.segs.set(s.id, { sig: '', bridges: this.layOut(s, c) });
      // (the types may have been filled in or corrected: that's part of the signature)
      this.segs.get(s.id)!.sig = `${keyOf(c)}|${JSON.stringify(s.bridges ?? null)}`;
      this.dirty = true;
    }
    if (this.dirty) this.redraw();
    const was = this.dirty;
    this.dirty = false;
    return was;
  }

  private layOut(s: RSeg, c: Crossing): Built[] {
    const stored = s.bridges ?? [];
    const out: Built[] = [], keep: SegBridge[] = [];
    for (const [a, b] of extents(c)) {
      const was = stored.filter((x) => overlap(x.s0, x.s1, a, b) > 0).sort((x, y) => overlap(y.s0, y.s1, a, b) - overlap(x.s0, x.s1, a, b))[0];
      // the stored type, if it still fits (its era may have passed: built bridges stay)
      let lay = was ? layoutBridge(c, BRIDGES[was.type], a, b) : undefined, over = !!was?.override;
      if (!lay?.ok) {
        const ch = chooseBridge(c, [a, b]), o = ch.options.find((x) => x.def.id === ch.chosen);
        lay = o?.layout; over = false;
      }
      if (!lay?.ok) continue; // nothing fits: roaddraw keeps its old deck for this stretch
      keep.push({ s0: a, s1: b, type: lay.def.id, override: over });
      // the deck slab sits a hair under the game's road surface, so the two never fight
      const draw = { ...c, path: c.path.map((p) => ({ ...p, y: (p.y ?? 0) - 0.04 })) };
      out.push({ seg: s.id, idx: keep.length - 1, s0: a, s1: b, crossing: c, layout: lay, geo: buildBridge(draw, lay, { surface: false }) });
    }
    s.bridges = keep.length ? keep : undefined;
    return out;
  }

  private drop(id: number) {
    const st = this.segs.get(id);
    if (!st) return;
    for (const b of st.bridges) {
      for (const g of Object.values(b.geo.parts)) g?.dispose();
      for (const l of b.geo.leaves) for (const g of Object.values(l.parts)) g?.dispose();
    }
    this.segs.delete(id);
  }

  // One mesh per material for every bridge together (plus the bascule leaves on their pivots).
  private redraw() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); }
    const mats = bridgeMaterials(), by = new Map<Mat, THREE.BufferGeometry[]>();
    const all = [...this.segs.values()].flatMap((st) => st.bridges);
    for (const b of all) for (const [m, g] of Object.entries(b.geo.parts) as [Mat, THREE.BufferGeometry][]) { let a = by.get(m); if (!a) by.set(m, (a = [])); a.push(g); }
    for (const [m, list] of by) {
      const mesh = new THREE.Mesh(merge(list), mats[m]);
      mesh.castShadow = m !== 'line' && m !== 'rail';
      mesh.receiveShadow = true;
      mesh.name = `bridge:${m}`;
      this.group.add(mesh);
    }
    for (const b of all) for (const l of b.geo.leaves) {
      const o = new THREE.Group();
      o.position.set(...l.pivot);
      for (const [m, g] of Object.entries(l.parts) as [Mat, THREE.BufferGeometry][]) o.add(new THREE.Mesh(g.clone(), mats[m]));
      this.group.add(o);
    }
  }

  // Every bridge built, for tapping and the editor.
  list() { return [...this.segs.values()].flatMap((st) => st.bridges); }

  // The bridge at distance s along a segment, if there is one.
  at(seg: number, s: number) { return this.segs.get(seg)?.bridges.find((b) => s >= b.s0 && s <= b.s1); }

  // What could be built there now (this year's types, on the deck as built), with the one built marked.
  options(b: Built): BridgeChoice {
    const c = { ...b.crossing, year: gameYear() };
    const ch = chooseBridge(c, [b.s0, b.s1]);
    return { ...ch, chosen: b.layout.def.id };
  }

  // The player's pick. Returns false if that type can't be built there.
  setType(net: Network, b: Built, id: BridgeId) {
    const s = net.segs.get(b.seg), ch = this.options(b);
    if (!s?.bridges?.[b.idx] || override(ch, id).chosen !== id || !ch.options.find((o) => o.def.id === id)?.ok) return false;
    s.bridges[b.idx] = { ...s.bridges[b.idx], type: id, override: id !== ch.recommended || s.bridges[b.idx].override };
    return true;
  }

  // Speed limit on a bridge (m/s), for traffic.ts; Infinity where there's none.
  capAt(seg: RSeg, s: number) {
    const b = this.at(seg.id, s);
    if (!b) return Infinity;
    const mph = seg.type.startsWith('rail') ? b.layout.def.railMph : b.layout.def.roadMph;
    return mph ? mph * MPH : Infinity;
  }
}

// Concatenate non-indexed geometries with the same attributes (position and normal).
function merge(list: THREE.BufferGeometry[]) {
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const size = list[0].getAttribute(n).itemSize;
    const arr = new Float32Array(list.reduce((t, g) => t + g.getAttribute(n).array.length, 0));
    let o = 0;
    for (const g of list) { const a = g.getAttribute(n).array as Float32Array; arr.set(a, o); o += a.length; }
    out.setAttribute(n, new THREE.Float32BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
