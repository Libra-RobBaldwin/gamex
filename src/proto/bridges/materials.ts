// Bridge materials. Few of them, flat-shaded, with enough contrast to read from a phone at a
// distance: pale sandstone against dark voussoirs, red-oxide trusses, green girders, white
// concrete, grey suspension towers. Everything is double-sided so the low-poly shapes can be built
// without fussing over winding, and one mesh per material keeps a bridge to a handful of draw calls.
import * as THREE from 'three';

export const COLOURS = {
  surface: '#4a4e54', ballast: '#8f887c', rail: '#6f7378', line: '#eeeeea',
  deck: '#a8a49b', concrete: '#e3e0d7', footing: '#b3ada2',
  stone: '#c2ad8c', stoneDark: '#8d7a5f',
  timber: '#86603a', timberDark: '#553d26',
  steelRed: '#9a4630', steelGreen: '#3f6a55', steelGrey: '#7f8d94', steelWhite: '#eef0ee', steelBlue: '#2f5f8f',
  cable: '#f4f4f0', roof: '#4a3f3a',
  bearer: '#2b2622', // the dark steelwork and gaps under an open (unballasted) railway deck
} as const;
export type Mat = keyof typeof COLOURS;

let cache: Record<Mat, THREE.MeshLambertMaterial> | null = null;
export function bridgeMaterials(): Record<Mat, THREE.MeshLambertMaterial> {
  if (cache) return cache;
  const out = {} as Record<Mat, THREE.MeshLambertMaterial>;
  for (const k of Object.keys(COLOURS) as Mat[]) {
    // road surface and markings sit on the deck: pull them forward so they don't flicker
    const lift = k === 'line' || k === 'rail' ? 3 : 0;
    out[k] = new THREE.MeshLambertMaterial({ color: COLOURS[k], side: THREE.DoubleSide, flatShading: true, ...(lift ? { polygonOffset: true, polygonOffsetFactor: -lift, polygonOffsetUnits: -lift } : {}) });
  }
  return (cache = out);
}
