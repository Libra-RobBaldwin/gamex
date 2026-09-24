// Supply-area overlays as plain data for the UI to draw: the catchment ring round a site, its
// need and output icons with how full each stockyard is, and which stations fall inside.
// Nothing here touches three.js, so a 2D map, a minimap or the 3D view can all draw it.
import { CARGO, INDUSTRY_TYPES, TOWN_ACCEPTS, type CargoId, type IndustryId, type ServeKind } from './catalogue';
import type { IndustryModel } from './models';
import { toWorld, type SiteFrame, type WXZ } from './site';
import type { IndustryVisualState } from './state';

export interface OverlayIcon {
  cargo: CargoId;
  role: 'in' | 'out';
  glyph: string;
  colour: string;
  label: string;
  at: WXZ; // world position to pin the icon, along the site's frontage
  level: number; // 0..1 stock fill, for a small gauge under the icon
  optional?: boolean; // an input that helps but isn't needed (limestone at a steelworks)
  starved?: boolean; // an input that's run out, so the UI can make it pulse
}

export interface CatchmentOverlay {
  type: IndustryId;
  site: WXZ[]; // the plot outline
  ring: WXZ[]; // the catchment boundary: stations inside it can serve the site
  radius: number;
  colour: string; // the first output's colour, or the first input's for sinks
  serve: ServeKind[];
  icons: OverlayIcon[];
}

function hull(pts: WXZ[]) {
  const P = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: WXZ, a: WXZ, b: WXZ) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo: WXZ[] = [], hi: WXZ[] = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...P].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)]; // anticlockwise in (x, z)
}

// The outline grown outwards by r: straight sides offset along their normals, joined by arcs
// round each corner. It uses the convex hull, so a notched plot gets a slightly generous ring.
export function offsetRing(poly: WXZ[], r: number, stepDeg = 15): WXZ[] {
  const H = hull(poly), n = H.length, out: WXZ[] = [];
  if (n < 3) return H;
  const normal = (a: WXZ, b: WXZ) => { const L = Math.hypot(b.x - a.x, b.z - a.z) || 1; return Math.atan2(-(b.x - a.x) / L, (b.z - a.z) / L); };
  for (let i = 0; i < n; i++) {
    const prev = H[(i + n - 1) % n], p = H[i], next = H[(i + 1) % n];
    let a0 = normal(prev, p), a1 = normal(p, next);
    while (a1 < a0) a1 += Math.PI * 2;
    const steps = Math.max(1, Math.ceil((a1 - a0) / ((stepDeg * Math.PI) / 180)));
    for (let k = 0; k <= steps; k++) { const a = a0 + ((a1 - a0) * k) / steps; out.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }); }
  }
  return out;
}

function pointIn(p: WXZ, poly: WXZ[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function distToPoly(p: WXZ, poly: WXZ[]) {
  if (pointIn(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
  }
  return best;
}

// Can a station at p (with its own catchment radius) serve the site? The two radii add, as in the
// 2D game, where a station's catchment only had to touch an industry's tiles.
export function serves(ov: CatchmentOverlay, p: WXZ, stationRadius = 0, kind?: ServeKind) {
  if (kind && !ov.serve.includes(kind)) return false;
  return distToPoly(p, ov.site) <= ov.radius + stationRadius;
}

export function catchmentOverlay(type: IndustryId, frame: SiteFrame, site: WXZ[], state?: IndustryVisualState): CatchmentOverlay {
  const t = INDUSTRY_TYPES[type];
  const icons: OverlayIcon[] = [];
  const ins = t.inputs, outs = t.role === 'hub' ? [] : t.outputs; // a hub's outputs are its inputs; show them once
  const all = [...ins.map((f) => ({ f, role: 'in' as const })), ...outs.map((f) => ({ f, role: 'out' as const }))];
  // pin icons in a row just in front of the frontage: needs on the left, products on the right
  const gap = Math.min(10, (frame.w * 0.8) / Math.max(1, all.length));
  all.forEach(({ f, role }, i) => {
    const lx = (i - (all.length - 1) / 2) * gap;
    const per = role === 'in' ? state?.inputs?.[f.cargo] : state?.outputs?.[f.cargo];
    const level = Math.max(0, Math.min(1, per ?? (role === 'in' ? state?.input ?? 0 : state?.output ?? 0)));
    const c = CARGO[f.cargo];
    icons.push({
      cargo: f.cargo, role, glyph: c.glyph, colour: c.colour, level, optional: f.optional,
      label: `${role === 'in' ? 'Needs' : 'Makes'} ${c.name.toLowerCase()}${f.optional ? ' (optional)' : ''}`,
      at: toWorld(frame, lx, frame.d / 2 + 6),
      starved: role === 'in' && !f.optional && !!state && level < 0.05,
    });
  });
  const lead = (t.outputs[0] ?? t.inputs[0]).cargo;
  return { type, site, ring: offsetRing(site, t.catchment), radius: t.catchment, colour: CARGO[lead].colour, serve: t.serve, icons };
}

export const overlayFor = (m: IndustryModel, state?: IndustryVisualState) => catchmentOverlay(m.type, m.frame, m.frame.outline.map(([x, z]) => toWorld(m.frame, x, z)), state);

// ---------------- chain helpers for route planning ----------------
// What one industry can send another directly.
export function linkCargo(from: IndustryId, to: IndustryId): CargoId[] {
  const outs = INDUSTRY_TYPES[from].outputs.map((f) => f.cargo);
  return outs.filter((c) => INDUSTRY_TYPES[to].inputs.some((f) => f.cargo === c));
}

// Everything downstream of an industry, as edges, ending at towns: the chain a player is building.
export function chainFrom(id: IndustryId): { from: IndustryId; to: IndustryId | 'town'; cargo: CargoId }[] {
  const out: { from: IndustryId; to: IndustryId | 'town'; cargo: CargoId }[] = [];
  const seen = new Set<IndustryId>();
  const walk = (a: IndustryId) => {
    if (seen.has(a)) return;
    seen.add(a);
    for (const f of INDUSTRY_TYPES[a].outputs) {
      for (const b of Object.keys(INDUSTRY_TYPES) as IndustryId[]) {
        if (b === a || !INDUSTRY_TYPES[b].inputs.some((g) => g.cargo === f.cargo)) continue;
        out.push({ from: a, to: b, cargo: f.cargo });
        walk(b);
      }
      if (TOWN_ACCEPTS.includes(f.cargo)) out.push({ from: a, to: 'town', cargo: f.cargo });
    }
  };
  walk(id);
  return out;
}
