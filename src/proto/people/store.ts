// The crowd store: groups of figures (a bus queue, a footway's walkers, a park's dog walkers),
// each built lazily from a seed the first time it's near enough to see, drawn as instances.
// Every frame it decides, per group, how detailed to draw it (from how tall a person would
// be on screen), trims to the budget nearest the middle of the view first, and fades groups
// in and out rather than popping. Per-frame work is a projection per group and a small copy
// of per-group numbers; the figures themselves are placed and animated on the GPU.
import * as THREE from 'three';
import { bike, bird, personCard, personMid, personNear, pushchair, quadruped, triangles, wheelchair } from './geometry';
import { ATTRS, STRIDE, makeMaterials, makeUniforms, type Kind } from './shaders';
import { Mode, NO_FADE_IN, NO_FADE_OUT, LEG_FIRST, LEG_LAST, type Motion, type Route } from './track';
import { Carry, Prop, type Look } from './wardrobe';
import type { XZ } from './util';

// Records are grouped by what draws them.
export type Cat = 'people' | 'bike' | 'pushchair' | 'wheelchair' | 'pets' | 'stock' | 'birds';
const CATS: Cat[] = ['people', 'bike', 'pushchair', 'wheelchair', 'pets', 'stock', 'birds'];
// which mesh draws a category at each level of detail (near, middle, far)
const DRAW: Record<Cat, (Kind | null)[]> = {
  people: ['person', 'personMid', 'card'],
  bike: ['bike', 'bike', null], pushchair: ['pushchair', 'pushchair', null], wheelchair: ['wheelchair', 'wheelchair', null],
  pets: ['animal', 'animalMid', null], stock: ['animal', 'animalMid', 'animalMid'], birds: ['bird', null, null],
};

// A growable array of instance records (STRIDE floats each) and each record's figure index.
export class RecBuf {
  data = new Float32Array(STRIDE * 8);
  idx = new Float32Array(8);
  n = 0;
  version = 0;
  sorted = true; // records in figure order (so the first c figures are a prefix)
  private grow() {
    const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d;
    const i = new Float32Array(this.idx.length * 2); i.set(this.idx); this.idx = i;
  }
  push(k: number, f: ArrayLike<number>) {
    if (this.n >= this.idx.length) this.grow();
    if (this.n && k < this.idx[this.n - 1]) this.sorted = false;
    this.data.set(f, this.n * STRIDE);
    this.idx[this.n++] = k;
    this.version++;
  }
  clear() { this.n = 0; this.version++; this.sorted = true; }
  // how many records belong to figures numbered below c
  upTo(c: number) {
    if (!this.sorted) return this.n;
    let lo = 0, hi = this.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.idx[m] < c) lo = m + 1; else hi = m; }
    return lo;
  }
}
export type Bufs = Record<Cat, RecBuf>;
const newBufs = (): Bufs => Object.fromEntries(CATS.map((c) => [c, new RecBuf()])) as Bufs;

// ---------- writing figures ----------
const rec = new Float32Array(STRIDE);
function legRecord(route: Route, i: number, m: Motion, flags: number) {
  const l = route.legs[i];
  const f = (i === 0 ? LEG_FIRST : 0) | (i === route.legs.length - 1 ? LEG_LAST : 0) | flags;
  rec[0] = l.x; rec[1] = l.z; rec[2] = l.h; rec[3] = l.k;
  rec[4] = l.L; rec[5] = m.v; rec[6] = m.s0; rec[7] = m.lat;
  rec[8] = m.t0; rec[9] = m.tShow; rec[10] = m.tHide; rec[11] = m.mode;
  rec[12] = route.length; rec[13] = l.S; rec[14] = f; rec[15] = m.y;
}
// Which legs a figure can ever be on: a still figure is only on the leg holding it.
function legsFor(route: Route, m: Motion) {
  if (m.mode !== Mode.Still) return route.legs.map((_, i) => i);
  let i = route.legs.findIndex((l) => m.s0 < l.S + l.L);
  if (i < 0) i = route.legs.length - 1;
  return [i];
}
export function emitPerson(b: Bufs, k: number, route: Route, m: Motion, look: Look, phase: number, flags = 0) {
  for (const i of legsFor(route, m)) {
    legRecord(route, i, m, flags);
    rec[16] = look.height; rec[17] = look.build; rec[18] = look.idle; rec[19] = phase;
    rec[20] = look.top; rec[21] = look.bottom; rec[22] = look.skin; rec[23] = look.hairCol;
    rec[24] = look.hatCol; rec[25] = look.carryCol; rec[26] = look.trim; rec[27] = look.shoes;
    rec[28] = look.hair + 16 * look.hat; rec[29] = look.carry; rec[30] = look.prop; rec[31] = 0;
    b.people.push(k, rec);
    if (look.prop === Prop.Bike) b.bike.push(k, rec);
    else if (look.prop === Prop.Pushchair) b.pushchair.push(k, rec);
    else if (look.prop === Prop.Wheelchair) b.wheelchair.push(k, rec);
  }
}
export interface AnimalLook { species: number; size: number; idle: number; coat: number; second: number; pattern: number; dark: number }
export function emitAnimal(b: Bufs, k: number, route: Route, m: Motion, a: AnimalLook, phase: number, lead?: { lag: number; lat: number }, flags = 0) {
  for (const i of legsFor(route, m)) {
    legRecord(route, i, m, flags);
    rec[16] = a.size; rec[17] = a.species; rec[18] = a.idle; rec[19] = phase;
    rec[20] = a.coat; rec[21] = a.second; rec[22] = a.pattern; rec[23] = a.dark;
    rec[24] = rec[25] = rec[26] = rec[27] = 0;
    rec[28] = 0; rec[29] = 0; rec[30] = lead?.lag ?? 0; rec[31] = lead?.lat ?? 0;
    (a.species >= 9 ? b.stock : b.pets).push(k, rec);
  }
}
export interface BirdLook { species: number; size: number; idle: number; body: number; head: number; wing: number; beak: number }
export function emitBird(b: Bufs, k: number, route: Route, m: Motion, a: BirdLook, phase: number) {
  for (const i of legsFor(route, m)) {
    legRecord(route, i, m, 0);
    rec[16] = a.size; rec[17] = a.species; rec[18] = a.idle; rec[19] = phase;
    rec[20] = a.body; rec[21] = a.head; rec[22] = a.wing; rec[23] = a.beak;
    for (let j = 24; j < 32; j++) rec[j] = 0;
    b.birds.push(k, rec);
  }
}
export { NO_FADE_IN, NO_FADE_OUT, Carry };

// ---------- groups ----------
export interface GroupSpec {
  id: string;
  centre: XZ; radius: number; y?: number;
  count: number; // figures to show now (the first `count` by index); may be fractional
  build(b: Bufs): void; // fill the records, deterministically
  expires?: number; // drop the group after this time (transient crowds: boarders, alighters)
  // shown at full strength as soon as it's built, rather than faded in: people taking over from
  // others who were standing in the same places (the front of a queue walking to the bus)
  instant?: boolean;
}
interface Group {
  spec: GroupSpec; bufs: Bufs | null; shown: number; target: number; lod: number; keep: number; builtAt: number;
  dead: boolean; // removed from the store (its entries fade out as they're met)
  wasOn: boolean; cameOn: boolean; // on screen last frame; came on screen this frame
  keepE: number; // `keep`, eased, so figures over the far budget fade away rather than vanish
  slots: (Entry | undefined)[]; // its entry in each mesh, by mesh and category (see slotOf)
}

// Detail levels by how tall a person stands on screen, in CSS pixels, and how many figures each
// level may draw. Tie these to the game's adaptive quality tiers (see docs/people.md).
export interface Budget { name: string; nearPx: number; midPx: number; farPx: number; near: number; mid: number; far: number; shadows: boolean; buildsPerFrame: number }
export const BUDGETS: Budget[] = [
  { name: 'High', nearPx: 22, midPx: 7, farPx: 2.2, near: 1500, mid: 4000, far: 9000, shadows: true, buildsPerFrame: 24 },
  { name: 'Good', nearPx: 24, midPx: 7.5, farPx: 2.4, near: 1200, mid: 3000, far: 7000, shadows: true, buildsPerFrame: 20 },
  { name: 'Balanced', nearPx: 28, midPx: 8, farPx: 2.6, near: 800, mid: 2500, far: 5000, shadows: true, buildsPerFrame: 16 },
  { name: 'Fast', nearPx: 34, midPx: 10, farPx: 3, near: 500, mid: 1500, far: 3500, shadows: false, buildsPerFrame: 12 },
  { name: 'Fastest', nearPx: 44, midPx: 13, farPx: 3.5, near: 250, mid: 800, far: 2000, shadows: false, buildsPerFrame: 8 },
];

interface Entry { g: Group; cat: Cat; shown: number; hidden: number; version: number; n: number }
const KINDS: Kind[] = ['person', 'personMid', 'card', 'animal', 'animalMid', 'bird', 'bike', 'pushchair', 'wheelchair'];
const slotOf = (kind: Kind, cat: Cat) => KINDS.indexOf(kind) * CATS.length + CATS.indexOf(cat);
const needed = (e: Entry) => e.g.bufs![e.cat].upTo(Math.ceil(Math.min(Math.max(e.g.shown, e.g.target), Math.max(e.g.keep, e.g.keepE))));
class Batch {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  stat!: THREE.InstancedInterleavedBuffer;
  dyn!: THREE.InstancedBufferAttribute;
  cap = 0;
  entries: Entry[] = [];
  dirty = true;
  tris: number;
  constructor(public kind: Kind, geo: THREE.InstancedBufferGeometry, mats: { mat: THREE.Material; depth: THREE.Material }) {
    this.geo = geo;
    this.tris = triangles(geo);
    this.mesh = new THREE.Mesh(geo, mats.mat);
    this.mesh.customDepthMaterial = mats.depth;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = `people:${kind}`;
    this.alloc(256);
  }
  private alloc(n: number) {
    this.cap = n;
    this.stat = new THREE.InstancedInterleavedBuffer(new Float32Array(n * STRIDE), STRIDE, 1);
    this.stat.setUsage(THREE.DynamicDrawUsage);
    ATTRS.forEach((a, i) => this.geo.setAttribute(a, new THREE.InterleavedBufferAttribute(this.stat, 4, i * 4)));
    this.dyn = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.dyn.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iShow', this.dyn);
    // three.js works out how many instances a geometry can draw the first time it binds it and
    // keeps that; forget it so the larger buffers are used
    delete (this.geo as unknown as { _maxInstanceCount?: number })._maxInstanceCount;
  }
  // copy every entry's records into the instance buffer
  assemble() {
    // only the figures the group's count can show: the rest would cost a draw each for nothing
    let n = 0;
    for (const e of this.entries) { e.n = needed(e); n += e.n; }
    if (n > this.cap) { let c = this.cap; while (c < n) c *= 2; this.alloc(c); }
    const d = this.stat.array as Float32Array;
    let o = 0;
    for (const e of this.entries) {
      const rb = e.g.bufs![e.cat];
      d.set(rb.data.subarray(0, e.n * STRIDE), o * STRIDE);
      o += e.n;
      e.version = rb.version;
    }
    this.stat.needsUpdate = true;
    this.geo.instanceCount = n;
    this.dirty = false;
  }
  // the per-group numbers: how many to show, and the group's own fade in or out
  writeDynamic() {
    const d = this.dyn.array as Float32Array;
    let o = 0;
    for (const e of this.entries) {
      const rb = e.g.bufs![e.cat], c = Math.min(e.g.shown, e.g.keepE);
      for (let i = 0; i < e.n; i++, o++) { d[o * 4] = c; d[o * 4 + 1] = rb.idx[i]; d[o * 4 + 2] = e.shown; d[o * 4 + 3] = e.hidden; }
    }
    this.dyn.needsUpdate = true;
  }
}

export interface FigureNow { group: string; k: number; x: number; z: number; y: number; a: number; sr: number; moving: boolean; on: boolean; alpha: number; rec: Float32Array }
// The CPU twin of trackEval() in shaders.ts, for one record at offset o.
export function recordAt(d: Float32Array, o: number, t: number) {
  const x0 = d[o], z0 = d[o + 1], h = d[o + 2], k = d[o + 3], L = d[o + 4], v = d[o + 5], s0 = d[o + 6], lat = d[o + 7];
  const t0 = d[o + 8], tShow = d[o + 9], tHide = d[o + 10], mode = d[o + 11], Ltot = d[o + 12], S = d[o + 13], flags = d[o + 14], y = d[o + 15];
  let sr: number, moving: boolean;
  if (mode <= Mode.Closed) { sr = (((s0 + v * t) % Ltot) + Ltot) % Ltot; moving = v > 0.01; }
  else if (mode === Mode.Once) { const raw = s0 + v * Math.max(0, t - t0); sr = Math.min(raw, Ltot); moving = t > t0 && raw < Ltot && v > 0.01; }
  else { sr = s0; moving = false; }
  const s = sr - S;
  let on = true;
  if (s < 0) on = false;
  if (s >= L && !((flags & LEG_LAST) && mode >= Mode.Once)) on = false;
  const sc = Math.max(0, Math.min(L, s)), a = h + k * sc;
  let px: number, pz: number;
  if (Math.abs(k) < 1e-6) { px = x0 + Math.cos(h) * sc; pz = z0 + Math.sin(h) * sc; }
  else { px = x0 + (Math.sin(a) - Math.sin(h)) / k; pz = z0 + (Math.cos(h) - Math.cos(a)) / k; }
  px += Math.sin(a) * lat; pz -= Math.cos(a) * lat;
  const sm = (e0: number, e1: number, x: number) => { const q = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };
  let al = on ? 1 : 0;
  if (mode === Mode.Loop) al *= sm(0, 1.2, sr) * sm(0, 1.2, Ltot - sr);
  if (tHide > tShow) {
    al *= flags & NO_FADE_IN ? (t >= tShow ? 1 : 0) : sm(tShow, tShow + 0.6, t);
    al *= flags & NO_FADE_OUT ? (t < tHide ? 1 : 0) : 1 - sm(tHide - 0.5, tHide, t);
  }
  return { x: px, z: pz, y, a, sr, moving, on, alpha: al };
}

export interface StoreStats { groups: number; built: number; visible: number; instances: number; triangles: number; drawCalls: number; updateMs: number; byLod: [number, number, number] }

export class PeopleStore {
  readonly root = new THREE.Group();
  readonly uniforms = makeUniforms();
  private groups = new Map<string, Group>();
  private batches = new Map<Kind, Batch>();
  budget: Budget = BUDGETS[0];
  time = 0; // seconds of simulated time, as the shaders see it
  // Seconds of real time for fades and count easing. The game stops `time` while it's paused, but
  // zooming or panning still changes detail levels and brings new groups on screen, and those
  // fades have to finish or the new level would never show.
  fade = 0;
  forceLod?: number; // draw everything at one level of detail (for measuring)
  stats: StoreStats = { groups: 0, built: 0, visible: 0, instances: 0, triangles: 0, drawCalls: 0, updateMs: 0, byLod: [0, 0, 0] };
  private v = new THREE.Vector3();
  private m = new THREE.Matrix4();

  constructor() {
    this.root.name = 'people';
    const geos: Record<Kind, () => THREE.InstancedBufferGeometry> = {
      person: personNear, personMid, card: personCard, animal: () => quadruped(false), animalMid: () => quadruped(true), bird, bike, pushchair, wheelchair,
    };
    for (const kind of Object.keys(geos) as Kind[]) {
      const b = new Batch(kind, geos[kind](), makeMaterials(kind, this.uniforms));
      this.batches.set(kind, b);
      this.root.add(b.mesh);
    }
  }
  setBudget(b: Budget) {
    this.budget = b;
    for (const x of this.batches.values()) x.mesh.castShadow = b.shadows && x.kind !== 'card';
  }
  set rain(r: number) { this.uniforms.uRain.value = r; }
  get rain() { return this.uniforms.uRain.value; }

  add(spec: GroupSpec) {
    const old = this.groups.get(spec.id);
    if (old) { old.spec = spec; old.target = spec.count; if (old.bufs) { this.fill(old); } return; }
    this.groups.set(spec.id, { spec, bufs: null, shown: spec.count, target: spec.count, lod: 3, keep: Infinity, builtAt: 0, dead: false, wasOn: false, cameOn: false, keepE: 1e6, slots: new Array(KINDS.length * CATS.length) });
  }
  has(id: string) { return this.groups.has(id); }
  spec(id: string) { return this.groups.get(id)?.spec; }
  remove(id: string) {
    const g = this.groups.get(id);
    if (!g) return;
    this.groups.delete(id);
    g.dead = true;
    // its entries fade out over the next frames (see update), so a rebuilt footway cross-fades
    g.lod = 3;
  }
  // How many of a group to show. Changes ease in (a figure fades over about half a second)
  // unless `instant` (used when a queue re-forms after boarding).
  setCount(id: string, n: number, instant = false) {
    const g = this.groups.get(id);
    if (!g) return;
    g.target = g.spec.count = n;
    if (instant) g.shown = n;
  }
  // The group's records must be rebuilt (its spec changed shape, or its people moved).
  rebuild(id: string) { const g = this.groups.get(id); if (g?.bufs) this.fill(g); }
  private fill(g: Group) {
    for (const c of CATS) g.bufs![c].clear();
    g.spec.build(g.bufs!);
    g.builtAt = this.fade;
  }
  ids() { return [...this.groups.keys()]; }

  // Move the time origin back so float precision holds on long sessions: every stored time and
  // looping offset is shifted by T, which leaves every figure exactly where it was.
  private rebase(T: number) {
    for (const g of this.groups.values()) {
      if (g.spec.expires !== undefined) g.spec.expires -= T;
      if (!g.bufs) continue;
      for (const c of CATS) {
        const rb = g.bufs[c], d = rb.data;
        for (let i = 0; i < rb.n; i++) {
          const o = i * STRIDE, mode = d[o + 11];
          if (mode <= Mode.Closed) d[o + 6] = (((d[o + 6] + d[o + 5] * T) % d[o + 12]) + d[o + 12]) % d[o + 12];
          d[o + 8] -= T; d[o + 9] -= T; d[o + 10] -= T;
        }
        rb.version++;
      }
    }
    this.time -= T;
    this.onRebase?.(T);
  }
  onRebase?: (T: number) => void;
  // the same for the fade clock
  private rebaseFade(T: number) {
    for (const b of this.batches.values()) for (const e of b.entries) { e.shown -= T; if (e.hidden > 0) e.hidden -= T; }
    for (const g of this.groups.values()) g.builtAt -= T;
    this.fade -= T;
  }

  // Once a frame: advance time, choose detail and budget, update instance buffers. `dt` moves
  // everyone on (0 while the game is paused); `fadeDt`, real time, runs the fades and eases counts.
  update(camera: THREE.Camera, cssH: number, dt: number, fadeDt = dt) {
    const t0 = performance.now();
    this.time += dt;
    this.fade += fadeDt;
    if (this.time > 8192) this.rebase(4096);
    if (this.fade > 8192) this.rebaseFade(4096);
    const now = this.time, fnow = this.fade;
    this.uniforms.uTime.value = now;
    this.uniforms.uFade.value = fnow;
    camera.updateMatrixWorld();
    this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const B = this.budget;
    // 1. what's on screen, and how big a person there looks
    // (this runs every frame, so it reuses its working objects rather than leaving garbage behind)
    const vis = this.vis;
    let nv = 0;
    for (const g of this.groups.values()) {
      if (g.spec.expires !== undefined && now > g.spec.expires) { this.remove(g.spec.id); continue; }
      const c = g.spec.centre, y = g.spec.y ?? 0;
      this.v.set(c.x, y, c.z).applyMatrix4(this.m);
      const nx = this.v.x, ny = this.v.y, nz = this.v.z;
      this.v.set(c.x, y + 1.75, c.z).applyMatrix4(this.m);
      const ph = Math.abs(this.v.y - ny) * cssH * 0.5;
      // the group's radius in screen terms, measured sideways so it doesn't depend on tilt
      this.v.set(c.x + g.spec.radius, y, c.z).applyMatrix4(this.m);
      const rx = Math.hypot(this.v.x - nx, this.v.y - ny);
      this.v.set(c.x, y, c.z + g.spec.radius).applyMatrix4(this.m);
      const r = Math.max(rx, Math.hypot(this.v.x - nx, this.v.y - ny)) + 0.08;
      const on = nz > -1 && nz < 1 && nx > -1 - r && nx < 1 + r && ny > -1 - r && ny < 1 + r;
      if (!on || Math.max(g.target, g.shown) <= 0.001) { g.lod = 3; g.wasOn = on; continue; }
      g.cameOn = !g.wasOn; g.wasOn = true;
      let v = vis[nv];
      if (!v) vis.push((v = { g, ph, pri: 0 }));
      v.g = g; v.ph = ph; v.pri = nx * nx + ny * ny;
      nv++;
    }
    for (let i = nv; i < vis.length && vis[i].g; i++) vis[i].g = null; // (let go of groups since removed)
    // 2. detail by size (with a little hysteresis), then budgets from the middle of the view out
    // (an insertion sort of the ones on screen: from one frame to the next their order hardly changes)
    for (let i = 1; i < nv; i++) { const x = vis[i]; let j = i - 1; while (j >= 0 && vis[j].pri > x.pri) { vis[j + 1] = vis[j]; j--; } vis[j + 1] = x; }
    const used = this.stats.byLod, cap = [B.near, B.mid, B.far];
    used[0] = used[1] = used[2] = 0;
    let builds = 0;
    for (let i = 0; i < nv; i++) {
      const { ph } = vis[i], g = vis[i].g!, was = g.lod;
      let lod = this.forceLod ?? (ph >= B.nearPx * (was <= 0 ? 0.9 : 1.1) ? 0 : ph >= B.midPx * (was <= 1 ? 0.9 : 1.1) ? 1 : ph >= B.farPx * (was <= 2 ? 0.9 : 1.1) ? 2 : 3);
      const n = Math.ceil(Math.max(g.target, g.shown));
      while (lod < 2 && used[lod] + n > cap[lod]) lod++;
      g.keep = Infinity;
      if (lod === 2 && used[2] + n > cap[2]) { g.keep = Math.max(0, cap[2] - used[2]); if (g.keep === 0) lod = 3; }
      if (lod < 3 && !g.bufs) {
        if (builds >= B.buildsPerFrame) { lod = 3; } else { g.bufs = newBufs(); this.fill(g); builds++; }
      }
      if (lod < 3) used[lod] += Math.min(n, g.keep);
      g.lod = lod;
    }
    // ease shown counts towards their targets
    for (const g of this.groups.values()) {
      const k = Math.min(g.keep, 1e6), dk = k - g.keepE;
      if (dk !== 0) { const step = Math.max(2, Math.abs(dk) * 1.5) * fadeDt; g.keepE = Math.abs(dk) <= step ? k : g.keepE + Math.sign(dk) * step; }
      const d = g.target - g.shown;
      if (d !== 0) { const step = Math.max(2, Math.abs(d) * 1.5) * fadeDt; g.shown = Math.abs(d) <= step ? g.target : g.shown + Math.sign(d) * step; }
    }
    // 3. membership of each mesh. A group is wanted in the mesh that draws each of its categories at
    // its level; one leaving a level fades out there as it fades in at the next.
    const wanted = (g: Group, cat: Cat, kind: Kind) => !g.dead && g.lod <= 2 && !!g.bufs && DRAW[cat][g.lod] === kind && g.bufs[cat].n > 0;
    for (const b of this.batches.values()) {
      const E = b.entries;
      let w = 0;
      for (let i = 0; i < E.length; i++) {
        const e = E[i], g = e.g;
        if (wanted(g, e.cat, b.kind)) {
          // back before it had faded out: fade in from as far as it had got
          if (e.hidden) { const h = e.hidden; e.hidden = 0; e.shown = fnow - (h > 0 ? Math.max(0, 0.6 - (fnow - h)) : 0); }
          if (e.version !== g.bufs![e.cat].version) b.dirty = true;
          // more figures wanted than copied, or far fewer: copy again
          const want = needed(e);
          if (want > e.n || want < e.n - 8) b.dirty = true;
        } else if (!e.hidden && (g.dead || g.wasOn)) { e.hidden = fnow; } // removed, too small or a new level: fade
        else if (!e.hidden) { e.hidden = -1; }
        // off screen: drop at once; otherwise keep until faded out
        if (e.hidden === 0 || (e.hidden > 0 && fnow - e.hidden < 0.65)) E[w++] = e;
        else if (g.slots[slotOf(b.kind, e.cat)] === e) g.slots[slotOf(b.kind, e.cat)] = undefined;
      }
      if (w !== E.length) { E.length = w; b.dirty = true; }
    }
    for (let i = 0; i < nv; i++) {
      const g = vis[i].g!;
      if (g.lod > 2 || !g.bufs) continue;
      for (const cat of CATS) {
        const kind = DRAW[cat][g.lod];
        if (!kind || !g.bufs[cat].n) continue;
        const si = slotOf(kind, cat);
        if (g.slots[si]) continue; // already there (perhaps fading back in)
        // groups that appear because they came on screen are already at full strength; those that
        // appear because the view zoomed or they were just built fade in
        const fresh = (g.builtAt === fnow || !g.cameOn) && !g.spec.instant;
        const e: Entry = { g, cat, shown: fresh || this.shownElsewhere(g, kind) ? fnow : fnow - 1, hidden: 0, version: -1, n: 0 };
        const b = this.batches.get(kind)!;
        b.entries.push(e);
        g.slots[si] = e;
        b.dirty = true;
      }
    }
    let inst = 0, tris = 0, calls = 0;
    for (const b of this.batches.values()) {
      if (b.dirty) b.assemble();
      if (b.entries.length) b.writeDynamic();
      b.mesh.visible = b.geo.instanceCount > 0;
      inst += b.geo.instanceCount;
      tris += b.geo.instanceCount * b.tris;
      if (b.mesh.visible) calls += b.mesh.castShadow ? 2 : 1;
    }
    let built = 0;
    for (const g of this.groups.values()) if (g.bufs) built++;
    const st = this.stats;
    st.groups = this.groups.size; st.built = built; st.visible = nv; st.instances = inst; st.triangles = tris; st.drawCalls = calls; st.updateMs = performance.now() - t0;
  }
  private vis: { g: Group | null; ph: number; pri: number }[] = [];
  // is this group being drawn at another level right now (so a new level should fade in)?
  private shownElsewhere(g: Group, kind: Kind) {
    for (let k = 0; k < KINDS.length; k++) {
      if (KINDS[k] === kind) continue;
      for (let c = 0; c < CATS.length; c++) { const e = g.slots[k * CATS.length + c]; if (e && e.hidden > 0) return true; }
    }
    return false;
  }
  // Where every figure in a category is now, worked out on the CPU exactly as the vertex shader
  // does (for tests, debugging and picking; the game never needs this per frame).
  figures(cat: Cat = 'people', t = this.time) {
    const out: FigureNow[] = [];
    for (const g of this.groups.values()) {
      if (!g.bufs) continue;
      const rb = g.bufs[cat];
      for (let i = 0; i < rb.n; i++) {
        const f = recordAt(rb.data, i * STRIDE, t);
        const a = f.alpha * Math.max(0, Math.min(1, g.shown - rb.idx[i]));
        if (f.on) out.push({ group: g.spec.id, k: rb.idx[i], ...f, alpha: a, rec: rb.data.subarray(i * STRIDE, (i + 1) * STRIDE) });
      }
    }
    return out;
  }
  // build every group now, whether or not it's on screen (tests)
  buildAll() { for (const g of this.groups.values()) if (!g.bufs) { g.bufs = newBufs(); this.fill(g); } }
  dispose() {
    for (const b of this.batches.values()) { b.geo.dispose(); (b.mesh.material as THREE.Material).dispose(); b.mesh.customDepthMaterial?.dispose(); }
  }
}
