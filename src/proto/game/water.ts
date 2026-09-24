// The game's water: one water system (src/proto/water) over today's flat map, and everything the
// game needs from it. main.ts only calls these few things:
//
//   const gw = new GameWater(BOUND);
//   gw.isWater(p)                 // the game's isWater: roads, plots, bridges and traffic use it
//   gw.claim(net.land)            // the lake's land claims ('water' owner, 3 m off the bank)
//   ground.geometry = gw.groundGeometry(...)   // the map's ground, dipping into the lake bed
//   gw.patch(groundMaterial)      // lays beaches and the lake bed over the ground (chains its patch)
//   scene.add(gw.group)           // the water surface and reeds: two draw calls
//   gw.light(scene, sun)          // evening light: the scene's lights and the water's change together
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
// The lake's surface as drawn (a little under the flat map, so its bank shelves down to it): the
// ground dips under it exactly at lakeRadius. The water system is given a level DROP higher, so
// the water it finds (from 8 cm deep, its film) reaches 2 cm past the drawn waterline: its
// raster, its shore distance, the land claims and isWater never fall short of the water you see.
export const LEVEL = -0.3;
const DROP = 0.1;
export const WATER_LEVEL = LEVEL + DROP; // (the water system's level for the lake)
const DEEP = 4.2; // m of water in the middle
const RIM = 8; // m out from the waterline where the beach starts dropping from the flat (4% at the water)
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
  if (u <= 0) { const t = (u + RIM) / RIM, e = 0.3; return (LEVEL * (t < e ? (t * t) / (2 * e) : t - e / 2)) / (1 - e / 2); }
  const t = Math.min(1, u / (SHELF * R));
  return LEVEL - (DEEP + LEVEL) * (0.12 * t + 0.88 * smooth(t)); // (starting at about the beach's slope)
}
// the bowl's extent, with room for the bank
export const LAKE_BOX = { x0: LAKE.x - LAKE.r * 1.35, z0: LAKE.z - LAKE.r * 1.35, x1: LAKE.x + LAKE.r * 1.35, z1: LAKE.z + LAKE.r * 1.35 }; // (past the widest bay and its beach)

// Still water lies flat at the drawn level right to the edge of its mesh, so the ground cuts a
// smooth waterline. (waterSurface drops the dry corners just under the ground, which suits rivers
// beside lower land, but on a gently shelving lake shore it makes the waterline follow the 4 m
// raster in stair-steps.) The depth is measured from where it's drawn, so the shallows' colour and
// the foam fade to nothing right at the waterline.
function level(w: WaterMesh, t: WaterTile) {
  const n = t.g.nx, mg = t.margin, step = t.g.step, P = w.positions, W = w.water;
  for (let v = 0; v < w.vertexCount; v++) {
    const a = Math.round(P[v * 3] / step), b = Math.round(P[v * 3 + 2] / step), k = (mg + b) * n + mg + a;
    if (t.nearKind[k] !== KIND_CODE.lake && t.nearKind[k] !== KIND_CODE.sea) continue;
    P[v * 3 + 1] = t.nearLevel[k] - DROP;
    W[v * 4] = t.nearLevel[k] - DROP - t.ground[k];
  }
}

// How far a road's centre line keeps from the water: a street's band (5.65 m each side) clear of
// the reeds (which stand up to 3.5 m up the bank), a dual carriageway's kerb (8.2 m) clear of the
// water, and on flat ground again (roads are laid at height 0). (The road check only tests the
// centre line; wider roads, a motorway's 15.75 m kerb, still need it to test their width.)
const ROAD_GAP = 9.5;
// the claims keep plots and parks this far off (from the water system's waterline)
const CLAIM = 3;
// the outline the ground gets (hedges keep 2.2 m off it; lush grass beside it): over the sunken beach
const OUTLINE = 4;
// how far the light goes towards the library's dusk in the evening (0 day, 1 dusk)
const DUSK = 0.7;

export class GameWater {
  readonly water: WaterSystem;
  readonly group = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  private reedMat = reedMaterial();
  private wl: WaterLight = { ...WATER_LIGHT.day, sunDir: WATER_LIGHT.day.sunDir.clone() };
  private dusk = -1;
  private lit: { scene: THREE.Scene; sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight | null; day: { sun: THREE.Color; sunI: number; sky: THREE.Color; gnd: THREE.Color; hemiI: number; bg: THREE.Color | null } } | null = null;
  readonly tiles: WaterTile[] = []; // the tiles with water on the map
  // (half the map's width, and the tiles it covers)
  constructor(readonly half: number) {
    // Only the lake's own water: no rivers or basins are worked out from a flat map (a flat plain's
    // drainage is arbitrary, and the water system would start streams across it). Small regions,
    // as there's no catchment to follow: 2 km with 200 m of margin builds in a few ms, not 200.
    this.water = new WaterSystem(new FnHeight(lakeGround, () => WATER_LEVEL), { riverArea: 1e9, basinArea: 1e9, sea: null, region: 2000, margin: 200 });
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
      // (each tuft stands on the ground at its own spot, not the raster point it came from)
      for (let i = 0; i < spots.length; i += 5) spots[i + 1] = lakeGround(spots[i], spots[i + 2]);
      if (spots.length) { const r = reedMesh(spots, reedGeometry(), this.reedMat); r.name = 'reeds'; this.group.add(r); }
    }
  }

  // The game's isWater: wet, or within ROAD_GAP of the waterline (so roads keep off the bank).
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
  claim(land: Land) { for (const t of this.tiles) claimWater(land, t, 'water', { buffer: CLAIM }); }
  // the water's outline, over the sunken beach (for the ground's lush grass by the water, and its
  // hedges keeping off). (Kept: the ground compares it by identity to know when to repaint.)
  private edge: XZ[][] | null = null;
  outline(): XZ[][] { return (this.edge ??= this.tiles.flatMap((t) => waterClaims(t, { buffer: OUTLINE }).flatMap((c) => c.polys))); }

  // For the bridges and the road height solver: what a road along `path` crosses, the limits on its
  // deck (above the flood level, and the headroom over the navigation channel), where piers may not go.
  crossings(path: XZ[]) { return this.water.crossingsAlong(path); }
  navLimits(cs: Crossing[], deck?: number) { return navLimits(cs, deck); }
  pierBans(cs: Crossing[]) { return pierBans(cs); }

  // The map's ground as one mesh, fine only where it isn't flat:
  //   - the bank, a ring of about 2 m cells round the lake from where the bed levels off to where
  //     the beach meets the flat (the waterline runs round it, so it comes out smooth);
  //   - the flat lake bed inside it, a fan;
  //   - the flat map outside, a grid of 40 m cells, with the box round the lake triangulated between
  //     the grid's vertices and the ring's outer edge.
  // Every edge is shared whole (no T-junctions, so no cracks). It carries the shore colours (RGBA)
  // for patchGroundMaterial. It's in a PlaneGeometry's frame (x east, y north, z up), so it drops in
  // for the flat plane the game lays down with rotation.x = −π/2.
  groundGeometry(size: number) {
    const h = size / 2, B = LAKE_BOX, xyz: number[] = [], tris: number[] = [];
    const vert = (x: number, z: number) => { xyz.push(x, lakeGround(x, z), z); return xyz.length / 3 - 1; };
    // the grid outside the box
    const axis = (a0: number, a1: number) => {
      const out: number[] = [];
      const run = (from: number, to: number) => { const n = Math.max(1, Math.ceil((to - from) / GRID)); for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / n); };
      run(-h, a0); run(a0, a1); run(a1, h); out.push(h);
      return out;
    };
    const xs = axis(B.x0, B.x1), zs = axis(B.z0, B.z1), NX = xs.length, NZ = zs.length;
    for (const z of zs) for (const x of xs) vert(x, z);
    const inBox = (i: number, j: number) => xs[i] >= B.x0 - 1e-6 && xs[i + 1] <= B.x1 + 1e-6 && zs[j] >= B.z0 - 1e-6 && zs[j + 1] <= B.z1 + 1e-6;
    for (let j = 0; j + 1 < NZ; j++) for (let i = 0; i + 1 < NX; i++) {
      if (inBox(i, j)) continue;
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      tris.push(a, c, b, b, c, d);
    }
    // the bank: a ring from where the bed levels off to the top of the beach
    const N = ANGLES, span = (a: number) => lakeRadius(a) * SHELF + RIM;
    let M = 0;
    for (let i = 0; i < N; i++) M = Math.max(M, Math.ceil(span((i / N) * Math.PI * 2) / STEP));
    const r0 = NX * NZ;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, R = lakeRadius(a), rin = R * (1 - SHELF), c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k <= M; k++) { const r = rin + ((R + RIM - rin) * k) / M; vert(LAKE.x + c * r, LAKE.z + s * r); }
    }
    const ring = (i: number, k: number) => r0 + (i % N) * (M + 1) + k;
    for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) tris.push(ring(i, k), ring(i + 1, k), ring(i, k + 1), ring(i, k + 1), ring(i + 1, k), ring(i + 1, k + 1));
    // the flat bed: a fan
    const mid = vert(LAKE.x, LAKE.z);
    for (let i = 0; i < N; i++) tris.push(mid, ring(i, 0), ring(i + 1, 0));
    // the box between the grid and the ring's outer edge
    const border: number[] = [];
    const bi0 = xs.findIndex((x) => Math.abs(x - B.x0) < 1e-6), bi1 = xs.findIndex((x) => Math.abs(x - B.x1) < 1e-6);
    const bj0 = zs.findIndex((z) => Math.abs(z - B.z0) < 1e-6), bj1 = zs.findIndex((z) => Math.abs(z - B.z1) < 1e-6);
    for (let i = bi0; i < bi1; i++) border.push(bj0 * NX + i);
    for (let j = bj0; j < bj1; j++) border.push(j * NX + bi1);
    for (let i = bi1; i > bi0; i--) border.push(bj1 * NX + i);
    for (let j = bj1; j > bj0; j--) border.push(j * NX + bi0);
    const hole: number[] = [];
    for (let i = 0; i < N; i++) hole.push(ring(i, M));
    const v2 = (v: number) => new THREE.Vector2(xyz[v * 3], xyz[v * 3 + 2]);
    const all = [...border, ...hole];
    for (const f of THREE.ShapeUtils.triangulateShape(border.map(v2), [hole.map(v2)])) tris.push(all[f[0]], all[f[1]], all[f[2]]);
    // every triangle facing up
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ux = xyz[b * 3] - xyz[a * 3], uz = xyz[b * 3 + 2] - xyz[a * 3 + 2], wx = xyz[c * 3] - xyz[a * 3], wz = xyz[c * 3 + 2] - xyz[a * 3 + 2];
      if (uz * wx - ux * wz < 0) { tris[t + 1] = c; tris[t + 2] = b; }
    }
    const V = xyz.length / 3, pos = Float32Array.from(xyz), nor = new Float32Array(V * 3), e = 0.5;
    for (let v = 0; v < V; v++) {
      const x = pos[v * 3], z = pos[v * 3 + 2];
      const gx = (lakeGround(x + e, z) - lakeGround(x - e, z)) / (2 * e), gz = (lakeGround(x, z + e) - lakeGround(x, z - e)) / (2 * e), l = Math.hypot(gx, 1, gz);
      nor[v * 3] = -gx / l; nor[v * 3 + 1] = 1 / l; nor[v * 3 + 2] = -gz / l;
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
    g.setIndex(new THREE.BufferAttribute(V > 65535 ? Uint32Array.from(tris) : Uint16Array.from(tris), 1));
    g.computeBoundingSphere();
    return g;
  }
  // Lay the shore colours over the ground material (chained after the ground's own patch; keeps
  // its stencil settings). Every mesh drawn with it must carry the RGBA colour attribute.
  patch<M extends THREE.MeshLambertMaterial>(m: M) { return patchGroundMaterial(m); }

  // The scene's sun and sky light turn towards dusk in the evening with the water's, so the lake
  // never glows orange under a noon sky. (The sun keeps its direction: the shadows are fitted to it.)
  light(scene: THREE.Scene, sun: THREE.DirectionalLight) {
    const hemi = (scene.children.find((c) => (c as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight | undefined) ?? null;
    const bg = scene.background instanceof THREE.Color ? scene.background.clone() : null;
    this.lit = { scene, sun, hemi, day: { sun: sun.color.clone(), sunI: sun.intensity, sky: hemi?.color.clone() ?? new THREE.Color(), gnd: hemi?.groundColor.clone() ?? new THREE.Color(), hemiI: hemi?.intensity ?? 0, bg } };
    this.dusk = -1;
  }

  // Each frame: the ripples and reeds move with real time; the light follows the game clock
  // (hour 0–24): day, turning towards dusk through the evening, back to day after dawn.
  update(seconds: number, hour: number) {
    this.material.uniforms.uTime.value = seconds;
    (this.reedMat.userData.time as { value: number }).value = seconds;
    // (while nothing else in the scene has evening light, the water keeps to day light too)
    const k = !this.lit ? 0 : DUSK * (hour >= 17 && hour < 20 ? smooth((hour - 17) / 3) : hour >= 20 || hour < 5 ? 1 : hour < 8 ? 1 - smooth((hour - 5) / 3) : 0);
    if (Math.abs(k - this.dusk) < 0.01) return;
    this.dusk = k;
    const D = WATER_LIGHT.day, N = WATER_LIGHT.dusk, L = this.wl;
    for (const key of ['sun', 'skyTop', 'skyHorizon', 'ambient', 'shallow', 'deep', 'foam'] as const) L[key] = D[key].clone().lerp(N[key], k);
    L.reflect = D.reflect + (N.reflect - D.reflect) * k; L.glint = D.glint + (N.glint - D.glint) * k;
    const S = this.lit;
    if (S) {
      // the sun on the water comes from where the scene's does, in the scene's colour
      L.sunDir = S.sun.position.clone().sub(S.sun.target.position).normalize();
      S.sun.color.copy(S.day.sun).lerp(N.sun, k); S.sun.intensity = S.day.sunI * (1 + (N.sunIntensity / D.sunIntensity - 1) * k);
      L.sun = S.sun.color.clone();
      if (S.hemi) { S.hemi.color.copy(S.day.sky).lerp(N.hemiSky, k); S.hemi.groundColor.copy(S.day.gnd).lerp(N.hemiGround, k); S.hemi.intensity = S.day.hemiI * (1 + (N.hemi / D.hemi - 1) * k); }
      if (S.day.bg && S.scene.background instanceof THREE.Color) S.scene.background.copy(S.day.bg).lerp(N.background, k);
    } else L.sunDir = D.sunDir.clone();
    setWaterLight(this.material, L);
  }
}
// ground mesh: the bank ring's cells (m) and how many round, and the flat map's grid (m)
const STEP = 2, ANGLES = 320, GRID = 40;
