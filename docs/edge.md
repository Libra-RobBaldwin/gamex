# The edge of the map, and the ways off it

The region (`/?map=region`) ends in a cut face all the way round, like a slice through the ground,
with a hazy far country below and beyond it. The motorway, the A roads and the main line run out
through the face to places off the map. Traffic comes in and goes out through them, the economy
counts the trips, and trains can run off the map to a station out there.

Code:
- `src/proto/game/edge.ts`: the face, the far country, `beyondEdge`.
- `src/proto/game/portals.ts`: finding the ways off, their places, traffic, signs and sheet, the
  station off the map.
- Roads laid out to the edge: `interchange/region.ts` (`roadsOut`, `splitLong`, the motorway run
  on) and `rail/region.ts` (`plan.out`).
- A few lines in `main.ts`, `game/econ.ts`, `traffic.ts`, `rail/draw.ts`, `rail/railway.ts`,
  `rail/game.ts` and `game/regionview.ts`. The town (`?map=town`) keeps its old slice, with the new
  rock beds, and nothing else changes there.

## On the 50 km map (WORLD)

- **The rim:** the crust stands at the map's real rim, `WORLD.half` (25 km).
  - `EdgeFace` is its own group, reading the whole map's height field (the drape's field, which
    world50 fills in from a worker). It's built once that's in (`worldGame.view.ready`).
  - It stands 0.4 m out past the rim, clear of the scenery tiles' skirts, which lie in the same
    plane there.
  - The hazy far country lies beyond it.
- **Portals** (`worldPortals`) are where world50's plan runs roads off the rim: `plan.roads` with no
  place at their far end, plus its railways if it has any.
  - A seeded start has lanes only, so these are lanes: white signs with no number.
  - They're shown in section in the face (`portalCrossings`).
  - A real map's names can be passed in (`names`, from OS Open Names).
- **Trips to places off the map** come from world50's coarse economy (`CoarseEconomy.tripsOff`, a
  small hook in `worldmap/econ.ts`). Each place stands beyond its portal, as far as the drive takes
  (`offMapPoint`).
- **Visible portal traffic** runs only where a portal is on the game's own roads, which on WORLD
  means where the live area reaches the rim. That doesn't happen yet, so none runs.

## The cut face (`edgeMesh`)

- **Layers:** turf, topsoil and subsoil hang from the ground. Below them the rock lies in beds
  (clay, sandstone, mudstone, limestone, then bedrock) that fold gently across the country. They
  rise under the hills, since the hills are made of the rock. The beds go down to a level base,
  `edgeDepth(edge)`: the town's 26 m, and a big map's about 2% of its half-width (99 m on the 6 km
  region, 260 m at most). So from right out the map reads as a slab of crust. The face darkens a
  little with depth.
- **It follows the ground exactly.** The face's columns fall on the height field's grid lines
  (`RELIEF.step`), and it is 0.5 m columns wherever the ground between two grid lines isn't straight
  (a river's banks). Its top is the ground's own height at the same points the ground mesh uses:
  `surfaceAt` in `main.ts`, which is `gameWater.shapes.ground + RELIEF.heightAt`. So there's no
  gap and no lip. The mesh isn't draped (`noDrape`): its heights are already right.
  **Terrain session:** if the ground's height stops being `shapes.ground + RELIEF.heightAt` (a sea
  bed, say), change `surfaceAt` and nothing else. Water shows wherever the ground is below
  `level` (a number, or `(x, z) => level | null` per point). It's drawn as a column from the bed up
  to the level, lighter at the top.
- **No z-fighting:** every column is split wherever two of its layer lines cross, and each gap
  between neighbouring lines is one piece. No two pieces overlap, and none sits proud of another.
  `edge.test.ts` checks this: each side's area adds up exactly to the area between the ground and
  the base.
- **Roads and railways in section:** each carriageway shows its asphalt on its stone, footways and
  verges beside, a railway its ballast, and an embankment's fill under a road above the ground. They
  are cut into the face, not laid over it (`edgeCrossings`: roads that end at the edge heading out,
  or a railway passing through it).
- **Built where it can be seen** (`EdgeFace`, ready for 50 km maps):
  - Each side is cut into 1 km stretches. A stretch is built exactly (as `edgeMesh` with `span`)
    when it comes into sight, so the height field is only asked for there. It's kept while near,
    and let go once it's four sight-radii off.
  - A stretch that's in sight but not built yet is built that frame, so the rim never has a hole.
    The next ring out is built ahead, within 2 ms a frame.
  - Zoomed right out (views over 2,600 m tall), one coarse face all round stands in, with columns on
    the ground's grid only, at most 400 a side. The coarse face and the stretches are never shown
    together.
  - When a road off the map changes, only the stretches it touches are rebuilt, and they're
    swapped in the same frame.
  - Cost: one shared material, so one program. Draw calls are the stretches in sight (one to
    four), or one zoomed out, with 100 to 400 triangles a column-metre of rim in view.
  - The town keeps its single eager mesh.

## The far country (`farCountry`)

Two looks were tried, at the same views at low and high tilt:
- **A hazy lowland** below the cut (the default).
- **An extended world** in the manner of Cities: Skylines 2 (`?far=level`): the country carried on
  at the map's own height past a narrow gap, the height field continued out from the edge and
  fading into low hills.

The lowland reads better on a phone. The map stays a slab of crust at every zoom and the cut is
clear from any side. With the extended world, the far bank hides most of the cut at low tilt, and
zoomed out the rim thins to a line, so the playable edge stops reading. `?far=level` stays, to
compare.

A backdrop round the map, so the sky doesn't just start at the rim:
- It's a soft lowland of blurred fields and woods, meeting the foot of the cut and falling away
  40 m. Low hills rise further out, and it fades into the sky's colour (`update(sky)` each frame,
  so dusk follows).
- It's drawn first, with no depth writes or tests, and its depth is clamped to the far plane. So it
  never hides the map or the face, and the camera's depth range never cuts it off.
- Its slopes never get steeper than the camera looks down, so it never needs to hide itself.
- One draw call, about 17k triangles, no shadows.

## Ways off the map (`findPortals`)

- **Roads out** (`layRegionRoads` with `edge`):
  - The motorway runs on to the ground's edge at both ends. Its junctions still keep to the map.
  - An A road leaves by each side the motorway doesn't. It starts from the town (or the city) that
    can reach that side most directly, and runs straight out from its gate, clear of every other
    place. A village takes a B road out where no town can.
  - Then every long road is cut into pieces of 450 m at most (`splitLong`). The map is drawn a cell
    at a time, each road by the cell its middle is in, so a road kilometres long vanished when that
    cell went out of sight.
  - And every road and track on the region gets a point at least every 20 m (`densify`: points on
    the same line, so nothing moves). The hills are added as it's drawn, vertex by vertex, and the
    A and B roads and the main line had points up to 2 km apart, so they were drawn straight
    through the hills, under the ground, with only their markings showing.
- **The railway** (`planRegionRail` with `edge`): the main line runs straight on from each end
  station, through the face and 480 m past it (`OFF_MAP`), with a join exactly on the edge. Nothing
  wholly past the edge is drawn (`beyondEdge`): not its track, ballast, signals or station.
- **Portals:**
  - Every dead end on the ground's edge (or track through it) is found, and grouped where they run
    out together. A motorway's two carriageways are one portal.
  - Each gets a road number (M, A or B; none for the railway) and the name of a place off the map.
    The place's size grows with the map (by √(half-width / 4.5 km), up to 3×), since a bigger
    map's neighbours are bigger places.
    The name comes from the region's own name generator: never a real place, never one on the map.
  - Each also gets a distance: motorway 16–28 miles, A road 9–17, B road 5–9, railway 22–40.
  - Portals within 3 km of each other lead to the same place, for example the railway and the
    motorway out to the west.
  - Deterministic: the same map gives the same portals.

## Traffic through them (`PortalTraffic`)

While the camera is within reach of a portal (the traffic's own reach plus 600 m), vehicles come
in and go out at its rate:
- **Rates** are vehicles a second each way at the busiest: motorway 0.36, A road 0.07, B road
  0.025. They are scaled by `demand(hour)` (two rush hours, quiet nights) and the traffic setting.
- **Lorries:** 22% on the motorway, 10% on an A road.
- **Coming in:** vehicles appear at the face, already at the road's pace (`Traffic.trip(..., moving)`).
  They drive to somewhere near: a home, a job or a shop within 2.4 km. Or, on the motorway 70% of
  the time (35% on an A road), they're passing through, driving on 2.3 km along the road until the
  traffic's own culling takes them.
- **Going out:** they drive from somewhere near (or from 2.3 km in, already moving) to the face,
  and on out through it. The vehicles' one material is cut by the edge's four planes
  (`edgePlanes`), so they go into the slice rather than vanishing. That's four plane tests on
  vehicle pixels only.
- **Already busy:** when a portal comes into reach, its road already carries its flow each way
  (`prime`), spread along it, rather than starting empty.
- **Region trips:** the traffic's own trips to and from elsewhere (`Traffic.edgesFor`) use the
  portals near the camera. Before, they used every cul-de-sac more than 180 m from the middle.

## In the economy (`game/econ.ts` `outside`, `outsidePlaces`)

- **A town per place:** each place off the map is a town in the economy (ids from 900), of fixed
  size: motorway 14,000 people and 10,000 jobs, A road 5,000 and 3,500, railway 18,000 and 14,000.
  It's one zone with no plots, and a demolished building comes straight back.
- **Where its zone stands:** out from the map's middle through its portal, as far as the drive
  there takes, at the economy's 1 km a minute over 1.3 times the straight line. That's capped at
  11 km so it stays within the economy's 25 km reach, and any further drive is `carExtra`. So trips
  there leave through that portal, and it's too far to walk to.
- **No trips between two places off the map:** car time between them is infinite, and they're
  kilometres apart.
- **By train:** the station off the map stands, for the economy, in the place it leads to. A ride
  there takes the train's time to the portal station plus the miles beyond (`railMin`), so a rail
  line to the edge is a real link to it.
- **Where it shows:** the town panel's "Where people go" lists the places off the map with the
  rest. Tapping one goes to its portal.
- **Old saves:** a region save from before this has no outside towns. Its network has no roads
  off the map, so it has no portals either, and it loads as it was.

## Trains off the map

- **The station:** each railway portal has a station on its stretch past the edge
  (`portalStation`), named for the place it leads to. It's built with the map, or found again in a
  loaded game.
- **Your lines:** a line can end there like at any station. Its badge shows just past the rim.
  The train runs out through the face (cut off at it, like the cars), stops out there, and comes
  back.
- **Another company's trains** run through between two railway portals, if the map has two:
  `RailLine.other`, lines from 900 up.
  - They're not the player's: no fares, no running costs, not in the economy's lines or the Railway
    tab's list (the tab says they run), and not in the goal or save counts.
  - They share the track and signals with the player's trains.

## Signs and the card

- **Signs:** a DOM sign stands beside each road 80 m in from the edge, in the style of a UK
  direction sign. Motorways are blue, primary routes green with a yellow number, B roads white,
  and the railway white with a red train. It gives the number, the place, the direction and the
  miles, for example "M56 Willowham, West · 19 mi". The sign shows while the view is under 7 km
  tall and on screen, sliding in from the side of the screen with its post still under the spot.
- **Tapping one** goes there and opens a small card, following the rule of simple steps:
  - the place's name, the road number, the direction and the miles;
  - three numbers: vehicles in a day, out a day, and trips a day to and from the place (for the
    railway: the trains running there, the trips, and how many ride your lines);
  - one action at most: for the railway, "New rail line from here".

## Measured

Playwright at 412 × 915, DPR 2, touch, SwiftShader. Frame times are software GL, so the draw
calls and triangles matter more. The integration branch (before) is compared with this branch
(after) at the same views; `node e2e/perf.e2e.mjs` gives the wider table. See the PR for the numbers.

## Not done yet

- The ground between the map's bound (3 km) and the ground's edge (4.5 km) is plain grass. Its
  fields and woods belong to the countryside session, and its size to the terrain session. Once
  the map is 19 km, the cut face and the far country scale with `edge` as they are.
- The economy's rail riders to a place off the map: the line is taken (its cycle includes the
  miles beyond), but in a short test (3 game days, one station in a town) no line carried
  anyone, a map-to-map line included. That's worth a proper look with the economy's own tests.
- A portal has no gantry or sign in 3D, only the DOM sign.
