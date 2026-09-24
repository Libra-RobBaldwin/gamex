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
