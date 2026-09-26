# Brief: OS (real regions from Ordnance Survey OpenData, and priors for the generator)

Session https://claude.ai/code/session_01G4sVhwPzBo4cJhQ5dTvHKG. Branch `claude/work-os`.

- **PR #43:** merged at 7c7cae8.
- **Since then, on the branch and not yet in a PR:** dead ends that just stop, with footpaths
  (ebca930, 559a2cd). This session merged the integration branch into it at 01:20 UTC on 26 Sep.

## (a) Every request, and where it stands

### From the coordinator (the first task, 25 Sep)

1. "Real 50 km regions from free Ordnance Survey open data, and then using what real Britain
   looks like to make the seeded generator's maps realistic." Free data only.
   **Done:**
   - the OS Downloads API, no key: OpenMap Local, Terrain 50, Open Rivers, Open Names, Open
     Greenspace;
   - OSM is blocked, and the PR says what it would add.
2. Licence: "Contains OS data © Crown copyright and database right <year>" in the map data card
   and on any map built from it. **Done:** `#credit` on the map, Menu > About, and the previews.
3. Disk: per-100 km downloads, process, delete the raw files; commit only compact output, loaded
   per tile. **Done:**
   - the bake deletes its cache;
   - Exe is 5.8 MB and Teme 4.7 MB, in 5 km tiles.
4. **Phase 1:** a bake pipeline under `tools/` that turns a 50 km square into the game's map
   data. It should cover relief, coast and sea, rivers and lakes, woodland, buildings, roads by
   class, railways and stations, names and green space. **Done:** `tools/os/bake.mjs` writes
   `public/regions/<id>/`, in the format of `src/proto/real/format.ts`.
   - **Partly:** "the per-tile formats the world-scale session defines". The world-scale branch
     wasn't pushed when this was built, so it uses its own tile format. The fold-in below replaces
     that with the WORLD pipeline.
5. One or two showcase regions with varied character, never near the user's home.
   **Done:**
   - **Exe estuary:** Exeter, its coast, estuaries and hills.
   - **Teme valley:** Ludlow and the Shropshire Hills.
6. It must load and play at 412×915 and look right against the OS data, and the bus and rail loop
   must work on it. **Done:**
   - `e2e/real.e2e.mjs`: stops on real streets, a line with riders, two stations on the real
     track with a train calling at both;
   - the economy sees Exeter at about 132k people.
   - **Partly:** it plays a 6 km window of the 50 km, not all of it. The load is slow (142 s on
     the coordinator's run); see 12.
7. **Phase 2:** measure real data and feed the seeded generator one priors module with notes on
   where each number came from. **Partly:**
   - **Done:** `src/proto/region/priors.ts` and `tools/os/measure.mjs`, covering settlement
     spacing and sizes, the road hierarchy, junction shares and dead ends, orientation order,
     ribbon development, the coast's fractal dimension, and woodland patches, slopes and valleys.
   - **Fed in so far:** grid share, dead-end share, and the old 6 km region's woods.
   - **Not measured:** field sizes, which are not in OS data (needs OSM).
   - **Not fed in:** the 50 km generator (world50's `planWorld`).
8. Coordinate with world50, terrain-2, country and edge, keep edits to their files small, and
   list shared files in the PR. **Done** for #43.
9. The coordinator's later note: "one decision per screen … export a small list (id, name,
   one-line description, a thumbnail) and the wizard will show them". **Done:**
   - `src/proto/real/list.ts`, with 21–25 KB thumbnails;
   - the real regions' menu cards show them.

### From the user, directly (25 Sep)

10. "The dead ends being massive circles really hurts it … They should just be dead ends"; "All
    dead ends should be a standard dead end - not a massive circle!" **Done**, on every map:
    - `Network.turningHeads` is off (`xsection.ts`);
    - `joins.test.ts` keeps the old shape under the flag.
    - This changes the starter town at its cul-de-sacs.
11. "Maybe we need pedestrian paths"; "Dead ends should have a path at the end". **Done
    (generated):**
    - `src/proto/game/paths.ts`: through to the street ahead within 90 m, else a 12 m stub, clear
      of buildings, water, other roads and railways;
    - the paths claim their land and are drawn as one draped mesh;
    - Exeter has 526 of them (108 through), the town 8.
    - **Not done:** real footpaths. OS OpenData has none; they need OSM `highway=footway`.
    - **Checked:** all seven phone e2es pass on it, with loop and lines re-run cleanly at 01:35.

### From the coordinator (the resume, 26 Sep 01:15), from the user

12. "Real maps load far too slowly: Exeter took 142 s under SwiftShader. Aim for under 20 s on a
    mid-range phone: bake ahead of time, stream, and do less on the main thread." **Not started.**
    Where the time goes now (my runs, 67–85 s):
    - making the relief grid in the page: about 16 s;
    - laying the roads through the importer and designing the junctions: 6–7 s;
    - putting up 26–29k buildings: 17–23 s;
    - finishing the chunks: 4–17 s;
    - the region view: 6–7 s.
    All of it can move into the bake, or into workers and streaming.
13. "Fold the OS maps in, rather than keeping them as separate map cards. A real OS region should
    be a choice in the Region flow, the alternative to a seeded map. Both go through world50's
    single 50 km WORLD pipeline with the same rendering and gameplay; only the source differs."
    **Not started.** The proposed interface is below.
14. "Seeded maps should be as good as real ones, by learning from the OS data": coastline and
    forest shapes, settlement sizes and spacing, urban layout, the road hierarchy and how roads
    follow the land. Make the generator sample from them, and show seeded and real side by side.
    **Partly:**
    - **Done:** the priors are measured.
    - **Done (26 Sep, 01:40):** how roads follow the land, in `PRIORS.follow`, `roadClimb` and
      `valleyPreference`.
      - Grade: A roads have a median of 3% and a 90th percentile of 9–11%.
      - On slopes a road climbs at about half the ground's steepest slope.
      - Valleys: motorways run 13 m above the valley floor, A roads 24–32 m, lanes 36–48 m, against
        40–51 m for the land. Places stand at 22–29 m.
    - **Not done:**
      - wiring them into world50's `planWorld`;
      - a side-by-side view.
15. "Never use the user's home area, or anywhere near it." **Done.** Neither region is near it.
16. Phone first, no flicker or z-fighting; tsc, vitest and the phone e2es; a new PR with
    screenshots; hourly check-ins until merged. **Standing rules.**

## (b) Files and modules I own or expect to change

**Mine:**
- `tools/os/*`: bake, shp, bng, regions, preview, measure;
- `public/regions/*`;
- `src/proto/real/*`: format, osm, map, lay, load, list, node;
- `src/proto/region/priors.ts` and its test;
- `src/proto/game/paths.ts` and its test;
- `e2e/real.e2e.mjs`;
- `docs/real.md`.

**To add for the fold-in:** `src/proto/real/world.ts`, which builds a `WorldPlan` from a baked
region.

**Shared, small edits expected:**
- `worldmap/plan.ts` or `spec.ts`: a hook that takes a plan from a source. world50's call.
- `region/options.ts` and `app/regionsetup.ts`: a "real region" choice in the Region flow. Owned
  by the menu or world50.
- `maps.ts`: drop the Exeter and Ludlow cards once the flow has the choice.
- `main.ts`: take the real map out of its own path once it rides WORLD.
- `region/generate.ts` and world50's generator: sampling from the priors.

## (c) Overlaps with other sessions

- **world50:** the biggest overlap.
  - **Fold-in:** a real region must become a `WorldPlan` (settlements, water with sea and rivers,
    roads by class, rails with stations, terrain), streamed by its `WorldView`.
  - **Priors:** `planWorld` is where they belong.
  - **Proposed interface:**
    - `realWorldPlan(region: RealRegion, opts): WorldPlan`, with the same fields as
      `planWorld`'s;
    - a `WorldTerrain` that reads the baked heights, not noise;
    - `routes` from OS roads resampled to world50's `STEP`;
    - live-area roads and buildings from the tiles, as `layReal` does now.
    - world50 owns `plan.ts`, `view.ts` and `tilegen.ts`; I own `real/world.ts` and the bake.
- **terrain-2:**
  - the sea and coast: the real sea polygons, foreshore and tidal rivers are in the tiles, and
    `fractalCoast` in the priors is for the seeded coast;
  - real heights against terrain's landform presets.
- **countryside:**
  - woods and fields: `woodSpots` (the priors) against its woods;
  - the field-size prior, which is unmeasured without OSM;
  - OS Greenspace parks against its ground painter.
- **edge:** the real map's edge, where roads and rails leave the 50 km square (the tiles have
  them).
- **vernacular:** real buildings' look. OS gives footprints only, so the tradition could come from
  the region's geology (Devon or Marches). `buildgen.ts`: I added a big-church case (a lot far
  bigger than the spec draws at its size).
- **Shared engine edits I made:**
  - `roads.ts`: the `claimSeg` spike guard, and `turningHeads`;
  - `xsection.ts`: plain ends;
  - `game/econ.ts`: `byEdge`;
  - `region/mapspec.ts`: `ground`, `trees.spots`, `credit`, `placeBy`;
  - `region/terrain.ts`: uses `ground`;
  - `osm/import.ts`: exports `emit`.

## (d) Open questions

1. Does world50 accept `realWorldPlan` as a second source for `WorldPlan`, and does it own the
   hook in `worldmap/spec.ts` or `plan.ts`? Who adds the Region-flow step: the menu or world50?
2. **Speed target:** should real maps stream buildings per tile from the bake (baked lots per 1 km
   tile, spawned as tiles come near), with junctions pre-designed in the bake? That's the only way
   I see to reach under 20 s.
3. May I delete the Exeter and Ludlow map cards once the Region flow offers them? Saves on
   `map=exe` would need a migration.
4. The dead-end changes alter the starter town. Is that accepted? The user asked for it on every
   map.
5. Should real footpaths come from OSM if the user allows download.geofabrik.de? That would also
   give field boundaries, one-way streets and building uses.
6. **Housekeeping:** my old check-in trigger (`trig_013GtCHP7rnmTLWuPbJjyB2r`) was deleted at the
   pause, as the pause asked, not disabled. I'll make a new one for the new PR.
