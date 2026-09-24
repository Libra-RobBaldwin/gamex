// Who someone is and what they wear: a role (what they're doing in the town) and an era
// (1900–2030) give their build, hair, clothes, hat, what they carry and how fast they walk.
// Everything comes from the seeded random number passed in, so the same person always looks
// the same. The police are a made-up force (the Shire Constabulary, navy with a teal band),
// and the bus and rail liveries are invented too.
import { hex, pick, pickW, range, shade, type Rand } from './util';

export type Role =
  | 'public' | 'shopper' | 'office' | 'pupil' | 'worker' | 'overalls' | 'driver' | 'rail' | 'police' | 'nurse'
  | 'jogger' | 'cyclist' | 'wheelchair' | 'parent' | 'elderly' | 'child' | 'dogwalker' | 'drinker';
export const ROLES: Role[] = ['public', 'shopper', 'office', 'pupil', 'worker', 'overalls', 'driver', 'rail', 'police', 'nurse', 'jogger', 'cyclist', 'wheelchair', 'parent', 'elderly', 'child', 'dogwalker', 'drinker'];

// what stationary people do; the moving gait comes from speed and what they're riding or pushing
export const Idle = { Stand: 0, Wait: 1, Phone: 2, Sit: 3, Chat: 4, Play: 5 } as const;
export const Hair = { Bald: 0, Short: 1, Bob: 2, Long: 3, Bun: 4 } as const;
export const Hat = { None: 0, FlatCap: 1, Bowler: 2, Trilby: 3, HardHat: 4, Peaked: 5, Beanie: 6, CycleHelmet: 7, Custodian: 8, NurseCap: 9, Boater: 10, SchoolCap: 11, Headscarf: 12 } as const;
export const Carry = { Bag: 1, Briefcase: 2, Backpack: 4, Umbrella: 8, Stick: 16, HiVis: 32, Tie: 64, Elderly: 128, Coat: 256, SkirtKnee: 512, SkirtLong: 1024, Apron: 2048 } as const;
export const Prop = { None: 0, Bike: 1, Pushchair: 2, Wheelchair: 3 } as const;

export interface Look {
  role: Role; child: boolean;
  height: number; // metres
  build: number; // 1 = average width
  idle: number; hair: number; hat: number; carry: number; prop: number;
  top: number; bottom: number; skin: number; hairCol: number; hatCol: number; carryCol: number; trim: number; shoes: number;
  speed: number; // walking speed, m/s
}

// era buckets: 1900s–10s, 20s–40s, 1945–65, 1966–85, 1986–2005, 2006 on
export const eraOf = (year: number) => (year < 1920 ? 0 : year < 1945 ? 1 : year < 1966 ? 2 : year < 1986 ? 3 : year < 2006 ? 4 : 5);
const TOPS = [
  ['#3b3631', '#2d2a28', '#4a3f35', '#23252b', '#5a4b3c', '#6b5f52', '#2c3140', '#77705f'],
  ['#3a3a3f', '#4a4038', '#2a2e38', '#5d5347', '#6e6252', '#35302b', '#7a6a55', '#5a3a36'],
  ['#4a5560', '#6d5b4b', '#8a7d6a', '#2e3a4a', '#a33a3a', '#5a6b4a', '#c9b89a', '#3a3f45', '#7d93a8'],
  ['#c26a2b', '#8a5a2b', '#d9a62a', '#3f6f3a', '#9e3a2e', '#5b3f6a', '#e0d0a8', '#2f5a8a', '#b8573a', '#6b4a2e'],
  ['#2a4f9e', '#c9302c', '#1f7a5a', '#e6e2d8', '#5a2f6a', '#e0a526', '#2b2b2b', '#7a8ea8', '#d95f8a', '#3a8fb8'],
  ['#2b2d31', '#3a4150', '#6b7078', '#1f2e45', '#a9adb3', '#e8e6e0', '#4f6b52', '#8a3b3b', '#c9a24a', '#2f6b8a', '#d0c3a8'],
] as const;
const BOTTOMS = [
  ['#2a2826', '#3a342e', '#23252b', '#4a4038', '#1f1e1d'],
  ['#2e2e33', '#3f3a34', '#26282f', '#4d463e'],
  ['#3a3f45', '#4a4a50', '#2e3a4a', '#5a4b3c', '#6b6b70'],
  ['#3a4f7a', '#5a4632', '#6b5a3a', '#2b3a5a', '#7a6a4a', '#3a3a3a'],
  ['#34507e', '#2b2b2b', '#4a5d7a', '#5a5a60', '#3a4a6a'],
  ['#1f2226', '#2e3a52', '#3a3d42', '#4a4f57', '#5a6a8a', '#2b2b2b'],
] as const;
// skin tones, and how the town's make-up shifts over the century
const SKINS = ['#f1d3bd', '#e8c0a0', '#d9a882', '#c58c62', '#a36e48', '#7d5236', '#5a3a26'];
const SKIN_W = [
  [60, 30, 8, 1, 1, 0, 0], [58, 30, 9, 2, 1, 0, 0], [50, 30, 12, 4, 2, 1, 1],
  [42, 28, 12, 7, 5, 3, 3], [36, 26, 14, 9, 7, 4, 4], [30, 24, 15, 11, 9, 6, 5],
];
const HAIRS = ['#1d1a18', '#2e2219', '#4a3322', '#6b4a2e', '#8a6a3a', '#c9a45a', '#a24a2a', '#e0cfa0'];
const GREYS = ['#9a9590', '#c9c5bf', '#e6e3de', '#7a7470'];
// chance of a hat by era, for everyday people
const HAT_P = [0.9, 0.75, 0.45, 0.15, 0.08, 0.1];
// made-up liveries
const BUS_JACKET = hex('#7a2230'), BUS_TRIM = hex('#e9dcc0');
const POLICE_NAVY = hex('#1b2233'), POLICE_TEAL = hex('#1fa3a0');
const HIVIS_Y = hex('#d7e82a'), HIVIS_O = hex('#f07c1a'), SILVER = hex('#cfd4d8');
const SCHOOL = [['#1f2e5a', '#8a1f2e'], ['#6a1f2e', '#d9b44a'], ['#1f4a2e', '#d9d0b0'], ['#222226', '#c9302c'], ['#2a4f9e', '#e0e0e0']] as const;

// A person for a role and era. `school` picks one school's colours; `fem` shifts hair and skirts.
export function dress(role: Role, year: number, r: Rand, o: { school?: number } = {}): Look {
  const e = eraOf(year);
  const child = role === 'pupil' || role === 'child';
  const elderly = role === 'elderly' || (role === 'public' && r() < 0.15) || (role === 'dogwalker' && r() < 0.25);
  const fem = r() < 0.5;
  let height = child ? range(r, 1.0, 1.55) : (fem ? 1.63 : 1.76) + (r() + r() + r() - 1.5) * 0.09;
  if (elderly) height -= 0.04;
  // the Edwardians were a few centimetres shorter
  if (!child) height -= [0.06, 0.04, 0.02, 0.01, 0, 0][e];
  const build = child ? range(r, 0.85, 1.05) : range(r, 0.88, 1.2) + (elderly ? 0.05 : 0);
  const skin = hex(SKINS[pickFromW(r, SKIN_W[e])]);
  let hairCol = hex(elderly ? pick(r, GREYS) : pick(r, HAIRS));
  let hair: number = elderly && !fem && r() < 0.4 ? Hair.Bald : fem ? (e <= 1 ? pick(r, [Hair.Bun, Hair.Bun, Hair.Bob]) : pick(r, [Hair.Bob, Hair.Long, Hair.Long, Hair.Bun, Hair.Short])) : e === 3 && r() < 0.35 ? Hair.Bob : pick(r, [Hair.Short, Hair.Short, Hair.Short, Hair.Bald]);
  if (child && hair === Hair.Bald) hair = Hair.Short;
  let top = hex(pick(r, TOPS[e])), bottom = hex(pick(r, BOTTOMS[e]));
  let hat: number = Hat.None, hatCol = shade(bottom, 0.8), carry = 0, prop: number = Prop.None, trim = hex('#e8e6e0'), carryCol = hex(pick(r, ['#8a5a2b', '#2b2b2b', '#c9302c', '#e8e6e0', '#2f6fb8', '#d9a62a']));
  const shoes = hex(e >= 4 && r() < 0.4 ? pick(r, ['#e8e8e8', '#2b2b2b', '#3a4a6a']) : pick(r, ['#1c1a18', '#3a2a1e', '#2b2b2b']));
  let speed = range(r, 1.2, 1.55), idle: number = Idle.Stand;
  const skirt = fem && !child ? (e <= 1 ? Carry.SkirtLong : e === 2 ? (r() < 0.8 ? (r() < 0.5 ? Carry.SkirtLong : Carry.SkirtKnee) : 0) : e === 3 ? (r() < 0.5 ? Carry.SkirtKnee : 0) : r() < 0.25 ? Carry.SkirtKnee : 0) : 0;
  carry |= skirt;
  // coats: nearly everyone before the sixties, and people in winter (not modelled yet)
  if (!child && (e <= 2 ? r() < 0.7 : r() < 0.2)) carry |= Carry.Coat;
  const everydayHat = () => {
    if (r() >= HAT_P[e]) return;
    if (fem) { hat = e <= 1 ? pick(r, [Hat.Bowler, Hat.Trilby, Hat.Headscarf]) : e === 2 ? pick(r, [Hat.Headscarf, Hat.Trilby]) : pick(r, [Hat.Beanie, Hat.Headscarf]); hatCol = hex(pick(r, ['#5a2f3a', '#2b2b2b', '#6b5a3a', '#8a3a4a', '#3a4a6a'])); return; }
    hat = e === 0 ? pick(r, [Hat.FlatCap, Hat.FlatCap, Hat.Bowler, Hat.Boater]) : e === 1 ? pick(r, [Hat.FlatCap, Hat.Trilby, Hat.Trilby, Hat.Bowler]) : e === 2 ? pick(r, [Hat.FlatCap, Hat.Trilby]) : pick(r, [Hat.Beanie, Hat.FlatCap]);
    hatCol = hat === Hat.Boater ? hex('#e0cf9a') : hex(pick(r, ['#2b2b2b', '#3a342e', '#4a4038', '#5d5347', '#23252b']));
  };
  if (elderly) { carry |= Carry.Elderly; speed = range(r, 0.8, 1.1); if (r() < 0.3) carry |= Carry.Stick; }
  if (r() < (e >= 4 ? 0.5 : 0.35) && !child) carry |= Carry.Umbrella; // opened only when it rains

  switch (role) {
    case 'office':
      top = hex(pick(r, ['#23283a', '#2e3035', '#3a3f45', '#1f2e45', '#4a4f57'])); bottom = fem && skirt ? top : top;
      carry |= r() < 0.6 ? Carry.Briefcase : Carry.Bag;
      carryCol = hex(pick(r, ['#2b2b2b', '#4a3322', '#1c1a18']));
      if (!fem && r() < (e >= 5 ? 0.35 : 0.9)) { carry |= Carry.Tie; trim = hex(pick(r, ['#8a1f2e', '#1f3f6a', '#2e5a3a', '#c9a24a', '#6a2f5a'])); }
      if (e <= 2 && !fem && r() < 0.8) { hat = e === 0 ? Hat.Bowler : Hat.Trilby; hatCol = hex('#1c1a18'); }
      speed = range(r, 1.35, 1.65);
      break;
    case 'pupil': {
      const s = SCHOOL[(o.school ?? 0) % SCHOOL.length];
      top = hex(s[0]); bottom = hex(fem && r() < 0.7 ? '#4a4a50' : '#5a5a60'); trim = hex(s[1]);
      carry = (fem && r() < 0.6 ? Carry.SkirtKnee : 0) | Carry.Tie | (e >= 4 || r() < 0.3 ? Carry.Backpack : Carry.Bag);
      carryCol = hex(pick(r, ['#2b2b2b', '#2f6fb8', '#c9302c', '#6a2f5a', '#3f7a4a']));
      if (e <= 2 && !fem) { hat = Hat.SchoolCap; hatCol = top; } else if (e === 0 && fem) { hat = Hat.Boater; hatCol = hex('#e0cf9a'); }
      idle = pick(r, [Idle.Play, Idle.Play, Idle.Chat, Idle.Stand]);
      speed = range(r, 1.2, 1.6);
      break;
    }
    case 'child':
      carry &= ~(Carry.SkirtKnee | Carry.SkirtLong);
      top = hex(pick(r, ['#c9302c', '#2f6fb8', '#e0a526', '#3f7a4a', '#d95f8a', '#6ab0d9', '#e8e6e0'])); idle = Idle.Play;
      if (e <= 1) { top = hex(pick(r, TOPS[e])); if (!fem) { hat = Hat.FlatCap; hatCol = shade(top, 0.8); } }
      speed = range(r, 1.1, 1.5);
      break;
    case 'worker':
      // hard hats from the seventies, high-visibility clothing from the eighties
      if (e >= 3) { hat = Hat.HardHat; hatCol = hex(pick(r, ['#f2f2f2', '#e8c21f', '#e8c21f', '#2f6fb8', '#e07a1f'])); }
      else { hat = Hat.FlatCap; hatCol = hex(pick(r, ['#2b2b2b', '#3a342e', '#4a4038'])); }
      if (e >= 4) { carry |= Carry.HiVis; top = r() < 0.7 ? HIVIS_Y : HIVIS_O; trim = SILVER; }
      else top = hex(pick(r, ['#2e3a4a', '#3a342e', '#4a4038', '#2b3a5a']));
      bottom = hex(pick(r, ['#2b3a5a', '#2b2b2b', '#3a3a3a']));
      carry &= ~(Carry.SkirtLong | Carry.SkirtKnee | Carry.Coat | Carry.Umbrella);
      if (r() < 0.4) { carry |= Carry.Bag; carryCol = hex(pick(r, ['#3a4a6a', '#2b2b2b'])); }
      break;
    case 'overalls':
      top = bottom = hex(pick(r, e <= 2 ? ['#3a4a6a', '#4a4038', '#5a5a50'] : ['#2f4f8a', '#2f4f8a', '#3a6a4a', '#e07a1f']));
      carry &= ~(Carry.SkirtLong | Carry.SkirtKnee | Carry.Coat);
      if (e >= 5 && r() < 0.5) { carry |= Carry.HiVis; trim = SILVER; }
      if (e <= 2) { hat = Hat.FlatCap; hatCol = hex('#2b2b2b'); }
      break;
    case 'driver':
      top = BUS_JACKET; bottom = hex('#23252b'); trim = BUS_TRIM; carry = Carry.Tie;
      if (e <= 3) { hat = Hat.Peaked; hatCol = BUS_JACKET; }
      break;
    case 'rail':
      if (e >= 4) { top = HIVIS_O; carry = Carry.HiVis; trim = SILVER; bottom = hex('#1f2e45'); }
      else { top = hex('#1f2e45'); bottom = hex('#1f2e45'); carry = Carry.Tie; trim = hex('#c9a24a'); hat = Hat.Peaked; hatCol = hex('#1f2e45'); }
      break;
    case 'police':
      top = POLICE_NAVY; bottom = POLICE_NAVY; trim = POLICE_TEAL; carry = Carry.Tie | (e >= 4 ? Carry.HiVis : 0);
      if (e >= 4) { top = hex('#c7e02a'); trim = POLICE_TEAL; }
      hat = e <= 3 && !fem ? Hat.Custodian : Hat.Peaked; hatCol = POLICE_NAVY;
      speed = range(r, 1.0, 1.25);
      break;
    case 'nurse':
      top = hex(pick(r, ['#8fb0d9', '#1f2e5a', '#6a9ad0'])); bottom = e <= 3 ? top : hex('#1f2e5a'); trim = hex('#f2f2f2');
      carry = e <= 2 ? Carry.Apron | Carry.SkirtKnee : 0;
      if (e <= 2) { hat = Hat.NurseCap; hatCol = hex('#f2f2f2'); }
      break;
    case 'shopper':
      carry |= Carry.Bag;
      if (e >= 5 && r() < 0.3) carry |= Carry.Backpack;
      carryCol = hex(pick(r, ['#e8e6e0', '#3f7a4a', '#c9302c', '#2f6fb8', '#e0a526', '#8a5a2b', '#d95f8a']));
      everydayHat();
      speed = range(r, 1.05, 1.4); idle = pick(r, [Idle.Stand, Idle.Chat, Idle.Phone]);
      break;
    case 'jogger':
      top = hex(pick(r, ['#e04a8a', '#2fb0e0', '#e8e8e8', '#2b2b2b', '#e0e02a', '#e07a1f'])); bottom = hex(pick(r, ['#1c1c1c', '#2b2b2b', '#3a4a6a']));
      carry = 0; hat = r() < 0.2 ? Hat.Beanie : Hat.None; hatCol = top; speed = range(r, 2.6, 3.4);
      if (hair === Hair.Long) hair = Hair.Bun;
      break;
    case 'cyclist':
      prop = Prop.Bike; carry &= Carry.Backpack | Carry.Tie; speed = range(r, 4, 6);
      if (e >= 4 && r() < 0.6) { hat = Hat.CycleHelmet; hatCol = hex(pick(r, ['#e8e8e8', '#2b2b2b', '#c9302c', '#2f6fb8'])); }
      else if (e <= 2) { hat = Hat.FlatCap; hatCol = hex('#2b2b2b'); }
      if (e >= 5 && r() < 0.4) { carry |= Carry.HiVis; top = HIVIS_Y; trim = SILVER; }
      if (e >= 4 && r() < 0.4) carry |= Carry.Backpack;
      break;
    case 'wheelchair':
      prop = Prop.Wheelchair; carry &= ~(Carry.Stick | Carry.SkirtLong | Carry.Umbrella); speed = range(r, 0.9, 1.2); idle = Idle.Sit;
      break;
    case 'parent':
      prop = Prop.Pushchair; carry &= ~(Carry.Stick | Carry.Umbrella | Carry.Briefcase); speed = range(r, 1.0, 1.3);
      if (r() < 0.4) carry |= Carry.Bag;
      break;
    case 'drinker':
      idle = pick(r, [Idle.Chat, Idle.Chat, Idle.Stand, Idle.Phone]);
      everydayHat();
      break;
    default:
      everydayHat();
      if (role === 'dogwalker') { speed = Math.min(speed, 1.25); if (e >= 3 && r() < 0.3) { carry |= Carry.Coat; top = hex(pick(r, ['#3f5a3a', '#4a4038', '#2e3a4a'])); } }
      if (role === 'public' && r() < 0.25) carry |= Carry.Bag;
      if (e >= 5 && r() < 0.3) carry |= Carry.Backpack;
      idle = pick(r, [Idle.Stand, Idle.Wait, Idle.Wait]);
  }
  // phones: from the late 2000s, people waiting look at them
  if (e >= 5 && !child && (idle === Idle.Wait || idle === Idle.Stand) && r() < 0.45) idle = Idle.Phone;
  if (e < 5 && idle === Idle.Phone) idle = Idle.Wait;
  if (child && !(carry & (Carry.Bag | Carry.Backpack))) carry &= ~Carry.Umbrella;
  return { role, child, height, build, idle, hair, hat, carry, prop, top, bottom, skin, hairCol, hatCol, carryCol, trim, shoes, speed };
}
function pickFromW(r: Rand, w: readonly number[]) { return pickW(r, w.map((x, i) => [i, x] as const)); }

// A role mix: how likely each kind of person is in a place ("a high street at lunchtime").
export type Mix = Partial<Record<Role, number>>;
export const MIXES = {
  street: { public: 5, shopper: 3, office: 1, elderly: 1, parent: 0.6, cyclist: 0.4, jogger: 0.2, wheelchair: 0.15, child: 0.4, dogwalker: 0.4, police: 0.05 },
  highStreet: { shopper: 6, public: 3, office: 1, elderly: 1.2, parent: 0.8, wheelchair: 0.2, child: 0.4, police: 0.08, cyclist: 0.2 },
  commute: { office: 3, public: 2, worker: 1, nurse: 0.2, cyclist: 0.5 },
  works: { worker: 6, overalls: 3, office: 0.5 },
  park: { public: 3, dogwalker: 3, jogger: 1, parent: 1, elderly: 1.5, child: 1, cyclist: 0.3, wheelchair: 0.2 },
  pub: { drinker: 1 },
  station: { public: 3, office: 3, shopper: 1, elderly: 0.6, rail: 0.1, wheelchair: 0.1, parent: 0.2, cyclist: 0.2 },
} satisfies Record<string, Mix>;
export function roleOf(r: Rand, mix: Mix, year: number): Role {
  const list = (Object.entries(mix) as [Role, number][]).filter(([role]) => year >= 1975 || role !== 'jogger');
  return pickW(r, list);
}
