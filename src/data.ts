// Static game definitions: skills, cargo, buildings, vehicles, costs.

export type SkillId =
  | 'woodcutting'
  | 'mining'
  | 'fishing'
  | 'smithing'
  | 'cooking'
  | 'construction'
  | 'transport';

export const SKILLS: { id: SkillId; name: string; icon: string }[] = [
  { id: 'woodcutting', name: 'Woodcutting', icon: '🪓' },
  { id: 'mining', name: 'Mining', icon: '⛏️' },
  { id: 'fishing', name: 'Fishing', icon: '🎣' },
  { id: 'smithing', name: 'Smithing', icon: '🔨' },
  { id: 'cooking', name: 'Cooking', icon: '🍳' },
  { id: 'construction', name: 'Construction', icon: '🪚' },
  { id: 'transport', name: 'Transport', icon: '🚂' },
];

export const MAX_LEVEL = 99;

// Classic OSRS experience table.
const XP_TABLE: number[] = (() => {
  const t = [0, 0];
  let pts = 0;
  for (let l = 1; l < MAX_LEVEL; l++) {
    pts += Math.floor(l + 300 * Math.pow(2, l / 7));
    t.push(Math.floor(pts / 4));
  }
  return t;
})();

export function xpForLevel(level: number): number {
  return XP_TABLE[Math.max(1, Math.min(MAX_LEVEL, level))];
}

export function levelForXp(xp: number): number {
  let l = 1;
  while (l < MAX_LEVEL && xp >= XP_TABLE[l + 1]) l++;
  return l;
}

export type CargoId =
  | 'logs'
  | 'oak_logs'
  | 'willow_logs'
  | 'copper_ore'
  | 'tin_ore'
  | 'iron_ore'
  | 'coal'
  | 'raw_fish'
  | 'planks'
  | 'bronze_bar'
  | 'iron_bar'
  | 'steel_bar'
  | 'cooked_fish';

export const CARGO: Record<CargoId, { name: string; value: number; color: string }> = {
  logs: { name: 'Logs', value: 4, color: '#8a5a2b' },
  oak_logs: { name: 'Oak logs', value: 8, color: '#a8773f' },
  willow_logs: { name: 'Willow logs', value: 12, color: '#9aa04a' },
  copper_ore: { name: 'Copper ore', value: 5, color: '#c8733a' },
  tin_ore: { name: 'Tin ore', value: 5, color: '#c9c9b5' },
  iron_ore: { name: 'Iron ore', value: 10, color: '#8e4f3f' },
  coal: { name: 'Coal', value: 12, color: '#2a2a2a' },
  raw_fish: { name: 'Raw fish', value: 6, color: '#8fb3c9' },
  planks: { name: 'Planks', value: 10, color: '#c79a5a' },
  bronze_bar: { name: 'Bronze bars', value: 30, color: '#b0793a' },
  iron_bar: { name: 'Iron bars', value: 36, color: '#7d7d85' },
  steel_bar: { name: 'Steel bars', value: 90, color: '#b9bec8' },
  cooked_fish: { name: 'Cooked fish', value: 16, color: '#d9a066' },
};

export type NodeKind =
  | 'tree'
  | 'oak'
  | 'willow'
  | 'copper_rock'
  | 'tin_rock'
  | 'iron_rock'
  | 'coal_rock'
  | 'fishing_spot'
  | 'trout_spot';
export type IndustryKind = 'sawmill' | 'furnace' | 'range';
export type BuildingKind = NodeKind | IndustryKind | 'town';

export interface NodeDef {
  type: 'node';
  name: string;
  produces: CargoId;
  rate: number; // items per second
  cap: number;
  skill: SkillId;
  level: number;
  xp: number; // per item
  verb: string;
}

export interface Recipe {
  inputs: Partial<Record<CargoId, number>>;
  outputs: Partial<Record<CargoId, number>>;
  time: number; // seconds per batch
  skill: SkillId;
  level: number;
  xp: number; // per batch
}

export interface IndustryDef {
  type: 'industry';
  name: string;
  recipes: Recipe[]; // earlier recipes take priority
  cap: number;
}

export interface TownDef {
  type: 'town';
  name: string;
  accepts: CargoId[];
}

export type BuildingDef = NodeDef | IndustryDef | TownDef;

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  tree: { type: 'node', name: 'Tree', produces: 'logs', rate: 0.35, cap: 40, skill: 'woodcutting', level: 1, xp: 25, verb: 'You swing your axe at the tree.' },
  oak: { type: 'node', name: 'Oak tree', produces: 'oak_logs', rate: 0.3, cap: 40, skill: 'woodcutting', level: 15, xp: 37.5, verb: 'You swing your axe at the oak.' },
  willow: { type: 'node', name: 'Willow tree', produces: 'willow_logs', rate: 0.3, cap: 40, skill: 'woodcutting', level: 30, xp: 67.5, verb: 'You swing your axe at the willow.' },
  copper_rock: { type: 'node', name: 'Copper rocks', produces: 'copper_ore', rate: 0.3, cap: 40, skill: 'mining', level: 1, xp: 17.5, verb: 'You swing your pickaxe at the rock.' },
  tin_rock: { type: 'node', name: 'Tin rocks', produces: 'tin_ore', rate: 0.3, cap: 40, skill: 'mining', level: 1, xp: 17.5, verb: 'You swing your pickaxe at the rock.' },
  iron_rock: { type: 'node', name: 'Iron rocks', produces: 'iron_ore', rate: 0.3, cap: 40, skill: 'mining', level: 15, xp: 35, verb: 'You swing your pickaxe at the rock.' },
  coal_rock: { type: 'node', name: 'Coal rocks', produces: 'coal', rate: 0.3, cap: 40, skill: 'mining', level: 30, xp: 50, verb: 'You swing your pickaxe at the rock.' },
  fishing_spot: { type: 'node', name: 'Fishing spot', produces: 'raw_fish', rate: 0.35, cap: 40, skill: 'fishing', level: 1, xp: 10, verb: 'You cast out your net...' },
  trout_spot: { type: 'node', name: 'Trout spot', produces: 'raw_fish', rate: 0.7, cap: 60, skill: 'fishing', level: 20, xp: 50, verb: 'You cast out your fly...' },
  sawmill: {
    type: 'industry',
    name: 'Sawmill',
    cap: 200,
    recipes: [
      { inputs: { willow_logs: 1 }, outputs: { planks: 3 }, time: 1.2, skill: 'construction', level: 1, xp: 40 },
      { inputs: { oak_logs: 1 }, outputs: { planks: 2 }, time: 1, skill: 'construction', level: 1, xp: 20 },
      { inputs: { logs: 1 }, outputs: { planks: 1 }, time: 0.6, skill: 'construction', level: 1, xp: 8 },
    ],
  },
  furnace: {
    type: 'industry',
    name: 'Furnace',
    cap: 200,
    recipes: [
      { inputs: { iron_ore: 1, coal: 2 }, outputs: { steel_bar: 1 }, time: 2, skill: 'smithing', level: 30, xp: 17.5 * 4 },
      { inputs: { iron_ore: 1 }, outputs: { iron_bar: 1 }, time: 1.5, skill: 'smithing', level: 15, xp: 12.5 * 4 },
      { inputs: { copper_ore: 1, tin_ore: 1 }, outputs: { bronze_bar: 1 }, time: 1.5, skill: 'smithing', level: 1, xp: 6.2 * 4 },
    ],
  },
  range: {
    type: 'industry',
    name: 'Cooking range',
    cap: 200,
    recipes: [{ inputs: { raw_fish: 1 }, outputs: { cooked_fish: 1 }, time: 0.8, skill: 'cooking', level: 1, xp: 30 }],
  },
  town: {
    type: 'town',
    name: 'Town',
    accepts: ['planks', 'bronze_bar', 'iron_bar', 'steel_bar', 'cooked_fish'],
  },
};

export function accepts(kind: BuildingKind, cargo: CargoId): boolean {
  const def = BUILDINGS[kind];
  if (def.type === 'town') return def.accepts.includes(cargo);
  if (def.type === 'industry') return def.recipes.some((r) => cargo in r.inputs);
  return false;
}

export type Mode = 'road' | 'rail' | 'air';

export const MODE_BIT: Record<Mode, number> = { road: 1, rail: 2, air: 0 };

export type VehicleId = 'ox_cart' | 'wagon' | 'minecart' | 'steam_train' | 'glider' | 'balloon';

export interface VehicleDef {
  name: string;
  mode: Mode;
  speed: number; // tiles per second
  capacity: number;
  cost: number;
  upkeep: number; // coins per minute
  level: number; // Transport level required
  cars: number; // for drawing trains
}

export const VEHICLES: Record<VehicleId, VehicleDef> = {
  ox_cart: { name: 'Ox cart', mode: 'road', speed: 1.6, capacity: 8, cost: 120, upkeep: 2, level: 1, cars: 1 },
  wagon: { name: 'Horse wagon', mode: 'road', speed: 2.6, capacity: 16, cost: 450, upkeep: 6, level: 8, cars: 1 },
  minecart: { name: 'Mine train', mode: 'rail', speed: 3.6, capacity: 36, cost: 1200, upkeep: 14, level: 12, cars: 3 },
  steam_train: { name: 'Steam train', mode: 'rail', speed: 5.5, capacity: 80, cost: 4000, upkeep: 40, level: 30, cars: 5 },
  glider: { name: 'Gnome glider', mode: 'air', speed: 6.5, capacity: 10, cost: 2500, upkeep: 30, level: 20, cars: 1 },
  balloon: { name: 'Hot-air balloon', mode: 'air', speed: 2.8, capacity: 45, cost: 6000, upkeep: 45, level: 40, cars: 1 },
};

export const STATIONS: Record<Mode, { name: string; cost: number; level: number; radius: number }> = {
  road: { name: 'Road stop', cost: 40, level: 1, radius: 2 },
  rail: { name: 'Rail station', cost: 200, level: 12, radius: 2 },
  air: { name: 'Glider pad', cost: 800, level: 20, radius: 3 },
};

export const INFRA: Record<'road' | 'rail', { name: string; cost: number; level: number }> = {
  road: { name: 'Road', cost: 4, level: 1 },
  rail: { name: 'Rail', cost: 14, level: 12 },
};

export const BRIDGE_MULT = 5;
export const STATION_CARGO_CAP = 300;
export const OFFLINE_CAP_SECONDS = 12 * 3600;
export const START_COINS = 800;

export function levelUnlocks(skill: SkillId, level: number): string[] {
  const out: string[] = [];
  for (const d of Object.values(BUILDINGS)) {
    if (d.type === 'node' && d.skill === skill && d.level === level) out.push(d.name);
    if (d.type === 'industry')
      for (const r of d.recipes)
        if (r.skill === skill && r.level === level && level > 1)
          out.push(`${d.name}: ${Object.keys(r.outputs).map((c) => CARGO[c as CargoId].name).join(', ')}`);
  }
  if (skill === 'transport') {
    for (const v of Object.values(VEHICLES)) if (v.level === level) out.push(v.name);
    for (const s of Object.values(STATIONS)) if (s.level === level && level > 1) out.push(s.name);
    for (const i of Object.values(INFRA)) if (i.level === level && level > 1) out.push(i.name);
  }
  return out;
}

export function nextUnlock(skill: SkillId, level: number): { level: number; names: string[] } | null {
  for (let l = level + 1; l <= MAX_LEVEL; l++) {
    const u = levelUnlocks(skill, l);
    if (u.length) return { level: l, names: u };
  }
  return null;
}
