# Brief: OS (real regions from Ordnance Survey OpenData, and priors for the generator)

Session https://claude.ai/code/session_01G4sVhwPzBo4cJhQ5dTvHKG. Branch `claude/work-os`.
Updated 26 Sep, 09:10 UTC, for the one-map plan (PLAN.md, top section).

Nothing below is marked done unless it's live and I've checked it on a 412×915 screenshot.

## What the coordinator asked (26 Sep, 07:45), and where it stands

1. **Fold real regions into the WORLD pipeline** (`real/world.ts`, a `WorldSource`, streamed by
   world50's view, with the same gameplay). **Done, checked at 412×915** on Exe and Teme:
   - `real/world.ts` is the source. It gives:
     - places from Open Names;
     - the land from Terrain 50;
     - the sea from tidal water plus sea-level ground;
     - rivers from Open Rivers;
     - roads and railways by class from OpenMap Local;
     - woods.
   - It registers itself on the main thread and in the tile worker.
   - `?map=region&real=exe` makes the 50 km map. Screenshots show:
     - the real Exe estuary, with Topsham, Exmouth, Dawlish and Crediton, the M5 and the sea;
     - the whole 50 km of the Teme valley, with Ludlow, Craven Arms, Tenbury Wells, Bishop's Castle
       and Bromyard.
   - **The live 8 km area is the real one,** restored from the bake's pack inside the WORLD path. It
     has the real streets, junctions, 38k buildings round Exeter and 7.6k round Ludlow.
   - **Same gameplay:** `e2e/real.e2e.mjs` passes on it. It builds bus stops on real streets and a
     line with riders, then two stations on the real railway with a train calling at both.
   - **Load time under SwiftShader:** Exeter 53–60 s, Ludlow 21–22 s. The far scenery then streams
     in over about a minute.
   - The Exe bake was re-made centred on Exeter, since a 50 km map's home place is its middle.
     Torbay is off the square now.
2. **Delete the separate real-map path.** **Done:**
   - `real/load.ts` is gone, along with `packMap` and the pack's own copy of the map.
   - The two real branches in `main.ts seedTown` are replaced by one inside the WORLD path.
   - **Still here, and why:**
     - `real/map.ts`, `lay.ts` and `osm.ts`: `tools/os/pack.mjs` runs them at bake time to make the
       live area. The game doesn't load them.
     - `lay.ts parkLeafiness` is used by the game.
     - `real/live.ts` restores the pack inside WORLD.
3. **Keep `?map=exe` and `?map=teme` as aliases, with a save migration.** **Done, not yet checked by
   hand:**
   - `?map=exe` opens `?map=region&real=exe`, and a game saves with the long form.
   - A save from the old 6 km map (`map=exe`, no `real`) opens the region afresh, saying so. That
     path has no e2e yet.
   - The menu's labels for those saves are the coordinator's (`src/app`).
4. **Priors into the seeded plan, and seeded and real side by side.**
   - **Side by side: done, checked at 412×915.** See `docs/reports/os/side-whole.jpg` and
     `side-town.jpg` (seed 42 against Exe, the same pipeline and camera).
   - **The measurements:** `tools/os/compare.mjs` puts both plans on the same yardsticks
     (`docs/reports/os/seeded-vs-real.md`).
   - **Already wired:** settlement counts and spacing. world50's `planWorld` reads
     `PRIORS.settlements`, and the seeded maps match the priors.
   - **Not wired, and not my files.** Each item has its number in the report:
     - **world50 (`routes.ts`):** lanes climb at 1.3% median against 3.2–4.2% for real minor roads;
     - **world50 and countryside:** there are about a third of the real lane length;
     - **terrain:** the seeded land sits about 100 m too high, a plateau.
     I haven't edited those owners' files.
5. **`docs/briefs/os.md` current and honest:** this file.

## Known problems (seen on screenshots, not fixed)

- **The live area's edge cuts the real town.** Exeter's buildings run right to the 8 km square's
  edge, and beyond it the scenery draws no real buildings (see the next item). It shows as a hard
  diamond when zoomed out.
- **Heavy over a real city centre.** Close in over central Exeter, 63 building chunks draw about 38
  materials each: 2,400–2,900 calls. That's the same as the old 6 km path had at the start, and comes
  from how many materials the buildings use (vernacular). Zoomed out, the shared region view never
  swaps its near tiles for far ones, on seeded maps too, so it stays near that count. I made a real
  map settle its whole live area at load, so every other tile gets its merged far buildings: 3,365
  calls zoomed out went to 2,904, at no cost to the load.
- **Heavy when zoomed out over a real city (before that change).** Over Exeter, zoomed out (h 6,000–40,000), a frame draws
  3,100–3,500 calls and 3.4–4.2 M triangles, because all 38k live-area buildings are drawn. Ludlow is
  1,600 calls and 2 M triangles. A seeded start town is far lighter. The live area's buildings need a
  far level of detail (regionView, shared).
- **Far towns are generated, not real.** Beyond the live area each real place is drawn as the plan's
  generated town at its real place and size. Their real buildings are in the bake, but there's no
  scenery hook for them yet (world50's `tilegen.ts`).
- **The economy overcounts:** 178,000 people in the 8 km round Exeter, against about 130,000 for the
  real city.
- **Ways off the map have made-up names.** The edge's portals are named by the generator. Real names
  beyond the square need Open Names outside it, which the bake doesn't keep yet.
- **Industries:** the real source gives none yet.
- **Streaming under SwiftShader** takes about a minute to fill the whole 50 km.

## Files

- **Mine:** `tools/os/*`, `public/regions/*`, `src/proto/real/*` (new: `world.ts`, `worldmap.ts`,
  `world.test.ts`), `region/priors.ts`, `game/paths.ts`, `e2e/real.e2e.mjs`, `docs/real.md`.
- **Shared, small hunks this round:**
  - `main.ts`: the map choice, the old-save redirect, the pack branch inside WORLD, and real live
    places starting live;
  - `worldmap/tile.worker.ts`: one import;
  - `region/options.ts`: the `real` field;
  - `main.ts`: `regionView.settle(…, all)` on a real map.

## Open questions

1. **world50:** a scenery hook for a real place's buildings (the bake has them), and a far level of
   detail for the live area's buildings.
2. **edge:** should I add Open Names beyond the square to the bake, for real portal names?
3. **coordinator:** real regions in the Region flow read `REAL_REGION_LIST`. The ids and names are
   unchanged, and the Exe thumbnail is redrawn for the new square.
