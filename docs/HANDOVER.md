# Handover: where everything stands (24 Sep 2026, ~10:15 UTC)

The previous session ran on the org account and hit its usage limit mid-flight. Every
background build stopped at once. Nothing was lost: every piece of work, finished or not,
is committed and pushed. This file tells the next session what each piece is and how to
carry on.

Read this first, then `docs/ROADMAP.md` (direction), `docs/ENGINE.md` (architecture) and the
per-library docs in `docs/`.

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

- **Network:** the cloud environment's policy blocks the OSM hosts. Fetching real map data needs `overpass-api.de` (and the mirror `overpass.kumi.systems`) allowed in the environment's Network access settings.
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
