// Farmsteads in the live play area. The countryside lays them out (region/fields.ts: a farmhouse, a
// barn and a shed round a yard, beside a lane or down a track to one), and the scenery tiles draw
// them beyond the live area (worldmap/country.ts farmsIn). Inside the 8 km live square no scenery is
// made, so this puts them there: the same farms, in the same places, built with the town's own
// building generator (buildgen: the farmhouse in the place's tradition) and plain barns as the tiles
// draw them; their yards claimed on the land registry, so no road is built through a farm; and their
// yards and tracks given to the live ground to paint (ground/game.ts GameWorld.extra). Built a few a
// frame after start-up and merged into one mesh a material, as the dresser does (game/dress.ts).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Lot, Network } from '../roads';
import { countryFor, farmsIn } from '../worldmap/country';
import { farmTrack, farmYard } from '../ground/farms';
import { LIVE_HALF, type WorldPlan } from '../worldmap/plan';
import { ROOFS, WALLS, type SceneBuilding } from '../worldmap/towns';
import type { XZ } from '../ground/layout';

export const LIVE_BOX = { x0: -LIVE_HALF, z0: -LIVE_HALF, x1: LIVE_HALF, z1: LIVE_HALF };
const inLive = (p: XZ) => p.x >= LIVE_BOX.x0 && p.x < LIVE_BOX.x1 && p.z >= LIVE_BOX.z0 && p.z < LIVE_BOX.z1;

// The farms' yards and tracks, for the live ground: worn earth, kept clear of hedges and crops.
const groundCache = new WeakMap<WorldPlan, { plots: { poly: XZ[]; kind: 'yard' | 'track' }[]; blocked: XZ[][] }>();
export function farmGround(plan: WorldPlan) {
  let g = groundCache.get(plan);
  if (g) return g;
  const plots: { poly: XZ[]; kind: 'yard' | 'track' }[] = [];
  for (const f of countryFor(plan).farmsNear(LIVE_BOX)) {
    if (!inLive(f)) continue;
    plots.push({ poly: farmYard(f), kind: 'yard' });
    const t = farmTrack(f);
    if (t) plots.push({ poly: t, kind: 'track' });
  }
  groundCache.set(plan, (g = { plots, blocked: [] }));
  return g;
}

const hash = (x: number, z: number) => { let h = Math.imul(Math.round(x * 10), 374761393) ^ Math.imul(Math.round(z * 10), 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// a farmhouse as a plot for buildgen (its front faces -v in the scenery's frame, +z in buildgen's)
function houseLot(b: SceneBuilding): Lot {
  const s = hash(b.x, b.z);
  return { id: -1, x: b.x, z: b.z, rot: b.rot + Math.PI, w: b.w, d: b.d, h: b.h, kind: 'house', seg: -1, seed: s, row: Math.floor(s * 1e6), front: 5, back: 11, px: 0, pw: b.w };
}

// A barn as the tiles draw it: a box with a pitched roof, flat shaded, in the scenery's colours.
const barnMat = new THREE.MeshLambertMaterial({ vertexColors: true });
function barnGeometry(b: SceneBuilding): THREE.BufferGeometry {
  const co = Math.cos(b.rot), si = Math.sin(b.rot), hw = b.w / 2, hd = b.d / 2, h = b.h, top = h + b.ridge;
  const wall = new THREE.Color(WALLS[b.wall] ?? WALLS[0]), roof = new THREE.Color(ROOFS[b.roof] ?? ROOFS[0]), foot = wall.clone().multiplyScalar(0.72);
  const at = (u: number, v: number, y: number) => [b.x + u * co - v * si, y, b.z + u * si + v * co];
  const pos: number[] = [], col: number[] = [], mid = [b.x, h / 2, b.z];
  // (each triangle wound to face out from the barn's middle, whichever way its frame turns)
  const tri = (a: number[], c: number[], d: number[], ca: THREE.Color, cc: THREE.Color, cd: THREE.Color) => {
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ox = (a[0] + c[0] + d[0]) / 3 - mid[0], oy = (a[1] + c[1] + d[1]) / 3 - mid[1], oz = (a[2] + c[2] + d[2]) / 3 - mid[2];
    if (nx * ox + ny * oy + nz * oz < 0) { [c, d] = [d, c]; [cc, cd] = [cd, cc]; }
    pos.push(...a, ...c, ...d); col.push(ca.r, ca.g, ca.b, cc.r, cc.g, cc.b, cd.r, cd.g, cd.b);
  };
  const quad = (a: number[], c: number[], d: number[], e: number[], lo: THREE.Color, hi: THREE.Color) => { tri(a, c, d, lo, lo, hi); tri(a, d, e, lo, hi, hi); };
  // the four walls (the ridge runs along u, so the ±v walls are the long eaves sides, the ±u ends have the gables)
  quad(at(-hw, -hd, 0), at(hw, -hd, 0), at(hw, -hd, h), at(-hw, -hd, h), foot, wall);
  quad(at(hw, hd, 0), at(-hw, hd, 0), at(-hw, hd, h), at(hw, hd, h), foot, wall);
  quad(at(hw, -hd, 0), at(hw, hd, 0), at(hw, hd, h), at(hw, -hd, h), foot, wall);
  quad(at(-hw, hd, 0), at(-hw, -hd, 0), at(-hw, -hd, h), at(-hw, hd, h), foot, wall);
  // the gables and the two roof slopes
  tri(at(hw, -hd, h), at(hw, hd, h), at(hw, 0, top), wall, wall, wall);
  tri(at(-hw, hd, h), at(-hw, -hd, h), at(-hw, 0, top), wall, wall, wall);
  quad(at(-hw, -hd, h), at(hw, -hd, h), at(hw, 0, top), at(-hw, 0, top), roof, roof);
  quad(at(hw, hd, h), at(-hw, hd, h), at(-hw, 0, top), at(hw, 0, top), roof, roof);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class LiveFarms {
  readonly group = new THREE.Group();
  readonly count: number; // farmsteads in the live area
  private todo: SceneBuilding[];
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  built = 0;
  done = false;
  constructor(plan: WorldPlan, net: Network, private make: (l: Lot) => { group: THREE.Group }) {
    this.group.name = 'farms';
    const farms = countryFor(plan).farmsNear(LIVE_BOX).filter(inLive);
    this.count = farms.length;
    // (the yard, house and barns, held on the land registry as a site is: roads and stations keep off)
    farms.forEach((f, k) => net.land.claim(`farm:${k}`, 'industry', [farmYard(f)]));
    this.todo = farmsIn(plan, LIVE_BOX);
  }
  // a few buildings a frame, then one mesh a material
  update(budgetMs = 4) {
    if (this.done) return;
    const t0 = performance.now();
    while (this.todo.length && performance.now() - t0 < budgetMs) {
      const b = this.todo.pop()!;
      try {
        if (b.kind === 'farm') this.bake(this.make(houseLot(b)).group);
        else this.part(barnMat, barnGeometry(b));
        this.built++;
      } catch (e) { console.warn('farm', e); }
    }
    if (this.todo.length) return;
    for (const [mat, list] of this.parts) {
      const g = mergeGeometries(list);
      for (const x of list) x.dispose();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !(mat as THREE.MeshLambertMaterial).transparent;
      mesh.receiveShadow = true;
      mesh.userData.surface = true; // (the underground view needn't draw them twice)
      this.group.add(mesh);
    }
    this.parts.clear();
    this.done = true;
  }
  private part(mat: THREE.Material, geo: THREE.BufferGeometry) { let l = this.parts.get(mat); if (!l) this.parts.set(mat, (l = [])); l.push(geo); }
  // a building's meshes into the pile, in world space
  private bake(g: THREE.Group) {
    g.updateMatrixWorld(true);
    for (const o of g.children) { const m = o as THREE.Mesh; this.part(m.material as THREE.Material, m.geometry.applyMatrix4(m.matrixWorld)); }
  }
  dispose() { this.group.parent?.remove(this.group); for (const m of this.group.children) (m as THREE.Mesh).geometry.dispose(); }
}
