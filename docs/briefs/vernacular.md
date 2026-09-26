# Brief: vernacular (buildings)

Session https://claude.ai/code/session_013W364Qf7cmYt1ejuVbvaHq · branch `claude/work-vernacular` · PR #45 merged.

## (a) What was asked, and where it stands

From the coordinator (task, 25 Sep):
1. **Regional vernacular in Britain (temperate): walls and roofs from local geology and landform** (Cotswold limestone, Pennine gritstone and slate, Cornish and Scottish granite with harling and crow steps, flint and brick on the chalk, Midland red brick and tile, Wealden and Marches timber frame, slate in Wales and the north). **Done** (`vernacular.ts`, `buildgen.ts`).
2. **Era by distance from the centre** (medieval core, Georgian, Victorian terraces, interwar semis, post-war estates, modern). **Done.**
3. **Use the terrain session's per-point geology query when it lands, with a fallback until then.** **Partly done:** the hook `setGeology((x, z) => rock)` and a seeded fallback are in, but nothing calls the hook yet (terrain has no branch).
4. **Climates beyond Britain for the other styles:** arctic/Nordic, dry/Mediterranean or desert, and tropical if cheap. Churches, pubs, stations, shops and industry follow the same family; street furniture and gardens too if cheap. **Done** for Nordic, desert and Mediterranean, including civic buildings, factories, garden walls and trees. **Tropical: not started** (there's no tropical style option).
5. **Performance the same or better:** shared materials, no more draw calls per chunk, the generator kept pure and worker-friendly, deterministic from the seed. **Done** for draw calls (fewer) and determinism; triangles are about 4% higher. **Partly done** for purity: `vernacular.ts` is pure, but `buildgen.ts` still uses DOM canvases for its textures, as it always has.
6. **The town map byte-identical unless a style is chosen.** **Done** for the vernacular work (hash-verified). The later finish and parking changes alter the town map on purpose, at the user's request.
7. **Screenshot villages and towns in each region type and climate at 412x915, judge them, iterate; PR into the integration branch.** **Done** (PR #45).

From the user directly (25 Sep):
8. "All the buildings do look a bit shit at the moment... Could we increase the quality at all?" **Partly done:** roof edges, ridges, plinths, ambient occlusion, window reveals.
9. "Cars should actually park in spaces if they need to - at the moment they are just badly drawn boxes... Car parks should actually be used." **Done:** `game/parking.ts`, with real fleet models, drive-in and pull-out.
10. "Doors look to be in the outside of houses - not on houses..." **Done:** doors are let into their walls.
11. "Still looks a bit juvenile to me." **Partly done:** textured walls and hedges, weathered roofs, trees. More is needed (see the plan below).

From the coordinator (resume, 26 Sep 01:15):
12. **Finish every request the user made, starting with less ugly buildings.** Review the live buildings on phone screenshots (?map=town, ?map=region, ?map=exe): proportions, roofs, windows, colour variety, how they meet the ground, how a street reads. Fix the worst first. **Not started.**
13. **NEW (user): shopping complexes of variable size** (small parade, high-street arcade, retail park, covered centre). Each is one coherent building on its plot: continuous walls, a roof that suits it (flat with parapets, glazed atrium, sawtooth or pitched sections), shopfronts, entrances, signage bands, loading at the back, parking where it fits, and the town's vernacular. No overlapping or clumped buildings anywhere. Sized by the town's size and demand, with the economy's shop and job counts unchanged; within phone budgets. **Not started.**
14. **No flicker or z-fighting; tsc, vitest and phone e2es; a new PR with before/after screenshots; hourly check-ins.** Ongoing.

## (b) Files I own or expect to change
- **Own:**
  - `src/proto/buildgen.ts`: the generator, regional recipes, finish, and the shopping complex recipes to come.
  - `src/proto/vernacular.ts` and `vernacular.test.ts`.
  - `src/proto/game/parking.ts`.
  - `src/proto/vernacular-demo.ts` and `buildings-demo.html` (the gallery).
  - `src/proto/region/styles.ts`.
  - `docs/vernacular.md` and `docs/parking.md`.
- **Expect to change, in small ways, once the ownership map says so:**
  - `src/proto/roads.ts` (Network lot planning): how centre frontage becomes shop lots. Complexes need one large `shop` lot or a new `mall` kind in place of many small overlapping ones, and the no-overlap rule for lots.
  - `src/proto/infill.ts`, if centre gaps get filled with small shops.
  - `src/proto/game/econ.ts` and `crowdsites.ts` (`USE`): a complex's unit count, so shop and job totals stay the same.
  - `main.ts`: one or two lines at most, after the map arrives.

## (c) Overlaps with other sessions
- **OS / real regions** (`real/lay.ts`, `osm/buildings.ts`) builds real footprints as lots and has already edited `buildgen.ts` (big churches, whole cathedrals, priors). Shopping complexes on real maps have to agree with how OS footprints become lots: a big retail footprint should use the complex recipe.
- **world50** (the `WORLD` pipeline, tiles built lazily, maybe in workers): the generator must stay deterministic and should move towards being worker-safe. Parking registers bays per building in `main.ts`, so check that WORLD tiles feed bays too.
- **Terrain:** `setGeology` is waiting for its rock query. Buildings sit at y = 0 inside a lot; plots on slopes need terrain's height (plinths could take up the slope).
- **Countryside:** farm buildings and field boundaries. My garden walls and hedges follow the vernacular; farmsteads should match (a shared `boundaryMat`?).
- **Edge:** none known.

## (d) Open questions
1. Who owns `roads.ts` lot planning? Shopping complexes need to change how shop lots are cut from centre frontage, and overlapping lots are a planning problem, not a drawing one.
2. Should a complex be a new `LotKind` (`mall`) or a large `shop` lot with a `units` count? A new kind touches the economy, the save format and the places UI.
3. Where do overlapping or on-top-of-each-other buildings come from today: `roads.ts` lots, `infill.ts`, or OS footprints on real maps? I'll find out; the fix may land outside my files.
4. Tropical: add a `tropical` style option (`region/options.ts`, the region session's) or drop it?
5. Real windows with depth would help the "juvenile" look but cost triangles. Is a near-view-only level of detail acceptable?
