// Geography: where on Earth a region's metres are. Each region has its own transverse Mercator
// projection centred on its origin (central meridian through the origin, scale 1 there), so its
// metres are true to within a few parts in 100,000 for 50 km around the origin. Game space uses
// three.js axes: x is east, z is south (so north is −z), y is up.
//
// The maths is Krüger's series to sixth order in n (Karney 2011), which is accurate to a few
// nanometres thousands of kilometres from the central meridian. That leaves the only real limit
// on a region's size as distortion, not rounding: the scale grows like 1 + x²/2R², so 50 km out
// a kilometre measures 3 cm long. Beyond that, maps are cut into several regions (RegionGrid).

import { TILE } from './tiles';

// WGS84, the datum GPS, OpenStreetMap and slippy map tiles all use.
const A_AXIS = 6378137;
const FLAT = 1 / 298.257223563;
const N = FLAT / (2 - FLAT);
const E2 = FLAT * (2 - FLAT);
const E = Math.sqrt(E2);
const DEG = Math.PI / 180;

// rectifying radius: metres per radian of "rectified" latitude
const RECT = (A_AXIS / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64 + N ** 6 / 256);
const n2 = N * N, n3 = n2 * N, n4 = n3 * N, n5 = n4 * N, n6 = n5 * N;
// forward (conformal → projected) and inverse coefficients
const ALPHA = [
  N / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
  (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
  (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
  (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
  (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
  (212378941 / 319334400) * n6,
];
const BETA = [
  N / 2 - (2 / 3) * n2 + (37 / 96) * n3 - (1 / 360) * n4 - (81 / 512) * n5 + (96199 / 604800) * n6,
  (1 / 48) * n2 + (1 / 15) * n3 - (437 / 1440) * n4 + (46 / 105) * n5 - (1118711 / 3870720) * n6,
  (17 / 480) * n3 - (37 / 840) * n4 - (209 / 4480) * n5 + (5569 / 90720) * n6,
  (4397 / 161280) * n4 - (11 / 504) * n5 - (830251 / 7257600) * n6,
  (4583 / 161280) * n5 - (108847 / 3991680) * n6,
  (20648693 / 638668800) * n6,
];

export interface LatLon { lat: number; lon: number } // degrees
export interface EN { e: number; n: number } // metres east and north of the region origin

// Transverse Mercator easting/northing (from the equator) for a longitude difference dLon, both
// in radians.
function tmForward(lat: number, dLon: number): EN {
  const s = Math.sin(lat);
  // conformal latitude, via tan: t = sinh(atanh(sin φ) − e·atanh(e sin φ))
  const t = Math.sinh(Math.atanh(s) - E * Math.atanh(E * s));
  const xi = Math.atan2(t, Math.cos(dLon));
  const eta = Math.atanh(Math.sin(dLon) / Math.sqrt(1 + t * t));
  let x = eta, y = xi;
  for (let j = 1; j <= 6; j++) {
    x += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { e: RECT * x, n: RECT * y };
}

function tmInverse(e: number, n: number): { lat: number; dLon: number } {
  const xi = n / RECT, eta = e / RECT;
  let xp = xi, ep = eta;
  for (let j = 1; j <= 6; j++) {
    xp -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    ep -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const tp = Math.sin(xp) / Math.sqrt(Math.sinh(ep) ** 2 + Math.cos(xp) ** 2); // tan of conformal latitude
  const dLon = Math.atan2(Math.sinh(ep), Math.cos(xp));
  // conformal → geodetic latitude by Newton's method on tan φ (Karney eq. 19–21); 2–3 steps
  let tau = tp;
  for (let k = 0; k < 6; k++) {
    const sig = Math.sinh(E * Math.atanh((E * tau) / Math.sqrt(1 + tau * tau)));
    const taup = tau * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + tau * tau);
    const dtau = ((tp - taup) / Math.sqrt(1 + taup * taup)) * ((1 + (1 - E2) * tau * tau) / ((1 - E2) * Math.sqrt(1 + tau * tau)));
    tau += dtau;
    if (Math.abs(dtau) < 1e-15) break;
  }
  return { lat: Math.atan(tau), dLon };
}

const wrapLon = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

// A region: one local projection, named by a stable id. Its tiles are keyed in its own metres.
export class Region {
  readonly id: string;
  readonly origin: LatLon;
  private n0: number;
  constructor(id: string, origin: LatLon) {
    this.id = id;
    this.origin = { lat: origin.lat, lon: wrapLon(origin.lon) };
    this.n0 = tmForward(origin.lat * DEG, 0).n;
  }
  // latitude/longitude → metres east/north of the origin
  toEN(p: LatLon): EN {
    const f = tmForward(p.lat * DEG, wrapLon(p.lon - this.origin.lon) * DEG);
    return { e: f.e, n: f.n - this.n0 };
  }
  fromEN(p: EN): LatLon {
    const r = tmInverse(p.e, p.n + this.n0);
    return { lat: r.lat / DEG, lon: wrapLon(this.origin.lon + r.dLon / DEG) };
  }
  // game space (x east, z south)
  toWorld(p: LatLon) { const q = this.toEN(p); return { x: q.e, z: -q.n }; }
  fromWorld(p: { x: number; z: number }) { return this.fromEN({ e: p.x, n: -p.z }); }
  // How much a metre on the ground is stretched in this projection at a point (1 at the origin's
  // meridian). Useful to report distortion; the game treats its metres as true.
  scaleAt(p: { x: number; z: number }) {
    const d = 1;
    const a = this.fromWorld(p), b = this.fromWorld({ x: p.x + d, z: p.z });
    return d / geodesicShort(a, b);
  }
}

// Ellipsoidal distance for points a few metres apart (local radii of curvature), enough for
// measuring scale; not a general geodesic.
function geodesicShort(a: LatLon, b: LatLon) {
  const lat = ((a.lat + b.lat) / 2) * DEG, s = Math.sin(lat);
  const w = Math.sqrt(1 - E2 * s * s);
  const nu = A_AXIS / w, rho = (A_AXIS * (1 - E2)) / (w * w * w);
  const dn = (b.lat - a.lat) * DEG * rho, de = wrapLon(b.lon - a.lon) * DEG * nu * Math.cos(lat);
  return Math.hypot(dn, de);
}

// Maps bigger than one region: a grid of regions, each REGION_SIZE square in the anchor's own
// projection, each with its own origin at its centre. Region (0,0) is centred on the anchor.
// Every region's tiles are keyed in its own metres; handing over converts through lat/lon, which
// is exact, so a place has one position per region and nothing drifts.
export const REGION_SIZE = 50 * TILE;
export class RegionGrid {
  readonly anchor: Region;
  private cache = new Map<string, Region>();
  constructor(anchor: LatLon, readonly size = REGION_SIZE) { this.anchor = new Region('0,0', anchor); this.cache.set('0,0', this.anchor); }
  // which region a place falls in
  cellOf(p: LatLon) {
    const q = this.anchor.toEN(p);
    return { ri: Math.floor(q.e / this.size + 0.5), rj: Math.floor(q.n / this.size + 0.5) };
  }
  region(ri: number, rj: number): Region {
    const id = `${ri},${rj}`;
    let r = this.cache.get(id);
    if (!r) this.cache.set(id, (r = new Region(id, this.anchor.fromEN({ e: ri * this.size, n: rj * this.size }))));
    return r;
  }
  regionAt(p: LatLon) { const c = this.cellOf(p); return this.region(c.ri, c.rj); }
  // Game position in one region → the same place in another. Neighbouring regions are turned
  // slightly against each other (meridian convergence, about 1° per 100 km east–west at 52°N),
  // which is why a whole region's content can't just be shifted across.
  transfer(p: { x: number; z: number }, from: Region, to: Region) { return to.toWorld(from.fromWorld(p)); }
  // The rigid move (rotation then shift) that best maps `from`'s space onto `to`'s near a point:
  // enough to draw a neighbouring region's tiles by the border without converting every vertex.
  localTransform(at: { x: number; z: number }, from: Region, to: Region) {
    const o = this.transfer(at, from, to), px = this.transfer({ x: at.x + 100, z: at.z }, from, to);
    const rot = Math.atan2(px.z - o.z, px.x - o.x);
    const c = Math.cos(rot), s = Math.sin(rot);
    // to = R·(p − at) + o
    return { rot, apply: (p: { x: number; z: number }) => ({ x: c * (p.x - at.x) - s * (p.z - at.z) + o.x, z: s * (p.x - at.x) + c * (p.z - at.z) + o.z }) };
  }
}

// ---------- web (slippy) map tiles ----------
// Real data sources (OSM vector tiles, PMTiles, Terrain Tiles) are cut into Web Mercator z/x/y
// tiles. These find which of those cover one of our tiles, so a tile's data can be fetched on its
// own when it streams in.
export interface Slippy { z: number; x: number; y: number }
const MAX_MERC_LAT = 85.0511287798066;
export function slippyAt(p: LatLon, z: number): Slippy {
  const n = 2 ** z, lat = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, p.lat)) * DEG;
  const x = Math.floor(((wrapLon(p.lon) + 180) / 360) * n);
  const y = Math.floor(((1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}
// north-west corner of a slippy tile
export function slippyCorner(t: Slippy): LatLon {
  const n = 2 ** t.z;
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - (2 * t.y) / n))) / DEG, lon: (t.x / n) * 360 - 180 };
}
// the zoom whose tiles are about `metres` across at a latitude (web tiles shrink with cos lat)
export function slippyZoomFor(metres: number, lat: number) {
  return Math.max(0, Math.min(22, Math.round(Math.log2((40075016.686 * Math.cos(lat * DEG)) / metres))));
}
// Every slippy tile at zoom z that touches our tile (i, j) of `region`. Our tile's edges are
// curved in lat/lon, so edges are sampled rather than only corners.
export function slippyCover(region: Region, i: number, j: number, z: number, size = TILE): Slippy[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const k = 4;
  for (let a = 0; a <= k; a++) for (let b = 0; b <= k; b++) {
    if (a !== 0 && a !== k && b !== 0 && b !== k) continue;
    const t = slippyAt(region.fromWorld({ x: (i + a / k) * size, z: (j + b / k) * size }), z);
    x0 = Math.min(x0, t.x); x1 = Math.max(x1, t.x); y0 = Math.min(y0, t.y); y1 = Math.max(y1, t.y);
  }
  const out: Slippy[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}
