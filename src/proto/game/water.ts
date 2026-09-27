// The game's water: one water system (src/proto/water) over today's flat map, and everything the
// game needs from it. main.ts only calls these few things:
//
//   const gw = new GameWater(BOUND, map.water);   // (the map's lakes and rivers: worldmap/water.ts)
//   gw.isWater(p)                 // the game's isWater: roads, plots, bridges and traffic use it
//   gw.claim(net.land)            // the lake's land claims ('water' owner, 3 m off the bank)
//   ground.geometry = gw.groundGeometry(...)   // the map's ground, dipping into the lake bed
//   gw.patch(groundMaterial)      // lays beaches and the lake bed over the ground (chains its patch)
//   scene.add(gw.group)           // the water surface and reeds: two draw calls per 1 km tile
//   gw.beds(makeGroundMat)        // rivers' beds: ground-coloured strips that hide the flat ground over them
//   gw.light(scene, sun)          // evening light: the scene's lights and the water's change together
//   gw.update(seconds, hour)      // ripples, reeds swaying, day and dusk from the game clock
//   gw.crossings(path) / navLimits / pierBans   // for the bridges and road height solver
//
// The map is flat (height 0) apart from its lakes and rivers: hollows in an FnHeight (noise-warped
// bowls with a gently shelving rim, and channels along a centre line; worldmap/water.ts), which the
// water system fills to its level. Terrain comes later; then the source becomes the terrain
// library's and nothing else here changes.
import * as THREE from 'three';
import { FnHeight } from '../terrain/height';
import { TILE } from '../terrain/height';
import { KIND_CODE, WaterSystem, claimWater, navLimits, pierBans, reedSpots, shoreColours, waterClaims, waterSurface, type Crossing, type WaterMesh, type WaterTile } from '../water';
import { WATER_LIGHT, patchGroundMaterial, reedGeometry, reedMaterial, reedMesh, rippleTexture, setWaterLight, waterGeometry, waterMaterial, type WaterLight } from '../water/material';
import type { Land } from '../land';
import { GROUND_LIFT, swellSlope } from '../worldmap/terrain';
import { DROP, LEVEL, MapWater, RIM, TOWN_LAKE, TOWN_WATER, WATER_LEVEL, lakeBox, lakeGroundOf, lakeRadiusOf, riverReach, type LakeSpec, type WaterSpec } from '../worldmap/water';

export interface XZ { x: number; z: number }

// The town's lake (the default map's): where it is and roughly how big (the bowl's radius wobbles
// by up to ±13% round this). The shapes and the ground they make are in worldmap/water.ts.
export const LAKE = TOWN_LAKE;
export { LEVEL, WATER_LEVEL };
export const lakeRadius = (a: number) => lakeRadiusOf(TOWN_LAKE, a);
export const lakeGround = (x: number, z: number) => lakeGroundOf(TOWN_LAKE, x, z);
export const LAKE_BOX = lakeBox(TOWN_LAKE);
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const SHELF = 0.3; // how far in (share of the radius) the bed reaches its full depth

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
  readonly shapes: MapWater; // the map's lakes and rivers (worldmap/water.ts)
  // (half the map's width, and the tiles it covers; the map's water, the town's lake by default)
  constructor(readonly half: number, spec: WaterSpec = TOWN_WATER) {
    const W = (this.shapes = new MapWater({ ...spec, lakes: [...spec.lakes] })); // (its own list of lakes: a pond added later (addPond) joins this map's, not the spec it was given)
    // Only the map's own water: no rivers or basins are worked out from a flat map (a flat plain's
    // drainage is arbitrary, and the water system would start streams across it). Small regions,
    // as there's no catchment to follow: 2 km with 200 m of margin builds in a few ms, not 200.
    // (A river is a channel in the ground, filled to the level like a lake: still water for now.)
    this.water = new WaterSystem(new FnHeight(W.ground, () => WATER_LEVEL), { riverArea: 1e9, basinArea: 1e9, sea: null, region: 2000, margin: 200 }, 100000); // (every tile with water is kept for the game's life: its cache must hold them all, or at its default 24 it builds them again and again)
    this.material = waterMaterial(rippleTexture(), WATER_LIGHT.day, { still: true }); // (still water: no current)
    const t0 = Math.floor(-half / TILE), t1 = Math.floor(half / TILE);
    for (let ti = t0; ti <= t1; ti++) for (let tj = t0; tj <= t1; tj++) {
      // (a tile no bowl or channel reaches is dry: don't build its rasters)
      const box = { x0: ti * TILE, z0: tj * TILE, x1: (ti + 1) * TILE, z1: (tj + 1) * TILE };
      const lake = spec.lakes.some((L) => { const B = lakeBox(L); return !((ti + 1) * TILE < B.x0 || ti * TILE > B.x1 || (tj + 1) * TILE < B.z0 || tj * TILE > B.z1); });
      if (!lake && !W.rivers.some((r) => r.index.near((box.x0 + box.x1) / 2, (box.z0 + box.z1) / 2, TILE * 0.71 + riverReach(r.spec)) !== Infinity)) continue;
      const t = this.water.tile(ti, tj);
      if (t.wet) this.tiles.push(t);
    }
    for (const t of this.tiles) this.place(t);
  }
  // a tile's surface and reeds on the scene (kept by tile, so a tile built again replaces its own)
  private meshes = new Map<string, THREE.Object3D[]>();
  private place(t: WaterTile) {
    const key = `${t.ti},${t.tj}`, W = this.shapes;
    for (const o of this.meshes.get(key) ?? []) { this.group.remove(o); (o as THREE.Mesh).geometry?.dispose(); }
    const made: THREE.Object3D[] = [];
    this.meshes.set(key, made);
    const w = waterSurface(t);
    if (!w) return;
    level(w, t);
    const m = new THREE.Mesh(waterGeometry(w), this.material);
    m.position.set(w.offset[0], 0, w.offset[1]);
    m.renderOrder = 2; // after the ground and the roads
    m.name = 'water';
    this.group.add(m); made.push(m);
    const spots = reedSpots(t);
    // (each tuft stands on the ground at its own spot, not the raster point it came from)
    for (let i = 0; i < spots.length; i += 5) spots[i + 1] = W.ground(spots[i], spots[i + 2]);
    if (spots.length) { const r = reedMesh(spots, reedGeometry(), this.reedMat); r.name = 'reeds'; this.group.add(r); made.push(r); }
  }
  // A park's pond, added while the game runs (worldmap/water.ts addPond gives the spec; the terrain
  // has laid the ground to it): the bowl joins the live water's shapes, the tiles it lies in are
  // built again with their surface and reeds, and their land is claimed again so plots, paths and
  // trees keep off it. The ground mesh and its paint are the caller's (main.ts), which has them.
  addPond(L: LakeSpec, land: Land | null): WaterTile[] {
    this.shapes.addLake(L);
    this.edge = null;
    const B = lakeBox(L), out: WaterTile[] = [];
    for (let ti = Math.floor(B.x0 / TILE); ti <= Math.floor(B.x1 / TILE); ti++) for (let tj = Math.floor(B.z0 / TILE); tj <= Math.floor(B.z1 / TILE); tj++) {
      this.water.forgetTile(ti, tj);
      const t = this.water.tile(ti, tj), at = this.tiles.findIndex((q) => q.ti === ti && q.tj === tj);
      if (at >= 0) this.tiles[at] = t; else this.tiles.push(t);
      this.place(t);
      if (land) claimWater(land, t, 'water', { buffer: CLAIM });
      out.push(t);
    }
    return out;
  }

  // The game's isWater: wet, or within ROAD_GAP of the waterline (so roads keep off the bank).
  isWater = (p: XZ) => {
    if (!this.shapes.mayBeNear(p, ROAD_GAP)) return false;
    return this.water.distanceToShore(p.x, p.z) > -ROAD_GAP;
  };
  // Is this spot within `m` metres of water (trees keep further off than roads)?
  near(p: XZ, m: number) {
    if (!this.shapes.mayBeNear(p, m)) return false;
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
  //   - the bank, a ring round each lake from where the bed levels off to where the beach meets the
  //     flat: 2 m rings across the waterline and beach, 5 m down the shelf, 128 pieces round (the
  //     waterline runs along a ring, so it comes out smooth; small cells cost a heavy ground shader
  //     dear, so there are no more than the shape needs);
  //   - the flat lake bed inside it, a fan;
  //   - the flat map outside, a grid of 100 m cells, with the box round each lake triangulated
  //     between the grid's vertices and the ring's outer edge.
  // Every edge is shared whole (no T-junctions, so no cracks). It carries the shore colours (RGBA)
  // for patchGroundMaterial. It's in a PlaneGeometry's frame (x east, y north, z up), so it drops in
  // for the flat plane the game lays down with rotation.x = −π/2. (Rivers are flat here: their beds
  // are separate strips, drawn over it; see beds().)
  //
  // On a map with hills (`relief`, worldmap/terrain.ts), the grid is the hills' own (25 m), the lakes'
  // boxes are snapped out onto it, and every vertex carries the hills' height: the mesh is then
  // exactly the surface everything else is draped on (drape.ts).
  groundGeometry(size: number, relief?: { step: number; heightAt: (x: number, z: number) => number }, swell = 0) {
    const h = size / 2, lakes = this.shapes.spec.lakes, xyz: number[] = [], tris: number[] = [];
    const cell = relief?.step ?? GRID, snap = (v: number, up: boolean) => (relief ? -h + (up ? Math.ceil : Math.floor)((v + h) / cell) * cell : v);
    const boxes = lakes.map(lakeBox).map((B) => ({ x0: snap(B.x0, false), z0: snap(B.z0, false), x1: snap(B.x1, true), z1: snap(B.z1, true) }));
    const G = this.shapes.lakesGround; // (rivers' channels aren't in it: see beds())
    const H = relief?.heightAt;
    const vert = (x: number, z: number) => { xyz.push(x, G(x, z) + (H ? H(x, z) : 0), z); return xyz.length / 3 - 1; };
    // the grid outside the boxes (their edges are grid lines)
    // (on the hills' grid every run between cuts is whole cells)
    const axis = (cuts: number[]) => {
      const out: number[] = [], at = [-h, ...[...new Set(cuts)].filter((c) => c > -h && c < h).sort((p, q) => p - q), h];
      for (let k = 0; k + 1 < at.length; k++) { const from = at[k], to = at[k + 1], n = Math.max(1, (relief ? Math.round : Math.ceil)((to - from) / cell)); for (let i = 0; i < n; i++) out.push(from + ((to - from) * i) / n); }
      out.push(h);
      return out;
    };
    const xs = axis(boxes.flatMap((B) => [B.x0, B.x1])), zs = axis(boxes.flatMap((B) => [B.z0, B.z1])), NX = xs.length, NZ = zs.length;
    for (const z of zs) for (const x of xs) vert(x, z);
    const inBox = (i: number, j: number) => boxes.some((B) => xs[i] >= B.x0 - 1e-6 && xs[i + 1] <= B.x1 + 1e-6 && zs[j] >= B.z0 - 1e-6 && zs[j + 1] <= B.z1 + 1e-6);
    for (let j = 0; j + 1 < NZ; j++) for (let i = 0; i + 1 < NX; i++) {
      if (inBox(i, j)) continue;
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      tris.push(a, c, b, b, c, d);
    }
    lakes.forEach((L, li) => this.bowl(L, boxes[li], xs, zs, xyz, tris, vert));
    // (shore colours only round the lakes: a river's are on its strip, and on the flat ground's big
    // cells they'd smear out across 100 m)
    return this.finish(xyz, tris, G, (x, z) => boxes.some((B) => x >= B.x0 - 1e-6 && x <= B.x1 + 1e-6 && z >= B.z0 - 1e-6 && z <= B.z1 + 1e-6), H, cell, swell);
  }
  // One lake's bank ring, bed and box in the ground mesh.
  private bowl(L: LakeSpec, B: { x0: number; z0: number; x1: number; z1: number }, xs: number[], zs: number[], xyz: number[], tris: number[], vert: (x: number, z: number) => number) {
    const NX = xs.length;
    // the bank: a ring from where the bed levels off to the top of the beach, in STEP rings across
    // the waterline and the beach (where the shape shows) and about 5 m ones down the shelf
    const N = ANGLES, near: number[] = [];
    for (let u = NEAR; u >= -RIM - 1e-6; u -= STEP) near.push(u);
    const deep = Math.ceil((L.r * 1.155 * SHELF - NEAR) / 5), M = deep + near.length - 1;
    const r0 = xyz.length / 3;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, R = lakeRadiusOf(L, a), c = Math.cos(a), s = Math.sin(a);
      for (let k = 0; k < deep; k++) { const u = R * SHELF + ((NEAR - R * SHELF) * k) / deep; vert(L.x + c * (R - u), L.z + s * (R - u)); }
      for (const u of near) vert(L.x + c * (R - u), L.z + s * (R - u));
    }
    const ring = (i: number, k: number) => r0 + (i % N) * (M + 1) + k;
    for (let i = 0; i < N; i++) for (let k = 0; k < M; k++) tris.push(ring(i, k), ring(i + 1, k), ring(i, k + 1), ring(i, k + 1), ring(i + 1, k), ring(i + 1, k + 1));
    // the flat bed: a fan
    const mid = vert(L.x, L.z);
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
  }
  // Triangles facing up, normals from the ground, shore colours from the water's tiles, in the
  // plane's frame.
  // (`H`: hills already in the heights, for the normals: sloped over a cell's width, so they're smooth)
  private finish(xyz: number[], tris: number[], G: (x: number, z: number) => number, shore: (x: number, z: number) => boolean = () => true, H?: (x: number, z: number) => number, eH = 25, swell = 0) {
    // every triangle facing up
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ux = xyz[b * 3] - xyz[a * 3], uz = xyz[b * 3 + 2] - xyz[a * 3 + 2], wx = xyz[c * 3] - xyz[a * 3], wz = xyz[c * 3 + 2] - xyz[a * 3 + 2];
      if (uz * wx - ux * wz < 0) { tris[t + 1] = c; tris[t + 2] = b; }
    }
    const V = xyz.length / 3, pos = Float32Array.from(xyz), nor = new Float32Array(V * 3), e = 0.5;
    for (let v = 0; v < V; v++) {
      const x = pos[v * 3], z = pos[v * 3 + 2];
      let gx = (G(x + e, z) - G(x - e, z)) / (2 * e), gz = (G(x, z + e) - G(x, z - e)) / (2 * e);
      if (H) { gx += GROUND_LIFT * (H(x + eH, z) - H(x - eH, z)) / (2 * eH); gz += GROUND_LIFT * (H(x, z + eH) - H(x, z - eH)) / (2 * eH); } // (lit steeper than it is: worldmap/terrain.ts)
      if (swell) { const [sx, sz] = swellSlope(x, z, swell); gx += sx; gz += sz; } // (and its swells, for the light only)
      const l = Math.hypot(gx, 1, gz);
      nor[v * 3] = -gx / l; nor[v * 3 + 1] = 1 / l; nor[v * 3 + 2] = -gz / l;
    }
    // shore colours from each tile with water (alpha 0 elsewhere: the ground as it is), worked out
    // for the vertices in that tile only
    const col = new Float32Array(V * 4), inTile = new Map<WaterTile, number[]>();
    for (let v = 0; v < V; v++) {
      const x = pos[v * 3], z = pos[v * 3 + 2];
      if (!shore(x, z)) continue;
      const t = this.tiles.find((t) => x >= t.ti * t.size && x < (t.ti + 1) * t.size && z >= t.tj * t.size && z < (t.tj + 1) * t.size);
      if (!t) continue;
      let l = inTile.get(t);
      if (!l) inTile.set(t, (l = []));
      l.push(v);
    }
    for (const [t, vs] of inTile) {
      const p = new Float32Array(vs.length * 3), n = new Float32Array(vs.length * 3);
      vs.forEach((v, k) => { for (let q = 0; q < 3; q++) { p[k * 3 + q] = pos[v * 3 + q]; n[k * 3 + q] = nor[v * 3 + q]; } });
      const c = shoreColours(t, { vertexCount: vs.length, positions: p, normals: n, offset: [0, 0] } as unknown as Parameters<typeof shoreColours>[1]);
      vs.forEach((v, k) => { for (let q = 0; q < 4; q++) col[v * 4 + q] = c[k * 4 + q]; });
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

  // The rivers' beds: a strip along each (rows every 6 m, finer across the waterline and beach),
  // from the flat on one bank down through the channel and up to the flat on the other, drawn with
  // a ground material of its own (from `makeMaterial`: patched like the ground's, and with the shore
  // colours). It's drawn first, marking the stencil, and the flat ground leaves out what it marked
  // (as it does for cuttings), so the two never fight where they meet at the strip's edges.
  beds(makeMaterial: () => THREE.MeshLambertMaterial): THREE.Mesh[] {
    const out: THREE.Mesh[] = [], lim = this.half * 1.0001;
    for (const r of this.shapes.rivers) {
      const half = r.half, rows = resample(r.spec.path, 6).filter((p) => Math.abs(p.x) <= lim + 40 && Math.abs(p.z) <= lim + 40);
      if (rows.length < 2) continue;
      // across the channel: the middle, the shelf, fine through the waterline and the beach
      const d = [0, 0.35, 0.6, 0.8, 0.92].map((k) => k * half).concat([half - 0.6, half, half + 1, half + 2, half + 3.5, half + 5, half + 6.5, half + RIM]);
      const offs = [...d.slice(1).reverse().map((x) => -x), ...d], C = offs.length;
      const xyz: number[] = [], tris: number[] = [];
      rows.forEach((p, i) => {
        const a = rows[Math.max(0, i - 1)], b = rows[Math.min(rows.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
        for (const o of offs) { const x = p.x + nx * o, z = p.z + nz * o; xyz.push(x, o === offs[0] || o === offs[C - 1] ? 0 : this.shapes.ground(x, z), z); }
      });
      for (let i = 0; i + 1 < rows.length; i++) for (let k = 0; k + 1 < C; k++) {
        const a = i * C + k, b = a + 1, c = a + C, e = c + 1;
        tris.push(a, c, b, b, c, e);
      }
      const m = new THREE.Mesh(this.finish(xyz, tris, this.shapes.ground), makeMaterial());
      const mat = m.material as THREE.MeshLambertMaterial;
      mat.stencilWrite = true; mat.stencilRef = 1; mat.stencilFunc = THREE.AlwaysStencilFunc; mat.stencilZPass = THREE.ReplaceStencilOp;
      m.rotation.x = -Math.PI / 2;
      m.receiveShadow = true;
      m.renderOrder = -10; // (before the ground, which leaves out what this marks)
      m.name = 'river-bed';
      out.push(m);
    }
    return out;
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
// a polyline resampled every `step` metres along its length
function resample(path: XZ[], step: number): XZ[] {
  const out: XZ[] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], L = Math.hypot(b.x - a.x, b.z - a.z);
    let t = step - carry;
    for (; t <= L; t += step) out.push({ x: a.x + ((b.x - a.x) * t) / L, z: a.z + ((b.z - a.z) * t) / L });
    carry = L - (t - step);
  }
  const last = path[path.length - 1], end = out[out.length - 1];
  if (Math.hypot(last.x - end.x, last.z - end.z) > step * 0.3) out.push(last);
  return out;
}
// ground mesh: the bank ring's cells (m) and how many round, and the flat map's grid (m)
const STEP = 2, NEAR = 2, ANGLES = 128, GRID = 100; // (fine rings from NEAR m inside the waterline out; 128 round: 4.7 m chords, 3 cm off the curve)
