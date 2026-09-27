# Water system

`src/proto/water/` turns any height source into the sea, lakes, rivers and canals, answers the
questions the rest of the game asks about them, and draws them. Everything is derived from the
ground: no circles, nothing placed by hand. The core is pure functions with no three.js or DOM,
so it can run in a Web Worker. Import it from `./water` (`index.ts`); the three.js materials are
in `./water/material` so a worker never pulls in three.

It's new files only. Its tests, benchmark and demo run on the game's 50 km land
(`worldmap/land.ts`).

**In the game** (`src/proto/game/water.ts`, `GameWater`): steps 1, 2 and 5 below are done, on
today's flat map.
- **The lake:** a noise-warped hollow in an `FnHeight` (an 8 m beach falling 4% to the water, then
  shelving to 4 m deep), drawn at −0.3 m; the water system gets −0.2 m, so what it counts as water (8 cm deep) reaches just past the drawn waterline. No rivers or basins are worked out
  from the flat.
- **Roads:** `isWater` is the water system's, keeping 9.5 m off the waterline (a street's band clear of the reeds).
- **Land:** the lake claims its land as `'water'`, 3 m past the waterline.
- **Drawing:** the ground mesh dips into the bed with the shore colours, `patchGroundMaterial` is
  chained after the ground's patch, and the water and reeds take two draw calls. The light blends
  part way to dusk in the evening.
- **For bridges:** `crossings`, `navLimits` and `pierBans` (step 3 and 4) are exposed on
  `GameWater`, and `window.proto.water` gives it to tests.

By still water the tile's shore distance is the distance to the waterline interpolated between
raster points (marching squares on the depth), so the foam line and beaches are smooth. Still water in the game is drawn flat,
at the level, so the ground cuts the waterline. The ground mesh is a ring over the bank (2 m across the beach), a fan over the flat bed and 100 m cells elsewhere. `light(scene, sun)` turns the scene's sun, sky and background towards dusk with the water.

## Conventions

As in `docs/terrain.md`: metres, **x east, z south, y up**, absolute heights. Gradients are rise
over run. Speeds are metres a second.

## 1. The water system (`water.ts`, `region.ts`, `rivers.ts`, `flood.ts`)

```ts
const water = new WaterSystem(landSource({ landform: 'uplands', seed: 7 }).source);
const ground = new CachedHeight(water.terrain);   // the ground with river channels cut, and its water
```

Pass the **raw** source (not a `CachedHeight`): the water system samples each 8 km region
coarsely (32 m), and a cache would fill every 2 m cell of it. `water.terrain` is a `HeightSource` for everything else (meshing, alignment,
platforms, picking); put the cache in front of that.

### What it finds

Hydrology is worked out per **region** (8 km square, with 2 km of margin so catchments reaching in
from outside count) on a 32 m grid, the first time anything asks about it:

| Water | How |
|---|---|
| **Sea** | Ground below `sea` connected to open water (the region's edge, or at least `seaArea` km²). An inland hollow below sea level is not sea. |
| **Lakes** | Priority-flood (Barnes et al.) fills every closed hollow to its spill level. A hollow becomes a lake if it is deeper than `basinDepth + breach·√catchment` and bigger than `basinArea`; shallower ones are breached by the river running through (it cuts through the sill). A lake stands `drawdown` below its spill point. Water the source already has (OpenStreetMap water on real data) is kept as it is. |
| **Rivers** | The same flood gives every cell a drainage direction (no pits, no loops) and the catchment of every cell. A stream starts at `riverArea` km². Reaches run from a source or confluence to the next confluence, the sea or the region's edge. |
| **Widths** | Hydraulic geometry: width `widthK·A^widthExp`, depth `depthK·A^depthExp` (A in km²), scaled up so rivers read at the game's scale: 5 m at the source (the least that shows on a 4 m raster), 14 m at 20 km², 25 m at 60 km². |
| **Meanders** | On flat floors, sine-generated curves (the direction swings as ω·sin(2πs/M), M ≈ 11 widths), limited by the room on the floor, off on steep valleys, fading to nothing at confluences. |
| **Levels** | The surface never climbs downstream; it stays under the ground (with a freeboard), is smoothed along the reach, and tributaries meet the main river's level. Flow speed is Manning's formula on the surface slope. |
| **Estuaries** | Rivers of at least `estuaryArea` km² reaching the sea are tidal (at sea level) up to where the valley floor rises `estuaryRise` above the sea, widening to a mouth (at most `estuaryMouth`) over the low ground only, deepening, with gentle mudflat banks. |
| **Channels** | Each reach cuts a flat-bottomed trough with banks at `bankSlope` that rise until they meet the ground (steeper where they must), then ease back into it. |

Everything finer than the region grid (the exact shoreline, the channel, depth, flow) is a pure
function of the point. Tiles and point queries go through the same code, so they agree exactly
and every tile meets its neighbours.

### Queries

```ts
water.isWater(x, z)            // boolean
water.depthAt(x, z)            // m of water (0 when dry)
water.waterLevelAt(x, z)       // surface height, or null
water.groundAt(x, z)           // the ground or bed, channels cut
water.kindAt(x, z)             // 'sea' | 'lake' | 'river' | 'estuary' | 'canal' | null
water.bodyAt(x, z)             // stable id of the body ('sea', 'basin0,0:3', 'r0,0:12', …)
water.flowAt(x, z)             // { x, z, speed }: unit direction downstream and m/s (0 on still water)
water.distanceToShore(x, z)    // signed m: + in the water, − on land, ±64 beyond
water.probe(x, z)              // all of the above in one call (about 0.5 µs)
water.watercourseAt(x, z)      // the river or canal here: class, width, depth, surface, design (flood) level,
                               //   flow, offset from the centre line, channel half-width, clearance, draught, catchment
water.crossings(a, b)          // every body a straight line crosses: where it's wet, the navigation channel,
water.crossingsAlong(path)     //   normal and design levels, headroom and the lowest soffit allowed
water.reaches(rx, rz)          // the river network of a region
```

### River classes and navigation (`types.ts`)

`NAV[cls]` is what each class asks of anything crossing or using it:

| Class | Clearance above the design level | Draught | Channel kept clear of piers | Freeboard (design above normal) |
|---|---|---|---|---|
| `stream` | 0.6 m | – | – | 0.6 m |
| `river` | 2.5 m | – | half the width, at least 4 m | 1.5 m |
| `navigable` (≥ 25 m wide, ≈ 1.8 m deep) | 4.5 m | 1.8 m | 60%, at least 12 m | 1.5 m |
| `canal` | 2.7 m | 1.2 m | 70%, at least 6 m | 0.3 m |
| `estuary` | 18 m | 4 m | 40%, at least 40 m | 3 m |
| lake / sea | 3 m / 30 m | 1 m / 6 m | the middle half / at least 100 m | 0.5 m / 4 m |

### Parameters (`WaterParams`, defaults in `DEFAULT_WATER`)

`sea` (none by default), `region` 8000, `margin` 2000, `cell` 32,
`riverArea` 0.5 km², `widthK` 3.2 / `widthExp` 0.5, `depthK` 0.45 / `depthExp` 0.4, `maxWidth` 120,
`bankSlope` 0.6, `basinDepth` 4 m, `basinArea` 0.1 km², `breach` 1.2, `drawdown` 0.3 m, `seaArea`
2 km², `estuaryRise` 3 m, `estuaryLength` 2500, `estuaryMouth` 420, `estuaryArea` 4 km²,
`manning` 0.035, `meander` 1.

### A coast

Give the source ground below sea level out at sea and pass `{ sea: 0 }`: the 50 km land's source
does (`landSource({ landform: 'coast' })`), and so does real elevation.

### Real elevation

Pass a `TerrariumHeight` or `GridHeight` straight in, with `{ sea: 0 }` for a coast. Rivers come
from flow accumulation alone, hollows fill by priority-flood, and the sea is found by
connectivity. Inland water from OpenStreetMap goes in as the source's `waterLevel` (an `FnHeight`
wrapper, or a small `BaseHeight` subclass) and is kept as lakes; rivers still come from the
ground, so snap OSM river lines to them later if they must match.

## 2. Tiles and drawing (`surface.ts`, `material.ts`)

```ts
const t = water.tile(ti, tj);          // 1 km of rasters at 4 m, with 64 m of margin (cached, 24 tiles)
const w = waterSurface(t);             // the water mesh, or null: positions + aWater (depth, shore, flow) + aKind
const colours = shoreColours(t, groundMesh);   // RGBA per ground vertex: beaches, banks, the bed
const reeds = reedSpots(t);            // [x, y, z, rotation, scale] per tuft
```

`WaterTile` holds, per raster point: `ground`, `level`, `kind`, `body`, `flowX`/`flowZ`,
`shore` (signed distance), and the nearest water's kind and level.

three.js (`material.ts`):

```ts
const waterMat = waterMaterial(rippleTexture(), WATER_LIGHT.day);   // one material for all water
new THREE.Mesh(waterGeometry(w), waterMat)                          // renderOrder after the ground
waterMat.uniforms.uTime.value = seconds;  setWaterLight(waterMat, WATER_LIGHT.dusk);
patchGroundMaterial(groundMat)            // lays the shore colours over the grass; keeps stencil settings
reedMesh(reeds, reedGeometry(), reedMaterial())    // one InstancedMesh per tile (uTime in material.userData.time)
```

The shader: turquoise over the bed in the shallows, dark with depth (from the vertex, so there's
no depth texture and no extra pass); two scales of ripple, each at two phases of a flow cycle so
the texture scrolls along the current without stretching; foam at the waterline, washing in on
the sea and in fast water; a fresnel sky reflection warmer towards the sun, and a sun glint. Four
texture reads a pixel (two with `waterMaterial(ripple, light, { still: true })`, for water that
never flows, like the game's lake). The ground mesh carries on under the water, so the bed shows through.

**Two draw calls per tile**: the water mesh and the reeds.

## 3. Land claims (`claims.ts`)

```ts
waterClaims(t, { buffer: 0, block: 200, tolerance: 0.6 })   // [{ key, polys, kinds, bodies }]
claimWater(land, t, owner)                                   // replaces the tile's earlier claims
```

Outlines are marching squares on the signed shore distance (smooth, `buffer` metres beyond the
waterline if asked), cut into 200 m blocks, simplified to 0.6 m. Islands are slit into their
outline, so every claim is a simple polygon that `land.ts`'s tests handle as they are.

## 4. Hooks for later (`hooks.ts`)

| Hook | What there is |
|---|---|
| **Canals with locks** | `planCanal(ground, path, { width, depth, maxRise, freeboard, maxCut, lockLength })` gives level pounds joined by locks (flights where the rise is more than `maxRise`), never standing above the ground (no embankments: canals keep to the contours). `canalReach(canal, ground)` + `water.addReaches([...])` cuts it in and shows it, as still water of class `canal`. |
| **Ports and quays** | `findQuays(water, box, { minDepth, reach, minLength, maxSlope, landDepth })` gives shore runs with deep water close in and level land behind: ends, length, depth, facing, body. `Port` is the interface the game fills in (quays, berths). |
| **Ferry and ship routes** | `navGrid(water, box, { cell, draught, keel, clear })` marks water deep enough and away from the shore; `shipRoute(nav, a, b)` is A* over it, pulled straight where the water allows. `FerryRoute` is the interface. |
| **Bridges** | `water.crossings(a, b)` / `crossingsAlong(path)`, then `navLimits(crossings, deck)` gives grade.ts `Limit`s: the deck above the flood level everywhere over water, and above the class's headroom over the channel; `pierBans(crossings)` gives the stretches where piers may not stand. |

## 5. The demo

`npx vite --port 5173`, then open `/water-demo.html`. It isn't in the production build's inputs.

- It shows a phone-sized view with the game's isometric camera. Buttons pick Coast, Valley, Lake
  or Uplands, toggle day and dusk, and measure the water's cost ("Measure").
- Drag to pan and pinch or scroll to zoom. On a desktop, hovering shows what the water system
  says about the spot under the pointer.
- URL options: `?preset=coast|valley|lake|uplands&light=day|dusk&at=x,z&h=metres&az=radians&t=seconds&bench=1`.

## 6. Park ponds (`worldmap/water.ts` `addPond`, `worldmap/terrain.ts`)

A park's pond is a level surface in a hollow with an irregular outline, never a circle (the user's
rule, `docs/briefs/play.md` 12). It goes through the water system's own shapes rather than a disc
drawn by the park: `WorldWater.addPond({ x, z, r, seed }, heightAt)` makes a small lake shape (the
radius clamped to 8–30 m, the shore wandering with `waves` from the seed) at the ground's height
where it is put, keeps it in `ponds`, and returns its `LakeSpec` (with `level`). From then on the
terrain lays the ground level to it and a little past its shore, with the hollow's rim rising to the
land within three times its radius and never falling below the water, so it holds (`heightAt`), and
cuts its bed below the water (`bed`, from `lakesGround`); `kindAt`, `edgeDistance`, `wet`,
`mayBeNear` and `pondAt` answer for it. `worldmap/pond.test.ts` checks all of that on a seeded map.

What the game does when a park makes one (the play session's files: `main.ts` `addInfill` and
`applyPonds`, `parkplan.ts` `parkPond`, `game/water.ts` `addPond`):

1. `const L = WORLD.water.addPond({ x, z, r, seed }, WORLD.terrain.heightAt)` at the park's spot, then
   `gameWater.shapes.addLake(L)` so the live water's own `MapWater` has the bowl too (`main.ts`
   makes `GameWater` over `MAP.water`, a copy of the plan's water cut to the live area).
2. Remake the relief field's box round it (`WORLD.terrain.partField`, the drape's grid), and the
   ground mesh (`gameWater.groundGeometry`) and its paint round it, so the hollow shows.
3. Rebuild the water tile it lies in (`WaterSystem.tile`, its surface mesh and reeds; the tile cache
   must forget the old one) and claim its land (`gameWater.claim`), so plots and paths keep off it.

The park planner picks the spot: the lowest in a park of 2,000 m² or more where the water lies a
metre inside the park with its bank clear of the roads and the paths (`parkplan.ts` `parkPond`); the
park's lawn, trees, beds and bandstand keep off it (`buildgen.ts` `makeRegion`). A pond is made once
per spot: a park found again (a road edit nearby, a reload) asks for the same spot and keeps its pond.

## Integration plan

In order; each step leaves the game working.

### Step 1: one water system, and `isWater` from it (`main.ts`)

Replace `LAKE` and `isWater`:

```ts
import { WaterSystem } from './water';
// with the terrain library's step 1: the land's heights (or FnHeight for a hand-made scene)
const water = new WaterSystem(new FnHeight(plan.terrain.heightAt));
const ground = new CachedHeight(water.terrain);
const isWater = (p: P) => water.isWater(p.x, p.z);
const net = new Network(isWater, BOUND, 11);   // and net.ground = ground (terrain step 1)
```

To keep today's flat map with one lake, make the lake a hollow in an `FnHeight` (a noise-warped
bowl) and let the water system fill it: it comes out shaped by the ground.

### Step 2: drawing

- Delete the `beach` and `lake` circles.
- Build the ground tiles (terrain step 2) from `water.terrain`, add
  `shoreColours(water.tile(ti, tj), m)` as a 4-component `color` attribute, and call
  `patchGroundMaterial(groundMat)` once. The stencil settings are kept.
- Per tile: `waterSurface` → a mesh with the shared `waterMaterial`, `renderOrder` after the
  ground; `reedSpots` → `reedMesh`. Set `uTime` each frame, and `setWaterLight` when the time of
  day changes.
- Trees: replace the lake test with `water.distanceToShore(x, z) > -8` (skip).
- Ground meshes of 2.5 m or finer near water show the smallest streams; at 3.9 m (256 cells) a
  5 m stream can break into pools.

### Step 3: the road and rail height solver

`align.ts` already takes water from the height source: over water it must bridge (at the spec's
`water` clearance) or tunnel. Make the clearance the water's:

```ts
const cs = water.crossingsAlong(centreline);
const al = alignRoute(centreline, ground, { ...sp, water: 0.6 + deck }, { y0, yL, limits: [...limits, ...navLimits(cs, deck)] });
```

`navLimits` puts the deck above the design (flood) level everywhere over water and above the
class's headroom over the navigation channel, so a footbridge over a stream is low and a road
over a navigable river is high, as they should be.

### Step 4: bridges

The bridges library (another session) takes `crossings`: `pierBans(cs)` for where piers may not
go, `c.soffit` for the underside, `c.design` for the flood level, and `watercourseAt` for the
class, width and flow (scour, pier shape).

### Step 5: plots, parks and the land registry

- Add `'water'` to `Owner` in `land.ts` (one word).
- When a tile loads: `claimWater(land, water.tile(ti, tj), 'water', { buffer: 3 })` (3 m keeps
  plots off the bank). Release with `land.releaseWhere((k) => k.startsWith('water:ti,tj:'))`.
- Plots, parks and street trees already ask `land.free()`, so they keep off water with no new
  code. `levelPad` refuses wet plots through the height source.

### Step 6: later

- **Canals**: the player draws a path; `planCanal` gives the levels and locks, `addReaches` shows
  it, claims come from the tile as for any water, and bridges over it get the canal's 2.7 m.
- **Ports**: offer `findQuays` sites where the player can build a port.
- **Ferries and ships**: `navGrid` over the service area, `shipRoute` between quays.
- **Streaming**: regions and tiles are pure functions of the source and their indices, so they
  can be built in a worker (transfer the typed arrays).
