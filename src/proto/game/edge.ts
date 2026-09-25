// The edge of the map: a cut face, like a slice through the ground (the bridges demo's look). A
// lip of turf, dark topsoil and a band of subsoil follow the ground; below them the rock lies in
// beds (clay, sandstone, mudstone, limestone) that fold gently across the country rather than
// following the surface, as real strata do, down to a level base. Where the sea, a lake or a river
// meets the edge, the slice shows the water standing in its bed; where a road or railway runs off
// the map, it shows that in section too (the surface and the stone it's laid on).
//
// Everything is cut exactly: each column of the face is split wherever two of its layer lines
// cross, so no two pieces ever overlap (nothing fights for the same pixels), and the face's top is
// the ground's own height at the same points the ground mesh has them (no gap, no lip). One mesh
// with vertex colours (a big map cuts it into tiles: regionview.ts splitByTile).
import * as THREE from 'three';
import { EARTH_COLOURS } from '../bridges/earthworks';
import { kerbOf } from '../catalog';
import { STD } from '../standards';
import type { Network } from '../roads';

export const EDGE_BASE = -26; // how far down the town's slice goes (a big map's goes deeper: edgeDepth)
// how deep a map's slice goes: deep enough to read as a slab of crust from right out
export const edgeDepth = (edge: number) => (edge < 1500 ? -EDGE_BASE : Math.min(260, Math.max(60, edge * 0.022)));
const WATER = ['#3d7fae', '#1d4f78']; // (the bridges demo's water in section: lighter at the top)
const ROAD = { asphalt: '#3d4046', footway: '#b3a996', subbase: '#8a8378', ballast: '#8f887c', fill: '#9b7a4c' };
// the rock beds under the soil, top down: each bed's thickness (m) and colour; the last runs to the base
const BEDS: [number, string][] = [[7, '#8e7a63'], [5, '#b99a68'], [9, '#7f756b'], [4, '#c2b594'], [12, '#9a8a73'], [6, '#6f6a64'], [18, '#a79978'], [Infinity, EARTH_COLOURS.bedrock]];
const MAX_COLS = 20000; // columns a side at most (a 19 km map on a 25 m grid is under 1,200)

// How much a soil band's lower edge wanders (m) at distance s along the perimeter: a few gentle waves
const wander = (s: number, k: number) => 0.18 * Math.sin(s * 0.031 + k * 1.7) + 0.12 * Math.sin(s * 0.093 + k * 4.1) + 0.06 * Math.sin(s * 0.27 + k);
// The rock beds' fold: how far the top of the rock lies below the ground (m, before the hills lift
// it) at a world point. Long, low folds with a gentle dip, so the beds rise and fall along each side
// of the map and meet at the corners. (The hills are made of the rock: it rises under them.)
function fold(x: number, z: number, depth: number) {
  const a = depth / 90;
  return -6 - a * (7 * Math.sin(x * 0.0011 + 0.7) * Math.cos(z * 0.0009 - 0.4) + 4 * Math.sin((x + z) * 0.0023 + 2.1) + 1.6 * Math.sin(x * 0.0071 - z * 0.0053)) - (x * 0.0012 - z * 0.0008) * a;
}

// A road or railway crossing the edge: where along the side (u, across it), its half-widths, its level.
export interface EdgeCrossing { side: number; u: number; half: number; kerb: number; y: number; rail: boolean }

// Roads that run off the map (ending near the buildable edge, or at the ground's edge itself,
// heading out) cross the cut face at `edge` where they'd reach it running straight on.
export function edgeCrossings(net: Network, edge: number): EdgeCrossing[] {
  const out: EdgeCrossing[] = [], near = net.bound - STD.mapEdge - 1;
  if (net.edge < edge - 1) return out; // (roads running off the map are drawn only as far as that: they don't reach this edge)
  for (const s of net.segs.values()) {
    const path = net.path(s);
    if (path.length < 2) continue;
    for (const [p, q] of [[path[path.length - 1], path[path.length - 2]], [path[0], path[1]]]) {
      if (Math.max(Math.abs(p.x), Math.abs(p.z)) < near) continue;
      // (only a dead end, or a join on the edge itself (the railway running on off the map): a road
      // through a node out here carries on along the map)
      const end = p === path[0] ? s.a : s.b;
      if (net.segsAt(end).length > 1 && Math.max(Math.abs(p.x), Math.abs(p.z)) < edge - 1) continue;
      const L = Math.hypot(p.x - q.x, p.z - q.z) || 1, dx = (p.x - q.x) / L, dz = (p.z - q.z) / L;
      // which side it's heading out through, and where it meets it
      const side = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 0 : 2) : dz > 0 ? 1 : 3;
      const along = side === 0 || side === 2 ? dx : dz;
      const pos = side === 0 || side === 2 ? p.x : p.z;
      if (pos * along <= 0) continue; // (heading out, not in from past the edge)
      const t = (Math.sign(along) * edge - pos) / along;
      if (!(t >= 0)) continue;
      const hit = { x: p.x + dx * t, z: p.z + dz * t };
      const d = net.def(s), cos = Math.abs(along) || 1; // (a road meeting the edge at a slant is wider along it)
      out.push({ side, u: [-hit.z, hit.x, hit.z, -hit.x][side], half: net.half(s) / cos, kerb: (d.cls === 'rail' ? net.half(s) : kerbOf(d)) / cos, y: p.y ?? 0, rail: d.cls === 'rail' });
    }
  }
  return out;
}

export interface EdgeOpts {
  base?: number; // the level the slice goes down to (default: the town's EDGE_BASE)
  step?: number; // the ground's grid (m): the face's columns fall on its lines, so its top is the ground's
  // the water's level where the ground dips below it (a number, or per point: null where there's none)
  level?: number | ((x: number, z: number) => number | null);
}

// A line across one column of the face: its heights at the column's two ends
type Line = { a: number; b: number; k: number };
// what each layer is (Line.k): the soil lines, the rock beds' tops, the base, water, the road's layers
const K = { surf: 0, turf: 1, top: 2, sub: 3, base: 4, water: 5, road: 6, rock: 20 };

// `ground`: the ground's height at a point, as the ground mesh has it (hills and the beds of lakes,
// rivers and the sea); where it's below the water's level, the slice shows the water standing in the bed.
export function edgeMesh(edge: number, crossings: EdgeCrossing[] = [], ground: (x: number, z: number) => number = () => 0, level: number | EdgeOpts = 0, opts: EdgeOpts = {}) {
  if (typeof level === 'object') { opts = level; level = opts.level as number ?? 0; }
  const lv = opts.level ?? level;
  const levelAt = typeof lv === 'function' ? lv : () => lv;
  const base = opts.base ?? EDGE_BASE, depth = -base;
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  const c = new THREE.Color(), c2 = new THREE.Color();
  // side k's frame: a point u along it (-edge..edge)
  const P = (k: number, u: number): [number, number] => (k === 0 ? [edge, -u] : k === 1 ? [u, edge] : k === 2 ? [-edge, u] : [-u, -edge]);
  const out = (k: number, d: number): [number, number] => (k === 0 ? [d, 0] : k === 1 ? [0, d] : k === 2 ? [-d, 0] : [0, -d]);
  const gAt = (k: number, u: number) => { const p = P(k, u); return ground(p[0], p[1]); };
  // darker with depth, as a cut face is where the light doesn't reach in far
  const shade = (y: number, top: number) => 1 - 0.3 * Math.min(1, Math.max(0, (top - y) / (depth + 20)));
  const colourOf = (k: number, bed: number) => (k === K.turf ? EARTH_COLOURS.turf : k === K.top ? EARTH_COLOURS.topsoil : k === K.sub ? EARTH_COLOURS.subsoil : BEDS[Math.min(BEDS.length - 1, bed)][1]);
  // a quad on side k from u0 to u1, heights ya0..ya1 at u0 and yb0..yb1 at u1
  const quad = (k: number, u0: number, u1: number, ya0: number, ya1: number, yb0: number, yb1: number, hex: string, hex2?: string, sa = 0, sb = 0) => {
    if (ya1 - ya0 < 1e-4 && yb1 - yb0 < 1e-4) return;
    const [x0, z0] = P(k, u0), [x1, z1] = P(k, u1);
    const a: number[] = [x0, ya0, z0], b = [x1, yb0, z1], e = [x1, yb1, z1], f = [x0, ya1, z0];
    for (const v of [a, b, e, a, e, f]) pos.push(v[0], v[1], v[2]);
    // lit as if tipped back towards the sky a little: a face turned from the sun would otherwise
    // be nearly black, and the slice should read from every side
    const [nx, nz] = out(k, 0.6);
    for (let i = 0; i < 6; i++) nor.push(nx, 0.8, nz);
    c.set(hex); c2.set(hex2 ?? hex);
    const top = [sa, sb, sb, sa, sb, sa], ys = [ya0, yb0, yb1, ya0, yb1, ya1], lo = [true, true, false, true, false, false];
    for (let i = 0; i < 6; i++) { const m = shade(ys[i], top[i]), cc = hex2 && !lo[i] ? c2 : c; col.push(cc.r * m, cc.g * m, cc.b * m); }
  };

  // One column of the face, from u0 to u1 (both on the side's line), with whatever road runs off there.
  const column = (k: number, u0: number, u1: number, road: EdgeCrossing | null) => {
    const s0 = k * 2 * edge + u0, s1 = s0 + (u1 - u0);
    const [xa, za] = P(k, u0), [xb, zb] = P(k, u1);
    const ga = ground(xa, za), gb = ground(xb, zb);
    const L: Line[] = [];
    const add = (a: number, b: number, kind: number) => L.push({ a, b, k: kind });
    // the soil, hanging from the surface
    add(ga, gb, K.surf);
    add(ga - 0.35, gb - 0.35, K.turf);
    add(ga - (1.4 + wander(s0, 0)), gb - (1.4 + wander(s1, 0)), K.top);
    add(ga - (4.5 + wander(s0, 1)), gb - (4.5 + wander(s1, 1)), K.sub);
    // the rock beds' tops (below the soil wherever the ground's low, cut off by it on the hills)
    let d = 0;
    for (let i = 0; i < BEDS.length; i++) {
      add(0.9 * ga + fold(xa, za, depth) - d, 0.9 * gb + fold(xb, zb, depth) - d, K.rock + i);
      d += BEDS[i][0] === Infinity ? 0 : BEDS[i][0] * (depth / 90);
      if (!isFinite(d)) break;
    }
    add(base, base, K.base);
    // water standing over a bed below its level
    const la = levelAt(xa, za), lb = levelAt(xb, zb);
    const wet = la !== null && lb !== null && (ga < la - 0.02 || gb < lb - 0.02);
    if (wet) add(la!, lb!, K.water);
    // a road or railway: its surface and stone, laid on the ground (on the level the network has it)
    const R = road ? (road.rail ? { top: 0.35, bot: -0.5 } : { top: Math.abs((u0 + u1) / 2 - road.u) <= road.kerb ? 0.25 : 0.15, bot: Math.abs((u0 + u1) / 2 - road.u) <= road.kerb ? -0.75 : -0.35 }) : null;
    if (road && R) { add(ga + road.y + R.top, gb + road.y + R.top, K.road); add(ga + road.y + R.bot, gb + road.y + R.bot, K.road + 1); if (!road.rail && Math.abs((u0 + u1) / 2 - road.u) <= road.kerb) add(ga + road.y + 0.02, gb + road.y + 0.02, K.road + 2); }
    // split the column wherever two lines cross, so in each piece they keep their order
    const cuts = [0, 1];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const p = L[i], q = L[j], da = p.a - q.a, db = p.b - q.b;
      if (da * db < 0) cuts.push(da / (da - db));
    }
    cuts.sort((x, y) => x - y);
    const top = (t: number) => Math.max(ga + (gb - ga) * t + (road && R ? road.y + R.top : 0), wet ? Math.max(la!, lb!) : -Infinity);
    for (let ci = 0; ci + 1 < cuts.length; ci++) {
      const t0 = cuts[ci], t1 = cuts[ci + 1];
      if (t1 - t0 < 1e-6) continue;
      const tm = (t0 + t1) / 2, at = (l: Line, t: number) => l.a + (l.b - l.a) * t;
      const sorted = [...L].sort((p, q) => at(q, tm) - at(p, tm)); // top down
      const surf = L[0], sm = at(surf, tm);
      const rockTop = (y: number) => { let bed = -1; for (const l of L) if (l.k >= K.rock && at(l, tm) >= y) bed = Math.max(bed, l.k - K.rock); return bed; };
      const soilLines = L.filter((l) => l.k >= K.turf && l.k <= K.sub);
      const roadTop = L.find((l) => l.k === K.road), roadBot = L.find((l) => l.k === K.road + 1), asph = L.find((l) => l.k === K.road + 2);
      // what's at height y in the middle of this piece (null: open air)
      const what = (y: number): [string, string?] | null => {
        if (roadTop && roadBot && y <= at(roadTop, tm) && y >= at(roadBot, tm)) {
          if (road!.rail) return [ROAD.ballast];
          if (asph) return y >= at(asph, tm) ? [ROAD.asphalt] : [ROAD.subbase];
          return [ROAD.footway];
        }
        if (y > sm) {
          if (roadTop && y <= at(roadTop, tm)) return [ROAD.fill]; // (a road above the ground: its embankment)
          const w = L.find((l) => l.k === K.water);
          return w && y <= at(w, tm) ? [WATER[0], WATER[1]] : null;
        }
        if (y < base) return null;
        // the soil bands, unless the rock comes up through them
        let band = K.turf;
        for (const l of soilLines) if (at(l, tm) >= y) band = Math.max(band, l.k + 1);
        if (band <= K.sub) return [colourOf(band, 0)];
        const bed = rockTop(y);
        return bed < 0 ? [colourOf(K.sub, 0)] : [colourOf(K.rock, bed)];
      };
      // each gap between neighbouring lines is one layer; neighbours alike are drawn as one
      let run: { hi: Line; lo: Line; m: [string, string?] } | null = null;
      const flush = () => {
        if (!run) return;
        const ua = u0 + (u1 - u0) * t0, ub = u0 + (u1 - u0) * t1;
        if (run.m[1]) {
          // (water: lighter at its surface, darker down at the bed)
          quad(k, ua, ub, at(run.lo, t0), at(run.hi, t0), at(run.lo, t1), at(run.hi, t1), run.m[1], run.m[0], top(t0), top(t1));
        } else quad(k, ua, ub, at(run.lo, t0), at(run.hi, t0), at(run.lo, t1), at(run.hi, t1), run.m[0], undefined, top(t0), top(t1));
        run = null;
      };
      for (let i = 0; i + 1 < sorted.length; i++) {
        const hi = sorted[i], lo = sorted[i + 1], ym = (at(hi, tm) + at(lo, tm)) / 2;
        if (at(hi, tm) - at(lo, tm) < 1e-5) continue;
        const m = what(ym);
        if (!m) { flush(); continue; }
        if (run && run.m[0] === m[0] && run.m[1] === m[1]) run.lo = lo;
        else { flush(); run = { hi, lo, m }; }
      }
      flush();
    }
  };

  // (sides are walked so each quad faces outwards; u runs the same way round for every side. The
  // columns fall on the ground's grid lines; finer where the ground between them isn't straight,
  // so a river's banks keep their shape, and at the edges of anything running off the map.)
  const grid = opts.step ?? 4;
  for (let k = 0; k < 4; k++) {
    const mine = crossings.filter((x) => x.side === k);
    const marks = new Set<number>();
    for (const x of mine) for (const h of x.rail ? [x.half] : [x.half, x.kerb]) { marks.add(x.u - h); marks.add(x.u + h); }
    const step = Math.max(grid, (2 * edge) / MAX_COLS);
    const us: number[] = [];
    for (let u = -edge; u < edge - 1e-6; u += step) {
      const u1 = Math.min(edge, u + step), g0 = gAt(k, u), g1 = gAt(k, u1);
      // (straight between the grid's lines? then one column does)
      const bent = [0.25, 0.5, 0.75].some((t) => Math.abs(gAt(k, u + (u1 - u) * t) - (g0 + (g1 - g0) * t)) > 0.02);
      const n = bent ? Math.ceil((u1 - u) / 0.5) : 1;
      for (let i = 0; i < n; i++) us.push(u + ((u1 - u) * i) / n);
    }
    us.push(edge);
    for (const m of marks) if (m > -edge && m < edge) us.push(m);
    us.sort((a, b) => a - b);
    for (let i = 0; i + 1 < us.length; i++) {
      const u0 = us[i], u1 = us[i + 1];
      if (u1 - u0 < 1e-3) continue;
      const um = (u0 + u1) / 2, road = mine.find((x) => Math.abs(um - x.u) < x.half) ?? null;
      column(k, u0, u1, road);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.name = 'map edge';
  m.userData.noDrape = true; // (its heights are the ground's already)
  return m;
}

// The country beyond the edge, far below and far off: a soft, hazy lowland of fields and woods
// with low hills further out, fading into the sky, so the sky doesn't just start at the rim and
// the map reads as a slab of land standing over the wider world. It's a backdrop: drawn first,
// under everything, never clipped by the camera's far plane, and it never hides the map or its
// cut face. One draw call, no shadows; its haze follows the sky (dusk too): `update(sky)`.
export function farCountry(edge: number, level: number, colours: string[], seed = 1) {
  const R = Math.max(40000, edge * 6); // how far it runs (the camera's widest look out, and more)
  // the grid's lines: fine by the edge, coarser further off (and the map's own square left out)
  const ring: number[] = [];
  for (let d = 0, s = Math.max(120, edge / 40); d < R - edge; d += s, s *= 1.13) ring.push(edge + d);
  ring.push(R);
  const inner: number[] = [];
  const n = Math.max(8, Math.round((2 * edge) / Math.max(150, edge / 30)));
  for (let i = 1; i < n; i++) inner.push(-edge + (2 * edge * i) / n);
  const xs = [...ring.map((v) => -v).reverse(), ...inner, ...ring];
  const N = xs.length;
  const pos: number[] = [], col: number[] = [], hz: number[] = [], idx: number[] = [];
  const cols = colours.map((h) => new THREE.Color(h));
  const hash = (i: number, j: number) => { let h = (i * 374761393 + j * 668265263 + seed * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // smooth noise for the hills, lifting them only well out (they never rise into the map's view of its own edge)
  const hill = (x: number, z: number) => Math.sin(x * 0.00031 + seed) * Math.cos(z * 0.00027 - seed * 0.7) + 0.5 * Math.sin((x - z) * 0.00071 + 1.3 * seed) + 0.25 * Math.sin(x * 0.0017 + z * 0.0013);
  const c = new THREE.Color();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = xs[i], z = xs[j], d = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - edge);
    // (gentle: no slope steeper than the camera ever looks down, so it never hides itself)
    const lift = Math.min(1, d / 9000) ** 1.5, y = level - 40 * (1 - Math.exp(-d / 700)) + lift * (160 + 140 * hill(x, z)); // (meeting the foot of the cut, then falling away)
    pos.push(x, y, z);
    // a patchwork of fields and woods, blurred by distance
    const a = cols[Math.floor(hash(i, j) * cols.length)], b = cols[Math.floor(hash(j + 91, i - 7) * cols.length)];
    c.copy(a).lerp(b, 0.5);
    const lightness = 0.9 + 0.1 * hill(z, x);
    col.push(c.r * lightness, c.g * lightness, c.b * lightness);
    // how much of it the haze takes: some even at the foot of the cut, all of it far out
    hz.push(Math.min(1, 0.2 + 0.8 * (1 - Math.exp(-d / 7000)) + (d > R - edge - 8000 ? (d - (R - edge - 8000)) / 8000 : 0)));
  }
  const inside = (i: number, j: number) => { const x = (xs[i] + xs[i + 1]) / 2, z = (xs[j] + xs[j + 1]) / 2; return Math.abs(x) < edge && Math.abs(z) < edge; };
  for (let j = 0; j + 1 < N; j++) for (let i = 0; i + 1 < N; i++) {
    if (inside(i, j)) continue;
    const a = j * N + i, b = a + 1, cc = a + N, dd = cc + 1;
    idx.push(a, cc, b, b, cc, dd);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('haze', new THREE.Float32BufferAttribute(hz, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const haze = { value: new THREE.Color('#a9cbe3') };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false, depthTest: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHaze = haze;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float haze;\nvarying float vHaze;')
      // (at the far plane at most, so the camera's depth range never cuts it off)
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHaze = haze;\ngl_Position.z = min(gl_Position.z, gl_Position.w * 0.9999);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nvarying float vHaze;')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, vHaze);\n#include <tonemapping_fragment>');
  };
  mat.customProgramCacheKey = () => 'far-country';
  const m = new THREE.Mesh(g, mat);
  m.name = 'far country';
  m.renderOrder = -100; // (first: everything else draws over it)
  m.frustumCulled = false;
  m.userData.noDrape = true;
  const update = (sky: THREE.Color) => { if (!haze.value.equals(sky)) haze.value.copy(sky); };
  return { mesh: m, update };
}

// Is this wholly past the ground's edge (the railway's stretch off the map, to its station there)?
// Nothing there is drawn: it's the world beyond, where trains go on to.
export const beyondEdge = (edge: number, pts: { x: number; z: number }[]) => pts.length > 0 && pts.every((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) >= edge - 0.5);
