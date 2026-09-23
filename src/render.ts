// Canvas renderer: baked terrain, auto-joined roads/rails, sprites, vehicles, overlays.
import { BUILDINGS, STATIONS, VEHICLES, type Mode } from './data';
import { Game, vehiclePos } from './sim';
import { makeSprites, type Sprites } from './sprites';
import { T_FOREST, T_GRASS, T_MOUNTAIN, T_SAND, T_WATER, rng } from './world';

export const TILE = 16;

export interface Float { x: number; y: number; text: string; color: string; t: number }

export interface Overlay {
  preview: { tiles: number[]; ok: boolean } | null;
  catchment: { x: number; y: number; r: number } | null;
  selectedStation: number | null;
  selectedBuilding: number | null;
  selectedVehicle: number | null;
  floats: Float[];
}

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  game: Game;
  sprites: Sprites;
  cam = { x: 0, y: 0, zoom: 2.2 };
  private terrain: HTMLCanvasElement;
  private dpr = 1;
  cssW = 0;
  cssH = 0;

  constructor(canvas: HTMLCanvasElement, game: Game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.game = game;
    this.sprites = makeSprites();
    this.terrain = this.bakeTerrain();
    this.cam.x = game.s.start.x * TILE;
    this.cam.y = game.s.start.y * TILE;
    this.resize();
  }

  setGame(g: Game) {
    this.game = g;
    this.terrain = this.bakeTerrain();
    this.cam.x = g.s.start.x * TILE;
    this.cam.y = g.s.start.y * TILE;
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
    this.cam.zoom = Math.max(1, Math.min(6, this.cam.zoom));
    this.cam.x = Math.max(0, Math.min(s.w * TILE, this.cam.x));
    this.cam.y = Math.max(0, Math.min(s.h * TILE, this.cam.y));
  }

  screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.cssW / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.cssH / 2) / this.cam.zoom + this.cam.y,
    };
  }

  worldToScreen(wx: number, wy: number) {
    return { x: (wx - this.cam.x) * this.cam.zoom + this.cssW / 2, y: (wy - this.cam.y) * this.cam.zoom + this.cssH / 2 };
  }

  screenToTile(sx: number, sy: number) {
    const w = this.screenToWorld(sx, sy);
    return { x: Math.floor(w.x / TILE), y: Math.floor(w.y / TILE) };
  }

  private bakeTerrain(): HTMLCanvasElement {
    const s = this.game.s;
    const c = document.createElement('canvas');
    c.width = s.w * TILE;
    c.height = s.h * TILE;
    const ctx = c.getContext('2d')!;
    const r = rng(s.seed ^ 0x5eed);
    const t = (x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? T_WATER : s.terrain[y * s.w + x]);
    for (let y = 0; y < s.h; y++)
      for (let x = 0; x < s.w; x++) {
        const k = t(x, y), px = x * TILE, py = y * TILE;
        const speck = (cols: string[], n: number) => {
          for (let i = 0; i < n; i++) {
            ctx.fillStyle = cols[(r() * cols.length) | 0];
            ctx.fillRect(px + ((r() * 16) | 0), py + ((r() * 16) | 0), 1, 1);
          }
        };
        if (k === T_WATER) {
          ctx.fillStyle = '#2e63a0';
          ctx.fillRect(px, py, TILE, TILE);
          speck(['#3a74b4', '#28598f'], 10);
          if (r() < 0.35) { ctx.fillStyle = '#5b93cf'; ctx.fillRect(px + ((r() * 10) | 0), py + ((r() * 14) | 0), 4, 1); }
          // foam against land
          ctx.fillStyle = '#9fc9ee';
          if (t(x, y - 1) !== T_WATER) ctx.fillRect(px, py, TILE, 1);
          if (t(x, y + 1) !== T_WATER) ctx.fillRect(px, py + 15, TILE, 1);
          if (t(x - 1, y) !== T_WATER) ctx.fillRect(px, py, 1, TILE);
          if (t(x + 1, y) !== T_WATER) ctx.fillRect(px + 15, py, 1, TILE);
        } else if (k === T_SAND) {
          ctx.fillStyle = '#d8c287';
          ctx.fillRect(px, py, TILE, TILE);
          speck(['#c8b074', '#e6d49d'], 14);
        } else if (k === T_MOUNTAIN) {
          ctx.fillStyle = '#5d6b3a';
          ctx.fillRect(px, py, TILE, TILE);
          // a little peak
          const h = 11 + ((r() * 4) | 0);
          for (let i = 0; i < h; i++) {
            const half = Math.floor((i / h) * 8);
            const yy = py + (16 - h) + i;
            ctx.fillStyle = '#6f6a62';
            ctx.fillRect(px + 8 - half, yy, half, 1);
            ctx.fillStyle = '#4f4b45';
            ctx.fillRect(px + 8, yy, half, 1);
            if (i < 3) { ctx.fillStyle = '#eef2f5'; ctx.fillRect(px + 8 - half, yy, half * 2, 1); }
          }
        } else {
          ctx.fillStyle = k === T_FOREST ? '#4b7d2c' : '#5c9236';
          ctx.fillRect(px, py, TILE, TILE);
          speck(k === T_FOREST ? ['#3f6d24', '#588c33'] : ['#4f8430', '#6aa33e', '#679f3b'], 18);
          if (k === T_GRASS && r() < 0.08) speck(['#f2e36b', '#f7f7f7', '#e97aa1'], 2);
          if (k === T_FOREST && r() < 0.5) {
            ctx.fillStyle = '#2f5a1c';
            const bx = px + 3 + ((r() * 8) | 0), by = py + 3 + ((r() * 8) | 0);
            ctx.fillRect(bx, by, 3, 2);
            ctx.fillRect(bx + 1, by - 1, 1, 1);
          }
        }
      }
    return c;
  }

  draw(now: number, ov: Overlay) {
    const { ctx, game } = this;
    const s = game.s;
    const z = this.cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1f4f86';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const ox = -this.cam.x * z + (this.cssW / 2) * this.dpr;
    const oy = -this.cam.y * z + (this.cssH / 2) * this.dpr;
    ctx.setTransform(z, 0, 0, z, ox, oy);
    ctx.drawImage(this.terrain, 0, 0);

    const tl = this.screenToTile(0, 0), br = this.screenToTile(this.cssW, this.cssH);
    const x0 = Math.max(0, tl.x - 1), y0 = Math.max(0, tl.y - 1);
    const x1 = Math.min(s.w - 1, br.x + 1), y1 = Math.min(s.h - 1, br.y + 1);

    // water shimmer
    ctx.fillStyle = 'rgba(200,230,255,0.55)';
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (s.terrain[y * s.w + x] !== T_WATER) continue;
        const ph = Math.sin(now / 700 + x * 1.7 + y * 2.3);
        if (ph > 0.85) ctx.fillRect(x * TILE + ((x * 7 + y * 3) % 12), y * TILE + ((x * 5 + y * 11) % 14), 3, 1);
      }

    // infrastructure
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const v = s.infra[y * s.w + x];
        if (!v) continue;
        const water = s.terrain[y * s.w + x] === T_WATER;
        if (v & 1) this.drawTrack(x, y, 1, water);
        if (v & 2) this.drawTrack(x, y, 2, water);
      }

    // build preview
    if (ov.preview) {
      ctx.fillStyle = ov.preview.ok ? 'rgba(120,255,120,0.35)' : 'rgba(255,80,80,0.4)';
      for (const t of ov.preview.tiles) ctx.fillRect((t % s.w) * TILE, ((t / s.w) | 0) * TILE, TILE, TILE);
    }

    // catchment
    const drawCatch = (x: number, y: number, r: number, col: string) => {
      ctx.fillStyle = col;
      ctx.fillRect((x - r) * TILE, (y - r) * TILE, (2 * r + 1) * TILE, (2 * r + 1) * TILE);
      ctx.strokeStyle = 'rgba(255,255,160,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect((x - r) * TILE + 0.5, (y - r) * TILE + 0.5, (2 * r + 1) * TILE - 1, (2 * r + 1) * TILE - 1);
    };
    if (ov.catchment) drawCatch(ov.catchment.x, ov.catchment.y, ov.catchment.r, 'rgba(255,255,120,0.18)');
    const selSt = ov.selectedStation != null ? game.station(ov.selectedStation) : undefined;
    if (selSt) drawCatch(selSt.x, selSt.y, STATIONS[selSt.mode].radius, 'rgba(120,200,255,0.18)');

    // buildings
    for (const b of s.buildings) {
      if (b.x + b.w < x0 || b.x > x1 + 1 || b.y + b.h < y0 || b.y > y1 + 1) continue;
      const px = b.x * TILE, py = b.y * TILE;
      const def = BUILDINGS[b.kind];
      if (b.kind === 'town') {
        ctx.drawImage(this.sprites.house, px - 1, py - 2);
        ctx.drawImage(this.sprites.house2, px + 16, py + 1);
        ctx.drawImage(this.sprites.house3, px + 2, py + 15);
        ctx.drawImage(this.sprites.house, px + 17, py + 17);
        ctx.fillStyle = '#a88a58';
        ctx.fillRect(px + 14, py + 14, 4, 4);
        continue;
      }
      if (b.kind === 'fishing_spot' || b.kind === 'trout_spot') {
        const ph = (now / 900 + b.id * 0.37) % 1;
        ctx.strokeStyle = `rgba(255,255,255,${0.9 - ph * 0.8})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(px + 8, py + 8, 2 + ph * 6, 1 + ph * 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = b.kind === 'trout_spot' ? '#e6a3a3' : '#dfe9ee';
        if (Math.sin(now / 400 + b.id) > 0.7) ctx.fillRect(px + 7, py + 6, 3, 2);
      } else {
        const sp = this.sprites[b.kind];
        if (sp) ctx.drawImage(sp, px, py);
      }
      if (def.type === 'node' && game.level(def.skill) < def.level) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(px, py, TILE, TILE);
        ctx.drawImage(this.sprites.lock, px + 4, py + 4);
      }
      if (def.type === 'industry') {
        // smoke
        const t = now / 1000 + b.id;
        ctx.fillStyle = 'rgba(220,220,220,0.5)';
        for (let i = 0; i < 3; i++) {
          const f = (t * 0.5 + i / 3) % 1;
          ctx.fillRect(px + 10 + Math.sin(t + i) * 2, py - f * 10, 2 + f * 2, 2 + f * 2);
        }
      }
      if (ov.selectedBuilding === b.id) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, b.w * TILE - 1, b.h * TILE - 1);
      }
    }

    // stations
    for (const st of s.stations) {
      const sp = this.sprites[`stop_${st.mode}`];
      ctx.drawImage(sp, st.x * TILE, st.y * TILE);
      if (st.id === ov.selectedStation) {
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 1;
        ctx.strokeRect(st.x * TILE + 0.5, st.y * TILE + 0.5, TILE - 1, TILE - 1);
      }
    }

    // vehicles
    const airborne: (() => void)[] = [];
    for (const v of s.vehicles) {
      const def = VEHICLES[v.type];
      const draw = () => {
        for (let car = def.cars - 1; car >= 0; car--) {
          const p = vehiclePos(s.w, v, def.mode, car * 0.75);
          const sprite = car === 0 ? this.sprites[v.type] : this.sprites.car;
          this.drawVehicle(sprite, p.x * TILE, p.y * TILE, p.a, def.mode, now, v.id);
        }
        const p = vehiclePos(s.w, v, def.mode);
        const loaded = Object.values(v.cargo).some((n) => (n ?? 0) > 0);
        if (loaded) {
          ctx.fillStyle = '#ffd84a';
          ctx.fillRect(p.x * TILE - 1, p.y * TILE - (def.mode === 'air' ? 16 : 9), 2, 2);
        }
        if (v.state === 'lost') {
          ctx.fillStyle = '#ff3030';
          ctx.fillRect(p.x * TILE - 1, p.y * TILE - 12, 2, 5);
          ctx.fillRect(p.x * TILE - 1, p.y * TILE - 6, 2, 2);
        }
        if (v.id === ov.selectedVehicle) {
          ctx.strokeStyle = '#ffff00';
          ctx.strokeRect(p.x * TILE - 8.5, p.y * TILE - 8.5, 17, 17);
        }
      };
      if (def.mode === 'air') airborne.push(draw);
      else draw();
    }
    for (const d of airborne) d();

    // screen-space text: labels and floating coins
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const label = (text: string, wx: number, wy: number, col: string, size = 13) => {
      const p = this.worldToScreen(wx, wy);
      ctx.font = `${size}px "VT323", monospace`;
      ctx.fillStyle = '#000';
      ctx.fillText(text, p.x + 1, p.y + 1);
      ctx.fillStyle = col;
      ctx.fillText(text, p.x, p.y);
    };
    for (const b of s.buildings)
      if (b.kind === 'town') label(b.name, (b.x + 1) * TILE, b.y * TILE - 2, '#ffff00', 18);
      else if (this.cam.zoom >= 2.5 && BUILDINGS[b.kind].type === 'industry') label(b.name, (b.x + 0.5) * TILE, b.y * TILE - 2, '#ff981f', 15);
    if (this.cam.zoom >= 3)
      for (const st of s.stations) {
        const n = Object.values(st.cargo).reduce((a, b) => a + Math.floor(b ?? 0), 0);
        if (n > 0) label(`▣${n}`, (st.x + 0.5) * TILE, st.y * TILE + 2, '#ffffff', 14);
      }
    for (const f of ov.floats) label(f.text, f.x, f.y - f.t * 14, f.color, 18);
  }

  private drawVehicle(sp: HTMLCanvasElement, x: number, y: number, a: number, mode: Mode, now: number, id: number) {
    const ctx = this.ctx;
    ctx.save();
    if (mode === 'air') {
      const bob = Math.sin(now / 500 + id) * 1.5;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x + 4, y + 8, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.translate(x, y - 8 + bob);
      if (sp === this.sprites.balloon) {
        ctx.drawImage(sp, -8, -12);
        ctx.restore();
        return;
      }
      ctx.rotate(a);
      if (Math.abs(a) > Math.PI / 2) ctx.scale(1, -1);
      ctx.drawImage(sp, -8, -8);
      ctx.restore();
      return;
    }
    ctx.translate(Math.round(x), Math.round(y));
    const q = Math.round(a / (Math.PI / 2)); // 0 east, 1 south, 2/-2 west, -1 north
    if (q === 2 || q === -2) ctx.scale(-1, 1);
    else if (q === 1) ctx.rotate(Math.PI / 2);
    else if (q === -1) ctx.rotate(-Math.PI / 2);
    ctx.drawImage(sp, -8, -8);
    ctx.restore();
  }

  private drawTrack(x: number, y: number, bit: number, water: boolean) {
    const { ctx, game } = this;
    const s = game.s;
    const has = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < s.w && yy < s.h && (s.infra[yy * s.w + xx] & bit) !== 0;
    const px = x * TILE, py = y * TILE;
    const n = has(x, y - 1), so = has(x, y + 1), w = has(x - 1, y), e = has(x + 1, y);
    const horiz = w || e || !(n || so);
    const vert = n || so;
    // Outer (edge) and inner (surface) rects for the centre and each connected arm.
    const outer: number[][] = [[4, 4, 8, 8]];
    const inner: number[][] = [[5, 5, 6, 6]];
    if (n) { outer.push([4, 0, 8, 4]); inner.push([5, 0, 6, 5]); }
    if (so) { outer.push([4, 12, 8, 4]); inner.push([5, 11, 6, 5]); }
    if (w) { outer.push([0, 4, 4, 8]); inner.push([0, 5, 5, 6]); }
    if (e) { outer.push([12, 4, 4, 8]); inner.push([11, 5, 5, 6]); }
    if (water) {
      ctx.fillStyle = '#5a3d20';
      for (const [ax, ay, aw, ah] of outer) ctx.fillRect(px + ax - 2, py + ay - 2, aw + 4, ah + 4);
      ctx.fillStyle = '#8f6a3a';
      for (const [ax, ay, aw, ah] of outer) ctx.fillRect(px + ax - 1, py + ay - 1, aw + 2, ah + 2);
    }
    if (bit === 1) {
      ctx.fillStyle = '#7a6240';
      for (const [ax, ay, aw, ah] of outer) ctx.fillRect(px + ax, py + ay, aw, ah);
      ctx.fillStyle = '#b09366';
      for (const [ax, ay, aw, ah] of inner) ctx.fillRect(px + ax, py + ay, aw, ah);
      return;
    }
    // rail: sleepers + two steel rails
    if (horiz) {
      const xa = w ? 0 : 3, xb = e ? 16 : 13;
      ctx.fillStyle = '#5b3f22';
      for (let sx = xa; sx < xb; sx += 3) ctx.fillRect(px + sx, py + 4, 2, 8);
      ctx.fillStyle = '#c9ccd4';
      ctx.fillRect(px + xa, py + 5, xb - xa, 1);
      ctx.fillRect(px + xa, py + 10, xb - xa, 1);
    }
    if (vert) {
      const ya = n ? 0 : 3, yb = so ? 16 : 13;
      ctx.fillStyle = '#5b3f22';
      for (let sy = ya; sy < yb; sy += 3) ctx.fillRect(px + 4, py + sy, 8, 2);
      ctx.fillStyle = '#c9ccd4';
      ctx.fillRect(px + 5, py + ya, 1, yb - ya);
      ctx.fillRect(px + 10, py + ya, 1, yb - ya);
    }
  }
}
