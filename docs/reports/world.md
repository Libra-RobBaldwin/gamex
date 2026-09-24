# Report: world tiles and streaming scaffold

Branch `claude/world-tiles`. It adds new files only: `src/proto/world/*` (about 1,800 lines with
tests), `docs/world.md` (API and integration plan) and this report. No existing file changed.
`npx tsc --noEmit` is clean. `npx vitest run` passes 106 tests: 46 new ones in 7 files, and the
repo's 60 existing tests unchanged.

## What was built

| Part | File | Summary |
|---|---|---|
| Geography | `geo.ts`, `tiles.ts` | Regional transverse Mercator (Krüger to n⁶, WGS84). x is east, z is south. `RegionGrid` handles maps larger than a region: 50 km regions with exact handover and a local rigid transform for drawing across borders. Tiles are 1 km, keyed `"i,j"`. Covers slippy z/x/y tiles and picks a zoom. |
| Floating origin | `origin.ts` | Render origin snapped to tile corners near the camera, with a `rebase` event and threshold hysteresis. |
| Streaming | `stream.ts`, `worker.ts` | near/mid/far rings, zoom-scaled. Hysteresis margin; priority by distance and view direction; per-frame budget in ms and/or items. Async loaders with `AbortSignal` cancellation, retry after errors, and load-before-unload level swaps. A worker bridge runs the same loader over a message port. |
| Authorities | `authority.ts`, `seed.ts` | `TileStore` for nodes, segments, claims, zones and edits. One owner tile per record, and references from every other tile it touches. Sorted, JSON-safe saves hold only authorities, plus incremental change tracking. Pinned 32-bit tile and entity seeds. Imports the prototype's `Network`. |
| Dirty tracking | `dirty.ts` | Staged per-tile propagation with per-stage radius and batch, a budget, `live`/`priority` hooks and re-entrancy. `roadPipeline()` is commitRoads as five stages. |
| Benchmark | `bench.ts` | A 50 × 50 km map with a corner-to-corner flight, simulated latency and main-thread cost, and a save-size estimate. |

## Decisions

- **One projection per region, not one per world.** Doubles are precise enough for one plane
  across a continent, but distortion isn't. Scale grows as 1 + x²/2R², so at 50 km a kilometre
  measures 3 cm long. Regions are therefore 50 km squares, each with its own origin. A map up to
  about 100 km across fits in one region without anyone noticing. Handover goes through lat/lon,
  which is exact, so positions never drift.
- **x east, z south.** This is three.js's right-handed y-up frame with north as −z, which is
  what the prototype's camera and network already assume.
- **Tile keys are strings `"i,j"`.** The same value works as a map key, a save-file key and a
  worker message, with no conversion. A key is local to its region; `${region}/${key}` is global.
- **Distance to a tile's nearest edge, not its centre.** The camera's own tile is always near
  wherever the camera is in it, and ring radii mean "how much ground around me".
- **Hysteresis is on the wanted level, not the loaded one.** A load in flight doesn't get
  cancelled by a wobble either.
- **Unloads first, arrivals nearest-first, at least one item a frame.** Unloading frees memory
  and costs little. The minimum of one item means a single slow item can't stall streaming.
- **A segment is owned by its first node's tile.** This is cheap and stable, and it keeps a node
  and the roads leaving it in one tile's save. Midpoint ownership would be more "fair", but it
  changes whenever the road is edited anywhere along its length.
- **Reference lists are saved as hints.** They're derivable, but a tile streamed alone from
  storage can then tell which neighbours to fetch. The test checks that the saved hints match what
  a load recomputes.
- **An edit follows its target.** If the target is removed, the edit stays where it was. The
  player's intent outlives the thing, so a rebuilt road can pick the edit up again.
- **Stages run strictly in order.** A later stage runs only when every earlier one is clean. That
  is the same guarantee commitRoads gives today ("the order can't let one thing be built over
  another"), and it still holds when changes arrive mid-way.

## Test results

46 new tests, all passing.

- **Geography.**
  - Round trip within ±50 km: worst error under 1 µm (the requirement is 1 cm).
  - Northings on the origin meridian match a numerically integrated meridian arc to under 0.5 mm.
  - Scale factor at 50 km is between 1 + 2.5 × 10⁻⁵ and 1 + 3.5 × 10⁻⁵.
  - Works across the antimeridian and in the southern hemisphere.
  - Region-grid handover is lossless (under 1 µm).
  - The border rigid transform is within 5 cm up to 1 km from its reference point.
  - Slippy tile numbers match OSM (central London z10 is 511/340), and the cover contains every
    sampled point of the tile.
- **Floating origin.** Float32 error 50 km out: about 2 mm raw, under 0.1 mm after rebasing.
  Groups shifted on `rebase` stay put in world space.
- **Streaming.**
  - Ring selection, bounds and zoom scaling.
  - Level swap order (load, then unload).
  - No events at all while the camera wobbles within the margin of an edge.
  - Unload only past the margin.
  - Item budget (at most 3 a frame, nearest first).
  - Millisecond budget with a fake clock: 3 ms items and an 8 ms budget give 3 a frame; one
    50 ms item still gets through.
  - In-flight cap with ahead-first ordering.
  - Aborting, and ignoring late results.
  - Cancelling a level change when the camera turns back.
  - Error, then retry after the delay.
  - `dispose`.
- **Worker.** A pure generator runs across a real `MessageChannel`, and a typed array comes back
  intact. Jobs queued in the worker that are cancelled before they start are skipped.
- **Authorities.**
  - Owner and cover rules.
  - A road across three tiles is referenced from two of them.
  - Moving a node re-homes its road and the road's edit, and reports all four tiles touched.
  - Dangling roads are refused; edits of removed things are kept.
  - save → JSON → load → save is byte-identical.
  - Incremental change tracking.
  - Seeds are pinned by an inline snapshot and are distinct across 2,500 neighbouring tiles.
  - Imports a real `Network` and round-trips it.
- **Dirty tracking.**
  - Order and radius spread.
  - Narrowed output stops later stages.
  - Duplicate marks are merged.
  - A pipeline can start part-way down.
  - Re-entrant marks from inside a stage.
  - Tile and millisecond budgets.
  - Priority, the `live` filter and `drop`.
  - Driven end to end by a `TileStore` edit.

## Benchmark

`npx vitest run src/proto/world/bench.test.ts --reporter=verbose`

The setup:

- A 50 × 50 km map (2,500 tiles) with the default rings (near 1.5 km, mid 5 km, far 12 km).
- The camera flies 65 km corner to corner at 60 fps, with a 4 ms per-frame budget and 16 loads
  in flight.
- Simulated worker latency is 60, 30 and 15 ms for near, mid and far tiles.
- Simulated main-thread hand-over cost is 1.2, 0.3 and 0.05 ms per tile, plus 0.02 ms per unload.
- The manager's own bookkeeping is measured in real time and added on top.

| | 100 m/s | 400 m/s |
|---|---|---|
| Flight | 650 s, 39,033 frames | 163 s, 9,759 frames |
| Loads / unloads | 3,536 / 3,347 (5.4 / 5.1 per s) | 3,536 / 3,347 (21.7 / 20.6 per s) |
| Frame time in `update()` p50 / p99 / max | 0.02 / 0.78 / 7.8 ms | 0.03 / 2.47 / 4.9 ms |
| Frames over budget by more than one item | 2 (0.005%) | 0 |
| Bookkeeping, mean | 0.036 ms | 0.046 ms |
| Near coverage (camera tile and its 8 neighbours) | 99.8% | 99.3% |
| Peak resident tiles | near 19, mid 94, far 410 | same |

Across runs, the worst bookkeeping frame varies from about 3 to 10 ms. It is a single frame per
run, from JIT warm-up or garbage collection, not selection. p99 stays under 2.5 ms against the
4 ms budget.

**Memory.** The synthetic tile data peaks at 1.7 MiB. A modelled drawn cost of 6 MiB per near
tile, 400 KiB per mid tile and 16 KiB per far tile peaks at 154 MiB. About 114 MiB of that is the
19 near tiles. These per-tile sizes are assumptions; replace them with measured chunk sizes once
step 2 of the integration plan is done.

**Save size.** A whole-map save at 93 authority records per tile (40 nodes, 48 roads, 3 claims,
a zone and an edit) holds 232,500 records in 21 MiB of JSON, about 9 KB per tile. It compresses
well, and a derived town's geometry is never in it.

## Known limits and next steps

- **Nothing is wired in yet.** `docs/world.md` has the eight-step plan. Step 2 (changing the
  120 m chunks to 125 m so they nest in tiles) needs a one-line change to `main.ts`, which was
  off limits here.
- **Too many near tiles for a phone.** 19 near tiles at 1.5 km is a lot for a phone. The rings
  are options, and 1 km near is 9 to 13 tiles. The benchmark's memory model suggests near detail
  dominates memory, so adaptive quality could shrink the near ring as well as the pixel ratio.
- **Far tiles are 1 km each.** At a 12 km far ring that means about 410 tiles. A far level that
  covers the whole region should use coarser 4 or 8 km super-tiles (a quadtree step). The manager
  would need a per-ring tile size for that; its structure allows it but it isn't built.
- **Region handover is one active region at a time.** There's no automatic switch when the camera
  crosses into another region. `RegionGrid.cellOf` plus a margin would detect it; the switch would
  then `transfer` the camera and `origin.moveTo`. Neighbour-region tiles drawn by the border use
  `localTransform`, which is good to centimetres near its reference point but not across a whole
  region.
- **`slippyCover` doesn't wrap across the antimeridian.** The projection itself is fine there.
- **Loaders run one at a time on the worker side.** `serveLoader` is serial per worker; use a
  pool of workers for parallel generation.
- **Selection allocates a little each frame.** It uses small arrays over the ~500 tile slots,
  which is fine at the measured 0.04 ms, but could be pooled if GC shows up on phones.
- **The store holds all authorities in memory.** That is 21 MiB of JSON for 2,500 dense tiles,
  and less in memory. Per-tile saves and `takeChanged()` make it possible to page tiles to
  IndexedDB later. Loading a lone tile whose segments reach an unloaded node's tile isn't handled
  yet: the reference hints say what to fetch, but the store requires both nodes to be present.
- **Ownership can change seeds.** `entitySeed` includes the owner tile, so if a road's first node
  moves to another tile, lots seeded by that road regrow differently. That is deliberate, since a
  road moved that far is a different place, but a stage should reuse old seeds for lots it keeps.
