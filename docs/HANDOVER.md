# Handover: where everything stands

## Latest: HUD, start menu and region work (25 Sep 2026)

**Morning, 26 Sep (06:30 UTC):** everything in `docs/briefs/PLAN.md` merged overnight is live:
- world50: WorldSource, places in every 10 km square, industries, trunk routes over the land, priors;
- edge on WORLD;
- vernacular's shopping complexes;
- countryside on WORLD (one field style);
- OS's faster real maps (40 s Exeter under SwiftShader);
- terrain on WORLD (landforms, islands).

The region setup shows the seven landforms, and the real places under "Or play a real place".

Open issues:
- The region's first view lands on a field beside the start town, not on the town. World50 and terrain have
  been told.
- The OS fold-in of real maps into the WORLD pipeline is not done: real places still open ?map=exe or teme.
- The gameplay review session (session_01U9NWdcPH7mkV5QoNQxL1zG) had no repo attached, and its documents never
  reached GitHub.

**Countryside on `WORLD` (26 Sep, `claude/work-country`).** One field style everywhere: the farm
blocks of `region/fields.ts` on every 50 km tile, the live area and the town (the town's fields
changed; its world state didn't). The old grid, bend and swirl generator in `ground/layout.ts` is
deleted. Woods are a canopy mesh (in each tile's one solid mesh, so no extra draw call), farmsteads
are tile scenery, and farm tracks route over the land. `worldmap/country.ts` is now countryside's.
`region/lanes.ts` `laneRoute` is on offer to world50 for its B roads and lanes. See docs/ground.md.

**PAUSED 25 Sep ~20:40 UTC for a credit limit. To resume:**
1. All six region sessions were told to commit and push, write a note on where they stopped and
   stop. Their check-ins were disabled, not deleted: `trig_01AyapkhwsVcMhAMAKQ9caju` (#42),
   `trig_01Ek1SW3wQooCqKrBfHwT3j9` (#44), `trig_013GtCHP7rnmTLWuPbJjyB2r` (#43) and
   `trig_01LkUZuKGwCSYrq9QoDTE41o` (#45). The coordinator's check-in is
   `trig_01UboPgMjMc2T4TShqSC9vTi`. Re-enable them, or message each session to carry on.
2. **Merged and live at the pause:** world50 (#42), vernacular (#45) and OS (#43, adds Exeter and
   Ludlow). All tests were green. Exeter took 142 s to load under SwiftShader; check it on a phone.
   **Still to merge:** countryside (#41) and edge (#44). Both were built on the old 6 km region's
   `BIG` path, which world50's `WORLD` path has replaced for the region, so they conflict in
   `main.ts` and `ground/game.ts`. Port them onto `WORLD`, not a text merge. Terrain has no branch
   yet. The loop, lines, save, stations and rail suites take the address as their first argument
   (`node e2e/loop.e2e.mjs http://localhost:5180/?map=town`). The menu suite takes it from `BASE=`.
3. **The user's rules for the 50 km world (25 Sep, at the pause). Do these first, in the port of
   countryside and edge:**
   - **One field style everywhere:** straight-edged hedged fields in farm blocks, as world50
     has. No curvy or warped fields left in any path (the region, the 50 km world, the town's
     ground). Remove the old curvy generator, don't just hide it.
   - **Every road respects the terrain, not only lanes:** motorways, A roads and railways too.
     Follow valleys and contours, keep within a grade limit, curve round hills, woods and water
     in sweeping bends, and bridge or tunnel only where it pays. No ruler-straight roads across
     hills.
   - **The whole map is playable:** seed towns, villages and industries right out to the corners
     and edges, so no part of the 50 km is empty (for example a minimum per 10 km square,
     scaled by terrain: fewer in mountains, some on the coast). Link them all into the road and
     rail network, and have the edge portals carry the traffic that runs on off the map.
   - **Also (the user, 25 Sep, late):**
     - Fold the OS real regions into the Region flow as the alternative to a seeded map. Both use
       one WORLD pipeline.
     - Seeded maps as good as real ones, by learning from the OS data.
     - Shopping complexes of variable size in town centres. Each is one coherent building with
       its own walls, roof and look, not 20 buildings squashed together or overlapping.
     - Less ugly buildings.
   - **Overnight run:** every session writes `docs/briefs/<name>.md` first, listing everything asked
     of it by the coordinator and by the user directly. At 01:45 UTC the coordinator dovetails the
     briefs into `docs/briefs/PLAN.md` (the ownership map, requests, interfaces and merge order),
     then merges hourly. Morning summary at 06:15 UTC.
4. Then wire terrain's landform presets and islands into the region setup's first step, and do
   HUD phase 3 (small tap cards for a bus, stop or building).
5. The user's home town is still named in the repo in a few places, from before the privacy
   rule (region names, vehicle brands, tests, docs). It's gone from the menu. Ask the user
   before removing the rest.

Coordinator: https://claude.ai/code/session_01KCA5Gq42qr3TFSD5KvUoT8. Integration branch as before.
- **HUD, second pass (`ui/shell.ts`, `proto.css`):** a rounded floating dock with a Build button
  in the middle, and a status pill showing money with its trend, population, the clock and speed.
  It also has an alert bell (`setAlerts`), a milestone ring that pays grants (`MILESTONES` in
  `main.ts`, `purse.grant`), a Stats tab (money, lines, towns) and small cards when you tap
  something. Overlays are Stop coverage and Traffic.
- **Bus stops reach a three-minute walk (250 m), not 400 m:** `STOP_WALK_M` in `game/econ.ts`, the
  same in the coverage overlay. Stations stay at 800 m. The loop e2e's profit is unchanged.
- **Roundabout entries** have painted chevrons, not green splitter islands (`jshape.ts`).
- **Start menu (`src/app`):**
  - Home is a picture of the starter town, drifting slowly (`src/app/art/`, taken from the game
    with `e2e/.scratch/art.mjs`, a local script; retake the pictures when the look changes).
  - Over it: a Continue card for the last town with its map's picture, New game as the big
    button, and a row of tiles (How to play, Library, Settings, About).
  - New game has a card per map with its picture. Loading shows the map's picture and a tip.
  - Region setup asks one question per step, then shows a summary (`regionsetup.ts`).
  - Everything is rounded, like the HUD.
- **Six region sessions (started 25 Sep afternoon):** terrain, countryside (PR #41), edge,
  world50 (50 km maps, PR #42), OS open data (PR #43) and vernacular buildings. Merge each
  into the integration branch as it's ready, and test.
## Latest: buildings fit their place, and parked cars are real (25 Sep 2026)

Branch `claude/work-vernacular`. **Read `docs/vernacular.md` and `docs/parking.md`.**
- **Regional buildings:** on generated maps, houses, terraces, shops and village buildings are
  built in their settlement's tradition, from the rock (Cotswold, Pennine, Lakeland, Cornish,
  Scottish, flint, Midland brick, Wealden, Marches) or the climate (Nordic under snow, desert earth,
  Mediterranean). The age of the street comes from its distance to the centre. `vernacular.ts` is
  pure and takes the terrain's geology through `setGeology`. The town map is unchanged by it;
  `?vern=` forces a tradition. Gallery: `/buildings-demo.html`.
- **Finish, everywhere:** fascias, gutters, ridges, plinths, ambient occlusion, doors set into
  their walls, textured garden walls and hedges, and layered garden trees.
- **Parking:** drives and car parks hold the traffic's own vehicles (no extra draw calls). Trips end
  by driving into a free space and start by pulling out of one. Plots fill and empty with the hour
  off screen.

## Earlier: saving and loading (24 Sep 2026, night)

Session https://claude.ai/code/session_01PQ93PyRyTyLaPDoybw2MMw. **Read `docs/save.md`.**
- **Save and load work:**
  - versioned saves in IndexedDB with a migration chain;
  - autosave every 4 game hours and when the page is hidden;
  - Menu > Save town and Load town;
  - the start menu's Continue and Saved towns;
  - a loaded town continues exactly as saved (`game/save.test.ts`, `e2e/save.e2e.mjs`).
- **The economy library changed slightly (`economy.ts`):** its save also keeps each zone's review
  tallies, each building's site score and the order its town met its zones. The game makes a save
  a round trip for its own economy too (docs/ENGINE.md).
- **CI:** timing budgets scale with the machine, and the phone tests run in CI. That's a second
  PR from `claude/work-save-ci`.

## Earlier: the player builds everything, and simpler tools (24 Sep 2026, night)

Session https://claude.ai/code/session_01KCA5Gq42qr3TFSD5KvUoT8, on the user's feedback:
nothing should be built at the start, the HUD was too big, and the tools were too complicated.
- **Empty start:** no starter stops, bus line, stations or rail lines; the region's track is laid
  bare (`layRegionRail(..., { trackOnly: true })`). The economy holds a town steady with no
  service (`GAME_TUNE.local.visitors: 1`), so the player's service is what makes it grow.
  `transferWalkM: 60` fixed zero riders.
- **Next-step card** (`shell.goal`, `updateGoal` in `main.ts`): under the status strip. It reads
  "build 2 stops", then "draw a line", then "watch the town grow". Tapping it opens the right
  tool. It goes once the first line has run two days.
- **Bus stop tool:** tap a road, and a blueprint goes down. Kerbside and Lay-by are two buttons
  with prices, and Build confirms. The blueprint shows faintly through buildings in front of it.
- **Road tool:** one row, showing the type name and price. The chevron or the sliders button
  opens a drawer: row 1 holds the common types plus More, row 2 the shape, height, gradient and
  Join/Over/Under. With a blueprint down, the hint pill steps aside for the card. A Build that
  can't be pressed now looks disabled (before, it only faded under the primary colour). The
  climb errors say what to do.
- **Line tool:** frames every stop when it starts. Once stops are picked, its card says what to
  do next.
- **Line sheet:** buses, riders a day and profit a day as three tiles (`Info.stats`), then the
  stops and one row of actions. It's about half the height it was.
- **Bulldoze** (Build > Bulldoze): tap a road or a stop, then Remove; half a road's price comes
  back. It refuses a road buildings face, a stop a line calls at, and motorway junction parts.
- **Build sheet:** the cards for things not in the game yet are gone (bus station, lorry depot,
  Freight, Landscape). Add them back when they exist. Save and Load in the menu are left to the
  save session.
- **Merged overnight (24–25 Sep):**
  - #35: save and load;
  - #36: CI timing budgets scaled by machine speed, and the phone tests in CI;
  - #37: region hills, place names, Places, and trips between towns;
  - #38: region streaming.

  The merges were checked with tsc, vitest (only the known economy test fails), the lines, loop,
  rail and save phone tests, and a region-map smoke test (it loads in 29 s with no errors). The
  region and streaming sessions are archived.
- **#40 merged** (curved, viaduct and underground stations, and the underground view), and the
  stations session archived.
- **Station tool now works like the bus stop:** tap level track, and the blueprint shows with the
  layouts that suit the line as buttons with prices. Build is in the strip; More options opens the
  full sheet (tracks, style, crossing, canopies, length), and closing it goes back to the card.
  `e2e/rail.e2e.mjs` builds from the card; `e2e/stations.e2e.mjs` builds through More options.
- **#39 merged:** traffic takes gaps quicker, pulls out onto roundabouts under UK rules, and
  steers with a bicycle model. The traffic session is archived. That was the last parallel
  session; none are running now.
- **Still open (as of the night before):**
  - #39: traffic. Gap-taking is done; the roundabout pull-out and steering are to follow on the
    same branch.
  - #36: follow-up commits.
  - Stations session: `work-stations-2`.
- **Parallel sessions** each push a `claude/work-*` branch; merge them here as they land:
  - traffic feel: `work-traffic-2`;
  - save and CI: `work-save`;
  - region streaming: `work-streaming`;
  - stations on curves, bridges and underground: `work-stations-2`;
  - region generator: `work-region`.

## Traffic that feels right (work-traffic-2, 24 Sep 2026, late)

Session https://claude.ai/code/session_018DK8CF7BYZZHj49auA1MyH, production.md §3.
- **Gap to go (done):** measured in the harness (`simulate(..., { gaps: true })`, `gapTrial`,
  `queueTrial`, `ringTrial` in `trafficsim.ts`; `Traffic.gapProbe()` says who stands at a line with
  the way clear). There was no reaction delay as such; the slowness was in following. IDM waited for
  the gap to grow before a queue moved off, and at a crawl it kept a 1.1 s time gap. A flaky "does
  the limit move with the leader" test also made followers brake for a moving car as if it were a
  wall. Order locks held drivers on the ring for someone still coming round, and let a driver keep a
  place it couldn't use. Fixes in `traffic.ts`: `follow()` (anticipation, a shorter time gap at a
  crawl), `movesWith()`, re-admission inside the junction, `ringRoom` counting only those near the
  ring, and no committing while someone uncommitted stands in the way.
- **Roundabout pull-out (done):** `keepsBehind` for traffic already on the ring judges by when it
  gets there: it may ease off to 0.6 s behind, and one standing further round doesn't count. The
  harness counts a driver as gone only once it's through the mouth of the junction; before, one that
  rolled over its line and waited there looked as if it had gone. A driver doesn't commit while
  someone uncommitted stands in its way, unless each is in the other's way (two lorries).
- **Bicycle-model steering (done):** `footprint.steered` keeps each vehicle's axles from frame to
  frame. `bodiesAlong` drags them the same way along each course for the conflict tables.
  `Track.settle` is where the rear starts settling back onto the lane (the end of the junction).
  `fleet.bodyFor` gives each real vehicle its axles. `footprint.test.ts` checks the geometry, and
  that drawn bodies and table bodies agree.
  - **Knock-on changes in `traffic.ts`:** `holdAt` (give-way hold points set back out of
    higher-rank swept paths); `nowMe`/`nowIt` in `conflicts.View` (where the other is right now),
    used when both are engaged; `waitingAt` (don't draw up into the way of someone waiting);
    same-lane followers skipped in `junctionLimits`; `E_PRE = 16` (courses start 16 m up the
    approach, so a long vehicle held short of its line has samples). In `conflicts.ts`,
    `MARGIN = 0.15`: with 0.25 the front overhang's swing made cars at their lines block turning
    traffic.
  - **Still to watch:** a bus's swept path at small junctions is real and wide. Give-way lines set
    back for it (DMRB swept paths) would belong in `jshape.ts`.
- Bench: `src/proto/*.local.test.ts` in this session only; to rebuild it, run `simulate` over the
  scenarios with `{ gaps: true }` on seeds 11–13.

## Earlier: the bus loop is playable (24 Sep 2026, evening)

Session https://claude.ai/code/session_01KCA5Gq42qr3TFSD5KvUoT8. **Read `docs/loop.md`
("Status")** for what was built and what's open.
- **Merged:**
  - PR #17 (traffic), with the conflict resolved;
  - the fix for traffic give-ups with the library's true body lengths (21 give-ups over six
    seeds became 1);
  - PR #25 (terminals and CI).
- **Loop:** M1–M4 are done and live at https://gamex-nu.vercel.app/:
  - bus lines;
  - the economy running the town, with one town panel;
  - money;
  - railway stations and rail lines, with trains kept apart until there's signalling.
- **Tests:** tsc is clean. vitest has 922 passing and 2 failing: the economy's "well-served town
  grows" and the bridges timing test. Phone tests: `e2e/lines.e2e.mjs`, `e2e/loop.e2e.mjs`,
  `e2e/rail.e2e.mjs`.
- **Open decisions for the user:**
  - The economy growth test. A distance-decay fix passes 61 of 62; the last test samples runaway
    office growth mid-way.
  - Closing the old library PRs #1–#8.
  - Whether R3 (`claude/work-rail`) replaces the loop's interim train separation with blocks.
- **Other sessions are merging into this branch too** (PRs #26–#28). Fetch and merge before
  every push.

## Earlier: the second account's wrap-up (24 Sep 2026, ~14:00 UTC)

The account running the coordinating session (https://claude.ai/code/session_019K7UAChLqLhMzXsaSczdtJ)
ran low on credit, so the next session carries on from here. **Read "Focus" below first:
the user's current priority is the core game loop.**

- **Branch:** `claude/cloud-session-history-rvqkm1`, with PR #9 into
  `claude/runescape-transport-puzzle-game-q1uhy8`. Everything that merged is in it.
- **Checks:** tsc is clean. vitest passes 914 tests; two fail. One is new since the economy merge: `src/proto/economy.test.ts` "a well-served town grows and gets denser" (796 is not above 902.4). The economy session was stopped partway through its review fixes, so fix this before wiring the economy into the game. The other failure is
  `src/proto/bridges/perf.review.test.ts`. Its 150 ms budget fails on slower machines (210–330 ms on a
  4-CPU cloud box) and on its own branch too. The fix is to scale timing budgets by a measured machine
  factor, not to loosen them; a session was started for it but never pushed.
- **Play it:**
  - **Vercel** (the user connected it; it rebuilds on every push to this branch): the game is at
    https://gamex-nu.vercel.app/proto, the Real Town Plans page at https://gamex-nu.vercel.app/places, and
    the old 2D game at `/`.
  - **Artifact:** https://claude.ai/artifact/Baau34269e5GgVfKquSesJ (v8). It's owned by the second
    account, so the next account should use Vercel.
- **Merged today:**
  - HUD, camera kit, vehicle moving parts;
  - industries, bridges (types, track, earthworks), people, library vehicles and water in the game;
  - terminals and supply chains;
  - junctions that line up (PR #24);
  - the economy library, reviewed twice (`src/proto/economy*.ts`, `econ*.ts`). It is **not yet wired into the game**;
  - the Real Town Plans page (`places.html`, `src/places`, `docs/places.md`).
- **Every cloud session is archived.** Their branches and PRs keep all their work.
- **Open PRs, and what to do with them:**
  1. **#17 traffic** (lane-drop zip merging, fewer congestion give-ups). It conflicts in
     `src/proto/traffic.ts` with the library-vehicles merge (#18). **Resolve and merge it first**:
     it's core.
  2. **#25 terminals follow-up:** 1 commit (the opencast ironstone pit kept clear of the mine's
     siding, and CI for typecheck). It's unreviewed, so check it and merge it if it's sound.
  3. **#21 ground** (fields, hedgerows, lawn texture; 12 commits). It conflicts with the water and
     bridge-track merges in `main.ts`, `ground/game.ts`, `ground/demo.ts` and `bridges/demo.ts`. It's
     scenery, so merge it when convenient.
  4. **#22 real town (Horley):** parked by the user. The PR comment explains what's needed:
     world water through `GameWater`, and the invented town as the default.
  5. **#1–#8,** the original library PRs: everything in them is already in #9. Close them with a
     note once the user agrees (they asked the Vercel bot to comment on all of them).
- **Part-finished streams: where each stopped, and where to pick up.** Their sessions are
  archived, and anything they hadn't pushed is lost.
  - **Traffic (PR #17, `claude/work-traffic`).**
    - *Landed:* lane-drop zip merging; committed drivers leave room for longer waits; harness
      scenarios (a heavy mini-roundabout, a lane drop queued in both lanes).
    - *Stopped:* partway through its own adversarial review. No review tests were pushed, so the
      fixes are unreviewed. It had also measured the traffic step getting 18% slower
      (1.70 → 2.04 ms) and hadn't found why.
    - *Pick up:*
      1. Resolve the `traffic.ts` conflict against the library-vehicles merge.
      2. Re-run its harness scenarios.
      3. Find the 18% slowdown.
      4. Run an adversarial review (lane drops, roundabouts, give-ups, gridlock) before relying on it.
  - **Economy (merged at 32be666).**
    - *Landed:* two adversarial reviews. The second wrote 23 failing tests
      (`economy.review2.test.ts`), and they now pass.
    - *Stopped:* partway through its fix workflow. Since then the original
      `economy.test.ts` "a well-served town grows and gets denser" fails (796 is not above 902.4).
      One of the last fixes probably regressed it, most likely "Count only homes near a stop as
      homes near a stop" or "Rebuild catchments after a review changes the towns".
    - *Not written:* `docs/economy.md`, the guide to wiring the library into the game.
    - *Pick up:* fix the growth test first, without weakening it. Then write the wiring notes
      as the start of the game loop.
  - **Junctions (merged, PR #24).**
    - *Landed:* its last commits: markings kept on the carriageway, splitter islands only where
      they fit, short stubs end square, splitter islands back at the town's roundabouts.
    - *Stopped:* partway through "Banbury holes audited by arm position; fixing markings and fills".
      Whether its own review ran is unknown.
    - *Pick up:* check the invented town's junctions at 412×915. The user reported joins that
      don't line up; look especially for holes at arm positions.
  - **Ground (PR #21, `claude/work-ground`, 12 commits).**
    - *Landed:* its look review is done and fixed (`src/proto/ground/review.look.test.ts`).
    - *Stopped:* before its performance review finished.
    - *Pick up:* resolve the conflicts (`main.ts`, `ground/game.ts`, `ground/demo.ts`,
      `bridges/demo.ts`), then measure draw calls and frame time on each quality tier at phone
      size. It's scenery, so after the loop.
  - **Timing tests (`claude/work-bench-robust`).** Nothing was pushed; the work is lost.
    - *The brief, to redo:* one helper (e.g. `src/proto/test/speed.ts`) measures the machine's
      speed with a fixed workload (typed-array geometry, Map inserts, allocation), takes the best
      of a few runs, and clamps the result to 0.5–4× a reference. Every timing budget in the tests
      is multiplied by it: the bridges, terrain, water and world benchmarks.
    - A real 2× regression must still fail. Never loosen a budget.
  - **Terminals follow-up (PR #25, 1 commit).** The terminals session woke after finishing and
    pushed this: the opencast ironstone pit kept clear of the mine's siding, plus a GitHub Actions
    CI for typecheck and tests. It's unreviewed. Merge it only if its CI treats the two known test
    failures sensibly; otherwise it's red from the first run.
  - **People and HUD.** Both woke after finishing and started follow-ups that were never pushed:
    - people: wiring stations, trains and people, and route smoothing (backlog item A3);
    - HUD: measuring how much of the screen the HUD covers, and more compact layouts.
    Redo them from the backlog when they come up.
  - **The game-loop design** was stopped before it wrote `docs/loop.md`, so write it fresh from
    the backlog's group A.
- **The game loop plan:** `docs/loop.md` doesn't exist yet (see above). Write it first: one page, milestones that each end playable.
- **Backlog from the finished streams:** the section below, if present, lists every "still to do"
  the archived sessions reported, sorted against the focus.
- **GitHub quirk:** the combined commit-status API returns 403 to the Claude GitHub app, so it
  can't read commit statuses. Use the Vercel bot's PR comment, or `curl` the deployed URL.
- **Estimating time:** use the measured throughput under "Estimating time" below, not
  human-developer estimates. The user asked for this explicitly.

## Earlier: where everything stood (24 Sep 2026, ~10:15 UTC)

The previous session ran on the org account and hit its usage limit mid-flight. Every
background build stopped at once. Nothing was lost: every piece of work, finished or not,
is committed and pushed. This file tells the next session what each piece is and how to
carry on.

Read this first, then `docs/ROADMAP.md` (direction), `docs/ENGINE.md` (architecture) and the
per-library docs in `docs/`.

## Backlog from finished streams (archived 24 Sep)

From the ten merged streams (PRs #10–#16, #18–#20), with duplicates merged. At 13:49 UTC terminals, int-people and hud were still mid-turn: collect their unpushed work (station stops, compact HUD) before archiving.

### A. The first playable loop

- Give lines real routes. Today buses wander and call at every stop on their side, Transport > Lines has no routes, and "New line" is disabled. A line is stops in order plus vehicles, with one livery and operator. (hud, int-vehicles)
- Wire the economy into the game, and feed `CrowdNumbers` from it instead of `TownNumbers`. That covers waiting per stop, hourly footfall and boarded counts. (int-people)
- Money: fill the money slot (`setMoney` is never called) and charge fares. Also charge for roads, bridges and a change of bridge type: costs are shown but never charged. (hud, int-bridges, bridges-track)
- Buy vehicles through the economy: map `VEHICLES` in `defs.ts` onto library offers and charge for purchases (vehicles plan step 8). (int-vehicles, vehicles-moving)
- Railway stations. Build > Stops has the railway station and bus station locked. Trains should stop at platforms and open their platform-side doors (fleet.ts only drives buses' kerb doors). People board and alight through each car's `doorPositions`. (int-people, vehicles-moving, hud)
- Tapping a vehicle should open its info sheet. `tapMap` handles bridges, sites and buildings, but not vehicles. (hud)
- Layers: turn on the "Stop catchments" and "Where people want to go" overlays. (hud)
- Measure on a real Pixel. People `BUDGETS` are guesses, and every perf and look check so far ran under SwiftShader. (int-people, int-industries, terminals)

### B. Live-game bugs and performance, soon

- Road drawing stutters: bridge blueprint checks take 20–160 ms. Cache them and move them into a worker. (int-bridges)
- Roads and bridges ignore the lake. `alignRoute` doesn't use `crossings()` or `navLimits()`, and bridges don't take `pierBans`, the soffit or the flood level (water steps 3–4, bridges step 8). (int-water, int-bridges)
- The merges added frame-time cost:
  - lake views 11–15% slower;
  - industries 4–7% slower;
  - the Parade demo's per-frame JS at 1.3–1.5 times the baseline;
  - passenger-rail near-LOD triangles up 20–70%;
  - draw calls in the busy zoomed-out view up from 430 to 441.

  (int-water, int-industries, int-vehicles, vehicles-moving)
- Switch off middle-LOD vehicle shadows on weak phones through the adaptive-quality tiers. (int-vehicles, vehicles-moving)
- A walker is drawn once per route leg, so routes must stay short. (int-people)
- Signal phases don't control pedestrian crossings. (int-people)
- A 26 px flicker seam and "4 known cosmetic issues" aren't written down anywhere. Get them from the bridges-track transcript before archiving that session. (bridges-track)
- Timing tests fail under CPU load and pass when re-run: the bridges benchmark and one water test. (int-vehicles, int-water, terminals)
- The gesture and HUD Playwright checks only run by hand. Put them in CI. (kit-nav, hud)

### C. Later or parked

- Freight, after the loop:
  - the economy adopts `INDUSTRY_TYPES`;
  - a real `IndustryFeed` replaces `standInFeed`;
  - terminals live-game steps 1–5, including saves, production, the `siteActions` sheet, unlocking Build > Freight and removing the Lorry depot card;
  - cost balancing;
  - placement that respects `minSize`;
  - lorries, vans, boats and planes to buy.

  (terminals, int-industries, hud, int-vehicles)
- Terminal model limits: one terminal per mode, one load/unload rate, fixed input shares, rectangular annexes, no quay or goods-depot models. (terminals)
- Industry sites: rebuild when the era changes, real vehicle anchors, docks on the real water edge, a mesh worker, plot fitting, OSM plots, smoke and night lights. (int-industries)
- Commuting from real staffing and mode choice. (int-people)
- Save and Load town. Bulldoze and undo for built roads. (hud, terminals)
- Needs terrain first:
  - the Landscape tool;
  - pier heights and arches (bridges step 10);
  - levelled sites;
  - rivers and basins;
  - cross-slope on skew crossings;
  - earth cut-face map edges.

  (hud, int-bridges, int-industries, int-water, bridges-track)
- Track detail in the game's railways (the six `TrackBuilder` steps), and the shared grass in place of `earthTexture()`. (bridges-track)
- Bridges: bascule closures, suspension bridges refusing heavy loads, land claims for piers, English-only reason strings, pier spacing. (int-bridges, bridges-track)
- Water: canals, ports, ferries, worker streaming, region seams, hydrology and drawing limits. (int-water)
- Vehicles: night glow and hazard lamps, bogies and steering (`vr.add` gets no curvature), pantographs, lettering, far-LOD impostors, and batched far traffic for big maps. (int-vehicles, vehicles-moving)
- People: streaming ids, avoiding each other, street furniture, seasons, and the animals' look. Cyclists stay parked. (int-people)
- Demos:
  - a shared demo shell;
  - a library bus with working doors in the people demo;
  - the architecture test also catching demos' own ground and vehicle meshes;
  - a flows view and tutorial in the industries demo.

  (kit-nav, int-people, int-industries, vehicles-moving)
- HUD debug probes (`dbg*.mjs`, `anim.mjs`): delete them or turn them into real checks. (hud)
- Stale docs:
  - `reports/vehicles.md`, `reports/water.md`, `reports/bridges.md` and `water.md` §5;
  - `kit.md` (places.html is skipped too);
  - `people.md` on bus doors;
  - this file's stream tables.

  (several)

### Dropped as already done

- Bus doors from the vehicle library. `crowds.ts` `doorsOf()` uses `fleet.kerbDoors()` and `doorPositions` (2651070). (int-people)
- Raised-deck embankments missing from the bridge price. `priceBridges()` prices the raised path that gets built. (bridges-track)
- The industries and people demos' own nav. Both use `NavRig`, and the architecture test enforces it. (int-industries, int-people)
- Connector re-auth: not a code item, so it goes to the coordinator. (vehicles-moving)

When they were archived, the terminals, people and HUD sessions had woken from Vercel's PR comments and started follow-ups that may never have been pushed. Terminals' one commit is PR #25. The bridge-track session's "26 px flicker seam" and "4 cosmetic issues" are known only from its final summary.


## Focus (the user, 24 Sep ~13:20): the core game loop first

The user said we'd lost sight of the goal, and agreed this plan. The goal is the game in
`docs/ROADMAP.md`: build roads and bus and rail lines, good service makes towns grow, and the
growth creates the next problem. Real places come last.

1. **Land the core already in flight:** junctions, traffic, library vehicles in traffic and the economy
   library. Water and ground are nearly done, so merge them, but start nothing new on scenery.
2. **Then one stream only: the game loop** (`docs/loop.md`). You draw a bus route or rail
   line between parts of town and people ride it. It earns fares, and the town grows or shrinks
   with the service, shown on one town panel. The loop is built in the **invented town**, which
   the user chose over Horley for now.
3. **Parked. Noted here, not deleted, and not to be restarted without the user:**
   - **Real Town Plans page:** it works; it's at `claude/work-places-page` once merged. It goes on Vercel when the user connects it (`docs/deploy.md`).
   - **Polishing the plans page's progress bar:** a review was started and then stopped.
   - **Horley as the game's town:** the real-town code merges with the invented town as the default.
   - **Missing houses in real places:** OpenStreetMap hasn't mapped many of Horley's houses, for example around Kingsley Road, Wellington Way, Parkhurst Road and Southlands Avenue. There are two fixes: Ordnance Survey OpenMap Local building outlines (Open Government Licence, so credit OS), or procedural houses along unmapped residential streets.
   - **Cyclists.**

## Second session (from 24 Sep, ~10:20 UTC): status

A session on the user's other account picked this up:
https://claude.ai/code/session_019K7UAChLqLhMzXsaSczdtJ.

- **Integration branch:** `claude/cloud-session-history-rvqkm1`, with PR #9 into the main branch.
- **Merged into it so far:**
  - the handover (b8de12e);
  - the vitest fix (known bug 3);
  - all eight finished libraries (PRs #1–#8).
- **Checks at cccd45c:** tsc is clean and 429 tests pass. Under heavy CPU load, `terrain/bench.test.ts` and one water test can time out; both pass on a re-run.
- **The HUD redesign (approved by the user):** `docs/hud.md` and `docs/hud/mockup.html`.
- **This session:** coordinates. It merges each cloud session's PR into the integration
  branch once that session's own review is done, checks the result at phone size, and
  republishes the game links.
- **Cloud sessions:** each works on its own branch, pushes after every commit, and opens a PR into the integration branch.

  | Stream | Branch | Session |
  |---|---|---|
  | New HUD in the game | `claude/work-hud` | session_01LHmZZcerrUyGq1TSiFcnKZ |
  | One camera kit in the game and every demo (PR #10) | `claude/work-kit-nav` | session_01DCEbMvXXTVSr8K2R3gAvY8 |
  | Bridge earthworks and track detail (PR #11) | `claude/work-bridges-track` | session_017X98YbhdPPReFEcpyd4diZ |
  | Ground with character, shared by every demo (merged early at 4fddbf8) | `claude/work-ground` | session_01Yc7nmze9XbVcixsU4xaTBj |
  | Vehicle doors and moving parts | `claude/work-vehicles-moving` | session_012fqK9zWp7BH6mQXJMQ8S1Z |
  | Library vehicles in the game | `claude/work-int-vehicles` | session_01RXnbKFLJQMD26MEQxZ1fy7 |
  | People in the game | `claude/work-int-people` | session_015U21FuobTAx2YnV2ch42Z1 |
  | Industries in the game | `claude/work-int-industries` | session_01CMd8cDqGDoUBeqWsmqkX6W |
  | Bridge types in the game | `claude/work-int-bridges` | session_01PGN5VG2KUzJDurcUfdRkxB |
  | Water in the game | `claude/work-int-water` | session_01S28Gtoj2KAb54E513p46YQ |
  | Traffic lane-drop and give-up fixes | `claude/work-traffic` | session_01K6gzHHoJ3nPfxbCNeuPWtv |
  | Economy review, and a wiring plan in docs/economy.md | `claude/work-economy` | session_01PTFxCsS6mT4JTYZEgkTgrZ |
  | Freight terminals and supply chains | `claude/work-terminals` | session_01CE6XJ8Bv6zXW5sTZM9iCLw |
  | A real town (Horley) instead of the invented one, from the OSM importer | `claude/work-real-town` | session_019665XqqPm9U1NRR99GLvBm |
  | Junctions and joins that line up, on the invented town and on real OSM networks | `claude/work-junctions` | session_0185VszrHr5qQCJHYZH7rSeq |
  | Real Town Plans as a standalone web page for Vercel | `claude/work-places-page` | session_01GtT32NAQuqxrCU1YcEtfSw |

- **Network:** full access was enabled at ~12:30. The Overpass servers were "too busy" at first, so the Horley data is being fetched in tiles with polite retries.
- **Next wave (not started):**
  - wire the economy and terminals into the live game, from docs/economy.md and docs/terminals.md;
  - then cyclists;
  - then make the timing benchmarks robust under CPU load.
- **Dropped:** the UI fix stream for the old dock; the new HUD supersedes it.
- **New preview links (this account):**

  | What | Link |
  |---|---|
  | Game | https://claude.ai/artifact/Baau34269e5GgVfKquSesJ |
  | Water | https://claude.ai/artifact/CuTMcGE9xTebEACgv2Hkyf |
  | Vehicles | https://claude.ai/artifact/Vy1PUbSTHLMuScoL66fcLv |
  | People | https://claude.ai/artifact/9FaghH7bkVoAN7bfWR9MqJ |
  | Bridges | https://claude.ai/artifact/L72vN7hP41VjDp29fJnBLd |
  | Industries | https://claude.ai/artifact/6JyuqJ7Tdb5m2p4hYyhJzR |
  | HUD mock-up | https://claude.ai/artifact/WGbq3v6p161GpesZehQ1gW |
  | Early look (HUD and ground, before review) | https://claude.ai/artifact/7YPVNSXYBMSRNRTG41zGJY |
  | Real Town Plans tool: postcode, area, plans | https://claude.ai/artifact/7xoS53FzWa2WdyR3NBYPTH |

### The Real Town Plans tool: how its requests are served

A published page can't reach outside servers. So the page (artifact capability `artifact`,
plus `assets` for images) saves a request by republishing itself: `state.request` =
`{kind: 'lookup', postcode}` or `{kind: 'build', bbox, size_km, name}`. That wakes the session
that published it.

The tooling lives in this session's scratchpad under `places/`:

- **`places.py lookup`** uses postcodes.io and stitches a 6×6 grid of OSM z15 tiles.
- **`places.py fetch`** downloads from Overpass in tiles of about 1.3 km, with polite retries.
- **`places.py trim`** keeps only the tags the importer reads.
- **`places.py render`** runs the game's importer and turns its SVG drawings into JPEGs.
- **`page.py`** reads the state out of a saved copy of the page and writes the next version.

To serve a request:

1. Read the artifact.
2. Run the step it asks for.
3. Upload the images as assets.
4. Set `state.lookup`, or append to `state.areas`.
5. Clear `state.request`, and never keep the postcode.
6. Republish.

A later session would need to rebuild this tooling in its own scratchpad; the page itself
carries on working.

## The game and previews (published artifacts, owned by the org account)

These links belong to the org account. A session on another account can't update them, so
it should publish new ones and give the user the new links.

| What | Link | Built from |
|---|---|---|
| Main game | https://claude.ai/artifact/XLSLMVU25vj6fEXSXmSchs | main branch 63b2f9d |
| UI overhaul preview ("Untitled" brand) | https://claude.ai/artifact/N4yq9r4NL34SF1aqVHshR1 | wip-ui-overhaul (fd0d1a0) |
| Banbury OSM import | https://claude.ai/artifact/1Q1cjd3XT7ZkQyEo4j5mTT | claude/osm-import |
| Industry sites | https://claude.ai/artifact/Tc22cTc3HcrECuN4E27mRV | claude/industries-3d |
| Bridge types | https://claude.ai/artifact/2B5Z9WQVaA6DbkhFmNN2oG | claude/bridges-lib 7e137aa |
| Supply chains | https://claude.ai/artifact/8CzzfewDau2WBVdp11gmnV | wip-chains |
| Vehicle library | https://claude.ai/artifact/Mi4qWRmVSG87RjuswQPqdf | claude/vehicles-lib cd88773 |
| People and animals | https://claude.ai/artifact/4KaYJ1RcoSkTbQF7ibFcwm | claude/people-lib dd257ad |
| Water system | https://claude.ai/artifact/BNDn9gnVFyf8p7qJ8Tt1AM | claude/water-system 2f1bf9b |

## Branches

The main development branch is `claude/runescape-transport-puzzle-game-q1uhy8` (HEAD 63b2f9d).
It has everything up to the roads/traffic rewrite:
- road joins as continuous curves;
- dual-to-single tapers with ghost islands and lane-ends arrows;
- turning heads and off-map runs;
- collision-free traffic, with a 10-scenario harness asserting zero overlaps.

### Finished libraries from cloud sessions (not merged into main yet)

Each has its own PR or docs on the branch:

| Branch | What | State |
|---|---|---|
| `claude/terrain-lib` | height sources, vertical alignment, pads, tile meshing with LOD | PR #2, done |
| `claude/world-tiles` | tile/streaming scaffold | PR #1, done |
| `claude/osm-import` | OpenStreetMap importer prototype (Banbury) | PR #3, done |
| `claude/bridges-lib` | bridge catalogue, chooser, geometry, demo; plus my fixes (grade.ts alignment(), no bumpy decks, clearances, earth cut faces) | PR #5, done |
| `claude/industries-3d` | 3D industry models, production visuals, catchments, demo | done |
| `claude/water-system` | sea/lakes/rivers from terrain, depth-shaded water, claims, canal/quay/ship hooks | built on terrain-lib; the session may still have been polishing |
| `claude/vehicles-lib` | ~966 procedural vehicles, invented brands, eras, LOD, instanced renderer, name-safety check | the session may still have been polishing |
| `claude/people-lib` | GPU-posed instanced people and animals placed from flows, demo scenes | the session may still have been polishing |

Cloud sessions on the org account (water, vehicles, people) probably stopped too. Their last
pushes are on the branches above. Fetch before building on them.

### Local streams, pushed as `claude/wip-*`

| Branch | What | State and next step |
|---|---|---|
| `claude/wip-economy-model` | Transport Fever-style economy: towns grow/shrink from how well they're fed with goods, materials and passengers; flows-based lines; plain-English reasons. Not wired into the game. | Built. The reviewer found **15 problems**, each with a failing test in `src/proto/economy.review.test.ts` on `claude/wip-economy-review`. |
| `claude/wip-economy-model-2` | the fixer's unfinished work on those 15 | **Continue here.** Make every test in economy.review.test.ts pass. |
| `claude/wip-ui-overhaul` | "Untitled" brand HUD, Tabler icons, no emoji | Built. The reviewer found 2 layout bugs invisible at 412x915 (see `docs/handover/results/wf_7efd5802-eae.md`, "review:ui"). |
| `claude/wip-ui-overhaul-2` | the fixer's unfinished work on those bugs | **Continue here.** |
| `claude/wip-chains` | supply-chain logic (11 chains, audits, catalogue fixes) | Done. Based on industries-3d. |
| `claude/wip-terminals` | purchasable road/rail/water terminals that cap and unlock industry growth; Terminals panel in industries-demo | Built. Based on chains. |
| `claude/wip-terminals-review` | reviewer: 20 failing tests in `src/proto/terminals/terminals.review.test.ts` (throughput vs dwell mismatch, unreachable terminals raise the cap, cut-backs lose upgrades, and more) | |
| `claude/wip-terminals-2` | the fixer never started (same commit as review) | **Continue here:** fix all 20. |
| `claude/wip-bridges-track` | textured grass on rebuilt embankments, a fix for rail/grass z-fighting on the steel bridge, sleepers/rails/ballast detail (new `bridges/track.ts`, `bridges/earthworks.ts`) | **Unfinished.** Brief in `docs/handover/workflows/bridges-earthworks-and-track-*.js`. |
| `claude/wip-ground` | characterful grass, covers, fields, hedges, lawns, slopes (`src/proto/ground/`) | **Barely started.** Brief in `ground-character-*.js`. |
| `claude/wip-kit-nav` | ONE shared camera/navigation module (`src/proto/kit/`) | **Unfinished**; main.ts not adopted yet. Brief in `shared-nav-and-moving-parts-*.js`. |
| `claude/wip-vehicles-moving` | detailed animated doors (especially trains), wheels, bogies, pantographs | **Barely started.** Same brief file. |

`docs/handover/results/` holds the full reports of every agent that finished: numbers,
known issues and screenshot descriptions. The screenshots themselves were in a scratch
directory and are gone.

## Known bugs to fix first

1. **Traffic lane-drop freeze.** Where a lane ends, a car in the adjacent lane can stop dead
   alongside the car merging in. It's a hold-up, not a collision. The failing test is
   `docs/handover/pending-tests/traffic.refute.test.ts`. Move it to `src/proto/` and make
   `place()` use public API or `// @ts-expect-error` (it pokes private laneOff/laneIdx).
   Fix `traffic.ts` until it passes, keeping `traffic.test.ts` at zero overlaps.
2. Under heavy congestion 3–10% of trips give up. The worst spot is the estate
   mini-roundabout at (0,-290).
3. `npx vitest run` from the repo root also picks up tests in `.claude/worktrees/`. Use
   `npx vitest run --dir src`, or add `exclude: ['.claude/**']` to the vitest config.

## What the user asked for that isn't done yet (in order)

1. **Finish the stopped streams** above (economy fixes, UI fixes, terminals fixes, bridges
   track and earthworks, ground, nav kit, vehicle moving parts). Each workflow script in
   `docs/handover/workflows/` has the full brief and acceptance criteria. Its prompts use a
   scratchpad path from the old session, so replace it with the new session's scratchpad.
   Run them as workflows only if the user opts in to multi-agent orchestration; otherwise
   do the work directly or with single agents.
2. **Consolidation: one shared kit, used everywhere.** The user said: "make sure that each
   preview is using the stuff generated in the other previews and not making its own version...
   Everything also seems to have its own version of buggy nav... this really needs to be consistent."
   - Merge everything onto the main branch. Suggested order:
     1. ui-overhaul-2
     2. economy-model-2
     3. terrain-lib, then water-system
     4. world-tiles
     5. bridges-lib + bridges-track
     6. industries-3d, then chains, then terminals-2
     7. vehicles-lib + vehicles-moving
     8. people-lib
     9. osm-import
     10. ground
     11. kit-nav
   - Every demo (water, vehicles, people, bridges, industries) and the game must use the kit's
     camera (`kit/camera.ts`) and one shared branded demo shell (HUD, scene picker, perf readout).
     They must also share the ground material, the vehicle library (the people demo's bus must be
     a library bus, with its doors driven at stops), the people library, bridges, water and trees.
   - Add an architecture test that fails if a demo defines its own pointer/camera code,
     ground plane or vehicle meshes.
   - Keep `docs/kit.md` as the registry of shared modules.
   - The industries demo nav is reversed compared with the game. The kit fixes it. Also give
     that demo a flows view and a guided HUD/tutorial.
3. **Cyclists.**
   - Cyclists become road users in `traffic.ts`, in cycle lanes or on the carriageway.
   - Cars follow them and only overtake with Highway Code clearance: at least 1.5 m at up to
     30 mph, more above.
   - Junction rules apply to them.
   - They stay off footways except on shared paths, where they yield to and steer round
     pedestrians. In the people preview today, cyclists ride straight through pedestrians.
   - The rider comes from the people library and the bike from the vehicle library.
   - Extend the footprint overlap test to cyclists, pedestrians and vehicles.
4. **Wire the economy into the live game:** stations, lines, growth/shrink, a town panel in the
   new UI. Then industry staffing and commuting with mode choice (buses and trains near
   stops mean people don't need cars).
5. Later, per ROADMAP.md:
   - one-way roads and interchanges;
   - terrain in the game, with map edges using the bridges demo's earth cut-face look;
   - tiles, real elevation and OSM;
   - onboarding;
   - address → your real place, which comes very late (UK GDPR: privacy by design);
   - massive real-geography maps.

## Standing rules from the user

- Plays on an Android Pixel in portrait: test at 412x915 with DPR 2 and touch. Performance
  matters ("respect all the resource constraints so it's not laggy"). They are very sensitive
  to flicker and z-fighting.
- The name is **"Untitled"**. The brand is inspired by a green Rock Face deodorant bottle
  (forest #1f5e3f, darker #0f3322, lime #5cb83a, gold #b8964e; League Spartan + Archivo;
  Tabler icons). Never copy Rock Face's logo or wordmark. No emoji in the UI.
- Vehicles: invented brands with loose real-world links (GTA-style), never near-homophones of
  real trademarks (vehicles-lib has a name-safety check).
- British design standards for roads (DMRB/TSRGD) and UK traffic rules.
- OSM data is ODbL: attribute it.
- The user likes to test things as they land: publish previews and give links.
- Commit trailers used so far:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and a `Claude-Session:` line
  (use the new session's link). No model IDs in code, commits or PRs.

## Estimating time (the user asked for this)

Give wall-clock estimates from how fast AI sessions have actually worked on this project, never
from how long a human developer would take. These timings were measured on 24 Sep:

| Work | Measured | Examples |
|---|---|---|
| A focused change the coordinator makes directly | 5–15 min | grass matching the ground; the lawn colour |
| A cloud session, from start to its first working PR | 15–30 min | integrations 15–28 min; traffic 21; ground in the game 28 |
| A cloud session, including its adversarial review and fixes | 45–90 min | terminals 22 min; the camera kit and bridge track about 60–90; the HUD about 85 |
| Merging a finished stream, checking it and republishing the link | about 5 min | |

- **Parallel streams:** the wall-clock is the slowest stream plus merging, not the sum.
- **Name the waits separately.** Examples: busy map servers, the user's own steps (Vercel, settings) and usage limits. Say which part of an estimate is ours and which is a wait.

## Tools

`docs/handover/tools/` has the scripts the previous session used:
- `preview.sh <ref|MAIN> <page.html> <name>`: builds one page from any branch with relative
  paths, ready to publish.
- `smoke.mjs <url> <out.png>`: phone-size screenshot with console errors.
- `zfight.mjs`: finds coplanar up-facing triangles (the roof-flicker detector).
- `bridgeshot2.mjs`, `water.mjs`: per-demo screenshots.
- `watch3.sh`: polls workflow journals and branches.

Paths inside them point at the old scratchpad; change `SP=` first. Playwright needs
chromium at `/opt/pw-browsers/...` with SwiftShader flags (see smoke.mjs).
