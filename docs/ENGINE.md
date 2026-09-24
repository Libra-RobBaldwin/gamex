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

## Keeping it smooth

The rule is that **per-frame work depends only on what's near the camera. Work triggered
by a change depends only on what the change touches.** Never "check everything against
everything".

- **Done.** Clearing trees used to test every tree against every road each time a
  building went up. That caused a spike every third of a second. It now asks the land
  registry and only looks at trees on the new plot.
- **Done.** Adaptive quality watches frame times and steps down when frames run slow:
  pixel ratio, then shadow-map size, then shadow refresh rate, then no shadows. It steps
  back up when there's headroom. Tap the stats line to see fps, sim and draw time, draw
  calls and the current tier.
- **Next.**
  - Move building generation and mesh merging into a Web Worker. They're the remaining
    ~10 ms spikes.
  - Put facade textures into an atlas, so each chunk is a few draw calls, not one per
    material.
  - Use cheaper building LODs past a few hundred metres.
  - Run the traffic sim on a fixed timestep, decoupled from rendering, so a slow frame
    never slows the simulation.

## Next steps, in order

1. Move plots and buildings into the land registry as claims, not a separate list.
   Parks, car parks and plots then share one "who owns this" answer, and irregular
   plots can be cut from the land left after road claims instead of a 5 m grid.
2. Generalise the pipeline into per-tile dirty tracking with stages as pure functions.
3. Add a zone and trip model and link-flow assignment, then drive vehicle spawning from
   it.
4. Add terrain height tiles (the grade solver already takes limits from anything).
5. Add streaming tiles and the middle and far levels of detail.

## The economy layer

`economy.ts` (with `econdefs.ts`, `econlines.ts`, `econaccess.ts`, `econtowns.ts`) is the
**demand model** authority from the diagram above. It owns what buildings are *used for* and
how full they are, each town's memory (what it's been fed, its hysteresis counters),
industries' production, and the loads on your lines and stops. The game owns the geometry.
Catchments, the transit skim, zone-pair times, reach and trip tables are derived, rebuilt at
each monthly review or when service changes. Only the authority is saved (`save()` and
`Economy.load()`).

**Time.** It never runs per frame. `advance(gameMinutes)` steps it an hour at a time and
reviews every town once a "month" (`tune.monthDays`, default 30). Rates are per hour and
changes are per review, so the live game can make a month one game day without retuning.

**Simulate flows, show agents.** A line is a flow: each step moves the capacity its fleet
brings past each stop (vehicles × seats × step / cycle) round the loop once. People get off
(or change lines), then others get on. The cycle comes from the game's journey times plus
dwell, and dwell grows with the crowd. `vehicles()` places each vehicle a headway apart along
its line, with the load on its leg, for drawing buses, trains and lorries. A step costs lines ×
stops + stops + industries. Neither depends on population: a test counts the work.

**Getting about.** Lines between the same two stops are taken together, since people board
whichever comes first: their frequencies add and each carries its share. Routes and modes are
chosen on how long a journey *feels*: walking and waiting count double, as in WebTAG, and taking
a bus or train at all is worth a few minutes, so nobody rides 300 m. A journey on your lines
counts towards reach only for the share of people who found room on board last month, so a
full line can't feed a town like one with seats to spare. Fares have a fixed part that builds
up over the first 2–3 km, so short hops earn next to nothing.

**Pairs, not all pairs.** A zone pairs one to one with the zones within about a kilometre,
then with blocks of zones, three times coarser at each step out to 25 km (a block is reached
at its middle by car and at its best stop by your lines). The pairs grow with the number of
zones, not its square. A review costs those pairs + stops², plus one pass over the buildings:
50 towns, 500 stops, 200 lines and 1,000 vehicles, or 144 towns of 2,300 zones, run a month in
well under a second in node.

**Freight.** For each cargo the economy works out, back from every place that takes it, how
long it takes to get there from each freight stop (riding, waiting and handling). A line only
takes cargo to a stop nearer by that measure than the one it's leaving, so freight always gets
closer, with any number of changes (lorry to railhead, train, lorry to the works). It can't be
shuttled for fares, and an industry doesn't hand its output to a depot whose only route runs to
another depot beside it. Production rises when most of it is collected and falls back to where
it started when it isn't, as in 2D.

**How towns change.** Each month, each use of building in each town gets a demand:

| Use | Grows with | Capped by |
|---|---|---|
| Homes | reach: workers who can get to a job within 30 min, shops within 20, leisure within 30 (by car via the car oracle, on foot, or by your lines where there's room), shared out among everyone competing for them | — |
| Shops | customers and workers who can reach them | goods delivered |
| Offices | workers who can reach them | passengers arriving to visit a workplace (not those going home) |
| Works | workers who can reach them | building materials delivered |

Businesses open a little ahead of the workers they need, and further (up to about half again)
when what they need is delivered to spare, so feeding a town draws jobs and the homes follow.

A town finds some of what it needs for itself (about half of what it started with), and half
its homes are wanted whatever its people can reach (the retired, those working from home), so
an unserved town shrinks towards a floor rather than vanishing. It is taken to be in balance
when the map is made, within limits: one with more jobs than homes is held back so it doesn't
grow on its own, and one far short (an estate with no jobs in reach) is only partly lifted, so
it still shrinks towards its floor and a trickle of service can't make it boom. Demand is
smoothed, then set against capacity:

- After two months above capacity it builds. It restores abandoned buildings first, then
  uses a free plot in the zone where demand is keenest, or densifies (house → terrace →
  flats → tower) where people most want to be and there's nowhere left to spread.
- After three months well below capacity, people leave the emptiest, worst-placed
  buildings. Those are abandoned, and cleared six months later. A cleared plot is kept for
  the use it was cleared of, as planning would, so a town doesn't empty its homes, fill their
  land with offices and then want the homes back.
- Buildings come in lumps, so it never builds what it couldn't fill, or abandons what it
  would want back: no oscillation. When what's left is too lumpy to give up any more, it has
  settled.
- A request the game declines rests that zone or building for six months.
- Occupancy moves in quickly and out slowly, and only once low demand has lasted.

Every town reports a status (growing, stable, stalling, declining), a headline, ranked
reasons in plain words ("shops only 40% supplied with goods", "no bus or rail service") and
the numbers for a town panel. Growing means something went up (and the game put it up) or
people moved in; demand that nothing comes of isn't growth, and demand that has fallen and
settled isn't stalling.

**Plugging it into the live game.**

1. *World.* Towns from the town centres. Zones are blocks of lots (the lots along one street
   `row`, or ~150 m cells), with the free plots the queue still holds (not the lots the
   economy cleared: it keeps those for their old use). Buildings are `Lot`s,
   with capacity from `USE`. Stops come from `seg.stops`, lines from a line editor, industries
   from the map.
2. *Oracles.* `travelTime(stop, stop, vehicle)` and `carTime(zone, zone)` come from the traffic
   graph, as skims rebuilt when `commitRoads()` runs (then call `networkChanged()`), not a
   search per call.
3. *Clock.* Call `advance(dt × GAME_MIN_PER_S)` from the frame loop. It only does work on hour
   boundaries.
4. *Actions* (`takeActions()`):
   - `add`: queue a plot in that zone, then `addBuilding(lot, req)`, or `decline(req)` if
     none fits. The game's own growth from its plot queue must be switched off, since the
     economy asks for what the town needs.
   - `densify`: rebuild the lot as the next kind, then `updateBuilding`, or `decline(req)`
     when the lot can't take it (roads.ts lots are sized by kind).
   - `vacate`, `abandon`, `restore`: change how the building looks.
   - `demolish`: remove it.
5. *Show it.* `traffic.ts` draws buses and trains from `vehicles()`, mapping each leg to its
   route. Money events feed the HUD, and `town(id)` fills the town panel.
6. *Next.* Feed car trips from the trip tables into traffic spawning as link flows; let
   passengers queue per stop pair rather than per line, so people left behind by a full bus
   take the next one on another line.
