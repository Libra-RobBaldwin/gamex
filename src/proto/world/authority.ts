// The tile authority store: the facts a save file holds, cut up by tile.
//
// Authorities (ENGINE.md) are the only things saved: the road graph's nodes and segments, land
// claims that nothing else derives (a park the player placed, land use from real data), zoning,
// and the player's edits (overrides of what the generators would do). Everything else — junction
// designs, road and junction land claims, plots, buildings, meshes — is derived from these plus
// seeds, and is rebuilt when a tile loads.
//
// Every record has a stable string id and is **owned** by exactly one tile:
//   node   the tile it stands in
//   seg    the tile its first node (a) stands in, however far the road runs
//   claim  the tile holding the centre of its bounding box
//   zone   likewise
//   edit   whichever tile owns the thing it edits (or where it was made, if that's gone)
// A record whose geometry reaches other tiles is **referenced** from them: each tile keeps the ids
// of foreign records that touch it and which tile owns them. So a road crossing three tiles is
// stored once, and each of the three knows it's there and where to find it.

import { entitySeed, tileSeed } from './seed';
import { TILE, keyAt, keysAlong, keysInBox, type TileKey } from './tiles';

export interface XZ { x: number; z: number }
export interface XYZ extends XZ { y?: number }
export interface NodeRec { kind: 'node'; id: string; x: number; z: number; y?: number }
export interface SegRec { kind: 'seg'; id: string; a: string; b: string; mid: XYZ[]; type: string; stops?: unknown[] }
export interface ClaimRec { kind: 'claim'; id: string; owner: string; polys: XZ[][] }
export interface ZoneRec { kind: 'zone'; id: string; zone: string; poly: XZ[] }
export interface EditRec { kind: 'edit'; id: string; target: string; op: string; data?: unknown; at?: XZ }
export type Rec = NodeRec | SegRec | ClaimRec | ZoneRec | EditRec;

// What a tile holds in a save: the records it owns, and (as a hint for streaming a single tile
// from storage) which foreign records touch it and who owns them.
export interface TileSave { owned: Rec[]; refs: [string, TileKey][] }
export interface WorldSave { version: 1; seed: number; size: number; next: number; tiles: Record<TileKey, TileSave> }

interface TileAuth { key: TileKey; owned: Map<string, Rec>; refs: Map<string, TileKey> }

const boxCentre = (pts: XZ[]) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
};
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class TileStore {
  private tiles = new Map<TileKey, TileAuth>();
  private recs = new Map<string, Rec>();
  private owner = new Map<string, TileKey>();
  private covers = new Map<string, TileKey[]>(); // every tile a record touches, owner included
  private segsAt = new Map<string, Set<string>>(); // node id → segment ids
  private editsOf = new Map<string, Set<string>>(); // target id → edit ids
  private changed = new Set<TileKey>(); // tiles whose saved form changed since the last save
  next = 1;

  constructor(readonly seed = 1, readonly size = TILE) {}

  // A fresh id for something the player made. Generated content uses ids derived from what it
  // was generated from (e.g. `lot:s12:L:3`), so it needs no counter and never collides.
  newId(prefix: string) { return `${prefix}${this.next++}`; }

  get<R extends Rec = Rec>(id: string) { return this.recs.get(id) as R | undefined; }
  ownerOf(id: string) { return this.owner.get(id); }
  coverOf(id: string) { return this.covers.get(id) ?? []; }
  has(key: TileKey) { return this.tiles.has(key); }
  keys() { return [...this.tiles.keys()]; }

  // the seed for anything generated from a record, e.g. the building on a lot
  seedOf(id: string) { return entitySeed(this.seed, this.owner.get(id) ?? '', id); }
  tileSeed(key: TileKey) { return tileSeed(this.seed, key); }

  pathOf(s: SegRec): XYZ[] {
    const a = this.get<NodeRec>(s.a), b = this.get<NodeRec>(s.b);
    if (!a || !b) throw new Error(`segment ${s.id} has a missing node`);
    return [a, ...s.mid, b];
  }

  private homeOf(r: Rec, was?: TileKey): { own: TileKey; cover: TileKey[] } {
    const sz = this.size;
    switch (r.kind) {
      case 'node': { const k = keyAt(r.x, r.z, sz); return { own: k, cover: [k] }; }
      case 'seg': { const p = this.pathOf(r); return { own: keyAt(p[0].x, p[0].z, sz), cover: keysAlong(p, 0, sz) }; }
      case 'claim': case 'zone': {
        const b = boxCentre(r.kind === 'claim' ? r.polys.flat() : r.poly);
        return { own: keyAt(b.cx, b.cz, sz), cover: keysInBox(b.x0, b.z0, b.x1, b.z1, sz) };
      }
      case 'edit': {
        const k = this.owner.get(r.target) ?? (r.at ? keyAt(r.at.x, r.at.z, sz) : was);
        if (!k) throw new Error(`edit ${r.id} has neither a target nor a place`);
        return { own: k, cover: [k] };
      }
    }
  }

  private tile(key: TileKey) {
    let t = this.tiles.get(key);
    if (!t) this.tiles.set(key, (t = { key, owned: new Map(), refs: new Map() }));
    return t;
  }

  private unindex(id: string, touched: Set<TileKey>) {
    const own = this.owner.get(id);
    if (own === undefined) return;
    for (const k of this.covers.get(id)!) {
      const t = this.tiles.get(k)!;
      t.owned.delete(id); t.refs.delete(id);
      touched.add(k); this.changed.add(k);
      if (!t.owned.size && !t.refs.size) this.tiles.delete(k);
    }
    this.owner.delete(id); this.covers.delete(id);
  }
  private index(r: Rec, touched: Set<TileKey>, was?: TileKey) {
    const { own, cover } = this.homeOf(r, was);
    const all = cover.includes(own) ? cover : [own, ...cover];
    this.owner.set(r.id, own); this.covers.set(r.id, all);
    for (const k of all) {
      const t = this.tile(k);
      if (k === own) t.owned.set(r.id, r); else t.refs.set(r.id, own);
      touched.add(k); this.changed.add(k);
    }
  }
  private reindex(id: string, touched: Set<TileKey>) {
    const r = this.recs.get(id);
    if (r) { const was = this.owner.get(id); this.unindex(id, touched); this.index(r, touched, was); }
  }

  // Add or replace a record. Returns every tile whose facts changed (old and new places), which
  // is what the dirty tracker should hear about.
  put(r: Rec): TileKey[] {
    if (r.kind === 'seg') for (const n of [r.a, r.b]) if (!this.recs.has(n)) throw new Error(`segment ${r.id}: no node ${n}`);
    const touched = new Set<TileKey>();
    const old = this.recs.get(r.id);
    if (old && old.kind !== r.kind) throw new Error(`${r.id} is a ${old.kind}, not a ${r.kind}`);
    if (old?.kind === 'seg') for (const n of [old.a, old.b]) this.segsAt.get(n)?.delete(old.id);
    if (old?.kind === 'edit') this.editsOf.get(old.target)?.delete(old.id);
    this.unindex(r.id, touched);
    this.recs.set(r.id, r);
    this.index(r, touched);
    if (r.kind === 'seg') for (const n of [r.a, r.b]) { let s = this.segsAt.get(n); if (!s) this.segsAt.set(n, (s = new Set())); s.add(r.id); }
    if (r.kind === 'edit') { let s = this.editsOf.get(r.target); if (!s) this.editsOf.set(r.target, (s = new Set())); s.add(r.id); }
    // a moved node drags its roads' extents along; edits follow whatever they edit
    if (r.kind === 'node') for (const s of this.segsAt.get(r.id) ?? []) { this.reindex(s, touched); this.follow(s, touched); }
    this.follow(r.id, touched);
    return [...touched];
  }
  private follow(id: string, touched: Set<TileKey>) { for (const e of this.editsOf.get(id) ?? []) this.reindex(e, touched); }

  remove(id: string): TileKey[] {
    const r = this.recs.get(id);
    if (!r) return [];
    if (r.kind === 'node' && this.segsAt.get(id)?.size) throw new Error(`node ${id} still has roads`);
    const touched = new Set<TileKey>();
    if (r.kind === 'seg') for (const n of [r.a, r.b]) this.segsAt.get(n)?.delete(id);
    if (r.kind === 'edit') this.editsOf.get(r.target)?.delete(id);
    this.unindex(id, touched);
    this.recs.delete(id);
    // edits of a removed thing stay (the player's intent survives): homed where they were made,
    // or failing that where the thing was
    for (const e of this.editsOf.get(id) ?? []) this.reindex(e, touched);
    return [...touched];
  }

  // What a tile's derivation stages read: the records it owns and the foreign ones touching it.
  inTile(key: TileKey) {
    const t = this.tiles.get(key);
    if (!t) return { owned: [] as Rec[], refs: [] as Rec[] };
    return { owned: [...t.owned.values()].sort(byId), refs: [...t.refs.keys()].map((id) => this.recs.get(id)!).sort(byId) };
  }
  refsOf(key: TileKey) { return [...(this.tiles.get(key)?.refs ?? new Map<string, TileKey>())].sort((a, b) => (a[0] < b[0] ? -1 : 1)); }

  // ---------- saving ----------
  // Records only, sorted, so the same world always saves to the same bytes.
  saveTile(key: TileKey): TileSave {
    const t = this.tiles.get(key);
    return { owned: t ? [...t.owned.values()].sort(byId).map((r) => structuredClone(r)) : [], refs: this.refsOf(key) };
  }
  save(): WorldSave {
    const tiles: Record<TileKey, TileSave> = {};
    for (const k of [...this.tiles.keys()].sort()) tiles[k] = this.saveTile(k);
    this.changed.clear();
    return { version: 1, seed: this.seed, size: this.size, next: this.next, tiles };
  }
  // Tiles to write for an incremental save (e.g. one IndexedDB row per tile), then forget them.
  takeChanged() { const out = [...this.changed].sort(); this.changed.clear(); return out; }

  static load(s: WorldSave): TileStore {
    if (s.version !== 1) throw new Error(`unknown save version ${s.version}`);
    const st = new TileStore(s.seed, s.size);
    st.next = s.next;
    // nodes before the roads between them, and edits last so their targets are known
    const order = { node: 0, claim: 1, zone: 1, seg: 2, edit: 3 } as const;
    const all = Object.values(s.tiles).flatMap((t) => t.owned).sort((a, b) => order[a.kind] - order[b.kind] || byId(a, b));
    for (const r of all) st.put(structuredClone(r));
    st.changed.clear();
    return st;
  }
}

// ---------- the prototype's network ----------
// Structural types, so this file doesn't pull the renderer-facing roads.ts into workers.
interface NetLike {
  nodes: Map<number, { id: number; x: number; z: number; y: number }>;
  segs: Map<number, { id: number; a: number; b: number; mid: XYZ[]; type: string; stops: unknown[] }>;
}
// Copy the prototype's road graph (roads.ts Network) into the store: node 5 becomes "n5",
// segment 9 becomes "s9". Returns every tile touched.
export function importNetwork(store: TileStore, net: NetLike): TileKey[] {
  const touched = new Set<TileKey>();
  // heights only where there are any, so saves stay small and JSON round trips are exact
  const pt = <T extends XZ>(p: T, y?: number) => (y ? { ...p, y } : p);
  for (const n of net.nodes.values()) for (const k of store.put(pt<NodeRec>({ kind: 'node', id: `n${n.id}`, x: n.x, z: n.z }, n.y))) touched.add(k);
  for (const s of net.segs.values()) {
    const rec: SegRec = { kind: 'seg', id: `s${s.id}`, a: `n${s.a}`, b: `n${s.b}`, mid: s.mid.map((p) => pt({ x: p.x, z: p.z }, p.y)), type: s.type };
    if (s.stops.length) rec.stops = structuredClone(s.stops);
    for (const k of store.put(rec)) touched.add(k);
  }
  return [...touched];
}
