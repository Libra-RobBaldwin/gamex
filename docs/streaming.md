# The region streamed in tiles (R4)

The 6 km region (`/?map=region`) is drawn a tile at a time around the camera, at a level of detail
picked from the zoom. An edit re-derives only what it touched. Traffic is only near the camera.
The invented town (`/?map=town`) is drawn and simulated exactly as before: all of this is behind
`BIG` in `main.ts`, and a test compares the town's state after loading with the integration
branch's.

Code: `src/proto/game/regionview.ts` (the tiles), the `regionView` parts of `src/proto/main.ts`
(edits, traffic, trees, infill), and small additions to `roaddraw.ts` (draw only some roads),
`infill.ts` (look in a box), `ground/game.ts` (repaint round boxes) and `game/bridges.ts` (look at
some roads again).

## Tiles and levels

The map is cut into 1 km tiles (`world/tiles.ts`), and `world/StreamManager` decides which level
each wants and loads them nearest first, a few milliseconds a frame.

| Level | Roads | Buildings | Trees and hedges |
|---|---|---|---|
| Near | everything `drawRoads` draws: markings, kerbs, lamps, street trees, parked cars | the textured chunks (250 m, a quarter of a tile across) | full trees; hedgerows and their trees |
| Mid | plain ribbons: carriageways, footways, ballast, the junctions' surfaces, walls under raised roads | the same geometry in one flat-coloured mesh a tile (each material's colour, its texture averaged) | full trees; the hedgerows' trees |
| Far | ribbons | each building a box of its footprint and height, in its wall and roof colours | low-poly trees |

The camera is orthographic, so everything on screen is drawn at the same scale. The level
therefore follows the zoom: near up to a view about 1,000 m tall, mid to 2,600 m, far beyond,
with 12% of slack either way so a zoom resting on a line doesn't flip back and forth. A tile only
drops below that once it's out of view (with a margin). So every tile on screen is at the same
level, and a level changes where what it adds or takes away is about a pixel across.

Nothing flickers or fights:

- Each level is built once and kept, hidden when not wanted. A tile swaps whole: the new level is
  shown and the old one hidden in the same frame, never both, never neither.
- The ribbons sit a few centimetres below where the full drawing puts the same surfaces, so where
  a near tile's roads meet a mid tile's (only ever past the edge of the screen, or for the frame
  they swap), the full drawing is cleanly on top.
- Hedge pieces and trees are instanced per tile and culled with it; a piece belongs to the tile its
  middle is in, so none is drawn twice.

Work is metered. A tile's near roads are drawn one 250 m cell at a time, then merged into one mesh
a material; a tile's buildings are merged a few milliseconds at a time. When the page is idle
between frames, the view gets ready for where the camera may go next (near detail for the tiles
just beyond the view, mid a ring further), so a zoom or a pan mostly just swaps.

The river beds and the map's cut edge are cut into a mesh a tile too, so only what's in view is
drawn.

Precision: nothing on the 6 km map is more than 4.5 km from the origin, where a float32 steps in
half a millimetre. It needs no floating origin; `world/origin.ts` is for the 30 km map.

## Edits

Each road's and each node's signature is kept from the last commit (`commitTouched` in
`main.ts`):

- A junction is designed again only when the roads meeting there changed (or it's new). A
  customised one keeps its choices while its roads stay the same, as before.
- Its land is claimed again only when its design changed (here, or in the junction panel).
- Only the buildings and queued plots within reach of what changed are checked against the land;
  only the ground, trees, hedgerows and bridges round it are looked at again.
- The leftover land (parks, car parks, community buildings) is looked at again in a box round
  the edit, grown until no gap it cuts across reaches what changed, so every gap re-found is whole
  and exactly what looking at the whole map would find (a test checks this).
- `regionView.roadsChanged()` works out each 250 m cell's signature (its roads, junctions, stops,
  bridges and the roads they join) and redraws only the cells that changed, then swaps their tiles.

This is `world/DirtyPipeline`'s idea (per-tile dirty areas, stages in order) without its
machinery: the Network changes in many places (roads, slip roads, interchanges, rail, stops), so
rather than each marking dirty tiles, a commit compares signatures. Each stage is cheap once it
only looks at what changed, so they run in order in the same call.

## Traffic

Trips start from homes and places within about a kilometre of the camera (or what's in view, when
zoomed out), so how many cars there are follows who lives there; the 300-car cap now applies to
what's near the camera. A car well outside that is taken off the road once it's clear of junctions
(traffic.ts's own `sold`). Buses on the player's lines always run. Further out there are only the
economy's flows. People already only walk near the camera.

## Measured

Playwright at 412 × 915, DPR 2, touch, with SwiftShader (software GL: frame times are far slower
than a phone's GPU, so the CPU numbers, draw calls and triangles matter more than the frame
times). Before: the integration branch at 8ad5a55. After: this branch. See the PR for the full
table; `node e2e/perf.e2e.mjs <base url> town,region 0,1,2,3,4 out.json` reproduces it.

## Not done yet

- Building generation and the region generator in a worker (`world/worker.ts`).
- Spawning cars at the rate each link's flow implies (needs link flows from the economy).
- Start-up: most of what's left is generating the streets, putting up the buildings and the
  water; on SwiftShader a few seconds are the GPU catching up.
