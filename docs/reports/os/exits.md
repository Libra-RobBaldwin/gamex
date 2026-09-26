# How roads leave real places, and how the seeded ones now do

Measured by `tools/os/exits.mjs` (26 Sep 2026) over the two OS bakes, `exe` and `teme`: 31 market towns and
330 villages. A place's built-up area is its buildings (4 or more within 150 m) joined to its centre, holes
filled; a way out is where an A road, B road or lane (not a street, drive or track) last leaves it and runs
600 m on into open country. The numbers are `PRIORS.exits` in `src/proto/region/priors.ts`.

| | towns | villages |
|---|---|---|
| ways out of a place (10th / 25th / median / 75th / 90th) | 7 / 9 / 11 / 13 / 15 | 3 / 3 / 5 / 6 / 8 |
| the angle a road meets the edge at (0°: straight out) | 4 / 11 / 25 / 48 / 79 | 3 / 10 / 23 / 45 / 68 |
| within 30° of straight out | 58% | 60% |
| inside, heading off the line to the centre over its last 400 m | 10 / 17 / 29 / 59 / 88 | 11 / 19 / 36 / 61 / 91 |
| followed straight on, reaches the middle | 27% | 58% |
| turn in its first kilometre outside (net) | 5 / 16 / 40 / 66 / 109 | 8 / 19 / 42 / 83 / 138 |
| angle between one way out and the next | 4 / 11 / 24 / 43 / 67 | 13 / 28 / 59 / 101 / 144 |
| what they are (primary / A / B / lane) | 32 / 42 / 65 / 196 | 109 / 112 / 206 / 1202 |

The rule they show: a road out of a place runs radially through one of its main streets, straight for its
first stretch, and bends towards where it's going only once it's clear of the houses. Where two roads want the
same way out they share it and fork outside. Three of the real places (`node tools/os/exits.mjs --svg <dir>`
draws every town; green rings are the ways out found, with the angle at the edge and inside, and the turn per
kilometre outside):

![Silverton: seven lanes radiating from its crossroads](exits-silverton.jpg)

![Moretonhampstead: eight roads out from its centre](exits-moretonhampstead.jpg)

![Ludlow: its A roads and lanes continue its streets](exits-ludlow.jpg)

## The seeded start town, before and after (seed 42, 1600×900, the same camera)

Before: the lanes came in to the nearer end of the high street from wherever the finder had them, meeting the
town's corners at any angle, three of them side by side.

![before](exits-before.jpg)

After: every settlement has four spokes (both ends of its high street and of its main cross street, each facing
out along its street); a lane leaves by the spoke facing where it goes, runs straight along that street for
150 m and more, then sweeps into its course; two lanes wanting one spoke share it and fork outside
(`worldmap/routes.ts` `spokeFor`, `stem`, `joinStems`, `forks`).

![after](exits-after.jpg)

What this doesn't fix, and the rest of the realism stream is for (`docs/briefs/realism.md`): the town itself is
still a rotated grid with stub streets ending in the fields and a square edge; real towns grow along their
radials, with streets branching off them as T-junctions and closes, and a ragged edge that follows the roads.

## How a place is put together (`tools/os/towns.mjs`, the same 31 towns and 330 villages)

| | towns | villages |
|---|---|---|
| ways out / of them radials (roads that, followed in, reach the middle) | 11 / 5 (45%) | 5 / 3 (59%) |
| angle between one radial and the next (10th / 25th / median / 75th / 90th) | 11 / 20 / 43 / 82 / 142 | 23 / 48 / 87 / 138 / 197 |
| built-up area (ha) | 205 / 291 / 468 / 720 / 1034 | 33 / 47 / 76 / 126 / 238 |
| long axis over short (over 2 is linear) | 1.3 / 1.36 / 1.63 / 1.92 / 2.2; 19% linear | 1.2 / 1.36 / 1.65 / 2.2 / 2.66; 29% linear |
| edge reach along the radials over between them | 0.87 / 1.15 / 1.71 / 2.77 / 3.22 | 0.63 / 0.96 / 1.35 / 1.95 / 2.62 |
| side streets off the radials, per km of radial | 10 / 12 / 15 / 18 / 24 | 3 / 5 / 8 / 11 / 15 |
| of them closes (dead ends) | 9 / 14 / 18 / 22 / 26% | 0 / 0 / 15 / 33 / 50% |
| a side street's length (m) | 33 / 55 / 98 / 191 / 373 | 31 / 60 / 133 / 413 / 1144 |
| a close's length (m) | 49 / 67 / 103 / 165 / 270 | 49 / 66 / 106 / 177 / 430 |

The rule they show, for the generator: a place is its radials first, three to five roads meeting at the
middle, spread round it unevenly (the next one 45° to 90° on, rarely under 20°); the houses run further
out along the radials than between them, so the edge follows the roads, ragged, not a circle or a square;
inside, streets branch off the radials as T-junctions every 60 to 80 m in a town (every 120 m in a
village), one in five of them a close about 100 m long, the rest running on to meet another street. These
are `PRIORS.towns`.
