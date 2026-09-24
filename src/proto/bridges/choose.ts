// Choosing a bridge: every type is tried against the crossing, the ones that can't be built are
// given a plain reason ("span 140 m needs a truss or longer", "rail too heavy for timber"), and the
// rest are ranked by what they cost to build. The recommended default is the cheapest over its
// life (building plus upkeep), and the player can override it, as with the junction editor.
import { BRIDGES, BRIDGE_IDS, COST_SCALE, LIFE_YEARS, availableIn, type BridgeDef, type BridgeId } from './catalogue';
import { demand, extents, type Crossing } from './crossing';
import { layoutBridge, type BridgeLayout } from './layout';

export interface BridgeOption {
  def: BridgeDef; ok: boolean;
  reasons: string[]; // why it can't be built, or (when it can) notes worth knowing
  layout?: BridgeLayout;
  crossing?: Crossing; // the crossing it was laid out on (re-solved if the deck had to be raised)
  cost: number; maint: number; wholeLife: number; // game money
  lift: number; // how much the deck was (or would have to be) raised for this type
}
export interface BridgeChoice { s0: number; s1: number; options: BridgeOption[]; recommended?: BridgeId; chosen?: BridgeId }

// what a minute of the road being shut costs everyone queuing (real £)
const DELAY_PER_MIN = 10;
// the most the deck may be raised to fit a deeper structure before the type is refused
const MAX_RAISE = 20;
const low = (d: BridgeDef) => d.label.toLowerCase();

// Pre-checks that need no layout: era, load, what's carried, the deck's length and gradient.
function refuse(c: Crossing, d: BridgeDef, s0: number, s1: number): string[] {
  const out: string[] = [];
  if (c.year < d.era.from) out.push(`Not invented until ${d.era.from}`);
  else if (d.era.to !== undefined && c.year > d.era.to) out.push(`No longer built after ${d.era.to}`);
  const need = demand(c);
  if (need.rail > 0) {
    if (!d.railAxle) out.push(`Can't carry a railway: a ${low(d)} is too lively for trains`);
    else if (need.rail > d.railAxle) out.push(`Rail too heavy for a ${low(d)} (${need.rail} t axles; it takes ${d.railAxle} t)`);
  } else if (need.road > d.roadTonnes) out.push(`Too heavy for a ${low(d)}: ${need.road} t loads, it takes ${d.roadTonnes} t`);
  const L = s1 - s0;
  if (L > d.length.max) out.push(`${Math.round(L)} m is too long for a ${low(d)} (${d.length.max} m at most)`);
  return out;
}

// "a steel truss, box girder or longer": the types (open this year) that reach a span.
function reaching(c: Crossing, span: number, except: BridgeDef) {
  const ok = BRIDGE_IDS.map((id) => BRIDGES[id]).filter((d) => d !== except && availableIn(d, c.year) && d.span.max >= span).sort((a, b) => a.span.max - b.span.max);
  if (!ok.length) return '';
  const names = ok.slice(0, 2).map(low);
  return ok.length > 2 ? ` — needs a ${names.join(', ')} or longer` : ` — needs a ${names.join(' or ')}`;
}

// Try every type on the stretch s0..s1 (by default the first stretch that needs a bridge).
export function chooseBridge(c: Crossing, range?: [number, number]): BridgeChoice {
  const [s0, s1] = range ?? extents(c)[0] ?? [0, 0];
  const mid = (s0 + s1) / 2;
  const options: BridgeOption[] = BRIDGE_IDS.map((id) => {
    const d = BRIDGES[id];
    const no = refuse(c, d, s0, s1);
    if (no.length) return { def: d, ok: false, reasons: no, cost: 0, maint: 0, wholeLife: 0, lift: 0 };
    // Fit the type to the crossing; if it's deeper than the solver allowed for, or the deck is
    // steeper than it can be built to, ask for the profile again with the deck raised or the
    // ramps eased (when the caller can re-solve), up to a few times.
    let cur = c, a = s0, b = s1, raise = 0, grade: number | undefined, lay = layoutBridge(c, d, a, b), stuck = '';
    for (let k = 0; k < 5 && !lay.ok && c.resolve; k++) {
      let r = raise, g = grade;
      if (lay.grade !== undefined) g = Math.min(grade ?? 1, lay.grade);
      else if (lay.lift > 0 && raise + lay.lift < MAX_RAISE) r = raise + lay.lift + 0.2;
      else break;
      const next = c.resolve({ raise: r, grade: g });
      if (!next) { stuck = g !== grade ? ` (no room to ease the ramps to ${(g! * 100).toFixed(0)}%)` : ` (no room to raise the deck ${r.toFixed(1)} m)`; break; }
      raise = r; grade = g;
      const ex = extents(next).find((e) => e[0] <= mid && e[1] >= mid) ?? extents(next)[0];
      if (!ex) break;
      cur = next; [a, b] = ex;
      lay = layoutBridge(cur, d, a, b);
    }
    if (!lay.ok) {
      let why = (lay.reason ?? 'Can’t be built here') + stuck;
      const m = /^Span (\d+) m/.exec(why);
      if (m) why += reaching(c, +m[1], d);
      return { def: d, ok: false, reasons: [why], layout: lay, cost: 0, maint: 0, wholeLife: 0, lift: lay.lift };
    }
    const notes = [...lay.notes];
    if (raise > 0) notes.unshift(`Deck raised ${raise.toFixed(1)} m to make room for the structure`);
    if (grade !== undefined) notes.unshift(`Ramps eased to ${(grade * 100).toFixed(0)}% for the bridge`);
    // time the road is shut for boats is worth something too: the queues it causes
    const shut = lay.closedMinPerHour * 24 * 365 * DELAY_PER_MIN * COST_SCALE;
    return { def: d, ok: true, reasons: notes, layout: lay, crossing: cur, cost: lay.cost, maint: lay.maint, wholeLife: lay.cost + (lay.maint + shut) * LIFE_YEARS, lift: raise };
  });
  options.sort((a, b) => (a.ok === b.ok ? (a.ok ? a.cost - b.cost : 0) : a.ok ? -1 : 1));
  const best = options.filter((o) => o.ok).sort((a, b) => a.wholeLife - b.wholeLife)[0];
  return { s0, s1, options, recommended: best?.def.id, chosen: best?.def.id };
}

// The player's override: pick a type, keep the options (for showing why others were refused).
export function override(choice: BridgeChoice, id: BridgeId): BridgeChoice {
  const o = choice.options.find((x) => x.def.id === id);
  return o?.ok ? { ...choice, chosen: id } : choice;
}

export const chosenLayout = (choice: BridgeChoice) => choice.options.find((o) => o.def.id === choice.chosen)?.layout;
