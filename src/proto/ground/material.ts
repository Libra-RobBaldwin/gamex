// The ground material: the scene's own MeshLambertMaterial (so lights, shadows, fog, stencil and
// anything else patched onto it keep working), with its colour worked out per pixel from the
// cover map, a detail texture and a macro texture. Everything is sampled in world space, so
// terrain tiles, the game's single quad and the demos' planes all line up and never show a seam.
//
// Precision: world coordinates can be 100+ km from the origin. Meshes are expected to sit near a
// floating origin (the terrain library places tiles at offset − origin); the shader only ever sees
// positions relative to it, plus the origin modulo the textures' common period (worked out here in
// double precision), so nothing swims or bands however far away the world is.
import * as THREE from 'three';
import { CROPS, CROP_NAMES, DIRS, PALETTE, type GroundQuality } from './covers';
import { MACRO_PERIOD, makeDetail, makeMacro } from './textures';

export const DETAIL_REPEAT = 8; // metres per repeat of the detail texture (its second layer: 1024/48)
const DETAIL2 = MACRO_PERIOD / 96; // 21.33 m, a whole number of repeats in the period, so rebasing never jumps

// The detail and macro textures are generated once and shared by every ground.
let shared: { detail: THREE.DataTexture; macro: THREE.DataTexture; ms: number } | null = null;
export function sharedTextures() {
  if (shared) return shared;
  const d = makeDetail(1, 512), m = makeMacro(1, 256);
  const tex = (t: { size: number; data: Uint8Array }) => {
    const x = new THREE.DataTexture(t.data, t.size, t.size, THREE.RGBAFormat, THREE.UnsignedByteType);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.magFilter = THREE.LinearFilter; x.generateMipmaps = true;
    // the detail blends between mip levels (no pop as you zoom) and keeps a little sharpness at
    // grazing angles; the smooth macro needs neither, and its reads cost less without them
    const fine = t.size > 256;
    x.minFilter = fine ? THREE.LinearMipmapLinearFilter : THREE.LinearMipmapNearestFilter;
    x.anisotropy = 1; // (the view is never lower than 20 degrees: mipmaps alone keep it crisp enough, and cheap)
    x.needsUpdate = true;
    return x;
  };
  shared = { detail: tex(d), macro: tex(m), ms: d.ms + m.ms };
  return shared;
}

// The cover map textures for one ground (see paint.ts). A ground without a painted map gets a 1x1
// "pasture everywhere" pair.
export function coverTexture(data: Uint8Array, n: number) {
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ---- quality ----
const QN: Record<GroundQuality, number> = { low: 0, medium: 1, high: 2 };
let quality: GroundQuality = 'high';
const materials = new Set<THREE.MeshLambertMaterial>();
// (three reads `defines` from any material, though only ShaderMaterial declares it)
const defs = (m: THREE.Material) => m as unknown as { defines?: Record<string, unknown> };
export function setGroundQuality(q: GroundQuality) {
  if (q === quality) return;
  quality = q;
  for (const m of materials) { defs(m).defines = { ...defs(m).defines, GROUND_Q: QN[q] }; m.needsUpdate = true; }
}
export const getGroundQuality = () => quality;

export interface GroundUniforms {
  uCoverMap: { value: THREE.Texture };
  uDetail: { value: THREE.Texture }; uMacro: { value: THREE.Texture };
  uCover: { value: THREE.Vector4 }; // map corner relative to the origin (xy), 1/size, texels across
  uOriginMod: { value: THREE.Vector2 };
  uSlope: { value: THREE.Vector4 }; // rock from/to (1 − normal.y), heather from/to (height, m)
  uPal: { value: THREE.Color[] }; uCropA: { value: THREE.Color[] }; uCropB: { value: THREE.Color[] }; uCropRow: { value: THREE.Vector4[] };
  uDirs: { value: THREE.Vector2[] }; // unit vectors across the rows, one per stored direction
}
const PAL_KEYS = Object.keys(PALETTE) as (keyof typeof PALETTE)[];
const P = (k: keyof typeof PALETTE) => PAL_KEYS.indexOf(k);

export function groundUniforms(cover: THREE.Texture): GroundUniforms {
  const s = sharedTextures();
  return {
    uCoverMap: { value: cover }, uDetail: { value: s.detail }, uMacro: { value: s.macro },
    uCover: { value: new THREE.Vector4(-1e6, -1e6, 1 / 2e6, 1) }, uOriginMod: { value: new THREE.Vector2() },
    uSlope: { value: new THREE.Vector4(0.2, 0.34, 70, 130) },
    uPal: { value: PAL_KEYS.map((k) => new THREE.Color(PALETTE[k])) },
    uCropA: { value: CROP_NAMES.map((c) => new THREE.Color(CROPS[c].a)) },
    uCropB: { value: CROP_NAMES.map((c) => new THREE.Color(CROPS[c].b)) },
    uCropRow: { value: CROP_NAMES.map((c) => new THREE.Vector4(CROPS[c].rows, CROPS[c].row, CROPS[c].tram ? 1 : 0, 0)) },
    uDirs: { value: Array.from({ length: DIRS }, (_, k) => new THREE.Vector2(-Math.sin((k * Math.PI) / DIRS), Math.cos((k * Math.PI) / DIRS))) },
  };
}
// The origin's remainder, in double precision on the CPU.
export function setOrigin(u: GroundUniforms, x: number, z: number, cover?: { x0: number; z0: number; size: number; n: number }) {
  const m = (a: number) => ((a % MACRO_PERIOD) + MACRO_PERIOD) % MACRO_PERIOD;
  u.uOriginMod.value.set(m(x), m(z));
  if (cover) u.uCover.value.set(cover.x0 - x, cover.z0 - z, 1 / cover.size, cover.n);
}

const VERT_HEAD = `
varying vec3 vGW;
varying vec3 vGN;`;
const VERT_BODY = `
{
  vec4 gw = modelMatrix * vec4( transformed, 1.0 );
  vGW = gw.xyz;
  vGN = normalize( mat3( modelMatrix ) * objectNormal );
}`;

const FRAG_HEAD = `
uniform sampler2D uCoverMap, uDetail, uMacro;
uniform vec4 uCover;
uniform vec2 uOriginMod;
uniform vec4 uSlope;
uniform vec3 uPal[${PAL_KEYS.length}];
uniform vec3 uCropA[8];
uniform vec3 uCropB[8];
uniform vec4 uCropRow[8];
uniform vec2 uDirs[${DIRS}];
varying vec3 vGW;
varying vec3 vGN;
// 0 below a, 1 above b, straight between (as good as smoothstep for blending, and cheaper)
#define gRamp( a, b, x ) clamp( ( ( x ) - ( a ) ) * ( 1.0 / ( ( b ) - ( a ) ) ), 0.0, 1.0 )`;

// Kept lean: a software renderer runs every branch for every pixel, and a phone's GPU spends its
// time on the ground more than anything else on screen.
const FRAG_BODY = `
{
  vec2 wp = vGW.xz;
  vec2 dp = wp + uOriginMod; // world position modulo ${MACRO_PERIOD} m, for the tiling textures
  vec2 fwp = fwidth( wp );
  float mpp = max( fwp.x, fwp.y ); // metres per pixel
  vec4 d1 = texture2D( uDetail, dp * ${(1 / DETAIL_REPEAT).toFixed(6)} );
#if GROUND_Q >= 2
  // a second, larger layer turned a quarter: breaks up the repeat and gives clumps and flowers
  vec4 d2 = texture2D( uDetail, vec2( dp.y, -dp.x ) * ${(1 / DETAIL2).toFixed(6)} + 0.37 );
#else
  vec4 d2 = d1.gbga;
#endif
#if GROUND_Q >= 1
  vec4 mac = texture2D( uMacro, dp * ${(1 / MACRO_PERIOD).toFixed(8)} );
#else
  // no macro texture: soft bumps from parabolic waves (a few multiplies, no sines), at skewed
  // angles and whole numbers of cycles per period, so rebasing the origin never jumps
  vec4 w = fract( vec4( dot( dp, vec2( 5.0, 2.0 ) ), dot( dp, vec2( -3.0, 5.0 ) ), dot( dp, vec2( 13.0, 9.0 ) ), dot( dp, vec2( -11.0, 17.0 ) ) ) * ${(1 / MACRO_PERIOD).toFixed(8)} );
  w = w * ( 1.0 - w ) * 4.0;
  vec4 mac = vec4( w.x * w.y, w.z * w.w, w.x * w.w, w.y * w.z ) * 0.5 + 0.25;
#endif

  // the cover map (pasture past its edge), its borders wobbled by the clump noise so they look
  // grown, not drawn
  vec2 cuv = ( wp - uCover.xy ) * uCover.z + ( d2.rg - 0.5 ) * ( 1.3 / uCover.w );
  vec2 e2 = min( cuv, 1.0 - cuv );
  vec4 cov = mix( vec4( 0.5, 0.0, 0.5, 0.5 ), texture2D( uCoverMap, cuv ), clamp( min( e2.x, e2.y ) * 250.0, 0.0, 1.0 ) );
  // each channel is two covers either side of ½ (see covers.ts)
  vec3 sg = cov.rba * 2.0 - 1.0;
  float nz = d2.g - 0.5;
  float lawn = max( -sg.x, 0.0 ), fld = gRamp( 0.15, 0.85, sg.x + nz * 0.35 );
  float wood = gRamp( 0.1, 0.9, sg.y + nz * 0.5 ), bare = gRamp( 0.1, 0.9, nz * 0.6 - sg.y );
  float rough = max( sg.z, 0.0 ), wet = max( -sg.z, 0.0 );
  float sum = lawn + fld + wood + bare, k = 1.0 / max( sum, 1.0 );
  lawn *= k; fld *= k; wood *= k; bare *= k;
  float past = 1.0 - sum * k;
  float tuft = ( d1.r - 0.5 ) * ( 1.0 - gRamp( 0.03, 0.25, mpp ) ), clump = d1.g - 0.5, grain = d1.b - 0.5;

  // grass, the default: never one flat colour; tussocky patches here and there, and wherever
  // painted rough
  vec3 grass = mix( uPal[${P('pasture')}], uPal[${P('pastureDry')}], gRamp( 0.3, 0.75, mac.r * 0.65 + mac.b * 0.35 ) );
  grass = mix( grass, uPal[${P('pastureCool')}], gRamp( 0.45, 0.8, mac.a ) * 0.8 );
  grass = mix( grass, uPal[${P('wet')}], wet ) * ( 1.0 + ( mac.b - 0.5 ) * 0.3 + nz * 0.16 );
  float rgh = min( max( rough, gRamp( 0.6, 0.8, mac.g * 0.55 + mac.b * 0.2 + d2.g * 0.35 ) * 0.55 * ( 1.0 - wet ) ), 1.0 );
  vec3 col = mix( grass, mix( uPal[${P('rough')}], uPal[${P('pastureDry')}], d2.b ), rgh ) * ( 1.0 + tuft * ( 0.4 + rgh * 0.3 ) + clump * 0.42 ) * past;

  // fields and lawns: the crop (or mown stripes) and its rows, along the direction in the map
  float code = floor( cov.g * 255.0 + 0.5 ), cropF = floor( code * ${(1 / DIRS).toFixed(6)} );
  int ci = int( cropF );
  vec4 row = uCropRow[ ci ];
  float ac = dot( dp, uDirs[ int( code - cropF * ${DIRS}.0 ) ] ); // metres across the rows
  // rows: a triangle wave (soft, few harmonics) fading to its mean before it gets fine enough to alias
  float rows = ( abs( fract( ac / max( row.x, 0.01 ) ) - 0.5 ) * 4.0 - 1.0 ) * row.y * ( 1.0 - gRamp( 0.12, 0.3, mpp / max( row.x, 0.01 ) ) );
  // tramlines: two wheel tracks 2 m apart every 24 m, anti-aliased, gone when under a pixel
  float s24 = fract( ac * ${(1 / 24).toFixed(6)} ) * 24.0, dl = min( min( s24, 24.0 - s24 ), abs( s24 - 2.0 ) );
  float tram = row.z * ( 1.0 - gRamp( 0.22, 0.22 + mpp, dl ) ) * ( 1.0 - gRamp( 0.25, 0.6, mpp ) );
  vec3 fieldC = mix( uCropA[ ci ], uCropB[ ci ], gRamp( 0.3, 0.7, mac.g * 0.7 + mac.b * 0.3 ) );
  col += fieldC * ( 1.0 + rows + tuft * 0.45 + clump * 0.28 + grain * ( ci == 4 ? 0.5 : 0.08 ) - tram * 0.2 ) * fld;
  col += mix( uPal[${P('lawn')}], grass, 0.3 ) * ( 1.0 + tuft * 0.2 + clump * 0.12 + ( ci == 7 ? rows : 0.0 ) ) * lawn;

  col += mix( uPal[${P('wood')}], uPal[${P('litter')}], gRamp( 0.45, 0.75, d1.g * 0.5 + d2.g * 0.5 ) ) * ( 1.0 + tuft * 0.3 + ( d2.b - 0.5 ) * 0.3 ) * wood;
  col += mix( uPal[${P('bare')}], uPal[${P('bareDark')}], gRamp( 0.3, 0.7, d2.b * 0.6 + mac.b * 0.4 ) ) * ( 1.0 + grain * 0.45 + tuft * 0.15 ) * bare;

#if GROUND_Q >= 2
  // the odd daisy and buttercup in grass, only close up (they'd fizz from further off)
  float fl = gRamp( 0.55, 0.85, d2.a ) * ( 1.0 - gRamp( 0.012, 0.03, mpp ) ) * ( past * ( 1.0 - rgh ) + lawn ) * 0.55;
  col = mix( col, d2.r > 0.5 ? uPal[${P('daisy')}] : uPal[${P('buttercup')}], fl );
#endif

#ifdef GROUND_TERRAIN
  // slopes and heights: rock and scree where it's steep, heather and moor grass high up
  float rockW = gRamp( uSlope.x, uSlope.y, 1.0 - vGN.y + grain * 0.06 + ( mac.b - 0.5 ) * 0.08 );
  float heath = gRamp( uSlope.z, uSlope.w, vGW.y + ( mac.g - 0.5 ) * 40.0 ) * ( 1.0 - fld ) * ( 1.0 - lawn );
  col = mix( col, mix( uPal[${P('moor')}], uPal[${P('heather')}], gRamp( 0.35, 0.65, d2.g * 0.6 + mac.b * 0.4 ) ) * ( 1.0 + clump * 0.35 + tuft * 0.3 ), heath );
  col = mix( col, mix( uPal[${P('rock')}], uPal[${P('scree')}], gRamp( 0.35, 0.65, d2.b * 0.5 + mac.b * 0.5 ) ) * ( 1.0 + grain * 0.5 + tuft * 0.2 ), rockW );
#endif

  diffuseColor.rgb *= max( col, 0.0 );
}`;

// Turn a MeshLambertMaterial into ground. Any onBeforeCompile already on it runs first (and one
// put on afterwards, like the water system's shore overlay, should chain this one).
// `terrain` adds rock and scree on steep slopes and heather high up (a flat map needn't pay for it).
export function patchGround(m: THREE.MeshLambertMaterial, u: GroundUniforms, terrain = false) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.map = null;
  defs(m).defines = { ...defs(m).defines, GROUND_Q: QN[quality], ...(terrain ? { GROUND_TERRAIN: 1 } : {}) };
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>${VERT_HEAD}`).replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>${FRAG_HEAD}`).replace('#include <map_fragment>', FRAG_BODY);
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|ground`;
  m.userData.ground = u;
  materials.add(m);
  return m;
}
export function forgetGround(m: THREE.MeshLambertMaterial) { materials.delete(m); }

// The ground's fragment code as compiled at a quality level (its #if blocks resolved), for
// counting texture reads.
export function groundFragment(q: GroundQuality) {
  const lv = QN[q], out: string[] = [], keep: boolean[] = [];
  for (const line of FRAG_BODY.split('\n')) {
    const t = line.trim(), m = /^#if GROUND_Q >= (\d)/.exec(t);
    if (m) { keep.push(lv >= Number(m[1])); continue; }
    if (t === '#else') { keep[keep.length - 1] = !keep[keep.length - 1]; continue; }
    if (t === '#endif') { keep.pop(); continue; }
    if (keep.every(Boolean)) out.push(line);
  }
  return out.join('\n');
}
