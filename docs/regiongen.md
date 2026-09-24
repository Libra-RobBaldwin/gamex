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
| `relief` | `flat`, `lowland`, `rolling`, `upland`, `mountain` (see "Hills") | rolling |

`optionsQuery(options)` gives the URL back, which is what a new-game screen (the front-menu session's `maps.ts`)
would build. Names, positions and water each draw from their own seeded stream, so changing one setting doesn't
reshuffle the rest more than it has to.

## Hills (`terrain.ts`, `drape.ts`)

The region is rolling by default (`relief=rolling`). `relief` goes from `flat` to `mountain`, with hills of
0, 10, 32, 60 or 110 m. The town stays flat.

- **The height field** (`region/terrain.ts`, pure): seeded gradient noise on a 25 m grid, three octaves, plus
  ridges on upland and mountain maps. It's level in and round every settlement (60 m past its industrial edge),
  along every river and round every lake, then swells up over the next 450–650 m. So towns, their streets and plots,
  and the water stand on the flat as before, and the hills are the country between them, where the motorway and the
  railway run. Rolling hills reach about 28 m, and the steepest grid slope is about 8%. It takes about 240 ms to make.
- **Everything follows it** (`drape.ts`): each material's vertex shader adds the height at its world x, z.
  - Built-in materials get this through `project_vertex` and `worldpos_vertex`, so shadows are received right.
  - Sprites, route lines and the water shader get targeted replacements.
  - Shadows are cast through a draped depth material.
  - `drape.apply(scene)` runs before each frame. It patches new materials once (a WeakSet), gives them their own
    program (`|drape`), and widens bounds by the hills' height so nothing is culled early.
- **Exact fit:** the height is the grid's planar value over the two triangles of each cell, split along the same
  diagonal as the ground mesh. `GameWater.groundGeometry(size, relief)` builds the ground on that grid with the
  heights in it, snaps lake boxes onto it, and lights it with normals from the heights. So anything draped lies
  exactly on the ground, with no gaps and no fighting.
- **The camera and taps** find the ground on the hills through `nav.setGround(heightAt)`, and screen positions add
  the height.
- **What it doesn't do yet (terrain.md steps 4–7):**
  - roads follow the ground rather than keeping to gradient limits with cuttings and embankments;
  - vehicles and buildings are sheared by the slope rather than turned (right for gentle hills; towns are flat);
  - traffic's grade speeds ignore the hills.

## Finding your way (`game/places.ts`)

- **Place names** float over each settlement once you zoom out: the city from 420 m of view height, towns from
  480 m, villages from 560 m until 3.8 km. Bigger places win when two would overlap. Each shows how many people
  live there, and tapping a name goes there.
- **Menu → Places** lists every settlement, nearest first, with its kind, its people and how far away it is. Tap
  one to go there.

## Trips between towns (`game/econ.ts`, `econaccess.ts` `townFlows`)

On a map with more than one place, each settlement is a town of its own in the economy (id =
settlement id + 1). Each zone belongs to the town whose middle it's nearest, the same rule as
`settlementAt`. Out of town, drives go at 60 km/h after the first 2 km at the town's 28 km/h, so
neighbouring places trade trips by road. The town map, with one settlement, is unchanged (and so
is its economy, byte for byte).

After each trip assignment the economy adds up where each town's people go: `townFlows` shares
out every zone's trips the same way `assignTrips` does. `all` counts trips by any means and
`lines` the share of them on the player's lines. A block of far zones counts as the town of its
middle zone. The figures are only for display and change nothing in the economy.

The town panel is for the town you're looking at. "Where people go" lists the five busiest other
places, how many go there each day, and how many of those ride your lines. Tap one to go there.
Measured on the default region (seed 1, 10 places), with a DMU line of three trains between
Harrowley and its neighbour Dornewood: trips from Harrowley to Dornewood rose from 1,683 a day to
3,235, and 2,187 of those went by train. `economy.towns.test.ts` checks the same thing in the
library.

## Loading the region (why it's about a minute)

With the motorway, A and B roads (`interchange/region.ts`, wired in by this stream) the region first took over 6
minutes to load. Four fixes, each checked to give the same result, brought it down:

| Fix | Result |
|---|---|
| The land registry files a claim's pieces separately (`land.ts`), so a road claim across the map isn't tested by every question in its box | 227 s |
| Bridge checks walk a road with a cursor instead of `pointAt` from the start each metre, and look at a long path's nearby pieces only (`game/bridges.ts`) | roads 96 s → 21 s |
| The "too close to another road" test skips segments whose box it's outside (`roads.ts`) | roads 21 s → 8 s |
| Parks and verges ask the land registry only near buildings, and walk roads with a cursor, piece by piece (`infill.ts`) | parks 28 s → 7 s |

That's 68 s on the cloud box under SwiftShader. The rest is junction design, drawing the roads (twice),
starting the traffic and the first frame, which is streaming work (R4).

## Next: real places, on the same pipeline

The generator's steps are the same whether the map is invented or real. Only where each input comes from changes:

| Step | Invented (seed + options) | Real (a postcode or place) |
|---|---|---|
| Ground | `makeRelief` from `relief` and the seed | `TerrariumHeight` (AWS terrain tiles, world-wide) or OS Terrain 50 (UK), both already in `src/proto/terrain/`, sampled onto the same 25 m grid |
| Water | rivers and lakes from the options | OpenStreetMap water |
| Settlements | Poisson-disc sites on the flat and dry | OSM places (city, town, village) and their built-up areas |
| Streets | the lattice in `layStreets` | OSM roads (`src/proto/osm/`, as the Real Town Plans page and the parked Horley work do) |
| Look | `style` | picked from latitude and land cover |

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
- **Loading:** a loading screen (`src/proto/loading.ts`) shows the map, its options, a progress bar and what's
  being done ("Laying out Harrowley's streets", "Putting up 3,120 buildings", "Parks, playgrounds and car parks",
  "Painting the fields and woods" or "Laying the snow"…). Everything is built before play starts, as in TF2:
  nothing goes up in the background afterwards. `main.ts` yields to the page between stages (top-level `await`),
  and within the long ones every few milliseconds. It goes once the first frame is drawn, and `proto.loading.times`
  has each stage's time. On the cloud box under SwiftShader, the region takes 24 s (3,120 buildings) and the town 6 s.
- **What's off on the big map until R4 (streaming):**
  - 3D hedgerows: 1.34 M triangles over 6 km. The fields and their boundaries are still painted.
  - Cover texels are 4 m, not 2.5 m.
  - Building chunks are 240 m, not 120 m.

## Numbers

See PR #29 for load time, frame time, draw calls and triangles against `/`.
