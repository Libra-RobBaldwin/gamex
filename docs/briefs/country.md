# Brief: country (countryside session)

Session https://claude.ai/code/session_01NfUwLYbN2dwfppCiaRHfHK, branch `claude/work-country`, PR #41
(into `claude/cloud-session-history-rvqkm1`). Written 26 Sep 2026, 01:20 UTC, before any port.

## (a) Every request made to this session

### From the user (standing rules, given at the start)
| # | Request (close paraphrase) | Status |
|---|---|---|
| U1 | Region feedback: "Fields look warped and awful – this isn't how the countryside should look… should be more uniform, and missing forests etc." | **Done on the old 6 km `BIG` path** (PR #41). **Not started on `WORLD`.** |
| U2 | Same feedback, other parts: map edges should be earth crust, out-of-map traffic portals, sea and lakes, hills, map 10× the size. | Not mine (edge, terrain and world50 sessions); nothing done by me. |
| U3 | UK countryside: hedged fields, woods, villages; drive on the left; brand colours and fonts; no emoji. | Followed. |
| U4 | Test at 412×915, DPR 2, touch, SwiftShader. No flicker or z-fighting. Measure draw calls, triangles and load time before and after. Judge my own screenshots as a player would. | Done for PR #41 (the numbers are in the PR). |
| U5 | Before a push: tsc, vitest (only the known economy failure allowed), the six phone e2es. Town map byte-identical. Timing budgets through `test/speed.ts`. | Done for every push to PR #41. |
| U6 | Keep sub-agents to a minimum, keep shared-file edits small, and list them in the PR. | Done. |

### From the user, directly in this session
| # | Request | Status |
|---|---|---|
| U7 | "Fields look good... But maps still look flat and roads are still pin straight." | **Partly done.** B roads and new village lanes wind (`region/lanes.ts`, old `BIG` path only). Flat maps are the terrain session's. The coordinator kept motorways and A roads out of my scope. |

### From the coordinator
| # | Request | Status |
|---|---|---|
| C1 | The first brief: make the region's countryside look like real UK farmland. <br>• Coherent patchwork: 2–10 ha, mostly four-sided with near-right angles, laid out in blocks that follow roads, lanes, rivers and contours; almost every field hedged, with hedgerow trees. <br>• Calmer palette, crops in plausible proportions. <br>• Farmsteads where the lanes are. <br>• Woods: ancient woodland in valleys and on steep slopes, copses, shelter belts, upland conifer plantations, riverside woodland. Cheap: instanced trees near, canopy or clumps mid and far, streamed within the draw-call budgets. <br>• Rough grazing and moor on high ground; react to the height field and water. <br>• Own `src/proto/ground/*` and the layout (`region/fields.ts`, `region/woods.ts`). <br>• Measure; screenshot out, mid and near; PR into the integration branch. | **Done on the old `BIG` path.** Includes fields, woods, the canopy, farms and tracks, and the hedge foot line. **Not ported to `WORLD`.** |
| C2 | Maps will be 50 km. Make the field, hedge and woodland layout lazy per tile: deterministic, fast (a few ms per km), worker-friendly, seamless at tile borders. Give far tiles a cheap look. Keep every parameter in one tunable place for the OS data. | **Done as a library** (`Countryside.near`, `tileCover`, `COUNTRYSIDE`). **Not wired into `WORLD`**, because world50 wrote its own `worldmap/country.ts` on the ground grid instead. |
| C3 | The terrain session is running; don't wait for it. Read height, slope and water through the API, with a flat fallback. | Done in the layout: `heightAt`, `waterDist`, `hMax`. |
| C4 | Make country roads wind: B roads and below, between villages and farms, following field boundaries, contours and streams, with hedges both sides. Leave the motorway, A roads and railways (world50) and the edges (edge session) alone. Keep it in my own module, pure and per-tile friendly. | **Done on the old `BIG` path** (`region/lanes.ts`, `interchange/region.ts` `route`). Not on `WORLD`: world50's `routes.ts` plans its own B roads and lanes. |
| C5 | Merge the integration branch before a push. | Done each time up to `dd5c7c7`. The merge now conflicts. |
| C6 | Pause: commit, push, add a "where I stopped" note, delete check-ins. | Done. |
| C7 | Resume. Write this brief first, push it with "brief: country", and don't port into shared files before about 01:45 UTC. | This file. |
| C8 | Then the scope, which may be adjusted: <br>• Port the countryside onto `WORLD`: hedges, woods as a canopy, farmsteads and farm tracks. <br>• One field style: straight-edged hedged fields in farm blocks, as world50 draws them; drop the curvy or warped part. <br>• Lanes and farm tracks follow the terrain; world50 owns main roads and rail. <br>• Phone first, no flicker. <br>• tsc, vitest, e2es; check `?map=region` by eye. <br>• Push, update PR #41 with before/after screenshots, hourly check-ins until merged. | Not started. |
| C9 | From the handover, the user's rules for the 50 km world: <br>• one field style everywhere, removing the old curvy generator; <br>• every road respects the terrain; <br>• the whole map is playable. | Field style: part of C8. Roads and whole-map playability: world50's, except lanes and tracks. |

## (b) Files and modules I own or expect to change

**Own (PR #41):**
- `src/proto/ground/*`:
  - `plan.ts`, `canopy.ts`, `farms.ts`: new;
  - `layout.ts`, `paint.ts`, `hedgerows.ts`, `index.ts`, `game.ts`: the plan branches.
- `src/proto/region/`: `fields.ts`, `woods.ts`, `lanes.ts`, `countryside.ts` and their tests.
- `src/proto/game/country.ts`.

**Expect to change for the port:**
- `src/proto/worldmap/country.ts`: world50's file, where a tile asks for fields, woods, hedges and farms. The heart of the port; needs world50's agreement.
- `worldmap/tilegen.ts`: the canopy, with the tile's trees in one mesh; farm tracks.
- `worldmap/view.ts`: a canopy mesh per tile level.
- `ground/game.ts`: resolve the conflict with world50's `extra`.
- A few lines in `main.ts`.
- Lanes and farm tracks on terrain: either `region/lanes.ts` fed to `worldmap/routes.ts` for the B roads and lanes, or tracks only in `worldmap/country.ts`.

**Expect to remove:** my parts on the old `BIG` path that `WORLD` replaced:
- the `setPlan` calls in `main.ts`;
- the `route` option in `interchange/region.ts`, if the old region is gone.

## (c) Overlaps with other sessions
- **world50:**
  - Its `worldmap/country.ts` already does fields, woods, trees, hedges and farms per tile, on the ground grid with `STRAIGHT_FIELDS` (it added `setParcelStyle` to my `ground/layout.ts`).
  - Its `routes.ts` plans B roads and lanes ("lanes that follow the land").
  - So farm blocks, lanes and farm placement overlap directly.
  - Who owns `worldmap/country.ts` after the port is the main question.
- **terrain** (`claude/work-terrain-2`, not pushed yet):
  - my woods on slopes, rough grazing on high ground, contour-following blocks and lane routing all read `heightAt`;
  - world50's `worldmap/terrain.ts` says the terrain session can replace it.
- **edge:** farms and lanes near the map edge, and portals. No direct overlap beyond keeping clear of the edge.
- **OS** (real regions):
  - real woodland and field shapes replace or tune my generated ones;
  - `COUNTRYSIDE` is the tuning point;
  - on OS maps I should draw real woods as the canopy.
- **vernacular:** farmhouse and barn styles. My `ground/farms.ts` uses plain colours; vernacular could give them regional walls and roofs.

## (d) Open questions
1. **Field style.**
   - "Straight-edged hedged fields in farm blocks, as world50 draws them": world50 draws them with the ground's jittered grid (`STRAIGHT_FIELDS`), not with my farm blocks (`region/fields.ts`).
   - Mine are straight-edged too, square-cornered, and follow roads and contours.
   - Which one do we keep everywhere? I'd suggest my blocks laid out per tile (`Countryside.near`), which are already lazy and seamless. Or is the grid the choice, and I delete `region/fields.ts`?
   - Also: does "remove the old curvy generator" mean the swirl and bend in `ground/layout.ts` for the town too? That changes the town's look, though not its world state.
2. **`worldmap/country.ts` ownership.** Should I take it over, or hand world50 an interface (`countryInput` and `hedges` from my modules)?
3. **Lanes.** Should world50's B roads and lanes (`routes.ts`) use my `laneRoute`, or do I only add farm tracks?
4. **The canopy in far tiles.** The `WORLD` path's far and vast tiles use world50's cover maps. Is a canopy mesh per 4 km tile within world50's draw-call budget?
5. **PR #41.** Do we rework it into the port on the same branch, or close it and open a new PR? It's built on the old `BIG` path.
