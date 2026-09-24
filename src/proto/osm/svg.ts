// Top-down SVG drawings for checking an import by eye: one of what the game built, one of the raw
// OSM data it came from. Both use the same local metres, so they can be laid over each other.

import { halfOf, kerbOf } from '../catalog';
import type { P } from '../roads';
import { ATTRIBUTION, type OsmImport } from './import';
import { zoneKindOf, type ZoneKind } from './landuse';
import { areas, type OsmData } from './overpass';
import { classify } from './tags';

const f = (v: number) => (Math.round(v * 10) / 10).toString();
const pts = (ps: P[]) => ps.map((p) => `${f(p.x)},${f(p.z)}`).join(' ');
const pathD = (ps: P[]) => `M${ps.map((p) => `${f(p.x)} ${f(p.z)}`).join('L')}`;
const ringsD = (rings: P[][]) => rings.map((r) => `${pathD(r)}Z`).join('');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const ZONE_FILL: Record<ZoneKind, string> = { residential: '#ebe5d8', commercial: '#f3dcdc', industrial: '#e0d6ea', park: '#cfe6c2', farmland: '#eef0cc', water: '#a9cbe8' };
const FAMILY: Record<string, string> = { Street: '#ffffff', Avenue: '#fffaf0', Boulevard: '#fdf1d6', Arterial: '#f8d99a', Rural: '#fff3b0', Dual: '#f2ac62', Motorway: '#7ea7dc' };
const KIND_FILL: Record<string, string> = { house: '#c9b8a6', terrace: '#b99c86', flats: '#a88f7e', shop: '#d98b7a', office: '#8ea3bf', tower: '#6f86a8', industry: '#9d97a8', civic: '#c7a64f', minor: '#d8d2c8' };
const UNSUPPORTED = '#d0149a';

function frame(b: OsmImport['bounds'], px: number, body: string, title: string) {
  const pad = 30, w = b.x1 - b.x0 + pad * 2, h = b.z1 - b.z0 + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.x0 - pad)} ${f(b.z0 - pad)} ${f(w)} ${f(h)}" width="${px}" height="${Math.round((px * h) / w)}" font-family="system-ui, sans-serif">
<title>${esc(title)}</title>
<rect x="${f(b.x0 - pad)}" y="${f(b.z0 - pad)}" width="${f(w)}" height="${f(h)}" fill="#f4f2ec"/>
${body}
<text x="${f(b.x1 + pad - 6)}" y="${f(b.z1 + pad - 8)}" font-size="11" text-anchor="end" fill="#333">${esc(`Map data ${ATTRIBUTION} · ODbL`)}</text>
</svg>
`;
}

function legend(x: number, z: number, rows: [string, string, 'fill' | 'line'][]) {
  const h = rows.length * 15 + 12;
  let s = `<g><rect x="${f(x)}" y="${f(z)}" width="190" height="${h}" fill="#fff" fill-opacity="0.88" stroke="#999" stroke-width="0.5"/>`;
  rows.forEach(([label, colour, kind], i) => {
    const y = z + 14 + i * 15;
    s += kind === 'fill' ? `<rect x="${f(x + 8)}" y="${f(y - 8)}" width="14" height="10" fill="${colour}" stroke="#666" stroke-width="0.4"/>` : `<line x1="${f(x + 6)}" y1="${f(y - 3)}" x2="${f(x + 24)}" y2="${f(y - 3)}" stroke="${colour}" stroke-width="4"/>`;
    s += `<text x="${f(x + 30)}" y="${f(y)}" font-size="10" fill="#222">${esc(label)}</text>`;
  });
  return `${s}</g>`;
}

// What the game built: roads at their real width by type, plots, zones, water, and what it couldn't do.
export function importSvg(imp: OsmImport, px = 1800) {
  const { net, bounds: b } = imp;
  const out: string[] = [];
  for (const z of imp.zones) out.push(`<path d="${ringsD([...z.outer, ...z.inner])}" fill="${ZONE_FILL[z.kind]}" fill-rule="evenodd"${z.kind === 'water' ? '' : ' fill-opacity="0.9"'}/>`);
  for (const l of imp.water.lines) out.push(`<path d="${pathD(l.path)}" fill="none" stroke="${ZONE_FILL.water}" stroke-width="${f(l.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  // footways under carriageways, railways under roads (bridges aside, the game has no layers yet)
  const segs = [...net.segs.values()];
  const rail = segs.filter((s) => net.def(s).cls === 'rail'), road = segs.filter((s) => net.def(s).cls === 'road');
  for (const s of rail) {
    const d = net.def(s), p = net.path(s);
    out.push(`<path d="${pathD(p)}" fill="none" stroke="#b9b2a6" stroke-width="${f(halfOf(d) * 2)}" stroke-linejoin="round"/>`);
    out.push(`<path d="${pathD(p)}" fill="none" stroke="#3d3d3d" stroke-width="${d.tracks === 2 ? 2.6 : 1.4}" stroke-dasharray="${d.tracks === 2 ? '' : '6 3'}"/>`);
  }
  for (const s of road) out.push(`<path d="${pathD(net.path(s))}" fill="none" stroke="#c9c5bc" stroke-width="${f(halfOf(net.def(s)) * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const s of road) {
    const d = net.def(s);
    out.push(`<path d="${pathD(net.path(s))}" fill="none" stroke="${FAMILY[d.family] ?? '#fff'}" stroke-width="${f(kerbOf(d) * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    if (d.median) out.push(`<path d="${pathD(net.path(s))}" fill="none" stroke="${d.medianKind === 'grass' || d.medianKind === 'trees' ? '#9cc58b' : '#8a8a8a'}" stroke-width="${f(Math.max(0.6, d.median))}"/>`);
  }
  // one-way roads the game builds two-way: a thin line down the middle
  for (const r of imp.roads.values()) if (r.oneway) { const s = net.segs.get(r.seg); if (s) out.push(`<path d="${pathD(net.path(s))}" fill="none" stroke="${UNSUPPORTED}" stroke-width="0.9" stroke-dasharray="3 3"/>`); }
  for (const h of imp.hints) {
    const n = net.node(h.netNode);
    out.push(`<circle cx="${f(n.x)}" cy="${f(n.z)}" r="${f(h.radius)}" fill="none" stroke="#1d6fb8" stroke-width="1.6" stroke-dasharray="${h.form === 'mini' ? '2 2' : ''}"/>`);
  }
  for (const bl of imp.buildings) {
    const fill = bl.minor ? KIND_FILL.minor : KIND_FILL[bl.kind];
    out.push(`<polygon points="${pts(bl.poly)}" fill="${fill}" stroke="#5a5048" stroke-width="0.25"/>`);
  }
  // the fitted rectangles, faint, to show how much of each footprint a lot keeps
  out.push(`<g fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="0.2">${imp.buildings.map((bl) => {
    const l = bl.lot, c = Math.cos(l.rot), s = Math.sin(l.rot);
    const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: l.x + c * (l.w / 2) * i - s * (l.d / 2) * j, z: l.z + s * (l.w / 2) * i + c * (l.d / 2) * j }));
    return `<polygon points="${pts(q)}"/>`;
  }).join('')}</g>`);
  for (const st of imp.stations) out.push(`<g><rect x="${f(st.at.x - 6)}" y="${f(st.at.z - 6)}" width="12" height="12" fill="#c8102e" stroke="#fff" stroke-width="1.5"/><text x="${f(st.at.x + 10)}" y="${f(st.at.z + 4)}" font-size="13" font-weight="600" fill="#c8102e">${esc(st.name ?? 'station')}</text></g>`);
  // what couldn't be represented
  for (const u of imp.unsupported) {
    if (u.path && u.kind !== 'one-way street') out.push(`<path d="${pathD(u.path)}" fill="none" stroke="${UNSUPPORTED}" stroke-opacity="0.55" stroke-width="3" stroke-linecap="round"/>`);
    if (u.kind === 'one-way street') continue;
    out.push(`<circle cx="${f(u.at.x)}" cy="${f(u.at.z)}" r="${u.kind === 'gyratory' || u.kind === 'interchange' ? 9 : 4.5}" fill="${UNSUPPORTED}" fill-opacity="0.25" stroke="${UNSUPPORTED}" stroke-width="1"/>`);
    if (u.kind !== 'railway siding') out.push(`<text x="${f(u.at.x + 6)}" y="${f(u.at.z - 6)}" font-size="8" fill="${UNSUPPORTED}">${esc(u.kind)}</text>`);
  }
  out.push(legend(b.x0 - 20, b.z0 - 20, [
    ['Street', FAMILY.Street, 'line'], ['Arterial', FAMILY.Arterial, 'line'], ['Rural', FAMILY.Rural, 'line'], ['Dual carriageway', FAMILY.Dual, 'line'], ['Railway', '#3d3d3d', 'line'],
    ['Roundabout hint (real radius)', '#1d6fb8', 'line'], ['Unsupported / one-way', UNSUPPORTED, 'line'],
    ['House', KIND_FILL.house, 'fill'], ['Terrace', KIND_FILL.terrace, 'fill'], ['Flats', KIND_FILL.flats, 'fill'], ['Shop', KIND_FILL.shop, 'fill'], ['Office', KIND_FILL.office, 'fill'],
    ['Industry', KIND_FILL.industry, 'fill'], ['Civic', KIND_FILL.civic, 'fill'], ['Outbuilding', KIND_FILL.minor, 'fill'],
    ['Residential', ZONE_FILL.residential, 'fill'], ['Commercial', ZONE_FILL.commercial, 'fill'], ['Industrial', ZONE_FILL.industrial, 'fill'], ['Park', ZONE_FILL.park, 'fill'], ['Water', ZONE_FILL.water, 'fill'],
  ]));
  return frame(b, px, out.join('\n'), 'OSM import: what the game built');
}

// The raw OSM data, drawn plainly: every way by its tags, one-ways marked, nothing merged.
export function rawSvg(data: OsmData, local: (lat: number, lon: number) => P, bounds: OsmImport['bounds'], px = 1800) {
  const out: string[] = [];
  const ring = (ids: number[]) => ids.map((id) => data.nodes.get(id)).filter((n) => !!n).map((n) => local(n!.lat, n!.lon));
  for (const a of areas(data, (t) => !t.building && !!zoneKindOf(t))) out.push(`<path d="${ringsD([...a.outer.map(ring), ...a.inner.map(ring)])}" fill="${ZONE_FILL[zoneKindOf(a.tags)!]}" fill-rule="evenodd"/>`);
  for (const a of areas(data, (t) => !!t.building)) out.push(`<path d="${ringsD(a.outer.map(ring))}" fill="#bdb3a8" stroke="#6b6159" stroke-width="0.25"/>`);
  const W: Record<string, number> = { motorway: 3, trunk: 3, primary: 2.6, secondary: 2.2, tertiary: 1.8, unclassified: 1.4, residential: 1.4, living_street: 1.2, service: 0.8, pedestrian: 1.2, busway: 1.2 };
  const C: Record<string, string> = { motorway: '#4d78c9', trunk: '#d8663a', primary: '#e0913b', secondary: '#d6b43c', tertiary: '#8c8c8c', pedestrian: '#b0a0d0', busway: '#6aa0d0' };
  for (const w of data.ways.values()) {
    const t = w.tags;
    if (!t) continue;
    const path = ring(w.nodes);
    if (path.length < 2) continue;
    if (t.waterway) out.push(`<path d="${pathD(path)}" fill="none" stroke="#5b95c9" stroke-width="1.5"/>`);
    else if (t.railway && (classify(t).kind !== 'skip' || (t.railway === 'rail' && ['siding', 'yard', 'crossover'].includes(t.service ?? '')))) out.push(`<path d="${pathD(path)}" fill="none" stroke="#222" stroke-width="${t.service ? 0.6 : 1.2}"/>`);
    else if (t.highway && W[t.highway.replace(/_link$/, '')] && t.area !== 'yes') {
      const h = t.highway.replace(/_link$/, '');
      const ring = t.junction === 'roundabout' || t.junction === 'circular';
      out.push(`<path d="${pathD(path)}" fill="none" stroke="${ring ? '#1d6fb8' : C[h] ?? '#777'}" stroke-width="${W[h]}" stroke-linecap="round"/>`);
      // a one-way way gets a tick at its middle pointing the way traffic goes
      if (t.oneway === 'yes' || t.oneway === '-1') {
        const i = Math.floor((path.length - 1) / 2), a = path[i], c = path[i + 1], s = t.oneway === '-1' ? -1 : 1;
        const L = Math.hypot(c.x - a.x, c.z - a.z) || 1, ux = ((c.x - a.x) / L) * s, uz = ((c.z - a.z) / L) * s, m = { x: (a.x + c.x) / 2, z: (a.z + c.z) / 2 };
        out.push(`<path d="M${f(m.x - ux * 3 - uz * 2)} ${f(m.z - uz * 3 + ux * 2)}L${f(m.x + ux * 3)} ${f(m.z + uz * 3)}L${f(m.x - ux * 3 + uz * 2)} ${f(m.z - uz * 3 - ux * 2)}" fill="none" stroke="${UNSUPPORTED}" stroke-width="0.8"/>`);
      }
    }
  }
  for (const n of data.nodes.values()) if (n.tags?.railway === 'station') { const p = local(n.lat, n.lon); out.push(`<rect x="${f(p.x - 5)}" y="${f(p.z - 5)}" width="10" height="10" fill="#c8102e"/><text x="${f(p.x + 8)}" y="${f(p.z + 4)}" font-size="12" fill="#c8102e">${esc(n.tags.name ?? '')}</text>`); }
  out.push(legend(bounds.x0 - 20, bounds.z0 - 20, [['Primary', C.primary, 'line'], ['Secondary', C.secondary, 'line'], ['Tertiary', C.tertiary, 'line'], ['Roundabout ring', '#1d6fb8', 'line'], ['Railway', '#222', 'line'], ['One-way (tick)', UNSUPPORTED, 'line'], ['Building', '#bdb3a8', 'fill']]));
  return frame(bounds, px, out.join('\n'), 'Raw OpenStreetMap data');
}
