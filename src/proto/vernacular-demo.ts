// Gallery of the regional buildings (docs/vernacular.md): one street per era, medieval at the back
// to modern at the front, then the village's church, pub, station, hall and corner shop, all in
// one tradition. Open /buildings-demo.html on the Vite dev server.
// Query parameters (for screenshots): ?vern=<tradition>&x=&z=&h=&el=&az=&ui=0
import * as THREE from 'three';
import { makeBuilding, setPlaces } from './buildgen';
import type { Lot, LotKind } from './roads';
import { VERNS, VERN_NAME, type Era, type Vern } from './vernacular';
import { NavRig, SunFollow, mountNavControls } from './kit/camera';

const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
if (q.get('ui') === '0') $('panel').style.display = 'none';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9cbe3');
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
scene.add(new THREE.HemisphereLight('#dfeaf5', '#5d6b4a', 1.6), sun, sun.target);
const GROUND: Record<string, string> = { nordic: '#e6edf1', desert: '#c7a870', med: '#b9a56c' };
const groundMat = new THREE.MeshLambertMaterial({ color: '#6aa046' });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true;
scene.add(ground);
const roadMat = new THREE.MeshLambertMaterial({ color: '#4c4f54' });

const ERAS: Era[] = ['medieval', 'georgian', 'victorian', 'interwar', 'postwar', 'modern'];
const ROW = 48; // (metres between streets)
const rowZ = (i: number) => (i - 3) * ROW;
let vern: Vern = VERNS.includes(q.get('vern') as Vern) ? (q.get('vern') as Vern) : 'cotswold';
const street = new THREE.Group();
scene.add(street);

let id = 1;
function lot(kind: LotKind, x: number, z: number, w: number, d: number, o: Partial<Lot> = {}): Lot {
  const front = o.front ?? 5, back = o.back ?? 10;
  return { id: id++, x, z: z - d / 2 - front, rot: 0, w, d, h: 9, kind, seg: 0, seed: ((id * 0.6180339) % 1), row: id, front, back, px: 0, pw: w + 2, ...o };
}
function build() {
  for (const c of [...street.children]) street.remove(c);
  setPlaces((_x, z) => ({ vern, era: ERAS[Math.max(0, Math.min(5, Math.round(z / ROW + 3)))], kind: 'town' }));
  const lots: Lot[] = [];
  ERAS.forEach((_, i) => {
    const z = rowZ(i);
    let x = -110;
    for (let h = 0; h < 3; h++) { lots.push(lot('house', x + 6, z, 11, 10, { pw: 13 })); x += 14; }
    const row = 1000 + i;
    for (let t = 0; t < 5; t++) { lots.push(lot('terrace', x + 2.9, z, 5.8, 9, { row, pw: 5.8, back: 8 })); x += 5.8; }
    x += 4;
    for (let s = 0; s < 2; s++) { lots.push(lot('shop', x + 4.5, z, 9, 12, { h: 10 + s * 3, front: 3, back: 5, row: 2000 + i * 3 + s, pw: 9 })); x += 9; }
    x += 4;
    lots.push(lot('flats', x + 10, z, 20, 14, { h: 13, front: 6, back: 10, pw: 22 }));
    const road = new THREE.Mesh(new THREE.PlaneGeometry(260, 9).rotateX(-Math.PI / 2), roadMat);
    road.position.set(0, 0.02, z + 4.6);
    street.add(road);
  });
  let x = -110;
  const z = rowZ(6) + 10;
  for (const arch of ['church', 'pub', 'station', 'hall', 'cornershop', 'surgery'] as const) {
    const w = arch === 'church' ? 22 : arch === 'station' ? 22 : 15;
    lots.push(lot('civic', x + w / 2 + 2, z, w, arch === 'church' ? 12 : 10, { arch, front: 7, back: arch === 'church' ? 12 : 8, pw: w + 4 }));
    x += w + 8;
  }
  setPlaces((_x, zz) => ({ vern, era: ERAS[Math.max(0, Math.min(5, Math.round(zz / ROW + 3)))], kind: 'town' }));
  for (const l of lots) {
    const b = makeBuilding(l);
    b.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    street.add(b.group);
  }
  groundMat.color.set(GROUND[vern] ?? '#6aa046');
  $('name').textContent = VERN_NAME[vern];
  $('title').textContent = VERN_NAME[vern];
  $('detail').textContent = 'Back to front: medieval, Georgian, Victorian, 1930s, post-war, modern · then the civic buildings';
}

const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 5000);
const nav = new NavRig(cam, canvas, {
  view: { x: Number(q.get('x') ?? -40), z: Number(q.get('z') ?? 60), h: Number(q.get('h') ?? 260), az: Number(q.get('az') ?? 0), el: Number(q.get('el') ?? 0.75) },
  limits: { hMin: 20, hMax: 1200, elMin: 0.35, elMax: 1.52 },
  distance: 1000,
  shadow: new SunFollow(sun, { dir: { x: -160, y: 260, z: 110 } }),
});
mountNavControls(nav, { below: $('top') });
const step = (d: number) => { vern = VERNS[(VERNS.indexOf(vern) + d + VERNS.length) % VERNS.length]; build(); };
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
function resize() { renderer.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
addEventListener('resize', resize);
resize();
build();
let last = performance.now();
renderer.setAnimationLoop(() => { const now = performance.now(); nav.update(Math.min(0.1, (now - last) / 1000), now); last = now; renderer.render(scene, cam); });
(window as unknown as { demo: object }).demo = { nav, info: renderer.info, setVern: (v: Vern) => { vern = v; build(); } };
