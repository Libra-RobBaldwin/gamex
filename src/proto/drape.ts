// Hills for everything drawn: every mesh in the scene follows the map's height field
// (worldmap/terrain.ts) in its vertex shader, so roads, junctions, bridges, vehicles, trains, people,
// trees, water and markers all ride on the ground with no change to their own code, which goes on
// working on a flat map at height 0. The ground mesh itself is built with the heights in it (and
// real normals, so the hills are lit), and is left out.
//
//   const drape = new Drape(field);
//   drape.apply(scene);   // before each render: patches whatever's new (a WeakSet, so it's cheap)
//
// The shader's height is the field's exact planar value over the ground mesh's triangles, so
// anything on the ground lies on it. (Vehicles and buildings are sheared by the slope rather than
// turned, which is what you want on gentle hills; the towns stand on the flat anyway.) Materials
// get their own program ('|drape'), and shadows a draped depth material, so they fall on the hills.
import * as THREE from 'three';
import { GROUND_LIFT, SWELL_GLSL, type ReliefField } from './worldmap/terrain';

const GLSL = /* glsl */`
uniform sampler2D uTerrain;
uniform vec4 uTerrainGrid; // x0, z0, step, n
uniform float uSwell; // (the ground's swells for the light, m: worldmap/terrain.ts)
${SWELL_GLSL}
float terrainH( vec2 p ) {
  float top = uTerrainGrid.w - 1.0 - 1e-4;
  vec2 g = clamp( ( p - uTerrainGrid.xy ) / uTerrainGrid.z, vec2( 0.0 ), vec2( top ) );
  vec2 c = floor( g ), f = g - c;
  ivec2 i = ivec2( c );
  float h10 = texelFetch( uTerrain, i + ivec2( 1, 0 ), 0 ).r, h01 = texelFetch( uTerrain, i + ivec2( 0, 1 ), 0 ).r;
  if ( f.x + f.y <= 1.0 ) { float h00 = texelFetch( uTerrain, i, 0 ).r; return h00 + ( h10 - h00 ) * f.x + ( h01 - h00 ) * f.y; }
  float h11 = texelFetch( uTerrain, i + ivec2( 1, 1 ), 0 ).r;
  return h11 + ( h01 - h11 ) * ( 1.0 - f.x ) + ( h10 - h11 ) * ( 1.0 - f.y );
}
`;
// three.js's project_vertex, in world space, with the height added
const PROJECT = /* glsl */`
vec4 dWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  dWorld = batchingMatrix * dWorld;
#endif
#ifdef USE_INSTANCING
  dWorld = instanceMatrix * dWorld;
#endif
dWorld = modelMatrix * dWorld;
float dH = terrainH( dWorld.xz );
dWorld.y += dH;
vec4 mvPosition = viewMatrix * dWorld;
gl_Position = projectionMatrix * mvPosition;
`;
const WORLDPOS = /* glsl */`
#include <worldpos_vertex>
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  worldPosition.y += terrainH( worldPosition.xz );
#endif
`;

// Patch a vertex shader's source; false if nothing in it was recognised.
export function drapeShader(src: string): { src: string; ok: boolean } {
  let ok = false;
  const rep = (a: string | RegExp, b: string) => { const s2 = src.replace(a, b); if (s2 !== src) { ok = true; src = s2; } };
  rep('#include <project_vertex>', PROJECT);
  // clipping planes (the underground view's, game/underview.ts) cut by height above the ground,
  // not in the hills' world: where the vertex was before it was lifted onto them
  if (src.includes('float dH = terrainH')) src = src.replace('#include <clipping_planes_vertex>', `#if NUM_CLIPPING_PLANES > 0
  vClipPosition = - ( viewMatrix * vec4( dWorld.xyz - vec3( 0.0, dH, 0.0 ), 1.0 ) ).xyz;
#endif`);
  rep('#include <worldpos_vertex>', WORLDPOS);
  // sprites (badges and icons): their centre
  rep('vec4 mvPosition = modelViewMatrix[ 3 ];', 'vec4 dCentre = modelMatrix[ 3 ]; dCentre.y += terrainH( dCentre.xz ); vec4 mvPosition = viewMatrix * dCentre;');
  // fat lines (routes: LineMaterial)
  rep('vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );', 'vec4 dS = modelMatrix * vec4( instanceStart, 1.0 ); dS.y += terrainH( dS.xz ); vec4 start = viewMatrix * dS;');
  rep('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );', 'vec4 dE = modelMatrix * vec4( instanceEnd, 1.0 ); dE.y += terrainH( dE.xz ); vec4 end = viewMatrix * dE;');
  // the water (water/material.ts)
  rep('vec4 w = modelMatrix * vec4(position, 1.0);', 'vec4 w = modelMatrix * vec4(position, 1.0); w.y += terrainH( w.xz );');
  if (!ok) return { src, ok };
  // declarations: after `#include <common>`, or at the top of main's file for raw shaders
  src = src.includes('#include <common>') ? src.replace('#include <common>', `#include <common>\n${GLSL}`) : src.replace(/void\s+main\s*\(/, `${GLSL}\nvoid main(`);
  return { src, ok };
}

// Ground drawn over the ground (the fields and verges of the countryside, grass, lawns: ground
// materials, ground/material.ts) is flat, its normals straight up; draped, it would be lit as if
// the hills weren't there. Its normal is the hills' own instead, from the field, lit GROUND_LIFT
// times as steep as the live ground's mesh is (worldmap/terrain.ts).
const GROUND_NORMAL = /* glsl */`
#include <beginnormal_vertex>
#if !defined( USE_INSTANCING ) && !defined( USE_BATCHING )
{
  vec3 dN = normalize( mat3( modelMatrix ) * objectNormal );
  if ( dN.y > 0.9999 ) {
    vec2 dP = ( modelMatrix * vec4( position, 1.0 ) ).xz;
    float dE = uTerrainGrid.z;
    float dHx = terrainH( dP + vec2( dE, 0.0 ) ) - terrainH( dP - vec2( dE, 0.0 ) ), dHz = terrainH( dP + vec2( 0.0, dE ) ) - terrainH( dP - vec2( 0.0, dE ) );
    vec2 dS = swellSlope( dP, uSwell );
    vec3 dT = normalize( vec3( -dHx * ${GROUND_LIFT.toFixed(3)} / ( 2.0 * dE ) - dS.x, 1.0, -dHz * ${GROUND_LIFT.toFixed(3)} / ( 2.0 * dE ) - dS.y ) );
    objectNormal = transpose( mat3( modelMatrix ) ) * dT;
  }
}
#endif
`;

export class Drape {
  readonly texture: THREE.DataTexture;
  readonly uniforms: { uTerrain: { value: THREE.Texture }; uTerrainGrid: { value: THREE.Vector4 }; uSwell: { value: number } };
  private seen = new WeakSet<object>();
  private depth: THREE.MeshDepthMaterial;
  constructor(readonly field: ReliefField) {
    this.texture = new THREE.DataTexture(field.h, field.n, field.n, THREE.RedFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = { uTerrain: { value: this.texture }, uTerrainGrid: { value: new THREE.Vector4(field.x0, field.z0, field.step, field.n) }, uSwell: { value: 0 } };
    this.depth = this.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  }
  heightAt = (x: number, z: number) => this.field.heightAt(x, z);

  // Make a material follow the hills (once; chained after any patch it already has).
  patch<M extends THREE.Material>(m: M): M {
    if (this.seen.has(m)) return m;
    this.seen.add(m);
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey, u = this.uniforms, ground = !!m.userData.ground;
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      const d = drapeShader(sh.vertexShader);
      if (!d.ok) return;
      sh.vertexShader = ground ? d.src.replace('#include <beginnormal_vertex>', GROUND_NORMAL) : d.src;
      Object.assign(sh.uniforms, u);
    };
    m.customProgramCacheKey = () => `${prevKey.call(m)}|drape${ground ? '|gn' : ''}`;
    m.needsUpdate = true;
    return m;
  }

  // Patch everything in the scene that's new since last time: materials, shadows, bounds.
  apply(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material || this.seen.has(mesh) || o.userData.noDrape) return;
      this.seen.add(mesh);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) this.patch(m);
      // its shadow falls from where it's drawn
      if (mesh.castShadow && !mesh.customDepthMaterial && (mesh as THREE.Mesh).isMesh) mesh.customDepthMaterial = this.depth;
      // (and it's drawn up to the hills' height above where three.js thinks it is: widen its bounds)
      const g = mesh.geometry as THREE.BufferGeometry | undefined;
      if (g && !this.seen.has(g)) {
        this.seen.add(g);
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (g.boundingSphere) this.lift(mesh, g);
      }
      // (instanced meshes are drawn uncut, their instances could be anywhere; unless their maker set
      // `userData.cull` with their bounds worked out, which are then lifted by the hills under them)
      const im = mesh as unknown as THREE.InstancedMesh;
      if (im.isInstancedMesh) { if (o.userData.cull && im.boundingSphere) this.liftSphere(im, im.boundingSphere); else im.frustumCulled = false; }
    });
  }
  // A geometry's bounds, lifted by the hills under it: for one placed in the world as it is (no
  // move, turn or scale on it or its parents), its box raised by the least and most of the ground
  // under it (the field's grid points over the cells it covers bound every height in them: they're
  // planar between). Anything else is widened by the highest hill, as the hills may be anywhere
  // under it. (Tight bounds matter: widened by the highest hill everywhere, on a map with mountains
  // meshes kilometres off screen were drawn.)
  private lift(o: THREE.Object3D, g: THREE.BufferGeometry) {
    const S = g.boundingSphere!;
    if (!placedAsIs(o)) { S.radius += this.field.max; return; }
    if (!g.boundingBox) g.computeBoundingBox();
    const B = g.boundingBox!;
    if (!Number.isFinite(B.min.x)) { S.radius += this.field.max; return; }
    const [lo, hi] = this.range(B.min.x, B.min.z, B.max.x, B.max.z), box = B.clone();
    box.min.y += lo - 0.5; box.max.y += hi + 0.5;
    box.getBoundingSphere(S);
  }
  // (an instanced mesh's own sphere, in its frame: lifted by the ground under the box round it)
  private liftSphere(o: THREE.Object3D, S: THREE.Sphere) {
    if (!placedAsIs(o)) { S.radius += this.field.max; return; }
    const c = S.center, r = S.radius, [lo, hi] = this.range(c.x - r, c.z - r, c.x + r, c.z + r);
    const box = new THREE.Box3(new THREE.Vector3(c.x - r, c.y - r + lo - 0.5, c.z - r), new THREE.Vector3(c.x + r, c.y + r + hi + 0.5, c.z + r));
    box.getBoundingSphere(S);
  }
  // the least and the most of the ground over a box (from the field's grid points over the cells it covers)
  private range(x0: number, z0: number, x1: number, z1: number): [number, number] {
    const F = this.field;
    const i0 = Math.max(0, Math.floor((x0 - F.x0) / F.step)), i1 = Math.min(F.n - 1, Math.ceil((x1 - F.x0) / F.step));
    const j0 = Math.max(0, Math.floor((z0 - F.z0) / F.step)), j1 = Math.min(F.n - 1, Math.ceil((z1 - F.z0) / F.step));
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 250000) return [0, F.max]; // (a box over most of the map: no need to look)
    let lo = Infinity, hi = -Infinity;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = F.h[j * F.n + i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    return hi >= lo ? [lo, hi] : [0, F.max];
  }
}
// (it and its parents have no move, turn or scale: its geometry is where it's drawn, before the hills)
function placedAsIs(o: THREE.Object3D) {
  for (let p: THREE.Object3D | null = o; p && p.parent; p = p.parent) {
    if (p.position.lengthSq() > 1e-12 || Math.abs(p.quaternion.w) < 1 - 1e-12 || Math.abs(p.scale.x - 1) + Math.abs(p.scale.y - 1) + Math.abs(p.scale.z - 1) > 1e-9) return false;
  }
  return true;
}
