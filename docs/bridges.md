# Bridges library

`src/proto/bridges/` is a self-contained library for bridges. It holds a catalogue of bridge
types, a chooser that picks one for a crossing, a support layout that places piers and prices
the result, and low-poly three.js geometry for each type. The game uses it through
`src/proto/game/bridges.ts` (see **In the game**). This page covers the API and the plan for plugging it in. `docs/reports/bridges.md` describes what was
built and why.

Try it with `npx vite --port 5173`, then open `/bridges-demo.html`. It has two modes: a gallery
of every type, and a river crossing where the chooser picks the type. See **Demo** for the URL
parameters.

## Files

| File | What it holds |
|---|---|
| `catalogue.ts` | `BRIDGES`: the twelve types as data, plus `COST_SCALE`, `deckRate`, `depthOf`, `availableIn` and `approachFor` |
| `crossing.ts` | `Crossing`: what a bridge has to cross. Also `extents()` (where along a route the bridges go), `demand()`, `deckWidth()` and `pointOn()` |
| `layout.ts` | `layoutBridge()`: places the supports and costs the bridge. `underside()` gives the structure's soffit anywhere along a span |
| `choose.ts` | `chooseBridge()`, `override()` and `chosenLayout()` |
| `geometry.ts` | `buildBridge()`: one `BufferGeometry` per material. `bridgeObject()` wraps it in a `THREE.Group` that can lift its leaves |
| `materials.ts` | `COLOURS` and `bridgeMaterials()` |
| `scenario.ts` | `scenario()`: ready-made crossings built with the real height solver, for tests and the demo |
| `gallery.ts` | One showcase crossing per type, and the chooser's river crossing |
| `demo.ts`, `/bridges-demo.html` | The demo page |

## The catalogue

Each `BridgeDef` carries these fields. The figures are roughly UK, in 2020s money.

| Field | Meaning |
|---|---|
| `span.min/max` | Clear span between supports (m) |
| `length.min/max` | Whole bridge, end to end (m) |
| `depth.min/ratio` | Structural depth below the road surface: `max(min, span / ratio)`. The box girder is haunched: this is its depth at the piers, and about half that at midspan. |
| `rise` | Arches only: the drop from crown to springing, as a fraction of the span (0.5 for a semicircle) |
| `above(len)` | Height of the structure above the deck: trusses, arch ribs, pylons, towers |
| `maxPier` | Tallest pier the type can stand on |
| `maxGrade` | Steepest deck it can be built to. This applies to its own spans; approach spans follow their own type. |
| `roadTonnes`, `railAxle` | Gross road vehicle (t) and rail axle load (t). `railAxle: 0` means no railway. |
| `roadMph`, `railMph` | Speed limit on the bridge, if there is one |
| `era.from/to` | Years it can be built in |
| `cost` | Real pounds: `deck` per m² (it rises towards the type's longest span), `pier` plus `pierPerM` of height, `abutment` per end, `main` plus `mainPerM` for each pylon, tower, lifting pier or springing, and `maint` per m² a year |
| `opening` | Movable bridges: seconds of warning, lifting and boat passage per opening |
| `layout` | `multi` means a row of similar spans. `main` means one big span with approach spans either side. |

| Type | Span (m) | Loads (road t / rail axle t) | Years | Deck £/m² | Notes |
|---|---|---|---|---|---|
| Timber trestle | 4–12 | 18 / 20 | 1830–1930 | 1,400 | 30 mph, 4% max, high upkeep |
| Masonry arch viaduct | 6–40 | 150 / 25.5 | 1750–1940 | 5,200 | 4% max, piers up to 50 m, almost no upkeep |
| Steel girder | 8–50 | 150 / 25.5 | 1845– | 3,800 | Half-through plate girders |
| Steel truss (through) | 30–180 | 150 / 25.5 | 1850– | 5,600 | Shallow floor, trusses above the deck |
| Steel truss (deck) | 30–150 | 150 / 25.5 | 1860– | 5,000 | Deep: needs the deck high |
| Concrete beam | 8–45 | 150 / 25.5 | 1950– | 2,900 | Cheapest modern type |
| Concrete box girder | 40–250 | 150 / 25.5 | 1965– | 4,300 | Haunched, tall piers |
| Concrete arch | 40–250 | 150 / 25.5 | 1905– | 5,200 | Deck arch: needs a deep gap |
| Steel tied arch | 45–250 | 150 / 25.5 | 1885– | 7,200 | Arch above the deck, no depth needed |
| Cable-stayed | 110–650 | 150 / 22.5 | 1970– | 8,000 | 125 mph for trains, 5% max |
| Suspension | 150–1450 | 44 / – | 1826– | 9,500 | No trains, no abnormal loads, 4% max |
| Bascule (lifting) | 15–80 | 44 / 22.5 | 1890– | 12,000 | 2% max, shuts the road for boats |

`COST_SCALE = 0.03` turns real pounds into game money. It was chosen so a 60 m, three-span
concrete bridge carrying a street over a road costs about what `RAISE_COST` charges today:
£90k against £77k. The real figure is £3.0m, about £4,200/m². Unlike `RAISE_COST`, the price
scales with deck width, so a dual carriageway costs about twice as much. Tune it in one place.

## Describing a crossing

```ts
interface Crossing {
  path: P[];                        // plan with y = road surface height (from the height solver)
  ground?: (s: number) => number;   // ground or river-bed height along the route (0 if missing)
  obstacles: Obstacle[];            // by distance along the route
  road: RoadDef; year: number; heavy?: boolean;
  resolve?: (need: { raise: number; grade?: number }) => Crossing | undefined;
}
type Obstacle =
  | { kind: 'water'; s0; s1; level; channel?: { s0; s1; clear; tallPerHour? }; name? }
  | { kind: 'road' | 'rail'; s0; s1; surface; clear?; name? }   // no piers on it; headroom over it
  | { kind: 'keepout'; s0; s1; name };                            // e.g. a building or someone's land
```

Some behaviour worth knowing:

- **Headroom.** Headroom over roads and railways defaults to the solver's clearance minus
  `ASSUMED_DECK` (1.2 m): 5.3 m over a road and 6.6 m over a railway.
- **Water.** Any water needs 0.6 m of freeboard. A navigation channel needs `channel.clear`
  above the water level. Piers may stand in the water outside the channel. Footings cost more
  there.
- **Where the bridges go.** `extents(c)` returns the stretches that must be bridged: every
  obstacle, plus anywhere the deck is more than `EMBANK_MAX` (6 m) above the ground. Stretches
  closer than 40 m apart are joined into one bridge.
- **Re-solving.** Give `resolve` whenever you can. The height solver assumes a 1.2 m deck, but
  many types are deeper, and long-span types need gentler ramps. With `resolve`, the chooser asks
  for the profile again with every clearance raised, or the gradient eased, and lays the type out
  on that. Without it, those types are refused, and the option's `lift` says how much higher the
  deck would have to be.

## Choosing, laying out and drawing

```ts
import { chooseBridge, override, chosenLayout, buildBridge, bridgeObject } from './bridges';

const choice = chooseBridge(crossing);           // every type, ranked; choice.recommended
for (const o of choice.options) o.ok ? show(o.def.label, o.cost, o.maint, o.reasons) : grey(o.def.label, o.reasons[0]);
const mine = override(choice, 'truss-through');  // the player's pick (ignored if refused)
const opt = mine.options.find((o) => o.def.id === mine.chosen)!;
const geo = buildBridge(opt.crossing!, opt.layout!, { surface: false }); // the game draws its own road
const { object, setOpen } = bridgeObject(geo);   // one mesh per material; setOpen(0..1) lifts leaves
```

**`BridgeOption`** has these fields:

- `ok`: whether the type can be built here.
- `reasons`: why it can't, or notes when it can ("Deck raised 0.6 m…", "Speed limit 30 mph…",
  "the road shuts 6 min an hour").
- `layout` and `crossing`: the laid-out bridge and the profile it was laid out on.
- `cost` and `maint`: game money, and game money a year.
- `wholeLife`: build cost plus 30 years of upkeep and closure delays.

Options that can be built come first, cheapest first. Refused ones follow. The recommended
default has the lowest `wholeLife`.

**`layoutBridge(c, def, s0, s1)`** can be called on its own for one type. It returns:

- `spans`: `{ s0, s1, len, def, role: 'span' | 'main' | 'side' | 'approach', cost }`.
- `supports`: `{ s, kind: 'abutment' | 'pier' | 'pylon' | 'tower' | 'anchorage' | 'leaf-pier' | 'springing', top, base, inWater, level, along, across, cost, foot }`.
- `real`: the cost breakdown in real pounds.
- `cost` and `maint`: game money.
- `lift` and `grade`: set when it's refused for depth or gradient.
- `closedMinPerHour`: for movable bridges, minutes an hour the road is shut.
- `notes`.

The layout works like this:

1. Each thing that mustn't have a pier on it (a channel, a road, a railway, a keep-out) gets
   the shortest centred span that fits it and clears it. Zones too close together are crossed
   as one.
2. The gaps between are filled with evenly spaced spans, as many as is cheapest (deck price
   against pier price).
3. Big-span types put one main span over the channel, the widest obstacle, or the bottom of
   the valley. Cable-stayed bridges get back spans of 0.42 × the main span. Suspension bridges
   get side spans of 0.3 × the main span, ending at the anchorages. The approaches are built in
   the era's ordinary type: masonry, then girder, then concrete beam.

Afterwards, piers taller than `maxPier` are refused, as is structure reaching the ground and any
span steeper than its type allows.

## In the game

Steps 1–7 of the plan below are in. The glue is `src/proto/game/bridges.ts`:

- `crossingOf(net, path, road)` makes the `Crossing`. It uses:
  - the water sampled along the path;
  - roads and railways underneath, found by walking the deck: wherever a pier (a line across the
    deck's width) would touch a road's full width below, that stretch is kept clear, so skewed
    crossings, junction arms and roads running along under a viaduct are all covered;
  - keep-outs for other junctions' land under a raised deck.
- `extents()` reaches 6 m past each obstacle (it used to be 2 m), so there's room for the
  abutment's footing and setback.
- `check()` refuses a blueprint when:
  - no type fits one of its bridges;
  - a bridge already built overhead would have no room for its piers.

  When a new road only takes a built bridge's headroom below standard, the bridge is re-laid as
  a low bridge, with a note, instead of being refused. Over a railway, the height solver uses
  the railway's clearance, for the overhead wires.
- The game refuses types shorter than their `length.min`, such as a suspension bridge over a
  pond. The earthworks outside the bridges are priced on the path that's actually built.
- `check()` in `roads.ts` calls `priceBridges()`. Inside each extent, the chooser's cost
  replaces `RAISE_COST`. It passes a `resolve` that re-runs `solveProfile` with the over-limits
  raised or the gradient eased. If the chosen type needs it, the raised path is the one that
  gets built.
- `Check.choices` lists the bridges. The blueprint card shows each one's type, length, cost and
  first notes.
- `RSeg.bridges` holds `{ s0, s1, type, override }` for each bridge, and nothing else is
  stored. `build()` fills it from the blueprint. `split()` carries it to both halves.
- `BridgeLayer.sync(net)` runs in `commitRoads()` before `drawRoads()`. It lays out each
  segment whose path, obstacles or stored types changed, keeping the stored type while it still
  fits. A built bridge keeps its type after that type's era ends.
- The drawing is one merged mesh per material for every bridge together. The seed town's three
  bridges take 3 draw calls, and all twelve types together could take at most about 15. The
  bascule leaves are extra.
- `structures()` in `roaddraw.ts` skips the extents. The ramps outside them get retaining walls
  down to the ground, and the thin 24 m piers are gone.
- To edit a bridge, tap it. Its info sheet has **Change bridge type**, which opens a sheet
  listing this year's types: the cost and upkeep of each, the recommended one marked, and
  refused ones greyed out with their reason. Picking one sets the override and re-commits
  through `commitRoads()`. The editor offers only types that fit the deck as it's built.
- `Traffic.speedCap` caps cars at the type's `roadMph`, slowing them from 40 m before the bridge.
  Trains are capped at `railMph`, and brake for it in time.

Not done yet: bascule closures in traffic, abnormal loads, charging for a change of type, water classes and channels (for
water's `navLimits` and `pierBans`), and land claims for piers (steps 8–11). Money is shown but
not charged, because the economy isn't wired in yet.

## Integration plan

The steps are in order. Each one leaves the game working.

1. **Build a `Crossing` in `roads.ts` `check()`.** Everything it needs is already worked out
   there:
   - `path` is the densified path after the profile has been applied.
   - Water obstacles come from the `isWater` sampling loop, which already finds each wet
     stretch (`w0`..`t`).
   - Road and rail obstacles come from `crossings()`. `c.s ± span` is the footprint. `c.e` is
     their surface.
   - Keep-outs are lots the player won't clear.
   - `ground` is 0 until terrain exists.

   Wrap the call to `solveProfile` in a small function of `{ raise, grade }`: raise the `lo` of
   every water and crossing limit by `raise`, and use `G = min(G, grade)`. Pass that function as
   `resolve`.
2. **Costs in `check()`.** Run `extents()`. Price the raised stretches inside a bridge with
   `chooseBridge(...).options[chosen].cost` instead of `L × ym × RAISE_COST`. Keep `RAISE_COST`
   for the embankment stretches outside, which are 6 m or lower. `bridges` becomes the number of
   extents.

   Add `bridges: BridgeChoice[]` to `Check` so the build panel can show the type, its cost and
   the notes. If the chosen type raised the deck, use its `crossing.path` as the path to build.
3. **Store the choice, not the geometry.** Add `bridges?: { s0: number; s1: number; type: BridgeId; override: boolean }[]`
   to `RSeg`. This is the only bridge fact that gets saved: the player's override, as with
   junction overrides. The layout and meshes are derived. When a segment is rebuilt,
   re-choose, but keep an override that's still valid.
4. **Replace `structures()` in `roaddraw.ts`.** For each bridge extent, call
   `buildBridge(crossing, layout, { surface: false })` and merge its parts into the network's
   per-material batches. Materials come from `bridgeMaterials()`, so all bridges on a tile share
   about a dozen draw calls.

   Keep `structures()` only for the ramp stretches outside extents, where it draws the
   retaining walls. Drop its thin 24 m piers. The road surface, markings and railway on the deck
   are already drawn by roaddraw, which follows `y`.

   Bascule leaves are separate objects. Build them with the surface on (the road has to lift
   with them), and don't draw the road over the leaf span.
5. **A bridge editor.** Tap a bridge to open a panel like the junction editor's:
   - `choice.options` as a list: the cost of each buildable type, a ★ on the recommended one,
     and refused types greyed out with their first reason.
   - Tapping an option sets the override and re-commits through `commitRoads()`.
   - The panel shows `notes`: deck raised, speed limit, closures.
6. **Eras.** Pass the game year as `crossing.year`. `availableIn()` and the refusals ("Not
   invented until 1950") are already in the chooser.

   Bridges already built stay when their type's era ends. Rebuilding offers only what's current.
   The catalogue's `era` values are the unlock dates.
7. **Traffic.**
   - Cap link speed on a bridge at `roadMph` or `railMph`.
   - For a bascule, close the link for `closedPerOpening(def)` seconds each time a tall boat
     passes. Until boats are simulated, use the `closedMinPerHour` average as lost capacity.
   - Suspension bridges refuse `heavy: true` loads: abnormal loads have to go round.
8. **Water and navigation clearance, once terrain and water exist.**
   - Each river or canal gets a class, which fixes its channel: a canal is about 10 m wide with
     a 2.5 m air draft, a river barge channel needs about 7 m, and an estuary needs 30–60 m for
     seagoing ships.
   - Feed the solver `level + channel.clear + ASSUMED_DECK` over the channel, instead of the flat
     `spec.water`. `scenario.ts` shows how.
   - `tallPerHour` comes from the river's traffic.
   - The river bed comes from terrain through `ground(s)`. Piers, footings and costs follow
     automatically.
9. **Land claims for piers.** Each `Support.foot` is a four-point footprint. Claim them in the
   land registry with a new owner, `'pier'`, under keys like `bridge:<seg>:<i>`. That way plots,
   parks and trees stay off the piers, while the ground under the deck between them stays
   usable.

   Anchorages and abutments claim the same way. A growing junction that would evict a pier
   should refuse instead.
10. **Terrain.** Give `ground(s)` the height tiles. Valleys make tall piers and the arch types
    worth choosing, and the pier-height limits start to bite.
11. **Performance.** Everything is a pure function of its inputs. Choosing takes 7–25 ms and
    geometry takes 5–70 ms per bridge on a desktop. Cache by (segment, type, profile). Move both
    into the planned Web Worker along with plot and mesh baking.

## Demo

`/bridges-demo.html` takes these URL parameters:

| Parameter | Values |
|---|---|
| `type` | Any `BridgeId` |
| `view` | `iso` (the game's camera), `top` or `low` |
| `mode` | `chooser` |
| `open` | `0`–`1`, for the bascule leaves |
| `zoom` | A number. Zooming heads for the tower, pylon or tallest pier. |

Drag to turn or tilt the camera, and use the mouse wheel or a pinch to zoom.

The page isn't in `vite.config.ts`'s build inputs, because this change adds files only. Add
`bridges: resolve(__dirname, 'bridges-demo.html')` there if it should ship in a build.
