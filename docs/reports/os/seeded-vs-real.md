# Seeded against real: the 50 km plans on the same yardsticks

Made by `tools/os/compare.mjs` (2026-09-27 01:11 UTC). The real columns are the
bakes through `real/world.ts`; the seeded ones are `planWorld` for those seeds, at its defaults.
Seeded maps start with lanes only (PLAN.md decision 3), so their A road rows are empty; the trunk
planner's A roads are the priors' concern. `PRIORS.follow` measured every 50 m of the real roads
over Terrain 50: A roads 3.4–2.8% median and 10.6–9.4% at the 90th;
minor roads 4.2–3.2% and 12.6–10.2%. (The rows here sample every 100 m of the plan's
routes over the plan's heights, so they read a little lower.) A lane's grade is mostly its land's: the
real bakes' ground is two to three times steeper than a seeded lowland map's (the land slope row), so
the fair yardstick for the router is a lane's grade over the slope of the ground under it, which real
lanes take at about 0.54–0.52 (B roads) to 0.6–0.6 (minor roads). The seeded lane km fall short of the
real minor road km because the plan has no hamlets: the real "villages" row counts every named place,
and a real 50 km square has 65.1–170 hamlets per 1,000 km² on top of its 74–71.2 villages, each with its lanes.

| | real: exe | real: teme | seeded: 42 | seeded: 7 | seeded: 1234 |
|---|---|---|---|---|---|
| land (km²) | 2077 | 2401 | 2006 | 1884 | 1290 |
| towns and cities per 1,000 km² | 8.7 | 5 | 7 | 8.5 | 10.9 |
| villages per 1,000 km² | 129 | 156.6 | 80.3 | 75.4 | 104.7 |
| town to nearest town (km, median) | 6.2 | 11.1 | 6.5 | 7.1 | 6.4 |
| village to nearest place (km, median) | 1.4 | 1.4 | 2 | 2 | 1.8 |
| largest places (people) | 120900, 38100, 33500 | 15800, 15600, 14600 | 28400, 23500, 8000 | 27500, 23300, 7900 | 26600, 23300, 8100 |
| A road km | 419 | 373 | 0 | 0 | 0 |
| B and minor road km | 3368 | 2523 | 811 | 811 | 638 |
| A road grade, median / 90th (%) | 2.1 / 6.1 | 1.6 / 5.8 | n/a | n/a | n/a |
| B road and lane grade, median / 90th (%) | 3.1 / 9.3 | 2.6 / 7.9 | 1.5 / 4.3 | 1.4 / 4.3 | 2.0 / 4.3 |
| land slope, median / 90th (%) | 8.1 / 19.5 | 6.7 / 19.1 | 3.1 / 8.9 | 2.7 / 9.0 | 3.5 / 11.1 |
| lane grade over the slope of its ground (median) | 0.6 | 0.57 | 0.49 | 0.54 | 0.54 |
| land height, median / 90th (m) | 119 / 240 | 159 / 290 | 243 / 303 | 256 / 305 | 234 / 300 |
| railway km | 172 | 95 | 0 | 0 | 0 |
| plan made in (ms) | 4105 | 2740 | 2309 | 2089 | 1294 |

## The places: the seeded street layouts on the real towns' yardsticks

The real column is what `tools/os/towns.mjs` and `measure.mjs` measured over the bakes' own streets
(`PRIORS.towns`, `PRIORS.roads`); the seeded columns are `layStreets` over every place on those plans.

| | real (measured) | seeded: 42 | seeded: 7 | seeded: 1234 |
|---|---|---|---|---|
| radials per town (median) | 5 | 5 | 5 | 5 |
| radials per village (median) | 3 | 3 | 3 | 3 |
| junctions in towns: dead ends / T / crossroads | 0.31 / 0.65 / 0.04 | 0.33 / 0.65 / 0.03 | 0.28 / 0.70 / 0.02 | 0.27 / 0.71 / 0.02 |
| junctions in villages: dead ends / T / crossroads | (as towns) | 0.40 / 0.55 / 0.06 | 0.40 / 0.54 / 0.06 | 0.39 / 0.53 / 0.08 |
| street piece between junctions, towns (m, median) | 71–79 | 72 | 71 | 71 |
| street piece, villages (m, median) | (as towns) | 68 | 68 | 68 |
| orientation order, towns (1 a grid, 0 every bearing alike) | 0.01–0.05 (core), 0–0.01 (suburb) | 0.09 | 0.02 | 0.03 |
| orientation order, villages | (as towns) | 0.02 | 0.02 | 0.01 |
