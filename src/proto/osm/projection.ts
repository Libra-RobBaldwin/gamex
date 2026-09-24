// Latitude and longitude to game metres: a local tangent plane (east, north, up) touching the
// WGS84 ellipsoid at the centre of the area. Over a couple of kilometres it's accurate to
// millimetres, and it never assumes one flat plane for the whole world: each area (later, each
// region of world tiles) gets its own origin. The world-tiles work will bring its own projection;
// this one should be folded into it rather than kept alongside (see docs/osm.md).
//
// Axes match the game: x runs east, z runs south (so north is −z, which is "up" on a top-down
// view), y is height. That keeps the left-hand rule in junction.ts (a negative turn is a left
// turn) true of real maps rather than mirrored.

import type { P } from '../roads';

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F);
const RAD = Math.PI / 180;

export interface LatLon { lat: number; lon: number }
export interface Projection {
  origin: LatLon;
  toLocal(lat: number, lon: number, h?: number): P;
  toLatLon(p: P): LatLon;
}

function ecef(lat: number, lon: number, h: number) {
  const f = lat * RAD, l = lon * RAD, s = Math.sin(f), N = A / Math.sqrt(1 - E2 * s * s);
  return [(N + h) * Math.cos(f) * Math.cos(l), (N + h) * Math.cos(f) * Math.sin(l), (N * (1 - E2) + h) * s];
}

export function localProjection(origin: LatLon): Projection {
  const f = origin.lat * RAD, l = origin.lon * RAD;
  const sf = Math.sin(f), cf = Math.cos(f), sl = Math.sin(l), cl = Math.cos(l);
  const o = ecef(origin.lat, origin.lon, 0);
  const toLocal = (lat: number, lon: number, h = 0): P => {
    const q = ecef(lat, lon, h), dx = q[0] - o[0], dy = q[1] - o[1], dz = q[2] - o[2];
    const e = -sl * dx + cl * dy;
    const n = -sf * cl * dx - sf * sl * dy + cf * dz;
    return { x: e, z: -n };
  };
  // metres per degree at the origin, to seed the inverse
  const s0 = Math.sin(f), W = Math.sqrt(1 - E2 * s0 * s0);
  const mLat = (A * (1 - E2)) / (W * W * W) * RAD, mLon = (A / W) * cf * RAD;
  const toLatLon = (p: P): LatLon => {
    let lat = origin.lat - p.z / mLat, lon = origin.lon + p.x / mLon;
    // a few Newton steps take it from centimetres to well under a millimetre
    for (let i = 0; i < 3; i++) {
      const q = toLocal(lat, lon);
      lat -= (q.z - p.z) / -mLat;
      lon -= (q.x - p.x) / mLon;
    }
    return { lat, lon };
  };
  return { origin, toLocal, toLatLon };
}
