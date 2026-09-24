// Where a bridge's supports go, and what the result costs. Piers are spaced within what the type
// can span, kept out of navigation channels and off the roads and railways underneath (with their
// headroom), and stand on the ground or, with footings, in the water. Big-span types (arches,
// cable-stayed, suspension, lifting bridges) put their one main span over the widest thing to be
// crossed and reach the banks on ordinary approach spans. Everything is worked out along the
// route in one dimension; plan positions are only added at the end.
import type { XZ } from '../land';
import { BRIDGES, COST_SCALE, approachFor, closedPerOpening, deckRate, depthOf, type BridgeDef } from './catalogue';
import { deckAt, deckWidth, gradeOver, groundAt, headroomOf, pointOn, type Crossing, type Obstacle } from './crossing';

export type SupportKind = 'abutment' | 'pier' | 'pylon' | 'tower' | 'anchorage' | 'leaf-pier' | 'springing';
export interface Support {
  s: number; kind: SupportKind; def: BridgeDef;
  x: number; z: number; ux: number; uz: number; // plan position and the route's direction there
  top: number; base: number; // underside of what it carries, and the ground (or river bed) it stands on
  inWater: boolean; level?: number; // water surface, when it stands in water
  along: number; across: number; // footprint half-sizes: along the route, and out from the centreline
  cost: number; // real £
  foot: XZ[]; // footprint, for the land registry
}
export type SpanRole = 'span' | 'main' | 'side' | 'approach';
export interface Span { s0: number; s1: number; len: number; def: BridgeDef; role: SpanRole; cost: number }
export interface BridgeLayout {
  ok: boolean; reason?: string; def: BridgeDef;
  s0: number; s1: number; width: number;
  spans: Span[]; supports: Support[];
  real: { deck: number; supports: number; ends: number; total: number }; // real £
  cost: number; maint: number; // game money, and game money a year
  lift: number; // how much higher the deck would have to be for this type to fit (0 if it fits)
  grade?: number; // when refused for a steep deck: the gradient it could take instead
  closedMinPerHour: number; // movable bridges: minutes an hour the road is shut for boats
  notes: string[];
}

const r0 = (v: number) => Math.round(v);
const m = (v: number) => `${r0(v)} m`;
// clear gap between a support and the edge of something it mustn't stand on
const SETBACK = 1;

// ---------- the underside: what the structure leaves below the deck ----------

// Arches: how far the arch drops from crown to springing on a span. It takes what height there is
// (a semicircle for a masonry arch if the piers are tall enough), within the type's proportions.
function riseOf(c: Crossing, d: BridgeDef, s0: number, s1: number) {
  const len = s1 - s0, yMid = deckAt(c, (s0 + s1) / 2), crown = depthOf(d, len);
  const room = yMid - crown - Math.max(groundAt(c, s0), groundAt(c, s1)) - 0.3;
  const most = len * (d.rise ?? 0), least = len * (d.id === 'masonry' ? 0.2 : 0.12);
  return { rise: Math.max(least, Math.min(most, room)), fits: room >= least - 1e-6, room, least, crown, yMid };
}

// Height of the underside of the structure at s, on a span.
export function underside(c: Crossing, sp: Pick<Span, 's0' | 's1' | 'def' | 'role'>, s: number) {
  const d = sp.def, len = sp.s1 - sp.s0, u = Math.max(0, Math.min(1, (s - sp.s0) / (len || 1)));
  if (d.id === 'masonry' || (d.id === 'arch-concrete' && sp.role === 'main')) {
    const a = riseOf(c, d, sp.s0, sp.s1), x = 2 * u - 1;
    const spring = a.yMid - a.crown - a.rise;
    // masonry: a semicircle or segment; concrete: a parabola
    return d.id === 'masonry' ? spring + a.rise * Math.sqrt(Math.max(0, 1 - x * x)) : spring + a.rise * (1 - x * x);
  }
  if (d.id === 'box') {
    // haunched: deep over the piers, shallow in the middle
    const dp = depthOf(d, len), dm = Math.max(d.depth.min, len / 40), x = 2 * u - 1;
    return deckAt(c, s) - (dm + (dp - dm) * x * x);
  }
  return deckAt(c, s) - depthOf(d, len);
}

// ---------- where supports may not stand, and what must be cleared ----------

interface Zone { s0: number; s1: number; why: string; channel: boolean }
const nameOf = (o: Obstacle) => o.name ?? (o.kind === 'water' ? 'the channel' : o.kind === 'road' ? 'the road' : o.kind === 'rail' ? 'the railway' : o.name);

function zonesOf(c: Crossing, a: number, b: number, half: number): Zone[] {
  const z: Zone[] = [];
  for (const o of c.obstacles) {
    const w = half + SETBACK;
    if (o.kind === 'water') { if (o.channel) z.push({ s0: o.channel.s0 - w, s1: o.channel.s1 + w, why: o.name ? `the channel of ${o.name}` : 'the channel', channel: true }); }
    else z.push({ s0: o.s0 - w, s1: o.s1 + w, why: nameOf(o)!, channel: false });
  }
  return z.filter((q) => q.s1 > a && q.s0 < b).sort((p, q) => p.s0 - q.s0);
}

// Does a span clear everything underneath it? Returns the worst shortfall and what caused it.
function clearance(c: Crossing, sp: Pick<Span, 's0' | 's1' | 'def' | 'role'>, movable: boolean) {
  let short = 0, why = '', need = 0, have = 0;
  const test = (s: number, want: number, what: string) => {
    const u = underside(c, sp, s), gap = want - u;
    if (gap > short + 1e-6) { short = gap; why = what; need = want; have = u; }
  };
  for (const o of c.obstacles) {
    const s0 = Math.max(o.s0, sp.s0), s1 = Math.min(o.s1, sp.s1);
    if (s1 < s0) continue;
    for (let k = 0; k <= 6; k++) {
      const s = s0 + ((s1 - s0) * k) / 6;
      if (o.kind === 'road' || o.kind === 'rail') test(s, o.surface + headroomOf(o), nameOf(o)!);
      else if (o.kind === 'water') {
        const ch = o.channel;
        if (ch && s >= ch.s0 && s <= ch.s1 && !movable) test(s, o.level + ch.clear, o.name ? `boats on ${o.name}` : 'boats');
        else test(s, o.level + 0.6, 'the water');
      }
    }
    // the channel's own edges, which may lie inside the stretch sampled above
    if (o.kind === 'water' && o.channel && !movable) for (const s of [o.channel.s0, o.channel.s1]) if (s >= sp.s0 && s <= sp.s1) test(s, o.level + o.channel.clear, o.name ? `boats on ${o.name}` : 'boats');
  }
  // and the ground itself, away from the supports (arches spring from their piers)
  const len = sp.s1 - sp.s0;
  for (let k = 1; k < 8; k++) { const s = sp.s0 + (len * k) / 8; test(s, groundAt(c, s) + 0.3, 'the ground'); }
  return { short, why, need, have };
}

// Half the length of a support along the route (a pier's thickness).
function halfAlong(d: BridgeDef, len: number, kind: SupportKind) {
  if (kind === 'tower' || kind === 'pylon') return d.id === 'suspension' ? 4 : 3.5;
  if (kind === 'leaf-pier') return 5;
  if (kind === 'springing') return 3;
  switch (d.id) {
    case 'trestle': return 0.8;
    case 'masonry': return Math.max(1, len / 12);
    case 'truss-through': case 'truss-deck': case 'box': return 1.8;
    default: return 1.1;
  }
}

// ---------- placing supports ----------

interface Plan { spans: Span[]; fixed: { s: number; kind: SupportKind; def: BridgeDef }[]; fail?: string; lift: number }
const span = (s0: number, s1: number, def: BridgeDef, role: SpanRole): Span => ({ s0, s1, len: s1 - s0, def, role, cost: 0 });

// Rough price of a pier at s under a span of `len`, for choosing how many to have.
function pierGuess(c: Crossing, d: BridgeDef, len: number, s: number, width: number) {
  const h = Math.max(0, deckAt(c, s) - depthOf(d, len) - groundAt(c, s));
  const wet = c.obstacles.some((o) => o.kind === 'water' && s > o.s0 && s < o.s1);
  return (d.cost.pier + d.cost.pierPerM * h) * Math.max(0.6, width / 12) * (wet ? 1.8 : 1);
}

// A row of spans of type d between a and b, bridging every zone in between.
function placeMulti(c: Crossing, d: BridgeDef, a: number, b: number, width: number, role: SpanRole, movableMain = false): Plan {
  const half = halfAlong(d, d.span.max * 0.6, 'pier');
  let zones = zonesOf(c, a, b, half);
  // zones too close together for a pier between them are crossed as one
  const merged: Zone[] = [];
  for (const z of zones) {
    const l = merged[merged.length - 1];
    if (l && z.s0 - l.s1 < half * 2 + 0.5) { l.s1 = Math.max(l.s1, z.s1); l.why = `${l.why} and ${z.why}`; l.channel ||= z.channel; }
    else merged.push({ ...z });
  }
  zones = merged;
  const free = (s: number) => !zones.some((z) => s > z.s0 + 1e-6 && s < z.s1 - 1e-6);
  const chunks: Span[] = [];
  let lift = 0;
  // one span over each zone: the shortest that fits and clears, centred on it
  for (const z of zones) {
    const w = Math.min(b, z.s1) - Math.max(a, z.s0);
    if (w > d.span.max) return { spans: [], fixed: [], lift, fail: `Span ${m(w)} over ${z.why} is too long: a ${d.label.toLowerCase()} spans ${m(d.span.max)} at most` };
    let best: Span | null = null, worst = { short: 0, why: '', need: 0, have: 0 };
    for (let len = Math.max(w, d.span.min * 0.5); len <= d.span.max + 1e-6 && !best; len += Math.max(0.5, d.span.max / 200)) {
      const mid = (Math.max(a, z.s0) + Math.min(b, z.s1)) / 2;
      let p = mid - len / 2, q = mid + len / 2;
      // near a bank, reach it rather than leave a stub span
      if (p - a < d.span.min) { q += a - p; p = a; }
      if (b - q < d.span.min) { p -= q - b; q = b; }
      p = Math.max(a, p); q = Math.min(b, q);
      if (q - p > d.span.max + 1e-6 || !free(p) || !free(q)) continue;
      const sp = span(p, q, d, role);
      const cl = clearance(c, sp, movableMain);
      if (cl.short <= 0.01) best = sp;
      else if (!worst.why || cl.short < worst.short) worst = cl;
    }
    if (!best) {
      lift = Math.max(lift, worst.short);
      return { spans: [], fixed: [], lift, fail: worst.why === 'the ground'
        ? `A ${d.label.toLowerCase()} is too deep for the height here: it would reach the ground`
        : `Only ${worst.have.toFixed(1)} m under a ${d.label.toLowerCase()} over ${worst.why}; needs ${worst.need.toFixed(1)} m (raise the deck ${worst.short.toFixed(1)} m)` };
    }
    const prev = chunks[chunks.length - 1];
    // a stub between two zones' spans is better joined into one span, if one span can do it
    if (prev && best.s0 >= prev.s1 - 1e-6 && best.s0 - prev.s1 < d.span.min) {
      const joined = span(prev.s0, best.s1, d, role);
      if (joined.len <= d.span.max && clearance(c, joined, movableMain).short <= 0.01) { chunks[chunks.length - 1] = joined; continue; }
    }
    if (prev && best.s0 < prev.s1 - 1e-6) {
      // two neighbouring zones' spans overlap: cross both with one span if it can, else fail
      const joined = span(prev.s0, best.s1, d, role);
      if (joined.len > d.span.max || clearance(c, joined, movableMain).short > 0.01) return { spans: [], fixed: [], lift, fail: `No room for a pier between ${zones[chunks.length - 1]?.why ?? 'the obstacles'} and ${z.why}, and ${m(joined.len)} is too far for a ${d.label.toLowerCase()}` };
      chunks[chunks.length - 1] = joined;
    } else chunks.push(best);
  }
  // fill the gaps between with evenly spaced spans, as many as is cheapest
  const spans: Span[] = [];
  let at = a;
  const fill = (p: number, q: number): string | undefined => {
    const g = q - p;
    if (g < 0.5) return;
    const nMin = Math.max(1, Math.ceil(g / d.span.max - 1e-9)), nMax = Math.max(nMin, Math.min(nMin + 40, Math.floor(g / d.span.min)));
    let best: { n: number; cost: number } | null = null, why = '';
    for (let n = nMin; n <= nMax; n++) {
      const len = g / n;
      let ok = true, cost = n * deckRate(d, len) * width * len;
      for (let k = 0; k < n && ok; k++) {
        const cl = clearance(c, span(p + len * k, p + len * (k + 1), d, role), false);
        if (cl.short > 0.01) { ok = false; why = cl.why; lift = Math.max(lift, cl.short); }
      }
      for (let k = 1; k < n; k++) cost += pierGuess(c, d, len, p + len * k, width);
      if (ok && (!best || cost < best.cost)) best = { n, cost };
    }
    if (!best) return why === 'the ground' ? `A ${d.label.toLowerCase()} is too deep for the height near the ends` : `Can't clear ${why} with a ${d.label.toLowerCase()}`;
    for (let k = 0; k < best.n; k++) spans.push(span(p + (g * k) / best.n, p + (g * (k + 1)) / best.n, d, role));
  };
  for (const ch of chunks) {
    const e = fill(at, ch.s0);
    if (e) return { spans: [], fixed: [], lift, fail: e };
    spans.push(ch);
    at = ch.s1;
  }
  const e = fill(at, b);
  if (e) return { spans: [], fixed: [], lift, fail: e };
  const fixed = spans.slice(1).map((sp) => ({ s: sp.s0, kind: 'pier' as SupportKind, def: d }));
  return { spans, fixed, lift };
}

// One main span over the widest thing to cross, approach spans either side.
function placeMain(c: Crossing, d: BridgeDef, a: number, b: number, width: number): Plan {
  const approach = approachFor(c.year);
  const movable = !!d.opening;
  const half = halfAlong(d, 0, d.id === 'suspension' ? 'tower' : 'pylon');
  const zones = zonesOf(c, a, b, half);
  let lift = 0;
  if (b - a < d.span.min) return { spans: [], fixed: [], lift, fail: `Only ${m(b - a)} to cross: a ${d.label.toLowerCase()} needs a main span of ${m(d.span.min)} or more` };
  // the thing the main span is for: the channel if there is one, else the widest zone, else the
  // lowest ground (a valley)
  let target: { s0: number; s1: number; why: string };
  const ch = zones.filter((z) => z.channel).sort((p, q) => q.s1 - q.s0 - (p.s1 - p.s0))[0];
  const wide = [...zones].sort((p, q) => q.s1 - q.s0 - (p.s1 - p.s0))[0];
  if (ch ?? wide) target = ch ?? wide;
  else {
    let lo = a, gy = Infinity;
    for (let s = a; s <= b; s += 2) if (groundAt(c, s) < gy) { gy = groundAt(c, s); lo = s; }
    target = { s0: lo, s1: lo, why: 'the valley' };
  }
  const blocked = (s: number) => zones.some((z) => s > z.s0 + 1e-6 && s < z.s1 - 1e-6);
  const w = Math.min(b, target.s1) - Math.max(a, target.s0);
  if (w > d.span.max) return { spans: [], fixed: [], lift, fail: `Span ${m(w)} over ${target.why} is too long: a ${d.label.toLowerCase()} spans ${m(d.span.max)} at most` };
  // arches and towers want some room: the main span is sized to the crossing, not just the channel
  const want = d.id === 'arch-concrete' ? (b - a) * 0.7 : d.id === 'suspension' || d.id === 'cable-stayed' ? Math.max(w, (b - a) * 0.5) : w;
  let main: Span | null = null, worst = { short: 0, why: '', need: 0, have: 0 };
  const t0 = Math.max(a, target.s0), t1 = Math.min(b, target.s1), mid0 = (t0 + t1) / 2;
  // try the preferred length first, then longer, then (for arches, which want low springings) shorter
  const lens: number[] = [], step = Math.max(1, d.span.max / 150), shortest = Math.max(d.span.min, w), pref = Math.max(shortest, Math.min(want, d.span.max));
  for (let len = pref; len <= d.span.max + 1e-6; len += step) lens.push(len);
  for (let len = pref - step; len >= shortest - 1e-6; len -= step) lens.push(len);
  for (const len of lens) {
    for (const shift of [0, -0.1, 0.1, -0.2, 0.2, -0.3, 0.3]) {
      let p = mid0 - len / 2 + shift * len, q = p + len;
      if (p < a) { q += a - p; p = a; }
      if (q > b) { p -= q - b; q = b; }
      if (p > t0 + 1e-6 || q < t1 - 1e-6) continue;
      if (blocked(p) || blocked(q)) continue;
      const sp = span(p, q, d, 'main');
      if (d.id === 'arch-concrete') {
        const r = riseOf(c, d, p, q);
        if (!r.fits) { if (!worst.why || r.least - r.room < worst.short) worst = { short: r.least - r.room, why: 'arch', need: r.least, have: r.room }; continue; }
      }
      const cl = clearance(c, sp, movable);
      if (cl.short <= 0.01) { main = sp; break; }
      if (!worst.why || cl.short < worst.short) worst = cl;
    }
    if (main) break;
  }
  if (!main) {
    lift = Math.max(0, worst.short);
    if (worst.why === 'arch') return { spans: [], fixed: [], lift, fail: `Not deep enough for an arch: it needs ${m(worst.need)} below the deck, there's ${m(Math.max(0, worst.have))}` };
    if (!worst.why) return { spans: [], fixed: [], lift, fail: `No room for the ${d.id === 'suspension' ? 'towers' : d.id === 'cable-stayed' ? 'pylons' : 'main piers'} clear of ${target.why}` };
    return { spans: [], fixed: [], lift, fail: `Only ${worst.have.toFixed(1)} m under the ${d.label.toLowerCase()} over ${worst.why}; needs ${worst.need.toFixed(1)} m` };
  }
  const endKind: SupportKind = d.id === 'suspension' ? 'tower' : d.id === 'cable-stayed' ? 'pylon' : d.id === 'bascule' ? 'leaf-pier' : d.id === 'arch-concrete' ? 'springing' : 'pier';
  const spans: Span[] = [main];
  const fixed: Plan['fixed'] = [];
  if (main.s0 > a + 0.5) fixed.push({ s: main.s0, kind: endKind, def: d });
  if (main.s1 < b - 0.5) fixed.push({ s: main.s1, kind: endKind, def: d });
  // side spans: cable-stayed back spans end on a backstay pier; suspension side spans end at the
  // anchorage. Either is cut short by the bank.
  let A = main.s0, Bn = main.s1;
  if (d.id === 'cable-stayed' || d.id === 'suspension') {
    const side = main.len * (d.id === 'cable-stayed' ? 0.42 : 0.3);
    const out = (from: number, dir: -1 | 1) => {
      let s = from + dir * side;
      while (blocked(s) && Math.abs(s - from) > 10) s -= dir * 2;
      if (dir < 0 ? s - a < 20 : b - s < 20) s = dir < 0 ? a : b;
      return Math.max(a, Math.min(b, s));
    };
    const L = out(main.s0, -1), R = out(main.s1, 1);
    if (main.s0 - L > 1) { spans.unshift(span(L, main.s0, d, 'side')); fixed.push({ s: L, kind: d.id === 'suspension' ? 'anchorage' : 'pier', def: d }); }
    if (R - main.s1 > 1) { spans.push(span(main.s1, R, d, 'side')); fixed.push({ s: R, kind: d.id === 'suspension' ? 'anchorage' : 'pier', def: d }); }
    // the anchorage takes the place of an abutment when it sits at the bank
    A = L; Bn = R;
    for (const sp of spans.filter((q) => q.role === 'side')) {
      const cl = clearance(c, sp, false);
      if (cl.short > 0.01) return { spans: [], fixed: [], lift: cl.short, fail: `The side span can't clear ${cl.why}` };
    }
  }
  // approaches to the banks
  for (const [p, q] of [[a, A], [Bn, b]] as const) {
    if (q - p < 0.5) continue;
    const pl = placeMulti(c, approach, p, q, width, 'approach');
    if (pl.fail) return { spans: [], fixed: [], lift: pl.lift, fail: `Approach: ${pl.fail}` };
    spans.push(...pl.spans);
    fixed.push(...pl.fixed);
  }
  spans.sort((p, q) => p.s0 - q.s0);
  return { spans, fixed: fixed.filter((f) => f.s > a + 0.5 && f.s < b - 0.5 || f.kind === 'anchorage'), lift };
}

// ---------- the whole layout, costed ----------

export function layoutBridge(c: Crossing, d: BridgeDef, a: number, b: number): BridgeLayout {
  const width = deckWidth(c.road);
  const plan = d.layout === 'main' ? placeMain(c, d, a, b, width) : placeMulti(c, d, a, b, width, 'span');
  const empty: BridgeLayout = { ok: false, reason: plan.fail, def: d, s0: a, s1: b, width, spans: [], supports: [], real: { deck: 0, supports: 0, ends: 0, total: 0 }, cost: 0, maint: 0, lift: plan.lift, closedMinPerHour: 0, notes: [] };
  if (plan.fail) return empty;
  const wscale = Math.max(0.6, width / 12);
  const supports: Support[] = [];
  const spanAt = (s: number, side: -1 | 1) => plan.spans.find((sp) => (side < 0 ? Math.abs(sp.s1 - s) < 1e-3 : Math.abs(sp.s0 - s) < 1e-3));
  const add = (s: number, kind: SupportKind, sd: BridgeDef) => {
    const p = pointOn(c.path, s);
    const l = spanAt(s, -1), r = spanAt(s, 1);
    // it carries the lower of the two spans' undersides where they meet it
    const tops = [l, r].filter((x): x is Span => !!x).map((sp) => underside(c, sp, s));
    const top = tops.length ? Math.min(...tops) : p.y - depthOf(sd, 10);
    const base = groundAt(c, s);
    const water = c.obstacles.find((o) => o.kind === 'water' && s > o.s0 && s < o.s1) as Extract<Obstacle, { kind: 'water' }> | undefined;
    const lenMax = Math.max(l?.len ?? 0, r?.len ?? 0);
    const along = halfAlong(sd, lenMax, kind);
    const across = width / 2 + (kind === 'tower' || kind === 'pylon' ? 2.5 : kind === 'leaf-pier' ? 2 : kind === 'anchorage' ? 3 : sd.id === 'masonry' || sd.id === 'trestle' ? 1.2 : 0.8);
    const h = Math.max(0, top - base);
    let cost: number;
    if (kind === 'abutment') cost = (sd.id === 'suspension' ? BRIDGES.beam : sd).cost.abutment * wscale;
    else if (kind === 'anchorage') cost = sd.cost.abutment;
    else if (kind === 'pier') cost = (sd.cost.pier + sd.cost.pierPerM * h) * wscale;
    else {
      // pylons and towers are priced on their full height, deck to top included
      const full = kind === 'tower' || kind === 'pylon' ? p.y + (sd.above?.(plan.spans.find((q) => q.role === 'main')!.len) ?? 0) - base : h;
      cost = (sd.cost.main ?? 0) + (sd.cost.mainPerM ?? 0) * full + (sd.cost.pier + sd.cost.pierPerM * h) * wscale;
    }
    if (water && kind !== 'abutment' && kind !== 'anchorage') cost = cost * 1.8 + 60000 * Math.max(0, water.level - base) * wscale; // cofferdam and footings
    const nx = -p.uz, nz = p.ux;
    const foot = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: p.x + p.ux * along * i + nx * across * j, z: p.z + p.uz * along * i + nz * across * j }));
    supports.push({ s, kind, def: sd, x: p.x, z: p.z, ux: p.ux, uz: p.uz, top, base, inWater: !!water, level: water?.level, along, across, cost, foot });
  };
  const first = plan.spans[0], last = plan.spans[plan.spans.length - 1];
  const endDef = (sp: Span) => (sp.role === 'approach' ? sp.def : d);
  if (!plan.fixed.some((f) => f.kind === 'anchorage' && Math.abs(f.s - a) < 0.5)) add(a, 'abutment', endDef(first));
  for (const f of plan.fixed) add(f.s, f.kind, f.def);
  if (!plan.fixed.some((f) => f.kind === 'anchorage' && Math.abs(f.s - b) < 0.5)) add(b, 'abutment', endDef(last));
  supports.sort((p, q) => p.s - q.s);

  // piers that would be too tall, or no room for them under a too-deep structure
  for (const sp of supports) {
    if (sp.kind === 'abutment' || sp.kind === 'anchorage') continue;
    const h = sp.top - sp.base;
    if (h < -0.5) return { ...empty, reason: `A ${sp.def.label.toLowerCase()} is too deep for the height here: it would reach the ground`, lift: -h };
    if (sp.kind === 'pier' && h > sp.def.maxPier) return { ...empty, reason: `Piers would be ${m(h)} tall: a ${sp.def.label.toLowerCase()} stands on ${m(sp.def.maxPier)} at most` };
  }
  // each span to its own type's gradient (approach spans may be steeper than a main span)
  for (const sp of plan.spans) {
    const g = gradeOver(c, sp.s0, sp.s1);
    if (g > sp.def.maxGrade + 1e-3) return { ...empty, grade: sp.def.maxGrade, reason: `Deck climbs at ${(g * 100).toFixed(1)}%${sp.role === 'main' ? ' over the main span' : ''}: a ${sp.def.label.toLowerCase()} is built to ${(sp.def.maxGrade * 100).toFixed(0)}% at most` };
  }
  let deck = 0, maintReal = 0;
  for (const sp of plan.spans) {
    sp.cost = deckRate(sp.def, sp.len) * width * sp.len;
    deck += sp.cost;
    maintReal += sp.def.cost.maint * width * sp.len;
  }
  if (d.opening) maintReal += 150000; // a bridge keeper and the machinery
  const ends = supports.filter((q) => q.kind === 'abutment' || q.kind === 'anchorage').reduce((t, q) => t + q.cost, 0);
  const sup = supports.reduce((t, q) => t + q.cost, 0) - ends;
  const total = deck + sup + ends;
  const notes: string[] = [];
  const mph = c.road.cls === 'rail' ? d.railMph : d.roadMph;
  if (mph && mph < c.road.mph) notes.push(`Speed limit ${mph} mph on the bridge`);
  let closed = 0;
  if (d.opening) {
    const main = plan.spans.find((q) => q.role === 'main')!;
    for (const o of c.obstacles) {
      if (o.kind !== 'water' || !o.channel || o.channel.s1 < main.s0 || o.channel.s0 > main.s1) continue;
      const low = underside(c, main, (o.channel.s0 + o.channel.s1) / 2) - o.level;
      if (low < o.channel.clear) {
        closed += ((o.channel.tallPerHour ?? 1) * closedPerOpening(d)) / 60;
        notes.push(`Lifts for boats taller than ${low.toFixed(1)} m: the road shuts ${closed.toFixed(0)} min an hour`);
      }
    }
  }
  const approaches = plan.spans.filter((q) => q.role === 'approach');
  if (approaches.length) notes.push(`${approaches.length} approach span${approaches.length > 1 ? 's' : ''} in ${approaches[0].def.label.toLowerCase()}`);
  return {
    ok: true, def: d, s0: a, s1: b, width, spans: plan.spans, supports,
    real: { deck: r0(deck), supports: r0(sup), ends: r0(ends), total: r0(total) },
    cost: r0(total * COST_SCALE), maint: r0(maintReal * COST_SCALE), lift: 0, closedMinPerHour: closed, notes,
  };
}
