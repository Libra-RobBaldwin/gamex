// British National Grid (OSGB36 transverse Mercator on the Airy 1830 ellipsoid) to WGS84
// latitude and longitude: the inverse projection, then a Helmert shift (good to a few metres,
// which is plenty for saying where a region is).
const a = 6377563.396, b = 6356256.909, F0 = 0.9996012717, lat0 = (49 * Math.PI) / 180, lon0 = (-2 * Math.PI) / 180, N0 = -100000, E0 = 400000;
const e2 = 1 - (b * b) / (a * a), n = (a - b) / (a + b);
function meridian(phi) {
  const n2 = n * n, n3 = n2 * n;
  return b * F0 * ((1 + n + 1.25 * n2 + 1.25 * n3) * (phi - lat0) - (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(phi - lat0) * Math.cos(phi + lat0) + (1.875 * n2 + 1.875 * n3) * Math.sin(2 * (phi - lat0)) * Math.cos(2 * (phi + lat0)) - (35 / 24) * n3 * Math.sin(3 * (phi - lat0)) * Math.cos(3 * (phi + lat0)));
}
export function gridToLatLon(E, N) {
  let phi = lat0, M = 0;
  do { phi = (N - N0 - M) / (a * F0) + phi; M = meridian(phi); } while (Math.abs(N - N0 - M) >= 0.00001);
  const s = Math.sin(phi), c = Math.cos(phi), t = Math.tan(phi);
  const nu = (a * F0) / Math.sqrt(1 - e2 * s * s), rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * s * s, 1.5), eta2 = nu / rho - 1;
  const VII = t / (2 * rho * nu), VIII = (t / (24 * rho * nu ** 3)) * (5 + 3 * t * t + eta2 - 9 * t * t * eta2), IX = (t / (720 * rho * nu ** 5)) * (61 + 90 * t * t + 45 * t ** 4);
  const X = 1 / (c * nu), XI = (1 / (c * 6 * nu ** 3)) * (nu / rho + 2 * t * t), XII = (1 / (c * 120 * nu ** 5)) * (5 + 28 * t * t + 24 * t ** 4), XIIA = (1 / (c * 5040 * nu ** 7)) * (61 + 662 * t * t + 1320 * t ** 4 + 720 * t ** 6);
  const dE = E - E0;
  const lat = phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6, lon = lon0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7;
  // OSGB36 → WGS84 (Helmert)
  const H = 0, sl = Math.sin(lat), cl = Math.cos(lat), nuA = a / Math.sqrt(1 - e2 * sl * sl);
  const x1 = (nuA + H) * cl * Math.cos(lon), y1 = (nuA + H) * cl * Math.sin(lon), z1 = ((1 - e2) * nuA + H) * sl;
  const tx = 446.448, ty = -125.157, tz = 542.06, sc = 20.4894e-6, rx = (0.1502 / 3600) * (Math.PI / 180), ry = (0.247 / 3600) * (Math.PI / 180), rz = (0.8421 / 3600) * (Math.PI / 180);
  const x2 = tx + (1 + sc) * x1 - rz * y1 + ry * z1, y2 = ty + rz * x1 + (1 + sc) * y1 - rx * z1, z2 = tz - ry * x1 + rx * y1 + (1 + sc) * z1;
  const aW = 6378137, bW = 6356752.3142, e2W = 1 - (bW * bW) / (aW * aW), p = Math.hypot(x2, y2);
  let la = Math.atan2(z2, p * (1 - e2W)), prev;
  do { prev = la; const nuW = aW / Math.sqrt(1 - e2W * Math.sin(la) ** 2); la = Math.atan2(z2 + e2W * nuW * Math.sin(la), p); } while (Math.abs(la - prev) > 1e-12);
  return { lat: (la * 180) / Math.PI, lon: (Math.atan2(y2, x2) * 180) / Math.PI };
}
