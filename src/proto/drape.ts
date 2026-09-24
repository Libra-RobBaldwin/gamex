// Hills for everything drawn: every mesh in the scene follows the map's height field
// (region/terrain.ts) in its vertex shader, so roads, junctions, bridges, vehicles, trains, people,
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
import type { ReliefField } from './region/terrain';

const GLSL = /* glsl */`
uniform sampler2D uTerrain;
uniform vec4 uTerrainGrid; // x0, z0, step, n
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
dWorld.y += terrainH( dWorld.xz );
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

export class Drape {
  readonly texture: THREE.DataTexture;
  readonly uniforms: { uTerrain: { value: THREE.Texture }; uTerrainGrid: { value: THREE.Vector4 } };
  private seen = new WeakSet<object>();
  private depth: THREE.MeshDepthMaterial;
  constructor(readonly field: ReliefField) {
    this.texture = new THREE.DataTexture(field.h, field.n, field.n, THREE.RedFormat, THREE.FloatType);
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = { uTerrain: { value: this.texture }, uTerrainGrid: { value: new THREE.Vector4(field.x0, field.z0, field.step, field.n) } };
    this.depth = this.patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  }
  heightAt = (x: number, z: number) => this.field.heightAt(x, z);

  // Make a material follow the hills (once; chained after any patch it already has).
  patch<M extends THREE.Material>(m: M): M {
    if (this.seen.has(m)) return m;
    this.seen.add(m);
    const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey, u = this.uniforms;
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      const d = drapeShader(sh.vertexShader);
      if (!d.ok) return;
      sh.vertexShader = d.src;
      Object.assign(sh.uniforms, u);
    };
    m.customProgramCacheKey = () => `${prevKey.call(m)}|drape`;
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
        if (g.boundingSphere) g.boundingSphere.radius += this.field.max;
      }
      if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) (mesh as unknown as THREE.InstancedMesh).frustumCulled = false;
    });
  }
}
