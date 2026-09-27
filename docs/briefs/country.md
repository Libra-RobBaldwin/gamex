# Brief: country (the countryside session, second and third runs)

Sessions https://claude.ai/code/session_016uD19qC4yiFZR8AhPrtiib (ran out of context 27 Sep, about 05:00 UTC) and, from
27 Sep 06:00, https://claude.ai/code/session_012DhwfJ2AbfvDW6ViDNqx4d. Branch `claude/work-country-2`, PR #62 (merged) into
`claude/cloud-session-history-rvqkm1`, then `claude/work-country-pools` (#68, merged), `claude/work-country-farms` (#70,
merged) and `claude/work-country-edge` (#74, open). Written 26 Sep 2026, 21:00 UTC, updated 27 Sep 05:35 as a
handover: this session's context is nearly spent and a fresh countryside session (country-3) takes over
`claude/work-country-edge` and #74 from here. Coordinator: https://claude.ai/code/session_01NoR4Fo844FXMiY63oVBeCU
(docs/briefs/PLAN.md, decision 1).

## Country-3 (session_012DhwfJ2AbfvDW6ViDNqx4d), 27 Sep from 06:00 UTC

**#74's repaint budget, third round.** af73094 (the handover's head) failed the runner too: 3.54 ms against 2.84
(factor 1.42), down from 4.21. Pushed now: the handover's fixes kept, plus the coordinator's fix 1 and the rest of
fix 3, and their consequences:
- `Layout.setInput` keeps the coarse grid and the band's spots across changes and marks only the plots and town
  points added, telling them by identity; a change where a few went (a building site becoming a garden, its
  town point with it) makes the marks afresh and repaints the disc round each that went; the parks' spots live
  with the fixed marks; the coarse grid's block keys are small integers like the spots'; `setInput` returns the
  band boxes (`band`) and whether the marks only grew (`added`), so `Ground.change` no longer works the reach
  out itself;
- `Ground.change` replans a band's hedges only when a hedge piece or gateway stands within it (`hedgeIn`), plans
  the merged boxes once, and keeps the hedges' `Occupancy` across additive changes (`extend`);
- `GameGround.input()` keeps a lot's plot object and a site's town point from one input to the next while the
  parcel stays put, so the game's own repaint after a building takes the additive path (before, every input
  remade every plot object, and the layout could only tell "everything changed").
Measured on this box, the budget test's workload alone (eight paints then fifteen repaints, fresh process),
median of the fifteen, three runs each: trunk 1.05 / 1.07 / 1.01 ms; 77232ef 2.08 / 2.06 / 2.07; this head
0.73 / 0.80 / 0.85. (This box's machine factor swings 1.8–3.3 between runs, and its full paint runs 35–60 ms
against a budget of 42–97, so the full-paint assertion itself is flaky here; the runner's factor is 1.4 and
its full paint passes.) Stages per change before the last two items: `setInput` 0.11 ms, hedge planning
0.25, planting 0.06, paint 0.73. Checks: `tsc` clean; ground and game folders 29 files, 192 tests; the whole
suite on the merged head (below, "Checks before the push").

**Seasons and crop variety (item 3), branch `claude/work-country-seasons`, PR #80 into the integration branch.**
Done and checked on 412×915 screenshots (DPR 2, SwiftShader), `docs/reports/country/season-*.jpg`:

12. **The farming year.** `ground/covers.ts` `CROP_YEAR` gives each crop keyframes through the year (colours and
    rows), `cropLookAt` blends them (a day moves a colour under 2%, tested), and `material.ts` `applySeason` sets a
    ground's crop uniforms for a date; a crop a style colours (desert, arctic) keeps its colours. One page-wide
    season (`setGroundSeason`, `onGroundSeason`) reaches the live ground (`GameGround`) and the world's tiles
    (`worldmap/view.ts`, one hunk: it re-applies its style with the season, far tiles toning the crops to the grass
    as before). `main.ts` (one line) sets it from the clock each frame: a game day is a month, so a year is twelve
    game days (72 minutes of play); the game starts in mid-July, on the looks CROPS already had (rape apart:
    it flowers in April and May now, and is pods in July). Nothing is repainted and the tiles need no rebuild.
    What the keys follow is in `docs/ground.md` "The farming year". Screenshots at 700 m west of the start town:
    April (green wheat, rape in flower), May, July (gold), August (stubble), September (ploughed); at 2 km: January,
    April, August; and a field of each crop kind at 300 m in July and April (`crop-<crop>-<month>-300.jpg`, the
    nearest field of each crop to the start town, 700 m or more out). No tile edge shows, the woods and trees stay
    their summer green (not mine: baked colours). The ground demo has a Month button. The paint budgets, measured
    as for #74 (the budget test's workload alone, three runs): full paint 34.6 / 34.4 / 42.4 ms, repaint after one
    building 0.78 / 0.77 / 0.84 ms, the same as #74's head (nothing here touches the painter).
13. **Crop variety by the lie of the land** (`region/fields.ts`, `COUNTRYSIDE.upland`): a farm block high among
    the map's land or steep grows less wheat and rape, more barley and grass leys. Same rng draws, so every other
    field is unchanged. Over the middle 24 km of seed 7's map: arable fields in the lowest third of the land grow
    wheat or rape 40% of the time, the highest quarter 14%; barley or a ley 37% against 58% (a test).

## Handover for country-3 (27 Sep 05:35 UTC)

**What is unmerged: PR #74 only** (`claude/work-country-edge` into the integration branch, head af73094, pushed
05:20 after merging the trunk at bbb5d84, which has #71, #72, #73 and the money tuning). It carries items 9 and
10 below: the dresser's barns (one hunk in the play session's `game/dress.ts`) and the town's ragged edge (the
`TOWN_BAND` rule in `ground/*`). At 05:22 its `check` and `phone` jobs were running on af73094; the red Vercel
status on every head today is the free plan's deployment limit ("more than 100 per day"), not the PR's, and
was commented on once. **Do not widen the repaint budget**; the coordinator merges on green.

**The repaint budget, its history and the measurements.** `ground.test.ts` "a repaint after one building
under 2 ms" (`budget(2)` scales with the machine factor: 2.76–2.78 ms on the runner, 4–7.5 ms on my box)
takes the median of 15 repaints, each a garden plot 14×28 m at z 330, x from -240 step 30, at the fields'
edge (the town's roads end at z 320, a lane runs at z 380–440), after eight full paints in a fresh process:
so the repaints run cold, and each pays the band.

| head | on the runner | cold median here (3 runs, suite alongside) | warm |
|---|---|---|---|
| integration head (trunk) | passes | 0.7 ms | 0.33 ms |
| 7944625, band on the 20 m coarse cells, reach 52 m | 4.08 ms, fail | | |
| 77232ef, band exact per texel, reach 21 m round the plot box | 4.21 ms, fail | 2.5 ms | 1.1 ms |
| af73094 (c8c4a73), the fixes below | not known yet | 1.1 ms | 0.6 ms |

What c8c4a73 changed, and why (stage timings from a temporary tick inside `Ground.change` and
`CoverMap.times`, against the trunk in a worktree): (a) `Layout.townAt` was asked texel by texel through a Map
whose 32 m grid keys were doubles past the small-integer range, so every lookup hashed a heap number and the
paint's `parcels` step was five times the trunk's: now the keys are small integers (`cell()` in layout.ts) and
a paint rasterises the band once over its window from `Layout.spotsIn(box)` into a fifth byte layer
(`townBand`), read as one byte per texel; (b) the hedges were planned twice over overlapping boxes (the plot's
8 m margin and its reach), each line walked whole both times: now once, over the plot's margin united with
the band box; (c) the repaint box was the plot box padded 21 m each way (56×70 m): now the band circle round
the plot's middle (42×42 m), and only when a field within reach is `mixed`; the full pad only when the box
holds no spot (a plot has gone); (d) a gateway is repainted only when it came or went.

**The coordinator's comment of 05:17 on #74 lists three fixes; af73094 has the second and most of the third,
not the first.** Their timings of 77232ef: `layout.setInput` 0.62 ms, hedge replanning 0.62, `cover.paint`
0.91, per change. Fix 1, not done: `setInput` rebuilds the `Coarse` marks and the `spots` map from every
plot, town point and park on every change (my measure of setInput here after c8c4a73: 0.12–0.2 ms a change,
the trunk's 0.09, so it is second-order on this box, but the coordinator's box read it at 0.62 and the runner
is worse than either): keep `spots` and the coarse marks across calls when `near` is given, add the spots of
the plots in `near`, rebuild only when a plot went (fewer plots than before, or a bulldoze box). Fix 3's
second half, not done: skip the hedge replanning when no group has a piece within the band box (`groups`
holds every piece). If af73094 still fails on the runner, do those two, then the remaining gap is the paint
window, 1.6 times the trunk's (42×42 m plus 4 m and the 11-texel `MARGIN` each side, against 14×28 plus the
same): the `parcels`, `shapes`, `distances` and `write` steps all scale with it. A last resort that keeps
the look: `TOWN_BAND` 15 m (the window falls to 1.3 times). Post the measured medians on the PR, three runs
of the budget test alone, not an estimate from the machine factor: the runner's repaint is about 1.7 times
what the factor predicts from this box, and twice what the coordinator's box gives at the runner's own
factor, so cold, allocation-heavy code (Map churn, JIT-cold paths) costs more there than the factor's hot
loops do.

How to time it: copy the budget test's loop into a scratch test under `src/proto/ground/` (vitest only
collects tests under `src/`), print with `process.stderr.write` (vitest swallows `console.log` here), and
run `npx vitest run src/proto/ground/<name>.test.ts`; put a `tick(stage)` inside `Ground.change` on a
throwaway copy of `index.ts` and read `g.cover.times` after each change; time the trunk the same way in a
worktree with a `node_modules` symlink. Delete the scratch test before committing.

**What I would do next for seasons and crop variety (item 3 of the coordinator's list; not started).**
Crops today: `region/fields.ts` gives each field a `crop` (`CROP` in `ground/covers.ts`: grass, ley, wheat,
barley, plough, rape, stubble, stripes) and a row direction `dir`; `Layout.about` copies them into
`ParcelInfo`; `CoverMap.paint` writes crop and dir per texel (3 bits and 5 bits of the G channel) and the
ground shader draws each crop's look from `CROPS`. Variety: the mix is set where fields.ts picks the crop
(one rng draw per field): weight it by the farm block (a block leans to one rotation, so neighbouring fields
share a crop more often, as one farm's do) and by relief (rough grazing and ley high up, rape and wheat on the
low ground), and keep the ratio of grass to arable the tests already check. Seasons: the cheap way is a
uniform in the ground material (`ground/shader.ts`, `groundUniforms`) that the game's calendar (`game/era.ts`
has the date) drives: each crop's look in `CROPS` gets a spring and a late-summer colour and the shader mixes
by season, with plough and stubble swapping in over winter by crop id, so nothing is repainted and the tiles
(`worldmap/tilegen.ts` paints the same cover map) agree with the live ground for free. A repaint-based
season (changing `crop` per field) would cost a whole-map paint each change and would have to reach the
tiles too; avoid it. Check at 700 m and 2 km on 412×915 that a field's colour does not step at a tile edge.

**What the new session must know about the files.**
- `ground/layout.ts`: `Layout` lays fields out lazily (`ensure(box)`) from a `FieldSource` (the map's own
  `Countryside` in the game, seed-only blocks otherwise). `Coarse` is a 20 m flag grid (TOWN, INDUS, WET)
  marked 30 m round plots and town points; `about(id)` samples a field (about 60 points) against it and
  says town only when more than half lie in the marks, `mixed` when any do. `spots` is a 32 m grid of plot
  middles (radius `TOWN_BAND` 20), town points (20) and parks (14) for `townAt` and `spotsIn`. `setInput`
  keeps far fields' `info` when `near` is given, drops it within 52 m of each box, and returns the boxes of
  fields whose kind or crop changed. `GameGround` (`ground/game.ts`) passes the plots as garden, yard or
  track, and `town` = only the next four building sites, not the whole queue (that was the plain of mown
  ground round the town).
- `ground/paint.ts`: `CoverMap.paint(layout, rect, spots)` paints a texel rectangle plus `MARGIN` (11
  texels) each side so that every texel depends only on its neighbourhood; steps parcels, shapes,
  distances, write, timed in `times`. Scratch layers are pooled and dropped after a paint over `POOL_KEEP`
  texels (#68). `TOWN_REACH` = `TOWN_BAND` + 1 is how far a repaint after a plot must reach.
- `ground/index.ts`: `Ground.change(input, boxes)` is the incremental path (read its comments); `plantAll`
  rebuilds every hedge's geometry whenever any group changed (the trunk's design, 0.07 ms a change here);
  `same()` compares groups by `Object.entries`. `ground/hedgerows.ts` `planHedges(box)` walks every
  hedged line touching the box whole, one 8 m step at a time, with the keep callbacks (`townAt`, the kinds
  either side, `Occupancy.free`).
- `region/fields.ts`: `Countryside` (Voronoi farm blocks of 800 m, cut into fields; `blocksNear`,
  `farmsNear`); the per-piece lane following in `cutBlock` (`COUNTRYSIDE.follow`, item 2). `region/woods.ts`
  the woods, `region/lanes.ts` `laneRoute`. `region/fields.test.ts` is #52's version, thresholds unchanged.
  `worldmap/country.ts` `countryFor(plan)`, `countryInputOf`, `farmsIn`. `game/country.ts` `LiveFarms` and
  `farmGround` (#70; three small hunks in `main.ts`, listed there).
- Checks before a push, every time: `npx tsc --noEmit`; `npx vitest run --no-file-parallelism` (about 12 min
  here; bridges and perf.review timings flake under 1%); the dev server (`npx vite --port 5173 --strictPort
  --host 127.0.0.1`) and `node e2e/{lines,loop,rail,save,stations}.e2e.mjs "http://127.0.0.1:5173/proto.html?map=region&seed=42" shots`,
  `BASE=http://127.0.0.1:5173 node e2e/menu.e2e.mjs shots`, and `node e2e/firstview.e2e.mjs "<url>" 2 shots`
  (its third argument is the number of starts: given "shots" there it runs nothing and exits 0). The e2es
  write `shots/` in the repo: delete it, never commit it. `pkill -f "vite --port 5173"` kills the shell that
  runs it; use `pgrep -f "vite --port 517[3]"` first. Merge the integration branch before every push.

## The state, honestly

**Done, live on the branch and checked on 412×915 screenshots (DPR 2, SwiftShader):**

1. **PR #52 is back on today's head**, commit by commit: the plain re-apply of a19e89f (the one field and
   woods generator, high ground ranked among the map's land, the canopy's edges on the woods' outlines,
   the setup's woods option), with the conflict in `region/fields.test.ts` resolved to #52's version. That
   version lays the fields out from `planWorld`, the game's own plan, so it needs neither `region/terrain.ts`
   (#57 deleted it and put a stand-in height function in the test; the stand-in is not needed) nor
   `region/generate.ts` (being deleted).
2. **"Lines each block up with the road beside it" passes genuinely, the test unchanged.** Why it failed:
   the map's B roads now wind over the land (world50's router on #57's relief): a lane turns 16° across a
   farm block half the time, 50° one time in ten (measured over seed 7's roads). #52 gave each block one
   direction, the lane's heading at the block's middle, so half the fields beside a lane ran more than 8°
   off it. Now, as a block is cut, a piece within 150 m of a lane turns to the lane once the lane has bent
   more than 11° from the grain the piece was cut in (`COUNTRYSIDE.follow`), so the fields along a winding
   lane fan round its bends. A turned field's corners against its parent's cut are off by the bend, and a
   block's boundary corners were never square (half of all corners: the Voronoi edges meet the fields at any
   angle), so farm blocks grow from 650 m to 800 m (about 64 ha, an English farm), which halves the boundary
   corners per field. Field sizes are unchanged. On 6 km squares of seeds 7, 42 and 3: fields beside a lane
   within 8.6° of it, 52 / 56 / 45% before, 90 / 92 / 89% after; corners within 6.9° of square, 62 / 62 / 66%
   before, 66 / 67 / 63% after. The alternatives tried and dropped: the lane's mean course through the block
   (no better: the bends are too big), fanning every piece (aligned 97%, square 52%), and cuts tilted halfway
   between a turned piece and its neighbour (worse still). Ten of ten fields tests pass.
3. **The first view is not blank.** `e2e/firstview.e2e.mjs` on `?map=region&seed=42`, six cold starts at
   DPR 2: worst 0% blank on every shot through the first 20 s, each start settles on the town, no page errors,
   scenery tiles asked for once. So #58's fix holds with #52 applied.
4. **The two things #52 fixed are fixed again**, on 412×915 screenshots before (integration head 7f9b21e)
   and after, in `docs/reports/country/`: `before-town-far.jpg` / `after-town-far.jpg` (2.6 km over the start
   town: much less rough grazing and wood round it, and the fields beside the winding lane follow it);
   `before-country-far.jpg` / `after-country-far.jpg` (3 km over the country: the woods' edges were grid
   steps, now they run along the fields' outlines). `firstview-settled.jpg` is the settled first view.
5. **Draw calls and triangles**, same views, before → after: start view 295 / 601k → 298 / 648k; 900 m over
   the town 384 / 737k → 372 / 757k; 2.6 km 399 / 528k → 386 / 581k; 5 km 431 / 568k → 418 / 623k; 3 km over
   the country 48 / 226k → 37 / 198k; 500 m 36 / 273k → 35 / 232k. Load to the first frame under SwiftShader:
   about 10–14 s (the first-view runs), as before.
6. **world50's (e) finding, the CoverMap scratch pools: done** (branch `claude/work-country-pools`, its own
   small PR). `ground/paint.ts` drops its scratch layers after a paint whose window is over 2^20 texels (the
   live area's first whole-area paint); the small repaints after it size them again. On the region 15 s
   after loading: the pools were 110 MB, now 22 MB; the JS heap 427 MB, now 341 MB. A test in
   `ground.test.ts` covers it.
7. **Farmsteads per km², judged and put back** (same branch). With 800 m blocks the farms fell from about
   0.95 to 0.67 a km² (seed 42's middle 100 km²). `COUNTRYSIDE.farms` now leaves fewer blocks without a
   farm (`none` 0.35 → 0.15) and gives more of the rest two (`two` 0.45 → 0.6): 0.85 to 0.96 a km² on seeds
   42 and 7, about what the 650 m blocks gave. Over 336 km² of seed 42 outside the live area, 227 farms
   became 309. Screenshots at 2 km over the 2 km square at (1000, 7000), where 5 farms became 10:
   `docs/reports/country/before-farms-2km.jpg`, `after-farms-2km.jpg` (three in view, then four; farm
   buildings are small from 2 km). Farmsteads are tile scenery, and no scenery is made inside the 8 km
   live play area (`tilegen.ts` `inLive`), so the live area has no farmsteads at all; see "Not done".
8. **Farmsteads in the live play area** (branch `claude/work-country-farms`, its own PR). Found while judging
   the density: the 8 km live square had no farms at all (tile scenery, and none is made there).
   `game/country.ts` `LiveFarms` builds the same farms in the same places with buildgen (the farmhouse in
   the place's tradition) and plain barns as the tiles draw them, a few a frame after start-up into one mesh
   a material; claims each yard on the land registry (no road through a farm); and `farmGround` gives the
   live ground the yards and tracks to paint. Seed 42: 60 farms, 165 buildings, +16 draw calls and about
   +21k triangles in any live-area view; the plan's roads build exactly as before with the claims in place.
   main.ts got three small hunks. Screenshots at 700 m and 300 m of the farm nearest the start town, before
   and after: `docs/reports/country/before-farm0-700.jpg`, `after-farm0-700.jpg`, `before-farm0-300.jpg`,
   `after-farm0-300.jpg`; another beside a winding lane, `after-farm1-700.jpg`.
9. **The dresser's barns** (branch `claude/work-country-edge`, its own PR): `game/dress.ts` (the play
   session's; one hunk, listed on the PR) now takes a near tile's farmsteads from `farmsIn`: the farmhouse a
   house lot as before, the barns the same plain pitched boxes `LiveFarms` builds (`barnGeometry`, exported
   from `game/country.ts`). Before, a dressed tile hid its farms and rebuilt none of them. Checked at 300 m
   on a farm just outside the live area: `docs/reports/country/dressed-farm-300.jpg`.
10. **The town's ragged edge** (same PR). With #67 the start town grows along its radials. Checked at 2 km
    and 700 m: no field ran under a ribbon of houses and no hedge ran through a close, but a field-wide plain
    of mown "town" lay round the whole built area, because a field became town once 15% of it lay within
    30 m of a plot, and every plot still in the queue (68, out to 480 m) marked the town round it. Now: a
    field turns town only once half of it is built over; a field the town has reached stays a field, and the
    ground within 20 m of a plot's middle (`TOWN_BAND`, the back fence and a few metres behind it) is painted
    as town texel by texel (`Layout.townAt`) with no hedge through it, so the crops run up to the back
    gardens; and only the next four plots in the queue (the building sites) mark the town, not the whole
    queue. A repaint after a plot at the fields' edge reaches the band round that plot (`TOWN_REACH`, 21 m
    from its middle) so it stays exact. CI failed its 2 ms repaint budget twice on this (4.1 ms at a 52 m
    reach on 20 m cells; 4.2 ms with the band exact per texel but `townAt` asked texel by texel through a
    Map keyed by doubles, and the hedges planned twice over overlapping boxes). Now the band is rasterised
    once over the paint window, the spots grid has small-integer keys, the repaint box is the plot's band
    circle rather than 21 m round its box, the hedges are planned once over that, and only a gateway that
    came or went is repainted: median repaint after a plot at the fields' edge, 3 runs each with the full
    suite running alongside, cold 1.1 ms here against the base's 0.7, warm 0.6 against 0.33 (the paint
    window is 1.6 times the base's, the band's circle). Screenshots at 700 m, 350 m and 2 km, before and after:
    `docs/reports/country/before-edge-700-w.jpg`, `after-edge-700-w.jpg`, `before-edge-350-e.jpg`,
    `after-edge-350-e.jpg`, `before-edge-2km.jpg`, `after-edge-2km.jpg`. What's left round the town is its
    parks (the leftover land the game landscapes, 5 ha) and the 30 m band. A test in `ground.test.ts`.
11. Docs: `docs/regiongen.md` (the block size and the follow rule), `docs/ground.md` (the live farms, the
    town band); this brief.

**Checks before the push**, on the branch merged with the integration head 58ec61a (PR #60, the economy
fix): `tsc` clean; `vitest run --no-file-parallelism` 117 files, 1104 passed, 8 skipped, no failures (the
economy growth test passes with #60 in); the phone e2es on `?map=region&seed=42`: firstview (six starts
before the merge, three after, 0% blank on every shot), lines, loop, rail, save, stations and the menu
e2e all pass, before the merge and after it.

## Not done

- **world50's (e) other finding, hedges beside a lane that run straight while the lane curves: looked at,
  not reproduced.** The live area's lane hedges follow `net.path(s)`, and a curved leg carries 27 points
  over 150 m (a point every 6 m), so a hedge tracks the bend; `hedgerows.ts` `runs(path, 20)` keeps every
  other point. Three 700 m views over the longest rural segments in the region's live area (seed 42) show
  the hedges on the bends. What does run straight into a field at 700 m is a hedged field boundary meeting
  the lane, which is right. If world50 has the screenshot, the spot would settle it.
- **Wood edges up close:** the canopy's crowns still make a sawtooth along a straight wood edge from far out
  (the domes' tips at the outline). Not a staircase, and #52 had the same; a smoother edge row is possible.
- **Seasons: the trees' leaves, the woods' canopy and the far rim** keep their summer colours (baked into the
  tiles and the tree materials; `game/edge.ts` is a fixed palette). Snow: none. Hedges: evergreen-looking all year.
- (Done: **#74 merged** at 06:43 UTC, green at e9ed4f8 with the repaint under the trunk's; af73094 alone had
  given 3.54 ms against 2.84 on the runner.)
- **A farm-sites export for the realism session** (the coordinator, 06:48): the plan wants the countryside's
  farmsteads so it can lay a farm lane from each to its nearest lane. `Countryside.farmsNear(box)` already gives
  every farm in the blocks touching a box (`Farm`: x, z, heading, side of its lane, and its track if it stands
  back); the field it sits in is `Layout.fieldAt(x, z)`. To be agreed on #80 when the realism session asks: an
  export from `worldmap/country.ts` (a list of farm sites with their field) that `routes.ts` consumes. Not done.

## Files touched

Own: `src/proto/region/fields.ts`, `countryside.ts`, `woods.ts`, `lanes.ts`, their tests,
`src/proto/worldmap/country.ts`, `src/proto/ground/*` (layout, paint, index, hedgerows, game, canopy and
`ground.test.ts`), `src/proto/game/country.ts` and its test, `docs/ground.md`, `docs/regiongen.md`,
`docs/briefs/country.md`, `docs/reports/country/*`. Shared files, each granted and listed on its PR: three
small hunks in `src/proto/main.ts` (#70: `farmGround` in the ground's extra plots, `LiveFarms` made and
updated each frame), one hunk in `src/proto/game/dress.ts` (#74: barns), one line in `docs/HANDOVER.md`
(#62: `region/sixkm.fixture.ts` deleted). No `worldmap/*` other than `country.ts`, no `region/generate.ts`.
