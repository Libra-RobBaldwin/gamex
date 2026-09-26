# Brief: terrain (claude/work-terrain-2)

Session https://claude.ai/code/session_01Nh7v6jcJg3HUUibZ9harsP. Rewritten 26 Sep 2026 for the one-map plan
(docs/briefs/PLAN.md, top section). "Checked" below means seen on a 412×915 screenshot of the live build
or of a local build of the named commit.

## Live (merged into the integration branch)

**PR #46: the 50 km land (merged 06:17 UTC).**
- One height function for the 50 km map (`worldmap/terrain.ts`), from a coarse landform pass over the map
  (`worldmap/landform.ts`): ranges, scarps, massifs and rolling hills cut by their rivers, floodplains,
  glacial valleys, drowned valleys, lakes, and rock type (`geologyAt`).
- Water from it (`worldmap/water.ts`):
  - a sea with a fractal coast, or islands;
  - rivers widening to estuaries, each at its own level;
  - lakes with smooth shores.
- Seven landform presets and the islands option (`region/options.ts`).
- Checked on screenshots: the coast, mountains and islands, and whole-map hillshades (docs/reports/terrain/).
- **Not good enough:** the user, 07:30: "it still looks as flat as a pancake". The default first view showed
  a flat field, and the hills didn't read at the game's zoom.

## In a PR, not yet live

**The relief fix: hills you can see from the default camera.**
- **The start town's valley.** Its sides rise within about 1.5 km of the town's edge. Measured on seed 7: vale
  +47 m, coast +85 m, uplands +94 m, mountains +458 m. The town's own flat now stops close to its edge.
- **Knolls round the start.** They're a few hundred metres across, 10–32 m high by landform, and inside the
  live area only. The trunk routes beyond it keep their grades, and routes.test passes.
- **Lighting, all in `region/terrain.ts`:**
  - the ground is lit 4.5× steeper than it is;
  - on the 50 km map, the sun is lower in the south-west, with less sky light and more sun;
  - light-only swells: a sum of waves, the same in JS and GLSL, so a hillside isn't one evenly lit slope.
- **Fields drawn over the ground** (the countryside's overlays) now take the hills' normal. Before, they were lit
  as if flat whatever the ground under them, which was the main reason the relief didn't read.
- **Junctions:** two legs meeting at a sharp angle now join as straight kerbs. Their corner was being built
  kilometres away and overflowed the land registry, so islands seed 42 never loaded.
- **Checked:**
  - the low views on coast and uplands show lit and shaded slopes;
  - the mountains first view shows the valley sides.
- **Still weak:** the coast and vale default first views (h 300) are mostly the start town's own level ground,
  so they still look flat at that zoom. World50 owns the first view's framing.

## Not done

- **One generator (PLAN.md):** committed on the branch (4eb90c6), not pushed yet. It waits for #53 to merge, so
  #53 stays small.
  - `region/water.ts` is merged into `worldmap/water.ts`.
  - `region/terrain.ts`'s height field and lighting are merged into `worldmap/terrain.ts`.
  - The 6 km hill generator is deleted. `makeRelief` now only wraps a real map's own heights.
  - The region still loads and looks the same (checked at 412×915, coast seed 7).
  - `game/corridors.ts` never reached the integration branch, so there's nothing to delete.
  - **Still open:** `terrain/procedural.ts` and `water/coast.ts`. They're a second height and coast generator,
    used only by the water library's own tests and demo, not by the game. Deleting them means moving those
    tests onto the 50 km land.
- The coarse pass (about 0.65 s) runs on the main thread and in each tile worker. It isn't yet in a worker of
  its own.
- Lowland maps have no lakes (reservoirs).
- Rivers are only as wide as the width law gives. Small streams aren't drawn.
- routes.test "motorways keep to their grade" only passes on seed 42 (seeds 7 and 11 would fail on this
  land). That's world50's router.
- Far towns built in the tile workers don't get `geologyAt` (vernacular).
