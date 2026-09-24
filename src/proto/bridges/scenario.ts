// Ready-made crossings for tests and the demo: a straight or gently curved route over a river, a
// road or railway, and a valley, with its height profile from the real solver in grade.ts. The
// game builds its crossings from the network and terrain instead; this is the same shape of data.
import { GRADES, heightAt, solveProfile, type Limit } from '../grade';
import type { RoadDef } from '../catalog';
import type { P } from '../roads';
import { ASSUMED_DECK, type Crossing, type Obstacle } from './crossing';

export interface ScenarioOpts {
  length: number; road: RoadDef; year: number; heavy?: boolean;
  // a river: banks at 0, water `drop` below them, bed `depth` below that
  river?: { s0: number; s1: number; drop?: number; depth?: number; channel?: { width: number; clear: number; tallPerHour?: number; inProfile?: boolean } };
  under?: { s: number; kind: 'road' | 'rail'; half: number }[]; // roads or railways crossed, centred at s
  valley?: { s0: number; s1: number; depth: number };
  bend?: number; // sideways offset of the route's middle (m), for a curved deck
}

export interface Scenario { crossing: Crossing; water: { s0: number; s1: number; level: number }[]; under: { s0: number; s1: number; kind: 'road' | 'rail' }[]; ok: boolean; reason?: string }

export function scenario(o: ScenarioOpts, need: { raise: number; grade?: number } = { raise: 0 }): Scenario {
  const up = need.raise;
  const spec = o.road.cls === 'rail' ? GRADES.rail : GRADES.road;
  const limits: Limit[] = [];
  const obstacles: Obstacle[] = [];
  const water: Scenario['water'] = [], under: Scenario['under'] = [];
  // the lie of the land (a valley), then the river cut into it with sloping banks
  const base = (s: number) => {
    if (!o.valley) return 0;
    const { s0, s1, depth } = o.valley;
    return s > s0 && s < s1 ? -depth * (0.5 - 0.5 * Math.cos(((s - s0) / (s1 - s0)) * Math.PI * 2)) ** 0.7 : 0;
  };
  const r = o.river, drop = r?.drop ?? 1.2, depth = r?.depth ?? 4;
  const level = r ? Math.min(base(r.s0), base(r.s1)) - drop : 0;
  const ground = (s: number) => {
    const g = base(s);
    if (!r || s <= r.s0 || s >= r.s1) return g;
    const bank = Math.min(12, (r.s1 - r.s0) / 5), into = Math.min(s - r.s0, r.s1 - s);
    return Math.min(g, level - depth * Math.min(1, into / bank));
  };
  if (r) {
    const ch = r.channel, mid = (r.s0 + r.s1) / 2;
    const channel = ch ? { s0: mid - ch.width / 2, s1: mid + ch.width / 2, clear: ch.clear, tallPerHour: ch.tallPerHour } : undefined;
    obstacles.push({ kind: 'water', s0: r.s0, s1: r.s1, level, channel, name: 'the river' });
    water.push({ s0: r.s0, s1: r.s1, level });
    limits.push({ s0: r.s0 - 3, s1: r.s1 + 3, lo: level + spec.water + up, why: 'the water' });
    if (channel && ch!.inProfile !== false) limits.push({ s0: channel.s0, s1: channel.s1, lo: level + ch!.clear + ASSUMED_DECK + up, why: 'boats' });
  }
  for (const u of o.under ?? []) {
    const s0 = u.s - u.half, s1 = u.s + u.half;
    obstacles.push({ kind: u.kind, s0, s1, surface: ground(u.s), name: u.kind === 'rail' ? 'the railway' : 'the road' });
    under.push({ s0, s1, kind: u.kind });
    limits.push({ s0: s0 - 2, s1: s1 + 2, lo: ground(u.s) + (u.kind === 'rail' ? GRADES.rail.clear : spec.clear) + up, why: u.kind === 'rail' ? 'the railway' : 'the road' });
  }
  const G = Math.min(o.road.maxGrade, spec.max, need.grade ?? 1);
  const prof = solveProfile(o.length, 0, 0, G, limits, 'auto');
  // plan: straight along x, bowed sideways by `bend` for a curved deck
  const path: P[] = [];
  const n = Math.ceil(o.length / 3);
  for (let i = 0; i <= n; i++) {
    const t = i / n, s = o.length * t;
    path.push({ x: s - o.length / 2, z: (o.bend ?? 0) * Math.sin(Math.PI * t), y: 0 });
  }
  // arc length of the bowed path differs a little from x; re-map heights by true arc length
  let acc = 0;
  const total = path.reduce((a, p, i) => (i ? a + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z) : 0), 0);
  path.forEach((p, i) => {
    if (i) acc += Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z);
    p.y = heightAt(prof, (acc / total) * o.length);
  });
  const k = total / o.length; // obstacles were given against the straight length
  if (k !== 1) for (const ob of obstacles) { ob.s0 *= k; ob.s1 *= k; if (ob.kind === 'water' && ob.channel) { ob.channel.s0 *= k; ob.channel.s1 *= k; } }
  const crossing: Crossing = { path, ground: (s) => ground(s / k), obstacles, road: o.road, year: o.year, heavy: o.heavy };
  crossing.resolve = (n) => { const r = scenario(o, n); return r.ok ? r.crossing : undefined; };
  return { crossing, water, under, ok: prof.ok, reason: prof.reason };
}
