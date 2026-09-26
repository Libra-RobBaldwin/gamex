# Direction of travel

The long-term aim is a transport and city game on massive maps built from real geography,
with an onboarding flow where a player enters their address and gets their own place
built. That comes last. It only works once the engine underneath does. Until then,
nothing should assume a flat world, a fixed-size map or hand-placed content.

## Order

1. **Now.**
   - Road joins, tapers and collision-free traffic.
   - The economy: towns grow and shrink with how well passengers and goods are served,
     ported from the 2D game.
   - The branded UI.
2. **One-way roads and grade-separated interchanges.** Real data needs them:
   OpenStreetMap draws dual carriageways and motorways as pairs of one-way ways, with
   one-way slip roads. Motorway junctions need them too.
3. **Terrain.** Procedural height tiles. The grade solver treats the ground as a limit, so
   embankments, cuttings, tunnels and bridges fall out of it. Plots and buildings step
   with the ground, and rack railways get real hills to climb.
4. **Tiles.** Streaming about 1 km tiles keyed to real latitude and longitude, levels of
   detail, a floating origin and deterministic seeds (see `ENGINE.md`).
5. **Real elevation.** The same height interface, fed from open elevation data:
   - global: Copernicus GLO-30 or AWS Terrain Tiles (about 30 m);
   - UK: OS Terrain 50, and Environment Agency LIDAR at 1–2 m.
6. **Importing real places.** OpenStreetMap data:
   - Overpass for small areas;
   - Protomaps/PMTiles for large or offline maps.
   - Tags map onto the road catalogue: `highway`, `lanes`, `oneway`, `junction=roundabout`,
     `maxspeed`, rail and water.
   - Footprints become plots, with heights from `height`/`building:levels`, or from
     LIDAR (DSM − DTM) in the UK.
   - Land use feeds the land registry.
   - Junctions are re-designed or kept.
7. **Onboarding.** Find the address (Nominatim or Photon while small; a commercial or
   self-hosted geocoder at scale), pick the area on a Leaflet map, then build it.
8. **Massive real-geography maps.**

## Constraints to respect along the way

- **Licensing.** OpenStreetMap data is ODbL. Credit "© OpenStreetMap contributors".
  Any database derived from it that we distribute stays open under the same licence.
  Follow each geocoder's and elevation source's usage policy.
- **World coordinates are metres on a local projection per region.** The code should never
  assume one global flat plane.
- **Anything procedural must be able to take real data instead:** the height source, road
  and plot layout, and building footprints.

## V2 ideas, from Cities in Motion 2 (26 Sep 2026)

The user liked Cities in Motion 2. What it did well is worth taking for a second version; what sank
it (a 6/10 game that felt like working at a transit authority) is worth avoiding. Nothing here is for
V1: V1 is the loop on the region, played and fixed.

Take, for V2:
- **Passenger types** with different price and time sensitivity: commuters who shrug at fares and ride
  the town lines, students who are price-sensitive, pensioners who travel off-peak to the shops,
  visitors who never buy a season ticket. The economy already moves people by home and job; types
  make fares and timetables mean something without new UI.
- **Rush hours:** a demand curve by hour of the game clock, so buses fill and bunch at eight in the
  morning, and a single "more buses at peak" toggle per line. No per-line timetables.
- **Growth beside the stop, seen:** buildings going up next to a busy stop within days.
- **A stop's "why nobody rides" card:** too dear, too slow, too full, no route. The town panel's
  reasons, at the stop.
- **Eras:** the vehicle library's eras unlocking over the decades.

Avoid, for good:
- fare zones drawn on the map, ticket kinds (single, day, monthly), per-line timetables with separate
  rush-hour schedules, employee wages, vehicle wear, and depots every route must start and end at;
- empty-map missions: each challenge hands the player a situation, not a blank region;
- a metro tool harder than the bus stop tool.
