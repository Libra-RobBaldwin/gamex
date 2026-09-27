# Brief: country (the countryside session, second run)

Session https://claude.ai/code/session_016uD19qC4yiFZR8AhPrtiib, branch `claude/work-country-2`, PR #62 (merged) into
`claude/cloud-session-history-rvqkm1`, then `claude/work-country-pools` (#68, merged), `claude/work-country-farms` (#70,
merged) and `claude/work-country-edge`. Written 26 Sep 2026, 21:00 UTC, updated 27 Sep 02:50. Coordinator:
https://claude.ai/code/session_01NoR4Fo844FXMiY63oVBeCU (docs/briefs/PLAN.md, decision 1).

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
    ground within 30 m of the plots is painted as town texel by texel (`Layout.townAt`) with no hedge through
    it, so the crops run up to the back gardens; and only the next four plots in the queue (the building
    sites) mark the town, not the whole queue. A repaint after a plot reaches 52 m round it (`TOWN_REACH`)
    so it stays exact. Screenshots at 700 m, 350 m and 2 km, before and after:
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
- **The dresser drops barns.** `game/dress.ts` (the play session's) builds real buildings for a near tile's
  scenery but has no lot kind for a barn, so when a tile is dressed its farmhouses become houses and its
  barns vanish until the view goes up again. `LiveFarms` builds barns itself; the dresser could do the same
  (a plain pitched box) or buildgen could grow a barn.

## Files touched

Own: `src/proto/region/fields.ts`, `countryside.ts`, `woods.ts`, `lanes.ts`, their tests,
`src/proto/worldmap/country.ts`, `src/proto/ground/canopy.ts`, `docs/ground.md`, `docs/regiongen.md`,
`docs/briefs/country.md`, `docs/reports/country/*`. Shared files: none (no `main.ts`, no `worldmap/*` other
than `country.ts`, no `region/generate.ts`).
