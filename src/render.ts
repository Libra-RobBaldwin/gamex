// Isometric canvas renderer: terrain, smooth roads/rails, 3D-ish buildings, industries, vehicles.
import { STATIONS, VEHICLES, type StationKind, type VehicleId } from './defs';
import { DX, DY, HH, HW, iso, isoInv, type Pt } from './geo';
import { loadOf, type Game, type Station, type Vehicle } from './sim';
import { T_FOREST, T_SAND, T_WATER, valueNoise, rng } from './world';

export interface Float { x: number; y: number; text: string; color: string; t: number }

export interface Overlay {
  stroke: { nodes: number[]; bad: number; color: string } | null;
  catchment: { x: number; y: number; r: number } | null;
  selStation: number | null;
  selVehicle: number | null;
  selIndustry: number | null;
  lineStops: number[];
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
      } else if (STATIONS[st.kind].place === 'offroad') {
        for (const t of st.foot ?? [game.idx(st.x, st.y)]) {
          const tx = t % s.w, ty = Math.floor(t / s.w);
          ctx.fillStyle = st.kind === 'lorry_depot' ? '#8e9094' : '#c9c5bb';
          ctx.fillRect(tx + 0.03, ty + 0.03, 0.94, 0.94);
        }
        if (st.kind !== 'lorry_depot') {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = 0.025;
          for (const t of st.foot ?? []) {
            const tx = t % s.w, ty = Math.floor(t / s.w);
            ctx.beginPath();
            for (let k = 1; k < 4; k++) { ctx.moveTo(tx + k * 0.25, ty + 0.15); ctx.lineTo(tx + k * 0.25, ty + 0.45); }
            ctx.stroke();
          }
        } else {
          ctx.strokeStyle = '#e8c33a';
          ctx.lineWidth = 0.03;
          ctx.strokeRect(st.x + 0.12, st.y + 0.12, 0.76, 0.76);
        }
      } else if (st.kind === 'loading_bay') {
        const d = st.dir, l = Math.hypot(DX[d], DY[d]);
        const ux = DX[d] / l, uy = DY[d] / l;
        ctx.strokeStyle = '#e8c33a';
        ctx.lineWidth = 0.035;
        for (const side of [-1, 1]) {
          const cx = st.x + 0.5 - uy * 0.3 * side, cy = st.y + 0.5 + ux * 0.3 * side;
          ctx.beginPath();
          ctx.moveTo(cx - ux * 0.4, cy - uy * 0.4); ctx.lineTo(cx + ux * 0.4, cy + uy * 0.4);
          ctx.stroke();
        }
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
    const tags: { x: number; y: number; z: number; n: number; cap: number; pax: boolean }[] = [];
    const queue = new Map<number, number>();
    for (const v of s.vehicles) {
      const def = VEHICLES[v.type];
      if (def.mode === 'air') { if (v.state === 'move') flying.push(v); continue; }
      if (def.mode === 'metro') continue;
      let back = 0;
      if (v.state === 'load' && def.mode === 'road') {
        const key = v.stops[v.target];
        const q = queue.get(key) ?? 0;
        back = q;
        queue.set(key, q + Renderer.plan(v.type).reduce((a, p) => a + p.len, 0) + 0.06);
      }
      const parts = this.vehicleParts(v, back);
      if (!parts.length) continue;
      parts.forEach((pt) => objs.push({ k: pt.x + pt.y, draw: () => this.drawSegment(v.type, pt, loadOf(v) / def.capacity) }));
      const mid = parts[Math.floor((parts.length - 1) / 2)];
      tags.push({ x: mid.x, y: mid.y, z: def.height + 14, n: loadOf(v), cap: def.capacity, pax: def.pax });
      if (v.id === ov.selVehicle) objs.push({ k: parts[0].x + parts[0].y + 0.01, draw: () => this.marker(parts[0].x, parts[0].y, def.height + 30) });
    }
    objs.sort((a, b) => a.k - b.k);
    for (const o of objs) o.draw();

    // metro trains as glowing dots on the tunnel overlay
    this.tileT();
    for (const v of s.vehicles) {
      if (VEHICLES[v.type].mode !== 'metro' || v.state !== 'move') continue;
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
    if (this.cam.zoom >= 0.6) {
      for (const t of tags) {
        const p = this.tileToScreen(t.x, t.y, t.z);
        if (p.x < -40 || p.x > this.cssW + 40 || p.y < -40 || p.y > this.cssH + 40) continue;
        this.loadTag(p.x, p.y, t.n, t.cap, t.pax);
      }
      for (const v of flying) {
        const c = game.curveOf(v);
        const q = c.at(v.dist);
        const tt = c.length ? v.dist / c.length : 0;
        const alt = Math.min(1, tt * 5, (1 - tt) * 5) * 90;
        const p = this.tileToScreen(q.x, q.y, alt + 26);
        this.loadTag(p.x, p.y, loadOf(v), VEHICLES[v.type].capacity, true);
      }
    }
    ov.lineStops.forEach((id, i) => {
      const st = game.station(id);
      if (!st) return;
      const p = this.tileToScreen(st.x + 0.5, st.y + 0.5, 34);
      ctx.fillStyle = '#4cc3ff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#062033';
      ctx.font = '800 12px Inter, system-ui, sans-serif';
      ctx.fillText(String(i + 1), p.x, p.y + 0.5);
    });
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
    const d = st.dir, l = Math.hypot(DX[d], DY[d]);
    const ux = DX[d] / l, uy = DY[d] / l, nx = -uy, ny = ux;
    const a = Math.atan2(uy, ux);
    const kind = st.kind;
    if (kind === 'bus_stop' || kind === 'road') {
      // a shelter and flag on the left-hand kerb for each direction
      for (const side of [1, -1]) {
        const cx = x + 0.5 + nx * 0.33 * side * -1, cy = y + 0.5 + ny * 0.33 * side * -1;
        this.obox(cx, cy, a, 0.26, 0.08, 0, 8, '#7fa7c4', '#3c5566', ['#9cc0d8', '#6d8fa6', '#9cc0d8', '#6d8fa6']);
        const fx = cx + ux * 0.2 * side, fy = cy + uy * 0.2 * side;
        const b = iso(fx, fy), t = iso(fx, fy, 15);
        ctx.strokeStyle = '#5b6067'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        // bus stop flag: white plate with a red band
        ctx.fillStyle = '#f4f4f4';
        ctx.fillRect(t.x - 2.6, t.y - 6, 5.2, 6);
        ctx.fillStyle = '#d8342c';
        ctx.fillRect(t.x - 2.6, t.y - 6, 5.2, 2);
      }
    } else if (kind === 'loading_bay') {
      for (const side of [1, -1]) {
        const cx = x + 0.5 - nx * 0.4 * side, cy = y + 0.5 - ny * 0.4 * side;
        this.obox(cx + ux * 0.25, cy + uy * 0.25, a, 0.06, 0.06, 0, 5, '#f07c1e');
        this.obox(cx - ux * 0.25, cy - uy * 0.25, a, 0.06, 0.06, 0, 5, '#f07c1e');
      }
    } else if (kind === 'bus_station') {
      // canopy on posts beside the bays, with a small office
      // office at the back, canopy over a passenger island beside the bay
      this.obox(x + 0.5 - ux * 0.36 + nx * 0.3, y + 0.5 - uy * 0.36 + ny * 0.3, a, 0.2, 0.26, 0, 11, '#b95c3c', '#6b4a3a');
      const cx = x + 0.5 + ux * 0.05 - nx * 0.3, cy = y + 0.5 + uy * 0.05 - ny * 0.3;
      this.obox(cx, cy, a, 0.6, 0.16, 0, 1.5, '#d9d6cc');
      for (const f of [-0.25, 0.25]) {
        const b = iso(cx + ux * f, cy + uy * f), t = iso(cx + ux * f, cy + uy * f, 12);
        ctx.strokeStyle = '#6b7079'; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }
      this.obox(cx, cy, a, 0.66, 0.3, 12, 2, '#e6e8ea', '#b9c3cc');
    } else if (kind === 'bus_interchange') {
      const foot = st.foot ?? [];
      const xs = foot.map((t) => (t % this.game.s.w) + 0.5), ys = foot.map((t) => Math.floor(t / this.game.s.w) + 0.5);
      const mx = xs.reduce((p, q) => p + q, 0) / (xs.length || 1), my = ys.reduce((p, q) => p + q, 0) / (ys.length || 1);
      // terminal building at the back, long canopy over the bays
      this.obox(mx - ux * 0.55, my - uy * 0.55, a, 0.55, 1.5, 0, 18, '#9ec3db', '#eef2f5');
      this.bandsO(mx - ux * 0.55, my - uy * 0.55, a, 0.55, 1.5, 18, 6);
      for (const f of [-0.6, 0, 0.6]) {
        const px = mx + ux * 0.3 + nx * f, py = my + uy * 0.3 + ny * f;
        const b = iso(px, py), t = iso(px, py, 15);
        ctx.strokeStyle = '#6b7079'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }
      this.obox(mx + ux * 0.3, my + uy * 0.3, a, 0.5, 1.6, 15, 2.5, '#f2f3f4', '#c6ccd2');
    } else if (kind === 'lorry_depot') {
      this.obox(x + 0.5 - ux * 0.22, y + 0.5 - uy * 0.22, a, 0.5, 0.8, 0, 16, '#b8b2a6', '#7b858e');
      // roller doors on the side facing the yard
      for (const f of [-0.22, 0.18]) this.obox(x + 0.5 + ux * 0.04 + nx * f, y + 0.5 + uy * 0.04 + ny * f, a, 0.012, 0.2, 1, 10, '#8a8f96');
      for (const f of [-0.2, 0.2]) this.obox(x + 0.5 + ux * 0.28 + nx * f, y + 0.5 + uy * 0.28 + ny * f, a, 0.1, 0.1, 0, 4, '#a97f4f');
    } else if (kind === 'rail') {
      for (const side of [-1, 1]) {
        const cx = x + 0.5 + nx * 0.36 * side, cy = y + 0.5 + ny * 0.36 * side;
        const pts = [[-0.5, -0.07], [0.5, -0.07], [0.5, 0.07], [-0.5, 0.07]].map(([p, q]) => ({ x: cx + ux * p + nx * q, y: cy + uy * p + ny * q }));
        const z = 13;
        this.poly(pts.map((p) => iso(p.x, p.y, z)), '#7a8794');
        for (const q of [pts[0], pts[1]]) {
          const b = iso(q.x, q.y), t = iso(q.x, q.y, z);
          ctx.strokeStyle = '#555c63'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        }
      }
    } else if (kind === 'metro') {
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
    } else if (kind === 'airport') {
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

  // Window bands on the visible faces of an oriented box.
  private bandsO(cx: number, cy: number, a: number, len: number, wid: number, h: number, step: number) {
    for (let z = step * 0.5; z + step * 0.4 < h; z += step) this.obox(cx, cy, a, len + 0.004, wid + 0.004, z, step * 0.4, 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', undefined, 'rgba(35,60,90,0.5)');
  }

  // Oriented box on the ground (tile coords) with height in pixels.
  // faces: colours for [left side, front, right side, back]; top 'none' skips the lid.
  private obox(cx: number, cy: number, a: number, len: number, wid: number, z0: number, h: number, col: string, top?: string, faces?: string[], tint?: string) {
    const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
    const c = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: cx + ux * len * 0.5 * i + nx * wid * 0.5 * j, y: cy + uy * len * 0.5 * i + ny * wid * 0.5 * j }));
    const bottom = c.map((p) => iso(p.x, p.y, z0)), topP = c.map((p) => iso(p.x, p.y, z0 + h));
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4];
      const ex = q.x - p.x, ey = q.y - p.y;
      let ox = ey, oy = -ex;
      if (ox * ((p.x + q.x) / 2 - cx) + oy * ((p.y + q.y) / 2 - cy) < 0) { ox = -ox; oy = -oy; }
      if (ox + oy <= 0) continue; // faces away from the camera
      const f = 0.72 + 0.25 * Math.max(0, (ox - oy) / (Math.hypot(ox, oy) * 1.414) + 0.5);
      const fc = tint ?? faces?.[[0, 1, 2, 3][i]] ?? col;
      this.poly([bottom[i], bottom[(i + 1) % 4], topP[(i + 1) % 4], topP[i]], fc.startsWith('#') ? shade(fc, f) : fc);
    }
    if (top !== 'none') this.poly(topP, top ?? shade(col, 1.08));
  }

  private marker(x: number, y: number, z: number) {
    this.isoT();
    const q = iso(x, y, z);
    const ctx = this.ctx;
    ctx.fillStyle = '#ffe23c';
    ctx.beginPath(); ctx.moveTo(q.x, q.y + 7); ctx.lineTo(q.x - 6, q.y - 2); ctx.lineTo(q.x + 6, q.y - 2); ctx.fill();
  }

  private loadTag(x: number, y: number, n: number, cap: number, pax: boolean) {
    const ctx = this.ctx;
    const text = pax ? `${n}` : `${n}t`;
    ctx.font = '700 11px Inter, system-ui, sans-serif';
    const w = Math.max(30, ctx.measureText(text).width + 14), h = 19;
    ctx.fillStyle = 'rgba(14,18,26,0.86)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, 6); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - 2.5);
    const f = Math.max(0, Math.min(1, n / cap));
    const bw = w - 8;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x - bw / 2, y + 4, bw, 3);
    ctx.fillStyle = f > 0.9 ? '#ff7a4d' : f > 0.6 ? '#ffc53d' : '#3ecf7a';
    ctx.fillRect(x - bw / 2, y + 4, bw * f, 3);
  }

  // ---------- vehicles ----------
  static plan(type: VehicleId): { len: number; kind: string }[] {
    const d = VEHICLES[type];
    switch (type) {
      case 'bendy': return [{ len: 0.4, kind: 'bus' }, { len: 0.36, kind: 'busrear' }];
      case 'hgv': return [{ len: 0.17, kind: 'tractor' }, { len: 0.5, kind: 'trailer' }];
      case 'minibus': return [{ len: d.len, kind: 'minibus' }];
      case 'decker': case 'decker_coach': return [{ len: d.len, kind: 'decker' }];
      case 'coach': return [{ len: d.len, kind: 'coach' }];
      case 'van': return [{ len: d.len, kind: 'van' }];
      case 'truck': return [{ len: d.len, kind: 'truck' }];
      case 'bus': return [{ len: d.len, kind: 'bus' }];
      default: return Array.from({ length: d.cars }, (_, i) => ({ len: d.len, kind: i === 0 ? 'loco' : type === 'freight' ? 'wagon' : 'car' }));
    }
  }

  private vehicleParts(v: Vehicle, back = 0) {
    const def = VEHICLES[v.type];
    const w = this.game.s.w;
    const c = this.game.curveOf(v);
    const moving = v.path.length > 1 && c.length > 0;
    const n0 = v.path[0];
    const ha = v.heading >= 0 ? Math.atan2(DY[v.heading], DX[v.heading]) : 0;
    const at = (d: number) => {
      if (!moving) return { x: (n0 % w) + 0.5 + Math.cos(ha) * d, y: Math.floor(n0 / w) + 0.5 + Math.sin(ha) * d, a: ha };
      if (d < 0) { const p = c.at(0); return { x: p.x + Math.cos(p.a) * d, y: p.y + Math.sin(p.a) * d, a: p.a }; }
      return c.at(d);
    };
    const front = (moving ? v.dist : 0) - back;
    let off = 0;
    return Renderer.plan(v.type).map((sg, i) => {
      const p = at(front - off - sg.len / 2);
      off += sg.len + (def.mode === 'road' ? 0.02 : 0.05);
      let x = p.x, y = p.y;
      if (def.mode === 'road') { x += Math.sin(p.a) * 0.12; y -= Math.cos(p.a) * 0.12; } // keep left
      return { x, y, a: p.a, len: sg.len, kind: sg.kind, i };
    });
  }

  private drawSegment(type: VehicleId, p: { x: number; y: number; a: number; len: number; kind: string; i: number }, fill: number) {
    this.isoT();
    const def = VEHICLES[type];
    const ctx = this.ctx;
    const { x, y, a, len: L, kind } = p;
    const ux = Math.cos(a), uy = Math.sin(a);
    const W = def.mode === 'road' ? 0.2 : 0.25;
    const H = def.height;
    const sh = iso(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(sh.x + 2, sh.y + 1.5, L * 22 + 3, 5, 0, 0, Math.PI * 2); ctx.fill();
    const body = def.color, trim = def.color2;
    const glass = '#26343f', screen = '#557487';
    const wheel = (f: number) => this.obox(x + ux * f, y + uy * f, a, 0.085, W + 0.014, 0, 3.4, '#1b1c1f', '#2a2b2e');
    // stack horizontal slices bottom-up; only the last one gets a lid
    const stack = (sl: [number, number, string, string?][], len = L, cx = x, cy = y, lid?: string) =>
      sl.forEach(([z0, z1, col, front], k) => this.obox(cx, cy, a, len, W, z0, z1 - z0, col, k === sl.length - 1 ? lid ?? shade(body, 1.12) : 'none', front ? [col, front, col, col] : undefined));
    const lights = (f: number, z: number) => this.obox(x + ux * f, y + uy * f, a, 0.012, W * 0.86, z, 1.6, '#fff4c2', 'none');
    if (def.mode === 'road') {
      wheel(L * 0.33);
      wheel(-L * 0.33);
    }
    switch (kind) {
      case 'bus': case 'busrear': case 'minibus': {
        const gz = kind === 'minibus' ? 0.5 : 0.45;
        stack([[1.2, H * 0.28, body], [H * 0.28, H * 0.36, trim], [H * 0.36, H * gz, body], [H * gz, H * 0.84, glass, kind === 'busrear' ? glass : screen], [H * 0.84, H, body]]);
        if (kind !== 'busrear') lights(L / 2, 2.2);
        this.obox(x - ux * L * 0.15, y - uy * L * 0.15, a, 0.12, 0.1, H, 1.8, '#c9ced3');
        if (kind === 'busrear') this.obox(x + ux * (L / 2 + 0.01), y + uy * (L / 2 + 0.01), a, 0.03, W * 0.9, 1.5, H - 2, '#2d2f33');
        break;
      }
      case 'decker':
        stack([[1.2, H * 0.2, body], [H * 0.2, H * 0.42, glass, screen], [H * 0.42, H * 0.54, type === 'decker_coach' ? trim : body], [H * 0.54, H * 0.84, glass, screen], [H * 0.84, H, body]]);
        lights(L / 2, 2.2);
        break;
      case 'coach':
        stack([[1.2, H * 0.22, trim], [H * 0.22, H * 0.4, body], [H * 0.4, H * 0.86, glass, screen], [H * 0.86, H, body]]);
        lights(L / 2, 2.2);
        break;
      case 'van': {
        const cabF = L * 0.33;
        stack([[1.2, H, body]], L * 0.66, x - ux * L * 0.17, y - uy * L * 0.17);
        stack([[1.2, H * 0.5, body], [H * 0.5, H * 0.85, glass, screen], [H * 0.85, H * 0.92, body]], cabF, x + ux * (L / 2 - cabF / 2), y + uy * (L / 2 - cabF / 2));
        lights(L / 2, 2.2);
        break;
      }
      case 'truck': case 'tractor': {
        const cab = kind === 'tractor' ? L : 0.15;
        const cx = x + ux * (L / 2 - cab / 2), cy = y + uy * (L / 2 - cab / 2);
        stack([[1.2, H * 0.5, body], [H * 0.5, H * 0.8, glass, screen], [H * 0.8, H * 0.95, body]], cab, cx, cy);
        this.obox(x + ux * (L / 2 - 0.006), y + uy * (L / 2 - 0.006), a, 0.012, W * 0.86, 2, 1.6, '#fff4c2', 'none');
        if (kind === 'truck') {
          const bl = L - cab - 0.02, bx = x - ux * (cab + 0.02) / 2, by = y - uy * (cab + 0.02) / 2;
          stack([[2.4, H * 0.62, trim], [H * 0.62, H * 0.74, body], [H * 0.74, H + 1, trim]], bl, bx, by, '#f6f6f6');
        }
        break;
      }
      case 'trailer':
        wheel(-L * 0.18);
        stack([[2.6, H * 0.6, trim], [H * 0.6, H * 0.72, body], [H * 0.72, H + 1, trim]], L, x, y, '#f6f6f6');
        break;
      case 'loco':
        stack([[1.5, H * 0.45, body], [H * 0.45, H * 0.78, glass, screen], [H * 0.78, H, trim]]);
        lights(L / 2, 2.5);
        break;
      case 'car':
        stack([[1.5, H * 0.45, body], [H * 0.45, H * 0.78, glass], [H * 0.78, H, body]]);
        break;
      case 'wagon':
        stack([[1.5, H, trim]], L, x, y, shade(trim, 0.7));
        if (fill > 0.02) this.obox(x, y, a, L * 0.9, W * 0.8, H - 1, 1.2, '#2d2d2d', '#3a3632', undefined);
        break;
    }
  }

  // A picture of a vehicle model, for the picker.
  thumbVehicle(type: VehicleId): string {
    return this.thumb(() => {
      const parts = Renderer.plan(type);
      const total = parts.reduce((s2, p) => s2 + p.len, 0);
      let off = total / 2;
      parts.forEach((sg, i) => { this.drawSegment(type, { x: off - sg.len / 2, y: 0, a: 0, len: sg.len, kind: sg.kind, i }, 0.7); off -= sg.len + 0.02; });
    }, 1 + Math.max(0, VEHICLES[type].len * VEHICLES[type].cars - 0.6));
  }

  thumbStation(kind: StationKind): string {
    return this.thumb(() => {
      const st: Station = { id: -1, kind, x: -0.5, y: -0.5, name: '', waiting: {}, dir: 0, overflow: 0 };
      const ctx = this.ctx;
      const place = STATIONS[kind].place;
      this.tileT();
      ctx.fillStyle = '#7aa24f';
      ctx.fillRect(-1.5, -1.5, 3, 3);
      if (place === 'kerb' || place === 'offroad') {
        ctx.fillStyle = '#50545a';
        const ry = place === 'offroad' ? 0.5 : -0.2;
        ctx.fillRect(-1.5, ry, 3, 0.42);
        if (place === 'offroad') {
          st.dir = 2;
          st.y = -0.5;
          ctx.fillStyle = kind === 'lorry_depot' ? '#8e9094' : '#c9c5bb';
          ctx.fillRect(kind === 'bus_interchange' ? -1.5 : -0.47, kind === 'bus_interchange' ? -1.5 : -0.47, kind === 'bus_interchange' ? 2 : 0.94, kind === 'bus_interchange' ? 2 : 0.94);
          if (kind === 'bus_interchange') st.foot = [];
        }
      }
      if (kind === 'bus_interchange') {
        // fake footprint centred on the tile
        this.isoT();
        this.obox(-0.55, 0, Math.PI / 2, 0.55, 1.5, 0, 18, '#9ec3db', '#eef2f5');
        this.obox(0.3, 0, Math.PI / 2, 0.5, 1.6, 15, 2.5, '#f2f3f4', '#c6ccd2');
        return;
      }
      this.drawStation(st, false);
    }, 1.1);
  }

  private thumb(draw: () => void, scale: number): string {
    const W = 150, H = 96;
    const c = document.createElement('canvas');
    c.width = W * 2; c.height = H * 2;
    const saved = { ctx: this.ctx, k: this.k, ox: this.ox, oy: this.oy };
    this.ctx = c.getContext('2d')!;
    this.k = (2 * 2.3) / scale;
    this.ox = W;
    this.oy = H * 1.2;
    try { draw(); } finally {
      this.ctx = saved.ctx; this.k = saved.k; this.ox = saved.ox; this.oy = saved.oy;
    }
    return c.toDataURL();
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
