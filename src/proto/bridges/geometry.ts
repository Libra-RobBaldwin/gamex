// Bridge geometry: a laid-out bridge (layout.ts) turned into three.js BufferGeometry along any
// curved, sloping deck, one geometry per material. The aim is that each type reads at a glance
// from the game's high isometric camera, so the parts that tell them apart are exaggerated a
// little and pushed out past the deck edge where they can be seen from above: masonry piers with
// cutwaters and pilasters, trestle bents splaying out, trusses and arch ribs over the deck,
// pylons and towers beside it, fans of white cables and a thick main cable. Low-poly throughout.
import * as THREE from 'three';
import { pointAt } from '../roads';
import { depthOf, type BridgeDef } from './catalogue';
import { deckAt, groundAt, type Crossing } from './crossing';
import { underside, type BridgeLayout, type Span, type Support } from './layout';
import { bridgeMaterials, type Mat } from './materials';

type V = [number, number, number];

// Triangles grouped by material.
export class Geo {
  g = new Map<Mat, number[]>();
  private arr(m: Mat) { let a = this.g.get(m); if (!a) this.g.set(m, (a = [])); return a; }
  tri(m: Mat, a: V, b: V, c: V) { this.arr(m).push(...a, ...b, ...c); }
  quad(m: Mat, a: V, b: V, c: V, d: V) { const x = this.arr(m); x.push(...a, ...b, ...c, ...a, ...c, ...d); }
  // a square-section member between two points (truss bars, cables, hangers, braces)
  bar(m: Mat, a: V, b: V, w: number, h = w) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
    const u = [d[0] / L, d[1] / L, d[2] / L];
    let sx = -u[2], sz = u[0], sl = Math.hypot(sx, sz);
    if (sl < 1e-3) { sx = 1; sz = 0; sl = 1; } // vertical: any horizontal side will do
    const s = [sx / sl, 0, sz / sl];
    const up = [u[1] * s[2] - u[2] * s[1], u[2] * s[0] - u[0] * s[2], u[0] * s[1] - u[1] * s[0]];
    const off = (p: V, i: number, j: number): V => [p[0] + s[0] * i * w / 2 + up[0] * j * h / 2, p[1] + s[1] * i * w / 2 + up[1] * j * h / 2, p[2] + s[2] * i * w / 2 + up[2] * j * h / 2];
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const [i0, j0] = c[k], [i1, j1] = c[(k + 1) % 4];
      this.quad(m, off(a, i0, j0), off(a, i1, j1), off(b, i1, j1), off(b, i0, j0));
    }
  }
  // an upright box aligned with the route: half-sizes along it and across it
  box(m: Mat, x: number, z: number, ux: number, uz: number, along: number, across: number, y0: number, y1: number, top = true) {
    const nx = -uz, nz = ux;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [x + ux * along * i + nx * across * j, z + uz * along * i + nz * across * j]);
    for (let k = 0; k < 4; k++) { const p = c[k], q = c[(k + 1) % 4]; this.quad(m, [p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]); }
    if (top) this.quad(m, [c[0][0], y1, c[0][1]], [c[1][0], y1, c[1][1]], [c[2][0], y1, c[2][1]], [c[3][0], y1, c[3][1]]);
  }
  // an upright prism on any footprint (cutwaters, cabins)
  prism(m: Mat, pts: [number, number][], y0: number, y1: number) {
    for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; this.quad(m, [p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]); }
    for (let k = 1; k < pts.length - 1; k++) this.tri(m, [pts[0][0], y1, pts[0][1]], [pts[k][0], y1, pts[k][1]], [pts[k + 1][0], y1, pts[k + 1][1]]);
  }
  geometries(shift?: V) {
    const out: Partial<Record<Mat, THREE.BufferGeometry>> = {};
    for (const [m, a] of this.g) {
      if (!a.length) continue;
      if (shift) for (let i = 0; i < a.length; i += 3) { a[i] -= shift[0]; a[i + 1] -= shift[1]; a[i + 2] -= shift[2]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a, 3));
      g.computeVertexNormals();
      out[m] = g;
    }
    return out;
  }
}

// ---------- following the route ----------

interface Frame { x: number; y: number; z: number; ux: number; uz: number; nx: number; nz: number }
const frameAt = (c: Crossing, s: number): Frame => { const p = pointAt(c.path, s); return { x: p.x, y: p.y, z: p.z, ux: p.ux, uz: p.uz, nx: -p.uz, nz: p.ux }; };
// a point `n` to the left of the centreline (negative is right), at height y, `a` further along
const at = (f: Frame, n: number, y: number, a = 0): V => [f.x + f.nx * n + f.ux * a, y, f.z + f.nz * n + f.uz * a];
function samples(s0: number, s1: number, step: number) {
  const n = Math.max(1, Math.ceil((s1 - s0) / step)), out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(s0 + ((s1 - s0) * i) / n);
  return out;
}
// Sweep a closed cross-section (sideways offset, absolute height) along the route; one material
// per edge of the section, or one for all.
function sweep(g: Geo, c: Crossing, s0: number, s1: number, sec: (s: number) => [number, number][], mats: Mat | Mat[], step = 3, caps = true) {
  if (s1 - s0 < 0.05) return;
  const ss = samples(s0, s1, step);
  const rings = ss.map((s) => { const f = frameAt(c, s); return sec(s).map(([n, y]) => at(f, n, y)); });
  const k = rings[0].length;
  for (let i = 1; i < rings.length; i++) {
    const A = rings[i - 1], B = rings[i];
    for (let e = 0; e < k; e++) {
      const m = typeof mats === 'string' ? mats : mats[e % mats.length];
      g.quad(m, A[e], A[(e + 1) % k], B[(e + 1) % k], B[e]);
    }
  }
  if (!caps) return;
  const m = typeof mats === 'string' ? mats : mats[0];
  for (const R of [rings[0], rings[rings.length - 1]]) for (let e = 1; e < k - 1; e++) g.tri(m, R[0], R[e], R[e + 1]);
}
const rect = (n0: number, n1: number, y0: number, y1: number): [number, number][] => [[n0, y1], [n1, y1], [n1, y0], [n0, y0]];

// ---------- how each type looks ----------

interface Look { edge: Mat; slab: number; parapet: 'stone' | 'concrete' | 'steel' | 'timber' | 'none'; rail: Mat; pier: Mat }
function lookOf(d: BridgeDef, year: number): Look {
  const oldPier: Mat = year < 1920 ? 'stone' : 'concrete';
  switch (d.id) {
    case 'trestle': return { edge: 'timber', slab: 0.4, parapet: 'timber', rail: 'timberDark', pier: 'timber' };
    case 'masonry': return { edge: 'stone', slab: 0.5, parapet: 'stone', rail: 'stoneDark', pier: 'stone' };
    case 'girder': return { edge: 'steelGreen', slab: 0.6, parapet: 'none', rail: 'steelGreen', pier: oldPier };
    case 'truss-through': return { edge: 'steelRed', slab: 0.7, parapet: 'steel', rail: 'steelRed', pier: oldPier };
    case 'truss-deck': return { edge: 'steelRed', slab: 0.7, parapet: 'steel', rail: 'steelRed', pier: oldPier };
    case 'arch-tied': return { edge: 'steelWhite', slab: 0.8, parapet: 'steel', rail: 'steelGrey', pier: 'concrete' };
    case 'suspension': return { edge: 'steelGrey', slab: 1.0, parapet: 'steel', rail: 'steelGrey', pier: 'concrete' };
    case 'bascule': return { edge: 'steelBlue', slab: 0.8, parapet: 'steel', rail: 'steelBlue', pier: 'stone' };
    default: return { edge: 'concrete', slab: 0.9, parapet: 'concrete', rail: 'steelGrey', pier: 'concrete' };
  }
}

export interface Leaf { parts: Partial<Record<Mat, THREE.BufferGeometry>>; pivot: V; axis: V; sign: 1 | -1; max: number }
export interface BridgeGeometry { parts: Partial<Record<Mat, THREE.BufferGeometry>>; leaves: Leaf[] }
export interface GeometryOpts { surface?: boolean } // draw the road or track surface (the game draws its own)

export function buildBridge(c: Crossing, lay: BridgeLayout, opts: GeometryOpts = {}): BridgeGeometry {
  const g = new Geo();
  const hw = lay.width / 2, rail = c.road.cls === 'rail';
  const surface = opts.surface !== false;
  const leaves: Leaf[] = [];
  const main = lay.spans.find((sp) => sp.role === 'main');

  // the deck: surface, slab with visible edges, parapets; the moving leaves are drawn separately
  const deckRuns: [number, number, Span][] = [];
  for (const sp of lay.spans) {
    if (sp.def.id === 'bascule' && sp.role === 'main') {
      const pier = lay.supports.filter((q) => q.kind === 'leaf-pier');
      const a0 = pier.find((q) => Math.abs(q.s - sp.s0) < 0.5)?.along ?? 0, b0 = pier.find((q) => Math.abs(q.s - sp.s1) < 0.5)?.along ?? 0;
      if (a0) deckRuns.push([sp.s0, sp.s0 + a0, sp]);
      if (b0) deckRuns.push([sp.s1 - b0, sp.s1, sp]);
      const mid = (sp.s0 + sp.s1) / 2;
      leaves.push(leaf(c, sp, sp.s0 + a0, mid - 0.1, hw, surface, rail));
      leaves.push(leaf(c, sp, sp.s1 - b0, mid + 0.1, hw, surface, rail));
    } else deckRuns.push([sp.s0, sp.s1, sp]);
  }
  for (const [s0, s1, sp] of deckRuns) deck(g, c, s0, s1, sp.def, hw, surface, rail);
  for (const sp of lay.spans) spanStructure(g, c, lay, sp, hw);
  for (const q of lay.supports) support(g, c, lay, q, hw, main);
  return { parts: g.geometries(), leaves };
}

function deck(g: Geo, c: Crossing, s0: number, s1: number, d: BridgeDef, hw: number, surface: boolean, rail: boolean) {
  const L = lookOf(d, c.year), y = (s: number) => deckAt(c, s);
  // slab: the top is the road (or ballast), the rest shows the type's colour
  sweep(g, c, s0, s1, (s) => rect(-hw, hw, y(s) - L.slab, y(s)), [surface ? (rail ? 'ballast' : 'surface') : 'deck', L.edge, L.edge, L.edge]);
  if (surface) markings(g, c, s0, s1, hw, rail);
  parapets(g, c, s0, s1, L, hw);
}

function markings(g: Geo, c: Crossing, s0: number, s1: number, hw: number, rail: boolean) {
  const y = (s: number) => deckAt(c, s) + 0.03;
  if (rail) {
    const tracks = c.road.tracks === 2 ? [-2, 2] : [0];
    for (const t of tracks) for (const r of [-0.72, 0.72]) sweep(g, c, s0, s1, (s) => rect(t + r - 0.06, t + r + 0.06, y(s), y(s) + 0.15), 'rail', 3, false);
    return;
  }
  // edge lines and a dashed centre line, so the deck reads as a road from above
  const e = hw - (c.road.pave > 0 ? c.road.pave + 0.3 : 1);
  for (const k of [-1, 1]) sweep(g, c, s0, s1, (s) => rect(k * e - 0.08, k * e + 0.08, y(s), y(s) + 0.01), 'line', 3, false);
  if (c.road.median > 0) return;
  for (let s = s0 + 2; s + 3 < s1; s += 9) sweep(g, c, s, s + 3, (t) => rect(-0.08, 0.08, y(t), y(t) + 0.01), 'line', 3, false);
}

function parapets(g: Geo, c: Crossing, s0: number, s1: number, L: Look, hw: number) {
  const y = (s: number) => deckAt(c, s);
  for (const k of [-1, 1]) {
    const o = k * hw;
    if (L.parapet === 'stone') {
      sweep(g, c, s0, s1, (s) => rect(o - k * 0.5, o, y(s) - 0.1, y(s) + 1.0), 'stone');
      sweep(g, c, s0, s1, (s) => rect(o - k * 0.55, o + k * 0.05, y(s) + 1.0, y(s) + 1.15), 'stoneDark', 3, false); // coping
    } else if (L.parapet === 'concrete') {
      sweep(g, c, s0, s1, (s) => rect(o - k * 0.4, o + k * 0.05, y(s) - 0.1, y(s) + 0.95), 'concrete');
    } else if (L.parapet === 'steel' || L.parapet === 'timber') {
      const m = L.rail, w = L.parapet === 'timber' ? 0.18 : 0.1;
      sweep(g, c, s0, s1, (s) => rect(o - k * 0.25, o, y(s) + 1.0, y(s) + 1.0 + w), m, 3, false);
      for (const s of samples(s0, s1, 3)) { const f = frameAt(c, s); const p = at(f, o - k * 0.12, 0); g.box(m, p[0], p[2], f.ux, f.uz, w / 2, w / 2, y(s), y(s) + 1.05, false); }
    }
  }
}

// ---------- span structures ----------

function spanStructure(g: Geo, c: Crossing, lay: BridgeLayout, sp: Span, hw: number) {
  const d = sp.def, y = (s: number) => deckAt(c, s), L = lookOf(d, c.year);
  const len = sp.len, dep = depthOf(d, len);
  switch (d.id) {
    case 'trestle':
      for (const n of [-hw * 0.6, 0, hw * 0.6]) sweep(g, c, sp.s0, sp.s1, (s) => rect(n - 0.3, n + 0.3, y(s) - dep, y(s) - L.slab), 'timberDark');
      return;
    case 'masonry': return archSpan(g, c, sp, hw);
    case 'girder':
      for (const k of [-1, 1]) {
        const n = k * (hw + 0.25);
        sweep(g, c, sp.s0, sp.s1, (s) => rect(n - 0.3, n + 0.3, y(s) - dep, y(s) + 1.2), 'steelGreen');
        // stiffeners on the outside face catch the light and show the girder is steel
        for (const s of samples(sp.s0 + 1, sp.s1 - 1, 2.5)) { const f = frameAt(c, s), p = at(f, n + k * 0.35, 0); g.box('steelGreen', p[0], p[2], f.ux, f.uz, 0.12, 0.08, y(s) - dep, y(s) + 1.2, false); }
      }
      return;
    case 'truss-through': return truss(g, c, sp, hw, true);
    case 'truss-deck': return truss(g, c, sp, hw, false);
    case 'beam': {
      const beams = Math.max(3, Math.round((hw * 2) / 2.6));
      for (let i = 0; i < beams; i++) { const n = -hw + 1 + ((hw * 2 - 2) * i) / (beams - 1); sweep(g, c, sp.s0, sp.s1, (s) => rect(n - 0.35, n + 0.35, y(s) - dep, y(s) - L.slab), 'deck'); }
      return;
    }
    case 'box': {
      const dm = Math.max(d.depth.min, len / 40);
      sweep(g, c, sp.s0, sp.s1, (s) => { const u = (s - sp.s0) / len, x = 2 * u - 1, dd = dm + (dep - dm) * x * x; return [[-hw * 0.55, y(s) - L.slab], [hw * 0.55, y(s) - L.slab], [hw * 0.42, y(s) - dd], [-hw * 0.42, y(s) - dd]]; }, 'concrete', 4);
      return;
    }
    case 'arch-concrete':
      if (sp.role === 'main') return concreteArch(g, c, sp, hw);
      return;
    case 'arch-tied':
      if (sp.role === 'main') return tiedArch(g, c, sp, hw);
      return;
    case 'cable-stayed':
      sweep(g, c, sp.s0, sp.s1, (s) => [[-hw, y(s) - L.slab], [hw, y(s) - L.slab], [hw * 0.8, y(s) - dep], [-hw * 0.8, y(s) - dep]], 'concrete', 4);
      return; // the cables belong to the pylons
    case 'suspension':
      sweep(g, c, sp.s0, sp.s1, (s) => [[-hw, y(s) - L.slab], [hw, y(s) - L.slab], [hw * 0.85, y(s) - dep], [-hw * 0.85, y(s) - dep]], 'steelGrey', 4);
      if (sp.role !== 'approach') suspended(g, c, lay, sp, hw);
      return;
    case 'bascule':
      return;
  }
}

// Stone arches: spandrel walls down to the arch, the arch's underside, and a band of darker
// voussoirs round each face so the arch shape reads even from high up.
function archSpan(g: Geo, c: Crossing, sp: Span, hw: number) {
  const ss = samples(sp.s0, sp.s1, Math.max(0.8, sp.len / 20));
  const ring = 0.45 + sp.len / 40;
  for (let i = 1; i < ss.length; i++) {
    const a = ss[i - 1], b = ss[i], fa = frameAt(c, a), fb = frameAt(c, b);
    const ua = underside(c, sp, a), ub = underside(c, sp, b), ya = deckAt(c, a) - 0.5, yb = deckAt(c, b) - 0.5;
    for (const k of [-1, 1]) {
      const n = k * hw;
      g.quad('stone', at(fa, n, ua + ring), at(fb, n, ub + ring), at(fb, n, yb), at(fa, n, ya));
      g.quad('stoneDark', at(fa, n + k * 0.12, ua), at(fb, n + k * 0.12, ub), at(fb, n + k * 0.12, ub + ring), at(fa, n + k * 0.12, ua + ring));
    }
    g.quad('stoneDark', at(fa, -hw - 0.12, ua), at(fb, -hw - 0.12, ub), at(fb, hw + 0.12, ub), at(fa, hw + 0.12, ua));
  }
}

// Steel trusses, Pratt pattern: chords, verticals and diagonals, with lateral bracing across the
// top (through trusses) or the bottom (deck trusses) that makes the shape obvious from above.
function truss(g: Geo, c: Crossing, sp: Span, hw: number, through: boolean) {
  const d = sp.def, y = (s: number) => deckAt(c, s);
  const H = through ? d.above!(sp.len) : depthOf(d, sp.len);
  const panels = Math.max(4, Math.round(sp.len / Math.max(5, H * 0.9)));
  const n0 = through ? hw + 0.4 : hw - 0.6, m: Mat = 'steelRed';
  const lo = (s: number) => (through ? y(s) - 0.9 : y(s) - H), hi = (s: number) => (through ? y(s) + H : y(s) - 0.7);
  const P = (i: number) => sp.s0 + (sp.len * i) / panels;
  for (const k of [-1, 1]) {
    const n = k * n0;
    sweep(g, c, sp.s0, sp.s1, (s) => rect(n - 0.35, n + 0.35, lo(s), lo(s) + 0.8), m);
    // through trusses slope down to the bottom chord at the ends (the end posts)
    const t0 = through ? P(1) : sp.s0, t1 = through ? P(panels - 1) : sp.s1;
    sweep(g, c, t0, t1, (s) => rect(n - 0.4, n + 0.4, hi(s) - 0.8, hi(s)), m);
    for (let i = 0; i <= panels; i++) {
      const s = P(i), f = frameAt(c, s);
      if (through && (i === 0 || i === panels)) {
        const inner = frameAt(c, P(i === 0 ? 1 : panels - 1));
        g.bar(m, at(f, n, lo(s) + 0.4), at(inner, n, hi(P(i === 0 ? 1 : panels - 1)) - 0.4), 0.7);
        continue;
      }
      g.bar(m, at(f, n, lo(s) + 0.4), at(f, n, hi(s) - 0.4), 0.45);
      // diagonals lean towards the middle of the span
      const j = i < panels / 2 ? i + 1 : i - 1;
      if (j > 0 && j < panels || !through) { const s2 = P(j), f2 = frameAt(c, s2); g.bar(m, at(f, n, hi(s) - 0.4), at(f2, n, lo(s2) + 0.4), 0.35); }
    }
  }
  // lateral bracing: an X in every panel, and cross struts
  const yb = (s: number) => (through ? hi(s) - 0.4 : lo(s) + 0.4);
  const i0 = through ? 1 : 0, i1 = through ? panels - 1 : panels;
  for (let i = i0; i <= i1; i++) {
    const s = P(i), f = frameAt(c, s);
    g.bar(m, at(f, -n0, yb(s)), at(f, n0, yb(s)), 0.45);
    if (i < i1) { const s2 = P(i + 1), f2 = frameAt(c, s2); g.bar(m, at(f, -n0, yb(s)), at(f2, n0, yb(s2)), 0.25); g.bar(m, at(f, n0, yb(s)), at(f2, -n0, yb(s2)), 0.25); }
  }
  // portal frames over the ends of a through truss
  if (through) for (const i of [1, panels - 1]) { const s = P(i), f = frameAt(c, s); g.bar(m, at(f, -n0, hi(s) - 1.6), at(f, n0, hi(s) - 1.6), 0.6, 1.2); }
}

// A concrete deck arch: twin ribs springing from the valley sides, columns up to the deck.
function concreteArch(g: Geo, c: Crossing, sp: Span, hw: number) {
  const rib = Math.max(1.4, sp.len / 70), y = (s: number) => deckAt(c, s);
  for (const k of [-1, 1]) {
    const n = k * hw * 0.55;
    sweep(g, c, sp.s0, sp.s1, (s) => rect(n - 1, n + 1, underside(c, sp, s), underside(c, sp, s) + rib), 'concrete', Math.max(1.5, sp.len / 40));
  }
  const cols = Math.max(6, Math.round(sp.len / 12));
  for (let i = 1; i < cols; i++) {
    const s = sp.s0 + (sp.len * i) / cols, f = frameAt(c, s), top = y(s) - 0.9, bot = underside(c, sp, s) + rib;
    if (top - bot < 0.4) continue;
    for (const k of [-1, 1]) { const p = at(f, k * hw * 0.55, 0); g.box('concrete', p[0], p[2], f.ux, f.uz, 0.5, 0.6, bot, top); }
    const p = at(f, 0, 0);
    g.box('concrete', p[0], p[2], f.ux, f.uz, 0.4, hw * 0.75, top - 0.6, top);
  }
  // longitudinal beams under the slab between columns
  for (const k of [-1, 1]) sweep(g, c, sp.s0, sp.s1, (s) => rect(k * hw * 0.55 - 0.5, k * hw * 0.55 + 0.5, y(s) - 1.6, y(s) - 0.8), 'concrete');
}

// A bowstring (tied) arch: ribs over each edge of the deck, hangers down to it, wind bracing
// between the ribs where there's headroom.
function tiedArch(g: Geo, c: Crossing, sp: Span, hw: number) {
  const H = sp.def.above!(sp.len), y = (s: number) => deckAt(c, s), n0 = hw + 0.5, m: Mat = 'steelWhite';
  const rise = (s: number) => { const x = (2 * (s - sp.s0)) / sp.len - 1; return y(s) + 0.6 + H * (1 - x * x); };
  for (const k of [-1, 1]) {
    const n = k * n0;
    sweep(g, c, sp.s0, sp.s1, (s) => rect(n - 0.7, n + 0.7, rise(s) - 1.4, rise(s)), m, Math.max(2, sp.len / 36));
    sweep(g, c, sp.s0, sp.s1, (s) => rect(n - 0.5, n + 0.5, y(s) - 1.4, y(s) + 0.6), m); // the tie
  }
  const hangers = Math.max(8, Math.round(sp.len / 7));
  for (let i = 1; i < hangers; i++) {
    const s = sp.s0 + (sp.len * i) / hangers, f = frameAt(c, s);
    for (const k of [-1, 1]) g.bar('cable', at(f, k * n0, y(s) + 0.5), at(f, k * n0, rise(s) - 1.2), 0.18);
    if (rise(s) - y(s) > 8) {
      g.bar(m, at(f, -n0, rise(s) - 0.7), at(f, n0, rise(s) - 0.7), 0.5);
      if (i + 1 < hangers) { const s2 = sp.s0 + (sp.len * (i + 1)) / hangers, f2 = frameAt(c, s2); if (rise(s2) - y(s2) > 8) g.bar(m, at(f, -n0, rise(s) - 0.7), at(f2, n0, rise(s2) - 0.7), 0.3); }
    }
  }
}

// Suspension: main cables over the tower tops, sagging to just above the deck mid-span, and
// hangers down to the deck edges. Side spans hang from the cable's run down to the anchorage.
function cableY(c: Crossing, lay: BridgeLayout, s: number) {
  const main = lay.spans.find((q) => q.role === 'main')!, H = main.def.above!(main.len);
  const top0 = deckAt(c, main.s0) + H, top1 = deckAt(c, main.s1) + H;
  if (s >= main.s0 && s <= main.s1) {
    const u = (s - main.s0) / main.len, x = 2 * u - 1, low = deckAt(c, (main.s0 + main.s1) / 2) + 2.5;
    return low + (top0 + (top1 - top0) * u - low) * x * x;
  }
  const side = lay.spans.find((q) => q.role === 'side' && s >= q.s0 - 1e-6 && s <= q.s1 + 1e-6);
  if (!side) return deckAt(c, s) + 2;
  const atTower = side.s1 <= main.s0 + 1e-6 ? side.s1 : side.s0, top = atTower === main.s0 ? top0 : top1;
  const anchor = atTower === side.s1 ? side.s0 : side.s1, yA = deckAt(c, anchor) + 1.5;
  const u = (s - anchor) / (atTower - anchor);
  return yA + (top - yA) * u - side.len * 0.04 * Math.sin(Math.PI * u);
}
function suspended(g: Geo, c: Crossing, lay: BridgeLayout, sp: Span, hw: number) {
  const n0 = hw + 1.4, y = (s: number) => deckAt(c, s);
  for (const k of [-1, 1]) sweep(g, c, sp.s0, sp.s1, (s) => rect(k * n0 - 0.6, k * n0 + 0.6, cableY(c, lay, s) - 1.1, cableY(c, lay, s)), 'cable', Math.max(3, sp.len / 60), false);
  const n = Math.max(4, Math.round(sp.len / 14));
  for (let i = 1; i < n; i++) {
    const s = sp.s0 + (sp.len * i) / n, f = frameAt(c, s), top = cableY(c, lay, s) - 0.6;
    if (top - y(s) < 0.6) continue;
    for (const k of [-1, 1]) g.bar('cable', at(f, k * n0, y(s)), at(f, k * n0, top), 0.25);
  }
}

// ---------- supports ----------

function support(g: Geo, c: Crossing, lay: BridgeLayout, q: Support, hw: number, main?: Span) {
  const d = q.def, L = lookOf(d, c.year), f = frameAt(c, q.s), y = deckAt(c, q.s);
  const base = q.base, top = q.top;
  const water = q.inWater && q.level !== undefined;
  // footings: a pale plinth, or in water a pile cap standing proud of the surface
  const foot = (along: number, across: number) => {
    const y1 = water ? q.level! + 0.6 : base + 0.4;
    g.box('footing', f.x, f.z, f.ux, f.uz, along + 0.7, across + 0.7, base - 0.5, y1);
  };
  switch (q.kind) {
    case 'abutment': return abutment(g, c, lay, q, hw);
    case 'anchorage': {
      const out = q.s < (main?.s0 ?? 0) ? -1 : 1, p = at(f, 0, 0, out * 6);
      g.box('concrete', p[0], p[2], f.ux, f.uz, 9, hw + 4, Math.min(base, groundAt(c, q.s)) - 1, y + 3);
      g.box('footing', p[0], p[2], f.ux, f.uz, 9.5, hw + 4.5, y + 3, y + 3.6);
      return;
    }
    case 'tower': {
      foot(q.along, q.across);
      const H = main ? d.above!(main.len) : 30, n0 = hw + 1.4;
      for (const k of [-1, 1]) g.bar('steelGrey', at(f, k * n0, base), at(f, k * n0, y + H), 3.2, 3.2);
      for (const h of [top - 1.5, y + H * 0.45, y + H * 0.8, y + H - 1.5]) if (h > base + 1) g.bar('steelGrey', at(f, -n0, h), at(f, n0, h), 2.2, h === top - 1.5 ? 3 : 2.2);
      // saddles where the cables cross the tower tops
      for (const k of [-1, 1]) { const p = at(f, k * n0, 0); g.box('cable', p[0], p[2], f.ux, f.uz, 2.2, 1.8, y + H, y + H + 1.2); }
      return;
    }
    case 'pylon': {
      foot(q.along, q.across);
      const H = main ? d.above!(main.len) : 40;
      const nb = hw + 3, nt = hw + 1.3;
      // H-shaped pylon: legs leaning in slightly, a crossbeam under the deck and one at the top
      for (const k of [-1, 1]) { g.bar('concrete', at(f, k * nb, base), at(f, k * (hw + 1.8), top), 2.8); g.bar('concrete', at(f, k * (hw + 1.8), top), at(f, k * nt, y + H), 2.4); }
      g.bar('concrete', at(f, -(hw + 1.8), top - 1.2), at(f, hw + 1.8, top - 1.2), 2, 2.4);
      g.bar('concrete', at(f, -nt, y + H * 0.93), at(f, nt, y + H * 0.93), 1.8, 2.2);
      stays(g, c, lay, q, hw, H, main!);
      return;
    }
    case 'leaf-pier': {
      foot(q.along, q.across);
      g.box(L.pier, f.x, f.z, f.ux, f.uz, q.along, q.across, base, y - 0.3);
      // bridge keeper's cabins on the corners of the pier, on the side away from the leaf
      const back = main && q.s <= main.s0 + 0.5 ? -1 : 1;
      for (const k of [-1, 1]) {
        const p = at(f, k * (hw + 1.4), 0, back * (q.along - 2));
        g.box('concrete', p[0], p[2], f.ux, f.uz, 1.8, 1.2, y - 0.3, y + 2.6);
        const r = (i: number, j: number, h: number) => at(frameAt(c, q.s), k * (hw + 1.4) + j * 1.4, h, back * (q.along - 2) + i * 2.1);
        g.quad('roof', r(-1, -1, y + 2.6), r(1, -1, y + 2.6), r(1, 0, y + 3.6), r(-1, 0, y + 3.6));
        g.quad('roof', r(-1, 1, y + 2.6), r(1, 1, y + 2.6), r(1, 0, y + 3.6), r(-1, 0, y + 3.6));
      }
      return;
    }
    case 'springing': {
      foot(q.along, q.across);
      g.box('concrete', f.x, f.z, f.ux, f.uz, q.along, hw * 0.9, base, top + 1.5);
      return;
    }
    case 'pier': break;
  }
  if (top - base < 0.3) return;
  if (d.id === 'trestle') return bent(g, c, q, hw);
  if (d.id === 'masonry') return masonryPier(g, c, q, hw);
  foot(q.along, q.across * (d.id === 'box' ? 0.6 : 0.9));
  if (d.id === 'box') { for (const k of [-1, 1]) { const p = at(f, k * hw * 0.3, 0); g.box('concrete', p[0], p[2], f.ux, f.uz, q.along, hw * 0.18, base, top); } return; }
  if (d.id === 'beam' || d.id === 'arch-concrete' || d.id === 'arch-tied' || d.id === 'cable-stayed' || d.id === 'suspension') {
    // twin columns under a crosshead that shows past the deck edge
    for (const k of [-1, 1]) { const p = at(f, k * hw * 0.45, 0); g.box(L.pier, p[0], p[2], f.ux, f.uz, 0.8, 0.8, base, top - 1.1); }
    g.box(L.pier, f.x, f.z, f.ux, f.uz, 1.0, hw + 0.8, top - 1.1, top);
    return;
  }
  // girders and trusses: a solid pier with a cap standing out beyond the deck
  const wide = d.id === 'truss-through' ? hw + 1.3 : hw + 0.6;
  g.box(L.pier, f.x, f.z, f.ux, f.uz, q.along, wide * 0.85, base, top - 0.8);
  g.box(L.pier === 'stone' ? 'stoneDark' : 'concrete', f.x, f.z, f.ux, f.uz, q.along + 0.3, wide + 0.3, top - 0.8, top);
  if (water) cutwaters(g, f, q.along, wide * 0.85, base, q.level! + 1.5, L.pier);
}

function abutment(g: Geo, c: Crossing, lay: BridgeLayout, q: Support, hw: number) {
  const f = frameAt(c, q.s), y = deckAt(c, q.s), out = q.s <= lay.s0 + 0.5 ? -1 : 1;
  const stone = q.def.material === 'stone' || q.def.material === 'timber' || (q.def.material === 'steel' && c.year < 1920);
  const m: Mat = stone ? 'stone' : 'concrete';
  const ground = groundAt(c, q.s), p = at(f, 0, 0, out * 1.2);
  // the bank seat the deck rests on
  g.box(m, p[0], p[2], f.ux, f.uz, 1.6, hw + 0.4, Math.min(ground, q.top) - 0.5, y - 0.2);
  // wing walls splaying back into the embankment
  for (const k of [-1, 1]) {
    const a = at(f, k * (hw + 0.2), 0), b = at(f, k * (hw + 3.2), 0, out * 7);
    const yb = Math.max(ground, y - 5);
    const wall: [V, V, V, V] = [[a[0], ground - 0.5, a[2]], [b[0], ground - 0.5, b[2]], [b[0], yb, b[2]], [a[0], y + 0.8, a[2]]];
    g.quad(m, ...wall);
    const t = 0.6, dx = f.nx * k * t, dz = f.nz * k * t;
    g.quad(m, [a[0], y + 0.8, a[2]], [b[0], yb, b[2]], [b[0] + dx, yb, b[2] + dz], [a[0] + dx, y + 0.8, a[2] + dz]);
    g.quad(m, [a[0] + dx, ground - 0.5, a[2] + dz], [b[0] + dx, ground - 0.5, b[2] + dz], [b[0] + dx, yb, b[2] + dz], [a[0] + dx, y + 0.8, a[2] + dz]);
  }
}

// Pointed ends on a pier in the river, across the route (the way the water flows).
function cutwaters(g: Geo, f: Frame, along: number, across: number, y0: number, y1: number, m: Mat) {
  for (const k of [-1, 1]) {
    const base = [-1, 1].map((i) => at(f, k * across, 0, i * along)), tip = at(f, k * (across + along * 1.4), 0);
    g.prism(m, [[base[0][0], base[0][2]], [tip[0], tip[2]], [base[1][0], base[1][2]]], y0, y1);
  }
}

function masonryPier(g: Geo, c: Crossing, q: Support, hw: number) {
  const f = frameAt(c, q.s), y = deckAt(c, q.s), water = q.inWater && q.level !== undefined;
  const across = hw + 1.1;
  // the pier, with a slight batter (wider at the foot), rising to the arch springings
  const batter = Math.min(1.5, (q.top - q.base) / 30);
  g.box('stone', f.x, f.z, f.ux, f.uz, q.along + batter, across + batter, q.base, q.base + (q.top - q.base) * 0.3);
  g.box('stone', f.x, f.z, f.ux, f.uz, q.along, across, q.base, q.top + 0.3);
  // pilasters carried up past the parapet: from above they punctuate the deck at every pier
  g.box('stoneDark', f.x, f.z, f.ux, f.uz, Math.min(q.along, 1.4) * 0.8, across + 0.1, q.top + 0.3, y + 1.3);
  if (water) cutwaters(g, f, q.along, across, q.base, q.level! + 2, 'stone');
}

// A timber bent: posts splaying out towards the ground, a cap beam, and cross bracing.
function bent(g: Geo, c: Crossing, q: Support, hw: number) {
  const f = frameAt(c, q.s), top = q.top, base = q.base, h = top - base;
  const tops = [-hw * 0.85, -hw * 0.3, hw * 0.3, hw * 0.85];
  const splay = (n: number) => n + Math.sign(n) * (Math.abs(n) > hw * 0.5 ? h / 6 : h / 20);
  for (const n of tops) g.bar('timber', at(f, splay(n), base), at(f, n, top), 0.45);
  const cap = at(f, 0, 0);
  g.box('timberDark', cap[0], cap[2], f.ux, f.uz, 0.35, hw + 1.1, top - 0.45, top);
  // bracing every 5 m of height: an X between the outer posts and a horizontal wale
  const lerp = (n: number, t: number) => n + (splay(n) - n) * (1 - t);
  for (let y0 = base + 0.5; y0 < top - 1.5; y0 += 5) {
    const y1 = Math.min(top - 0.6, y0 + 5), t0 = (y0 - base) / h, t1 = (y1 - base) / h;
    const L0 = lerp(tops[0], t0), R0 = lerp(tops[3], t0), L1 = lerp(tops[0], t1), R1 = lerp(tops[3], t1);
    g.bar('timberDark', at(f, L0, y0), at(f, R1, y1), 0.22);
    g.bar('timberDark', at(f, R0, y0), at(f, L1, y1), 0.22);
    g.bar('timberDark', at(f, L1 - 0.3, y1), at(f, R1 + 0.3, y1), 0.25);
  }
  if (q.inWater && q.level !== undefined) g.box('footing', f.x, f.z, f.ux, f.uz, 0.9, Math.abs(splay(tops[3])) + 0.6, base - 0.3, q.level + 0.4);
}

// Cable stays from one pylon: a semi-fan in two planes, to anchors along the deck edges on both
// sides, as far as mid-span on the main span and to the backstay pier on the side span.
function stays(g: Geo, c: Crossing, lay: BridgeLayout, q: Support, hw: number, H: number, main: Span) {
  const y = deckAt(c, q.s), f = frameAt(c, q.s);
  const toMain = q.s <= main.s0 + 0.5 ? 1 : -1;
  const midReach = main.len / 2 - 6;
  const side = lay.spans.find((sp) => sp.role === 'side' && (toMain > 0 ? Math.abs(sp.s1 - q.s) < 0.5 : Math.abs(sp.s0 - q.s) < 0.5));
  const backReach = side ? side.len - 4 : midReach * 0.5;
  const n = Math.max(6, Math.round(midReach / 14));
  for (const k of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const t = (i + 1) / n, hgt = y + H * (0.62 + 0.34 * t);
      const top = at(f, k * (hw + 1.4), hgt);
      for (const [dir, reach] of [[toMain, midReach], [-toMain, backReach]] as const) {
        const s = q.s + dir * (10 + (reach - 10) * t), fd = frameAt(c, s);
        g.bar('cable', top, at(fd, k * (hw + 0.2), deckAt(c, s) + 0.3), 0.3);
      }
    }
  }
}

// A bascule leaf, built around its pivot so it can be swung up.
function leaf(c: Crossing, sp: Span, from: number, to: number, hw: number, surface: boolean, rail: boolean): Leaf {
  const g = new Geo();
  const a = Math.min(from, to), b = Math.max(from, to);
  deck(g, c, a, b, sp.def, hw, surface, rail);
  const y = (s: number) => deckAt(c, s);
  for (const k of [-1, 1]) sweep(g, c, a, b, (s) => rect(k * hw * 0.6 - 0.35, k * hw * 0.6 + 0.35, y(s) - 1.6, y(s) - 0.8), 'steelBlue');
  const f = frameAt(c, from), pivot: V = [f.x, y(from) - 0.8, f.z];
  // which way round the axis lifts the free end
  const dir = to > from ? 1 : -1;
  const sign: 1 | -1 = dir > 0 ? 1 : -1;
  return { parts: g.geometries(pivot), pivot, axis: [f.nx, 0, f.nz], sign, max: (78 * Math.PI) / 180 };
}

// A three.js object for a bridge: one mesh per material, and the bascule leaves on their pivots.
// setOpen(0..1) lifts the leaves.
export function bridgeObject(bg: BridgeGeometry, mats = bridgeMaterials()) {
  const group = new THREE.Group();
  const meshes = (parts: BridgeGeometry['parts'], into: THREE.Object3D) => {
    for (const [m, geo] of Object.entries(parts) as [Mat, THREE.BufferGeometry][]) {
      const mesh = new THREE.Mesh(geo, mats[m]);
      mesh.castShadow = m !== 'line' && m !== 'rail';
      mesh.receiveShadow = true;
      into.add(mesh);
    }
  };
  meshes(bg.parts, group);
  const pivots = bg.leaves.map((l) => {
    const o = new THREE.Group();
    o.position.set(...l.pivot);
    meshes(l.parts, o);
    group.add(o);
    return o;
  });
  const axes = bg.leaves.map((l) => new THREE.Vector3(...l.axis).normalize());
  return {
    object: group,
    setOpen(t: number) { bg.leaves.forEach((l, i) => pivots[i].setRotationFromAxisAngle(axes[i], l.sign * l.max * Math.max(0, Math.min(1, t)))); },
  };
}

// Shared with the demo, for drawing embankments and roads in the same way.
export { sweep as sweepAlong, frameAt, at as offsetAt, rect as sectionRect };
