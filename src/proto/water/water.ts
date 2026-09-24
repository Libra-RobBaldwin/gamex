// The water system: sea, lakes, rivers and canals derived from a height source, and the answers
// the rest of the game needs about them.
//
//   const water = new WaterSystem(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }));
//   const ground = new CachedHeight(water.terrain);   // the ground with river channels cut, and its water
//   water.isWater(x, z), water.depthAt(x, z), water.flowAt(x, z), water.watercourseAt(x, z)…
//
// Hydrology is worked out per region (region.ts); everything finer (the exact shoreline, the
// channel a river cuts, depth, flow) is a pure function of the point, worked out on demand, so
// point queries, tile rasters and meshes all agree and every tile meets its neighbours.

import { BaseHeight, TILE, type GridSpec, type HeightSource } from '../terrain/height';
import { edt } from './flood';
import { buildRegion, cellOf, isRiverTerrain, type Region, type RiverTerrain } from './region';
import { CLASS_OF, ReachIndex, SPILL, capsuleRows, channelY, lerpAt, type Hit, type Reach } from './rivers';
import { DEFAULT_WATER, KIND_CODE, KIND_OF, NAV, type Flow, type WaterKind, type WaterParams, type WaterPoint, type Watercourse } from './types';

// A tile's water as rasters (tile plus a margin all round, so distances near the edge are right).
export interface WaterTile {
  ti: number; tj: number; size: number;
  g: GridSpec; // the raster (margin included)
  margin: number; // cells of margin each side
  ground: Float32Array; // bed / ground, absolute
  level: Float32Array; // water surface (NaN where dry)
  kind: Uint8Array; // KIND_CODE (0 = dry)
  body: Uint16Array; // index into bodies (0xffff = none)
  bodies: string[];
  flowX: Float32Array; flowZ: Float32Array; // m/s
  shore: Float32Array; // signed distance to the waterline, m (+ in water, − on land), capped at the margin
  // the nearest water to each point (itself where wet), spread out across the margin: its kind and
  // level. Dry points beside a stream too narrow for the raster get the stream's level, so the
  // water mesh still covers it.
  nearKind: Uint8Array; nearLevel: Float32Array;
  cover: Uint8Array; // 1 where wet or on a narrow stream's line: where the water mesh must reach
  wet: number; // wet points inside the tile
  ms: number;
}

const NONE = 0xffff;

export class WaterSystem {
  readonly P: WaterParams;
  readonly terrain: WaterTerrain;
  private rt: RiverTerrain | null;
  private regions = new Map<number, { R: Region; index: ReachIndex }>();
  private tiles = new Map<string, WaterTile>();
  private extra: ReachIndex | null = null; // canals and other made watercourses
  private extraReaches: Reach[] = [];
  private hits: Hit[] = [];
  constructor(readonly src: HeightSource, params: Partial<WaterParams> = {}, readonly maxTiles = 24) {
    this.rt = isRiverTerrain(src) ? src : null;
    this.P = { ...DEFAULT_WATER, sea: this.rt ? this.rt.p.sea : null, ...params };
    this.terrain = new WaterTerrain(this);
  }

  // ---------- regions ----------
  region(rx: number, rz: number) {
    const k = (rx + 32768) * 65536 + (rz + 32768);
    let e = this.regions.get(k);
    if (!e) {
      const R = buildRegion(this.src, this.P, rx, rz);
      e = { R, index: new ReachIndex(R.reaches, 48, R.box) };
      this.regions.set(k, e);
    }
    return e;
  }
  regionAt(x: number, z: number) { return this.region(Math.floor(x / this.P.region), Math.floor(z / this.P.region)); }
  get regionCount() { return this.regions.size; }
  // every reach in a region (for drawing maps, route finding, debugging)
  reaches(rx = 0, rz = 0): readonly Reach[] { return this.region(rx, rz).R.reaches; }

  // Made watercourses (canals) join the natural ones: their channels are cut and their water
  // shows. Tiles they touch are forgotten so they're rebuilt.
  addReaches(rs: Reach[]) {
    const base = this.extraReaches.length;
    rs.forEach((r, i) => { r.id = base + i; });
    this.extraReaches.push(...rs);
    this.extra = new ReachIndex(this.extraReaches, 48);
    this.tiles.clear();
  }

  // ---------- the ground and water at a point ----------
  private base(x: number, z: number): { h: number; water: number | null } {
    if (this.rt) return this.rt.baseAt(x, z);
    const h = this.src.heightAt(x, z), w = this.src.waterLevel(x, z);
    return { h, water: w !== null && w > h ? w : null };
  }
  private near(x: number, z: number): Hit[] {
    const hs = this.regionAt(x, z).index.near(x, z, this.hits);
    if (this.extra) for (const h of this.extra.near(x, z)) hs.push(h);
    return hs;
  }
  // the ground with river channels cut into it
  groundAt(x: number, z: number) {
    let h = this.base(x, z).h;
    for (const hit of this.near(x, z)) h = Math.min(h, channelAt(hit));
    return h;
  }
  // Everything about a point in one go.
  probe(x: number, z: number): WaterPoint & { hit: Hit | null } {
    const b = this.base(x, z), hits = this.near(x, z);
    let ground = b.h;
    for (const hit of hits) ground = Math.min(ground, channelAt(hit));
    let rivY = -Infinity, best: Hit | null = null;
    for (const h of hits) {
      const y = riverLevel(h.r, h.i, h.t, h.d, ground);
      if (y > rivY || (y === rivY && best && h.d < best.d)) { rivY = y; best = h; }
    }
    const { R } = this.regionAt(x, z), st = this.settle(R, x, z, ground, b.water ?? NaN, rivY);
    if (!st.code) return { ground, level: null, kind: null, body: null, hit: null };
    const river = st.type === BODY.river ? best : null;
    const kind = river ? segKind(river.r, river.t < 0.5 ? river.i : river.i + 1) : KIND_OF[st.code]!;
    return { ground, level: st.level, kind, body: this.bodyKey(R, st.type, st.id, river?.r ?? null), hit: river };
  }
  // The one rule for which water stands at a point, shared by point queries and tiles: the highest
  // of the sea, the source's own water, a filled hollow and a river whose level is above the ground.
  private st = { level: 0, code: 0, type: 0, id: 0 };
  private settle(R: Region, x: number, z: number, ground: number, srcW: number, rivY: number) {
    const o = this.st, sea = this.P.sea, c = cellOf(R, x, z);
    o.level = -Infinity; o.code = 0; o.type = 0; o.id = 0;
    if (sea !== null && ground < sea && R.seaNear[c]) { o.level = sea; o.code = KIND_CODE.sea; o.type = BODY.sea; }
    if (srcW === srcW && srcW > ground && (sea === null || Math.abs(srcW - sea) > 1e-4) && srcW > o.level) { o.level = srcW; o.code = KIND_CODE.lake; o.type = BODY.lake; o.id = Math.round(srcW * 100); }
    const l = R.lakeNear[c];
    if (l >= 0 && R.basinLevel[l] > ground && R.basinLevel[l] > o.level) { o.level = R.basinLevel[l]; o.code = KIND_CODE.lake; o.type = BODY.basin; o.id = l; }
    if (rivY > o.level) { o.level = rivY; o.type = BODY.river; o.code = KIND_CODE.river; }
    return o;
  }
  private bodyKey(R: Region, type: number, id: number, r: Reach | null) {
    return type === BODY.sea ? 'sea' : type === BODY.lake ? `lake:${id}` : type === BODY.basin ? `basin${R.rx},${R.rz}:${id}` : r ? r.key : '?';
  }
  waterLevelAt(x: number, z: number) { return this.probe(x, z).level; }
  isWater(x: number, z: number) { return this.probe(x, z).level !== null; }
  depthAt(x: number, z: number) { const p = this.probe(x, z); return p.level === null ? 0 : p.level - p.ground; }
  kindAt(x: number, z: number) { return this.probe(x, z).kind; }
  bodyAt(x: number, z: number) { return this.probe(x, z).body; }
  // Which way the water moves here, and how fast (rivers and canals; still water gives speed 0).
  flowAt(x: number, z: number): Flow {
    const p = this.probe(x, z);
    return p.hit ? flowOf(p.hit.r, p.hit.i, p.hit.t, p.hit.d) : { x: 0, z: 0, speed: 0 };
  }
  // Signed distance to the waterline in metres: + in the water, − on land. Beyond `cap` (the tile
  // raster's margin, 64 m by default) it reads ±cap.
  distanceToShore(x: number, z: number) {
    const [ti, tj] = [Math.floor(x / TILE), Math.floor(z / TILE)], t = this.tile(ti, tj);
    return rasterAt(t, t.shore, x, z);
  }
  // The river or canal at (or nearest to, within its banks) a point: class, size, levels, flow,
  // navigation channel and bridge clearance. Null away from any watercourse.
  watercourseAt(x: number, z: number): Watercourse | null {
    let best: Hit | null = null;
    for (const h of this.near(x, z)) if (h.d < lerpAt(h.r.hw, h) + SPILL && (!best || h.d / lerpAt(h.r.hw, h) < best.d / lerpAt(best.r.hw, best))) best = h;
    return best ? watercourse(best) : null;
  }
  // Every watercourse a straight line from a to b crosses (for bridges and the road height solver):
  // where it is wet along the line, where the navigation channel is (keep piers out), and the
  // lowest the deck's underside may be. s is metres from a.
  crossings(a: { x: number; z: number }, b: { x: number; z: number }, step = 2): Crossing[] {
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(2, Math.ceil(L / step) + 1), out: Crossing[] = [];
    let cur: Crossing | null = null;
    for (let k = 0; k < n; k++) {
      const s = (L * k) / (n - 1), x = a.x + ((b.x - a.x) * s) / (L || 1), z = a.z + ((b.z - a.z) * s) / (L || 1), p = this.probe(x, z);
      if (p.level !== null) {
        if (!cur || cur.body !== p.body) {
          if (cur) out.push(cur);
          const wc = p.hit ? watercourse(p.hit) : null, rule = NAV[wc ? wc.cls : p.kind === 'sea' ? 'sea' : 'lake'];
          cur = { body: p.body!, kind: p.kind!, cls: wc?.cls ?? null, s0: s, s1: s, surface: p.level, design: p.level + rule.freeboard, clearance: rule.clearance, soffit: p.level + rule.freeboard + rule.clearance, channel: null, maxDepth: 0, draught: rule.draught };
        }
        cur.s1 = s; cur.maxDepth = Math.max(cur.maxDepth, p.level - p.ground);
        if (p.hit) {
          const wc = watercourse(p.hit);
          if (wc.channel > 0 && Math.abs(wc.offset) <= wc.channel) cur.channel = cur.channel ? [cur.channel[0], s] : [s, s];
        }
      } else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    // lakes and the sea: keep the middle of the crossing clear, as a channel, where deep enough
    for (const c of out) if (!c.channel && c.draught > 0 && c.maxDepth >= c.draught) {
      const w = c.s1 - c.s0, rule = NAV[c.kind === 'sea' ? 'sea' : 'lake'], half = Math.min(w, Math.max(rule.minChannel, w * rule.channel)) / 2, m = (c.s0 + c.s1) / 2;
      c.channel = [m - half, m + half];
    }
    return out;
  }

  // ---------- tiles ----------
  tile(ti: number, tj: number, o: { size?: number; res?: number; margin?: number } = {}): WaterTile {
    const size = o.size ?? TILE, res = o.res ?? 4, mg = Math.round((o.margin ?? 64) / res);
    const key = `${ti},${tj},${size},${res},${mg}`;
    let t = this.tiles.get(key);
    if (t) { this.tiles.delete(key); this.tiles.set(key, t); return t; }
    t = this.buildTile(ti, tj, size, res, mg);
    this.tiles.set(key, t);
    if (this.tiles.size > this.maxTiles) this.tiles.delete(this.tiles.keys().next().value!);
    return t;
  }
  forget() { this.tiles.clear(); }

  // The ground (channels cut) on any grid, fast: base heights in one go, then each river segment
  // stamped onto the points it reaches. Hits per point match near() exactly.
  sampleGround(g: GridSpec, out = new Float32Array(g.nx * g.nz), water?: Float32Array) {
    if (this.rt) this.rt.sampleBase(g, out, water);
    else {
      this.src.sample(g, out);
      if (water) for (let j = 0, k = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++, k++) { const w = this.src.waterLevel(g.x0 + i * g.step, g.z0 + j * g.step); water[k] = w !== null && w > out[k] ? w : NaN; }
    }
    this.stamp(g, (k, r, i, t, d) => { const y = segY(r, i, t, d); if (y < out[k]) out[k] = y; });
    return out;
  }
  // Calls f for every (grid point, segment) pair within the segment's reach, region by region
  // (each point only sees its own region's rivers, as near() does), with the projection onto it.
  private stamp(g: GridSpec, f: (k: number, r: Reach, i: number, t: number, d: number, side: number) => void) {
    const RS = this.P.region, cols = new Int32Array(g.nx), rows = new Int32Array(g.nz);
    for (let i = 0; i < g.nx; i++) cols[i] = Math.floor((g.x0 + i * g.step) / RS);
    for (let j = 0; j < g.nz; j++) rows[j] = Math.floor((g.z0 + j * g.step) / RS);
    for (let rx = cols[0]; rx <= cols[g.nx - 1]; rx++) for (let rz = rows[0]; rz <= rows[g.nz - 1]; rz++) {
      // the part of the grid in this region
      let ci0 = 0, ci1 = g.nx - 1, cj0 = 0, cj1 = g.nz - 1;
      while (ci0 < g.nx && cols[ci0] < rx) ci0++;
      while (ci1 >= 0 && cols[ci1] > rx) ci1--;
      while (cj0 < g.nz && rows[cj0] < rz) cj0++;
      while (cj1 >= 0 && rows[cj1] > rz) cj1--;
      if (ci0 > ci1 || cj0 > cj1) continue;
      const sub = { x0: g.x0 + ci0 * g.step, z0: g.z0 + cj0 * g.step, nx: ci1 - ci0 + 1, nz: cj1 - cj0 + 1 };
      const X1 = sub.x0 + (sub.nx - 1) * g.step, Z1 = sub.z0 + (sub.nz - 1) * g.step;
      const segs = this.region(rx, rz).index.within(sub.x0, sub.z0, X1, Z1);
      if (this.extra) segs.push(...this.extra.within(sub.x0, sub.z0, X1, Z1));
      for (const [r, i] of segs) {
        const ax = r.x[i], az = r.z[i], dx = r.x[i + 1] - ax, dz = r.z[i + 1] - az, L2 = dx * dx + dz * dz || 1, e0 = r.reach[i], e1 = r.reach[i + 1];
        capsuleRows(sub.x0, sub.z0, g.step, sub.nx, sub.nz, ax, az, r.x[i + 1], r.z[i + 1], Math.max(e0, e1), (j, i0, i1) => {
          const z = sub.z0 + j * g.step, row = (cj0 + j) * g.nx + ci0;
          for (let q = i0; q <= i1; q++) {
            const x = sub.x0 + q * g.step;
            let t = ((x - ax) * dx + (z - az) * dz) / L2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = x - (ax + dx * t), pz = z - (az + dz * t), d = Math.sqrt(px * px + pz * pz);
            // the same test as ReachIndex.near (whose hash holds every segment within reach of a point)
            if (d <= e0 + (e1 - e0) * t) f(row + q, r, i, t, d, px * dz - pz * dx >= 0 ? 1 : -1);
          }
        });
      }
    }
  }

  private buildTile(ti: number, tj: number, size: number, res: number, mg: number): WaterTile {
    const t0 = performance.now(), n = Math.round(size / res) + 1 + 2 * mg;
    const g: GridSpec = { x0: ti * size - mg * res, z0: tj * size - mg * res, step: res, nx: n, nz: n }, N = n * n;
    const ground = new Float32Array(N), srcW = new Float32Array(N).fill(NaN);
    this.sampleGround(g, ground, srcW);
    const level = new Float32Array(N).fill(-Infinity), kind = new Uint8Array(N), body = new Uint16Array(N).fill(NONE);
    const flowX = new Float32Array(N), flowZ = new Float32Array(N), bodies: string[] = [], bodyIx = new Map<string, number>();
    // the best river at each point: its reach, segment, position along and distance from it
    const bR = new Array<Reach | null>(N).fill(null), bI = new Int32Array(N), bT = new Float32Array(N), bD = new Float32Array(N), bS = new Int8Array(N);
    const ext = new Float32Array(N).fill(NaN), extKind = new Uint8Array(N);
    // rivers (on the final ground, so a channel's level is judged against the channel)
    this.stamp(g, (k, r, i, t, d, side) => {
      const near = t < 0.5 ? i : i + 1;
      if (r.sub[near]) return;
      const hw = r.hw[i] + (r.hw[i + 1] - r.hw[i]) * t;
      if (d >= hw + SPILL + res) return;
      const y = r.surf[i] + (r.surf[i + 1] - r.surf[i]) * t;
      if (!(ext[k] >= y)) { ext[k] = y; extKind[k] = KIND_CODE[segKind(r, near)]; }
      if (d >= hw + SPILL || !(y > ground[k])) return;
      if (y > level[k] || (y === level[k] && bR[k] && d < bD[k])) { level[k] = y; bR[k] = r; bI[k] = i; bT[k] = t; bD[k] = d; bS[k] = side; }
    });
    const RS = this.P.region;
    let reg = this.region(Math.floor(g.x0 / RS), Math.floor(g.z0 / RS)), lastB = 0, lastType = -1, lastId = -1, lastR: Reach | null = null, lastReg: Region | null = null;
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const x = g.x0 + i * res, z = g.z0 + j * res, rx = Math.floor(x / RS), rz = Math.floor(z / RS);
      if (rx !== reg.R.rx || rz !== reg.R.rz) reg = this.region(rx, rz);
      const R = reg.R, st = this.settle(R, x, z, ground[k], srcW[k], level[k]);
      level[k] = NaN;
      if (!st.code) continue;
      const r = st.type === BODY.river ? bR[k] : null;
      let code = st.code;
      if (r) {
        const near = bT[k] < 0.5 ? bI[k] : bI[k] + 1;
        code = KIND_CODE[segKind(r, near)];
        const f = flowOf(r, bI[k], bT[k], bD[k]); flowX[k] = f.x * f.speed; flowZ[k] = f.z * f.speed;
      }
      // (the body's name is only worked out when it changes from the last point's)
      if (st.type !== lastType || st.id !== lastId || r !== lastR || R !== lastReg) {
        const key = this.bodyKey(R, st.type, st.id, r);
        let b = bodyIx.get(key);
        if (b === undefined) { b = bodies.length; bodies.push(key); bodyIx.set(key, b); }
        lastB = b; lastType = st.type; lastId = st.id; lastR = r; lastReg = R;
      }
      level[k] = st.level; kind[k] = code; body[k] = lastB;
    }
    // signed distance to the waterline (a half cell either side of the change)
    const dry = new Uint8Array(N);
    for (let k = 0; k < N; k++) dry[k] = kind[k] ? 0 : 1;
    const inW = edt(dry, 1, n, n), outW = edt(dry, 0, n, n), shore = new Float32Array(N), cap = mg * res;
    let wet = 0;
    for (let k = 0; k < N; k++) {
      shore[k] = Math.max(-cap, Math.min(cap, kind[k] ? (inW[k] - 0.5) * res : -(outW[k] - 0.5) * res));
      const i = k % n, j = (k - i) / n;
      if (kind[k] && i >= mg && j >= mg && i < n - mg && j < n - mg) wet++;
    }
    // nearest water, by a breadth-first spread from the wet points (and the banks of narrow streams)
    const nearKind = new Uint8Array(N), nearLevel = new Float32Array(N).fill(NaN), q = new Int32Array(N);
    let qh = 0, qt = 0;
    for (let k = 0; k < N; k++) {
      if (kind[k]) { nearKind[k] = kind[k]; nearLevel[k] = level[k]; q[qt++] = k; }
      else if (ext[k] === ext[k]) { nearKind[k] = extKind[k]; nearLevel[k] = ext[k]; q[qt++] = k; }
    }
    while (qh < qt) {
      const c = q[qh++], ci = c % n, cj = (c - ci) / n;
      for (let d = 0; d < 4; d++) {
        const i = ci + (d === 0 ? 1 : d === 1 ? -1 : 0), j = cj + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const m = j * n + i;
        if (nearKind[m]) continue;
        nearKind[m] = nearKind[c]; nearLevel[m] = nearLevel[c]; q[qt++] = m;
      }
    }
    const cover = new Uint8Array(N);
    for (let k = 0; k < N; k++) cover[k] = kind[k] || ext[k] === ext[k] ? 1 : 0;
    return { ti, tj, size, g, margin: mg, ground, level, kind, body, bodies, flowX, flowZ, shore, nearKind, nearLevel, cover, wet, ms: performance.now() - t0 };
  }
}

const BODY = { sea: 1, lake: 2, basin: 3, river: 4 };
// A river's level at a point on segment i of reach r (t along it, d from it), if water stands
// there over this ground; −∞ if not. Point queries and tiles both come through here.
function riverLevel(r: Reach, i: number, t: number, d: number, ground: number): number {
  if (r.sub[t < 0.5 ? i : i + 1]) return -Infinity;
  const hw = r.hw[i] + (r.hw[i + 1] - r.hw[i]) * t;
  if (d >= hw + SPILL) return -Infinity;
  const y = r.surf[i] + (r.surf[i + 1] - r.surf[i]) * t;
  return y > ground ? y : -Infinity;
}
// the channel's floor or bank at that point
function segY(r: Reach, i: number, t: number, d: number) {
  return channelY(d, r.hw[i] + (r.hw[i + 1] - r.hw[i]) * t, r.depth[i] + (r.depth[i + 1] - r.depth[i]) * t, r.surf[i] + (r.surf[i + 1] - r.surf[i]) * t, r.bank);
}
const channelAt = (h: Hit) => segY(h.r, h.i, h.t, h.d);
function segKind(r: Reach, k: number): WaterKind {
  const c = CLASS_OF[r.cls[k]];
  return c === 'estuary' ? 'estuary' : c === 'canal' ? 'canal' : 'river';
}
function flowOf(r: Reach, i: number, t: number, d: number): Flow {
  const dx = r.x[i + 1] - r.x[i], dz = r.z[i + 1] - r.z[i], l = Math.hypot(dx, dz) || 1, hw = r.hw[i] + (r.hw[i + 1] - r.hw[i]) * t;
  // fastest mid-stream, slowing to a third at the banks
  const q = Math.min(1, d / hw), speed = (r.speed[i] + (r.speed[i + 1] - r.speed[i]) * t) * (1 - 0.67 * q * q);
  return { x: dx / l, z: dz / l, speed };
}
function watercourse(h: Hit): Watercourse {
  const r = h.r, cls = CLASS_OF[r.cls[h.t < 0.5 ? h.i : h.i + 1]], rule = NAV[cls], hw = lerpAt(r.hw, h), surface = lerpAt(r.surf, h);
  const w = 2 * hw, ch = rule.channel > 0 ? Math.min(w, Math.max(rule.minChannel, w * rule.channel)) / 2 : 0;
  return {
    cls, reach: r.key, width: w, depth: lerpAt(r.depth, h), surface, design: surface + rule.freeboard, flow: flowOf(r, h.i, h.t, h.d), offset: h.d * h.side,
    channel: ch, clearance: rule.clearance, draught: rule.draught, area: lerpAt(r.area, h),
  };
}
// Bilinear read of a tile raster at a world point.
export function rasterAt(t: WaterTile, a: Float32Array, x: number, z: number) {
  const g = t.g;
  let fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  fx = Math.max(0, Math.min(g.nx - 1.0001, fx)); fz = Math.max(0, Math.min(g.nz - 1.0001, fz));
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * g.nx + i;
  return (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - tz) + (a[k + g.nx] * (1 - tx) + a[k + g.nx + 1] * tx) * tz;
}

export interface Crossing {
  body: string; kind: WaterKind; cls: Watercourse['cls'] | null;
  s0: number; s1: number; // wet from s0 to s1 along the line
  channel: [number, number] | null; // keep piers out of this stretch
  surface: number; design: number; // normal and design (flood) water level
  clearance: number; soffit: number; // headroom needed, and the lowest the deck's underside may be
  maxDepth: number; draught: number;
}

// The ground with channels cut, and the water on it, as a height source for the terrain library
// (meshing, alignment, platforms). Put a CachedHeight in front of it for fast point queries.
export class WaterTerrain extends BaseHeight {
  constructor(readonly water: WaterSystem) { super(); }
  heightAt(x: number, z: number) { return this.water.groundAt(x, z); }
  waterLevel(x: number, z: number) { return this.water.waterLevelAt(x, z); }
  isWater(x: number, z: number) { return this.water.isWater(x, z); }
  sample(g: GridSpec, out = new Float32Array(g.nx * g.nz)) { return this.water.sampleGround(g, out); }
}
export { KIND_OF };
