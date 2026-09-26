# Brief: vernacular (buildings)

Session https://claude.ai/code/session_013W364Qf7cmYt1ejuVbvaHq · branch `claude/work-vernacular` · updated 26 Sep 08:40 UTC.

PRs:
- merged: #45 (regional styles, parking), #48 (shopping complexes);
- open: #50 (scenery dressed up close, save on hide, level on slopes).

**Honesty rule:** "done" below means live on the integration branch and checked on a 412×915 close-zoom screenshot. "In PR" means pushed and checked here, but not merged yet.

## Now (ONE MAP, PLAN.md 07:40)

1. **Urgent: the phone's plain grey boxes that don't improve on zoom.** **In PR #50.**
   - Cause: on the 50 km map, towns outside the live play area, and places in it not yet live, are world50's scenery boxes at every zoom.
   - Fix: `game/dress.ts` rebuilds them with buildgen below a 700 m view and hides the boxes in the same frame.
   - Checked at 412×915 on `?map=region&seed=42`: a town 7 km out and a city (screenshots in `docs/reports/dress/`).
   - Not yet checked on the user's phone.
   - Known limits:
     - A tile appears only once it's all built: a few seconds on a phone, about a minute under SwiftShader.
     - Streets in dressed places are still world50's plain ribbons (no kerbs, lamps or markings).
     - Between 700 m and 1000 m a near tile shows the boxes.
2. **One building generator** (towns.ts scenery uses buildgen, or a cheap LOD of it). **In progress.**
   - The seam was proposed to world50 at 08:45: towns.ts plans the plots, buildgen builds every building, and tilegen's `building()` becomes only the far LOD box and roof in buildgen's palette.
   - Next (mine, once world50 agrees): strip the windows, doors and chimneys from tilegen's `building()`, so no second style of building exists.
   - Not done until the near scenery is always buildgen and the far boxes match in colour.
3. **Keep this brief honest.** Ongoing.

## Earlier asks, where they stand
- **Regional vernacular from geology, era by distance, the Nordic, desert and Mediterranean climates.** Done (#45). Tropical was dropped by the plan.
- **Terrain's geology query.** Done: the integration branch calls `setGeology(WORLD.terrain.geologyAt)`. Dressed scenery uses it too, now that the resolver sees every place on the map (in #50).
- **"Buildings look a bit shit / juvenile."**
  - Partly done: roof edges, ridges, plinths, ambient occlusion, textured walls, doors let into walls (#45).
  - In PR #50: buildings level on slopes.
  - Not started:
    - window depth up close;
    - street trees in dressed places;
    - more colour variety within a street.
- **Cars park in spaces; car parks used.** Done (#45), for live towns only; dressed scenery has no cars.
- **Shopping complexes** (parade, arcade, retail park, covered centre). Done (#48) on the live town map. On the 50 km map:
  - live places: not yet checked at close zoom;
  - dressed scenery: runs of shops become parades (in #50).
- **No overlapping buildings.**
  - Done for live-town shop runs (#48).
  - Real maps: `real/lay.ts` still allows about 0.6 m of overlap. That's OS's file, now being folded into WORLD.
- **Save e2e on CI** ("hiding the page did not save"): in PR #50. Root cause: long SwiftShader GPU stalls. Hide saves no longer queue behind autosaves, and hidden pages don't draw.

## Files
- **Mine:** `buildgen.ts`, `vernacular.ts`, `complexes.ts`, `game/parking.ts`, `game/dress.ts`, `region/styles.ts`, the gallery, `docs/vernacular.md`, `docs/parking.md`, `docs/shopping.md`.
- **Small hunks in others' files (listed in each PR):**
  - `main.ts`;
  - `roads.ts` `lotSpec`;
  - `game/econ.ts` and `crowdsites.ts` (units);
  - `traffic.ts` (parking hooks);
  - `worldmap/tilegen.ts`, `tile.worker.ts` and `view.ts` (the `bld` mesh and dressing API, #50).

## Open questions
1. Does world50 agree the seam above?
2. Should dressing reach the whole near range (1000 m), at more draw calls, or stay at 700 m?
