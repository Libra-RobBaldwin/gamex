// Review checks (cost, maths and API) for the doors and moving parts. Each test here failed when
// it was written; it names a real problem, not a style preference. Browser-side checks live in
// docs/handover/tools/review-cost-*.mjs.
import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { MODELS } from './models';
import { VehicleRenderer } from './render';
import { DoorStates, doorSeconds } from './doors';
import { geometry } from './build';
import { MOTION } from './motion';
import type { Model } from './types';
import demoSource from './demo.ts?raw';

const byStyle = (style: string, year: number, f: (m: Model) => boolean = () => true) => {
  const m = MODELS.find((x) => x.style === style && x.from <= year && x.to >= year && f(x));
  if (!m) throw new Error(`no ${style} in ${year}`);
  return m;
};

describe('review: shadows', () => {
  // The vehicle buckets cast shadows (near and middle levels), but the shadow pass draws them
  // with three's default depth material, which knows nothing of the motion tags: an open slam
  // door or a lowered pantograph casts the shadow of a shut door or a raised one.
  test('a vehicle casting a shadow casts it with its doors, bogies and pantographs where the shader put them', () => {
    const slam = byStyle('coach-stock', 1940, (x) => x.design.panelled === true);
    const g = geometry(slam, 0).getAttribute('vd');
    let hinged = 0;
    for (let i = 0; i < g.count; i++) if (g.getX(i) === MOTION.hinge) hinged++;
    expect(hinged).toBeGreaterThan(0);
    const vr = new VehicleRenderer({ shadows: true });
    vr.begin();
    vr.add(slam, 0, new THREE.Matrix4(), [new THREE.Color('#884422')], 0, 0, 1, 0, 0);
    vr.end(0);
    const mesh = vr.group.children[0] as THREE.InstancedMesh;
    expect(mesh.castShadow).toBe(true);
    const depth = mesh.customDepthMaterial;
    expect(depth, 'no customDepthMaterial: the shadow pass draws every door shut and every pantograph up').toBeDefined();
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    depth!.onBeforeCompile(sh, undefined as unknown as THREE.WebGLRenderer);
    expect(sh.vertexShader).toContain('mvKind');
    vr.dispose();
  });
});

describe('review: DoorStates API', () => {
  // A traffic or rail system that states what it wants every frame (the usual way to drive a
  // fleet) with a per-car stagger never sees the doors move: setDoors resets the wait each time,
  // even when nothing has changed.
  test('asserting the same open state every frame with a stagger still opens the doors', () => {
    const m = byStyle('metro-car', 2010);
    const ds = new DoorStates();
    const dt = 1 / 60;
    for (let t = 0; t < 0.54 + doorSeconds(m) + 1; t += dt) {
      ds.setDoors('train-7-car-3', 1, 'left', { model: m, delay: 0.54 });
      ds.update(dt);
    }
    expect(ds.get('train-7-car-3')[0]).toBe(1);
  });
});

describe('review: the Parade track geometry', () => {
  // demo.ts's oval(s, off) turns through s / R on the bends whatever the offset, so on a track or
  // lane off metres out from the centre line one metre of s is (R + off) / R metres of track.
  // Everything in the demo takes s as distance: wheels turn by odo += v·dt (so they slip on the
  // bends: 24% on the inner track, 28% on the outer), trains and cars go 24–28% faster on the
  // bends than their v, and the curvature handed to the bogies is 1 / R instead of 1 / (R + off),
  // so they over-swivel by the same share.
  test('one metre of s is one metre along every track and lane', () => {
    const src = demoSource;
    const body = src.slice(src.indexOf('function oval('), src.indexOf('\n}\n', src.indexOf('function oval(')) + 2);
    const R = +/const R = (\d+(?:\.\d+)?)/.exec(src)![1], SL = +/SL = (\d+(?:\.\d+)?)/.exec(src)![1];
    const rail = JSON.parse(/const RAIL = (\[[^\]]+\])/.exec(src)![1]) as number[];
    const oval = new Function('R', 'SL', `${body.replace(/: number/g, '')}; return oval;`)(R, SL) as (s: number, off: number) => { x: number; z: number; h: number };
    // the middle of the first bend
    const s = 2 * SL + (Math.PI * R) / 2;
    for (const off of rail) {
      const a = oval(s, off), b = oval(s + 1, off);
      expect(Math.hypot(b.x - a.x, b.z - a.z), `track at ${off} m`).toBeCloseTo(1, 2);
    }
  });
});
