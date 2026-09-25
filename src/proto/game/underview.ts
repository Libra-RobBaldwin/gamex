// The underground view (docs/rail.md): the ground, the buildings and everything else on the
// surface fade back, so tunnels, underground stations and the trains in them show through.
//
// It's drawn in two passes split by one level plane just under the ground, so every triangle is
// drawn exactly once and nothing is sorted against anything else (fading the surface's many
// materials one by one would sort per object, and flicker as the camera moved):
//   1. everything above it into an off-screen target;
//   2. everything below it, straight to the screen, over a dark floor under the deepest tunnel
//      (and the sky fading to dark beyond it);
//   3. the first laid over the second at the surface's opacity.
// Meshes wholly on one side of the plane are left out of the other pass altogether (and anything
// that's always on the surface can say so: `userData.surface`).
// With the surface at full opacity that's the ordinary picture, so the fade in and out runs
// smoothly from it, and once the view is off the passes stop and the game draws as it always has.
// The sun's shadows are drawn with the surface pass (so what's left out of that pass casts none),
// and drawn whole again once the view is off.
import * as THREE from 'three';

export const FADED = 0.25; // how much of the surface shows in the underground view
const CUT = -0.3; // the plane: just under the ground, above anything built below it
const FADE_S = 0.35; // seconds to fade in or out
const DARK = new THREE.Color('#0f3322'); // (the brand's darker forest green, under everything)

export class UnderView {
  on = false;
  private k = 1; // how much of the surface shows now
  private rt: THREE.WebGLRenderTarget | null = null;
  private below = [new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT)]; // keeps y < CUT
  private above = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUT)]; // keeps y > CUT
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // (the second pass looks through a copy of the camera: three.js only re-applies the clipping
  // planes when the camera changes between draws, so the same camera would keep the first pass's)
  private cam2: THREE.Camera | null = null;
  private size = new THREE.Vector2();
  private clearWas = new THREE.Color();
  private sky = new THREE.Color();
  private bg = new THREE.Color();
  // under everything, only in the below-ground pass: a dark floor below the deepest tunnel, so
  // wherever the ground fades it fades to the dark evenly (not to the sky's colour behind it),
  // while the sky itself fades from its own colour
  private bedrock = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: DARK }));
  private shadowsOwed = false;
  private last = 0;
  private box = new THREE.Box3();
  private onlyAbove: THREE.Object3D[] = [];
  private onlyBelow: THREE.Object3D[] = [];

  // `hideBelow`: things under the ground that aren't built (the lake bed, the map's cut edge),
  // left out of the first pass
  constructor(private renderer: THREE.WebGLRenderer, private hideBelow: () => THREE.Object3D[] = () => []) {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, depth: { value: null }, k: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      // (the target holds the surface's colour. Where anything was drawn, its depth says so: that's
      // solid, whatever alpha an opaque material happened to write, which the screen would have
      // ignored. Elsewhere only see-through things were drawn, over nothing, so their colour is
      // premultiplied by their alpha: un-premultiply it. Then convert it for the screen, and lay it
      // over what's below at the surface's opacity, premultiplied.)
      fragmentShader: `uniform sampler2D map, depth; uniform float k; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(map, vUv);
          float a = texture2D(depth, vUv).x < 1.0 ? 1.0 : c.a;
          gl_FragColor = vec4(a >= 1.0 ? c.rgb : c.a > 0.0 ? c.rgb / c.a : vec3(0.0), 1.0);
          #include <colorspace_fragment>
          gl_FragColor = vec4(gl_FragColor.rgb * a * k, a * k);
        }`,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    }));
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
    this.bedrock.frustumCulled = false;
    this.bedrock.visible = false;
    this.bedrock.position.y = -70; // (under FLOOR, the deepest a tunnel goes)
    this.bedrock.scale.set(1e5, 1, 1e5);
  }
  get showing() { return this.on || this.k < 1; }
  set(on: boolean) { this.on = on; }

  // Which meshes lie wholly above the plane, or wholly below it: each pass leaves the other's out
  // altogether, rather than clipping every pixel of them (most of the town is buildings, trees and
  // vehicles, all above it).
  private split(scene: THREE.Scene) {
    this.onlyAbove.length = 0; this.onlyBelow.length = 0;
    scene.updateMatrixWorld();
    const walk = (o: THREE.Object3D, surface: boolean) => {
      if (!o.visible) return;
      // (anything that says it's always on the surface, like the woods' instanced trees, and all in it)
      surface ||= o.userData.surface === true;
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) {
        if (surface) this.onlyAbove.push(o);
        // (otherwise only what stays put: anything that moves, vehicles and trains and people among
        // them, isn't frustum culled either, and instances are moved about in place; those go in
        // both passes)
        else if (o.frustumCulled && !(o as THREE.InstancedMesh).isInstancedMesh) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          this.box.copy(m.geometry.boundingBox!);
          if (!this.box.isEmpty()) {
            this.box.applyMatrix4(o.matrixWorld);
            if (this.box.min.y > CUT + 0.01) this.onlyAbove.push(o);
            else if (this.box.max.y < CUT - 0.01) this.onlyBelow.push(o);
          }
        }
      }
      for (const c of o.children) walk(c, surface);
    };
    walk(scene, false);
  }
  private hide(list: THREE.Object3D[]) { for (const o of list) o.visible = false; }
  private show(list: THREE.Object3D[]) { for (const o of list) o.visible = true; }

  // Draw a frame (in place of renderer.render).
  render(scene: THREE.Scene, cam: THREE.Camera, now = performance.now()) {
    const r = this.renderer, dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const to = this.on ? FADED : 1;
    this.k = to < this.k ? Math.max(to, this.k - (dt * (1 - FADED)) / FADE_S) : Math.min(to, this.k + (dt * (1 - FADED)) / FADE_S);
    if (this.k >= 1 && !this.on) {
      if (this.shadowsOwed) { r.shadowMap.needsUpdate = true; this.shadowsOwed = false; }
      // (and the off-screen target's memory goes back until the view is on again)
      if (this.rt) { this.rt.depthTexture?.dispose(); this.rt.dispose(); this.rt = null; }
      r.render(scene, cam);
      return;
    }
    r.getDrawingBufferSize(this.size);
    // (stored as sRGB, like the screen: linear light in 8 bits would band away the ground's fine detail)
    if (!this.rt) {
      // (with a stencil: the ground leaves out the cuttings and river beds that mark it first)
      const depth = new THREE.DepthTexture(this.size.x, this.size.y, THREE.UnsignedInt248Type);
      depth.format = THREE.DepthStencilFormat;
      this.rt = new THREE.WebGLRenderTarget(this.size.x, this.size.y, { samples: 4, stencilBuffer: true, depthTexture: depth });
      this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    }
    else if (this.rt.width !== this.size.x || this.rt.height !== this.size.y) this.rt.setSize(this.size.x, this.size.y);
    const t = Math.min(1, (1 - this.k) / (1 - FADED)), was = scene.background, clear = r.getClearColor(this.clearWas), clearA = r.getClearAlpha();
    if (was instanceof THREE.Color) this.sky.copy(was); else this.sky.copy(DARK);
    if (this.bedrock.parent !== scene) scene.add(this.bedrock);
    this.split(scene);
    // 1: the surface, off the screen, on nothing (where the ground has holes, the cuttings below
    // show through them, as they do on the screen). The shadows are drawn with it, as they are
    // every frame (what this pass leaves out, being wholly under the ground, casts none: they're
    // drawn whole again once the view is off).
    scene.background = null;
    r.setClearColor(0x000000, 0);
    r.clippingPlanes = this.above;
    r.setRenderTarget(this.rt);
    this.hide(this.onlyBelow);
    r.render(scene, cam);
    this.show(this.onlyBelow);
    this.shadowsOwed = true;
    // 2: below the ground, on the screen, over the dark (with the same shadows: not drawn again)
    const hidden = this.hideBelow().filter((o) => o.visible), owed = r.shadowMap.needsUpdate;
    for (const o of hidden) o.visible = false;
    this.hide(this.onlyAbove);
    this.bedrock.visible = true;
    scene.background = this.bg.copy(this.sky).lerp(DARK, t); // (the sky, where no ground is)
    r.shadowMap.needsUpdate = false;
    r.clippingPlanes = this.below;
    r.setRenderTarget(null);
    if (!this.cam2 || this.cam2.type !== cam.type) this.cam2 = cam.clone();
    this.cam2.copy(cam);
    r.render(scene, this.cam2);
    r.shadowMap.needsUpdate = owed;
    this.show(this.onlyAbove);
    this.bedrock.visible = false;
    for (const o of hidden) o.visible = true;
    scene.background = was;
    r.setClearColor(clear, clearA);
    r.clippingPlanes = [];
    // 3: the surface laid over what's below
    this.quad.material.uniforms.map.value = this.rt.texture;
    this.quad.material.uniforms.depth.value = this.rt.depthTexture;
    this.quad.material.uniforms.k.value = this.k;
    const auto = r.autoClear;
    r.autoClear = false;
    r.render(this.qScene, this.qCam);
    r.autoClear = auto;
  }
  dispose() { this.rt?.dispose(); this.quad.geometry.dispose(); this.quad.material.dispose(); }
}
