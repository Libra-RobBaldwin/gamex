# Brief: onemap-4 (ONE MAP step 4: delete the 6 km code)

Session: https://claude.ai/code/session_01N2xhRAKzQWsSt6RZQH8jdG, branch `claude/work-onemap-4`, off the
integration head efce852. Coordinator: https://claude.ai/code/session_01NoR4Fo844FXMiY63oVBeCU.

**Rule:** nothing below is "done" until it is live (merged into the integration branch) and checked on a
412×915 screenshot where a screen is involved.

## What's asked (PLAN.md decision 4, and PR #59's "not in this PR")

1. **Delete the 6 km parts nothing on the WORLD path uses.**
   - `region/generate.ts`: WORLD uses `KINDS`, `layStreets`, `reach`, `suggestLinks` and the types
     (`worldmap/plan.ts`, `spec.ts`, `towns.ts`, `routes.ts`, `source.ts`, `real/world.ts`), so the file
     stays. `generateRegion`, `makeWater`, `placeSettlements`, `REGION_BOUND` and `Region` (the 6 km map
     made whole) are the part to delete.
   - `interchange/region.ts`: nothing live imports it (only `rail/region.ts`, its test and the portal test).
   - `rail/region.ts`: nothing live imports it (only `rail.test.ts`'s "the region's railway").
   - `region/town.ts` (`TOWN_MAP`): only `region/index.ts` re-exports it; nothing uses it.
   - `game/regionview.ts`: **live** (main.ts builds a `RegionView` on every map). Stays.
   - `region/index.ts`: `regionMap`, `mapOfRegion`, `REGION_SEED` (6 km MapSpecs) go; `mapFromQuery` stays.
   - Tests that follow: `interchange/region.test.ts` (deleted), `rail.test.ts` "the region's railway"
     (deleted), `region/region.test.ts` (rewritten for what's left), `game/water.region.test.ts` and
     `game/portals.test.ts` (their 6 km fixtures replaced), `vernacular.test.ts` and `region/priors.test.ts`
     (built their maps with `regionMap`).
   - The portal-traffic test keeps its intent on a 50 km map's rim (see "Decisions").
   - `npx tsc --noEmit` clean after.
2. **Wording and packages:** the 6 km wording in `src/app/regionsetup.ts` and `src/proto/maps.ts`;
   `leaflet` and `@types/leaflet` out of `package.json` (nothing imports them), lockfile by `npm install`.
3. **Docs:** remove or rewrite what describes the starter town, the sandbox, the 6 km region and Real Town
   Plans / `places.html` in README.md and docs/.
4. **Hero pictures** for the start menu from the region (`src/app/art/hero-tall.webp`, `hero-wide.webp`,
   `map-region.webp`), retaken from the game at phone size. The old script (`e2e/.scratch/art.mjs`) was never
   committed, so a new one is written (kept out of the repo, or in e2e/ if small).

## Files I must not edit
`src/proto/region/fields.ts`, `woods.ts`, `lanes.ts`, `countryside.ts`, `src/proto/worldmap/country.ts`,
`src/proto/ground/*` (countryside); `src/proto/economy*.ts`, `econ*.ts`, `src/proto/bridges/perf.review.test.ts`
(coordinator); `src/proto/game/*`, `src/proto/ui/*` beyond removing dead 6 km references (play-review).

## Decisions
- **`generateRegion` and `region/fields.test.ts`.** Countryside's `fields.test.ts` builds its input from
  `generateRegion` (settlements, links, a river). That file sits with countryside's `fields.ts`, and the
  countryside session is re-applying #52 against that very test, so I don't edit it. To delete
  `generateRegion` all the same, its 6 km settlement layout moves to a test-only fixture,
  `src/proto/region/sixkm.fixture.ts`, and `fields.test.ts` keeps working through a one-line re-export
  shim... **No:** a shim is the old code under a new name. Decision: `generateRegion` is deleted from
  `generate.ts`; `fields.test.ts`'s one import line is the only edit outside my list, and it's noted in the
  PR for countryside. *(Updated below as the work settles.)*
- **The portal-traffic test.** On a 50 km map the ways off come from `worldPortals(plan)` and carry no seg
  ids (the live area never reaches the rim), so `PortalTraffic` never runs there yet. The test's intent
  (traffic in and out through a way off near the camera, busiest in the rush hour and on the motorway) is
  kept on a hand-laid Network on a 50 km map's rim: a motorway and an A road the player might build out
  through it, and a lane as the seeded start has, found by `findPortals`. `layRegionRoads` goes with
  `interchange/region.ts`.
- **`TOWN_WATER` / `TOWN_LAKE`** (`worldmap/water.ts`) stay: `game/water.ts` takes `TOWN_WATER` as its
  default spec, and `game/*` isn't mine.

## State

| Item | State |
|---|---|
| Brief written | done (this file) |
| 1. Delete the 6 km code, tsc clean | not started |
| 1. Tests follow (vitest green bar the known economy test) | not started |
| 2. Setup / maps wording | not started |
| 2. Leaflet out, lockfile by `npm install` | not started |
| 3. Docs | not started |
| 4. Hero pictures from the region, checked at 412×915 | not started |
| Phone e2es (lines, loop, rail, save, stations, menu) on the region | not run |
| PR open into the integration branch | no |
| Live (merged) | no |
