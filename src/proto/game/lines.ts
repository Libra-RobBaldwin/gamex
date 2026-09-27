// The player's bus lines (docs/loop.md, M1). A line is its stops in the order you tapped them,
// and the buses that run it, all in one livery. Its buses run A, B, C, then back B, A (or round
// again from A when you close the loop by tapping the first stop last). Each call is at the stop
// you tapped or at the one facing it across the road, whichever side the bus comes along
// (traffic.ts `place`).
//
// Stops get street names here, one per place (both sides of the road share it), in the order
// they're first seen; the names are invented and never real addresses.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { pathLength, subPath, type Network, type P } from '../roads';
import type { BusLine, Traffic } from '../traffic';

export interface Line {
  id: number; num: number; stops: number[]; loop: boolean; offer?: string;
  bus: BusLine; // what the traffic follows (the same object, so edits reach the buses at once; its `spacing` is the line's even-gaps switch)
}

export interface LinesSave {
  nextId: number; used: number; names: [number, string][];
  list: { id: number; num: number; stops: number[]; loop: boolean; offer?: string; mode?: 'bus' | 'rail'; vehicles: number; spacing?: boolean }[]; // (mode: in saves from before the interim stations went)
}

const NAMES = [
  'Market Place', 'Church Street', 'Mill Lane', 'Station Road', 'The Green', 'Victoria Road', 'Park Road', 'Bridge Street',
  'School Lane', 'The Parade', 'Chapel Row', 'Elm Grove', 'Oak Avenue', 'Hill Rise', 'Brook Lane', 'Castle Street',
  'Albert Road', 'North Street', 'West End', 'Priory Walk', 'Orchard Way', 'Meadow Close', 'Forge Lane', 'Manor Road',
  'Crown Street', 'Well Lane', 'Tanners Row', 'Cooper Street', 'Linden Road', 'Fairfield', 'Gasworks Lane', 'Wharf Road',
];

export function callOrder(stops: number[], loop: boolean) { return loop || stops.length < 3 ? [...stops] : [...stops, ...stops.slice(1, -1).reverse()]; }

export class Lines {
  list: Line[] = [];
  private nextId = 1;
  private names = new Map<number, string>();
  private used = 0;
  constructor(private traffic: Traffic) {}

  // a stop's name: shared with the stop facing it, given the first time either is asked about
  name(stop: number): string {
    const had = this.names.get(stop);
    if (had) return had;
    const pl = this.traffic.place(stop);
    const mate = pl?.stops.map((s) => this.names.get(s.id)).find(Boolean);
    const n = mate ?? (this.used < NAMES.length ? NAMES[this.used++] : `Stop ${++this.used}`);
    this.names.set(stop, n);
    return n;
  }
  // "Market Place – Station Road", from its ends
  title(l: Line) {
    const a = this.name(l.stops[0]), b = this.name(l.stops[l.loop ? Math.floor(l.stops.length / 2) : l.stops.length - 1]);
    return l.loop ? `${a} circular` : `${a} – ${b}`;
  }
  // same place (a stop or the one facing it)?
  same(a: number, b: number) { if (a === b) return true; const p = this.traffic.place(a); return !!p?.stops.some((s) => s.id === b); }

  add(stops: number[], loop: boolean, buses = 2, offer?: string): Line {
    const id = this.nextId++, num = id;
    const l: Line = { id, num, stops: [...stops], loop, offer, bus: { id, seq: callOrder(stops, loop) } };
    this.list.push(l);
    for (let i = 0; i < buses; i++) this.addBus(l);
    return l;
  }
  // a bus for the line, starting part way round it (by the golden ratio, so however many there
  // are they start spread out: 0, 0.62, 0.24, 0.85... of the way)
  addBus(l: Line) {
    const n = this.traffic.busesOn(l.id).length, q = l.bus.seq.length;
    return this.traffic.addBus(l.offer, l.bus, Math.floor(((n * 0.618034) % 1) * q));
  }
  removeBus(l: Line) { const ids = this.traffic.busesOn(l.id); if (ids.length) this.traffic.removeBus(ids[ids.length - 1]); }
  remove(l: Line) {
    for (const id of this.traffic.busesOn(l.id)) this.traffic.removeBus(id);
    this.list = this.list.filter((x) => x !== l);
  }
  // stops that no longer exist leave their lines (a road rebuilt through them); a line left with
  // fewer than two stops goes, and its buses with it. The buses of a line that lost a call go on to
  // the same call, or the next one still made (traffic.setLineSeq), never back to the start.
  prune() {
    for (const l of [...this.list]) {
      const keep = l.stops.filter((id) => this.traffic.place(id));
      if (keep.length === l.stops.length) continue;
      if (keep.length < 2) { this.remove(l); continue; }
      l.stops = keep; this.traffic.setLineSeq(l.bus, callOrder(keep, l.loop));
    }
  }
  buses(l: Line) { return this.traffic.busesOn(l.id); }
  // Even gaps: a bus holds at a stop while the one ahead of it is too close (traffic.ts holdOn). On unless turned off.
  spacing(l: Line) { return l.bus.spacing !== false; }
  setSpacing(l: Line, on: boolean) { l.bus.spacing = on; }

  // ---------- saving (game/save.ts) ----------
  // The lines, how many vehicles each runs, and the stops' names. The vehicles themselves start
  // again spread along their lines, as a new line's do. (Rail lines are the railway's: rail/.)
  save(): LinesSave {
    return {
      nextId: this.nextId, used: this.used, names: [...this.names],
      list: this.list.map((l) => ({ id: l.id, num: l.num, stops: [...l.stops], loop: l.loop, offer: l.offer, vehicles: this.buses(l).length, ...(l.bus.spacing === false ? { spacing: false } : {}) })),
    };
  }
  // (after the stops are back, into an empty list; false for a vehicle with no room)
  restore(s: LinesSave) {
    this.nextId = s.nextId; this.used = s.used; this.names = new Map(s.names);
    let all = true;
    // (a save from before the loop's interim stations went may have rail lines on them: they're gone)
    for (const x of s.list.filter((x) => x.mode !== 'rail')) {
      const l: Line = { id: x.id, num: x.num, stops: [...x.stops], loop: x.loop, offer: x.offer, bus: { id: x.id, seq: callOrder(x.stops, x.loop), ...(x.spacing === false ? { spacing: false } : {}) } };
      this.list.push(l);
      for (let i = 0; i < x.vehicles; i++) if (!this.addBus(l)) all = false;
    }
    return all;
  }
  of(bus: number) { const id = this.traffic.bus(bus)?.line; return this.list.find((l) => l.id === id) ?? null; }
}

// ---------- the route drawn on the map ----------
// A lime line down the left of each road the line's buses use (UK: they drive on the left, so
// the two directions show side by side when zoomed in), a few pixels wide at any zoom. It floats
// 0.6 m over the road (whose paths carry their height over bridges and down tunnels): far enough
// never to flicker against it, low enough that the buses on it hide it as they pass.
// Call `resolution.set(w, h)` on its material with the drawing buffer's size.
const SIDE = 2.4;
export function routeMesh(net: Network, traffic: Traffic, seq: number[], colour = '#5cb83a'): LineSegments2 | null {
  const legs = traffic.lineRoute(seq);
  const pos: number[] = [];
  for (const leg of legs) for (const run of leg) {
    if (run.s1 - run.s0 < 0.5) continue;
    const full = net.path(run.seg);
    let pts = run.from === run.seg.a ? subPath(full, run.s0, run.s1) : subPath([...full].reverse(), run.s0, run.s1);
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.05);
    if (pts.length < 2 || pathLength(pts) < 0.5) continue;
    const side = offsetLeft(pts);
    for (let i = 1; i < side.length; i++) pos.push(side[i - 1].x, side[i - 1].y!, side[i - 1].z, side[i].x, side[i].y!, side[i].z);
  }
  if (!pos.length) return null;
  const g = new LineSegmentsGeometry();
  g.setPositions(pos);
  const m = new LineMaterial({ color: colour, linewidth: 5, worldUnits: false, transparent: true, opacity: 0.9, depthWrite: false });
  const line = new LineSegments2(g, m);
  line.renderOrder = 20;
  line.frustumCulled = false;
  return line;
}
function offsetLeft(pts: P[]): P[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // the left of the direction of travel, seen from above (x east, z south): heading north (-z), west (-x)
    return { x: p.x + dz * SIDE, z: p.z - dx * SIDE, y: (p.y ?? 0) + 0.6 };
  });
}

// ---------- stop markers ----------
// While a line is drawn or looked at, every stop place wears a round badge that stays the same
// size on screen: orange for a stop, lime with its number once it's on the line. Also drawn over
// everything, so there's nothing for them to fight with.
const texCache = new Map<string, THREE.Texture>();
function badge(label: string, on: boolean) {
  const key = `${label}|${on}`;
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = on ? '#5cb83a' : '#f28c28'; g.fill();
  g.lineWidth = 6; g.strokeStyle = on ? '#0f3322' : '#361402'; g.stroke();
  if (label) { g.fillStyle = on ? '#0f3322' : '#fff'; g.font = '700 30px "League Spartan", Archivo, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 32, 35); }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}
export class StopMarkers {
  readonly group = new THREE.Group();
  constructor(private net: Network, private traffic: Traffic) { this.group.renderOrder = 21; }
  // each place once (a stop and the one facing it share a badge, between the two kerbs)
  places(): { id: number; p: P }[] {
    const seen = new Set<number>(), out: { id: number; p: P }[] = [];
    for (const seg of this.net.segs.values()) for (const st of seg.stops) {
      if (seen.has(st.id)) continue;
      const pl = this.traffic.place(st.id);
      if (!pl) continue;
      for (const s of pl.stops) seen.add(s.id);
      const path = this.net.path(seg), s0 = pl.stops.reduce((a, s) => a + s.s, 0) / pl.stops.length;
      const q = subPath(path, Math.max(0, s0 - 0.5), s0 + 0.5)[0];
      out.push({ id: st.id, p: { x: q.x, z: q.z, y: (q.y ?? 0) + 4 } });
    }
    return out;
  }
  // keep each badge its size on screen: once a frame while shown (cssH: the canvas's css height)
  frame(cam: THREE.Camera, cssH: number) {
    if (!this.group.children.length) return;
    const o = cam as THREE.OrthographicCamera, pc = cam as THREE.PerspectiveCamera, v = new THREE.Vector3();
    for (const c of this.group.children) {
      let perPx: number;
      if (o.isOrthographicCamera) perPx = (o.top - o.bottom) / o.zoom / cssH;
      else { v.copy(c.position).applyMatrix4(cam.matrixWorldInverse); perPx = (2 * -v.z * Math.tan((pc.fov * Math.PI) / 360)) / pc.zoom / cssH; }
      const k = (c.userData.px as number) * perPx;
      c.scale.set(k, k, 1);
    }
  }
  // numbers: which places are on the line being shown, and their order
  show(numbers: Map<number, string> | null) {
    for (const c of [...this.group.children]) { this.group.remove(c); ((c as THREE.Sprite).material as THREE.Material).dispose(); }
    if (!numbers) return;
    for (const { id, p } of this.places()) {
      const key = [...numbers.keys()].find((k) => k === id || this.traffic.place(k)?.stops.some((s) => s.id === id));
      const label = key !== undefined ? numbers.get(key)! : '';
      const m = new THREE.SpriteMaterial({ map: badge(label, key !== undefined), depthTest: false, depthWrite: false, transparent: true });
      const s = new THREE.Sprite(m);
      s.position.set(p.x, p.y ?? 4, p.z);
      s.renderOrder = 21;
      // (on a hilly map the badge is drawn lifted by the ground's height in its shader, drape.ts, but
      // three.js culls a sprite where it thinks it is: badges in the top half of a phone's screen went
      // missing. A dozen sprites cost nothing to draw uncut.)
      s.frustumCulled = false;
      s.userData.px = key !== undefined ? 40 : 30; // css pixels across
      this.group.add(s);
    }
  }
}
