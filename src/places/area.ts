// The area the player picks: a square of a given size centred on a point, as the box Overpass
// wants, and that box cut into tiles small enough for a busy public server to answer.

import type { Bbox } from '../proto/osm/fetch';
import { localProjection, type LatLon } from '../proto/osm/projection';

export const SIZES_KM = [1, 1.5, 2, 2.5, 3] as const;
export const TILE_KM = 1.3; // a tile's side at most; dense town centres answer in seconds at this size

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** Keeps a centre where a square around it still makes sense (Leaflet's own limit is ±85°). */
export const clampCentre = (c: LatLon): LatLon => ({ lat: Math.max(-84, Math.min(84, c.lat)), lon: ((((c.lon + 180) % 360) + 360) % 360) - 180 });

/**
 * Where a square found from a postcode starts: the nearest point on a grid about 550 m apart, so
 * the square (and everything sent or saved from it) never holds the postcode's exact point. The
 * postcode stays inside even the smallest square: the grid moves the centre at most about 280 m.
 */
export function snapCentre(c: LatLon): LatLon {
  const lat = Math.round(c.lat / 0.005) * 0.005;
  const step = 0.005 / Math.max(0.2, Math.cos((lat * Math.PI) / 180)); // about the same distance east-west
  return { lat: r6(lat), lon: r6(Math.round(c.lon / step) * step) };
}

/** A square `sizeKm` on a side, centred on `c`, measured on the ground (not in degrees). */
export function squareBbox(c: LatLon, sizeKm: number): Bbox {
  const centre = clampCentre(c);
  const p = localProjection(centre), h = (sizeKm * 1000) / 2;
  const n = p.toLatLon({ x: 0, z: -h }).lat, s = p.toLatLon({ x: 0, z: h }).lat;
  const e = p.toLatLon({ x: h, z: 0 }).lon, w = p.toLatLon({ x: -h, z: 0 }).lon;
  return [r6(s), r6(w), r6(n), r6(e)];
}

export const bboxCentre = (b: readonly number[]): LatLon => ({ lat: (b[0] + b[2]) / 2, lon: (b[1] + b[3]) / 2 });

/** The square cut into an n × n grid of equal tiles, none more than `maxKm` a side, north-west first. */
export function tilesOf(b: Bbox, sizeKm: number, maxKm = TILE_KM): Bbox[] {
  const n = Math.max(1, Math.ceil(sizeKm / maxKm - 1e-9));
  const dLat = (b[2] - b[0]) / n, dLon = (b[3] - b[1]) / n;
  const out: Bbox[] = [];
  for (let i = n - 1; i >= 0; i--) for (let j = 0; j < n; j++) {
    const s = i === 0 ? b[0] : r6(b[0] + dLat * i), nn = i === n - 1 ? b[2] : r6(b[0] + dLat * (i + 1));
    const w = j === 0 ? b[1] : r6(b[1] + dLon * j), e = j === n - 1 ? b[3] : r6(b[1] + dLon * (j + 1));
    out.push([s, w, nn, e]);
  }
  return out;
}

/** An area's key in the cache: where and how big, and what it's called. Never the postcode. */
export const areaId = (b: Bbox, name: string) => `${b.map((v) => v.toFixed(5)).join(',')}|${name.trim().toLowerCase()}`;
