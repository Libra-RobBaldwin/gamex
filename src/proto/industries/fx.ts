// Moving and changing parts of every industrial site in a scene, drawn with a handful of
// instanced meshes shared by all sites: stockpiles, log bundles, crates and containers, tank
// roofs, winding wheels, animals and weeds, smoke puffs, lamps and their glow. Nine draw calls
// in all, however many industries there are.
//
// Work is split by how often it changes. Stockpiles, lamps, parked vehicles and decay are only
// recomputed when a site's state (or day and night) changes. Wheels, cranes, conveyors and smoke
// are recomputed at a low, fixed rate (12 Hz by default), and each is a pure function of the
// clock, so nothing accumulates frame by frame.
import * as THREE from 'three';
import { Kit, colour } from './kit';
import type { IndustryModel } from './models';
import { DEFAULT_STATE, pileLevel, type IndustryVisualState, type Pile } from './state';

// ---------------- unit shapes ----------------
function unit(build: (k: Kit) => void) {
  const k = new Kit();
  build(k);
  const g = k.toGeometry();
  g.deleteAttribute('color'); // coloured per instance instead
  return g;
}
const G = {
  // a rounded mound on a 1 x 1 base, height 1: rings of an octagon narrowing to a short ridge
  heap: () => unit((k) => {
    const rings: [number, number, number][] = [[0.5, 0.5, 0], [0.42, 0.4, 0.4], [0.3, 0.25, 0.75], [0.16, 0.06, 1]]; // half-width, half-depth, height
    const pt = (r: [number, number, number], i: number): [number, number, number] => { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; return [Math.cos(a) * r[0] * 1.08, r[2], Math.sin(a) * r[1] * 1.08]; };
    for (let j = 0; j + 1 < rings.length; j++) for (let i = 0; i < 8; i++) k.quad(pt(rings[j], i + 1), pt(rings[j], i), pt(rings[j + 1], i), pt(rings[j + 1], i + 1));
    k.flat(Array.from({ length: 8 }, (_, i) => { const q = pt(rings[3], i); return [q[0], q[2]] as [number, number]; }), 1);
  }),
  box: () => unit((k) => k.box(0, 0, 0, 1, 1, 1)),
  cyl: () => unit((k) => k.prism(0, 0, 0.5, 12, 0, 1)),
  // three rows of logs lying along z, a 3-2-1 pyramid filling a 1 x 1 x 1 cell
  logs: () => unit((k) => { for (const [x, y] of [[-1 / 3, 0], [0, 0], [1 / 3, 0], [-1 / 6, 0.29], [1 / 6, 0.29], [0, 0.58]]) k.at(x, 0, 0, () => { for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, b = ((i + 1) / 6) * Math.PI * 2, r = 0.17; k.quad([Math.cos(b) * r, y + 0.17 + Math.sin(b) * r, 0.5], [Math.cos(a) * r, y + 0.17 + Math.sin(a) * r, 0.5], [Math.cos(a) * r, y + 0.17 + Math.sin(a) * r, -0.5], [Math.cos(b) * r, y + 0.17 + Math.sin(b) * r, -0.5]); } }); }),
  // a winding wheel in the y-z plane, radius 1: rim, hub and four spokes
  wheel: () => unit((k) => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      for (const [r0, r1] of [[0.86, 1]]) {
        const P = (r: number, t: number, x: number): [number, number, number] => [x, Math.sin(t) * r, Math.cos(t) * r];
        k.quad(P(r1, a, 0.12), P(r1, b, 0.12), P(r1, b, -0.12), P(r1, a, -0.12));
        k.quad(P(r0, a, 0.12), P(r1, a, 0.12), P(r1, b, 0.12), P(r0, b, 0.12));
        k.quad(P(r1, a, -0.12), P(r0, a, -0.12), P(r0, b, -0.12), P(r1, b, -0.12));
      }
    }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI; k.at(0, 0, 0, () => { const c = Math.cos(a), s = Math.sin(a); k.quad([0.06, -s * 0.9, -c * 0.9], [0.06, s * 0.9, c * 0.9], [0.06, s * 0.9 + 0.08 * c, c * 0.9 - 0.08 * s], [0.06, -s * 0.9 + 0.08 * c, -c * 0.9 - 0.08 * s]); k.quad([-0.06, -s * 0.9 + 0.08 * c, -c * 0.9 - 0.08 * s], [-0.06, s * 0.9 + 0.08 * c, c * 0.9 - 0.08 * s], [-0.06, s * 0.9, c * 0.9], [-0.06, -s * 0.9, -c * 0.9]); }); }
  }),
  blob: () => new THREE.IcosahedronGeometry(0.5, 0),
  puff: () => new THREE.IcosahedronGeometry(0.5, 1),
  disc: () => new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2),
};

// ---------------- pools ----------------
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

class Pool {
  mesh: THREE.InstancedMesh;
  private free: number[] = [];
  private used = 0;
  dirty = false;
  constructor(public name: string, private geo: THREE.BufferGeometry, private mat: THREE.Material, private cap: number, private parent: THREE.Group, private shadow: boolean) {
    this.mesh = this.make(cap);
  }
  private make(cap: number) {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.name = `industry-fx-${this.name}`;
    m.frustumCulled = false; // instances move about; one bounding sphere would be wrong or huge
    m.castShadow = this.shadow;
    m.receiveShadow = this.shadow;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) { m.setMatrixAt(i, HIDE); m.setColorAt(i, white); }
    m.count = 0;
    this.parent.add(m);
    return m;
  }
  alloc() {
    const i = this.free.pop() ?? this.used++;
    if (i >= this.cap) {
      // grow by doubling, copying what's there
      const old = this.mesh, next = this.make(this.cap * 2);
      next.instanceMatrix.array.set(old.instanceMatrix.array);
      next.instanceColor!.array.set(old.instanceColor!.array);
      this.parent.remove(old);
      old.dispose();
      this.mesh = next;
      this.cap *= 2;
    }
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    return i;
  }
  release(i: number) { this.mesh.setMatrixAt(i, HIDE); this.free.push(i); this.dirty = true; }
  set(i: number, m: THREE.Matrix4, c?: THREE.Color) {
    this.mesh.setMatrixAt(i, m);
    if (c) { this.mesh.setColorAt(i, c); this.mesh.instanceColor!.needsUpdate = true; }
    this.dirty = true;
  }
  hide(i: number) { this.mesh.setMatrixAt(i, HIDE); this.dirty = true; }
  flush() { if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; } }
  get live() { return this.used - this.free.length; }
}

type PoolName = 'heap' | 'box' | 'cyl' | 'logs' | 'wheel' | 'blob' | 'puff' | 'lamp' | 'glow';

// ---------------- per-site handle ----------------
interface Slot { pool: PoolName; i: number }
export interface FxHandle {
  model: IndustryModel;
  world: THREE.Matrix4;
  state: IndustryVisualState;
  piles: Slot[][]; // instances per pile
  rotors: { slots: Slot[]; angle: number }[];
  emitters: Slot[][];
  movers: Slot[][];
  lamps: { lamp: Slot; glow: Slot | null }[];
  berths: Slot[][];
  decay: Slot[];
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();
const frac = (x: number) => x - Math.floor(x);
const hash01 = (n: number) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);

// local transform: translate, turn (yaw, then roll about local x, then pitch about local z), scale
function trs(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, roll = 0, pitch = 0) {
  _e.set(roll, yaw, pitch, 'YXZ');
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

export interface FxOptions { hz?: number }

export class IndustryFx {
  readonly group = new THREE.Group();
  private pools: Record<PoolName, Pool>;
  private handles = new Set<FxHandle>();
  private night = 0;
  private last = -Infinity;
  private prevTime = 0;
  hz: number;

  constructor(opts: FxOptions = {}) {
    this.hz = opts.hz ?? 12;
    this.group.name = 'industry-fx';
    const lit = () => new THREE.MeshLambertMaterial({ color: 0xffffff });
    const puffMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    const P = (n: PoolName, g: THREE.BufferGeometry, m: THREE.Material, cap: number, shadow: boolean) => new Pool(n, g, m, cap, this.group, shadow);
    this.pools = {
      heap: P('heap', G.heap(), lit(), 64, true),
      box: P('box', G.box(), lit(), 512, true),
      cyl: P('cyl', G.cyl(), lit(), 64, false),
      logs: P('logs', G.logs(), lit(), 128, true),
      wheel: P('wheel', G.wheel(), lit(), 32, true),
      blob: P('blob', G.blob(), lit(), 256, true),
      puff: P('puff', G.puff(), puffMat, 256, false),
      lamp: P('lamp', G.box(), lampMat, 128, false),
      glow: P('glow', G.disc(), glowMat, 64, false),
    };
    this.pools.glow.mesh.renderOrder = 2;
    this.pools.puff.mesh.renderOrder = 3;
  }

  get drawCalls() { return Object.keys(this.pools).length; }
  stats() { return { drawCalls: this.drawCalls, sites: this.handles.size, instances: Object.fromEntries(Object.entries(this.pools).map(([k, p]) => [k, p.live])) }; }
  // For tests and debugging: the world matrix of one instance.
  matrixOf(slot: Slot, out = new THREE.Matrix4()) { this.pools[slot.pool].mesh.getMatrixAt(slot.i, out); return out; }

  add(model: IndustryModel, state: IndustryVisualState = DEFAULT_STATE): FxHandle {
    const A = (pool: PoolName): Slot => ({ pool, i: this.pools[pool].alloc() });
    const d = model.dyn;
    const world = new THREE.Matrix4().compose(new THREE.Vector3(model.frame.cx, 0, model.frame.cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -model.frame.rot), new THREE.Vector3(1, 1, 1));
    const h: FxHandle = {
      model, world, state,
      piles: d.piles.map((p) => {
        const n = p.kind === 'heap' || p.kind === 'tank' ? 1 : p.kind === 'logs' ? (p.slots ?? 6) : p.kind === 'stack' ? (p.slots ?? 6) * (p.layers ?? 3) : (p.slots ?? 8);
        const pool: PoolName = p.kind === 'heap' ? 'heap' : p.kind === 'tank' ? 'cyl' : p.kind === 'logs' ? 'logs' : p.kind === 'herd' ? 'blob' : 'box';
        return Array.from({ length: n }, () => A(pool));
      }),
      rotors: d.rotors.map((r) => ({ slots: r.kind === 'wheel' ? [A('wheel')] : [A('box'), A('box')], angle: 0 })),
      emitters: d.emitters.map((e) => Array.from({ length: e.puffs }, () => A('puff'))),
      movers: d.movers.map((m) => (m.kind === 'jib' ? [A('box'), A('box')] : m.kind === 'gantry' ? [A('box'), A('box')] : Array.from({ length: Math.max(2, Math.floor(m.len / 6)) }, () => A('box')))),
      lamps: d.lamps.map((l) => ({ lamp: A('lamp'), glow: l.glow > 0 ? A('glow') : null })),
      berths: d.berths.map((b) => (b.kind === 'lorry' ? [A('box'), A('box')] : b.kind === 'ship' ? [A('box'), A('box'), A('box')] : [A('box')])),
      decay: d.decay.map(() => A('blob')),
    };
    this.handles.add(h);
    this.setState(h, state);
    this.animate(h, this.prevTime, 0);
    this.flush();
    return h;
  }

  remove(h: FxHandle) {
    const rel = (s: Slot) => this.pools[s.pool].release(s.i);
    h.piles.flat().forEach(rel); h.rotors.forEach((r) => r.slots.forEach(rel)); h.emitters.flat().forEach(rel); h.movers.flat().forEach(rel);
    h.lamps.forEach((l) => { rel(l.lamp); if (l.glow) rel(l.glow); }); h.berths.flat().forEach(rel); h.decay.forEach(rel);
    this.handles.delete(h);
    this.flush();
  }

  // the site whose parts are being placed; local matrices are relative to it
  private cur!: FxHandle;
  private put(slot: Slot, local: THREE.Matrix4, c?: THREE.Color) {
    this.pools[slot.pool].set(slot.i, local.premultiply(this.cur.world), c);
  }
  private hide(slot: Slot) { this.pools[slot.pool].hide(slot.i); }

  // ---------------- state-driven parts ----------------
  setState(h: FxHandle, state: IndustryVisualState) {
    h.state = state;
    this.cur = h;
    const d = h.model.dyn;
    d.piles.forEach((p, k) => this.drawPile(p, h.piles[k], pileLevel(p, state)));
    this.drawLamps(h);
    // a lorry in the bay, wagons in the siding and a ship at the quay while traffic is coming and going
    const busy = state.recentlyDelivered && (state.neglect ?? 0) < 0.6;
    d.berths.forEach((b, k) => {
      const sl = h.berths[k];
      if (!busy || (b.kind !== 'ship' && hash01(k * 3.1 + h.model.frame.cx) > 0.7)) { sl.forEach((s) => this.hide(s)); return; }
      const col = colour(['#2f6fb8', '#c8452f', '#e8e6e0', '#3f7a4a', '#d69a2d'][Math.floor(hash01(k + 9) * 5)]);
      if (b.kind === 'lorry') {
        // the bay's local frame has the lorry nosing out towards the road (+z)
        const c = Math.cos(b.rot), s = Math.sin(b.rot), off = (dz: number) => [b.x + dz * s, b.z + dz * c];
        const [tx, tz] = off(-1.2), [cx, cz] = off(5);
        this.put(sl[0], trs(tx, 0.4, tz, b.rot, 2.5, 3.2, 9.5), col);
        this.put(sl[1], trs(cx, 0.4, cz, b.rot, 2.5, 2.8, 2.4), colour('#e8e6e0'));
      } else if (b.kind === 'wagon') {
        this.put(sl[0], trs(b.x, 0.9, b.z, b.rot, b.len - 1, 2.6, 2.8), colour('#5a4a3a'));
      } else {
        this.put(sl[0], trs(b.x, -1, b.z, 0, b.len, 5, 14), colour('#2d3a4a'));
        this.put(sl[1], trs(b.x - b.len * 0.38, 4, b.z, 0, 10, 8, 12), colour('#ecebe4'));
        this.put(sl[2], trs(b.x + 4, 4, b.z, 0, b.len * 0.5, 2.6, 12), colour('#b0463a'));
      }
    });
    // weeds and rubble come in as the site is left unserved
    const neg = Math.max(0, ((state.neglect ?? 0) - 0.3) / 0.7);
    d.decay.forEach((q, k) => {
      if (neg <= 0.02) return this.hide(h.decay[k]);
      const weed = hash01(k * 7.7) < 0.7;
      const s = q.s * Math.min(1, neg * (0.6 + hash01(k) * 0.8));
      this.put(h.decay[k], trs(q.x, 0, q.z, k, s * (weed ? 1.8 : 1.4), s * (weed ? 0.9 : 0.4), s * (weed ? 1.6 : 1.2)), colour(weed ? (k % 3 ? '#5f7a3a' : '#7a7a45') : '#8a8378'));
    });
    this.animate(h, this.prevTime, 0);
    this.flush();
  }

  private drawPile(p: Pile, slots: Slot[], f: number) {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const at = (lx: number, lz: number) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
    if (p.kind === 'heap') {
      // a loose pile keeps its angle of repose, so every dimension grows with the cube root of volume
      if (f < 0.01) return this.hide(slots[0]);
      const k = Math.cbrt(f);
      this.put(slots[0], trs(p.x, 0.04, p.z, p.rot, p.w * k, p.h * k, p.d * k), colour(p.colour));
    } else if (p.kind === 'tank') {
      // the floating roof or grain surface sits at the level of what's inside
      const y = (p.y ?? 0) + Math.max(0.05, f) * p.h;
      this.put(slots[0], trs(p.x, y, p.z, 0, p.w, 0.3, p.d), colour(p.colour));
    } else if (p.kind === 'logs') {
      const n = slots.length, cw = p.w / n, fill = f * n;
      slots.forEach((sl, i) => {
        const t = Math.max(0, Math.min(1, fill - i));
        if (t < 0.05) return this.hide(sl);
        const [x, z] = at(-p.w / 2 + cw * (i + 0.5), 0);
        this.put(sl, trs(x, 0.05, z, p.rot, cw * 0.95, p.h * t, p.d), _c.set(p.colour).multiplyScalar(0.9 + hash01(i) * 0.2));
      });
    } else if (p.kind === 'stack') {
      const n = p.slots ?? 6, L = p.layers ?? 3, cw = p.w / n, show = Math.round(f * n * L);
      slots.forEach((sl, idx) => {
        if (idx >= show) return this.hide(sl);
        const i = idx % n, layer = Math.floor(idx / n);
        const [x, z] = at(-p.w / 2 + cw * (i + 0.5), 0);
        const col = p.palette ? colour(p.palette[Math.floor(hash01(idx * 1.3 + p.x) * p.palette.length)]) : _c.set(p.colour).multiplyScalar(0.88 + hash01(idx) * 0.24);
        this.put(sl, trs(x, 0.05 + layer * p.h, z, p.rot, cw * 0.9, p.h * 0.96, p.d * 0.94), col);
      });
    } else {
      // herd: animals stand about the field; the more stock, the more there are
      const show = Math.round(f * slots.length);
      slots.forEach((sl, i) => {
        if (i >= show) return this.hide(sl);
        const [x, z] = at((hash01(i * 2.3 + p.x) - 0.5) * p.w, (hash01(i * 5.9 + p.z) - 0.5) * p.d);
        const col = colour(hash01(i * 1.7) < 0.55 ? p.colour : hash01(i) < 0.5 ? '#3b2f2a' : '#8a5a3a');
        this.put(sl, trs(x, 0.6, z, hash01(i) * 6, 2.8, 1.5, 1.3), col); // drawn half as big again, or they vanish from above
      });
    }
  }

  // Lamps glow at night while there's anyone on site: sodium orange before 2000, white LEDs after.
  private drawLamps(h: FxHandle) {
    this.cur = h;
    const on = this.night > 0.05 && (h.state.neglect ?? 0) < 0.6 && (h.state.running || h.state.production > 0);
    const warm = h.state.year < 2000 ? '#ffb347' : '#f4f1e0';
    const lampCol = on ? colour(warm) : colour('#4a4d52');
    h.model.dyn.lamps.forEach((l, k) => {
      const s = h.lamps[k];
      this.put(s.lamp, trs(l.x, l.y, l.z, 0, 0.7, 0.35, 0.7), lampCol);
      if (s.glow) {
        if (!on) this.hide(s.glow);
        else this.put(s.glow, trs(l.x, 0.14, l.z, 0, l.glow * this.night, 1, l.glow * this.night), colour(warm));
      }
    });
  }

  // 0 = day, 1 = full night.
  setNight(n: number) {
    if (Math.abs(n - this.night) < 0.01) return;
    this.night = n;
    for (const h of this.handles) this.drawLamps(h);
    this.flush();
  }

  // ---------------- clock-driven parts ----------------
  // Call every frame with the time in seconds; the work only happens `hz` times a second.
  update(time: number) {
    if (time - this.last < 1 / this.hz) return false;
    const dt = Math.min(0.5, this.last === -Infinity ? 0 : time - this.last);
    this.last = time;
    this.prevTime = time;
    for (const h of this.handles) this.animate(h, time, dt);
    this.flush();
    return true;
  }

  private animate(h: FxHandle, t: number, dt: number) {
    this.cur = h;
    const st = h.state, d = h.model.dyn;
    const live = st.running && st.production > 0 && (st.neglect ?? 0) < 0.6;
    const pace = live ? 0.5 + Math.min(4, st.production) / 4 : 0;
    d.rotors.forEach((r, k) => {
      const R = h.rotors[k];
      R.angle += r.speed * pace * dt;
      if (r.kind === 'wheel') this.put(R.slots[0], trs(r.x, r.y, r.z, r.rot, r.r, r.r, r.r, R.angle), colour(r.colour));
      else {
        // pumpjack: the walking beam rocks about the samson post, the horse head at its front end
        const tilt = Math.sin(R.angle) * 0.3, c = Math.cos(r.rot), s = Math.sin(r.rot);
        this.put(R.slots[0], trs(r.x, r.y, r.z, r.rot, r.r * 2, 0.5, 0.5, 0, tilt), colour(r.colour));
        const hx = r.r * Math.cos(tilt), hy = r.r * Math.sin(tilt);
        this.put(R.slots[1], trs(r.x + hx * c, r.y + hy - 1, r.z - hx * s, r.rot, 0.6, 1.8, 0.6), colour('#2b2b2b'));
      }
    });
    const sooty = st.year < 1960;
    d.emitters.forEach((e, k) => {
      const slots = h.emitters[k];
      if (!live) { slots.forEach((s) => this.hide(s)); return; }
      const n = slots.length, speed = e.kind === 'flame' ? 1.8 : 0.12 + 0.05 * pace;
      const col = colour(e.kind === 'steam' ? '#f4f4f2' : e.kind === 'flame' ? '#ff8a2a' : sooty ? '#3b3936' : '#9a9690');
      slots.forEach((sl, i) => {
        const ph = frac(t * speed + i / n + hash01(k));
        const grow = e.kind === 'flame' ? 1 - ph : 0.7 + ph * 2.4;
        const fade = ph < 0.8 ? 1 : (1 - ph) / 0.2;
        const size = e.r * grow * fade * (0.7 + 0.1 * Math.min(4, st.production));
        const drift = ph * e.rise * 0.45; // the wind carries it off towards +x
        this.put(sl, trs(e.x + drift, e.y + ph * e.rise, e.z + drift * 0.3, i, size * 1.3, size, size * 1.2), col);
      });
    });
    d.movers.forEach((m, k) => {
      const sl = h.movers[k];
      const c = Math.cos(m.rot), s = Math.sin(m.rot);
      if (m.kind === 'jib') {
        const yaw = m.rot + (live ? Math.sin(t * 0.25 + m.phase * 6) * 1.1 : 0);
        const cy = Math.cos(yaw), sy = Math.sin(yaw), mid = m.len / 2 - 2;
        this.put(sl[0], trs(m.x + mid * cy, m.y, m.z - mid * sy, yaw, m.len, 1.1, 1.2), colour(m.colour));
        const u = m.len * (0.55 + 0.3 * Math.sin(t * 0.4 + m.phase * 4)), lift = live ? 3 + 2.5 * Math.sin(t * 0.6 + m.phase) : 4;
        this.put(sl[1], trs(m.x + u * cy, m.y - lift - 1.4, m.z - u * sy, yaw, 1.8, 1.4, 1.8), colour('#3a3a3a'));
      } else if (m.kind === 'gantry') {
        // the trolley runs out over the ship and back; its box drops to the deck and rises again
        const ph = live ? frac(t * 0.05 + m.phase) : 0.1, u = m.len * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2));
        const drop = live ? Math.max(0, Math.sin(ph * Math.PI * 4)) * (m.y * 0.7) : 0;
        const ux = u * c, uz = -u * s; // along the crane's rot: out towards the water
        this.put(sl[0], trs(m.x + ux, m.y + 1.2, m.z + uz, m.rot, 3, 1.4, 3), colour(m.colour));
        this.put(sl[1], trs(m.x + ux, m.y - 3 - drop, m.z + uz, m.rot, 6, 2.6, 2.4), colour(m.load ?? '#2f6f9e'));
      } else {
        const n = sl.length;
        sl.forEach((q, i) => {
          if (!live) return this.hide(q);
          const u = frac(t * 0.08 * pace + i / n + m.phase) * m.len;
          this.put(q, trs(m.x + u * c, m.y + (m.rise ?? 0) * (u / m.len), m.z - u * s, m.rot, 1.2, 0.5, 1.2), colour(m.load ?? '#444'));
        });
      }
    });
  }

  private flush() { for (const p of Object.values(this.pools)) p.flush(); }

  dispose() {
    for (const p of Object.values(this.pools)) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); (p.mesh.material as THREE.Material).dispose(); p.mesh.dispose(); }
    this.handles.clear();
  }
}
