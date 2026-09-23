// Hand-made 16x16 pixel sprites, baked to offscreen canvases at startup.

const PAL: Record<string, string> = {
  k: '#1b1410', // outline
  g: '#2f5a1c', G: '#4d8a2a', l: '#7cbf3a', // greens
  d: '#2b4a1a', D: '#3d6b24', e: '#5f8f33', // oak greens
  v: '#6f9a3a', V: '#94c04e', // willow greens
  b: '#6b4423', B: '#432a15', // trunk
  s: '#7d7d7d', S: '#4e4e4e', L: '#ababab', // stone
  r: '#b0412c', R: '#6e2418', // roof
  p: '#c79a5a', P: '#8f6a3a', // plank walls
  w: '#f4e7a1', // lit window
  o: '#ff9a1f', O: '#ffd84a', // fire
  y: '#e8c547', // gold
  c: '#c8733a', t: '#d8d8c8', i: '#9a503c', C: '#141414', // ores
  u: '#2d5d9a', U: '#7ab8ea', // water
  m: '#e6d6b0', // cloth
  n: '#8a6a44', // wood dark
};

type Sprite = HTMLCanvasElement;

function bake(rows: string[], pal: Record<string, string> = {}): Sprite {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const ch = row[x] ?? '.';
      if (ch === '.' || ch === ' ') continue;
      ctx.fillStyle = pal[ch] ?? PAL[ch] ?? '#f0f';
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

const TREE = [
  '................',
  '......kkkk......',
  '....kkGGGGkk....',
  '...kGGlGGGGGk...',
  '..kGGlGGGGlGGk..',
  '..kGGGGGGGGGGk..',
  '.kGGGlGGGGGlGGk.',
  '.kgGGGGGGGGGGgk.',
  '.kggGGGGlGGGggk.',
  '..kggGGGGGGggk..',
  '...kkggggggkk...',
  '.....kkbbkk.....',
  '.......bB.......',
  '.......bB.......',
  '......bbBB......',
  '................',
];

const WILLOW = [
  '................',
  '.....kkkkkk.....',
  '...kkVVVVVVkk...',
  '..kVVvVVVVvVVk..',
  '.kVvVVvVVvVVvVk.',
  '.kVvVvVvvVvVvVk.',
  'kVvkvVvbbvVvkvVk',
  'kv.kv.vbBv.vk.vk',
  'kv.kv..bB..vk.vk',
  '.v..v..bB..v..v.',
  '.v..v..bB..v..v.',
  '.......bB.......',
  '.......bB.......',
  '......bbBB......',
  '................',
  '................',
];

const ROCK = [
  '................',
  '................',
  '................',
  '.....kkkkk......',
  '....kLssssk.....',
  '...kLsLsxsskk...',
  '..kLssssssxssk..',
  '..ksxssssssssk..',
  '.kssssssxsssSSk.',
  '.ksxsssssssssSk.',
  '.kSssssxsssxsSk.',
  '..kSSssssssSSk..',
  '...kkSSSSSSkk...',
  '.....kkkkkk.....',
  '................',
  '................',
];

const HOUSE = [
  '................',
  '.......kk.......',
  '......krrk......',
  '.....krrrrk.....',
  '....krrrrrrk....',
  '...krrrrrrrrk...',
  '..krrrrrrrrrrk..',
  '..kRRRRRRRRRRk..',
  '...kppppppppk...',
  '...kpwwppwwpk...',
  '...kpwwppwwpk...',
  '...kppppppppk...',
  '...kppbbpppPk...',
  '...kppbbpppPk...',
  '...kkkkkkkkkk...',
  '................',
];

const SAWMILL = [
  '................',
  '....kkkkkkkk....',
  '...knnnnnnnnk...',
  '..knnnnnnnnnnk..',
  '.knnnnnnnnnnnnk.',
  '.kkkkkkkkkkkkkk.',
  '..kpPpPpPpPpPk..',
  '..kpPpkkkkPpPk..',
  '..kpPpkLLkPpPk..',
  '..kpPpkLLkPpPk..',
  '..kpPpkkkkPpPk..',
  '..kkkkkkkkkkkk..',
  'kbbkbbkbbk......',
  'kbBkbBkbBk......',
  '.kk.kk.kk.......',
  '................',
];

const FURNACE = [
  '.........kk.....',
  '.........kSk....',
  '.........kSk....',
  '....kkkkkkSkk...',
  '...kLsssssssk...',
  '..kLssssssssSk..',
  '..ksssSSSSssSk..',
  '..kssSkkkkSsSk..',
  '..kssSkookSsSk..',
  '..kssSkOOkSsSk..',
  '..kssSkookSsSk..',
  '..ksssSSSSssSk..',
  '..kSssssssssSk..',
  '..kSSSSSSSSSSk..',
  '..kkkkkkkkkkkk..',
  '................',
];

const RANGE = [
  '................',
  '..........kk....',
  '..........kSk...',
  '.....kkkkkkSk...',
  '....krrrrrrrrk..',
  '...krrrrrrrrrrk.',
  '..kRRRRRRRRRRRRk',
  '...kppppppppppk.',
  '...kpkkkkpwwppk.',
  '...kpkookpwwppk.',
  '...kpkOOkppppPk.',
  '...kpkkkkppppPk.',
  '...kppppppppPPk.',
  '...kkkkkkkkkkkk.',
  '................',
  '................',
];

const STOP = [
  '................',
  '................',
  '...kkkkkkkkkk...',
  '..kyyyyyyyyyyk..',
  '..kkkkkkkkkkkk..',
  '...kb......bk...',
  '...kb......bk...',
  '...kb.kkkk.bk...',
  '...kb.knnk.bk...',
  '...kb.kkkk.bk...',
  '...kb......bk...',
  '..kkkkkkkkkkkk..',
  '..kLLLLLLLLLLk..',
  '..kkkkkkkkkkkk..',
  '................',
  '................',
];

const STATION = [
  '................',
  '.kkkkkkkkkkkkkk.',
  'kRrrrrrrrrrrrrRk',
  'kRRRRRRRRRRRRRRk',
  '.kb..kkkkkk..bk.',
  '.kb..kpwwpk..bk.',
  '.kb..kpwwpk..bk.',
  '.kb..kppppk..bk.',
  '.kb..kpbbpk..bk.',
  'kkkkkkkkkkkkkkkk',
  'kLLLLLLLLLLLLLLk',
  'kSSSSSSSSSSSSSSk',
  'kkkkkkkkkkkkkkkk',
  '................',
  '................',
  '................',
];

const PAD = [
  '................',
  '..........kk....',
  '..........kok...',
  '..........kmok..',
  '....kkkkkkkmk...',
  '...knnnnnnnkn...',
  '..knppppppppnk..',
  '.knppkkkkkkppnk.',
  '.knpkyyyyyykpnk.',
  '.knpkykkkkykpnk.',
  '.knpkyyyyyykpnk.',
  '.knppkkkkkkppnk.',
  '..knppppppppnk..',
  '...knnnnnnnnk...',
  '....kkkkkkkk....',
  '................',
];

// Vehicles face right (east).
const OXCART = [
  '................',
  '................',
  '................',
  '................',
  '..kkkkkk........',
  '.knnnnnnk.......',
  '.knPPPPnk..kkk..',
  '.knnnnnnkbkmmmkk',
  '.kkkkkkkk.kmmmmk',
  '..kBk.kBk.kmkmk.',
  '..kkk.kkk..k.k..',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const WAGON = [
  '................',
  '................',
  '................',
  '..kkkkkkkk......',
  '.kmmmmmmmmk.....',
  '.kmmmmmmmmk.....',
  '.knnnnnnnnk..kk.',
  '.knPPPPPPnkbkBBk',
  '.kkkkkkkkkk.kBBk',
  '..kBk..kBk..kBk.',
  '..kkk..kkk..k.k.',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const ENGINE = [
  '................',
  '................',
  '................',
  '..kkk...........',
  '..kSk..kkkkk....',
  '..kSk.kkLLLkk...',
  '.kkkkkkkLwLkk...',
  'kSSSSSSSkkkkkk..',
  'kSrrSSSSSSSSSSk.',
  'kSSSSSSSSSSSSSkk',
  '.kkkkkkkkkkkkkk.',
  '..kLk..kLk.kLk..',
  '..kkk..kkk.kkk..',
  '................',
  '................',
  '................',
];

const CAR = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..kkkkkkkkkkkk..',
  '..knnnnnnnnnnk..',
  '..knPnPnPnPnnk..',
  '..knnnnnnnnnnk..',
  '..kkkkkkkkkkkk..',
  '..kLk......kLk..',
  '..kkk......kkk..',
  '................',
  '................',
  '................',
  '................',
];

const GLIDER = [
  '................',
  '................',
  '.......kk.......',
  '......kmmk......',
  '.....kmmmk......',
  '....kmmmmk......',
  'kk.kmmmmmk......',
  'knkkkkkkkkkkkk..',
  'knnnnnnnnnnnnnkk',
  'kk.kkkkkkkkkkk..',
  '....kmmmmk......',
  '.....kmmmk......',
  '......kmmk......',
  '.......kk.......',
  '................',
  '................',
];

const BALLOON = [
  '.....kkkkkk.....',
  '...kkrrmmrrkk...',
  '..krrmmrrmmrrk..',
  '.krrmmrrmmrrmrk.',
  '.krmmrrmmrrmmrk.',
  '.krmmrrmmrrmmrk.',
  '.krrmmrrmmrrmrk.',
  '..krrmmrrmmrrk..',
  '...krmmrrmmrk...',
  '....kkrrmmkk....',
  '.....k....k.....',
  '.....k....k.....',
  '.....kkkkkk.....',
  '.....knnnnk.....',
  '.....kkkkkk.....',
  '................',
];

const LOCK = [
  '....kkkk',
  '...k....k',
  '...k....k',
  '..kkkkkkkk',
  '..kyyyyyyk',
  '..kyykkyyk',
  '..kyyyyyyk',
  '..kkkkkkkk',
];

export interface Sprites {
  [name: string]: Sprite;
}

export function makeSprites(): Sprites {
  return {
    tree: bake(TREE),
    oak: bake(TREE, { G: PAL.D, l: PAL.e, g: PAL.d }),
    willow: bake(WILLOW),
    copper_rock: bake(ROCK, { x: PAL.c }),
    tin_rock: bake(ROCK, { x: PAL.t }),
    iron_rock: bake(ROCK, { x: PAL.i }),
    coal_rock: bake(ROCK, { x: PAL.C }),
    house: bake(HOUSE),
    house2: bake(HOUSE, { r: '#3f6fa3', R: '#243f63' }),
    house3: bake(HOUSE, { r: '#7a7a7a', R: '#4a4a4a' }),
    sawmill: bake(SAWMILL),
    furnace: bake(FURNACE),
    range: bake(RANGE),
    stop_road: bake(STOP),
    stop_rail: bake(STATION),
    stop_air: bake(PAD),
    ox_cart: bake(OXCART),
    wagon: bake(WAGON),
    minecart: bake(ENGINE, { S: '#6b4a2a', r: '#e0b030' }),
    steam_train: bake(ENGINE),
    car: bake(CAR),
    glider: bake(GLIDER),
    balloon: bake(BALLOON),
    lock: bake(LOCK),
  };
}
