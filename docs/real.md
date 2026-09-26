# Real regions from Ordnance Survey OpenData

Two parts:
- **Real regions.** A bake turns a real 50 km square of Britain into the game's map data, from free
  OS OpenData. A real region is the other source of the game's one map, the 50 km region: `/?map=exe`
  is the Exe estuary round Exeter, `/?map=teme` the Teme valley round Ludlow. It's drawn, streamed and
  played through the same WORLD pipeline as a seeded map (`src/proto/worldmap/`); only the source
  differs.
- **Priors.** Numbers measured from those regions tell the seeded generator what real Britain looks
  like (`src/proto/region/priors.ts`).

Contains OS data © Crown copyright and database right 2026. OS OpenData is under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
The game shows the credit on the map (`#credit`, bottom right) whenever a real map is open, and in
Menu > About. Any image made from the data needs the same line.

## Data (all free, no key)

The OS Downloads API (`https://api.os.uk/downloads/v1/products`) serves each product whole, or per
100 km grid square where the product offers it:

| Product | What it gives | Download |
|---|---|---|
| OS OpenMap - Local | buildings, roads by class, railways and tunnels, stations, surface water, tidal water (the sea), foreshore, woodland, functional sites (schools, hospitals), important buildings, roundabouts, motorway junctions | per 100 km square (SX 57 MB, SY 19 MB, SO about 40 MB) |
| OS Terrain 50 | heights on a 50 m grid (10 km ASCII grids inside) | GB, 162 MB |
| OS Open Rivers | river centre lines with names and form (inland, tidal, canal, lake) | GB, 40 MB |
| OS Open Names | cities, towns, villages, hamlets and suburbs, and their extents | GB, 103 MB (20 km CSVs inside) |
| OS Open Greenspace | parks, playing fields, allotments, cemeteries, golf | per 100 km square |

**Not used:**
- OpenStreetMap: blocked by this environment's network policy (overpass-api.de,
  download.geofabrik.de).
- The free AWS terrarium tiles: Terrain 50 covers Britain.

**What OSM would add** (if download.geofabrik.de is allowed later):
- field boundaries (`landuse=farmland`), which OS OpenData doesn't have: the priors' field sizes
  are an estimate until then;
- one-way streets, speed limits and lanes;
- building uses (shop, pub, church) and levels;
- land use (retail, industrial, residential), where this bake guesses from the distance to a place's
  middle.

## The bake (`tools/os/`)

    node tools/os/bake.mjs exe                   # or teme; --cache <dir> (default .os-cache/), --keep
    node tools/os/preview.mjs exe out.png [x0 z0 x1 z1] [--px 1800]   # draw a bake to compare with the OS map
    node tools/os/measure.mjs exe teme --out r.json                   # the priors' numbers

- **Regions** are listed in `tools/os/regions.mjs`: the square's south-west corner on the British
  National Grid, its size (50 km) and its home place. Nowhere tied to a player.
- **Speed and disk:**
  - A region takes 15–40 s. The downloads go to a cache (`.os-cache/`, git-ignored) and are deleted
    afterwards unless `--keep`.
  - Only the 10 km height grids and 20 km name files the square needs are unzipped.
- **Output:** `public/regions/<id>/` has `region.json` and `t/<i>-<j>.bin`.
  - Exe: 5.8 MB in 100 tiles.
  - Teme: 4.7 MB.
  - Served with the game as static files and fetched per tile.
- **Coordinates:**
  - Game metres: x east, z south, the square's centre at 0, 0.
  - Straight off the grid: x = E − E₀, z = N₀ − N. The National Grid's scale error here is under
    0.04%, so no reprojection.
  - `region.json` keeps the centre's grid reference and its WGS84 latitude and longitude
    (`tools/os/bng.mjs`, inverse transverse Mercator and a Helmert shift). The world-scale work can
    then place the square on its own projection.

### The tile format (`src/proto/real/format.ts`)

- **Tiles:** 5 km each, one binary file holding every layer inside it.
- **Features:** each has a class and an optional name, with parts as polylines, rings or points.
- **Coordinates** are multiples of Q = 0.5 m from the tile's corner, zigzag-varint deltas.
- **Heights:** 101 × 101 posts at 50 m, shared along tile edges, in decimetre deltas. Each post is
  the mean of the four Terrain 50 cells round it.
- `encodeTile` and `decodeTile` are pure and shared by the bake (Node strips the types) and the game.

| Layer | Classes | Notes |
|---|---|---|
| `roads` | motorway, primary (A road, primary route), a, b, minor, local, access, restricted, shared; flags DUAL (collapsed dual carriageway), RAISED (drawn over what it crosses) | name is "A377 Western Way": number and street name |
| `rail` | multi, single, narrow, multi-tunnel, single-tunnel | |
| `buildings` | building, and the important buildings' themes (education, religious, medical, retail…) | named where OS names them (the cathedral, schools) |
| `water`, `sea`, `foreshore`, `woods`, `green`, `sites` | green: park, playing, golf, allotment, cemetery…; sites: school, college, university, hospital… | polygons clipped to the tile, holes kept |
| `rivers` | form + 8 × width (m) | OS Open Rivers centre lines; width from the water polygons, sampled every 15 m (median) |
| `streams` | | OML's narrow watercourses |
| `points` | station, roundabout, motorway junction | |

**The open sea:** OS tidal water stops at the edge of the 5 km squares it's drawn in. A tile wholly
offshore (no land feature, every height at sea level or below) gets a sea polygon edge to edge.

**People:**
- OML merges a terrace into one footprint, so people come from footprint area: 42 m² of footprint
  a person, calibrated on Exeter's 2021 census.
- A place counts the buildings within 1.4 × (its extent + 150 m), and suburbs fold into their city
  or town.
- The resulting estimates:

  | Place | Estimate | Real (2021) |
  |---|---|---|
  | Exeter | 122k | 130k |
  | Exmouth | 38k | 37k |
  | Newton Abbot | 33k | 26k |
  | Ludlow | 15k | 11k |

  Rural places come out high, because farm buildings count.

## On the 50 km map (`real/world.ts`, `real/worldmap.ts`)

`?map=region&real=exe` (or `?map=exe` for short; a game saves with the long form) makes the 50 km
map from the bake. `real/world.ts` is a `WorldSource` (`worldmap/source.ts`): the same facts a seeded
map's plan is made from, read from the tiles instead of made up. It registers itself with
`setRealSource`, on the main thread and in the tile worker, so both make the same plan.

- **The square:** the bake is centred on the region's home place, which the plan puts at 0, 0. The
  map runs 24.5 km each way round it. The Exe bake was moved north to put Exeter in the middle, so
  it now runs from Tiverton to Dawlish and from Dartmoor's edge to Sidmouth (Torbay is off it).
- **Places:** Open Names' cities, towns and villages (hamlets of 150 people or more count as
  villages). Each is sized by the people the bake counted in it, at about 250 m² of town a head,
  never more than Open Names' own extent. A village well inside a bigger place's extent is one of
  its suburbs and is folded into it. Exe has 286 places, Teme about 100.
- **The land:** Terrain 50, bilinear between its 50 m posts. Each river's floor is laid at its water
  and eased up to the land beside it, as the seeded terrain does. Nothing is below the sea.
- **The sea:** OpenMap Local's tidal water covers only the strip along the shore and up the
  estuaries, so the sea is that plus any ground at sea level (Terrain 50's sea is 0 or below) that
  reaches it or the map's edge. It goes to the plan's water as a 100 m coarse grid of the signed
  distance to the coast (`realLand`), which `WorldWater` reads as it reads a seeded map's.
- **Rivers:** Open Rivers at their measured widths (6–90 m), each run's water level read off the
  heights along it and never rising downstream. Still water of a hectare or more becomes a lake.
- **Roads and railways:** OpenMap Local's motorways, A roads (and primary routes), B roads and minor
  roads become the plan's routes (minor roads as B). The pieces the bake cut at its tiles are joined
  end to end and resampled to the plan's 25 m step. Main roads and railways leaving the map run on
  60 m past its rim, where `game/portals.ts` makes their ways off it: on Exe, the M5, 13 A roads, 4 B
  roads and 7 railways. A road leaving at both ends is split in two.
- **Woods:** OpenMap Local's woodland, by tile (`woods(box)`).
- **Not from OS yet:** industries (the plan's `industries` is empty), and far towns' buildings. The
  scenery draws each place beyond the live area as the plan's generated town at the real place and
  size (`worldmap/towns.ts`), not its real buildings.

The plan takes 3.6 s in node for Exe (`real/world.test.ts`).

## The live play area (`real/live.ts`, made by `tools/os/pack.mjs`)

The 8 km square round the home place, where the game's own network, buildings, traffic and economy
run, is the real one. It's worked out ahead of time by `tools/os/pack.mjs`, which runs the code below
over the tiles and writes `public/regions/<id>/live/<home>.json`. The game restores it inside the
WORLD path (`main.ts seedTown`) in place of the streets a seeded map lays out. Every place inside it
starts live, since its real streets are all there. What the pack is made from (`map.ts realMap` for
the window, then `lay.ts`):

- **Places:** in the game they're the plan's (above). A spot belongs to the place whose edge is
  nearest (`placeBy: 'edge'`), not its middle, so Exeter's suburbs are Exeter's. In the economy
  the 8 km round Exeter has 178,000 people. That's more than the real city (about 130,000), because
  the pack's lots count every building in the square, and the economy fills each lot.
- **Water, for laying out:** the pack's network keeps off OS Open Rivers' rivers of 6 m or more,
  chained by name into runs of one width. In the game the live area's water is the plan's.
- **Parks:** OS Open Greenspace sites become the parks, playing fields, allotments and churchyards
  (`lay.ts greenRegions`). The leftover-land finder is off, because a real map's gaps are its
  gardens.
- **Roads, railway, stations, buildings** (`osm.ts`, then `lay.ts`) go through the OSM importer's own
  stages into the game's network: the road graph, pairing, joining runs, buildings to lots.
  - The tiles are handed over as Overpass-shaped JSON (lat = z, lon = x).
  - Ways share a node wherever two vertices land on the same 0.5 m spot, which is how OML joins its
    roads.
  - Restricted and private roads are left out, as the importer leaves out driveways.
  - **Speed limits:** 30 mph in a place (40 on a primary route), the national limit outside it.
  - **Railways:** OML draws tunnels as lines of their own, and its track pieces don't always meet.
    Each end is snapped onto another piece within 4 m, or up to 30 m straight ahead within a 35°
    cone (`joinRails`). Exeter's railway comes out as one connected network with its six stations
    on it.
  - **Buildings:**
    - A terrace is cut into houses. An L-shape or courtyard block is cut on a grid its wings' width.
      A named building (the cathedral) stays whole.
    - `placeLots` stands each on its land. It moves a building up to 4 m back from its road and makes
      it up to 30% smaller before dropping it, because a catalogue road is often wider than the real
      street. 85% of the city centre's buildings stand.
    - Neighbours may touch, as a terrace's houses do, but their rectangles as drawn never cross (it
      used to check them 0.6 m in a side, and neighbouring shops' boxes crossed). That costs 1.7% of
      the buildings.
    - A building's zone comes from where it stands: commercial in a place's inner quarter,
      residential in the rest.
    - A church lot far bigger than a parish church's is drawn at its size, taller to match
      (`buildgen.ts`).
  - **Growth:** the game's own plots grow only where they're 14 m clear of the real buildings.

**Measured before the pack** (see "Speed" below) (412 × 915, DPR 2, SwiftShader, `node e2e/perf.e2e.mjs`), against the generated
region on the same tier:

| | Region (generated, 3,120 buildings) | Exeter (26,700 buildings) |
|---|---|---|
| Start-up | about 60 s | 67–75 s |
| Zoomed out: draw calls, triangles | 258, 1.0 M | 437, 2.9 M |
| Wide: draw calls, triangles | 219, 1.0 M | 362, 2.8 M |
| Close over the centre: draw calls, triangles | 566, 1.2 M | 1,580, 2.2 M |

The close-in draw calls are the building chunks: each 250 m chunk has one mesh a material, and a
real city has many materials a chunk.

`e2e/real.e2e.mjs` plays it by touch:
- it loads with no errors and shows the credit;
- two bus stops go on real streets and a line is drawn between them (72 riders in three days);
- two stations go on the real railway at St David's and St Thomas, with a line whose train calls
  at both;
- the economy sees the city.

**Not done yet:**
- **The rest of the 50 km:** the world-scale work streams it. The tiles, `tilesFor` and
  `heightGrid` are ready for it.
- **The sea:** `WaterSpec` has lakes and rivers only; the terrain and sea work adds it. The sea,
  foreshore and tidal river widths are in the tiles.
- **One-way streets and slip roads:** OML has neither.
- **The city centre:** it still looks sparser than the real one, and its grid-cut blocks are
  uniform.
- **Edits on a real map:** they don't look again for leftover land.

## Speed: the live pack (`tools/os/pack.mjs`, `src/proto/real/live.ts`)

**On the 50 km map (26 Sep, 08:40), under SwiftShader at 412 × 915:** Exeter loads in 53–60 s and
Ludlow in 21–22 s. The rest of the 50 km then streams in over about a minute. The pack is now the
8 km live area: Exeter's holds 3,629 road segments, 38,219 buildings and 3,317 plots (4.4 MB,
1.1 MB gzipped), and Ludlow's 7,614 buildings (0.26 MB gzipped). The history below is from the
6 km window, before the 50 km map.

Everything the game used to work out while the player waited is now worked out in the bake:

```
node --experimental-transform-types --no-warnings --import ./tools/os/ts-register.mjs tools/os/pack.mjs exe [--home Exeter] [--half 4000]
```

`pack.mjs` runs the game's own code over the baked tiles: `realMap`, the OSM importer's stages,
`design()` at every junction, `placeLots`, the growth plots as `queuePlots` would lay them,
`greenRegions` and `deadEndPaths`. (`ts-register.mjs` lets node import the game's TypeScript.)
It writes `public/regions/<id>/live/<home>.json`, rounded columns that compress well. The file
holds:
- the nodes and segments;
- each junction's chosen form;
- every lot, tagged with its 1 km tile;
- the growth plots;
- the parks and the dead ends' paths.

| Pack | Size | Gzipped | Buildings | Junctions | Plots |
|---|---|---|---|---|---|
| Exeter | 3.8 MB | 1.1 MB | 28,969 | 1,425 | 2,331 |
| Ludlow | 1.3 MB | 0.45 MB | 6,695 | 252 | 1,408 |

The game (`load.ts`, then `main.ts seedTown`) fetches the pack unless `&pack=0` is set, then:
- restores the network, whose land claims come back from the roads;
- designs each junction in its packed form only (`preferAt`);
- puts every lot on the land at once, so the economy, the paths and the land registry see the
  whole town;
- draws the buildings within 1.2 km before the first frame, and the rest a tile at a time, nearest
  first, 4 ms a frame (`LotStream`).

Repack after changing the bake, the importer, `design()`, `placeLots` or the plot layout.

Engine speed-ups found on the way. Each gives the same answers as before, so the town is unchanged:
- **The water's ground** (`region/water.ts`) skips any lake bowl or river channel whose box the
  spot is outside. Exeter's 46 lakes and 16 rivers took 11 s; now 2.5 s.
- **`Network.segsAt`** reads an index of each node's segments, kept by `SegMap` as segments are
  set and deleted, instead of scanning all of them.
- **The dead ends' paths** aren't worked out again when the roads haven't changed.

A real park is hectares of open lawn, not a 30 m gap planted like a garden. So a real map plants
its big parks more thinly (`parkLeafiness`, buildgen's `leafy`): a 1 ha park is planted as before,
a 14 ha one has a tree every 400 m² or so. That took the parks from 2.5 M triangles to 1.5 M, and
from 4.4 s to 2.8 s to build.

Exeter's load (412 × 915, DPR 2, SwiftShader), in seconds:

| Stage | Before (no pack) | Pack | Now |
|---|---|---|---|
| Hills and rivers | 16 | 16.8 | 5.1 |
| Roads and railway | 6–7 | 4.2 | 0.8 |
| Buildings round you | 17–23 | 3.9 | 3.7–4.2 |
| Bus stops and drawing the roads | | 9.0 | 9.0 |
| Parks | | 5.9 | 3.2 |
| Map round you | 6–7 | 7.1 | 4.3 |
| **Total** | 67–85 (142 on the coordinator's run) | 61–69 | **41–47** |

Ludlow loads in 29 s.

What's left is mostly SwiftShader's, and a phone's GPU does it far faster:
- **About 9 s in the bus-stop stage:** the first `renderer.setSize` (2.2 s even on the town) and a
  paint the GPU process holds up.
- **About 14 s after the last stage:** compiling the shaders and uploading the buffers
  (`onFirstUse`, `createBuffer`).

The first frame over Exeter draws 2,405 calls and 1.38 M triangles.

## Dead ends and their paths (every map)

A dead end just stops, as a UK cul-de-sac does. There are no turning circles any more:
`Network.turningHeads` is off, and a test turns it on to keep the old shape working.

A footpath carries on from each dead end (`src/proto/game/paths.ts`):
- **Through:** to the nearest street within 90 m straight ahead (inside a 40° cone), stopping at its
  footway.
- **Stub:** failing that, 12 m on into the ground.
- **Where they go:**
  - only to streets at ground level that have a footway;
  - never over a building, water, another road or a railway;
  - on a real map, worked out after the real buildings go up.
- **Land:** each path claims its land (`path:<node>`), so nothing is built on it.
- **Drawing:** the paths are drawn as one draped tarmac mesh, 2 m wide, 6 cm above the ground.
- **Edits:** worked out again with every road edit.

Exeter has 526 of them, 108 running through to the next street. The starter town has 8. So the
starter town now differs from before at its cul-de-sacs.

Free OS data has no real footpaths. OSM's (`highway=footway`) would replace these where they exist.

## Priors (`src/proto/region/priors.ts`)

`PRIORS` holds every number with where it came from: both regions, `[exe, teme]` where they differ.
`tools/os/measure.mjs` re-measures. The main findings:

| | Measured | Used for |
|---|---|---|
| Street pattern | orientation order 0.01–0.05 in town cores, 0 in suburbs; junctions 65% T, 4% crossroads, 31% dead ends; streets 70–80 m between junctions (median) | `GRID_PLAN`: a grid plan only 5–20% of the time; an organic plan leaves out 31% of its side streets (it was 30%) |
| Woods | 13–16% of the land outside places; 7–8 patches a km²; log-normal sizes, median 0.5 ha; shape index 1.7; 8% wooded on the flat, 33% at 20–30% slopes, 59% above 30%; nearer streams than the land | `woodSpots`: the generated region's woods are real-sized patches, sited by slope and drawn out along the contours |
| Settlements | per 1,000 km²: 5–12 towns, 71–74 villages, 65–170 hamlets; nearest-neighbour medians 5.5–11 km (towns), 1.8 km (villages), 1.1–1.2 km (hamlets); rank–size exponent 0.8–1.3; extent r ≈ 24–47 · people^0.37–0.43 | `placesFor`, `radiusFor` for the 50 km maps (the 6 km generator keeps its options) |
| Roads | km/km²: minor 0.9–1.5, streets 0.2–0.9, B 0.13–0.18, A 0.08–0.15, primary 0.08–0.10 | the 50 km generator's road hierarchy |
| Ribbon development | outside places, buildings are 2.5–3.5 times likelier within 60 m of an A or B road than the land is | the 50 km generator's roadside houses |
| Coast | fractal dimension 1.15 (50 m–3.2 km); 96 km of tidal river inside the square, 12–213 m wide | `fractalCoast`, for the sea work |
| Buildings | footprints 120–130 m² median; 33–88 a km² | |
| Fields | not in OS OpenData: 1–5 ha, an estimate until OSM | the countryside work |
