# Ground

`src/proto/ground/` is the one ground used by the game and every demo. It replaces the flat
speckled grass with a British countryside and market-town edge seen from above:

- pasture with drier and damper patches and tussocks;
- mown lawns (with stripes on big ones);
- rough grass on verges and waste ground;
- a patchwork of fields behind instanced hedgerows: wheat, barley, plough, oilseed rape, leys and stubble, each with its own drill rows and tramlines;
- woods with a woodland floor;
- worn earth at gateways and on building sites;
- lush grass near water;
- rock, scree and heather on slopes and high ground.

It stays calm, so roads, vehicles and buildings remain the most readable things on screen.
It is cheap on a phone: one material, no extra draw calls for the ground, two for all the
hedgerows.

Try it: `ground-demo.html` has the scenes Countryside, Town edge, Hills and Gallery. Its controls:

- zoom presets;
- Before/After (the old speckle grass);
- quality;
- Day/Dusk;
- a performance readout.

## Using it

```ts
import { Ground, setGroundQuality } from './ground';

const ground = new Ground({ region: { x0: -600, z0: -600, size: 1200 }, seed: 11 });
mesh.material = ground.material;   // any plane or terrain mesh with normals; no UVs needed
scene.add(ground.hedges);          // two instanced meshes
ground.paint(input);               // covers, fields and hedges from a GroundInput (below)
ground.change(input, [box]);       // after a plot is built: repaints just round it
setGroundQuality('low');           // 'high' | 'medium' | 'low', for every ground at once
```

Without a `region`, `new Ground().material` is plain pasture that needs no painting. It still
has macro variation, fine detail, and rock and heather from slope and height. It is a drop-in
for any flat green material. Pass `{ base: someLambert }` to patch an existing
`MeshLambertMaterial` and keep its settings; pass `{ hedges: false }` for no hedgerows.

### GroundInput

All polygons are in world metres (`XZ[]`):

| field | what it does |
|---|---|
| `blocked` | road and rail footprints (the land registry's claims). No crops or woods go there. A band round them becomes a verge: mown in town, rough outside it. |
| `lanes` | centrelines of country roads and railways, with `half` = half the claimed width. Each gets a hedge along both sides where the land beside isn't town. |
| `plots` | `garden` → lawn, `site` → bare earth (a building plot being cleared), `yard` → worn and rough (industry). |
| `parks` | lawn; `stripes: angle` mows stripes along that direction. |
| `water` | wet, lusher grass for 20 m round it. Parcels touching it are left rough. |
| `trees` | woodland floor under trees out of town. |
| `town`, `industrial` | extra points that count as town or industry: plots still to be built, an estate's zone. |
| `noFields` | everything that isn't town is grass, with no fields. |

`ground.settleTrees(trees)` moves trees standing in the middle of fields into the woods, keeping
the count. The game uses it at start-up, because its trees were scattered at random.

### Cover classes

The cover map is one RGBA byte texture, 2.5 m per texel, over the region, so the ground makes
one texture read for it (see `covers.ts`, `packCover`). Covers that never meet share a channel,
one on each side of ½, so filtering blends them sensibly (½ is plain pasture):

| channel | below ½ | above ½ |
|---|---|---|
| R | lawn | field |
| B | bare earth | woodland floor |
| A | wet grass | rough grass |

G holds the crop (top 3 bits) and the row direction (32 steps over half a turn). It is only
read where there's a field or a lawn, which never reaches a boundary where two codes meet.
Pasture is whatever is left over. Rock/scree (from `1 − normal.y`) and heather/moor (from world
height) aren't painted: with `new Ground({ terrain: true })` the shader works them out per pixel.
Tune them with `ground.uniforms.uSlope.value`: rock from/to, then heather from/to in metres,
default `(0.2, 0.34, 70, 130)`. A flat map leaves `terrain` off and doesn't pay for them.

Fields are world-anchored, so every map anywhere agrees about them. There is one field style
everywhere, the farm blocks of `region/fields.ts` (`Countryside`, docs/regiongen.md). A `Layout` takes a field
source (`FieldSource.blocksNear(box)`, `plan.ts`) and lays out the blocks touching any box it's
asked about, whole and only once (`ensure`), into a `PlanIndex`. A 50 km map's source is
`worldmap/country.ts` `countryFor(plan)`, which follows its roads, rivers and hills. The town and
the demos use `defaultFields(seed)`, which follows nothing. (The old jittered-grid parcels, with
their bent and swirled edges, are gone.)

What a field becomes is its source's (arable, grass, wood, rough), unless:

- the town has grown over it (more than half of it within 30 m of plots), which makes it town. A
  field the town has only reached stays a field, and the ground within 20 m of a plot's middle
  (`TOWN_BAND`: the back fence and a few metres behind it) is painted as town, texel by texel
  (`Layout.townAt`; a paint rasterises the band once over its window, `Layout.spotsIn`), with no
  hedge through it: the crops run up to the back gardens, as they do at a real town's ragged edge.
  A repaint after a plot at the fields' edge reaches the band round that plot (`TOWN_REACH`, 21 m
  from its middle), so it stays exact; in the town itself it reaches only the plot;
- industry has (more than 12%), which makes it rough;
- it's arable at the water's edge, which makes it grass.

Arable fields get a crop and rows along their longest edge. The painter fills each field with its
index and bands each boundary for the field margins. A hedged line between farmland is banded again
and painted as a dark hedge foot (woodland floor), so field boundaries read from far out, where the
3D hedges aren't drawn. The margin and foot widths scale with the texel size (a 10 m far tile
still shows an unbroken line). A wood's edge wanders up to 4.5 m in from its boundary (scrub where
the trees stop short).

Hedges run along every hedged line between farmland (not against a wood, not across open rough
grazing), and along both sides of country lanes. Each hedge:

- keeps 2.2 m off roads, plots, parks and water, at both ends of every 8 m piece;
- usually has one gateway, with worn earth either side;
- has a hedgerow tree about every 55 m.

A line's seed comes from its own coordinates, so two tiles that share it plant the same hedge.
`settleTrees` moves trees standing in the fields to the woods' edges.

**Woods as a canopy (`canopy.ts`, pure; `canopymesh.ts`, three.js).** Over each wood there is one
low-poly, flat-shaded surface, with vertex colours: crowns (domes on a jittered grid, spires in a
conifer plantation) with dark gaps, going down steeply into the ground at the wood's edge. Its
outline is the cover map's woodland weight, so it follows the painted wood, and a road or the town
cuts it. The grid points just outside a wood are moved onto its edge (bisected on the layout), so
it meets the ground along the wood's own straight outline rather than in grid-square steps, even on
a far tile's 24 m grid.

- On a 50 km map's tiles (`worldmap/tilegen.ts`) it is built in the worker, into the tile's one
  solid mesh, so it costs no extra draw call. The grid is 5 m near, 10 m mid, 24 m far, 64 m vast.
- On the live cover map (the town, and the 50 km map's live area), `GameGround.woods(look)` gives
  a `CanopyMeshes`: one mesh per 1 km box that has woods, at a 5 m grid below a view 1,100 m tall
  and 24 m above. A box is made when it's first painted, and remade only when a repaint touches
  a wood.

The trees along the woods' edges (`fringe`) stand out of it close up.

**Farmsteads (`farms.ts`, `region/fields.ts`).** A farmhouse, a barn and a shed round a worn yard,
where the lanes are. Their yards are plots of kind `yard` (hedges and fields keep off them). A farm
standing back from its road has a farm track, routed over the land like a lane (`region/lanes.ts`
`laneRoute`: round hills, woods and water) and painted as a `track` plot. On a 50 km map the
buildings are tile scenery (`worldmap/country.ts` `farmsIn`) beyond the live play area; inside it,
where no scenery is made, `game/country.ts` (`LiveFarms`) builds the same farms in the same places
with the town's own building generator (the farmhouse in the place's tradition, the barns as the
tiles draw them), a few a frame after start-up into one mesh a material, claims each yard on the
land registry as a site (no road through a farm), and gives the live ground the yards and tracks to
paint (`farmGround`, through `GameWorld.extra`).

### The farming year

The fields change with the season without a repaint. `covers.ts` `CROP_YEAR` gives each crop
keyframes through the year (a month each, wrapping), with the two field colours and the rows as
`CROPS` has them; `cropLookAt(crop, t)` blends between them, so nothing ever jumps. The looks in
`CROPS` are mid-July's, which the game starts on (`START_MONTH`). What the keys follow, for the
lowland English year: winter wheat drilled in October, low and green over the winter, thick by
May, turning in June, gold in July, cut in August, its stubble ploughed in September; spring
barley ploughed over the winter, drilled in April, pale gold by July; oilseed rape low and green
over the winter, in yellow flower April to May, pods to July, cut in August; a ley cut for silage
in May and July; the stubble field is winter barley's, cut early in July and left over the
winter, ploughed and drilled in the spring; pasture yellows in a dry August and dulls in the
winter. A ploughed field stays bare, darker when wet in the winter.

`material.ts` `applySeason(uniforms, t, fixed?)` sets a ground's crop colour and row uniforms
for a point in the year; a crop the map's style colours (a desert's, snow's: `region/styles.ts`)
keeps its colours all year. The page has one season, `setGroundSeason(t)`, which tells every
ground that listens (`onGroundSeason`): the live ground (`GameGround`) and the 50 km map's tiles
(`worldmap/view.ts`, whose far tiles tone the crops towards the grass as before), so the live
area and the tiles agree at any date. The game sets it from its clock each frame
(`seasonOf(clock)`: a game day is a month in the town's life, so a year passes in twelve game
days, about 72 minutes of play). The ground demo's Month button steps through it. Screenshots
at 700 m and 2 km through the year are in `docs/reports/country/season-*.jpg`.

Not seasonal yet: the trees' leaves and the woods' canopy (their colours are baked into the tiles
and the tree materials), snow, and the far rim beyond the map's edge (`game/edge.ts`, a fixed
palette).

### Painting and repainting

`paint` fills the whole map. `change(input, boxes)` repaints only round the boxes: each texel
depends only on the world within a fixed margin, so an incremental repaint is exactly what a
full paint would give (tested). When a plot turns a field into town, that whole parcel is
repainted and its hedges replanned. Replaced hedge instances reuse their buffers, and
`dispose()` frees everything.

A repaint after one building is kept cheap by touching only what that building can change. The
layout's town marks (the coarse grid and the band's spots) and the hedges' occupancy grid are
kept between changes: an input whose plots and town points only grew since the last one (the
same objects, plus new ones) has just the additions marked; one where a few went (a building
site becoming a garden, its town point going with it), or whose roads, parks or water changed,
has them made afresh. The parks' marks live with the other fixed marks, and the grids' keys are
small integers. The band round a new plot is repainted as a disc of `TOWN_BAND` round its
middle, not the plot's whole box padded, and only where a field the town has reached lies; the
disc round a plot or point that went is repainted too; its hedges are replanned only if a hedge
piece or gateway stands within it (a spot added can only take hedges away). The plot's box and
its band are planned as one box, so a hedge line they both touch is walked once. `GameGround`
keeps a lot's plot object from one input to the next while its parcel stays where it was, so the
game's repaint after a building takes this path.

## In the game (main.ts)

`ground/game.ts` (`GameGround`) turns the network, plots, queue, trees and lake into a
`GroundInput`. `main.ts` only calls it at these points:

- the ground mesh uses `gameGround.ground.material`, which keeps the stencil hole for cuttings;
- `scene.add(gameGround.ground.hedges)`;
- `gameGround.start(trees)` at start-up;
- `invalidate()` when roads or the landscaping change (repainted on the next frame);
- `built(lot)` after a building goes up;
- `setGroundQuality()` from `setTier`: High is `high`, Good and Balanced are `medium`, Fast and Fastest are `low`.

The next four plots in the queue show as cleared building sites.

## Adopting it elsewhere

The material is a patched `MeshLambertMaterial`. It chains any earlier `onBeforeCompile` and
extends `customProgramCacheKey`, so shadows, fog, stencil and other patches keep working. A
patch put on afterwards should chain it too, as the water system's shore overlay does.

| where | the swap |
|---|---|
| terrain tiles | `groundTile(tileMesh(src, ti, tj, o), ground.material, origin)` with `new Ground({ terrain: true })`: world-space sampling needs no UVs, and slopes and heights come from the mesh |
| water demo | `patchGroundMaterial(new Ground({ terrain: true }).material)`: the shore overlay goes on top |
| bridges demo | the ground strips and earthworks use `new Ground({ base, terrain: true }).material`; cut faces steeper than about 35° turn to rock and scree by themselves |
| industries, people and vehicles demos | their plane's material becomes `ground.material`; at night, tint `ground.material.color` rather than swapping materials |
| bridge earthworks (bridges-track) | use `new Ground({ terrain: true }).material` for embankments and cuttings: grass on the gentle parts, scree on steep cut faces |

### Far from the origin

Meshes should sit near a floating origin. The terrain library places tiles at `offset − origin`.
Call `ground.setOrigin(x, z)` with the origin. The shader only ever sees positions relative to
it, plus the origin modulo 2048 m (the textures' common period), worked out in double precision
on the CPU. So a world 100 km out doesn't swim or band, and rebasing never makes the pattern jump.

## Performance

These are the budgets and what was measured. The measurements are in Node or SwiftShader on a
shared 4-CPU machine, so treat them as relative.

| budget | limit | measured |
|---|---|---|
| texture reads per ground pixel | ≤ 6 high, ≤ 3 low | 4 high, 3 medium, 2 low (from the shader source, tested) |
| new texture memory | ≤ 4 MB | detail 512² with mips 1.40 MB + macro 256² 0.35 MB + the game's cover map 480² 0.92 MB, so **2.67 MB** |
| texture generation | ≤ 40 ms | about 30 ms warm, 55 ms cold at start-up (once) |
| full paint of the game map (with hedges) | ≤ 30 ms | about 26–30 ms warm in Node; the first paint at start-up runs cold, at about 100 ms |
| repaint after one building | ≤ 2 ms | about 1.3–1.6 ms median, 3 ms when a whole field becomes town |
| draw calls | ground +0, extras ≤ +2 | +0 and +2 (hedges, hedgerow trees); +1 in the shadow pass (hedgerow trees only: hedges don't cast) |
| triangles | ≤ +60k | about +52k in the main pass on the game map (14 per 8 m hedge piece, 90 per hedgerow tree) |
| frame time vs old ground | within ~15% | see the table below |
| shimmer | no worse than old | see the review notes |

The whole game frame in SwiftShader at 412×915, old ground against new. Each figure is the
fastest of 8 renders per side, alternating old and new so background load hits both alike,
with shadows redrawn every frame at High, Good and Balanced as the game does:

| view | High | Good | Balanced | Fast | Fastest |
|---|---|---|---|---|---|
| countryside, 200 m | 1.22 | 1.07 | 0.98 | 1.06 | 1.00 |
| town, 200 m | 0.72 | 0.95 | 1.11 | 1.01 | 1.00 |
| far, 900 m | 0.94 | 1.20 | 1.20 | 1.05 | 1.01 |

(The town and far rows were measured before hedges stopped casting shadows, so they flatter
the old ground if anything.) Per full-screen pixel of ground alone the new ground costs 1.12×
the old grass at High, 1.01× at Medium and 0.91× at Low. A software renderer runs every branch
for every pixel, so the shader is written to be short rather than to skip work.

Anti-shimmer measures:

- mipmaps on the detail textures, blending between levels so zooming never pops;
- fine strokes fade out from 3 cm per pixel;
- flowers only show close up;
- rows and stripes are soft triangle waves that fade to their mean before they alias; tramlines are anti-aliased lines that fade out below a pixel;
- nothing has high contrast below the pixel.

<!-- measured tables are appended below by the look-dev and review rounds -->
