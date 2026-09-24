// Railway track: a ballast bed with shoulders, sleepers, and rails with a head and a foot, cheap
// enough for a phone. From a distance the bed is one textured strip with the sleepers, chairs and
// rails painted on it. Close in, real sleepers (one InstancedMesh per kind for the whole scene) and
// real rails appear, each exactly over its painted twin, so switching between the two never shifts
// anything. Old lines get timber sleepers in cast-iron chairs, lines from 1960 concrete sleepers
// on baseplates; steel and timber bridge decks carry bare timbers with guard rails and no ballast.
//
// Nothing here knows about bridges: a TrackRun is a stretch of track along any path, so the game's
// railways can build their track with it too (see docs/bridges.md).
import * as THREE from 'three';
import type { P } from '../roads';
import { pointOn } from './crossing';

export const GAUGE = 1.435; // between the running edges of the two rail heads (standard gauge)
export const SLEEPER_PITCH = 0.65; // sleeper centres along the track
export const TRACK_CENTRES = 4; // double track, centre to centre (the drawn decks assume ±2 m)
export const BALLAST_DEPTH = 0.3; // top of the ballast down to the formation it sits on
export const SHOULDER_SLOPE = 1.5; // ballast shoulders: horizontal per vertical
export const SHOULDER = 0.35; // ballast beyond the sleeper ends, at the top
export const SLEEPER_PROUD = 0.05; // sleeper tops stand this far above the ballast
export const SEAT = 0.04; // chair or baseplate: the rail's foot sits this far above the sleeper
export const RAIL_HEIGHT = 0.15;
export const RAIL_CENTRE = GAUGE / 2 + 0.035; // centreline to the middle of each rail head
export const GUARD_INSET = 0.25; // guard rails on open decks: this far inside the running rails
// Real sleepers and rails replace the painted ones once a sleeper pitch covers about five pixels.
export const DETAIL_MPP = 0.13;

export type SleeperKind = 'timber' | 'concrete';
export type TrackForm = 'ballast' | 'open';
export const sleeperKind = (year: number): SleeperKind => (year < 1960 ? 'timber' : 'concrete');
// How a bridge type carries track: steel girders, trusses and timber trestles have bare timbers
// (longitudinal bearers or transoms) with guard rails; masonry and concrete carry the ballast across.
const OPEN_DECKS = ['trestle', 'girder', 'truss-through', 'truss-deck', 'bascule'];
export const deckForm = (bridgeId: string): TrackForm => (OPEN_DECKS.includes(bridgeId) ? 'open' : 'ballast');
// How far below the track level the deck (or formation) under it lies: the ballast depth, or on
// an open deck the underside of the timbers, which sit straight on the steelwork.
export const formationDrop = (form: TrackForm) => (form === 'ballast' ? BALLAST_DEPTH : SLEEPERS.timber.depth - SLEEPER_PROUD);
// Sleepers and rails are built in chunks of about this length, so zoomed in only the chunks on
// screen are drawn.
export const CHUNK = 120;

interface SleeperDef { len: number; width: number; depth: number; colour: string; seat: { across: number; along: number; colour: string } }
export const SLEEPERS: Record<SleeperKind, SleeperDef> = {
  // creosoted softwood in cast-iron chairs (bullhead rail)
  timber: { len: 2.6, width: 0.25, depth: 0.13, colour: '#4d3b2b', seat: { across: 0.34, along: 0.2, colour: '#2d2a28' } },
  // prestressed concrete with baseplates and clips (flat-bottom rail)
  concrete: { len: 2.5, width: 0.28, depth: 0.2, colour: '#b9b4aa', seat: { across: 0.2, along: 0.17, colour: '#2b2c2f' } },
};

// Half-widths of the ballast bed: its flat top and the toe of its shoulders.
export function bedWidth(tracks: number) {
  const top = trackCentres(tracks).reduce((m, c) => Math.max(m, Math.abs(c)), 0) + SLEEPERS.timber.len / 2 + SHOULDER;
  return { top, toe: top + BALLAST_DEPTH * SHOULDER_SLOPE };
}
export const trackCentres = (tracks: number) => (tracks >= 2 ? [-TRACK_CENTRES / 2, TRACK_CENTRES / 2] : [0]);

// A stretch of track. `level` is the top of the ballast; on an open deck, the sleeper bed.
export interface TrackRun {
  path: P[]; s0: number; s1: number;
  level: (s: number) => number;
  tracks: number; form: TrackForm; year: number;
  step?: number; // sampling along the path (m)
}

// Sleeper centres along a run: one global grid, so runs laid end to end stay in step.
export function sleeperStations(s0: number, s1: number) {
  const out: number[] = [];
  for (let i = Math.ceil(s0 / SLEEPER_PITCH - 0.5); (i + 0.5) * SLEEPER_PITCH < s1 - 1e-9; i++) {
    const s = (i + 0.5) * SLEEPER_PITCH;
    if (s >= s0 - 1e-9) out.push(s);
  }
  return out;
}

// Rail section: foot, web and head, as (offset from the rail's centre, height above its foot).
// The foot's top falls away to its edges as a real rail's does. The underside isn't drawn.
const RAIL_SECTION: [number, number][] = [
  [0.07, 0], [0.07, 0.012], [0.012, 0.032], [0.012, 0.1], [0.035, 0.107], [0.035, RAIL_HEIGHT],
  [-0.035, RAIL_HEIGHT], [-0.035, 0.107], [-0.012, 0.1], [-0.012, 0.032], [-0.07, 0.012], [-0.07, 0],
];
const GUARD_SECTION: [number, number][] = [[0.03, 0], [0.03, 0.11], [-0.03, 0.11], [-0.03, 0]];

// ---------- textures: painted track for the far view ----------

// Pixel painter with 3×3 supersampling. `px` is the size of a texel in metres (across, along) so
// thin things (rails) can be kept at least a texel wide in the smaller mipmaps.
type Paint = (n: number, s: number, px: number) => [number, number, number];
const U_M = TRACK_CENTRES, V_M = SLEEPER_PITCH; // one texture repeat, in metres across and along
function paintTexture(w: number, h: number, paint: Paint) {
  const levels: { data: Uint8Array; width: number; height: number }[] = [];
  for (let lw = w, lh = h; ; lw = Math.max(1, lw >> 1), lh = Math.max(1, lh >> 1)) {
    const data = new Uint8Array(lw * lh * 4), px = Math.max(U_M / lw, V_M / lh);
    for (let j = 0; j < lh; j++) for (let i = 0; i < lw; i++) {
      let r = 0, g = 0, b = 0;
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
        const u = (i + (a + 0.5) / 3) / lw, v = (j + (c + 0.5) / 3) / lh;
        // across: distance from the nearest track centre (centres sit at u = 0 and u = 1)
        const n = (u <= 0.5 ? u : u - 1) * U_M, s = (v - 0.5) * V_M;
        const [pr, pg, pb] = paint(n, s, px);
        r += pr; g += pg; b += pb;
      }
      const k = (j * lw + i) * 4;
      data[k] = r / 9; data[k + 1] = g / 9; data[k + 2] = b / 9; data[k + 3] = 255;
    }
    levels.push({ data, width: lw, height: lh });
    if (lw === 1 && lh === 1) break;
  }
  const t = new THREE.DataTexture(levels[0].data, w, h, THREE.RGBAFormat);
  t.mipmaps = levels;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const shade = (c: [number, number, number], k: number): [number, number, number] => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
// stable per-stone brightness: stones about 4 cm across
function stone(n: number, s: number) {
  const a = Math.floor(n / 0.04 + 1000), b = Math.floor(s / 0.04 + 1000);
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
// rails, chairs and sleepers seen from above, shared by both painted beds
function trackTop(n: number, s: number, px: number, kind: SleeperKind, under: [number, number, number], guard: boolean): [number, number, number] {
  const d = SLEEPERS[kind], an = Math.abs(n), dr = Math.abs(an - RAIL_CENTRE);
  // a rail head is 7 cm across: in the small mipmaps keep it a texel wide, a little fainter
  const head = Math.max(0.035, px * 0.6), fade = Math.sqrt(0.035 / head);
  if (dr < head) return shade(hex('#c3c7cb'), 0.75 + 0.25 * fade);
  if (dr < Math.max(0.07, head * 1.6)) return hex('#3b3c40'); // the foot, and its shadow
  if (guard && Math.abs(an - (RAIL_CENTRE - GUARD_INSET)) < Math.max(0.03, px * 0.5)) return hex('#56595e');
  const onSleeper = an < d.len / 2 && Math.abs(s) < d.width / 2;
  if (onSleeper && dr < d.seat.across / 2 && Math.abs(s) < d.seat.along / 2) return hex(d.seat.colour);
  if (onSleeper) return shade(hex(d.colour), 0.92 + 0.12 * stone(n * 0.3, s * 4));
  return under;
}
const BALLAST: Record<SleeperKind, string> = { timber: '#7b7266', concrete: '#9a958d' }; // older ballast is dirtier
const cache = new Map<string, THREE.Texture>();
export function ballastTexture(kind: SleeperKind) {
  const key = `ballast-${kind}`;
  if (!cache.has(key)) cache.set(key, paintTexture(256, 32, (n, s, px) => trackTop(n, s, px, kind, shade(hex(BALLAST[kind]), 0.8 + 0.4 * stone(n, s)), false)));
  return cache.get(key)!;
}
// close in, real sleepers and rails stand on the bed, so it shows only stones (no painted twins
// peeping out beside them at an angle)
export function plainBallastTexture(kind: SleeperKind) {
  const key = `plain-${kind}`;
  if (!cache.has(key)) cache.set(key, paintTexture(256, 32, (n, s) => shade(hex(BALLAST[kind]), 0.8 + 0.4 * stone(n, s))));
  return cache.get(key)!;
}
// bare timbers on a steel deck: dark gaps between them, guard rails inside the running rails
export function openDeckTexture() {
  if (!cache.has('open')) cache.set('open', paintTexture(256, 32, (n, s, px) => trackTop(n, s, px, 'timber', hex('#26231f'), true)));
  return cache.get('open')!;
}

// ---------- materials ----------

let mats: { bed: Record<SleeperKind, THREE.MeshLambertMaterial>; plain: Record<SleeperKind, THREE.MeshLambertMaterial>; open: THREE.MeshLambertMaterial; rail: THREE.MeshLambertMaterial; sleeper: THREE.MeshLambertMaterial } | null = null;
export function trackMaterials() {
  if (mats) return mats;
  const lit = (o: THREE.MeshLambertMaterialParameters) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, flatShading: true, ...o });
  return (mats = {
    bed: { timber: lit({ map: ballastTexture('timber') }), concrete: lit({ map: ballastTexture('concrete') }) },
    plain: { timber: lit({ map: plainBallastTexture('timber') }), concrete: lit({ map: plainBallastTexture('concrete') }) },
    open: lit({ map: openDeckTexture() }),
    rail: lit({ color: '#8d9196' }),
    sleeper: lit({ vertexColors: true }),
  });
}

// ---------- geometry ----------

class Tris {
  pos: number[] = []; uv: number[] = []; col: number[] = [];
  tri(a: number[], b: number[], c: number[]) { this.pos.push(...a, ...b, ...c); }
  quad(a: number[], b: number[], c: number[], d: number[]) { this.tri(a, b, c); this.tri(a, c, d); }
  uvQuad(a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]) { this.quad(a, b, c, d); this.uv.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    if (this.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    return g;
  }
}

// A box with its top at y = 0, x across the track and z along it; no underside.
function boxInto(t: Tris, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: THREE.Color) {
  const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; t.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]); }
  t.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
  const n = t.pos.length / 3 - t.col.length / 3;
  for (let i = 0; i < n; i++) t.col.push(colour.r, colour.g, colour.b);
}
// One sleeper with its two chairs or baseplates, top at y = 0: the instanced shape.
export function sleeperGeometry(kind: SleeperKind) {
  const d = SLEEPERS[kind], t = new Tris();
  boxInto(t, -d.len / 2, d.len / 2, -d.depth, 0, -d.width / 2, d.width / 2, new THREE.Color(d.colour));
  for (const k of [-1, 1]) boxInto(t, k * RAIL_CENTRE - d.seat.across / 2, k * RAIL_CENTRE + d.seat.across / 2, 0, SEAT, -d.seat.along / 2, d.seat.along / 2, new THREE.Color(d.seat.colour));
  return t.geometry();
}

function samples(s0: number, s1: number, step: number) {
  const n = Math.max(1, Math.ceil((s1 - s0) / step - 1e-9)), out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(s0 + ((s1 - s0) * i) / n);
  return out;
}
const frame = (path: P[], s: number) => { const p = pointOn(path, s); return { x: p.x, z: p.z, ux: p.ux, uz: p.uz, nx: -p.uz, nz: p.ux }; };
type F = ReturnType<typeof frame>;
const at = (f: F, n: number, y: number) => [f.x + f.nx * n, y, f.z + f.nz * n];

export interface Track {
  group: THREE.Group; // add this to the scene
  near: THREE.Group; far: THREE.Group; // shown close in, and from a distance
  sleepers: number; // how many sleepers (instances) in the scene
  detailed: boolean; // whether they are showing now
  setDetail(metresPerPixel: number): boolean; // true when the real sleepers and rails are showing
  dispose(): void;
}

// Collects every run of track in a scene, then builds it as a handful of meshes: the ballast bed
// (one per sleeper kind, with a painted twin for the far view), the open-deck strip, and close in
// the rails and sleepers in chunks of about CHUNK metres.
export class TrackBuilder {
  runs: TrackRun[] = [];
  add(r: TrackRun) { if (r.s1 - r.s0 > 0.05) this.runs.push(r); return this; }

  build(): Track {
    const bed = { timber: new Tris(), concrete: new Tris() }, open = new Tris();
    const rails = new Map<number, Tris>(), inst = new Map<string, THREE.Matrix4[]>();
    const railsOf = (k: number) => { let t = rails.get(k); if (!t) rails.set(k, (t = new Tris())); return t; };
    const instOf = (kind: SleeperKind, k: number) => { const key = `${kind}:${k}`; let a = inst.get(key); if (!a) inst.set(key, (a = [])); return a; };
    const m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3();
    const ballastRuns = this.runs.filter((r) => r.form === 'ballast');
    const joined = (r: TrackRun, s: number) => ballastRuns.some((o) => o !== r && o.path === r.path && (Math.abs(o.s0 - s) < 1e-3 || Math.abs(o.s1 - s) < 1e-3));
    // chunks are counted along each path, so a run's pieces and its neighbours share them
    const chunkOf = (r: TrackRun, s: number) => this.runs.indexOf(this.runs.find((o) => o.path === r.path)!) * 100000 + Math.floor(s / CHUNK);
    for (const r of this.runs) {
      const ss = samples(r.s0, r.s1, r.step ?? 3), fr = ss.map((s) => frame(r.path, s)), lv = ss.map((s) => r.level(s));
      const cs = trackCentres(r.tracks), c0 = cs[0], w = bedWidth(r.tracks);
      const kind: SleeperKind = r.form === 'open' ? 'timber' : sleeperKind(r.year);
      const U = (n: number) => (n - c0) / U_M, V = (s: number) => s / V_M;
      if (r.form === 'ballast') {
        // the bed: sloping shoulder, flat top, sloping shoulder; the texture paints the top
        const t = bed[kind], sec: [number, number][] = [[-w.toe, -BALLAST_DEPTH], [-w.top, 0], [w.top, 0], [w.toe, -BALLAST_DEPTH]];
        for (let i = 1; i < ss.length; i++) for (let e = 0; e < 3; e++) {
          const [na, ha] = sec[e], [nb, hb] = sec[e + 1];
          t.uvQuad(at(fr[i - 1], na, lv[i - 1] + ha), at(fr[i - 1], nb, lv[i - 1] + hb), at(fr[i], nb, lv[i] + hb), at(fr[i], na, lv[i] + ha),
            [U(na), V(ss[i - 1])], [U(nb), V(ss[i - 1])], [U(nb), V(ss[i])], [U(na), V(ss[i])]);
        }
        // close the end of the bed where it stops short of more ballast (an open deck, the map edge)
        for (const i of [0, ss.length - 1]) {
          if (joined(r, ss[i])) continue;
          const q = sec.map(([n, h]) => at(fr[i], n, lv[i] + h)), uvc = sec.map(([n, h]) => [0.45 + n * 0.02, h / V_M]);
          t.uvQuad(q[0], q[1], q[2], q[3], uvc[0], uvc[1], uvc[2], uvc[3]);
        }
      } else {
        // far view of an open deck: the timbers painted on a strip at their top
        const n0 = cs[0] - SLEEPERS.timber.len / 2, n1 = cs[cs.length - 1] + SLEEPERS.timber.len / 2, h = SLEEPER_PROUD;
        for (let i = 1; i < ss.length; i++) open.uvQuad(at(fr[i - 1], n0, lv[i - 1] + h), at(fr[i - 1], n1, lv[i - 1] + h), at(fr[i], n1, lv[i] + h), at(fr[i], n0, lv[i] + h),
          [U(n0), V(ss[i - 1])], [U(n1), V(ss[i - 1])], [U(n1), V(ss[i])], [U(n0), V(ss[i])]);
      }
      // rails (and guard rails on open decks), swept along the run
      const railAt = (n: number, sec: [number, number][], base: number) => {
        for (let i = 1; i < ss.length; i++) {
          const t = railsOf(chunkOf(r, (ss[i - 1] + ss[i]) / 2));
          for (let e = 0; e + 1 < sec.length; e++) {
            const [pa, ha] = sec[e], [pb, hb] = sec[e + 1];
            t.quad(at(fr[i - 1], n + pa, lv[i - 1] + base + ha), at(fr[i - 1], n + pb, lv[i - 1] + base + hb), at(fr[i], n + pb, lv[i] + base + hb), at(fr[i], n + pa, lv[i] + base + ha));
          }
        }
      };
      for (const c of cs) for (const k of [-1, 1]) {
        railAt(c + k * RAIL_CENTRE, RAIL_SECTION, SLEEPER_PROUD + SEAT);
        if (r.form === 'open') railAt(c + k * (RAIL_CENTRE - GUARD_INSET), GUARD_SECTION, SLEEPER_PROUD);
      }
      // sleepers, square to the track, tops SLEEPER_PROUD above the ballast
      for (const s of sleeperStations(r.s0, r.s1)) {
        const f = frame(r.path, s), y = r.level(s) + SLEEPER_PROUD, list = instOf(kind, chunkOf(r, s));
        X.set(f.nx, 0, f.nz); Z.set(-f.ux, 0, -f.uz);
        for (const c of cs) { m4.makeBasis(X, Y, Z).setPosition(f.x + f.nx * c, y, f.z + f.nz * c); list.push(m4.clone()); }
      }
    }
    const tm = trackMaterials();
    const group = new THREE.Group(), near = new THREE.Group(), far = new THREE.Group();
    group.name = 'track'; near.name = 'track-near'; far.name = 'track-far';
    const add = (into: THREE.Group, g: THREE.BufferGeometry, m: THREE.Material, name: string) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.name = name; mesh.receiveShadow = true;
      into.add(mesh);
    };
    for (const kind of ['timber', 'concrete'] as SleeperKind[]) {
      if (!bed[kind].pos.length) continue;
      // one geometry, two looks: painted sleepers and rails from afar, bare stones close in
      const g = bed[kind].geometry();
      add(far, g, tm.bed[kind], `ballast-${kind}`);
      add(near, g, tm.plain[kind], `ballast-${kind}-near`);
    }
    if (open.pos.length) add(far, open.geometry(), tm.open, 'open-deck');
    for (const [k, t] of rails) add(near, t.geometry(), tm.rail, `rails-${k}`);
    let count = 0;
    const shapes = new Map<SleeperKind, THREE.BufferGeometry>();
    for (const [key, list] of inst) {
      const kind = key.split(':')[0] as SleeperKind;
      if (!shapes.has(kind)) shapes.set(kind, sleeperGeometry(kind));
      const im = new THREE.InstancedMesh(shapes.get(kind)!, tm.sleeper, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = `sleepers-${key}`; im.receiveShadow = true;
      near.add(im);
      count += list.length;
    }
    group.add(near, far);
    const track: Track = {
      group, near, far, sleepers: count, detailed: false,
      setDetail(mpp: number) {
        const on = mpp < DETAIL_MPP;
        near.visible = on; far.visible = !on; track.detailed = on;
        return on;
      },
      dispose() {
        const seen = new Set<THREE.BufferGeometry>();
        group.traverse((o) => { if (o instanceof THREE.Mesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); } });
      },
    };
    track.setDetail(Infinity);
    return track;
  }
}

// Metres per screen pixel at the middle of an orthographic view: what setDetail() wants.
export const metresPerPixel = (cam: THREE.OrthographicCamera, heightPx: number) => (cam.top - cam.bottom) / cam.zoom / Math.max(1, heightPx);
