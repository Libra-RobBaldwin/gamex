# The railway: stations, signalling and rail lines

Region plan step R3 (`docs/region.md`), which also covers loop M4 (`docs/loop.md`): railway
stations bought from Build > Stops, trains that run lines under signals, level crossings, and a
generated railway for the region map. Everything lives in `src/proto/rail/`. The library is pure
and tested; `draw.ts` and `game.ts` hold the three.js drawing and the HUD.

## What's in the game

- **Build > Stops > Railway station** is unlocked. You tap a straight, level stretch of track, on
  the side where you want the building. The sheet offers each layout that fits, with its price
  and the platform length (Short 60 m, Long 130 m, Very long 215 m). You then tap **Build this
  station**.
  - The blueprint shows green, or red where something is in the way.
  - Buildings on the site are bought and cleared.
  - Roads, junctions, industrial sites and other stations block it.
- **Layouts:**
  - On a double line: two side platforms, or an island, with the tracks spread round it.
  - On a single line: a passing loop with an island or two platforms (so trains can cross there),
    or one platform and no loop.
  - Each station gets a booking hall from the building kit (`buildgen.ts`, civic `station`), a
    footbridge where there are two platforms, and canopies.
- **A station is refused** on:
  - a gradient steeper than 1 in 200;
  - a curve tighter than 1,000 m;
  - a bridge, embankment or cutting;
  - too little track;
  - points, or another station or level crossing, within its span.
  The sheet says which.
- **Rail lines:** use **New line from here** on a station's sheet, or **Transport > Railway >
  New rail line**. Tap stations in order, then Create. Tapping the first station again (with three
  or more) makes the line circular.
  - A line runs A→B→C→B→A, or round the loop.
  - A depot siding (with a shed) is laid past the first station's platforms if there's room, and
    trains come out of it.
  - A line gets two trains: an intercity and a local if every platform takes 130 m, otherwise
    two locals. It gets as many of those as you can afford, and at least one.
- **Trains:**
  - They stop at each platform with a dwell (15 s, plus however long the people take to board).
  - They open the doors of the cars that are alongside the platform, on the platform side
    (selective door opening for a train longer than the platform).
  - People queue along each platform (`TownCrowds.setPlatforms`), get off, and board through
    each car's `doorPositions`.
  - Tapping a train shows its line, its next station, whether it's held at a red signal, its
    speed and who's on board.
- **Level crossings:** a single-carriageway road can cross a railway on the level where:
  - the line is 100 mph or less;
  - the road crosses nearly square to it (within 45°);
  - it's at least 25 m from any road junction.
  
  Draw either one across the other with Join. Anything else is still bridged, as before. The
  crossing gets a deck, barriers and wig-wag lights. Road traffic stops at the barriers
  (`Traffic.barriers`).
- **Signals:** UK four-aspect colour lights on the driver's left at the end of every block. They
  show red, single yellow, double yellow or green, by how many blocks ahead are reserved for the
  train approaching.
- **Money and the economy:**
  - Stations are charged at the purse's share of their price (`Purse.price`). So are trains
  (the economy's `VEHICLES` list prices: a local £120,000).
  - Stations are `rail_station` stops in the economy, and rail lines are its lines
    (`TownHooks.rail`, ids from 1,000,000). The economy gets journey times along the track, fares
    at twice the bus fare, and each train's running costs.
- **The starter town:** its two wandering trains are replaced by a line between two stations on
  the main line, **Central** and **Parkway**. The line humps 7.8 m over the high road, so it's
  only level near the ends, and the stations are at x ≈ ±420. The line runs an intercity and a
  local. They start at the platforms: there's no room for a depot there.

## How the signalling works

- **The track graph (`track.ts`):**
  - Every track is a *piece*.
  - A single line is one piece used both ways.
  - A double line is two pieces, one each way, and trains run on the left.
  - Stations reshape the track they stand on: a loop's two tracks, the tracks round an island,
    and a depot siding behind a short "throat" of points. The network keeps its one centre line,
    and `roaddraw.ts` leaves out the stretches a station lays itself (`setTrackSkip`).
- **Blocks:** track is cut into blocks at stations and at intervals of at most 400 m. Every piece
  within 40 m of points shares one junction block, so crossing moves never meet.
  - A block is *safe* if a train can stand in it without cutting anyone off: one-way track, a
    loop's platform, a terminus or a depot.
- **Reservations (`sim.ts`):**
  - A train may only enter a block reserved for it, and a block is reserved for one train at a
    time.
  - Reservations are made in chunks that run on to the next safe block, all or nothing. So on a
    single line a train never sets off towards another one.
  - Before a chunk with a level crossing is reserved, the barriers must be down and the road
    clear.
  - Points are set by the route the train was given. Planning avoids blocks other trains hold
    where there's another way, such as the other track of a loop.
  - A train won't take the last free track at a loop while a train going its way holds the
    other. That was a real deadlock with three trains and two loops.
  - A single-track line can run one train more than it has passing loops. More is refused, with
    the reason.
- **Braking:** trains brake for the end of their authority with their own service brake
  (`TrainDef.brake`, `trainBraking()` in `catalog.ts`). Each step is cut short at the signal, so
  no train can pass a red one. Speed limits apply through points (50 mph), round a station's
  loop (40 mph) and in depots (15 mph), and trains brake for them ahead.
- **Rebuilding:** when the network changes, the graph is rebuilt from it, and each train is put
  back on the track where it stood. A train that no longer fits goes back to its depot. Stations
  keep their position and heading, so they find their track again after a seg is split
  elsewhere. A station whose track is broken (points built through it) closes until it's
  straight again.

## The API (for the line tool and the region)

```ts
import { Railway } from './rail/railway';
const rw = new Railway(net);                  // main.ts keeps one; rebuild() is called from commitRoads
rw.useRoads(traffic);                         // level crossings hold its cars
const { plans, reason } = rw.plan(segId, s, side, len?);  // every layout that fits: title, notes, cost, ok, blocked
const { station, cleared } = rw.build(plans[0]);           // claims 'station:<id>' land; cleared: lots taken down
const line = rw.addLine([a.id, b.id], loop, [TRAINS.dmu]); // RailLine, or a reason string
rw.addTrain(line, def); rw.removeTrain(t); rw.removeLine(line); rw.remove(station.id);
rw.update(dt);                                // with the traffic, in the same steps
rw.stations, rw.lines, rw.trains, rw.shapes   // (shapes: each station's platforms, building, land)
rw.sim.log                                    // every call: { train, line, station, t }
```

- **`RailLine`** has the same shape as a bus `Line` (`game/lines.ts`): `{ id, num, stops, loop,
  offer? }`, plus `depot?` and `colour?`. `callOrder(stops, loop)` gives the order calls are made
  in. The bus-loop session's line tool can take stations as stops: tap a station (use
  `rw.stationAt(p)`, or the station badges), then `rw.addLine(ids, loop, trains)`.
  `RailGame.startLineTool(first?)` is a working rail line tool that can be reused.
- **The region:** the region generator's `SettlementInfo` already has the right shape.
  ```ts
  import { planRegionRail, layRegionRail } from './rail/region';
  const plan = planRegionRail(spec.settlements, { bound, isWater });
  const made = layRegionRail(railway, plan); // { stations, lines, problems, length }
  ```
  - The main line runs through the city and the two towns it lies most nearly between (or from
    the city out through two towns). Stations are on straights, and gentle curves join them.
  - A single-track branch leaves the city's straight through points. It runs to the nearest
    village off the main line, with a passing loop at its station.
  - There's one line per route.
  - It was tried on seeds 1, 2, 3, 7 and 42 of `claude/work-region`'s generator: 4 stations and
    2 lines each, 6.7–8.3 km of track, trains calling and no reds.
  - Lay the railway before the roads, with `cross: 'bridge'`. B roads laid across it afterwards
    get level crossings where the rules allow.

## Tests

- `src/proto/rail/sim.test.ts`:
  - two trains on a single line with a passing loop never share a block and never pass a red,
    over six game days;
  - three trains and two loops keep running, and a fourth is refused;
  - a train behind another stops at the red signal, within 40 m of it, braking no harder than
    its own brake allows;
  - trains call at every station of their line, in order.
- `src/proto/rail/rail.test.ts`:
  - the layouts on offer;
  - land claims;
  - refusals on a gradient, a ramp, a bridge, a curve and short track;
  - a train longer than its platforms refused;
  - a level crossing never has a car on it while a train holds its block, with a straight road
    and with a curved one;
  - depot sidings keep off roads;
  - the region's railway laid and run;
  - the same railway for the same region.
- `e2e/rail.e2e.mjs`: by touch at 412×915, DPR 2:
  - the starter line runs;
  - a branch line across the north road gets a level crossing;
  - two stations are built from Build > Stops and a line drawn between them;
  - its train calls at both with its doors open;
  - the crossing shuts;
  - Transport > Railway lists the lines;
  - no console errors.

## Performance (starter town, SwiftShader, Fast tier, 412×915 DPR 2)

| View | Frame (median), before → after | Draw calls, before → after | Triangles, before → after |
|---|---|---|---|
| Start | 283 → 283 ms | 252–256 → 264–265 | 253k → 255k |
| Railway close up | 167 → 167 ms | 35 → 47 | 187k → 192k |
| Whole town | 333 → 333 ms | 444–450 → 460–462 | 281k → 281k |

- The per-frame JavaScript is unchanged within noise: 4.8–6.3 ms after, 6.2–7.5 ms before.
- The static parts of every station are merged into one mesh per material. Signal lamps, barrier
  arms and crossing lights are instanced and updated in place, and only when they change.

## Not done yet

- Trains reversing on a double line change tracks by a crossover that isn't drawn: the train
  steps across at the terminus.
- There's no freight, and no timetables beyond "call at each station in turn".
- A station can't be moved or resized, only demolished and rebuilt.
- The region map calls `layRegionRail` once the region session's loader wants it; that's not
  wired in here (`src/proto/region/` belongs to that session).
