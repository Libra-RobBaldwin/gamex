# The region generator, and maps as data

`src/proto/region/` covers steps R1 and R0 of `docs/region.md`. It's pure (no three.js, no DOM) and tested in
`region.test.ts`. Play it at `/?map=region` (seed 7).

## A seed and a few settings (`options.ts`, `styles.ts`)

Like Transport Fever 2's new-game screen, a generated map is its options. The same options always make the same
map, in about 30 ms, and the URL carries them all:

    /?map=region&seed=12&rivers=2&lakes=3&towns=4&villages=9&city=1&style=desert&relief=rolling

| Option | Values | Default |
|---|---|---|
| `seed` | any whole number | 7 |
| `rivers` | 0–3, each right across the map, in its own band (they never cross) | 1 |
| `lakes` | 0–4 | one or two (the seed decides) |
| `city` | 1 or 0 | 1 |
| `towns` | 0–6 | 3 |
| `villages` | 0–12 | six to eight (the seed decides) |
| `style` | `temperate`, `desert`, `arctic`: the ground's palette and crops, the woods (how many, how many conifers, their colour) and the sky | temperate |
| `relief` | `flat`, `lowland`, `rolling`, `upland`, `mountain` (the terrain library's presets) | flat. It's recorded now; see "Hills" |

`optionsQuery(options)` gives the URL back, which is what a new-game screen (the front-menu session's `maps.ts`)
would build. Names, positions and water each draw from their own seeded stream, so changing one setting doesn't
reshuffle the rest more than it has to.

## Next: hills, and real places, on the same pipeline

The generator's steps are the same whether the map is invented or real. Only where each input comes from changes:

| Step | Invented (seed + options) | Real (a postcode or place) |
|---|---|---|
| Ground | `ProceduralTerrain` from `relief` and the seed | `TerrariumHeight` (AWS terrain tiles, world-wide) or OS Terrain 50 (UK), both already in `src/proto/terrain/` |
| Water | rivers and lakes from the options (later: down the terrain's valleys) | OpenStreetMap water |
| Settlements | Poisson-disc sites on gentle, dry ground | OSM places (city, town, village) and their built-up areas |
| Streets | the lattice in `layStreets` | OSM roads (`src/proto/osm/`, as the Real Town Plans page and the parked Horley work do) |
| Look | `style` | picked from latitude and land cover |

So the next step for "hillier" is the terrain integration plan in `docs/terrain.md` (8 steps). Steps 1–3 change
nothing on screen. Steps 4–5 replace the grade solver in `roads.ts` and the cutting drawing in `roaddraw.ts`, which
the motorway session is editing now, so the steps clash unless they're sequenced. Recommended order:

1. Once motorways (R2) merges: terrain steps 1–3, plus the generator placing settlements on gentle ground and
   running rivers down valleys (a "rolling" region).
2. Terrain steps 4–7: roads, rail, plots and water on real slopes, first on the region with `relief=rolling`, then
   the town.
3. Real places: a postcode gives a centre, and step 8 (real elevation), OSM water, places and roads fill the same
   `MapSpec`.

## Maps as data (`mapspec.ts`, `town.ts`, `index.ts`)

A `MapSpec` is everything map-specific the game reads:

| Field | What reads it |
|---|---|
| `bound` | the Network's bounds, the camera's bounds and zoom-out limit (`hMax = 900 × bound / 520`), the ground's size (1.3 × bound for the town, 1.5 × on a bigger map), tree scattering, the ground painter's area |
| `water` | `GameWater(half, map.water)`: lakes (bowls) and rivers (channels), as the ground the water library fills |
| `zones` | `net.zoneAt` (industrial polygons or boxes) and the ground painter's industrial land |
| `settlements` | plot queueing: nearest centre first. Each road's plots are laid out from its settlement's centre, as central as its size says: a city's bands are twice as wide, and a village has no towers (`plotCentre`, `centrality`) |
| `streets` | `buildStreets(net, map.streets, DEFAULT_OPTS, map.generated)`: `net.build` calls with catalogue road types |
| `view`, `stops`, `line` | where the camera starts, the first bus stops and the starter line |
| `trees`, `industries` | woodland trees scattered, and whether the town's library industrial sites are placed |

`mapById(id)` picks the map from `?map=` (the town is the default). `TOWN_MAP` is the old `seedTown()`, `BOUND`, `LAKE`,
`INDUSTRIAL` and `CENTRE`. With it, the town's roads, plots, buildings, junctions and infill come out byte-identical
to before, and so do its water mesh, isWater and outline (checked by dumping the world after load, before and
after).

When the front-menu session's `src/proto/maps.ts` lands, its `region` entry takes `regionMap()` as its loader,
and `main.ts` reads the map from there instead of calling `mapById`.

## The generator (`generate.ts`)

`generateRegion(seed)` makes a 6 × 6 km map (bound 3000):

- **Water:** a river right across the map (off both edges of the ground), meandering on two slow waves,
  16–22 m wide; one or two lakes (110–170 m) at least 350 m clear of it.
- **Settlements:** one city (440–480 m to its edge), three market towns (230–270 m), six to eight villages
  (110–160 m). They're placed by Poisson-disc dart throwing: the city first, near the middle, then the towns, then the
  villages. Each is kept apart from the others by both their reaches plus a gap (750 m, or 420 m with a village), and
  off water.
- **Streets:** a lattice in each settlement's frame (85–90 m blocks; 80 m in villages) inside a wobbly circle:
  - row 0 is the high street (a boulevard through the city centre, then an avenue; an avenue in towns; a
    wide-pavement street in villages);
  - column 0 is the main cross street;
  - the city and towns get an industrial edge of double-length blocks with a zone rule;
  - organic plans jitter the lattice, bend the streets and leave about 30% out, but always keep a spanning tree.

  Streets whose band comes within 30 m of water, or 60 m of the map's edge, are dropped. The rest come out in
  the order they're reached from the centre, each starting on a street already built. `buildStreets` in
  careful mode also refuses any street after the first that doesn't start on the network, so every
  settlement is one connected piece.
- **Names (`names.ts`):** a first element (a tree, a bird, a landmark…) and an English place-name ending,
  sometimes with "Little …" or "… Green" on villages. They're checked against `REAL_PLACES` (about 450 real UK
  names, towns and the real places these elements make): no exact match, and nothing one letter off a real name
  of seven letters or more, with or without its "Little" or "Green".
- **Links, for the motorway and rail sessions:** `region.links`:
  - A roads: the Gabriel graph of the city and the towns;
  - B roads: each village's two shortest Gabriel links, plus whatever keeps everywhere reachable;
  - `water: true` where the straight line crosses water.

  `settlements[i].gates` are the high street's ends, where roads from outside should come in.

## In the game (`main.ts`, `game/water.ts`, `ground/game.ts`)

- **Water:** `GameWater` takes the map's `WaterSpec`. Lakes are drawn as before, as a ring in the ground mesh
  for each. A river is a channel filled to the lake level (still water for now). Its bed is a strip drawn in a
  ground material of its own that marks the stencil first. The flat ground leaves out what it marked (as it does
  for cuttings), so they never z-fight at the strip's edges.
- **Loading a big map:** all the streets are built and committed at the start. Then:
  - the settlement you start over is built at once;
  - the others' plots stay at the front of the queue (so nothing else takes them) and go up over the next frames,
    6 ms a frame, nearest first;
  - then the trees are cleared and the ground repainted once.

  `proto.seeding()` says how many plots are left.
- **What's off on the big map until R4 (streaming):**
  - 3D hedgerows: 1.34 M triangles over 6 km. The fields and their boundaries are still painted.
  - Cover texels are 4 m, not 2.5 m.
  - Building chunks are 240 m, not 120 m.

## Numbers

See PR #29 for load time, frame time, draw calls and triangles against `/`.
