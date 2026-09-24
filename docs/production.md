# From here to production

Written 24 Sep 2026, evening. The first playable loop (buses, the town, money and rail) is done
(`docs/loop.md`). This is everything left before a public release, and how it splits across
sessions. Estimates use the measured AI throughput in `docs/HANDOVER.md` ("Estimating time"):
a stream with review and fixes takes 45–90 minutes, and a merge about 5.

## Everything left

### 1. A map big enough to test on (under way)
- [ ] **The region map (R1):** 6 × 6 km, about 33 times today's area, with a dozen towns, a
  motorway, A and B roads, a main line and a branch line (`docs/region.md`,
  `claude/work-region`).
- [ ] **One-way roads, slip roads and motorway junctions (R2):** `claude/work-motorways`.
- [ ] **Signalling:** blocks at stations and junctions, points set by route, passing loops, level
  crossings (R3, `claude/work-rail`). This replaces the loop's interim rule that keeps trains
  apart.
- [ ] **Streaming, levels of detail and a floating origin, so the region runs on a Pixel (R4):**
  `src/proto/world/` is built but not used yet.
- [ ] **Town names and labels, a places list, and trips between towns (R5).** The economy needs
  trips between towns before rail and coaches mean much.
- [ ] **The front menu and onboarding:** pick a map (`claude/work-front-menu`).

### 2. Stations (sent to the rail session)
- [ ] Platforms on curved track: they follow the curve, with a limit on radius.
- [ ] Stations on bridges where there's room: a viaduct station with stairs down.
- [ ] Underground stations in tunnels: platforms below ground, entrances at the surface.
- [ ] **An underground view toggle:** the ground fades and tunnels, underground platforms and
  their trains show. A HUD view button, like the 3D/map toggle.
- [ ] Trains open their platform-side doors; people queue on platforms and board through each
  car's `doorPositions`.

### 3. Traffic that looks and feels right
- [ ] **Quicker to take a gap:** drivers react too slowly when a gap opens. Look at the
  reaction delay, the acceptance checks each step and the commit hysteresis, and measure time
  from gap to go.
- [ ] **Pulling out at roundabouts:** give way to the right. Accept a gap from a vehicle's
  arrival time rather than its distance, count a vehicle leaving before your arm as no conflict,
  and don't wait for circulating traffic already past.
- [ ] **Front-wheel steering:** vehicles yaw as if every wheel steers. They should follow a
  bicycle model:
  - the front axle follows the lane;
  - the rear axle trails, so it cuts corners;
  - body heading comes from the axle line;
  - articulated buses and lorries have a pivot for each section.

  The swept path then matches real turns, and the conflict tables must use it.
- [ ] Simulate near the camera and use flows far away, so the region's traffic stays cheap
  (ENGINE.md: "simulate flows, show agents").

### 4. The loop, finished properly
- [ ] **Economy across towns:** reach weighted by distance (the fix that passes 61 of 62), then a
  decision on the last test, which checks a town while it's still in runaway office growth.
  Then tune growth, money and decline on the region.
- [ ] Growth and the town panel for each district and each town.
- [ ] A "Stop catchments" layer that means something at region scale.
- [ ] **Save and load:** versioned saves in IndexedDB, autosave, and the menu's Load. The
  economy already has `save()`. Nothing in the game saves yet, and that blocks release.
- [ ] Bulldoze and undo for roads, stops and stations.
- [ ] Freight after passengers: industries in the economy, lorries, terminals (backlog C).

### 5. Ready for real players
- [ ] **A green CI:**
  - fix the economy test (above);
  - [x] scale timing budgets by a measured machine factor: every timed test's budget goes
    through `budget()` (src/proto/test/speed.ts) and is timed in CPU time (bridges, terrain,
    water, game water, ground, world and economy benchmarks). Four budgets are loose enough that
    a 2× slowdown still passes on a reference-speed machine: water bench (42 ms of 200), terrain
    (34 of 250), game water (390 of 1500) and the conurbation month (90 of 1000). Tightening them
    is their streams' call;
  - [x] run the Playwright phone tests in CI: the `phone` job in .github/workflows/ci.yml runs
    lines, loop, rail, saving and loading, and the start menu (Playwright's own Chromium, via
    `CHROME`).
- [ ] **Performance on a real Pixel:** frame time, memory and heat on each quality tier. Every
  check so far ran under SwiftShader.
- [ ] **Known bugs:**
  - bridge blueprint checks take 20–160 ms (move them into a worker);
  - roads and bridges ignore the lake;
  - the 26 px flicker seam;
  - the frame-time increases after the library merges.
- [ ] **Look:** merge the ground PR (#21). Scenery and cyclists stay parked.
- [ ] **A first-run tutorial:** place a stop, draw a line, watch the town grow.
- [ ] **Release:**
  - installable PWA with offline play;
  - an Android build as a trusted web activity;
  - a store listing;
  - privacy notice;
  - error reporting.
- [ ] **Licences and names:**
  - credit OSM as ODbL and Tabler as MIT;
  - run the vehicle name check against trademarks;
  - review the game's name.
- [ ] **Real places last:** Horley and OSM import, real elevation, address onboarding.

## How to spread it

Up to six sessions at once. Each owns its own files and merges into
`claude/cloud-session-history-rvqkm1`, fetching and merging before every push.

| Wave | Stream | Branch | Owns | Starts |
|---|---|---|---|---|
| 1 (running) | Region map | `claude/work-region` | `src/proto/region/`, MapSpec | running |
| 1 (running) | Motorways | `claude/work-motorways` | one-way roads, interchanges | running |
| 1 (running) | Rail, signalling and station options (§2) | `claude/work-rail` | `src/proto/rail/` | running; §2 sent |
| 1 (running) | Front menu | `claude/work-front-menu` | `src/app/`, `maps.ts` | running |
| 2 | Traffic feel (§3: gaps, roundabouts, steering) | `claude/work-traffic-2` | `traffic.ts`, `conflicts.ts`, `fleet.ts` pose | after motorways merges, since both touch `traffic.ts` |
| 2 | Save/load and green CI (§4 save, §5 CI) | `claude/work-save` | `src/proto/save/`, CI, test machine factor | now: nothing overlaps |
| 3 | Streaming and performance (R4) | `claude/work-streaming` | `src/proto/world/` wiring | after the region merges |
| 3 | Economy across towns and loop tuning (§4) | `claude/cloud-session-history-rvqkm1` | `econ*.ts`, `game/econ.ts` | after the region merges |
| 4 | Release (§5: Pixel, PWA, TWA, tutorial, licences) | `claude/work-release` | packaging, docs | after waves 2–3 |

**Rough wall-clock time, from what's been measured:**
- Wave 1: about 2 hours, for the slowest of the four plus merges.
- Wave 2: about 1½ hours.
- Wave 3: about 2 hours.
- Wave 4: about 2 hours of ours, plus your time on the Pixel and store accounts.

That's about 7–8 hours of session time in all, over four waves. It isn't the sum of the
streams, because streams in a wave run in parallel.

**Waits that aren't ours:**
- your playtests between waves;
- usage limits (credit);
- the Play Store listing and review.

## Keeping credit use down
- **Archive finished sessions** (with your OK). The ten library sessions whose PRs merged, and
  "Larger test map", which the region session replaces. Several still wake hourly to re-check
  CI, which costs credit and does nothing.
- **One check-in per running session at most,** and none once its PR is merged.
- **Test at the right level:** vitest first, then one Playwright run per milestone. The full
  suite takes about 4 minutes; run it before a push, not after every edit.

## Briefs for the new wave-2 streams (paste into a new session)

**Traffic feel.** Continue "Untitled" in Libra-RobBaldwin/gamex. Branch from
`claude/cloud-session-history-rvqkm1` once `claude/work-motorways` has merged; work on
`claude/work-traffic-2`. Read `docs/production.md` §3 and `docs/HANDOVER.md` ("Standing rules").
Fix, in order:
1. Drivers are too slow to take a gap. Measure time from gap to go and cut it.
2. Roundabout pull-out logic: give way to the right, and judge gaps by arrival time.
3. Vehicle motion as front-wheel steering: a bicycle model with a trailing rear axle and
   articulated sections. The conflict tables use the true swept path.

`npx vitest run src/proto/traffic.test.ts` must stay green, with give-ups at 1% of trips or
fewer; never loosen tests. Check at 412×915, DPR 2, with touch. UK rules, drive on the left.

**Save/load and green CI.** Continue "Untitled" in Libra-RobBaldwin/gamex on `claude/work-save`,
branched from `claude/cloud-session-history-rvqkm1`. Read `docs/production.md` §4–5. Build
versioned saves in IndexedDB covering:
- roads, junction designs, stops, stations, lines and vehicles;
- the economy's `save()`, the purse and the clock;
- autosave;
- Menu > Save town and Load town.

Add a machine-speed factor for the timing tests (never loosen a budget), and add the
`e2e/*.e2e.mjs` phone tests to CI.
