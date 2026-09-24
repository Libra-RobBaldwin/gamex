// Railway stations (docs/loop.md, M4): platforms either side of a straight, level run of track,
// where the trains of the player's rail lines draw up. A station is found again after the
// network is rebuilt by where it stands, not by the road id (which a rebuild can change).
//
// The platforms are plain boxes with a yellow safety line and a shelter each, at the height of the
// track: on the town's raised main line they stand on solid embankment down to the ground.
// Nothing lies flat on anything else: the safety line stands 2 cm proud of the platform top and
// the platforms stand clear of the track, so there's nothing to flicker.
import * as THREE from 'three';
import { closestOnPath, pointAt, rectCorners, type Network, type P, type RSeg } from '../roads';
import type { StationSpot } from '../traffic';

export const PLATFORM = 110; // metres: a four-car local train or a short intercity
const HEIGHT = 0.9, WIDTH = 3.5;
export const STATION_LIST_PRICE = 1_200_000;

export interface Station { id: number; name: string; x: number; z: number; len: number; group: THREE.Group }
export interface StationPlan { ok: boolean; reason?: string; seg?: RSeg; s?: number; x: number; z: number; heading: number }

const NAMES = ['Ashcombe', 'Ashcombe Parkway', 'Millbrook Halt', 'Ashcombe North', 'Fairfield Road', 'Wharfside', 'Ashcombe East', 'Brookside'];
const MAT = {
  deck: new THREE.MeshLambertMaterial({ color: '#b9b4a8' }),
  edge: new THREE.MeshLambertMaterial({ color: '#e3c14a' }),
  roof: new THREE.MeshLambertMaterial({ color: '#1f5e3f' }),
  post: new THREE.MeshLambertMaterial({ color: '#2b2f2c' }),
};

export class Stations {
  list: Station[] = [];
  readonly group = new THREE.Group();
  constructor(private net: Network) {}

  // the track under a point on the ground, and whether a station can stand there
  plan(p: P): StationPlan {
    const q = this.net.nearestSeg(p, 14, (s) => this.net.def(s).cls === 'rail');
    if (!q) return { ok: false, reason: 'Tap on a railway line', x: p.x, z: p.z, heading: 0 };
    const seg = q.seg, path = this.net.path(seg), L = this.net.length(seg), half = PLATFORM / 2;
    const s = Math.max(half + 20, Math.min(L - half - 20, q.s));
    const c = pointAt(path, s), heading = Math.atan2(c.uz, c.ux);
    const out = { seg, s, x: c.x, z: c.z, heading };
    if (L < PLATFORM + 40) return { ok: false, reason: 'This stretch of track is too short for platforms', ...out };
    // straight and level along the platforms, and nothing passing under them
    const a = pointAt(path, s - half), b = pointAt(path, s + half);
    const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(b.uz, b.ux) - Math.atan2(a.uz, a.ux)), Math.cos(Math.atan2(b.uz, b.ux) - Math.atan2(a.uz, a.ux))));
    if (turn > 0.06) return { ok: false, reason: 'Platforms need a straight run of track', ...out };
    // (an even gradient is allowed, as gentle as the main line's 2.5% climbs: the platforms follow it)
    const y0 = c.y ?? 0, ya = a.y ?? 0, yb = b.y ?? 0;
    if (Math.abs(yb - ya) / PLATFORM > 0.03) return { ok: false, reason: 'The track is too steep here for platforms', ...out };
    for (let t = s - half; t <= s + half; t += 10) { const k = (t - (s - half)) / PLATFORM; if (Math.abs((pointAt(path, t).y ?? 0) - (ya + (yb - ya) * k)) > 0.35) return { ok: false, reason: 'Platforms need an even run of track, not over a crest or dip', ...out }; }
    if (y0 < -0.6) return { ok: false, reason: 'Platforms can’t go in a cutting or tunnel yet', ...out };
    if (this.list.some((st) => Math.hypot(st.x - c.x, st.z - c.z) < PLATFORM + 60)) return { ok: false, reason: 'There’s a station too close by', ...out };
    // nor a road beneath the track there (the platforms stand on solid ground)
    const under = rectCorners(c.x, c.z, heading, PLATFORM + 10, 2 * (this.edge(seg) + WIDTH) + 4);
    for (const r of this.net.segs.values()) {
      if (this.net.def(r).cls !== 'road') continue;
      const rp = this.net.path(r);
      for (let i = 1; i < rp.length; i++) if (segHitsPoly(rp[i - 1], rp[i], under)) return { ok: false, reason: 'A road passes under the track here', ...out };
    }
    // the platforms' land must be clear of buildings
    const off = this.edge(seg) + WIDTH / 2;
    for (const side of [1, -1]) {
      const cx = c.x - c.uz * off * side, cz = c.z + c.ux * off * side, poly = rectCorners(cx, cz, heading, PLATFORM, WIDTH);
      if (this.net.lots.some((l) => Math.hypot(l.x - cx, l.z - cz) < PLATFORM / 2 + 20 && overlaps(poly, rectCorners(l.x, l.z, l.rot, l.w, l.d)))) return { ok: false, reason: 'Buildings stand where the platforms would go', ...out };
    }
    return { ok: true, ...out };
  }
  // how far out from the track's middle the platform edge is: beyond the outer track and the train
  private edge(seg: RSeg) { return (this.net.def(seg).tracks === 2 ? 2 : 0) + 1.65; }

  add(pl: StationPlan): Station | null {
    if (!pl.ok || !pl.seg || pl.s === undefined) return null;
    const id = this.net.nextId++, name = NAMES[this.list.length % NAMES.length] + (this.list.length >= NAMES.length ? ` ${Math.floor(this.list.length / NAMES.length) + 1}` : '');
    const st: Station = { id, name, x: pl.x, z: pl.z, len: PLATFORM, group: this.build(pl) };
    this.list.push(st);
    this.group.add(st.group);
    this.claim(st, pl);
    return st;
  }
  private claim(st: Station, pl: StationPlan) {
    const off = this.edge(pl.seg!) + WIDTH / 2, polys = [1, -1].map((side) => rectCorners(pl.x - Math.sin(pl.heading) * off * side, pl.z + Math.cos(pl.heading) * off * side, pl.heading, PLATFORM, WIDTH + 1));
    this.net.land.claim(`station:${st.id}`, 'station', polys);
  }
  // where a station is on today's network (the road ids may have changed since it was built)
  spot(id: number): StationSpot | null {
    const st = this.list.find((x) => x.id === id);
    if (!st) return null;
    const q = this.net.nearestSeg({ x: st.x, z: st.z }, 10, (s) => this.net.def(s).cls === 'rail');
    return q ? { seg: q.seg, s: closestOnPath({ x: st.x, z: st.z }, this.net.path(q.seg)).s, len: st.len } : null;
  }
  near(p: P, r = 40) { let best: Station | null = null, bd = r; for (const st of this.list) { const d = Math.hypot(st.x - p.x, st.z - p.z); if (d < bd) { bd = d; best = st; } } return best; }
  byId(id: number) { return this.list.find((x) => x.id === id) ?? null; }

  // two side platforms with a safety line and a shelter each, following the track's gradient
  private build(pl: StationPlan) {
    const g = new THREE.Group(), path = this.net.path(pl.seg!), half = PLATFORM / 2, off = this.edge(pl.seg!) + WIDTH / 2;
    const c = pointAt(path, pl.s!), ya = Math.max(0, pointAt(path, pl.s! - half).y ?? 0), yb = Math.max(0, pointAt(path, pl.s! + half).y ?? 0), yc = Math.max(0, c.y ?? 0);
    g.position.set(c.x, 0, c.z);
    g.rotation.y = -pl.heading;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material) => { const b = new THREE.Mesh(geo, m); b.castShadow = true; b.receiveShadow = true; g.add(b); };
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, yy: number, z: number) => { const geo = new THREE.BoxGeometry(w, h, d); geo.translate(x, yy, z); add(geo, m); };
    for (const side of [1, -1]) {
      const z = off * side;
      // from the ground up to the platform top (the track's height plus a platform's), sloping with it
      add(slab(-half, half, 0, 0, ya + HEIGHT, yb + HEIGHT, z - WIDTH / 2, z + WIDTH / 2), MAT.deck);
      const ez = z - side * (WIDTH / 2 - 0.4);
      add(slab(-half, half, ya + HEIGHT, yb + HEIGHT, ya + HEIGHT + 0.02, yb + HEIGHT + 0.02, ez - 0.175, ez + 0.175), MAT.edge);
      // a shelter towards the back of the platform
      const top = yc + HEIGHT;
      box(18, 0.15, 2.2, MAT.roof, 0, top + 2.7, z + side * 0.4);
      // (posts reach down into the sloping deck, so none stands clear of it at the low end)
      for (const x of [-8, 0, 8]) box(0.15, 3, 0.15, MAT.post, x, top + 1.15, z + side * 1.2);
    }
    return g;
  }
}

// a box whose bottom and top can each slope along x: bottom from yb0 (at x0) to yb1 (at x1), top
// from yt0 to yt1, from z0 to z1 across
function slab(x0: number, x1: number, yb0: number, yb1: number, yt0: number, yt1: number, z0: number, z1: number) {
  const v = [
    [x0, yb0, z0], [x1, yb1, z0], [x1, yb1, z1], [x0, yb0, z1], // bottom
    [x0, yt0, z0], [x1, yt1, z0], [x1, yt1, z1], [x0, yt0, z1], // top
  ];
  const quads = [[4, 7, 6, 5], [0, 1, 2, 3], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
  const pos: number[] = [];
  for (const [a, b, c, d] of quads) for (const i of [a, b, c, a, c, d]) pos.push(...v[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
// does a line segment cross (or lie in) a convex polygon?
function segHitsPoly(a: P, b: P, poly: { x: number; z: number }[]) {
  const inside = (p: P) => poly.every((q, i) => { const r = poly[(i + 1) % poly.length]; return (r.x - q.x) * (p.z - q.z) - (r.z - q.z) * (p.x - q.x) >= 0; }) || poly.every((q, i) => { const r = poly[(i + 1) % poly.length]; return (r.x - q.x) * (p.z - q.z) - (r.z - q.z) * (p.x - q.x) <= 0; });
  if (inside(a) || inside(b)) return true;
  return overlaps([a, b, b, a], poly);
}
// do two convex polygons overlap? (separating axes)
function overlaps(a: { x: number; z: number }[], b: { x: number; z: number }[]) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], nx = q.z - p.z, nz = p.x - q.x;
    const pa = a.map((v) => v.x * nx + v.z * nz), pb = b.map((v) => v.x * nx + v.z * nz);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
