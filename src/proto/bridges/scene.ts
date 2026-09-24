// The scene around a bridge, as the demo shows it and the tests check it: the ground and the
// route's earthworks as one mesh (embankments, cuttings, spill slopes at the abutments, benches for
// the roads and railways underneath, the map's cut edges), the route's own surface, water, trees,
// and all the track in the scene built together by track.ts.
import * as THREE from 'three';
import { deckAt, deckWidth, groundAt, pointOn, type Crossing } from './crossing';
import { buildBridge, bridgeObject, frameAt, routeMat, Geo } from './geometry';
import { BATTER, dashCuts, EARTH_COLOURS, EarthGeo, earthMaterial, earthPaint, halfSection, isEarth, mirrored, sectionReach, type SectionKind } from './earthworks';
import { BALLAST_DEPTH, formationDrop, TrackBuilder, type Track } from './track';
import { layoutBridge, underside, type BridgeLayout } from './layout';
import { bridgeMaterials, type Mat } from './materials';
import { scenario, type Scenario } from './scenario';
import { chooseBridge } from './choose';
import { BRIDGES, type BridgeId } from './catalogue';
import { extents } from './crossing';
import { GALLERY } from './gallery';

export interface BridgeScene {
  group: THREE.Group; // add this to the scene
  bridge: THREE.Object3D | null; // the bridge itself (null when it can't be built)
  track: Track; // every run of track in the scene
  setOpen: ((t: number) => void) | null; // lifts a bascule's leaves
  setDetail(metresPerPixel: number): void; // near or far track
  dispose(): void; // frees its geometries and instance buffers (materials and textures are shared)
}

function disposeAll(root: THREE.Object3D) {
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (o instanceof THREE.Mesh && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
  });
}

// A gallery type on its own showcase crossing, raised or eased as the chooser would.
export function galleryCrossing(id: BridgeId, bend?: number) {
  const opts = bend === undefined ? GALLERY[id] : { ...GALLERY[id], bend };
  const o = chooseBridge(scenario(opts).crossing).options.find((x) => x.def.id === id)!;
  const c = o.crossing ?? scenario(opts).crossing;
  const sc = scenario(opts); // the water and roads underneath don't move when the deck is raised
  const lay = o.layout ?? layoutBridge(c, BRIDGES[id], ...(extents(c)[0] ?? [0, 0]));
  return { sc: { ...sc, crossing: c }, c, lay, choice: o };
}

// Builds a bridge in its surroundings.
export function bridgeScene(sc: Scenario, c: Crossing, lay: BridgeLayout): BridgeScene {
  const group = new THREE.Group(), tb = new TrackBuilder();
  let bridge: THREE.Object3D | null = null, setOpen: BridgeScene['setOpen'] = null;
  if (lay.ok) {
    const bo = bridgeObject(buildBridge(c, lay, { track: true }), undefined, { track: tb });
    bridge = bo.object;
    group.add(bo.object);
    if (lay.def.opening) setOpen = (t) => { bo.setOpen(t); };
    const leafDetail = bo.setDetail;
    group.add(world(sc, c, lay, tb));
    const track = tb.build();
    group.add(track.group);
    return { group, bridge, track, setOpen, setDetail: (m) => { track.setDetail(m); leafDetail(m); }, dispose: () => disposeAll(group) };
  }
  group.add(world(sc, c, lay, tb));
  const track = tb.build();
  group.add(track.group);
  return { group, bridge, track, setOpen, setDetail: (m) => { track.setDetail(m); }, dispose: () => disposeAll(group) };
}


const lit = (c: string, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide, flatShading: true, ...o });
const waterMat = lit('#3f86b8', { transparent: true, opacity: 0.88 }), waterCut = lit('#2f6f9e', { transparent: true, opacity: 0.8 });
const leafMat = lit('#3f7a3a'), trunkMat = lit('#5b4330');
const red = lit('#d23b2e'), green = lit('#2f9a4a'), hullMat = lit('#2f3a48'), cabinMat = lit('#e9e4d8');

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow = true, name = '') { const x = new THREE.Mesh(g, m); x.receiveShadow = true; x.castShadow = shadow; x.name = name; return x; }
function strip(pos: number[]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; }

type V3 = [number, number, number];
// One line of ground across the route at a station: points left to right, and what each
// stretch between them is (with the colour and grass factor at either end).
interface Line { s: number; pts: V3[]; paint: [string, number][][] }

// The map ends in a cut face, like a slice through the ground: a lip of turf, dark topsoil, a
// band of subsoil following the surface, then rock down to a level base. `top` is the surface
// along the cut. (A paper-thin edge gives the game away.)
const BANDS: [string, number, number][] = [[EARTH_COLOURS.turf, 0, 0.35], [EARTH_COLOURS.topsoil, 0.35, 1.4], [EARTH_COLOURS.subsoil, 1.4, 5], [EARTH_COLOURS.bedrock, 5, Infinity]];
function cutFace(e: EarthGeo, top: V3[], base: number) {
  for (let i = 1; i < top.length; i++) {
    const a = top[i - 1], b = top[i];
    if (Math.hypot(a[0] - b[0], a[2] - b[2]) < 1e-4) continue;
    for (const [col, d0, d1] of BANDS) {
      const a0 = a[1] - d0, a1 = Math.max(base, a[1] - d1), b0 = b[1] - d0, b1 = Math.max(base, b[1] - d1);
      if (a0 - a1 < 1e-3 && b0 - b1 < 1e-3) continue;
      e.quad([[a[0], Math.max(base, a0), a[2]], [b[0], Math.max(base, b0), b[2]], [b[0], b1, b[2]], [a[0], a1, a[2]]], [col, col, col, col], [0, 0, 0, 0]);
    }
  }
}

function world(sc: Scenario, c: Crossing, lay: BridgeLayout, tb: TrackBuilder) {
  const out = new THREE.Group();
  const L = c.path.reduce((a, p, i) => (i ? a + Math.hypot(p.x - c.path[i - 1].x, p.z - c.path[i - 1].z) : 0), 0);
  // The ground is laid in lines across the route, each at the height of the ground where it
  // crosses it: square to the route over its earthworks and a band either side (where the bridge
  // stands, as the bridge's own layout assumes), then straight across the map (x fixed) to its
  // edges. On a curved route that keeps the lines from fanning out and folding over.
  const x0 = c.path[0].x, x1 = c.path[c.path.length - 1].x;
  const xAt = (s: number) => pointOn(c.path, s).x;
  const sOf = (x: number) => { let a = 0, b = L; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (xAt(m) < x) a = m; else b = m; } return (a + b) / 2; };
  const W = Math.max(160, (lay.s1 - lay.s0) * 0.6);
  const hw = deckWidth(c.road) / 2, y = (s: number) => deckAt(c, s), gr = (s: number) => groundAt(c, s);
  const rail = c.road.cls === 'rail';
  const earth = new EarthGeo(), route = new Geo();
  const wetAt = (s: number) => sc.water.some((w) => s > w.s0 - 1 && s < w.s1 + 1);
  const [ground, bank] = [earthPaint('ground', false), earthPaint('bank', false)];

  // Ground paint at a station off the route: grass, the river's banks, or the side slopes of a
  // bench for a road or railway underneath (pale at the crest, lush at the toe).
  const lerpHex = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t))).getHexString();
  const groundPaint = (s: number): [string, number] => {
    if (wetAt(s)) return bank;
    for (const u of sc.under) {
      if (u.bench0 === undefined || u.level === undefined) continue;
      for (const [edge, toe] of [[u.bench0, u.toe0!], [u.bench1!, u.toe1!]]) {
        const t = (s - edge) / (toe - edge);
        if (Math.abs(toe - edge) < 0.5 || t < 0 || t > 1) continue;
        const fill = gr(toe) < u.level; // built out: the bench edge is the crest
        return [lerpHex(EARTH_COLOURS.crest, EARTH_COLOURS.toe, fill ? t : 1 - t), 1];
      }
    }
    return ground;
  };

  // stations along the route: close together on the approaches (and at every dash), wider under
  // the bridge, and at every edge where the ground changes
  const stepA = Math.max(3, L / 400), stepB = Math.max(2, L / 500);
  const approaches: [number, number][] = [[0, lay.s0], [lay.s1, L]].filter(([a, b]) => b - a > 0.5) as [number, number][];
  // Spill slopes: an embankment doesn't stop dead at the abutment; its end runs on under the
  // first span at the same slope as its sides, down to the ground (short of water or a road).
  const blocked = (s: number) => wetAt(s) || sc.under.some((u) => s > Math.min(u.s0, u.toe0 ?? u.s0) - 2 && s < Math.max(u.s1, u.toe1 ?? u.s1) + 2);
  // Short of room, a spill stands steeper (to 1:1, stone-pitched in practice); what's left
  // over is a wing wall.
  const spills: { e: number; dir: 1 | -1; to: number; batter: number }[] = [];
  for (const [e, dir] of [[lay.s0, 1], [lay.s1, -1]] as const) {
    if (!approaches.some(([a, b]) => Math.abs(a - e) < 1e-6 || Math.abs(b - e) < 1e-6)) continue;
    const h = y(e) - formationDrop('ballast') - gr(e);
    if (h < 0.3) continue;
    let d = 0;
    while (d < BATTER * h && d < (lay.s1 - lay.s0) / 2 - 1 && !blocked(e + dir * (d + 0.5))) d += 0.5;
    if (d > 1) spills.push({ e, dir, to: e + dir * d, batter: Math.max(1, Math.min(BATTER, d / h)) });
  }
  const spillAt = (s: number) => spills.find((q) => (s - q.e) * q.dir > 1e-6 && (q.to - s) * q.dir >= -1e-6);
  const onApproach = (s: number) => approaches.some(([a, b]) => s >= a - 1e-6 && s <= b + 1e-6) || !!spillAt(s);
  // the route's cross-section, centreline out: on a spill slope its top falls away from the
  // abutment and is all earth
  const half = (s: number) => {
    const sp = spillAt(s);
    if (!sp) return halfSection(c.road, hw, y(s), gr(s));
    // (and never up into the bridge: under a deep girder or truss it falls away at once)
    const span = lay.spans.find((q) => s >= q.s0 - 1e-6 && s <= q.s1 + 1e-6);
    const soffit = span ? underside(c, span, s) - 0.3 : Infinity;
    const level = Math.max(gr(s) + formationDrop('ballast'), Math.min(soffit, y(sp.e) - Math.abs(s - sp.e) / sp.batter));
    return halfSection(c.road, hw, level, gr(s)).map((q) => (q.kind === 'ditch' ? q : { ...q, kind: 'slope' as const }));
  };
  const cuts = new Set<number>([0, L, lay.s0, lay.s1]);
  for (const [a, b] of approaches) {
    for (let s = a; s < b; s += stepA) cuts.add(s);
    if (!rail && c.road.median <= 0) for (const s of dashCuts(a, b)) cuts.add(s);
  }
  for (let s = lay.s0; s < lay.s1; s += stepB) cuts.add(s);
  for (const q of spills) { for (let d = 0; d < Math.abs(q.to - q.e); d += 1.5) cuts.add(q.e + q.dir * d); cuts.add(q.to); }
  for (const w of sc.water) cuts.add(w.s0 - 1).add(w.s1 + 1);
  for (const u of sc.under) {
    for (const s of [u.bench0, u.bench1, u.toe0, u.toe1, (u.s0 + u.s1) / 2]) if (s !== undefined) cuts.add(s);
    if (u.kind === 'road') for (const [n] of roadUnder((u.s1 - u.s0) / 2)) cuts.add((u.s0 + u.s1) / 2 + n);
  }
  const stations = [...cuts].filter((s) => s >= 0 && s <= L).sort((a, b) => a - b).filter((s, i, a) => i === 0 || s - a[i - 1] > 0.05);

  // the approaches' reach at the bridge ends: the ground under the bridge lines up with it
  const reachAt = (s: number) => sectionReach(half(s));
  const endA = spills.find((q) => q.dir === 1)?.to ?? lay.s0, endB = spills.find((q) => q.dir === -1)?.to ?? lay.s1;
  const rA = reachAt(Math.max(0, endA)), rB = reachAt(Math.min(L, endB));
  // The band narrows where the route curves hard, so lines square to it can't converge and cross
  // on the inside of the curve within it (at most half-way to the centre of the curve).
  const bandAt = (s: number, r: number) => {
    const a = frameAt(c, Math.max(0, s - 5)), b = frameAt(c, Math.min(L, s + 5));
    const k = Math.abs(Math.atan2(a.ux * b.uz - a.uz * b.ux, a.ux * b.ux + a.uz * b.uz)) / 10; // curvature, 1/m
    return Math.max(4, Math.min(30, 0.4 / Math.max(k, 1e-6) - r));
  };
  // The direction across the route at s, smoothed over 3 m: the route is a polyline, and its
  // segments' own directions jump at every corner, which 30 m out would fold the ground.
  const across = (s: number) => {
    const f = frameAt(c, s), a = pointOn(c.path, Math.max(0, s - 1.5)), b = pointOn(c.path, Math.min(L, s + 1.5)), d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d > 1e-6) { f.ux = (b.x - a.x) / d; f.uz = (b.z - a.z) / d; f.nx = -f.uz; f.nz = f.ux; }
    return f;
  };
  const lineAt = (s: number, side: 'approach' | 'under'): Line => {
    const f = across(s), p = (n: number, h: number): V3 => [f.x + f.nx * n, h, f.z + f.nz * n];
    const g = gr(s), gp = groundPaint(s), edge = (z: number): V3 => [f.x, g, z];
    if (side === 'under') {
      // the earthworks' reach, eased from one end of the bridge to the other
      const t = Math.max(0, Math.min(1, (s - endA) / Math.max(1, endB - endA))), r = rA + (rB - rA) * t;
      const band = bandAt(s, r);
      return { s, pts: [edge(-W), p(-r - band, g), p(-r, g), p(r, g), p(r + band, g), edge(W)], paint: [0, 1, 2, 3, 4].map(() => [gp, gp]) };
    }
    const { pts, kinds } = mirrored(half(s)), r0 = -pts[0].n, r1 = pts[pts.length - 1].n;
    const all: V3[] = [edge(-W), p(-r0 - bandAt(s, r0), g), ...pts.map((q) => p(q.n, q.y)), p(r1 + bandAt(s, r1), g), edge(W)];
    const paint: [string, number][][] = [[gp, gp], [gp, gp]];
    kinds.forEach((kd, e) => {
      const a = pts[e], b = pts[e + 1];
      if (!isEarth(kd)) { paint.push([]); return; } // the route's own surface: drawn separately
      paint.push([earthPaint(kd, a.y >= b.y), earthPaint(kd, b.y > a.y)]);
    });
    paint.push([gp, gp], [gp, gp]);
    return { s, pts: all, paint };
  };
  const kindsOf = (s: number) => ['ground', 'ground', ...mirrored(half(s)).kinds, 'ground', 'ground'] as SectionKind[];

  // sweep the lines into the ground mesh, and the route's own surface into the route mesh
  const lines: Line[] = [];
  const sweepLines = (ls: Line[], approach: boolean) => {
    for (let i = 1; i < ls.length; i++) {
      const A = ls[i - 1], B = ls[i], kinds = approach ? kindsOf((A.s + B.s) / 2) : null;
      for (let e = 0; e + 1 < A.pts.length; e++) {
        const q = [A.pts[e], A.pts[e + 1], B.pts[e + 1], B.pts[e]];
        const kd = kinds?.[e];
        if (kd && !isEarth(kd)) {
          const m = routeMat(kd, A.s, B.s);
          if (m) route.quad(m, ...(q as [V3, V3, V3, V3]));
          continue;
        }
        // (where a spill slope meets the route, one end's stretch was route surface: use the other's paint)
        const pa = A.paint[e].length ? A.paint[e] : B.paint[e], pb = B.paint[e].length ? B.paint[e] : A.paint[e];
        if (!pa.length || !pb.length) continue;
        if (Math.hypot(q[0][0] - q[1][0], q[0][2] - q[1][2]) < 1e-4 && Math.hypot(q[2][0] - q[3][0], q[2][2] - q[3][2]) < 1e-4) continue;
        earth.quad(q, [pa[0][0], pa[1][0], pb[1][0], pb[0][0]], [pa[0][1], pa[1][1], pb[1][1], pb[0][1]]);
      }
    }
  };
  // group consecutive stations into runs of the same kind, sharing the end station
  let run: Line[] = [], runSide: 'approach' | 'under' | null = null;
  const runs: [Line[], boolean][] = [], ordered: Line[] = [];
  const flush = () => { if (run.length > 1) runs.push([run, runSide === 'approach']); };
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i], last = i + 1 === stations.length;
    const side: 'approach' | 'under' = last && runSide ? runSide : onApproach((s + stations[i + 1]) / 2) ? 'approach' : 'under';
    const here = lineAt(s, runSide ?? side);
    lines.push(here);
    ordered.push(here);
    run.push(here);
    if (runSide && side !== runSide) {
      flush();
      // where earthworks still stand at the bridge (a cutting, or a spill cut short), they end in
      // a wing wall down to (or up from) the ground beneath the bridge
      const other = lineAt(s, side), a = runSide === 'approach' ? here : other, u = runSide === 'approach' ? other : here;
      const top = a.pts, g = u.pts[0][1];
      for (let e = 2; e + 3 < top.length; e++) {
        const p = top[e], q = top[e + 1];
        if (Math.abs(p[1] - g) < 1e-3 && Math.abs(q[1] - g) < 1e-3) continue;
        const col = '#b3ada2'; // a wing wall, in the bridge's footing stone
        earth.quad([p, q, [q[0], g, q[2]], [p[0], g, p[2]]], [col, col, col, col], [0, 0, 0, 0]);
      }
      run = [other];
      ordered.push(other);
    }
    runSide = side;
  }
  flush();
  // Where the route curves hard and the earthworks' reach changes fast (a spill slope), the band's
  // outer points could step backwards and fold the ground over itself: keep them moving on along
  // the route.
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i];
    for (const [ka, kb] of [[1, 1], [a.pts.length - 2, b.pts.length - 2]]) {
      const p = a.pts[ka], q = b.pts[kb];
      if (Math.abs(b.s - a.s) < 1e-6) { q[0] = p[0]; q[2] = p[2]; continue; }
      // progress measured along the route (the lines may run at any angle to x)
      const f = frameAt(c, b.s), ahead = (q[0] - p[0]) * f.ux + (q[2] - p[2]) * f.uz, want = 0.02 * (b.s - a.s);
      if (ahead < want) { q[0] += (want - ahead) * f.ux; q[2] += (want - ahead) * f.uz; }
    }
  }
  for (const [ls, approach] of runs) sweepLines(ls, approach);

  // the map's cut edges, along both sides and across both ends
  let lowest = Infinity;
  for (const l of lines) for (const p of l.pts) lowest = Math.min(lowest, p[1]);
  const base = lowest - 18;
  cutFace(earth, lines.map((l) => l.pts[0]), base);
  cutFace(earth, lines.map((l) => l.pts[l.pts.length - 1]), base);
  cutFace(earth, lineAt(0, onApproach(0.1) ? 'approach' : 'under').pts, base);
  cutFace(earth, lineAt(L, onApproach(L - 0.1) ? 'approach' : 'under').pts, base);
  // the river shows at the cut as a column of water down to its bed
  const wc: number[] = [];
  for (const edge of [0, -1]) for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i], w = sc.water.find((q) => a.s >= q.s0 - 1e-6 && b.s <= q.s1 + 1e-6);
    if (!w) continue;
    const pa = a.pts.at(edge)!, pb = b.pts.at(edge)!;
    wc.push(pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], pb[0], w.level, pb[2], pa[0], pa[1], pa[2], pb[0], w.level, pb[2], pa[0], w.level, pa[2]);
  }
  out.add(mesh(earth.geometry(), earthMaterial(), false, 'earth'));
  if (wc.length) out.add(mesh(strip(wc), waterCut, false));
  for (const w of sc.water) {
    const xa = xAt(w.s0), xb = xAt(w.s1);
    out.add(mesh(strip([xa, w.level, -W, xb, w.level, -W, xb, w.level, W, xa, w.level, -W, xb, w.level, W, xa, w.level, W]), waterMat, false));
  }
  // channel buoys and a boat, to show where the piers can't go
  for (const o of c.obstacles) {
    if (o.kind !== 'water' || !o.channel) continue;
    // (the buoys are instanced: a long river has a hundred of them)
    const ch = o.channel, xa = xAt(ch.s0), xb = xAt(ch.s1), buoy = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 8);
    const zs: number[] = [];
    for (let z = -W + 20; z < W; z += 45) if (Math.abs(z) >= 30) zs.push(z);
    for (const [x, m] of [[xa, red], [xb, green]] as const) {
      const im = new THREE.InstancedMesh(buoy, m, zs.length), m4 = new THREE.Matrix4();
      zs.forEach((z, i) => im.setMatrixAt(i, m4.makeTranslation(x, o.level + 1, z)));
      im.computeBoundingSphere();
      im.castShadow = true; im.receiveShadow = true; im.name = 'buoys';
      out.add(im);
    }
    const bw = Math.min(10, (xb - xa) * 0.3), bl = bw * 3.2, boat = new THREE.Group();
    const hull = mesh(new THREE.BoxGeometry(bw, 2.2, bl), hullMat); hull.position.y = 1.1; boat.add(hull);
    const cab = mesh(new THREE.BoxGeometry(bw * 0.7, 2.6, bl * 0.25), cabinMat); cab.position.set(0, 3.4, -bl * 0.25); boat.add(cab);
    const mast = mesh(new THREE.BoxGeometry(0.4, ch.clear - 2, 0.4), cabinMat); mast.position.set(0, (ch.clear - 2) / 2 + 2, bl * 0.1); boat.add(mast);
    boat.position.set((xa + xb) / 2, o.level, W * 0.55);
    out.add(boat);
  }
  // roads and railways underneath, across the route on their benches, along the line of ground
  // through their middle: a road on its own pavement with sloping edges, a railway on its ballast
  const underLines: { path: { x: number; z: number }[]; clear: number }[] = [];
  for (const u of sc.under) {
    const mid = (u.s0 + u.s1) / 2, hwU = (u.s1 - u.s0) / 2, g = u.level ?? gr(mid);
    const line = (ordered.find((l) => Math.abs(l.s - mid) < 1e-6) ?? lineAt(mid, onApproach(mid) ? 'approach' : 'under')).pts;
    const path = [line[0], line[1], line[line.length - 2], line[line.length - 1]].map((q) => ({ x: q[0], z: q[2], y: 0 }));
    // (trees keep clear of it, its bench and the bench's slopes, measured on the ground)
    underLines.push({ path, clear: Math.max(hwU, mid - (u.toe0 ?? u.s0), (u.toe1 ?? u.s1) - mid) + 1 });
    const len = path.reduce((a, q, i) => (i ? a + Math.hypot(q.x - path[i - 1].x, q.z - path[i - 1].z) : 0), 0);
    if (u.kind === 'rail') {
      tb.add({ path, s0: 0, s1: len, level: () => g + BALLAST_DEPTH, tracks: 2, form: 'ballast', year: c.year, step: 12 });
      continue;
    }
    // Across: edge slope, carriageway with edge lines and a dashed centre line, edge slope. Each
    // edge of each stretch is a line of the ground itself (a station at mid + n), so the road
    // lies exactly over its bench however the lines run.
    const sec = roadUnder(hwU), kinds: SectionKind[] = ['surface', 'surface', 'line', 'surface', 'centre', 'surface', 'line', 'surface', 'surface'];
    const polys = sec.map(([n]) => (ordered.find((q) => Math.abs(q.s - (mid + n)) < 1e-6) ?? lineAt(mid + n, 'under')).pts);
    // along: every corner of the middle line and every dash, as fractions of each line's length
    const lens = polys.map((q) => q.reduce((a, v, i) => (i ? a + Math.hypot(v[0] - q[i - 1][0], v[2] - q[i - 1][2]) : 0), 0));
    const midPoly = polys[4], midLen = lens[4], cumM = [0];
    for (let i = 1; i < midPoly.length; i++) cumM.push(cumM[i - 1] + Math.hypot(midPoly[i][0] - midPoly[i - 1][0], midPoly[i][2] - midPoly[i - 1][2]));
    const ts = [...new Set([...cumM.map((d) => d / midLen), ...dashCuts(0, midLen).map((d) => d / midLen)])].sort((a, b) => a - b);
    const at = (q: V3[], len: number, t: number, h: number): V3 => {
      let d = t * len;
      for (let i = 1; i < q.length; i++) {
        const l = Math.hypot(q[i][0] - q[i - 1][0], q[i][2] - q[i - 1][2]);
        if (d <= l + 1e-9 || i === q.length - 1) { const f = l ? Math.min(1, d / l) : 0; return [q[i - 1][0] + (q[i][0] - q[i - 1][0]) * f, g + h, q[i - 1][2] + (q[i][2] - q[i - 1][2]) * f]; }
        d -= l;
      }
      return [q[0][0], g + h, q[0][2]];
    };
    for (let i = 1; i < ts.length; i++) for (let e2 = 0; e2 + 1 < sec.length; e2++) {
      const m = routeMat(kinds[e2], ts[i - 1] * midLen, ts[i] * midLen)!;
      const [, ha] = sec[e2], [, hb] = sec[e2 + 1];
      route.quad(m, at(polys[e2], lens[e2], ts[i - 1], ha), at(polys[e2 + 1], lens[e2 + 1], ts[i - 1], hb), at(polys[e2 + 1], lens[e2 + 1], ts[i], hb), at(polys[e2], lens[e2], ts[i], ha));
    }
  }
  // the route itself on the approaches: ballast and track, or the road's surface
  if (rail) for (const [a, b] of approaches) tb.add({ path: c.path, s0: a, s1: b, level: y, tracks: c.road.tracks, form: 'ballast', year: c.year });
  const mats = bridgeMaterials();
  for (const [m, g] of Object.entries(route.geometries()) as [Mat, THREE.BufferGeometry][]) out.add(mesh(g, mats[m], false, `route-${m}`));
  trees(out, c, sc, sOf, x0, x1, W, (s) => (onApproach(s) ? reachAt(s) : hw + 14 + Math.max(0, y(s) - gr(s)) * 2), heightOn(earth), underLines);
  return out;
}

// Scattered trees, one draw call each for crowns and trunks, clear of the water, roads and route.
// The height of the ground mesh at (x, z), from its up-facing triangles: trees stand on the
// ground as built, wherever the lines of it run.
function heightOn(e: EarthGeo) {
  // bucketed by x only: the ground's triangles are narrow along the route and long across it
  const C = 4, cells = new Map<number, number[]>(), P = e.pos;
  for (let i = 0; i < P.length; i += 9) {
    const ny = (P[i + 5] - P[i + 2]) * (P[i + 6] - P[i]) - (P[i + 3] - P[i]) * (P[i + 8] - P[i + 2]);
    if (Math.abs(ny) < 1e-6) continue; // vertical (the map's cut edges)
    const x0 = Math.floor(Math.min(P[i], P[i + 3], P[i + 6]) / C), x1 = Math.floor(Math.max(P[i], P[i + 3], P[i + 6]) / C);
    for (let x = x0; x <= x1; x++) { let a = cells.get(x); if (!a) cells.set(x, (a = [])); a.push(i); }
  }
  return (x: number, z: number) => {
    let best = -Infinity;
    for (const i of cells.get(Math.floor(x / C)) ?? []) {
      const ax = P[i], az = P[i + 2], bx = P[i + 3], bz = P[i + 5], cx = P[i + 6], cz = P[i + 8];
      if (z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
      const d = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      const l1 = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / d, l2 = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / d, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      best = Math.max(best, l1 * P[i + 1] + l2 * P[i + 4] + l3 * P[i + 7]);
    }
    return best;
  };
}

// A road underneath, across it: [offset from its middle, height above its bench] for its edge
// slopes, carriageway, edge lines and centre line.
function roadUnder(hw: number): [number, number][] {
  const P = 0.15, e = hw - 0.6;
  // (the pavement edges are steep: out where the lines of ground spread apart they flatten)
  return [[-hw - 0.12, 0], [-hw, P], [-e - 0.08, P], [-e + 0.08, P], [-0.08, P], [0.08, P], [e - 0.08, P], [e + 0.08, P], [hw, P], [hw + 0.12, 0]];
}

// distance in plan from a point to a polyline
function distTo(path: { x: number; z: number }[], x: number, z: number) {
  let best = Infinity;
  for (let j = 1; j < path.length; j++) {
    const a = path[j - 1], b = path[j], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

function trees(out: THREE.Group, c: Crossing, sc: Scenario, sOf: (x: number) => number, x0: number, x1: number, W: number, reach: (s: number) => number, heightAt: (x: number, z: number) => number, under: { path: { x: number; z: number }[]; clear: number }[]) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots: THREE.Vector3[] = [], sizes: number[] = [];
  for (let i = 0; i < 900 && spots.length < 260; i++) {
    // (the widest crown is 4.2 m across its radius: all of it stays inside the map's edges)
    const x = x0 + 5 + (x1 - x0 - 10) * rnd(), z = (rnd() * 2 - 1) * (W - 5), s = sOf(x);
    if (sc.water.some((w) => s > w.s0 - 8 && s < w.s1 + 8)) continue;
    // clear of the roads underneath and their benches, and of the route's earthworks (a crown is
    // about 4 m across)
    if (sc.under.some((u) => s > Math.min(u.s0, u.toe0 ?? u.s0) - 6 && s < Math.max(u.s1, u.toe1 ?? u.s1) + 6)) continue;
    if (under.some((u) => distTo(u.path, x, z) < u.clear + 5)) continue;
    const p = frameAt(c, s);
    if (Math.abs(z - p.z) < reach(s) + 5) continue;
    // crowns never overlap: two cones of the same slope meeting would flicker where they cross
    const r = 0.7 + rnd() * 0.6;
    if (spots.some((q, j) => Math.hypot(q.x - x, q.z - z) < 3.2 * (r + sizes[j]) + 0.2)) continue;
    const h = heightAt(x, z);
    if (!Number.isFinite(h)) continue;
    spots.push(new THREE.Vector3(x, h, z));
    sizes.push(r);
  }
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 9, 7), leafMat, spots.length);
  // trunks are open tubes sunk a little into the ground: no end faces lying on the grass
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.6, 3.5, 5, 1, true), trunkMat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach((p, i) => {
    const s = sizes[i];
    m4.makeScale(s, s, s).setPosition(p.x, p.y + 7 * s, p.z); crown.setMatrixAt(i, m4);
    m4.makeScale(s, s, s).setPosition(p.x, p.y + 1.25 * s, p.z); trunk.setMatrixAt(i, m4);
  });
  crown.castShadow = true; trunk.castShadow = true;
  crown.name = 'tree-crowns'; trunk.name = 'tree-trunks';
  out.add(crown, trunk);
}

