// Drawing vehicles at scale: one InstancedMesh per model and level of detail, all sharing one
// material. The material is a Lambert patched in three places:
//   – colour: paint zones take the instance's livery (instanceColor for the body, and three more
//     per-instance colours for the band, roof and accent zones);
//   – light: baked lamp codes glow when the instance's flags switch them on (headlamps, tail and
//     brake lamps, indicators that blink, interior lights, flashing beacons, cab signs);
//   – wheels: vertices tagged with a wheel centre turn by the instance's odometer;
//   – moving parts (motion.ts): door leaves slide, plug, swing or fold by the instance's door
//     state, bogies swivel and front wheels steer by its curvature, coupling rods go round with
//     the wheels and pantographs fold down with a flag.
// Per-frame cost is one matrix and a few floats per vehicle; draw calls are one per model and
// level that has anything on screen.
import * as THREE from 'three';
import type { Livery, Lod, Model } from './types';
import { geometry } from './build';
import { packDoors, MOTION_GLSL_COMMON, MOTION_GLSL_NORMAL, MOTION_GLSL_VERTEX } from './motion';

export interface VehicleMaterialOptions { night?: number }

// The shared material. uTime drives indicators and beacons; uNight (0–1) scales how strongly the
// lamps glow, since a lit headlamp at noon shouldn't look like a torch.
export function vehicleMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uNight = uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 vk;
attribute vec3 iC2;
attribute vec3 iC3;
attribute vec3 iC4;
attribute vec4 iData;
uniform float uTime;
uniform float uNight;
varying vec3 vEmit;
vec2 spin(vec2 p, vec2 c, float a) { vec2 d = p - c; float s = sin(a), co = cos(a); return c + vec2(co * d.x - s * d.y, s * d.x + co * d.y); }
${MOTION_GLSL_COMMON}`)
      .replace('#include <color_vertex>', `
vColor = color;
int zone = int(vk.x + 0.5);
#ifdef USE_INSTANCING_COLOR
if (zone == 1) vColor *= instanceColor;
#endif
if (zone == 2) vColor *= iC2;
else if (zone == 3) vColor *= iC3;
else if (zone == 4) vColor *= iC4;
int fl = int(iData.x + 0.5);
int li = int(vk.y + 0.5);
float blink = step(0.5, fract(uTime * 1.5));
float glow = mix(0.55, 1.0, uNight);
vEmit = vec3(0.0);
if (li == 1 && (fl & 1) != 0) vEmit = vec3(1.7, 1.6, 1.3) * glow;
else if (li == 2) vEmit = vec3(1.2, 0.06, 0.04) * ((fl & 2) != 0 ? 1.4 : ((fl & 1) != 0 ? 0.55 * glow : 0.0));
else if (li == 3 && (fl & 2) != 0) vEmit = vec3(1.6, 0.06, 0.04);
else if (li == 4 && (fl & 4) != 0) vEmit = vec3(1.6, 0.75, 0.05) * blink;
else if (li == 5 && (fl & 8) != 0) vEmit = vec3(1.6, 0.75, 0.05) * blink;
else if (li == 6 && (fl & 16) != 0) vEmit = vec3(1.0, 0.86, 0.55) * 0.75 * uNight;
else if (li == 7 && (fl & 32) != 0) vEmit = vec3(0.2, 0.35, 2.0) * step(0.5, fract(uTime * 2.5 + (position.z > 0.0 ? 0.5 : 0.0)));
else if (li == 8 && (fl & 32) != 0) vEmit = vec3(1.8, 0.8, 0.05) * step(0.5, fract(uTime * 2.0 + position.x * 0.2));
else if (li == 9 && (fl & 64) != 0) vEmit = vec3(1.5, 1.0, 0.3) * glow;
else if (li == 10 || li == 11) {
  vec2 dd = mvDoors(iData.z);
  float o = position.z > 0.0 ? dd.y : dd.x;
  if (o > 0.004) vEmit = li == 10 ? vec3(1.7, 0.85, 0.08) : vec3(0.25, 1.4, 0.35);
}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float wheelA = vk.w > 0.0 ? -iData.y / vk.w : 0.0;
if (vk.w > 0.0) objectNormal.xy = spin(objectNormal.xy, vec2(0.0), wheelA);
${MOTION_GLSL_NORMAL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (vk.w > 0.0) transformed.xy = spin(transformed.xy, vk.zw, wheelA);
${MOTION_GLSL_VERTEX}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vEmit;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vEmit;`);
  };
  // every vehicle shares this shader, so compile it once
  mat.customProgramCacheKey = () => 'vehicle-v2';
  return { material: mat, uniforms };
}

const tmpC = new THREE.Color();

// One model at one level of detail: an InstancedMesh that grows as needed.
class Bucket {
  mesh: THREE.InstancedMesh;
  count = 0;
  private c2: THREE.InstancedBufferAttribute;
  private c3: THREE.InstancedBufferAttribute;
  private c4: THREE.InstancedBufferAttribute;
  private data: THREE.InstancedBufferAttribute;
  constructor(public model: Model, public lod: Lod, material: THREE.Material, public cap: number, shadows: boolean) {
    const src = geometry(model, lod);
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'color', 'vk', 'vd']) g.setAttribute(k, src.getAttribute(k));
    g.boundingSphere = src.boundingSphere; g.boundingBox = src.boundingBox;
    this.c2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.c3 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.c4 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    // flags, odometer, doors (packed left and right), curvature
    this.data = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    for (const a of [this.c2, this.c3, this.c4, this.data]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iC2', this.c2); g.setAttribute('iC3', this.c3); g.setAttribute('iC4', this.c4); g.setAttribute('iData', this.data);
    this.mesh = new THREE.InstancedMesh(g, material, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, tmpC.set('#ffffff'));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // positions change every frame; culling per vehicle happens in the caller
    this.mesh.castShadow = shadows && lod < 2;
    this.mesh.receiveShadow = false;
    this.mesh.name = `${model.id}#${lod}`;
  }
  set(i: number, m: THREE.Matrix4, cols: readonly THREE.Color[], flags: number, odo: number, doors = 0, curve = 0) {
    this.mesh.setMatrixAt(i, m);
    this.mesh.setColorAt(i, cols[0]);
    const [c2, c3, c4] = [cols[1] ?? cols[0], cols[2] ?? cols[0], cols[3] ?? cols[0]];
    this.c2.setXYZ(i, c2.r, c2.g, c2.b); this.c3.setXYZ(i, c3.r, c3.g, c3.b); this.c4.setXYZ(i, c4.r, c4.g, c4.b);
    this.data.setXYZW(i, flags, odo, doors, curve);
  }
  flush() {
    this.mesh.count = this.count;
    if (!this.count) return;
    const upd = (a: THREE.BufferAttribute, n: number) => { a.clearUpdateRanges(); a.addUpdateRange(0, this.count * n); a.needsUpdate = true; };
    upd(this.mesh.instanceMatrix, 16); upd(this.mesh.instanceColor!, 3); upd(this.c2, 3); upd(this.c3, 3); upd(this.c4, 3); upd(this.data, 4);
  }
  dispose() {
    for (const k of ['iC2', 'iC3', 'iC4', 'iData']) this.mesh.geometry.deleteAttribute(k);
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

// Colours for a livery, converted once and cached.
const liveryCache = new Map<string, THREE.Color[]>();
export function liveryColours(l: Livery | readonly string[]) {
  const key = l.join(',');
  let c = liveryCache.get(key);
  if (!c) { c = l.map((h) => new THREE.Color(h)); liveryCache.set(key, c); }
  return c;
}

// Which level of detail for a vehicle of a given length at a given on-screen scale: the near
// model once it's more than about 40 pixels long, the far box once it's less than about 12.
export function lodFor(lengthM: number, pixelsPerMetre: number): Lod {
  const px = lengthM * pixelsPerMetre;
  return px > 40 ? 0 : px > 12 ? 1 : 2;
}

// Soft light on the ground: headlamp beams in front of vehicles and pools under street lamps.
// One instanced quad with a canvas gradient, drawn additively, so a whole city's worth of beams is
// a single draw call. Only worth drawing at night.
function glowTexture(kind: 'beam' | 'pool') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  if (kind === 'pool') {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,214,150,0.9)'); g.addColorStop(0.5, 'rgba(255,190,120,0.35)'); g.addColorStop(1, 'rgba(255,180,110,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  } else {
    // a cone widening away from the lamps (u = 0 at the car, 1 at the far end)
    const img = x.createImageData(64, 64);
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const u = i / 63, v = Math.abs(j / 63 - 0.5) * 2;
      const w = 0.25 + 0.75 * u;
      const a = Math.max(0, 1 - v / w) * Math.pow(1 - u, 1.3) * Math.min(1, u * 8);
      const o = (j * 64 + i) * 4;
      img.data[o] = 255; img.data[o + 1] = 240; img.data[o + 2] = 205; img.data[o + 3] = Math.round(a * 255);
    }
    x.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export class Glow {
  mesh: THREE.InstancedMesh;
  count = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private p = new THREE.Vector3(); private s = new THREE.Vector3();
  constructor(kind: 'beam' | 'pool', public cap = 4096, intensity = 1) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    if (kind === 'beam') g.translate(0.5, 0, 0); // from the lamps forward
    const mat = new THREE.MeshBasicMaterial({ map: glowTexture(kind), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: intensity });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  begin() { this.count = 0; }
  // at (x, z) on the ground, pointing along heading, len long and w wide
  add(x: number, y: number, z: number, heading: number, len: number, w: number) {
    if (this.count >= this.cap) return;
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(0, -heading, 0)), this.s.set(len, 1, w));
    this.mesh.setMatrixAt(this.count++, this.m);
  }
  end() { this.mesh.count = this.count; this.mesh.instanceMatrix.clearUpdateRanges(); this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16); this.mesh.instanceMatrix.needsUpdate = true; }
}

// The renderer: call begin(), add() every visible vehicle, then end(). Buckets are created on
// first use and kept, so the scene graph doesn't churn.
export class VehicleRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshLambertMaterial;
  readonly uniforms: { uTime: { value: number }; uNight: { value: number } };
  private buckets = new Map<string, Bucket>();
  shadows: boolean;
  constructor(opts: { shadows?: boolean } = {}) {
    const { material, uniforms } = vehicleMaterial();
    this.material = material; this.uniforms = uniforms;
    this.shadows = opts.shadows ?? true;
    this.group.name = 'vehicles';
  }
  begin() { for (const b of this.buckets.values()) b.count = 0; }
  // One vehicle this frame. odo is metres travelled (wheels turn by it); doorsLeft and doorsRight
  // are how far open (0–1) the doors on the driver's left (−z, the kerb side in Britain) and right
  // are, from a DoorStates or doorsAt; curve is the curvature of the path under the vehicle
  // (1 / radius, positive turning right) for bogies and steered wheels.
  add(model: Model, lod: Lod, matrix: THREE.Matrix4, colours: readonly THREE.Color[], flags = 0, odo = 0, doorsLeft = 0, doorsRight = 0, curve = 0) {
    const key = `${model.id}|${lod}`;
    let b = this.buckets.get(key);
    if (!b || b.count >= b.cap) b = this.grow(key, model, lod, b);
    b.set(b.count++, matrix, colours, flags, odo, doorsLeft || doorsRight ? packDoors(doorsLeft, doorsRight) : 0, curve);
  }
  end(time = 0) {
    this.uniforms.uTime.value = time;
    for (const b of this.buckets.values()) b.flush();
  }
  // live draw calls and triangles, for the stats readout
  get stats() {
    let calls = 0, tris = 0, instances = 0;
    for (const b of this.buckets.values()) if (b.count) {
      calls++; instances += b.count;
      tris += b.count * (b.mesh.geometry.getAttribute('position').count / 3);
    }
    return { calls, tris, instances, buckets: this.buckets.size };
  }
  private grow(key: string, model: Model, lod: Lod, old?: Bucket) {
    const cap = old ? old.cap * 2 : lod === 2 ? 64 : 16;
    const b = new Bucket(model, lod, this.material, cap, this.shadows);
    if (old) {
      // copy what's already been added this frame
      for (let i = 0; i < old.count; i++) {
        const m = new THREE.Matrix4(); old.mesh.getMatrixAt(i, m); b.mesh.setMatrixAt(i, m);
        const c = new THREE.Color(); old.mesh.getColorAt(i, c); b.mesh.setColorAt(i, c);
      }
      for (const k of ['iC2', 'iC3', 'iC4', 'iData']) (b.mesh.geometry.getAttribute(k).array as Float32Array).set((old.mesh.geometry.getAttribute(k).array as Float32Array).subarray(0, old.count * (k === 'iData' ? 4 : 3)));
      b.count = old.count;
      this.group.remove(old.mesh); old.dispose();
    }
    this.buckets.set(key, b);
    this.group.add(b.mesh);
    return b;
  }
  dispose() { for (const b of this.buckets.values()) { this.group.remove(b.mesh); b.dispose(); } this.buckets.clear(); this.material.dispose(); }
}
