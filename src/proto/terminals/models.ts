// Low-poly terminal models, drawn with the industries kit so they match the sites: one
// vertex-coloured mesh for all of a site's terminals, placed with the same frame as the site, and
// their moving parts (cranes, conveyors, gantry trolleys), floodlights and vehicle berths as plain
// data for IndustryFx. Built from the placements in layout.ts, so each fits the plot it serves.
import * as THREE from 'three';
import { rng } from '../roads';
import { CARGO, INDUSTRY_TYPES, type CargoId, type IndustryId } from '../industries/catalogue';
import { rect } from '../industries/kit';
import type { IndustryModel } from '../industries/models';
import { PAL, Site } from '../industries/site';
import type { Dynamics, Pile } from '../industries/state';
import { CARGO_CLASS, FITS, type CargoClass, type FitId, type Mode, type TierId } from './catalogue';
import { place, TRACK_GAP, type LayoutOpts, type Placement } from './layout';

export interface Shown { mode: Mode; tier: TierId; fit: FitId }
export interface TerminalsModel {
  group: THREE.Group; // static parts: one mesh, placed like the site's group
  dyn: Dynamics; // moving parts, lamps and berths, site-local
  tris: number;
  height: number;
  placements: Placement[];
  parts: (Shown & { tris: number })[];
  detail: string;
}
export interface TerminalBuildOpts extends LayoutOpts { year?: number; seed?: number }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const CANOPY = '#2e7d5b', CRANE_RED = '#c8452f', CRANE_BLUE = '#3f6d93', GRAVEL = '#a8a294', APRON = '#b9b4a8';
// Darker ballast and bright rail heads than the sites' own sidings: from the isometric camera a
// yard is read by its tracks, so they need to stand out from the gravel round them.
const BALLAST = '#6e6962', RAIL = '#b8b2a8';
const CONTAINERS = ['#b0463a', '#2f6f9e', '#d69a2d', '#3f7a4a', '#8a8f94', '#5a3f7a', '#c9c3b6'];

interface Ctx { s: Site; m: IndustryModel; P: Placement; fit: FitId }

// ---------------- what the site moves, and where it keeps it ----------------
function cargoOf(type: IndustryId, cls: CargoClass): { cargo: CargoId; role: 'in' | 'out' } | null {
  const t = INDUSTRY_TYPES[type];
  const o = t.outputs.find((f) => CARGO_CLASS[f.cargo] === cls);
  if (o) return { cargo: o.cargo, role: 'out' };
  const i = t.inputs.find((f) => CARGO_CLASS[f.cargo] === cls);
  return i ? { cargo: i.cargo, role: 'in' } : null;
}
const loadColour = (type: IndustryId, cls: CargoClass) => { const c = cargoOf(type, cls); return c ? CARGO[c.cargo].colour : '#6a6f74'; };
// the site's own stockpile of a class, for a conveyor or a pipe to start from
function pileOf(m: IndustryModel, cls: CargoClass): Pile | undefined {
  const P = m.dyn.piles.filter((p) => CARGO_CLASS[p.cargo] === cls);
  return P.find((p) => p.role === 'out') ?? P[0];
}

// ---------------- parts ----------------
// A track along x: ballast and two rails, with a buffer stop at one end if asked.
function track(s: Site, x0: number, x1: number, z: number, buffer: 0 | 1 | -1 = 0) {
  const k = s.k;
  if (x1 - x0 < 1) return;
  k.flat(rect((x0 + x1) / 2, z, x1 - x0, 3.4), 0.07, BALLAST);
  for (const o of [-0.72, 0.72]) k.beam(x0, z + o, x1, z + o, 0.07, 0.16, 0.14, RAIL);
  if (buffer) k.box(buffer < 0 ? x0 + 0.6 : x1 - 0.6, 0, z, 0.8, 1.1, 2.6, '#b03a2e');
}
// A diagonal between two tracks (a crossover, a ladder): ballast and rails turned to suit.
function trackSeg(s: Site, ax: number, az: number, bx: number, bz: number) {
  const k = s.k, L = Math.hypot(bx - ax, bz - az);
  k.at((ax + bx) / 2, (az + bz) / 2, -Math.atan2(bz - az, bx - ax), () => {
    k.flat(rect(0, 0, L + 1.5, 3.2), 0.075, BALLAST);
    for (const o of [-0.72, 0.72]) k.beam(-L / 2, o, L / 2, o, 0.075, 0.16, 0.14, RAIL);
  });
}
function wagons(s: Site, x0: number, z: number, n: number, dir: 1 | -1) {
  for (let i = 0; i < n; i++) s.dyn.berths.push({ kind: 'wagon', x: x0 + dir * (6 + i * 11), z, rot: 0, len: 10 });
}
// Posts and a flat roof: loading canopies and tanker gantries.
function canopy(s: Site, x0: number, x1: number, z0: number, z1: number, h: number, hex = CANOPY, every = 10) {
  const k = s.k, n = Math.max(1, Math.round((x1 - x0) / every));
  for (let i = 0; i <= n; i++) for (const z of [z0 + 0.4, z1 - 0.4]) k.box(x0 + ((x1 - x0) * i) / n, 0, z, 0.35, h, 0.35, '#5d6166');
  k.box((x0 + x1) / 2, h, (z0 + z1) / 2, x1 - x0 + 1, 0.45, z1 - z0 + 1, hex);
}
function bollards(s: Site, x0: number, x1: number, z: number, every = 10) {
  for (let x = x0 + every / 2; x < x1; x += every) s.k.prism(x, z, 0.3, 6, 0, 0.6, '#2b2b2b');
}
// The face of a quay or apron dropping into the water.
function quayWall(s: Site, x0: number, x1: number, z: number, hex = PAL.stone) {
  s.k.box((x0 + x1) / 2, -1.2, z + 0.5, x1 - x0, 1.35, 1, hex);
  s.k.flat(rect((x0 + x1) / 2, z + 1.2, x1 - x0, 0.3), 0.16, PAL.yellow); // cope edge line
}
// Low fence round a road annex, open along the frontage where the lorries come in.
function yardFence(s: Site, x0: number, x1: number, z0: number, z1: number) {
  for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x0, z0, x0, z1], [x1, z0, x1, z1]]) s.k.beam(ax, az, bx, bz, 0, 1.6, 0.12, PAL.fence);
}
// A ring of dashes painted on a yard: the turning circle.
function ring(s: Site, x: number, z: number, r: number) {
  for (let i = 0; i < 12; i += 1) { const a = (i / 12) * Math.PI * 2; s.k.at(x + Math.cos(a) * r, z + Math.sin(a) * r, -a - Math.PI / 2, () => s.k.flat(rect(0, 0, 1.6, 0.25), 0.09, PAL.line)); }
}
// A hopper on four legs over a loading point, fed by a belt from the site's bulk stockpile.
function hopper(c: Ctx, x: number, z: number, h: number, feedFrom = true) {
  const k = c.s.k;
  for (const [a, b] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]]) k.box(x + a, 0, z + b, 0.4, h, 0.4, '#6c7176');
  k.prism(x, z, 1, 4, h - 1.2, 1.2, '#5a5e62', 2.2);
  k.box(x, h, z, 4, 2.6, 4, '#7f8a93');
  if (feedFrom) feed(c, x, z, h + 2.4);
}
// A belt (or for liquids a pipe on trestles) from the site's own stockpile of the fit's class up
// to (x, z, y). With no such pile, or one too far off to belt, it starts at the edge of the pad
// nearest the site, where the stockyard's own belt would hand over.
function feed(c: Ctx, x: number, z: number, y: number) {
  const cls = c.fit === 'tank_farm' ? 'liquid' : 'bulk';
  const p = pileOf(c.m, cls), b = c.P.pad;
  let sx = p?.x ?? x, sz = p?.z ?? z;
  if (!p || Math.hypot(sx - x, sz - z) > 70) { sx = x; sz = c.P.side === 'back' ? b.z1 - 1 : c.P.side === 'plot' ? z - Math.sign(z || 1) * 12 : b.z0 + 1; }
  if (Math.hypot(sx - x, sz - z) < 4) return;
  if (cls === 'liquid') { c.s.k.beam(sx, sz, x, z, y - 0.6, 0.5, 0.5, PAL.yellow, y - 0.6); for (const t of [0.33, 0.66]) c.s.k.box(sx + (x - sx) * t, 0, sz + (z - sz) * t, 0.3, y - 0.6, 0.3, '#6c7176'); return; }
  c.s.conveyor(sx, sz, 1, x, z, y, loadColour(c.m.type, cls));
}
function tankRow(c: Ctx, x0: number, x1: number, z: number, r: number, h: number, bund = true) {
  const liq = cargoOf(c.m.type, 'liquid') ?? { cargo: 'fuel' as CargoId, role: 'out' as const };
  const n = Math.max(1, Math.floor((x1 - x0) / (r * 2 + 2)));
  if (bund) { c.s.k.beam(x0 - 1, z - r - 1.5, x1 + 1, z - r - 1.5, 0, 1, 0.5, '#8a8f94'); c.s.k.beam(x0 - 1, z + r + 1.5, x1 + 1, z + r + 1.5, 0, 1, 0.5, '#8a8f94'); }
  for (let i = 0; i < n; i++) c.s.tank(x0 + r + 1 + i * ((x1 - x0 - 2 * r - 2) / Math.max(1, n - 1) || 0), z, r, h, liq.cargo, liq.role, '#e3e0d8');
}
// A walkway on posts along a track or a bay row, with drop arms: the loading rack for tankers.
function rack(s: Site, x0: number, x1: number, z: number, h = 4.5) {
  const k = s.k;
  for (let x = x0; x <= x1 + 0.01; x += 6) { k.box(x, 0, z, 0.35, h, 0.35, '#6c7176'); k.box(x, h - 1.6, z - 1.1, 0.2, 0.2, 2.2, PAL.yellow); }
  k.box((x0 + x1) / 2, h, z, x1 - x0 + 1, 0.35, 1.4, '#9aa0a4');
}

// ---------------- road ----------------
function loadingBay(c: Ctx) {
  const { s, P } = c, b = P.pad, cx = (b.x0 + b.x1) / 2, cz = P.spine.z;
  s.bays(cx, cz, 2, 0, 5);
  s.block(b.x1 - 1.9, b.z0 + 1.6, 3, 2.4, 2.6, '#d8d2c4', PAL.roof);
  s.floodlight(b.x0 + 0.6, b.z0 + 1, 8);
  if (c.fit === 'conveyor') hopper(c, cx - 2.5, cz - 1.5, 5.5);
  if (c.fit === 'tank_farm') {
    for (const x of [b.x0 + 2.2, b.x0 + 6.6]) s.tank(x, b.z0 + 2.2, 1.9, 4.5, cargoOf(c.m.type, 'liquid')?.cargo ?? 'fuel', 'out', '#e3e0d8');
    canopy(s, cx - 5, cx + 5, cz - 3.5, cz - 0.5, 4.6, '#d8d6cf', 10);
  }
  s.notes.push(c.fit === 'standard' ? 'two loading bays' : `loading bays with ${FITS[c.fit].name.toLowerCase()}`);
}

function lorryDepot(c: Ctx) {
  const { s, P } = c, k = s.k, b = P.pad, W = b.x1 - b.x0;
  s.pad((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, W, b.z1 - b.z0, PAL.tarmac, 0.055);
  yardFence(s, b.x0, b.x1, b.z0, b.z1);
  const shedW = W - 12, sx = b.x0 + 1 + shedW / 2;
  if (c.fit === 'tank_farm') {
    tankRow(c, b.x0 + 1, b.x0 + 1 + shedW, b.z0 + 6, 3.4, 7);
    canopy(s, sx - shedW / 2 + 1, sx + shedW / 2 - 1, b.z0 + 13, b.z0 + 19, 5.2, '#d8d6cf', 9);
  } else {
    s.shed(sx, b.z0 + 6, shedW, 10, 6, '#8a969e', '#5b636b', 1.6);
    s.doors(sx, b.z0 + 11, 4, shedW * 0.8, 4.2);
    k.box(sx, 0, b.z0 + 12, shedW, 1.2, 2, PAL.concrete); // loading dock
  }
  s.bays(sx, b.z0 + 22, 4, 0, 7);
  if (c.fit === 'conveyor') hopper(c, sx - 10.5, b.z0 + 20.5, 5.5);
  s.block(b.x1 - 5, b.z0 + 5, 7, 7, 3.2, '#d8d2c4', PAL.roof, 1);
  ring(s, (b.x0 + b.x1) / 2, b.z1 - 6.5, 5.5);
  k.box(b.x1 - 4, 0, b.z1 - 15, 1.2, 1.6, 3, CRANE_RED); // fuel pump
  s.floodlight(b.x0 + 1, b.z1 - 3, 10); s.floodlight(b.x1 - 1, b.z0 + 14, 10);
  s.notes.push(`lorry depot with ${c.fit === 'standard' ? 'four bays at a dock' : FITS[c.fit].name.toLowerCase()}`);
}

function roadTerminal(c: Ctx) {
  const { s, P } = c, k = s.k, b = P.pad, W = b.x1 - b.x0, D = b.z1 - b.z0;
  s.pad((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, W, D, PAL.tarmac, 0.055);
  yardFence(s, b.x0, b.x1, b.z0, b.z1);
  const shedW = 48, sx = b.x0 + 2 + shedW / 2;
  if (c.fit === 'tank_farm') tankRow(c, b.x0 + 2, b.x0 + 2 + shedW, b.z0 + 7, 4.5, 9);
  else {
    // the cross-dock shed: goods come off one lorry and straight onto another
    s.block(sx, b.z0 + 8, shedW, 12, 8, '#c9cdd0', '#8a969e');
    k.box(sx, 6.6, b.z0 + 8, shedW + 0.2, 1.2, 12.2, CANOPY);
    s.doors(sx, b.z0 + 14, 8, shedW - 4, 4.2);
    k.box(sx, 0, b.z0 + 15, shedW, 1.2, 2, PAL.concrete);
  }
  canopy(s, sx - shedW / 2, sx + shedW / 2, b.z0 + 15, b.z0 + 22, 6, c.fit === 'tank_farm' ? '#d8d6cf' : CANOPY, 12);
  s.bays(sx, b.z0 + 25, 8, 0, 5.8);
  if (c.fit === 'conveyor') { hopper(c, sx - 20.3, b.z0 + 23.5, 6.5); hopper(c, sx - 14.5, b.z0 + 23.5, 6.5, false); }
  // lorry park down the far side: HGVs wait here rather than on the road
  const px = b.x0 + 2 + shedW + 2, pw = b.x1 - 2 - px;
  s.pad(px + pw / 2, b.z0 + (D - 12) / 2 + 1, pw, D - 12, '#4f5257', 0.06);
  for (let i = 0; i < 7; i++) {
    const z = b.z0 + 4 + i * 5.6;
    k.flat(rect(px + pw / 2, z - 2.8, pw - 1, 0.15), 0.08, PAL.line);
    if (i < 6) s.dyn.berths.push({ kind: 'lorry', x: px + pw / 2 - 1, z, rot: Math.PI / 2, len: 12 });
  }
  // gatehouse, barrier and weighbridge where the traffic comes in
  s.block(b.x0 + 5, b.z1 - 5, 4, 3, 3, '#d8d2c4', PAL.roof);
  k.beam(b.x0 + 7.5, b.z1 - 3, b.x0 + 15, b.z1 - 3, 1, 0.16, 0.16, CRANE_RED);
  s.pad(b.x0 + 12, b.z1 - 11, 4, 14, '#34373c', 0.075);
  for (const [x, z] of [[b.x0 + 1, b.z0 + 20], [b.x1 - 1, b.z0 + 2], [b.x1 - 1, b.z1 - 14]]) s.floodlight(x, z, 14);
  s.notes.push('road freight terminal', 'cross-dock shed', 'lorry park', 'weighbridge');
}

// ---------------- rail ----------------
// The site's own sidings (inside the plot at its siding line), or two in a strip behind it.
function sidings(c: Ctx) {
  const { s, P } = c, b = P.pad;
  const inPlot = P.side === 'plot';
  if (!inPlot) s.pad((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.z1 - b.z0, GRAVEL, 0.05);
  const x0 = inPlot ? P.spine.x0 : b.x0 + 3, x1 = inPlot ? P.spine.x1 : b.x1 - 3, conn = P.connect;
  for (const z of P.tracks) track(s, x0, x1, z, conn > 0 ? -1 : 1);
  const farEnd = conn > 0 ? x0 : x1, dir = (conn > 0 ? 1 : -1) as 1 | -1;
  wagons(s, farEnd, P.tracks[0], Math.min(3, Math.floor((x1 - x0 - 14) / 11)), dir);
  const outer = P.tracks[P.tracks.length - 1] + 3.4 * (inPlot ? 1 : P.grow);
  s.block(conn > 0 ? x1 - 4 : x0 + 4, outer, 2.6, 2, 2.4, PAL.brick, PAL.roof); // ground frame hut
  s.floodlight(conn > 0 ? x1 - 9 : x0 + 9, outer, 9);
  const kx = (x0 + x1) / 2 + dir * 6;
  if (c.fit === 'conveyor') {
    // a loading bunker straddling the first track
    const k = s.k, z = P.tracks[0];
    for (const [a, bb] of [[-2.4, -2.4], [2.4, -2.4], [2.4, 2.4], [-2.4, 2.4]]) k.box(kx + a, 0, z + bb, 0.5, 6, 0.5, '#6c7176');
    k.box(kx, 6, z, 6, 4.5, 5.6, '#5a5e62');
    feed(c, kx, z, 10.5);
  }
  if (c.fit === 'tank_farm') { rack(s, kx - 9, kx + 9, P.tracks[0] + 2.4 * (inPlot ? -1 : -P.grow)); feed(c, kx, P.tracks[0] + 2.4 * (inPlot ? -1 : -P.grow), 5); }
  s.notes.push(P.tracks.length > 1 ? `${P.tracks.length} private sidings` : 'private siding');
}

// Along the yard from the end that meets the main line.
const alongFrom = (P: Placement) => (u: number) => (P.connect > 0 ? P.pad.x1 - u : P.pad.x0 + u);

// Three roads on a loop: two to load on, one to run round. The fit's kit stands in the strip
// beyond them. `P` may be the inner part of a marshalling yard.
function railTerminal(c: Ctx, withSidings = true) {
  const { s, P } = c, k = s.k, b = P.pad, L = b.x1 - b.x0, at = alongFrom(P), T = P.tracks;
  s.pad((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, L, b.z1 - b.z0, GRAVEL, 0.05);
  const lo = (u0: number, u1: number) => [Math.min(at(u0), at(u1)), Math.max(at(u0), at(u1))] as const;
  const [a0, a1] = lo(24, L - 26), [l0, l1] = lo(2, L - 3);
  track(s, a0, a1, T[0], P.connect > 0 ? -1 : 1);
  track(s, a0, a1, T[1], P.connect > 0 ? -1 : 1);
  track(s, l0, l1, T[2]);
  // crossovers from the loop into each loading road, and back at the far end
  trackSeg(s, at(8), T[2], at(16), T[1]); trackSeg(s, at(17), T[1], at(24), T[0]);
  trackSeg(s, at(L - 4), T[2], at(L - 12), T[1]);
  const dir = (P.connect > 0 ? -1 : 1) as 1 | -1, far = at(L - 26);
  wagons(s, far, T[0], 5, (-dir) as 1 | -1); wagons(s, far, T[1], 4, (-dir) as 1 | -1);
  // the strip beyond the loop, away from the site
  const sz = T[2] + P.grow * 6.5, kx = at(L * 0.5);
  if (c.fit === 'gantry') {
    // an overhead crane on a runway over both loading roads, the trolley travelling along it
    const z0 = T[0] - P.grow * 2.8, z1 = T[1] + P.grow * 2.8, h = 11, len = 44;
    for (const x of [kx - len / 2, kx, kx + len / 2]) for (const z of [z0, z1]) k.box(x, 0, z, 0.8, h, 0.8, PAL.yellow);
    for (const z of [z0, z1]) k.beam(kx - len / 2 - 1, z, kx + len / 2 + 1, z, h, 1, 0.9, PAL.yellow);
    s.dyn.movers.push({ kind: 'gantry', x: kx - len / 2, y: h - 0.2, z: (T[0] + T[1]) / 2, rot: 0, len, colour: '#3a3a3a', load: loadColour(c.m.type, 'general'), phase: s.r() });
    const g = cargoOf(c.m.type, 'general');
    if (g) s.stack(kx, sz, 34, 6, g.cargo, g.role, 7, 3, 1.1);
    s.notes.push('loading gantry');
  } else if (c.fit === 'rapid_loader') {
    // a silo on a portal over the first road, fed by a belt, and a hopper house over the second
    // that empties wagons as they creep through. A site that only takes bulk in (a power station)
    // has hopper houses on both roads and a belt to its stockyard instead of the silo.
    const hopperHouse = (x: number, z: number) => {
      for (const a of [-3, 3]) for (const bb of [-2.4, 2.4]) k.box(x + a, 0, z + bb, 0.5, 5, 0.5, '#6c7176');
      k.box(x, 5, z, 8, 2.6, 6, '#7f8a93');
    };
    if (cargoOf(c.m.type, 'bulk')?.role === 'out') {
      const z = T[0], h0 = 7;
      for (const [a, bb] of [[-3.8, -2.6], [3.8, -2.6], [3.8, 2.6], [-3.8, 2.6]]) k.box(kx + a, 0, z + bb, 0.7, h0, 0.7, '#8a8f94');
      k.box(kx, h0 - 1, z, 8.4, 1.2, 6.4, '#6c7176');
      k.lathe(kx, z, [[4.6, h0], [4.6, h0 + 15]], 12, '#d6d8d8', '#403d3a');
      k.prism(kx, z, 4.8, 12, h0 + 15, 3, '#9aa0a4', 0);
      feed(c, kx, z + P.grow * 1, h0 + 16);
      hopperHouse(kx + dir * -22, T[1]);
      s.notes.push('rapid loader silo', 'hopper house');
    } else {
      hopperHouse(kx, T[0]); hopperHouse(kx, T[1]);
      feed(c, kx, T[1] + P.grow * 3, 7);
      s.notes.push('hopper houses');
    }
  } else if (c.fit === 'tank_farm') {
    tankRow(c, kx - 30, kx + 30, sz, 3.4, 8);
    rack(s, kx - 18, kx + 18, T[0] - P.grow * 2.4);
    k.beam(kx - 10, sz, kx - 10, T[0] - P.grow * 2.4, 3.5, 0.5, 0.5, PAL.yellow);
    s.notes.push('tank farm', 'loading rack');
  } else {
    s.shed(kx - 12, sz, 26, 7, 5, PAL.brick, PAL.roof, 1.6);
    s.jibCrane(kx + 12, sz, 9, 11, '#2e2e2e');
    s.notes.push('goods shed', 'yard crane');
  }
  s.block(at(8), sz, 6, 5, 3.2, '#d8d2c4', PAL.roof, 1);
  for (const u of [L * 0.2, L * 0.55, L * 0.85]) s.floodlight(at(u), sz + P.grow * 2, 12);
  // the sidings inside the plot stay in use as part of the terminal
  if (withSidings && P.side === 'back') {
    const line = c.m.anchors.rail.filter((r) => Math.abs(r.x0 - c.m.anchors.rail[0]?.x0) < 0.5);
    for (const r of line.slice(0, 2)) track(s, r.x0, r.x1, r.z, -1);
  }
  s.notes.push('rail freight terminal');
}

function marshallingYard(c: Ctx) {
  const { s, P } = c, k = s.k, b = P.pad, L = b.x1 - b.x0, at = alongFrom(P);
  // the loading roads nearest the site are a rail freight terminal; the fan lies beyond them
  const innerD = 24, inner: Placement = { ...P, pad: P.grow < 0 ? { ...b, z0: b.z1 - innerD } : { ...b, z1: b.z0 + innerD } };
  railTerminal({ ...c, P: inner });
  // arrival and departure line along the far edge; the fan comes back from it towards the site
  const far = P.grow < 0 ? b.z0 : b.z1, back = -P.grow, zA = far + back * 3;
  s.pad((b.x0 + b.x1) / 2, (far + (P.grow < 0 ? b.z1 - innerD : b.z0 + innerD)) / 2, L, b.z1 - b.z0 - innerD, '#a39c90', 0.052);
  track(s, b.x0 + 2, b.x1 - 2, zA);
  const n = 6, dz = back * TRACK_GAP, u0 = 30, du = 9;
  const fanEnd = at(L - 8), dir = P.connect > 0 ? -1 : 1;
  for (let i = 1; i <= n; i++) {
    const z = zA + dz * i, u = u0 + i * du, x = at(u);
    const [x0, x1] = [Math.min(x, fanEnd), Math.max(x, fanEnd)];
    track(s, x0, x1, z, P.connect > 0 ? -1 : 1);
    if (i <= 3) wagons(s, fanEnd, z, 6, (-dir) as 1 | -1);
  }
  trackSeg(s, at(u0), zA, at(u0 + n * du), zA + dz * n); // the ladder
  // control tower in the triangle the ladder leaves, a signal gantry over the fan, high masts
  const tx = at(12), tz = zA + dz * 4;
  s.k.box(tx, 0, tz, 5, 12, 5, PAL.brick);
  s.k.box(tx, 12, tz, 6.4, 3, 6.4, PAL.glass);
  s.k.box(tx, 15, tz, 7, 0.5, 7, PAL.roof);
  const gx = at(u0 + n * du + 14), gz0 = zA - back * 2.5, gz1 = zA + dz * n + back * 2.5;
  for (const z of [gz0, gz1]) k.box(gx, 0, z, 0.5, 7, 0.5, '#5d6166');
  k.beam(gx, gz0, gx, gz1, 7, 0.6, 0.6, '#5d6166');
  for (const u of [L * 0.3, L * 0.6, L * 0.9]) s.floodlight(at(u), far + back * 1.2, 22);
  s.notes.push('marshalling yard', `${n}-road fan`, 'control tower');
}

// ---------------- water ----------------
function apron(c: Ctx, hex = APRON) {
  const { s, P } = c, b = P.pad;
  s.pad((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.z1 - b.z0, hex, 0.08);
  quayWall(s, b.x0, b.x1, b.z0);
  bollards(s, b.x0, b.x1, b.z0 + 1.6, 12);
}

function jetty(c: Ctx) {
  const { s, P } = c, k = s.k, b = P.pad, cx = (b.x0 + b.x1) / 2;
  apron(c);
  const zh = b.z0 - 32; // inner edge of the T-head
  k.box(cx, 1.2, (b.z0 + zh) / 2, 4.5, 0.35, b.z0 - zh, PAL.timber); // trestle
  for (let z = b.z0 - 4; z > zh; z -= 6) for (const a of [-2, 2]) k.box(cx + a, 0, z, 0.35, 1.25, 0.35, '#5a4636');
  k.box(cx, 1.2, zh - 3, 36, 0.4, 6, PAL.timber); // head
  for (const x of [-17, -9, 0, 9, 17]) for (const z of [zh - 0.6, zh - 5.4]) k.box(cx + x, 0, z, 0.4, 1.25, 0.4, '#5a4636');
  for (let x = -15; x <= 15; x += 10) k.prism(cx + x, zh - 5.4, 0.25, 6, 1.6, 0.5, '#2b2b2b');
  s.block(b.x0 + 5, b.z1 - 4, 5, 4, 3, '#d8d2c4', PAL.roof);
  if (c.fit === 'conveyor') {
    s.conveyor(cx + 3, b.z1 - 3, 1, cx + 3, zh - 2, 8, loadColour(c.m.type, 'bulk'));
    k.box(cx + 3, 1.6, zh - 3, 3, 7, 3, '#6a6f74');
    k.beam(cx + 3, zh - 3, cx + 3, zh - 11, 8, 1, 1.2, '#6a6f74', 7);
    s.notes.push('conveyor and shiploader');
  } else if (c.fit === 'tank_farm') {
    k.beam(cx - 1.5, b.z1 - 2, cx - 1.5, zh - 2, 1.8, 0.45, 0.45, PAL.yellow);
    for (const x of [-6, 6]) { k.box(cx + x, 1.6, zh - 3, 0.5, 4.5, 0.5, '#6c7176'); k.beam(cx + x, zh - 3, cx + x, zh - 6.5, 5.6, 0.3, 0.3, PAL.yellow, 3.5); }
    const liq = cargoOf(c.m.type, 'liquid');
    for (const x of [b.x1 - 6, b.x1 - 15]) s.tank(x, b.z1 - 5.5, 3.2, 5.5, liq?.cargo ?? 'oil', liq?.role ?? 'out', '#e3e0d8');
    s.notes.push('oil jetty');
  } else s.jibCrane(cx + 10, zh - 3, 7, 9, '#2e2e2e');
  s.floodlight(b.x1 - 1, b.z1 - 1, 9);
  s.dyn.berths.push({ kind: 'ship', x: cx, z: zh - 13.5, rot: 0, len: 40 });
  s.notes.push('jetty');
}

function quay(c: Ctx) {
  const { s, P } = c, k = s.k, b = P.pad, cx = (b.x0 + b.x1) / 2, W = b.x1 - b.x0;
  apron(c);
  const edge = b.z0 + 4.5;
  if (c.fit === 'grab_cranes') {
    for (const x of [cx - W * 0.3, cx, cx + W * 0.3]) s.jibCrane(x, edge, 17, 20, CRANE_BLUE, true);
    const bulk = cargoOf(c.m.type, 'bulk') ?? { cargo: 'coal' as CargoId, role: 'out' as const };
    s.heap(cx - W * 0.15, b.z1 - 8, W * 0.55, 9, 6, bulk.cargo, bulk.role, false);
    s.conveyor(cx + W * 0.15, b.z1 - 8, 1, cx + W * 0.15, edge + 1, 9, CARGO[bulk.cargo].colour);
    s.notes.push('grab cranes', 'stockyard');
  } else if (c.fit === 'tank_farm') {
    tankRow(c, cx - W * 0.45, cx + W * 0.2, b.z1 - 9, 5, 9);
    for (const x of [cx + W * 0.28, cx + W * 0.38]) { k.box(x, 0, edge - 1, 0.6, 6, 0.6, '#6c7176'); k.beam(x, edge - 1, x, edge - 5, 6.4, 0.35, 0.35, PAL.yellow, 3); }
    k.beam(cx + W * 0.2, b.z1 - 9, cx + W * 0.33, edge - 1, 3, 0.5, 0.5, PAL.yellow);
    s.notes.push('tank farm', 'loading arms');
  } else {
    s.shed(cx - W * 0.2, b.z1 - 8, W * 0.4, 11, 7, PAL.brick, PAL.roof, 2.4);
    s.doors(cx - W * 0.2, b.z1 - 2.5, 4, W * 0.34);
    for (const x of [cx + W * 0.12, cx + W * 0.36]) s.jibCrane(x, edge, 15, 17, '#2e2e2e', true);
    if (c.fit === 'conveyor') {
      k.box(cx - W * 0.38, 0, edge, 4, 12, 4, '#6a6f74');
      k.beam(cx - W * 0.38, edge, cx - W * 0.38, b.z0 - 12, 12, 1.2, 1.4, '#6a6f74', 11);
      s.conveyor(cx - W * 0.38, b.z1 - 2, 1, cx - W * 0.38, edge + 2, 12, loadColour(c.m.type, 'bulk'));
      s.notes.push('shiploader');
    }
    s.notes.push('transit shed', 'portal cranes');
  }
  for (const x of [b.x0 + 2, cx, b.x1 - 2]) s.floodlight(x, b.z1 - 1.5, 14);
  for (const x of [cx - W * 0.25, cx + W * 0.25]) s.dyn.berths.push({ kind: 'ship', x, z: b.z0 - 8.5, rot: 0, len: Math.min(55, W * 0.45) });
  s.notes.push('quay');
}

function portTerminal(c: Ctx) {
  const { s, P } = c, k = s.k, b = P.pad, cx = (b.x0 + b.x1) / 2, W = b.x1 - b.x0;
  apron(c, c.fit === 'container_cranes' ? '#9d998f' : APRON);
  const xs = [cx - W * 0.3, cx, cx + W * 0.3];
  if (c.fit === 'container_cranes') {
    for (const x of xs) s.gantry(x, b.z0 + 10, 28, 16, 22, CRANE_RED, CONTAINERS[1]);
    const g = cargoOf(c.m.type, 'general') ?? { cargo: 'goods' as CargoId, role: 'out' as const };
    for (let i = 0; i < 6; i++) s.stack(cx - W * 0.33 + (i % 3) * W * 0.33, b.z1 - 9 - Math.floor(i / 3) * 11, W * 0.26, 7, g.cargo, g.role, 8, 4, 2.6, CONTAINERS);
    for (const x of [cx - W * 0.16, cx + W * 0.16]) { for (const [a, bb] of [[-1.6, -3], [1.6, -3], [1.6, 3], [-1.6, 3]]) k.box(x + a, 0, b.z0 + 24 + bb, 0.4, 9, 0.4, '#d69a2d'); k.box(x, 9, b.z0 + 24, 3.6, 1, 6.4, '#d69a2d'); }
    s.notes.push('three ship-to-shore cranes', 'container stack', 'straddle carriers');
  } else if (c.fit === 'grab_cranes') {
    for (const x of xs) s.jibCrane(x, b.z0 + 5, 20, 24, CRANE_BLUE, true);
    const bulk = cargoOf(c.m.type, 'bulk') ?? { cargo: 'coal' as CargoId, role: 'out' as const };
    for (const x of [cx - W * 0.22, cx + W * 0.22]) s.heap(x, b.z1 - 13, W * 0.38, 14, 9, bulk.cargo, bulk.role, false);
    k.beam(cx - W * 0.42, b.z1 - 13, cx + W * 0.42, b.z1 - 13, 0.07, 0.3, 2, PAL.rail); // the stacker's rails
    k.box(cx, 0.4, b.z1 - 13, 4, 6, 4, '#c9b24a'); // stacker-reclaimer
    k.beam(cx, b.z1 - 13, cx - 18, b.z1 - 15, 7, 1, 1.2, '#c9b24a', 3);
    s.conveyor(cx + 8, b.z1 - 22, 1, cx + 8, b.z0 + 6, 12, CARGO[bulk.cargo].colour);
    s.notes.push('grab cranes', 'stockyard', 'stacker-reclaimer');
  } else if (c.fit === 'tank_farm') {
    for (const z of [b.z1 - 9, b.z1 - 25]) tankRow(c, cx - W * 0.42, cx + W * 0.1, z, 6.5, 12);
    k.beam(cx + W * 0.12, b.z1 - 17, cx + W * 0.12, b.z0 + 4, 3, 0.8, 1.6, '#8a6f55'); // pipe rack
    for (const x of [cx + W * 0.2, cx + W * 0.3, cx + W * 0.4]) { k.box(x, 0, b.z0 + 3, 0.6, 7, 0.6, '#6c7176'); k.beam(x, b.z0 + 3, x, b.z0 - 2, 7.4, 0.35, 0.35, PAL.yellow, 4); }
    s.notes.push('oil terminal', 'tank farm');
  } else {
    for (const x of xs) s.jibCrane(x, b.z0 + 5, 17, 20, '#2e2e2e', true);
    for (const x of [cx - W * 0.2, cx + W * 0.2]) s.shed(x, b.z1 - 12, W * 0.32, 16, 9, '#8a969e', PAL.roof, 2);
    s.notes.push('deep-water berths', 'transit sheds');
  }
  for (const x of [b.x0 + 3, cx - W * 0.15, cx + W * 0.15, b.x1 - 3]) s.floodlight(x, b.z1 - 2, 20);
  for (const x of xs) s.dyn.berths.push({ kind: 'ship', x, z: b.z0 - 9, rot: 0, len: Math.min(60, W * 0.3) });
  s.notes.push(c.fit === 'container_cranes' ? 'container terminal' : c.fit === 'grab_cranes' ? 'bulk terminal' : 'port terminal');
}

const DRAW: Record<TierId, (c: Ctx) => void> = {
  loading_bay: loadingBay, lorry_depot: lorryDepot, road_terminal: roadTerminal,
  sidings, rail_terminal: (c) => railTerminal(c), marshalling_yard: marshallingYard,
  jetty, quay, port_terminal: portTerminal,
};

// Build every terminal of a site into one mesh. `shown` is what to draw for each mode: the tier
// being built when there's an upgrade under way (see shownFor). The same site, terminals, seed
// and year always give the same triangles.
export function buildTerminals(m: IndustryModel, shown: Shown[], opts: TerminalBuildOpts = {}): TerminalsModel {
  const seed = opts.seed ?? (m.group.userData.industry?.seed as number | undefined) ?? 1;
  const list = shown.filter((t) => !(t.mode === 'water' && t.tier === 'quay' && m.type === 'port')); // the docks draw their own quay
  const placements = place(m, list, opts);
  const s = new Site(m.frame, rng(hash(`${m.type}|${seed}|${list.map((t) => `${t.mode}:${t.tier}:${t.fit}`).join(',')}`)), opts.year ?? 1960);
  const parts: TerminalsModel['parts'] = [];
  for (const P of placements) {
    const t = list.find((x) => x.mode === P.mode)!;
    const before = s.k.tris;
    DRAW[P.tier]({ s, m, P, fit: t.fit });
    parts.push({ ...t, tris: s.k.tris - before });
  }
  const group = s.k.build();
  group.position.set(m.frame.cx, 0, m.frame.cz);
  group.rotation.y = -m.frame.rot;
  group.userData.terminals = { type: m.type, shown: list };
  return { group, dyn: s.dyn, tris: s.k.tris, height: s.k.top, placements, parts, detail: [...new Set(s.notes)].join(' · ') };
}

// A stand-in so IndustryFx can draw a site's terminals' moving parts from the same frame.
export const fxModel = (m: IndustryModel, t: TerminalsModel): IndustryModel => ({ ...m, dyn: t.dyn });
