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

A cover map is two RGBA byte textures, 2.5 m per texel, over the region (see `covers.ts`):

| texture | R | G | B | A |
|---|---|---|---|---|
| A | lawn | field | wood | bare |
| B | crop | row direction | rough | wet |

Pasture is whatever isn't lawn, field, wood or bare. Rock/scree (from `1 − normal.y`) and
heather/moor (from world height) aren't painted: the shader works them out per pixel. Tune them
with `ground.uniforms.uSlope.value`: rock from/to, then heather from/to in metres, default
`(0.2, 0.34, 70, 130)`.

Fields are world-anchored, so every map anywhere agrees about them. They come from a jittered
grid, rotated and longer one way than the other:

- each cell is a Voronoi parcel of about 4 ha;
- 30% of cells are split in two by a straight hedge;
- about 20% are merged with a neighbour.

So parcels run from 2 to 8 ha and don't form a grid. What a parcel becomes depends on what's in
it:

- town if more than 15% of it is within 30 m of plots;
- rough if it's industrial or touches water;
- otherwise wood, arable or grass, from landscape-scale noise.

Arable parcels get a crop, and rows along their longest edge. Hedges run along the edges
between different parcels (not between two town parcels), and along both sides of country
lanes. Each hedge:

- keeps 2.2 m off roads, plots, parks and water, at both ends of every 8 m piece;
- usually has one gateway, with worn earth either side;
- has a hedgerow tree about every 70 m.

### Painting and repainting

`paint` fills the whole map. `change(input, boxes)` repaints only round the boxes: each texel
depends only on the world within a fixed margin, so an incremental repaint is exactly what a
full paint would give (tested). When a plot turns a field into town, that whole parcel is
repainted and its hedges replanned. Replaced hedge instances reuse their buffers, and
`dispose()` frees everything.

## In the game (main.ts)

`ground/game.ts` (`GameGround`) turns the network, plots, queue, trees and lake into a
`GroundInput`. `main.ts` only calls it at these points:

- the ground mesh uses `gameGround.ground.material`, which keeps the stencil hole for cuttings;
- `scene.add(gameGround.ground.hedges)`;
- `gameGround.start(trees)` at start-up;
- `invalidate()` when roads or the landscaping change (repainted on the next frame);
- `built(lot)` after a building goes up;
- `setGroundQuality()` from `setTier`: High and Good are `high`, Balanced is `medium`, Fast and Fastest are `low`.

The next four plots in the queue show as cleared building sites.

## Adopting it elsewhere

The material is a patched `MeshLambertMaterial`. It chains any earlier `onBeforeCompile` and
extends `customProgramCacheKey`, so shadows, fog, stencil and other patches keep working. A
patch put on afterwards should chain it too, as the water system's shore overlay does.

| where | the swap |
|---|---|
| terrain tiles | `groundTile(tileMesh(src, ti, tj, o), ground.material, origin)`: world-space sampling needs no UVs, and slopes and heights come from the mesh |
| water demo | `patchGroundMaterial(new Ground().material)`: the shore overlay goes on top |
| bridges demo | the ground strips and earthworks use `ground.material`; cut faces steeper than about 35° turn to rock and scree by themselves |
| industries, people and vehicles demos | their plane's material becomes `ground.material`; at night, tint `ground.material.color` rather than swapping materials |
| bridge earthworks (bridges-track) | use `new Ground().material` or the game's `ground.material` for embankments and cuttings: grass on the gentle parts, scree on steep cut faces |

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
| texture reads per ground pixel | ≤ 6 high, ≤ 3 low | 5 high, 4 medium, 3 low (from the shader source, tested) |
| new texture memory | ≤ 4 MB | detail 512² with mips 1.40 MB + macro 256² 0.35 MB + game cover maps 480² × 2 = 1.84 MB, so **3.59 MB** |
| texture generation | ≤ 40 ms | about 30 ms warm, 55 ms cold at start-up (once) |
| full paint of the game map (with hedges) | ≤ 30 ms | about 26–30 ms warm in Node; the first paint at start-up runs cold, at about 100 ms |
| repaint after one building | ≤ 2 ms | about 1.3–1.6 ms median, 3 ms when a whole field becomes town |
| draw calls | ground +0, extras ≤ +2 | +0 and +2 (hedges, hedgerow trees) |
| triangles | ≤ +60k | 14 per 8 m hedge piece and 90 per hedgerow tree: about 25k on the game map |
| frame time vs old ground | within ~15% | see the table below |
| shimmer | no worse than old | see the table below |

Anti-shimmer measures:

- mipmaps and anisotropy on the detail textures;
- fine strokes fade out from 3 cm per pixel;
- flowers only show close up;
- rows, tramlines and stripes are box-filtered analytically and fade to their mean before they alias;
- nothing has high contrast below the pixel.

<!-- measured tables are appended below by the look-dev and review rounds -->
