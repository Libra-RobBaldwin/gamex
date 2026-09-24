# Real Town Plans (`places.html`)

A page that turns a UK postcode into the plan the game's OpenStreetMap importer builds. It
runs entirely in the browser, so it works on any static host (see [deploy.md](deploy.md)).
It's a look ahead at the game's "your real place" start (ROADMAP.md).

## The flow

1. **Find.** A postcode, or just its first half, is looked up at
   [postcodes.io](https://postcodes.io).
   - Retired postcodes fall back to its `terminated_postcodes` endpoint.
   - Northern Ireland (BT) postcodes work.
   - Guernsey, Jersey and the Isle of Man aren't in the open data, and the page says so
     without asking.
2. **Pick.** A Leaflet map with OpenStreetMap's standard tiles shows a pin on the postcode
   and a square of 1, 1.5, 2, 2.5 or 3 km. The square moves by:
   - dragging its handle on the top edge;
   - tapping the map;
   - **Square here**, which moves it to the middle of the view.

   Inside the square, one finger pans the map and two pinch it, so the map never fights
   the square.
3. **Fetch.** The square is cut into an n × n grid of tiles, each 1.3 km across at most, and
   fetched one tile at a time (`overpass.ts`).
   - Four mirrors take turns: overpass-api.de, overpass.kumi.systems, maps.mail.ru and
     overpass.private.coffee. The page stays on a mirror while it answers.
   - On a 429, a 504, a timeout (100 s), an answer that isn't map data, or a 200 whose
     remark says the query ran out of time, the page moves on to the next mirror. It waits
     4, 8, 16 or 32 s, then a minute, or the server's `Retry-After` up to two minutes.
   - After eight tries on one tile, it gives up with a clear message.
   - The screen shows tiles done of total, which server is busy, and a countdown.
4. **Build.** The tiles are merged and trimmed with `src/proto/osm/fetch.ts`, the same code
   `fetch-fixture.mjs` uses, so a downloaded file is exactly a fixture. `importOsm` then runs
   in a Web Worker (`worker.ts` → `build.ts`).
5. **Show.** The page shows:
   - both plans (`importSvg` and `rawSvg`), with pan, pinch, double-tap and buttons to zoom;
   - the counts: road and rail pieces, junctions (nodes where three or more pieces meet),
     plots, roundabouts, paired dual carriageways, stations and the import time;
   - what the game can't build yet, grouped by kind;
   - a download of the trimmed data.

   Each built area is kept in IndexedDB, so it reopens instantly, even offline, and can be
   deleted from the list.

## Privacy

The postcode is personal data: it can point at someone's home.

- It is sent to `api.postcodes.io` and nowhere else, with no cookies and no referrer.
- It is never stored: not in localStorage, IndexedDB, the URL or history, and the form's
  autocomplete is off. It is never logged.
- The input box is cleared as soon as the postcode is found.
- The square doesn't start on the postcode's exact point. It starts on the nearest point of a
  grid about 550 m apart (`snapCentre`), which keeps the postcode inside even a 1 km square.
  Otherwise the point would go to Overpass in the tile boxes and end up in the saved box and in
  the downloaded file, and a reverse lookup of that point gives the postcode back.
- Saved areas are keyed by their box and name (`areaId`). The suggested name is the parish or
  ward, never the postcode.
- Each step is a history entry holding only the step's name, so the phone's Back button moves
  back a step.

The end-to-end test checks all of this. It looks through every request, localStorage,
sessionStorage, cookies, IndexedDB, the URL and the page for the postcode.

## Credits

Postcode locations come from postcodes.io. The ONS, OS, Royal Mail and LPS (Northern Ireland)
credits appear at the foot of the first step.

Map data is © OpenStreetMap contributors under the ODbL. The credit appears:

- on the map (Leaflet's attribution control, kept above the sheet);
- in a corner of each plan and inside each SVG;
- at the foot of the page;
- in the downloaded file's `attribution` field.

A downloaded area is an ODbL database: the page says so next to the download button.

## Hand-over to the game: "Play it in 3D"

The real-town stream (`claude/work-real-town`) makes the game start from a `World`
(`src/proto/town`). The first real town is a built-in snapshot. That work wasn't on the
integration branch when this page was built, so the button is there but disabled. Wiring it
takes three steps:

1. **The page** already keeps each area's trimmed data in IndexedDB. Flip
   `GAME_READS_PLACES` in `src/places/main.ts` to `true`. The button then opens
   `proto.html?place=<area id>`.
2. **The game** reads the parameter at start-up, before it builds the world:

   ```ts
   import { PLACE_PARAM, placeData, getArea } from '../places/store';
   const id = new URLSearchParams(location.search).get(PLACE_PARAM);
   const data = id ? await placeData(id) : undefined;       // the fixture format: bbox, elements, attribution
   const name = id ? (await getArea(id))?.name : undefined;
   // then: realWorld({ name, data }) instead of the built-in snapshot
   ```

   `realWorld(town: RealTown)` in `src/proto/town/real.ts` already takes `{ name, data }`.
   The one change the game needs is to await the data before `startWorld`. The data comes
   from the same origin, so this works on Vercel and in `npm run dev`.
3. **If the id isn't found** (another device, or the area was deleted), the game falls back
   to its default town and says so.

## Files

| File | What it does |
|---|---|
| `places.html` | The page (a Vite build input). |
| `src/places/main.ts` | The four steps and the page's markup. |
| `src/places/postcode.ts` | Postcode parsing and the postcodes.io lookup. |
| `src/places/area.ts` | The square as a bbox, measured on the ground; tiling; the cache key. |
| `src/places/map.ts` | The Leaflet map, the pin and the square. |
| `src/places/overpass.ts` | Fetching tiles: mirrors, back-off, progress. Its network and clock are injected, so the tests fake them. |
| `src/places/build.ts`, `worker.ts` | `importOsm` and the SVGs, off the page's thread. |
| `src/places/viewer.ts` | Pan and pinch-zoom over a plan. |
| `src/places/store.ts` | IndexedDB; `placeData(id)` for the game. |
| `src/proto/osm/fetch.ts` | The Overpass query, the tag trim, the tile merge and the fixture layout, shared with `fetch-fixture.mjs`. |

## Tests

- `npx vitest run src/places src/proto/osm/fetch.test.ts` covers:
  - the square and the tiling;
  - the back-off and the mirror rotation, against a fake network and clock;
  - giving up, going offline and cancelling;
  - postcodes;
  - the merge and the trim, including rebuilding `banbury.json` byte for byte;
  - the worker's build on Banbury.
- `npm run build && npm run test:e2e` runs the whole flow in Chromium at 412×915, DPR 2, with
  touch, and with every outside request mocked:
  - postcodes.io answers with Banbury;
  - the tiles are plain squares;
  - Overpass answers with the Banbury fixture, with one 429 first.

  It checks, among other things:
  - dragging the handle and panning the map;
  - the countdown;
  - the plans, the counts and pinch-zoom;
  - the download;
  - the saved list, reopening and deleting;
  - privacy;
  - a phone on its side.

  It writes screenshots of each step to the folder given as its argument. It needs Chromium:
  it uses `/opt/pw-browsers/...` if present, or set `CHROMIUM=/path/to/chrome`.
