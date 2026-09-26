// The live play area of a 50 km map (docs/streaming.md, "The live play area"): the square round
// the start town where the game's own Network, junctions, plots, buildings, traffic and economy
// run. The start town is laid out on it before the first frame; the trunk roads and the railway
// through the area are built on it too (from the plan's routes, so they run on seamlessly into the
// scenery beyond its edge); the other places in it come to life when the camera or the player gets
// near them, a slice at a time (`LiveTowns`), and until then they're scenery like the rest of the map.
//
// Pure of three.js: it takes the Network (and the railway) as the parts of them it uses.
import type { End, P, RoadOpts } from '../roads';
import type { XZ } from './water';
import { LIVE_HALF, type WorldPlan } from './plan';

// the roads' types on the Network (the catalogue's, as interchange/region.ts uses for the region)
export const LIVE_TYPES = { A: 'rural-60', B: 'rural-50', main: 'rail-main', branch: 'rail-branch' } as const;

interface NetLike {
  snapStart(raw: P, tol: number, cls?: 'road' | 'rail'): End;
  check(a: End, b: End, ctrl: P | undefined, opts: RoadOpts): { ok: boolean; reason?: string };
  build(a: End, b: End, ctrl: P | undefined, opts: RoadOpts): number[];
}

// A route's centre line inside the play area, as pieces the Network builds: each a quadratic
// through three of its points about `len` metres apart (so it follows the route's bends), from
// where it enters to where it leaves (the last point inside: the scenery's own stretch starts
// there, so the two meet exactly).
export function legsOf(path: XZ[], len: number, pad = 30): { a: XZ; b: XZ; c?: XZ }[][] {
  const inside = (p: XZ) => Math.max(Math.abs(p.x), Math.abs(p.z)) < LIVE_HALF - pad;
  const runs: XZ[][] = [];
  let run: XZ[] = [];
  for (const p of path) { if (inside(p)) run.push(p); else if (run.length) { runs.push(run); run = []; } }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 2).map((r) => {
    const step = Math.max(2, Math.round(len / 25)), out: { a: XZ; b: XZ; c?: XZ }[] = [];
    for (let k = 0; k < r.length - 1; k += step) {
      const e = Math.min(r.length - 1, k + step), m = r[Math.floor((k + e) / 2)], a = r[k], b = r[e];
      // (the control point that puts the curve's middle on the route's middle point)
      const c = { x: 2 * m.x - (a.x + b.x) / 2, z: 2 * m.z - (a.z + b.z) / 2 };
      const off = Math.abs((b.x - a.x) * (m.z - a.z) - (b.z - a.z) * (m.x - a.x)) / (Math.hypot(b.x - a.x, b.z - a.z) || 1);
      out.push({ a, b, c: off > 0.8 ? c : undefined });
    }
    return out;
  });
}

// Build the trunk roads and railways through the play area on the Network. Roads snap onto the
// streets they meet (a place's high street end); a piece the Network refuses is left out and said why.
// Roads are built once the places at both ends are live (or lie outside the play area): until then
// they're drawn with the scenery of the place not yet live (tilegen.ts placeTile). `only`: just the
// roads to and from that place (it has just come to life).
export function layLiveRoutes(net: NetLike, plan: WorldPlan, base: RoadOpts, which: 'rail' | 'road', isLive: (id: number) => boolean = () => true, only?: number): { made: number[]; problems: string[] } {
  const inArea = (id: number | null) => id !== null && Math.max(Math.abs(plan.settlements[id].x), Math.abs(plan.settlements[id].z)) < LIVE_HALF;
  const ready = (id: number | null) => !inArea(id) || isLive(id!);
  const made: number[] = [], problems: string[] = [];
  const lay = (path: XZ[], type: string, cls: 'road' | 'rail', extra: Partial<RoadOpts>) => {
    for (const legs of legsOf(path, cls === 'rail' ? 250 : 150)) {
      let prev: End | null = null;
      for (const [k, l] of legs.entries()) {
        const opts: RoadOpts = { ...base, type, ...extra };
        const a: End = prev ?? net.snapStart(l.a, cls === 'rail' ? 1 : 12, cls);
        const b: End = net.snapStart(l.b, cls === 'rail' ? 1 : k === legs.length - 1 ? 12 : 1, cls);
        const c = net.check(a, b, l.c, opts);
        if (!c.ok) { problems.push(`${type} at ${Math.round(l.a.x)},${Math.round(l.a.z)}: ${c.reason}`); prev = null; continue; }
        const ids = net.build(a, b, l.c, opts);
        made.push(...ids);
        prev = net.snapStart(l.b, 0.5, cls);
      }
    }
  };
  // (the railway first, as the region lays it: the streets and roads then cross it or bridge it)
  if (which === 'rail') for (const r of plan.rails) lay(r.path, r.kind === 'main' ? LIVE_TYPES.main : LIVE_TYPES.branch, 'rail', { cross: 'bridge', grade: 0.025 });
  else for (const r of plan.roads) {
    if (r.kind === 'motorway' || !ready(r.a) || !ready(r.b)) continue;
    if (only !== undefined ? r.a !== only && r.b !== only : false) continue;
    if (!inArea(r.a) && !inArea(r.b) && !r.path.some((p) => Math.max(Math.abs(p.x), Math.abs(p.z)) < LIVE_HALF)) continue;
    lay(r.path, LIVE_TYPES[r.kind], 'road', {});
  }
  return { made, problems };
}

// The places of the play area, and which of them are live yet. A place comes to life when the view
// is close over it (or the player builds near it): the game builds its streets, junctions and
// buildings a slice at a time (main.ts), and the scenery version of it goes.
export interface LivePlace { id: number; x: number; z: number; reach: number; live: boolean; busy: boolean }
export class LiveTowns {
  readonly places: LivePlace[];
  constructor(plan: WorldPlan, liveNow: number[]) {
    this.places = plan.settlements.filter((s) => Math.max(Math.abs(s.x), Math.abs(s.z)) < LIVE_HALF).map((s) => ({ id: s.id, x: s.x, z: s.z, reach: s.reach, live: liveNow.includes(s.id), busy: false }));
  }
  // the next place to bring to life for a view (the nearest one close enough to be seen in detail)
  next(v: { x: number; z: number; h: number }, reach: number): LivePlace | null {
    if (v.h > 2600) return null;
    let best: LivePlace | null = null, bd = Infinity;
    for (const p of this.places) {
      if (p.live || p.busy) continue;
      const d = Math.hypot(p.x - v.x, p.z - v.z) - p.reach;
      if (d < reach && d < bd) { bd = d; best = p; }
    }
    return best;
  }
  near(p: XZ, m = 150) { return this.places.find((q) => !q.live && !q.busy && Math.hypot(q.x - p.x, q.z - p.z) < q.reach + m) ?? null; }
  get liveIds() { return this.places.filter((p) => p.live).map((p) => p.id); }
}
