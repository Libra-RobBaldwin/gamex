// How a map's style looks: the ground's palette and crops (over ground/covers.ts's British ones),
// the woods, and the sky. Temperate is the game as it is (no overrides). Colours are sRGB hex.
// Pure data: game code applies it (GameGround.setStyle, and the trees in main.ts).
import type { CropName } from '../ground/covers';
import type { Style } from './options';

type Palette = Partial<Record<'pasture' | 'pastureDry' | 'pastureCool' | 'rough' | 'lawn' | 'wood' | 'litter' | 'bare' | 'bareDark' | 'wet' | 'rock' | 'scree' | 'heather' | 'moor' | 'daisy' | 'buttercup', string>>;
export interface StyleLook {
  palette: Palette;
  crops: Partial<Record<CropName, { a: string; b: string }>>;
  trees: { density: number; pines: number; crown: string; pine: string }; // share of the woods there'd be, share that are conifers
  sky: string;
}

export const STYLE_LOOKS: Record<Style, StyleLook> = {
  temperate: { palette: {}, crops: {}, trees: { density: 1, pines: 0.3, crown: '#4f8a36', pine: '#2f6b35' }, sky: '#a9cbe3' },
  // dry scrub and sand, irrigated green only in gardens and by water; few, olive-coloured trees
  desert: {
    palette: {
      pasture: '#c7a870', pastureDry: '#d4b67e', pastureCool: '#b99d69', rough: '#b0955f', lawn: '#8e9a58', wood: '#8a7449', litter: '#9a7f55',
      bare: '#c09a6c', bareDark: '#a58159', wet: '#87955a', rock: '#b08e6c', scree: '#c8a883', heather: '#a88765', moor: '#bea372', daisy: '#e8dcc0', buttercup: '#d9b458',
    },
    crops: {
      grass: { a: '#b9a56c', b: '#c4ae74' }, ley: { a: '#8f9656', b: '#99a05c' }, wheat: { a: '#cfb173', b: '#d8bb7c' }, barley: { a: '#d3c08c', b: '#dcc996' },
      plough: { a: '#a8865f', b: '#b39067' }, rape: { a: '#c9b35a', b: '#bfae5c' }, stubble: { a: '#c8b07e', b: '#bfa978' }, stripes: { a: '#8f9a58', b: '#96a05c' },
    },
    trees: { density: 0.25, pines: 0.05, crown: '#7c8a4a', pine: '#5f7040' },
    sky: '#cfd9e0',
  },
  // snow on everything, bare rock showing through, dark conifer woods
  arctic: {
    palette: {
      pasture: '#e6edf1', pastureDry: '#dde6eb', pastureCool: '#d0dde6', rough: '#c7d1d6', lawn: '#e1e9ed', wood: '#a3adaf', litter: '#bcc5c8',
      bare: '#a8a49d', bareDark: '#8f8b85', wet: '#c6d6de', rock: '#8a8e94', scree: '#b3b7bb', heather: '#a7acb1', moor: '#cbd3d6', daisy: '#f4f7f9', buttercup: '#e8ecee',
    },
    crops: {
      grass: { a: '#e3eaee', b: '#dbe3e8' }, ley: { a: '#dfe7eb', b: '#d7e0e5' }, wheat: { a: '#e6e9ea', b: '#dde2e4' }, barley: { a: '#e8ebec', b: '#e0e4e6' },
      plough: { a: '#c9cdcf', b: '#bfc4c7' }, rape: { a: '#e2e6e3', b: '#dadfdc' }, stubble: { a: '#dee3e5', b: '#d5dbde' }, stripes: { a: '#e4ebee', b: '#dce4e8' },
    },
    trees: { density: 0.8, pines: 0.9, crown: '#48664a', pine: '#2b4f3a' },
    sky: '#c7d6e2',
  },
};
