# One-way roads, slip roads and motorway junctions (R2)

Step R2 of `docs/region.md` and step 2 of `ROADMAP.md`. The code is in `src/proto/interchange/`, plus
additive changes to `catalog.ts`, `roads.ts`, `xsection.ts`, `junction.ts`, `jshape.ts`, `traffic.ts`
and `roaddraw.ts`.

## Try it

- `/proto.html?junction=dumbbell`, `?junction=gsr`, `?junction=diamond`: one junction on its own.
  Add `&slips=parallel` for slip roads with a long parallel lane.
- `/proto.html?junction=blank`: a north–south dual carriageway on an empty map. Build a motorway
  across it (Build › Roads › Motorway) and the blueprint card offers **Junction here**.
- The starter town (`/proto.html?map=town`): its motorway along the south edge is now a pair of
  carriageways (`pairUpMotorways`, run after the town's streets are built).

## One-way roads

- A segment has a `oneway` flag (`RSeg.oneway`). Traffic only runs from its `a` end to its `b` end.
- `Network.def(s)` gives the one-way version of the segment's type (`catalog.oneWay`):
  - the same lanes, all running one way on one carriageway;
  - no reservation and no centre line;
  - on a motorway or a fast dual, a 1 m (or 0.7 m) hard strip on the offside.
- The path runs down the middle of the carriageway, so land, bridges, cuttings and plots are all
  symmetric as before. Only the lanes are laid out differently: `catalog.laneBase(d)` is where the
  lanes start. For a two-way road that's half the reservation. For a one-way road it's the offside
  edge, which is negative. Traffic (`laneOff`), cross-sections (`sectionAt`) and markings all read it.
- `RoadOpts.oneway` builds one. Splitting a one-way road keeps its direction.
- **Everything that respects it:**

  | Where | What it does |
  |---|---|
  | Routing (`traffic.adj`, `plan`, `search`) | Only a → b. A trip from a one-way road goes on ahead, even to somewhere behind it on the same road. |
  | Off-map roads (`edges`) | Split into where trips start and where they end. |
  | Buses | Start the right way. They never turn round on a one-way road. |
  | Diversions and re-routes | Never go up a one-way road. |
  | Junction design (`Leg.into` / `Leg.out`) | Flows, lane use and scores only for movements that can happen. No give-way line or arrows across a road that only leads away. |
  | Drawing | No centre line. Lane lines on one side. Edge lines both sides where there are hard strips. A barrier in the central reservation of a motorway pair. |
  | Stops | Only on the left. |

- **Two-way roads behave exactly as before.** The traffic harness numbers for the old scenarios are
  unchanged.

## A motorway as a pair

- `interchange/build.ts`, `buildPair(net, line, type)`: two one-way carriageways either side of
  the line. The one on its left runs the way the line was drawn.
- Between their verges is a 10.5 m reservation (`RESERVATION`), claimed as road land. It is wide
  enough for the bridges library to stand an overbridge's pier in the middle. With the verges
  touching, every overbridge became an 80 m steel truss.
- `pairToNode` builds a pair that ends at a junction. The carriageways splay in over their last
  stretch, so each has its own mouth on the roundabout. The starter town uses this.

## Slip roads: merges and diverges (`interchange/slips.ts`)

A slip road (`catalog`'s `slip`: one lane, one way, hard strips, 50 mph, part of the motorway) meets a
carriageway at a node on it. Three one-way roads at a node make a **merge** (two in, one out) or a
**diverge** (one in, two out), with the slip road on the nearside. These are two new junction forms.
Their shape (`slipShape`) holds:

- **The nose:** where the slip road's own drawing stops, which is where its kerb has parted from
  the carriageway's by `STD.noseTip`. A hatched nose runs between that point and where the lanes
  touch, at the node.
- **The course** the slip lane takes alongside the nearside lane, then into it (a merge) or out of
  it (a diverge). Traffic drives it as the junction's slip path. A merging car finds a gap before
  its gate. A diverging one is in the nearside lane beforehand.
- **The extra carriageway and verge** it takes, and the land.
- **The markings:** the hatched nose, the broken line (TSRGD diagram 1010) where the lanes meet, and
  the edge lines. The carriageway's own nearside edge line gives way to the junction's over that
  stretch (`edgeGap`).

Lengths come from `standards.ts`, following DMRB CD 122:

| | 70 mph | 60 mph | 50 mph | ≤40 mph |
|---|---|---|---|---|
| `STD.merge` taper / nose | 150 / 100 m | 125 / 85 | 100 / 70 | 75 / 55 |
| `STD.diverge` taper / nose | 150 / 80 m | 125 / 70 | 100 / 55 | 75 / 45 |
| `STD.parallel` length / taper | 200 / 90 m | 170 / 80 | 140 / 70 | 110 / 60 |

- **Taper layout (A):** the slip lane closes into, or opens out of, the nearside lane along a
  straight taper.
- **Parallel layout (B, `slips=parallel`):** the slip lane is a whole auxiliary lane alongside for
  `length`, with a short taper at its far end. This is the look in the user's Cities: Skylines clip.
  The slip road carries it as `RSeg.aux`.
- Traffic through a merge or diverge keeps to the roads' own speed. The 15 m/s limit only applies
  inside ordinary junctions.

- **Keep left to leave.** A slip road at a merge or diverge is reached only from the nearside lane
  (`slipOnly` in `traffic.ts`). A car in another lane that wants the slip road plans it anyway, but
  the plan is marked `wrong`: it isn't entered, and holds nobody up, until the car has changed down
  into the nearside lane. Without this a car in lane 1 took a long curve across lane 0.

## Chevrons and ghost islands (TSRGD diagram 1042)

- Where a motorway's two carriageways splay into a roundabout, the gap between them is a **ghost
  island** on the tarmac, not a grass triangle (`jshape.ghostIslands`): solid chevrons between the
  roads' own edge lines, with a small rounded grass nose at the wide end.
- The same chevrons fill the nose of every slip road (`slips.ts`).
- `jshape.chevronsIn` lays them: solid V bars, their points towards the narrow end where the two edges come together, sized by
  `standards.chevron(mph)` (1.0 m bars 1.6 m apart at 60 mph and over, 0.8/1.4 at 40, 0.6/1.2 below).

## Pedestrian crossings

- `jshape.crossingAt(shape, form, leg, y)` says where people cross each arm of a junction. The
  crowds (`game/crowdsites.ts`) and the drawing both read it, so people cross where the crossing is
  drawn.
- Drawn at both kerbs: tactile paving, buff blister for an uncontrolled crossing, red with studs
  across the carriageway at signals.
- Only on single-carriageway arms with footways, a little way back from the corner and clear of a
  roundabout's splitter island. None on dual carriageways, motorways or merges.

## Grade-separated junctions (`interchange/build.ts`)

| Form | Built from |
|---|---|
| **Dumbbell** | A roundabout either side of the motorway, and the local road on a bridge over both carriageways between them. |
| **Grade-separated roundabout** | A one-way ring (`gsr-ring`, 2 lanes, 40 mph) about the junction, over the motorway on two bridges. The local road and the slip roads meet it at give-way junctions, the slip roads at 40° to it from outside. |
| **Diamond** | A dumbbell with give-way junctions instead of roundabouts. |

- Each has four slip roads. The off-slips diverge before the junction and the on-slips merge after
  it. They curve round to the local road at radii no tighter than the slip road's minimum.
- The bridges come from the bridges library, through `Network.build` with `cross: 'bridge'`. The
  ramps have room for a beam's depth. On an open site that gives a two-span concrete beam, with a
  pier in the reservation.
- A junction is one `Interchange`: its nodes, its roads, and the form each of its junctions must
  take (`prefer`, which `main.ts` passes to the designer).
- **It's built whole or not at all.** Each junction is tried on a copy of the network first
  (`scratch`).
- `motorwayWithJunction(net, form, line, type, road)` does the whole thing:
  1. cuts the local road where the junction's nodes go;
  2. builds the pair through the gap;
  3. builds the pieces.
- `buildJunction` puts a junction on a pair that already exists.
- **Size:** at 70 mph a junction takes about 950 m of motorway (1,250 m with parallel lanes). The
  dumbbell takes about 430 m across, and the grade-separated roundabout's ring is about 140 m in
  radius.

### In the game

- **Junction here:** a motorway blueprint that crosses a road shows the forms, and taper or long
  parallel slip lanes, on its card (`interchange/plan.ts`). The card shows:
  - the price;
  - what it demolishes;
  - why it can't be built, if it can't.

  The ghost shows every piece. Build builds it.
- **Tapping any part of a junction** opens one panel for the whole thing. It shows the busiest lane
  in any of its junctions, the lengths of its slip roads, and buttons to edit its roundabouts or
  give-ways in the junction designer.

## The starter town

- The motorway is now a pair of carriageways, splaying into the roundabout at its end.
- **There's no grade-separated junction there, because one doesn't fit:**
  - at-grade, the bridge's ramps put the junction's roundabouts or give-ways 160–220 m either
    side of the motorway;
  - the estate's streets are 90 m north of it, and the map ends 50 m south of it.

  One would fit with the motorway in a cutting, which is a job for the terrain step.
- Screenshots (412×915) are in the PR.

## The region (`interchange/region.ts`)

`layRegionRoads(net, region)` takes `{ bound, settlements: { id, kind, x, z, r, gates? }[], links: { a,
b, road: 'A' | 'B' }[] }`. That is the shape `src/proto/region` gives as `map.settlements` and
`map.links`. It lays out:

- **one motorway right across the map:** along the principal axis of the city and the towns, set
  off to pass at least 300 m clear of every place, as close to the biggest as it can be;
- **3–4 dumbbells,** level with the biggest places, 1.3 km apart and 650 m from the edges, each
  with an A road to its place;
- **A roads** (`rural-60`) between the city and the towns;
- **B roads** (`rural-50`) to the villages. Where they cross the motorway they bridge it.

It's tested on a made-up region: every place reaches every other, and one-way roads are respected.
The generator has merged (`src/proto/region`); wiring `layRegionRoads` into `?map=region` is left to
the region session, since this stream doesn't touch `src/proto/region/`.

## Tests

| File | What it checks |
|---|---|
| `interchange/interchange.test.ts` | Tapers and noses measured from the course traffic drives against `STD`, for each form and for parallel lanes. The drawn surfaces round every junction window (`drawcheck.ts`): no holes, stray markings or footway/verge fights. A junction that can't be built changes nothing. One-way streets: nobody ever goes the wrong way. |
| `traffic.test.ts` (scenarios in `trafficsim.ts`) | Motorway junction scenarios for all three forms and for parallel lanes, with lorries running end to end along the motorway: zero overlaps at 30 and 10 frames a second. |
| `interchange/region.test.ts` | The region's roads. |

## Known limits

- **Slip roads are one lane.** The clip's slip road opens out to two lanes; that's a follow-up.
- **The grade-separated roundabout's ring can queue back** at the local road's give-ways when the
  local traffic is heavy. In the harness that's up to 2 give-ups in about 200 trips; the limit is 1 in 100.
- **Junction design:** the give-way corners on the ring's curve leave a 5 cm hairline of asphalt.
- **No mid-block zebras or refuges yet.** Crossings are only at junctions. Zebras near bus stops and
  refuges in splitter islands are the obvious next step.
- **Merges and diverges are laid out on the carriageway as it runs.** A tight curve through one
  would bend its taper with it. The builders use straight motorways at their junctions.
