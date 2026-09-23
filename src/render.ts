// Isometric canvas renderer: terrain, smooth roads/rails, 3D-ish buildings, industries, vehicles.
import { STATIONS, VEHICLES } from './defs';
import { DX, DY, HH, HW, iso, isoInv, type Pt } from './geo';
import type { Game, Station, Vehicle } from './sim';
import { T_FOREST, T_SAND, T_WATER, valueNoise, rng } from './world';

export interface Float { x: number; y: number; text: string; color: string; t: number }

export interface Overlay {
  stroke: { nodes: number[]; bad: number; color: string } | null;
  catchment: { x: number; y: number; r: number } | null;
  selStation: number | null;
  selVehicle: number | null;
  selIndustry: number | null;
  grid: boolean;
  floats: Float[];
}

const hash = (n: number) => {
  let h = n * 374761393 + 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

const HOUSE_WALL = ['#eadfc8', '#d9c3a1', '#c99171', '#e8e3d8', '#d6b48c'];
const HOUSE_ROOF = ['#a4493d', '#6e5a50', '#7d848c', '#b5653f', '#58606b'];
const FLAT_WALL = ['#c9baa6', '#b3a28e', '#d8d1c5', '#a07d66', '#bfae9a'];
const TOWER_WALL = ['#8fb0c9', '#a6b6c3', '#7c98b0', '#9fb9c0'];

interface Obj { k: number; draw: () => void }

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  game: Game;
  cam = { x: 0, y: 0, zoom: 1.2 };
  cssW = 0;
  cssH = 0;
  private dpr = 1;
  private shadeMap: Float32Array = new Float32Array(0);
  private depth: Uint8Array = new Uint8Array(0);
  private trees: HTMLCanvasElement[] = [];
  private k = 1;
  private ox = 0;
  private oy = 0;

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.game = game;
    this.trees = [0, 1, 2, 3].map((v) => this.makeTree(v));
    this.setGame(game);
    this.resize();
  }

  setGame(g: Game) {
    this.game = g;
    const s = g.s;
    this.shadeMap = valueNoise(s.w, s.h, 5, rng(s.seed ^ 99));
    // distance-to-land for water colouring
    const N = s.w * s.h;
    const depth = new Uint8Array(N).fill(255);
    const q: number[] = [];
    for (let i = 0; i < N; i++) if (s.terrain[i] !== T_WATER) { depth[i] = 0; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const n = q[qi];
      for (let d = 0; d < 8; d += 2) {
        const m = g.road.neighbour(n, d);
        if (m >= 0 && depth[m] === 255) { depth[m] = Math.min(254, depth[n] + 1); q.push(m); }
      }
    }
    this.depth = depth;
    const c = iso(s.start.x + 0.5, s.start.y + 0.5);
    this.cam.x = c.x;
    this.cam.y = c.y;
  }

  resize() {
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
  }

  clampCam() {
    const s = this.game.s;
    this.cam.zoom = Math.max(0.3, Math.min(3.2, this.cam.zoom));
    const minX = -s.h * HW, maxX = s.w * HW, maxY = (s.w + s.h) * HH;
    this.cam.x = Math.max(minX, Math.min(maxX, this.cam.x));
    this.cam.y = Math.max(0, Math.min(maxY, this.cam.y));
  }

  screenToIso(sx: number, sy: number) {
    return { x: (sx - this.cssW / 2) / this.cam.zoom + this.cam.x, y: (sy - this.cssH / 2) / this.cam.zoom + this.cam.y };
  }
  isoToScreen(x: number, y: number) {
    return { x: (x - this.cam.x) * this.cam.zoom + this.cssW / 2, y: (y - this.cam.y) * this.cam.zoom + this.cssH / 2 };
  }
  screenToTileF(sx: number, sy: number) {
    const p = this.screenToIso(sx, sy);
    return isoInv(p.x, p.y);
  }
  screenToTile(sx: number, sy: number) {
    const t = this.screenToTileF(sx, sy);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }
  tileToScreen(x: number, y: number, z = 0) {
    const p = iso(x, y, z);
    return this.isoToScreen(p.x, p.y);
  }

  // Switch to drawing in tile coordinates (flat on the ground).
  private tileT() { this.ctx.setTransform(this.k * HW, this.k * HH, -this.k * HW, this.k * HH, this.ox, this.oy); }
  // Switch to drawing in iso pixel coordinates (for upright things).
  private isoT() { this.ctx.setTransform(this.k, 0, 0, this.k, this.ox, this.oy); }

  private makeTree(v: number): HTMLCanvasElement {
    const S = 3, W = 26, H = 36;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const x = c.getContext('2d')!;
    x.scale(S, S);
    const cx = W / 2;
    x.fillStyle = 'rgba(0,0,0,0.18)';
    x.beginPath(); x.ellipse(cx + 2, H - 3, 9, 3.5, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#6b4a2f';
    x.fillRect(cx - 1.2, H - 13, 2.4, 10);
    if (v === 3) {
      // conifer
      const g = x.createLinearGradient(cx - 8, 0, cx + 8, 0);
      g.addColorStop(0, '#3f7a3a'); g.addColorStop(1, '#23502a');
      x.fillStyle = g;
      for (let i = 0; i < 3; i++) {
        x.beginPath();
        x.moveTo(cx, 2 + i * 6);
        x.lineTo(cx + 8 - i, 16 + i * 5);
        x.lineTo(cx - 8 + i, 16 + i * 5);
        x.closePath();
        x.fill();
      }
    } else {
      const base = ['#5d9a3c', '#6fa645', '#4f8a3a'][v];
      const blobs: [number, number, number][] = [[0, 15, 8], [-4.5, 18, 6], [4.5, 18, 6.3], [0, 10, 6.2]];
      for (const [dx, dy, r] of blobs) {
        const g = x.createRadialGradient(cx + dx - r * 0.35, dy - r * 0.4, r * 0.2, cx + dx, dy, r);
        g.addColorStop(0, shade(base, 1.25)); g.addColorStop(1, shade(base, 0.72));
        x.fillStyle = g;
        x.beginPath(); x.arc(cx + dx, dy, r, 0, Math.PI * 2); x.fill();
      }
    }
    return c;
  }

  draw(now: number, ov: Overlay) {
    const { ctx, game } = this;
    const s = game.s;
    this.k = this.cam.zoom * this.dpr;
    this.ox = (this.cssW / 2 - this.cam.x * this.cam.zoom) * this.dpr;
    this.oy = (this.cssH / 2 - this.cam.y * this.cam.zoom) * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a6da3';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // visible tile bounds (generous vertically for tall buildings)
    const corners = [[0, -140], [this.cssW, -140], [0, this.cssH + 60], [this.cssW, this.cssH + 60]].map(([x, y]) => this.screenToTileF(x, y));
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 1);
    const x1 = Math.min(s.w - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 1);
    const y1 = Math.min(s.h - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 1);
    const visible = (x: number, y: number) => {
      const p = this.tileToScreen(x + 0.5, y + 0.5);
      return p.x > -80 && p.x < this.cssW + 80 && p.y > -60 && p.y < this.cssH + 200;
    };

    // ---- ground ----
    this.tileT();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * s.w + x;
        const t = s.terrain[i];
        const n = this.shadeMap[i];
        if (t === T_WATER) {
          const f = Math.min(1, (this.depth[i] - 1 + n * 1.5) / 5);
          ctx.fillStyle = `rgb(${Math.round(92 - 50 * f)},${Math.round(172 - 60 * f)},${Math.round(212 - 40 * f)})`;
        } else if (t === T_SAND) ctx.fillStyle = `hsl(45, 45%, ${74 + n * 6}%)`;
        else ctx.fillStyle = `hsl(${88 + n * 16}, ${36 + n * 8}%, ${t === T_FOREST ? 36 + n * 5 : 44 + n * 8}%)`;
        ctx.fillRect(x - 0.01, y - 0.01, 1.02, 1.02);
      }
    // shimmer on water
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.03;
    ctx.beginPath();
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * s.w + x;
        if (s.terrain[i] !== T_WATER) continue;
        const ph = Math.sin(now / 900 + hash(i) * 20);
        if (ph < 0.6) continue;
        const ox = hash(i + 7) * 0.6, oy = hash(i + 13) * 0.8;
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + 0.3, y + oy);
      }
    ctx.stroke();

    if (ov.grid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) { ctx.moveTo(x, y0); ctx.lineTo(x, y1 + 1); }
      for (let y = y0; y <= y1 + 1; y++) { ctx.moveTo(x0, y); ctx.lineTo(x1 + 1, y); }
      ctx.stroke();
    }

    // industry ground patches, farm fields, airport aprons, station pads
    for (const ind of s.industries) {
      if (ind.x > x1 + 1 || ind.x + 2 < x0 || ind.y > y1 + 1 || ind.y + 2 < y0) continue;
      if (ind.kind === 'farm') {
        for (let r = 0; r < 8; r++) {
          ctx.fillStyle = r % 2 ? '#c9b25a' : '#a9b85a';
          ctx.fillRect(ind.x + 0.05, ind.y + 0.05 + r * 0.24, 1.3, 0.22);
        }
      } else if (ind.kind === 'forest') {
        ctx.fillStyle = '#4b7a34';
        ctx.fillRect(ind.x, ind.y, 2, 2);
      } else {
        ctx.fillStyle = ind.kind === 'coal_mine' ? '#6a635a' : '#a9a69e';
        ctx.fillRect(ind.x + 0.05, ind.y + 0.05, 1.9, 1.9);
      }
    }
    for (const st of s.stations) {
      if (st.kind === 'airport') {
        ctx.fillStyle = '#b8babc';
        ctx.fillRect(st.x - 1, st.y - 1, 3, 3);
        ctx.fillStyle = '#53575c';
        ctx.fillRect(st.x - 0.95, st.y + 0.6, 2.9, 0.55);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.03;
        ctx.setLineDash([0.15, 0.12]);
        ctx.beginPath(); ctx.moveTo(st.x - 0.85, st.y + 0.875); ctx.lineTo(st.x + 1.85, st.y + 0.875); ctx.stroke();
        ctx.setLineDash([]);
      } else if (st.kind === 'road') {
        ctx.fillStyle = '#c7c3b8';
        ctx.fillRect(st.x + 0.08, st.y + 0.08, 0.84, 0.84);
      }
    }
    // rubble
    for (const n of s.rubble) {
      const x = n % s.w, y = Math.floor(n / s.w);
      ctx.fillStyle = 'rgba(90,70,50,0.8)';
      ctx.fillRect(x + 0.1, y + 0.1, 0.8, 0.8);
      ctx.fillStyle = '#8a8680';
      for (let j = 0; j < 5; j++) ctx.fillRect(x + 0.15 + hash(n + j) * 0.6, y + 0.15 + hash(n * 3 + j) * 0.6, 0.12, 0.1);
    }

    // ---- networks ----
    this.drawRoads(x0, y0, x1, y1);
    this.drawRails(x0, y0, x1, y1, 'rail');
    // rail platforms
    for (const st of s.stations) if (st.kind === 'rail') this.drawPlatforms(st);
    this.drawRails(x0, y0, x1, y1, 'metro');

    // ---- overlays on ground ----
    const drawCatch = (x: number, y: number, r: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 0.05;
      ctx.strokeRect(x - r, y - r, 2 * r + 1, 2 * r + 1);
    };
    if (ov.catchment) drawCatch(ov.catchment.x, ov.catchment.y, ov.catchment.r, 'rgba(255,230,90,0.18)');
    const selSt = ov.selStation != null ? game.station(ov.selStation) : undefined;
    if (selSt) drawCatch(selSt.x, selSt.y, STATIONS[selSt.kind].radius, 'rgba(90,200,255,0.16)');
    const selV = ov.selVehicle != null ? s.vehicles.find((v) => v.id === ov.selVehicle) : undefined;
    if (selV && selV.path.length > 1) {
      ctx.strokeStyle = 'rgba(255,230,60,0.8)';
      ctx.lineWidth = 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath();
      selV.path.forEach((n, i) => { const x = (n % s.w) + 0.5, y = Math.floor(n / s.w) + 0.5; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    if (ov.stroke && ov.stroke.nodes.length) {
      const pts = ov.stroke.nodes.map((n) => ({ x: (n % s.w) + 0.5, y: Math.floor(n / s.w) + 0.5 }));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.34;
      const upto = ov.stroke.bad < 0 ? pts.length : ov.stroke.bad + 1;
      ctx.strokeStyle = ov.stroke.color;
      ctx.beginPath();
      pts.slice(0, upto).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      if (upto < pts.length) {
        ctx.strokeStyle = 'rgba(255,60,50,0.75)';
        ctx.beginPath();
        pts.slice(upto - 1).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
      for (const p of [pts[0], pts[pts.length - 1]]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.12, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ---- upright objects, depth sorted ----
    const objs: Obj[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * s.w + x;
        if (!visible(x, y)) continue;
        if (s.bld[i]) objs.push({ k: x + y + 1, draw: () => this.drawBuilding(x, y, s.bld[i], i) });
        else if (s.terrain[i] === T_FOREST && !game.road.any(i) && !game.rail.any(i)) {
          const cnt = 2 + Math.floor(hash(i) * 2);
          for (let j = 0; j < cnt; j++) {
            const tx = x + 0.2 + hash(i * 7 + j) * 0.6, ty = y + 0.2 + hash(i * 13 + j) * 0.6;
            objs.push({ k: tx + ty, draw: () => this.drawTree(tx, ty, Math.floor(hash(i + j * 31) * 4), 0.8 + hash(i * 3 + j) * 0.45) });
          }
        } else if (s.terrain[i] === 0 && hash(i * 17) < 0.035 && !game.road.any(i) && !game.rail.any(i) && !game.stationAt(x, y) && !game.airportAt(x, y) && !game.industryAt(x, y)) {
          const tx = x + 0.5, ty = y + 0.5;
          objs.push({ k: tx + ty, draw: () => this.drawTree(tx, ty, Math.floor(hash(i) * 4), 0.9) });
        }
      }
    for (const ind of s.industries) objs.push({ k: ind.x + ind.y + 2, draw: () => this.drawIndustry(ind.kind, ind.x, ind.y, now, ind.id === ov.selIndustry) });
    for (const st of s.stations) objs.push({ k: st.x + st.y + 1.2, draw: () => this.drawStation(st, st.id === ov.selStation) });
    const flying: Vehicle[] = [];
    for (const v of s.vehicles) {
      const def = VEHICLES[v.type];
      if (def.station === 'airport') { if (v.state === 'move') flying.push(v); continue; }
      if (def.station === 'metro') continue;
      const c = game.curveOf(v);
      for (let car = 0; car < def.cars; car++) {
        const p = c.at(v.dist - car * 0.62);
        objs.push({ k: p.x + p.y, draw: () => this.drawVehicle(v, p, car, v.id === ov.selVehicle) });
      }
    }
    objs.sort((a, b) => a.k - b.k);
    for (const o of objs) o.draw();

    // metro trains as glowing dots on the tunnel overlay
    this.tileT();
    for (const v of s.vehicles) {
      if (VEHICLES[v.type].station !== 'metro' || v.state !== 'move') continue;
      const p = game.curveOf(v).at(v.dist);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.16, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = VEHICLES.metro.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.11, 0, Math.PI * 2); ctx.fill();
    }
    for (const v of flying) this.drawPlane(v, v.id === ov.selVehicle);

    // ---- labels (screen space) ----
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of s.towns) {
      const p = this.tileToScreen(t.cx + 0.5, t.cy + 0.5, 70);
      if (p.x < -100 || p.x > this.cssW + 100 || p.y < -40 || p.y > this.cssH + 40) continue;
      const pop = game.pop(t);
      if (!pop) continue;
      this.pill(`${t.name} · ${pop.toLocaleString()}`, p.x, p.y, 'rgba(18,22,30,0.82)', '#fff', 13);
    }
    if (this.cam.zoom >= 0.7) {
      for (const ind of s.industries) {
        const p = this.tileToScreen(ind.x + 1, ind.y + 1, 50);
        if (p.x < -100 || p.x > this.cssW + 100 || p.y < -40 || p.y > this.cssH + 40) continue;
        this.pill(ind.name, p.x, p.y, 'rgba(255,255,255,0.85)', '#223', 11);
      }
      for (const st of s.stations) {
        const w = Math.floor(Object.values(st.waiting).reduce((a, b) => a + (b ?? 0), 0));
        if (w < 1) continue;
        const cap = STATIONS[st.kind].cap;
        const p = this.tileToScreen(st.x + 0.5, st.y + 0.5, st.kind === 'airport' ? 40 : 26);
        const col = w > cap * 0.85 ? '#ff5a4d' : w > cap * 0.5 ? '#ffb13b' : '#3ecf7a';
        this.pill(`👥 ${w}`, p.x, p.y, col, '#fff', 11);
      }
    }
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    for (const f of ov.floats) {
      const p = this.tileToScreen(f.x, f.y, 30 + f.t * 30);
      ctx.globalAlpha = Math.max(0, 1 - f.t / 1.6);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(f.text, p.x + 1, p.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y);
      ctx.globalAlpha = 1;
    }
  }

  private pill(text: string, x: number, y: number, bg: string, fg: string, size: number) {
    const ctx = this.ctx;
    ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 12, h = size + 8;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, x, y + 0.5);
  }

  // ---------- networks ----------
  private mid(x: number, y: number, d: number): Pt { return { x: x + 0.5 + DX[d] * 0.5, y: y + 0.5 + DY[d] * 0.5 }; }

  private drawRoads(x0: number, y0: number, x1: number, y1: number) {
    const { ctx, game } = this;
    const s = game.s, g = game.road;
    type Seg = { a: Pt; c?: Pt; b: Pt; v: number; bridge: boolean };
    const segs: Seg[] = [];
    const nodes: { p: Pt; v: number }[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const n = y * s.w + x;
        const ds: number[] = [];
        for (let d = 0; d < 8; d++) if (g.get(n, d)) ds.push(d);
        if (!ds.length) continue;
        const c = { x: x + 0.5, y: y + 0.5 };
        const water = (d: number) => s.terrain[n] === T_WATER || s.terrain[g.neighbour(n, d)] === T_WATER;
        if (ds.length === 2 && ((ds[1] - ds[0]) & 7) !== 4) {
          const v = Math.min(g.get(n, ds[0]), g.get(n, ds[1]));
          segs.push({ a: this.mid(x, y, ds[0]), c, b: this.mid(x, y, ds[1]), v, bridge: water(ds[0]) || water(ds[1]) });
        } else {
          for (const d of ds) segs.push({ a: c, b: this.mid(x, y, d), v: g.get(n, d), bridge: water(d) });
          if (ds.length > 2) nodes.push({ p: c, v: Math.max(...ds.map((d) => g.get(n, d))) });
        }
      }
    if (!segs.length) return;
    const path = (sg: Seg) => {
      ctx.moveTo(sg.a.x, sg.a.y);
      if (sg.c) ctx.quadraticCurveTo(sg.c.x, sg.c.y, sg.b.x, sg.b.y);
      else ctx.lineTo(sg.b.x, sg.b.y);
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const W = [0, 0.42, 0.7];
    // bridges
    ctx.strokeStyle = '#8a7f72';
    for (const v of [1, 2]) {
      ctx.lineWidth = W[v] + 0.22;
      ctx.beginPath();
      for (const sg of segs) if (sg.bridge && sg.v === v) path(sg);
      ctx.stroke();
    }
    // kerb, asphalt
    for (const [col, extra] of [['#9c9a92', 0.08], ['#50545a', 0]] as const) {
      for (const v of [1, 2]) {
        ctx.strokeStyle = v === 2 && extra === 0 ? '#44484e' : col;
        ctx.lineWidth = W[v] + extra;
        ctx.beginPath();
        for (const sg of segs) if (sg.v === v) path(sg);
        for (const nd of nodes) if (nd.v === v) { ctx.moveTo(nd.p.x + 0.001, nd.p.y); ctx.lineTo(nd.p.x, nd.p.y); }
        ctx.stroke();
      }
    }
    // markings
    ctx.setLineDash([0.12, 0.12]);
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    for (const sg of segs) if (sg.v === 1) path(sg);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    for (const sg of segs) if (sg.v === 2) path(sg);
    ctx.stroke();
    ctx.strokeStyle = '#e8c33a';
    ctx.lineWidth = 0.025;
    for (const off of [-0.29, 0.29]) {
      ctx.beginPath();
      for (const sg of segs) if (sg.v === 2) this.offsetPath(sg, off);
      ctx.stroke();
    }
  }

  private offsetPath(sg: { a: Pt; c?: Pt; b: Pt }, o: number) {
    const ctx = this.ctx;
    const norm = (p: Pt, q: Pt) => { const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1; return { x: -dy / l, y: dx / l }; };
    if (!sg.c) {
      const n = norm(sg.a, sg.b);
      ctx.moveTo(sg.a.x + n.x * o, sg.a.y + n.y * o);
      ctx.lineTo(sg.b.x + n.x * o, sg.b.y + n.y * o);
      return;
    }
    const na = norm(sg.a, sg.c), nb = norm(sg.c, sg.b);
    let mx = na.x + nb.x, my = na.y + nb.y;
    const ml = Math.hypot(mx, my) || 1;
    const cosHalf = ml / 2;
    mx /= ml; my /= ml;
    ctx.moveTo(sg.a.x + na.x * o, sg.a.y + na.y * o);
    ctx.quadraticCurveTo(sg.c.x + (mx * o) / Math.max(0.5, cosHalf), sg.c.y + (my * o) / Math.max(0.5, cosHalf), sg.b.x + nb.x * o, sg.b.y + nb.y * o);
  }

  private drawRails(x0: number, y0: number, x1: number, y1: number, layer: 'rail' | 'metro') {
    const { ctx, game } = this;
    const s = game.s, g = layer === 'rail' ? game.rail : game.metro;
    type Seg = { a: Pt; c?: Pt; b: Pt; bridge: boolean };
    const segs: Seg[] = [];
    const ends: Pt[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const n = y * s.w + x;
        const ds: number[] = [];
        for (let d = 0; d < 8; d++) if (g.get(n, d)) ds.push(d);
        if (!ds.length) continue;
        const c = { x: x + 0.5, y: y + 0.5 };
        const used = new Set<number>();
        const water = (d: number) => s.terrain[n] === T_WATER || s.terrain[g.neighbour(n, d)] === T_WATER;
        for (let i = 0; i < ds.length; i++)
          for (let j = i + 1; j < ds.length; j++) {
            const diff = (ds[j] - ds[i] + 8) & 7;
            if (diff < 3 || diff > 5) continue;
            used.add(ds[i]); used.add(ds[j]);
            const straight = diff === 4;
            segs.push({ a: this.mid(x, y, ds[i]), c: straight ? undefined : c, b: this.mid(x, y, ds[j]), bridge: water(ds[i]) || water(ds[j]) });
          }
        for (const d of ds) if (!used.has(d)) { segs.push({ a: this.mid(x, y, d), b: c, bridge: water(d) }); ends.push(c); }
      }
    if (!segs.length) return;
    const path = (sg: Seg) => {
      ctx.moveTo(sg.a.x, sg.a.y);
      if (sg.c) ctx.quadraticCurveTo(sg.c.x, sg.c.y, sg.b.x, sg.b.y);
      else ctx.lineTo(sg.b.x, sg.b.y);
    };
    ctx.lineCap = 'butt';
    if (layer === 'metro') {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(31,95,191,0.55)';
      ctx.lineWidth = 0.16;
      ctx.setLineDash([0.22, 0.12]);
      ctx.beginPath();
      for (const sg of segs) path(sg);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    ctx.strokeStyle = '#7d6e5e';
    ctx.lineWidth = 0.58;
    ctx.beginPath();
    for (const sg of segs) if (sg.bridge) path(sg);
    ctx.stroke();
    ctx.strokeStyle = '#9d9388';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    for (const sg of segs) path(sg);
    ctx.stroke();
    // sleepers
    ctx.strokeStyle = '#5c4331';
    ctx.lineWidth = 0.3;
    ctx.setLineDash([0.045, 0.075]);
    ctx.beginPath();
    for (const sg of segs) path(sg);
    ctx.stroke();
    ctx.setLineDash([]);
    // rails
    ctx.strokeStyle = '#d4d8dd';
    ctx.lineWidth = 0.035;
    for (const off of [-0.085, 0.085]) {
      ctx.beginPath();
      for (const sg of segs) this.offsetPath(sg, off);
      ctx.stroke();
    }
    // buffer stops
    ctx.fillStyle = '#c0392b';
    for (const e of ends) { ctx.beginPath(); ctx.arc(e.x, e.y, 0.09, 0, Math.PI * 2); ctx.fill(); }
  }

  private drawPlatforms(st: Station) {
    const ctx = this.ctx;
    const d = st.dir;
    const ux = DX[d] / Math.hypot(DX[d], DY[d]), uy = DY[d] / Math.hypot(DX[d], DY[d]);
    const nx = -uy, ny = ux;
    const cx = st.x + 0.5, cy = st.y + 0.5;
    for (const side of [-1, 1]) {
      const px = cx + nx * 0.33 * side, py = cy + ny * 0.33 * side;
      const L = 0.62, Wd = 0.12;
      ctx.fillStyle = '#d9d4c7';
      ctx.beginPath();
      ctx.moveTo(px - ux * L - nx * Wd, py - uy * L - ny * Wd);
      ctx.lineTo(px + ux * L - nx * Wd, py + uy * L - ny * Wd);
      ctx.lineTo(px + ux * L + nx * Wd, py + uy * L + ny * Wd);
      ctx.lineTo(px - ux * L + nx * Wd, py - uy * L + ny * Wd);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e8c33a';
      ctx.lineWidth = 0.02;
      ctx.beginPath();
      const ex = px - nx * Wd * side * 0.8, ey = py - ny * Wd * side * 0.8;
      ctx.moveTo(ex - ux * L, ey - uy * L); ctx.lineTo(ex + ux * L, ey + uy * L);
      ctx.stroke();
    }
  }

  // ---------- 3D primitives (iso space) ----------
  private poly(pts: { x: number; y: number }[], fill: string) {
    const ctx = this.ctx;
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }

  // Axis-aligned box in tile coords from (x0,y0) to (x1,y1), z0..z0+h pixels.
  private box(x0: number, y0: number, x1: number, y1: number, z0: number, h: number, col: string, top?: string) {
    const z1 = z0 + h;
    this.poly([iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1)], shade(col, 0.78)); // south-west face
    this.poly([iso(x1, y0, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x1, y0, z1)], shade(col, 0.93)); // south-east face
    this.poly([iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)], top ?? shade(col, 1.06));
  }

  // Horizontal window bands on the two visible faces.
  private bands(x0: number, y0: number, x1: number, y1: number, z0: number, h: number, step: number, col: string) {
    const ctx = this.ctx;
    ctx.fillStyle = col;
    for (let z = z0 + step * 0.45; z + step * 0.35 < z0 + h; z += step) {
      const za = z, zb = z + step * 0.38;
      const i = 0.08;
      const f1 = [iso(x0 + i, y1, za), iso(x1 - i, y1, za), iso(x1 - i, y1, zb), iso(x0 + i, y1, zb)];
      const f2 = [iso(x1, y0 + i, za), iso(x1, y1 - i, za), iso(x1, y1 - i, zb), iso(x1, y0 + i, zb)];
      for (const f of [f1, f2]) {
        ctx.beginPath();
        f.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // Simple cast shadow off the east face (light from the west).
  private shadow(x1: number, y0: number, y1: number, len: number) {
    const o = Math.min(0.9, len / 60);
    this.poly([iso(x1, y0), iso(x1 + o, y0 - o * 0.3), iso(x1 + o, y1 - o * 0.3), iso(x1, y1)], 'rgba(0,0,0,0.13)');
  }

  private drawBuilding(x: number, y: number, level: number, i: number) {
    this.isoT();
    const h1 = hash(i), h2 = hash(i + 101), h3 = hash(i + 202);
    if (level === 1) {
      const ins = 0.18 + h1 * 0.06;
      const x0 = x + ins, y0 = y + ins, x1 = x + 1 - ins, y1 = y + 1 - ins;
      const wall = HOUSE_WALL[Math.floor(h2 * HOUSE_WALL.length)];
      const roof = HOUSE_ROOF[Math.floor(h3 * HOUSE_ROOF.length)];
      const h = 10 + h1 * 3, r = 8;
      this.shadow(x1, y0, y1, h + r);
      this.box(x0, y0, x1, y1, 0, h, wall);
      // windows
      this.bands(x0, y0, x1, y1, 0, h, 10, 'rgba(60,80,100,0.55)');
      // gable roof, ridge along x or y
      if (h2 < 0.5) {
        const ym = (y0 + y1) / 2;
        this.poly([iso(x0, y0, h), iso(x1, y0, h), iso(x1, ym, h + r), iso(x0, ym, h + r)], shade(roof, 1.08));
        this.poly([iso(x0, y1, h), iso(x1, y1, h), iso(x1, ym, h + r), iso(x0, ym, h + r)], shade(roof, 0.8));
        this.poly([iso(x1, y0, h), iso(x1, y1, h), iso(x1, ym, h + r)], shade(wall, 0.93));
      } else {
        const xm = (x0 + x1) / 2;
        this.poly([iso(x0, y0, h), iso(x0, y1, h), iso(xm, y1, h + r), iso(xm, y0, h + r)], shade(roof, 1.08));
        this.poly([iso(x1, y0, h), iso(x1, y1, h), iso(xm, y1, h + r), iso(xm, y0, h + r)], shade(roof, 0.9));
        this.poly([iso(x0, y1, h), iso(x1, y1, h), iso(xm, y1, h + r)], shade(wall, 0.78));
      }
    } else if (level === 2) {
      const ins = 0.12;
      const x0 = x + ins, y0 = y + ins, x1 = x + 1 - ins, y1 = y + 1 - ins;
      const wall = FLAT_WALL[Math.floor(h2 * FLAT_WALL.length)];
      const h = 26 + Math.floor(h1 * 3) * 8;
      this.shadow(x1, y0, y1, h);
      this.box(x0, y0, x1, y1, 0, h, wall, shade(wall, 0.7));
      this.bands(x0, y0, x1, y1, 0, h, 8, 'rgba(50,70,95,0.6)');
      this.box(x0 + 0.2, y0 + 0.2, x0 + 0.45, y0 + 0.45, h, 5, '#9b9b9b');
    } else {
      const ins = 0.1;
      const x0 = x + ins, y0 = y + ins, x1 = x + 1 - ins, y1 = y + 1 - ins;
      const wall = TOWER_WALL[Math.floor(h2 * TOWER_WALL.length)];
      const h = 70 + Math.floor(h1 * 5) * 12;
      this.shadow(x1, y0, y1, h);
      this.box(x0, y0, x1, y1, 0, h, wall, shade(wall, 1.12));
      this.bands(x0, y0, x1, y1, 0, h, 6, 'rgba(30,45,70,0.5)');
      this.box(x0 + 0.25, y0 + 0.25, x1 - 0.25, y1 - 0.25, h, 8, '#b8c0c8');
    }
  }

  private drawTree(x: number, y: number, v: number, sc: number) {
    this.isoT();
    const p = iso(x, y);
    const img = this.trees[v];
    const w = 26 * sc, h = 36 * sc;
    this.ctx.drawImage(img, p.x - w / 2, p.y - h + 3 * sc, w, h);
  }

  private cylinder(cx: number, cy: number, r: number, h: number, col: string, top?: string) {
    const ctx = this.ctx;
    const p = iso(cx, cy);
    const rx = r * HW * 1.414, ry = r * HH * 1.414;
    const g = ctx.createLinearGradient(p.x - rx, 0, p.x + rx, 0);
    g.addColorStop(0, shade(col, 1.05)); g.addColorStop(1, shade(col, 0.72));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI);
    ctx.lineTo(p.x - rx, p.y - h);
    ctx.ellipse(p.x, p.y - h, rx, ry, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = top ?? shade(col, 1.12);
    ctx.beginPath(); ctx.ellipse(p.x, p.y - h, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  }

  private drawIndustry(kind: string, x: number, y: number, now: number, sel: boolean) {
    this.isoT();
    const ctx = this.ctx;
    if (sel) this.poly([iso(x, y), iso(x + 2, y), iso(x + 2, y + 2), iso(x, y + 2)], 'rgba(255,230,60,0.25)');
    const smoke = (sx: number, sy: number, z: number, n = 4) => {
      for (let i = 0; i < n; i++) {
        const f = ((now / 2600 + i / n + (sx * 7 + sy) * 0.13) % 1);
        const p = iso(sx + f * 0.8, sy - f * 0.5, z + f * 40);
        ctx.fillStyle = `rgba(235,235,235,${0.55 * (1 - f)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 3 + f * 9, 0, Math.PI * 2); ctx.fill();
      }
    };
    if (kind === 'coal_mine') {
      // spoil heap
      const c = iso(x + 0.55, y + 0.55);
      ctx.fillStyle = '#2e2b28';
      ctx.beginPath(); ctx.moveTo(c.x - 26, c.y + 8); ctx.quadraticCurveTo(c.x - 4, c.y - 34, c.x + 22, c.y + 10); ctx.closePath(); ctx.fill();
      this.box(x + 1.1, y + 0.2, x + 1.8, y + 0.9, 0, 12, '#8b6f5a', '#6d5a4d');
      // headframe
      const b1 = iso(x + 1.2, y + 1.5), b2 = iso(x + 1.7, y + 1.5), top = iso(x + 1.45, y + 1.3, 48);
      ctx.strokeStyle = '#3a3f46';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b1.x, b1.y); ctx.lineTo(top.x, top.y); ctx.lineTo(b2.x, b2.y);
      ctx.moveTo((b1.x + top.x) / 2, (b1.y + top.y) / 2); ctx.lineTo((b2.x + top.x) / 2, (b2.y + top.y) / 2);
      ctx.stroke();
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(top.x, top.y - 3, 5, 0, Math.PI * 2); ctx.stroke();
      this.box(x + 0.2, y + 1.2, x + 0.9, y + 1.8, 0, 9, '#a9713f');
    } else if (kind === 'power_station') {
      for (const [tx, ty] of [[x + 0.6, y + 0.6], [x + 1.45, y + 0.55]]) {
        const p = iso(tx, ty);
        const rb = 22, rw = 15, rt = 17, h = 52;
        const g = ctx.createLinearGradient(p.x - rb, 0, p.x + rb, 0);
        g.addColorStop(0, '#e2e2de'); g.addColorStop(1, '#a3a39e');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p.x - rb, p.y);
        ctx.quadraticCurveTo(p.x - rw, p.y - h * 0.6, p.x - rt, p.y - h);
        ctx.lineTo(p.x + rt, p.y - h);
        ctx.quadraticCurveTo(p.x + rw, p.y - h * 0.6, p.x + rb, p.y);
        ctx.ellipse(p.x, p.y, rb, rb / 2, 0, 0, Math.PI);
        ctx.fill();
        ctx.fillStyle = '#8c8c88';
        ctx.beginPath(); ctx.ellipse(p.x, p.y - h, rt, rt / 2.2, 0, 0, Math.PI * 2); ctx.fill();
        smoke(tx - 0.3, ty - 0.3, 60, 3);
      }
      this.box(x + 0.3, y + 1.2, x + 1.8, y + 1.85, 0, 16, '#b7a58f', '#6f7a84');
      this.box(x + 1.55, y + 1.3, x + 1.7, y + 1.45, 16, 44, '#9a8f86');
    } else if (kind === 'forest' || kind === 'sawmill') {
      if (kind === 'forest') {
        for (let j = 0; j < 9; j++) {
          const tx = x + 0.25 + (j % 3) * 0.6 + hash(j + x) * 0.2, ty = y + 0.25 + Math.floor(j / 3) * 0.6 + hash(j + y) * 0.2;
          this.drawTree(tx, ty, 3, 1.05);
          this.isoT();
        }
        this.box(x + 1.3, y + 1.4, x + 1.8, y + 1.85, 0, 7, '#8b5e3c', '#5a3d27');
      } else {
        this.box(x + 0.2, y + 0.3, x + 1.8, y + 1.0, 0, 14, '#9b7b5b', '#5b4636');
        this.box(x + 1.4, y + 0.4, x + 1.55, y + 0.55, 14, 22, '#7a6b60');
        smoke(x + 1.45, y + 0.45, 38);
        for (let j = 0; j < 3; j++)
          for (let k = 0; k < 3 - j; k++) {
            const p = iso(x + 0.5 + k * 0.28 + j * 0.14, y + 1.5, 4 + j * 6);
            ctx.fillStyle = '#b07b4a';
            ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#e0b788';
            ctx.beginPath(); ctx.arc(p.x - 1, p.y, 2.4, 0, Math.PI * 2); ctx.fill();
          }
      }
    } else if (kind === 'farm') {
      this.box(x + 1.4, y + 0.2, x + 1.9, y + 0.9, 0, 12, '#a8392f', '#5b5b5b');
      this.cylinder(x + 1.65, y + 1.35, 0.18, 30, '#c8ccd0');
      this.box(x + 1.4, y + 1.6, x + 1.8, y + 1.9, 0, 8, '#e8e0cf', '#8a4b3a');
    } else if (kind === 'food_plant') {
      this.box(x + 0.2, y + 0.9, x + 1.6, y + 1.8, 0, 18, '#e6e8ea', '#9aa3ab');
      for (let j = 0; j < 3; j++) this.cylinder(x + 0.45 + j * 0.45, y + 0.45, 0.17, 34, '#d4d8dc');
      this.box(x + 1.65, y + 1.2, x + 1.8, y + 1.35, 0, 48, '#b0a69e');
      smoke(x + 1.72, y + 1.27, 50);
    }
  }

  private drawStation(st: Station, sel: boolean) {
    this.isoT();
    const ctx = this.ctx;
    const x = st.x, y = st.y;
    if (st.kind === 'road') {
      this.box(x + 0.62, y + 0.1, x + 0.9, y + 0.38, 0, 9, '#4d6e8c', '#2f4a63');
      const p = iso(x + 0.15, y + 0.85);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - 16); ctx.stroke();
      ctx.fillStyle = '#e8342a';
      ctx.beginPath(); ctx.arc(p.x, p.y - 18, 4, 0, Math.PI * 2); ctx.fill();
    } else if (st.kind === 'rail') {
      const d = st.dir;
      const l = Math.hypot(DX[d], DY[d]);
      const ux = DX[d] / l, uy = DY[d] / l, nx = -uy, ny = ux;
      for (const side of [-1, 1]) {
        const cx = x + 0.5 + nx * 0.36 * side, cy = y + 0.5 + ny * 0.36 * side;
        const pts = [[-0.5, -0.07], [0.5, -0.07], [0.5, 0.07], [-0.5, 0.07]].map(([a, b]) => ({ x: cx + ux * a + nx * b, y: cy + uy * a + ny * b }));
        const z = 13;
        this.poly(pts.map((p) => iso(p.x, p.y, z)), '#7a8794');
        for (const q of [pts[0], pts[1]]) {
          const b = iso(q.x, q.y), t = iso(q.x, q.y, z);
          ctx.strokeStyle = '#555c63'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        }
      }
    } else if (st.kind === 'metro') {
      this.box(x + 0.35, y + 0.35, x + 0.65, y + 0.65, 0, 7, '#2b3440', '#1b222b');
      const p = iso(x + 0.5, y + 0.5, 20);
      ctx.fillStyle = '#1f5fbf';
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('M', p.x, p.y + 0.5);
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
      const b = iso(x + 0.5, y + 0.5, 7);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(p.x, p.y + 7); ctx.stroke();
    } else if (st.kind === 'airport') {
      this.box(x - 0.9, y - 0.9, x + 0.6, y - 0.1, 0, 16, '#9ec3db', '#e9eef2');
      this.bands(x - 0.9, y - 0.9, x + 0.6, y - 0.1, 0, 16, 7, 'rgba(30,60,90,0.45)');
      this.box(x + 1.1, y - 0.8, x + 1.35, y - 0.55, 0, 38, '#d9dde1');
      this.box(x + 1.02, y - 0.88, x + 1.43, y - 0.47, 38, 8, '#3d6a8a', '#e8ecef');
    }
    if (sel) {
      const p = iso(x + 0.5, y + 0.5);
      ctx.strokeStyle = '#ffe23c';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, HW * 0.8, HH * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Oriented box on the ground (tile coords) with height in pixels.
  private obox(cx: number, cy: number, a: number, len: number, wid: number, z0: number, h: number, col: string, top?: string) {
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: cx + ux * len * 0.5 * i + nx * wid * 0.5 * j, y: cy + uy * len * 0.5 * i + ny * wid * 0.5 * j }));
    const bottom = c.map((p) => iso(p.x, p.y, z0)), topP = c.map((p) => iso(p.x, p.y, z0 + h));
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4];
      // outward normal of this side in tile space
      const ex = q.x - p.x, ey = q.y - p.y;
      let ox = ey, oy = -ex;
      if (ox * ((p.x + q.x) / 2 - cx) + oy * ((p.y + q.y) / 2 - cy) < 0) { ox = -ox; oy = -oy; } // make it point outward
      if (ox + oy <= 0) continue; // faces away from the camera
      const f = 0.72 + 0.25 * Math.max(0, (ox - oy) / (Math.hypot(ox, oy) * 1.414) + 0.5);
      this.poly([bottom[i], bottom[(i + 1) % 4], topP[(i + 1) % 4], topP[i]], shade(col, f));
    }
    this.poly(topP, top ?? shade(col, 1.08));
  }

  private drawVehicle(v: Vehicle, p: { x: number; y: number; a: number }, car: number, sel: boolean) {
    this.isoT();
    const def = VEHICLES[v.type];
    let x = p.x, y = p.y;
    if (def.station === 'road') {
      // keep left, like the UK
      x += Math.sin(p.a) * 0.12;
      y -= Math.cos(p.a) * 0.12;
    }
    const ctx = this.ctx;
    const sh = iso(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(sh.x + 2, sh.y + 1, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
    if (def.station === 'road') {
      if (v.type === 'truck' || v.type === 'hgv') {
        const L = v.type === 'hgv' ? 0.5 : 0.36;
        this.obox(x - Math.cos(p.a) * 0.06, y - Math.sin(p.a) * 0.06, p.a, L, 0.2, 1, 11, def.color2, '#f4f4f4');
        this.obox(x + Math.cos(p.a) * (L / 2 + 0.02), y + Math.sin(p.a) * (L / 2 + 0.02), p.a, 0.13, 0.2, 1, 9, def.color);
      } else {
        const L = v.type === 'coach' ? 0.56 : 0.48;
        this.obox(x, y, p.a, L, 0.2, 1, 10, def.color, shade(def.color, 1.12));
        this.obox(x, y, p.a, L * 0.96, 0.205, 5, 3, '#23303c');
      }
    } else {
      const loco = car === 0;
      const col = loco ? def.color : v.type === 'freight' ? def.color2 : def.color;
      this.obox(x, y, p.a, 0.56, 0.24, 1.5, v.type === 'freight' && !loco ? 8 : 11, col, loco ? shade(col, 1.1) : undefined);
      if (v.type !== 'freight' || loco) this.obox(x, y, p.a, 0.54, 0.245, 6, 3, loco ? def.color2 : '#27313b');
      if (v.type === 'freight' && !loco) {
        const load = Object.values(v.cargo).reduce((a, b) => a + (b ?? 0), 0);
        if (load > 0) this.obox(x, y, p.a, 0.46, 0.18, 9.5, 1, '#2d2d2d');
      }
    }
    if (sel && car === 0) {
      const q = iso(x, y, 18);
      ctx.fillStyle = '#ffe23c';
      ctx.beginPath(); ctx.moveTo(q.x, q.y + 6); ctx.lineTo(q.x - 5, q.y - 2); ctx.lineTo(q.x + 5, q.y - 2); ctx.fill();
    }
  }

  private drawPlane(v: Vehicle, sel: boolean) {
    this.isoT();
    const ctx = this.ctx;
    const c = this.game.curveOf(v);
    const t = c.length ? v.dist / c.length : 0;
    const p = c.at(v.dist);
    const alt = Math.min(1, t * 5, (1 - t) * 5) * 90;
    const sh = iso(p.x + alt / 200, p.y + alt / 200);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(sh.x, sh.y, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
    const a = p.a, ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const at = (f: number, s: number, z: number) => iso(p.x + ux * f + nx * s, p.y + uy * f + ny * s, alt + z);
    this.poly([at(0.05, -0.55, 3), at(0.2, -0.55, 3), at(0.18, 0, 4), at(0.2, 0.55, 3), at(0.05, 0.55, 3), at(-0.12, 0, 4)], '#c9d1da');
    this.obox(p.x, p.y, a, 1.0, 0.13, alt, 6, VEHICLES.plane.color, '#ffffff');
    this.poly([at(-0.5, 0, 6), at(-0.38, 0, 6), at(-0.46, 0, 16)], VEHICLES.plane.color2);
    if (sel) {
      const q = at(0, 0, 24);
      ctx.fillStyle = '#ffe23c';
      ctx.beginPath(); ctx.moveTo(q.x, q.y + 6); ctx.lineTo(q.x - 5, q.y - 2); ctx.lineTo(q.x + 5, q.y - 2); ctx.fill();
    }
  }
}
