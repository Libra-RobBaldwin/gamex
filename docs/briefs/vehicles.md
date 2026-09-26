# Brief: vehicles (the review's vehicle rows)

Session https://claude.ai/code/session_01EKUWb6f3c3TYr6jHSTbTjp, branch `claude/work-vehicles-fixes`, PR
into `claude/cloud-session-history-rvqkm1`. Written 26 Sep 2026, 21:20 UTC, before any fix.

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

## Not done / to check before the PR is final

- The full unit suite and the six phone e2es on the region: running now; results go in the PR.
- The play session's part of bug 2 (the road tool's warning from `check.stops`, and the refund).
- A stop kept across a split stands hard against the new junction, as the review's test demands;
  a bus calling there holds its junction slot while it dwells. The warning is what stops a player
  doing that by accident.
