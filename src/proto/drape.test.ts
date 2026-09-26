import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Drape, drapeShader } from './drape';
import { field } from './worldmap/terrain';
import { waterMaterial, rippleTexture } from './water/material';

describe('drape: everything drawn follows the hills', () => {
  test('the vertex shaders the game uses are all recognised', () => {
    for (const k of ['basic', 'lambert', 'phong', 'standard', 'depth'] as const) {
      const d = drapeShader(THREE.ShaderLib[k].vertexShader);
      expect(d.ok).toBe(true);
      expect(d.src).toContain('terrainH( dWorld.xz )');
      expect(d.src).not.toContain('#include <project_vertex>');
    }
    const sprite = drapeShader(THREE.ShaderLib.sprite.vertexShader);
    expect(sprite.ok).toBe(true);
    expect(sprite.src).toContain('terrainH( dCentre.xz )');
    const line = drapeShader(new LineMaterial().vertexShader);
    expect(line.ok).toBe(true);
    expect(line.src).toContain('terrainH( dS.xz )');
    expect(line.src).toContain('terrainH( dE.xz )');
    const water = drapeShader(waterMaterial(rippleTexture()).vertexShader);
    expect(water.ok).toBe(true);
    expect(water.src).toContain('w.y += terrainH( w.xz )');
    // declared once, before use
    for (const d of [sprite, line, water]) expect(d.src.indexOf('float terrainH')).toBeLessThan(d.src.indexOf('terrainH( d') === -1 ? d.src.indexOf('terrainH( w') : d.src.indexOf('terrainH( d'));
  });
  test('a shader it can\'t place is left alone', () => {
    const src = 'void main() { gl_Position = vec4(0.0); }';
    expect(drapeShader(src)).toEqual({ src, ok: false });
  });
  test('materials get their own programs, shadows a draped depth material, and the ground is left out', () => {
    const f = field(-100, -100, 25, 9, new Float32Array(81).fill(3), 3);
    const d = new Drape(f), scene = new THREE.Scene();
    const mat = new THREE.MeshLambertMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), mat); a.castShadow = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshLambertMaterial()); ground.userData.noDrape = true;
    scene.add(a, ground);
    d.apply(scene);
    expect(mat.customProgramCacheKey()).toMatch(/\|drape$/);
    expect(a.customDepthMaterial).toBeDefined();
    expect(ground.material.customProgramCacheKey()).not.toContain('drape');
    // patched once, however often it's applied
    d.apply(scene); d.apply(scene);
    expect(mat.customProgramCacheKey().match(/\|drape/g)).toHaveLength(1);
    // its bounds grow by the hills' height (so it isn't culled when drawn up there)
    expect(a.geometry.boundingSphere!.radius).toBeGreaterThan(new THREE.BoxGeometry().boundingSphere?.radius ?? 0.8);
    // the shader gets the grid
    const sh = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: '', uniforms: {} as Record<string, THREE.IUniform> };
    mat.onBeforeCompile(sh as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect((sh.uniforms.uTerrainGrid.value as THREE.Vector4).toArray()).toEqual([-100, -100, 25, 9]);
    expect(d.heightAt(0, 0)).toBe(3);
  });
});
