// Where the town's people can be: the footways along every road with a pavement, the bus stops,
// the kerbs where people cross at a junction's arms, parks and playgrounds, pubs and shop windows,
// schools and works gates. Everything is read from the game's own geometry (the road courses and
// cross-sections the drawing uses, the junction shapes, the infill regions and the plots), so a
// person is never standing where the drawing has road, a building or a pond. These are pure
// functions of the town, rebuilt when it changes, never per frame.
import { closestOnPath, kerbOf, pathLength, pointAt, type Lot, type Network, type P, type RSeg, type Stop } from '../roads';
import { legsAt, type Junction } from '../junction';
import { CELL, type Region } from '../infill';
import { parkEntrances, parkPaths } from '../parkplan';
import { USE, unitsOf } from '../buildgen';
import { crossingAt } from '../jshape';
import { pedCrossingsOn, type PedXKind } from '../pedx';
import { courseOf, type Course } from '../xsection';
import { endsOf, section } from '../roaddraw';
import type { QueueSite, Bench } from '../people/flows';
import type { XZ } from '../people/util';

// A pavement's surface is drawn this far above its road's centreline (roaddraw: pavements at
// +0.15, the carriageway at +0.25), so that's where feet go.
export const PAVE_Y = 0.15;

// One side of a road, one stretch of pavement: its centre line and width, and what fronts it.
export interface FootwaySite {
  id: string; seg: number; side: 1 | -1;
  line: XZ[]; width: number; y: number; length: number;
  residents: number; jobs: number; shops: number; // per 100 m of this side of the road
}
export interface StopSite {
  id: string; seg: number; stop: number; site: QueueSite;
  door: XZ; exit: XZ; // where the bus's front door and its rear doors open at the kerb
  roomy: boolean; // wide enough to queue behind the shelter (otherwise the queue stays short)
  residents: number; jobs: number; // within a few minutes' walk
}
// Both kerbs of one arm of a junction: people wait at either and cross to the other.
// kind: a zebra or pelican crossing along a road (pedx.ts; node -1), where traffic stops `stand` metres
// short of its middle; otherwise the kerbs at a junction's arm
export interface CrossingSite { id: string; node: number; seg: number; mid: XZ; kerbs: [QueueSite, QueueSite]; to: [XZ, XZ]; footfall: string[]; kind?: PedXKind; stand?: number }
export interface ParkSite {
  id: string; kind: 'park' | 'pocket' | 'playground' | 'allotments';
  area: XZ[]; paths: XZ[][]; benches: Bench[]; cells: number;
  pond?: XZ[]; play?: XZ; centre: XZ; width: number;
}
export interface VenueSite { id: string; venue: 'pub' | 'shop'; at: XZ; facing: number; width: number; y: number; lot: number }
export interface SchoolSite { id: string; gate: XZ; yard: XZ[]; approaches: XZ[][]; seed: number }
export interface WorksSite { id: string; path: XZ[]; jobs: number }
export interface Sites { footways: FootwaySite[]; stops: StopSite[]; crossings: CrossingSite[] }
export interface LotSites { parks: ParkSite[]; venues: VenueSite[]; schools: SchoolSite[]; works: WorksSite[] }

const hyp = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
// a lot's local frame (+x along its road, +z towards it) to the world, as buildgen places it
const lotAt = (l: Lot, lx: number, lz: number): XZ => {
  const c = Math.cos(l.rot), s = Math.sin(l.rot);
  return { x: l.x + lx * c - lz * s, z: l.z + lx * s + lz * c };
};

// ---------- roads: footways, stops, crossings ----------
export function roadSites(net: Network, junctions: Map<number, Junction>): Sites {
  const courses = new Map<number, Course>();
  const course = (s: RSeg) => { let C = courses.get(s.id); if (!C) courses.set(s.id, (C = courseOf(net, s))); return C; };
  const footways: FootwaySite[] = [];
  for (const s of net.segs.values()) {
    const d = net.def(s);
    if (d.cls !== 'road' || d.pave <= 0) continue;
    const C = course(s), CL = C.len, ends = endsOf(junctions, s, C);
    // where the road runs on into one with grass verges the footway tapers away (as drawRoads does)
    const fades = (r: number) => C.onward.some((o, e) => o && o.def.pave === 0 && (e ? CL - r : r) < 6.5);
    for (const k of [1, -1] as const) {
      const [e0, e1] = k === 1 ? ends.L : ends.R;
      // stop a little short of the junction's corner: past it the footway curves away round the kerb
      const r0 = e0 + 0.6, r1 = CL - e1 - 0.6;
      if (r1 - r0 < 8) continue;
      const n = Math.ceil((r1 - r0) / 3);
      let run: (XZ & { y: number })[] = [], runW = 0, runKey = NaN, part = 0;
      const flush = () => {
        if (run.length >= 2 && pathLength(run) >= 8) {
          footways.push({ id: `walk:${s.id}:${k}:${part++}`, seg: s.id, side: k, line: run.map((p) => ({ x: p.x, z: p.z })), width: runW, y: run[0].y + PAVE_Y, length: pathLength(run), residents: 0, jobs: 0, shops: 0 });
        }
        run = []; runKey = NaN;
      };
      for (let i = 0; i <= n; i++) {
        const r = r0 + ((r1 - r0) * i) / n, q = pointAt(C.path, r);
        const sd = k === 1 ? section(net, s, C, r).L : section(net, s, C, r).R;
        let mid = (sd.kerb + sd.back) / 2;
        const w = sd.back - sd.kerb;
        // round the inside of a join's curve nothing reaches past the curve's centre
        const lim = C.limit(r);
        if (lim && lim.side === k && mid > lim.r) mid = lim.r;
        const ok = w >= 1.2 && Math.abs(q.y) < 0.3 && !fades(r) && Math.abs(q.x) < net.bound && Math.abs(q.z) < net.bound;
        // a stretch whose width changes by a metre or more (a lay-by cut into the pavement) is its own footway
        const key = Math.round(w);
        if (!ok || (run.length && (key !== runKey || Math.abs(q.y - run[0].y) > 0.05))) flush();
        if (!ok) continue;
        if (!run.length) { runKey = key; runW = w; }
        runW = Math.min(runW, w);
        run.push({ x: q.x + q.uz * mid * k, z: q.z - q.ux * mid * k, y: q.y });
      }
      flush();
    }
  }

  // bus stops: the queue by the shelter that roaddraw draws, the doors where the bus stands
  const stops: StopSite[] = [];
  for (const s of net.segs.values()) for (const st of s.stops) stops.push(stopSite(net, s, st, course(s), footways));

  // crossings: a few metres back from each arm's corner, kerb to kerb, on single carriageways
  const crossings: CrossingSite[] = [];
  for (const j of junctions.values()) {
    const sh = j.shape;
    if (!sh || j.form === 'join' || j.form === 'merge') continue;
    const n = net.node(j.node);
    for (const leg of legsAt(net, j.node)) {
      const d = net.def(leg.seg);
      // (jshape.crossingAt: where roaddraw paints the crossing, so people cross where it's drawn)
      const t = crossingAt(sh, j.form, { id: leg.seg.id, dir: leg.dir, ang: leg.ang, def: d, len: leg.len }, n.y);
      if (t === null) continue;
      // (feet halfway between the pavement and the carriageway, so neither shows them sunk or floating)
      const u = leg.dir, K = kerbOf(d), y = n.y + 0.2;
      // the leg's frame, as jshape.W: `a` out along it, `b` across (+b the side traffic arrives on)
      const W = (a: number, b: number): XZ => ({ x: n.x + u.x * a - u.z * b, z: n.z + u.z * a + u.x * b });
      const across = Math.atan2(u.x, -u.z); // heading of +b
      const kerbSite = (sgn: 1 | -1, id: string): QueueSite => ({
        // (a metre back from the kerb where there's room: a bus turning the corner overhangs it)
        id, kind: 'stop', at: W(t + 1.5, sgn * (K + Math.max(0.55, Math.min(1.1, d.pave - 0.9)))),
        // a short line along the kerb, stepping back from it (see flows.ts queue slots)
        along: sgn === 1 ? Math.atan2(u.z, u.x) : Math.atan2(-u.z, -u.x),
        facing: sgn === 1 ? across + Math.PI : across, y,
      });
      const id = `cross:${j.node}:${leg.seg.id}`;
      const fw = footways.filter((f) => f.seg === leg.seg.id).map((f) => f.id);
      crossings.push({ id, node: j.node, seg: leg.seg.id, mid: W(t, 0), kerbs: [kerbSite(1, `${id}:a`), kerbSite(-1, `${id}:b`)], to: [W(t, -(K + 0.4)), W(t, K + 0.4)], footfall: fw });
    }
  }
  // zebras and pelicans along the roads (pedx.ts: where roaddraw paints them)
  for (const s of net.segs.values()) {
    if (net.def(s).cls !== 'road' || net.def(s).pave <= 0) continue;
    const C = course(s);
    for (const x of pedCrossingsOn(net, s, C, endsOf(junctions, s, C))) {
      const q = pointAt(C.path, x.r), sd = section(net, s, C, x.r), y = (q.y ?? 0) + 0.2;
      // +o: the road's left, a to b
      const W = (a: number, o: number): XZ => ({ x: q.x + q.ux * a + q.uz * o, z: q.z + q.uz * a - q.ux * o });
      const kerbSite = (sgn: 1 | -1, id: string): QueueSite => {
        const K = sgn === 1 ? sd.L.kerb : sd.R.kerb, w = (sgn === 1 ? sd.L.back : sd.R.back) - K;
        return {
          id, kind: 'stop', at: W(0, sgn * (K + Math.max(0.55, Math.min(1.1, w - 0.9)))),
          along: sgn === 1 ? Math.atan2(q.uz, q.ux) : Math.atan2(-q.uz, -q.ux),
          facing: sgn === 1 ? Math.atan2(q.ux, -q.uz) : Math.atan2(-q.ux, q.uz), y,
        };
      };
      const fw = footways.filter((f) => f.seg === s.id).map((f) => f.id);
      crossings.push({
        id: x.id, node: -1, seg: s.id, mid: W(0, 0), kerbs: [kerbSite(1, `${x.id}:a`), kerbSite(-1, `${x.id}:b`)],
        to: [W(0, -(sd.R.kerb + 0.4)), W(0, sd.L.kerb + 0.4)], footfall: fw, kind: x.kind, stand: x.w / 2 + (x.kind === 'zebra' ? 1.5 : 2.5),
      });
    }
  }
  return { footways, stops, crossings };
}

function stopSite(net: Network, s: RSeg, st: Stop, C: Course, footways: FootwaySite[]): StopSite {
  const rs = C.rhoOf(st.s), q = pointAt(C.path, rs), k = st.side;
  const sd = k === 1 ? section(net, s, C, rs).L : section(net, s, C, rs).R;
  // u: the way the bus travels (we drive on the left, so side 1 is served a→b); n: out to its pavement
  const u = { x: q.ux * k, z: q.uz * k }, n = { x: q.uz * k, z: -q.ux * k };
  const W = (a: number, o: number): XZ => ({ x: q.x + u.x * a + n.x * o, z: q.z + u.z * a + n.z * o });
  const kerb = sd.kerb, width = sd.back - sd.kerb, y = q.y + PAVE_Y;
  // The shelter (roaddraw) is 4 m long, from 0.3 m to 1.5 m back from the kerb, with its bench along
  // the back and the flag just ahead of it. On a wide pavement the queue stands behind the shelter;
  // on a narrow one it runs along the kerb in front of it.
  const roomy = width >= 3.6;
  const site: QueueSite = {
    id: `stop:${s.id}:${st.id}`, kind: 'stop',
    at: W(3.4, kerb + (roomy ? 2.3 : 0.5)),
    along: Math.atan2(-u.z, -u.x), facing: Math.atan2(-n.z, -n.x), y,
    shelter: { at: W(0, kerb + 1.2), along: Math.atan2(-u.z, -u.x), seats: 3 },
    double: roomy ? -1 : 1, back: width - (roomy ? 2.3 : 0.5),
    away: footways.filter((f) => f.seg === s.id && f.side === k).map((f) => f.line),
  };
  return { id: site.id, seg: s.id, stop: st.id, site, door: W(4.4, kerb - 0.35), exit: W(-3, kerb - 0.35), roomy, residents: 0, jobs: 0 };
}

// ---------- what fronts each footway, and who lives near each stop ----------
export function frontage(net: Network, sites: Sites) {
  const bySide = new Map<string, FootwaySite[]>();
  for (const f of sites.footways) { const key = `${f.seg}:${f.side}`; const l = bySide.get(key); if (l) l.push(f); else bySide.set(key, [f]); }
  const len = new Map<string, number>();
  for (const [key, l] of bySide) len.set(key, l.reduce((t, f) => t + f.length, 0));
  const tot = new Map<string, { residents: number; jobs: number; shops: number }>();
  for (const f of sites.footways) { f.residents = f.jobs = f.shops = 0; }
  for (const s of sites.stops) { s.residents = s.jobs = 0; }
  const segs = net.segs;
  for (const l of net.lots) {
    const u = USE[l.kind], s = segs.get(l.seg), n = unitsOf(l); // (a shopping complex holds several shops)
    const res = u.unit === 'jobs' ? 0 : u.pop * n, jobs = u.unit === 'residents' ? 0 : u.pop * n;
    if (s) {
      const key = `${s.id}:${net.sideOf(s, l)}`;
      const t = tot.get(key) ?? { residents: 0, jobs: 0, shops: 0 };
      t.residents += res; t.jobs += jobs; if (l.kind === 'shop' || l.arch === 'cornershop') t.shops += n;
      tot.set(key, t);
    }
    // a stop serves everyone within about 300 m (four minutes' walk)
    for (const st of sites.stops) {
      const d = hyp(st.site.at, l);
      if (d < 300) { const w = 1 - d / 400; st.residents += res * w; st.jobs += jobs * w; }
    }
  }
  for (const [key, l] of bySide) {
    const t = tot.get(key), per = 100 / Math.max(20, len.get(key)!);
    if (t) for (const f of l) { f.residents = t.residents * per; f.jobs = t.jobs * per; f.shops = t.shops * per; }
  }
}

// ---------- plots and open space: parks, pubs, shops, schools, works ----------
export function lotSites(net: Network, regions: Region[], footways: FootwaySite[], stops: StopSite[]): LotSites {
  const parks: ParkSite[] = [];
  for (const r of regions) {
    if (r.kind !== 'park' && r.kind !== 'pocket' && r.kind !== 'playground' && r.kind !== 'allotments') continue;
    parks.push(parkSite(r));
  }
  const venues: VenueSite[] = [], schools: SchoolSite[] = [], works: WorksSite[] = [];
  for (const l of net.lots) {
    const seg = net.segs.get(l.seg);
    const face = lotAt(l, 0, l.d / 2), facing = Math.atan2(-Math.cos(l.rot), Math.sin(l.rot));
    if (l.arch === 'pub') venues.push({ id: `pub:${l.id}`, venue: 'pub', at: face, facing, width: l.w - 2, y: l.front < 4 ? PAVE_Y : 0.05, lot: l.id }); // (drinkers stand up to 4 m out: on the pavement where the forecourt is shallower)
    else if (l.kind === 'shop' || l.arch === 'cornershop') venues.push({ id: `shop:${l.id}`, venue: 'shop', at: face, facing, width: Math.max(3, l.w - 1.5), y: l.front < 2.5 ? PAVE_Y : 0.05, lot: l.id });
    else if (l.arch === 'school' && seg) {
      // buildgen: the building in the middle, a tarmac forecourt to the road, the playground behind
      const zf = l.d / 2, X0 = -l.pw / 2, X1 = l.pw / 2;
      const gate = lotAt(l, -l.w / 4, zf + l.front - 0.6);
      const yard = [lotAt(l, X0 + 1.2, -zf - 7.2), lotAt(l, X1 - 1.2, -zf - 7.2), lotAt(l, X1 - 1.2, -zf - 0.8), lotAt(l, X0 + 1.2, -zf - 0.8)];
      const fw = nearestFootway(footways, seg.id, net.sideOf(seg, l), gate);
      const approaches = fw ? [slice(fw.line, fw.at, -70), slice(fw.line, fw.at, 70)].filter((p) => pathLength(p) > 10).map((p) => [...p.reverse(), gate]) : [];
      if (approaches.length) schools.push({ id: `school:${l.id}`, gate, yard, approaches, seed: l.id });
    } else if (l.kind === 'industry' && seg) {
      const gate = lotAt(l, 0, l.d / 2 + l.front - 0.4);
      const fw = nearestFootway(footways, seg.id, net.sideOf(seg, l), gate);
      if (!fw) continue;
      // workers come along the pavement from the nearest stop (one on this side of the road
      // first), or else from the end nearer the middle of town, where the estate is reached from
      const side = net.sideOf(seg, l);
      const far = (s: StopSite) => hyp(s.site.at, gate) + (net.sideOf(seg, s.site.at) === side ? 0 : 50);
      const stop = stops.filter((s) => s.seg === seg.id && hyp(s.site.at, gate) < 200).sort((a, b) => far(a) - far(b))[0];
      const L = pathLength(fw.line);
      const from = stop ? closestOnPath(stop.site.at, fw.line).s : hyp(fw.line[0], { x: 0, z: 0 }) < hyp(fw.line[fw.line.length - 1], { x: 0, z: 0 }) ? 0 : L;
      // at least 40 m of it, so a stop right by the gate still shows people walking up from beyond
      // it; if that would run off the footway, they come the other way
      let dir = Math.sign(from - fw.at) || 1, len = Math.min(140, Math.max(40, Math.abs(from - fw.at)));
      if ((dir > 0 ? L - fw.at : fw.at) < 12) dir = -dir;
      len = Math.min(len, dir > 0 ? L - fw.at : fw.at);
      if (len < 12) continue;
      const span = dir * len;
      works.push({ id: `works:${l.id}`, path: [...slice(fw.line, fw.at, span).reverse(), gate], jobs: USE.industry.pop });
    }
  }
  return { parks, venues, schools, works };
}

// The footway on one side of a road nearest a point, and how far along it that is.
function nearestFootway(footways: FootwaySite[], seg: number, side: 1 | -1, p: XZ) {
  let best: { line: XZ[]; at: number; d: number } | null = null;
  for (const f of footways) {
    if (f.seg !== seg || f.side !== side) continue;
    const c = closestOnPath(p, f.line);
    if (!best || c.d < best.d) best = { line: f.line, at: c.s, d: c.d };
  }
  return best && best.d < 30 ? best : null;
}
// The piece of a line from distance `s` along it, `len` metres on (negative: back towards its start).
function slice(line: XZ[], s: number, len: number): XZ[] {
  const L = pathLength(line), e = Math.max(0, Math.min(L, s + len)), a = Math.min(s, e), b = Math.max(s, e);
  const pts: XZ[] = [pointAt(line, a)];
  let acc = 0;
  for (let i = 1; i < line.length - 1; i++) { acc += hyp(line[i - 1], line[i]); if (acc > a && acc < b) pts.push(line[i]); }
  pts.push(pointAt(line, b));
  const out = pts.map((p) => ({ x: p.x, z: p.z }));
  return len < 0 ? out.reverse() : out;
}

// A park as makeRegion (buildgen) lays it out: a gravel path the long way across through the middle
// cell, benches beside it on every other cell, a pond in a big park, the play equipment in a
// playground. Worked out the same way from the same cells, so people use the path that's drawn.
function parkSite(r: Region): ParkSite {
  const S = CELL, h = S / 2, cells = r.cells;
  const key = (x: number, z: number) => `${Math.round((x / S) * 2)},${Math.round((z / S) * 2)}`;
  const has = new Set(cells.map((c) => key(c.x, c.z)));
  const inR = (x: number, z: number) => has.has(key(x, z));
  const cx = cells.reduce((t, c) => t + c.x, 0) / cells.length, cz = cells.reduce((t, c) => t + c.z, 0) / cells.length;
  const centre = cells.reduce((b, c) => (Math.hypot(c.x - cx, c.z - cz) < Math.hypot(b.x - cx, b.z - cz) ? c : b), cells[0]);
  const block = (n: number) => cells.find((c) => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!inR(c.x + i * S, c.z + j * S)) return false; return true; });
  const out: ParkSite = { id: `park:${r.id}`, kind: r.kind as ParkSite['kind'], area: innerRect(centre, inR, S), paths: [], benches: [], cells: cells.length, centre, width: 0 };
  const b = out.area;
  out.width = Math.min(b[1].x - b[0].x, b[2].z - b[1].z);
  if (r.kind === 'pocket' || r.kind === 'park') {
    // (no pond: a park's water waits for the water system to hold it in a hollow, docs/briefs/play.md)
    // the paths run from the gates on the road edges (parkplan.ts), as they're drawn, with a bench
    // beside the middle of each
    const gates = parkEntrances(r.roadEdges, centre);
    const paths = gates.length ? parkPaths(gates, centre) : oldPath(cells, centre, S);
    for (const path of paths) {
      out.paths.push(path);
      const a = path[0], b = path[path.length - 1], L = hyp(a, b) || 1, nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
      const m = { x: (a.x + b.x) / 2 + nx * 2.2, z: (a.z + b.z) / 2 + nz * 2.2 };
      if (L > 8) out.benches.push({ at: m, facing: Math.atan2(-nz, -nx) });
    }
  } else if (r.kind === 'playground') {
    const p = block(2) ?? centre;
    out.play = { x: p.x + h, z: p.z + h };
    out.benches.push({ at: { x: p.x - h - 1.5, z: p.z + h }, facing: 0 });
  }
  return out;
}
// (a park with no road edge, which is rare: a straight path the long way through its middle)
function oldPath(cells: XZ[], centre: XZ, S: number): XZ[][] {
  const xs = cells.map((c) => c.x), zs = cells.map((c) => c.z), h = S / 2;
  const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs);
  const row = cells.filter((c) => (alongX ? Math.abs(c.z - centre.z) < 0.1 : Math.abs(c.x - centre.x) < 0.1)).sort((p, q) => (alongX ? p.x - q.x : p.z - q.z));
  if (row.length < 2) return [];
  const a = row[0], z = row[row.length - 1];
  return [alongX ? [{ x: a.x - h + 0.5, z: a.z }, { x: z.x + h - 0.5, z: z.z }] : [{ x: a.x, z: a.z - h + 0.5 }, { x: z.x, z: z.z + h - 0.5 }]];
}
// The biggest rectangle of whole cells about the middle one, grown a row or column at a time.
function innerRect(c: XZ, inR: (x: number, z: number) => boolean, S: number): XZ[] {
  let x0 = c.x, x1 = c.x, z0 = c.z, z1 = c.z;
  const rowOk = (z: number) => { for (let x = x0; x <= x1 + 1e-6; x += S) if (!inR(x, z)) return false; return true; };
  const colOk = (x: number) => { for (let z = z0; z <= z1 + 1e-6; z += S) if (!inR(x, z)) return false; return true; };
  for (let grew = true; grew;) {
    grew = false;
    if (colOk(x1 + S)) { x1 += S; grew = true; }
    if (colOk(x0 - S)) { x0 -= S; grew = true; }
    if (rowOk(z1 + S)) { z1 += S; grew = true; }
    if (rowOk(z0 - S)) { z0 -= S; grew = true; }
  }
  const h = S / 2;
  return [{ x: x0 - h, z: z0 - h }, { x: x1 + h, z: z0 - h }, { x: x1 + h, z: z1 + h }, { x: x0 - h, z: z1 + h }];
}

// ---------- starter stops ----------
// A few stops on the starting town's main streets, so the buses call and people queue from the
// first minute (the player adds more with the Stop tool). A lay-by where the pavement can give
// the room, else a kerbside stop; never one that would take anyone's garden.
export function starterStops(net: Network, at: P[] = STARTER_STOPS) {
  for (const p of at) {
    const q = net.nearestSeg(p, 25, (s) => net.def(s).cls === 'road' && net.def(s).family !== 'Motorway');
    if (!q) continue;
    for (const side of [1, -1] as const) {
      const { plans } = net.planStop(q.seg.id, q.s, side);
      const plan = plans.find((pl) => pl.kind === 'layby' && pl.ok && pl.take.land === 0) ?? plans.find((pl) => pl.kind === 'kerb' && pl.ok);
      if (plan) net.addStop(q.seg.id, q.s, side, plan);
    }
  }
  net.touched = [];
}
// the high street either side of the centre, the road north, and the industrial estate
export const STARTER_STOPS: P[] = [{ x: -85, z: 0 }, { x: 120, z: 0 }, { x: 0, z: 150 }, { x: -95, z: -290 }, { x: 75, z: -290 }];
