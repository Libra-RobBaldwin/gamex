// A minimal ESRI shapefile reader (.shp geometry + .dbf attributes), enough for OS OpenData:
// points, polylines and polygons (types 1, 3, 5 and their Z/M forms), dBASE III attributes.
// No dependencies. Coordinates stay in the file's own system (British National Grid metres).
import { readFileSync } from 'node:fs';

// Every record: { attrs: {...}, parts: [[x, y, x, y, ...], ...] } (a point is one part of one pair)
export function readShapefile(base, { bbox } = {}) {
  const shp = readFileSync(base + '.shp'), dbf = readFileSync(base + '.dbf');
  const attrs = readDbf(dbf);
  const out = [];
  let o = 100, k = 0;
  while (o + 8 <= shp.length) {
    const len = shp.readInt32BE(o + 4) * 2;
    const rec = o + 8;
    o = rec + len;
    const a = attrs[k++];
    const type = shp.readInt32LE(rec);
    if (type === 0) continue;
    const base2 = type % 10; // 1 point, 3 polyline, 5 polygon (11/13/15 Z, 21/23/25 M)
    if (base2 === 1) {
      const x = shp.readDoubleLE(rec + 4), y = shp.readDoubleLE(rec + 12);
      if (bbox && (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3])) continue;
      out.push({ attrs: a, parts: [[x, y]] });
      continue;
    }
    if (base2 !== 3 && base2 !== 5) continue;
    const x0 = shp.readDoubleLE(rec + 4), y0 = shp.readDoubleLE(rec + 12), x1 = shp.readDoubleLE(rec + 20), y1 = shp.readDoubleLE(rec + 28);
    if (bbox && (x1 < bbox[0] || x0 > bbox[2] || y1 < bbox[1] || y0 > bbox[3])) continue;
    const nParts = shp.readInt32LE(rec + 36), nPts = shp.readInt32LE(rec + 40);
    const starts = [];
    for (let i = 0; i < nParts; i++) starts.push(shp.readInt32LE(rec + 44 + 4 * i));
    const pts = rec + 44 + 4 * nParts;
    const parts = [];
    for (let i = 0; i < nParts; i++) {
      const s = starts[i], e = i + 1 < nParts ? starts[i + 1] : nPts;
      const arr = new Array((e - s) * 2);
      for (let j = s; j < e; j++) { arr[(j - s) * 2] = shp.readDoubleLE(pts + 16 * j); arr[(j - s) * 2 + 1] = shp.readDoubleLE(pts + 16 * j + 8); }
      parts.push(arr);
    }
    out.push({ attrs: a, parts, box: [x0, y0, x1, y1] });
  }
  return out;
}

function readDbf(b) {
  const n = b.readUInt32LE(4), headLen = b.readUInt16LE(8), recLen = b.readUInt16LE(10);
  const fields = [];
  for (let o = 32; b[o] !== 0x0d && o < headLen; o += 32) {
    const name = b.toString('latin1', o, o + 11).replace(/\0.*$/, '');
    fields.push({ name, type: String.fromCharCode(b[o + 11]), len: b[o + 16] });
  }
  const rows = new Array(n);
  for (let i = 0; i < n; i++) {
    let o = headLen + i * recLen + 1;
    const row = {};
    for (const f of fields) {
      const s = b.toString('utf8', o, o + f.len).trim();
      row[f.name] = f.type === 'N' || f.type === 'F' ? (s === '' ? null : Number(s)) : s;
      o += f.len;
    }
    rows[i] = row;
  }
  return rows;
}
