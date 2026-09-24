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
  BRIDGES, bridgeMaterials, buildBridge, chooseBridge, deckWidth, extents, layoutBridge, override,
  type BridgeChoice, type BridgeGeometry, type BridgeId, type BridgeLayout, type BridgeOption, type Crossing, type Mat, type Obstacle,
} from '../bridges';
import type { RoadDef } from '../catalog';
import { RAISE_COST, TUNNEL_COST, closestOnPath, pathLength, pointAt, type Network, type P, type RSeg } from '../roads';
import { gameYear } from './era';

// What's stored on a segment (RSeg.bridges): where each bridge is and its type. `override` is the
// player's pick in the bridge editor; otherwise the type is the chooser's at the time it was built,
// and stays that way (a bridge isn't rebuilt when its type's era ends).
export interface SegBridge { s0: number; s1: number; type: BridgeId; override: boolean }

// A road that isn't built yet but would pass under a bridge (for checking a blueprint).
export interface Under { path: P[]; half: number; rail: boolean }

const MPH = 0.44704;
const box = (path: P[], pad: number) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of path) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad] as const;
};

// Everything under a road that a pier mustn't stand on, by distance along `path` (whose y is the
// road's height). `skip` leaves out the segment itself; `extra` adds roads not built yet.
//
// Roads underneath are found by walking the deck: wherever a pier (a line across the deck's
// width, and a bit) would touch a road's full width below, that stretch is kept clear. That covers roads crossed at
// a skew, the arms of a junction, and a road running along under a viaduct alike.
export function obstaclesOf(net: Network, path: P[], road: RoadDef, skip: (seg: number) => boolean = () => false, extra: Under[] = []): Obstacle[] {
  const L = pathLength(path), out: Obstacle[] = [];
  // water, sampled as roads.ts check() does
  const step = 2;
  let w0 = -1;
  for (let s = 0; s <= L + 1e-6; s += step) {
    const wet = net.isWater(pointAt(path, s));
    if (wet && w0 < 0) w0 = Math.max(0, s - step);
    if (w0 >= 0 && (!wet || s + step > L)) { out.push({ kind: 'water', s0: w0, s1: Math.min(L, s), level: 0, name: 'the water' }); w0 = -1; }
  }
  // roads and railways underneath: no piers on them, and headroom over them
  const reach = deckWidth(road) / 2 + 1;
  if (path.some((p) => (p.y ?? 0) > 2.5)) {
    const me = box(path, 0);
    const under: (Under & { b: readonly number[] })[] = [];
    for (const s of net.segs.values()) {
      if (skip(s.id)) continue;
      const sp = net.path(s), h = net.half(s), b = box(sp, h + reach);
      if (b[0] > me[2] || b[2] < me[0] || b[1] > me[3] || b[3] < me[1]) continue;
      under.push({ path: sp, half: h, rail: net.def(s).cls === 'rail', b });
    }
    for (const u of extra) under.push({ ...u, b: box(u.path, u.half + reach) });
    const runs = under.map(() => ({ s0: -1, s1: -1, y: Infinity }));
    const close = (i: number) => {
      const r = runs[i];
      if (r.s0 < 0) return;
      out.push({ kind: under[i].rail ? 'rail' : 'road', s0: Math.max(0, r.s0 - 0.5), s1: Math.min(L, r.s1 + 0.5), surface: r.y, name: under[i].rail ? 'the railway' : 'the road' });
      runs[i] = { s0: -1, s1: -1, y: Infinity };
    };
    for (let s = 0; s <= L + 1e-6; s += 1) {
      const p = pointAt(path, s);
      under.forEach((u, i) => {
        let hit = false;
        if (p.y > 2.5 && p.x >= u.b[0] && p.x <= u.b[2] && p.z >= u.b[1] && p.z <= u.b[3]) {
          // a pier here is a line across the deck: does any of it come within the road's width?
          const q = closestOnPath(p, u.path);
          if (p.y - q.y > 2 && q.d < u.half + reach + 1) {
            for (let k = -reach; k <= reach + 1e-6 && !hit; k += 1) {
              const e = closestOnPath({ x: p.x - p.uz * k, z: p.z + p.ux * k }, u.path);
              if (e.d < u.half + 1 && p.y - e.y > 2) { hit = true; const r = runs[i]; if (r.s0 < 0) r.s0 = s; r.s1 = s; r.y = Math.min(r.y, e.y); }
            }
          }
        }
        if (!hit) close(i);
      });
    }
    under.forEach((_, i) => close(i));
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

export function crossingOf(net: Network, path: P[], road: RoadDef, skip?: (seg: number) => boolean, resolve?: Crossing['resolve'], extra?: Under[]): Crossing {
  const p = path.map((q) => ({ x: q.x, z: q.z, y: q.y ?? 0 }));
  return { path: p, obstacles: obstaclesOf(net, p, road, skip, extra), road, year: gameYear(), resolve };
}

// The chooser, tidied for the game: a type shorter than it can be built (a suspension bridge
// over a pond) is refused too, and the recommendation moves on if it was one of those.
function choose(c: Crossing, range: [number, number]): BridgeChoice {
  const ch = chooseBridge(c, range);
  const L = range[1] - range[0];
  const options: BridgeOption[] = ch.options.map((o) => (o.ok && L < o.def.length.min ? { ...o, ok: false, reasons: [`${Math.round(L)} m is too short for a ${o.def.label.toLowerCase()} (${o.def.length.min} m at least)`] } : o));
  options.sort((a, b) => (a.ok === b.ok ? (a.ok ? a.cost - b.cost : 0) : a.ok ? -1 : 1));
  const best = options.filter((o) => o.ok).sort((a, b) => a.wholeLife - b.wholeLife)[0];
  return { ...ch, options, recommended: best?.def.id, chosen: best?.def.id };
}

// ---------- pricing a blueprint (Network.check) ----------

export interface Priced {
  choices: BridgeChoice[]; // s0..s1 of each is the chosen layout's, on the path to build
  cost: number; // what the bridges cost (game money)
  lifted?: Crossing & { profile?: unknown }; // the profile to build, when the chosen type needed the deck raised or the ramps eased
}

// Tiny memo: the blueprint is re-checked on every drag move, and the chooser is the slow part.
const memo: { key: string; out: Priced }[] = [];
const keyOf = (c: Crossing) => `${c.road.id}|${c.year}|${c.path.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)},${p.y!.toFixed(2)}`).join(';')}|${JSON.stringify(c.obstacles)}`;

export function priceBridges(c: Crossing): Priced {
  if (!c.path.some((p) => (p.y ?? 0) > 3)) return { choices: [], cost: 0 };
  const key = keyOf(c), hit = memo.find((m) => m.key === key);
  if (hit) return hit.out;
  // the chooser re-solves the profile often and with the same few needs: remember them
  const seen = new Map<string, Crossing | undefined>(), res = c.resolve;
  const cc: Crossing = res ? { ...c, resolve: (n) => { const k = `${n.raise.toFixed(2)}|${n.grade ?? ''}`; if (!seen.has(k)) seen.set(k, res(n)); return seen.get(k); } } : c;
  const raw = extents(cc).map((ex) => choose(cc, ex));
  let cost = 0, lifted: Crossing | undefined, lift = -1;
  const choices = raw.map((ch) => {
    const o = ch.options.find((x) => x.def.id === ch.chosen);
    if (!o) return ch; // nothing fits: check() refuses
    cost += o.cost;
    if (o.crossing && o.crossing !== cc && o.lift > lift) { lift = o.lift; lifted = o.crossing; }
    return { ...ch, s0: o.layout!.s0, s1: o.layout!.s1 };
  });
  const out = { choices, cost: Math.round(cost), lifted };
  memo.unshift({ key, out });
  memo.length = Math.min(memo.length, 6);
  return out;
}

// What roads.ts charges for a path outside its bridges: RAISE_COST for embankments and ramps,
// TUNNEL_COST below ground. Also how much of it is raised or sunk.
export function earthworks(path: P[], choices: BridgeChoice[]) {
  let acc = 0, cost = 0, raised = 0, sunk = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1].y ?? 0, b = path[i].y ?? 0, L = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z), m = acc + L / 2, ym = (a + b) / 2;
    acc += L;
    if (a > 1.5 || b > 1.5) raised += L;
    if (a < -1.5 || b < -1.5) sunk += L;
    if (choices.some((ch) => ch.chosen && m >= ch.s0 && m <= ch.s1)) continue;
    cost += ym > 0 ? L * ym * RAISE_COST : L * Math.min(-ym, 14) * TUNNEL_COST;
  }
  return { cost, raised, sunk };
}

// Over a road or railway below: the standard headroom, or (for a bridge already built, when the
// network changes under it) whatever it has: a low bridge, as with any old one with a height limit.
const lowered = (c: Crossing): Crossing => ({ ...c, obstacles: c.obstacles.map((o) => (o.kind === 'road' || o.kind === 'rail' ? { ...o, clear: 0.5 } : o)) });
const LOW_NOTE = 'Less than the standard headroom over the road below: a low bridge, signed for high vehicles';

// A road about to be built under bridges already there: can each of them still be laid out over
// it, with no pier on it? (Headroom may come up short: that bridge becomes a low one.)
// Returns why not, if not.
export function blocksBridges(net: Network, path: P[], road: RoadDef): string | undefined {
  const u: Under = { path, half: deckWidth(road) / 2, rail: road.cls === 'rail' };
  const me = box(path, 40);
  for (const s of net.segs.values()) {
    if (!s.bridges) continue;
    const sp = net.path(s), b = box(sp, 0);
    if (b[0] > me[2] || b[2] < me[0] || b[1] > me[3] || b[3] < me[1]) continue;
    const c = lowered(crossingOf(net, sp, net.def(s), (id) => id === s.id, undefined, [u]));
    for (const ex of extents(c)) {
      const was = s.bridges.find((x) => Math.min(x.s1, ex[1]) > Math.max(x.s0, ex[0]));
      if (was && layoutBridge(c, BRIDGES[was.type], ex[0], ex[1]).ok) continue;
      if (choose(c, ex).chosen) continue;
      return `The bridge overhead has no room for its piers either side of this ${road.cls === 'rail' ? 'railway' : 'road'}`;
    }
  }
  return undefined;
}

// Carry a blueprint's bridges onto the segments build() made from it: `from` is where each
// segment starts along the blueprint's path.
export function storeBridges(seg: RSeg, choices: BridgeChoice[], from: number, to: number) {
  seg.bridges = clipBridges(choices.filter((ch) => ch.chosen).map((ch) => ({ s0: ch.s0, s1: ch.s1, type: ch.chosen!, override: false })), from, to);
}

// The part of a segment's bridges between from and to, measured from `from` (for a split).
export function clipBridges(list: SegBridge[], from: number, to: number) {
  const out = list.filter((b) => b.s1 > from + 1 && b.s0 < to - 1).map((b) => ({ ...b, s0: Math.max(0, b.s0 - from), s1: Math.min(to, b.s1) - from }));
  return out.length ? out : undefined;
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
  private topo = '';
  constructor() { this.group.name = 'bridges'; }

  // Lay out every bridge whose segment (or what's under it) changed, and store the types on the
  // segments; roaddraw.ts reads RSeg.bridges to leave those stretches to the library. Returns
  // whether anything changed. Call before drawRoads().
  sync(net: Network) {
    // nothing to do if no road changed and no type was picked (the common case: a junction edit)
    const topo = [...net.segs.values()].map((s) => `${s.id}:${s.mid.length}:${JSON.stringify(s.bridges ?? 0)}`).join();
    if (topo === this.topo && !this.dirty) return false;
    this.topo = topo;
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
    this.topo = [...net.segs.values()].map((s) => `${s.id}:${s.mid.length}:${JSON.stringify(s.bridges ?? 0)}`).join();
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
      // the stored type, if it still fits (its era may have passed: built bridges stay); else the
      // chooser's. Blueprints are refused where nothing fits, but the network can still change
      // underneath (a road that ran under before the deck was re-laid): then the bridge stays,
      // with its piers off the roads, and only the headroom is short.
      const low = lowered(c);
      let lay: BridgeLayout | undefined, over = false;
      for (const x of [c, low]) {
        lay = was ? layoutBridge(x, BRIDGES[was.type], a, b) : undefined; over = !!was?.override;
        if (!lay?.ok) { const ch = choose(x, [a, b]); lay = ch.options.find((o) => o.def.id === ch.chosen)?.layout; over = false; }
        if (lay?.ok) break;
      }
      if (!lay?.ok) continue; // nothing fits: roaddraw keeps its old deck for this stretch
      if (!layoutBridge(c, lay.def, a, b).ok) lay = { ...lay, notes: [LOW_NOTE, ...lay.notes] };
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
    const ch = choose(c, [b.s0, b.s1]);
    return { ...ch, chosen: b.layout.def.id };
  }

  // The player's pick. Returns false if that type can't be built there.
  setType(net: Network, b: Built, id: BridgeId) {
    const s = net.segs.get(b.seg), ch = this.options(b);
    if (!s?.bridges?.[b.idx] || override(ch, id).chosen !== id || !ch.options.find((o) => o.def.id === id)?.ok) return false;
    s.bridges[b.idx] = { ...s.bridges[b.idx], type: id, override: id !== ch.recommended };
    return true;
  }

  // Speed limit on a bridge (m/s), for traffic.ts; Infinity where there's none. `dir` is the way
  // the vehicle is going (+1 from seg.a): it slows for the bridge in the `ahead` metres before it.
  capAt(seg: RSeg, s: number, dir: 1 | -1 = 1, ahead = 40) {
    const b = this.segs.get(seg.id)?.bridges.find((x) => s >= x.s0 - (dir > 0 ? ahead : 0) && s <= x.s1 + (dir < 0 ? ahead : 0));
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
