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

- **`KINDS`:** how big a city, a market town, a village and a hamlet is, its block spacing, and the road types of
  its high street, main cross street, side streets and industrial edge.
- **`layStreets(s, water, bound)`:** one settlement's streets as `net.build` calls, grown along its
  radials as real places are (`PRIORS.towns`, measured by `tools/os/towns.mjs`): the high street's two
  ways through the middle and 2–4 more radials for a village, 4–6 for a town, 6–8 for a city, none within
  30–40° of another and each starting on a high-street node a block or two off the middle (a T, not one
  great crossroads); the houses run further out along the radials than between them; cross streets join
  neighbouring radials part way out; side streets and closes branch off every radial at the measured rate
  and lengths, through side streets on one side joined end to end by a back street; an organic plan
  wanders and bends, a grid plan runs square. No street crosses another: one that would meet a radial
  ends on it as a T, one that would cross another street or run within 25 m of its node is left out. The
  city's and the towns' industrial estate is a small grid of wide blocks beside one radial's outer end,
  its way in a T off the radial (with a zone rule). Streets that would touch water or leave the map are
  dropped, and the rest come out in the order they're reached from the centre along the streets, so every
  settlement is one connected piece and the careful builder (`apply.ts` `buildStreets`) refuses none. The
  plan lays the far towns' streets this way for the scenery (`worldmap/towns.ts`), and the live area's
  for the game (`worldmap/spec.ts`, then `apply.ts`). It also gives the settlement its **spokes**: each
  radial's outer end, facing out along it (the high street's two are the `gates`). The plan's lanes leave
  by them (`worldmap/routes.ts` `laneBetween`, `spokeFor`, `stem`): of the two spokes at each end that best
  face the other place, the pair whose way doesn't double back and has no standing water at the stem;
  straight along the street for 240 m, then a smooth blend into the course found between; two lanes
  wanting one spoke share it and fork outside. That's how real roads leave real places (`PRIORS.exits`,
  measured by `tools/os/exits.mjs`). `docs/reports/os/seeded-vs-real.md` puts the seeded places on the
  real towns' yardsticks.
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

## Farmland and woods (`fields.ts`, `woods.ts`, `lanes.ts`, `countryside.ts`)

The one field, wood and farm generator. The 50 km map's countryside comes from it, through
`worldmap/country.ts` `countryFor(plan)`, which gives it the plan's roads and railways, rivers,
lakes and sea, and terrain. It's the ground's field source everywhere (docs/ground.md), and
`fields.test.ts` lays its fields out from `planWorld`, the game's own plan:

- **Farm blocks:** Voronoi cells of seeds about 800 m apart (about 64 ha, an English farm). Each
  block's fields run one way: along the nearest road or river within 380 m, else along the contour
  where there's a slope, else as the land's grain runs (a noise field over 2.6 km).
- **Fields:** each block is cut square across its longer side, again and again, until its fields
  are the size that land has: 4 to 11.5 ha where it's ploughed, less round the villages (down to
  60%) and on slopes. The map's lanes wind (a B road turns 16° across a block, half the time), so
  as the block is cut, a piece within 150 m of a lane turns to the lane once it has bent more than
  11° from the grain the piece was cut in (`COUNTRYSIDE.follow`): the fields along a winding lane
  fan round its bends, each square to the road beside it, with its rows along it; the rest of the
  block keeps its one direction. So fields are mostly four-sided with right angles, and meet the
  block's edge at whatever angle it takes. A road through a field splits it (along its chord). One
  cut in ten on a big block is a shelter belt, a strip of trees 16 to 24 m wide. Measured on 6 km
  squares of three seeds: nine fields in ten beside a lane run within 8.6° of it (was one in two,
  once the roads wound), and about two corners in three are within 6.9° of square (a block's
  boundary corners, half of all corners, are never square).
- **What each is:** woods first (`woods.ts`: old woods in clumps a kilometre or so apart, hanging
  woods on the steepest slopes, wet woodland on small fields by the water, the odd copse, the
  belts, conifer plantations a farm block at a time on the high ground). Then rough grazing on the
  high ground, steep slopes and by the water, then arable where the block is ploughed (flat land
  away from the villages and the water), else pasture. Each farm grows two main crops, so
  neighbouring fields are often the same. No woods or hedges on fields under the sea or a lake.
- **The high ground** is ranked among the map's own land (`heightRank`, from a kilometre grid of
  its heights): the top 15% is rough grazing, the top tenth has more woods, the top fifth
  plantations. (Not a share of the highest point: a 50 km map is a plateau cut by valleys, and
  over half of it stood above 62% of its peak.) On seeds 7, 42 and 99, over the whole map: 9 to 11%
  wood (plus 2 to 4% plantations), 11 to 13% rough, 30 to 42% arable, the rest pasture. Round the
  start town the woods are more (about a fifth), as its valley sides are steep.
- **Farmsteads:** about one a farm block, beside a road or out in the fields with a track to one
  (routed with `laneRoute`), 380 m or more apart, out of the villages, the water and the woods.
- **Lazily, a tile at a time:** `new Countryside({ seed, bounds, settlements, lanes, waterDist,
  heightAt, heightRank, woods, pines })`, then `blocksNear(box)`: every farm block touching a box,
  whole, so fields cross tile borders and neighbouring tiles agree. `farmsNear(box)` is the farms in
  them. Each block depends only on the seed, its place and what's near it (no whole-map pass;
  blocks are remembered): a few milliseconds a kilometre tile. No DOM or three.js, so it runs in
  the tile workers.
- **Farm tracks (`lanes.ts` `laneRoute`):** the cheapest way over a grid in a corridor round the
  straight line. Each step costs its length times how unwelcome the ground is: steep ground (so
  they go round hills, along the contours), water (crossed square on), the old woods, villages,
  running beside a big road, and a slow noise so they wander; then smoothed to a minimum radius.
  The map's roads and lanes are the world plan's own (`worldmap/routes.ts`).
- **Tuning:** every number (block size, field sizes, crop shares, woodland rules, farms, the
  tracks' costs) is in `region/countryside.ts` (`COUNTRYSIDE`), for the OS import to fit to real
  data. The setup's woods (0 to 100, 50 as the style has them) scale the woods.
