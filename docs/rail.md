# The railway: stations, signalling and rail lines

Region plan step R3 (`docs/region.md`), which also covers loop M4 (`docs/loop.md`): railway
stations bought from Build > Stops, trains that run lines under signals, level crossings, and a
generated railway for the region map. Everything lives in `src/proto/rail/`. The library is pure
and tested; `draw.ts` and `game.ts` hold the three.js drawing and the HUD.

## What's in the game

- **Build > Stops > Railway station** is unlocked. You tap a level stretch of track (straight or
  gently curving: on the ground, on a viaduct or deep in a tunnel), on the side where you want the
  building. The sheet offers each layout that fits, with its price
  and the platform length (Short 60 m, Long 130 m, Very long 215 m). You then tap **Build this
  station**.
  - The blueprint shows green, or red where something is in the way.
  - Buildings on the site are bought and cleared.
  - Roads, junctions, industrial sites and other stations block it.
- **Choosing a station:**
  - The sheet opens on **quick picks** that suit the line:
    - on a double line: two side platforms, or an island;
    - on a single line: a passing loop with an island or two platforms, or one platform.
  - Every choice has its own row, and the blueprint and price follow as you change them:
    - **Tracks:** 1–4. Tracks beyond the line's own become loops, or fast lines through the middle.
    - **Platforms:** at the sides, islands between pairs of tracks, or on both sides of every track.
      A track with no platform is a through line: trains that don't call run straight through.
    - **Style:** a brick booking hall or a glass one (both from the building kit, `buildgen.ts`
      civic `station` and `station-modern`), or a halt with a shelter on each platform.
    - **Crossing the tracks:** a footbridge, with stairs to every platform, or a subway.
    - **Canopies** on or off.
    - **Platform length:** 60, 130 or 215 m.
- **A station is refused** on:
  - a gradient steeper than 1 in 200;
  - a curve tighter than 1,000 m;
  - an embankment, a ramp, a cutting or a shallow tunnel;
  - a bridge that can't be widened for platforms (below);
  - too little track;
  - points, or another station or level crossing, within its span.
  The sheet says which.

## Stations on curves, on viaducts and underground

- **On a curve** (`rail/station.ts`):
  - Platforms follow the track round any curve of 1,000 m radius or more. That's UK practice for
    new platforms: on a tighter curve the gap at the doors gets too wide.
  - Each platform edge that faces a track is set back by the train's overhang there, so the gap
    is never less than on the straight. A 23 m coach on bogies 16 m apart hangs in by
    16²/8R on the inside of the curve (its middle) and out by (23² − 16²)/8R on the outside (its
    ends): 32 mm and 34 mm at 1,000 m. The sheet gives the radius and the set-back.
  - The curve is measured as the circle through points 75 m apart all along the station (a curve
    is a polyline; `minRadius` on a piece of one reads its corners).
  - Island and side platforms, canopies, the footbridge and the subway all follow it: the
    footbridge crosses square to the track where it is, and its stairs meet each platform under it.
- **On a viaduct:**
  - Where the whole station stands on bridges 4.5 m up or more, it's a viaduct station. Its deck is
    widened under every track and platform, with parapets along its edges and cross-heads on
    columns every 18 m. No column stands on a road passing underneath.
  - Each platform has stairs and a lift down to a booking hall at street level beside the viaduct.
  - Only bridges that can be widened carry one: masonry arches, steel girders, concrete beams and
    box girders. A timber trestle, a truss either side of the tracks, a long main span or a bridge
    that lifts are refused, and the sheet says why.
  - The bridge stops a metre into the station's deck and ends on a pier there
    (`setBridgeSkip`, `game/bridges.ts`); roaddraw leaves the stretch alone (`setDeckSkip`).
  - The deck is the railway's, like a bridge: roads may pass under it later, buildings can't go
    there. Only the booking hall is the station's land.
- **Underground:**
  - Where the rails are at least 10 m down (a bored tunnel, not an open cutting), it's an
    underground station. The platforms stand in a box of walls round the tracks, with a passage
    over them at the middle and stairs down to each platform. A shaft of stairs, escalators and a
    lift rises from the passage to the booking hall (or, for a halt, a canopy over the stairs) at
    street level beside the line. No canopies below ground.
  - Only the entrance is the station's land: the ground over the platforms stays free to build on.
  - The rail tool's height has a fourth setting, **Deep**, to get a line down there: it dives to
    14 m below the ground as soon as the gradient allows, and stays there (`grade.ts`, `DEEP`).
- **None of these gets a depot siding:** their lines' trains start at a platform.
- **Trains** call at all of them as anywhere else: the track graph and the signalling don't care
  what a station stands on.
- **The economy:** they're `rail_station` stops like any other (`RailGame.econ`).
- **Prices** (list, before the purse's share): on top of the platforms, the building and the
  track, a viaduct station's widened deck is £650 a square metre and its stairs and lifts £320,000
  a platform; an underground station's box is £2,400 a square metre of its plan, its shafts and
  lifts £450,000 a platform, and its entrance shaft £900,000. So a two-platform 130 m station costs
  about £1.4m on the ground, £3.1m on a viaduct and £9m underground (the game charges a tenth of that: `Purse.price`).

## The underground view

- The round button under the compass (the view button, while a tool is in use, is between them)
  turns it on and off (`ui/shell.ts`, `#ugbtn`). The ground, the buildings and everything else on
  the surface fade back, over a dark green, so tunnels, underground platforms and the trains in
  them show (`game/underview.ts`).
- **How it's drawn:** in two passes split by a level plane 0.3 m under the ground, so every
  triangle is drawn exactly once and nothing is sorted against anything else:
  1. the surface, into an off-screen target (sRGB, 4× multisampled, with its depth and a stencil:
     the ground leaves out the cuttings and river beds that mark the stencil first);
  2. everything under the plane, straight to the screen, over a dark floor 70 m down (under the
     deepest tunnel), with the sky fading to dark beyond it;
  3. the surface laid over it at 25%.
- At full opacity the passes give the ordinary picture, pixel for pixel (checked: 0.3/255 on
  average, with a cutting in view; the rest at anti-aliased edges, and along the line where a
  cutting's walls cross the plane), so the fade in and out (0.35 s) starts and ends without a
  jump. Every frame of it is a straight blend of the two pictures: sampled frame by frame, the
  screen's brightness runs 78 → 69 → 59 → 50 → 45 and back to exactly 78. (A first go let the
  ground fade to the sky's colour behind it, and flashed brighter for two frames.)
  Once the view is off, the game draws in one pass again.
- Covered tunnels have walls now (roaddraw), hidden under the ground until the view is on, and no
  grass verges inside them.
- **Taps** in the view mean what's drawn deep down: the station tool and a tap on a station or a
  train look at the level of the deep track under the finger. Otherwise an underground station is
  found only by its entrance, so a tap on a building over its platforms still picks the building.
- **On a hilly map** (the region), everything is lifted onto the hills in its vertex shader
  (`drape.ts`); the clipping planes cut by height above the ground there, not in world height, so
  the view splits the same way over a hill as on the flat.
- **Deep** always goes under what it crosses (it implies Under).
- **Saving:** a station's structure and height are part of the railway's save (`RailwaySave`), so
  viaduct and underground stations come back as they were.
- A station remembers the rails' height it was built at, and only finds track at that height
  again: a surface line laid over a tunnel doesn't take its underground station.
- **What it costs** (the whole town, SwiftShader, Fast tier, 412×915 DPR 2, median frame):
  | View | Frame | Draw calls | Triangles |
  |---|---|---|---|
  | Ordinary | 593–660 ms | 693–797 | 964k–1,064k |
  | Underground view | 834 ms | 758 | 1,069k |

  Each pass leaves out the meshes wholly on the other side of the plane (and anything marked
  `userData.surface`, like the woods' trees), so the view draws no more than the ordinary one; the
  extra is the off-screen target and laying it over. (The shadow passes are counted in the calls.)
- **Gotchas found on the way:** three.js only re-applies clipping planes when the camera changes
  between draws, so the second pass looks through a copy of the camera. And the sun's shadows are
  drawn with the surface pass (only what's on the surface casts them there). The off-screen target
  is freed once the view is off.
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
- **The map starts with no railway:** the player lays the track, builds the stations and draws
  the lines. Trains start at the platforms where a station has no room for a depot.

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
  - Lines that share a single-track station are counted together. Between them they can run one
    train more than they have passing loops, and more is refused, with the reason.
  - The loop rule above only applies where trains come the other way, so a circular line
    doesn't deadlock on it.
- **Clearance points:** a signal stands where its track is 3.8 m clear of every track it meets
  beyond (at least 12 m short of the points). A train held there is clear of the other line.
- **Level crossings:** a block over a crossing is *claimed* with the rest of the train's run, so
  single-line safety is unchanged. But the barriers only come down as the train approaches (its
  braking distance plus the barriers' 9 s). The train *holds* the block only once they're down
  and the road is clear. Until then the signal before the crossing stays red. Cars stop a metre
  short of the barriers.
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
- **The region starts with no railway** (the user: "no rail, no upgraded roads, then it's up
  to the player"). The 6 km region's generated main line and branch (`rail/region.ts`) went
  with that map.
  - A single-track branch leaves the city's straight through points. It runs to the nearest
    village off the main line, with a passing loop at its station.
  - There's one line per route.
  - It was tried on seeds 1, 2, 3, 7 and 42 of `claude/work-region`'s generator: 4 stations and
    2 lines each, 6.7–8.3 km of track, trains calling and no reds.
  - **In the game:** `seedTown()` lays it on a generated map before the streets. Streets built
    afterwards cross it on the level where the rules allow, or bridge it. They're refused through
    its stations (a rule for every road now). Each station slides along its straight to find
    clear ground.
  - On seed 7 (the default region) that gives 4 stations, 2 lines, 3 trains and 7 level crossings,
    with no console errors. The region is still marked "Coming soon" in the menu (`maps.ts`, the
    region session's to flip).

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
- `src/proto/rail/stations.test.ts`:
  - a station on a 1,250 m curve: platform edges never nearer a platform track than on the
    straight, nor further by more than the overhang; trains call there;
  - an 800 m curve refused;
  - a viaduct station: its platforms on the deck, its hall at street level, the hall claimed and
    the deck not (a street can be built under it), dearer than on the ground;
  - refused on a trestle, a through truss and a suspension bridge, and on the ramp up;
  - trains call at it, and it gets no depot;
  - an underground station in a Deep tunnel: platforms 10 m down or more, only the entrance
    claimed, dearer than a viaduct one, found by a tap over it, trains calling;
  - refused in a cutting;
  - viaduct and underground stations saved and restored as they were.
- `e2e/stations.e2e.mjs`: by touch at 412×915, DPR 2, on the region (`?map=region&seed=42`): a curve, a viaduct and a
  deep tunnel laid; a station built on each from Build > Stops (the underground ones by tapping
  the track in the underground view); a line drawn between the two underground stations and its
  train calling at both with its doors open, 14 m down; the view off again with nothing left over;
  no console errors.
- `e2e/rail.e2e.mjs`: by touch at 412×915, DPR 2:
  - the starter line runs;
  - a branch line across the north road gets a level crossing;
  - two stations are built from Build > Stops and a line drawn between them;
  - its train calls at both with its doors open;
  - the crossing shuts;
  - Transport > Railway lists the lines;
  - no console errors.

## Performance (measured on the old starter town, SwiftShader, Fast tier, 412×915 DPR 2)

| View | Frame (median), before → after | Draw calls, before → after | Triangles, before → after |
|---|---|---|---|
| Start | 283 → 283 ms | 252–256 → 264–265 | 253k → 255k |
| Railway close up | 167 → 167 ms | 35 → 47 | 187k → 192k |
| Whole town | 333 → 333 ms | 444–450 → 460–462 | 281k → 281k |

- The per-frame JavaScript is unchanged within noise: 4.8–6.3 ms after, 6.2–7.5 ms before.
- The static parts of every station are merged into one mesh per material. Signal lamps, barrier
  arms and crossing lights are instanced and updated in place, and only when they change.

## The interim M4 on the integration branch

- **What happened:** the bus-loop session built its own M4 at the same time: stations in
  `game/rail.ts`, trains kept apart in `traffic.ts`, and the line tool taking stations. Its commit
  says it was a stand-in until R3.
- **How the merge resolves it:** the game now uses this railway. Build > Stops > Railway station,
  Transport > Railway, and taps on trains and stations all come here.
- **The interim code is gone:** `game/rail.ts` and its test (`game/trains.test.ts`) are deleted.
  So are its functions in `main.ts`, the rail lines in `game/lines.ts` and the station badges.
- **In `traffic.ts`:** its line trains and the rule that kept trains apart are removed. The
  wandering trains (`addTrain`) are back as they were before it. Nothing in the game adds them.
- **Bus lines** work as before. The Lines tool takes bus stops only.
- **The economy** counts only this railway's stations as `rail_station` stops (`RailHooks`).
- **The e2e:** `e2e/rail.e2e.mjs` is this branch's.

## The adversarial review, and what it changed

A separate review tried to break the railway, and found six bugs. All are fixed, with a test
each in `src/proto/rail/review.test.ts`:
1. Two lines sharing a single line could fill every passing place and deadlock. Capacity is now
   counted across lines.
2. The loop rule deadlocked a circular line.
3. A car could stop 0.2 m onto a crossing and hold the train, which waited for it, for 90 s or
   more. Crossings were also shut from over a kilometre away.
4. Withdrawing a line left trains still waiting in its depot to run it anyway.
5. A road could be built with a junction within 25 m of a level crossing: the crossing's own
   road, or a side street added later.
6. A train held at a signal could stand with its nose on the points.

Also fixed: a train as long as its platform stood 7 m past it; and a rebuild that broke a
station deleted its line and trains (now they wait until the track is back).

## Not done yet

- **Partial sharing is slow.** Where a second line shares only part of a single line, its trains
  can wait a long while at a loop for the first line's trains. They keep running, but slowly.
- **Stations across several lines** aren't built yet: a station spanning two parallel railways or
  a junction, with its platforms shared between them. Nor are more add-ons, such as car parks,
  bay platforms and bus interchanges.

- Trains reversing on a double line change tracks by a crossover that isn't drawn: the train
  steps across at the terminus.
- There's no freight, and no timetables beyond "call at each station in turn".
- A station can't be moved or resized, only demolished and rebuilt.
