// Hedgerows in 3D: one instanced mesh of lumpy hedge pieces and one of hedgerow trees, so however
// many fields there are they cost two draw calls. Pieces sink a little into the ground (no face
// lies on it, so nothing can z-fight) and are flat-shaded like the game's trees.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from './noise';
import type { HedgeTree, Piece } from './hedgerows';

// A unit hedge piece (1 long, 1 high, 1 wide): a cross-section of a flat foot, sloping sides and
// a rounded crown, drawn along x, with its two ends closed. 14 triangles, so thousands of metres
// of hedge stay cheap; the variety comes from each piece's own size, lean and shade.
function hedgeGeometry() {
  // cross-section (z, y), foot to foot over the top; the foot sinks below the ground
  const sec: [number, number][] = [[-0.42, -0.2], [-0.5, 0.45], [-0.3, 0.92], [0.3, 0.92], [0.5, 0.45], [0.42, -0.2]];
  const pos: number[] = [], col: number[] = [];
  const lo = new THREE.Color('#2f4a24'), hi = new THREE.Color('#4f7337'), c = new THREE.Color();
  const put = (x: number, [z, y]: [number, number]) => { pos.push(x, y, z); c.lerpColors(lo, hi, Math.min(1, Math.max(0, y * 1.1))); col.push(c.r, c.g, c.b); };
  for (let i = 0; i + 1 < sec.length; i++) {
    const a = sec[i], b = sec[i + 1];
    put(-0.5, a); put(0.5, b); put(0.5, a);
    put(-0.5, a); put(-0.5, b); put(0.5, b);
  }
  // the ends: a fan over the section (facing out along ±x)
  for (const x of [-0.5, 0.5]) for (let i = 1; i + 1 < sec.length; i++) {
    const [p, q] = x > 0 ? [sec[i], sec[i + 1]] : [sec[i + 1], sec[i]];
    put(x, sec[0]); put(x, p); put(x, q);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// A hedgerow tree: a round crown on a trunk (kind 1: taller and narrower, an ash), one geometry.
function treeGeometry() {
  const crown = new THREE.IcosahedronGeometry(3.6, 1); crown.translate(0, 6.4, 0);
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 5, 5, 1, true); trunk.translate(0, 2.3, 0); // (open: its ends are hidden)
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
    // hedges take shadows but don't cast them: thousands of metres of hedge in the shadow map,
    // redrawn every frame at the top quality tiers, cost more than the thin shadow is worth
    x.receiveShadow = true;
    x.castShadow = g === this.treeGeo;
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
