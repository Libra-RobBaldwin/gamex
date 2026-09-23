# Engine architecture: scaling from a town to a region

The 3D prototype (`src/proto`) started life as libraries that each had their own idea of
the world: plots checked roads, the junction designer checked plots, and the parks checked
neither. Each added rule fixed one clash and missed the next. The fix is structural. There
are a few **authorities** that own the facts, **reference data** that sets the rules, and
**derived** layers that are rebuilt from the other two and never edited by hand. On top
sits a **pipeline** that decides the order.

```
        reference data (catalog.ts, standards.ts, building kits)
                    │ read by everything
 ┌──────────────────┼────────────────────────────────────────────┐
 │  authorities     │   what's true — the only things saved      │
 │  network graph (roads.ts) · land registry (land.ts)           │
 │  demand model (zones, trips) · player overrides               │
 └──────────────────┬────────────────────────────────────────────┘
                    │ pipeline: dirty areas re-derived in order
 ┌──────────────────┴────────────────────────────────────────────┐
 │  derived         │   rebuilt, never edited                    │
 │  junction designs → junction shapes → land claims →           │
 │  plots → buildings → meshes · link flows → visible vehicles   │
 └───────────────────────────────────────────────────────────────┘
```

## What exists now

| Piece | File | Role |
|---|---|---|
| Land registry | `land.ts` | Every road, junction, slip road and island **claims** its polygons in a spatial hash. Plots, parks, car parks and street trees ask `free()`/`at()` instead of checking roads themselves. A junction that grows evicts whatever stands on its new land. |
| Design standards | `standards.ts` | The guiding reference: kerb radii by speed, slip-lane radius and width, roundabout sizes, splitter islands, footways. Geometry reads these, so the numbers live in one place. |
| Junction shapes | `jshape.ts` | One geometric model per junction: the carriageway with filleted corners or a flared roundabout, the footway, islands, where each road's markings stop, and where its stop line is. Drawing, traffic and the land registry all use the same shape. |
| Pipeline | `commitRoads()` in `main.ts` | Build roads, then design junctions, claim their land, evict what's on it, then lay out plots. It's the only way the town changes shape. |
| Road catalogue | `catalog.ts` | 69 road and 5 rail cross-sections, generated from rules rather than hand-listed. |

## Where it goes: many towns across many miles, simulated cheaply

The aim is a map far larger than Transport Fever's 11 km without its cost, because it
doesn't simulate every person. Three ideas make that work.

### 1. Simulate flows, show agents

- **Demand is statistical.** Each town is split into zones with population and jobs. A
  gravity model gives the trips between zones, per hour of the day. It's recomputed each
  game day, so its cost grows with zones and links, not with people.
- **Traffic is assignment, not agents.** Trips are loaded onto the network as flows on
  each link (incremental assignment, updated a slice at a time). Junctions already work
  like this: `junction.ts` scores forms and lanes from flows (degree of saturation,
  roundabout entry capacity, signal green splits), not from counting cars.
- **Cars and trains are samples of the flows.** Near the camera, vehicles are spawned at
  the rate each link's flow implies and driven with the current car-following model. Out
  of view they don't exist, and the numbers don't change. Counts seen on screen feed back
  into the flows, as `traffic.seen` already does.
- **Freight and passengers on your services** are tracked as loads per vehicle and per
  station, never as individuals.

### 2. Levels of detail for simulation, not just graphics

| Distance | Simulation | Drawing |
|---|---|---|
| Near (≈1 km) | Agents sampled from flows, full junction control | Full kit buildings, markings, street furniture |
| Middle (≈5 km) | Link flows and queues only | Building massing with baked facade textures, roads as ribbons |
| Far (whole region) | Zone trip matrices, service loads | Town silhouettes / impostors, trunk roads and rail only |

### 3. The world streams, and its content comes from seeds

- **Tiles.** The world is cut into tiles of about 1 km. Each holds its slice of the
  authorities: graph nodes and segments, claims, zoning, and edits. Tiles load and
  unload around the camera. Derived content is re-derived when a tile loads.
- **Determinism.** Everything procedural (plots, buildings, parks, trees) is seeded by a
  stable id, as buildings and infill regions already are. A save stores only the
  authorities and what the player changed, not the town's geometry. That keeps
  county-sized maps small on a phone.
- **Dirty areas.** When something changes, only the tiles and junctions it touches are
  re-derived. That's `commitRoads()` generalised from "the whole town" to "these tiles".
- **Workers.** Junction design, plot layout and mesh baking are pure functions of their
  inputs, so they can run in Web Workers while the main thread only draws.
- **Precision.** A floating origin, re-centred on the camera, keeps positions accurate
  tens of kilometres out.

## Next steps, in order

1. Move plots and buildings into the land registry as claims, not a separate list.
   Parks, car parks and plots then share one "who owns this" answer, and irregular
   plots can be cut from the land left after road claims instead of a 5 m grid.
2. Generalise the pipeline into per-tile dirty tracking with stages as pure functions.
3. Add a zone and trip model and link-flow assignment, then drive vehicle spawning from
   it.
4. Add terrain height tiles (the grade solver already takes limits from anything).
5. Add streaming tiles and the middle and far levels of detail.
