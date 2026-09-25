// Drawing the railway (docs/rail.md): platforms, station buildings and footbridges, a viaduct
// station's deck, piers and stair towers, an underground station's box, passage and shafts, the
// track a station lays itself (its passing loop, the tracks round an island, a depot siding), UK colour-light
// signals showing their aspects, level-crossing barriers and lights, and the trains, their doors open
// on the platform side while they stand.
//
// Everything that doesn't move is merged into one mesh per material, rebuilt only when the railway
// changes (Railway.version); signal lamps, barrier arms and crossing lights are instanced, updated
// in place each frame. Platform tops, edge lines and ballast sit at distinct heights with their own
// polygon offsets, so nothing is coplanar with the ground, the track or each other.
import * as THREE from 'three';
import { makeBuilding } from '../buildgen';
import { RAIL_MATS, setBoxSkip, setDeckSkip, setTrackSkip } from '../roaddraw';
import { setBridgeSkip } from '../game/bridges';
import { kerbOf } from '../catalog';
import { doorPositions as doorPositionsOf, platformSide } from '../vehicles/doors';
import type { Fleet, Dress } from '../game/fleet';
import type { Lot, RSeg } from '../roads';
import type { XZ } from '../land';
import { at, stationTracks, worksSpan, type P3, type Piece } from './track';
import { BED_PAST, type StationShape } from './station';
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
  // a viaduct station's deck and piers; an underground station's walls (seen from inside and out,
  // in the underground view) and its floor
  concrete: new THREE.MeshLambertMaterial({ color: '#aba69c' }),
  lining: new THREE.MeshLambertMaterial({ color: '#77736b', side: THREE.DoubleSide }),
  floor: new THREE.MeshLambertMaterial({ color: '#5b5852' }),
  glass: new THREE.MeshLambertMaterial({ color: '#8fb5c4' }),
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
    // and a viaduct station's stretch of the bridge: its deck is widened for the platforms, on its own piers
    // (and an underground station's stretch of the tunnel: its box has walls of its own)
    const decks = (s: RSeg) => this.spans(s, 'viaduct');
    setDeckSkip(decks); setBridgeSkip(decks);
    setBoxSkip((s: RSeg) => this.spans(s, 'underground'));
  }
  private spans(s: RSeg, kind: 'viaduct' | 'underground'): [number, number][] {
    const rw = this.rw, tracks = rw.net.def(s).tracks === 2 ? 2 : 1, out: [number, number][] = [];
    for (const w of rw.works()) {
      if (w.seg !== s.id || rw.station(w.id)?.structure !== kind || rw.graph.broken.has(w.id)) continue;
      // (the bridge stops a metre into the station's deck, which runs on past it: see BED_PAST)
      const [a, b] = worksSpan({ ...w, depot: undefined }, tracks), k = kind === 'viaduct' ? BED_PAST - 0.5 : 0;
      out.push([Math.round((a - k) * 10) / 10, Math.round((b + k) * 10) / 10]);
    }
    return out;
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
    const G = { platform: new Geo(), edge: new Geo(), yellow: new Geo(), steel: new Geo(), roof: new Geo(), panel: new Geo(), shed: new Geo(), post: new Geo(), head: new Geo(), deck: new Geo(), ballast: new Geo(), sidingBallast: new Geo(), sleeper: new Geo(), rail: new Geo(), concrete: new Geo(), lining: new Geo(), floor: new Geo(), glass: new Geo() };
    const rw = this.rw, g = rw.graph;
    // the track stations lay: loops, the tracks round islands, depot sidings
    for (const p of g.pieces) {
      if (!p.curvy && !p.laid && p.depot === undefined) continue;
      const bal = p.depot !== undefined ? G.sidingBallast : G.ballast, yb = p.depot !== undefined ? 0.18 : 0.2;
      G.ballast === bal ? bal.band(p.pts, 2.4, -2.4, yb) : bal.band(p.pts, 2.2, -2.2, yb);
      track(G.sleeper, G.rail, p);
    }
    // the stations
    for (const [id, sh] of rw.shapes) {
      const st = rw.station(id);
      if (!st) continue;
      const deep = sh.structure === 'underground', raised = sh.structure === 'viaduct';
      for (const pl of sh.platforms) platform(G, pl.edge, pl.back, pl.y, pl.twoFaced, sh.canopy && sh.style !== 'halt', sh.style === 'halt' && !deep);
      // where the footbridge (or the subway, or a viaduct's stairs down) meets each platform: its stairs go up (or down) there
      // (exactly under the footbridge: the platforms' points are evenly spaced along the track, so
      // three quarters of the way along them is where it crosses; underground, the middle)
      const stairs = sh.platforms.map((pl) => {
        const f = (pl.edge.length - 1) * (sh.structure === 'underground' ? 0.5 : 0.75), i = Math.min(pl.edge.length - 2, Math.floor(f)), t = f - i;
        const mix = (a: P3, b: P3) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        const e = mix(pl.edge[i], pl.edge[i + 1]), b = mix(pl.back[i], pl.back[i + 1]), n = pl.edge[i + 1], p = pl.edge[i];
        return { x: (e.x + b.x) / 2, z: (e.z + b.z) / 2, y: pl.y, rot: Math.atan2(n.z - p.z, n.x - p.x) };
      });
      if (raised) viaduct(G, sh, stairs, (p) => this.pierFree(p, id));
      else if (deep) { const w = rw.works().find((x) => x.id === id), seg = w && rw.net.segs.get(w.seg); underground(G, sh, stairs, seg ? kerbOf(rw.net.def(seg)) + 0.8 : 5); }
      else if (sh.footbridge) {
        if (sh.access === 'subway') for (const q of [...stairs, { ...sh.footbridge.a, y: sh.footbridge.y, rot: sh.footbridge.rot }]) subwayStairs(G, q.x, q.y, q.z, q.rot);
        else footbridge(G, sh.footbridge.a, sh.footbridge.b, sh.footbridge.y, sh.footbridge.rot, sh.platforms[0]?.y ?? sh.mid.y + 1.3, stairs);
      }
      if (sh.depot) { const d = sh.depot.shed; shed(G, d.x, d.y, d.z, d.w, d.d, d.rot); }
      // (a halt has no booking hall: its shelters are on the platforms; underground, a canopy over the stairs down)
      if (sh.style === 'halt') { if (deep) subwayStairs(G, sh.building.x, 0.02, sh.building.z, sh.building.rot); continue; }
      // the building, from the building kit, facing away from the track
      const b = sh.building, nx = Math.cos(b.rot + Math.PI / 2), nz = Math.sin(b.rot + Math.PI / 2);
      const side = (b.x - sh.mid.x) * nx + (b.z - sh.mid.z) * nz > 0 ? 1 : -1, fx = nx * side, fz = nz * side;
      const lot: Lot = { id: -id, x: b.x, z: b.z, rot: Math.atan2(-fx, fz), w: b.w, d: b.d, h: 8, kind: 'civic', arch: sh.style === 'modern' ? 'station-modern' : 'station', seg: 0, seed: ((id * 0.6180339) % 1), row: -id, front: 6, back: st.layout === 'island' ? 0.5 : 3.6, px: 0, pw: b.w + 4 };
      const shape = makeBuilding(lot);
      shape.group.position.y = b.y;
      shape.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.statics.add(shape.group);
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
    const mats: [keyof typeof G, THREE.Material][] = [['platform', MAT.platform], ['edge', MAT.edge], ['yellow', MAT.yellow], ['steel', MAT.steel], ['roof', MAT.roof], ['panel', MAT.panel], ['shed', MAT.shed], ['post', MAT.post], ['head', MAT.head], ['deck', MAT.deck], ['ballast', RAIL_MATS.ballast], ['sidingBallast', MAT.sidingBallast], ['sleeper', RAIL_MATS.sleeper], ['rail', RAIL_MATS.rail], ['concrete', MAT.concrete], ['lining', MAT.lining], ['floor', MAT.floor], ['glass', MAT.glass]];
    // signals: a post and a head at the end of each block, on the driver's left
    this.sig = [];
    for (const s of rw.sim.signals()) {
      const p = g.pieces[s.piece], back = rw.sim.signalBack(s), q = at(p, s.dir === 1 ? p.len - back : back), hx = q.ux * s.dir, hz = q.uz * s.dir;
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
    for (const [k, m] of mats) { const mesh = G[k].mesh(m); if (mesh) { mesh.castShadow = k !== 'edge' && k !== 'yellow' && k !== 'deck' && k !== 'ballast' && k !== 'sidingBallast' && k !== 'sleeper' && k !== 'rail' && k !== 'lining' && k !== 'floor'; this.statics.add(mesh); } }
    return true;
  }
  // can a viaduct station's pier stand here? (not on a road, a junction or another railway passing under)
  // (every claim over the pier's footing counts, not just the first found: the viaduct's own track
  // is usually claimed first there)
  private pierFree(p: XZ, id: number) {
    const seg = this.rw.works().find((w) => w.id === id)?.seg, r = 0.8;
    const foot = [{ x: p.x - r, z: p.z - r }, { x: p.x + r, z: p.z - r }, { x: p.x + r, z: p.z + r }, { x: p.x - r, z: p.z + r }];
    return !this.rw.net.land.hits(foot, (c) => c.key === `road:${seg}` || c.key.startsWith('station:') || (c.owner !== 'road' && c.owner !== 'junction' && c.owner !== 'slip')).length;
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
// (twoFaced: tracks both sides, so both edges get their lines; canopy over the middle half; a halt's
// shelter instead)
function platform(G: Record<string, Geo>, edge: P3[], back: P3[], top: number, twoFaced = false, canopy = true, shelter = false) {
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
    if (twoFaced) { q(1 - 0.12 / w, 1, G.edge); q(1 - 0.9 / w, 1 - 0.8 / w, G.yellow); }
  }
  if (shelter) {
    // a bus-stop style shelter at the middle, its back to the far side
    const i = Math.floor(n / 2), p = lerp(edge[i], back[i], 0.6), q2 = edge[Math.min(n - 1, i + 1)], rot = Math.atan2(q2.z - edge[i].z, q2.x - edge[i].x);
    G.steel.box(p.x, lift, p.z, 4.2, 2.5, 0.12, rot);
    G.panel.box(p.x, lift + 0.4, p.z, 4, 1.6, 0.1, rot);
    G.roof.box(p.x, lift + 2.5, p.z, 4.6, 0.12, 1.8, rot);
  }
  if (!canopy) return;
  // a canopy over the middle half, on posts along its back
  const i0 = Math.floor(n * 0.3), i1 = Math.ceil(n * 0.7);
  for (let i = i0; i < i1; i++) {
    const a = lerp(edge[i], back[i], 0.15), b = lerp(edge[i], back[i], 0.95), c = lerp(edge[i + 1] ?? edge[i], back[i + 1] ?? back[i], 0.95), d = lerp(edge[i + 1] ?? edge[i], back[i + 1] ?? back[i], 0.15);
    if (i + 1 < n) G.roof.quad(v(a, lift + 3.3), v(b, lift + 3.1), v(c, lift + 3.1), v(d, lift + 3.3));
    if ((i - i0) % 2 === 0) { const p = lerp(edge[i], back[i], 0.75); G.steel.box(p.x, lift, p.z, 0.14, 3.2, 0.14, 0); }
  }
}
// a footbridge: stair towers each end, and an enclosed span between them high enough for the wires
function footbridge(G: Record<string, Geo>, a: XZ, b: XZ, y: number, rot: number, deck: number, stairs: { x: number; y: number; z: number }[] = []) {
  const top = y + 7.2, L = Math.hypot(b.x - a.x, b.z - a.z), ang = Math.atan2(b.z - a.z, b.x - a.x), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  // (its ends stop inside the end towers, 2.6 m square: an end face in the plane of a tower's would flicker)
  G.steel.box(mx, top, mz, L + 2.4, 0.35, 2.4, ang);
  G.panel.box(mx, top + 0.35, mz, L + 2.4, 1.3, 2.4, ang);
  G.roof.box(mx, top + 2.4, mz, L + 3, 0.12, 2.8, ang);
  // stair towers down to each platform it crosses, and to the ground at the building's end
  const towers = stairs.length ? [{ ...a, y: deck }, ...stairs] : [{ ...a, y: deck }, { ...b, y: deck }];
  for (const e of towers) {
    G.steel.box(e.x, e.y, e.z, 2.6, top - e.y + 2.4, 2.6, rot);
    G.panel.box(e.x, e.y + 0.5, e.z, 2.7, top - e.y - 0.6, 2.7, rot);
  }
}
// a subway's stairs going down from a platform (or the forecourt): low walls round the well and a roof over it
function subwayStairs(G: Record<string, Geo>, x: number, y: number, z: number, rot: number) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const k of [-1, 1]) G.panel.box(x - s * 1.1 * k, y, z + c * 1.1 * k, 5, 1.1, 0.2, rot);
  G.panel.box(x + c * 2.5, y, z + s * 2.5, 0.2, 1.1, 2.4, rot);
  G.head.box(x, y + 0.04, z, 4.6, 0.02, 1.9, rot); // (the dark of the stairwell, clear of its walls)
  for (const k of [-1, 1]) G.steel.box(x - s * 1.1 * k + c * 2.2, y, z + c * 1.1 * k + s * 2.2, 0.12, 2.6, 0.12, rot);
  G.roof.box(x + c * 0.4, y + 2.6, z + s * 0.4, 5.4, 0.12, 2.8, rot);
}
function shed(G: Record<string, Geo>, x: number, y: number, z: number, w: number, d: number, rot: number) {
  // (open at the end the siding runs in: three walls and a roof)
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const k of [-1, 1]) G.shed.box(x - s * (d / 2) * k, y, z + c * (d / 2) * k, w, 5.5, 0.3, rot);
  G.shed.box(x + c * (w / 2), y, z + s * (w / 2), 0.3, 5.5, d, rot);
  G.roof.box(x, y + 5.5, z, w + 0.6, 0.2, d + 0.8, rot);
}

// ---------- viaducts and station boxes ----------
// a polyline with its arc lengths, to walk along
function walker(pts: P3[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, len: cum[cum.length - 1] } as unknown as Piece;
}
// the point `o` to the left (+) of a polyline at u along it, the way offsets are measured to the track
const beside = (p: Piece, u: number, o: number) => { const q = at(p, u); return { x: q.x + q.uz * o, y: q.y, z: q.z - q.ux * o, ux: q.ux, uz: q.uz }; };
// a wall along a polyline at offset `o`, from y0 to y1 over its height
function wall(g: Geo, pts: P3[], o: number, y0: number, y1: number) {
  for (let i = 1; i < pts.length; i++) {
    const A = pts[i - 1], B = pts[i], L = Math.hypot(B.x - A.x, B.z - A.z) || 1, nx = (B.z - A.z) / L * o, nz = -(B.x - A.x) / L * o;
    g.quad([A.x + nx, A.y + y0, A.z + nz], [B.x + nx, B.y + y0, B.z + nz], [B.x + nx, B.y + y1, B.z + nz], [A.x + nx, A.y + y1, A.z + nz]);
  }
}
// A viaduct station: the bridge's deck widened under every track and platform, with parapets along
// its edges; cross-heads on columns every 18 m (none standing on a road beneath); and at each
// platform, a tower of stairs and a lift down to the booking hall at street level.
const PARAPET = 2.4; // over the rails (a metre over the platforms)
function viaduct(G: Record<string, Geo>, sh: StationShape, stairs: { x: number; y: number; z: number; rot: number }[], free: (p: XZ) => boolean) {
  const bed = sh.bed!, l = bed.l, r = bed.r, pts = bed.pts;
  // (the deck's top a few centimetres under the rails' own: the track and its ballast sit on it, never level with it)
  const top = -0.06, under = -1.3;
  G.concrete.band(pts, l, r, top);
  G.concrete.band(pts, r, l, under); // (its underside, facing down)
  // the deck's edges and the parapets' outer faces in one, the parapets' inner faces, and their tops
  wall(G.concrete, pts, l, PARAPET, under); wall(G.concrete, pts, r, under, PARAPET);
  wall(G.concrete, pts, l - 0.25, top, PARAPET); wall(G.concrete, pts, r + 0.25, PARAPET, top);
  G.concrete.band(pts, l, l - 0.25, PARAPET); G.concrete.band(pts, r + 0.25, r, PARAPET);
  const w = walker(pts), across = Math.max(1, Math.round((l - r) / 7));
  for (let u = 6; u < w.len - 4; u += 18) {
    const c = beside(w, u, (l + r) / 2), rot = Math.atan2(c.uz, c.ux);
    // the cross-head under the deck, square to the track
    G.concrete.box(c.x, c.y + under - 1.1, c.z, 1.4, 1.1, l - r - 0.6, rot);
    for (let k = 0; k <= across; k++) {
      const o = r + 1 + ((l - r - 2) * k) / across, q = beside(w, u, o);
      if (!free(q)) continue;
      G.concrete.box(q.x, 0, q.z, 1.1, Math.max(0.5, q.y + under - 1.1), 1.1, rot);
    }
  }
  // stairs and a lift from each platform down to the street
  for (const s of stairs) {
    const c = Math.cos(s.rot), n = Math.sin(s.rot), deck = s.y - RAIL_TOP - 0.92; // (the rails' level there)
    subwayStairs(G, s.x, s.y, s.z, s.rot);
    G.panel.box(s.x + c * 1.2, 0, s.z + n * 1.2, 6, deck + under + 0.4, 2.6, s.rot); // (the stair tower, up into the deck)
    G.glass.box(s.x - c * 3.4, 0, s.z - n * 3.4, 1.8, s.y + 2.4, 1.8, s.rot); // (the lift, up through the platform to its door)
    G.roof.box(s.x - c * 3.4, s.y + 2.4, s.z - n * 3.4, 2.2, 0.15, 2.2, s.rot);
  }
}
// An underground station: the box round its tracks and platforms (walls, a floor; no roof, so the
// underground view sees in), a passage over the tracks at the middle with stairs down to each
// platform, and a shaft of stairs, escalators and lifts from it up to just under the entrance.
// (`half`: the approach tunnel's half-width, its walls' offset in roaddraw, for the openings in the ends)
function underground(G: Record<string, Geo>, sh: StationShape, stairs: { x: number; y: number; z: number; rot: number }[], half: number) {
  const bed = sh.bed!, pts = bed.pts, H = 8.4, P = 6.2; // (the box's walls over the rails, and the passage's floor)
  G.floor.band(pts, bed.l, bed.r, -0.06);
  wall(G.lining, pts, bed.l, -0.4, H); wall(G.lining, pts, bed.r, -0.4, H);
  // the ends, round the tunnel mouths
  for (const [e, o] of [[pts[0], pts[1]], [pts[pts.length - 1], pts[pts.length - 2]]]) {
    const L = Math.hypot(e.x - o.x, e.z - o.z) || 1, nx = (o.z - e.z) / L, nz = -(o.x - e.x) / L;
    const q = (a: number, b: number, y0: number, y1: number) => G.lining.quad([e.x + nx * a, e.y + y0, e.z + nz * a], [e.x + nx * b, e.y + y0, e.z + nz * b], [e.x + nx * b, e.y + y1, e.z + nz * b], [e.x + nx * a, e.y + y1, e.z + nz * a]);
    if (bed.l - half > 0.2) q(bed.l, half, -0.4, H);
    if (-half - bed.r > 0.2) q(-half, bed.r, -0.4, H);
    q(half, -half, 6.8, H);
  }
  // which side the entrance is on, and where the box's wall is on that side, at the middle
  const b = sh.building, m = sh.mid, lx = sh.uz, lz = -sh.ux, side = (b.x - m.x) * lx + (b.z - m.z) * lz > 0 ? 1 : -1, o = side === 1 ? bed.l : bed.r;
  const e = { x: m.x + lx * o, z: m.z + lz * o }, rot = Math.atan2(sh.uz, sh.ux), y = m.y;
  const over = stairs.length > 1 || !!sh.footbridge, low = over ? y + P : (stairs[0]?.y ?? y + 1.4);
  if (over && stairs.length) {
    // the passage over the tracks, from the wall on the entrance's side to the furthest platform
    const far = stairs.reduce((f, s) => (Math.hypot(s.x - e.x, s.z - e.z) > Math.hypot(f.x - e.x, f.z - e.z) ? s : f), stairs[0]);
    const L = Math.hypot(far.x - e.x, far.z - e.z), ang = Math.atan2(far.z - e.z, far.x - e.x);
    G.concrete.box((e.x + far.x) / 2, y + P, (e.z + far.z) / 2, L + 2.6, 0.3, 3, ang);
    G.panel.box((e.x + far.x) / 2, y + P + 0.3, (e.z + far.z) / 2, L + 2.6, 1.1, 3, ang);
    for (const s of stairs) { G.steel.box(s.x, s.y, s.z, 5, y + P - s.y, 2.4, s.rot); G.panel.box(s.x, s.y + 0.4, s.z, 5.1, y + P - s.y - 0.6, 2.5, s.rot); }
  } else if (stairs[0]) {
    // one platform: a passage along it, through the wall, at its level
    const s = stairs[0], L = Math.hypot(s.x - e.x, s.z - e.z);
    G.panel.box((s.x + e.x) / 2, s.y, (s.z + e.z) / 2, L + 1, 2.6, 3, Math.atan2(s.z - e.z, s.x - e.x));
  }
  // the shaft just outside the wall, under the entrance: its stairs and escalators, and a lift
  const sx = e.x + lx * side * 3.2, sz = e.z + lz * side * 3.2;
  G.concrete.box(sx, low, sz, 7, -0.35 - low, 4.4, rot);
  G.glass.box(sx + Math.cos(rot) * 4.6, low + 0.3, sz + Math.sin(rot) * 4.6, 1.8, -0.75 - low, 1.8, rot); // (clear of the shaft's end)
}
