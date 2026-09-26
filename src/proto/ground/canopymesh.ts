// The woods' canopy (canopy.ts) as meshes, a box at a time, for ground the game paints itself (a 50 km
// map's live play area): two levels, crowns on a 4 m grid close in and a 16 m grid from further out
// (the tiles beyond use the same grids: worldmap/tilegen.ts), shown by the zoom. One vertex-coloured
// mesh a box and level; one material for all of them.
import * as THREE from 'three';
import { canopy, type CanopyArrays, type CanopyLook } from './canopy';
import type { Ground } from './index';

type Box = { x0: number; z0: number; x1: number; z1: number };
const GRIDS = [5, 24], FAR_H = 1100; // (the view height where the coarser one takes over)

export class CanopyMeshes {
  readonly group = new THREE.Group();
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private boxes = new Map<string, (THREE.Mesh | null)[]>();
  private far = false;
  private woods = new Set<number>(); // (the fields that were woods when their canopy was made)
  constructor(private ground: Ground, private look: CanopyLook) { this.group.name = 'canopy'; }
  // (the box's canopy again: after it's painted, or repainted)
  add(box: Box) {
    const C = this.ground.cover;
    if (!C) return;
    // (on the painted map only)
    const R = C.region;
    box = { x0: Math.max(box.x0, R.x0), z0: Math.max(box.z0, R.z0), x1: Math.min(box.x1, R.x0 + R.size), z1: Math.min(box.z1, R.z0 + R.size) };
    if (box.x1 <= box.x0 || box.z1 <= box.z0) return;
    const key = `${Math.floor(box.x0 / 1000) * 1000},${Math.floor(box.z0 / 1000) * 1000}`;
    for (const m of this.boxes.get(key) ?? []) if (m) { this.group.remove(m); m.geometry.dispose(); }
    const cover = { a: C.a, x0: C.region.x0, z0: C.region.z0, size: C.region.size, n: C.region.n };
    const own = (p: { x: number; z: number }) => p.x >= box.x0 && p.x < box.x1 && p.z >= box.z0 && p.z < box.z1;
    const ms = GRIDS.map((g) => this.mesh(canopy(this.ground.layout, cover, box, g, this.look, own)));
    for (const f of this.ground.layout.plan.fieldsNear(box)) if (this.ground.layout.about(f).kind === 'wood') this.woods.add(f);
    ms.forEach((m, k) => { if (m) { m.visible = (k === 1) === this.far; this.group.add(m); } });
    this.boxes.set(key, ms);
  }
  // The ground changed in these boxes: the canopy again where a wood is or was (a building going up
  // in town, the usual change, touches none, and costs nothing here).
  changed(boxes: Box[], size = 1000) {
    const done = new Set<string>(), L = this.ground.layout;
    const woody = (b: Box) => L.plan.fieldsNear(b).some((f) => this.woods.has(f) || L.about(f).kind === 'wood');
    for (const b of boxes) for (let i = Math.floor(b.x0 / size); i <= Math.floor(b.x1 / size); i++) for (let j = Math.floor(b.z0 / size); j <= Math.floor(b.z1 / size); j++) {
      const key = `${i * size},${j * size}`;
      if (done.has(key) || !this.boxes.has(key) || !woody(b)) continue;
      done.add(key);
      this.add({ x0: i * size, z0: j * size, x1: (i + 1) * size, z1: (j + 1) * size });
    }
  }
  setView(h: number) {
    const far = this.far ? h > FAR_H * 0.88 : h > FAR_H * 1.12;
    if (far === this.far) return;
    this.far = far;
    for (const ms of this.boxes.values()) ms.forEach((m, k) => { if (m) m.visible = (k === 1) === far; });
  }
  get tris() { let n = 0; for (const ms of this.boxes.values()) for (const m of ms) if (m?.visible) n += (m.geometry.index?.count ?? 0) / 3; return n; }
  private mesh(a: CanopyArrays | null) {
    if (!a) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(a.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(a.col, 3));
    g.setIndex(new THREE.BufferAttribute(a.idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}
