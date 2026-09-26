# Brief: terrain (claude/work-terrain-2, PR #46)

Session https://claude.ai/code/session_01Nh7v6jcJg3HUUibZ9harsP. Written 26 Sep 2026, 01:30 UTC, on resuming.

**State of the branch:** `claude/work-terrain-2` at `216aeed` is pushed and PR #46 is open. All checks passed at that
head: tsc, vitest (only the known economy failure) and the six phone e2es. Everything in it was built on the old
6 km region path (`BIG` in `main.ts`), before world50 landed.

**The merge the coordinator asked for is not done.** Merging `claude/cloud-session-history-rvqkm1` (b57164e) gives
18 conflict hunks in 8 files:

| File | Hunks |
|---|---|
| `src/app/regionsetup.ts` | 5 |
| `src/proto/main.ts` | 4 |
| `src/proto/region/options.ts` | 3 |
| `src/proto/region/generate.ts` | 2 |
| `src/proto/region/index.ts` | 1 |
| `src/proto/region/terrain.ts` | 1 |
| `src/proto/drape.ts` | 1 |
| `e2e/menu.e2e.mjs` | 1 |

Five of those files are shared, and resolving them means deciding how this work sits next to world50's `WORLD`
path. That is the scope decision the ownership map will make, so I aborted the merge and changed nothing else. I'll
resolve it as soon as scope is confirmed; see "Open questions".

## (a) Requests, and where each stands

### The original task (coordinator, 25 Sep, with the user's feedback on `?map=region`)

The user's words, quoted in the task: "The map edges look really bad... should be earth crust, and I asked
previously for out-of-map portals for traffic. Fields look warped and awful - this isn't how the countryside should
look... should be more uniform, and missing forests etc. There's no sea or concept of sea or lakes - just very narrow
rivers, and the map is completely flat... where are the hills? Also expecting the map to be 10x the size."

1. **"Hills you can see":**
   - The ask: real hill ranges, valleys the rivers run down, escarpments and ridges on upland, with settlements
     still on level ground. Shading must show the relief. Keep road and rail gradients sane: terrain.md steps 4–7
     are the ideal (cuttings and embankments), and at least the motorway and railway should be on gentle ground.
   - **Done on the 6 km region path, not on WORLD:**
     - `region/terrain.ts` has swells, hill ranges and a scarp, rising inland; rolling hills reach about 150 m.
     - Every settlement, lake and river sits on a level flat, and flats that meet share one level.
     - Corridors ease the ground to rail 1.5%, motorway 3%, A roads 5% and B roads 6%.
     - The ground is lit three times steeper than it is (`GROUND_LIFT` in `game/water.ts`).
   - **Not done:** viaducts over valleys. Roads dip with the eased ground instead.
2. **"Sea and coast":**
   - The ask: a coastline on one or two sides with bays, headlands, beaches and cliffs, and a harbour town possible,
     on by default for temperate. Lakes bigger and more varied (reservoirs in valleys, meres). Rivers widen
     downstream to a wide lowland river and estuary. Water must look right with the existing shader.
   - **Done on the region path:** the coast, the harbour town, rivers from 7 m to an estuary, streams, meres and
     reservoirs. The sea uses the water library's own sea type, and open sea is drawn as plain sheets.
3. **"Map size":**
   - The ask: about 10x the area (6 km to about 19 km) as the new default, with S/M/L in `options.ts` and the start
     menu's region setup. Keep it streaming, measure load time, draw calls and frame time, stay under the R4
     budgets, and scale settlements and roads with the area.
   - **Done** (S/M/L, L by default, measured in #46), then **superseded** by brief update 1 below. To drop in
     favour of world50's `size` (50 or 6).
4. **Coordination rules in the task:**
   - Stay off `ground/*` (fields, hedges, woodland; the countryside session) and `game/edge.ts` plus roads off the
     map (the edge session).
   - Kept to both, with one exception: `main.ts` sets the ground shader's `uSlope` uniform, its rock and moor
     thresholds.

### The user, directly (mid-turn, 25 Sep)

"Fields are still a weird shape - and roads still cut straight through the landscape, they should be built around
the topography, but still sense no hills etc"

- **Fields:** not mine (countryside). Not touched.
- **Roads around the topography:** partly done.
  - A and B roads route round the hills by A* (`findRoute`, `routePieces`) and are built as curves. On L the share
    of road on ground steeper than 6% fell from 15% to 5%.
  - The motorway and railway are still straight lines with the ground eased along them.
  - On WORLD, world50's `routes.ts` has since made lanes follow the land.
- **Hills:** partly done. They show at mid and near zoom; fully zoomed out they are still subtle.

### Brief update 1 (coordinator, 16:51 UTC): every map is 50 km

The ask:
- World50 owns size and lazy tile generation, so drop the size option.
- Make the height field, coast, lakes and rivers work at 50 km and be evaluated lazily per tile:
  - pure functions of (x, z) and the seed, plus small global structures;
  - a 1 km tile's heights in a few ms;
  - no whole-map fine arrays.
- Read as real Britain: a fractal coast with bays, estuaries and headlands, valleys that drain to it, hill ranges
  and moorland.
- Keep the parameters in one clear place, to be tuned from OS data.

**Not started.** The update reached me only after #46 was built. `landform()` is already a pure function of (x, z)
and the seed. The flats, corridors and road routing are whole-map grids (25–50 m, about 2 s on L). The size option
is still in #46.

### Brief update 2 (coordinator, 17:23 UTC): real landforms, presets, islands, geology

The user, quoted: "Islands might be an option for the region settings... I want the region seed to create maps that
feel realistic... we are still doing nothing with mountains/valleys/cool stuff at the moment... we should be - the
seed should enable the player to create many realistic places! How does TF2 manage it? Or CS2? ...remember this is
built for phone!"

1. **Coarse field:**
   - The ask: in a worker at load, over 50 km at 100–200 m cells:
     - uplift masks (ranges, massifs, scarps);
     - priority-flood, flow accumulation and stream-power incision, so valleys are carved by their rivers;
     - rivers that join into trees and reach the sea or a lake;
     - eroded ridges and spurs, with cheap per-tile noise on top.
   - Budget: about a second on a mid phone, without blocking the first frame.
   - **Not started.** The water library already has `priorityFlood` and `accumulate` in `water/flood.ts`.
2. **Landform presets:**
   - The ask: lowland vale, chalk downs with scarps, river estuary, uplands and dales, mountains with glacial lakes
     (U-valleys, ribbon lakes, corries), coast with cliffs and headlands, islands and archipelago. Offered as clear
     choices plus sliders (hilliness, water, woods).
   - **Not started.**
3. **Islands:**
   - The ask: none, a few offshore, archipelago, or one big island. Land and sea right; ferries and bridges later.
   - **Not started.**
4. **Settlements and trunk routes:**
   - The ask: places on valley floors, river crossings, bays and the foot of hills; trunk roads and railways along
     valleys and passes.
   - **Partly done:** places sit on flats at the water's level when near water, and A and B roads follow valleys.
     Placement is not yet driven by landform.
5. **Geology:**
   - The ask: a per-point query (x, z) to rock or soil type, for the vernacular session.
   - **Not started.**
6. **Parameters:** everything tunable in one module. **Not started** (constants are spread across
   `region/terrain.ts`).

### Brief update 3 (coordinator, 18:39 UTC): the setup UI is the coordinator's

The ask:
- Don't edit the region setup UI in `src/app`.
- Put new settings only in `region/options.ts`: the options, defaults, clamping, `optionsFromQuery`, and an exported
  list of landform presets (id, name, one-line description, the option values it implies).
- Suggested ids: vale, downs, estuary, uplands, mountains, coast, islands. An `islands` option: none, few,
  archipelago or one.

**Not started, and #46 breaks this rule.** It touches `src/app/regionsetup.ts` (a Map size step and a Coast stepper)
and `e2e/menu.e2e.mjs`. The update reached me only after #46 was built; I'll strip those edits.

### Pause (20:42 UTC) and resume (01:15 UTC)

- **Pause:** done. Work committed and pushed, the PR note written, my check-in deleted.
- **Resume, step 0:**
  - The merge is not done (see the top).
  - This brief: done.
- **Resume, then:** land terrain on the WORLD path, not started:
  - hills, valleys, drainage and erosion, sea and coast, islands and landform presets;
  - presets and islands in `region/options.ts`;
  - one height generator with `worldmap/terrain.ts`;
  - coordinate with world50 (roads and rail on the terrain) and OS (seeded land learning from OS maps) through the
    height function;
  - phone first, no flicker or z-fighting;
  - tsc, vitest and the phone e2es;
  - a PR with screenshots, and hourly check-ins until merged.

### The user's rules for the 50 km world (HANDOVER, 25 Sep), where they touch terrain

- "Every road respects the terrain, not only lanes: motorways, A roads and railways too. Follow valleys and
  contours, keep within a grade limit, curve round hills, woods and water in sweeping bends, and bridge or tunnel
  only where it pays."
  - The routing is world50's. What I bring: the height function they read, and `findRoute` (A* over the height
    grid with a grade cost), which they could reuse.
- "Seeded maps as good as real ones, by learning from the OS data."
  - Needs the one-parameters module, so OS priors can set it.

## (b) Files and modules I own or expect to change

- **Mine now:**
  - `src/proto/region/terrain.ts`: the landform, levels, corridors, road routing and grid field.
  - `src/proto/region/water.ts`: `MapWater`, coast, river widths, lakes.
  - The water part of `src/proto/region/generate.ts`.
  - `src/proto/game/corridors.ts` (new).
  - `GameWater`'s ground mesh, beds, sea and shore in `src/proto/game/water.ts`.
- **Expect to change, with world50's agreement:**
  - `src/proto/worldmap/terrain.ts`, which is to become one height generator with mine. Its header already says
    the terrain session can replace it: "anything with these three methods" (`heightAt`, `bed`, `field`).
  - `src/proto/worldmap/water.ts` (the sea, rivers and lakes of the world plan).
  - The water and relief parts of `src/proto/worldmap/plan.ts`.
- **New:**
  - a parameters module (for example `src/proto/region/landform.ts` or `worldmap/params.ts`);
  - a coarse drainage and erosion pass, run in a worker;
  - `geologyAt(x, z)`.
- **Options:** presets and islands in `src/proto/region/options.ts` only; no UI.
- **Shared files #46 touched:**
  - `src/proto/drape.ts`: tight culling bounds, and culling of instanced tile woods and hedges;
  - `src/proto/roads.ts`: two bounding-box pre-filters with identical results;
  - `src/proto/interchange/region.ts`: the motorway keeps to land; roads built along routes;
  - `src/proto/main.ts`: a few lines;
  - `src/app/regionsetup.ts` and `e2e/menu.e2e.mjs`, to be stripped.

## (c) Overlaps with other sessions

- **World50:**
  - `worldmap/terrain.ts`, `water.ts` and `plan.ts` are the same job as mine, done their way. Their `BROAD_HEIGHT`
    and `HILL_HEIGHT` sit on top of my old `RELIEF_HEIGHT`; mine changed `RELIEF_HEIGHT` to 30/110/210/380 m.
  - `routes.ts` routes roads over the terrain; my `findRoute` does the same for the region's A and B roads, so we
    should agree on one router.
  - `tile.worker.ts` is theirs; the coarse erosion pass needs a worker too.
  - The `size` option in `options.ts`: both of us changed it; theirs wins.
  - `main.ts` `WORLD` versus `BIG` wiring.
  - `drape.ts`: they use `partField` and I changed the bounds.
- **OS:**
  - Real heights for Exeter and Ludlow, and priors for the generator. The parameters module is where their
    statistics would go.
  - Real OS land should come through the same height interface.
- **Countryside:**
  - `ground/*` is theirs. I set `uSlope` from `main.ts` and exaggerate the ground mesh's normals, so the rock,
    moor and shading on slopes are shared ground.
  - Trees and woods keep off water through `GameWater.near` and `isWater`, which I sped up.
  - Their port onto WORLD will read my height function.
- **Edge:**
  - `game/edge.ts`'s cut face reads `gameWater.shapes.ground`, which now includes the sea bed, so the edge face
    goes below sea level on a coast.
  - The motorway line (`interchange/region.ts`) and roads off the map are theirs; I added the coast check to
    `motorwayLine`.
- **Vernacular:** will consume `geologyAt(x, z)`. We need to agree the rock and soil categories (chalk, clay,
  limestone, sandstone, granite, alluvium…).
- **Coordinator (menu):** presets and islands go through `options.ts` only; I strip my regionsetup edits.

## (d) Open questions

1. **Is PR #46 merged or retired?**
   - With the region now the 50 km world, does the 6 km path (`size=6`) stay? If yes, #46 can land there once
     conflicts are resolved and my `size` option is dropped for theirs.
   - If no, I'd close #46 and port the useful parts onto WORLD in a new PR: the sea and coast, river widths,
     streams and reservoirs, level-flat groups, corridor easing, road routing, and the drape, roads and water
     performance fixes.
2. **Who owns the world plan's water placement** (where the coast, rivers and lakes go in `plan.ts`) versus how they
   lie in the ground? I'd take both, if world50 agrees.
3. **One road router:** keep world50's `routes.ts` and have it read my height function, or share `findRoute`?
4. **May I keep the ground mesh's three-times lighting and the `uSlope` setting**, which touch countryside's ground
   shader, or should they move into `ground/`?
5. **Worker:** should the coarse drainage and erosion pass run in world50's `tile.worker.ts` or its own worker?
6. **Phone budgets:** I can only measure under SwiftShader here, so the "about a second on a mid phone" coarse pass
   needs a check on the user's Pixel.
7. **Geology categories for vernacular:** agree the list before I write `geologyAt`.
