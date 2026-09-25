// Procedural buildings: a handful of simulation kinds (house, terrace, shop, flats, office, tower)
// each dressed by seeded "recipes" — archetype, massing, wall skin, window style, roof, and
// features such as bays, balconies, dormers, porches, awnings, chimneys and water tanks.
// Everything a building uses is batched into one mesh per material to keep draw calls down.
import * as THREE from 'three';
import { rng, type Lot } from './roads';

type Sw = [string, string]; // colour, name
const BRICK: Sw[] = [['#9a4b35', 'red brick'], ['#b0603f', 'orange brick'], ['#7e3b2e', 'dark red brick'], ['#c9a678', 'yellow stock brick'], ['#8a6a55', 'brown brick'], ['#b8a08c', 'pale brick'], ['#7c7670', 'grey brick']];
const RENDER: Sw[] = [['#efe8da', 'cream render'], ['#f5f3ee', 'white render'], ['#e3cfad', 'sand render'], ['#d6dfdc', 'pale grey render']];
const PASTEL: Sw[] = [['#f0c4b8', 'pink'], ['#c4dcc2', 'mint'], ['#b9d1e6', 'powder blue'], ['#f2e0a0', 'primrose'], ['#d6c4e0', 'lilac'], ['#f3d2a2', 'apricot'], ['#ecebe4', 'white'], ['#a9cfc9', 'duck-egg']];
const STONE: Sw[] = [['#ddd3bb', 'Portland stone'], ['#cdb48a', 'Bath stone'], ['#aaa49b', 'granite']];
const CONC: Sw[] = [['#b9b6ae', 'concrete'], ['#a3a098', 'weathered concrete'], ['#cfcac0', 'pale concrete']];
const TIMBER: Sw[] = [['#a8744a', 'larch cladding'], ['#6e4a33', 'cedar cladding'], ['#3f3b38', 'charred timber'], ['#c9a27a', 'pale timber']];
const GLASS: Sw[] = [['#6f8fae', 'blue glass'], ['#5f827e', 'green glass'], ['#8ea4b8', 'silver glass'], ['#4c6580', 'dark glass'], ['#9b8f7e', 'bronze glass']];
const SLATE: Sw[] = [['#535c66', 'slate roof'], ['#474e57', 'dark slate roof']];
const TILE: Sw[] = [['#9c463b', 'clay tile roof'], ['#b0633e', 'terracotta roof'], ['#6d5a50', 'brown tile roof']];
const COPPER: Sw = ['#6f9a8a', 'copper roof'];
const METALS: Sw[] = [['#8a969e', 'grey cladding'], ['#5f7f8f', 'blue cladding'], ['#b8bcbf', 'silver cladding'], ['#6b7f5a', 'green cladding'], ['#c9cdd0', 'white cladding'], ['#8c3b32', 'red cladding']];
const METAL: Sw = ['#3f4449', 'standing-seam roof'];
const FRAMES = ['#f4f4f0', '#f4f4f0', '#2d3338', '#2e5a45'];
const DOORS = ['#2e4a6b', '#7a2d2d', '#2e5a45', '#222222', '#d9b43c', '#6b4b8a', '#f4f4f0', '#c9573a'];
const FASCIA = ['#2e7d5b', '#b23a3a', '#2f5d9e', '#c98a1f', '#3a3a3a', '#7a3f7a', '#1f6f78', '#8c2f4f'];
const TRIM = '#ece6d8';
const GRAVEL = '#8e8b86';

type Win = 'none' | 'sash' | 'grid' | 'arched' | 'casement' | 'picture' | 'ribbon' | 'curtain' | 'punched' | 'door' | 'warehouse' | 'shop' | 'lobby';
type Skin = 'brick' | 'render' | 'stone' | 'concrete' | 'timber' | 'glass' | 'metal';
const WIN_NAME: Record<Win, string> = {
  none: '', sash: 'sash windows', grid: 'Georgian sash windows', arched: 'arched windows', casement: 'casement windows', picture: 'picture windows',
  ribbon: 'ribbon windows', curtain: 'curtain wall', punched: 'punched windows', door: 'balcony doors', warehouse: 'warehouse windows', shop: 'shopfront', lobby: 'glazed lobby',
};

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const shade = (hex: string, f: number) => `rgb(${rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * f)))).join(',')})`;
const pick = <T,>(r: () => number, arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];

// ---------------- textures ----------------
// Facade textures hold 2 x 2 window cells (one bay by one floor each), so neighbouring windows
// get different glass, blinds and curtains.
const texCache = new Map<string, THREE.Texture>();
function tex(key: string, w: number, h: number, draw: (x: CanvasRenderingContext2D, r: () => number) => void) {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, rng(hash(key)));
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

function drawSkin(x: CanvasRenderingContext2D, r: () => number, skin: Skin, wall: string) {
  x.fillStyle = wall;
  x.fillRect(0, 0, 128, 128);
  if (skin === 'brick') {
    for (let y = 0, row = 0; y < 128; y += 2, row++)
      for (let bx = row % 2 ? -2.5 : 0; bx < 128; bx += 5) { x.fillStyle = shade(wall, 0.84 + r() * 0.3); x.fillRect(bx, y, 4.4, 1.5); }
  } else if (skin === 'stone') {
    for (let y = 0, row = 0; y < 128; y += 8, row++) {
      x.fillStyle = shade(wall, 0.82); x.fillRect(0, y, 128, 1);
      for (let bx = row % 2 ? 8 : 0; bx < 128; bx += 16) { x.fillStyle = shade(wall, 0.92 + r() * 0.14); x.fillRect(bx + 1, y + 1, 14, 7); }
    }
  } else if (skin === 'timber') {
    for (let bx = 0; bx < 128; bx += 4) { x.fillStyle = shade(wall, 0.88 + r() * 0.2); x.fillRect(bx, 0, 3.4, 128); }
  } else if (skin === 'concrete') {
    for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(0,0,0,${r() * 0.06})`; x.fillRect(r() * 128, r() * 128, 1 + r() * 3, 1 + r() * 6); }
    x.fillStyle = shade(wall, 0.78);
    for (const v of [0, 64]) { x.fillRect(v, 0, 1, 128); x.fillRect(0, v, 128, 1); x.fillRect(0, v + 32, 128, 0.6); }
  } else if (skin === 'metal') {
    for (let bx = 0; bx < 128; bx += 5) { x.fillStyle = shade(wall, 0.78); x.fillRect(bx, 0, 1, 128); x.fillStyle = shade(wall, 1.12); x.fillRect(bx + 1.2, 0, 0.8, 128); }
  } else if (skin === 'glass') {
    const g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, shade(wall, 1.35)); g.addColorStop(0.5, wall); g.addColorStop(1, shade(wall, 0.8));
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  } else {
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.05})`; x.fillRect(r() * 128, r() * 128, 1.5, 1.5); }
  }
}

const GLASS_TONES = ['#3e5366', '#4a6378', '#56708a', '#6d8194', '#445a6c'];
function glassCell(x: CanvasRenderingContext2D, r: () => number, gx: number, gy: number, gw: number, gh: number, base?: string) {
  const g = x.createLinearGradient(gx, gy, gx + gw, gy + gh);
  const tone = base ?? pick(r, GLASS_TONES);
  g.addColorStop(0, shade(tone, 1.45)); g.addColorStop(0.45, tone); g.addColorStop(1, shade(tone, 0.8));
  x.fillStyle = g;
  x.fillRect(gx, gy, gw, gh);
  // life behind the glass: blinds, curtains, a lamp
  const k = r();
  if (k < 0.25) { x.fillStyle = pick(r, ['#e8e2cf', '#d9cdb0', '#f1ede4']); x.fillRect(gx, gy, gw, gh * (0.2 + r() * 0.5)); }
  else if (k < 0.4) { x.fillStyle = pick(r, ['#9c5a4a', '#5a6f8c', '#c9b48a', '#7c8a5a']); x.fillRect(gx, gy, gw * 0.22, gh); x.fillRect(gx + gw * 0.78, gy, gw * 0.22, gh); }
  else if (k < 0.46) { x.fillStyle = 'rgba(255,214,140,0.55)'; x.fillRect(gx, gy + gh * 0.3, gw, gh * 0.7); }
}

function drawWindow(x: CanvasRenderingContext2D, r: () => number, win: Win, cx: number, cy: number, wall: string, frame: string, fascia: string) {
  const S = 64;
  const R = (a: number, b: number, w: number, h: number, c: string) => { x.fillStyle = c; x.fillRect(cx + a * S, cy + b * S, w * S, h * S); };
  const lintel = shade(wall === '#f5f3ee' ? '#d8d2c4' : '#efe9dc', 1);
  if (win === 'sash' || win === 'grid') {
    R(0.27, 0.13, 0.46, 0.06, lintel);
    R(0.3, 0.19, 0.4, 0.6, frame);
    glassCell(x, r, cx + 0.32 * S, cy + 0.21 * S, 0.36 * S, 0.56 * S);
    R(0.3, 0.47, 0.4, 0.025, frame);
    if (win === 'grid') { for (const v of [0.43, 0.56]) R(v, 0.2, 0.015, 0.58, frame); for (const v of [0.33, 0.62]) R(0.3, v, 0.4, 0.015, frame); }
    else R(0.49, 0.2, 0.02, 0.58, frame);
    R(0.27, 0.79, 0.46, 0.04, lintel);
  } else if (win === 'arched') {
    x.fillStyle = lintel;
    x.beginPath(); x.arc(cx + 0.5 * S, cy + 0.34 * S, 0.24 * S, Math.PI, 0); x.fill();
    x.fillStyle = frame;
    x.beginPath(); x.arc(cx + 0.5 * S, cy + 0.34 * S, 0.2 * S, Math.PI, 0); x.fill();
    R(0.3, 0.34, 0.4, 0.45, frame);
    x.save(); x.beginPath(); x.arc(cx + 0.5 * S, cy + 0.34 * S, 0.18 * S, Math.PI, 0); x.rect(cx + 0.32 * S, cy + 0.34 * S, 0.36 * S, 0.43 * S); x.clip();
    glassCell(x, r, cx + 0.32 * S, cy + 0.16 * S, 0.36 * S, 0.61 * S); x.restore();
    R(0.49, 0.18, 0.02, 0.6, frame); R(0.3, 0.52, 0.4, 0.025, frame);
    R(0.27, 0.79, 0.46, 0.04, lintel);
  } else if (win === 'casement') {
    R(0.22, 0.3, 0.56, 0.44, frame);
    glassCell(x, r, cx + 0.245 * S, cy + 0.325 * S, 0.51 * S, 0.39 * S);
    R(0.49, 0.3, 0.02, 0.44, frame); R(0.22, 0.42, 0.56, 0.02, frame);
    R(0.2, 0.74, 0.6, 0.04, shade(wall, 0.8));
  } else if (win === 'picture') {
    R(0.1, 0.22, 0.8, 0.58, frame);
    glassCell(x, r, cx + 0.12 * S, cy + 0.24 * S, 0.76 * S, 0.54 * S);
    R(0.66, 0.22, 0.02, 0.58, frame);
  } else if (win === 'ribbon') {
    R(0, 0.28, 1, 0.5, frame);
    glassCell(x, r, cx, cy + 0.3 * S, S, 0.46 * S);
    R(0, 0.28, 0.02, 0.5, frame); R(0.5, 0.28, 0.02, 0.5, frame);
  } else if (win === 'curtain') {
    glassCell(x, r, cx, cy, S, 0.86 * S, wall);
    R(0, 0.86, 1, 0.14, shade(wall, 0.55));
    R(0, 0, 0.03, 1, shade(wall, 1.5)); R(0.5, 0, 0.02, 1, shade(wall, 1.3));
  } else if (win === 'punched') {
    R(0.3, 0.26, 0.4, 0.46, shade(wall, 0.5));
    glassCell(x, r, cx + 0.34 * S, cy + 0.3 * S, 0.32 * S, 0.4 * S);
  } else if (win === 'door') {
    R(0.26, 0.12, 0.48, 0.88, frame);
    glassCell(x, r, cx + 0.285 * S, cy + 0.145 * S, 0.43 * S, 0.83 * S);
    R(0.49, 0.12, 0.02, 0.88, frame);
  } else if (win === 'warehouse') {
    R(0.14, 0.16, 0.72, 0.66, frame);
    glassCell(x, r, cx + 0.16 * S, cy + 0.18 * S, 0.68 * S, 0.62 * S);
    for (const v of [0.32, 0.5, 0.68]) R(v, 0.16, 0.012, 0.66, frame);
    for (const v of [0.34, 0.5, 0.66]) R(0.14, v, 0.72, 0.012, frame);
    R(0.12, 0.1, 0.76, 0.06, shade(wall, 0.8));
  } else if (win === 'shop') {
    R(0, 0, 1, 0.2, fascia);
    for (let i = 0; i < 5; i++) if (r() < 0.8) R(0.12 + i * 0.15, 0.07, 0.1, 0.06, '#f3ead2'); // sign lettering
    R(0, 0.2, 1, 0.8, shade(fascia, 0.55));
    glassCell(x, r, cx + 0.06 * S, cy + 0.26 * S, 0.88 * S, 0.58 * S, '#6d8aa0');
    for (let i = 0; i < 6; i++) R(0.1 + r() * 0.75, 0.62 + r() * 0.14, 0.05 + r() * 0.06, 0.08, pick(r, ['#e0b040', '#c84a4a', '#f2efe6', '#4a7ac8', '#6aa050']));
    if (r() < 0.5) R(0.7, 0.3, 0.18, 0.7, shade(fascia, 0.4));
    R(0, 0.86, 1, 0.14, shade(fascia, 0.45));
  } else if (win === 'lobby') {
    R(0, 0.1, 1, 0.9, frame);
    glassCell(x, r, cx + 0.03 * S, cy + 0.13 * S, 0.94 * S, 0.87 * S, '#7a93a8');
    R(0.49, 0.1, 0.02, 0.9, frame); R(0, 0.1, 1, 0.03, frame);
  }
}

function facadeTex(win: Win, skin: Skin, wall: string, frame: string, fascia = '#2e7d5b') {
  return tex(`f|${win}|${skin}|${wall}|${frame}|${fascia}`, 128, 128, (x, r) => {
    drawSkin(x, r, skin, wall);
    if (win === 'none') return;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) drawWindow(x, r, win, i * 64, j * 64, wall, frame, win === 'shop' ? pick(r, [fascia, fascia, pick(r, FASCIA)]) : fascia);
  });
}
const roofTex = (col: string) => tex(`r|${col}`, 64, 64, (x, r) => {
  x.fillStyle = col; x.fillRect(0, 0, 64, 64);
  for (let y = 0, row = 0; y < 64; y += 6, row++) {
    for (let bx = row % 2 ? -4 : 0; bx < 64; bx += 8) { x.fillStyle = shade(col, 0.9 + r() * 0.2); x.fillRect(bx, y, 7.4, 5.4); }
    x.fillStyle = shade(col, 0.7); x.fillRect(0, y + 5.4, 64, 0.8);
  }
});
const stripeTex = (col: string) => tex(`s|${col}`, 32, 8, (x) => { x.fillStyle = col; x.fillRect(0, 0, 32, 8); x.fillStyle = '#f3efe4'; x.fillRect(16, 0, 16, 8); });

// ---------------- materials ----------------
const mats = new Map<string, THREE.Material>();
const M = (key: string, make: () => THREE.Material) => { let m = mats.get(key); if (!m) { m = make(); mats.set(key, m); } return m; };
// Plain colours all share one vertex-coloured material, so they merge into a single draw call.
const PLAIN = new THREE.MeshLambertMaterial({ vertexColors: true });
export const PLAIN_MAT = PLAIN; // (industrial sites bake into the chunks with it: game/industry.ts)
const plain = (c: string) => M(`p|${c}`, () => { const m = new THREE.MeshLambertMaterial({ color: c }); m.userData.tint = new THREE.Color(c); return m; });
const facade = (win: Win, skin: Skin, wall: string, frame: string, fascia?: string) => M(`f|${win}|${skin}|${wall}|${frame}|${fascia}`, () => new THREE.MeshLambertMaterial({ map: facadeTex(win, skin, wall, frame, fascia) }));
const roofM = (c: string) => M(`r|${c}`, () => new THREE.MeshLambertMaterial({ map: roofTex(c) }));
const stripes = (c: string) => M(`s|${c}`, () => new THREE.MeshLambertMaterial({ map: stripeTex(c), side: THREE.DoubleSide }));
const railM = () => M('rail', () => new THREE.MeshLambertMaterial({ color: '#a9cddd', transparent: true, opacity: 0.5, depthWrite: false }));

// ---------------- geometry kit ----------------
type V = [number, number, number];
type XZ = [number, number];

const WHITE = new THREE.Color(1, 1, 1);
class Geo {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = [];
  col = WHITE;
  tri(a: V, b: V, c: V, ua: XZ, ub: XZ, uc: XZ) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    nx /= L; ny /= L; nz /= L;
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.n.push(nx, ny, nz);
    this.uv.push(...ua, ...ub, ...uc);
    for (let i = 0; i < 3; i++) this.c.push(this.col.r, this.col.g, this.col.b);
  }
  quad(a: V, b: V, c: V, d: V, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1]);
    this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1]);
  }
}

// A footprint rectangle, ordered front-left, front-right, back-right, back-left (+z is the front).
const rect = (cx: number, cz: number, w: number, d: number): XZ[] => [[cx - w / 2, cz + d / 2], [cx + w / 2, cz + d / 2], [cx + w / 2, cz - d / 2], [cx - w / 2, cz - d / 2]];

class Kit {
  byMat = new Map<THREE.Material, Geo>();
  private frames: { ox: number; oz: number; c: number; s: number }[] = [];
  top = 0;
  foot = { w: 0, d: 0 };
  doorX: number | undefined;
  g(m: THREE.Material) {
    const tint = m.userData.tint as THREE.Color | undefined;
    const key = tint ? PLAIN : m;
    let g = this.byMat.get(key);
    if (!g) { g = new Geo(); this.byMat.set(key, g); }
    g.col = tint ?? WHITE;
    return g;
  }
  T(x: number, y: number, z: number): V {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      [x, z] = [f.ox + x * f.c + z * f.s, f.oz - x * f.s + z * f.c];
    }
    this.top = Math.max(this.top, y);
    return [x, y, z];
  }
  // draw inside a local frame, offset and turned about the vertical axis
  at(ox: number, oz: number, ry: number, fn: () => void) {
    this.frames.push({ ox, oz, c: Math.cos(ry), s: Math.sin(ry) });
    fn();
    this.frames.pop();
  }
  // Walls along a footprint path; windows are fitted to whole bays on every face.
  // With cellW = 0 the texture is simply mapped in metres (for trim, parapets, chimneys).
  walls(pts: XZ[], closed: boolean, y0: number, floors: number, fh: number, cellW: number, m: THREE.Material) {
    const g = this.g(m), y1 = y0 + floors * fh;
    const E = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < E; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const u = cellW ? Math.max(1, Math.round(len / cellW)) / 2 : len / 6, v = cellW ? floors / 2 : (y1 - y0) / 6;
      g.quad(this.T(p[0], y0, p[1]), this.T(q[0], y0, q[1]), this.T(q[0], y1, q[1]), this.T(p[0], y1, p[1]), 0, 0, u, v);
    }
  }
  // A block: front face, sides and back can each have their own facade.
  block(cx: number, cz: number, w: number, d: number, y0: number, floors: number, fh: number, cellW: number, front: THREE.Material, side = front, back = side, cap?: THREE.Material) {
    const r = rect(cx, cz, w, d);
    this.walls([r[0], r[1]], false, y0, floors, fh, cellW, front);
    this.walls([r[1], r[2]], false, y0, floors, fh, cellW, side);
    this.walls([r[2], r[3]], false, y0, floors, fh, cellW, back);
    this.walls([r[3], r[0]], false, y0, floors, fh, cellW, side);
    if (cap) this.cap(r, y0 + floors * fh, cap);
  }
  cap(pts: XZ[], y: number, m: THREE.Material) {
    const g = this.g(m);
    // keep the face pointing up whichever way the outline winds
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    const P = area < 0 ? pts : [...pts].reverse();
    for (let i = 1; i + 1 < P.length; i++)
      g.tri(this.T(P[0][0], y, P[0][1]), this.T(P[i][0], y, P[i][1]), this.T(P[i + 1][0], y, P[i + 1][1]), [P[0][0] / 3, P[0][1] / 3], [P[i][0] / 3, P[i][1] / 3], [P[i + 1][0] / 3, P[i + 1][1] / 3]);
  }
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, m: THREE.Material) {
    this.walls(rect(cx, cz, w, d), true, y0, 1, h, 0, m);
    this.cap(rect(cx, cz, w, d), y0 + h, m);
  }
  // Truncated pyramid: hip roofs (td = 0), pyramids, mansards, spires, podium steps.
  frustum(cx: number, cz: number, w: number, d: number, tw: number, td: number, y0: number, h: number, m: THREE.Material, capM?: THREE.Material) {
    const B = rect(cx, cz, w, d), U = rect(cx, cz, tw, td), g = this.g(m);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const len = Math.hypot(B[j][0] - B[i][0], B[j][1] - B[i][1]);
      const slant = Math.hypot(h, (Math.abs(w - tw) + Math.abs(d - td)) / 4);
      g.quad(this.T(B[i][0], y0, B[i][1]), this.T(B[j][0], y0, B[j][1]), this.T(U[j][0], y0 + h, U[j][1]), this.T(U[i][0], y0 + h, U[i][1]), 0, 0, len / 2, slant / 2);
    }
    if (capM && tw > 0.05 && td > 0.05) this.cap(U, y0 + h, capM);
  }
  // Gable roof with its ridge running along x; the triangular ends are walls.
  // overX is the overhang past the gable ends: 0 where roofs of a terrace meet, or they'd overlap
  gable(cx: number, cz: number, w: number, d: number, y0: number, rise: number, over: number, roof: THREE.Material, end: THREE.Material, overX = over) {
    const g = this.g(roof), x0 = cx - w / 2 - overX, x1 = cx + w / 2 + overX, zf = cz + d / 2 + over, zb = cz - d / 2 - over, top = y0 + rise;
    const eave = over * (rise / (d / 2)); // eaves dip a little below the wall top
    const slant = Math.hypot(rise, d / 2 + over) / 2, W = (x1 - x0) / 2;
    g.quad(this.T(x0, y0 - eave, zf), this.T(x1, y0 - eave, zf), this.T(x1, top, cz), this.T(x0, top, cz), 0, 0, W, slant);
    g.quad(this.T(x1, y0 - eave, zb), this.T(x0, y0 - eave, zb), this.T(x0, top, cz), this.T(x1, top, cz), 0, 0, W, slant);
    const e = this.g(end), h = d / 2, xl = cx - w / 2, xr = cx + w / 2;
    e.tri(this.T(xl, y0, cz + h), this.T(xl, top, cz), this.T(xl, y0, cz - h), [0, 0], [h / 6, rise / 6], [d / 6, 0]);
    e.tri(this.T(xr, y0, cz - h), this.T(xr, top, cz), this.T(xr, y0, cz + h), [0, 0], [h / 6, rise / 6], [d / 6, 0]);
  }
  // Regular n-sided prism, optionally with a cone on top (water tanks, turrets, spires).
  prismN(x: number, z: number, r: number, n: number, y0: number, h: number, m: THREE.Material, cone = 0, coneM = m) {
    const pts: XZ[] = [];
    for (let i = 0; i < n; i++) { const a = (-i / n) * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
    this.walls(pts, true, y0, 1, h, 0, m);
    if (!cone) return this.cap(pts, y0 + h, m);
    const g = this.g(coneM);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      g.tri(this.T(p[0], y0 + h, p[1]), this.T(q[0], y0 + h, q[1]), this.T(x, y0 + h + cone, z), [0, 0], [1, 0], [0.5, 1]);
    }
  }
  build() {
    const group = new THREE.Group();
    for (const [m, g] of this.byMat) {
      if (!g.p.length) continue;
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      bg.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
      const mesh = new THREE.Mesh(bg, m);
      const transparent = (m as THREE.MeshLambertMaterial).transparent;
      mesh.castShadow = !transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

// ---------------- features ----------------
function door(k: Kit, x: number, zf: number, col: string, w = 1.05, h = 2.2) {
  k.doorX ??= x;
  k.box(x, 0, zf + 0.06, w + 0.3, h + 0.2, 0.1, plain(TRIM));
  k.box(x, 0, zf + 0.1, w, h, 0.1, plain(col));
  k.box(x, 0, zf + 0.35, w + 0.5, 0.18, 0.6, plain('#b9b3a8')); // step
}
function porch(k: Kit, x: number, zf: number, w: number, roof: THREE.Material) {
  k.box(x, 2.55, zf + 0.7, w + 0.4, 0.18, 1.4, plain(TRIM));
  k.frustum(x, zf + 0.7, w + 0.4, 1.4, w + 0.4, 0.05, 2.73, 0.45, roof);
  for (const s of [-1, 1]) k.box(x + s * (w / 2), 0, zf + 1.3, 0.14, 2.55, 0.14, plain(TRIM));
}
function portico(k: Kit, x: number, zf: number, stone: THREE.Material) {
  for (const s of [-1, 1]) k.prismN(x + s * 0.95, zf + 1.1, 0.2, 8, 0, 2.9, plain(TRIM));
  k.box(x, 2.9, zf + 0.75, 2.6, 0.35, 1.5, stone);
  k.at(x, zf + 0.75, 0, () => k.gable(0, 0, 2.6, 1.5, 3.25, 0.6, 0.05, plain(TRIM), plain(TRIM)));
}
// canted bay window; the outline leaves and rejoins the front wall
function bay(k: Kit, x: number, zf: number, bw: number, y0: number, floors: number, fh: number, wall: THREE.Material, top: THREE.Material) {
  const dep = 0.85, cant = 0.55;
  const pts: XZ[] = [[x - bw / 2, zf], [x - bw / 2 + cant, zf + dep], [x + bw / 2 - cant, zf + dep], [x + bw / 2, zf]];
  k.walls(pts, false, y0, floors, fh, 1.4, wall);
  k.cap(pts, y0 + floors * fh + 0.02, top);
  k.cap(pts, y0 + 0.02, plain('#b9b3a8'));
}
function chimney(k: Kit, x: number, z: number, y: number, m: THREE.Material) {
  k.box(x, y - 1.2, z, 0.9, 2.6, 0.7, m);
  k.box(x, y + 1.4, z, 1.05, 0.15, 0.85, plain('#c8c0b0'));
  for (const s of [-0.22, 0.22]) k.prismN(x + s, z, 0.13, 6, y + 1.55, 0.45, plain('#b0633e'));
}
function dormer(k: Kit, x: number, zf: number, y: number, wall: THREE.Material, roof: THREE.Material) {
  k.walls(rect(x, zf - 0.8, 1.7, 1.6), true, y, 1, 1.7, 3, wall);
  k.at(x, zf - 0.8, Math.PI / 2, () => k.gable(0, 0, 1.6, 1.7, y + 1.7, 0.8, 0.12, roof, plain(TRIM)));
}
// Hipped roof: the ridge runs along the longer side.
const hip = (k: Kit, cx: number, cz: number, w: number, d: number, y: number, rise: number, m: THREE.Material) => k.frustum(cx, cz, w, d, Math.max(0.01, w - d), Math.max(0.01, d - w), y, rise, m);
function parapet(k: Kit, cx: number, cz: number, w: number, d: number, y: number, h: number, m: THREE.Material) {
  const t = 0.3;
  k.box(cx, y, cz + d / 2 - t / 2, w, h, t, m);
  k.box(cx, y, cz - d / 2 + t / 2, w, h, t, m);
  k.box(cx - w / 2 + t / 2, y, cz, t, h, d - 2 * t, m);
  k.box(cx + w / 2 - t / 2, y, cz, t, h, d - 2 * t, m);
}
// A cornice is a band round the top of the walls: its top is only the overhang, a frame round
// the roof. (As a solid slab its top covered the whole roof at the roof's own height, and the two
// fought over which to draw — the flashing triangles.)
function cornice(k: Kit, cx: number, cz: number, w: number, d: number, y: number, m: THREE.Material, out = 0.3, h = 0.4) {
  const W = w + out * 2, D = d + out * 2;
  k.walls(rect(cx, cz, W, D), true, y, 1, h, 0, m);
  k.cap(rect(cx, cz + d / 2 + out / 2, W, out), y + h, m);
  k.cap(rect(cx, cz - d / 2 - out / 2, W, out), y + h, m);
  k.cap(rect(cx - w / 2 - out / 2, cz, out, d), y + h, m);
  k.cap(rect(cx + w / 2 + out / 2, cz, out, d), y + h, m);
}
function flatRoof(k: Kit, cx: number, cz: number, w: number, d: number, y: number, edge: THREE.Material, r: () => number, plant = true) {
  k.cap(rect(cx, cz, w - 0.2, d - 0.2), y + 0.05, plain(GRAVEL));
  parapet(k, cx, cz, w, d, y, 0.8, edge);
  if (plant) for (let i = 0; i < 1 + Math.floor(r() * 3); i++) k.box(cx + (r() - 0.5) * w * 0.5, y, cz + (r() - 0.5) * d * 0.5, 1.5 + r() * 2.5, 1 + r() * 1.4, 1.2 + r() * 2, plain(pick(r, ['#a7a9ab', '#9aa0a4', '#c1c3c4'])));
}
function waterTank(k: Kit, x: number, z: number, y: number) {
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) k.box(x + a * 0.8, y, z + b * 0.8, 0.14, 1.8, 0.14, plain('#3a3a3a'));
  k.prismN(x, z, 1.35, 10, y + 1.8, 2.6, plain('#8a6446'), 1.1, plain('#4a4a4a'));
}
function balconies(k: Kit, x0: number, x1: number, zf: number, f0: number, f1: number, fh: number, cellW: number, pattern: number, slab: THREE.Material, y0 = 0) {
  const n = Math.max(1, Math.round((x1 - x0) / cellW)), bw = (x1 - x0) / n;
  for (let f = f0; f < f1; f++) {
    if (pattern === 2) {
      k.box((x0 + x1) / 2, y0 + f * fh - 0.1, zf + 0.7, x1 - x0, 0.22, 1.4, slab);
      k.box((x0 + x1) / 2, y0 + f * fh + 0.12, zf + 1.38, x1 - x0, 1.0, 0.05, railM());
      continue;
    }
    for (let i = 0; i < n; i++) {
      if (pattern === 1 && (i + f) % 2) continue;
      const cx = x0 + bw * (i + 0.5);
      k.box(cx, y0 + f * fh - 0.1, zf + 0.65, bw * 0.78, 0.22, 1.3, slab);
      k.box(cx, y0 + f * fh + 0.12, zf + 1.28, bw * 0.78, 1.0, 0.05, railM());
    }
  }
}
function awning(k: Kit, x: number, zf: number, w: number, y: number, col: string) {
  k.g(stripes(col)).quad(k.T(x - w / 2, y - 0.7, zf + 1.6), k.T(x + w / 2, y - 0.7, zf + 1.6), k.T(x + w / 2, y, zf), k.T(x - w / 2, y, zf), 0, 0, w / 1.2, 1);
  k.box(x, y - 0.95, zf + 1.58, w, 0.25, 0.04, stripes(col));
}

// ---------------- recipes ----------------
export interface BuiltShape { group: THREE.Group; height: number; name: string; detail: string }

interface Look { skin: Skin; wall: Sw; win: Win; frame: string }
const skinPalette = (s: Skin): Sw[] => ({ brick: BRICK, render: RENDER, stone: STONE, concrete: CONC, timber: TIMBER, glass: GLASS, metal: METALS }[s]);
const look = (r: () => number, skin: Skin, win: Win, frame = pick(r, FRAMES), wall = pick(r, skinPalette(skin))): Look => ({ skin, wall, win, frame });
const fm = (l: Look, win: Win = l.win) => facade(win, l.skin, l.wall[0], l.frame);
const blank = (l: Look) => facade('none', l.skin, l.wall[0], l.frame);
const cellOf = (win: Win) => (win === 'picture' ? 4 : win === 'curtain' ? 3 : win === 'warehouse' ? 3.6 : 3);
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;

function house(k: Kit, l: Lot, r: () => number, rr: () => number) {
  const W = Math.min(l.w, 11), D = Math.min(l.d * 0.85, 10);
  k.foot = { w: W, d: D };
  // streets are often built by one developer, so neighbours usually share an archetype
  const arch = rr() < 0.7 ? pick(rr, ['cottage', 'villa', 'semi', 'modern', 'bungalow', 'georgian'] as const) : pick(r, ['cottage', 'villa', 'semi', 'modern', 'bungalow', 'georgian'] as const);
  const zf = D / 2, doorCol = pick(r, DOORS), extras: string[] = [];
  let L: Look, roofName: string, name: string;
  if (arch === 'cottage') {
    L = look(r, r() < 0.6 ? 'render' : 'stone', 'casement', pick(r, ['#f4f4f0', '#2e5a45', '#f4f4f0']), r() < 0.5 ? pick(r, PASTEL) : undefined);
    if (L.skin === 'render' && r() < 0.5) L.wall = pick(r, RENDER);
    const roof = pick(r, [...TILE, ...SLATE]); roofName = roof[1];
    const half = r() < 0.4; // storey-and-a-half with dormers
    const floors = half ? 1 : 2, fh = 2.6, wallTop = floors * fh;
    k.block(0, 0, W, D, 0, floors, fh, 3, fm(L), r() < 0.5 ? blank(L) : fm(L), fm(L));
    k.gable(0, 0, W, D, wallTop, half ? 4.2 : 3.4, 0.35, roofM(roof[0]), blank(L));
    if (half) { for (const x of [-W / 4, W / 4]) dormer(k, x, zf, wallTop + 0.3, fm(L), roofM(roof[0])); extras.push('dormers'); }
    chimney(k, W / 2 - 0.6, 0, wallTop + (half ? 4.2 : 3.4), blank(L));
    door(k, -W / 4 + (half ? W / 4 : 0), zf, doorCol);
    if (r() < 0.6) { porch(k, -W / 4 + (half ? W / 4 : 0), zf, 1.6, roofM(roof[0])); extras.push('porch'); }
    name = half ? 'Dormer cottage' : 'Cottage';
  } else if (arch === 'villa') {
    L = look(r, 'brick', r() < 0.5 ? 'sash' : 'arched', '#f4f4f0');
    const roof = pick(r, SLATE); roofName = roof[1];
    const fh = 3, wallTop = 6;
    k.block(0, 0, W, D, 0, 2, fh, 3, fm(L), blank(L), fm(L));
    cornice(k, 0, 0, W, D, wallTop - 0.3, plain(TRIM), 0.15, 0.3);
    if (r() < 0.5) { hip(k, 0, 0, W + 0.7, D + 0.7, wallTop, 3.6, roofM(roof[0])); roofName = 'hipped ' + roofName; }
    else { k.at(0, 0, Math.PI / 2, () => k.gable(0, 0, D, W, wallTop, 4.2, 0.35, roofM(roof[0]), blank(L))); roofName = 'front-gabled ' + roofName; }
    bay(k, -W / 4, zf, 2.8, 0, 2, fh, fm(L), plain('#5b6168')); extras.push('two-storey bay');
    for (const s of [-1, 1]) chimney(k, s * (W / 2 - 0.5), 0, wallTop + 3.2, blank(L));
    door(k, W / 4, zf, doorCol);
    name = 'Victorian villa';
  } else if (arch === 'semi') {
    const two = r() < 0.5; // brick ground floor with rendered upper storey
    L = look(r, 'render', 'casement', '#f4f4f0', pick(r, [...RENDER, ...PASTEL.slice(0, 3)]));
    const low: Look = two ? look(r, 'brick', 'casement', '#f4f4f0') : L;
    const roof = pick(r, TILE); roofName = 'hipped ' + roof[1];
    const fh = 2.8, wallTop = 5.6;
    k.block(0, 0, W, D, 0, 1, fh, 3, fm(low), blank(low), fm(low));
    k.block(0, 0, W, D, fh, 1, fh, 3, fm(L), blank(L), fm(L));
    hip(k, 0, 0, W + 0.8, D + 0.8, wallTop, 3.4, roofM(roof[0]));
    if (r() < 0.7) { bay(k, -W / 4, zf, 3, 0, 2, fh, fm(L), roofM(roof[0])); extras.push('bay window'); }
    porch(k, W / 4, zf, 1.6, roofM(roof[0])); door(k, W / 4, zf, doorCol); extras.push('porch');
    chimney(k, W / 2 - 0.8, -D / 4, wallTop + 2.6, blank(low));
    name = two ? '1930s semi (brick and render)' : '1930s semi';
    if (two) L = low;
  } else if (arch === 'modern') {
    L = look(r, r() < 0.6 ? 'render' : 'timber', 'picture', '#2d3338', r() < 0.6 ? ['#f5f3ee', 'white render'] : undefined);
    const acc: Look = look(r, L.skin === 'timber' ? 'render' : 'timber', 'picture', '#2d3338', L.skin === 'timber' ? ['#f5f3ee', 'white render'] : undefined);
    roofName = 'flat roof';
    const fh = 3;
    k.block(0, 0, W, D, 0, 1, fh, 4, fm(L), fm(L), fm(L));
    // upper box slides forward over the entrance
    const shift = 1 + r() * 1.5, uw = W * (0.6 + r() * 0.3);
    k.block(-W / 2 + uw / 2, shift / 2, uw, D - 1 + shift, fh, 1, fh, 4, fm(acc), fm(acc), fm(acc));
    flatRoof(k, -W / 2 + uw / 2, shift / 2, uw, D - 1 + shift, 2 * fh, plain('#f5f3ee'), r, false);
    flatRoof(k, 0, 0, W, D, fh, plain('#e8e6e0'), r, false);
    door(k, W / 2 - 1.5, zf, doorCol);
    extras.push('cantilevered ' + acc.wall[1]);
    name = 'Modern house';
  } else if (arch === 'bungalow') {
    L = look(r, r() < 0.5 ? 'brick' : 'render', r() < 0.5 ? 'casement' : 'picture', '#f4f4f0');
    const roof = pick(r, [...TILE, ...SLATE]); roofName = 'hipped ' + roof[1];
    k.block(0, 0, W, D, 0, 1, 3, 3.5, fm(L), fm(L), fm(L));
    hip(k, 0, 0, W + 0.9, D + 0.9, 3, 3, roofM(roof[0]));
    door(k, 0, zf, doorCol);
    if (r() < 0.5) { bay(k, -W / 4, zf, 2.6, 0, 1, 3, fm(L), roofM(roof[0])); extras.push('bay window'); }
    name = 'Bungalow';
  } else {
    L = look(r, r() < 0.5 ? 'stone' : 'brick', 'grid', '#f4f4f0');
    const roof = pick(r, SLATE); roofName = 'hipped ' + roof[1];
    const fh = 3.2, wallTop = 6.4;
    k.block(0, 0, W, D, 0, 2, fh, W / 3, fm(L), blank(L), fm(L));
    cornice(k, 0, 0, W, D, wallTop - 0.35, plain(TRIM), 0.2, 0.35);
    hip(k, 0, 0, W + 0.5, D + 0.5, wallTop, 3, roofM(roof[0]));
    for (const s of [-1, 1]) chimney(k, s * (W / 2 - 0.5), 0, wallTop + 2.6, blank(L));
    portico(k, 0, zf, blank(L)); door(k, 0, zf, doorCol);
    extras.push('portico');
    name = 'Georgian house';
  }
  return { name, detail: [L.wall[1], WIN_NAME[L.win], roofName, ...extras].join(' · ') };
}

function terrace(k: Kit, l: Lot, r: () => number, rr: () => number) {
  const W = l.w, D = l.d, zf = D / 2, doorCol = pick(r, DOORS), extras: string[] = [];
  k.foot = { w: W, d: D };
  const arch = pick(rr, ['victorian', 'georgian', 'painted', 'townhouse', 'gabled'] as const);
  const doorLeft = rr() < 0.5 ? -1 : 1;
  let L: Look, roofName: string, name: string;
  if (arch === 'victorian') {
    L = look(rr, 'brick', rr() < 0.5 ? 'sash' : 'arched', '#f4f4f0');
    if (r() < 0.12) { L = { ...L, skin: 'render', wall: pick(r, PASTEL) }; extras.push('painted front'); }
    const roof = pick(rr, SLATE); roofName = roof[1];
    const fh = 3;
    k.block(0, 0, W, D, 0, 2, fh, 3, fm(L), blank(L), fm(L));
    k.gable(0, 0, W, D, 6, 3.2, 0.3, roofM(roof[0]), blank(L), 0);
    const bays = rr() < 0.6 ? 2 : 1;
    bay(k, -doorLeft * W / 5, zf, 2.6, 0, bays, fh, fm(L), plain('#5b6168'));
    extras.push(bays === 2 ? 'two-storey bay' : 'bay window');
    chimney(k, W / 2, -0.5, 9, blank(L));
    door(k, doorLeft * (W / 2 - 1.2), zf, doorCol);
    name = 'Victorian terrace';
  } else if (arch === 'georgian') {
    const painted = rr() < 0.5;
    L = painted ? look(r, 'render', 'grid', '#f4f4f0', pick(r, PASTEL)) : look(rr, rr() < 0.5 ? 'stone' : 'brick', 'grid', '#f4f4f0');
    const ground: Look = painted ? L : look(rr, 'stone', 'grid', '#f4f4f0', ['#e9e2cf', 'stucco']);
    const floors = 3 + Math.floor(rr() * 2), fh = 3.2, top = floors * fh;
    k.block(0, 0, W, D, 0, 1, fh, W / 2, fm(ground), blank(ground), fm(ground));
    k.block(0, 0, W, D, fh, floors - 1, fh, W / 2, fm(L), blank(L), fm(L));
    cornice(k, 0, 0, W, D, fh - 0.2, plain(TRIM), 0.12, 0.25);
    cornice(k, 0, 0, W, D, top - 0.4, plain(TRIM), 0.25, 0.4);
    if (rr() < 0.5) { k.frustum(0, 0, W, D, W, D - 3, top, 2.8, roofM(pick(rr, SLATE)[0]), plain(GRAVEL)); roofName = 'mansard roof'; dormer(k, 0, zf - 0.2, top + 0.2, fm(L), roofM(SLATE[0][0])); extras.push('dormer'); }
    else { flatRoof(k, 0, 0, W, D, top, blank(L), r, false); roofName = 'parapet roof'; }
    door(k, doorLeft * (W / 2 - 1.3), zf, doorCol, 1.1, 2.5);
    name = painted ? 'Painted Georgian terrace' : 'Georgian terrace';
  } else if (arch === 'painted') {
    L = look(r, 'render', rr() < 0.5 ? 'casement' : 'sash', '#f4f4f0', pick(r, PASTEL));
    const roof = pick(rr, [...SLATE, ...TILE]); roofName = roof[1];
    k.block(0, 0, W, D, 0, 2, 2.8, 3, fm(L), blank(L), fm(L));
    k.gable(0, 0, W, D, 5.6, 3, 0.3, roofM(roof[0]), blank(L), 0);
    chimney(k, W / 2, -0.8, 8.6, blank(L));
    door(k, doorLeft * (W / 2 - 1.2), zf, doorCol);
    name = 'Painted cottage row';
  } else if (arch === 'townhouse') {
    L = look(rr, 'brick', 'picture', '#2d3338', pick(rr, [BRICK[3], BRICK[5], BRICK[6]]));
    const fh = 3, floors = 3;
    k.block(0, 0, W, D, 0, floors, fh, 4, fm(L), blank(L), fm(L));
    flatRoof(k, 0, 0, W, D, floors * fh, blank(L), r, false);
    roofName = 'flat roof';
    if (rr() < 0.6) { balconies(k, -W / 2 + 0.6, W / 2 - 0.6, zf, 2, 3, fh, 6, 2, plain('#d8d6d0')); extras.push('Juliet balcony'); }
    door(k, doorLeft * (W / 2 - 1.2), zf, doorCol);
    name = 'Modern townhouse';
  } else {
    L = look(r, rr() < 0.5 ? 'brick' : 'render', rr() < 0.5 ? 'grid' : 'sash', '#f4f4f0', rr() < 0.5 ? pick(r, BRICK) : pick(r, PASTEL));
    const floors = 3 + Math.floor(rr() * 2), fh = 3, top = floors * fh;
    k.block(0, 0, W, D, 0, floors, fh, W / 2, fm(L), blank(L), fm(L));
    const roof = pick(rr, SLATE); roofName = 'front gable';
    k.at(0, 0, Math.PI / 2, () => k.gable(0, 0, D, W, top, 3.5 + rr() * 1.5, 0.2, roofM(roof[0]), fm(L)));
    door(k, doorLeft * (W / 2 - 1.2), zf, doorCol);
    name = 'Gabled canal house';
  }
  return { name, detail: [L.wall[1], WIN_NAME[L.win], roofName, ...extras].join(' · ') };
}

function shop(k: Kit, l: Lot, r: () => number) {
  const W = l.w, D = Math.min(l.d, 14), zf = D / 2, extras: string[] = [];
  k.foot = { w: W, d: D };
  const up = Math.max(1, Math.min(3, Math.round((l.h - 4) / 3)));
  const style = pick(r, ['victorian', 'render', 'stone', 'modern', 'deco'] as const);
  const L = style === 'victorian' ? look(r, 'brick', 'sash', '#f4f4f0') : style === 'render' ? look(r, 'render', 'casement', '#f4f4f0', r() < 0.5 ? pick(r, PASTEL) : undefined)
    : style === 'stone' ? look(r, 'stone', 'grid', '#f4f4f0') : style === 'modern' ? look(r, 'brick', 'picture', '#2d3338') : look(r, 'render', 'ribbon', '#2e5a45', ['#efe8da', 'cream render']);
  const fascia = pick(r, FASCIA);
  const gh = 4, fh = 3, top = gh + up * fh;
  k.block(0, 0, W, D, 0, 1, gh, 4.5, facade('shop', L.skin, L.wall[0], L.frame, fascia), blank(L), blank(L));
  k.block(0, 0, W, D, gh, up, fh, cellOf(L.win), fm(L), blank(L), fm(L));
  cornice(k, 0, 0, W, D, gh - 0.1, plain(TRIM), 0.2, 0.3);
  let roofName = 'parapet roof';
  if (style === 'victorian' && r() < 0.6) { k.gable(0, 0, W, D, top, 3, 0.2, roofM(pick(r, SLATE)[0]), blank(L)); roofName = 'slate roof'; }
  else if (style === 'deco') { flatRoof(k, 0, 0, W, D, top, blank(L), r); k.box(0, top, zf - 0.6, W * 0.3, 2.2, 1.2, blank(L)); extras.push('Deco parapet'); }
  else { cornice(k, 0, 0, W, D, top - 0.3, plain(TRIM), 0.25, 0.35); flatRoof(k, 0, 0, W, D, top, blank(L), r); }
  if (r() < 0.55) { const n = Math.max(1, Math.round(W / 4.5)); for (let i = 0; i < n; i++) awning(k, -W / 2 + (W / n) * (i + 0.5), zf, (W / n) * 0.9, 3.5, fascia); extras.push('striped awning'); }
  return { name: `Shop with ${plural(up, 'floor')} above`, detail: [L.wall[1], 'shopfront', WIN_NAME[L.win] + ' above', roofName, ...extras].join(' · ') };
}

function flats(k: Kit, l: Lot, r: () => number) {
  const W = l.w, D = Math.min(l.d, 16), zf = D / 2, extras: string[] = [];
  k.foot = { w: W, d: D };
  const floors = Math.max(3, Math.round(l.h / 3)), fh = 3, top = floors * fh;
  const arch = pick(r, ['mansion', 'balcony', 'brutalist', 'scandi', 'deco', 'brick'] as const);
  let L: Look, roofName = 'flat roof', name: string;
  if (arch === 'mansion') {
    L = look(r, 'brick', 'sash', '#f4f4f0', pick(r, [BRICK[0], BRICK[1], BRICK[2]]));
    const S = look(r, 'stone', 'arched', '#f4f4f0', ['#e3d9c2', 'stone']);
    k.block(0, 0, W, D, 0, 1, fh + 0.6, 3, fm(S), blank(S), blank(S));
    k.block(0, 0, W, D, fh + 0.6, floors - 1, fh, 3, fm(L), blank(L), fm(L));
    const t = top + 0.6;
    cornice(k, 0, 0, W, D, fh + 0.4, plain(TRIM), 0.15, 0.3);
    cornice(k, 0, 0, W, D, t - 0.4, plain(TRIM), 0.35, 0.45);
    for (const x of W > 14 ? [-W / 3, W / 3] : [0]) bay(k, x, zf, 3.2, fh + 0.6, floors - 1, fh, fm(L), blank(S));
    const roof = r() < 0.4 ? COPPER : pick(r, SLATE);
    k.frustum(0, 0, W, D, W - 2.4, D - 2.4, t, 3, roofM(roof[0]), plain(GRAVEL));
    for (let i = 0; i < Math.max(1, Math.round(W / 5)); i++) dormer(k, -W / 2 + (W / Math.max(1, Math.round(W / 5))) * (i + 0.5), zf - 0.2, t + 0.3, fm(L), roofM(roof[0]));
    for (const s of [-1, 1]) chimney(k, s * (W / 2 - 1.2), 0, t + 3.3, blank(L));
    roofName = 'mansard ' + roof[1]; extras.push('stacked bays', 'dormers');
    name = 'Edwardian mansion block';
  } else if (arch === 'balcony') {
    L = look(r, 'render', 'door', '#2d3338', pick(r, [RENDER[1], RENDER[3], RENDER[0]]));
    const lobby = facade('lobby', L.skin, L.wall[0], '#2d3338');
    k.block(0, 0, W, D, 0, 1, fh, 6, lobby, blank(L), blank(L));
    k.block(0, 0, W, D, fh, floors - 1, fh, 3, fm(L), fm(L, 'picture'), fm(L));
    const pattern = Math.floor(r() * 3);
    balconies(k, -W / 2, W / 2, zf, 1, floors, fh, 3, pattern, plain('#e0ded8'));
    flatRoof(k, 0, 0, W, D, top, blank(L), r);
    extras.push(['balconies', 'staggered balconies', 'continuous balconies'][pattern]);
    name = 'Modern apartments';
  } else if (arch === 'brutalist') {
    L = look(r, 'concrete', r() < 0.5 ? 'punched' : 'ribbon', '#2d3338');
    // ground floor tucked back behind columns
    k.block(0, -0.8, W - 2, D - 1.6, 0, 1, fh, 6, facade('lobby', L.skin, L.wall[0], '#2d3338'), blank(L), blank(L));
    for (let i = 0; i <= Math.round(W / 5); i++) k.box(-W / 2 + 0.4 + (i * (W - 0.8)) / Math.round(W / 5), 0, zf - 0.4, 0.6, fh, 0.6, blank(L));
    k.block(0, 0, W, D, fh, floors - 1, fh, 3, fm(L), fm(L), fm(L), plain(GRAVEL));
    parapet(k, 0, 0, W, D, top, 0.9, blank(L));
    k.box(W / 4, top, 0, 3.5, 2.8, 3.5, blank(L)); // lift overrun
    extras.push('pilotis');
    name = 'Brutalist block';
  } else if (arch === 'scandi') {
    L = look(r, 'timber', 'picture', '#2d3338');
    k.block(0, 0, W, D, 0, floors, fh, 4, fm(L), fm(L), fm(L));
    if (r() < 0.5) { k.gable(0, 0, W, D, top, D * 0.35, 0.4, plain(METAL[0]), fm(L)); roofName = METAL[1]; }
    else flatRoof(k, 0, 0, W, D, top, blank(L), r);
    balconies(k, -W / 2, W / 2, zf, 1, floors, fh, 4, 1, plain('#3a3a3a'));
    extras.push('staggered balconies');
    name = 'Scandinavian timber flats';
  } else if (arch === 'deco') {
    L = look(r, 'render', 'ribbon', pick(r, ['#2e5a45', '#2d3338']), pick(r, [RENDER[0], RENDER[1]]));
    k.block(0, 0, W, D, 0, floors - 1, fh, 3, fm(L), fm(L), fm(L));
    for (let f = 1; f < floors; f++) cornice(k, 0, 0, W, D, f * fh - 0.15, blank(L), 0.12, 0.2);
    // top floor set back behind a terrace
    k.block(0, -0.8, W - 3, D - 3.6, (floors - 1) * fh, 1, fh, 3, fm(L), fm(L), fm(L));
    flatRoof(k, 0, 0, W, D, (floors - 1) * fh, blank(L), r, false);
    flatRoof(k, 0, -0.8, W - 3, D - 3.6, top, blank(L), r, false);
    k.box(0, 0, zf + 0.1, 2.6, top + 2.5, 0.8, blank(L)); // stair tower
    extras.push('stepped top', 'stair tower');
    name = 'Art Deco flats';
  } else {
    L = look(r, 'brick', 'picture', '#2d3338', pick(r, [BRICK[3], BRICK[5], BRICK[6], BRICK[4]]));
    k.block(0, 0, W, D, 0, floors, fh, 4, fm(L), fm(L), fm(L));
    balconies(k, -W / 2, W / 2, zf, 1, floors, fh, 4, 1, plain('#3a3a3a'));
    flatRoof(k, 0, 0, W, D, top, blank(L), r);
    extras.push('balconies');
    name = 'Brick apartments';
  }
  return { name: `${name} · ${floors} storeys`, detail: [L.wall[1], WIN_NAME[L.win], roofName, ...extras].join(' · ') };
}

function office(k: Kit, l: Lot, r: () => number) {
  const W = l.w, D = Math.min(l.d, 18), extras: string[] = [];
  k.foot = { w: W, d: D };
  const arch = pick(r, ['glass', 'ribbon', 'warehouse', 'classical'] as const);
  let L: Look, name: string, floors: number;
  if (arch === 'glass') {
    L = look(r, 'glass', 'curtain', '#2d3338');
    const S = look(r, 'stone', 'lobby', '#2d3338');
    floors = Math.max(4, Math.round(l.h / 3.4));
    const fh = 3.4;
    k.block(0, 0, W + 1, D + 1, 0, 1, 4.5, 6, fm(S), fm(S), blank(S), plain('#8a8f94'));
    k.block(0, 0, W, D, 4.5, floors - 1, fh, 3, fm(L), fm(L), fm(L));
    flatRoof(k, 0, 0, W, D, 4.5 + (floors - 1) * fh, plain('#6a7076'), r);
    extras.push('stone podium');
    name = 'Glass office';
  } else if (arch === 'ribbon') {
    L = look(r, r() < 0.5 ? 'concrete' : 'stone', 'ribbon', '#2d3338');
    floors = Math.max(4, Math.round(l.h / 3.5));
    k.block(0, 0, W, D, 0, 1, 4, 6, facade('lobby', L.skin, L.wall[0], '#2d3338'), blank(L), blank(L));
    k.block(0, 0, W, D, 4, floors - 1, 3.5, 3, fm(L), fm(L), fm(L));
    flatRoof(k, 0, 0, W, D, 4 + (floors - 1) * 3.5, blank(L), r);
    name = '1960s office';
  } else if (arch === 'warehouse') {
    L = look(r, 'brick', 'warehouse', pick(r, ['#2e5a45', '#2d3338', '#6b2f2a']), pick(r, [BRICK[0], BRICK[2], BRICK[4]]));
    floors = Math.max(3, Math.min(7, Math.round(l.h / 3.6)));
    const fh = 3.6, top = floors * fh;
    k.block(0, 0, W, D, 0, floors, fh, 3.6, fm(L), fm(L), fm(L));
    cornice(k, 0, 0, W, D, top - 0.5, blank(L), 0.3, 0.5);
    flatRoof(k, 0, 0, W, D, top, blank(L), r, false);
    waterTank(k, W / 4, -D / 5, top);
    extras.push('rooftop water tank');
    name = 'Warehouse offices';
  } else {
    L = look(r, 'stone', 'grid', '#2d3338');
    floors = Math.max(4, Math.min(8, Math.round(l.h / 3.4)));
    const fh = 3.4;
    k.block(0, 0, W, D, 0, 1, 4.4, 4, facade('lobby', L.skin, L.wall[0], '#2d3338'), blank(L), blank(L));
    k.block(0, 0, W, D, 4.4, floors - 1, fh, 3, fm(L), fm(L), fm(L));
    cornice(k, 0, 0, W, D, 4.2, blank(L), 0.2, 0.35);
    cornice(k, 0, 0, W, D, 4.4 + (floors - 1) * fh - 0.5, plain(TRIM), 0.45, 0.55);
    flatRoof(k, 0, 0, W, D, 4.4 + (floors - 1) * fh, blank(L), r);
    name = 'Classical office';
  }
  return { name: `${name} · ${floors} storeys`, detail: [L.wall[1], WIN_NAME[L.win], ...extras].join(' · ') };
}

// ---------------- more towers: the same kit, put together differently ----------------
// Massing (how the volume is shaped) × skin (what it's clad in) × crown (how it meets the sky) ×
// extras (fins, sky gardens, a helipad) — each chosen separately, so no two skylines repeat.
type Massing = 'round' | 'twist' | 'stacked' | 'twin' | 'tapered' | 'cross';
const SKINS: { win: Win; skin: Skin; name: string; frame: string }[] = [
  { win: 'curtain', skin: 'glass', name: 'glass', frame: '#2d3338' },
  { win: 'ribbon', skin: 'concrete', name: 'concrete bands', frame: '#2d3338' },
  { win: 'grid', skin: 'stone', name: 'stone grid', frame: '#2d3338' },
  { win: 'picture', skin: 'brick', name: 'brick', frame: '#2d3338' },
  { win: 'door', skin: 'render', name: 'white balconied', frame: '#2d3338' },
  { win: 'ribbon', skin: 'metal', name: 'metal panels', frame: '#2d3338' },
];
function fins(k: Kit, W: number, D: number, y0: number, y1: number, m: THREE.Material) {
  // slim vertical fins down the front and back faces
  const n = Math.max(3, Math.round(W / 3));
  for (let i = 0; i <= n; i++) for (const z of [D / 2 + 0.25, -D / 2 - 0.25]) k.box(-W / 2 + (W * i) / n, y0, z, 0.25, y1 - y0, 0.5, m);
}
function crownOf(k: Kit, W: number, D: number, y: number, r: () => number, glassM: THREE.Material, extras: string[]) {
  const c = r();
  if (c < 0.2) { k.prismN(0, 0, 0.35, 6, y, 3, plain('#c3c8cc'), 16, plain('#d9dde0')); extras.push('mast'); }
  else if (c < 0.4) {
    // helipad: a painted disc on the roof
    k.cap(rect(0, 0, W - 1, D - 1), y + 0.05, plain('#5d6166'));
    k.prismN(0, 0, Math.min(W, D) * 0.35, 16, y + 0.06, 0.04, plain('#e0c14a'));
    k.box(-1.2, y + 0.1, 0, 0.5, 0.04, 3, plain('#f4f4f0')); k.box(1.2, y + 0.1, 0, 0.5, 0.04, 3, plain('#f4f4f0')); k.box(0, y + 0.1, 0, 2.4, 0.04, 0.5, plain('#f4f4f0'));
    extras.push('helipad');
  } else if (c < 0.6) { k.frustum(0, 0, W, D, W * 0.3, D * 0.3, y, Math.min(W, D) * 0.5, glassM, plain('#6a7076')); extras.push('glass pyramid'); }
  else if (c < 0.8) {
    // a roof garden behind a glass balustrade
    k.cap(rect(0, 0, W - 1, D - 1), y + 0.05, lawnM(1.04));
    for (let i = 0; i < 4; i++) tree(k, (r() - 0.5) * (W - 4), (r() - 0.5) * (D - 4), 0.6, r);
    k.walls(rect(0, 0, W - 0.2, D - 0.2), true, y, 1, 1.1, 0, railM());
    extras.push('roof garden');
  } else { for (let i = 0; i < 3; i++) k.box((r() - 0.5) * W * 0.5, y, (r() - 0.5) * D * 0.5, 2 + r() * 3, 1.5 + r() * 2, 2 + r() * 2, plain('#9aa0a4')); extras.push('plant room'); }
}
function modernTower(k: Kit, l: Lot, r: () => number, massing: Massing) {
  const W = l.w, D = Math.min(l.d, 18), extras: string[] = [];
  k.foot = { w: W, d: D };
  const S = pick(r, SKINS);
  const col = S.skin === 'glass' ? pick(r, GLASS) : pick(r, skinPalette(S.skin));
  const face = facade(S.win, S.skin, col[0], S.frame);
  const glassM = facade('curtain', 'glass', pick(r, GLASS)[0], '#2d3338');
  const fh = S.win === 'door' ? 3 : 3.5;
  const floors = Math.max(10, Math.round(l.h / fh));
  // a podium of shops or a glazed lobby, so the street level is lively
  const podF = r() < 0.5 ? 1 : 2, podH = 4.2;
  const pod = r() < 0.5 ? facade('shop', 'stone', '#ddd3bb', '#2d3338', pick(r, FASCIA)) : facade('lobby', 'stone', '#ddd3bb', '#2d3338');
  k.block(0, 0, W + 1.5, D + 1.5, 0, podF, podH, 4.5, pod, pod, blank(look(r, 'stone', 'none', '#2d3338', ['#ddd3bb', 'stone'])), plain('#8a8f94'));
  const base = podF * podH, top = base + (floors - podF) * fh;
  let y = top;
  if (massing === 'round') {
    const R = Math.min(W, D) / 2, n = 16, pts: XZ[] = [];
    for (let i = 0; i < n; i++) { const a = (-i / n) * Math.PI * 2; pts.push([Math.cos(a) * R, Math.sin(a) * R]); }
    k.walls(pts, true, base, floors - podF, fh, 2.5, face);
    k.cap(pts, top, plain('#6a7076'));
    extras.push('round');
  } else if (massing === 'twist') {
    // every floor turned a little further than the one below
    const turn = (0.8 + r() * 1.6) * (Math.PI / 180) * (r() < 0.5 ? 1 : -1);
    const s = Math.min(W, D) * 0.92;
    for (let f = 0; f < floors - podF; f++) k.at(0, 0, turn * f, () => k.block(0, 0, s, s, base + f * fh, 1, fh, 3, face, face, face, f === floors - podF - 1 ? plain('#6a7076') : undefined));
    extras.push(`twisting ${Math.round(Math.abs(turn) * (floors - podF) * 180 / Math.PI)}°`);
  } else if (massing === 'stacked') {
    // boxes of four floors, each slid across the one below
    let yy = base;
    for (let f = podF, i = 0; f < floors; f += 4, i++) {
      const n = Math.min(4, floors - f), dx = (i % 2 ? 1 : -1) * W * 0.12, dz = (i % 3 === 1 ? 1 : -1) * D * 0.1;
      k.block(dx, dz, W * 0.82, D * 0.82, yy, n, fh, 3, i % 2 ? face : glassM, face, face, plain('#6a7076'));
      yy += n * fh;
    }
    y = yy;
    extras.push('stacked boxes');
  } else if (massing === 'twin') {
    // two slim towers joined by a sky bridge
    const w2 = W * 0.42, h2 = Math.round((floors - podF) * (0.75 + r() * 0.2));
    k.block(-W * 0.29, 0, w2, D * 0.8, base, floors - podF, fh, 3, face, face, face, plain('#6a7076'));
    k.block(W * 0.29, 0, w2, D * 0.8, base, h2, fh, 3, face, face, face, plain('#6a7076'));
    const by = base + Math.round(h2 * 0.6) * fh;
    k.block(0, 0, W * 0.2, D * 0.4, by, 2, fh, 3, glassM, glassM, glassM, plain('#6a7076'));
    extras.push('twin towers', 'sky bridge');
  } else if (massing === 'tapered') {
    // narrowing as it rises
    let yy = base;
    const steps = Math.ceil((floors - podF) / 3);
    for (let i = 0; i < steps; i++) {
      const n = Math.min(3, floors - podF - i * 3), sc = 1 - (i / steps) * 0.45;
      k.block(0, 0, W * sc, D * sc, yy, n, fh, 3, face, face, face, i === steps - 1 ? plain('#6a7076') : undefined);
      yy += n * fh;
    }
    y = yy;
    extras.push('tapering');
  } else {
    // cross plan: two slabs through each other, with notches of balconies
    k.block(0, 0, W, D * 0.45, base, floors - podF, fh, 3, face, face, face, plain('#6a7076'));
    k.block(0, 0, W * 0.45, D, base, floors - podF - 2, fh, 3, face, face, face, plain('#6a7076'));
    extras.push('cross plan');
  }
  if (r() < 0.35 && massing !== 'round' && massing !== 'twist') { fins(k, W * 0.82, D * 0.82, base, y, plain(pick(r, ['#c9cdd0', '#2d3338', '#b0633e', '#e8e6e0']))); extras.push('vertical fins'); }
  if (massing !== 'twin') crownOf(k, massing === 'round' ? Math.min(W, D) * 0.7 : massing === 'tapered' ? W * 0.55 : W * 0.8, massing === 'tapered' ? D * 0.55 : D * 0.8, y, r, glassM, extras);
  const names: Record<Massing, string> = { round: 'Round tower', twist: 'Twisting tower', stacked: 'Stacked tower', twin: 'Twin towers', tapered: 'Tapering tower', cross: 'Cross-plan tower' };
  return { name: `${names[massing]} · ${floors} storeys`, detail: [S.name, ...extras].join(' · ') };
}

function tower(k: Kit, l: Lot, r: () => number) {
  const W = l.w, D = Math.min(l.d, 18), extras: string[] = [];
  k.foot = { w: W, d: D };
  const arch = pick(r, ['glass', 'resi', 'deco', 'round', 'twist', 'stacked', 'twin', 'tapered', 'cross', 'glass', 'round', 'stacked'] as const);
  if (arch !== 'glass' && arch !== 'resi' && arch !== 'deco') return modernTower(k, l, r, arch);
  const fh = arch === 'resi' ? 3 : 3.6;
  const floors = Math.max(8, Math.round(l.h / fh));
  let L: Look, name: string;
  if (arch === 'glass') {
    L = look(r, 'glass', 'curtain', '#2d3338');
    const pod = look(r, 'stone', 'lobby', '#2d3338');
    const podF = 2;
    k.block(0, 0, W, D, 0, podF, 4, 6, fm(pod), fm(pod), blank(pod), plain('#8a8f94'));
    // one to three tiers, each set back from the one below
    const tiers = 1 + Math.floor(r() * 3);
    let y = podF * 4, w = W - 1.5, d = D - 1.5, left = floors - podF;
    for (let t = 0; t < tiers; t++) {
      const f = t === tiers - 1 ? left : Math.round(left * (0.5 + r() * 0.2));
      if (f <= 0) break;
      k.block(0, 0, w, d, y, f, fh, 3, fm(L), fm(L), fm(L), plain('#6a7076'));
      y += f * fh; left -= f;
      w *= 0.78; d *= 0.78;
    }
    const crown = r();
    if (crown < 0.35) { k.prismN(0, 0, 0.5, 6, y, 2, plain('#c3c8cc'), 14, plain('#d9dde0')); extras.push('spire'); }
    else if (crown < 0.7) { k.frustum(0, 0, w / 0.78, d / 0.78, w * 0.5, d * 0.5, y, 5, fm(L), plain('#6a7076')); extras.push('angled crown'); }
    else { k.box(0, y, 0, w * 0.9, 3, d * 0.9, plain('#8a8f94')); extras.push('plant screen'); }
    if (tiers > 1) extras.push(plural(tiers, 'tier'));
    name = 'Glass tower';
  } else if (arch === 'resi') {
    L = look(r, r() < 0.5 ? 'render' : 'concrete', 'door', '#2d3338', r() < 0.5 ? pick(r, [RENDER[1], RENDER[3]]) : undefined);
    k.block(0, 0, W, D, 0, 1, 4, 6, facade('lobby', L.skin, L.wall[0], '#2d3338'), blank(L), blank(L));
    k.block(0, 0, W, D, 4, floors - 1, fh, 3, fm(L), fm(L, 'picture'), fm(L));
    const pattern = Math.floor(r() * 3);
    balconies(k, -W / 2, W / 2, D / 2, 1, floors, fh, 3, pattern, plain('#e0ded8'), 1);
    k.at(0, 0, Math.PI, () => balconies(k, -W / 2, W / 2, D / 2, 1, floors, fh, 3, pattern, plain('#e0ded8'), 1));
    flatRoof(k, 0, 0, W, D, 4 + (floors - 1) * fh, blank(L), r);
    extras.push('balconies front and back');
    name = 'Residential tower';
  } else {
    L = look(r, r() < 0.5 ? 'stone' : 'brick', 'grid', '#2d3338', r() < 0.5 ? pick(r, STONE) : BRICK[3]);
    let y = 0, w = W, d = D, left = floors;
    for (let t = 0; t < 3; t++) {
      const f = t === 2 ? left : Math.round(left * 0.55);
      k.block(0, 0, w, d, y, f, fh, 3, fm(L), fm(L), fm(L), plain(GRAVEL));
      y += f * fh; left -= f;
      cornice(k, 0, 0, w, d, y - 0.4, plain(TRIM), 0.2, 0.4);
      w *= 0.75; d *= 0.75;
    }
    k.frustum(0, 0, w / 0.75, d / 0.75, 0.2, 0.2, y, 9, roofM(COPPER[0]));
    k.prismN(0, 0, 0.25, 6, y + 9, 1, plain('#d9dde0'), 8);
    extras.push('stepped setbacks', 'copper spire');
    name = 'Art Deco tower';
  }
  return { name: `${name} · ${floors} storeys`, detail: [L.wall[1], WIN_NAME[L.win], ...extras].join(' · ') };
}

// ---------------- industry ----------------
const PAINT = '#f2f2ee';
const CONTAINERS = ['#b0463a', '#2f6f9e', '#d69a2d', '#3f7a4a', '#8a8f94', '#5a3f7a'];
const CAR_COLS = ['#c9302c', '#2f6fb8', '#f2f2f2', '#2b2b2b', '#8d8f93', '#e0a526', '#5a8f4a', '#6b2f4a', '#b8bcbf', '#f2f2f2'];

function lorry(k: Kit, x: number, z: number, col: string, cab = '#e8e6e0') {
  // cab faces +z (out towards the road)
  k.box(x, 0.3, z - 1.4, 2.3, 0.7, 11, plain('#26282c'));
  k.box(x, 1.0, z - 1.4, 2.5, 3.1, 11, plain(col));
  k.box(x, 0.3, z + 5.4, 2.5, 3, 2.4, plain(cab));
  k.box(x, 1.9, z + 6.61, 2.3, 0.9, 0.02, plain('#2b3640'));
}

function industry(k: Kit, l: Lot, r: () => number) {
  const W = l.w, D = l.d, zf = D / 2, extras: string[] = [];
  k.foot = { w: W, d: D };
  const arch = pick(r, ['shed', 'shed', 'factory', 'depot'] as const);
  let name: string, L: Look;
  if (arch === 'shed') {
    L = look(r, 'metal', 'none', '#2d3338');
    const H = Math.round(l.h);
    k.block(0, 0, W, D, 0, 1, H, 0, blank(L));
    k.box(0, H - 1.3, 0, W + 0.1, 1.3, D + 0.1, plain(pick(r, ['#3f4449', '#2f5d9e', '#b23a3a', '#e8e6e0', '#2e7d5b'])));
    k.gable(0, 0, W, D, H, 1.8, 0.3, plain('#9aa0a4'), blank(L));
    const ow = Math.min(10, W * 0.3);
    const n = Math.max(2, Math.floor((W - ow) / 5));
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + ow + ((W - ow) / n) * (i + 0.5);
      k.box(x, 0, zf + 0.05, 3.4, 4.3, 0.12, plain('#5d6166'));
      k.box(x, 0, zf + 0.6, 3.6, 1.2, 1.2, plain('#2e3034')); // dock leveller
    }
    k.box(ow / 2, 5, zf + 1.2, W - ow, 0.3, 2.4, plain('#8a8f94'));
    const ofm = facade('ribbon', 'render', '#f0efea', '#2d3338');
    k.block(-W / 2 + ow / 2, zf + 0.5, ow, 5, 0, 2, 3.2, 3, ofm, ofm, ofm, plain(GRAVEL));
    extras.push(plural(n, 'loading door'), 'two-storey office');
    name = 'Distribution warehouse';
  } else if (arch === 'factory') {
    L = look(r, 'brick', 'warehouse', pick(r, ['#2e5a45', '#2d3338']), pick(r, [BRICK[0], BRICK[2], BRICK[4]]));
    const H = 8;
    k.block(0, 0, W, D, 0, 2, 4, 3.6, fm(L), fm(L), fm(L));
    // north-light sawtooth roof
    const n = Math.max(2, Math.round(D / 6)), td = D / n, roof = roofM(pick(r, SLATE)[0]);
    const glass = facade('curtain', 'glass', GLASS[2][0], '#2d3338');
    for (let i = 0; i < n; i++) {
      const z0 = -D / 2 + i * td, z1 = z0 + td;
      k.g(roof).quad(k.T(W / 2, H, z0), k.T(-W / 2, H, z0), k.T(-W / 2, H + 3, z1), k.T(W / 2, H + 3, z1), 0, 0, W / 2, td / 2);
      k.g(glass).quad(k.T(-W / 2, H, z1), k.T(W / 2, H, z1), k.T(W / 2, H + 3, z1), k.T(-W / 2, H + 3, z1), 0, 0, W / 6, 0.5);
      const e = k.g(blank(L));
      e.tri(k.T(-W / 2, H, z0), k.T(-W / 2, H, z1), k.T(-W / 2, H + 3, z1), [0, 0], [td / 6, 0], [td / 6, 0.5]);
      e.tri(k.T(W / 2, H, z0), k.T(W / 2, H + 3, z1), k.T(W / 2, H, z1), [0, 0], [td / 6, 0.5], [td / 6, 0]);
    }
    const ch = 24 + r() * 12;
    k.prismN(W / 2 - 3, -D / 2 + 3, 1.3, 10, 0, ch, blank(L));
    k.prismN(W / 2 - 3, -D / 2 + 3, 1.45, 10, ch - 3, 0.8, plain(TRIM));
    extras.push('sawtooth roof', 'chimney stack');
    if (r() < 0.5) { k.prismN(-W / 2 + 3.5, -D / 2 + 3.5, 3, 12, H, 8, plain('#b8bcbf'), 1.6); extras.push('silo'); }
    name = pick(r, ['Brick works', 'Engineering works', 'Bakery', 'Print works']);
  } else {
    L = look(r, 'metal', 'none', '#2d3338');
    // open canopy over the front half, workshop behind
    k.block(0, -D / 4, W, D / 2, 0, 1, 7, 0, blank(L), blank(L), blank(L), plain('#9aa0a4'));
    k.box(0, 7, D / 4, W, 0.5, D / 2, plain('#c9cdd0'));
    for (let x = -W / 2 + 0.3; x <= W / 2; x += Math.max(6, W / 5)) k.box(x, 0, zf - 0.3, 0.4, 7, 0.4, plain('#3a3a3a'));
    for (let i = 0; i < Math.floor(W / 8); i++) if (r() < 0.7) lorry(k, -W / 2 + 4 + i * 8, D / 4 - 3, pick(r, CONTAINERS));
    extras.push('lorry canopy');
    name = 'Haulage depot';
  }
  return { name, detail: [L.wall[1], ...extras].join(' · ') };
}

// ---------------- plots: gardens, drives, car parks, plazas, yards ----------------
const LEAVES = ['#4f8a36', '#5b9440', '#3e7a35', '#6c9a3a', '#4a8a4a', '#b0782f'];
const gmat = (key: string, draw: (x: CanvasRenderingContext2D, r: () => number) => void) => M(`g|${key}`, () => new THREE.MeshLambertMaterial({ map: tex(`g|${key}`, 64, 64, draw) }));
const lawnM = (f: number) => gmat(`lawn${f}`, (x, r) => {
  for (let i = 0; i < 4; i++) { x.fillStyle = shade('#6aa046', f * (i % 2 ? 1.07 : 0.95)); x.fillRect(0, i * 16, 64, 16); }
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '40,70,20' : '200,230,150'},0.18)`; x.fillRect(r() * 64, r() * 64, 1, 1.5); }
});
// every lawn and meadow the plots and the landscaping lay (the game gives them the ground's look)
export const grassMats = () => [meadowM(), ...[0.94, 0.96, 1, 1.03, 1.04, 1.06].map(lawnM)] as THREE.MeshLambertMaterial[];
const slabsM = () => gmat('slabs', (x, r) => {
  x.fillStyle = '#b3aea4'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.fillStyle = shade('#cfcac0', 0.95 + r() * 0.1); x.fillRect(i * 16 + 0.6, j * 16 + 0.6, 14.8, 14.8); }
});
const blockM = () => gmat('block', (x, r) => {
  x.fillStyle = '#6e4a3c'; x.fillRect(0, 0, 64, 64);
  for (let j = 0; j < 16; j++) for (let i = 0; i < 8; i++) { x.fillStyle = shade('#a8664f', 0.85 + r() * 0.3); x.fillRect(i * 8 + (j % 2) * 4 + 0.4, j * 4 + 0.4, 7.2, 3.2); }
});
const tarmacM = () => gmat('tarmac', (x, r) => { x.fillStyle = '#4c4f54'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(255,255,255,${r() * 0.07})`; x.fillRect(r() * 64, r() * 64, 1, 1); } });
const gravelM = () => gmat('gravel', (x, r) => { x.fillStyle = '#c9bc9c'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 700; i++) { x.fillStyle = shade('#c9bc9c', 0.75 + r() * 0.45); x.fillRect(r() * 64, r() * 64, 1.4, 1.4); } });
const tilesM = () => gmat('tiles', (x) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#e9e4d8' : '#7a3b30'; x.fillRect(i * 8, j * 8, 8, 8); } });
const concreteM = () => gmat('concrete', (x, r) => {
  x.fillStyle = '#b4b1a9'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(0,0,0,${r() * 0.06})`; x.fillRect(r() * 64, r() * 64, 2 + r() * 4, 1 + r() * 3); }
  x.fillStyle = '#8f8c85'; x.fillRect(0, 0, 64, 0.8); x.fillRect(0, 0, 0.8, 64);
});
const plazaM = () => gmat('plaza', (x, r) => {
  x.fillStyle = '#b9b1a2'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.fillStyle = shade('#ddd5c6', 0.96 + r() * 0.08); x.fillRect(i * 32 + 0.6, j * 32 + 0.6, 30.8, 30.8); }
  x.fillStyle = '#a79d8c'; x.fillRect(0, 30, 64, 4);
});
const bedM = () => gmat('bed', (x, r) => {
  x.fillStyle = '#5e4632'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 140; i++) { x.fillStyle = pick(r, ['#d94f6a', '#f2d04a', '#f4f0ea', '#9b59c9', '#e5873a', '#4f8a36', '#4f8a36']); x.fillRect(r() * 64, r() * 64, 2.5, 2.5); }
});
const hedgeM = () => plain('#3f6e34');

const rectXZ = (x0: number, z0: number, x1: number, z1: number): XZ[] => {
  const a = Math.min(x0, x1), b = Math.max(x0, x1), c = Math.min(z0, z1), d = Math.max(z0, z1);
  return [[a, d], [b, d], [b, c], [a, c]];
};
function flat(k: Kit, x0: number, z0: number, x1: number, z1: number, y: number, m: THREE.Material) {
  if (Math.abs(x1 - x0) < 0.05 || Math.abs(z1 - z0) < 0.05) return;
  k.cap(rectXZ(x0, z0, x1, z1), y, m);
}
// a run along x from x0 to x1, leaving gaps (gates, paths, drives)
function run(x0: number, x1: number, gaps: [number, number][], draw: (a: number, b: number) => void) {
  let a = x0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > a + 0.2) draw(a, Math.min(g0, x1));
    a = Math.max(a, g1);
  }
  if (x1 > a + 0.2) draw(a, x1);
}
function sphere(k: Kit, x: number, y: number, z: number, rad: number, m: THREE.Material, seg = 7, rings = 4, squash = 1) {
  const g = k.g(m);
  const P = (i: number, j: number) => {
    const th = (i / seg) * Math.PI * 2, ph = (j / rings) * Math.PI;
    return k.T(x + Math.sin(ph) * Math.cos(th) * rad, y + Math.cos(ph) * rad * squash, z + Math.sin(ph) * Math.sin(th) * rad);
  };
  for (let i = 0; i < seg; i++) for (let j = 0; j < rings; j++) g.quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
}
function tree(k: Kit, x: number, z: number, s: number, r: () => number) {
  k.prismN(x, z, 0.16 * s, 5, 0, 2.6 * s, plain('#6b4a2f'));
  const leaf = plain(pick(r, LEAVES));
  sphere(k, x, 3.8 * s, z, 1.9 * s, leaf);
  if (r() < 0.6) sphere(k, x + 0.7 * s, 4.5 * s, z - 0.4 * s, 1.25 * s, leaf, 6, 3);
}
function car(k: Kit, x: number, z: number, alongZ: boolean, col: string) {
  const [w, d] = alongZ ? [1.8, 4.3] : [4.3, 1.8], [cw, cd] = alongZ ? [1.6, 2.2] : [2.2, 1.6];
  k.box(x, 0.1, z, w * 0.9, 0.32, d * 0.9, plain('#1c1d20'));
  k.box(x, 0.38, z, w, 0.72, d, plain(col));
  k.box(x, 1.1, z, cw, 0.6, cd, plain('#2b3640'));
}
function bench(k: Kit, x: number, z: number, alongX: boolean) {
  const [w, d] = alongX ? [1.8, 0.55] : [0.55, 1.8];
  k.box(x, 0, z, alongX ? w * 0.8 : 0.3, 0.42, alongX ? 0.3 : d * 0.8, plain('#3a3a3a'));
  k.box(x, 0.42, z, w, 0.08, d, plain('#8a6446'));
}
function parasol(k: Kit, x: number, z: number, col: string) {
  k.prismN(x, z, 0.45, 8, 0, 0.75, plain('#e8e6e0'));
  k.prismN(x, z, 0.05, 4, 0.75, 1.5, plain('#3a3a3a'));
  k.prismN(x, z, 1.4, 8, 2.2, 0.05, plain(col), 0.5, plain(col));
  for (const s of [-1, 1]) k.box(x + s * 0.8, 0, z, 0.4, 0.45, 0.4, plain('#3a3a3a'));
}
function shed(k: Kit, x: number, z: number, r: () => number) {
  k.box(x, 0, z, 2.4, 2.1, 2, plain(pick(r, ['#7a5a3e', '#5f7f5a', '#8a6446', '#6f8fae'])));
  k.box(x, 2.1, z, 2.7, 0.12, 2.3, plain('#2e3034'));
}
function fountain(k: Kit, x: number, z: number) {
  k.prismN(x, z, 3.3, 16, 0, 0.5, plain('#c9c2b4'));
  k.prismN(x, z, 3.0, 16, 0.5, 0.02, plain('#4f93c4'));
  k.prismN(x, z, 0.35, 8, 0.5, 1.3, plain('#c9c2b4'));
  sphere(k, x, 2.3, z, 0.55, plain('#dcecf5'), 6, 3, 1.3);
}
function parkingRow(k: Kit, x0: number, x1: number, zBack: number, r: () => number, fill = 0.7) {
  const n = Math.floor((x1 - x0) / 2.6);
  for (let i = 0; i <= n; i++) flat(k, x0 + i * 2.6 - 0.06, zBack, x0 + i * 2.6 + 0.06, zBack + 5, 0.1, plain(PAINT));
  for (let i = 0; i < n; i++) if (r() < fill) car(k, x0 + i * 2.6 + 1.3, zBack + 2.6, true, pick(r, CAR_COLS));
  return n;
}

// Landscapes the plot around the building. Returns notes for the building card.
function yard(k: Kit, l: Lot, r: () => number, rr: () => number): string[] {
  const { w: W, d: D } = k.foot;
  const F = l.d / 2 + l.front, Bk = -l.d / 2 - l.back, X0 = l.px - l.pw / 2, X1 = l.px + l.pw / 2;
  const bf = D / 2, bb = -D / 2, door = k.doorX ?? 0;
  const out: string[] = [];
  const freeR = X1 - W / 2, freeL = -W / 2 - X0;
  if (l.kind === 'house') {
    flat(k, X0, Bk, X1, F, 0.04, lawnM(pick(rr, [0.94, 1, 1.06])));
    const driveMat = pick(rr, [tarmacM(), gravelM(), blockM()]);
    let drive: [number, number] | null = null;
    if (Math.max(freeR, freeL) >= 2.8) {
      const right = freeR >= freeL;
      drive = right ? [W / 2 + 0.3, X1 - 0.3] : [X0 + 0.3, -W / 2 - 0.3];
      flat(k, drive[0], bb + 1, drive[1], F, 0.07, driveMat);
      if (r() < 0.75) car(k, (drive[0] + drive[1]) / 2, F - 3.3, true, pick(r, CAR_COLS));
      out.push('driveway');
    } else if (l.front > 5) {
      const px = door > 0 ? -W / 4 : W / 4;
      drive = [px - 1.7, px + 1.7];
      flat(k, drive[0], bf + 0.3, drive[1], F, 0.07, driveMat);
      if (r() < 0.75) car(k, px, (bf + F) / 2, true, pick(r, CAR_COLS));
      out.push('parking pad');
    }
    flat(k, door - 0.6, bf, door + 0.6, F, 0.075, slabsM());
    const edge = pick(rr, ['hedge', 'wall', 'picket', 'open', 'hedge'] as const);
    const gaps: [number, number][] = [[door - 0.9, door + 0.9]];
    if (drive) gaps.push(drive);
    const zE = F - 0.35;
    const wallM = plain(pick(rr, ['#9a4b35', '#b8a08c', '#e8e2d4']));
    if (edge !== 'open') run(X0, X1, gaps, (a, b) => {
      if (edge === 'hedge') k.box((a + b) / 2, 0, zE, b - a, 0.9, 0.7, hedgeM());
      else if (edge === 'wall') k.box((a + b) / 2, 0, zE, b - a, 0.7, 0.3, wallM);
      else { for (const y of [0.35, 0.75]) k.box((a + b) / 2, y, zE, b - a, 0.07, 0.05, plain('#f4f4f0')); for (let x = a + 0.1; x < b; x += 0.7) k.box(x, 0, zE, 0.08, 0.95, 0.06, plain('#f4f4f0')); }
    });
    out.push({ hedge: 'front hedge', wall: 'garden wall', picket: 'picket fence', open: 'open-plan front' }[edge]);
    if (r() < 0.5) { run(X0 + 0.4, X1 - 0.4, gaps, (a, b) => flat(k, a, zE - 1.5, b, zE - 0.5, 0.075, bedM())); out.push('flower beds'); }
    if (l.front > 6.5 && r() < 0.4) tree(k, door > 0 ? -W / 3 : W / 3, (bf + F) / 2, 0.7, r);
    if (l.back > 2) {
      const fence = plain(pick(rr, ['#8a6446', '#6e5238', '#a07a52']));
      k.box((X0 + X1) / 2, 0, Bk + 0.05, X1 - X0, 1.8, 0.1, fence);
      for (const x of [X0 + 0.05, X1 - 0.05]) k.box(x, 0, (bb + Bk) / 2, 0.1, 1.8, bb - Bk, fence);
      if (l.back > 4) flat(k, -W / 2, bb - 3, W / 2, bb, 0.075, r() < 0.5 ? slabsM() : blockM());
      if (l.back > 7 && r() < 0.6) { shed(k, X0 + 1.6, Bk + 1.5, r); out.push('shed'); }
      if (l.back > 6 && r() < 0.75) tree(k, X1 - 2.5, Bk + 3, 0.8 + r() * 0.4, r);
      if (l.back > 9 && r() < 0.15) { k.prismN((X0 + X1) / 2, Bk + 5, 1.7, 12, 0.7, 0.08, plain('#1e2226')); out.push('trampoline'); }
      out.push(`${Math.round(l.back)} m back garden`);
    }
  } else if (l.kind === 'terrace') {
    flat(k, X0, bf, X1, F, 0.05, pick(rr, [slabsM(), gravelM(), tilesM()]));
    const wallM = plain(pick(rr, ['#9a4b35', '#b8a08c', '#e8e2d4'])), rails = rr() < 0.5;
    run(X0, X1, [[door - 0.6, door + 0.6]], (a, b) => {
      k.box((a + b) / 2, 0, F - 0.2, b - a, 0.6, 0.3, wallM);
      if (rails) k.box((a + b) / 2, 0.6, F - 0.2, b - a, 0.5, 0.04, plain('#1f2226'));
    });
    if (r() < 0.6) { const bx = door > 0 ? X0 + 0.7 : X1 - 1.5; for (const i of [0, 1]) k.box(bx + i * 0.8, 0, F - 1, 0.6, 1.05, 0.7, plain(pick(r, ['#2f5d3a', '#222222', '#2f5d9e', '#6b4b2a']))); out.push('wheelie bins'); }
    out.push(rails ? 'front wall and railings' : 'front wall');
    if (l.back > 1.5) {
      flat(k, X0, Bk, X1, bb, 0.05, r() < 0.6 ? lawnM(1) : slabsM());
      const yw = plain('#8a4a36');
      for (const x of [X0 + 0.1, X1 - 0.1]) k.box(x, 0, (bb + Bk) / 2, 0.2, 1.8, bb - Bk, yw);
      k.box((X0 + X1) / 2, 0, Bk + 0.1, X1 - X0, 1.8, 0.2, yw);
      if (l.back > 5 && r() < 0.35) tree(k, (X0 + X1) / 2, Bk + 2, 0.6, r);
      out.push('back yard');
    }
  } else if (l.kind === 'shop') {
    flat(k, X0, bf, X1, F, 0.05, slabsM());
    if (l.front >= 3 && r() < 0.55) {
      const n = Math.max(1, Math.floor(W / 4.5)), col = pick(r, FASCIA);
      for (let i = 0; i < n; i++) parasol(k, -W / 2 + (W / n) * (i + 0.5), bf + 2, col);
      out.push('café tables');
    }
    if (l.back > 2) {
      flat(k, X0, Bk, X1, bb, 0.05, tarmacM());
      for (const i of [0, 1]) k.box(X0 + 1.5 + i * 2, 0, Bk + 1.2, 1.6, 1.3, 1.1, plain('#3d5a3a'));
      if (l.back > 6 && r() < 0.4) k.box(X1 - 3, 0.3, (bb + Bk) / 2, 2, 2.2, 5, plain('#f2f2f2'));
      out.push('service yard');
    }
  } else if (l.kind === 'flats' || l.kind === 'office') {
    const office = l.kind === 'office';
    flat(k, X0, Bk, X1, F, 0.04, lawnM(1));
    if (office) flat(k, X0, bf, X1, F, 0.05, plazaM());
    else flat(k, -1.2, bf, 1.2, F, 0.075, slabsM());
    // side drive to parking behind
    const gaps: [number, number][] = [[-1.6, 1.6]];
    let spaces = 0;
    if (l.back >= 10) {
      flat(k, X0 + 0.4, Bk + 0.4, X1 - 0.4, bb - 0.8, 0.06, tarmacM());
      spaces = parkingRow(k, X0 + 0.6, X1 - 0.6, Bk + 0.5, r, office ? 0.85 : 0.65);
      if (Math.max(freeR, freeL) >= 3.2) {
        const d: [number, number] = freeR >= freeL ? [W / 2 + 0.2, X1 - 0.2] : [X0 + 0.2, -W / 2 - 0.2];
        flat(k, d[0], bb - 0.8, d[1], F, 0.06, tarmacM());
        gaps.push(d);
      }
      out.push(`car park (${spaces} spaces)`);
    }
    if (office) {
      const n = Math.max(1, Math.floor((X1 - X0) / 7));
      for (let i = 0; i < n; i++) {
        const x = X0 + ((X1 - X0) * (i + 0.5)) / n;
        if (Math.abs(x) < 2.5 || gaps.some(([a, b]) => x > a - 1 && x < b + 1)) continue;
        k.box(x, 0, F - 2.2, 1.8, 0.6, 1.8, plain('#b9b3a8'));
        tree(k, x, F - 2.2, 0.8, r);
        bench(k, x + 2, F - 2.2, true);
      }
      if (r() < 0.35) { for (let i = 0; i < 3; i++) { k.prismN(X0 + 1.5 + i * 1.6, F - 1, 0.06, 5, 0, 9, plain('#d9dde0')); k.box(X0 + 2.2 + i * 1.6, 7.6, F - 1, 1.4, 0.9, 0.03, plain(pick(r, FASCIA))); } out.push('flagpoles'); }
      out.push('plaza with planters');
    } else {
      run(X0, X1, gaps, (a, b) => k.box((a + b) / 2, 0, F - 0.4, b - a, 0.8, 0.7, hedgeM()));
      if (l.front >= 5) for (const s of [-1, 1]) { tree(k, s * W / 3, (bf + F) / 2 + 0.5, 0.9, r); bench(k, s * 2.4, (bf + F) / 2, false); }
      if (!spaces) k.box(X0 + 2, 0, bb - 2, 3, 1.6, 1.5, plain('#7a5a3e'));
      out.push('communal garden');
    }
  } else if (l.kind === 'tower') {
    flat(k, X0, Bk, X1, F, 0.05, plazaM());
    if (l.front >= 7) { fountain(k, 0, (bf + F) / 2 + 0.3); out.push('fountain'); }
    for (const x of [X0 + 1.6, X1 - 1.6]) if (Math.abs(x) > W / 2 + 1.5) for (let z = bb + 2; z < F - 1.5; z += 6) tree(k, x, z, 0.8, r);
    if (l.back > 3) { flat(k, X1 - 4.5, Bk + 0.5, X1 - 0.8, bb - 0.5, 0.07, plain('#2a2c30')); out.push('car park ramp'); }
    out.push('plaza');
  } else if (l.kind === 'industry') {
    flat(k, X0, Bk, X1, F, 0.05, concreteM());
    // lorry bays in front of the loading doors
    if (l.front >= 12) {
      const n = Math.floor(W / 4.5);
      for (let i = 0; i <= n; i++) flat(k, -W / 2 + i * 4.5 - 0.07, bf + 0.8, -W / 2 + i * 4.5 + 0.07, Math.min(F - 1.5, bf + 14), 0.1, plain('#e0c14a'));
      for (let i = 0; i < n; i++) if (r() < 0.45) lorry(k, -W / 2 + 2.25 + i * 4.5, bf + 7.2, pick(r, CONTAINERS));
      out.push('lorry yard');
    }
    if (l.back > 5) {
      const m = Math.floor((X1 - X0 - 2) / 6.6);
      for (let i = 0; i < m; i++) { const lv = r() < 0.5 ? 2 : 1; for (let j = 0; j < lv; j++) k.box(X0 + 4.2 + i * 6.6, j * 2.6, Bk + 1.8, 6.1, 2.55, 2.44, plain(pick(r, CONTAINERS))); }
      if (m) out.push('container stacks');
    }
    if (freeR > 4) parkingRow(k, W / 2 + 0.5, X1 - 0.5, bb, r, 0.6);
    // security fence round the plot, gate onto the road
    const post = plain('#6b7176'), mesh = M('fence', () => new THREE.MeshLambertMaterial({ color: '#9aa3a8', transparent: true, opacity: 0.4, depthWrite: false }));
    const side = (x0: number, z0: number, x1: number, z1: number) => { k.box((x0 + x1) / 2, 0, (z0 + z1) / 2, Math.abs(x1 - x0) || 0.04, 2.2, Math.abs(z1 - z0) || 0.04, mesh); k.box((x0 + x1) / 2, 2.2, (z0 + z1) / 2, Math.abs(x1 - x0) || 0.08, 0.08, Math.abs(z1 - z0) || 0.08, post); };
    run(X0, X1, [[-6, 6]], (a, b) => side(a, F - 0.3, b, F - 0.3));
    side(X0 + 0.1, F - 0.3, X0 + 0.1, Bk + 0.1); side(X1 - 0.1, F - 0.3, X1 - 0.1, Bk + 0.1); side(X0 + 0.1, Bk + 0.1, X1 - 0.1, Bk + 0.1);
    out.push('security fence');
  }
  return out;
}

// ---------------- community buildings (fill awkward corners and odd plots) ----------------
export const CIVIC: Record<string, { w: number; d: number; front: number; back: number; label: string; pop: number; unit: string }> = {
  church: { w: 22, d: 12, front: 8, back: 12, label: 'Church', pop: 4, unit: 'jobs' },
  pub: { w: 14, d: 11, front: 5, back: 12, label: 'Pub', pop: 12, unit: 'jobs' },
  petrol: { w: 12, d: 8, front: 18, back: 4, label: 'Filling station', pop: 8, unit: 'jobs' },
  school: { w: 34, d: 14, front: 10, back: 24, label: 'Primary school', pop: 40, unit: 'jobs' },
  surgery: { w: 16, d: 11, front: 8, back: 8, label: 'Doctors’ surgery', pop: 15, unit: 'jobs' },
  hall: { w: 15, d: 10, front: 6, back: 6, label: 'Community hall', pop: 3, unit: 'jobs' },
  cornershop: { w: 9, d: 9, front: 3, back: 5, label: 'Corner shop', pop: 4, unit: 'jobs' },
  substation: { w: 6, d: 5, front: 2.5, back: 2.5, label: 'Electricity substation', pop: 0, unit: 'jobs' },
  station: { w: 22, d: 10, front: 7, back: 0.5, label: 'Railway station', pop: 12, unit: 'jobs' }, // (only rail/draw.ts builds these, beside their platforms)
  'station-modern': { w: 24, d: 11, front: 7, back: 0.5, label: 'Railway station', pop: 14, unit: 'jobs' },
};
const SAINTS = ['St Mary’s', 'St John’s', 'All Saints', 'St Peter’s', 'Holy Trinity', 'St Michael’s', 'St Andrew’s'];
const PUBS = ['The Red Lion', 'The Crown', 'The Railway', 'The Royal Oak', 'The Plough', 'The White Hart', 'The Bell', 'The Swan'];

function civic(k: Kit, l: Lot, r: () => number) {
  const spec = CIVIC[l.arch ?? 'hall'];
  // (a real map's cathedral or minster: a church on a lot far bigger than a parish church's is drawn
  // at the lot's size, taller to match; every other civic building keeps its own size)
  const big = l.arch === 'church' && l.w > spec.w * 1.6 && l.d > spec.d * 1.6, g = big ? Math.min(2.6, Math.sqrt(l.w / spec.w)) : 1;
  const W = big ? l.w : spec.w, D = big ? l.d : spec.d, zf = D / 2, F = D / 2 + l.front, Bk = -D / 2 - l.back, X0 = -l.pw / 2, X1 = l.pw / 2;
  k.foot = { w: W, d: D };
  const out: string[] = [];
  let name = spec.label;
  switch (l.arch) {
    case 'church': {
      const S = look(r, 'stone', 'arched', '#2d3338', pick(r, STONE));
      flat(k, X0, Bk, X1, F, 0.04, lawnM(0.96));
      k.block(0, 0, W - 6 * g, D - 2 * g, 0, 1, 7 * g, 3.4, fm(S), fm(S), fm(S));
      k.gable(0, 0, W - 6 * g, D - 2 * g, 7 * g, 5.5 * g, 0.3, roofM(pick(r, SLATE)[0]), fm(S, 'none'));
      // tower and spire at the west end
      k.block(W / 2 - 3 * g, 0, 6 * g, 6 * g, 0, 3, 5 * g, 6, fm(S, 'none'), fm(S, 'none'), fm(S, 'none'), plain(GRAVEL));
      if (r() < 0.6) { k.prismN(W / 2 - 3 * g, 0, 3.1 * g, 8 * g, 15 * g, 0.1, plain('#bdb6a6'), 13, roofM(SLATE[0][0])); out.push('spire'); }
      else { parapet(k, W / 2 - 3 * g, 0, 6.4 * g, 6.4 * g, 15 * g, 1.2, fm(S, 'none')); out.push('square tower'); }
      flat(k, W / 2 - 3.8, zf, W / 2 - 2.2, F, 0.075, gravelM());
      // churchyard
      for (let x = X0 + 2; x < X1 - 1; x += 2.2) for (const z of [Bk + 2, Bk + 4.5, Bk + 7]) if (r() < 0.75) k.box(x, 0, z, 0.7, 0.8 + r() * 0.4, 0.18, plain(pick(r, ['#8f8a80', '#a8a296', '#6f6b64'])));
      for (const x of [X0 + 2, X1 - 2]) tree(k, x, F - 3, 1.1, () => 0.2);
      k.box((X0 + X1) / 2, 0, F - 0.3, X1 - X0, 0.9, 0.5, fm(S, 'none'));
      name = `${pick(r, SAINTS)} church`;
      out.push('churchyard');
      break;
    }
    case 'pub': {
      const L = look(r, r() < 0.5 ? 'brick' : 'render', 'sash', '#2d3338', r() < 0.5 ? undefined : pick(r, [...RENDER, PASTEL[3]]));
      flat(k, X0, zf, X1, F, 0.05, slabsM());
      k.block(0, 0, W, D, 0, 1, 3.6, 3, facade('shop', L.skin, L.wall[0], '#2d3338', pick(r, ['#2e5a45', '#7a2d2d', '#1f3f6a', '#3a3a3a'])), blank(L), fm(L));
      k.block(0, 0, W, D, 3.6, 1, 3, 3, fm(L), blank(L), fm(L));
      k.gable(0, 0, W, D, 6.6, 3.4, 0.3, roofM(pick(r, [...SLATE, ...TILE])[0]), blank(L));
      chimney(k, -W / 2 + 0.6, 0, 9.8, blank(L));
      // hanging sign
      k.box(W / 2 - 1, 3.6, zf + 0.6, 0.1, 0.1, 1.2, plain('#2b2b2b'));
      k.box(W / 2 - 1, 2.4, zf + 1.1, 0.08, 1.1, 0.8, plain(pick(r, FASCIA)));
      // beer garden
      flat(k, X0, Bk, X1, -zf, 0.04, lawnM(1));
      for (let i = 0; i < 4; i++) { const x = X0 + 2 + ((X1 - X0 - 4) * i) / 3, z = Bk + 3 + (i % 2) * 4; k.box(x, 0.7, z, 1.8, 0.08, 0.8, plain('#8a6446')); for (const s of [-0.7, 0.7]) k.box(x, 0.42, z + s, 1.8, 0.06, 0.3, plain('#8a6446')); if (i % 2) parasol(k, x, z, pick(r, FASCIA)); }
      k.box((X0 + X1) / 2, 0, Bk + 0.1, X1 - X0, 1.6, 0.12, plain('#6e5238'));
      name = pick(r, PUBS);
      out.push(L.wall[1], 'beer garden');
      break;
    }
    case 'petrol': {
      flat(k, X0, Bk, X1, F, 0.05, concreteM());
      const brand = pick(r, ['#1f7a3a', '#c9302c', '#1f4f9e', '#e0a526']);
      const kz = zf + l.front / 2;
      // canopy over the pumps
      for (const [x, z] of [[-5, kz - 3], [5, kz - 3], [-5, kz + 3], [5, kz + 3]]) k.box(x, 0, z, 0.4, 5, 0.4, plain('#e8e6e0'));
      k.box(0, 5, kz, 14, 0.9, 9, plain('#f2f2ee'));
      k.box(0, 5.3, kz, 14.1, 0.35, 9.1, plain(brand));
      for (const x of [-3.5, 3.5]) { k.box(x, 0, kz, 1.2, 0.2, 5, plain('#b9b3a8')); for (const z of [kz - 1.4, kz + 1.4]) k.box(x, 0.2, z, 0.8, 1.6, 0.5, plain('#dcdcd8')); }
      const g = facade('lobby', 'render', '#f0efea', '#2d3338');
      k.block(0, 0, W, D, 0, 1, 3.6, 4, g, blank(look(r, 'render', 'none', '#2d3338', ['#f0efea', 'white'])), blank(look(r, 'render', 'none', '#2d3338', ['#f0efea', 'white'])), plain(GRAVEL));
      k.box(0, 3.2, zf + 0.05, W, 0.4, 0.12, plain(brand));
      k.box(X1 - 1.5, 0, F - 1.5, 0.3, 5, 1.6, plain(brand));
      out.push('forecourt with 4 pumps', 'shop');
      break;
    }
    case 'school': {
      const L = look(r, 'brick', 'ribbon', '#2d3338', pick(r, [BRICK[3], BRICK[5], BRICK[0]]));
      flat(k, X0, zf, X1, F, 0.05, tarmacM());
      k.block(0, 0, W, D, 0, 2, 3.4, 3, fm(L), fm(L), fm(L));
      flatRoof(k, 0, 0, W, D, 6.8, blank(L), r, false);
      k.box(-W / 4, 0, zf + 0.4, 5, 3.2, 0.8, facade('lobby', 'render', '#f0efea', '#2d3338'));
      // playground markings and a playing field behind
      flat(k, X0, -zf - 8, X1, -zf, 0.05, tarmacM());
      for (let i = 0; i < 6; i++) flat(k, X0 + 3 + i * 2.5, -zf - 5, X0 + 4.5 + i * 2.5, -zf - 3.5, 0.08, plain(pick(r, ['#e0c14a', '#d94f6a', '#4f93c4', '#f2f2ee'])));
      flat(k, X0, Bk, X1, -zf - 8, 0.04, lawnM(1.06));
      const fz = (Bk - zf - 8) / 2;
      for (const s of [-1, 1]) { k.box(s * (X1 - 4), 0, fz, 0.1, 2.2, 5, plain('#f4f4f0')); }
      k.box(0, 0, fz, 0.1, 0.02, (-zf - 8 - Bk) - 2, plain('#f4f4f0'));
      run(X0, X1, [[-4, 4]], (a, b) => k.box((a + b) / 2, 0, F - 0.3, b - a, 1.8, 0.05, plain('#2e5a45')));
      out.push('playground', 'playing field');
      break;
    }
    case 'substation': {
      flat(k, X0, Bk, X1, F, 0.05, gravelM());
      for (const x of [-1.5, 1.5]) { k.box(x, 0, 0, 2.2, 2.4, 2, plain('#7c8a6a')); for (const z of [-0.6, 0.6]) k.prismN(x, z, 0.15, 6, 2.4, 1.2, plain('#c9c2b4')); }
      const mesh = M('fence', () => new THREE.MeshLambertMaterial({ color: '#9aa3a8', transparent: true, opacity: 0.4, depthWrite: false }));
      for (const [x0, z0, x1, z1] of [[X0, F - 0.2, X1, F - 0.2], [X0, Bk, X1, Bk], [X0, Bk, X0, F], [X1, Bk, X1, F]]) k.box((x0 + x1) / 2, 0, (z0 + z1) / 2, Math.abs(x1 - x0) || 0.04, 2.2, Math.abs(z1 - z0) || 0.04, mesh);
      out.push('transformers behind a fence');
      break;
    }
    case 'station': {
      // a brick booking hall, its forecourt in front and a canopy on posts over the platform behind
      const L = look(r, 'brick', 'sash', '#2d3338');
      flat(k, X0, zf, X1, F, 0.05, slabsM());
      k.block(0, 0, W, D, 0, 1, 4.4, 3.2, facade('shop', L.skin, L.wall[0], '#2d3338', '#1f5e3f'), fm(L), fm(L));
      k.gable(0, 0, W, D, 4.4, 3.2, 0.35, roofM(pick(r, SLATE)[0]), blank(L));
      chimney(k, -W / 2 + 1.2, 0, 8.4, blank(L));
      // (the canopy only where there's a platform behind it: `back` is how far out it reaches)
      const green = plain('#1f5e3f'), cream = plain('#efe3c2'), cd = Math.min(3.6, l.back), cz = -D / 2 - cd / 2 - 0.1;
      if (cd >= 2) {
        k.box(0, 3.5, cz, W - 1, 0.25, cd, green);
        k.box(0, 3.35, cz - cd / 2 + 0.05, W - 1, 0.18, 0.12, cream); // (the valance)
        for (let i = 0; i < 5; i++) k.box(-W / 2 + 1.5 + ((W - 3) * i) / 4, 0, cz - cd / 2 + 0.7, 0.16, 3.5, 0.16, green);
      }
      // the name board over the door, in the company's colours
      k.box(0, 3.1, D / 2 + 0.06, Math.min(9, W * 0.5), 0.7, 0.08, green);
      k.box(0, 3.25, D / 2 + 0.11, Math.min(8.4, W * 0.46), 0.4, 0.04, cream);
      name = 'Railway station';
      out.push(L.wall[1], 'booking hall', 'platform canopy');
      break;
    }
    case 'station-modern': {
      // a glass booking hall with a flat roof overhanging its front, and a canopy over the platform behind
      const L = look(r, 'glass', 'curtain', '#3a3f45');
      flat(k, X0, zf, X1, F, 0.05, slabsM());
      k.block(0, 0, W, D, 0, 1, 5.2, 3, facade('lobby', 'glass', L.wall[0], '#3a3f45', '#1f5e3f'), fm(L), fm(L));
      const grey = plain('#e4e6e8'), green = plain('#1f5e3f');
      k.box(0, 5.2, 0.8, W + 1.6, 0.45, D + 3.2, grey);
      k.box(0, 4.4, D / 2 + 0.06, Math.min(10, W * 0.5), 0.6, 0.08, green);
      const cd = Math.min(3.6, l.back);
      if (cd >= 2) {
        k.box(0, 3.6, -D / 2 - cd / 2 - 0.1, W - 1, 0.2, cd, grey);
        for (let i = 0; i < 4; i++) k.box(-W / 2 + 1.5 + ((W - 3) * i) / 3, 0, -D / 2 - cd + 0.6, 0.18, 3.6, 0.18, plain('#8a9096'));
      }
      name = 'Railway station';
      out.push('glass booking hall', ...(cd >= 2 ? ['platform canopy'] : []));
      break;
    }
    default: {
      // surgery, community hall, corner shop
      const L = l.arch === 'cornershop' ? look(r, 'brick', 'sash', '#f4f4f0') : look(r, r() < 0.5 ? 'brick' : 'render', 'picture', '#2d3338');
      flat(k, X0, Bk, X1, F, 0.04, lawnM(1));
      flat(k, X0, zf, X1, F, 0.05, l.arch === 'cornershop' ? slabsM() : tarmacM());
      if (l.arch === 'cornershop') {
        k.block(0, 0, W, D, 0, 1, 4, 4.5, facade('shop', L.skin, L.wall[0], L.frame, pick(r, FASCIA)), blank(L), blank(L));
        k.block(0, 0, W, D, 4, 1, 3, 3, fm(L), blank(L), fm(L));
        k.gable(0, 0, W, D, 7, 3, 0.3, roofM(pick(r, SLATE)[0]), blank(L));
        k.box(-W / 2 + 1, 0, zf + 1.2, 1.6, 1.1, 0.6, plain('#e0c14a')); // newspaper stand
        out.push('newspaper stand');
      } else {
        k.block(0, 0, W, D, 0, 1, 4, 4, fm(L), fm(L), fm(L));
        if (l.arch === 'hall') k.gable(0, 0, W, D, 4, 3.2, 0.4, roofM(pick(r, TILE)[0]), blank(L));
        else flatRoof(k, 0, 0, W, D, 4, blank(L), r, false);
        if (l.front >= 6) parkingRow(k, X0 + 0.5, X1 - 0.5, zf + 0.5, r, 0.6);
        out.push(L.wall[1], 'car park');
      }
    }
  }
  return { name, detail: out.join(' · ') };
}

// ---------------- leftover land: parks, playgrounds, allotments, car parks, scrub ----------------
export type RegionKind = 'verge' | 'pocket' | 'playground' | 'allotments' | 'park' | 'carpark' | 'scrub' | 'grounds';
export interface RegionShape { cells: P3[]; size: number; kind: RegionKind; seed: number; roadEdges: [number, number, number, number][] }
type P3 = { x: number; z: number };
const REGION_NAMES: Record<RegionKind, string> = {
  verge: 'Planted verge', pocket: 'Pocket park', playground: 'Playground', allotments: 'Allotments', park: 'Park', carpark: 'Car park', scrub: 'Rough ground', grounds: 'Gardens',
};
const meadowM = () => gmat('meadow', (x, r) => {
  x.fillStyle = '#7aa653'; x.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 500; i++) { x.fillStyle = pick(r, ['#5f8f3e', '#8fb862', '#6a9a47', '#6a9a47', '#e8e2c0', '#d9c04a', '#b06ab0']); x.fillRect(r() * 64, r() * 64, 1.2, 2); }
});
const vegM = () => gmat('veg', (x, r) => {
  x.fillStyle = '#6a4d35'; x.fillRect(0, 0, 64, 64);
  for (let row = 4; row < 64; row += 8) for (let i = 0; i < 16; i++) { x.fillStyle = pick(r, ['#4f8a36', '#6c9a3a', '#3e7a35', '#8aa04a']); x.fillRect(i * 4 + r(), row + r(), 3, 3); }
});
const rubberM = () => gmat('rubber', (x, r) => { x.fillStyle = '#b5493f'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(0,0,0,${r() * 0.12})`; x.fillRect(r() * 64, r() * 64, 1.5, 1.5); } });
const scrubM = () => gmat('scrub', (x, r) => { x.fillStyle = '#9f9676'; x.fillRect(0, 0, 64, 64); for (let i = 0; i < 400; i++) { x.fillStyle = pick(r, ['#7a8a4a', '#8a8060', '#6a7a3a', '#b0a888']); x.fillRect(r() * 64, r() * 64, 2, 2); } });

export function makeRegion(reg: RegionShape): BuiltShape {
  const k = new Kit(), r = rng(Math.floor(reg.seed * 4294967295)), S = reg.size, h = S / 2;
  const key = (c: P3) => `${Math.round(c.x / S * 2)},${Math.round(c.z / S * 2)}`;
  const has = new Set(reg.cells.map(key));
  const inR = (x: number, z: number) => has.has(key({ x, z }));
  const cells = reg.cells;
  const ground = { verge: meadowM(), pocket: lawnM(1), playground: lawnM(1), allotments: lawnM(0.94), park: lawnM(1.03), carpark: tarmacM(), scrub: scrubM(), grounds: lawnM(1) }[reg.kind];
  for (const c of cells) flat(k, c.x - h, c.z - h, c.x + h, c.z + h, 0.04, ground);
  // the middle of the region and the longest way across it
  const cx = cells.reduce((t, c) => t + c.x, 0) / cells.length, cz = cells.reduce((t, c) => t + c.z, 0) / cells.length;
  const centre = cells.reduce((b, c) => (Math.hypot(c.x - cx, c.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? c : b), cells[0]);
  const block = (n: number) => cells.find((c) => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!inR(c.x + i * S, c.z + j * S)) return false; return true; });
  const notes: string[] = [`${Math.round(cells.length * S * S)} m²`];
  const railings = () => { for (const [x0, z0, x1, z1] of reg.roadEdges) k.at((x0 + x1) / 2, (z0 + z1) / 2, -Math.atan2(z1 - z0, x1 - x0), () => k.box(0, 0, 0, Math.hypot(x1 - x0, z1 - z0) + 0.05, 1.1, 0.06, plain('#23262a'))); };
  const keep: { x: number; z: number; r: number }[] = [];
  const clear = (x: number, z: number) => keep.every((o) => Math.hypot(x - o.x, z - o.z) > o.r);
  const trees = (p: number, s = 0.9) => { let n = 0; for (const c of cells) if (r() < p && clear(c.x, c.z)) { tree(k, c.x + (r() - 0.5) * S * 0.6, c.z + (r() - 0.5) * S * 0.6, s + r() * 0.4, r); n++; } return n; };
  if (reg.kind === 'verge' || reg.kind === 'grounds') {
    for (const c of cells) if (r() < 0.6) sphere(k, c.x + (r() - 0.5) * 2, 0.6, c.z + (r() - 0.5) * 2, 0.8 + r() * 0.5, plain(pick(r, LEAVES)), 6, 3, 0.8);
    trees(0.3, 0.8);
    notes.push('shrubs and trees');
  } else if (reg.kind === 'pocket' || reg.kind === 'park') {
    const pond = reg.kind === 'park' ? block(4) : undefined;
    if (pond) { keep.push({ x: pond.x + 1.5 * S, z: pond.z + 1.5 * S, r: S * 1.6 + 2 }); k.prismN(pond.x + 1.5 * S, pond.z + 1.5 * S, S * 1.6, 18, 0, 0.1, plain('#cfc7a8')); k.prismN(pond.x + 1.5 * S, pond.z + 1.5 * S, S * 1.4, 18, 0, 0.14, plain('#4f93c4')); notes.push('pond'); }
    // a path across the longer way, benches along it
    const xs = cells.map((c) => c.x), zs = cells.map((c) => c.z);
    const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
    const path = cells.filter((c) => (alongX ? Math.abs(c.z - centre.z) < 0.1 : Math.abs(c.x - centre.x) < 0.1) && clear(c.x, c.z));
    for (const c of path) alongX ? flat(k, c.x - h, c.z - 1.2, c.x + h, c.z + 1.2, 0.075, gravelM()) : flat(k, c.x - 1.2, c.z - h, c.x + 1.2, c.z + h, 0.075, gravelM());
    path.forEach((c, i) => { if (i % 2 === 1) bench(k, alongX ? c.x : c.x + 2, alongX ? c.z + 2 : c.z, alongX); });
    const tn = trees(reg.kind === 'park' ? 0.3 : 0.4);
    for (const c of cells) if (r() < 0.12 && clear(c.x, c.z)) flat(k, c.x - 1.5, c.z - 1, c.x + 1.5, c.z + 1, 0.07, bedM());
    if (reg.kind === 'park' && cells.length > 80 && clear(centre.x, centre.z + S)) { k.prismN(centre.x, centre.z + S, 3.2, 8, 0, 0.6, plain('#c9c2b4')); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; k.box(centre.x + Math.cos(a) * 2.8, 0.6, centre.z + S + Math.sin(a) * 2.8, 0.15, 2.6, 0.15, plain('#2e5a45')); } k.prismN(centre.x, centre.z + S, 3.6, 8, 3.2, 0.2, plain('#2e5a45'), 1.4, plain('#2e5a45')); notes.push('bandstand'); }
    railings();
    notes.push(`${tn} trees`, 'benches', 'railings');
  } else if (reg.kind === 'playground') {
    const b = block(2) ?? centre;
    const x0 = b.x - h, z0 = b.z - h, x1 = x0 + 2 * S, z1 = z0 + 2 * S;
    flat(k, x0, z0, x1, z1, 0.06, rubberM());
    // swings, slide, climbing frame
    k.box(x0 + 2.5, 2.3, z0 + 2.5, 3.4, 0.12, 0.12, plain('#2f5d9e'));
    for (const s of [-1.6, 1.6]) k.box(x0 + 2.5 + s, 0, z0 + 2.5, 0.12, 2.4, 0.12, plain('#2f5d9e'));
    for (const s of [-0.7, 0.7]) k.box(x0 + 2.5 + s, 0.5, z0 + 2.5, 0.5, 0.06, 0.25, plain('#1c1d20'));
    k.box(x1 - 2.5, 0, z0 + 2.5, 1.4, 1.8, 1.4, plain('#e0a526'));
    k.g(plain('#c9302c')).quad(k.T(x1 - 1.8, 1.8, z0 + 1.9), k.T(x1 - 1.8, 1.8, z0 + 3.1), k.T(x1 + 0.6, 0.1, z0 + 3.1), k.T(x1 + 0.6, 0.1, z0 + 1.9));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) k.box(x0 + 3.5 + i * 1.2, 0, z1 - 4.5 + j * 1.2, 0.08, 2, 0.08, plain('#2e7d5b'));
    k.box(x0 + 4.7, 2, z1 - 3.3, 2.5, 0.08, 2.5, plain('#2e7d5b'));
    for (const [a, c, d, e] of [[x0, z0, x1, z0], [x0, z1, x1, z1], [x0, z0, x0, z1], [x1, z0, x1, z1]]) k.box((a + d) / 2, 0, (c + e) / 2, Math.max(0.05, d - a), 1, Math.max(0.05, e - c), plain('#2e7d5b'));
    bench(k, x0 - 1.5, z0 + S, false);
    trees(0.25);
    railings();
    notes.push('swings, slide and climbing frame');
  } else if (reg.kind === 'allotments') {
    let sheds = 0;
    for (const c of cells) {
      flat(k, c.x - h + 0.5, c.z - h + 0.5, c.x + h - 0.5, c.z + h - 0.5, 0.07, vegM());
      if (r() < 0.16) { shed(k, c.x + h - 1.8, c.z + h - 1.6, r); sheds++; }
      else if (r() < 0.15) k.prismN(c.x - h + 1, c.z - h + 1, 0.4, 8, 0, 0.9, plain('#2f5d3a'));
      if (r() < 0.2) { for (let i = 0; i < 3; i++) k.box(c.x - 1 + i, 0, c.z, 0.05, 1.6, 0.05, plain('#8a6446')); }
    }
    notes.push(`${cells.length} plots`, `${sheds} sheds`);
  } else if (reg.kind === 'carpark') {
    let spaces = 0;
    for (const c of cells) { for (let i = 0; i < 2; i++) { flat(k, c.x - h + i * 2.5, c.z - h + 0.2, c.x - h + i * 2.5 + 0.1, c.z + h - 0.2, 0.1, plain('#f2f2ee')); if (r() < 0.6) car(k, c.x - h + 1.3 + i * 2.5, c.z, true, pick(r, CAR_COLS)); spaces++; } }
    k.box(centre.x, 0, centre.z, 0.15, 2.4, 0.15, plain('#3a3a3a'));
    k.box(centre.x, 2.4, centre.z, 1.2, 0.8, 0.1, plain('#1f4f9e'));
    notes.push(`${spaces} spaces`, 'pay and display');
  } else {
    for (const c of cells) if (r() < 0.3) sphere(k, c.x + (r() - 0.5) * 3, 0.4, c.z + (r() - 0.5) * 3, 0.6 + r() * 0.6, plain(pick(r, ['#6a7a3a', '#7a8a4a', '#8a8060'])), 5, 3, 0.7);
    for (const c of cells) if (r() < 0.05) k.box(c.x, 0, c.z, 3.6, 1.2, 1.8, plain(pick(r, ['#e0a526', '#2f6f9e', '#b0463a'])));
    notes.push('weeds', 'a skip or two');
  }
  return { group: k.build(), height: k.top, name: REGION_NAMES[reg.kind], detail: notes.join(' · ') };
}

export const USE: Record<Lot['kind'], { label: string; pop: number; unit: string }> = {
  house: { label: 'Housing · low density', pop: 4, unit: 'residents' },
  terrace: { label: 'Housing · terraced', pop: 5, unit: 'residents' },
  shop: { label: 'Retail with flats above', pop: 6, unit: 'jobs' },
  flats: { label: 'Housing · medium density', pop: 45, unit: 'residents' },
  office: { label: 'Offices', pop: 120, unit: 'jobs' },
  tower: { label: 'High density', pop: 160, unit: 'people' },
  industry: { label: 'Industry', pop: 60, unit: 'jobs' },
  civic: { label: 'Community', pop: 10, unit: 'jobs' },
};

export function makeBuilding(l: Lot): BuiltShape {
  const k = new Kit();
  const r = rng(Math.floor(l.seed * 4294967295));
  const rr = rng(hash(`row${l.row}`));
  const d = l.kind === 'house' ? house(k, l, r, rr) : l.kind === 'terrace' ? terrace(k, l, r, rr) : l.kind === 'shop' ? shop(k, l, r) : l.kind === 'flats' ? flats(k, l, r) : l.kind === 'office' ? office(k, l, r) : l.kind === 'industry' ? industry(k, l, r) : l.kind === 'civic' ? civic(k, l, r) : tower(k, l, r);
  const height = k.top;
  const y = yard(k, l, r, rr);
  const group = k.build();
  group.position.set(l.x, 0, l.z);
  // local +x runs along the road; local +z faces the road
  group.rotation.y = -l.rot;
  group.userData.lot = l;
  return { group, height, name: d.name, detail: [d.detail, ...y].filter(Boolean).join(' · ') };
}
