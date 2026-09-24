# Terrain library

`src/proto/terrain/` gives the game real ground: a height source (procedural or real
elevation data), road and rail profiles that cut, fill, bridge and tunnel through it,
building platforms on slopes, and tile meshes with levels of detail. Nothing in it touches
three.js or the DOM. It's all pure functions of its inputs, so any of it can run in a Web
Worker. Import everything from `./terrain` (`index.ts`).

It's new files only. The live game still stands on its flat plane until the integration
steps below are done.

## Conventions

- World coordinates are metres on the region's local projection: **x east, z south**
  (north is −z), **y up**.
- Heights are **absolute**, not "above a flat plane". This is the main change for the rest
  of the code (see step 3 of the integration plan).
- Gradients are rise over run (0.08 is 8%), as in `catalog.ts`.
- Costs are in the catalogue's money. A street costs about 250 a metre to build.

## 1. Height sources (`height.ts`, `procedural.ts`, `raster.ts`)

```ts
interface HeightSource {
  heightAt(x, z): number;              // ground (the bed, under water)
  waterLevel(x, z): number | null;     // water surface over this spot, or null
  isWater(x, z): boolean;
  slopeAt(x, z): number;               // steepest gradient
  normalAt(x, z): [nx, ny, nz];
  sample(grid: GridSpec, out?): Float32Array;  // a whole grid at once (fast path)
}
interface GridSpec { x0, z0, step, nx, nz }    // data[j * nx + i] is at (x0 + i·step, z0 + j·step)
```

| Class | What it is |
|---|---|
| `FlatHeight(h, isWater?)` | Level ground. `new FlatHeight(0, (x, z) => isWater({x, z}))` is today's world exactly, which makes it a safe first step. |
| `FnHeight(f, water?)` | Any function. Handy for tests and hand-made scenes. |
| `ProceduralTerrain(params)` | Seeded UK-like terrain (see below). |
| `TerrariumHeight(frame, zoom)` | Mapzen/AWS Terrain Tiles. `addTile(tx, ty, rgba)` takes a decoded PNG's RGBA bytes. `tilesFor(box)` says which tiles to fetch. |
| `GridHeight(e0, n0)` | OS Terrain 50 or any ESRI ASCII grid on the British National Grid. `addAscii(text)`. World (0, 0) is at (E e0, N n0). |
| `CachedHeight(src, size = 250, res = 2)` | Put this in front of any source. It fills a grid per 250 m tile with `sample()`, so `heightAt` costs about 45 ns. Call `invalidate(box)` after edits. |

Helpers: `tileGrid(ti, tj, cells, size)` gives the grid covering a tile edge to edge (edge
points are shared, which is why seams meet). `tileOf(x, z)`, `tileKey`, `gridHeight(grid,
x, z)` (bilinear), `decodeTerrarium` / `encodeTerrarium` / `decodeTerrainRgb`,
`parseAsciiGrid`, `LocalFrame(lat0, lon0)` (local metres ↔ latitude/longitude),
`mercatorPixel`, `tileFor`.

### Procedural terrain

```ts
new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 })
```

Presets: `flat`, `lowland` (Fens), `rolling` (Cotswolds, the default), `upland` (Peak
District), `mountain` (Lake District). The parameters are all in metres except where noted:

| Param | Meaning |
|---|---|
| `seed` | Everything follows from it. |
| `scale` | Horizontal stretch (2 = everything twice as broad). Keep it at 0.5 or more. |
| `baseHeight`, `base` | Floor of the regional surface, and its broad swell. |
| `hills` | Rolling-hill amplitude. |
| `upland` (0–1), `mountains` | Share of upland, and ridged relief at its heart. |
| `warp` | How far the domain is pushed about (meanders, spurs). |
| `rivers` (density), `riverWidth`, `riverDepth`, `valleyWidth` | River valleys. |
| `lakes` (0–1) | Chance of a lake per 2 km cell. |
| `sea` | Sea level, or `null` for an inland map. |

The terrain is deterministic and seamless. The same seed gives the same height at the same
point, whichever tile asks first. `sampleWater(grid)` gives the water surface on a grid
(NaN where dry).

## 2. Road and rail profiles (`align.ts`, `earthworks.ts`)

```ts
const sp = alignSpec(ROADS[type]);   // gradient from the catalogue, clearances from GRADES
const a = alignRoute(centreline, terrain, sp, { y0, yL, limits, step: 5 });
if (!a.ok) hint(a.reason);
a.y[i], a.ground[i], a.depth[i]      // absolute height, ground, y − ground (+ fill/bridge, − cut/tunnel)
a.kind[i]                            // 'grade' | 'embankment' | 'cutting' | 'bridge' | 'tunnel'
a.spans                              // [{ kind, s0, s1, i0, i1, max }], tiling the route end to end
a.cost                               // { total, earth, bridge, tunnel, ends }
a.volume                             // { cut, fill } in m³
a.path                               // [{ x, z, y }] every 5 m, absolute y
```

- `align(input, spec)` is the core, on a ground profile you've already sampled:
  `{ length, ground[], water?[], y0?, yL?, limits? }`.
- **Limits** are grade.ts's `Limit` (`{ s0, s1, lo?, hi?, why }`) in **absolute** heights.
  A crossing is `lo: other.y + clear` or `hi: other.y − clear`. A junction is
  `lo = hi = other.y`, and it's met exactly.
- **Water** comes from the height source. Over water the road must bridge with the boat
  clearance or tunnel `under` below the surface. It can't be on a bank.
- **`y0` / `yL`** are fixed end heights (defaults: the ground). `yL: null` leaves the end
  free. An end in the water without a given height is refused ("The end is in the water").
- **The spec** can be overridden: `maxFill` (15 m of bank, then a bridge), `maxCut`
  (20 m of cutting, then a tunnel), `cover` (tunnel deck at least this far below ground),
  `maxHeight`, `maxDepth`, side slopes, `costs`, and `bridges` / `tunnels`
  (allowed or not).
- `sections(route, terrain, spec)` gives the left and right edges of the earthworks at each
  sample: where the embankment toe or cutting top meets the ground.
- `earthworkPolys(route, sections)` turns those edges into polygons for the land registry.

## 3. Building platforms (`platform.ts`)

```ts
const pad = levelPad(terrain, rectPoly(l.x, l.z, l.rot, l.w, l.d), l.kind);
pad.ok, pad.reason   // "Too steep: 22% across the plot, 6% at most for this building", "In the water", …
pad.y                // level of the ground floor (least-cost cut/fill balance, kept above nearby water)
pad.slope, pad.cut, pad.fill, pad.maxCut, pad.maxFill
pad.walls            // [{ a, b, height, side: 'cut' | 'fill' }] retaining walls along the footprint's edges
pad.cost
```

`PAD_RULES` holds the steepest slope and tallest retaining wall for each `LotKind`
(industry 6%, houses 25%, terraces 30%, and so on). `rectPoly` turns a lot the same way as
`roads.ts`'s `rectCorners`.

## 4. Meshing (`mesh.ts`)

```ts
const m = tileMesh(terrain, ti, tj, { size: 1000, cells: 256, lod, skirt: 10, stitch: { e: 1 }, uvScale: 16 });
// m.positions / normals / uvs (Float32Array), m.indices (Uint16 or Uint32), relative to m.offset
```

- `lod` halves the cells each level (256 → 128 → 64…).
- `stitch` gives, per edge (`n`, `e`, `s`, `w`), how many levels coarser that neighbour is.
  The in-between vertices on that edge are moved onto the neighbour's straight edges, so
  there are no cracks.
- `skirt` hangs a curtain from every edge, which hides anything left over.
- Normals come from a bordered grid, so they match across tiles.
- UVs are in world space, so a repeating texture runs on across tiles.

Other functions:

- `waterMesh(terrain, ti, tj)` gives flat water quads wherever there's water (null if none).
- `drapeStrip(terrain, pts, i => [left, right], lift)` gives a strip lying on the ground, for
  the stencil openings (below).
- `cutHoles(mesh, polys, pointInPoly)` gives the index list with the triangles inside the
  polygons removed (for exports and physics, where the stencil can't help).
- `raycast(terrain, origin, dir)` finds the first hit on the ground.

## Integration plan

Do these in order. Each step leaves the game working, and steps 1–3 change nothing on
screen.

### Step 1: one height source in `main.ts`

```ts
import { CachedHeight, FlatHeight, ProceduralTerrain, TERRAIN_PRESETS } from './terrain';
// first: today's world, exactly
const terrain = new FlatHeight(0, (x, z) => isWater({ x, z }), 0.1);
// later: const terrain = new CachedHeight(new ProceduralTerrain({ ...TERRAIN_PRESETS.rolling, seed: 7 }));
```

Pass it into `new Network(...)`. Keep the `isWater(p)` constructor argument for now as
`(p) => terrain.isWater(p.x, p.z)`, and store the source on the network (`net.ground`).

### Step 2: the ground mesh

Replace the `PlaneGeometry` ground with tiles. For the prototype's 1 km map, four
`size: 520` tiles around the origin, or one `size: 1352` tile centred with an offset, are
enough:

```ts
function groundTile(ti: number, tj: number, lod: number, stitch = {}) {
  const m = tileMesh(terrain, ti, tj, { size: 520, cells: 256, lod, stitch, uvScale: BOUND * 2.6 / 60 });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  const mesh = new THREE.Mesh(g, groundMat);          // the same material, stencil settings and all
  mesh.position.set(m.offset[0], 0, m.offset[1]);
  mesh.renderOrder = -9; mesh.receiveShadow = true;
  return mesh;
}
```

- Keep the `stencilWrite` / `NotEqualStencilFunc` settings on the shared material. It no
  longer needs `rotation.x`.
- Pick the LOD by distance from the camera. When a neighbour is coarser, pass its level
  difference in `stitch`.
- Rebuild a tile when the height source changes there.
- Later this becomes streaming: `tileMesh` in a worker, with transferable arrays.

### Step 3: `groundAt` and absolute heights

- `groundAt` should return `raycast(terrain, [cam.x, cam.y, cam.z], ray.direction)`, with
  y, and fall back to the old plane intersection if that returns null. `toScreen` already
  uses `p.y`.
- **The convention change.** `P.y` and `RNode.y` become absolute. Today they mean "above
  the flat ground at 0", so on `FlatHeight(0)` nothing changes, which is why this can land
  before real hills.
- Where code means "above the ground", use
  `rel = p.y − terrain.heightAt(p.x, p.z)`, or better, the alignment's `depth[]`:
  - `structures()` in `roaddraw.ts`: the "is it raised" tests (`Y(i) > 0.05`) become
    depth tests. Deck undersides and piers run down to `terrain.heightAt` instead of 0.
    Piers go where `kind === 'bridge'`.
  - The cutting and tunnel block in `drawRoads`:
    - Use `depth < −0.3` for "sunk" and `kind === 'tunnel'` for "covered", instead of
      `DEEP = −9`.
    - The slope tops are `sections()`'s `l` / `r` points, not `top(y)` at y 0.02.
    - The retaining walls run from the road edge up to those points.
    - Portals go at span boundaries between `cutting` and `tunnel`.
  - The hole strips (`holes.strip(flat, …, 0.02)`) become
    `drapeStrip(terrain, pts, i => [secs[i].left, secs[i].right])`, drawn with `holeMat`.
    The stencil then marks exactly the pixels of ground over the cutting on a hillside.
  - Anything placed "on the ground": trees, lamps, street furniture, vehicles on at-grade
    roads. Add `terrain.heightAt(x, z)`, or use the road's own y.

### Step 4: replace the grade solver in `Network.check`

In `roads.ts` `check()`:

- Build `limits` as now, but in absolute heights. `c.e` (the crossed road's height) is
  already absolute once nodes are. Drop the water-sampling loop: `alignRoute` gets water
  from the height source. If you keep `FlatHeight` with an `isWater` callback, you get the
  same result.
- ```ts
  const sp = { ...alignSpec(def), maxGrade: G };   // Over/Under only shape the crossing limits, as now
  const al = alignRoute(flat, this.ground, sp, { y0: this.endHeight(a), yL: this.endHeight(b), limits });
  if (!al.ok) return res(al.reason);
  ```
- `path = al.path` (every 5 m, absolute y).
- `profile = { s: al.s, y: al.y, … }`. grade.ts's `heightAt(profile, t)` works on it
  unchanged, because the samples are evenly spaced.
- `cost += al.cost.total` replaces the `RAISE_COST` / `TUNNEL_COST` sum. The units were
  calibrated to match: a 3 m bank costs about 600 a metre, against 510 today.
- `bridges` and `tunnels` become the counts of spans of those kinds. `raised` and `sunk`
  become the summed lengths of `bridge`/`embankment` and `tunnel`/`cutting`.
- Keep `solveProfile` for the "level" and "up" height modes. `align` only does "auto"
  (cheapest). Or add a target-height term to `unitCost` later.
- The blueprint's long section (`main.ts`, "ground, the road's height, and what it has to
  clear") can plot `al.ground` against `al.y` and shade `al.spans`.

### Step 5: plots and buildings

- In `Network.lotFree` (or where lots are accepted), add
  `const pad = levelPad(this.ground, rectCorners(l.x, l.z, l.rot, l.w, l.d), l.kind)`.
  Refuse the lot if `!pad.ok`, and store `l.y = pad.y` (a new optional `Lot` field).
- `buildgen` places the building at `l.y`. The plot's garden follows the ground.
- Draw `pad.walls` as thin boxes, from the pad down to the ground for `fill` walls and
  from the pad up to it for `cut` walls.
- Terraces step down a hill by calling `levelPad` once per house.

### Step 6: water and the lake

- `isWater` everywhere becomes `terrain.isWater(x, z)`.
- The lake and beach circles in `main.ts` become `waterMesh(terrain, ti, tj)` per tile,
  drawn after the ground. A shore band can come from `slopeAt` and height above
  `waterLevel`.
- For the current map, keep the hand-placed lake with `FnHeight`: a bowl under the circle,
  with `waterLevel` 0.1 inside it.

### Step 7: land registry claims for earthworks

After a segment's profile is solved (in `commitRoads`, next to `claimJunctions`):

```ts
const secs = sections(route, terrain, sp);
earthworkPolys(route, secs).forEach((e, k) => land.claim(`earth:${seg.id}:${k}`, 'road', e.polys));
```

- Release them with `land.releaseWhere((k) => k.startsWith(`earth:${seg.id}:`))` when the
  segment goes.
- Plots, parks and trees then keep off embankment and cutting slopes with no new code:
  they already ask `land.free()`.
- A separate `'earthworks'` owner would let parks keep grass on banks. That's a one-word
  change to `land.ts`'s `Owner`.

### Step 8: real elevation

- **Terrarium:**
  1. `const src = new TerrariumHeight(new LocalFrame(lat, lon), 12)`.
  2. For each `[tx, ty]` in `src.tilesFor(box)`, fetch
     `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/${tx}/${ty}.png`.
  3. Decode it with `createImageBitmap` and a canvas `getImageData`.
  4. Pass it to `src.addTile(tx, ty, data)`.
  5. Call `cache.invalidate(box)`.
- **OS Terrain 50:** `const src = new GridHeight(e0, n0)`, then `src.addAscii(text)` for
  each 10 km tile.
- Both go behind `CachedHeight` like the procedural terrain. Everything above is unchanged.
- Inland water isn't in elevation data. Pass `water: (x, z) => …` built from OpenStreetMap
  water polygons.

## Drawing tiles

The library stays free of three.js (it runs in workers). To draw a tile, use the shared ground
(`src/proto/ground/`, see `docs/ground.md`), so tiles look like the rest of the game:

```ts
const ground = new Ground({ terrain: true }); // rock and scree on steep ground, heather up high
scene.add(groundTile(tileMesh(src, ti, tj, { cells: 256 }), ground.material, origin));
```

The ground samples everything in world space, so it needs no UVs and runs on seamlessly across
tiles. Place tiles at `offset − origin` and call `ground.setOrigin(origin.x, origin.z)` whenever
the floating origin moves.
