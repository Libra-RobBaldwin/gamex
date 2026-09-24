# The first playable loop

**Goal:** in the invented town, you draw a bus route between parts of town. Buses follow it and
stop only at its stops. People board, fares come in and running costs go out, and the town grows
or shrinks with the service, shown on one town panel. Rail lines follow the same pattern. Nothing
else starts until the bus loop plays well on a Pixel in portrait.

Built from group A of the handover backlog. Scenery, Horley, the Real Town Plans page, ground
polish and cyclists stay parked.

## Milestones

Every milestone ends with something to play on https://gamex-nu.vercel.app/proto. Each is checked
with Playwright at 412×915, DPR 2, with touch: no console errors, no flicker or z-fighting in
the screenshots, and frame time no worse than before the milestone at the same quality tier.

### M1. Lines with real routes (about 60–90 min)
- **New line** is enabled: tap stops in order, then Done. A line is its stops in order, plus its
  buses, with one livery. It runs A→B→C→B→A, or as a loop if you tap the first stop again.
- Buses on a line drive the shortest road route between consecutive stops (UK, on the left) and
  call only at that line's stops, on the correct side. Wandering buses are gone, and the starter
  town begins with one line.
- **Transport > Lines** lists each line with its stops and buses: add a bus, remove one, delete
  the line. Tapping a bus opens its sheet, showing its line and its next stop.
- **Accept:** draw a 3-stop line by touch. Within 2 game hours a bus has called at every stop,
  and at nothing else, in order. People queue and board at those stops only.

### M2. The economy runs the town (about 75–120 min)
- First, fix the failing `economy.test.ts` growth case without weakening it.
- Feed the library (`economy*.ts`, `econ*.ts`) from the game:
  - towns and zones from the town's streets;
  - buildings from the lots;
  - stops and lines from M1;
  - the Oracles from road route times.
- Advance it on the game clock. Its actions replace the queue stand-in: build, densify, vacate,
  abandon and demolish.
- `CrowdNumbers` comes from the economy, not `TownNumbers`: waiting, boarded and alighting per stop.
- **One town panel:** status and headline, reasons, residents and history, and homes near a stop.
  The "Stop catchments" layer is turned on.
- **Accept:** a well-served district's panel says *growing*, and buildings go up there within a
  few game days. Delete its line and it turns *stalling* or *declining*. The number waiting at a
  stop comes from the economy.

### M3. Money (about 30–60 min)
- You start with a balance. The HUD money slot comes from the economy's fare and running events.
- Roads, bridges, stops and buses are charged when built or bought. Bus offers map onto the
  economy's vehicle kinds.
- You can't build what you can't afford: the button greys out with the reason.
- Line rows show revenue and profit for last month.
- **Accept:** the balance drops when you build a road or buy a bus, and rises with fares. A busy
  line shows a profit, and an empty one a loss.

### M4. Railway stations and rail lines (about 60–90 min)
- Build > Stops unlocks the railway station: platforms on a straight run of track.
- The same line tool works for trains. They stop at the platforms and open their platform-side
  doors, and people board through each car's `doorPositions`.
- Trains feed the economy as rail stops and lines.
- **Accept:** build two stations and a rail line between them. Trains call at both. The towns at
  each end show the rail service on their panels, and fares come in.

## Estimates

These come from the measured AI throughput in the handover ("Estimating time"): a focused change
takes 5–15 min, and a stream with review and fixes 45–90 min. M1–M3 are the bus loop: about
3–4½ hours of our time, built in this session one milestone at a time, with at most one helper
agent. M4 adds 1–1½ hours.

Waits that aren't ours:
- Vercel builds take about 2 minutes a push.
- Your playtest on the Pixel between milestones.
