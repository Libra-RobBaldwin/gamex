# `src/proto/region/`: what the 50 km plan takes from it

The 6 km region generator that lived here is gone (the game is one 50 km map: `docs/world.md`,
`docs/streaming.md`). What's left is what the plan (`worldmap/plan.ts`) and the game still use. All of
it is pure (no three.js, no DOM), and `region.test.ts` runs it on the plan.

## A seed and a few settings (`options.ts`, `styles.ts`)

A map is its options: the same options always make the same map, and the address carries them all,
every one spelt out (`optionsQuery`), so a shared or saved address makes the same map whatever the
defaults become:

    /?map=region&seed=12&rivers=2&lakes=-1&towns=-1&villages=-1&city=1&style=temperate&relief=rolling&size=50&sea=1&landform=coast&islands=none&hills=-1&water=-1&woods=-1

| Option | Values | Default |
|---|---|---|
| `seed` | any whole number | 7 |
| `landform`, `islands`, `sea`, `hills`, `water`, `woods` | the terrain's presets and sliders (`LANDFORMS`; `worldmap/landform.ts`) | coast, none, a coast, the landform's own |
| `rivers` | 0–4 | 2 |
| `lakes` | 0–12, or −1 for the seed to decide | −1 |
| `city` | 1 or 0: two cities, the biggest places | 1 |
| `towns` | 0–30, or −1 for the seed to decide | −1 |
| `villages` | 0–250, or −1 | −1 |
| `style` | `temperate`, `desert`, `arctic`: the ground's palette and crops, the woods and the sky (`styles.ts`) | temperate |
| `relief` | `flat`, `lowland`, `rolling`, `upland`, `mountain` | rolling |
| `real` | a real region's id (`public/regions/<id>`): the map is that region, not made up | |
| `size` | 50: there is one size. An old 6 km address opens the 50 km map | 50 |

## Settlements' streets and links (`generate.ts`)

- **`KINDS`:** how big a city, a market town and a village is, its block spacing, and the road types of
  its high street, main cross street, side streets and industrial edge.
- **`layStreets(s, water, bound)`:** one settlement's streets as `net.build` calls: a lattice in the
  settlement's frame inside a wobbly circle, row 0 the high street, column 0 the main cross street, an
  industrial edge of double-length blocks (with a zone rule) for cities and towns. An organic plan jitters
  the lattice, bends the streets and leaves about a third out, keeping a spanning tree. Streets that would
  touch water or leave the map are dropped, and the rest come out in the order they're reached from the
  centre, so every settlement is one connected piece. The plan lays the far towns' streets this way for the
  scenery (`worldmap/towns.ts`), and the live area's for the game (`worldmap/spec.ts`, then `apply.ts`
  `buildStreets`).
- **`suggestLinks(settlements, water)`:** which places to join: A roads on the Gabriel graph of the cities
  and towns, B roads bringing each village in by its two shortest links, and whatever keeps everywhere
  reachable. `worldmap/routes.ts` turns them into the lanes of a seeded start.
- **`reach(kind, r)`:** how far a settlement's land reaches, built-up area and industrial edge.

## Names (`names.ts`)

`placeName(rng, village, taken)`: a first element (a tree, a bird, a landmark…) and an English place-name
ending, sometimes "Little …" or "… Green" on villages, checked against `REAL_PLACES` (about 450 real UK
names): no exact match, and nothing one letter off a real name of seven letters or more.

## Maps as data (`mapspec.ts`, `index.ts`)

`mapFromQuery(query)` is the one way to a map: it reads the options and returns the 50 km map's
`MapSpec` (`worldmap/spec.ts` `worldMapSpec`), whose fields the game reads:

| Field | What reads it |
|---|---|
| `bound` | the live area's half-width: the Network's bounds, the camera's, the ground's |
| `water` | `GameWater(half, map.water)`: the plan's lakes and rivers inside the live area |
| `zones`, `settlements`, `streets` | the live area's industrial land, its places (plot queueing nearest centre first; `centrality` and `plotCentre` size a place's plots by its kind) and their streets |
| `view`, `stops`, `line` | where the camera starts (the start town's centre), and where the guide's first stops go |
| `world` | the whole plan, for the streamed scenery (`worldmap/view.ts`) and the coarse economy (`worldmap/econ.ts`) |

## Priors from real data (`priors.ts`)

What a real 50 km square of England has (`docs/real.md`): how many places and how big, the road
hierarchy, the share of dead ends and grid plans, the woods' sizes and slopes. The plan reads them
(`placesFor`, `radiusFor`, `GRID_PLAN`, `PRIORS.roads`). `woodSpots` sited the 6 km region's woods and
nothing reads it now; the 50 km map's woods are countryside's (`docs/ground.md`).

## Countryside (`fields.ts`, `woods.ts`, `lanes.ts`, `countryside.ts`)

Fields, hedges, woods, farms and winding lanes: countryside's, run a tile at a time through
`worldmap/country.ts`. See `docs/ground.md`. `region/fields.test.ts` lays its fields over
`sixkm.fixture.ts`, a test-only 6 km spread of places, lanes and a river.
