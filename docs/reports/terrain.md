# Report: the terrain library

Branch `claude/terrain-lib`. The code is new files only, under `src/proto/terrain/`, plus
`docs/terrain.md` (the API and integration plan) and this report. No existing file was
changed. All 60 existing tests still pass, and there are 37 new ones.

## What was built

| File | What it does |
|---|---|
| `height.ts` | The `HeightSource` interface; `BaseHeight` (slopes and normals by central differences; a default `sample`); `FlatHeight`; `FnHeight`; tile helpers; `CachedHeight` (a per-tile grid cache with LRU eviction and `invalidate(box)`). |
| `noise.ts` | Seeded gradient noise (random-angle gradients, quintic fade), fbm, ridged fbm, and hashes. |
| `procedural.ts` | `ProceduralTerrain` and five presets from flat to mountain. |
| `raster.ts` | Terrarium and Terrain-RGB decoding; an ESRI ASCII grid parser; a lattice `Mosaic` that samples bilinearly across tile seams and skips missing cells; `LocalFrame` (local metres ↔ latitude/longitude); Web Mercator helpers; `TerrariumHeight`; `GridHeight` (OS Terrain 50). |
| `align.ts` | Vertical alignment on terrain: dynamic programming over (sample, height, structure). |
| `earthworks.ts` | Where embankment toes and cutting tops meet the ground, and polygons for land claims. |
| `platform.ts` | Building pads: the level, cut and fill, retaining walls, and whether each kind of building fits (`PAD_RULES`). |
| `mesh.ts` | Tile meshes at any level of detail with stitching and skirts; water surfaces; stencil strips draped over the ground; cutting holes out of a mesh; ray casting for picking. |
| `index.ts` | One import for all of it. |

## Decisions

### Procedural terrain

- **Layered, broadest first.** The layers are:
  1. a domain warp;
  2. a regional surface a few kilometres across (the valley floors follow it);
  3. rolling hills;
  4. an upland mask, with ridged noise inside it;
  5. river valleys;
  6. lakes;
  7. an optional sea.

  Each layer has one parameter in metres, so the presets stay readable.
- **Rivers** are the zero lines of a broad noise field. The distance to the line is
  estimated as the noise value divided by its typical gradient. Around each line there's a
  rounded channel, a floodplain at the regional floor, and valley sides easing back into the
  hills. Valleys are wider and channels deeper in the uplands.
- **Lakes** are placed per 2 km cell from the cell's hash, so they're deterministic
  without a flood fill. Each has a flat surface just below the land at its centre, a bowl
  beneath, and a shore eased to just above the water.
- **Speed.** Evaluating a dozen octaves at every point took 130 ms for a 1 km tile at 2 m.
  The smooth layers have nothing finer than about 50 m in them, so they're now evaluated on
  a 7.8125 m lattice, cached in 250 m blocks, and read back with Catmull-Rom interpolation.
  That's smooth enough that lighting shows no grid. Only the sharp parts (the river channel
  and lake shores) are worked out per point.
  - The lattice is part of the terrain's definition, so `heightAt` and `sample()` agree to
    under a millimetre.
  - `sample()` interpolates separably (along x for every lattice row, then along z), which
    is four times less work per point.
  - The lattice spacing divides a 1 km tile 128 times, so coarser LOD grids fall exactly on
    lattice points and are evaluated directly, with no blocks built.
  - Blocks that only a mesh's one-cell border reaches into aren't built either.
  - Cold tiles went from 105 ms to 30 ms.

### Real data

- **All tiles go into one integer lattice mosaic.** Bilinear sampling near an edge simply
  reads the neighbouring tile's samples, so there's no seam code at all.
- **Missing tiles and no-data cells** are skipped and the other corners reweighted. They're
  never averaged in as zero.
- **The local frame** is an equirectangular tangent plane about an origin in latitude and
  longitude.
- **Terrarium** maps world (x, z) to latitude/longitude, then to global Mercator pixels,
  then to pixel centres. That's exact, with no approximation of Mercator tiles as
  rectangles.
- **OS grids** need no projection at all. They're offset from British National Grid
  eastings and northings.

### Alignment

- **Structures in the search.** The DP state is (sample, height index, structure). The
  structures are earthworks (cut or fill by volume, including side slopes), bridge (deck,
  plus piers that grow with height) and tunnel (per metre, once there's enough cover).
  Changing structure costs an abutment or a portal, so the answer comes in sensible spans.
- **Heights are a lattice** with four steps per sample equal to 98% of the gradient limit.
  The 2% in hand absorbs a final correction onto exact end and junction heights. Any step
  still over the limit is relaxed without moving the anchors.
- **A tiny quadratic penalty on height change** breaks ties. Tunnels and bridges come out
  at steady gradients rather than as staircases.
- **Coarse to fine.** The search first runs every fourth sample on a four-times coarser
  lattice, which is 16 times less work. Then it runs at full resolution within ±2 m of that
  answer. The coarse bounds are rounded outwards, so the coarse pass never rules out what
  the fine pass could do. If the fine band turns out infeasible, it falls back to the full
  search.
- **Before searching**, a two-envelope pass (as in grade.ts) prunes heights that can't be
  reached, and names the two constraints that collide when there's no answer. For example:
  "Can't climb 30.1 m to clear the flyover within 40 m of the start at 8% (needs 376 m)".
- **Costs** were calibrated against the game's `RAISE_COST` and `TUNNEL_COST`. A 3 m bank
  costs about 620 a metre against 510 today. A bridge beats an embankment above about
  7 m, and a tunnel beats a cutting at about 14 m.

### Meshing

- **Stitching and skirts are both on by default.** Stitching moves the in-between
  vertices on an edge that faces a coarser neighbour onto that neighbour's straight edges,
  which makes the crack exactly zero. Skirts cover rounding and the moment before a
  neighbour is rebuilt.
- **Normals come from a bordered grid**, so they match across seams.
- **UVs are in world space**, so textures run on across tiles.
- **Positions are relative to the tile corner**, which keeps float32 precise far out and
  suits a floating origin.
- **Openings for cuttings stay stencil-based**, as the game does now. The change is that
  the stencil strip must lie on the ground (`drapeStrip`) rather than at y 0.02.
  `cutHoles` covers the cases the stencil can't: exports, physics and picking.

### Platforms

- **The pad level is the cheapest one.** With cut and fill priced differently, that's the
  quantile of the ground at cut / (cut + fill), which leans slightly towards digging.
- **The slope is a least-squares plane fit**, so it doesn't depend on how the plot is
  turned.
- **Walls are runs along each edge** where the step to the natural ground is over 0.8 m.
  Steps smaller than that are graded.

## Tests

`npx vitest run`: 12 files, 97 tests, all passing (60 existing, 37 new). `npx tsc --noEmit`
is clean.

**Height sources (13 tests):**
- Slopes and normals are right.
- The cache agrees with its source and touches the tile map only when the tile changes.
- The procedural terrain is deterministic (the same seed gives the same ground whatever
  order it's asked in), and a different seed gives different ground.
- Grid sampling matches point queries in all three sampling paths (separable, on-lattice,
  off-lattice coarse).
- Tile edges are bit-identical between neighbours.
- The presets are ordered by relief, from under 1 cm to over 300 m.
- Rivers and lakes cover 0.5–30% of the land and sit low, and lake surfaces are level.
- The sea floods exactly the land below it.
- Terrarium decodes to known values and round-trips through the encoder.
- The ASCII parser handles no-data and truncation.
- OS grids are exact at the posts, bilinear between them, seamless across two tiles, and
  have the right slope across the seam.
- A missing corner isn't averaged in as zero.
- Terrarium tiles bridge a seam in the local frame.
- The sea is detected.

**Alignment (9 tests):**
- Flat ground is at grade for nothing.
- Gentle ground is followed within 0.3 m.
- A hill steeper than the limit gives a road a cutting (grade kept, ends exact) and a main
  line a tunnel through the crest with full cover, at a higher cost.
- A shallow valley gets an embankment, and a deep one a viaduct (never below ground, no
  bank over 15 m).
- Over the same hills the main line moves more earth than the road, and the road more than
  the rack railway, with costs in the same order. On gentle ground the rack railway stays
  within 1 m of it, while the main line is over 5 m off.
- The clearance windows over and under a road are kept.
- A junction is met exactly.
- An unreachable flyover is refused and named.
- Fixed and free end heights work.
- Water is bridged with boat clearance, tunnelled under when bridges are off, and refused
  when neither is allowed. An end in the water is refused, or accepted with a given height.
- Costs add up and spans tile the route.

**Platforms and earthworks (6 tests):**
- Flat ground needs nothing.
- A 10% slope balances cut and fill with no walls.
- A 20% slope gets a cut wall on the high side and a fill wall on the low one.
- Industry refuses slopes by gradient, and refuses long plots by wall height.
- The slope comes out the same however the footprint is turned.
- Floors stay above water, and wet plots are refused.
- Cutting tops and embankment toes are at the expected offsets.
- Earthwork claims land in the land registry.

**Meshing (8 tests):**
- Vertex and triangle counts are right at LODs 0–3, with and without skirts.
- Every triangle faces up.
- The index type switches at 65,535 vertices.
- Vertices are on the ground, and normals are unit length and match the source.
- Same-LOD neighbours share their edges exactly, normals included.
- Across two LODs, stitching reduces the crack from more than 0.1 m to under 1 mm.
- Skirts hang below every edge and face outwards.
- Water meshes appear only over water.
- Draped strips lie on the ground and face up.
- `cutHoles` removes the cells under a strip.
- Ray casting passes over a plain and hits a hilltop.

**Benchmark (1 test):** prints the timings below. Its assertion is loose (under 250 ms) so
a slow CI machine doesn't fail the build.

## Timings

Node 22, 4-core Xeon at 2.1 GHz. Medians of 9 runs, `upland` preset (the most expensive,
since ridged octaves are on).

| Task | Time |
|---|---|
| 1 km tile, 513² vertices (1.95 m), ground never asked about before (height sampling and mesh) | **30 ms** |
| The same tile with its ground already cached | 19 ms (12 ms of that is height sampling) |
| 1 km tile, 257² vertices (3.9 m), new ground / cached | 13 ms / 5 ms |
| Coarser LODs: 129², 65², 33², 17² | 6.0, 1.8, 0.5, 0.2 ms |
| `heightAt` through `CachedHeight` | 48 ns |
| `heightAt` on `ProceduralTerrain` directly (lattice warm) | 165 ns |
| `heightAt` on an OS Terrain 50 mosaic | 77 ns |
| Alignment, street, 1 km / 3 km | 3.2 ms / 11.8 ms |
| Alignment, main line, 1 km / 3 km | 2.9 ms / 16.7 ms |
| Alignment, rack railway, 3 km | 8.3 ms |
| Alignment, motorway, 3 km | 12.8 ms |

A full-detail 1 km tile comes in at 30 ms, inside the 50 ms target.

## Known limits

**Rivers and lakes**
- Rivers are the zero lines of noise. They don't strictly run downhill, can form loops, and
  don't join into a drainage network.
- There's no erosion.
- The river's water surface follows the regional floor, so it can rise and fall gently
  along its length.
- Lakes sit at one level, taken from the land at their centre, and are round-ish (with a
  wobbly shore). Two overlapping lakes can make a step. Upland tarns that need a flood fill
  to find their level aren't modelled.

**Procedural terrain**
- The lattice spacing is fixed at 7.8125 m. With `scale` below about 0.5, the finest hill
  octaves become coarse relative to the lattice.
- `sample()` on a coarse grid that isn't on lattice points uses direct evaluation, which
  differs from `heightAt` by millimetres.

**Alignment**
- There are no vertical curves. The gradient can change at every 5 m sample (within the
  limit). Smoothing into parabolic curves would be a post-pass.
- Heights are quantised to G × ds × 0.98 / 4. That's about 0.1 m for roads and about
  0.03 m for the main line.
- The fine pass searches ±2 m around the coarse answer. It has been seen to miss the true
  optimum by up to 0.04% of cost.
- **Cost model:**
  - there's no mass haul: dug material isn't reused as fill;
  - bridges have no span limit, and any bridge is costed per square metre of deck;
  - tunnel cost is flat per metre (with a small depth term);
  - the road's width is the same throughout.
- Only the "cheapest" mode is supported. "Level" and "up" should keep using grade.ts.
- The horizontal alignment is taken as given. Nothing re-routes around a hill.
- Crossing limits are still produced by `Network.check`.

**Platforms**
- One pad per footprint. There are no split-level buildings.
- Graded batter slopes are not added to the footprint.
- Walls are reported per edge run, not as solid geometry.

**Meshing**
- Stitching needs the caller to know each neighbour's LOD.
- Skirts are a fixed depth.
- The water mesh is flat quads on a 64-cell grid. The terrain hides their jagged edge,
  since they run a cell under the shore.
- `cutHoles` drops whole triangles by their centroid, so its edges are jagged at the cell
  size.

**Real data**
- The local frame is an equirectangular tangent plane. Its east–west scale drifts with
  distance north or south of the origin: about 0.6% at 50 km in southern England. That's
  fine within a region of a few tens of kilometres. Larger maps need a new origin per
  region, as ROADMAP.md already expects.
- PNG decoding is left to the caller (a canvas in the browser).
- Inland water isn't in elevation data and needs OpenStreetMap polygons. Sea is "at or
  below sea level", which suits OS Terrain 50's flattened sea but counts land reclaimed
  below sea level (the Fens' lowest parts) as sea unless `sea: null` is set.

**Not integrated.** Nothing in the live game uses any of this yet. The step-by-step plan
is in `docs/terrain.md`.
