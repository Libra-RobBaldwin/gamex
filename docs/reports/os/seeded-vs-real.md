# Seeded against real: the 50 km plans on the same yardsticks

Made by `tools/os/compare.mjs` (2026-09-27 03:47 UTC). The real columns are the
bakes through `real/world.ts`; the seeded ones are `planWorld` for those seeds, at its defaults.
Seeded maps start with lanes only (PLAN.md decision 3), so their A road rows are empty; the trunk
planner's A roads are the priors' concern. `PRIORS.follow` measured every 50 m of the real roads
over Terrain 50: A roads 3.4–2.8% median and 10.6–9.4% at the 90th;
minor roads 4.2–3.2% and 12.6–10.2%. (The rows here sample every 100 m of the plan's
routes over the plan's heights, so they read a little lower.) A lane's grade is mostly its land's: the
real bakes' ground is two to three times steeper than a seeded lowland map's (the land slope row), so
the fair yardstick for the router is a lane's grade over the slope of the ground under it, which real
lanes take at about 0.52–0.54 (B roads) to 0.6 (minor roads). The seeded lane km fall short of the
real minor road km where the plan has fewer of the smallest places: a real 50 km square has
65.1–170 hamlets per 1,000 km² on top of its 71.2–74 villages, each with its lanes (the plan now makes
hamlets from that prior, capped so a plan is still made in a few seconds; the hamlets row).

| | real: exe | real: teme | seeded: 42 | seeded: 7 | seeded: 1234 |
|---|---|---|---|---|---|
| land (km²) | 2077 | 2401 | 2006 | 1884 | 1290 |
| towns and cities per 1,000 km² | 8.7 | 5 | 7 | 7.4 | 10.9 |
| villages per 1,000 km² | 129 | 156.6 | 72.3 | 71.1 | 102.4 |
| hamlets per 1,000 km² (the bakes: those of 150 people or more count as villages above, the rest are not loaded) | n/a | n/a | 109.7 | 116.8 | 132.6 |
| villages and hamlets per 1,000 km² | 129 | 156.6 | 182 | 187.9 | 235 |
| town to nearest town (km, median) | 6.2 | 11.1 | 6.5 | 8.3 | 6.4 |
| village to nearest place (km, median) | 1.4 | 1.4 | 1.5 | 1.5 | 1.4 |
| largest places (people) | 120900, 38100, 33500 | 15800, 15600, 14600 | 28400, 23500, 8000 | 27500, 23300, 7900 | 26600, 23300, 8100 |
| A road km | 419 | 373 | 0 | 0 | 0 |
| B and minor road km | 3368 | 2523 | 1655 | 1583 | 1313 |
| A road grade, median / 90th (%) | 2.1 / 6.1 | 1.6 / 5.8 | n/a | n/a | n/a |
| B road and lane grade, median / 90th (%) | 3.1 / 9.3 | 2.6 / 7.9 | 1.7 / 4.3 | 1.5 / 4.3 | 2.0 / 4.3 |
| land slope, median / 90th (%) | 8.1 / 19.5 | 6.7 / 19.1 | 3.1 / 8.9 | 2.7 / 9.0 | 3.4 / 11.2 |
| lane grade over the slope of its ground (median) | 0.6 | 0.57 | 0.55 | 0.57 | 0.54 |
| land height, median / 90th (m) | 119 / 240 | 159 / 290 | 244 / 303 | 256 / 305 | 234 / 300 |
| railway km | 172 | 95 | 0 | 0 | 0 |
| plan made in (ms) | 4847 | 3017 | 3984 | 3401 | 2592 |

## The places: the seeded street layouts on the real towns' yardsticks

The real column is what `tools/os/towns.mjs` and `measure.mjs` measured over the bakes' own streets
(`PRIORS.towns`, `PRIORS.roads`); the seeded columns are `layStreets` over every place on those plans.
The ways out count the plan's roads at a place (the real count has its A roads too; a seeded map starts
with lanes). A radial's wander is measured the same way on both: its line every 25 m, headings over
200 m windows, the change from one 100 m to the next; the generator's blocks are 85 m, so the finer
wiggle of a real centreline isn't there, and a village's radial is two blocks, too short for the
measure to catch much. The houses along a radial are buildings within 40 m of it per 100 m, each
quarter over the mean of the middle two: the real first quarter reads low because OS maps a terrace or
a parade of shops as one footprint, where the scenery builds each house and shop.

| | real (measured) | seeded: 42 | seeded: 7 | seeded: 1234 |
|---|---|---|---|---|
| radials per town (median) | 5 | 5 | 5 | 5 |
| radials per village (median) | 3 | 3 | 3 | 3 |
| ways out of a town (median; the real count has its A roads, the seeded one its lanes) | 11 | 11 | 12 | 12 |
| ways out of a village (median) | 5 | 4 | 4 | 4 |
| a radial's wander inside a town, from one 100 m to the next (°, median) | 11.3 | 6.2 | 6.6 | 7.2 |
| a radial's wander inside a village (°, median) | 11.3 | 2.0 | 1.5 | 1.9 |
| houses along a town's radials by quarter, over the middle quarters' (the ribbon thinning) | 0.79 / 1.06 / 0.94 / 0.51 | 1.51 / 1.19 / 0.81 / 0.60 | 1.84 / 1.12 / 0.88 / 0.66 | 1.70 / 1.12 / 0.88 / 0.66 |
| houses along a village's radials by quarter | 0.59 / 1.03 / 0.97 / 0.44 | 2.29 / 1.19 / 0.81 / 0.44 | 2.24 / 1.18 / 0.82 / 0.47 | 2.24 / 1.18 / 0.82 / 0.44 |
| junctions in towns: dead ends / T / crossroads | 0.31 / 0.65 / 0.04 | 0.34 / 0.64 / 0.02 | 0.31 / 0.67 / 0.02 | 0.32 / 0.66 / 0.02 |
| junctions in villages: dead ends / T / crossroads | (as towns) | 0.40 / 0.54 / 0.06 | 0.41 / 0.53 / 0.06 | 0.40 / 0.53 / 0.06 |
| street piece between junctions, towns (m, median) | 71–79 | 69 | 71 | 69 |
| street piece, villages (m, median) | (as towns) | 68 | 68 | 68 |
| orientation order, towns (1 a grid, 0 every bearing alike) | 0.01–0.05 (core), 0–0.01 (suburb) | 0.03 | 0.02 | 0.02 |
| orientation order, villages | (as towns) | 0.02 | 0.01 | 0.01 |
