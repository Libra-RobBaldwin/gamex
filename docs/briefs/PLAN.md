# Overnight plan: one owner per file, every request assigned (26 Sep 2026, 01:55 UTC)

The coordinator wrote this from the six briefs in this folder. It answers their open questions. When a brief and
this plan disagree, this plan wins. Merge the integration branch (`claude/cloud-session-history-rvqkm1`) before
every push.

## The decisions

1. **The region is the 50 km WORLD.** The old 6 km `BIG` path (`size=6`) is kept only as a legacy option. Build
   nothing new on it. Port what's worth keeping onto WORLD. PRs #41 (countryside), #44 (edge) and #46 (terrain)
   are **retired**: close each one with a pointer to its new PR, and open a fresh PR from the same branch once
   the port is done.
2. **The town map may change** where the user asked for it: straight fields and plain dead ends with paths.
   Byte-identity is lifted for those two things only. Everything else about `?map=town` stays as it is.
3. **The seeded start stays lanes only:** no rail, no motorways and no A roads. The user said so directly, and
   that beats "all linked into road and rail". "Every road follows the terrain" applies to:
   - every route the game generates: lanes now, and the trunk planner's motorways, A roads and rail when they're
     used;
   - the way the player's road and rail tools route over hills (later).
4. **One of each:**
   - **One height function:** terrain's, behind `worldmap/terrain.ts`'s `heightAt`/`bed`/`field` shape.
   - **One road router:** world50's `worldmap/routes.ts`, reading that height function and OS's `PRIORS.follow`
     grades. Terrain's `findRoute` ideas may be folded in by world50.
   - **One field style:** countryside's farm blocks.
   - **One plan type:** world50's `WorldPlan`, with two sources, seeded or real.
5. **Phone budgets are judged on a Pixel-class phone.** SwiftShader is a proxy about 3–5× slower. A first frame
   of about 14 s under SwiftShader is acceptable. Aim for under 10 s, but don't sink the night into it.
6. **Shopping complexes are a big `shop` lot with a `units` count, not a new lot kind.** That keeps the economy,
   saves and UI unchanged, and keeps shop and job totals the same.
7. **Dead ends with paths (OS) are accepted on every map.** No OSM downloads for now; the user asked for free OS
   data.
8. **Tropical buildings are dropped.** There's no tropical style.

## The ownership map

Each file has one owner. Anyone else changes it only through its owner, or with a small edit the plan names
here. Shared files are edited in small hunks, and each PR lists them.

| Area | Owner | Files |
|---|---|---|
| The 50 km pipeline: plan, tiles, worker, view, live area, activation, coarse economy, saves | **world50** | `worldmap/plan.ts` (except its water and relief part), `routes.ts`, `towns.ts`, `tilegen.ts`, `tile.worker.ts`, `view.ts`, `live.ts`, `spec.ts`, `game.ts`, `econ.ts`; `docs/streaming.md` |
| The plan's source interface (`WorldSource` / `WorldPlan`) | **world50** defines it; **OS** writes the real adapter | `worldmap/spec.ts` or a new `worldmap/source.ts` (world50); `real/world.ts` (OS) |
| Height, drainage and erosion, coast and sea, rivers, lakes, islands, landform presets, geology | **terrain** | `worldmap/terrain.ts`, `worldmap/water.ts`, and the water and relief part of `worldmap/plan.ts` (handed over by world50); `region/terrain.ts`, `region/water.ts`; a new params module (say `worldmap/landform.ts`), the erosion worker (its own, not `tile.worker.ts`) and `geologyAt(x, z)`; the presets and `islands` in `region/options.ts` |
| Fields, hedges, woods and canopy, farmsteads, farm tracks, the ground painter | **countryside** | `ground/*` (including `layout.ts`: delete `bend`/`unbend` and the curvy corners), `region/fields.ts`, `woods.ts`, `lanes.ts`, `countryside.ts`, `game/country.ts`; `worldmap/country.ts` (**handed over** by world50: a tile asks countryside for fields, woods, hedges and farms) |
| Map edge and portals | **edge** | `game/edge.ts`, `game/portals.ts`; small hooks in `worldmap/econ.ts` (trips off the map), `traffic.ts` and `rail/*` as #44 had them |
| Real regions and priors | **OS** | `tools/os/*`, `public/regions/*`, `real/*` (including the new `real/world.ts`), `region/priors.ts`, `game/paths.ts`, `e2e/real.e2e.mjs`; the `real=<id>` field in `region/options.ts` |
| How buildings look, including shopping complexes | **vernacular** | `buildgen.ts`, `vernacular.ts`, `region/styles.ts`, `game/parking.ts`, the gallery; **allowed:** centre-frontage shop-lot planning in `roads.ts` (one function, small), `infill.ts` if the overlaps come from there, and the `units` count in `game/econ.ts` and `crowdsites.ts` |
| Menus, the region setup, the map list | **coordinator** | `src/app/*`, `src/proto/maps.ts`, `e2e/menu.e2e.mjs`. Sessions don't edit these. They export data (presets, the real-region list) and the coordinator wires it in. |
| `main.ts` | shared | Small hunks only, each in its own map's branch (`WORLD`, real, town). Order of landing: world50 → terrain → OS → countryside → edge → vernacular. Merge the integration branch before each push. |

## Every request, assigned

**world50**
- **Straight fields in the far tiles:** done by calling countryside's layout through `worldmap/country.ts`, which
  countryside now owns.
- **The whole map is playable:**
  - a quota of places per 10 km square, fewer in mountains and some on the coast, all linked by lanes;
  - **industries:** place sites from `src/proto/industries/` (catalogue, chains and site) near fitting land,
    such as a quarry on high ground, a port on the coast and farms in the vales, and link them;
  - edge exits for lanes that leave the map (the edge session reads the list).
- **Trunk planner** (the `full` mode, and later the player's auto-routing): A* with a grade limit from
  `PRIORS.follow` (A roads with a median of 3% and a 90th percentile of about 10%, rail about 1.5%); sweeping
  curves; bridges or tunnels only where they pay.
- **Priors:** read `region/priors.ts` in `planWorld` (settlement spacing and sizes, road hierarchy, dead-end and
  grid shares).
- **`WorldSource`, first and small:** land the source interface and the hook as an early small PR (aim for
  within about an hour) so OS and terrain can build on it.
  - `{ half, heights/field, water, settlements, roads, rails, woods, seed }`, with `planWorld` as the seeded
    source.
  - The live area stays 8 km for both sources.
- **Carried over:** the plan in the worker, in parallel with the start town; spreading place activation over
  frames; re-measuring memory.
- **Scenery houses:** take their palette from `vernacular.ts`, so the far towns match the live ones.

**terrain**
- Port #46 onto WORLD:
  - hills, ranges and scarps; the coarse drainage and erosion pass in its own worker; rivers widening to
    estuaries; sea and coast; lakes and reservoirs; level flats for places, corridors and easing;
  - the drape, roads and water performance fixes.
- **Presets** in `options.ts`: vale, downs, estuary, uplands, mountains, coast and islands, plus hilliness, water
  and woods. Also `islands`: none, few, archipelago or one.
- **All tunables in one params module** that OS's priors can set.
- **`geologyAt(x, z)`**, returning one of `limestone | gritstone | slate | granite | chalk | clay | sandstone |
  alluvium`, which vernacular's `setGeology` reads. Agree the list with vernacular by message if it needs more.
- **Keep the lighting and `uSlope` settings,** in one place, and tell countryside where.
- **Strip your `regionsetup.ts` and `menu.e2e.mjs` edits.**

**OS**
- **`real/world.ts`:** `realWorldPlan(region)` builds a `WorldPlan` from the bake, streamed through world50's
  view. Real heights come through the same height interface.
- **Speed:**
  - bake lots per 1 km tile and pre-designed junctions;
  - stream buildings per tile as tiles come near;
  - move the relief grid into the bake.
  - Target: under 20 s on a phone, under 60 s under SwiftShader.
- **Real regions in the Region flow:** export the list (`real/list.ts` already does), and the coordinator adds
  the choice. Once that's live, the coordinator drops the Exeter and Ludlow cards. Keep `?map=exe` and
  `?map=teme` working as aliases, with a save migration (yours).
- **Priors:** finish the measurements and feed them to world50's plan and terrain's params. Show seeded and real
  side by side at 412×915.
- **Real names off the map:** fine to use real names for places beyond a real region's edge, from Open Names;
  give edge the list.
- **Big retail footprints** on real maps use vernacular's shopping-complex recipe.

**countryside**
- One field style everywhere: your farm blocks, per tile (`Countryside.near`), on WORLD tiles through
  `worldmap/country.ts`, and on the town map.
- Delete the curvy generator in `ground/layout.ts`.
- Hedges, woods as a canopy (measure its draw calls against world50's budget and keep it inside), farmsteads
  (take walls and roofs from vernacular if cheap), and farm tracks.
- World50 owns B roads and lanes. Offer `laneRoute` to world50 if it's better.
- Remove your `BIG`-path `setPlan` wiring from `main.ts`.

**edge**
- Crust and signs at the **25 km rim** (the real map edge). Keep `EdgeFace` as its own group, reading WORLD's
  height function.
- Portals where world50's lanes (and later trunk routes) leave the map.
- Trips to places off the map feed world50's coarse economy (a small hook). Visible portal traffic runs only
  where the live area reaches the rim.
- Keep the hazy far country beyond the rim.
- Real maps: portals from real roads crossing the rim, with real names from OS.

**vernacular**
- **Less ugly buildings first:** proportions, roofs, windows, colour variety, how buildings meet the ground, and
  streets as a whole.
  - Near-view window depth as a level of detail is fine, within budget.
  - Plinths take up slopes, with heights from terrain.
- **Shopping complexes** (decision 6):
  - a small parade, a high-street arcade, a retail park, a covered centre;
  - each one coherent building with its own look, in the town's vernacular;
  - find where today's overlapping and clumped shop buildings come from and fix that at the source: no
    overlapping buildings anywhere.
- **`setGeology`:** wire it to terrain's `geologyAt` once it lands.
- **An export for world50's scenery houses:** a palette function.

**coordinator**
- Wire terrain's presets and islands into the region setup's first step.
- Add a "Seeded or a real place" choice there from OS's list.
- Drop the Exeter and Ludlow cards once the fold-in lands.
- Merge and test hourly, and push live when green.
- Fold in the gameplay review (`claude/review-gameplay`) and the name research.

## Merge order

1. world50's `WorldSource` PR (small, early).
2. Terrain on WORLD.
3. OS fold-in and speed; countryside on WORLD; edge on WORLD, as each is ready.
4. Vernacular, any time: it doesn't touch the region path.
5. The rest of world50's work (quota, industries, trunk planner, priors) as it's ready.

Each one goes through tsc, vitest (only the known economy test may fail), the six phone e2es with the URL as the
first argument (menu with `BASE=`), and a look at `?map=region` at 412×915 before it goes live.
