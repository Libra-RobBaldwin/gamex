# Brief: vehicles (the review's vehicle rows)

Session https://claude.ai/code/session_01EKUWb6f3c3TYr6jHSTbTjp, branch `claude/work-vehicles-fixes`, PR
into `claude/cloud-session-history-rvqkm1`. Written 26 Sep 2026, 21:20 UTC, before any fix.

## What's asked (the coordinator, from `docs/reports/review-2026-09-26.md`)

Cherry-pick `src/proto/review.vehicles.test.ts` and the two "a road joined where a stop stands" tests
from `src/proto/game/review.loop.test.ts` off `claude/review-2026-09-26`, and make them pass by fixing
the causes, without weakening them. In this order:

| # | Ask | Status |
|---|---|---|
| 1 | **Bug 1.** `Network.split` gives the halves new ids and `Traffic.update` drops every car whose seg id is gone, so building onto or across the road a line's bus is on deletes the bus, unpaid. Vehicles on a split road must carry over onto the right half at the right offset and be re-planned, buses and cars alike. Bulldozing a road a line drives along must re-route the buses or the UI must refuse it. | Not started |
| 2 | **Bug 2, the Network part.** `split` drops every stop straddling the join. Keep stops across a split (each to the half it lies on, both poles of a pair), and make `Network.check` report a road that would land on a stop so the road tool can warn. The play session does the warning text and refund. | Not started |
| 3 | **Bug 5.** A bus dwelling at a stop drives off with its doors open when its line loses a different stop. A dwell must always complete, and `leg` be re-based when the sequence changes. | Not started |
| 4 | **Bug 6.** Every road or stop edit rebuilds the railway and zeroes every train. Rebuild only when the track graph actually changed, and then keep trains' speed and reservations where their track is unchanged. | Not started |
| 5 | **Suspected.** A bus that finds no room on load is silently lost with the money gone. Retry placement over later frames; never lose a paid bus. | Not started |

Files I own: `src/proto/traffic.ts`, `trafficsim.ts`, `game/lines.ts`, `game/fleet*.ts`, `rail/*`, the
split and check parts of `roads.ts`, their tests, `docs/rail.md`. Small hunks in `main.ts` only where a
fix needs them, each listed in the PR. Not `game/econ.ts`, `economy*`, `econ*`, `ui/*`, `app/*`,
`worldmap/*`, `region/*`, `ground/*`.

## Baseline (21:15 UTC, integration head 01dfb5b)

`review.vehicles.test.ts`: 3 of 3 fail, as the review says:
- the side road takes one of the two buses;
- 1,631 frames driving with the dwell still on;
- the train's speed is 0.08 m/s the step after a rebuild that changed nothing (was 24.8).

## Done

Nothing yet.

## Not done

Everything above.
