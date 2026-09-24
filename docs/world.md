# World tiles and streaming

`src/proto/world/` is the scaffold that lets the prototype grow from one town to a region:
real geography, ~1 km tiles, a floating origin, streaming by level of detail, per-tile
authorities with deterministic seeds, and per-tile dirty tracking. It doesn't depend on three.js
or the DOM, so all of it runs in tests, in a worker, or headless. Nothing in the existing
prototype uses it yet. This page covers the API and then the order to plug it in.

```
 geo.ts        Region (lat/lon ↔ metres), RegionGrid (maps bigger than one region), slippy tiles
 tiles.ts      TILE = 1000, tile keys "i,j", tiles in a box, along a path, around a tile
 seed.ts       hashStr, tileSeed(world, key), entitySeed(world, key, id), unitSeed
 origin.ts     FloatingOrigin: render origin near the camera, 'rebase' events
 stream.ts     StreamManager: near/mid/far rings, hysteresis, budget, priority, async loaders
 worker.ts     workerLoader / serveLoader: the same loader across a Worker's message port
 authority.ts  TileStore: nodes, segments, claims, zones, edits; ownership, references, saves
 dirty.ts      DirtyPipeline: staged per-tile re-derivation; roadPipeline() = commitRoads as stages
 bench.ts      headless 50 × 50 km fly-through (bench.test.ts prints the numbers)
```

## Coordinates

- **World space is metres on a region's own projection.** Axes are three.js's: x is east, z is
  south (so north is −z), and y is up. The prototype's `Network` already works in these metres, so
  its town sits unchanged around the region origin.
- A `Region` is a transverse Mercator projection whose central meridian passes through its origin,
  with scale 1 there. It uses Krüger's series to n⁶, so round trips are good to a micrometre, and
  northings match the meridian arc to under a millimetre. The only real limit is distortion. A
  region 50 km out stretches ground by 3 × 10⁻⁵ (3 cm per km), which is why regions stop there.
- Maps bigger than one region use a `RegionGrid`. It is a grid of 50 km regions, placed on the
  anchor's projection, and each has its own origin at its centre. `transfer(p, from, to)` moves a
  position between regions exactly (through lat/lon). `localTransform` gives the rigid rotation
  and shift that draws a neighbour region's tiles near the border. It's accurate to about 1 cm
  within a km of the reference point. The rotation is meridian convergence, about 1° per 100 km
  east–west at 52°N.
- **Tiles** are `TILE` = 1000 m squares on each region's grid. Tile `"i,j"` covers
  x ∈ [i·1000, (i+1)·1000) and z ∈ [j·1000, (j+1)·1000). A key is local to its region, and
  `${region.id}/${key}` is globally unique.
- **Slippy tiles.** `slippyZoomFor(1000, lat)` picks the web zoom whose tiles are about 1 km
  across (z15 in Britain). `slippyCover(region, i, j, z)` lists the z/x/y tiles that overlap one of
  ours, so OSM vector tiles, PMTiles and Terrain Tiles can be fetched per tile.

```ts
const york = new Region('york', { lat: 53.959, lon: -1.0815 });
york.toWorld({ lat: 53.96, lon: -1.08 });  // { x: 98.5, z: -111.3 }
york.fromWorld({ x: 2500, z: -300 });       // { lat, lon }
slippyCover(york, 2, -1, slippyZoomFor(TILE, 53.96)); // [{ z: 15, x, y }, ...]
```

## Floating origin

```ts
const origin = new FloatingOrigin(/* threshold */ 2000, /* snap */ 1000);
origin.on('rebase', ({ dx, dz }) => { for (const g of tileGroups.values()) { g.position.x -= dx; g.position.z -= dz; } });
// every frame, before drawing
origin.update(view.x, view.z);
```

Positions everywhere in the game (network, lots, cars) stay as doubles in world metres. Only
the scene graph works in render space, and there are two rules for it:

1. **A tile's meshes hold vertices relative to the tile's own corner**, which is never more than
   1 km away, so float32 is good to 0.06 mm. The tile's group is placed at
   `origin.toRender(corner)`.
2. **Moving things** (cars, trains, the camera target, the sun's shadow box) convert with
   `origin.toRender()` when they write `position`.

A rebase then touches a few hundred group positions and no vertices. The test shows float32
error dropping from about 2 mm at 50 km to under 0.1 mm.

## Streaming

```ts
const stream = new StreamManager<TileData>({
  loader,                          // (req, signal) => Promise<TileData>, pure and serialisable
  rings: DEFAULT_RINGS,            // near 1.5 km, mid 5 km, far 12 km (to the tile's nearest edge)
  margin: 250,                     // hysteresis
  budget: { ms: 4 },               // main-thread time for load/unload handlers per frame
  maxInFlight: 8,
  bounds: { i0, j0, i1, j1 },      // the map
  worldSeed,
});
stream.on('load', ({ key, lod, data, replaced }) => { /* build meshes, add to scene */ });
stream.on('unload', ({ key, lod, data, reason }) => { /* dispose meshes */ });
// every frame
stream.update({ x: view.x, z: view.z, dir: dirFromAz(view.az), span: view.h });
```

- **Selection.** Each tile's distance is to its nearest edge, so the tile under the camera is
  always near. Rings grow with zoom as `radius × clamp(span / zoomRef, 1, maxZoom)`, and levels are
  only recomputed after the camera moves an eighth of a tile, turns about 10°, or zooms 5%.
- **Hysteresis.** A tile gets finer detail at a ring's edge, but only gets coarser `margin` metres
  beyond it, so wobbling on an edge does nothing.
- **Priority.** A tile's score is distance × (1 + ahead × (1 − cos θ)), where θ is the angle
  between the tile and the view direction. With the default `ahead = 0.6`, a tile behind the
  camera counts as 2.2× as far away. Ties are broken by key, so the order is deterministic.
- **Budget.** Unloads are handled first, then arrivals, nearest first. Handing tiles over stops
  when the frame's `ms` or `items` is spent. At least one goes through each frame, so progress
  never stops.
- **Changing level** loads the new level first. `load` fires with `replaced`, then `unload` fires
  for the old level with `reason: 'lod'`, so there's never a hole.
- **Cancellation.** A load that stops being wanted is aborted through its `AbortSignal`, and a
  result that arrives late is dropped. A failed load fires `error` and is retried after `retryMs`.
- **Workers.** `serveLoader(self, generateTile)` in the worker and
  `workerLoader(new Worker(...))` on the main thread. Cancelling a job the worker hasn't started
  skips it. Return typed arrays and pass `transfer` to avoid copies.

## Authorities

```ts
const store = new TileStore(worldSeed);
store.put({ kind: 'node', id: 'n1', x, z });
store.put({ kind: 'seg', id: 's1', a: 'n1', b: 'n2', mid: [], type: 'street' }); // → tiles touched
store.inTile('3,-2');            // { owned: Rec[], refs: Rec[] }: everything a tile's stages read
store.seedOf('lot:s1:L:3');      // entitySeed(world, owner tile, id)
const save = store.save();       // JSON-safe, sorted, authorities only
TileStore.load(save);
store.takeChanged();             // tiles to rewrite for an incremental save
```

- **What's saved:** road nodes and segments, land claims that nothing derives (a park the player
  placed, land use from real data), zoning, and player edits. **Not saved:** junction designs,
  road, junction, slip-road and island claims, plots, buildings, infill and meshes. Those are
  re-derived from the authorities and seeds.
- **Ownership.** A node belongs to the tile it's in. A segment belongs to the tile of its first
  node (`a`). Claims and zones belong to the tile holding their box's centre. An edit belongs to
  whichever tile owns its target.
- **References.** Every tile a record's geometry touches holds `id → owner tile`. A road across
  three tiles is stored once and referenced twice. Moving a node re-homes its segments, and their
  edits follow.
- **Ids** are stable strings. Player-made things use `store.newId('p')`, whose counter is saved.
  Generated things take ids from what they were generated from (for example
  `lot:${seg}:${side}:${n}`), so they need no counter, and reloading a tile gives the same ids.
- **Seeds.** `tileSeed(world, key)` and `entitySeed(world, key, id)` are 32-bit and pinned by a
  test. `unitSeed` converts them to the [0, 1) seeds that `buildgen.ts` takes.

## Dirty tracking

```ts
const pipe = roadPipeline({ junctions, claims, evict, plots, meshes }, { live: (k) => !!stream.loaded(k), priority: distToCamera });
pipe.mark(store.put(rec));   // any authority change
stream.on('load', ({ key }) => pipe.mark(key)); // a tile that streams in derives from scratch
stream.on('unload', ({ key }) => pipe.drop(key));
pipe.step({ ms: 3 });        // every frame, after stream.update()
```

Each stage has its own set of dirty tiles. When a stage runs on some tiles, the tiles it
reports as changed (or all of them if it returns nothing) become dirty for the next stage, out to
that stage's `radius`. A stage runs only once every earlier stage is clean. A change arriving
part-way makes an earlier stage dirty again, and that stage runs first. `roadPipeline()` has the
prototype's order and radii:

| Stage | Radius | Batch | Today in main.ts |
|---|---|---|---|
| junctions | 1 | 4 | `redesignJunctions()` |
| claims | 0 | 8 | `claimJunctions()` |
| evict | 1 | 8 | `evictFromWorks()` |
| plots | 0 | 2 | `queuePlots()` + `refreshInfill()` |
| meshes | 0 | 1 | `drawRoads()` + building chunk merges |

## Integration plan

Do these in order. Each step leaves the game working.

1. **Region and origin, no behaviour change.** Create one `Region` for the prototype's town
   (any lat/lon), plus a `FloatingOrigin`. Put `roadGroup`, `cityGroup`, the trees and the traffic
   meshes under one `worldRoot` group, and on `rebase` shift `worldRoot.position`. The town is
   ±560 m, so no rebase fires yet. The step is still worth doing now, because it makes every
   `position.set(x, …)` call go through one place.
2. **Building chunks nest in tiles.** `CH = 120` in main.ts doesn't divide 1000, so a chunk would
   straddle two tiles. Change it to 125 m (8 × 8 chunks per tile) or 250 m. The chunk key then
   becomes `${tileKey}/${ci},${cj}`, and unloading a tile disposes exactly its chunks.
3. **The land registry per tile.** `Land`'s 40 m spatial hash already nests (25 × 25 cells per
   tile). Give each loaded tile its own `Land` and route `claim`/`at`/`free` by tile key, spanning
   neighbours for claims that cross an edge. Road, junction and slip-road claims stay derived:
   the `claims` stage rebuilds them for its tiles. Claims in the `TileStore` (parks, land use)
   are copied in when a tile loads.
4. **Authorities move behind `TileStore`.** On every `buildRoad`, split or delete, mirror the
   change into the store with `importNetwork` (or per record), and `pipe.mark()` what it returns.
   `commitRoads(made)` becomes `pipe.step()` each frame. Each handler does today's work for the
   given tiles only: for example, junctions whose node is in `keys`, and lots whose (x, z) is in
   `keys`. For a while, keep `Network` as the in-memory graph that traffic and drawing read, with
   the store as the saved form. Numeric ids map as `n5` ↔ 5 and `s9` ↔ 9.
5. **Deterministic plots.** `Network` draws lot seeds from one shared `rng(seed)`, so layout
   depends on build order. Seed each lot from `entitySeed(world, owner tile, lotId)` with
   `lotId = lot:${seg}:${side}:${n}`, and infill regions likewise. Then a tile that reloads, or
   one built in a worker, grows the same town.
6. **Stream it.** Wrap each tile's derivation as a `StreamManager` loader: plots and building
   boxes for `near`, massing for `mid`, silhouettes for `far`. The `load` handler adds meshes; the
   `unload` handler disposes them and `pipe.drop()`s the tile. Once the handlers only take plain
   data, move the loader into a worker with `serveLoader`/`workerLoader`.
7. **Traffic per tile.** `Traffic` keeps working on the in-memory graph. Agents are only spawned
   on links inside near tiles (`stream.loaded(k)?.lod === 'near'`). Links in mid tiles keep flows
   and queues only, and far tiles keep zone matrices (ENGINE.md, "simulate flows, show agents").
   `traffic.seen` counts are per junction node, so they live with the node's tile, saved as edits
   if they should persist.
8. **Save and load.** A save is `store.save()` plus the economy's own state. Loading calls
   `TileStore.load()`, then `pipe.mark()` for each tile as it streams in. Incremental saves write
   `store.takeChanged()` tiles only, one IndexedDB row per tile.

### How the other sessions plug in

- **Terrain.** A height source is `(req: LoadRequest) => Float32Array` on a grid per tile, and it
  runs in the same worker as the tile loader. The grade solver reads it as a limit. Choose the
  grid by level (for example 65² near, 17² mid, 5² far, as the benchmark's shapes do). Real
  elevation (Terrain Tiles, Copernicus) is fetched per tile with `slippyCover()`. Heights belong
  to the tile's derived data, not the store: they come from the seed or from the source, and are
  never saved.
- **Economy.** Towns and zones are authorities. Zoning polygons go in the store as `zone`
  records. Population, jobs and service levels are per-town state, keyed by a town id and saved
  by the economy layer, not per tile. The economy runs at the far level on the whole map. It only
  reads tiles to find which zones a road or stop serves, via `store.inTile()`. Its trip matrices
  drive the flows that near tiles sample into agents.
- **Real data (OSM).** An importer writes `node`/`seg`/`claim`/`zone` records into the store per
  tile. Tags map onto the road catalogue. From then on it's the same pipeline as a player-built
  road.

## Running

```
npx vitest run src/proto/world            # tests
npx vitest run src/proto/world/bench.test.ts --reporter=verbose   # benchmark with its table
```
