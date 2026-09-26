# Brief: onemap-4 (ONE MAP step 4: delete the 6 km code)

Session: https://claude.ai/code/session_01N2xhRAKzQWsSt6RZQH8jdG, branch `claude/work-onemap-4`, off the
integration head efce852. Coordinator: https://claude.ai/code/session_01NoR4Fo844FXMiY63oVBeCU.

**Rule:** nothing below is "done" until it is live (merged into the integration branch) and checked on a
412×915 screenshot where a screen is involved.

## What's asked (PLAN.md decision 4, and PR #59's "not in this PR")

1. **Delete the 6 km parts nothing on the WORLD path uses.** Every import was checked first:
   - `region/generate.ts`: WORLD uses `KINDS`, `layStreets`, `reach`, `suggestLinks` and the types
     (`worldmap/plan.ts`, `spec.ts`, `towns.ts`, `routes.ts`, `source.ts`, `real/world.ts`), so the file
     stays. `generateRegion`, `makeWater`, `placeSettlements`, `REGION_BOUND` and `Region` (the 6 km map
     made whole) were the part to delete.
   - `interchange/region.ts`: nothing live imported it (only `rail/region.ts`, its test and the portal test).
   - `rail/region.ts`: nothing live imported it (only `rail.test.ts`'s "the region's railway").
   - `region/town.ts` (`TOWN_MAP`): only `region/index.ts` re-exported it; nothing used it.
   - `game/regionview.ts`: **live** (main.ts builds a `RegionView` on every map). Stays.
   - `region/index.ts`: `regionMap`, `mapOfRegion`, `REGION_SEED` (6 km MapSpecs) go; `mapFromQuery` stays.
   - Tests follow: `interchange/region.test.ts` (deleted), `rail.test.ts` "the region's railway"
     (deleted), `region/region.test.ts` (rewritten on the 50 km plan), `game/water.region.test.ts` and
     `game/portals.test.ts` (their 6 km fixtures replaced), `vernacular.test.ts` and `region/priors.test.ts`
     (built their maps with `regionMap`).
   - `npx tsc --noEmit` clean after.
2. **Wording and packages:** the 6 km wording in `src/app/regionsetup.ts` (`src/proto/maps.ts` had none
   left); `leaflet` and `@types/leaflet` out of `package.json` (nothing imports them), lockfile by `npm install`.
3. **Docs:** remove or rewrite what describes the starter town, the sandbox, the 6 km region and Real Town
   Plans / `places.html` in README.md and docs/.
4. **Hero pictures** for the start menu from the region (`src/app/art/hero-tall.webp`, `hero-wide.webp`,
   `map-region.webp`), retaken from the game at phone size. The old script (`e2e/.scratch/art.mjs`) was never
   committed, so `e2e/art.mjs` is written and kept.

## Files I must not edit
`src/proto/region/fields.ts`, `woods.ts`, `lanes.ts`, `countryside.ts`, `src/proto/worldmap/country.ts`,
`src/proto/ground/*` (countryside); `src/proto/economy*.ts`, `econ*.ts`, `src/proto/bridges/perf.review.test.ts`
(coordinator); `src/proto/game/*`, `src/proto/ui/*` beyond removing dead 6 km references (play-review).

## Decisions
- **`generateRegion` and countryside's `fields.test.ts`.** That test builds its input (settlements, links, a
  river) from `generateRegion`, and the countryside session is re-applying #52 against that very test, so its
  body isn't touched. `generateRegion` and its water and settlement placing move verbatim into a test-only
  fixture, `src/proto/region/sixkm.fixture.ts` (with the old 6 km defaults, so the test's input is the same),
  and `fields.test.ts`'s one import line points at it. That import line is the only edit near countryside's
  files; the fixture is theirs to delete when the test builds its own input.
- **The portal-traffic test.** On a 50 km map the ways off come from `worldPortals(plan)` and carry no seg
  ids (the live area never reaches the rim), so `PortalTraffic` never runs there yet. The test's intent
  (traffic in and out through a way off near the camera, busiest in the rush hour and on the motorway) is
  kept on a hand-laid Network on a 50 km map's rim: a motorway pair, an A road and a B road the player might
  build out through it, found by `findPortals`. `layRegionRoads` went with `interchange/region.ts`.
- **Options:** `SIZES` is `[50]`; the 50 km defaults (two rivers, the seed decides the towns) are the
  defaults; `limitsFor` always gives the 50 km limits. An old `size=6` address still opens the 50 km map, and
  `goneSave` in the menu still recognises a 6 km save as gone.
- **`TOWN_WATER` / `TOWN_LAKE`** (`worldmap/water.ts`) stay: `game/water.ts` takes `TOWN_WATER` as its
  default spec, and `game/*` isn't mine.
- **`woodSpots`** (`region/priors.ts`, OS's) now has no caller in the game; noted in docs/regiongen.md, not deleted.
- **`findPortals`** (`game/portals.ts`) stays: it finds ways off on the Network, for when the player's roads
  reach the rim; only its test moved.

## Shared files touched (small hunks)
- `src/app/regionsetup.ts` (the 6 km branches and wording), `src/app/menu.ts` (one comment), `docs/HANDOVER.md`.
- `src/proto/region/options.ts` (one size), `region/index.ts`, `region/generate.ts`, `region/priors.test.ts`,
  `region/fields.test.ts` (one import line).
- `src/proto/game/portals.test.ts`, `game/water.region.test.ts` (dead 6 km fixtures replaced).
- `src/proto/vernacular.test.ts`, `src/proto/rail/rail.test.ts`.
- `package.json`, `package-lock.json` (Leaflet out).
- README.md and docs/ (see the docs commit).

## New direction from the user (26 Sep, 20:40 UTC): roads at the edge of towns

The user, on the region's start town: "Roads going off at deeply weird angles at the edge of the towns...
Not realistic at all... I really wanted you to look at a load of real maps from OS and come up with seed
rules that reflect reality... Tell coordinator session this is what you are doing." The coordinator was
told at 20:41 (a message into its session).

**Measured** (`tools/os/exits.mjs`, over the two OS bakes: 31 market towns and 330 villages; `--svg` draws
each town to look at): a place's roads leave radially through its main streets, within 30° of straight out
6 times in 10, and turn only about 40° in their first kilometre outside; a village has about 5 ways out, a
town about 11; two roads wanting the same way out share it and fork outside. The numbers are `PRIORS.exits`
(`region/priors.ts`), with a row in docs/real.md.

**Applied** (small hunks): `region/generate.ts` `layStreets` gives every settlement four spokes (both ends
of its high street and its main cross street, each facing out); `worldmap/routes.ts` picks the spoke facing
a lane's destination (`spokeFor`), runs the lane straight along it for 240 m (`stem`) and smooths the rest
into it as one line (`joinStems`); the existing `forks` makes two lanes on one spoke fork outside.
`region.test.ts` checks every lane leaves by the best-facing spoke, straight, and bends as the priors say.

| Item | State |
|---|---|
| Measurement and pictures of real towns | done (scratch: exits.json, an SVG per town); the script is in tools/os |
| Spokes, spoke choice, stems | done locally; the start town's lanes now leave along its streets (checked on a shot of seed 42) |
| Tests | being finished (the "straight out" check) |
| Checked at 412×915 on the region, before/after in the PR | not yet |

## State (step 4)

| Item | State |
|---|---|
| Brief written | done (this file) |
| 1. Delete the 6 km code, tsc clean | done locally (commit 1d750f3) |
| 1. Tests follow: vitest | done locally: the full suite passes bar the known economy test (see "Checks") |
| 2. Setup / maps wording | done locally; the setup's summary checked in the menu e2e shot |
| 2. Leaflet out, lockfile by `npm install` | done locally |
| 3. Docs | done locally (commit 7212d4c) |
| 4. Hero pictures from the region | done locally; checked in the e2e shots (below) |
| Phone e2es (lines, loop, rail, save, stations, menu) on the region | loop, rail, save, stations and menu passed on the deletion commit (1d750f3); lines was killed twice by the dev server reloading the page when I wrote files mid-run, then passed; being rerun with the full suite on this head, results on the PR |
| PR open into the integration branch | #61, open, subscribed; check-in at 22:26 UTC |
| Live (merged) | no |

## Checks
- `npx tsc --noEmit`: clean.
- `npx vitest run --no-file-parallelism`: all pass but `economy.test.ts` "a well-served town grows and gets
  denser" (the coordinator's known failure). `bridges/perf.review.test.ts` passed on this run.
- Phone e2es: see State. The home screen with the new picture (menu e2e `1-home.png`), the setup summary and the region start were checked at 412×915.

## Realism
The user's next ask (roads at the edge of towns, from OS data) is its own stream: branch `claude/work-realism`, brief `docs/briefs/realism.md`.
