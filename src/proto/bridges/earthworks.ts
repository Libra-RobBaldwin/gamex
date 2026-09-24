// Earthworks: the ground reshaped to carry a road or railway, as cross-sections (the formation
// with its cess or verges, then an embankment or a cutting, then a ditch), and one shared ground
// look that makes reshaped ground read from the game's camera. The look is a single material:
// vertex colours say what the surface is (grass, cinder cess, ditch, soil, rock), a small tiling
// texture in world space gives it grain and broad patches, and the shader tints slopes by their
// real normals: rougher, yellower grass with terracettes along the contours. The builder paints
// each slope from a pale crest to a dark, lush toe, and puts a drainage ditch at its foot.
import * as THREE from 'three';
import { kerbOf, type RoadDef } from '../catalog';
import { BALLAST_DEPTH, bedWidth } from './track';

export const BATTER = 2; // embankment and soil cutting slopes: horizontal per vertical
export const ROCK_BATTER = 0.5; // deep cuttings stand steeper, in rock
export const ROCK_FROM = 4; // cuttings deeper than this are rock
export const SOIL_FROM = 1.2; // and deeper than this, bare soil (shallow ones grass over)
export const DITCH = { depth: 0.35, side: 0.5, bottom: 0.3 };
export const CESS_FALL = 1 / 30; // the formation falls away from the track to shed water
export const VERGE_DROP = 0.12; // a road's surface stands this far above its verge

// What a stretch of section is. The route's own surface ('bed', drawn by track.ts; 'surface',
// 'line', 'centre' (a dashed line), 'kerb', 'footway') is drawn with the bridge materials; the rest is earth.
export type EarthKind = 'ground' | 'verge' | 'cess' | 'slope' | 'ditch' | 'soil' | 'rock' | 'bank' | 'turf' | 'topsoil' | 'subsoil' | 'bedrock';
export type RouteKind = 'bed' | 'surface' | 'line' | 'centre' | 'kerb' | 'footway';
export type SectionKind = EarthKind | RouteKind;
// A point on a half-section (n ≥ 0 from the centreline), and what the stretch arriving at it is.
export interface SectionPt { n: number; y: number; kind: SectionKind }
export const isEarth = (k: SectionKind): k is EarthKind => !(['bed', 'surface', 'line', 'centre', 'kerb', 'footway'] as SectionKind[]).includes(k);

export const EARTH_COLOURS: Record<EarthKind | 'crest' | 'toe', string> = {
  ground: '#79a653', verge: '#80aa57', cess: '#6d665b', ditch: '#4b6233',
  crest: '#a9b062', toe: '#56803a', // slopes run from dry, pale grass at the top to lush at the foot
  slope: '#8fa95a', soil: '#8c6c47', rock: '#8b867d', bank: '#8d8a62',
  turf: '#5f8a3e', topsoil: '#5b4632', subsoil: '#9b7a4c', bedrock: '#7c7872',
};
// how much of the grass treatment a surface gets (texture grain, slope tint, terracettes)
export const GRASSY: Record<EarthKind, number> = { ground: 1, verge: 1, slope: 1, ditch: 0.6, cess: 0, soil: 0.15, rock: 0, bank: 0, turf: 0, topsoil: 0, subsoil: 0, bedrock: 0 };

// The road's own surface across one half of the route, heights relative to its level. On a
// deck the footway or hard strip runs to the parapet; on the ground it gives way to a verge that
// sits a little lower, so the carriageway stands on its own raised pavement.
export function roadTop(road: RoadDef, hw: number, onDeck: boolean): { n: number; dy: number; kind: SectionKind }[] {
  const kerb = kerbOf(road), out: { n: number; dy: number; kind: SectionKind }[] = [];
  if (road.median > 0) out.push({ n: road.median / 2 + 0.17, dy: 0, kind: 'surface' }, { n: road.median / 2 + 0.33, dy: 0, kind: 'line' });
  else out.push({ n: 0.08, dy: 0, kind: 'centre' });
  const e = kerb - road.shoulder - 0.25; // edge line, just inside the carriageway (or the hard shoulder)
  out.push({ n: e - 0.08, dy: 0, kind: 'surface' }, { n: e + 0.08, dy: 0, kind: 'line' }, { n: kerb, dy: 0, kind: 'surface' });
  if (road.pave > 0) {
    out.push({ n: kerb + 0.03, dy: 0.12, kind: 'kerb' }, { n: kerb + road.pave, dy: 0.12, kind: 'footway' });
    if (onDeck) out.push({ n: hw, dy: 0.12, kind: 'footway' });
    else out.push({ n: kerb + road.pave + 0.1, dy: 0.05, kind: 'footway' }, { n: hw, dy: 0.05 - (hw - kerb - road.pave - 0.1) * CESS_FALL, kind: 'verge' });
  } else if (onDeck) out.push({ n: hw, dy: 0, kind: 'surface' });
  else out.push({ n: kerb + 0.5, dy: 0, kind: 'surface' }, { n: kerb + 0.8, dy: -VERGE_DROP, kind: 'surface' }, { n: hw, dy: -VERGE_DROP - (hw - kerb - 0.8) * CESS_FALL, kind: 'verge' });
  return out;
}

// A half-section (centreline out) mirrored into a whole one, left to right: the points, and the
// kind of each stretch between them. The stretch across the centreline is one.
export function mirrored<T extends { n: number; kind: SectionKind }>(half: T[]) {
  const pts = [...half.slice().reverse().map((p) => ({ ...p, n: -p.n })), ...half];
  const kinds = [...half.slice(1).reverse().map((p) => p.kind), half[0].kind, ...half.slice(1).map((p) => p.kind)];
  return { pts, kinds };
}

// The dashed centre line: 3 m dashes every 9 m, in step along the whole route.
export const DASH = { every: 9, from: 2, len: 3 };
export const dashOn = (s: number) => { const m = ((s % DASH.every) + DASH.every) % DASH.every; return m >= DASH.from && m < DASH.from + DASH.len; };
export function dashCuts(s0: number, s1: number) {
  const out: number[] = [];
  for (let k = Math.floor(s0 / DASH.every); k * DASH.every < s1; k++) for (const d of [DASH.from, DASH.from + DASH.len]) { const s = k * DASH.every + d; if (s > s0 && s < s1) out.push(s); }
  return out;
}

// One half of the route's cross-section on the ground, from the centreline out: its formation to
// the crest at `hw` (the deck's half-width, so bridge and approach line up), then an embankment
// down to `ground` or a cutting up to it, and a ditch at the low side. The number of points never
// changes, so sections can be swept along a route that goes from embankment to cutting.
export function halfSection(road: RoadDef, hw: number, level: number, ground: number): SectionPt[] {
  const out: SectionPt[] = [];
  if (road.cls === 'rail') {
    const toe = bedWidth(road.tracks).toe;
    out.push({ n: toe, y: level - BALLAST_DEPTH, kind: 'bed' }, { n: hw, y: level - BALLAST_DEPTH - (hw - toe) * CESS_FALL, kind: 'cess' });
  } else for (const p of roadTop(road, hw, false)) out.push({ n: p.n, y: level + p.dy, kind: p.kind });
  const crest = out[out.length - 1], d = DITCH;
  if (crest.y >= ground) {
    // embankment: slope down to the toe, then a ditch alongside
    const toe = crest.n + BATTER * (crest.y - ground);
    out.push({ n: toe, y: ground, kind: 'slope' }, { n: toe + d.side, y: ground - d.depth, kind: 'ditch' }, { n: toe + d.side + d.bottom, y: ground - d.depth, kind: 'ditch' }, { n: toe + 2 * d.side + d.bottom, y: ground, kind: 'ditch' });
  } else {
    // cutting: a ditch at the foot of the side, then the side up to the ground
    const deep = ground - crest.y, kind: SectionKind = deep > ROCK_FROM ? 'rock' : deep > SOIL_FROM ? 'soil' : 'slope';
    const foot = crest.n + 2 * d.side + d.bottom;
    out.push({ n: crest.n + d.side, y: crest.y - d.depth, kind: 'ditch' }, { n: crest.n + d.side + d.bottom, y: crest.y - d.depth, kind: 'ditch' }, { n: foot, y: crest.y, kind: 'ditch' },
      { n: foot + (kind === 'rock' ? ROCK_BATTER : BATTER) * deep, y: ground, kind });
  }
  return out;
}
// How far out from the centreline the earthworks reach.
export const sectionReach = (s: SectionPt[]) => s[s.length - 1].n;

// ---------- the ground look ----------

// A tileable 256² noise texture: R fine grain (grass clumps, gravel), G broad patches, B tussocks.
let tex: THREE.DataTexture | null = null;
export function earthTexture() {
  if (tex) return tex;
  const N = 256, data = new Uint8Array(N * N * 4);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // value noise on a periodic lattice, so the texture tiles
  const lattice = (P: number) => { const v = Array.from({ length: P * P }, rnd); return (x: number, y: number) => {
    const fx = (x / N) * P, fy = (y / N) * P, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
    const a = v[(j % P) * P + (i % P)], b = v[(j % P) * P + ((i + 1) % P)], c = v[((j + 1) % P) * P + (i % P)], d = v[((j + 1) % P) * P + ((i + 1) % P)];
    const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
    return a + (b - a) * su + (c - a) * sw + (a - b - c + d) * su * sw;
  }; };
  const oct = (spec: [number, number][]) => { const fs = spec.map(([P, amp]) => [lattice(P), amp] as const); return (x: number, y: number) => fs.reduce((t, [f, a]) => t + f(x, y) * a, 0); };
  const fine = oct([[16, 0.45], [32, 0.3], [64, 0.25]]), broad = oct([[4, 0.6], [8, 0.4]]), tuft = oct([[8, 0.5], [16, 0.5]]);
  const ch = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const k = y * N + x; ch[0][k] = fine(x, y) + (rnd() - 0.5) * 0.12; ch[1][k] = broad(x, y); ch[2][k] = tuft(x, y); }
  // stretch each channel to the full range
  for (let c = 0; c < 3; c++) {
    let lo = Infinity, hi = -Infinity;
    for (const v of ch[c]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let k = 0; k < N * N; k++) data[k * 4 + c] = Math.round(((ch[c][k] - lo) / (hi - lo)) * 255);
  }
  for (let k = 0; k < N * N; k++) data[k * 4 + 3] = 255;
  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// The ground material: flat-shaded Lambert with vertex colours, plus a little shader work. The
// texture is sampled by world position (no UVs needed), from above on the ground and from the side
// on cut faces. Slopes are found from the real face normal, so any reshaped ground gets the look.
let mat: THREE.MeshLambertMaterial | null = null;
export function earthMaterial() {
  if (mat) return mat;
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEarth = { value: earthTexture() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float grassy;\nvarying float vGrassy;\nvarying vec3 vEarthPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrassy = grassy;\nvEarthPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uEarth;\nvarying float vGrassy;\nvarying vec3 vEarthPos;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 wn = normalize(cross(dFdx(vEarthPos), dFdy(vEarthPos)));
        float up = abs(wn.y), g = vGrassy;
        vec2 p = up > 0.5 ? vEarthPos.xz : (abs(wn.x) > abs(wn.z) ? vEarthPos.zy : vEarthPos.xy);
        vec4 f = texture2D(uEarth, p * (1.0 / 7.0));
        vec4 b = texture2D(uEarth, p * (1.0 / 97.0) + vec2(0.37, 0.61));
        // grain: grass clumps, or a coarser grain for gravel, soil and rock
        diffuseColor.rgb *= mix(0.8 + 0.4 * f.r, 0.87 + 0.26 * f.r, g);
        // broad patches of lusher and drier grass
        diffuseColor.rgb *= 1.0 + g * (b.g - 0.5) * 0.24;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.07, 1.04, 0.84), g * smoothstep(0.5, 0.85, b.b) * 0.6);
        // slopes: rough, tussocky grass, and terracettes along the contours (faded out before they alias)
        float sinA = length(wn.xz), rough = g * smoothstep(0.2, 0.42, sinA);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.04, 0.84) * (0.86 + 0.28 * f.b), rough * 0.7);
        float t = vEarthPos.y / 0.55 + (f.b - 0.5) * 0.6, d = min(fract(t), 1.0 - fract(t));
        float fade = 1.0 - smoothstep(0.18, 0.45, fwidth(t));
        diffuseColor.rgb *= 1.0 - 0.1 * (1.0 - smoothstep(0.05, 0.17, d)) * rough * fade;
      }`);
  };
  m.customProgramCacheKey = () => 'earth-2';
  return (mat = m);
}

// Triangles for the earth material, with a colour and a grass factor per vertex.
export class EarthGeo {
  pos: number[] = []; col: number[] = []; grass: number[] = [];
  private cols = new Map<string, THREE.Color>(); // parsed once each: a scene has a handful of colours
  vert(p: number[], colour: string, grassy: number) {
    let c = this.cols.get(colour);
    if (!c) this.cols.set(colour, (c = new THREE.Color(colour)));
    this.pos.push(p[0], p[1], p[2]); this.col.push(c.r, c.g, c.b); this.grass.push(grassy);
  }
  // a quad a→b→c→d with a colour and grass factor at each corner
  quad(p: number[][], colour: string[], grassy: number[]) {
    for (const i of [0, 1, 2, 0, 2, 3]) this.vert(p[i], colour[i], grassy[i]);
  }
  get empty() { return !this.pos.length; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('grassy', new THREE.Float32BufferAttribute(this.grass, 1));
    g.computeVertexNormals();
    return g;
  }
}

// Colour and grass factor at either end of a stretch of section: slopes run from the crest colour
// at their upper end to the toe colour at the lower.
export function earthPaint(kind: EarthKind, upper: boolean): [string, number] {
  if (kind === 'slope') return [upper ? EARTH_COLOURS.crest : EARTH_COLOURS.toe, 1];
  return [EARTH_COLOURS[kind], GRASSY[kind]];
}
