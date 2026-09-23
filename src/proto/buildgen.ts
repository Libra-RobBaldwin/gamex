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
const METAL: Sw = ['#3f4449', 'standing-seam roof'];
const FRAMES = ['#f4f4f0', '#f4f4f0', '#2d3338', '#2e5a45'];
const DOORS = ['#2e4a6b', '#7a2d2d', '#2e5a45', '#222222', '#d9b43c', '#6b4b8a', '#f4f4f0', '#c9573a'];
const FASCIA = ['#2e7d5b', '#b23a3a', '#2f5d9e', '#c98a1f', '#3a3a3a', '#7a3f7a', '#1f6f78', '#8c2f4f'];
const TRIM = '#ece6d8';
const GRAVEL = '#8e8b86';

type Win = 'none' | 'sash' | 'grid' | 'arched' | 'casement' | 'picture' | 'ribbon' | 'curtain' | 'punched' | 'door' | 'warehouse' | 'shop' | 'lobby';
type Skin = 'brick' | 'render' | 'stone' | 'concrete' | 'timber' | 'glass';
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
const plain = (c: string) => M(`p|${c}`, () => new THREE.MeshLambertMaterial({ color: c }));
const facade = (win: Win, skin: Skin, wall: string, frame: string, fascia?: string) => M(`f|${win}|${skin}|${wall}|${frame}|${fascia}`, () => new THREE.MeshLambertMaterial({ map: facadeTex(win, skin, wall, frame, fascia) }));
const roofM = (c: string) => M(`r|${c}`, () => new THREE.MeshLambertMaterial({ map: roofTex(c) }));
const stripes = (c: string) => M(`s|${c}`, () => new THREE.MeshLambertMaterial({ map: stripeTex(c), side: THREE.DoubleSide }));
const railM = () => M('rail', () => new THREE.MeshLambertMaterial({ color: '#a9cddd', transparent: true, opacity: 0.5, depthWrite: false }));

// ---------------- geometry kit ----------------
type V = [number, number, number];
type XZ = [number, number];

class Geo {
  p: number[] = []; n: number[] = []; uv: number[] = [];
  tri(a: V, b: V, c: V, ua: XZ, ub: XZ, uc: XZ) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) return;
    nx /= L; ny /= L; nz /= L;
    this.p.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) this.n.push(nx, ny, nz);
    this.uv.push(...ua, ...ub, ...uc);
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
  g(m: THREE.Material) { let g = this.byMat.get(m); if (!g) { g = new Geo(); this.byMat.set(m, g); } return g; }
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
  gable(cx: number, cz: number, w: number, d: number, y0: number, rise: number, over: number, roof: THREE.Material, end: THREE.Material) {
    const g = this.g(roof), x0 = cx - w / 2 - over, x1 = cx + w / 2 + over, zf = cz + d / 2 + over, zb = cz - d / 2 - over, top = y0 + rise;
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
const cornice = (k: Kit, cx: number, cz: number, w: number, d: number, y: number, m: THREE.Material, out = 0.3, h = 0.4) => k.box(cx, y, cz, w + out * 2, h, d + out * 2, m);
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
const skinPalette = (s: Skin): Sw[] => ({ brick: BRICK, render: RENDER, stone: STONE, concrete: CONC, timber: TIMBER, glass: GLASS }[s]);
const look = (r: () => number, skin: Skin, win: Win, frame = pick(r, FRAMES), wall = pick(r, skinPalette(skin))): Look => ({ skin, wall, win, frame });
const fm = (l: Look, win: Win = l.win) => facade(win, l.skin, l.wall[0], l.frame);
const blank = (l: Look) => facade('none', l.skin, l.wall[0], l.frame);
const cellOf = (win: Win) => (win === 'picture' ? 4 : win === 'curtain' ? 3 : win === 'warehouse' ? 3.6 : 3);
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? '' : 's'}`;

function house(k: Kit, l: Lot, r: () => number, rr: () => number) {
  const W = Math.min(l.w, 11), D = Math.min(l.d * 0.85, 10);
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
  const arch = pick(rr, ['victorian', 'georgian', 'painted', 'townhouse', 'gabled'] as const);
  const doorLeft = rr() < 0.5 ? -1 : 1;
  let L: Look, roofName: string, name: string;
  if (arch === 'victorian') {
    L = look(rr, 'brick', rr() < 0.5 ? 'sash' : 'arched', '#f4f4f0');
    if (r() < 0.12) { L = { ...L, skin: 'render', wall: pick(r, PASTEL) }; extras.push('painted front'); }
    const roof = pick(rr, SLATE); roofName = roof[1];
    const fh = 3;
    k.block(0, 0, W, D, 0, 2, fh, 3, fm(L), blank(L), fm(L));
    k.gable(0, 0, W, D, 6, 3.2, 0.3, roofM(roof[0]), blank(L));
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
    k.gable(0, 0, W, D, 5.6, 3, 0.3, roofM(roof[0]), blank(L));
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

function tower(k: Kit, l: Lot, r: () => number) {
  const W = l.w, D = Math.min(l.d, 18), extras: string[] = [];
  const arch = pick(r, ['glass', 'resi', 'deco', 'glass'] as const);
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

export const USE: Record<Lot['kind'], { label: string; pop: number; unit: string }> = {
  house: { label: 'Housing · low density', pop: 4, unit: 'residents' },
  terrace: { label: 'Housing · terraced', pop: 5, unit: 'residents' },
  shop: { label: 'Retail with flats above', pop: 6, unit: 'jobs' },
  flats: { label: 'Housing · medium density', pop: 45, unit: 'residents' },
  office: { label: 'Offices', pop: 120, unit: 'jobs' },
  tower: { label: 'High density', pop: 160, unit: 'people' },
};

export function makeBuilding(l: Lot): BuiltShape {
  const k = new Kit();
  const r = rng(Math.floor(l.seed * 4294967295));
  const rr = rng(hash(`row${l.row}`));
  const d = l.kind === 'house' ? house(k, l, r, rr) : l.kind === 'terrace' ? terrace(k, l, r, rr) : l.kind === 'shop' ? shop(k, l, r) : l.kind === 'flats' ? flats(k, l, r) : l.kind === 'office' ? office(k, l, r) : tower(k, l, r);
  const group = k.build();
  group.position.set(l.x, 0, l.z);
  // local +x runs along the road; local +z faces the road
  group.rotation.y = -l.rot;
  group.userData.lot = l;
  return { group, height: k.top, ...d };
}
