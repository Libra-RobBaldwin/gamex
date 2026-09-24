// The game's water: one water system (src/proto/water) over today's flat map, and everything the
// game needs from it. main.ts only calls these few things:
//
//   const gw = new GameWater(BOUND);
//   gw.isWater(p)                 // the game's isWater: roads, plots, bridges and traffic use it
//   gw.claim(net.land)            // the lake's land claims ('water' owner, 3 m off the bank)
//   ground.geometry = gw.groundGeometry(...)   // the map's ground, dipping into the lake bed
//   gw.patch(groundMaterial)      // lays beaches and the lake bed over the ground (chains its patch)
//   scene.add(gw.group)           // the water surface and reeds: two draw calls
//   gw.update(seconds, hour)      // ripples, reeds swaying, day and dusk from the game clock
//   gw.crossings(path) / navLimits / pierBans   // for the bridges and road height solver
//
// The map is flat (height 0) apart from the lake: a hollow in an FnHeight, a noise-warped bowl
// with a gently shelving rim, which the water system fills to its level. Terrain comes later; then
// the source becomes the terrain library's and nothing else here changes.
import * as THREE from 'three';
import { FnHeight } from '../terrain/height';
import { TILE } from '../terrain/height';
import { KIND_CODE, WaterSystem, claimWater, navLimits, pierBans, reedSpots, shoreColours, waterClaims, waterSurface, type Crossing, type WaterMesh, type WaterTile } from '../water';
import { WATER_LIGHT, patchGroundMaterial, reedGeometry, reedMaterial, reedMesh, rippleTexture, setWaterLight, waterGeometry, waterMaterial, type WaterLight } from '../water/material';
import type { Land } from '../land';

export interface XZ { x: number; z: number }

// Where the lake is, and roughly how big: the bowl's radius wobbles by up to ±13 m round this.
export const LAKE = { x: 250, z: -190, r: 90 };
// the lake's surface (a little under the flat map, so its bank shelves down to it)
export const LEVEL = -0.3;
const DEEP = 4.2; // m of water in the middle
const RIM = 16; // m out from the waterline where the beach starts dropping from the flat (a 3% fall to the water)
const SHELF = 0.3; // how far in (share of the radius) the bed reaches its full depth

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// the bowl's radius in each direction: a few slow waves, so the shore has bays and headlands
export function lakeRadius(a: number) {
  return LAKE.r * (1 + 0.075 * Math.sin(2 * a + 0.7) + 0.05 * Math.sin(3 * a + 2.1) + 0.03 * Math.sin(5 * a + 0.4));
}
// The map's ground: flat, apart from the lake's bowl.
export function lakeGround(x: number, z: number) {
  const dx = x - LAKE.x, dz = z - LAKE.z, d = Math.hypot(dx, dz);
  if (d > LAKE.r * 1.35) return 0;
  const R = lakeRadius(Math.atan2(dz, dx)), u = R - d; // m inside the waterline
  if (u <= -RIM) return 0;
  // from the flat down to the waterline over the rim (a beach, easing off the flat and meeting the
  // water on a slope, so the waterline is crisp), then shelving on down to the full depth
  // (straight for the last 70%, where beaches are drawn, so the shore distance read off the slope is true)
  // (the water system counts water from 8 cm deep, so the beach runs on down to 10 cm under the level)
  const edge = LEVEL - 0.1;
  if (u <= 0) { const t = (u + RIM) / RIM, e = 0.3; return (edge * (t < e ? (t * t) / (2 * e) : t - e / 2)) / (1 - e / 2); }
  const t = Math.min(1, u / (SHELF * R));
  return edge - (DEEP + edge) * (0.2 * t + 0.8 * smooth(t)); // (starting at about the beach's slope)
}
// the bowl's extent, with room for the bank
export const LAKE_BOX = { x0: LAKE.x - LAKE.r * 1.35, z0: LAKE.z - LAKE.r * 1.35, x1: LAKE.x + LAKE.r * 1.35, z1: LAKE.z + LAKE.r * 1.35 }; // (past the widest bay and its beach)

// Still water lies flat right to the edge of its mesh, so the ground (a 2 m mesh) cuts a smooth
// waterline. (waterSurface drops the dry corners just under the ground, which suits rivers beside
// lower land, but on a gently shelving lake shore it makes the waterline follow the 4 m raster in
// stair-steps.) It lies DROP under the level: a point only counts as water 8 cm deep (the water
// system's film), so ground between the level and 8 cm under it is dry and the mesh doesn't cover
// all of it; lower, the mesh's 4 m edge never shows. The depth is measured from where it's drawn,
// so the shallows' colour and the foam fade to nothing right at the waterline.
const DROP = 0.1;
function level(w: WaterMesh, t: WaterTile) {
  const n = t.g.nx, mg = t.margin, step = t.g.step, P = w.positions, W = w.water;
  for (let v = 0; v < w.vertexCount; v++) {
    const a = Math.round(P[v * 3] / step), b = Math.round(P[v * 3 + 2] / step), k = (mg + b) * n + mg + a;
    if (t.nearKind[k] !== KIND_CODE.lake && t.nearKind[k] !== KIND_CODE.sea) continue;
    P[v * 3 + 1] = t.nearLevel[k] - DROP;
    W[v * 4] = t.nearLevel[k] - DROP - t.ground[k];
  }
}

// how far roads keep from the waterline (as the old circle lake's 4 m)
const ROAD_GAP = 4;
// ground mesh spacing over the lake (m), and elsewhere (the map is flat there)
const FINE = 2, COARSE = 80;
// how far the water's light goes towards dusk in the evening (0 day, 1 the library's dusk)
const DUSK = 0.55;

export class GameWater {
  readonly water: WaterSystem;
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private reedMat = reedMaterial();
  private light: WaterLight = { ...WATER_LIGHT.day, sunDir: WATER_LIGHT.day.sunDir.clone() };
  private dusk = -1;
  readonly tiles: WaterTile[] = []; // the tiles with water on the map
  // (half the map's width, and the tiles it covers)
  constructor(readonly half: number) {
    // Only the lake's own water: no rivers or basins are worked out from a flat map (a flat plain's
    // drainage is arbitrary, and the water system would start streams across it). Small regions,
    // as there's no catchment to follow: 2 km with 200 m of margin builds in a few ms, not 200.
    this.water = new WaterSystem(new FnHeight(lakeGround, () => LEVEL), { riverArea: 1e9, basinArea: 1e9, sea: null, region: 2000, margin: 200 });
    this.material = waterMaterial(rippleTexture(), WATER_LIGHT.day);
    const t0 = Math.floor(-half / TILE), t1 = Math.floor(half / TILE);
    for (let ti = t0; ti <= t1; ti++) for (let tj = t0; tj <= t1; tj++) {
      // (a tile the lake's bowl doesn't reach is dry: don't build its rasters)
      if ((ti + 1) * TILE < LAKE_BOX.x0 || ti * TILE > LAKE_BOX.x1 || (tj + 1) * TILE < LAKE_BOX.z0 || tj * TILE > LAKE_BOX.z1) continue;
      const t = this.water.tile(ti, tj);
      if (t.wet) this.tiles.push(t);
    }
    for (const t of this.tiles) {
      const w = waterSurface(t);
      if (!w) continue;
      level(w, t);
      const m = new THREE.Mesh(waterGeometry(w), this.material);
      m.position.set(w.offset[0], 0, w.offset[1]);
      m.renderOrder = 2; // after the ground and the roads
      m.name = 'water';
      this.group.add(m);
      const spots = reedSpots(t);
      if (spots.length) { const r = reedMesh(spots, reedGeometry(), this.reedMat); r.name = 'reeds'; this.group.add(r); }
    }
  }

  // The game's isWater: wet, or within a few metres of the waterline (so roads keep off the beach).
  isWater = (p: XZ) => {
    if (p.x < LAKE_BOX.x0 || p.x > LAKE_BOX.x1 || p.z < LAKE_BOX.z0 || p.z > LAKE_BOX.z1) return false;
    return this.water.distanceToShore(p.x, p.z) > -ROAD_GAP;
  };
  // Is this spot within `m` metres of water (trees keep further off than roads)?
  near(p: XZ, m: number) {
    if (p.x < LAKE_BOX.x0 - m || p.x > LAKE_BOX.x1 + m || p.z < LAKE_BOX.z0 - m || p.z > LAKE_BOX.z1 + m) return false;
    return this.water.distanceToShore(p.x, p.z) > -m;
  }

  // The lake's land: claimed as 'water' 3 m beyond the waterline, so plots, parks and street trees
  // keep off the bank (they ask land.free()).
  claim(land: Land) { for (const t of this.tiles) claimWater(land, t, 'water', { buffer: 3 }); }
  // the water's outline (for the ground's lush grass by the water, and its hedges keeping off)
  // (kept: the ground compares it by identity to know when to repaint)
  private edge: XZ[][] | null = null;
  outline(): XZ[][] { return (this.edge ??= this.tiles.flatMap((t) => waterClaims(t, { buffer: 0 }).flatMap((c) => c.polys))); }

  // For the bridges and the road height solver: what a road along `path` crosses, the limits on its
  // deck (above the flood level, and the headroom over the navigation channel), where piers may not go.
  crossings(path: XZ[]) { return this.water.crossingsAlong(path); }
  navLimits(cs: Crossing[], deck?: number) { return navLimits(cs, deck); }
  pierBans(cs: Crossing[]) { return pierBans(cs); }

  // The map's ground as one mesh: flat quads in big steps away from the lake, and a 2 m grid over
  // the lake's bowl (the columns and rows line up, so there are no T-junctions and no cracks). It
  // carries the shore colours (RGBA) for patchGroundMaterial. It's in a PlaneGeometry's frame (x
  // east, y north, z up), so it drops in for the flat plane the game lays down with rotation.x = −π/2.
  groundGeometry(size: number) {
    const h = size / 2, B = LAKE_BOX;
    const axis = (a0: number, a1: number) => {
      const out: number[] = [];
      const run = (from: number, to: number, step: number) => { const n = Math.max(1, Math.ceil((to - from) / step)); for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / n); };
      const f0 = Math.max(-h, Math.floor(a0 / FINE) * FINE), f1 = Math.min(h, Math.ceil(a1 / FINE) * FINE);
      if (f0 > -h) run(-h, f0, COARSE);
      run(f0, f1, FINE);
      if (f1 < h) run(f1, h, COARSE);
      out.push(h);
      return out;
    };
    const xs = axis(B.x0, B.x1), zs = axis(B.z0, B.z1), NX = xs.length, NZ = zs.length, V = NX * NZ;
    const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), e = 0.5;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const v = j * NX + i, x = xs[i], z = zs[j];
      pos[v * 3] = x; pos[v * 3 + 1] = lakeGround(x, z); pos[v * 3 + 2] = z;
      const gx = (lakeGround(x + e, z) - lakeGround(x - e, z)) / (2 * e), gz = (lakeGround(x, z + e) - lakeGround(x, z - e)) / (2 * e), l = Math.hypot(gx, 1, gz);
      nor[v * 3] = -gx / l; nor[v * 3 + 1] = 1 / l; nor[v * 3 + 2] = -gz / l;
    }
    const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
    let o = 0;
    for (let j = 0; j + 1 < NZ; j++) for (let i = 0; i + 1 < NX; i++) {
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    // shore colours from each tile with water (alpha 0 elsewhere: the ground as it is)
    const col = new Float32Array(V * 4), mesh = { vertexCount: V, positions: pos, normals: nor, offset: [0, 0] as [number, number] };
    for (const t of this.tiles) {
      const c = shoreColours(t, mesh as Parameters<typeof shoreColours>[1]), x0 = t.ti * t.size, z0 = t.tj * t.size;
      for (let v = 0; v < V; v++) {
        const x = pos[v * 3], z = pos[v * 3 + 2];
        if (x < x0 || x >= x0 + t.size || z < z0 || z >= z0 + t.size) continue;
        col[v * 4] = c[v * 4]; col[v * 4 + 1] = c[v * 4 + 1]; col[v * 4 + 2] = c[v * 4 + 2]; col[v * 4 + 3] = c[v * 4 + 3];
      }
    }
    // (world x, height, z → the plane's x, −z, height)
    for (let v = 0; v < V; v++) {
      const y = pos[v * 3 + 1], z = pos[v * 3 + 2], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
      pos[v * 3 + 1] = -z; pos[v * 3 + 2] = y; nor[v * 3 + 1] = -nz; nor[v * 3 + 2] = ny;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
  // Lay the shore colours over the ground material (chained after the ground's own patch; keeps
  // its stencil settings). Every mesh drawn with it must carry the RGBA colour attribute.
  patch<M extends THREE.MeshLambertMaterial>(m: M) { return patchGroundMaterial(m); }

  // Each frame: the ripples and reeds move with real time; the light follows the game clock
  // (hour 0–24): day, turning towards dusk through the evening, back to day after dawn. (Only part
  // way while the rest of the scene has no evening light: full dusk water under a noon sky looks
  // muddy. Raise DUSK when the game gets a day and night.)
  update(seconds: number, hour: number) {
    this.material.uniforms.uTime.value = seconds;
    (this.reedMat.userData.time as { value: number }).value = seconds;
    const k = DUSK * (hour >= 17 && hour < 20 ? smooth((hour - 17) / 3) : hour >= 20 || hour < 5 ? 1 : hour < 8 ? 1 - smooth((hour - 5) / 3) : 0);
    if (Math.abs(k - this.dusk) < 0.01) return;
    this.dusk = k;
    const D = WATER_LIGHT.day, N = WATER_LIGHT.dusk, L = this.light;
    L.sunDir = D.sunDir.clone().lerp(N.sunDir, k).normalize();
    for (const key of ['sun', 'skyTop', 'skyHorizon', 'ambient', 'shallow', 'deep', 'foam'] as const) L[key] = D[key].clone().lerp(N[key], k);
    L.reflect = D.reflect + (N.reflect - D.reflect) * k; L.glint = D.glint + (N.glint - D.glint) * k;
    setWaterLight(this.material, L);
  }
}
