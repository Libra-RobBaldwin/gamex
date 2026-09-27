# Brief: vehicles (the review's vehicle rows)

Session https://claude.ai/code/session_01EKUWb6f3c3TYr6jHSTbTjp, branch `claude/work-vehicles-fixes`.
PR #64 (the five review rows below) merged into `claude/cloud-session-history-rvqkm1` at 22:59 UTC.
A second PR, #69, the coordinator's follow-ups (asked 23:18 UTC), is the section right below; opened 27 Sep 00:46 UTC, CI green locally (122 unit files, six phone e2es).

# Round 4: rail money (asked 27 Sep 04:24 UTC)

The coordinator: RUN in `rail/game.ts` (a train's running cost a game day) had never been measured
against a train line's fares (riders × 30 × £2 × 2). On the phone build, seed 42, build a two-station
line with one train, run ten game days, report fares against running per day; then set RUN so a
well-used line makes about four times its running and an empty one loses.

## Measured (27 Sep 04:30–05:10 UTC, `e2e/railmoney.e2e.mjs`, not part of CI)

Three lines, each two stations built by the station tool, the line from a station's sheet, then ten
game days skipped on the page's clock hook, the line's fares and running read from the purse each
day. RUN as it was: dmu £4,000, intercity £9,000 a game day.

| Line | Trains | Riders a town-day (days 6–10) | Fares a game day | Running a game day | Ratio |
|---|---|---|---|---|---|
| The rail e2e's: a 590 m branch at the town's west edge, both stations covering the same homes | 2 dmus | 19.3 | £2,321 | £8,000 | 0.29 |
| Town to village: the start town's west edge to Fellwick (590 people, 2.1 km of single track, no loop, so one train runs; the tool's first is the intercity) | 1 intercity | 108.5 (147 on day 1, falling about 4% a day) | £13,080 (£15,759 on day 1, £12,027 on day 10) | £9,000 | 1.45 |
| Out in the fields, 2.2 km west of the town | 2 dmus | 0 | £0 | £8,000 | 0.00 |

What the numbers say: on this map a railway earns only between places: a line within the start town
(1 km across, a station's catchment 800 m) carries almost nobody because walking is as quick. The
town-to-village line is the natural first railway and the well-used case; its ridership was still
falling at day ten (the village's people settling), so the mean of days six to ten is the reference.

## Set

`RUN` = dmu £1,500, intercity £3,300, hs £4,400, tram £1,100, rack £1,300 a game day (the kinds keep
their old proportions, 0.37 of what they were). The town-to-village line then makes £13,080 against
£3,300, four times; the empty line loses £3,300 a day. One consequence to weigh (the fare side is the
economy's, not mine): a train's day now costs less than a decker bus's (£2,600), because a rail rider
pays twice a bus fare and a village line carries a third of a busy bus line's riders.

# Round 3: an adversarial review of rail on the new town (asked 27 Sep 01:51 UTC)

The coordinator: on the town grown along its radials (#67, #70), review rail as the review did for
buses, failing tests first, then fixes; then the train card and the station card, small, as the bus's.
PR #72, opened 27 Sep 02:36 UTC; locally: typecheck clean, 129 unit files (1183 tests) and the six phone
e2es green (the rail e2e checked 32 open doors against the platform edges, none wrong).

| # | Ask | Status |
|---|---|---|
| S1 | Two stations and a line built by touch on a branch that crosses a radial on the level (the rail e2e). | **Covered** by `e2e/rail.e2e.mjs` on the new town (the branch at x −440 crosses the lane west on the level; two stations from Build > Stops, a line by tapping); it now also checks S5 on the phone build. |
| S2 | Trains through a level crossing with the new lanes' traffic. | **Covered**: the rail e2e checks the barriers hold the lane's cars and no car is on the crossing while a train holds its block; `rail/rail.test.ts` and `rail/review.test.ts` cover the crossing rules. Nothing new found. |
| S3 | A train line that shares track with another. | **Done, one bug found and fixed** (below): two lines over one double line run clean; a branch off a main line at a workable angle runs clean; a branch joined at a right angle made a line whose trains never moved. |
| S4 | A station on a curve. | **Done, nothing wrong**: trains call at a station on a 1,250 m curve with their doors meeting the set-back platforms (`review2.test.ts`; `stations.test.ts` already covered placing and refusing). |
| S5 | Doors on the right side at every platform. | **Done, nothing wrong**: every layout a single or double line offers (side, island, both; 1–4 tracks; tapped on either side), 55 cases, each dwell's doors are at a platform edge and, for side platforms, not on the other side. The rail e2e checks every open door against the platform edges on the phone build. |
| S6 | Save and reload mid-journey. | **Done, nothing wrong at the sim level**: stations, lines and the train count come back; every train is out of the depot within a day and calling. By design a saved train restarts from its depot (its position, calls and who's aboard aren't saved), as a saved bus restarts along its line; its look comes back the same (dressed from its def). |
| S7 | Speed 1× against 4×. | **Done, nothing wrong**: two days at 0.25 s steps (a slow phone at 1×) against 1/30 s (4×): same calls within two, no red passed, no shared block, no train run past its stopping point. |
| S8 | The train card and the station card: a name, two or three numbers, one action, as the bus's has. | **Done** (`rail/game.ts`): the train card is "Train N", the model, cars, line and what it's doing on one line, three numbers (speed, on board, at/next), one action (its line). The station card is the name, "Railway station · 2 platforms × 130 m", three numbers (waiting, boarded today, lines), the layout as a note, New line from here; it keeps Demolish, which nothing else offers (the bulldozer refuses stations: the play session's row). Its lines are listed under Transport > Railway. |

### What the review found

- **A railway joined to another at a right angle** (a branch dropped square onto a main line) makes
  points no train can take: `track.ts exits` lets a train through a junction only within 60° of
  straight. The track tool built it all the same, the station tool put a station on the branch,
  and the line tool ran a line over it: its trains stood at the platform for ever, the money gone.
  Fixed twice: `Network.check` refuses the join ("Too sharp a junction: a railway has to leave the
  other at 60° or less, as points do"), and `RailSim.reachable` makes `fits()` refuse a line with
  no way by rail between two of its calls, by station name, before any train is paid for.
- Congestion, not a bug: four trains sharing a two-platform terminus make two or three calls a day
  each on a 2 km line (they queue to reverse). The test allows for it.

# Round 2: the coordinator's follow-ups (asked 23:18 UTC)

| # | Ask | Status |
|---|---|---|
| R1 | A stop kept across a split standing hard against the new junction: move it clear along its road, the same distance a new stop must keep from a junction, rather than a bus holding the junction slot while it dwells. | **Done** (roads.ts `split`: the pair moves together until its lay-by is the road's half-width and 6 m clear of the new node; stays put only on a half too short for that) |
| R2 | The suspected U-turn deletion of a line bus at a junction it has no path through (`pathFor` null for next === seg): build the case with a street ending into motorway-only legs; a line bus never counts as a give-up. | **Done** (traffic.ts `stepLane`: with no way on but back, the bus turns at the junction's stop line as at a dead end; test builds a street into a one-way motorway pair, 7 minutes, no give-up, both stops called, never in the junction) |
| R3 | The "stop just past a junction's stop line" lap detour: confirm planStop refuses those placements, and if not, fix. | **Done, it didn't**: planStop's rule (half-width + 6 m) is looser than a roundabout's or a big junction's reach. `Network.stopRange`, set by the traffic from its start and end guards, now makes planStop refuse them ("Too close to the junction — a bus couldn't pull up here clear of it"); the test found such places on the roundabout scenario. Also a bus still calls at a stop it comes to rest up to 4 m past (`BEHIND`). |
| R4 | Only if R1–R3 are done: the simplest anti-bunching a phone player would notice: a bus holds at a stop for up to a minute when the bus ahead is less than a third of the loop away, behind a per-line toggle default on; measure on the lines e2e that headways even out. | **Done** (traffic.ts `spacing`, `holdOn`, `hold`; lines.ts `spacing`/`setSpacing`, saved as `spacing: false` only when off; main.ts: an "Even gaps · on/off" action on the line sheet and a "Holding here to even the gaps" status on the bus sheet). See the notes below. |

### R4 notes (what was measured, honestly)

- **The rule.** When a bus's dwell is done, it looks at where its line's buses are round the loop
  (each call's distance along `lineRoute`, less what the bus still has to drive to its next call).
  It holds, a few seconds at a time and for at most a minute at one stop, while the bus ahead is
  closer than a third of the loop (or the line's even spacing, `1/N`, when it runs more than three
  buses) **and closer than the bus behind**. The second condition is not in the ask, but without
  it the first only moved the bunch: a bus holding for its leader let its follower close up on it
  (seen in a trace at t380–t440: gaps of 0.27–0.40 collapsed to 0.07).
- **The measure is approximate.** A there-and-back line calls at whichever pole of a stop the
  bus arrives on; after calling at the far pole a bus must loop round to the next call (522 m
  where the canonical leg is 205 m), so its loop position reads well behind, which is true but
  jumpy. So the test measures headways, not positions.
- **Unit test** (`traffic.spacing.test.ts`, the starter town, a 3-stop there-and-back line, 3 buses
  all started at the first call): over the second ten minutes the intervals between buses at each
  of the line's calls vary by 3–17% of their mean with the switch on (12 holds), and by up to 118%
  with it off (0 holds). Asserted at under 30% on, over 60% off. The switch survives a save.
- **Lines e2e** (`e2e/lines.e2e.mjs`): a third bus is added (it starts close behind another), and
  the run must show the rule engaging (at least one hold) and the smallest gap round the loop no
  worse than at the start. Since PR #72 the run is six sim minutes at 16× (the frame loop takes at
  most 0.1 s of real time a frame, in steps of 1/30 s), not four wall-clock minutes at 4×: on
  SwiftShader at half a second a frame that gave a slow runner three or four sim minutes and the
  check measured the runner, not the buses (CI failed once that way). A few sim minutes on SwiftShader is too little to measure
  headways settling on the phone build; the e2e prints the gaps and the unit test carries the
  20-minute evidence.
- Not done: no anti-bunching for trains; no "holding" shown on the map itself (the bus sheet says it).

Written 26 Sep 2026, 21:20 UTC, before any fix.

## What's asked (the coordinator, from `docs/reports/review-2026-09-26.md`)

Cherry-pick `src/proto/review.vehicles.test.ts` and the two "a road joined where a stop stands" tests
from `src/proto/game/review.loop.test.ts` off `claude/review-2026-09-26`, and make them pass by fixing
the causes, without weakening them. In this order:

| # | Ask | Status |
|---|---|---|
| 1 | **Bug 1.** `Network.split` gives the halves new ids and `Traffic.update` drops every car whose seg id is gone, so building onto or across the road a line's bus is on deletes the bus, unpaid. Vehicles on a split road must carry over onto the right half at the right offset and be re-planned, buses and cars alike. Bulldozing a road a line drives along must re-route the buses or the UI must refuse it. | **Done** (traffic.ts `carryOver`, `strand`, the depot) |
| 2 | **Bug 2, the Network part.** `split` drops every stop straddling the join. Keep stops across a split (each to the half it lies on, both poles of a pair), and make `Network.check` report a road that would land on a stop so the road tool can warn. The play session does the warning text and refund. | **Done** (roads.ts `split`, `landsOn`, `Check.stops`) |
| 3 | **Bug 5.** A bus dwelling at a stop drives off with its doors open when its line loses a different stop. A dwell must always complete, and `leg` be re-based when the sequence changes. | **Done** (traffic.ts `busStops`, `called`, `setLineSeq`; lines.ts `prune`) |
| 4 | **Bug 6.** Every road or stop edit rebuilds the railway and zeroes every train. Rebuild only when the track graph actually changed, and then keep trains' speed and reservations where their track is unchanged. | **Done** (rail/railway.ts `signature`, rail/sim.ts `rebuild`) |
| 5 | **Suspected.** A bus that finds no room on load is silently lost with the money gone. Retry placement over later frames; never lose a paid bus. | **Done** (traffic.ts `addBus`, `placeBus`, `fromDepot`) |

Files I own: `src/proto/traffic.ts`, `trafficsim.ts`, `game/lines.ts`, `game/fleet*.ts`, `rail/*`, the
split and check parts of `roads.ts`, their tests, `docs/rail.md`. Small hunks in `main.ts` only where a
fix needs them, each listed in the PR. Not `game/econ.ts`, `economy*`, `econ*`, `ui/*`, `app/*`,
`worldmap/*`, `region/*`, `ground/*`.

## Baseline (21:15 UTC, integration head 01dfb5b)

`review.vehicles.test.ts`: 3 of 3 fail, as the review says:
- the side road takes one of the two buses;
- 1,631 frames driving with the dwell still on;
- the train's speed is 0.08 m/s the step after a rebuild that changed nothing (was 24.8).

## Done (21:40 UTC)

All five, on the causes, with the review's tests unchanged:

- **Bug 1.** `Network.split` logs each split (`net.splits`); `Traffic.carryOver` (run by `invalidate()`
  and at the top of every `update()`) moves everyone on the old road onto the half under their
  centre, at the same distance from the end they drive from, remaps the stop they're pulling in to,
  the road they're turning onto, and every route through the old road (its halves in driving order,
  the trip's goal moved onto the right half). Then anything whose road is gone: a line's bus goes to
  the depot; anyone else fades out as before. Bulldozing a road a line drives along therefore sends
  its buses to the depot, and they're back at the line's next call within a second or two. No
  refusal needed in `main.ts`.
- **Bug 2, Network part.** `split` keeps every stop: each on the half its stand is on, a pair (a stop
  and the one facing it) together on the half the further pole is on, clamped to lie on the road.
  `Network.check` gains `stops`: the stops the road's junctions would land on (an end part-way along
  a road, or a level crossing of one), for the road tool's warning. `check.ok` stays true.
- **Bug 5.** A bus remembers the stop it stands at (`atStop`); its dwell counts down to the end
  whatever `nextStop` says meanwhile, and `called()` moves the call on only past the stop served.
  `Lines.prune` hands a shortened sequence to `Traffic.setLineSeq`, which puts each bus on the same
  call or the next one still made (outbound and return calls told apart), never back to the start.
- **Bug 6.** `Railway.rebuild` hashes what the railway is made from (rail segments with their paths
  and bridges, the stations, roads near a station) and returns at once when it's unchanged; a road
  crossing the line on the level only refreshes the crossings. `RailSim.rebuild` keeps the speed,
  route and reservations of every train whose own pieces and blocks are the same as before.
- **Lost bus.** `Traffic.addBus` for a line always returns a bus: with no room it waits in the
  depot (`traffic.depot`), counted by `busesOn`, saved with its line, tried once a second at the
  line's next call. A wandering bus (no line) still needs room now. The bus sheet says "Waiting for
  room on the road" (the one `main.ts` hunk, `showBusInfo`).

Tests: `review.vehicles.test.ts` (3, the review's), `game/review.split.test.ts` (the review's two,
plus the reported stops), `traffic.edits.test.ts` (a split under real traffic, a road bulldozed
under a bus, twelve buses on one short road, the leg re-base). Typecheck clean.

## Checked (22:20 UTC)

- `npx tsc --noEmit`: clean.
- `npx vitest run --no-file-parallelism`: 120 files, 1117 passed, 8 skipped, none failed (the traffic
  harness keeps zero overlaps and its give-up limit; the doors test's random stream is as before).
- Phone e2es on `?map=region&seed=42`: lines, loop, rail, save and stations all pass with no console
  errors; the menu e2e passes (on the dev server). Screenshots in `shots/` locally, not committed.

## Not done

- The play session's part of bug 2: the road tool's warning from `check.stops`, and the refund.
- A stop kept across a split stands hard against the new junction, as the review's test demands;
  a bus calling there holds its junction slot while it dwells. The warning is what stops a player
  doing that by accident. If the coordinator would rather the road tool refused to land on a stop,
  that's a one-line change in main.ts from `check.stops`.
- Not played on a phone by hand: checked by the e2es and the unit tests only.
