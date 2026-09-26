# Brief: world50 (50 km maps)

Session: world50, branch `claude/work-world50`. PR #42 is merged into the integration branch and live.
Written 26 Sep 2026, ~01:20 UTC, after merging the integration branch in (b57164e).

## Status now (26 Sep, ~16:00 UTC)

This section wins over the tables below, which are the brief as first written.

**Rule:** "live" means merged into the integration branch and checked on a 412×915 screenshot. "Done
locally" means it isn't live yet.

### Live
- **50 km map with a world plan** (#42, merged).
  - The plan has places in every 10 km square with land, industries with lanes in, trunk routes over the land (off at the start), OS priors for the counts, `WorldSource` (seeded or real), and far towns in vernacular palettes.
  - The live area's trees are lighter from mid zoom out, and places come to life a few streets a frame.
  - Checked on screenshots: the start town, a far town, the docks, the steelworks and a village.

- **The first view frames the start town's centre** (#51, merged). Checked on a screenshot.
- **Roundabouts are rare on 50 km maps** (#51, merged). The start town went from 14 minis and 4 roundabouts to 1 roundabout, 2 sets of signals and 24 give-ways. Checked on screenshots.

### Urgent fix, in its own PR (branch `claude/work-world50-sky`)
- **The start view sometimes went all sky blue** (the coordinator saw about 1 start in 4). Cause: the automatic quality tier resized the canvas *after* a frame had drawn. Resizing clears the canvas, so the page showed its sky-blue background until the next frame; after a shadows change that frame recompiles every shader (seconds under SwiftShader, a one-frame flash on a phone at every tier step).
- Fix: a tier step is applied at the start of the next frame, before it draws.
- New `e2e/firstview.e2e.mjs`: N cold starts at DPR 2, shot through the first 20 s. Blank before the fix in 2 of 4 starts; after, 0 of 6.
- **The region's page leaked memory**, about 1 GB of heap every 30 s under SwiftShader (13 GB in a stations run), and only 4 scenery tiles were ever shown. Cause (worldmap/view.ts): a tile's pending mark was cleared when its data arrived, not when it was built, so the view asked for it again every frame while it waited, and the data piled up. Fixed in the same PR: 208 tiles, each asked for once, about 1.2 GB RSS. firstview checks each tile is asked for once (it fails on the old code).
- Still high: the live area's heap settles at about 800 MB on the region against about 180 MB for the old town. Worth measuring on a phone next.
- Not live until that PR merges.

### One map, steps 1–3: in a PR from `claude/work-world50` (not live until it merges)
**Checked on 412×915 screenshots:**
- The home screen has one New game button, which opens the Region setup.
- An old or unknown map link opens the setup with a notice ("There's no map called …").
- The guide runs in the region's start town. Its card is now opaque, and the game's goal strip waits under it, where before both "Step …" counters showed at once.
- Old saves (the starter town, a 6 km region) are listed as "Made on a map that no longer exists", with only Delete. Continue skips them.

**Done and tested:**
- `maps.ts` lists one map, with real places inside it.
- `main.ts` has lost the starter town's, the sandbox's and the 6 km map's own branches.
- Real Town Plans is deleted (`src/places`, its e2e). `places.html` now only redirects old links to the start menu.
- PR #22 is closed.

**Bugs found and fixed along the way:**
- `focusOn` aimed at height 0, so on the hills every "go to" framed the wrong spot.
- The underground view crashed on 50 km maps: the scenery tiles free their vertex arrays, and the view needed their bounding boxes.
- A loaded region town drifted from the saved one. Its growth plots were filtered at load, where the town map kept them, so its economy counted fewer free plots.
- A town saved from a deep link wasn't offered by Continue. A 50 km map's saved query now says `size=50`.

**e2e suites on `proto.html?map=region&seed=42`**, all passing locally with tsc and vitest (only the known economy failure):

| Suite | Notes |
|---|---|
| firstview | new: 4 cold starts at DPR 2, no blank screen, each scenery tile asked for once |
| loop | the decline is checked as the status turning, see the economy note |
| lines | |
| stations | the underground pair is 450 m apart, clear of the start town's streets; the train is given 300 s |
| save | the branch is at z 540, and a one-way dual carriageway bridges it (the region starts with neither) |
| rail | the branch just north of the start town crosses the lane north on the level |
| menu | New game > Region, the guide, gone links, the DPR 2 first view |

**Not done yet (step 4, a follow-up PR):**
- Delete the 6 km parts: `region/generate.ts`, `interchange/region.ts`, `rail/region.ts` and `region/town.ts` (the town map). Their tests go too: the portal-traffic test has to move onto a 50 km map's portals first.
- The regionsetup's 6 km wording.
- Leaflet in `package.json` (only Real Town Plans used it).
- The docs that describe the deleted maps.
- The start menu's hero pictures still show the old starter town. They need retaking from the region.

### Not done, and waiting on others
- Grades from `PRIORS.follow` (OS hasn't added them).
- Fewer places on hills by real height (terrain's heights before placement).
- The cover-map scratch memory (205 MB, countryside's `ground/paint.ts`).
- Scenery houses from `buildgen.ts` (with vernacular).

### Agreed with vernacular (PR #50): one building generator
- `worldmap/towns.ts` is the layout planner: `SceneBuilding` carries the footprint, height, kind and place. `buildgen.ts` alone decides how a building looks.
- `tilegen`'s `building()` is only the cheap far version of the same buildings: a box and roof in the place's palette, with no windows, doors or chimneys of its own. Vernacular strips those in its next PR.
- I keep their hunks in my files: `TileData.bld` in tilegen, and its transfer in `tile.worker.ts`. In `view.ts` that's the `bld` mesh, `nearShown()` and `setDressed()`.
- In `main.ts`'s WORLD path I keep:
  - the Dresser;
  - `setPlaces(placeResolver(...MAP.world?.settlements ?? MAP.settlements...))`;
  - `setGround(RELIEF...)`.

### Finding for the economy
On the region's start town, the loop e2e shows the town turning to declining once its line is withdrawn. But within 8 to 16 days its people and jobs don't always fall below where they stood with the line: they did on one run and not on another. On the old starter town they fell every time. The suite now checks for the turn to declining, and logs the numbers.

## (a) Everything asked of this session

### The original task (the coordinator, 25 Sep)

| # | Request | State |
|---|---|---|
| 1 | Every map is 50 km across as standard; bigger maps later, as paid options. | Done (the region's size setting defaults to 50 km; 6 km remains as the old size) |
| 2 | "Have it so maps actually load something good", fast and smooth on a phone. | Partly done: first frame ~14 s under SwiftShader in a production build (was 41 s for the 6 km region); the budget asked for is well under 10 s |
| 3 | A coarse world plan at start, well under a few seconds: settlements, trunk network, coast, rivers and lakes, relief. | Done (`worldmap/plan.ts`, ~1.2–1.8 s on CI; not yet in a worker) |
| 4 | Fine detail per tile (streets, plots, buildings, fields, hedges, woods, trees), made lazily per tile, deterministic, seamless, in a Web Worker, cached and evicted by distance. | Done (`tilegen.ts`, `tile.worker.ts`, `view.ts`; a 64 MB LRU budget) |
| 5 | Far LOD: zoomed right out, the whole 50 km reads as a map. | Done (82 draw calls, 246k triangles zoomed out) |
| 6 | Sim at scale: traffic near the camera only; a coarse economy for the whole map; saves as a diff over the seed. | Done (the live 8 km area runs the full sim; `econ.ts` for the rest; SAVE_VERSION 2 saves `world.live` over the seed) |
| 7 | Size 50 km in the region options and the menu. | Done |
| 8 | The first view lands on a detailed town within a few seconds. | Partly done (the start town is detailed; "a few seconds" not met under SwiftShader, see 2) |
| 9 | Budgets at 412x915 DPR 2: first frame well under 10 s; steady frame no worse than today's region; under ~600 draw calls zoomed out; memory reasonable. | Partly done: draw calls met (near ~486 vs 517 before; 82 zoomed out); steady frame met; first frame not met; memory measured before the 64 MB tile budget (JS ~50 MB, ArrayBuffers ~320 MB) and not re-measured since |
| 10 | Coordinate with terrain-2, country, edge and OS; own the world plan, tile pipeline, worker, caching, LOD and the size setting; define the per-tile interfaces in `docs/streaming.md`; keep shared-file edits small. | Done for the docs ("50 km maps" in `docs/streaming.md`); the other sessions have not plugged in yet |

### The user, directly (25 Sep)

| # | Request (close to word for word) | State |
|---|---|---|
| 11 | "Don't link the completely circular lakes - they would never be circular!" | Done (lakes are clusters of overlapping bowls; no lake is linked) |
| 12 | "Game should start with just connections between some towns... Not a motorway network, this will be for the player to do... So just piddly yellow roads to start with... No rail, no upgraded roads, then it's up to the player." | Done (the plan lays only minor B lanes; no rail, no motorways, no A roads) |
| 13 | "Roads through countrysides are never dead straight - they are built around terrain." | Done for the lanes (A* over a 125 m grid with a slope cost, water and river-crossing costs, then smoothing) |
| 14 | "Fields are normally straight edged... Not warped messes of parallelograms." | Partly done: the 50 km world uses the straight style (`GROUND_SEED=12` and `STRAIGHT_FIELDS`); the old curvy generator (`ground/layout.ts` `bend`) is still used by the town map and the 6 km region |
| 15 | "The average phone is probably more powerful than your CPU... we can always cut off older phones." | Noted: budgets are read as relative to SwiftShader, and a Pixel-class phone is the target |

### The coordinator, on resume (26 Sep, 01:15 UTC)

| # | Request | State |
|---|---|---|
| 16 | Merge the integration branch in and write this brief; commit and push it as "brief: world50". | Done (this file) |
| 17 | One field style everywhere: straight-edged hedged fields in farm blocks. Delete any curvy or warped field generator that is still reachable. | Not started (see the open questions: the town map has to stay byte-identical) |
| 18 | Every road and railway respects the terrain: motorways, A roads and main lines follow valleys and contours, keep within a grade limit, take sweeping bends round hills, woods and water. Bridge or tunnel only where it pays. No ruler-straight routes. | Partly done: the lanes do (13). Motorways, A roads and rails exist only in the plan's `full` mode (off by default, per 12), which still uses the older meander approach, not A* with a grade limit. The player's own roads are drawn by the player |
| 19 | The whole map is playable: towns, villages and industries out to the corners and edges, no empty 10 km square (fewer in mountains, some on the coast), all linked into road and rail. | Partly done: ~165 places over the map (2 cities, ~16 towns, ~147 villages), linked by lanes, with edge exits. No per-10 km minimum is enforced yet, there are no industries in the plan, and no rail (per 12) |
| 20 | With the OS session: real OS maps fold into the same pipeline. One WORLD plan interface with two sources (seeded or real OS data), rendered through the same code. Agree the interface with OS; the coordinator confirms ownership. | Not started |
| 21 | Phone first (412x915), no flicker or z-fighting, UK left-hand traffic; tsc, vitest and the phone e2es; a new PR into the integration branch with before and after screenshots; hourly check-ins until it merges. | Standing; applies to the new work |

### Also in the handover, for all region sessions (the user, 25 Sep late)

- Seeded maps as good as real ones, by learning from the OS data. The OS session's `region/priors.ts` looks like the start of this. The world plan should read those priors, but it doesn't yet.
- Shopping complexes in town centres, each one coherent building. This belongs to vernacular or buildings, not here, but the scenery houses in `worldmap/towns.ts` would draw them.
- Less ugly buildings. The same applies here: `towns.ts` scenery houses are simple boxes (pending item "richer scenery houses").
- The edge portals carry the traffic that runs off the map (edge session). The plan already gives each lane that leaves the map an edge exit.

### Left over from before the pause (from PR #42's "where I stopped")

1. First frame: make the plan in the worker, in parallel with the start town.
2. Re-measure memory under the 64 MB tile budget.
3. Spread place activation (a village's streets can take up to 1.8 s in one frame) over frames.
4. Richer scenery houses.
5. Neighbouring sessions plug in through the interfaces in `docs/streaming.md`.

## (b) Files and modules I own or expect to change

I own these outright:

- `src/proto/worldmap/*`: `plan.ts`, `water.ts`, `terrain.ts`, `routes.ts`, `towns.ts`, `country.ts`, `tilegen.ts`, `tile.worker.ts`, `view.ts`, `live.ts`, `spec.ts`, `game.ts`, `econ.ts` and their tests.
- `docs/streaming.md`, the "50 km maps" section.

Shared files I touched in #42, where I expect more small edits:

- `src/proto/main.ts`: the `WORLD` branches.
- `src/proto/region/options.ts`: size, sea and limits.
- `src/proto/region/index.ts`: `mapFromQuery` sends size > 6 to `worldMapSpec`.
- `src/proto/region/mapspec.ts`: `world?`.
- `src/proto/game/save.ts`: `world.live`.
- `src/proto/app/regionsetup.ts`: the size choice.
- `src/proto/ground/layout.ts`: the parcel style.
- `src/proto/ground/game.ts`: `extra`, `startIn`, `paintBox`.
- `src/proto/drape.ts`: `userData.cull`.
- `src/proto/game/regionview.ts`: `treesUntil`.
- `src/proto/jshape.ts`: the run clamp.

For the new scope I expect to change:

- The field style (item 17): `ground/layout.ts`, removing `bend`/`unbend` and the curvy corners.
- Trunk routes (18): `worldmap/routes.ts`, a grade limit, and A* for motorways, A roads and rail.
- Places everywhere (19): `worldmap/plan.ts` (a per-10 km quota, industries).
- The two sources (20): a new `worldmap/source.ts`, or a similar interface file, plus `region/index.ts`, `real/map.ts` and the region setup's first step.

## (c) Overlaps with other sessions, known or suspected

- **Countryside (#41, `claude/work-country`):** built on the old 6 km `BIG` path. It conflicts with `WORLD` in `main.ts` and `ground/game.ts`, and it probably owns fields, hedges and woods (`ground/*`, maybe `region/countryside*`). Item 17 (one field style, delete the curvy generator) overlaps it directly. Someone has to own `ground/layout.ts`. My `worldmap/country.ts` paints the 50 km world's fields per tile with the same `ground/` Layout, so countryside's field and wood work would reach the far tiles through it.
- **Edge (#44, `claude/work-edge`):** the map-edge crust and the off-map portals. My plan makes the edge exits (the lanes that leave the map); edge draws the crust and runs the portals. `main.ts` skips `mapEdge` on WORLD today. That seam needs agreeing: which edge (the 50 km border or the live 8 km box), and who owns the exit list.
- **Terrain (no branch yet; `claude/work-terrain-2` is older):** landform presets and islands. My `worldmap/terrain.ts` builds the 50 km relief (a broad swell, hills and water bowls), so terrain's presets should feed it or replace it. Item 18's grade limit reads this height field.
- **OS (#43, merged; `src/proto/real/*`, `region/priors.ts`):** item 20. Today `real/map.ts` bakes a 6 km window (`WINDOW=3000`) of the 50 km region into a `MapSpec`, and `main.ts` loads it through `loadRealMap` before `mapFromQuery`. A shared WORLD interface means one of two things. Either `real/` gives a `WorldPlan`-shaped source (settlements, roads, rails, water, heights, woods) that my tile pipeline and live area render, or my plan grows a source abstraction that both fill. `region/priors.ts` (learned from OS) should drive the seeded plan's counts and sizes. Both of us would touch `region/index.ts` and `main.ts`.
- **Vernacular (#45, merged; `vernacular.ts`):** regional house styles. My scenery houses (`worldmap/towns.ts` WALLS/ROOFS) should take their palette from `vernacular.ts`, so the far towns match the live ones. The shopping-complex and less-ugly-buildings asks are theirs or buildings', and my scenery would follow.
- **HUD/menu (coordinator):** `app/regionsetup.ts` and `maps.ts`. I merged the stepped setup and kept my region blurb on top of OS's new Exeter and Ludlow entries in the merge just now.

## (d) Open questions

1. **Item 17 against the town rule:** the standing rule keeps `?map=town` byte-identical, but "one field style everywhere... the town's ground" and "delete the curvy generator" would change the town's fields. Does the coordinator lift the byte-identical rule for the town's fields, and who owns `ground/layout.ts` (me or countryside)?
2. **Item 18 against the user's item 12:** the user said the game should start with lanes only, "no rail, no upgraded roads, then it's up to the player". I read item 18 as:
   - (a) the planner for motorways, A roads and rail (the `full` mode, and any player-built route the game auto-routes) follows the terrain with a grade limit;
   - (b) the seeded start stays lanes only.

   Is that right, or does the coordinator want some A roads and rail seeded now? Item 19 also says "all linked into road and rail".
3. **Industries (item 19):** is there an industry model on the integration branch I should place (`game/industries`?), or should the plan give each place an industry site that someone else fills?
4. **Item 20, the interface with OS:** I propose a `WorldSource` of `{ half, heights(box, step), water(box), settlements[], roads[], rails[], woods(box), seed }`. The seeded `planWorld` and a real-region adapter over `real/` both give it, and everything downstream (tiles, live area, activation, saves) takes only a `WorldSource`. The real region's 50 km is baked in tiles already, so the tile worker would read OS tiles for the fine detail where they exist. Who owns the adapter (OS, since it knows the format), and does the live area stay 8 km for real regions too? (OS plays 6 km today.)
5. **Edge:** which boundary gets the crust and portals on WORLD maps: the 50 km border only, or also the live 8 km box's edge (where the full sim ends)?
6. **First frame:** the budget is "well under 10 s"; we measure ~14 s under SwiftShader and expect a Pixel to be several times faster. Can I cut older phones and judge this on a phone-class device, or must it meet 10 s under SwiftShader?

## (e) Findings for other sessions (26 Sep, ~03:10 UTC)

These were measured on a 50 km map (seed 42) at 412×915 under SwiftShader, after the plan landed.

- **Countryside, `ground/paint.ts` (memory):**
  - About 205 MB of the page's 375 MB JS heap at the first frame is `CoverMap`'s scratch pools: `fpool` (10 × 17 MB `Float32Array`s), `ipool` (17 MB) and `bpool` (4 × 4.3 MB).
  - They are sized to the largest window ever painted, which is the live area's first whole-area paint (about 2048² texels at 4 m), and they're kept for good.
  - The fix is small: drop the pools after a paint whose window was over about 1M texels, or have `GameGround` paint the live area in 1 km boxes. Either brings the pools down to a few MB, and it matters on phones.
- **Countryside, hedges along lanes in the live area:** at 700 m, some hedge lines beside a lane run straight while the lane curves, so they drift into the fields and stop. It looks as if the hedges follow a straight or coarser line than the road that was built. There's a screenshot on request.
- **Everyone:** at 1.5 km over the live area, the full-detail trees were 1.4 million triangles. `game/regionview.ts` now uses the low trees, without trunks, from mid zoom out, which brings that down to 0.6 million. Up close the trees are unchanged.
