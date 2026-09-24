// three.js materials and geometry for water. Kept cheap for phones: the water shader does four
// texture reads (two scales of ripple, each at two phases of the flow cycle) and a few dozen
// arithmetic operations per pixel, with no depth texture and no extra render pass. Depth comes
// from a vertex attribute instead, so shallows show the bed through them and the colour darkens
// with depth without reading the depth buffer.

import * as THREE from 'three';
import type { WaterMesh } from './surface';

// ---------- lighting ----------
export interface WaterLight {
  sunDir: THREE.Vector3; sun: THREE.Color; skyTop: THREE.Color; skyHorizon: THREE.Color;
  ambient: THREE.Color; // light on the water column (scattered skylight), and on foam
  shallow: THREE.Color; deep: THREE.Color; foam: THREE.Color; reflect: number; glint: number; // sky reflection strength, sun highlight sharpness
  // for the rest of the scene
  hemiSky: THREE.Color; hemiGround: THREE.Color; hemi: number; sunIntensity: number; background: THREE.Color;
}
const c = (s: string) => new THREE.Color(s);
export const WATER_LIGHT: Record<'day' | 'dusk', WaterLight> = {
  day: {
    sunDir: new THREE.Vector3(-160, 260, 110).normalize(), sun: c('#fff3dc'), skyTop: c('#5b93cc'), skyHorizon: c('#d4e6f2'), ambient: c('#b9cad4'),
    shallow: c('#3fd6c6'), deep: c('#0a3560'), foam: c('#f6fbfa'), reflect: 0.5, glint: 90,
    hemiSky: c('#e8f3ff'), hemiGround: c('#5d7040'), hemi: 0.95, sunIntensity: 2.9, background: c('#a9cbe3'),
  },
  dusk: {
    sunDir: new THREE.Vector3(-330, 90, 140).normalize(), sun: c('#ffae6b'), skyTop: c('#6c6aa8'), skyHorizon: c('#ffa66e'), ambient: c('#7f86bd'),
    shallow: c('#2f9c9a'), deep: c('#0b2a4a'), foam: c('#f7dcc6'), reflect: 0.34, glint: 14,
    hemiSky: c('#b3a6d6'), hemiGround: c('#4a4234'), hemi: 0.85, sunIntensity: 2.3, background: c('#e8a883'),
  },
};

// ---------- the ripple texture ----------
// Tileable by construction: a sum of sine waves whose wave numbers are whole numbers of cycles per
// tile. Red and green hold the surface slope (so the normal is exact), blue a foam noise.
export function rippleTexture(size = 128, seed = 1): THREE.DataTexture {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const waves: [number, number, number, number][] = [];
  for (let i = 0; i < 28; i++) {
    const k = 2 + Math.floor(rnd() * 10), a = rnd() * Math.PI * 2, kx = Math.round(Math.cos(a) * k), kz = Math.round(Math.sin(a) * k);
    if (!kx && !kz) continue;
    waves.push([kx, kz, 1 / Math.hypot(kx, kz), rnd() * Math.PI * 2]);
  }
  const foam: [number, number, number, number][] = [];
  for (let i = 0; i < 16; i++) { const k = 3 + Math.floor(rnd() * 9), a = rnd() * Math.PI * 2; foam.push([Math.round(Math.cos(a) * k), Math.round(Math.sin(a) * k), 1, rnd() * Math.PI * 2]); }
  const d = new Uint8Array(size * size * 4), tau = Math.PI * 2;
  let mx = 0;
  const sx = new Float32Array(size * size), sz = new Float32Array(size * size), fo = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size, k = j * size + i;
    let gx = 0, gz = 0, f = 0;
    for (const [kx, kz, amp, ph] of waves) { const cph = Math.cos(tau * (kx * u + kz * v) + ph) * amp; gx += cph * kx; gz += cph * kz; }
    for (const [kx, kz, , ph] of foam) f += Math.abs(Math.sin(tau * (kx * u + kz * v) + ph));
    sx[k] = gx; sz[k] = gz; fo[k] = f / foam.length;
    mx = Math.max(mx, Math.abs(gx), Math.abs(gz));
  }
  for (let k = 0; k < size * size; k++) {
    d[k * 4] = Math.round(127.5 + (127 * sx[k]) / mx); d[k * 4 + 1] = Math.round(127.5 + (127 * sz[k]) / mx);
    d[k * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, (fo[k] - 0.45) * 2.2))); d[k * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------- the water ----------
const VERT = /* glsl */ `
attribute vec4 aWater;
attribute float aKind;
varying vec3 vWorld;
varying vec4 vWater;
varying float vKind;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz; vWater = aWater; vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uRipple;
uniform float uTime, uReflect, uGlint;
uniform vec3 uSunDir, uSun, uSkyTop, uSkyHorizon, uAmbient, uShallow, uDeep, uFoam;
varying vec3 vWorld;
varying vec4 vWater;
varying float vKind;
void main() {
  float depth = vWater.x, shore = vWater.y;
  vec2 flow = vWater.zw, p = vWorld.xz;
  float sea = 1.0 - step(0.5, abs(vKind - 1.0));        // kind 1
  float still = 1.0 - step(0.5, abs(vKind - 2.0));      // kind 2: lakes
  // ripples drift with the current (rivers) or a light breeze (still water), in two phases half a
  // cycle apart and crossfaded, so the texture never stretches however long it has been flowing
  vec2 drift = flow * 0.55 + vec2(0.05, 0.03) * (1.0 + sea);
  float ph0 = fract(uTime * 0.25), ph1 = fract(uTime * 0.25 + 0.5), w0 = 1.0 - abs(2.0 * ph0 - 1.0);
  vec2 o0 = drift * ph0 * 4.0, o1 = drift * ph1 * 4.0;
  vec4 a0 = texture2D(uRipple, (p - o0) / 11.0), a1 = texture2D(uRipple, (p - o1) / 11.0 + 0.5);
  vec4 b0 = texture2D(uRipple, (p - o0 * 0.6) / 29.0 + vec2(0.37, 0.11)), b1 = texture2D(uRipple, (p - o1 * 0.6) / 29.0 + vec2(0.87, 0.61));
  vec4 fine = mix(a1, a0, w0), broad = mix(b1, b0, w0);
  float speed = length(flow);
  float rough = mix(0.28, 0.5, sea) * (1.0 - 0.35 * still) + 0.12 * min(speed, 2.0);
  vec2 slope = ((fine.xy - 0.5) * 0.65 + (broad.xy - 0.5)) * rough;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));

  float d = max(depth, 0.0);
  // the colour of the water column: turquoise over the bed in the shallows, dark with depth
  vec3 body = mix(uShallow, uDeep, 1.0 - exp(-d / 2.4));
  float column = 1.0 - exp(-d * 0.75);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, V), 0.0);
  float fres = min(0.85, uReflect * (0.1 + 0.9 * pow(1.0 - ndv, 3.0)));
  vec3 R = reflect(-V, n);
  // the sky seen in the water: horizon to zenith, warmer towards the sun (at dusk that's most of it)
  vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(R.y * 1.1 - 0.1, 0.0, 1.0)) + uSun * 0.45 * pow(max(dot(R, uSunDir), 0.0), 3.0);
  vec3 col = body * (uAmbient + uSun * max(dot(n, uSunDir), 0.0) * 0.3);
  col = mix(col, sky, fres);
  col += uSun * pow(max(dot(R, uSunDir), 0.0), uGlint) * (0.3 + 0.9 * (uGlint / 90.0));

  // foam: at the waterline, in lines washing in on the sea, and streaks where a river runs fast
  float noise = mix(fine.b, broad.b, 0.5);
  // (by the shoreline, not just by depth: a lake spreading an inch deep over a flat has no surf)
  float edge = (1.0 - smoothstep(0.3, 2.2, shore)) * (1.0 - smoothstep(0.05, 0.7, d));
  float wash = sea * pow(0.5 + 0.5 * sin(shore * 0.9 - uTime * 1.2), 3.0) * (1.0 - smoothstep(0.5, 14.0, shore));
  float rapids = smoothstep(1.3, 2.3, speed) * fine.b;
  float foam = smoothstep(0.42, 0.8, (edge * 1.1 + wash * 0.8 + rapids) * (0.45 + noise));
  col = mix(col, uFoam * (uAmbient * 0.7 + uSun * 0.45), foam * 0.9);

  float alpha = mix(0.3, 0.94, column) + fres * 0.3;
  alpha = max(alpha, foam * 0.9) * smoothstep(-0.04, 0.05, depth);
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function waterMaterial(ripple: THREE.Texture, light: WaterLight = WATER_LIGHT.day) {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    uniforms: {
      uRipple: { value: ripple }, uTime: { value: 0 }, uReflect: { value: light.reflect }, uGlint: { value: light.glint },
      uSunDir: { value: light.sunDir.clone() }, uSun: { value: light.sun.clone() }, uSkyTop: { value: light.skyTop.clone() }, uSkyHorizon: { value: light.skyHorizon.clone() },
      uAmbient: { value: light.ambient.clone() }, uShallow: { value: light.shallow.clone() }, uDeep: { value: light.deep.clone() }, uFoam: { value: light.foam.clone() },
    },
  });
  return m;
}
export function setWaterLight(m: THREE.ShaderMaterial, l: WaterLight) {
  const u = m.uniforms;
  u.uSunDir.value.copy(l.sunDir); u.uSun.value.copy(l.sun); u.uSkyTop.value.copy(l.skyTop); u.uSkyHorizon.value.copy(l.skyHorizon);
  u.uAmbient.value.copy(l.ambient); u.uShallow.value.copy(l.shallow); u.uDeep.value.copy(l.deep); u.uFoam.value.copy(l.foam); u.uReflect.value = l.reflect; u.uGlint.value = l.glint;
}

export function waterGeometry(w: WaterMesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(w.positions, 3));
  g.setAttribute('aWater', new THREE.BufferAttribute(w.water, 4));
  g.setAttribute('aKind', new THREE.BufferAttribute(w.kind, 1));
  g.setIndex(new THREE.BufferAttribute(w.indices, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------- the ground ----------
// Lays the shore colours (surface.ts shoreColours, an RGBA colour attribute) over whatever the
// ground material draws, by their alpha. Keeps everything else about the material (stencil
// settings, texture, shadows) as it is.
export function patchGroundMaterial<M extends THREE.MeshLambertMaterial | THREE.MeshStandardMaterial>(m: M): M {
  m.vertexColors = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `
#if defined( USE_COLOR_ALPHA )
  diffuseColor.rgb = mix( diffuseColor.rgb, vColor.rgb, vColor.a );
#elif defined( USE_COLOR )
  diffuseColor.rgb *= vColor;
#endif`);
  };
  m.customProgramCacheKey = () => 'water-shore';
  return m;
}

// ---------- reeds ----------
// One tuft: a handful of thin blades leaning out a little, dark green at the foot to straw at the
// tip, some with a brown seed head. Drawn instanced, one draw call per tile.
export function reedGeometry(seed = 3) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const pos: number[] = [], col: number[] = [];
  const foot = new THREE.Color('#4d6b2f'), tip = new THREE.Color('#d8c68a'), head = new THREE.Color('#6b4a2a');
  const blades = 12;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.5, lean = 0.2 + rnd() * 0.5, h = 1.6 + rnd() * 1.1, w = 0.09 + rnd() * 0.05;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(x - px, 0, z - pz, x + px, 0, z + pz, tx, h, tz);
    col.push(foot.r, foot.g, foot.b, foot.r, foot.g, foot.b, tip.r, tip.g, tip.b);
    if (rnd() < 0.35) {
      const hx = x + Math.cos(a) * lean * 0.8, hz = z + Math.sin(a) * lean * 0.8, hy = h * 0.8;
      pos.push(hx - px * 1.6, hy, hz - pz * 1.6, hx + px * 1.6, hy, hz + pz * 1.6, hx, hy + 0.3, hz);
      col.push(head.r, head.g, head.b, head.r, head.g, head.b, head.r, head.g, head.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // light the blades as if they faced up, so both sides and every angle read the same
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0);
  return g;
}
// Reeds sway a little in the wind: the higher up a blade, the more.
export function reedMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const time = { value: 0 };
  m.userData.time = time;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
  transformed.x += sin(uTime * 1.6 + ph) * position.y * position.y * 0.05;
  transformed.z += cos(uTime * 1.3 + ph) * position.y * position.y * 0.03;
#endif`);
  };
  return m;
}
export function reedMesh(spots: Float32Array, geo: THREE.BufferGeometry, mat: THREE.Material) {
  const n = spots.length / 5, mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n)), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    q.setFromAxisAngle(up, spots[i * 5 + 3]);
    const sc = spots[i * 5 + 4];
    m.compose(new THREE.Vector3(spots[i * 5], spots[i * 5 + 1], spots[i * 5 + 2]), q, new THREE.Vector3(sc, sc, sc));
    mesh.setMatrixAt(i, m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
