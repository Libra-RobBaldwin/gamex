# The region streamed in tiles (R4)

The 6 km region (`/?map=region`) is drawn a tile at a time around the camera, at a level of detail
picked from the zoom. An edit re-derives only what it touched. Traffic is only near the camera.
The invented town (`/?map=town`) is drawn and simulated exactly as before: all of this is behind
`BIG` in `main.ts`, and a test compares the town's state after loading with the integration
branch's.

Code: `src/proto/game/regionview.ts` (the tiles), the `regionView` parts of `src/proto/main.ts`
(edits, traffic, trees, infill), and small additions to `roaddraw.ts` (draw only some roads),
`infill.ts` (look in a box), `ground/game.ts` (repaint round boxes) and `game/bridges.ts` (look at
some roads again).

## Tiles and levels

The map is cut into 1 km tiles (`world/tiles.ts`), and `world/StreamManager` decides which level
each wants and loads them nearest first, a few milliseconds a frame.

| Level | Roads | Buildings | Trees and hedges |
|---|---|---|---|
| Near | everything `drawRoads` draws: markings, kerbs, lamps, street trees, parked cars | the textured chunks (250 m, a quarter of a tile across) | full trees; hedgerows and their trees |
| Mid | plain ribbons: carriageways, footways, ballast, the junctions' surfaces, walls under raised roads | the same geometry in one flat-coloured mesh a tile (each material's colour, its texture averaged) | full trees; the hedgerows' trees |
| Far | ribbons | each building a box of its footprint and height, in its wall and roof colours | low-poly trees |

The camera is orthographic, so everything on screen is drawn at the same scale. The level
therefore follows the zoom: near up to a view about 1,000 m tall, mid to 2,600 m, far beyond,
with 12% of slack either way so a zoom resting on a line doesn't flip back and forth. A tile only
drops below that once it's out of view (with a margin). So every tile on screen is at the same
level, and a level changes where what it adds or takes away is about a pixel across.

Nothing flickers or fights:

- Each level is built once and kept, hidden when not wanted. A tile swaps whole: the new level is
  shown and the old one hidden in the same frame, never both, never neither.
- The ribbons sit a few centimetres below where the full drawing puts the same surfaces, so where
  a near tile's roads meet a mid tile's (only ever past the edge of the screen, or for the frame
  they swap), the full drawing is cleanly on top.
- Hedge pieces and trees are instanced per tile and culled with it; a piece belongs to the tile its
  middle is in, so none is drawn twice.

Work is metered. A tile's near roads are drawn one 250 m cell at a time, then merged into one mesh
a material; a tile's buildings are merged a few milliseconds at a time. When the page is idle
between frames, the view gets ready for where the camera may go next (near detail for the tiles
just beyond the view, mid a ring further), so a zoom or a pan mostly just swaps.

The river beds and the map's cut edge are cut into a mesh a tile too, so only what's in view is
drawn.

Precision: nothing on the 6 km map is more than 4.5 km from the origin, where a float32 steps in
half a millimetre. It needs no floating origin; `world/origin.ts` is for the 30 km map.

## Edits

Each road's and each node's signature is kept from the last commit (`commitTouched` in
`main.ts`):

- A junction is designed again only when the roads meeting there changed (or it's new). A
  customised one keeps its choices while its roads stay the same, as before.
- Its land is claimed again only when its design changed (here, or in the junction panel).
- Only the buildings and queued plots within reach of what changed are checked against the land;
  only the ground, trees, hedgerows and bridges round it are looked at again.
- The leftover land (parks, car parks, community buildings) is looked at again in a box round
  the edit, grown until no gap it cuts across reaches what changed, so every gap re-found is whole
  and exactly what looking at the whole map would find (a test checks this).
- `regionView.roadsChanged()` works out each 250 m cell's signature (its roads, junctions, stops,
  bridges and the roads they join) and redraws only the cells that changed, then swaps their tiles.

This is `world/DirtyPipeline`'s idea (per-tile dirty areas, stages in order) without its
machinery: the Network changes in many places (roads, slip roads, interchanges, rail, stops), so
rather than each marking dirty tiles, a commit compares signatures. Each stage is cheap once it
only looks at what changed, so they run in order in the same call.

## Traffic

Trips start from homes and places within about a kilometre of the camera (or what's in view, when
zoomed out), so how many cars there are follows who lives there; the 300-car cap now applies to
what's near the camera. A car well outside that is taken off the road once it's clear of junctions
(traffic.ts's own `sold`). Buses on the player's lines always run. Further out there are only the
economy's flows. People already only walk near the camera.

## Measured

Playwright at 412 × 915, DPR 2, touch, with SwiftShader (software GL: frame times are far slower
than a phone's GPU, so the CPU numbers, draw calls and triangles matter more than the frame
times). Before: the integration branch at 8ad5a55. After: this branch. See the PR for the full
table; `node e2e/perf.e2e.mjs <base url> town,region 0,1,2,3,4 out.json` reproduces it.

## Not done yet

- Building generation and the region generator in a worker (`world/worker.ts`).
- Spawning cars at the rate each link's flow implies (needs link flows from the economy).
- Start-up: most of what's left is generating the streets, putting up the buildings and the
  water; on SwiftShader a few seconds are the GPU catching up.

# 50 km maps: a world plan and tiles made as you go (work-world50)

Every map is 50 km across now (`?map=region`, `size=50`, the setup screen's default; the 6 km region
is still there as `size=6`, and saves made on it open on it). A real 50 km square of England holds
hundreds of thousands of buildings, so nothing fine is made for the whole map up front. There are
two levels:

1. **The world plan** (`src/proto/worldmap/plan.ts`, pure, about 1.2 s): the coarse facts of the whole map.
   - **Where things are.** The places: the start town at (0, 0), two cities, a dozen market towns and
     150 or so villages, each with its size, kind, name and seed. The whole map is playable: after
     the main placement, every 10 km square gets places in proportion to its land (`squareQuota`:
     none only for the open sea), and a square with a coast gets villages along it.
   - **The water.** The coast along one edge with the sea beyond, rivers widening on their way down
     to it, and lakes (`water.ts`). A lake is never a circle: it's a chain of overlapping bowls of
     different sizes along a wandering line, with a bay or two off it.
   - **The roads the map starts with.** Only minor roads between places (`routes.ts`): each place
     joined to its neighbours, and a few lanes off the map's edges. There are no motorways, A roads
     or railways at the start: those are the player's to build. (`planRoutes(c, true)` still lays the
     trunk network, for maps that want one, and it's the same planner the player's own big roads
     should use.)

     Each lane is found over the land: the cheapest path over a 125 m grid, where steep ground is
     dear, a river crossing dearer, and the sea, lakes and places it doesn't serve are out of bounds.
     Slow noise makes it wander as old lanes do. It's then smoothed into bends. A lane that would
     meet another side by side at a place forks off it square instead.

     The trunk network is found the same way, each kind with its own `PROFILES` entry:

     | Kind | Grade | Wander | Bridge cost | Keeps from places | Bends |
     |---|---|---|---|---|---|
     | Lane | 5% (soft: it just climbs) | full | 900 | 60 m | ~350 m |
     | A road | 6% | 0.7 | 1,600 | 150 m | ~600 m |
     | Motorway | 4% | 0.25 | 2,500 | 350 m, and out of the live area | ~1.1 km |
     | Railway | 2% | 0.15 | 2,500 | 120 m | ~700 m |

     A route steeper than its grade has to cut or tunnel, at `dig` times the cost a metre, so it
     goes round a hill unless going through pays. A long move over the grid counts any crest it
     passes over. Measured on seed 42: motorways are over 4% on about 3% of their length. Railways
     are over 2% on about 20%, against 28% for the land as a whole; those stretches are for
     cuttings and embankments.
   - **The industries** (`industry.ts`): sites from the industries library's catalogue, on land
     that suits each, and buildable in the game's year (2025 for now):
     - quarries on high ground (the top fifth of the land's heights);
     - forests on hillsides;
     - farms and oil wells in the vales;
     - docks on the coast by the town nearest the sea, with a refinery behind them;
     - steelworks, a power station, factories, food plants, breweries, sawmills and
       distribution centres at the edges of the towns and cities.

     That comes to about 60 on a 50 km map. Each keeps clear of the places, the water, the roads
     and the live play area, and gets a lane from the nearest road (`routes.ts` `spurs`: a `Route`
     with `site` set). The scenery draws a site as sheds, chimneys and silos on a yard, which the
     ground paints as worn ground. Industries in the live play area are left to the game
     (`game/industry.ts`). A real source may give its own list.
   - **The hills.** A function of x, z (`terrain.ts`): broad downs up to about 120 m on a rolling map,
     and rolling hills of up to about 40 m on them.
2. **Tiles** (`tilegen.ts`, pure, in workers: `tile.worker.ts`): everything fine, made a tile at a time as the
   camera nears it, from the plan and the tile's key alone:
   - streets, plots and buildings (`towns.ts`);
   - fields, their crops, woods and their trees, hedgerows and farmsteads (`country.ts`);
   - the trunk roads' carriageways and markings, railways and stations;
   - the sea, lakes and rivers.

   Every item belongs to exactly one tile, so neighbours meet without a seam and nothing is drawn twice:
   - a building by its centre;
   - a street by its middle;
   - a stretch of trunk road by each piece's middle;
   - the ground's cover by the ground library's world-anchored fields.

## Tiles and levels (`view.ts`)

A quadtree over the map. The view shows, for each part of the map, the finest level its zoom wants
(what's on screen at the zoom's level, a level coarser just off it, coarser again further out). It
swaps a tile for its children only once all of them are ready, and back only once the parent is.
So the map is always covered exactly once, with no holes and nothing fighting.

| Level | Tile | Shown until the view is | Ground grid, cover | What's on it |
|---|---|---|---|---|
| near | 1 km | 1,000 m tall | 25 m, 4 m texels | every building (gables, window bands on flats and offices), streets with footways, junctions and centre lines, trunk roads with lane markings, railways with rails, stations, farmsteads, the woods' trees, hedgerows |
| mid | 1 km | 5,000 m | 50 m, 8 m | the same, without markings, window bands or hedgerows; lower trees |
| far | 4 km | 17,000 m | 100 m, 16 m | buildings as boxes, main streets, trunk roads and railways drawn wider |
| vast | 16 km | the whole map | 200 m, 64 m | each place's built-up area as a patch with its roofs over it, roads wider still |

- **The live area.** The 16 km tiles round it show themselves with a hole where it is: its edge is on
  their grid, with skirts round the hole. So zoomed right out the whole map is 16 tiles.
- **Far and vast tiles.** They draw woods as their canopy (the woods' own greens on the ground, since
  no trees stand there) and tone the crops towards grass so the patchwork doesn't speckle. What
  stands on them is lifted a metre or five clear of where their coarser ground can bulge above the
  fine heights.
- **The fields.** A 50 km map's ground has its own seed with straight-edged, near-square fields
  (`ground/layout.ts` `setParcelStyle`, `STRAIGHT_FIELDS`). It's the same field grid, but it bends
  only over kilometres, not in swirls, so each field's hedges run straight while farms still face
  different ways. The starter town's fields are as they were.

- The thresholds have 12% of slack.
- Heights come from one field on a 50 m grid that everything drawn follows (`drape.ts`). A worker makes
  it while the start town is laid out, and the main thread makes only the live area's part.
- Tiles have skirts, so a coarser neighbour never shows a crack.
- Tiles are built into meshes a few milliseconds a frame. They're kept while there's room (160 MB) and
  dropped least recently used first.

## The live play area (`live.ts`, `spec.ts`, `game.ts`)

An 8 km square round the start town (`LIVE_HALF`, two far tiles each way) is where the game's own code
runs: the Network, junctions, plots, buildgen buildings, traffic, people and the economy's zones. The
MapSpec the game gets is that square (`worldMapSpec`); the plan rides along as `MapSpec.world`.

- **Before the first frame:**
  - the start town's streets and buildings;
  - the plan's lanes through the area, on the Network as country roads, ending exactly where the
    scenery's own stretch begins (country lanes get no plots: fields, not ribbon development);
  - the ground painted round the town.
- **Once it's running:** the rest of the area's ground and woods are painted a kilometre square at a time.
- **The other places in the square** stay scenery until the camera gets close. Then they come to life:
  - their streets and the roads to them are built;
  - their buildings go up a few a frame;
  - their scenery goes.

  Until then the live ground shows their gardens and verges (`GameWorld.extra`).
- **Nothing straddles the square's edge.** Places are placed wholly in or out of it, and motorways keep 500 m clear.

## The sim at scale

- **Traffic:** only near the camera (R4, unchanged).
- **The economy:** the game's own, zone by zone, for the live places. For every other place,
  `econ.ts`'s coarse economy: people and jobs from the plan, growing a little each day with how well
  joined the place is, and gravity-model trips between places. It's a function of the plan and the
  day, so nothing extra is saved.
- **Saves** (`game/save.ts`, version 2) are the difference from the seed:
  - the map's query, which makes the plan and all the scenery again;
  - which places had come to life (`world.live`);
  - the Network and the rest as before, for the live area only.

  A save from before (version 1) with no size in its query was made on the 6 km region, and opens on it.

## Sources: seeded or real (`source.ts`)

There is one plan type, `WorldPlan`, with two sources. A `WorldSource` gives the coarse facts, and
`planFrom(source)` makes the plan. Everything downstream takes only the plan: the tiles, the view,
the live area, activation, the coarse economy and saves. So a real region is drawn and played through
the same code as a seeded map.

| Field | Seeded (`seededSource`, plan.ts) | Real (`real/world.ts`, the OS session's) |
|---|---|---|
| `kind`, `id` | `'seeded'`, `seed:<n>` | `'real'`, the region's id |
| `half` | 25 km | 25 km (the bake's square) |
| `water` | made up (the terrain session owns it) | the bake's sea, rivers and lakes, as a `WorldWater` |
| `settlements` | placed (index = id; 0 is the start town at 0, 0) | the bake's places, shifted so the home place is at 0, 0 |
| `heights(grid)` | `WorldTerrain` (the terrain session's): levelled under places | the bake's heights, through the same `WorldHeights` shape |
| `routes?(grid, heights)` | none: the plan lays lanes (`routes.ts`) | the real roads and railways at the start |
| `woods?(box)` | none: the countryside paints woods | the real woods (OS VectorMap) |

A settlement's `gates` may be empty; the plan lays its streets to find where roads meet them.

**Loading:** `loadPlan(options)` picks the source by the options' `real` field. A real source
registers its loader with `setRealSource(load)` when `real/world.ts` is imported. That import has
to be on the main thread (`main.ts`) and in `tile.worker.ts`, because each worker makes the plan
itself from the options, so the loader must give the same plan on every thread. The live play area
is 8 km across for both sources. `source.test.ts` shows a small real source going through the
plan and the tiles.

## Interfaces for the sessions working alongside

Each of these is where a neighbouring session's work plugs in; keep the shapes and the rest follows.

- **Terrain and water (claude/work-terrain-2).**
  - `WorldTerrain` must keep three things: `heightAt(x, z)` (smooth, anywhere), `bed(x, z)` (≤ 0: how
    far a lake or the sea dips below it) and `field(step)`/`partField(box, step)` (the drape grid).
  - `WorldWater`, a `MapWater` with the sea, must keep: `edgeDistance(p, cap)`, `seaDistance(x, z)`,
    `riverWidth(x, z)`, `kindAt(x, z)`, and `world: { sea, rivers (paths and widths), lakes }`.
  - Replace the bodies; keep `heightAt` 0 on the water and level round places.
- **Countryside (claude/work-country).** `country.ts`:
  - `countryInput(plan, box, fine)`: a `GroundInput` for a box;
  - `paintCover(input, box, texel)`: the cover map, via the ground library's `Layout` and `CoverMap`;
  - `woodTrees(layout, box, spacing, pines, seed)`: x, z, scale, kind per tree;
  - `farmsIn(plan, box)`;
  - `hedges(layout, input, box)`.

  Fields and woods are the ground library's (`ground/layout.ts`), so a change there shows everywhere:
  in the live area and in every tile.
- **Map edge and portals (claude/work-edge).**
  - The map runs from −25,000 to 25,000 each way (`plan.half`).
  - The plan's `roads` with `b: null` are A roads off the map's edges (the portals' places). Ground
    tiles stop at the edge with 40 m skirts.
  - The live area's own edge isn't a map edge: roads cross it as Network roads that end where the
    scenery's stretch begins.
- **Real OS data (claude/work-os).** A plan made from data instead of a seed needs the same fields:
  - `settlements` (with `seed`, `axis` and `plan` for the street layout, or streets of its own);
  - `water.world`;
  - `roads` and `rails` (centre lines, kinds, end places);
  - a `WorldTerrain`.

  `tilegen.ts` needs nothing else.
