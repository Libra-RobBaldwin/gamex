// Which of the region's fields are woods (region/fields.ts lays the fields out; this picks among
// them). English lowland is about an eighth woodland, and it isn't scattered: it's where the
// plough never went.
//  - Ancient woodland: big woods in clumps a kilometre or two apart, most of all in the valleys
//    and on the steep sides of the hills (hanging woods).
//  - Wet woodland along the rivers: alder and willow on the small fields by the water.
//  - Copses: the odd small field left to trees, away from the villages.
//  - Shelter belts: the strips the field layout leaves for them.
//  - Conifer plantations on high ground, in blocks.
// Pure: no three.js, no DOM.
import { mix } from './random';

export interface WoodSite {
  x: number; z: number; area: number; // the field's middle and size (m²)
  slope: number; height: number; hMax: number; // the ground there (rise over run), and the highest point on the map
  water: number; town: number; // metres to the water's edge and to the nearest settlement's edge
  belt: boolean; block: number; rand: number;
}
export type WoodKind = 'broadleaf' | 'conifer' | null;

// a smooth value noise (0..1) over `scale` metres
function noise(seed: number) {
  const h = (i: number, j: number) => (mix(seed, i, j) & 0xffff) / 0xffff;
  return (x: number, z: number, scale: number) => {
    const gx = x / scale, gz = z / scale, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * u, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

export function chooseWoods(sites: WoodSite[], o: { seed: number; woods: number; pines: number }): WoodKind[] {
  const n = noise(mix(o.seed, 81)), n2 = noise(mix(o.seed, 82));
  const blockPine = (b: number) => (mix(o.seed, 83, b) & 0xffff) / 0xffff;
  return sites.map((s) => {
    if (s.town < 40) return null; // (the village's own land: its gardens and paddocks)
    const r = s.rand, high = s.hMax > 25 ? s.height / s.hMax : 0;
    // how likely this field is wood, from each reason there'd be one
    let p = 0;
    const clump = n(s.x, s.z, 1300) * 0.75 + n2(s.x, s.z, 450) * 0.25; // (where the old woods are)
    if (clump > 0.64) p = Math.max(p, 0.5 + (clump - 0.64) * 3);
    if (s.slope > 0.12) p = Math.max(p, Math.min(0.6, (s.slope - 0.12) * 5 + 0.25)); // hanging woods on the steepest sides
    if (s.water < 50 && s.area < 3e4) p = Math.max(p, 0.4); // wet woodland by the river
    if (s.area < 1.6e4 && s.town > 250) p = Math.max(p, 0.16); // a copse
    if (high > 0.7) p = Math.max(p, 0.22); // (the rest of the high ground is rough grazing: fields.ts)
    if (s.belt) p = 0.92;
    p *= o.woods;
    if (s.town < 250) p *= 0.3 + 0.7 * (s.town - 40) / 210; // (few right next to a village)
    if (r >= p) return null;
    // plantations: on the high ground, a farm block at a time
    const pine = (high > 0.6 ? 0.55 : 0.12) * Math.min(1, o.pines / 0.3);
    return blockPine(s.block) < pine && !s.belt ? 'conifer' : 'broadleaf';
  });
}
