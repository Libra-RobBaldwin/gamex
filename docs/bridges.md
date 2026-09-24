# Bridges library

`src/proto/bridges/` is a self-contained library for bridges. It holds a catalogue of bridge
types, a chooser that picks one for a crossing, a support layout that places piers and prices
the result, and low-poly three.js geometry for each type. The game doesn't use it yet. This page
covers the API and the plan for plugging it in. `docs/reports/bridges.md` describes what was
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
| `track.ts` | `TrackBuilder`: railway track along any path (ballast bed, sleepers by era, rails with head and foot, open timber decks), with a near and a far look. Nothing in it knows about bridges |
| `earthworks.ts` | Cross-sections for a route on the ground (formation, cess or verges, embankment or cutting, ditch), a road's own surface as a section, and the shared ground material (`earthMaterial()`) |
| `scene.ts` | `bridgeScene()`: a bridge in its surroundings, as the demo shows it and the tests check it. `galleryCrossing()` |
| `coplanar.ts` | `findFights()`: finds faces that would z-fight, for tests |
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
const { object, setOpen, setDetail } = bridgeObject(geo); // one mesh per material; setOpen(0..1) lifts leaves
```

On a railway the deck's track is laid by `track.ts` unless `buildBridge(..., { track: false })`
asks for the old plain ballast and bar rails. The deck's slab then stops at the track's
formation, and its runs come back in `geo.track`. `bridgeObject()` builds them, or adds them to
your own `TrackBuilder` if you pass one (`bridgeObject(geo, mats, { track: builder })`), so all
the track in a scene is built together. Call `setDetail(metresPerPixel)` when the camera changes.
Which deck a type carries comes from `deckForm(id)`: bare timbers with guard rails on timber
trestles, steel girders, trusses and bascules, and ballast across masonry and concrete.

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

## Track and earthworks

### Track (`track.ts`)

```ts
import { TrackBuilder, metresPerPixel } from './bridges/track';

const tb = new TrackBuilder();
tb.add({ path, s0: 0, s1: len, level: (s) => y(s), tracks: 2, form: 'ballast', year: 1905 });
const track = tb.build();          // group, near, far, sleepers, setDetail(), dispose()
scene.add(track.group);
// whenever the camera moves or zooms:
track.setDetail(metresPerPixel(camera, renderer.getDrawingBufferSize(v).y));
```

A `TrackRun` is a stretch of track along a path. `level(s)` is the top of the ballast; on an
open deck, the bed the timbers sit on. Rail heads stand 0.25 m above it.

- **Dimensions:** standard gauge (1.435 m between the running edges), sleepers at 0.65 m
  centres on one grid along each path (so runs laid end to end stay in step), double track
  at 4 m centres, a 0.3 m ballast bed with 1:1.5 shoulders.
- **Era:** timber sleepers in cast-iron chairs before 1960; prestressed concrete on baseplates
  from 1960. Older ballast is darker.
- **Far look** (the default game camera): one ballast mesh per sleeper kind, textured with the
  sleepers, chairs and rails painted on (a 256×32 texture with hand-made mipmaps that keep the
  rails a texel wide), plus one strip for open decks. That's one or two draw calls for all the
  track in a scene.
- **Near look** (a sleeper pitch covers five or more pixels, `DETAIL_MPP` = 0.13 m a pixel):
  the same bed with a plain-stones texture, real rails (a ten-sided head, web and foot section)
  and instanced sleepers, each exactly over its painted twin so the switch doesn't shift
  anything. Sleepers and rails are built in chunks of about 120 m, one instanced mesh and one
  rail mesh per chunk, so zoomed in only the chunks on screen are drawn.
- **Corners:** the bed and rails are mitred at every corner of the path, and sleepers turn with
  the track over three metres, so polylines with sharp corners still look right.
- **Cost:** a sleeper with its two chairs is 30 triangles; rails are 22 triangles per rail per
  3 m. Nothing runs per frame: `setDetail()` only flips two groups' visibility.

### Earthworks (`earthworks.ts`)

`halfSection(road, hw, level, ground)` gives one half of a route's cross-section on the ground,
centreline out: the formation (the track bed and its cess, or the road's own surface on its
pavement with verges a little lower), then an embankment down to the ground or a cutting up to
it, then a ditch on the low side. It always has the same number of points, so sections can be
swept along a route that goes from embankment to cutting. Cuttings deeper than 1.2 m show bare
soil; deeper than 4 m they're rock, and stand steeper.

`earthMaterial()` is the ground look: one flat-shaded Lambert material with vertex colours
saying what each surface is (grass, cinder cess, ditch, soil, rock), a tiling 256² noise
texture sampled in world space (no UVs), and slopes found from the real face normals, which get
rougher, yellower grass with terracettes along the contours. Slopes run from a pale crest to a
lush toe. `EarthGeo` collects triangles for it. When the shared ground module lands
(`src/proto/ground/`), swap `earthTexture()` for its grass and keep the vertex-colour kinds.

`bridgeScene()` in `scene.ts` shows it all in use: the ground and the earthworks as one mesh,
spill slopes under the first span at each abutment (steepened to fit, with a wing wall for
whatever's left), benches cut and built out for roads and railways crossing a valley side, and
the map's cut edges.

### Nothing coplanar

`findFights(object)` lists pairs of faces within 4 cm of each other, at nearly the same angle,
over the same ground: the recipe for z-fighting. `scene.test.ts` runs it over every gallery
type, the chooser's crossing and curved railways, in the near and far look. Its rules, which
the fixes it forced follow:

- Nothing lies on anything else. Ballast sits on a formation 0.3 m below its top; roads stand
  on their own pavement; lines, kerbs and footways are stretches of the road's one surface.
- A member bearing on another runs into it by 10 cm (beams into slabs, pier caps into girders,
  posts into caps), so no two faces meet flush.
- Flat tops stand clear of sloping ground by 15 cm (footings, abutment seats, anchorages).
- The demo's camera keeps its depth range to the scene: a phone's depth buffer may have only
  16 bits.

### Adopting the track in the game's railways

1. In `roaddraw.ts`, for each rail segment collect a `TrackRun` per stretch of the same form:
   `path` is the segment's densified path, `level` its profile, `tracks` from the rail class,
   `year` the year it was built, `form` `'ballast'` on the ground and `deckForm(type)` on a
   bridge. Laying runs of one segment on one `path` keeps the sleepers in step across joins.
2. Build one `TrackBuilder` per tile (or per batch the network already draws together) and add
   `track.group` where the rail meshes go now. Drop the network's own ballast strip and bar
   rails for those segments.
3. Draw the formation, not the ballast, in the network's ground or embankment mesh: the ballast
   bed's toe (`bedWidth(tracks).toe`) sits `BALLAST_DEPTH` below `level`. `halfSection()` gives
   the whole cross-section if the game wants its embankments to match.
4. Call `track.setDetail(metresPerPixel(camera, bufferHeight))` from the camera's change handler
   (not every frame), once for all tiles.
5. On a bridge, pass the network's builder to `bridgeObject(geo, mats, { track: builder })`, so
   the deck's track joins the approach's without a seam.
6. Dispose with `track.dispose()` when a tile is rebuilt. The textures and materials are shared
   and stay.

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
| `at` | `start`, `end` or metres along the route (`start-4` is 4 m back from the first abutment): what zooming heads for instead |

`window.demo` has `renderer`, `scene`, `cam` and `track`, for the screenshot scripts.

Drag to turn or tilt the camera, and use the mouse wheel or a pinch to zoom.

The page isn't in `vite.config.ts`'s build inputs, because this change adds files only. Add
`bridges: resolve(__dirname, 'bridges-demo.html')` there if it should ship in a build.
