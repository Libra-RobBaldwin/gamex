# The region map: many towns, motorways and railways

**What the user asked for (24 Sep, ~14:50):** the test map is one town. They want one about
30 times the size with lots of towns in it. That lets them test scale, and motorways and
railways linking the towns. It needs train stations.

**The goal:** a second map, `/proto?map=region`, about **6 × 6 km** (36 km², 33 times today's
1.04 × 1.04 km). It holds a dozen settlements of different sizes, joined by:

- a motorway with proper junctions;
- A and B roads;
- a main line and a branch line, with stations in the towns.

It has to stay smooth on a Pixel in portrait. The invented town stays the default map and
doesn't change. Everything here is in its own module, so it can't break the bus-loop work in
`docs/loop.md`.

"30 times the width" (31 km) is a different job: that's the tiles and far level of detail in
`ROADMAP.md` step 4. The 6 km map is the step that proves the engine can take it. The
generator is written so the same code can later lay out a 30 km map tile by tile.

## What's missing today

Checked against `claude/cloud-session-history-rvqkm1` at 95f5d5d.

| Gap | Where it is now |
|---|---|
| The map size is fixed. | `BOUND = 520`, one `LAKE`, the `INDUSTRIAL` rule and `CENTRE` are constants in `main.ts`. The same goes for the ground plane, tree scattering, `GameWater(520 * 1.3)` and camera limits (`hMax: 900`). |
| There's one town, drawn by hand. | `seedTown()` is ~40 hand-placed roads. Plots are queued outwards from one `CENTRE`. |
| No one-way roads, slip roads or interchanges. | A motorway is one two-way segment ending at a roundabout (ROADMAP step 2 was never started). |
| No railway stations or platforms. | Build > Stops shows "Railway station — Not in the game yet". |
| Trains don't signal each other. | `moveTrains` picks the straightest track and reverses at dead ends. There are no blocks or signals, and no timetable. Two trains on one line can run through each other. |
| No level crossings or depots, and no choice at points. | |
| Every edit rebuilds the whole network. | Done on the region (R4, `docs/streaming.md`): an edit designs again only the junctions whose roads changed and redraws only the 250 m cells that changed. The town still does it all, as before. |
| Traffic has one global cap. | Done on the region (R4): trips start near the camera and cars well away from it leave the road, so the cap is per view. |
| The world tiles and streaming aren't used. | Done (R4): the region streams 1 km tiles through `world/StreamManager` at three levels of detail (`game/regionview.ts`). The workers aren't used yet. |
| The economy isn't in the game yet. | Loop M2. It's per town (`TState`), so many towns fit, but there are no trips between towns. |
| No way to find your way round a big map. | There are no town names or labels when zoomed out, no overview map and no "go to town" list. |

## Milestones

Each milestone ends with something to play at `https://gamex-nu.vercel.app/proto?map=region`.
Each is checked with Playwright at 412×915, DPR 2, with touch. The checks are: no console errors,
no flicker or z-fighting, and the frame-time budgets below. The invented town (`/proto`) must be
no slower than before.

### R0. A map is data, not constants (30–45 min)
- A `MapSpec` has the bounds, water bodies, zone rules, a list of settlements (centre, size,
  kind, name) and a seed. `BOUND`, `LAKE`, `INDUSTRIAL` and `CENTRE` move into it.
- The following all read the `MapSpec`: ground, water, trees, `Network` bounds, camera limits
  and plot queueing (nearest settlement first, not nearest `CENTRE`).
- `seedTown()` becomes the `town` map. `?map=` picks the map, and `town` is the default.
- **Accept:** `/proto` looks and measures the same as before (screenshot and frame time). An
  empty 6 km `?map=region` loads, pans and zooms out to the whole map.
- **Clash to avoid:** this touches the top of `main.ts`, which the bus-loop session is editing.
  Land it right after loop M1 merges, as a small mechanical diff, and tell that session.

### R1. Settlements (60–90 min)
- `src/proto/region/` generates a seeded region, pure and testable with no three.js:
  - 1 city (about twice today's town);
  - 3 market towns (about the size of today's town);
  - 6–8 villages.
- They're spaced by Poisson-disc sampling and kept off water. There are 1–2 lakes and a river
  from the water library.
- Each settlement gets its own street pattern from its kind and seed:
  - a centre with a high street;
  - a grid or organic residential streets;
  - an industrial edge for the city and towns.
- Plots, infill and buildings come from the existing `Network` / `buildgen` code. There's no
  second building system.
- Names are invented and plausibly English. They're checked like vehicle brands, so no real
  place name.
- **Accept:** 10–12 distinct settlements, each with plots filled. Two seeds give two different
  regions, and one seed always gives the same region (test).

### R2. Roads that link them (90–120 min, including one-way roads)
- **One-way roads first** (ROADMAP step 2). Add a `oneway` flag on segments, which traffic,
  routing and drawing all respect. A motorway becomes a pair of one-way carriageways.
- **Motorway junctions** are built from the existing pieces:
  - slip roads (one-way, with DMRB taper and merge lengths from `standards.ts`);
  - a bridge over or under the motorway;
  - two roundabouts (dumbbell) or one (a grade-separated roundabout).
  The junction designer treats them as one junction.
- **The network:**
  - one motorway across the map, with 3–4 junctions near the biggest places;
  - A roads between towns (a Gabriel graph, trimmed to the shortest links);
  - B roads out to the villages.
  - Rural speed limits come from the catalogue.
- **Accept:** from any settlement, traffic can reach any other (test). Cars join and leave the
  motorway only by slip roads, in the right direction. The traffic harness's zero-overlap test
  passes on a motorway junction scenario.

### R3. Railways, stations and trains that don't collide (120–150 min)
- **Stations are the same thing as loop M4:** platforms on a straight run of track, bought from
  Build > Stops, and the same line tool. One stream builds them, not two (see "Who does what").
- **The generated railway:**
  - a main line through the city and two of the towns;
  - a branch line off it to a village;
  - a station in each of those places, with passing loops at the stations.
- **Signalling:** track is split into blocks at stations and junctions. A train enters a block
  only when it's clear, and points are set by the train's route. There are no more wandering
  trains: every train runs a line (stations in order) from a depot siding.
- Where track crosses a road at grade, there's a level crossing with barriers that hold
  traffic.
- Trains stop at platforms, open their platform-side doors, and people board through
  `doorPositions` (vehicles and people libraries).
- **Accept:**
  - Two trains on a single line with a passing loop run for 2 game days without ever sharing
    a block (test).
  - A player-built station and line work on both maps.
  - A level crossing never lets a car onto the track while a train is in its block (test).

### R4. Keeping 6 km smooth (90–120 min)

**Done** (`claude/work-streaming`): how it works and what was measured is in `docs/streaming.md`.
Not done: building generation and the generator in the worker; spawning at each link's flow rate.

- **Streaming:** plug in `world/StreamManager` with 1 km tiles:
  - near tiles: full buildings and markings;
  - middle tiles: building massing and roads as ribbons;
  - far tiles: settlement silhouettes, with only trunk roads and rail drawn.
- **Edits re-derive only what they touch:** `commitRoads()` becomes `world/DirtyPipeline` stages
  per tile. A junction is redesigned only when its roads changed. `drawRoads` redraws only dirty
  tiles.
- **Traffic near the camera only:** cars are spawned on links within about 1 km of the camera,
  at the rate each link's flow implies. Further out there are flows only (ENGINE.md). The
  global `MAX = 300` becomes a per-view cap.
- Building generation moves into the worker (`world/worker.ts`), and so does the region
  generator for the first load.
- **Budgets on the region map** (SwiftShader first, then the user's Pixel):
  - first load under 6 s;
  - an edit under 50 ms;
  - zoomed in over the city: frame time no worse than `/proto` today at the same tier;
  - fully zoomed out: under 600 draw calls.
- **Accept:** the budgets hold in a scripted fly-over of every settlement. The `/proto` numbers
  don't get worse.

### R5. Getting round, and towns that trade (60–90 min)
- **Finding your way:** town names float over settlements when zoomed out. A "Places" list
  jumps the camera to any town. There's a small overview map.
- **The economy across towns:** each settlement is an economy town (once loop M2 lands). A
  gravity model gives trips between towns, so an A road, a coach line or a rail line between
  two towns carries people and changes how both grow. The town panel says where its people
  travel to.
- **Accept:** linking two towns by rail raises trips between them, and the panel of each
  shows it. Cutting the line lowers them.

### F. The front of the app: a start menu and onboarding (the user, 24 Sep ~15:05)

Opening the app today drops you straight into the game. It should work like an application.

- **Start screen:** branded "Untitled" (the green, League Spartan + Archivo, Tabler icons, no
  emoji). It has **Continue** (when there's a save), **New game**, **How to play**,
  **Settings** and **About** (credits, with "© OpenStreetMap contributors").
- **New game** lists the scenarios from one registry (`src/proto/maps.ts`), each with a name,
  a line of description, a picture and its state:
  - **Starter town** (today's map);
  - **Region** (this plan; shown as "coming soon" until R1 marks it ready);
  - **Real town** (`?place=`, Horley and the Real Town Plans places);
  - **Sandbox** (an empty map).
- **First visit:** a short guided start of 3–5 steps: move the map, build a road, place a stop,
  start a line. You can skip it or replay it from How to play. Whether it has been seen is
  stored in `localStorage`, and the app works when that's blocked.
- **It behaves like an app:**
  - The 3D game isn't loaded until you pick a scenario (a dynamic import), so the menu opens
    instantly.
  - The phone's back button and a menu button in the HUD return to the menu, after asking to
    save.
  - `/?map=<id>` and `/?place=<id>` deep links skip the menu.
  - It works offline (the existing service worker), in portrait and in landscape.
- **Accept:**
  - A fresh visit at 412×915 shows the menu, not the game, and the first frame arrives in
    under 1 s.
  - Every ready scenario starts, and back returns to the menu with no console errors.
  - A deep link goes straight in.
  - The guide shows once, and again from How to play.

## Cloud sessions (started 24 Sep ~15:10)

The work is split so that each session owns its own files. Every session starts from
`claude/cloud-session-history-rvqkm1`, merges it in often, and opens its PR back into it.

| Session | Branch | Owns | Steps |
|---|---|---|---|
| Front menu and onboarding | `claude/work-front-menu` | `index.html` boot, `src/app/`, `src/proto/maps.ts`, the HUD menu button | F |
| Region generator | `claude/work-region` | `src/proto/region/`, the `MapSpec` refactor at the top of `main.ts` | R1, then R0 |
| One-way roads and motorway junctions | `claude/work-motorways` | additive changes to `roads.ts`, `traffic.ts`, `roaddraw.ts` and `junction.ts`, and `src/proto/interchange/` | R2 (the one-way flag, slip roads and junctions; the region's links once R1 lands) |
| Stations and signalling | `claude/work-rail` | `src/proto/rail/` | R3 |

- **The contract between the menu and the maps:** `MAPS` in `src/proto/maps.ts` has, for each
  map, an id, a name, a description and a `ready` flag, and `?map=<id>` picks it. The menu
  session creates the file. The region session only flips `region` to ready and adds its
  loader.
- **The bus loop** keeps M1–M3. The rail session builds the station, platform and signalling
  library, and hands M4 a ready API instead of both building stations.
- R4 (streaming and performance) and R5 (labels, places list, trips between towns) start once
  R1–R3 have merged.

## Who does what (other sessions are running)

The other sessions running now, and how this plan stays out of their way:
- **Bus loop** (`claude/cloud-session-history-rvqkm1`): M1–M4 in `docs/loop.md`. It edits
  `main.ts`, `traffic.ts` and the HUD.
  - **Stations (loop M4 and R3)** are one piece of work. The recommendation is that this
    stream builds stations, signalling and rail lines, and the loop session stops at M3.
    Otherwise the loop session builds M4 and R3 adds the generated railway and signalling on
    top. The user decides; tell the loop session either way.
  - R0 lands after loop M1, so the two don't both rewrite the top of `main.ts` at once.
- **Map and road rendering** (`claude/map-road-rendering-issues-nz1b6f`): ground PR #21 and
  give-way markings. There's no overlap, apart from `main.ts`'s ground setup, which R0 touches.
  Merge #21 before R0.
- **Game test URL** (`claude/game-test-url-ti3d9f`, PR #27): the front page becomes the 3D game.
  `?map=region` works the same on whichever path serves the game.

New code goes in `src/proto/region/` (generator, `MapSpec`, settlements, network layout) and
`src/proto/rail/` (stations, blocks, signalling, crossings). Changes to shared files are kept
small and listed in each PR.

## Order and time

These estimates use the measured throughput in `HANDOVER.md` ("Estimating time"), not a human
developer's.

| Step | Ours | Can run alongside |
|---|---|---|
| R0 map as data | 30–45 min | after loop M1 merges |
| R1 settlements | 60–90 min | R0 can be skipped at first: the generator is pure and tested on its own |
| R2 one-way, motorway junctions, links | 90–120 min | after R1 |
| R3 stations, signalling, rail | 120–150 min | alongside R2 (a separate module) |
| R4 streaming and performance | 90–120 min | after R2 and R3 |
| R5 labels, places list, trips between towns | 60–90 min | after loop M2 |

**In total:** about 7½–10½ hours of our time done one after another. With R2 and R3 in
parallel sessions, it's about 5½–8 hours wall-clock. The first playable region, with towns and
roads between them (R0–R2), is about 3–4½ hours in.

Waits that aren't ours:
- a Vercel build per push (~2 min);
- the user's Pixel playtest between milestones;
- usage limits.

## Decisions for the user

1. **Size:** 6 × 6 km (30 times the area) now, with 30 km wide left to tiles and far LOD
   later? Recommended.
2. **Stations:** does this stream build stations and rail (recommended), or does the bus-loop
   session's M4?
3. **Priority against the bus loop:** start R1 now, alongside it (it's self-contained), or
   wait until loop M3 is done?
