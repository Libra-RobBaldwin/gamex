# Importing OpenStreetMap

`src/proto/osm/` turns OpenStreetMap data into the game's world: roads and railways in a
`Network`, building plots, land-use zones, water and stations. It's a prototype. It lives
in its own folder and doesn't change any engine file, so it can be wired in when the engine
is ready (one-way roads first; see below). What it does on real data, and what it can't do
yet, is in [`reports/osm.md`](reports/osm.md).

Map data is © OpenStreetMap contributors, available under the
[Open Database Licence](https://www.openstreetmap.org/copyright). See
[Licensing](#licensing) for what that means for the game.

## API

```ts
import { importOsm } from './proto/osm/import';

const imp = importOsm(overpassJson, { origin?: { lat, lon }, seed?: number });
```

`overpassJson` is what Overpass returns for `[out:json]` with `out body; >; out skel qt;`.
It can also carry a `bbox` (`[south, west, north, east]`), which sets the origin and the
bounds. `importOsm` returns:

| Field | What it is |
|---|---|
| `net` | A `Network` built only through its public API (`addNode`, `addSeg`, `lots`, `zoneAt`), with `isWater` from the data. |
| `roads` | `Map<segId, ImportedRoad>`: catalogue type, OSM way ids, name and ref, whether it was paired from two carriageways, whether it was one-way in OSM, bridge, tunnel and layer, and `approx` (what was rounded to fit the catalogue). |
| `hints` | Junction forms OSM states outright: `roundabout` or `mini`, on a network node, with the ring's real radius and whether the ring was complete. |
| `buildings` | One per footprint: a game `Lot` (also pushed onto `net.lots`), the real polygon and holes, kind, civic archetype, height, and how each was decided. |
| `zones`, `zoneAt(p)` | Land-use polygons as `residential`, `commercial`, `industrial`, `park`, `farmland` or `water`. |
| `isWater(p)`, `water` | Water areas and waterway lines with widths, behind a point test. |
| `stations` | Railway stations and halts, each with the nearest rail segment. |
| `unsupported` | Everything the game can't represent yet, each with a kind, a note, the OSM ways, a local position and a latitude and longitude. |
| `dropped` | OSM ways left out of the network, and why. |
| `projection` | `toLocal(lat, lon)` and `toLatLon(p)` for this area. |
| `stats` | Counts for the report and tests. |

The stages can be used on their own:

| Stage | File | Notes |
|---|---|---|
| Overpass JSON → indexed OSM | `overpass.ts` | `parseOverpass`, `joinRings` and `areas` (multipolygons back into rings). |
| Projection | `projection.ts` | `localProjection(origin)`. |
| Tags → catalogue | `tags.ts` | `roadTypeFor(tags, paired)`, `railTypeFor`, `classify`, `parseMph`, `lanesOf`, `onewayOf`. |
| Road graph | `graph.ts` | `buildGraph`, `collapseRoundabouts`, `pairCarriageways`, `dropSlivers`, `dropDuplicates`, `joinRuns`, `reportOneWays`. |
| Buildings | `buildings.ts` | `orientedRect`, `kindOf`, `heightOf`, `buildingsOf`. |
| Land, water, stations | `landuse.ts` | `zonesOf`, `zoneLookup`, `waterOf`, `stationsOf`. |
| Drawing | `svg.ts` | `importSvg`, `rawSvg`. |

Scripts:

- `node src/proto/osm/fetch-fixture.mjs` refetches the Banbury fixture. Run it rarely. Its
  query and trim live in `fetch.ts`.
- `node src/proto/osm/render.mjs` redraws `docs/reports/osm-import.svg` and `osm-raw.svg`.

## Coordinates

`projection.ts` is a local tangent plane (east, north, up) touching the WGS84 ellipsoid at
the area's centre. Game axes are x east, z south (north is −z) and y up. That keeps the
engine's left-hand rule true on real maps: in `junction.ts` a negative turn is a left turn.
Over the 1.5 km fixture the plane is accurate to well under a millimetre. It degrades
slowly with distance, so it's fine for a region of a few tens of kilometres.

The world-tiles session will bring its own projection: tiles keyed to latitude and
longitude, with a floating origin. **This projection should be replaced by that one, not
kept alongside it.** The importer only uses `toLocal` and `toLatLon`, so the swap is one
line in `import.ts`. Two things to keep: the axis convention above, and one origin per
region rather than one global plane (ROADMAP.md).

## Integration plan: from an address to a playable town

1. **Find the place.** The player types an address.
   - Geocode it with [Nominatim](https://operations.osmfoundation.org/policies/nominatim/)
     or [Photon](https://photon.komoot.io/) while we're small.
   - Nominatim's public service allows at most one request a second. It needs a real
     User-Agent or Referer identifying the game. It forbids autocomplete, so search on
     submit, not per keystroke. Results must be cached and credited.
   - Photon is built for search-as-you-type, but its public instance is fair-use only.
   - At scale, use a commercial geocoder or self-host Nominatim or Photon.
   - Send the address from the player's device, not through our servers, and don't store it.
2. **Pick the area** on a [Leaflet](https://leafletjs.com/) map. Draw a box whose size is
   the number of world tiles. Base-map tiles need attribution. The
   [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) forbids heavy
   use of `tile.openstreetmap.org`, so use a tile provider or our own tiles.
3. **Fetch per world tile**, not one big box, so it streams and caches the same way the
   world does. Pad each tile by about 100 m so roads crossing its edge join up with the
   next tile's.
   - Small areas: Overpass. The public instances are shared and volunteer-run. Keep under
     their rate limits, back off on 429s, and use one query per tile with the filter in
     `fetch-fixture.mjs`.
   - Large or offline maps: Protomaps/PMTiles or Geofabrik extracts, cut to tiles on our
     side.
4. **Import** each tile with `importOsm`. Across tiles, nodes on a tile's edge are
   stitched by OSM node id, because OSM ids are stable and shared.
5. **Hand over to the game's own designers.** OSM gives the network, not the junction
   geometry.
   - Run `commitRoads()` as for a hand-built town: junctions design themselves, claim land
     and evict plots.
   - Seed each junction's form from `hints`: a roundabout with its real radius, or a mini.
     The player can re-design it or keep it.
   - The building generator takes each `Lot` and its real `poly` (a later pass can extrude
     the polygon rather than the rectangle).
   - `zones` feed the land registry and the demand model.
6. **Real heights** come later from the elevation sources in ROADMAP.md. The importer
   leaves every node at y = 0 and records `bridge`, `tunnel` and `layer` per road, so the
   grade solver can lift or sink them.

### Prerequisite: one-way roads

The engine has no one-way roads, and that's the biggest gap. The importer works round it
as follows:

- The two carriageways of a dual carriageway or motorway are **paired** into one centreline
  of the matching dual or motorway type, when they run parallel within 40 m (60 m for
  motorways and trunk roads) and share a name or ref.
- Double-track railways drawn as two single tracks are paired the same way, within 6.5 m.
- One-way streets that don't pair are **built two-way** and listed as unsupported.
- One-way slip roads are **left out** and listed. The junction designer adds its own slips.
- One-way loops (gyratories, town-centre one-way systems) are listed with their extent.

Once `RSeg` can carry a direction, the pairing pass can be skipped where it would lose
information: a gyratory, a one-way system, slip roads and motorway interchanges.
`ImportedRoad.oneway` and the `unsupported` list mark exactly which roads to revisit.

## Licensing

OpenStreetMap data is under the ODbL 1.0. For the game that means:

- **Attribution** wherever map data is shown: "© OpenStreetMap contributors", linking to
  <https://www.openstreetmap.org/copyright>. That covers the in-game map, the onboarding
  map, screenshots the game produces and the store page. `import.ts` exports
  `ATTRIBUTION` and `LICENCE` for the UI. The SVGs and the fixture carry them.
- **Share-alike for derived databases.** A world built from OSM is a derived database. If
  we distribute it (downloadable world tiles, shared saves, a server that hands them out),
  it must be offered under the ODbL, or the changes must be published as a diff against
  OSM. Game assets and code are not affected. Images of the world are "produced works"
  and need only the attribution.
- **Fixture.** `src/proto/osm/fixtures/banbury.json` is an OSM extract. It stays under the
  ODbL, and its `attribution` field says so.
- **Other sources.** Each geocoder, tile server and elevation dataset has its own usage
  policy and credit line. Collect them all on one credits screen.
