// Finds surfaces that would z-fight: two faces (from any meshes, instanced ones included) that
// lie within a few centimetres of each other, at nearly the same angle, over the same ground.
// Only what's visible is checked, so a scene's near and far looks are checked one at a time.
// Used by the tests; handy from the console too.
import * as THREE from 'three';

export interface Fight { a: string; b: string; at: [number, number, number]; gap: number; tris?: number[][][] }
interface Tri { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; n: THREE.Vector3; mesh: string; box: [number, number, number, number] }

// Every visible, non-vertical triangle in world space, its normal turned to face up (materials
// are double-sided, and from above either face shows).
function triangles(root: THREE.Object3D, minUp: number) {
  const out: Tri[] = [];
  root.updateMatrixWorld(true);
  const visible = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const m = new THREE.Matrix4(), im = new THREE.Matrix4();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !visible(o)) return;
    const mat = o.material as THREE.Material;
    if (mat.transparent) return; // water: its own sorting, never coplanar with the banks
    const pos = o.geometry.getAttribute('position'), idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const count = o instanceof THREE.InstancedMesh ? o.count : 1;
    for (let k = 0; k < count; k++) {
      if (o instanceof THREE.InstancedMesh) { o.getMatrixAt(k, im); m.multiplyMatrices(o.matrixWorld, im); } else m.copy(o.matrixWorld);
      for (let i = 0; i + 2 < n; i += 3) {
        const v = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(m));
        const nn = new THREE.Vector3().subVectors(v[1], v[0]).cross(new THREE.Vector3().subVectors(v[2], v[0]));
        const area = nn.length() / 2;
        if (area < 1e-4) continue;
        nn.normalize();
        if (nn.y < 0) nn.negate();
        if (nn.y < minUp) continue;
        out.push({ a: v[0], b: v[1], c: v[2], n: nn, mesh: o.name || (mat as THREE.MeshLambertMaterial).color?.getHexString?.() || o.uuid.slice(0, 6), box: [Math.min(v[0].x, v[1].x, v[2].x), Math.min(v[0].z, v[1].z, v[2].z), Math.max(v[0].x, v[1].x, v[2].x), Math.max(v[0].z, v[1].z, v[2].z)] });
      }
    }
  });
  return out;
}

// Height of a triangle's plane over (x, z), if (x, z) lies inside its footprint by at least `margin`.
function heightIn(t: Tri, x: number, z: number, margin: number): number | null {
  const { a, b, c } = t;
  const d = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
  if (Math.abs(d) < 1e-9) return null;
  const l1 = ((b.x - x) * (c.z - z) - (c.x - x) * (b.z - z)) / d, l2 = ((c.x - x) * (a.z - z) - (a.x - x) * (c.z - z)) / d, l3 = 1 - l1 - l2;
  // distance from each edge, in metres: barycentric times that vertex's height over the edge
  const h = (_p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => Math.abs(d) / Math.max(1e-9, Math.hypot(q.x - r.x, q.z - r.z));
  if (l1 * h(a, b, c) < margin || l2 * h(b, c, a) < margin || l3 * h(c, a, b) < margin) return null;
  return l1 * a.y + l2 * b.y + l3 * c.y;
}

// `gap`: surfaces closer than this (m) fight; `angle`: only when within this many degrees of
// parallel (steeper crossings show a clean line, not a flickering band).
export function findFights(root: THREE.Object3D, opts: { gap?: number; angle?: number; limit?: number } = {}): Fight[] {
  const gap = opts.gap ?? 0.04, cosMax = Math.cos(((opts.angle ?? 12) * Math.PI) / 180), limit = opts.limit ?? 20;
  const tris = triangles(root, 0.2), C = 2;
  const grid = new Map<string, number[]>();
  tris.forEach((t, i) => {
    for (let x = Math.floor(t.box[0] / C); x <= Math.floor(t.box[2] / C); x++) for (let z = Math.floor(t.box[1] / C); z <= Math.floor(t.box[3] / C); z++) {
      const k = `${x},${z}`; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i);
    }
  });
  const out: Fight[] = [];
  const seen = new Set<string>();
  // sample points inside each triangle: its centroid and six more towards its corners
  const W = [[1 / 3, 1 / 3], [0.7, 0.15], [0.15, 0.7], [0.15, 0.15], [0.45, 0.45], [0.1, 0.45], [0.45, 0.1]];
  for (let i = 0; i < tris.length && out.length < limit; i++) {
    const t = tris[i];
    for (const [u, v] of W) {
      const x = t.a.x * u + t.b.x * v + t.c.x * (1 - u - v), z = t.a.z * u + t.b.z * v + t.c.z * (1 - u - v);
      const y = heightIn(t, x, z, 0.01);
      if (y === null) continue;
      for (const j of grid.get(`${Math.floor(x / C)},${Math.floor(z / C)}`) ?? []) {
        if (j === i) continue;
        const o = tris[j];
        if (x < o.box[0] || x > o.box[2] || z < o.box[1] || z > o.box[3]) continue;
        if (Math.abs(t.n.dot(o.n)) < cosMax) continue;
        const yo = heightIn(o, x, z, 0.01);
        if (yo === null || Math.abs(yo - y) >= gap) continue;
        const key = `${t.mesh}|${o.mesh}`;
        if (seen.has(key) && out.length > 3) continue;
        seen.add(key);
        out.push({ a: t.mesh, b: o.mesh, at: [+x.toFixed(2), +y.toFixed(2), +z.toFixed(2)], gap: +Math.abs(yo - y).toFixed(3), tris: [t, o].map((q) => [q.a, q.b, q.c].map((v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)])) });
        break;
      }
      if (out.length >= limit) break;
    }
  }
  return out;
}
