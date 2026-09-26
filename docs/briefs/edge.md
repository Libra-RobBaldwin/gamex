# Brief: edge session (`claude/work-edge`, PR #44)

This session covers the edge of the region map, and traffic and trains coming and going through
it. It was written on 26 Sep 2026 on `claude/work-edge` at 36f6095 (not yet merged with the
integration branch at b57164e; see "State" below).

## State

- **PR #44** (into `claude/cloud-session-history-rvqkm1`) is built on the old region's `BIG` path:
  a 6 km map with the ground running to 4.5 km.
- **CI:** red only on the known economy test, "a well-served town grows".
- **Merging the integration branch** gives conflicts in `main.ts` (5 hunks), `traffic.ts` (1),
  `game/econ.ts` (1) and `docs/HANDOVER.md` (1). world50's `WORLD` path has replaced the `BIG`
  path:
  - `MAP.world`, `worldmap/`;
  - a live play area of `LIVE_HALF` = 4 km, with streamed scenery out to `WORLD.half` = 25 km;
  - `mapEdge` is an empty group on WORLD maps, since the live area has the map round it.
- **Not resolved yet:** porting waits for the confirmed scope, as asked.

## (a) Requests, and where each stands

### From the user (via the task and the standing rules)

1. **"The map edges look really bad... should be earth crust":** a solid cut face all round,
   following the hills. **Done on the old BIG path; not yet on WORLD.**
   - Built: soil bands following the ground, folded rock beds, a level base (`edgeDepth`), the
     face cut exactly with no overlaps (area-sum test), water in section, and roads and railways in
     section.
2. **Read the height field through the existing API, so the face follows whatever the ground
   does:** **Done** via `surfaceAt`
   (`gameWater.shapes.ground + RELIEF.heightAt`). **On WORLD it needs pointing at
   `WORLD.terrain`.**
3. **Show water in section where the sea or a river meets the edge:** **done** (`level` can be a
   function). Not checked against a real sea coast yet.
4. **Looks good at every zoom and angle, no z-fighting, cheap (streamed per tile, one or few draw
   calls):** **Done:** `EdgeFace`, 1 km stretches built as they come into sight, and one coarse
   face zoomed out.
5. **A soft distant horizon beyond the edge, as long as the cut still reads:** **Done:** the
   `farCountry` hazy lowland backdrop, one draw call.
6. **"I asked previously for out-of-map portals for traffic":** the motorway, A roads and railways
   run off the edges to the outside world, shown in section on the face. **Done on BIG; not on
   WORLD.**
7. **Traffic enters and leaves through them at believable rates** (by time of day, bigger on the
   motorway): **done** (`PortalTraffic`: rates, lorries, passing through, already moving, primed,
   clipped at the face).
8. **They count in the economy as trips to/from outside, an external town per portal:** **done**
   (`outside` towns in `game/econ.ts`, `outsidePlaces`).
   - **Partly verified:** in a short test no rail line carried riders, a map-to-map line included,
     so this is unconfirmed rather than known broken.
9. **Trains, the player's and others, can run to an edge portal as a terminus off the map:**
   **done:** a station past the edge, not drawn; `RailLine.other` through trains.
10. **Portals visible and understandable, with a sign naming where it goes; tap for its flows:**
    **done:** UK-style DOM signs, and a small card.
11. **Map to be 10× the size (the 19 km, then 50 km note):** scaling hooks are **done** (depth,
    lazy face, far country, place sizes); the **port onto WORLD isn't started**.
12. **Standing rules:**
    - **Followed:** UK left-hand traffic; phone testing at 412×915; perf before/after; the town
      map left byte-identical; PR into the integration branch; commit trailers; no model IDs.
    - **tsc, vitest and the e2es:** done for #44.

### From the coordinator

1. **The 50 km note:** the cut face per edge tile only where the camera can see it, following the
   lazily evaluated height field; portals where the region's motorways, A roads and railways leave
   the map; flows sized for a 50 km region's neighbours.
   - **Partly done:** `EdgeFace` is lazy, and places grow with map size.
   - **Not on WORLD yet.**
2. **The Cities: Skylines 2 extended world:** try it alongside or instead of the haze, screenshot
   both at low and high tilt, pick one and say why in the PR.
   - **Done:** `?far=level` was tried and the lowland kept, with the reasoning in the PR and
     `docs/edge.md`.
3. **The simple-steps rule:** a portal tap shows a small card with its name, two or three numbers
   and at most one action. **Done.**
4. **PAUSE:** commit, push, note in the PR, delete check-ins. **Done.**
5. **RESUME:** this brief (**done**), then the port onto WORLD (**not started**, waiting for scope).

## (b) Files and modules

**Owned (mine):**
- `src/proto/game/edge.ts`: the face, `EdgeFace`, `farCountry`, `beyondEdge`, `edgeCrossings`.
- `src/proto/game/portals.ts`: portals, traffic, signs, the card, `outsidePlaces`,
  `portalStation`.
- Tests: `game/edge.test.ts`, `game/portals.test.ts`.
- Docs: `docs/edge.md`, `docs/briefs/edge.md`.

**Shared, which I changed in #44 and would change again for WORLD:**
- `main.ts`: the glue. It's now WORLD-path code, owned by world50.
- `traffic.ts`: `edgesFor`, `trip()`, `roadLength()`, and `Access` exported.
- `game/econ.ts`: the `outside` towns.
- `interchange/region.ts`: `layRegionRoads` roads out, `runOn`, `splitLong`, `densify`.
- `rail/region.ts`: `plan.out`, the run past the edge.
- `rail/draw.ts`, `game/regionview.ts`: nothing past the edge is drawn.
- `rail/railway.ts`, `rail/sim.ts`, `rail/game.ts`: `RailLine.other` and its filters.

**Expected for WORLD:**
- `worldmap/routes.ts`: its "A roads off the map's edges" are where my portals go, but world50
  owns it.
- The scenery view (`worldmap/view.ts`): whether the face is drawn there or by me.
- `worldmap/live.ts`, `worldmap/econ.ts` (CoarseEconomy): trips to places off the map.

## (c) Overlaps with other sessions

- **world50:**
  - owns `main.ts`'s WORLD path, `worldmap/` (routes run edge to edge, with A roads off the edges
    "where the edge session's portals go"), the scenery tiles, and the coarse economy;
  - my rim is at `WORLD.half` (25 km), inside their streamed scenery, not the live Network.
  - Portal traffic today runs on the game's Network and traffic sim, which on WORLD exist only in
    the 4 km live area. So traffic "off the map" at 25 km needs either scenery traffic (theirs)
    or live-area "portals" at the live boundary. **This is the biggest open question.**
- **terrain:** the height field (`WORLD.terrain.partField` / the drape texture), the sea coast,
  and water levels, which my face and water-in-section read. `densify` (points every 20 m on
  region roads) and `splitLong` touch the road drawing they may also be changing.
- **countryside:** the ground beyond the old bound (plain grass on the BIG path), and fields and
  woods up to the rim. The far-country palette reads their style colours (`LOOK.palette`).
- **streaming/regionview:** my one-line skip in `regionview.ts` for rail past the edge, and
  `splitLong`, which works around their draw-a-road-by-its-middle's-cell rule.
- **OS, real regions (fold-in):** real maps' rims and real roads leaving them. Portals should come
  from the real roads that cross the rim, and place names off the map should be real ones there.
  Today they're invented, and `isRealPlace` rejects real names.
- **vernacular:** none known.
- **rail session (archived):** `RailLine.other` and its filters in `rail/game.ts` and
  `rail/railway.ts`.

## (d) Open questions

1. **Portals on WORLD: at the 25 km rim, or at the 4 km live area's edge?** Traffic sim only exists
   in the live area. My suggestion:
   - draw the crust and signs at the 25 km rim;
   - feed trips to the places off the map into world50's CoarseEconomy;
   - run visible portal traffic only when the live area reaches the rim, or where world50 spawns
     scenery traffic.
2. **Who draws the face on WORLD:** my `EdgeFace` (own group, reading the height field), or a hook
   in world50's tile view? I'd keep `EdgeFace` separate and give it `WORLD.terrain` heights.
3. **The far country at 50 km:** keep the hazy lowland, or does world50 already show an
   extended world round the scenery?
4. **Places off the map on real maps:** allowed to use real names (OS session)?
5. **Is the economy's rail-riders result a known library issue?** It affects whether "links to
   the edge matter" by rail.
6. **Merge conflicts in `main.ts`, `traffic.ts` and `econ.ts`:** resolve them as part of the port,
   after the ownership map arrives.
