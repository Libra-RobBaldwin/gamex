// Hedgerows in 3D: one instanced mesh of lumpy hedge pieces and one of hedgerow trees, so however
// many fields there are they cost two draw calls. Pieces sink a little into the ground (no face
// lies on it, so nothing can z-fight) and are flat-shaded like the game's trees.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from './noise';
import type { HedgeTree, Piece } from './hedgerows';

// A unit hedge piece (1 long, 1 high, 1 wide), its top and sides bulging irregularly. The bulges
// depend only on position, so neighbouring faces share their corners.
function hedgeGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1, 4, 2, 2);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const h = hash2(Math.round(x * 8), Math.round(y * 4) * 7 + Math.round(z * 4), 5);
    if (y < 0.01) { p.setY(i, -0.2); p.setZ(i, z * 0.8); continue; } // the foot, narrower, below ground
    // the ends stay put so pieces join; the rest billows
    const end = Math.abs(x) > 0.49 ? 0.3 : 1;
    p.setY(i, y * (0.85 + h * 0.3 * end));
    p.setZ(i, z * (0.9 + (h - 0.3) * 0.35 * end) * (y > 0.9 ? 0.7 : 1));
  }
  const n = g.toNonIndexed();
  n.computeVertexNormals();
  // darker in the bottom and the inside of the hedge
  const q = n.getAttribute('position') as THREE.BufferAttribute, col = new Float32Array(q.count * 3);
  const lo = new THREE.Color('#2f4a24'), hi = new THREE.Color('#4f7337'), c = new THREE.Color();
  for (let i = 0; i < q.count; i++) { c.lerpColors(lo, hi, Math.min(1, Math.max(0, q.getY(i) * 1.1))); col.set([c.r, c.g, c.b], i * 3); }
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

// A hedgerow tree: a round crown on a trunk (kind 1: taller and narrower, an ash), one geometry.
function treeGeometry() {
  const crown = new THREE.IcosahedronGeometry(3.6, 1); crown.translate(0, 6.4, 0);
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 5, 6); trunk.translate(0, 2.3, 0);
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const n = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex), a = new Float32Array(n.getAttribute('position').count * 3);
    for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(a, 3));
    n.deleteAttribute('uv');
    return n;
  };
  const g = mergeGeometries([paint(crown, '#4a7632'), paint(trunk, '#5e4630')])!;
  g.computeVertexNormals();
  return g;
}

export class Hedges {
  readonly group = new THREE.Group();
  private hedgeGeo = hedgeGeometry();
  private treeGeo = treeGeometry();
  private hedgeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  hedges: THREE.InstancedMesh;
  trees: THREE.InstancedMesh;
  constructor() {
    this.group.name = 'hedges';
    this.hedges = this.make(this.hedgeGeo, this.hedgeMat, 256);
    this.trees = this.make(this.treeGeo, this.treeMat, 32);
  }
  private make(g: THREE.BufferGeometry, m: THREE.Material, n: number) {
    const x = new THREE.InstancedMesh(g, m, n);
    x.castShadow = x.receiveShadow = true;
    x.count = 0;
    x.frustumCulled = false; // (instances spread over the whole map)
    this.group.add(x);
    return x;
  }
  private fit(which: 'hedges' | 'trees', n: number) {
    const cur = this[which];
    if (cur.instanceMatrix.count >= n) return cur;
    this.group.remove(cur); cur.dispose();
    return (this[which] = this.make(which === 'hedges' ? this.hedgeGeo : this.treeGeo, which === 'hedges' ? this.hedgeMat : this.treeMat, Math.ceil(n * 1.3)));
  }
  // Lay out every piece and tree. `ox`/`oz` is the floating origin.
  set(pieces: Piece[], trees: HedgeTree[], ox = 0, oz = 0) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const H = this.fit('hedges', pieces.length);
    pieces.forEach((p, i) => {
      q.setFromAxisAngle(up, -p.a);
      H.setMatrixAt(i, m.compose(v.set(p.x - ox, 0, p.z - oz), q, s.set(p.len, p.h, p.w)));
      const k = hash2(Math.round(p.x), Math.round(p.z), 9);
      H.setColorAt(i, c.setRGB(0.85 + k * 0.3, 0.9 + k * 0.2, 0.85 + (1 - k) * 0.2));
    });
    H.count = pieces.length;
    H.instanceMatrix.needsUpdate = true;
    if (H.instanceColor) H.instanceColor.needsUpdate = true;
    const T = this.fit('trees', trees.length);
    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, hash2(Math.round(t.x), Math.round(t.z), 3) * 6.28);
      T.setMatrixAt(i, m.compose(v.set(t.x - ox, 0, t.z - oz), q, s.set(t.s * (t.kind ? 0.8 : 1), t.s * (t.kind ? 1.2 : 1), t.s * (t.kind ? 0.8 : 1))));
      const k = hash2(Math.round(t.z), Math.round(t.x), 4);
      T.setColorAt(i, c.setRGB(0.85 + k * 0.25, 0.9 + k * 0.15, 0.8 + (1 - k) * 0.2));
    });
    T.count = trees.length;
    T.instanceMatrix.needsUpdate = true;
    if (T.instanceColor) T.instanceColor.needsUpdate = true;
  }
  dispose() {
    for (const x of [this.hedges, this.trees]) x.dispose();
    this.hedgeGeo.dispose(); this.treeGeo.dispose(); this.hedgeMat.dispose(); this.treeMat.dispose();
  }
}
