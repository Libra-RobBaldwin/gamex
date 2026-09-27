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
| PR open | none; #67 (the radial town, the review fixes, the lane climb) merged 27 Sep 01:45 UTC, #65 merged 26 Sep; the next PR is the park pond and the hamlet proposal |
| Radials, edge, T-junctions, closes, village shapes measured | live (#67): `tools/os/towns.mjs`, `PRIORS.towns`, a section in the report |
| Generator: town grown along its radials | on PR #67 (`layStreets` rewritten, then made crossing-free); the careful builder refuses nothing on five seeds; tsc clean; the full unit suite green (126 files, 1120 tests); all six phone suites green locally on their moved positions (listed in the PR); the start town checked at 412×915 from 900 m and 400 m (report); live (#67) |
| Lanes: the best-facing spoke, water at the stem, a blend into the course | live (#67); `region.test.ts` checks every lane on three plans |
| Compare yardsticks: radials, junction shares, street pieces, orientation order | live (#67): `compare.mjs`, the places table in `seeded-vs-real.md`, within the real ranges |
| Lane grades and density | measured: the seeded land is two to three times gentler than the bakes' (slope median 2.7–3.5% against 6.7–8.1%), so lane grades read low because of the ground, not the router; the fair yardstick, a lane's grade over the slope of its ground, was 0.44–0.46 against the real 0.52–0.6; the lanes' slope penalty (`PROFILES.B.climb`, 2 → 0.9) takes it to 0.49–0.54 (higher climbs match better still but tip `routes.test.ts`'s marginal motorway row, which re-plans its motorway over ground the lanes have eased: 0.057 against a 0.06 limit). Density: the plan makes 74 villages per 1,000 km² and no hamlets; the real bakes have 65–170 hamlets per 1,000 km² on top, each with lanes, which is most of the 800 vs 2,500–3,400 km gap. A hamlet kind touches `Kind` everywhere (econ, names, vernacular, live): a shared decision for the coordinator, proposed with the next PR. Rows for both are in `seeded-vs-real.md`; live (#67) |
| Side-by-side evidence at 6 km / 1 km, hero pictures retaken | live (#67): hero pictures retaken from the radial town (`src/app/art`); Moretonhampstead (Exe bake, 2,180 people) against the seeded start town at 412×915 from 6 km and 1 km, in `docs/reports/os/exits.md` (`side-*.jpg`): the same compact blob at a meeting of roads with ribbons along the radials; the real town has more lanes round it, bends with its roads and thins out along them |
| Review bug 11 (failed tiles asked for for ever) | committed (`view.ts`: three tries, each wait twice the last, then left alone; `view.fail.test.ts`, the review's test); live (#67) |
| Park pond (coordinator, 26 Sep 23:46 UTC, on PR #67: after it lands, a park pond as a level surface in a hollow with an irregular outline, through the water system, or a clear note here on why not yet) | in hand, 27 Sep 01:50 UTC: reading how parks and the water system stand |
| Review: bounded coarse growth, no jump on activation | growth bounded, committed (`econ.ts` eases off towards half again the planned size; `econ.test.ts`); the jump on activation is `main.ts`, the play session's, noted in the PR; live (#67) |
