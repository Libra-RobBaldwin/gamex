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
import { CROPS, CROP_NAMES, PALETTE, type GroundQuality } from './covers';
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
    x.magFilter = THREE.LinearFilter; x.minFilter = THREE.LinearMipmapLinearFilter; x.generateMipmaps = true;
    x.anisotropy = 8; // (three clamps it to what the device can do)
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
  uCoverA: { value: THREE.Texture }; uCoverB: { value: THREE.Texture };
  uDetail: { value: THREE.Texture }; uMacro: { value: THREE.Texture };
  uCover: { value: THREE.Vector4 }; // map corner relative to the origin (xy), 1/size, texels across
  uOriginMod: { value: THREE.Vector2 };
  uSlope: { value: THREE.Vector4 }; // rock from/to (1 − normal.y), heather from/to (height, m)
  uPal: { value: THREE.Color[] }; uCropA: { value: THREE.Color[] }; uCropB: { value: THREE.Color[] }; uCropRow: { value: THREE.Vector4[] };
}
const PAL_KEYS = Object.keys(PALETTE) as (keyof typeof PALETTE)[];
const P = (k: keyof typeof PALETTE) => PAL_KEYS.indexOf(k);

export function groundUniforms(coverA: THREE.Texture, coverB: THREE.Texture): GroundUniforms {
  const s = sharedTextures();
  return {
    uCoverA: { value: coverA }, uCoverB: { value: coverB }, uDetail: { value: s.detail }, uMacro: { value: s.macro },
    uCover: { value: new THREE.Vector4(-1e6, -1e6, 1 / 2e6, 1) }, uOriginMod: { value: new THREE.Vector2() },
    uSlope: { value: new THREE.Vector4(0.2, 0.34, 70, 130) },
    uPal: { value: PAL_KEYS.map((k) => new THREE.Color(PALETTE[k])) },
    uCropA: { value: CROP_NAMES.map((c) => new THREE.Color(CROPS[c].a)) },
    uCropB: { value: CROP_NAMES.map((c) => new THREE.Color(CROPS[c].b)) },
    uCropRow: { value: CROP_NAMES.map((c) => new THREE.Vector4(CROPS[c].rows, CROPS[c].row, CROPS[c].tram ? 1 : 0, 0)) },
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
uniform sampler2D uCoverA, uCoverB, uDetail, uMacro;
uniform vec4 uCover;
uniform vec2 uOriginMod;
uniform vec4 uSlope;
uniform vec3 uPal[${PAL_KEYS.length}];
uniform vec3 uCropA[8];
uniform vec3 uCropB[8];
uniform vec4 uCropRow[8];
varying vec3 vGW;
varying vec3 vGN;
// how much of a pixel footprint [u − fw/2, u + fw/2] lies where fract(u) < w: a line (or
// stripe) of width w per unit, filtered, so it greys out smoothly instead of aliasing
float gPulse( float u, float w, float fw ) {
  // (u is brought near zero first: the difference below loses precision on big numbers)
  u = mod( u, 64.0 );
  fw = max( fw, 1e-3 );
  float a = u - 0.5 * fw, b = u + 0.5 * fw;
  float ia = floor( a ) * w + min( fract( a ), w ), ib = floor( b ) * w + min( fract( b ), w );
  return clamp( ( ib - ia ) / fw, 0.0, 1.0 );
}`;

const FRAG_BODY = `
{
  vec2 wp = vGW.xz;
  vec2 dp = wp + uOriginMod; // world position modulo ${MACRO_PERIOD} m, for the tiling textures
  float mpp = length( fwidth( wp ) ); // metres per pixel
  vec4 d1 = texture2D( uDetail, dp * ${(1 / DETAIL_REPEAT).toFixed(6)} );
#if GROUND_Q >= 2
  // a second, larger layer turned a quarter: breaks up the repeat and gives clumps and flowers
  vec4 d2 = texture2D( uDetail, vec2( dp.y, -dp.x ) * ${(1 / DETAIL2).toFixed(6)} + 0.37 );
#else
  vec4 d2 = vec4( d1.g, d1.b, d1.g, 0.0 );
#endif
#if GROUND_Q >= 1
  vec4 mac = texture2D( uMacro, dp * ${(1 / MACRO_PERIOD).toFixed(8)} );
#else
  // cheap macro variation: products of sines, whole numbers of cycles per period (no seam)
  const float K = ${((2 * Math.PI) / MACRO_PERIOD).toFixed(8)};
  vec4 mac = 0.5 + 0.22 * vec4(
    sin( dot( dp, vec2( 5.0, 2.0 ) * K ) ) * sin( dot( dp, vec2( -2.0, 4.0 ) * K ) ),
    sin( dot( dp, vec2( 13.0, 9.0 ) * K ) ) * sin( dot( dp, vec2( -11.0, 15.0 ) * K ) ),
    sin( dot( dp, vec2( 31.0, 23.0 ) * K ) ) * sin( dot( dp, vec2( -27.0, 37.0 ) * K ) ),
    sin( dot( dp, vec2( 7.0, -10.0 ) * K ) ) * sin( dot( dp, vec2( 9.0, 6.0 ) * K ) ) );
#endif

  // the cover map, its edges wobbled by the clump noise so borders look grown, not drawn
  vec2 cuv = ( wp - uCover.xy ) * uCover.z + ( d2.rg - 0.5 ) * ( 1.3 / uCover.w );
  vec4 cA = texture2D( uCoverA, cuv ), cB = texture2D( uCoverB, cuv );
  vec2 e2 = min( cuv, 1.0 - cuv );
  float inMap = smoothstep( 0.0, 0.004, min( e2.x, e2.y ) );
  cA *= inMap;
  cB = mix( vec4( 0.0625, 0.0, 0.0, 0.0 ), cB, inMap );

  float nz = d2.g - 0.5;
  float lawn = cA.r, fld = smoothstep( 0.15, 0.85, cA.g + nz * 0.35 ), wood = smoothstep( 0.1, 0.9, cA.b + nz * 0.5 ), bare = smoothstep( 0.1, 0.9, cA.a + nz * 0.6 );
  float rough = cB.b, wet = cB.a;
  float sum = lawn + fld + wood + bare;
  if ( sum > 1.0 ) { lawn /= sum; fld /= sum; wood /= sum; bare /= sum; sum = 1.0; }
  float past = 1.0 - sum;

  float fineK = 1.0 - smoothstep( 0.03, 0.25, mpp ); // fine strokes only close up
  float tuft = ( d1.r - 0.5 ) * fineK, clump = d1.g - 0.5, grain = d1.b - 0.5;

  // grass, the default: never one flat colour
  vec3 grass = mix( uPal[${P('pasture')}], uPal[${P('pastureDry')}], smoothstep( 0.3, 0.75, mac.r * 0.65 + mac.b * 0.35 ) );
  grass = mix( grass, uPal[${P('pastureCool')}], smoothstep( 0.45, 0.8, mac.a ) * 0.8 );
  grass = mix( grass, uPal[${P('wet')}], wet );
  grass *= 1.0 + ( mac.b - 0.5 ) * 0.3 + ( d2.g - 0.5 ) * 0.16; // patches a few metres to tens of metres across
  // tussocky patches here and there in the pasture, and wherever painted rough
  float tuss = smoothstep( 0.6, 0.8, mac.g * 0.55 + mac.b * 0.2 + d2.g * 0.35 ) * 0.55 * ( 1.0 - wet );
  float rgh = clamp( max( rough, tuss ) * ( 1.0 - lawn ), 0.0, 1.0 );
  vec3 roughC = mix( uPal[${P('rough')}], uPal[${P('pastureDry')}], d2.b ) * ( 1.0 + tuft * 0.7 + ( d2.g - 0.5 ) * 0.35 );
  vec3 pasture = grass * ( 1.0 + tuft * 0.4 + clump * 0.42 );
  pasture = mix( pasture, roughC, rgh );

  vec3 lawnC = mix( uPal[${P('lawn')}], grass, 0.3 ) * ( 1.0 + tuft * 0.2 + clump * 0.12 );

  // fields: the crop's colour, its rows (along dir), tramlines every 24 m
  float code = cB.r * 8.0 - 0.5;
  int ci = int( clamp( floor( code + 0.5 ), 0.0, 7.0 ) );
  float dir = cB.g * 3.14159265;
  vec2 across = vec2( -sin( dir ), cos( dir ) );
  float ac = dot( dp, across );
  vec4 row = uCropRow[ ci ];
  vec3 fieldC = mix( uCropA[ ci ], uCropB[ ci ], smoothstep( 0.3, 0.7, mac.g * 0.7 + mac.b * 0.3 ) );
  if ( row.x > 0.0 ) {
    float u = ac / row.x, fw = fwidth( u );
    float r = 1.0 - 2.0 * gPulse( u, 0.5, fw ); // −1..1, averaging to 0 when too fine to see
    r *= 1.0 - smoothstep( 0.3, 0.6, fw );
    fieldC *= 1.0 + r * row.y;
  }
  if ( row.z > 0.0 ) {
    float u = ac / 24.0, fw = fwidth( u );
    float t = gPulse( u, 0.5 / 24.0, fw ) + gPulse( u - 2.0 / 24.0, 0.5 / 24.0, fw );
    fieldC *= 1.0 - t * 0.2 * ( 1.0 - smoothstep( 0.03, 0.08, fw ) );
  }
  fieldC *= 1.0 + tuft * 0.45 + clump * 0.28 + grain * ( ci == 4 ? 0.5 : 0.08 );
  // mown stripes on the bigger lawns
  if ( ci == 7 ) lawnC *= 1.0 + ( 1.0 - 2.0 * gPulse( ac / row.x, 0.5, fwidth( ac / row.x ) ) ) * row.y;

  vec3 woodC = mix( uPal[${P('wood')}], uPal[${P('litter')}], smoothstep( 0.45, 0.75, d1.g * 0.5 + d2.g * 0.5 ) ) * ( 1.0 + tuft * 0.3 + ( d2.b - 0.5 ) * 0.3 );
  vec3 bareC = mix( uPal[${P('bare')}], uPal[${P('bareDark')}], smoothstep( 0.3, 0.7, d2.b * 0.6 + mac.b * 0.4 ) ) * ( 1.0 + grain * 0.45 + tuft * 0.15 );

  vec3 col = pasture * past + lawnC * lawn + fieldC * fld + woodC * wood + bareC * bare;

#if GROUND_Q >= 2
  // the odd daisy and buttercup in grass, only close up (they'd fizz from further off)
  float fl = smoothstep( 0.55, 0.85, d2.a ) * ( 1.0 - smoothstep( 0.02, 0.05, mpp ) ) * ( past * ( 1.0 - rgh ) + lawn ) * 0.55;
  col = mix( col, d2.r > 0.5 ? uPal[${P('daisy')}] : uPal[${P('buttercup')}], fl );
#endif

  // slopes and heights (terrain): rock and scree where it's steep, heather and moor grass high up
  float slope = 1.0 - clamp( vGN.y, 0.0, 1.0 );
  float rockW = smoothstep( uSlope.x, uSlope.y, slope + grain * 0.06 + ( mac.b - 0.5 ) * 0.08 );
  float heath = smoothstep( uSlope.z, uSlope.w, vGW.y + ( mac.g - 0.5 ) * 40.0 ) * ( 1.0 - fld ) * ( 1.0 - lawn );
  vec3 heathC = mix( uPal[${P('moor')}], uPal[${P('heather')}], smoothstep( 0.35, 0.65, d2.g * 0.6 + mac.b * 0.4 ) ) * ( 1.0 + clump * 0.35 + tuft * 0.3 );
  vec3 rockC = mix( uPal[${P('rock')}], uPal[${P('scree')}], smoothstep( 0.35, 0.65, d2.b * 0.5 + mac.b * 0.5 ) ) * ( 1.0 + grain * 0.5 + tuft * 0.2 );
  col = mix( col, heathC, heath );
  col = mix( col, rockC, rockW );

  diffuseColor.rgb *= max( col, 0.0 );
}`;

// Turn a MeshLambertMaterial into ground. Any onBeforeCompile already on it runs first (and one
// put on afterwards, like the water system's shore overlay, should chain this one).
export function patchGround(m: THREE.MeshLambertMaterial, u: GroundUniforms) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.map = null;
  defs(m).defines = { ...defs(m).defines, GROUND_Q: QN[quality] };
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
