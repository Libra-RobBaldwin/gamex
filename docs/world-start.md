# The world a game starts from

The game no longer builds its own town in `main.ts`. It starts from a **`World`**
(`src/proto/town/`), and there are two:

| World | Where | What |
|---|---|---|
| `realWorld()` | `town/real.ts` | A real town from an OpenStreetMap snapshot (the default): Horley town centre. `realWorld(BANBURY)` builds the importer's Banbury fixture instead. |
| `inventedWorld(rand)` | `town/invented.ts` | The hand-laid seed town, exactly as it was. |

**Menu → New town** offers both. The choice is kept in `localStorage` (`untitled.town`), and
`?town=real` or `?town=invented` in the URL overrides it.

**If you're wiring something into the game, read the world. Never assume the town is the invented
one.** No `LAKE`, no hard-coded industrial estate, no `BOUND = 520`.

## The interface

```ts
import { type World } from './town';
// main.ts: const world = startWorld(chosenTown(), rand);
```

| Field | Use it for |
|---|---|
| `net` | The `Network`, with roads and railways laid. Junctions aren't designed yet: `main.ts` designs them at start-up, so they claim their land before any plot does. `net.isWater` and `net.zoneAt` are set. |
| `bound` | The map runs from `-bound` to `+bound` on x and z (520 for the invented town, about 1,200 for Horley). Used by the camera clamp, the ground and plots. |
| `centre`, `view` | The town centre (a real town's is where its shops are), and where the camera starts. |
| `water.polys`, `water.isWater(p)`, `water.shores` | Every water surface as a polygon (lakes; rivers and canals as ribbons of quads), a point test, and any beaches to draw under them. |
| `zones`, `zoneAt(p)` | Land use: `residential`, `commercial`, `industrial`, `park`, `farmland`, `water`. Each is outer rings minus holes, with a `name` where the map has one. |
| `industrial(p)` | Industrial land. It matches `net.zoneAt(p) === 'industrial'`. |
| `stations` | Railway stations: `{ name, at, seg }`, with `seg` the nearest rail segment. |
| `names` | Real road names and numbers ("High Street", "A361") by segment id. |
| `hints` | Junction forms the map states outright (roundabouts, minis), by node. `main.ts` passes them to `design()` as `prefer`. |
| `standing` | Buildings already standing: a real town's, with their real kind and height (`lot.h`). |
| `growAlong()`, `growNow`, `canGrow(p)` | Which roads the town grows along, how much of that growth is built at the start (0.8 invented, 0.85 real: a real street with no mapped buildings is usually one nobody has drawn yet), and where a new plot may go (never into a real town's parks or water). |
| `invent` | Whether leftover land gets invented parks, car parks and churches (`infill.ts`). It's false for a real town, which keeps its own. |
| `trees` | Woods and scattered trees. The game clears any that end up on roads or plots. |
| `name`, `real`, `attribution`, `attributionUrl` | What to call the town, and the credit line to show wherever real map data is on screen. |
| `notes` | What didn't import cleanly: one-way streets built two-way, slip roads left out, and so on. The Menu's Map data card lists them. |

## Hooks for the systems being wired in now

| System | Take it from |
|---|---|
| **Industries** | `world.zones.filter(z => z.kind === 'industrial')` for estates to place on, and `world.industrial(p)` for a point. On the invented town that's the estate south of the centre. |
| **Water** | `world.water.polys` and `world.water.isWater`. On a real town that means rivers, canals and lakes from the map. Replace the flat drawing in `main.ts` (`flatPolys`) if you draw water properly. Keep `water.shores` for beaches. |
| **Bridges** | `world.structures`: the segments the map says are bridges or tunnels, with their OSM `layer`. They're laid at ground level for now, so in Horley the road bridges over the Brighton Main Line cross it on the level. Raising them is the bridges code's job. Also `net` roads and railways crossing `world.water.isWater`. |
| **Stations, trains, terminals** | `world.stations` (name, position, rail segment). The invented town has none. |
| **Vehicles and people** | Nothing new: traffic still runs on `net` and the buildings' lots. |
| **The ground** | `GameGround` takes `water` (polygons), `industrial` and `lawns` (the world's parks) from the world. |
| **Map labels** | `world.names`, and `zones[].name`. |
| **Credits, screenshots** | Show `world.attribution` whenever `world.real`. The shell has `setCredit(text, href)`. |

## Start-up, in order (`seedTown()` in `main.ts`)

1. The world lays its roads.
2. `commitRoads(world.growAlong())` designs every junction (with the world's hints), claims their land and queues growth plots.
3. `settleStanding(net, world.standing)` puts a real town's buildings up. The catalogue's roads are often wider than the real street, so a building standing on road or junction land is moved straight back (and a little sideways, or made up to 30% smaller) to the nearest clear spot. Only if nothing within 5 m works is it left out: about 5% in Banbury.
4. `world.growNow` of the queue is built now. The rest grows as the game runs.

Buildings within 450 m of the starting view go up before the first frame. The rest are
registered at once (so nothing else can take their land), then drawn over the first seconds,
nearest first, about 8 ms a frame. A chunk joins the scene only when all its buildings are ready,
so each chunk is merged once.

## What a real town simplifies

- **Map edge.** Roads, railways and waterways are cut 30 m past the edge of the box. Overpass returns whole ways, so some reached 2.3 km out.
- **Service roads.** Unnamed ones (car-park and yard access, alleys) are left out. At the catalogue's street width they ran through half the buildings. The game's plots have their own access.
- **One-way streets and slips.** One-way streets are built two-way. One-way slip roads are left out, and the junction designer adds its own. Both are listed in `world.notes`.
- **Roundabout size.** Roundabouts keep their form, at the designer's standard radius rather than the real one (the real radius is in `hints[].r`).
- **Bridges and tunnels** are laid at ground level (`world.structures` lists them). Roads cross railways on the level where in reality they go over them.
- **Garages and sheds** aren't drawn.
- **Mapping gaps.** A road that stops within 2 m of another road without sharing a node is joined to it (`stitch`).
- **Growth.** The town grows only along roads with room (less than one building every 40 m), and
  builds most of that at the start, because streets with no buildings on the map are mostly unmapped.

## Measured

Measured in Chromium with software GL (SwiftShader) on this cloud machine's CPU, at 412×915 and DPR 2.
Frame times there are set by the emulated GPU (about 200 ms for any town), so compare the
other numbers:

| | Invented town | Banbury (1.5 km) | Horley (2.4 × 2.5 km) |
|---|---|---|---|
| Buildings | 195 | about 1,490 | about 4,520 (2,440 from the map) |
| Road and rail segments, nodes | 35, 34 | 525, 482 | 951, 868 |
| Junctions designed | 14 | 236 | 477 |
| Start-up (to first frame) | 1.5 s | 4.5 s | 4.9 s (buildings out of view follow over the first seconds) |
| Building draw calls, default view | 202 | about 550 | about 370 |
| Traffic update (per 1/30 s step) | 1.2 ms (95 vehicles) | 1.6 ms (230 vehicles) | similar |

Before this work, the same Horley would have taken 14.8 s. What made the difference:
- a plot index in `Network` (lotFree and garden fitting no longer scan every plot);
- drawing out-of-view buildings over the first seconds;
- road samples cached in the leftover-land pass;
- per-piece water lines;
- no invented fillers in a real town.

Headless (Node), import, junction design and buildings take about 1 s.
`town/world.test.ts` holds them under 5 s.

**Too heavy for a phone?** Start-up and triangles are acceptable. Draw calls are the cost to watch.
They come from `buildgen`: each combination of façade, window and colour is its own textured
material, so a 120 m chunk of a real town carries dozens of materials. Bigger chunks didn't help
(606 → 519 calls on Banbury, with more triangles). The fix belongs in `buildgen`: a façade texture
atlas, so a chunk becomes a few draw calls. Until then, the adaptive quality tiers drop shadows
first, which halves the calls.

## Horley

`src/proto/osm/fixtures/horley.json` is Horley town centre: the station and High Street on the
Brighton Main Line, and the A23. It covers about 2.4 × 2.5 km, fetched on 24 Sep 2026 and trimmed to
the tags the importer reads (no addresses). To refetch it:

```sh
node src/proto/osm/fetch-fixture.mjs horley      # or banbury
```

The script tries overpass-api.de, then overpass.kumi.systems, then the VK mirror (`OVERPASS=<url>`
puts one first). `--check`, with a postcode in the `POSTCODE` environment variable, says only
whether that area sits inside the box. `--fit` and `--span` propose a box. None of them prints or
writes the postcode or where it is.

## Licence

A real town is © OpenStreetMap contributors, under the ODbL (see [osm.md](osm.md#licensing)). The
game shows the credit faintly on the map, bottom right, and on a Map data card in the Menu.
