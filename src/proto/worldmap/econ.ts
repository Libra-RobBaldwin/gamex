// The coarse economy of a 50 km map (docs/streaming.md, "The sim at scale"): every place on the map
// has its people and jobs, and grows (or doesn't) a little each game day, from the plan alone: its
// size, how well it's joined to the rest (its A and B roads, a station), and its own seed. It's what
// the names over the map and the Places list show for the places that aren't live; a place that
// comes to life hands over to the game's own economy (game/econ.ts, zone by zone), which starts
// from its buildings. Nothing here needs saving: it's a function of the plan and the day.
//
// The trips between places follow a gravity model (people × people / distance²), for the whole map
// at once; the live economy's own trips between its towns (econaccess.ts townFlows) stay as they are.
// Pure: no three.js.
import { mix } from '../region/random';
import type { WorldPlan } from './plan';

const GROWTH_CAP = 0.5; // how much a place can grow, as a share of its planned size

export class CoarseEconomy {
  private rate: Float64Array; // growth a day
  constructor(readonly plan: WorldPlan) {
    const n = plan.settlements.length, links = new Uint16Array(n), rail = new Uint8Array(n);
    for (const l of plan.links) { links[l.a]++; links[l.b]++; }
    for (const r of plan.rails) for (const st of r.stations) rail[st.settlement] = 1;
    this.rate = new Float64Array(n);
    for (const s of plan.settlements) {
      const j = (mix(plan.seed, 700 + s.id) % 1000) / 1000;
      // (well joined places grow faster: about 1% a game month for a market town on the railway)
      this.rate[s.id] = (0.00012 + 0.00006 * Math.min(4, links[s.id]) + 0.00018 * rail[s.id]) * (0.6 + 0.8 * j);
    }
  }
  // (bounded: a place grows at its rate at first and eases off towards half again its size, so a
  // far place's people never run away from what its streets could hold when it comes to life)
  pop(id: number, day: number) {
    const s = this.plan.settlements[id], t = (this.rate[id] * Math.max(0, day)) / GROWTH_CAP;
    return Math.round(s.pop * (1 + GROWTH_CAP * (1 - Math.exp(-t))));
  }
  jobs(id: number, day: number) { const s = this.plan.settlements[id]; return Math.round(this.pop(id, day) * (s.kind === 'city' ? 0.62 : s.kind === 'town' ? 0.48 : 0.2)); }
  // trips a day between two places (a gravity model)
  trips(a: number, b: number, day: number) {
    const A = this.plan.settlements[a], B = this.plan.settlements[b], d = Math.max(1500, Math.hypot(A.x - B.x, A.z - B.z));
    return Math.round((0.9e6 * this.pop(a, day) * this.pop(b, day)) / (d * d) / 1000);
  }
  // Trips a day between the map's places and one off it (beyond a way off the map: the edge
  // session's game/portals.ts), by the same gravity: its people, where it stands past the rim.
  tripsOff(o: { x: number; z: number; pop: number }, day: number) {
    let t = 0;
    for (const s of this.plan.settlements) { const d = Math.max(1500, Math.hypot(s.x - o.x, s.z - o.z)); t += (0.9e6 * this.pop(s.id, day) * o.pop) / (d * d) / 1000; }
    return Math.round(t);
  }
  // everyone on the map
  total(day: number) { let t = 0; for (const s of this.plan.settlements) t += this.pop(s.id, day); return t; }
}
