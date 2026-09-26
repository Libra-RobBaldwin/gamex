# The region: the one map

The game has one map, the 50 km region, made by the WORLD pipeline (`src/proto/worldmap/`): a plan of
settlements, water, relief and lanes from a seed, or from a real Ordnance Survey region, then fine detail
a tile at a time round the camera. How it's made is in `docs/world.md` and `docs/streaming.md`; what
`src/proto/region/` still provides to it is in `docs/regiongen.md`.

It replaced the starter town, the sandbox, the 6 km region and Real Town Plans (the one-map clean-up,
`docs/briefs/PLAN.md`, 26 Sep 2026). An old address for any of those opens the region setup with a note;
an old save is listed as made on a map that no longer exists, with only Delete.
