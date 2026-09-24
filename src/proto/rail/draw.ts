// Drawing the railway (docs/rail.md): platforms, station buildings and footbridges, the track a
// station lays itself (its passing loop, the tracks round an island, a depot siding), UK colour-light
// signals showing their aspects, level-crossing barriers and lights, and the trains, their doors open
// on the platform side while they stand.
//
// Everything that doesn't move is merged into one mesh per material, rebuilt only when the railway
// changes (Railway.version); signal lamps, barrier arms and crossing lights are instanced, updated
// in place each frame. Platform tops, edge lines and ballast sit at distinct heights with their own
// polygon offsets, so nothing is coplanar with the ground, the track or each other.
import * as THREE from 'three';
import { makeBuilding } from '../buildgen';
import { RAIL_MATS, setTrackSkip } from '../roaddraw';
import { kerbOf } from '../catalog';
import { doorPositions as doorPositionsOf, platformSide } from '../vehicles/doors';
import type { Fleet, Dress } from '../game/fleet';
import type { Lot, RSeg } from '../roads';
import type { XZ } from '../land';
import { at, stationTracks, type P3, type Piece } from './track';
import type { Railway } from './railway';
import type { CrossingSite } from './crossing';
import type { Train } from './sim';

const off = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n });
const MAT = {
  platform: new THREE.MeshLambertMaterial({ color: '#b6b1a6' }),
  edge: new THREE.MeshLambertMaterial({ color: '#f2f0ea', ...off(2) }),
  yellow: new THREE.MeshLambertMaterial({ color: '#e8c33a', ...off(2) }),
  steel: new THREE.MeshLambertMaterial({ color: '#2e5a45' }),
  roof: new THREE.MeshLambertMaterial({ color: '#4b5157', side: THREE.DoubleSide }),
  panel: new THREE.MeshLambertMaterial({ color: '#d9d4c8' }),
  shed: new THREE.MeshLambertMaterial({ color: '#7d6a55' }),
  post: new THREE.MeshLambertMaterial({ color: '#3a3d42' }),
  head: new THREE.MeshLambertMaterial({ color: '#16181b' }),
  deck: new THREE.MeshLambertMaterial({ color: '#2f3134', ...off(4) }),
  // (a depot siding's ballast sits just under the running line's where they meet at the points)
  sidingBallast: new THREE.MeshLambertMaterial({ color: '#8f887c' }),
  arm: new THREE.MeshLambertMaterial({ color: '#f2f2f0' }),
  lamp: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
};
const LAMP = { off: new THREE.Color('#2a1a18'), red: new THREE.Color('#ff3b2f'), yellow: new THREE.Color('#ffc21a'), green: new THREE.Color('#35e06b'), amber: new THREE.Color('#ffb020') };
const RAIL_TOP = 0.44;

// triangles in world space, one bucket per material
class Geo {
  pos: number[] = [];
  tri(a: number[], b: number[], c: number[]) { this.pos.push(...a, ...b, ...c); }
  quad(a: number[], b: number[], c: number[], d: number[]) { this.tri(a, b, c); this.tri(a, c, d); }
  // a box rotated about the vertical, its base at y0
  box(x: number, y0: number, z: number, w: number, h: number, d: number, rot: number) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (i: number, j: number, y: number) => [x + c * i * (w / 2) - s * j * (d / 2), y, z + s * i * (w / 2) + c * j * (d / 2)];
    const y1 = y0 + h, b = [P(-1, -1, y0), P(1, -1, y0), P(1, 1, y0), P(-1, 1, y0)], t = [P(-1, -1, y1), P(1, -1, y1), P(1, 1, y1), P(-1, 1, y1)];
    this.quad(t[0], t[3], t[2], t[1]);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(b[i], b[j], t[j], t[i]); }
  }
  // a band either side of a line, between offsets l and r to its left, at a height over the line
  band(pts: P3[], l: number, r: number, y: number) {
    for (let i = 1; i < pts.length; i++) {
      const A = pts[i - 1], B = pts[i], L = Math.hypot(B.x - A.x, B.z - A.z) || 1, nx = (B.z - A.z) / L, nz = -(B.x - A.x) / L;
      this.quad([A.x + nx * l, A.y + y, A.z + nz * l], [A.x + nx * r, A.y + y, A.z + nz * r], [B.x + nx * r, B.y + y, B.z + nz * r], [B.x + nx * l, B.y + y, B.z + nz * l]);
    }
  }
  mesh(m: THREE.Material) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  }
}
// the quads above wind either way; the materials that need it are double-sided, the rest are
// boxes and bands seen from above, wound consistently (band: left to right, counter-clockwise from above)

export class RailDraw {
  readonly group = new THREE.Group();
  private statics = new THREE.Group();
  private built = -1;
  private sig: { key: number; x: number; y: number; z: number; rot: number }[] = [];
  private lamps: THREE.InstancedMesh | null = null;
  private lampState: Int8Array = new Int8Array(0);
  private arms: THREE.InstancedMesh | null = null;
  private xLights: THREE.InstancedMesh | null = null;
  private armState: number[] = [];
  private flash = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(private rw: Railway, private fleet: Fleet) {
    this.group.add(this.statics);
    // roaddraw leaves out the track where a station moves it over; we lay it here instead
    setTrackSkip((s: RSeg) => this.skips(s));
  }
  private skips(s: RSeg): [XZ, XZ][] {
    const out: [XZ, XZ][] = [];
    const rw = this.rw, tracks = rw.net.def(s).tracks === 2 ? 2 : 1;
    for (const w of rw.works()) {
      if (w.seg !== s.id || rw.graph.broken.has(w.id)) continue;
      const r = stationTracks(w, tracks).ramp;
      if (r <= 0) continue;
      const path = rw.net.path(s), a = at1(path, w.s0 - r), b = at1(path, w.s1 + r);
      out.push([a, b]);
    }
    return out;
  }

  // ---------- what doesn't move ----------
  sync() {
    if (this.built === this.rw.version) return false;
    this.built = this.rw.version;
    for (const c of [...this.statics.children]) { this.statics.remove(c); c.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); }); }
    const G = { platform: new Geo(), edge: new Geo(), yellow: new Geo(), steel: new Geo(), roof: new Geo(), panel: new Geo(), shed: new Geo(), post: new Geo(), head: new Geo(), deck: new Geo(), ballast: new Geo(), sidingBallast: new Geo(), sleeper: new Geo(), rail: new Geo() };
    const rw = this.rw, g = rw.graph;
    // the track stations lay: loops, the tracks round islands, depot sidings
    for (const p of g.pieces) {
      if (!p.curvy && p.depot === undefined) continue;
      const bal = p.depot !== undefined ? G.sidingBallast : G.ballast, yb = p.depot !== undefined ? 0.18 : 0.2;
      G.ballast === bal ? bal.band(p.pts, 2.4, -2.4, yb) : bal.band(p.pts, 2.2, -2.2, yb);
      track(G.sleeper, G.rail, p);
    }
    // the stations
    for (const [id, sh] of rw.shapes) {
      const st = rw.station(id);
      if (!st) continue;
      for (const pl of sh.platforms) platform(G, pl.edge, pl.back, pl.y);
      // the building, from the building kit, facing away from the track
      const b = sh.building, nx = Math.cos(b.rot + Math.PI / 2), nz = Math.sin(b.rot + Math.PI / 2);
      const side = (b.x - sh.mid.x) * nx + (b.z - sh.mid.z) * nz > 0 ? 1 : -1, fx = nx * side, fz = nz * side;
      const lot: Lot = { id: -id, x: b.x, z: b.z, rot: Math.atan2(-fx, fz), w: b.w, d: b.d, h: 8, kind: 'civic', arch: 'station', seg: 0, seed: ((id * 0.6180339) % 1), row: -id, front: 6, back: 0.5, px: 0, pw: b.w + 4 };
      const shape = makeBuilding(lot);
      shape.group.position.y = b.y;
      shape.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.statics.add(shape.group);
      if (sh.footbridge) footbridge(G, sh.footbridge.a, sh.footbridge.b, sh.footbridge.y, sh.footbridge.rot, sh.platforms[0]?.y ?? b.y + 1.3);
      if (sh.depot) { const d = sh.depot.shed; shed(G, d.x, d.y, d.z, d.w, d.d, d.rot); }
    }
    // level crossings: a deck of panels over the track where the road crosses it
    for (const c of rw.crossings) {
      const road = rw.net.segs.get(c.road), rail = rw.net.segs.get(c.rail);
      if (!road || !rail) continue;
      const kh = kerbOf(rw.net.def(road)), K = kerbOf(rw.net.def(rail)) + 0.4;
      const along = K / Math.max(0.3, c.sin);
      const pts: P3[] = [-along, along].map((t) => ({ x: c.x + c.rx * t, y: c.y, z: c.z + c.rz * t }));
      G.deck.band(pts, kh, -kh, 0.33);
    }
    const mats: [keyof typeof G, THREE.Material][] = [['platform', MAT.platform], ['edge', MAT.edge], ['yellow', MAT.yellow], ['steel', MAT.steel], ['roof', MAT.roof], ['panel', MAT.panel], ['shed', MAT.shed], ['post', MAT.post], ['head', MAT.head], ['deck', MAT.deck], ['ballast', RAIL_MATS.ballast], ['sidingBallast', MAT.sidingBallast], ['sleeper', RAIL_MATS.sleeper], ['rail', RAIL_MATS.rail]];
    // signals: a post and a head at the end of each block, on the driver's left
    this.sig = [];
    for (const s of rw.sim.signals()) {
      const p = g.pieces[s.piece], q = at(p, s.dir === 1 ? p.len - 1 : 1), hx = q.ux * s.dir, hz = q.uz * s.dir;
      // (the left of the way the train is going; a double line's signals stand outside its tracks)
      const lx = hz, lz = -hx, o = 2.9;
      const x = q.x + lx * o, z = q.z + lz * o;
      this.sig.push({ key: s.piece * 2 + (s.dir === 1 ? 1 : 0), x, y: q.y, z, rot: Math.atan2(hz, hx) });
      G.post.box(x, q.y, z, 0.16, 4.2, 0.16, 0);
      // the head faces the train coming towards it
      G.head.box(x, q.y + 3.2, z, 0.3, 1.25, 0.5, Math.atan2(hz, hx));
    }
    // the lamps: two a signal (the upper lights for a double yellow)
    this.dropInstanced();
    if (this.sig.length) {
      const geo = new THREE.SphereGeometry(0.11, 6, 4);
      this.lamps = new THREE.InstancedMesh(geo, MAT.lamp, this.sig.length * 2);
      this.sig.forEach((s, i) => {
        const bx = -Math.cos(s.rot) * 0.18, bz = -Math.sin(s.rot) * 0.18; // (on the face towards the train)
        for (const k of [0, 1]) { this.m4.makeTranslation(s.x + bx, s.y + 3.55 + k * 0.45, s.z + bz); this.lamps!.setMatrixAt(i * 2 + k, this.m4); this.lamps!.setColorAt(i * 2 + k, LAMP.off); }
      });
      this.lamps.computeBoundingSphere();
      this.group.add(this.lamps);
      this.lampState = new Int8Array(this.sig.length).fill(-1);
    }
    // crossing barriers (one arm each side, across the left-hand half of the road) and their lights
    const nx = rw.crossings.length;
    if (nx) {
      const armGeo = new THREE.BoxGeometry(1, 0.12, 0.12).translate(0.5, 0, 0);
      this.arms = new THREE.InstancedMesh(armGeo, MAT.arm, nx * 2);
      this.xLights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 4), MAT.lamp, nx * 6);
      rw.crossings.forEach((c, i) => {
        for (const e of [-1, 1] as const) {
          // a post at the kerb on each road's approach, its lights facing the traffic
          const P = gear(rw, c, e), k = (e + 1) / 2;
          G.post.box(P.x, c.y, P.z, 0.2, 2.6, 0.2, 0);
          for (let j = 0; j < 3; j++) {
            const w = j === 2 ? 0 : j ? 0.25 : -0.25;
            this.m4.makeTranslation(P.x + P.ox * 0.2 + P.lx * w, c.y + (j === 2 ? 2.55 : 2.25), P.z + P.oz * 0.2 + P.lz * w);
            this.xLights!.setMatrixAt(i * 6 + k * 3 + j, this.m4);
            this.xLights!.setColorAt(i * 6 + k * 3 + j, LAMP.off);
          }
        }
      });
      this.armState = new Array(nx).fill(-1);
      this.arms.computeBoundingSphere(); this.xLights.computeBoundingSphere();
      this.group.add(this.arms, this.xLights);
    }
    for (const [k, m] of mats) { const mesh = G[k].mesh(m); if (mesh) { mesh.castShadow = k !== 'edge' && k !== 'yellow' && k !== 'deck' && k !== 'ballast' && k !== 'sidingBallast' && k !== 'sleeper' && k !== 'rail'; this.statics.add(mesh); } }
    return true;
  }
  private dropInstanced() {
    for (const m of [this.lamps, this.arms, this.xLights]) if (m) { this.group.remove(m); m.geometry.dispose(); m.dispose(); }
    this.lamps = this.arms = this.xLights = null;
  }

  // ---------- each frame ----------
  frame(dt: number) {
    this.sync();
    const sim = this.rw.sim;
    this.flash = (this.flash + dt) % 1;
    // signals: red, yellow, double yellow or green
    if (this.lamps) {
      const asp = sim.aspects();
      let dirty = false;
      this.sig.forEach((s, i) => {
        const a = asp.get(s.key) ?? 0;
        if (this.lampState[i] === a) return;
        this.lampState[i] = a;
        const lo = a === 0 ? LAMP.red : a === 3 ? LAMP.green : LAMP.yellow, hi = a === 2 ? LAMP.yellow : LAMP.off;
        this.lamps!.setColorAt(i * 2, lo); this.lamps!.setColorAt(i * 2 + 1, hi);
        dirty = true;
      });
      if (dirty && this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    }
    // crossings: the arms come down, the red lights wig-wag
    if (this.arms && this.xLights) {
      const rw = this.rw;
      let armDirty = false;
      sim.crossings.forEach((c, i) => {
        const down = c.barrier;
        if (Math.abs(this.armState[i] - down) > 1e-3) {
          this.armState[i] = down;
          armDirty = true;
          for (const e of [-1, 1] as const) {
            // pivoting at the post, swinging down from upright to across the approaching traffic's half of the road
            const P = gear(rw, c.site, e);
            this.e.set(0, Math.atan2(-P.dz, P.dx), (1 - down) * (Math.PI / 2) * 0.97, 'YXZ');
            this.q.setFromEuler(this.e);
            this.m4.compose(this.v.set(P.x, c.site.y + 1.05, P.z), this.q, this.sc.set(P.half * 0.95, 1, 1));
            this.arms!.setMatrixAt(i * 2 + (e + 1) / 2, this.m4);
          }
        }
        const on = c.holding, amber = c.state === 'amber', wig = this.flash < 0.5;
        for (const k of [0, 1]) {
          this.xLights!.setColorAt(i * 6 + k * 3, on && !amber && wig ? LAMP.red : LAMP.off);
          this.xLights!.setColorAt(i * 6 + k * 3 + 1, on && !amber && !wig ? LAMP.red : LAMP.off);
          this.xLights!.setColorAt(i * 6 + k * 3 + 2, amber ? LAMP.amber : LAMP.off);
        }
      });
      if (armDirty) this.arms.instanceMatrix.needsUpdate = true;
      if (this.xLights.instanceColor) this.xLights.instanceColor.needsUpdate = true;
    }
  }

  // ---------- the trains (from traffic.onDraw, inside the fleet's frame) ----------
  drawTrains(dt: number) {
    const sim = this.rw.sim, fleet = this.fleet;
    for (const t of sim.trains) {
      const d = (t.dress ??= fleet.dressTrain(t.def)) as Dress;
      const n = d.chain.length, open = t.state === 'dwell' ? t.doors : 0;
      for (let i = 0; i < n; i++) {
        // (with the driver at the other end, the set runs backwards from the front)
        const mid = t.flipped ? d.length - d.offs![i] : d.offs![i];
        const half = Math.min(d.chain[i].dims.length * 0.35, 12);
        const f = sim.pose(t, mid - half), b = sim.pose(t, mid + half);
        const x = (f.x + b.x) / 2, z = (f.z + b.z) / 2, y = (f.y + b.y) / 2;
        let heading = Math.atan2(f.z - b.z, f.x - b.x);
        if (t.flipped) heading += Math.PI;
        const lead = t.flipped ? i === n - 1 : i === 0, tail = n > 1 && (t.flipped ? i === 0 : i === n - 1);
        // doors: open on the platform side, only on cars alongside the platform
        const id = `rail:${t.id}:${i}`;
        let doors: [number, number] = fleet.doors.get(id); // (paused: as they were)
        if (dt > 0) {
          const c = sim.pose(t, mid), p = sim.graph.pieces[c.piece], pl = p.plat;
          const u = c.dir === 1 ? c.u : p.len - c.u;
          const along = pl && u > pl.u0 + 2 && u < pl.u1 - 2;
          const real = heading + (d.flip?.[i] ? Math.PI : 0);
          const lx = c.uz * t.doorSide, lz = -c.ux * t.doorSide; // (the platform's side of the track, as the train faces)
          const side = platformSide({ x, z, heading: real }, { x: x + lx * 3, z: z + lz * 3 });
          fleet.doors.setDoors(id, open && along ? 1 : 0, side, { model: d.chain[i], delay: i * 0.25 });
          doors = fleet.doors.get(id);
        }
        fleet.drawRail(d, i, x, y, z, heading, Math.atan((f.grade + b.grade) / 2) * (t.flipped ? -1 : 1), t.v, dt, doors, lead, tail);
      }
    }
  }
  // Where a standing train's doors are, on the platform side: people board and alight through them.
  doorsOf(t: Train) {
    const d = t.dress as Dress | undefined, sim = this.rw.sim, out: { x: number; z: number }[] = [];
    if (!d) return out;
    for (let i = 0; i < d.chain.length; i++) {
      const mid = t.flipped ? d.length - d.offs![i] : d.offs![i], c = sim.pose(t, mid), p = sim.graph.pieces[c.piece], pl = p.plat;
      const u = c.dir === 1 ? c.u : p.len - c.u;
      if (!pl || u < pl.u0 + 2 || u > pl.u1 - 2) continue;
      const f = sim.pose(t, mid - 3), b = sim.pose(t, mid + 3);
      const real = Math.atan2(f.z - b.z, f.x - b.x) + (t.flipped ? Math.PI : 0) + (d.flip?.[i] ? Math.PI : 0);
      const lx = c.uz * t.doorSide, lz = -c.ux * t.doorSide;
      for (const dp of doorPositionsOf(d.chain[i], { x: c.x, z: c.z, heading: real }, { x: c.x + lx * 3, z: c.z + lz * 3 })) out.push({ x: dp.x, z: dp.z });
    }
    return out;
  }
  // everything the railway draws, for the draw-call count
  get calls() { let n = 0; this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) n++; }); return n; }
}

// Where a crossing's barrier post stands on one approach (e: the side of the track it's on, along
// the road): at the kerb on the left of traffic coming towards the track, with the way its arm
// comes down across the road (dx, dz), which way its lights face (ox, oz), and the half-width it closes.
function gear(rw: Railway, c: CrossingSite, e: 1 | -1) {
  const road = rw.net.segs.get(c.road), rail = rw.net.segs.get(c.rail);
  const kh = road ? kerbOf(rw.net.def(road)) : 3.5, K = (rail ? kerbOf(rw.net.def(rail)) : 2.4) + 1.2;
  const T = e * (K / Math.max(0.3, c.sin) + 0.6);
  // traffic on this approach heads -e along the road; its left is (uz, -ux)
  const lx = -e * c.rz, lz = e * c.rx;
  return { x: c.x + c.rx * T + lx * (kh + 0.4), z: c.z + c.rz * T + lz * (kh + 0.4), dx: -lx, dz: -lz, ox: e * c.rx, oz: e * c.rz, lx, lz, half: kh };
}

function at1(path: { x: number; z: number }[], s: number): XZ {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const L = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    if (acc + L >= s || i === path.length - 1) { const t = Math.max(0, Math.min(1, (s - acc) / (L || 1))); return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, z: path[i - 1].z + (path[i].z - path[i - 1].z) * t }; }
    acc += L;
  }
  return { x: path[0].x, z: path[0].z };
}
// sleepers and rails along a piece
function track(sl: Geo, rl: Geo, p: Piece) {
  // (the same sizes as roaddraw's: 0.26 m sleepers every 0.68 m, 2.6 m long; rails 1.44 m apart)
  for (let u = 0.3; u + 0.26 < p.len - 0.3; u += 0.68) {
    const A = at(p, u), B = at(p, u + 0.26);
    sl.band([{ x: A.x, y: A.y, z: A.z }, { x: B.x, y: B.y, z: B.z }], 1.3, -1.3, 0.3);
  }
  for (const r of [-0.72, 0.72]) rl.band(p.pts, r + 0.05, r - 0.05, RAIL_TOP);
}
// a platform: its top, the face along the track, the back down to the ground, and its ends; a white
// edge and a yellow line a stride back from it
function platform(G: Record<string, Geo>, edge: P3[], back: P3[], top: number) {
  const n = edge.length, lift = top;
  const v = (p: P3, y: number) => [p.x, y, p.z];
  for (let i = 1; i < n; i++) {
    const a = edge[i - 1], b = edge[i], c = back[i], d = back[i - 1];
    G.platform.quad(v(a, lift), v(d, lift), v(c, lift), v(b, lift)); // (the top, facing up whichever side it's on)
    G.platform.quad(v(a, a.y + 0.15), v(b, b.y + 0.15), v(b, lift), v(a, lift));
    G.platform.quad(v(c, c.y - 0.05), v(d, d.y - 0.05), v(d, lift), v(c, lift));
  }
  for (const [e, b] of [[edge[0], back[0]], [edge[n - 1], back[n - 1]]]) G.platform.quad(v(e, e.y - 0.05), v(b, b.y - 0.05), v(b, lift), v(e, lift));
  // the lines: the edge (white, 0.1 m) and the yellow line 0.8 m back
  const lerp = (a: P3, b: P3, k: number): P3 => ({ x: a.x + (b.x - a.x) * k, y: a.y, z: a.z + (b.z - a.z) * k });
  const w = Math.hypot(back[0].x - edge[0].x, back[0].z - edge[0].z) || 1;
  for (let i = 1; i < n; i++) {
    const q = (k0: number, k1: number, g: Geo) => g.quad(v(lerp(edge[i - 1], back[i - 1], k0), lift + 0.01), v(lerp(edge[i - 1], back[i - 1], k1), lift + 0.01), v(lerp(edge[i], back[i], k1), lift + 0.01), v(lerp(edge[i], back[i], k0), lift + 0.01));
    q(0, 0.12 / w, G.edge);
    q(0.8 / w, 0.9 / w, G.yellow);
  }
  // a canopy over the middle half, on posts along its back
  const i0 = Math.floor(n * 0.3), i1 = Math.ceil(n * 0.7);
  for (let i = i0; i < i1; i++) {
    const a = lerp(edge[i], back[i], 0.15), b = lerp(edge[i], back[i], 0.95), c = lerp(edge[i + 1] ?? edge[i], back[i + 1] ?? back[i], 0.95), d = lerp(edge[i + 1] ?? edge[i], back[i + 1] ?? back[i], 0.15);
    if (i + 1 < n) G.roof.quad(v(a, lift + 3.3), v(b, lift + 3.1), v(c, lift + 3.1), v(d, lift + 3.3));
    if ((i - i0) % 2 === 0) { const p = lerp(edge[i], back[i], 0.75); G.steel.box(p.x, lift, p.z, 0.14, 3.2, 0.14, 0); }
  }
}
// a footbridge: stair towers each end, and an enclosed span between them high enough for the wires
function footbridge(G: Record<string, Geo>, a: XZ, b: XZ, y: number, rot: number, deck: number) {
  const top = y + 7.2, L = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.z - a.z, b.x - a.x), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  G.steel.box(mx, top, mz, L + 2.6, 0.35, 2.4, ang);
  G.panel.box(mx, top + 0.35, mz, L + 2.6, 1.3, 2.4, ang);
  G.roof.box(mx, top + 2.4, mz, L + 3, 0.12, 2.8, ang);
  for (const e of [a, b]) {
    G.steel.box(e.x, deck, e.z, 2.6, top - deck + 2.4, 2.6, rot);
    G.panel.box(e.x, deck + 0.5, e.z, 2.7, top - deck - 0.6, 2.7, rot);
  }
}
function shed(G: Record<string, Geo>, x: number, y: number, z: number, w: number, d: number, rot: number) {
  // (open at the end the siding runs in: three walls and a roof)
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const k of [-1, 1]) G.shed.box(x - s * (d / 2) * k, y, z + c * (d / 2) * k, w, 5.5, 0.3, rot);
  G.shed.box(x + c * (w / 2), y, z + s * (w / 2), 0.3, 5.5, d, rot);
  G.roof.box(x, y + 5.5, z, w + 0.6, 0.2, d + 0.8, rot);
}
