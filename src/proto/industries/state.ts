// The small contract between the economy and the industry visuals, and the plain-data
// description of a site's moving parts. Models describe what moves; fx.ts draws it.
import type { CargoId } from './catalogue';

// What the economy tells a site each time it ticks. Everything is optional except what the
// visuals can't guess; missing per-cargo levels fall back to the aggregate input/output fill.
export interface IndustryVisualState {
  production: number; // 0..4, the 2D game's production multiplier; 0 means not producing
  input: number; // 0..1, how full the input stockyards are
  output: number; // 0..1, how full the output stockyards are
  running: boolean; // working now (has what it needs and somewhere to put what it makes)
  recentlyDelivered: boolean; // a load arrived or left in the last few game hours
  year: number; // sets lamp colour and how sooty the smoke is
  inputs?: Partial<Record<CargoId, number>>; // per-cargo fill 0..1, overriding `input`
  outputs?: Partial<Record<CargoId, number>>; // per-cargo fill 0..1, overriding `output`
  neglect?: number; // 0..1, how long it has gone unserved; above ~0.6 it looks derelict
}

export const DEFAULT_STATE: IndustryVisualState = { production: 1, input: 0.5, output: 0.5, running: true, recentlyDelivered: false, year: 1960 };

// ---------------- moving parts, in site-local metres (+z towards the road) ----------------

// A stockpile. Its extents are its size when full; fx.ts scales it with the stock level.
export interface Pile {
  kind: 'heap' | 'logs' | 'stack' | 'tank' | 'herd';
  cargo: CargoId;
  role: 'in' | 'out';
  x: number; z: number; rot: number;
  w: number; d: number; h: number;
  colour: string;
  y?: number; // base height (a silo's floor, a tank's)
  slots?: number; // stacks along w for logs and stacks; animals for a herd
  layers?: number; // stacked layers for stacks
  palette?: string[]; // container or crate colours to cycle through
}

// Something that turns while the site runs: winding wheels, a pumpjack's crank.
export interface Rotor { kind: 'wheel' | 'pumpjack'; x: number; y: number; z: number; r: number; rot: number; speed: number; colour: string }

// Chimneys and cooling towers.
export interface Emitter { kind: 'smoke' | 'steam' | 'flame'; x: number; y: number; z: number; r: number; rise: number; puffs: number }

// Parts that shuttle back and forth or go round: crane jibs, gantry trolleys, conveyor loads.
export interface Mover {
  kind: 'jib' | 'gantry' | 'conveyor';
  x: number; y: number; z: number; rot: number;
  len: number; // jib length, gantry travel, belt length
  rise?: number; // a conveyor's climb from start to end
  colour: string;
  load?: string; // colour of what it carries
  phase: number;
}

export interface Lamp { x: number; y: number; z: number; glow: number }

// Where the economy's vehicles would stand: a lorry in the bay, wagons on the siding.
export interface Berth { kind: 'lorry' | 'wagon' | 'ship'; x: number; z: number; rot: number; len: number }

// Weeds, rubble and rust patches that fade in with neglect.
export interface Decay { x: number; z: number; s: number }

export interface Dynamics {
  piles: Pile[];
  rotors: Rotor[];
  emitters: Emitter[];
  movers: Mover[];
  lamps: Lamp[];
  berths: Berth[];
  decay: Decay[];
}

export const emptyDynamics = (): Dynamics => ({ piles: [], rotors: [], emitters: [], movers: [], lamps: [], berths: [], decay: [] });

// Anchor points for integration: where the gate is and where each kind of station can go.
export interface Anchors {
  gate: { x: number; z: number };
  lorry: { x: number; z: number; rot: number }[];
  rail: { x0: number; x1: number; z: number }[];
  quay: { x0: number; x1: number; z: number }[];
}

// The stock level a pile shows, from a state.
export function pileLevel(p: Pile, s: IndustryVisualState) {
  const per = p.role === 'in' ? s.inputs?.[p.cargo] : s.outputs?.[p.cargo];
  const v = per ?? (p.role === 'in' ? s.input : s.output);
  return Math.max(0, Math.min(1, v));
}
