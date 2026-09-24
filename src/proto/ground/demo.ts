// The ground demo: the shared ground on its own, in a few scenes, with the old speckled grass a
// tap away for comparison. Phone first: one finger pans (the ground stays under it), two pinch to
// zoom and twist to turn.
import * as THREE from 'three';
import '../ui/fonts';
import { markSvg } from '../ui/brand';
import { bandPolys, circlePoly } from '../land';
import { CROP, type CropName } from './covers';
import { Ground, setGroundQuality, type Covers, type GroundInput, type GroundQuality, type XZ } from './index';
import { rng, worldNoise } from './noise';
import { NavRig, SunFollow } from '../kit/camera';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
$('#mark').innerHTML = markSvg();

const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight('#e8f3ff', '#5d7040', 1.25);
const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
scene.add(hemi, sun, sun.target);

// ---- camera: the shared kit (kit/camera.ts), the game's gestures ----
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 6000);
const nav = new NavRig(cam, canvas, {
  view: { x: 0, z: 0, az: Math.PI / 4, el: 0.6, h: 200 },
  limits: { hMin: 35, hMax: 900 },
  distance: 2500,
  // the sun's shadow box follows the view, in whole texels so shadows don't crawl
  shadow: new SunFollow(sun, { dir: { x: -160, y: 260, z: 110 }, radius: 140, cover: 1.4, near: 1, far: 1200 }),
});
const view = nav.view;
const place = () => nav.apply();
function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); nav.apply(); }
window.addEventListener('resize', resize);

// ---- the old ground, for Before ----
function speckle() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#6f9e48'; x.fillRect(0, 0, 256, 256);
  const r = rng(3);
  for (let i = 0; i < 5000; i++) { x.fillStyle = `rgba(${60 + r() * 40},${120 + r() * 60},${40 + r() * 30},0.35)`; x.fillRect(r() * 256, r() * 256, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
const oldTex = speckle();

// ---- scene furniture (kept simple: the ground is the subject) ----
const M = (c: string) => new THREE.MeshLambertMaterial({ color: c });
const roadMat = new THREE.MeshLambertMaterial({ color: '#55585c', side: THREE.DoubleSide }), roofMat = M('#7a4a3a'), wallMat = M('#d8cdb8'), waterMat = new THREE.MeshLambertMaterial({ color: '#3f78a0' });
const crownMat = new THREE.MeshLambertMaterial({ color: '#4f8a36', flatShading: true }), pineMat = new THREE.MeshLambertMaterial({ color: '#2f6b35', flatShading: true });
const trunkMat = M('#6b4a2f');
const crownGeo = new THREE.IcosahedronGeometry(3.4, 1).translate(0, 5.6, 0), pineGeo = new THREE.ConeGeometry(3, 9, 7).translate(0, 7, 0), trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6).translate(0, 1.75, 0);

function strip(path: XZ[], half: number, y: number, mat: THREE.Material) {
  const pos: number[] = [];
  for (const q of bandPolys(path, half, half)) pos.push(q[0].x, y, q[0].z, q[3].x, y, q[3].z, q[1].x, y, q[1].z, q[1].x, y, q[1].z, q[3].x, y, q[3].z, q[2].x, y, q[2].z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}
function trees(list: (XZ & { s: number; pine: boolean })[], y: (x: number, z: number) => number = () => 0) {
  const g = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, l: typeof list) => {
    const x = new THREE.InstancedMesh(geo, mat, Math.max(1, l.length));
    l.forEach((t, i) => x.setMatrixAt(i, m.compose(v.set(t.x, y(t.x, t.z), t.z), q, s.set(t.s, t.s, t.s))));
    x.count = l.length; x.castShadow = x.receiveShadow = true;
    g.add(x);
  };
  mk(trunkGeo, trunkMat, list);
  mk(crownGeo, crownMat, list.filter((t) => !t.pine));
  mk(pineGeo, pineMat, list.filter((t) => t.pine));
  return g;
}
function house(x: number, z: number, rot: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 6, 7), wallMat); body.position.y = 3;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 5.6, 3, 4, 1).rotateY(Math.PI / 4).scale(1.15, 1, 0.9), roofMat); roof.position.y = 7.5;
  g.add(body, roof);
  g.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  g.position.set(x, 0, z); g.rotation.y = -rot;
  return g;
}
// a rectangle of plot: w along the road direction a, d back from it
const rect = (x: number, z: number, a: number, w: number, d: number): XZ[] => {
  const ux = Math.cos(a), uz = Math.sin(a), nx = -uz, nz = ux;
  return [{ x: x - ux * w / 2, z: z - uz * w / 2 }, { x: x + ux * w / 2, z: z + uz * w / 2 }, { x: x + ux * w / 2 + nx * d, z: z + uz * w / 2 + nz * d }, { x: x - ux * w / 2 + nx * d, z: z - uz * w / 2 + nz * d }];
};
const curve = (pts: [number, number][], n = 60): XZ[] => {
  // Catmull-Rom through the points
  const v = pts.map(([x, z]) => new THREE.Vector3(x, 0, z));
  return new THREE.CatmullRomCurve3(v).getPoints(n).map((p) => ({ x: p.x, z: p.z }));
};

// ---- scenes ----
interface Built { group: THREE.Group; grounds: THREE.Mesh[]; ground: Ground; desc: string; home: { x: number; z: number; h: number }; labels?: { x: number; y: number; z: number; t: string }[]; height?: (x: number, z: number) => number }
let cur: Built | null = null;
const labelsEl = $('#labels');

function countryside(): Built {
  const ground = new Ground({ region: { x0: -600, z0: -600, size: 1200 }, seed: 3 });
  const group = new THREE.Group();
  const lane1 = curve([[-640, -120], [-300, -60], [-60, 40], [180, 30], [420, 150], [640, 170]]);
  const lane2 = curve([[60, -640], [20, -300], [-40, 40], [-10, 320], [80, 640]]);
  const blocked = [...bandPolys(lane1, 5.5, 5.5), ...bandPolys(lane2, 5.5, 5.5)];
  // a hamlet where the lanes cross
  const plots: GroundInput['plots'] = [];
  const r = rng(7);
  for (let i = 0; i < 9; i++) {
    const k = 8 + i * 3, p = lane1[k], q = lane1[k + 1], a = Math.atan2(q.z - p.z, q.x - p.x), side = i % 2 ? 1 : -1;
    const nx = -Math.sin(a) * side, nz = Math.cos(a) * side;
    const poly = rect(p.x + nx * 7, p.z + nz * 7, a + (side < 0 ? Math.PI : 0), 16, 32);
    plots.push({ poly, kind: i === 4 ? 'site' : 'garden' });
    if (i !== 4) group.add(house(p.x + nx * 15, p.z + nz * 15, a));
  }
  const pond = circlePoly({ x: -230, z: 210 }, 26, 32);
  const input: GroundInput = { seed: 3, blocked, plots, water: [pond], lanes: [{ path: lane1, half: 5.5 }, { path: lane2, half: 5.5 }] };
  // trees scattered at random, then gathered into the woods (as the game does)
  ground.layout.setInput(input);
  const list: (XZ & { s: number; pine: boolean })[] = [];
  for (let i = 0; i < 900; i++) list.push({ x: (r() - 0.5) * 1200, z: (r() - 0.5) * 1200, s: 0.8 + r() * 0.6, pine: r() < 0.25 });
  ground.settleTrees(list);
  const standing = list.filter((t) => !blocked.some((b) => inside(t, b)) && !plots.some((p) => inside(t, p.poly)) && Math.hypot(t.x + 230, t.z - 210) > 32);
  input.trees = standing;
  ground.paint(input);
  group.add(strip(lane1, 3.2, 0.05, roadMat), strip(lane2, 3.2, 0.05, roadMat), trees(standing));
  const w = new THREE.Mesh(new THREE.CircleGeometry(26, 32).rotateX(-Math.PI / 2), waterMat); w.position.set(-230, 0.08, 210); group.add(w);
  return { group, grounds: [plane(1500)], ground, desc: 'Countryside: a patchwork of fields of 2 to 8 ha behind hedgerows, woods, a pond with lush grass round it, a hamlet with gardens and a cleared building plot.', home: { x: -60, z: 40, h: 200 } };
}
const inside = (p: XZ, poly: XZ[]) => {
  let ins = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) if ((poly[a].z > p.z) !== (poly[b].z > p.z) && p.x < ((poly[b].x - poly[a].x) * (p.z - poly[a].z)) / (poly[b].z - poly[a].z) + poly[a].x) ins = !ins;
  return ins;
};

function townEdge(): Built {
  const ground = new Ground({ region: { x0: -600, z0: -600, size: 1200 }, seed: 5 });
  const group = new THREE.Group();
  const main: XZ[] = [{ x: -600, z: 0 }, { x: 600, z: 0 }];
  const side: XZ[] = [{ x: 0, z: 0 }, { x: 0, z: -180 }];
  const close: XZ[] = [{ x: -160, z: 0 }, { x: -160, z: 150 }];
  const blocked = [...bandPolys(main, 7, 7), ...bandPolys(side, 6, 6), ...bandPolys(close, 6, 6)];
  const plots: GroundInput['plots'] = [];
  const add = (x: number, z: number, a: number, site = false) => { plots.push({ poly: rect(x, z, a, 15, 34), kind: site ? 'site' : 'garden' }); if (!site) group.add(house(x + Math.cos(a + Math.PI / 2) * 8, z + Math.sin(a + Math.PI / 2) * 8, a)); };
  // houses both sides of the main road west of the junction, and along the side road
  for (let x = -290; x <= -20; x += 18) { if (Math.abs(x + 160) > 14) { add(x, 9, 0); add(x, -9, Math.PI, x === -110); } }
  for (let z = -30; z >= -160; z -= 18) { add(9, z, -Math.PI / 2); add(-9, z, Math.PI / 2); }
  for (let z = 25; z <= 140; z += 18) add(-151, z, -Math.PI / 2);
  const park = rect(-60, 60, 0, 150, 90);
  const town = [{ x: 60, z: 10 }, { x: 100, z: -10 }];
  const input: GroundInput = { seed: 5, blocked, plots, parks: [{ poly: park, stripes: 0.2 }], town, lanes: [{ path: [{ x: 120, z: 0 }, { x: 600, z: 0 }], half: 7 }] };
  const r = rng(11), list: (XZ & { s: number; pine: boolean })[] = [];
  for (let i = 0; i < 700; i++) list.push({ x: (r() - 0.5) * 1200, z: (r() - 0.5) * 1200, s: 0.8 + r() * 0.6, pine: r() < 0.2 });
  ground.layout.setInput(input);
  ground.settleTrees(list);
  const standing = list.filter((t) => !blocked.some((b) => inside(t, b)) && !plots.some((p) => inside(t, p.poly)) && !inside(t, park) && Math.hypot(t.x + 100, t.z + 60) > 200);
  input.trees = standing;
  ground.paint(input);
  group.add(strip(main, 4, 0.05, roadMat), strip(side, 3.2, 0.05, roadMat), strip(close, 3.2, 0.05, roadMat), trees(standing));
  return { group, grounds: [plane(1500)], ground, desc: 'Town edge: gardens round the houses, a park mown in stripes, mown verges, a building site, and the fields beginning where the town ends.', home: { x: -60, z: 10, h: 200 } };
}

function hills(): Built {
  const ground = new Ground({ terrain: true });
  const H = (x: number, z: number) => {
    const n = worldNoise(x, z, 420, 3) * 0.6 + worldNoise(x, z, 160, 4) * 0.3 + worldNoise(x, z, 60, 5) * 0.1;
    const ridge = Math.max(0, 1 - Math.hypot(x - 80, z + 60) / 520);
    return Math.max(0, (n - 0.3) * 190 + ridge * ridge * 170);
  };
  const size = 1400, seg = 180;
  const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, ground.material);
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  const r = rng(5), list: (XZ & { s: number; pine: boolean })[] = [];
  for (let i = 0; i < 500; i++) {
    const x = (r() - 0.5) * 1300, z = (r() - 0.5) * 1300, h = H(x, z), sl = Math.abs(H(x + 3, z) - H(x - 3, z)) + Math.abs(H(x, z + 3) - H(x, z - 3));
    if (h < 60 && sl < 3 && worldNoise(x, z, 200, 9) > 0.5) list.push({ x, z, s: 0.8 + r() * 0.5, pine: r() < 0.5 });
  }
  group.add(trees(list, H));
  return { group, grounds: [mesh], ground, desc: 'Hills: rock and scree where the ground is steep, heather and bleached moor grass on the high tops, pasture in the valleys. Worked out from the slope and height per pixel.', home: { x: 60, z: -40, h: 600 }, height: H };
}

function gallery(): Built {
  const ground = new Ground({ region: { x0: -150, z0: -150, size: 300 }, seed: 1, hedges: false, terrain: true });
  const S = 56, G = 12, cols = 4;
  type Sw = { t: string; c?: Covers; y?: number; tilt?: boolean };
  const F = (crop: CropName) => ({ field: 1, crop: CROP[crop], dir: 0.4 });
  const sw: Sw[] = [
    { t: 'Pasture' }, { t: 'Rough grass', c: { rough: 1 } }, { t: 'Lawn', c: { lawn: 1 } }, { t: 'Lawn, mown stripes', c: { lawn: 1, crop: CROP.stripes, dir: 0.4 } },
    { t: 'Wet grass', c: { wet: 1 } }, { t: 'Woodland floor', c: { wood: 1 } }, { t: 'Bare earth', c: { bare: 1 } }, { t: 'Grass field', c: F('grass') },
    { t: 'Wheat', c: F('wheat') }, { t: 'Barley', c: F('barley') }, { t: 'Ploughed', c: F('plough') }, { t: 'Oilseed rape', c: F('rape') },
    { t: 'Ley', c: F('ley') }, { t: 'Stubble', c: F('stubble') }, { t: 'Rock and scree (steep)', tilt: true }, { t: 'Heather moor (high)', y: 110 },
  ];
  const x0 = -((S + G) * cols - G) / 2, at = (i: number) => ({ x: x0 + (i % cols) * (S + G), z: x0 + Math.floor(i / cols) * (S + G) });
  ground.paintWith((x, z) => {
    const i = sw.findIndex((_, k) => { const p = at(k); return x >= p.x && x < p.x + S && z >= p.z && z < p.z + S; });
    return i < 0 ? null : sw[i].c ?? null;
  });
  const group = new THREE.Group(), labels: Built['labels'] = [];
  const grounds = [plane(700)];
  sw.forEach((s, i) => {
    const p = at(i);
    if (s.tilt || s.y) {
      const g = new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, ground.material);
      m.position.set(p.x + S / 2, s.y ?? 12, p.z + S / 2);
      if (s.tilt) m.rotation.x = 0.75; // about 43 degrees
      m.receiveShadow = true;
      grounds.push(m);
    }
    labels.push({ x: p.x + S / 2, y: (s.y ?? 0) + 2, z: p.z + S / 2, t: s.t });
  });
  return { group, grounds, ground, desc: 'Gallery: every kind of ground, side by side. Zoom in close to see the detail.', home: { x: 0, z: 0, h: 360 }, labels };
}

function plane(size: number) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), undefined);
  m.receiveShadow = true;
  return m;
}

const SCENES: Record<string, () => Built> = { country: countryside, town: townEdge, hills, gallery };
let before = false;
function setScene(k: string) {
  if (cur) {
    scene.remove(cur.group, cur.ground.hedges, ...cur.grounds);
    cur.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && !(o as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose(); });
    for (const g of cur.grounds) g.geometry.dispose();
    cur.ground.dispose();
  }
  cur = SCENES[k]();
  scene.add(cur.group, cur.ground.hedges, ...cur.grounds);
  // the hills scene isn't flat: the camera pans and pivots on the ground itself
  nav.setGround(cur.height, [-50, 400]);
  applyBefore();
  nav.setView(cur.home);
  labelsEl.innerHTML = (cur.labels ?? []).map((l) => `<div>${l.t}</div>`).join('');
  $('#desc').textContent = cur.desc;
  document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach((b) => b.classList.toggle('on', b.dataset.scene === k));
  place();
  renderer.shadowMap.needsUpdate = true;
}
const oldMat = new THREE.MeshLambertMaterial({ map: oldTex });
function applyBefore() {
  if (!cur) return;
  // the old grass repeated every 22.5 m (60 times across the game's 1352 m plane), in world space
  for (const g of cur.grounds) {
    if (before) {
      const uv = g.geometry.getAttribute('uv') as THREE.BufferAttribute, pos = g.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 22.5, pos.getZ(i) / 22.5);
      uv.needsUpdate = true;
    }
    g.material = before ? oldMat : cur.ground.material;
  }
  cur.ground.hedges.visible = !before;
  $('#before').classList.toggle('on', before);
  $('#before').textContent = before ? 'After' : 'Before';
}

// ---- controls ----
document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach((b) => (b.onclick = () => setScene(b.dataset.scene!)));
document.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach((b) => (b.onclick = () => { nav.animateTo({ h: Number(b.dataset.zoom) }); }));
$('#before').onclick = () => { before = !before; applyBefore(); };
const QS: GroundQuality[] = ['high', 'medium', 'low'];
let qi = 0;
function setQuality(q: GroundQuality) { qi = QS.indexOf(q); setGroundQuality(q); $('#quality').textContent = q[0].toUpperCase() + q.slice(1); }
$('#quality').onclick = () => setQuality(QS[(qi + 1) % QS.length]);
let dusk = false;
function setDusk(on: boolean) {
  dusk = on;
  scene.background = new THREE.Color(on ? '#4a4a66' : '#a9cbe3');
  hemi.color.set(on ? '#9aa0c8' : '#e8f3ff'); hemi.groundColor.set(on ? '#3a3830' : '#5d7040'); hemi.intensity = on ? 0.7 : 1.25;
  sun.color.set(on ? '#ffb27a' : '#fff3dc'); sun.intensity = on ? 1.3 : 2.3;
  $('#dusk').classList.toggle('on', on);
  renderer.shadowMap.needsUpdate = true;
}
$('#dusk').onclick = () => setDusk(!dusk);

// ---- loop, with a perf readout ----
let last = performance.now(), frames = 0, acc = 0, shown = 0;
const v3 = new THREE.Vector3();
function frame(now: number) {
  const dt = now - last;
  last = now; frames++; acc += dt;
  nav.update(Math.min(0.1, dt / 1000), now);
  renderer.render(scene, cam);
  if (cur?.labels) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    cur.labels.forEach((l, i) => {
      v3.set(l.x, l.y, l.z).project(cam);
      const el = labelsEl.children[i] as HTMLElement;
      el.style.left = `${((v3.x + 1) / 2) * w}px`; el.style.top = `${((1 - v3.y) / 2) * h}px`;
    });
  }
  if (now - shown > 500 && cur) {
    const i = renderer.info.render, tb = cur.ground.textureBytes();
    $('#perf').textContent = `${Math.round((1000 * frames) / acc)} fps · ${(acc / frames).toFixed(1)} ms · ${i.calls} calls · ${Math.round(i.triangles / 1000)}k tris · ground tex ${((tb.shared + tb.cover) / 1048576).toFixed(1)} MB · paint ${cur.ground.stats.paint.toFixed(0)} ms`;
    shown = now; frames = 0; acc = 0;
  }
  requestAnimationFrame(frame);
}
setScene(new URLSearchParams(location.search).get('scene') ?? 'country');
setQuality('high');
setDusk(false);
resize();
requestAnimationFrame(frame);
(window as unknown as { nav: NavRig }).nav = nav;
// Cost per pixel: the ground filling the whole screen with nothing else drawn, old grass against
// the new ground at each quality (ms per frame, waiting for the GPU each time). Ratios carry over
// to a phone better than the absolute times from a software renderer do.
function pixelCost(frames = 20) {
  const gl = renderer.getContext(), px = new Uint8Array(4), s2 = new THREE.Scene();
  s2.add(hemi.clone(), sun.clone());
  const g = new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 22.5, pos.getZ(i) / 22.5);
  const m = new THREE.Mesh(g);
  m.position.set(view.x, cur?.height?.(view.x, view.z) ?? 0, view.z);
  s2.add(m);
  const time = (mat: THREE.Material) => {
    m.material = mat;
    for (let i = 0; i < 3; i++) renderer.render(s2, cam);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t = performance.now();
    for (let i = 0; i < frames; i++) { renderer.render(s2, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - t) / frames;
  };
  const was = QS[qi], out: Record<string, number> = {};
  out.old = time(oldMat);
  for (const q of QS) { setGroundQuality(q); out[q] = time(cur!.ground.material); }
  out.old2 = time(oldMat); // (again, to see the noise)
  setGroundQuality(was);
  g.dispose();
  return out;
}
(window as unknown as { groundDemo: unknown }).groundDemo = { pixelCost, setScene, setQuality, setDusk, view, nav, place, renderer, scene, cam, get ground() { return cur?.ground; }, setBefore: (b: boolean) => { before = b; applyBefore(); } };
