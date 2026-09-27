# Brief: realism (seeded places and roads as real UK ones, from OS data)

Session: https://claude.ai/code/session_01N2xhRAKzQWsSt6RZQH8jdG (the onemap-4 session), branch
`claude/work-realism` (step 4 is merged, #61; the stream's first PR, spokes and stems, is merged, #65; the integration branch is merged in after each landing, so a PR carries only what is new).
Coordinator: https://claude.ai/code/session_01NoR4Fo844FXMiY63oVBeCU. Its brief came at 20:52 UTC, 26 Sep 2026.

**Rule:** nothing is "done" until it is live (merged into the integration branch) and checked on a 412×915
screenshot, judged as a player would: would anyone mistake this for a real English town from the air?

## What the user asked (26 Sep, 20:40 UTC)
"Roads going off at deeply weird angles at the edge of the towns... Not realistic at all... I really wanted
you to look at a load of real maps from OS and come up with seed rules that reflect reality."

## What the coordinator asked (20:52 UTC)
What the hero picture shows: the start town is a rotated grid with stub streets ending in fields, its edge is
a square, and the lanes reach it wherever the router arrived and join at any angle. No UK town looks like that.

1. **Measure first**, from the two OS bakes (`public/regions/exe`, `teme`; `tools/os/measure.mjs`,
   `compare.mjs`; `region/priors.ts`), on as many real places as they hold, and bake more regions if
   `tools/os/bake.mjs` can reach OS OpenData from here: how many roads enter a town and a village (radials),
   the angles between them and the angle they meet the built-up edge at; how the built-up edge relates to the
   radials (ribbons along the roads, not a circle or a square); how far streets branch off the radials as
   T-junctions and closes; how villages are shaped (linear along a road, or nucleated round a junction, a green
   or a church); where the centre sits on the radials. Write the rules into `region/priors.ts` with sources.
2. **Then the generator: the road network first, the town grows along it.** In `worldmap/routes.ts` the
   lanes reach a place's centre as its radials (3–6 for a town, 1–3 for a village), curving with the land, so
   a lane leaving a town is the continuation of a radial. In the street layout (`layStreets` in
   `region/generate.ts`, and `worldmap/towns.ts`'s scene) streets branch off the radials as T-junctions and
   closes at the measured rates and lengths, the built-up edge follows the radials and is ragged, grid patches
   appear only as small Victorian-terrace or estate blocks, and the centre is where the radials meet. One
   generator feeds the live start town (`worldmap/live.ts`) and the scenery towns. "Gates" become the radials'
   entry points.
3. **Second priority** (docs/reports/os/seeded-vs-real.md): seeded lanes are too gentle (1.3% median grade
   against 2.6–3.1% real) and too few (770–880 km against 2,500–3,400 km); both `routes.ts`.
4. **Evidence:** side-by-side 412×915 screenshots of a seeded town and a real one (Exe or Teme), same camera,
   at the whole map, 6 km and 1 km; `tools/os/compare.mjs` extended with the new yardsticks (radials per place,
   entry angles, orientation order, junction shares, street lengths) showing seeded within the real ranges;
   the hero pictures retaken.

**Files I own for this:** `region/generate.ts`, `worldmap/towns.ts`, `worldmap/routes.ts`, `worldmap/plan.ts`
(the places' part), `region/priors.ts`, `tools/os/*`, `docs/regiongen.md`, `docs/real.md`, `docs/reports/os/*`.
**Not mine:** `ground/*`, `region/fields.ts`, `woods.ts`, `lanes.ts`, `countryside.ts`, `worldmap/country.ts`
(countryside); `economy*.ts`, `econ*.ts` (coordinator); `game/*`, `ui/*`, `app/*` (play session). `e2e/*` is
the play session's: if the new layout moves the start town's streets so a suite's fixed positions break,
adjust them minimally, keep each suite's intent, and list every e2e edit in the PR.

Standing rules: tsc, the full unit suite and the six region e2es before every push; merge integration before
every push; small commits, push after each; one PR per stream into `claude/cloud-session-history-rvqkm1`;
keep this brief honest; reply on the PR when asked; a check-in every hour while a PR is open.

## Measured so far (`tools/os/exits.mjs`, 31 market towns and 330 villages; `--svg <dir>` draws each town)
A place's built-up area is its buildings (4 or more within 150 m) joined to the centre, holes filled; a way
out is where a road (A, B or lane; not streets, drives or tracks) last leaves it and runs 600 m on.
- Ways out: towns 7–15 (median 11), villages 3–8 (median 5). Most of a village's are lanes (1,202 of 1,629).
- The angle a road meets the edge at: median 23–25°, 6 in 10 within 30° of straight out, 1 in 7 over 60°.
- Inside, over its last 400 m, a road's heading is 29–36° off the line to the centre at the median; followed
  straight on, 58% of a village's ways out and 27% of a town's reach the middle.
- Outside, a road turns 40–42° in its first kilometre at the median (109–138° at the 90th).
- The ways out of a village are 59° apart at the median (smallest gap 22°); a town's 24° (4°).
These are `PRIORS.exits`. Pictures: Silverton has 7 lanes radiating from its crossroads; Pembridge 6;
Moretonhampstead 8 from its centre; Ludlow's are its A roads and lanes continuing its streets.

## Done locally (commit 0841d49 on this branch)
- Every settlement has four **spokes** (both ends of its high street and its main cross street, each facing
  out along its street): `layStreets`.
- A lane leaves by the spoke facing where it goes (`spokeFor`), runs 240 m straight along it (`stem`), and the
  way found between is smoothed into the stems as one line with the first 150 m held straight (`joinStems`);
  two lanes on one spoke fork outside (`forks`, as before). `region.test.ts` checks every lane on three plans.
- Checked on a 1600×900 picture of seed 42's start town: the lanes now continue its streets and fork outside
  it. Not yet checked at 412×915; not live.

## Plan (in order)
1. Open step 4's PR (the deletion only), then this branch's PR with the spokes and stems as its first step.
2. Measure the rest (a second script or `exits.mjs` grown): radials per place and their angles; the built-up
   edge against the radials (how far ribbons run out along them; the edge's raggedness); T-junctions and closes
   off the radials (spacing, lengths, the share that are closes); village shapes; the centre's place on the
   radials. Add the yardsticks to `compare.mjs` and the rows to `docs/reports/os/seeded-vs-real.md`.
3. The generator: radials into the centre (the lanes' ends), streets grown off the radials, a ragged edge that
   follows them, grid patches only as terrace or estate blocks; scenery towns from the same calls.
4. Lanes' grades and density (`PRIORS.follow`, more links).
5. Evidence: side-by-side shots, compare rows, the hero pictures retaken.
6. Done through #75. What the yardsticks still show, for the coordinator to pick from (nothing assigned after
   item 3): (a) lane km 1,313–1,655 against the real 2,523–3,368: the rest is farm lanes and tracks that no
   place owns; a lane from each farmstead to its nearest lane, as `routes.ts` `spurs` does for industries,
   once the plan exposes the countryside's farm sites (the farms are the countryside session's, `#70`);
   (b) a town's radials wander 6–7° per 100 m against the real 11.3, the finer wiggle of a centreline that
   85 m blocks can't carry; (c) villages 72 per 1,000 km² against 129–157: done as step 5. The hero
   pictures (`src/app/art`) are retaken from the town as it is after step 4.

## Also mine, from the logic review (coordinator, 21:22 UTC; `docs/reports/review-2026-09-26.md` on `claude/review-2026-09-26`)
Lower priority than step 4's PR and the stream above; in this PR or a small one of their own.
1. **Bug 11 (verified):** `worldmap/view.ts` clears `pending` on a rejected tile request and remembers nothing,
   so the tile is asked for again every frame for ever, with a warning each time. Remember failed tiles and
   retry with a back-off, a few times at most. Test: "the streamed view › stops asking for a tile whose
   request failed" in `src/proto/review.flow.test.ts` on that branch.
2. **Suspected:** `worldmap/econ.ts` `pop()` grows every far place linearly for ever regardless of service, and
   on activation a place's people jump to the sum of its generated buildings' capacity (`main.ts:2061`). Make
   the coarse growth bounded and consistent with what the generator will build, so a place doesn't change size
   when it comes to life.

## State
| Item | State |
|---|---|
| Exits measured, priors written | live (#65) |
| Spokes and stems | live (#65), checked at 412×915 |
| PR open | #79 (step 5: villages at the density a real region shows), open, subscribed, its lanes fix pushed (2d505eb); red on the loop e2e for the economy's reason below, held for the coordinator to broker; #77 (the menu's pictures retaken after step 4, the brief's list of remaining gaps) merged 27 Sep 06:21 UTC; #75 (step 4: ribbons that bend and thin, a town's share of lanes) merged 27 Sep 05:13 UTC, its gate green (tsc, 130 files / 1,187 tests, all six phone e2es on the merged head), CI green; #71 merged 27 Sep 04:19 UTC (its CI green once the integration branch's lines-suite fix was merged in). Before that: #71 was its gate (full unit suite, five of the six phone e2es) passes on 9de1abc; CI was red only on the lines e2e, whose calls and gap checks sat on the edge since PR #69 gave the line a third bus (analysis and a proposed patch on the PR); the coordinator fixed the suite on the integration branch (9742732) and it is merged into #71 (5d454d7), CI running; step 4 (ribbons, lanes) is committed on top locally and waits for #71 to merge before its own PR; #67 merged 27 Sep 01:45 UTC, #65 merged 26 Sep |
| Radials, edge, T-junctions, closes, village shapes measured | live (#67): `tools/os/towns.mjs`, `PRIORS.towns`, a section in the report |
| Generator: town grown along its radials | on PR #67 (`layStreets` rewritten, then made crossing-free); the careful builder refuses nothing on five seeds; tsc clean; the full unit suite green (126 files, 1120 tests); all six phone suites green locally on their moved positions (listed in the PR); the start town checked at 412×915 from 900 m and 400 m (report); live (#67) |
| Lanes: the best-facing spoke, water at the stem, a blend into the course | live (#67); `region.test.ts` checks every lane on three plans |
| Compare yardsticks: radials, junction shares, street pieces, orientation order | live (#67): `compare.mjs`, the places table in `seeded-vs-real.md`, within the real ranges |
| Lane grades and density | measured: the seeded land is two to three times gentler than the bakes' (slope median 2.7–3.5% against 6.7–8.1%), so lane grades read low because of the ground, not the router; the fair yardstick, a lane's grade over the slope of its ground, was 0.44–0.46 against the real 0.52–0.6; the lanes' slope penalty (`PROFILES.B.climb`, 2 → 0.9) takes it to 0.49–0.54 (higher climbs match better still but tip `routes.test.ts`'s marginal motorway row, which re-plans its motorway over ground the lanes have eased: 0.057 against a 0.06 limit). Density: the plan makes 74 villages per 1,000 km² and no hamlets; the real bakes have 65–170 hamlets per 1,000 km² on top, each with lanes, which is most of the 800 vs 2,500–3,400 km gap. Hamlets (the coordinator, 01:50 UTC: do them): a `hamlet` kind in `KINDS` and the plan (`planWorld` makes them from `PRIORS.settlements.perThousandKm2.hamlet`, capped at 220), a few houses along one lane with two ways out and a close or two, lanes to their nearest neighbours as villages have; the scenery builds their houses (`towns.ts`), the buildings style them as villages (`vernacular.ts`), the places list names them (`game/places.ts`, `mapspec.ts`); trunk roads keep only a lane's margin from them (`routes.ts`). Seed 42: 220 hamlets, nearest neighbour 1.26 km at the median (real 1.1–1.24), 2 lanes each, ~95 people, lane km 800 → 1,100–1,140 (real 2,500–3,400: the rest is farm lanes and tracks no place owns). Checked at 412×915 from 2.5 km and 400 m (`docs/reports/os/exits.md`, Hamlets). The trunk-route test now eases the ground along its own routes before measuring their grades, as the game does. On PR #71, not live; the start town and its lanes are unchanged by them, and the frame rate at the start view is the same |
| Side-by-side evidence at 6 km / 1 km, hero pictures retaken | live (#67), the hero pictures retaken again after step 4 (`e2e/art.mjs`, the tall one re-aimed at the town's middle; the menu suite passes on them); Moretonhampstead (Exe bake, 2,180 people) against the seeded start town at 412×915 from 6 km and 1 km, in `docs/reports/os/exits.md` (`side-*.jpg`): the same compact blob at a meeting of roads with ribbons along the radials; the real town has more lanes round it, bends with its roads and thins out along them |
| Review bug 11 (failed tiles asked for for ever) | committed (`view.ts`: three tries, each wait twice the last, then left alone; `view.fail.test.ts`, the review's test); live (#67) |
| Park pond (coordinator, 26 Sep 23:46 UTC, on PR #67: after it lands, a park pond as a level surface in a hollow with an irregular outline, through the water system, or a clear note here on why not yet) | the water and terrain side is done and tested (`worldmap/water.ts` `addPond`, `pondAt`, `MapWater.addLake`; `terrain.ts` lays the ground level to a pond and cuts its hollow; `worldmap/pond.test.ts`: a level surface at the ground's height, an outline that wanders and is never a circle, a bed below the water, a rim rising to the land within three times its radius, the land beyond untouched, water to `kindAt`, `edgeDistance`, `wet`); what remains is the game's side, the play session's files (`docs/water.md`, Park ponds): the park planner calling `addPond`, handing the spec to the game's water (`shapes.addLake`), remaking the relief field's box, rebuilding the water tile, the ground mesh and the claims round it; no pond is drawn until then, so no screenshot yet |
| Review: bounded coarse growth, no jump on activation | growth bounded, committed (`econ.ts` eases off towards half again the planned size; `econ.test.ts`); the jump on activation is `main.ts`, the play session's, noted in the PR; live (#67) |
| Villages at a real region's density (coordinator, 27 Sep 06:27 UTC, step 5) | on PR #79. Found on its first CI run and fixed: a later village anywhere can change the Gabriel graph of places near the start town (one lane through the live area swapped), so the later villages are now placed last of all, from the same stream after every other draw, and their lanes are chosen last and added on top of the others' (`Settlement.later`, `suggestLinks`): every lane a place had before them is exactly what it was (checked: the 31 roads touching the live square match the base's). Still red, and not this stream's code: the loop e2e no longer sees the start town decline when its bus line goes (1,898 → 2,054 people over the eight days after, against 1,867 → 1,819 on the base), because `TownEconomy` takes every plan settlement as a destination (`towns: MAP.settlements`) and the region now has 161 more; with the later villages' people set to zero the numbers are identical, so it is their existence as destinations, not their people: the economy's (play session's) to weigh, or the loop suite's expectation; reported on the PR for the coordinator to broker. Measured: a baked region shows 129–157 villages per 1,000 km² (its hamlets of 150 people or more folded in; `compare.mjs`), the plan made 72 from Open Names' village count; `PRIORS.settlements.villagesLoadedPerThousandKm2` [129, 156.6]; `planWorld` places the rest of the villages after the hamlets (every earlier place keeps its spot; none within 6.5 km of the start town, so its first view and its lanes are unchanged). Plan time kept at 3.2 s idle (seed 42) by a grid for the Gabriel test in `suggestLinks` and a once-per-cell keep-out in `LaneFinder`. Seeds 42/7/1234: villages 152/156/148 per 1,000 km², nearest place 1.4 km (real 1.4), lane km 2,045/1,963/1,438 (was 1,655/1,583/1,313; real 2,523–3,368). Before/after 6 km views 8.7 km from the start town in `exits.md` (`country-*-6km.jpg`). Plan, region and priors tests pass; the gate (six e2es, full unit suite) running |
| Ribbons that bend and thin, more lanes round a town (coordinator, 27 Sep 01:50 UTC, item 3) | measured over the 31 towns and 330 villages (`tools/os/towns.mjs`: a radial's net turn inside 64° for a town, its heading wandering 11° from one 100 m to the next; the houses along it half as dense over its last quarter, none beyond the edge at the median; 8.4 B roads and lanes out of a town, 4.3 out of a village), written as `PRIORS.towns` `radialTurnInsideDegPerKm`, `radialWanderInsideDegPer100m`, `radialNetTurnOutsideDeg`, `housesPer100mByQuarter` and `PRIORS.exits.minorPerPlace`. `layStreets`: every radial bends (drift plus a curvature that carries over and wanders, from a random stream of its own so the rest of a place's layout keeps its draws), grid plan or not; a radial that would cross an earlier one stops short; side streets that would meet too flat or too near another street end as closes, ones that would cross a street end on it as a T. `towns.ts`: the ribbon thins along its radial to the measured profile (`StreetCall.along`). `suggestLinks`: towns take every Gabriel neighbour's lane, villages four, and a place short of its share takes lanes to its nearest neighbours (none through a third place, none within 12° of one it has). Seeds 42/7/1234: towns 11–12 ways out (real 11), villages 4 (real 5), lane km 1,313–1,655 (was 871–1,136; real 2,523–3,368), a town's radials wander 6–7° per 100 m by the real measure (real 11.3: 85 m blocks), the last quarter of a town's ribbon 0.60–0.66 of the middle's (real 0.51), a village's 0.44–0.47 (0.44); the start town 1,775 people and 216 buildings against 1,858 and 230. Judged at 412×915 from 6 km and 1 km against Moretonhampstead (`exits.md`, the pair retaken; the pair before kept as `-before`). Region tests pass (the spoke-facing test loosened to the measured `insideOffCentreDeg`, the links test takes the top-up lanes); the rail and save e2es build their branch at x −480 (listed on the PR); all six phone e2es and the full unit suite (130 files, 1,187 tests) pass on the PR's head; CI green. Live (#75) |
