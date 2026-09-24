// Where each terminal goes. A starter terminal uses the site's own anchors, inside the plot: the
// loading bay where the recipe left its lorry bays, private sidings on its siding line. Bigger
// ones need land beside the plot: road terminals on the frontage next to the bays, rail yards
// behind the works (or off to the side when the back is water), and quays and jetties built out
// into the water behind. Pure geometry in site-local metres (+z towards the road), no three.js.
import { INDUSTRY_TYPES } from '../industries/catalogue';
import type { IndustryModel } from '../industries/models';
import { toWorld, type WXZ } from '../industries/site';
import { TIERS, type Mode, type TierId } from './catalogue';
import { called } from './rules';

export interface Box { x0: number; x1: number; z0: number; z1: number }
export type Side = 'plot' | 'back' | 'left' | 'right';

export interface Placement {
  mode: Mode;
  tier: TierId;
  side: Side;
  pad: Box; // the terminal's ground
  spine: { x0: number; x1: number; z: number }; // its loading line: the bay row, the first track, the quay edge
  grow: 1 | -1; // which way along z further tracks, bays or the apron go from the spine
  tracks: number[]; // z of each track, for rail
  connect: 1 | -1; // the end (along x) where the track leaves for the main line
  over: Box | null; // what stands out over the water beyond the pad (a jetty's trestle and head)
  land: WXZ[] | null; // world polygon it needs outside the plot, or null when it's inside
  water: boolean; // built out into the water rather than on land beside the site
}

export interface LayoutOpts { water?: boolean }
export interface Wanted { mode: Mode; tier: TierId }

export const TRACK_GAP = 4.5; // centre to centre, as the site's own sidings

export function bounds(m: IndustryModel): Box {
  const O = m.frame.outline;
  return { x0: Math.min(...O.map((p) => p[0])), x1: Math.max(...O.map((p) => p[0])), z0: Math.min(...O.map((p) => p[1])), z1: Math.max(...O.map((p) => p[1])) };
}
export const overlaps = (a: Box, b: Box, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap;
export const boxPoly = (b: Box): [number, number][] => [[b.x0, b.z1], [b.x1, b.z1], [b.x1, b.z0], [b.x0, b.z0]];

// The docks have water behind the quay, and so does a waterside-optional site that is on the water.
export const waterBehind = (m: IndustryModel, o: LayoutOpts = {}) => m.type === 'port' || (!!o.water && !!INDUSTRY_TYPES[m.type].waterside);
// The water's edge behind the site: just past the back fence (the docks' own basin runs out to it).
export const waterline = (m: IndustryModel) => bounds(m).z0 - 2;

// Which side the lorries are on: the side of the site's own bays, else the gate's.
function roadSide(m: IndustryModel): 1 | -1 {
  const L = m.anchors.lorry;
  const x = L.length ? L.reduce((s, a) => s + a.x, 0) / L.length : m.anchors.gate.x;
  return x >= 0 ? 1 : -1;
}
// The site's own siding line: the first rail anchor and the ones laid alongside it.
function sidingLine(m: IndustryModel) {
  const R = m.anchors.rail;
  if (!R.length) return null;
  const a = R[0], same = R.filter((r) => Math.abs(r.x0 - a.x0) < 0.5 && Math.abs(r.x1 - a.x1) < 0.5);
  return { x0: a.x0, x1: a.x1, tracks: same.map((r) => r.z).sort((p, q) => p - q) };
}

// Push an annex outwards from the plot until it clears the ones already placed.
function clear(b: Box, side: Side, taken: Box[]): Box {
  let box = { ...b };
  for (let guard = 0; guard < 12; guard++) {
    const hit = taken.find((t) => overlaps(t, box, 1));
    if (!hit) break;
    const dx = side === 'right' ? hit.x1 - box.x0 + 2 : side === 'left' ? -(box.x1 - hit.x0 + 2) : 0;
    const dz = side === 'back' ? -(box.z1 - hit.z0 + 2) : 0;
    box = { x0: box.x0 + dx, x1: box.x1 + dx, z0: box.z0 + dz, z1: box.z1 + dz };
  }
  return box;
}

// A side annex beside the plot, `w` along x and `d` along z, from z0.
function beside(B: Box, side: 1 | -1, w: number, z0: number, d: number): Box {
  return side > 0 ? { x0: B.x1 + 2, x1: B.x1 + 2 + w, z0, z1: z0 + d } : { x0: B.x0 - 2 - w, x1: B.x0 - 2, z0, z1: z0 + d };
}

function placeOne(m: IndustryModel, want: Wanted, o: LayoutOpts, taken: Box[]): Placement {
  const B = bounds(m), T = TIERS[want.tier], rs = roadSide(m);
  const base = { mode: want.mode, tier: want.tier, tracks: [] as number[], connect: 1 as 1 | -1, over: null as Box | null, water: false };
  const finish = (p: Omit<Placement, 'land'>, inPlot: boolean): Placement => ({ ...p, land: inPlot ? null : boxPoly(p.pad).map(([x, z]) => toWorld(m.frame, x, z)) });

  if (want.mode === 'road') {
    if (T.rank === 1) {
      // two bays where the recipe had its own, or just inside the gate
      const L = m.anchors.lorry;
      const cx = L.length ? L.reduce((s, a) => s + a.x, 0) / L.length : m.anchors.gate.x;
      const cz = L.length ? L.reduce((s, a) => s + a.z, 0) / L.length : m.anchors.gate.z - 14;
      const pad = { x0: cx - 5.5, x1: cx + 5.5, z0: cz - 10, z1: cz + 10 };
      return finish({ ...base, side: 'plot', pad, spine: { x0: pad.x0, x1: pad.x1, z: cz }, grow: -1 }, true);
    }
    const fp = T.footprint!;
    const pad = clear(beside(B, rs, fp.w, B.z1 - fp.d, fp.d), rs > 0 ? 'right' : 'left', taken);
    return finish({ ...base, side: rs > 0 ? 'right' : 'left', pad, spine: { x0: pad.x0, x1: pad.x1, z: pad.z0 }, grow: 1 }, false);
  }

  if (want.mode === 'rail') {
    const line = sidingLine(m), wet = waterBehind(m, o);
    if (T.rank === 1 && line) {
      const tracks = line.tracks.slice(0, 2);
      const pad = { x0: line.x0, x1: line.x1, z0: tracks[0] - 2, z1: tracks[tracks.length - 1] + 2 };
      return finish({ ...base, side: 'plot', pad, spine: { x0: line.x0, x1: line.x1, z: tracks[0] }, grow: 1, tracks }, true);
    }
    // no siding space inside (or a bigger yard): land behind the works, or off the far side
    // from the road when the back is water
    const fp = T.footprint ?? { w: Math.max(50, Math.min(90, B.x1 - B.x0 - 10)), d: 12 };
    const n = T.rank === 1 ? 2 : T.rank === 2 ? 3 : 3; // loading roads; a yard's fan is drawn beyond them
    if (wet) {
      const side = -rs as 1 | -1, zStart = (line?.tracks[0] ?? B.z0 + 6) - 3;
      const pad = clear(beside(B, side, fp.w, zStart, fp.d), side > 0 ? 'right' : 'left', taken);
      const tracks = Array.from({ length: n }, (_, i) => pad.z0 + 3 + i * TRACK_GAP);
      return finish({ ...base, side: side > 0 ? 'right' : 'left', pad, spine: { x0: pad.x0, x1: pad.x1, z: tracks[0] }, grow: 1, tracks, connect: side }, false);
    }
    const w = Math.max(fp.w, T.rank === 1 ? 0 : B.x1 - B.x0 + 20);
    const pad = clear({ x0: -w / 2, x1: w / 2, z0: B.z0 - 2 - fp.d, z1: B.z0 - 2 }, 'back', taken);
    const tracks = Array.from({ length: n }, (_, i) => pad.z1 - 3 - i * TRACK_GAP);
    return finish({ ...base, side: 'back', pad, spine: { x0: pad.x0, x1: pad.x1, z: tracks[0] }, grow: -1, tracks, connect: -rs as 1 | -1 }, false);
  }

  // water: reclaimed out from the bank behind the site, the quay edge facing the open water
  const fp = T.footprint!, wl = waterline(m);
  const pad = clear({ x0: -fp.w / 2, x1: fp.w / 2, z0: wl - fp.d, z1: wl }, 'back', taken);
  const over = T.rank === 1 ? { x0: -18, x1: 18, z0: pad.z0 - 46, z1: pad.z0 } : null; // the jetty's trestle and T-head
  return finish({ ...base, side: 'back', pad, spine: { x0: pad.x0, x1: pad.x1, z: pad.z0 }, grow: 1, over, water: true }, false);
}

// Place a site's terminals: water first (it has least choice), then rail, then road.
export function place(m: IndustryModel, wanted: Wanted[], o: LayoutOpts = {}): Placement[] {
  const order: Mode[] = ['water', 'rail', 'road'];
  const taken: Box[] = [], out: Placement[] = [];
  for (const mode of order) for (const w of wanted.filter((x) => x.mode === mode)) {
    const p = placeOne(m, w, o, taken);
    if (p.side !== 'plot') { taken.push(p.pad); if (p.over) taken.push(p.over); }
    out.push(p);
  }
  return out;
}

// A room check for the rules (SiteContext.room): does this tier fit, with the site's other
// terminals where they are, on land the world says is free?
export function roomCheck(m: IndustryModel, current: Wanted[], o: LayoutOpts = {}, landFree?: (poly: WXZ[], mode: Mode) => boolean) {
  return (mode: Mode, tier: TierId): string | null => {
    const wanted = [...current.filter((w) => w.mode !== mode), { mode, tier }];
    const p = place(m, wanted, o).find((x) => x.mode === mode)!;
    if (!p.land || !landFree || landFree(p.land, mode)) return null;
    const { w, d } = { w: Math.round(p.pad.x1 - p.pad.x0), d: Math.round(p.pad.z1 - p.pad.z0) };
    const where = mode === 'road' ? 'beside the site' : mode === 'rail' ? (p.side === 'back' ? 'behind the site' : 'beside the site') : 'along the water';
    return `No room ${where} for ${called(tier)}: it needs ${w} × ${d} m`;
  };
}
