# 3D industries

Industrial sites for the 3D game: a catalogue of UK industry types and their freight chains,
procedural site models fitted to a plot, cheap animated production effects, and supply-area
overlays for the UI. Everything lives in `src/proto/industries/` and nothing outside it depends
on it yet. This page is the API and the plan for wiring it in.

```
catalogue.ts   types, cargo, chains, sizes, eras, station kinds, catchments (pure data)
state.ts       IndustryVisualState (what the economy sends) and the moving-part descriptions
kit.ts         vertex-coloured geometry kit (one mesh per site; runs under Node)
site.ts        plot fitting and the parts a site is made of
models.ts      buildIndustry(): one recipe per type, three or more variants each
fx.ts          IndustryFx: every site's moving parts in nine instanced meshes
overlay.ts     catchment rings, need/output icons, chain helpers (plain data)
index.ts       the public surface
demo.ts        the gallery behind /industries-demo.html
```

## The catalogue

`INDUSTRY_TYPES` is keyed by `IndustryId`. The 2D game's six ids (`coal_mine`, `power_station`,
`forest`, `sawmill`, `farm`, `food_plant`) are kept, with the same produced cargo and base rate,
so the economy being ported from `src/sim.ts` can adopt the table without renaming anything.
Nine are new: `quarry`, `iron_ore_mine`, `steelworks`, `oil_well`, `refinery`, `brewery`,
`goods_factory`, `port` and `warehouse`.

Each type has:

| Field | Meaning |
|---|---|
| `role` | `primary` (from the ground), `processor`, `sink` (consumes, makes nothing you carry), `hub` (stores and re-sends the same cargo) or `gateway` (docks: exports in, imports out, independently) |
| `mix` | for processors: `all` needs every required input for a cycle; `any` runs a cycle on whichever input is there |
| `inputs`, `outputs` | amount per production cycle. An input can be `optional`; while every optional input is supplied, output is multiplied by `boost` |
| `rate` | cycles per second at production level 1 (the 2D game's `rate`) |
| `size`, `minSize` | preferred and smallest site, in metres, `w` along the road frontage |
| `era` | years new ones appear; each variant has its own era too |
| `serve` | station kinds that can serve it: `lorry`, `rail`, `quay`. `SERVE_2D` maps these onto the 2D `StationKind`s |
| `waterside` | `required` (docks) or `optional` (a quay is possible if the plot touches water) |
| `catchment` | metres from the site boundary a station may be and still serve it |
| `variants` | at least three. `outputScale` lets a variant lean one way (an arable farm makes more grain, a livestock farm more livestock) |

The chains:

```
coal_mine ──coal──┬──────────────▶ power_station (sink)
                  ├──────────────▶ steelworks ◀── iron_ore ── iron_ore_mine, port (import)
                  └──▶ port (export)   ▲  └──steel──▶ goods_factory, port (export)
quarry ──stone──▶ towns, steelworks (optional flux, ×1.25)
forest ──wood──▶ sawmill ──planks──▶ goods_factory, towns
farm ──grain──▶ brewery ──beer──▶ towns, warehouse
     ├─grain/livestock──▶ food_plant ──food──▶ towns, warehouse
oil_well, port ──oil──▶ refinery ──fuel──▶ towns, warehouse
                                 └─chemicals──▶ goods_factory
goods_factory ──goods──▶ towns, warehouse, port (export)
warehouse: goods, food, beer, fuel in ──▶ the same out, to towns
```

Steel needs coal **and** iron ore, iron ore comes from a mine or the docks, and limestone helps,
so a steelworks is a routing puzzle on its own. Two 2D chains change shape: the sawmill makes
planks and the food plant makes food, rather than both making goods. `CARGO_2D` maps every new
cargo to its nearest 2D one for anything that still only knows five.

Helpers: `variantFor(type, year, seed)`, `outputRate(type, level, variant)`, `consumersOf(cargo)`,
`producersOf(cargo)` and `TOWN_ACCEPTS`.

## Building a site

```ts
import { buildIndustry, plotFromLot, IndustryFx } from './industries';

const model = buildIndustry('steelworks', plot, { seed, variant: 'integrated', year });
scene.add(model.group);               // static: one mesh, one material
const handle = fx.add(model, state);  // moving parts
```

- `plot` is `{ poly: {x,z}[], facing?: {x,z} }`: any simple polygon in world metres and the
  direction of its road. Without `facing`, the longest edge is taken as the frontage.
  `plotFromLot(lot)` and `plotRect(cx, cz, rot, w, d)` make one from a `Lot` or a rectangle, with
  the same convention as buildgen (`group.rotation.y = -rot`, local +z faces the road).
- `fitPlot` turns the site to face its road and finds a large rectangle inside the plot (shrink
  the bounding box until it fits, then push each side out while it still fits). Recipes lay out
  in that rectangle; the grass and the fence follow the real plot outline.
- The model is deterministic: the same type, variant, seed, year and plot always give the same
  triangles and the same moving parts. A save needs only those.
- `model.anchors` says where the gate is and where stations can go: lorry bays (position and
  heading), rail sidings (`x0`, `x1`, `z`) and quays, in site-local metres. `toWorld(frame, x, z)`
  converts.
- `model.dyn` is plain data for the moving parts: piles, rotors, emitters, movers, lamps, berths
  (where a lorry, wagon or ship would stand) and decay spots.

## Production visuals

The economy drives each site with an `IndustryVisualState`:

```ts
interface IndustryVisualState {
  production: number;          // 0..4, the 2D production multiplier; 0 = not producing
  input: number;               // 0..1 fill of the input stockyards
  output: number;              // 0..1 fill of the output stockyards
  running: boolean;
  recentlyDelivered: boolean;  // a load came or went in the last few game hours
  year: number;                // lamp colour (sodium before 2000) and soot (before 1960)
  inputs?, outputs?: Partial<Record<CargoId, number>>;  // per-cargo overrides
  neglect?: number;            // 0..1; weeds from 0.3, derelict (lights out, still) from 0.6
}
```

`IndustryFx` draws every site's moving parts in nine instanced meshes, whatever the number of
sites: heaps, boxes (crates, containers, steel, cranes, conveyor loads, vehicles), tank roofs,
log bundles, winding wheels, blobs (animals, weeds, rubble), puffs (smoke, steam, flame), lamps
and lamp glow.

- Stockpiles grow and shrink: a heap keeps its angle of repose, so each dimension scales with
  the cube root of the stock; log rows, crate and container stacks fill slot by slot and layer by
  layer; a tank's floating roof or a silo's grain rises; a herd gains animals.
- Smoke and steam are a few puffs per chimney that rise, grow and fade on a loop, each a pure
  function of the clock. They stop when the site isn't running.
- Winding wheels, pumpjacks, crane jibs, gantry trolleys and conveyor loads move at a pace set by
  the production level.
- Lamps light at night while anyone is on site, with a glow on the ground under floodlights.
- `recentlyDelivered` parks a lorry in a bay, wagons in the siding and a ship at the quay.
- Neglect brings weeds and rubble, turns the lights off and stops everything.

Cost: `setState` and `setNight` recompute only that site's piles, lamps, vehicles and decay.
`update(time)` recomputes wheels, cranes, conveyors and smoke at `hz` (12 by default) and does
nothing between. 45 sites in the gallery use about 3,500 instances.

## Overlays

`overlayFor(model, state)` (or `catchmentOverlay(type, frame, outline, state)`) returns data, not
meshes:

- `ring`: the site outline grown by the catchment radius (the convex hull offset with rounded
  corners);
- `icons`: one per input and output, with glyph, colour, label, a world position along the
  frontage, the stock `level`, and `optional` or `starved` flags;
- `serve`: the station kinds allowed.

`serves(overlay, stationPos, stationRadius, kind)` answers "can this station serve this site?".
The two radii add, as in the 2D game. `linkCargo(a, b)` and `chainFrom(id)` are there for route
planning hints.

## Integration plan

1. **Economy adopts the ids.** The economy's industry table imports `INDUSTRY_TYPES`, or copies
   its numbers, for inputs, outputs, `mix`, `boost` and `rate`. Its production loop replaces the
   2D `converts` with: for `all`, a cycle consumes each required input; for `any`, a cycle
   consumes one input. The per-minute review that raises or lowers `rate` (1 to 4) carries on and
   becomes `production`.
2. **Placing industries.** World generation or the player picks a type allowed in the current
   year (`era`), a variant with `variantFor`, and a plot of at least `minSize`. The plot comes
   from the land registry: ask `land.free(poly)`, then claim it as `industry:<id>` so roads and
   houses keep off. Plots are polygons, so they can later come from OpenStreetMap
   `landuse=industrial` outlines unchanged. Waterside-required types need a plot edge on water.
3. **Stations and catchment.** A station serves a site when `serves(overlay, pos, radius, kind)`
   is true. The station kind must be in `type.serve`. `anchors.lorry`, `anchors.rail` and
   `anchors.quay` are good default spots to suggest when the player drags a station near a site.
   Loading moves stock between the site's output store and the station, as `sim.ts` does now.
4. **Visual state from ticks.** After each economy tick, or each game minute (it doesn't need
   more), build an `IndustryVisualState` from the site's stock against its capacity, the
   production multiplier, whether it ran this tick, whether a vehicle loaded in the last few game
   hours, and how long since it was last served (for `neglect`). Call `fx.setState` only when
   something changed by more than a few per cent. Call `fx.setNight` from the day clock in
   `main.ts` and `fx.update(time)` once a frame.
5. **Chunk baking and animated parts.** `model.group` has one mesh with one shared material
   (`SITE_MAT`), so `main.ts` can bake it with `bakeGroup` and merge it into its 120 m chunks like
   any building: the chunk gains no draw calls. Moving parts never enter the chunks. They stay in
   the single `IndustryFx` added to the scene once. A site that is rebuilt (variant or year
   change) is removed from its chunk and from the fx, and added again.
6. **Workers.** `buildIndustry` is pure and uses no DOM, so it can run in the planned mesh
   worker. Post back the position, normal and colour arrays and `dyn`.
7. **UI.** The catchment ring and icons are drawn by the UI layer from `overlayFor`, only for the
   selected site or while placing a station.

## In the game now

`src/proto/game/industry.ts` (`Industries`) does steps 2, 3, 4, 5 and 7 for the seed town.

- **Placing.** `findPlot(wish)` walks the roads near a point and fits the largest rectangle
  (preferred size down to `minSize`) set back 5 m from the kerb. The plot must be clear of every
  land claim and every site, and on land the wish accepts. `place()` claims it as `industry:<n>`.
  `townWishes()` is the British market town now:
  - on the estate: a distribution centre, a factory, a sawmill, a brewery and a food plant;
  - out of town: a farm, a forest and a quarry.

  The estate's buildgen industry plots are dropped. A road built through a site takes it
  (`evict()`, called from `evictFromWorks`).
- **Drawing.** Each site's mesh is baked to world space with a blank `uv`. `main.ts` merges it
  into its chunk with buildgen's shared vertex-coloured material (`PLAIN_MAT`), so it adds no
  draw calls. The moving parts are one `IndustryFx` (up to nine instanced draws). Lamps follow
  `nightAt(hour)`, and the animation runs on game time, so it stops when the game is paused.
- **State.** `IndustryFeed.visual(site, ctx)` is what the economy will provide. For now,
  `standInFeed` gives production 1 with nothing calling, and one level more for each stop in the
  catchment, up to 4. Served sites have lorries in their bays and moving stock. `tick(clock)`
  refreshes once a game minute (and after any road change) and calls `fx.setState` only on a
  real change.
- **UI.**
  - Tapping a site opens its info sheet: `shell.openInfo`, with cargo chips using Tabler icons
    from `game/icons`.
  - The selected site shows its ring and cargo badges on the map.
  - While the stop tool is in use, every ring shows, and it's lit if the previewed stop would
    serve that site.
  - Layers has an "Industry catchments" toggle.
- **Hook for terminals.** Push a function onto `siteActions` to add an action ("Buy a terminal")
  to every site's sheet.
- **Traffic.** Each site gives traffic a stand-in lot at its gate, so lorries come and go there.

## Viewing

`npx vite --port 5173`, then open `/industries-demo.html`. Parameters help with screenshots:
`?focus=steelworks&variant=integrated&prod=3&in=0.2&out=0.9&neglect=0&year=1965&night=1&ring=1&zoom=300&ui=0&t=4`.
`window.demo` exposes `set({...})`, `focusOn(id, variant)` and `setTime(t)`.
