import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_LIMITS, clampView, groundToScreen, keepUnder, lerpView, nearestAz, rotateAbout, screenToGround, shadowFrame,
  tiltAbout, zoomAbout, type Lens, type View,
} from './viewmath';

const ORTHO: Lens = { width: 412, height: 915 };
const PERSP: Lens = { width: 412, height: 915, fov: (45 * Math.PI) / 180 };
const ELS = [0.35, 0.6, 0.9, 1.2, 1.52];
const AZS = [-3, -1.2, 0, Math.PI / 4, 2, 3.1];
// including views 100 km from the origin
const AT = [{ x: 0, z: 0 }, { x: 1234.5, z: -567.8 }, { x: 100000, z: -100000 }, { x: -100000, z: 250 }];
const SCREEN = [{ x: 206, y: 457 }, { x: 20, y: 60 }, { x: 390, y: 880 }, { x: 300, y: 200 }];
function* views(hs = [60, 300]): Generator<View> {
  for (const el of ELS) for (const az of AZS) for (const p of AT) for (const h of hs) yield { ...p, h, az, el };
}
const hills = (x: number, z: number) => 25 * Math.sin(x / 90) * Math.cos(z / 70) + 10;

describe('screen and ground', () => {
  it('screenToGround and groundToScreen are inverses, orthographic and perspective, far from the origin too', () => {
    let worst = 0;
    for (const lens of [ORTHO, PERSP]) for (const v of views()) for (const s of SCREEN) {
      const g = screenToGround(v, lens, s.x, s.y);
      if (!g) { expect(lens.fov).toBeTruthy(); continue; } // a perspective ray above the horizon
      const b = groundToScreen(v, lens, g);
      worst = Math.max(worst, Math.hypot(b.x - s.x, b.y - s.y));
      expect(b.depth).toBeGreaterThan(0);
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('matches a three.js camera placed the way the game has always placed it', () => {
    const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
    let worst = 0;
    for (const lens of [ORTHO, PERSP]) for (const v of views()) {
      if (Math.abs(v.x) > 5000) continue; // float32 matrices: compare near the origin
      const aspect = lens.width / lens.height;
      const cam = lens.fov ? new THREE.PerspectiveCamera((lens.fov * 180) / Math.PI, aspect, 1, 20000) : new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
      const d = lens.fov ? v.h / (2 * Math.tan(lens.fov / 2)) : 1200;
      if (cam instanceof THREE.OrthographicCamera) { cam.left = (-v.h * aspect) / 2; cam.right = (v.h * aspect) / 2; cam.top = v.h / 2; cam.bottom = -v.h / 2; }
      cam.updateProjectionMatrix();
      cam.position.set(v.x + Math.sin(v.az) * Math.cos(v.el) * d, Math.sin(v.el) * d, v.z + Math.cos(v.az) * Math.cos(v.el) * d);
      cam.lookAt(v.x, 0, v.z);
      cam.updateMatrixWorld();
      for (const s of SCREEN) {
        ray.setFromCamera(new THREE.Vector2((s.x / lens.width) * 2 - 1, -(s.y / lens.height) * 2 + 1), cam);
        const g = screenToGround(v, lens, s.x, s.y);
        if (!ray.ray.intersectPlane(plane, hit) || !g) continue;
        worst = Math.max(worst, Math.hypot(hit.x - g.x, hit.z - g.z) / v.h);
      }
    }
    expect(worst).toBeLessThan(1e-4); // float32 in three.js
  });

  it('finds the terrain under a point, not the flat plane', () => {
    for (const lens of [ORTHO, PERSP]) for (const v of views([120])) {
      const ground = { heightAt: hills, range: [-20, 40] as [number, number] };
      for (const s of SCREEN) {
        const g = screenToGround(v, lens, s.x, s.y, ground);
        if (!g) continue;
        expect(Math.abs(g.y - hills(g.x, g.z))).toBeLessThan(1e-3);
        const b = groundToScreen(v, lens, g);
        expect(Math.hypot(b.x - s.x, b.y - s.y)).toBeLessThan(1e-4);
      }
    }
  });
});

describe('the ground stays under the finger', () => {
  const lensSets = [ORTHO, PERSP];
  const check = (f: (v: View, lens: Lens, w: { x: number; y: number; z: number }, s: { x: number; y: number }) => View, terrain = false) => {
    let worst = 0, n = 0;
    const ground = terrain ? { heightAt: hills, range: [-20, 40] as [number, number] } : undefined;
    for (const lens of lensSets) for (const v of views()) {
      // (a perspective eye down among the test hills isn't a view anyone can have)
      if (terrain && lens.fov && (Math.sin(v.el) * v.h) / (2 * Math.tan(lens.fov / 2)) < 60) continue;
      const w = screenToGround(v, lens, 206, 600, ground);
      if (!w) continue;
      for (const s of SCREEN) {
        const v2 = f(v, lens, w, s);
        if (!screenToGround(v2, lens, s.x, s.y)) continue; // that spot is sky, in perspective
        const b = groundToScreen(v2, lens, w);
        if (b.depth <= 0) continue;
        worst = Math.max(worst, Math.hypot(b.x - s.x, b.y - s.y));
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
    return worst;
  };
  it('pan: the point grabbed follows the finger anywhere on the screen', () => {
    expect(check((v, lens, w, s) => keepUnder(v, lens, w, s.x, s.y))).toBeLessThan(1e-6);
    expect(check((v, lens, w, s) => keepUnder(v, lens, w, s.x, s.y), true)).toBeLessThan(1e-6);
  });
  it('pinch zoom about the fingers', () => {
    expect(check((v, lens, w, s) => zoomAbout(v, lens, DEFAULT_LIMITS, w, s.x, s.y, v.h * 0.37))).toBeLessThan(1e-6);
    expect(check((v, lens, w, s) => zoomAbout(v, lens, DEFAULT_LIMITS, w, s.x, s.y, v.h * 2.2), true)).toBeLessThan(1e-6);
  });
  it('twist about the fingers', () => {
    expect(check((v, lens, w, s) => rotateAbout(v, lens, w, s.x, s.y, v.az + 1.3))).toBeLessThan(1e-6);
    expect(check((v, lens, w, s) => rotateAbout(v, lens, w, s.x, s.y, v.az - 2.9), true)).toBeLessThan(1e-6);
  });
  it('tilt about the fingers', () => {
    expect(check((v, lens, w, s) => tiltAbout(v, lens, DEFAULT_LIMITS, w, s.x, s.y, v.el + 0.4))).toBeLessThan(1e-6);
    expect(check((v, lens, w, s) => tiltAbout(v, lens, DEFAULT_LIMITS, w, s.x, s.y, v.el - 0.3), true)).toBeLessThan(1e-6);
  });
  it('is as precise 100 km out as at the origin (metres)', () => {
    for (const x of [0, 100000, -100000]) {
      const v = { x, z: x / 2, h: 40, az: 0.7, el: 0.5 };
      const w = screenToGround(v, ORTHO, 100, 100)!;
      const v2 = keepUnder(v, ORTHO, w, 300, 800);
      const g = screenToGround(v2, ORTHO, 300, 800)!;
      expect(Math.hypot(g.x - w.x, g.z - w.z)).toBeLessThan(1e-8);
    }
  });
});

describe('clamps and animation', () => {
  it('clamps zoom, tilt and bounds', () => {
    const l = { ...DEFAULT_LIMITS, bounds: { minX: -520, maxX: 520, minZ: -520, maxZ: 520 } };
    expect(clampView({ x: 900, z: -900, h: 5, az: 9, el: 2 }, l)).toEqual({ x: 520, z: -520, h: 35, az: 9, el: 1.52 });
    expect(clampView({ x: 0, z: 0, h: 5000, az: 0, el: 0 }, l)).toMatchObject({ h: 900, el: 0.35 });
    // a zoom past the limit stops at it, and still keeps the point under the finger
    const v = { x: 10, z: 20, h: 40, az: 1, el: 0.8 };
    const w = screenToGround(v, ORTHO, 50, 700)!;
    const z = zoomAbout(v, ORTHO, l, w, 50, 700, 1);
    expect(z.h).toBe(35);
    const b = groundToScreen(z, ORTHO, w);
    expect(Math.hypot(b.x - 50, b.y - 700)).toBeLessThan(1e-6);
    expect(tiltAbout(v, ORTHO, l, w, 50, 700, 3).el).toBe(1.52);
  });
  it('lerpView: exact ends, even zoom, literal turn', () => {
    const a = { x: 0, z: 0, h: 50, az: 0, el: 0.4 }, b = { x: 100, z: -40, h: 200, az: 3, el: 1.2 };
    expect(lerpView(a, b, 0)).toEqual(a);
    expect(lerpView(a, b, 1)).toEqual(b);
    const m = lerpView(a, b, 0.5);
    expect(m.h).toBeCloseTo(100, 9); // geometric mean
    expect(m).toMatchObject({ x: 50, z: -20, az: 1.5 });
    expect(m.el).toBeCloseTo(0.8, 12);
    expect(nearestAz(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.1, 12);
  });
});

describe('shadow follow', () => {
  it('matches the game: the box grows in steps and slides in whole texels', () => {
    const dir = { x: -160, y: 260, z: 110 };
    const D = new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    const X = new THREE.Vector3(0, 1, 0).cross(D).normalize(), Y = D.clone().cross(X).normalize();
    for (const v of [{ x: 0, z: 20, h: 300 }, { x: 123.4, z: -77.7, h: 35 }, { x: 100000.3, z: 5.5, h: 900 }]) {
      const f = shadowFrame({ ...v, az: 0, el: 0.6 }, { dir }, 2048);
      // the game's own formula
      const r = 120 * Math.pow(1.6, Math.max(0, Math.ceil(Math.log((v.h * 0.9) / 120) / Math.log(1.6))));
      const texel = (2 * r) / 2048;
      const c = new THREE.Vector3(v.x, 0, v.z);
      const u = c.dot(X), w = c.dot(Y);
      c.addScaledVector(X, Math.round(u / texel) * texel - u).addScaledVector(Y, Math.round(w / texel) * texel - w);
      expect(f.r).toBe(r);
      expect(Math.hypot(f.centre.x - c.x, f.centre.y - c.y, f.centre.z - c.z)).toBeLessThan(1e-6 * Math.max(1, Math.abs(v.x) / 1000));
      expect(Math.abs(f.centre.x - v.x)).toBeLessThan(texel);
    }
  });
});
