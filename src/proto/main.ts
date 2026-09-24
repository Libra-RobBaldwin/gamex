// 3D prototype: free-form roads, plots along any street, buses and cars, rotating camera.
import * as THREE from 'three';
import './proto.css';
import { DEFAULT_OPTS, Network, ROADS, kerbOf, rectCorners, rng, closestOnPath, pointAt, stopSpan, subPath, pathLength, type Check, type End, type Lot, type P, type RSeg, type RoadDef, type RoadOpts, type RoadType, type Stop, type StopPlan } from './roads';
import { FORM_NAME, design, landFits, laneOptions, legsAt, moveOf, rescore, type Form, type Junction } from './junction';
import { PRESETS, RAIL_PRESETS, TRAINS, filterRoads, type RoadFilter } from './catalog';
import { GRADES } from './grade';
import { Flat, Solid, drawRoads, halfOfType, laneCentre, structures, GRASS_MATS, LAMP_OFF, LAMP_ON, type Lamp } from './roaddraw';
import { GRADE_STEPS } from './grade';
import { Traffic, rushLabel, type Places } from './traffic';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CIVIC, grassMats, makeBuilding as generate, makeRegion, USE } from './buildgen';
import { CELL, findRegions, type Region } from './infill';
import { NavRig, SunFollow } from './kit/camera';
import { GameGround } from './ground/game';
import { patchGround, setGroundQuality } from './ground';
import './ui/fonts';
import { formIcon, icon, roadIcon, trainIcon, type Icon } from './ui/icons';
import { Shell, type SheetSpec, type ToolHandle } from './ui/shell';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const money = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

// ---------------- world ----------------
const LAKE = { x: 250, z: -190, r: 90 };
const isWater = (p: P) => Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 4;
const BOUND = 520;
const net = new Network(isWater, BOUND, 11);
// an industrial estate south of the centre
const INDUSTRIAL = (p: P) => p.z < -215 && Math.abs(p.x) < 280;
net.zoneAt = (p) => (INDUSTRIAL(p) ? 'industrial' : 'town');
const CENTRE = { x: 0, z: 0 };
const rand = rng(99);

// ---------------- three setup ----------------
const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9cbe3');

scene.add(new THREE.HemisphereLight('#e8f3ff', '#5d7040', 1.25));
const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
const HOME = { az: Math.PI / 4, el: 0.6 };
const EL_MIN = 0.35, EL_MAX = 1.52;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// The shared camera (kit/camera.ts), the one every page uses: gestures, wheel, keys and animated moves
// (any touch cancels those). The sun follows the view so shadows stay sharp where you're looking;
// its shadow area only changes size in big steps and slides in whole shadow-map texels, so edges
// don't shimmer. The game's own input hooks are set with the rest of the input code below.
const nav = new NavRig(cam, canvas, {
  view: { x: 0, z: 20, h: 300, ...HOME },
  limits: { hMin: 35, hMax: 900, elMin: EL_MIN, elMax: EL_MAX, bounds: { minX: -BOUND, maxX: BOUND, minZ: -BOUND, maxZ: BOUND } },
  shadow: new SunFollow(sun, { dir: { x: -160, y: 260, z: 110 } }),
});
const view = nav.view;

function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  nav.apply();
}
window.addEventListener('resize', resize);

// ---------------- ground, water ----------------
// the shared ground (src/proto/ground): pasture, fields and hedgerows, lawns, woods, verges
const gameGround = new GameGround({ net, queue: () => queue, trees: () => trees, lake: LAKE, industrial: INDUSTRIAL, parks: () => infill.map((b) => ({ cells: b.region?.cells ?? [], size: CELL })) }, BOUND);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(BOUND * 2.6, BOUND * 2.6), gameGround.ground.material);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
// Grass drawn on top of the ground (verges, roundabout islands, cutting slopes, gardens, parks)
// takes the ground's own look: the painter already paints those places as lawn or rough grass.
for (const m of [...GRASS_MATS, ...grassMats()]) { m.color.set('#ffffff'); patchGround(m, gameGround.ground.uniforms); }
// the ground leaves out any cutting a road or railway runs down into (they mark the stencil first)
{ const gm = ground.material as THREE.MeshLambertMaterial; gm.stencilWrite = true; gm.stencilRef = 1; gm.stencilFunc = THREE.NotEqualStencilFunc; ground.renderOrder = -9; }
scene.add(gameGround.ground.hedges);
scene.add(ground);
const beach = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r + 7, 72), new THREE.MeshLambertMaterial({ color: '#d9c894' }));
beach.rotation.x = -Math.PI / 2;
beach.position.set(LAKE.x, 0.05, LAKE.z);
const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE.r, 72), new THREE.MeshPhongMaterial({ color: '#3f86bf', shininess: 90, specular: '#cfe6ff' }));
lake.rotation.x = -Math.PI / 2;
lake.position.set(LAKE.x, 0.1, LAKE.z);
lake.receiveShadow = true;
scene.add(beach, lake);

// ---------------- trees (instanced) ----------------
interface Tree { x: number; z: number; s: number; kind: number }
let trees: Tree[] = [];
for (let i = 0; i < 1400; i++) {
  const p = { x: (rand() * 2 - 1) * BOUND, z: (rand() * 2 - 1) * BOUND };
  // woods on the outskirts, a few in town
  const dc = Math.hypot(p.x, p.z);
  if (dc < 140 && rand() < 0.85) continue;
  if (isWater(p) || Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r + 10) continue;
  trees.push({ ...p, s: 0.8 + rand() * 0.7, kind: rand() < 0.3 ? 1 : 0 });
}
const crownGeo = new THREE.IcosahedronGeometry(3.4, 1);
const pineGeo = new THREE.ConeGeometry(3, 9, 7);
const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6);
const crownMat = new THREE.MeshLambertMaterial({ color: '#4f8a36', flatShading: true });
const pineMat = new THREE.MeshLambertMaterial({ color: '#2f6b35', flatShading: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
const MAXT = 1600;
const crowns = new THREE.InstancedMesh(crownGeo, crownMat, MAXT);
const pines = new THREE.InstancedMesh(pineGeo, pineMat, MAXT);
const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAXT);
for (const m of [crowns, pines, trunks]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

// Is a woodland tree standing somewhere it shouldn't? Roads and junctions answer through the land
// registry (a spatial hash, so this looks only at claims near the tree); plots through `lots`.
function treeBlocked(t: Tree, lots: Lot[]) {
  if (!net.land.free([{ x: t.x - 3, z: t.z - 3 }, { x: t.x + 3, z: t.z - 3 }, { x: t.x + 3, z: t.z + 3 }, { x: t.x - 3, z: t.z + 3 }])) return true;
  // plots and parks have their own planting
  if (infillCells.has(cellKey(t.x, t.z))) return true;
  for (const l of lots) {
    const c = net.parcelCentre(l);
    if (Math.hypot(t.x - c.x, t.z - c.z) > net.parcelR(l) + 3) continue;
    const dx = t.x - c.x, dz = t.z - c.z, co = Math.cos(l.rot), si = Math.sin(l.rot);
    if (Math.abs(dx * co + dz * si) < l.pw / 2 + 2 && Math.abs(-dx * si + dz * co) < (l.d + l.front + l.back) / 2 + 2) return true;
  }
  return false;
}

// Clear trees from where things now stand. Given a new plot, only trees on it are looked at
// (a building going up shouldn't re-check the whole map); with nothing given, all of them are.
function refreshTrees(only?: Lot) {
  const before = trees.length;
  if (only) {
    const c = net.parcelCentre(only), r = net.parcelR(only) + 3;
    trees = trees.filter((t) => Math.abs(t.x - c.x) > r || Math.abs(t.z - c.z) > r || !treeBlocked(t, [only]));
    if (trees.length === before) return;
  } else trees = trees.filter((t) => !treeBlocked(t, net.lots));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  let nc = 0, np = 0;
  trees.forEach((t, i) => {
    m.compose(v.set(t.x, 1.75 * t.s, t.z), q, sc.set(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m);
    if (t.kind === 0) { m.compose(v.set(t.x, 5.6 * t.s, t.z), q, sc.set(t.s, t.s * 1.1, t.s)); crowns.setMatrixAt(nc++, m); }
    else { m.compose(v.set(t.x, 7 * t.s, t.z), q, sc.set(t.s, t.s, t.s)); pines.setMatrixAt(np++, m); }
  });
  trunks.count = trees.length; crowns.count = nc; pines.count = np;
  for (const x of [trunks, crowns, pines]) x.instanceMatrix.needsUpdate = true;
}


// ---------------- roads ----------------
const roadGroup = new THREE.Group();
scene.add(roadGroup);
// ---------------- junctions ----------------
// Every junction designs itself (see junction.ts) whenever the roads meeting there change; a
// junction the player has customised keeps their choices as long as its roads stay the same.
const junctions = new Map<number, Junction>();
let seenAt: (node: number) => Map<string, number> | undefined = () => undefined;
const geoFor = (node: number) => ({ fits: (polys: P[][]) => landFits(net, node, polys) });
function redesignJunctions() {
  for (const id of [...junctions.keys()]) if (!net.nodes.has(id) || legsAt(net, id).length < 3) junctions.delete(id);
  for (const n of net.nodes.values()) {
    const legs = legsAt(net, n.id);
    if (legs.length < 3) continue;
    const old = junctions.get(n.id);
    const same = old && old.legs.length === legs.length && legs.every((l) => old.legs.includes(l.seg.id));
    if (same && !old!.auto) continue;
    const j = design(net, n.id, geoFor(n.id), seenAt(n.id));
    if (j) junctions.set(n.id, j);
  }
}
// Every junction registers the land its shape takes (see land.ts), so nothing else is built on it.
function claimJunctions() {
  net.land.releaseWhere((k) => k.startsWith('junction:') && !junctions.has(Number(k.slice(9))));
  for (const j of junctions.values()) net.land.claim(`junction:${j.node}`, 'junction', j.shape?.claims ?? []);
}
// The one place the town changes shape. Roads first, then the junctions they form (which claim
// their land), then anything standing on land that's now taken moves out, then plots fill in.
// Every step reads the land registry, so the order can't let one thing be built over another.
function commitRoads(made: number[] = []) {
  redesignJunctions();
  claimJunctions();
  evictFromWorks();
  lamps = drawRoads(net, roadGroup, junctions, trunkMat, crownMat, editJ);
  if (made.length) queuePlots(made);
  onRoadsChanged();
  gameGround.invalidate();
}
let lamps: Lamp[] = [];
const rebuildRoads = () => commitRoads();

// ---------------- buildings ----------------
// Each building is generated once, then baked into world space. Settled buildings are merged into
// 120 m chunks (one mesh per material per chunk) so a detailed town stays cheap to draw; only
// buildings rising or being demolished are drawn on their own.
interface Part { m: THREE.Material; g: THREE.BufferGeometry }
interface Built { lot: Lot; born: number; height: number; name: string; detail: string; parts: Part[]; solo: THREE.Group | null; chunk: string | null; dying?: number; region?: Region }
const buildings: Built[] = [];
const cityGroup = new THREE.Group();
scene.add(cityGroup);
const CH = 120;
const chunks = new Map<string, { members: Set<Built>; group: THREE.Group; dirty: boolean }>();

function bakeGroup(group: THREE.Group) {
  group.updateMatrixWorld(true);
  const parts: Part[] = [];
  for (const o of group.children) {
    const mesh = o as THREE.Mesh;
    parts.push({ m: mesh.material as THREE.Material, g: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld) });
    mesh.geometry.dispose();
  }
  return parts;
}
function bake(l: Lot) {
  const b = generate(l);
  return { height: b.height, name: b.name, detail: b.detail, parts: bakeGroup(b.group) };
}
function soloGroup(b: Built) {
  const g = new THREE.Group();
  for (const p of b.parts) { const m = new THREE.Mesh(p.g, p.m); m.castShadow = !(p.m as THREE.MeshLambertMaterial).transparent; m.receiveShadow = true; g.add(m); }
  return g;
}
function toChunk(b: Built) {
  if (b.solo) { cityGroup.remove(b.solo); b.solo = null; }
  const key = `${Math.floor(b.lot.x / CH)},${Math.floor(b.lot.z / CH)}`;
  let c = chunks.get(key);
  if (!c) { c = { members: new Set(), group: new THREE.Group(), dirty: true }; chunks.set(key, c); cityGroup.add(c.group); }
  c.members.add(b); c.dirty = true; b.chunk = key;
}
function fromChunk(b: Built) {
  if (!b.chunk) return;
  const c = chunks.get(b.chunk)!;
  c.members.delete(b); c.dirty = true; b.chunk = null;
}
function rebuildChunk(c: { members: Set<Built>; group: THREE.Group; dirty: boolean }) {
  for (const m of [...c.group.children]) { c.group.remove(m); (m as THREE.Mesh).geometry.dispose(); }
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const b of c.members) for (const p of b.parts) { let l = byMat.get(p.m); if (!l) byMat.set(p.m, (l = [])); l.push(p.g); }
  for (const [m, list] of byMat) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = !(m as THREE.MeshLambertMaterial).transparent;
    mesh.receiveShadow = true;
    c.group.add(mesh);
  }
  c.dirty = false;
}

let queue: Lot[] = [];
let placesDirty = true;
let onRoadsChanged = () => {};
const LEVELS = [['Traffic', 1], ['Busy', 2], ['Quiet', 0.4]] as const;
let level = 0;
function spawnLot(l: Lot, animate = true) {
  net.fitParcel(l);
  net.lots.push(l);
  const b: Built = { lot: l, born: performance.now(), solo: null, chunk: null, ...bake(l) };
  buildings.push(b);
  if (animate) { b.solo = soloGroup(b); b.solo.scale.y = 0.01; cityGroup.add(b.solo); }
  else toChunk(b);
  placesDirty = true;
}
// a plot got trimmed (a road went through its garden): landscape it again
function regenerate(b: Built) {
  fromChunk(b);
  for (const p of b.parts) p.g.dispose();
  Object.assign(b, bake(b.lot));
  if (b.solo) { cityGroup.remove(b.solo); b.solo = null; }
  toChunk(b);
}
function demolish(b: Built) {
  fromChunk(b);
  if (!b.solo) { b.solo = soloGroup(b); cityGroup.add(b.solo); }
  b.dying = performance.now();
  placesDirty = true;
}
const shortName = (b: Built) => b.name.split(' · ')[0];
// A junction grew (a crossroads became a roundabout, a slip road was added): buildings standing on
// its land are compulsorily purchased, gardens running into it are cut back, queued plots dropped.
function evictFromWorks() {
  const works = (c: { owner: string }) => c.owner === 'road';
  for (const b of buildings) {
    if (b.dying || b.lot.id < 0) continue;
    const l = b.lot;
    if (!net.land.free(rectCorners(l.x, l.z, l.rot, l.w, l.d))) { net.lots = net.lots.filter((x) => x !== l); demolish(b); continue; }
    if (!net.land.free(net.parcelRect(l, -0.3), works)) { const was = l.back; net.fitParcel(l); if (l.back !== was) regenerate(b); }
  }
  queue = queue.filter((l) => net.lotFree(l));
}


// ---------------- leftover land ----------------
let infill: Built[] = [];
const infillCells = new Map<string, Built>();
const cellKey = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
let infillDue = true;
// Find the gaps the plots leave and fill them: community buildings where one fits, else parks,
// playgrounds, allotments, car parks, verges. Plots still waiting to be built count as taken.
function refreshInfill() {
  for (const b of infill) { fromChunk(b); for (const p of b.parts) p.g.dispose(); }
  infill = [];
  infillCells.clear();
  const { regions, civics } = findRegions(net, queue);
  for (const l of civics) spawnLot(l, false);
  for (const r of regions) {
    const shape = makeRegion({ cells: r.cells, size: CELL, kind: r.kind, seed: r.seed, roadEdges: r.roadEdges });
    const lot: Lot = { id: -1, x: r.centre.x, z: r.centre.z, rot: 0, w: 0, d: 0, h: 0, kind: 'civic', seg: -1, seed: r.seed, row: 0, front: 0, back: 0, px: 0, pw: 0, arch: r.kind };
    const b: Built = { lot, born: 0, height: shape.height, name: shape.name, detail: shape.detail, parts: bakeGroup(shape.group), solo: null, chunk: null, region: r };
    toChunk(b);
    infill.push(b);
    for (const c of r.cells) infillCells.set(cellKey(c.x, c.z), b);
  }
  refreshTrees();
  gameGround.invalidate();
}

function queuePlots(segs: number[]) {
  for (const id of segs) {
    const plots = net.plotsFor(id, CENTRE);
    // denser, taller near the centre; a few gaps elsewhere
    for (const p of plots) if (Math.hypot(p.x, p.z) < 200 || rand() < 0.75) queue.push(p);
  }
  // and around any roundabout these roads meet at
  const nodes = new Set(segs.flatMap((id) => { const s = net.segs.get(id); return s ? [s.a, s.b] : []; }));
  for (const id of nodes) {
    const j = junctions.get(id);
    if (!j || j.form !== 'roundabout' || !j.shape) continue;
    const legs = legsAt(net, id).map((l) => ({ seg: l.seg.id, ang: l.ang, half: net.half(l.seg) }));
    queue.push(...net.plotsAround(id, j.R + 3, legs, CENTRE));
  }
  queue.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
}

// ---------------- starter town ----------------
function seedTown() {
  const road = (a: P, b: P, c?: P, o = DEFAULT_OPTS) => net.build(net.snapStart(a, 3), net.snapStart(b, 3), c, o);
  const as = (type: RoadType, o = DEFAULT_OPTS) => ({ ...o, type });
  // the high street is a tree-lined avenue, from under the flyover to a roundabout on the bypass
  // (it ends exactly where the bypass's curve will cross it, so the two meet there)
  const bypass = net.makePath({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 });
  const cross = bypass.findIndex((p) => p.z < 0), [p0, p1] = [bypass[cross - 1], bypass[cross]];
  road({ x: -230, z: 0 }, { x: p0.x + ((p1.x - p0.x) * p0.z) / (p0.z - p1.z), z: 0 }, undefined, as('avenue'));
  road({ x: 0, z: -200 }, { x: 0, z: 200 });
  road({ x: 0, z: 0 }, { x: 170, z: -98 }); // a 30° diagonal
  road({ x: -185, z: -96 }, { x: 0, z: -96 }); // (a cul-de-sac, its turning head clear of the flyover's ramp)
  road({ x: -110, z: -96 }, { x: -170, z: 0 }); // a slanting link
  road({ x: 0, z: 70 }, { x: -80, z: 150 }, { x: -80, z: 70 }); // a crescent
  road({ x: 60, z: 0 }, { x: 60, z: 110 });
  road({ x: 0, z: 110 }, { x: 110, z: 110 });
  road({ x: 110, z: 110 }, { x: 170, z: -98 }, { x: 230, z: 40 }, as('dual')); // a sweeping dual-carriageway bypass
  const over = { ...DEFAULT_OPTS, cross: 'bridge' as const };
  road({ x: -215, z: -150 }, { x: -215, z: 150 }, undefined, over); // a flyover across the main road
  road({ x: 0, z: -150 }, { x: 510, z: -200 }, undefined, over); // a bridge over the lake, and on out of town to the east
  // the industrial estate
  road({ x: 0, z: -200 }, { x: 0, z: -380 });
  road({ x: -190, z: -290 }, { x: 150, z: -290 });
  road({ x: 0, z: -380 }, { x: -170, z: -370 }, { x: -110, z: -420 });
  // a motorway along the south edge, reached from the estate by a dual carriageway
  // the motorway ends at a roundabout, where it carries on east as a fast dual carriageway
  road({ x: -510, z: -470 }, { x: 0, z: -470 }, undefined, as('motorway'));
  road({ x: 0, z: -470 }, { x: 510, z: -470 }, undefined, as('dual-2-70-0'));
  road({ x: 0, z: -380 }, { x: 0, z: -470 }, undefined, as('dual'));
  // a main line railway along the north, lifted over the high road, and a road tunnel under the lake
  net.build({ x: -500, z: 185 }, { x: 500, z: 185 }, undefined, { ...DEFAULT_OPTS, type: 'rail-main', cross: 'bridge', grade: 0.025 });
  road({ x: 250, z: -470 }, { x: 250, z: 90 }, undefined, { ...DEFAULT_OPTS, type: 'street', cross: 'tunnel', grade: 0.08 }); // from the dual carriageway
  // roads out of town: west from the end of the high street, north under the railway (both run off the map)
  road({ x: -230, z: 0 }, { x: -510, z: 0 }, undefined, as('rural-60'));
  road({ x: 0, z: 200 }, { x: 0, z: 510 }, undefined, as('rural-60'));
  // junctions are designed (and take their land) before any plot is laid out
  commitRoads([...net.segs.keys()]);
  // most of the town exists at the start, the rest grows in front of you
  const now = Math.floor(queue.length * 0.8);
  for (const l of queue.splice(0, now)) if (net.lotFree(l)) spawnLot(l, false);
}

// ---------------- UI ----------------
type Mode = 'look' | 'road' | 'rail' | 'stop';
type RoadKind = 'straight' | 'curve' | 'smooth';
let mode: Mode = 'look';
let roadKind: RoadKind = 'straight';
interface Draft { a: End; b: End; c?: P }
let draft: Draft | null = null;
let picks: End[] = []; // curve tool: taps placed so far (start, bend)
let dragging = false;
let draftCheck: Check | null = null;
let trace: P[] = []; // curve tool: where the finger has been during a drag
const opts: RoadOpts = { ...DEFAULT_OPTS };
const lastType = { road: 'street', rail: 'rail-main' };
const HEIGHTS = [['auto', 'Auto', 'heightAuto'], ['level', 'Level', 'minus'], ['up', 'Climb', 'trendUp']] as const;
const CROSS = [['junction', 'Join', 'arrowsCross'], ['bridge', 'Over', 'bridge'], ['tunnel', 'Under', 'tunnel']] as const;
const KINDS = [['straight', 'Straight', 'line'], ['curve', 'Curve', 'curve'], ['smooth', 'Smooth', 'smooth']] as const;
const cls = () => (mode === 'rail' ? 'rail' : 'road') as 'road' | 'rail';

// The HUD is the shell (ui/shell.ts, docs/hud.md): a status strip, a compass and a bar of four
// buttons (Build · Transport · Layers · Menu) at rest; sheets, a tool strip and a layers pop-over
// when asked for. Everything below registers with it rather than adding markup of its own.
const shell = new Shell($('#ui'), {
  onCompass: () => nav.resetNorth(),
  onPause: () => togglePause(),
  onRate: () => cycleRate(),
  onPerf: () => togglePerf(),
});
// the tool in use (a road or rail type, or bus stops), if any
let tool: ToolHandle | null = null;

const ctrlOf = (d: Draft) => (roadKind === 'smooth' ? net.smoothCtrl(d.a, d.b) : d.c);
function draftChanged() {
  draftCheck = draft ? net.check(draft.a, draft.b, ctrlOf(draft), opts) : null;
  drawGhost();
  renderBar();
  tool?.setUndo(!!draft || picks.length > 0);
}
function clearDraft() { draft = null; picks = []; draftChanged(); hint(); }

function setMode(m: Mode) {
  const building = m === 'road' || m === 'rail';
  if (building && (mode === 'road' || mode === 'rail') && m !== mode) lastType[mode] = opts.type;
  mode = m;
  // each mode has its colourway (green roads, blue rail, orange stops); the HUD reads it from here
  document.body.dataset.mode = m;
  if (m === 'rail' && opts.cross === 'junction') opts.cross = 'bridge';
  clearDraft();
}
function setKind(k: RoadKind) {
  roadKind = k;
  refreshOptions();
  clearDraft();
}
// The hint over the map. It leads with the current tool's icon unless given its own. With a tool
// in use it stays until replaced; otherwise it's a short message that clears itself.
const MODE_ICON: Record<Mode, Icon> = { look: 'finger', road: 'road', rail: 'train', stop: 'busStop' };
function hint(text?: string, ic?: Icon) {
  let t = text;
  if (t === undefined) {
    if (!tool) return shell.hint(null);
    if (mode === 'stop') t = 'Tap a road, on the side you want the stop · the bus will call there';
    else if (draft) t = 'Drag the white handles to adjust, then Build';
    else if (roadKind === 'straight') t = mode === 'rail' ? 'Drag to lay track · tap a junction to see how it works' : 'Drag to draw a road · tap a junction to redesign it';
    else if (roadKind === 'smooth') t = 'Drag from a road: the new one curves smoothly out of it';
    else t = ['Drag along the curve you want · or tap start, bend, end', '2/3 · Tap the bend point: the curve pulls towards it', '3/3 · Tap where the curve ends'][picks.length];
  }
  tool?.setUndo(!!draft || picks.length > 0);
  shell.hint(t ? `${icon(ic ?? MODE_ICON[mode])}<span>${esc(t)}</span>` : null, tool ? 0 : 4000);
}

// ---- tools: picking a card in the Build sheet swaps the bar for a tool strip ----
const typeSpec = (t: RoadType) => { const d = ROADS[t]; return `${Math.round(halfOfType(t) * 2)} m wide · ${d.mph} mph · £${d.cost.toLocaleString('en-GB')}/m`; };
function endTool() {
  tool = null;
  shell.endTool();
  shell.closeSheet();
  stopPreview = null;
  setMode('look');
}
function startRoadTool(t: RoadType) {
  const rail = ROADS[t].cls === 'rail';
  tool = shell.startTool({
    name: ROADS[t].label, spec: typeSpec(t), icon: roadIcon(ROADS[t]), tone: rail ? 'rail' : 'road',
    options: roadOptions(), bind: bindRoadOptions, onUndo: undoStep, onDone: endTool, onCancel: endTool,
  });
  setMode(rail ? 'rail' : 'road');
  setType(t);
  lastType[cls()] = t;
  hint();
}
function startStopTool() {
  tool = shell.startTool({ name: 'Bus stop', spec: 'Kerbside, or a lay-by where there is room', icon: 'busStop', tone: 'stop', onDone: endTool, onCancel: endTool });
  setMode('stop');
  hint();
}
// Undo steps back through what's being placed: the blueprint, then the curve's taps.
function undoStep() {
  if (draft) { draft = null; picks = []; draftChanged(); }
  else if (picks.length) { picks.pop(); drawGhost(); }
  hint();
}

// ---- the tool's options: shape, height, gradient, and what happens where it crosses something ----
function gradeSteps() {
  const d = ROADS[opts.type];
  const base = d.cls === 'rail' ? (d.rack ? [0.05, 0.1, 0.15, 0.2] : [0.01, 0.015, 0.025, 0.035, 0.06]) : GRADE_STEPS;
  const s = base.filter((g) => g <= d.maxGrade + 1e-9);
  return s.length ? s : [d.maxGrade];
}
const pctTxt = (g: number) => { const v = g * 100; return `${Math.abs(v - Math.round(v)) > 0.01 ? v.toFixed(1) : Math.round(v)}%`; };
function roadOptions() {
  const [, hl, hi] = HEIGHTS.find((h) => h[0] === opts.height)!;
  const on = (b: boolean) => `class="${b ? 'on' : ''}" aria-pressed="${b}"`;
  return `<span class="og" role="group" aria-label="Shape">${KINDS.map(([k, label, ic]) => `<button data-k="${k}" ${on(roadKind === k)}>${icon(ic)}<span>${label}</span></button>`).join('')}</span><span class="sep"></span>
    <button id="g-h" aria-label="Height: ${hl}">${icon(hi)}<span>${hl}</span></button>
    <button id="g-g" aria-label="Steepest gradient ${pctTxt(opts.grade)}">${icon('angle')}<span>${pctTxt(opts.grade)}</span></button><span class="sep"></span>
    <span class="og" role="group" aria-label="Where it crosses something">${CROSS.map(([k, label, ic]) => `<button data-x="${k}" ${on(opts.cross === k)}>${icon(ic)}<span>${label}</span></button>`).join('')}</span>`;
}
function refreshOptions() { if (mode === 'road' || mode === 'rail') tool?.set({ options: roadOptions() }); }
function bindRoadOptions(el: HTMLElement) {
  el.querySelectorAll<HTMLButtonElement>('[data-k]').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.k as RoadKind)));
  el.querySelectorAll<HTMLButtonElement>('[data-x]').forEach((b) => b.addEventListener('click', () => {
    opts.cross = b.dataset.x as RoadOpts['cross'];
    refreshOptions(); draftChanged();
    const sp = ROADS[opts.type].cls === 'rail' ? GRADES.rail : GRADES.road;
    hint({
      junction: mode === 'rail' ? 'Track you cross joins up (points); roads are always bridged' : 'Roads you cross at the same height become junctions (they design themselves)',
      bridge: `Goes over what it crosses — ${sp.clear} m clearance over roads and rail, ${sp.water} m over water`,
      tunnel: `Goes under what it crosses — a cutting near the surface, a bored tunnel deeper, ${sp.under} m under water`,
    }[opts.cross]);
  }));
  el.querySelector('#g-h')!.addEventListener('click', () => {
    opts.height = HEIGHTS[(HEIGHTS.findIndex((h) => h[0] === opts.height) + 1) % HEIGHTS.length][0];
    refreshOptions(); draftChanged();
    hint({ auto: 'Auto: stays near the ground, climbing or diving only to clear what it crosses', level: 'Level: holds the starting height all the way', up: 'Climb: rises at the chosen gradient the whole way' }[opts.height]);
  });
  el.querySelector('#g-g')!.addEventListener('click', () => {
    const steps = gradeSteps();
    opts.grade = steps[(steps.indexOf(opts.grade) + 1) % steps.length];
    refreshOptions(); draftChanged();
    const d = ROADS[opts.type];
    hint(d.cls === 'rail'
      ? `Steepest ${pctTxt(opts.grade)} (this line allows ${pctTxt(d.maxGrade)}) · trains climb: intercity 3%, local 3.5%, light rail 7%, rack 20%`
      : `Steepest ${pctTxt(opts.grade)} (a ${d.mph} mph road allows ${pctTxt(d.maxGrade)}) · gentler means longer ramps`);
  });
}
function setType(t: RoadType) {
  opts.type = t;
  const steps = gradeSteps();
  if (!steps.includes(opts.grade)) opts.grade = steps[steps.length - 1];
  refreshOptions();
  draftChanged();
}

// ---- the Build sheet: a tab per category, a card per thing ----
shell.addBuildCategory({ id: 'roads', label: 'Roads', icon: 'road' });
for (const id of PRESETS) shell.addBuildItem('roads', { id, label: ROADS[id].label, spec: `${ROADS[id].blurb} · ${typeSpec(id)}`, icon: roadIcon(ROADS[id]), tone: 'road', on: () => lastType.road === id, onPick: () => startRoadTool(id) });
shell.addBuildItem('roads', { id: 'more', label: 'More road types', spec: 'Filter by lanes, speed, trees, bus and cycle lanes', icon: 'adjustments', tone: 'road', on: () => !PRESETS.includes(lastType.road), onPick: () => { openRoadPicker(true); return false; } });
shell.addBuildCategory({ id: 'rail', label: 'Rail', icon: 'train' });
for (const id of RAIL_PRESETS) shell.addBuildItem('rail', { id, label: ROADS[id].label, spec: ROADS[id].blurb, icon: roadIcon(ROADS[id]), tone: 'rail', on: () => lastType.rail === id, onPick: () => startRoadTool(id) });
shell.addBuildCategory({ id: 'stops', label: 'Stops', icon: 'busStop' });
shell.addBuildItem('stops', { id: 'bus-stop', label: 'Bus stop', spec: 'On any road; a lay-by where there is room', icon: 'busStop', tone: 'stop', onPick: () => startStopTool() });
shell.addBuildItem('stops', { id: 'bus-station', label: 'Bus station', spec: 'Several bays, for busy routes', icon: 'bus', locked: 'Not in the game yet' });
shell.addBuildItem('stops', { id: 'rail-station', label: 'Railway station', spec: 'Platforms on a straight run of track', icon: 'train', locked: 'Not in the game yet' });
shell.addBuildItem('stops', { id: 'depot', label: 'Lorry depot', spec: 'Where your lorries start and are kept', icon: 'warehouse', locked: 'Not in the game yet' });
shell.addBuildCategory({ id: 'freight', label: 'Freight', icon: 'warehouse', note: 'Terminals are bought for an industry; better ones unlock as it grows.' });
shell.addBuildItem('freight', { id: 'terminals', label: 'Freight terminals', spec: 'Loading bays, sidings and jetties for industries', icon: 'warehouse', locked: 'Come with the terminals update' });
shell.addBuildCategory({ id: 'bulldoze', label: 'Bulldoze', icon: 'bulldozer' });
shell.addBuildItem('bulldoze', { id: 'bulldoze', label: 'Bulldoze', spec: 'Tap or drag over what you want to remove; costs shown first', icon: 'bulldozer', locked: 'Not in the game yet: roads stay once built' });
shell.addBuildCategory({ id: 'landscape', label: 'Landscape', icon: 'mountain' });
shell.addBuildItem('landscape', { id: 'terrain', label: 'Raise and lower land', spec: 'Hills, cuttings and embankments', icon: 'mountain', locked: 'Needs terrain, which isn’t in the game yet' });

// ---- the Layers pop-over: overlays (none are in the game yet) and the view ----
shell.addLayer({ id: 'flow', label: 'Traffic flow', icon: 'lights', disabled: 'Not in the game yet' });
shell.addLayer({ id: 'catchment', label: 'Stop catchments', icon: 'busStop', disabled: 'Not in the game yet' });
shell.addLayer({ id: 'demand', label: 'Where people want to go', icon: 'users', disabled: 'Not in the game yet' });
shell.addLayer({ id: 'landuse', label: 'Land use', icon: 'building', disabled: 'Not in the game yet' });
const viewNow = () => { const el = nav.goal.el; return el > 1.2 ? 'plan' : el < 0.45 ? 'low' : '3d'; };
shell.setViews({
  options: [{ id: '3d', label: '3D' }, { id: 'low', label: 'Low' }, { id: 'plan', label: 'Plan' }],
  current: viewNow,
  pick: (id) => { nav.tiltTo(id === 'plan' ? EL_MAX : id === 'low' ? EL_MIN : HOME.el); },
});
shell.firstRun('untitled.hint.inspect', 'Tap anything on the map to inspect it · pinch to zoom, twist to turn, two fingers up or down to tilt');

// ---------------- sheets ----------------
// Detail opens in a bottom sheet (a panel down the right in landscape); the camera turns so the
// thing you picked sits in the clear map left above or beside it, so you can see what each choice does.
type PanelKind = 'junction' | 'stop' | 'roads' | 'reset' | 'quality';
// the colourway a sheet wears: stops are orange, road work green, the rest the house green
const TONE = { junction: 'road', roads: 'road', stop: 'stop', reset: 'look', quality: 'look' } as const;
// what closing each kind of sheet undoes: a junction being edited, a stop being planned
const leaveJunction = () => { if (editJ !== null) { editJ = null; rebuildRoads(); } };
const ON_CLOSE: Partial<Record<PanelKind, () => void>> = { junction: leaveJunction, stop: () => { stopPreview = null; drawGhost(); } };
// A different sheet, or a new thing in the same one (another junction), starts at the top; a
// re-render of the same one (a filter or a form tapped) keeps its place in the list.
function openPanel(kind: PanelKind, title: string, ic: Icon, body: string, fresh = false, extra: Partial<SheetSpec> = {}) {
  return shell.openSheet({ key: kind, title, icon: ic, tone: TONE[kind], body, fresh, onClose: ON_CLOSE[kind], ...extra });
}
const closePanel = () => shell.closeSheet();
const closeSheet = closePanel;
// Put p in the middle of the clear map; if `dir` is given, turn so it runs up the screen.
function focusOn(p: P, h: number, dir?: P, el?: number) {
  let az = view.az;
  if (dir) {
    const a = Math.atan2(-dir.x, -dir.z);
    az = [a, a + Math.PI].map((v) => view.az + wrap(v - view.az)).sort((x, y) => Math.abs(x - view.az) - Math.abs(y - view.az))[0];
  }
  const c = shell.clearRect();
  nav.animateTo(nav.framing(p, (c.left + c.right) / 2, (c.top + c.bottom) / 2, { az, h, ...(el ? { el } : {}) }));
}

// ---- road picker: a few filters over the whole catalogue ----
const filt: RoadFilter = {};
const FAMILIES = ['Street', 'Avenue', 'Boulevard', 'Arterial', 'Rural', 'Dual', 'Motorway'] as const;
function roadSvg(d: RoadDef, W = 132, H = 14) {
  const parts: { w: number; c: string }[] = [];
  const side = (rev: boolean) => {
    const s = [
      { w: d.pave, c: '#bdb8ad' }, { w: d.verge, c: '#6f9a4a' }, { w: d.parking, c: '#6a6e74' }, { w: d.cycle, c: '#3f8a52' }, { w: d.bus, c: '#9c4238' }, { w: d.shoulder, c: '#55595f' },
      ...Array.from({ length: d.lanes }, () => ({ w: d.lane, c: '#44484e' })),
    ];
    return rev ? s.reverse() : s;
  };
  parts.push(...side(false), { w: d.median, c: d.medianKind === 'grass' || d.medianKind === 'trees' ? '#6f9a4a' : '#9d9a92' }, ...side(true));
  const tot = parts.reduce((t, p) => t + p.w, 0) || 1;
  let x = 0;
  const rects = parts.filter((p) => p.w > 0).map((p) => { const r = `<rect x="${((x / tot) * W).toFixed(1)}" y="0" width="${((p.w / tot) * W + 0.3).toFixed(1)}" height="${H}" fill="${p.c}"/>`; x += p.w; return r; });
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="rs">${rects.join('')}</svg>`;
}
// (inside the Build sheet, with a way back to the cards; picking one starts drawing it)
function openRoadPicker(fresh = false) {
  const chips = <T,>(label: string, key: keyof RoadFilter, vals: readonly T[], show: (v: T) => string) =>
    `<div class="fl" role="group" aria-label="${label}"><span class="lbl">${label}</span>${[undefined, ...vals].map((v) => `<button data-f="${String(key)}" data-v="${v === undefined ? '' : String(v)}" class="${filt[key] === v ? 'on' : ''}" aria-pressed="${filt[key] === v}">${v === undefined ? 'Any' : show(v)}</button>`).join('')}</div>`;
  // with, without, or either: tap to cycle
  const tri = (key: 'trees' | 'bus' | 'cycle' | 'parking', ic: Icon, words: string) => {
    const v = filt[key], state = v === true ? 'with' : v === false ? 'without' : 'either';
    return `<button data-t3="${key}" class="${v === true ? 'on' : v === false ? 'no' : ''}" aria-label="${words}: ${state}" title="${words}: ${state}">${icon(ic)}${v === true ? icon('check', 'tick') : v === false ? icon('x', 'tick') : ''}</button>`;
  };
  const list = filterRoads(filt);
  const el = openPanel('roads', 'Choose a road', 'road', `
    ${chips('Kind', 'family', FAMILIES, (f) => f)}
    ${chips('Lanes each way', 'lanes', [1, 2, 3, 4], (n) => String(n))}
    ${chips('Speed (mph)', 'mph', [20, 30, 40, 50, 60, 70], (n) => `${n}`)}
    <div class="fl" role="group" aria-label="With"><span class="lbl">With</span>${tri('trees', 'trees', 'Trees')}${tri('bus', 'bus', 'Bus lanes')}${tri('cycle', 'bike', 'Cycle lanes')}${tri('parking', 'parking', 'Parking')}</div>
    <div class="cnt">${list.length} of ${Object.values(ROADS).filter((d) => d.cls === 'road').length} road types</div>
    ${list.length ? '' : '<small>No road type has all of these. Set a filter back to Any, or tap a With chip until it’s plain.</small>'}
    <div class="rl">${list.map((d) => `<button data-pick="${d.id}" class="${d.id === lastType.road ? 'on' : ''}"><b>${icon(roadIcon(d))}${d.label}</b>${roadSvg(d)}<small>${Math.round(halfOfType(d.id) * 2)} m wide · £${d.cost.toLocaleString('en-GB')}/m · ${d.blurb}</small></button>`).join('')}</div>`,
  fresh, { from: 'build', back: () => shell.openBuild('roads') });
  el.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.f as keyof RoadFilter, v = b.dataset.v!;
    (filt as Record<string, unknown>)[k] = v === '' ? undefined : k === 'family' ? v : Number(v);
    openRoadPicker();
  }));
  el.querySelectorAll<HTMLButtonElement>('[data-t3]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.t3 as 'trees';
    filt[k] = filt[k] === undefined ? true : filt[k] === true ? false : undefined;
    openRoadPicker();
  }));
  el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    startRoadTool(b.dataset.pick!);
    const d = ROADS[opts.type];
    hint(`${d.label} · ${Math.round(halfOfType(d.id) * 2)} m wide · £${d.cost}/m · drag to draw it`);
  }));
}

// ---- Transport: lines (the stops buses call at) and buying vehicles ----
function allStops() { return [...net.segs.values()].flatMap((seg) => seg.stops.map((stop) => ({ seg, stop }))); }
shell.addTransportTab({
  id: 'lines', label: 'Lines', icon: 'transport', sub: 'Your stops and lines',
  render: (el) => {
    const stops = allStops();
    el.innerHTML = `<p class="note">Buses wander the roads and call at every stop on their side. ${stops.length ? `${stops.length} stop${stops.length === 1 ? '' : 's'} so far:` : 'There are no stops yet.'}</p>
      ${stops.map(({ seg, stop }, i) => `<button class="lrow tone-stop" data-stop="${i}"><span class="num">${icon('busStop')}</span><b>${stop.kind === 'kerb' ? 'Kerbside stop' : 'Bus lay-by'}</b><span>${esc(net.def(seg).label)} · tap to show it</span></button>`).join('')}
      <div class="acts"><button class="act primary tone-stop" data-addstop="1">${icon('plus')}<span>Add a bus stop</span></button><button class="act" disabled>${icon('transport')}<span>New line</span></button></div>
      <p class="note">New line (tap stops in order, then pick vehicles) comes with timetabled routes.</p>`;
    el.querySelector('[data-addstop]')!.addEventListener('click', () => startStopTool());
    el.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach((b) => b.addEventListener('click', () => {
      const { seg, stop } = stops[+b.dataset.stop!];
      const at = pointAt(net.path(seg), stop.s);
      showStopInfo(seg, stop);
      focusOn(at, 75);
    }));
  },
});
shell.addTransportTab({
  id: 'buy', label: 'Buy vehicles', icon: 'bus', sub: 'Buses, trains and how busy the roads are',
  render: (el) => {
    el.innerHTML = `
      <div class="grp"><span class="tab">Buses</span><small>Wander the roads and call at every stop on their side</small><button data-add="bus" class="act primary">${icon('plus')}<span>Add a bus</span></button></div>
      <div class="grp"><span class="tab">Trains</span><small>Each runs only on track it can manage: rack, electric wires, gradient</small>
        ${Object.values(TRAINS).map((t) => `<button data-train="${t.id}"><b>${icon(trainIcon(t.id))}${t.label}</b><small>${t.blurb}</small></button>`).join('')}</div>
      <div class="grp"><span class="tab">Background traffic</span><small>Cars come from homes, jobs, shops and works, and follow the clock</small>
        <div class="row3" role="group" aria-label="How busy">${LEVELS.map(([n], i) => `<button data-lvl="${i}" class="${i === level ? 'on' : ''}" aria-pressed="${i === level}">${n === 'Traffic' ? 'Normal' : n}</button>`).join('')}</div></div>`;
    el.querySelector('[data-add="bus"]')!.addEventListener('click', () => { traffic.addBus(); hint('Bus added', 'bus'); });
    el.querySelectorAll<HTMLButtonElement>('[data-train]').forEach((b) => b.addEventListener('click', () => {
      const t = TRAINS[b.dataset.train!];
      const ok = traffic.addTrain(t.id);
      hint(ok ? `${t.label} added` : `No track a ${t.label.toLowerCase()} can use${t.needsWires ? ' — it needs electrified line' : t.rack ? '' : ' — too steep, or rack only'}`, ok ? trainIcon(t.id) : 'alert');
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-lvl]').forEach((b) => b.addEventListener('click', () => { level = +b.dataset.lvl!; shell.refreshTransport(); }));
  },
});

// ---- Menu: quality, the performance readout, a new town ----
shell.addMenuItem({ id: 'quality', label: 'Quality', icon: 'sparkles', sub: () => (tierAuto ? `Auto · ${TIERS[tier].name} now` : TIERS[tier].name), onClick: () => openQuality() });
shell.addMenuItem({ id: 'perf', label: 'Performance', icon: 'activity', sub: () => (perfOn ? 'Readout showing' : 'Readout off'), onClick: () => { togglePerf(); closeSheet(); } });
shell.addMenuItem({ id: 'new', label: 'New town', icon: 'restore', sub: 'Starts again from the seed town', onClick: () => openReset() });
shell.addMenuItem({ id: 'save', label: 'Save town', icon: 'floppy', disabled: 'Not in the game yet', onClick: () => {} });
shell.addMenuItem({ id: 'load', label: 'Load town', icon: 'floppy', disabled: 'Not in the game yet', onClick: () => {} });
// The game picks its own quality from how fast frames come (see judgeFrames); a tier chosen here holds.
function openQuality() {
  const el = openPanel('quality', 'Quality', 'sparkles', `<div class="grp"><small>Auto steps down if frames run slow and back up when there’s headroom. Pick a level to hold it.</small>
    <button data-q="auto" class="${tierAuto ? 'on' : ''}" aria-pressed="${tierAuto}"><b>${icon('sparkles')}Auto</b><small>Now ${TIERS[tier].name}</small></button>
    ${TIERS.map((q, i) => `<button data-q="${i}" class="${!tierAuto && tier === i ? 'on' : ''}" aria-pressed="${!tierAuto && tier === i}"><b>${q.name}</b><small>${q.pr}× pixels · ${q.shadow ? `${q.shadow} px shadows` : 'no shadows'}</small></button>`).join('')}</div>`,
  false, { from: 'menu', back: () => shell.openMenu() });
  el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.q!;
    tierAuto = q === 'auto';
    if (!tierAuto) setTier(+q);
    openQuality();
  }));
}
// ---- a new town: nothing is saved yet, so starting again throws the player's work away; ask first ----
// (in a sheet rather than confirm(), which a sandboxed artifact frame may block outright)
function openReset() {
  const el = openPanel('reset', 'Start a new town?', 'restore', `
    <div class="grp"><small>Every road, rail line, stop and vehicle you have added goes, and the town starts again as it was. This can’t be undone.</small>
      <button data-reset="1" class="act danger">${icon('restore')}<span>Start again</span></button>
      <button data-keep="1" class="act">${icon('play')}<span>Keep playing</span></button></div>`, true, { from: 'menu', back: () => shell.openMenu() });
  el.querySelector('[data-reset]')!.addEventListener('click', () => location.reload());
  el.querySelector('[data-keep]')!.addEventListener('click', closePanel);
}

// ---- junctions: tap one in Road mode ----
let editJ: number | null = null;
function junctionNear(p: P) {
  let best: number | null = null, bd = Infinity;
  for (const j of junctions.values()) {
    if (j.form === 'join' || j.form === 'merge') continue;
    const n = net.node(j.node), d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < Math.max(10, j.R, net.nodeHalf(j.node)) + 2 && d < bd) { bd = d; best = j.node; }
  }
  return best;
}
function openJunction(node: number) {
  editJ = node;
  const j = junctions.get(node)!, n = net.node(node);
  rebuildRoads();
  renderJunction(true);
  focusOn(n, Math.max(70, j.R * 5), undefined, 1.15);
}
const pctFull = (d: number) => `${Math.round(d * 100)}%`;
function renderJunction(fresh = false) {
  if (editJ === null) return;
  const j = junctions.get(editJ)!;
  const legs = legsAt(net, editJ);
  const seen = traffic.seen.get(editJ), counted = seen ? [...seen.values()].reduce((t, v) => t + v, 0) : 0;
  const geo = geoFor(editJ);
  const forms: Form[] = legs.length === 3 ? ['priority', 'signals', 'mini', 'roundabout'] : ['roundabout', 'mini', 'signals', 'priority'];
  const auto = design(net, editJ, geo, seen)!;
  const alt = forms.map((f) => ({ f, j: rescore(net, j, geo, { form: f }) }));
  const bar = (dos: number) => `<i class="bar"><i style="width:${Math.min(100, dos * 100)}%;background:${dos < 0.7 ? '#35c46b' : dos < 0.9 ? '#e0a526' : '#e5483b'}"></i></i>`;
  const el = openPanel('junction', FORM_NAME[j.form], formIcon(j.form), `
    <div class="score">${bar(j.score.dos)}<div><b>Busiest lane ${pctFull(j.score.dos)} full</b><small>${j.score.busiest || 'all approaches'} · takes about ${Math.round(Math.min(j.score.capacity, 9999)).toLocaleString('en-GB')} vehicles an hour</small></div></div>
    <small class="sub">${j.auto ? `${icon('sparkles')}Designed automatically for the best flow` : `${icon('handStop')}Your design`} · ${counted > 60 ? `tuned on ${counted} vehicles counted here` : 'on estimated traffic (it retunes as cars are counted)'}</small>
    ${j.complex ? `<div class="warn">${icon('alert')}<span>A big junction: consider splitting it, or grade-separating the busiest road</span></div>` : ''}
    <div class="grp"><span class="tab">Form</span>
      <button data-form="auto" class="${j.auto ? 'on' : ''}" aria-pressed="${j.auto}"><b>${icon('sparkles')}Best for flow</b><small>${FORM_NAME[auto.form]}${auto.slip ? ' + slip' : ''} · ${pctFull(auto.score.dos)}</small></button>
      ${alt.map(({ f, j: a }) => `<button data-form="${f}" class="${!j.auto && j.form === f ? 'on' : ''}" aria-pressed="${!j.auto && j.form === f}"><b>${icon(formIcon(f))}${FORM_NAME[f]}</b><small>${pctFull(a.score.dos)} busiest lane</small></button>`).join('')}
    </div>
    ${j.form === 'priority' || j.form === 'signals' ? `<button data-slip="1" class="${j.slip ? 'on' : ''}" aria-pressed="${!!j.slip}"><b>${icon('ramp')}Left-turn slip lane${j.slip ? icon('check', 'tick') : ''}</b></button>` : ''}
    <div class="grp"><span class="tab">Lanes</span><small>Tap an arrow on the road to change what a lane is for. The design above is already the best balance for the traffic.</small>
      <button data-opt="1"><b>${icon('refresh')}Re-optimise lanes</b></button></div>`, fresh, { back: () => showJunctionInfo(editJ!) });
  el.querySelectorAll<HTMLButtonElement>('[data-form]').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.form!;
    junctions.set(editJ!, f === 'auto' ? auto : rescore(net, j, geo, { form: f as Form }));
    rebuildRoads(); renderJunction();
  }));
  el.querySelector('[data-slip]')?.addEventListener('click', () => { junctions.set(editJ!, rescore(net, j, geo, { form: j.form, slip: !j.slip })); rebuildRoads(); renderJunction(); });
  el.querySelector('[data-opt]')!.addEventListener('click', () => { junctions.set(editJ!, { ...rescore(net, j, geo, { form: j.form, slip: !!j.slip }), auto: j.auto }); rebuildRoads(); renderJunction(); });
}
// arrow positions on the road for the junction being edited (for tapping)
function laneArrows() {
  if (editJ === null) return [];
  const j = junctions.get(editJ)!, n = net.node(editJ);
  const out: { p: P; seg: number; i: number }[] = [];
  for (const leg of legsAt(net, editJ)) {
    const lineAt = j.form === 'roundabout' || j.form === 'mini' ? j.R + 0.3 : j.reach[leg.seg.id] ?? 0;
    (j.lanes[leg.seg.id] ?? []).forEach((_, i) => {
      const c = laneCentre(net, leg.seg, i), a = lineAt + 7.4;
      out.push({ p: { x: n.x + leg.dir.x * a - leg.dir.z * c, z: n.z + leg.dir.z * a + leg.dir.x * c, y: n.y }, seg: leg.seg.id, i });
    });
  }
  return out;
}
function arrowTap(sx: number, sy: number) {
  const hit = laneArrows().map((a) => ({ a, d: Math.hypot(toScreen(a.p).x - sx, toScreen(a.p).y - sy) })).sort((x, y) => x.d - y.d)[0];
  if (!hit || hit.d > 34) return false;
  const j = junctions.get(editJ!)!, legs = legsAt(net, editJ!);
  const leg = legs.find((l) => l.seg.id === hit.a.seg)!;
  const moves = [...new Set(legs.filter((o) => o !== leg && !(j.slip && j.slip.from === leg.seg.id && j.slip.to === o.seg.id)).map((o) => moveOf(leg, o)))];
  const optsL = laneOptions(moves);
  const cur = j.lanes[hit.a.seg][hit.a.i].join('');
  const next = optsL[(optsL.findIndex((o) => o.join('') === cur) + 1) % optsL.length];
  const lanes = { ...j.lanes, [hit.a.seg]: j.lanes[hit.a.seg].map((l, i) => (i === hit.a.i ? next : l)) };
  const before = j.score.dos;
  const nj = rescore(net, j, geoFor(editJ!), { form: j.form, slip: !!j.slip, lanes });
  junctions.set(editJ!, nj);
  rebuildRoads(); renderJunction();
  const name = (m: string[]) => m.map((x) => ({ L: 'left', S: 'ahead', R: 'right' } as Record<string, string>)[x]).join(' + ');
  hint(`Lane ${hit.a.i + 1}: ${name(next)} · busiest lane ${pctFull(nj.score.dos)} (was ${pctFull(before)})`);
  return true;
}

// what a road would knock down, in words
function demolitionSummary(lots: Lot[]) {
  const counts = new Map<string, number>();
  let residents = 0, jobs = 0;
  for (const l of lots) {
    const b = buildings.find((x) => x.lot === l);
    const n = b ? shortName(b) : l.kind;
    counts.set(n, (counts.get(n) ?? 0) + 1);
    const u = USE[l.kind];
    if (u.unit === 'jobs') jobs += u.pop; else residents += u.pop;
  }
  const list = [...counts].map(([n, c]) => `${c} × ${n}`).join(', ');
  const people = [residents && `${residents} residents rehoused`, jobs && `${jobs} jobs moved`].filter(Boolean).join(' · ');
  return { list, people };
}

// The blueprint: a card above the tool strip (length, cost, anything it knocks down, its long
// section), and the strip's main button turns into Build.
function renderBar() {
  if (!tool || (mode !== 'road' && mode !== 'rail')) return;
  if (!draft || !draftCheck) { tool.setPanel(null); tool.setPrimary(null); return; }
  // (a sheet opened from the tool, such as the junction editor, makes way for the blueprint)
  if (shell.sheetKey) closeSheet();
  const c = draftCheck;
  const n = c.clears.length;
  const kind = ctrlOf(draft) ? 'Curved road' : 'New road';
  const demo = n ? demolitionSummary(c.clears) : null;
  const pr = c.profile;
  const lift = pr && pr.maxY > 0.05
    ? `<div class="lift">${icon('mountain')}<span>${c.ok ? `up to <b>${pr.maxY.toFixed(1)} m</b> · steepest <b>${(pr.maxGrade * 100).toFixed(1)}%</b>${c.bridges ? ` · ${c.bridges} bridge${c.bridges > 1 ? 's' : ''}` : ''} · ${Math.round(c.raised)} m raised` : `would need <b>${pr.maxY.toFixed(1)} m</b> — red line shows the lowest it could go`}</span></div>${profileSvg(c)}` : '';
  tool.setPanel(`<div class="what">${icon('ruler')}<span>${kind} <b>${Math.round(c.length)} m</b> · <b class="cost">${money(c.cost)}</b></span></div>
    ${demo ? `<div class="demo">${icon('alert')}<div><b>This road demolishes ${n} building${n > 1 ? 's' : ''}</b> (flashing red): ${demo.list}.<br>${demo.people} · ${money(n * 6000)} compensation included</div></div>` : ''}
    ${lift}
    ${c.ok ? '' : `<div class="bad">${icon('alert')}<span>${c.reason}</span></div>`}`);
  // (demolishing, it's red with the bulldozer; the card above says what goes)
  tool.avoid(handles().map((h) => toScreen(h.p)));
  tool.setPrimary({ label: 'Build', title: n ? `Demolish ${n} building${n > 1 ? 's' : ''} and build` : 'Build', icon: n ? 'bulldozer' : 'check', kind: n ? 'danger' : 'primary', disabled: !(c.ok && !dragging), onClick: buildDraft });
}
function buildDraft() {
  if (!draft || !draftCheck?.ok) return;
  const doomed = new Set(draftCheck.clears);
  const summary = doomed.size ? demolitionSummary([...doomed]) : null;
  buildRoad(draft.a, draft.b, ctrlOf(draft), opts);
  draft = null;
  draftChanged();
  hint(summary ? `Demolished ${doomed.size}: ${summary.list}` : 'Built. New plots will fill in along it.', summary ? 'bulldozer' : 'check');
}

function buildRoad(a: End, b: End, ctrl: P | undefined, o: RoadOpts) {
  const made = net.build(a, b, ctrl, o);
  // demolished buildings sink away rather than vanishing
  for (const x of buildings) if (x.lot.id >= 0 && !net.lots.includes(x.lot) && !x.dying) demolish(x);
  for (const l of net.touched) { const x = buildings.find((y) => y.lot === l); if (x && !x.dying) regenerate(x); }
  commitRoads(made);
  refreshTrees();
  infillDue = true;
  return made;
}

// Long section of the blueprint: ground, the road's height, and what it has to clear.
function profileSvg(c: Check) {
  const p = c.profile!;
  const W = 320, H = 62, L = p.s[p.s.length - 1] || 1, top = Math.max(8, p.maxY + 1.5);
  const X = (s: number) => ((s / L) * W).toFixed(1), Y = (y: number) => (H - 8 - (y / top) * (H - 16)).toFixed(1);
  const parts: string[] = [`<line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}" stroke="#6f9e48" stroke-width="2"/>`];
  for (const l of p.limits) {
    const x0 = X(Math.max(0, l.s0)), w = Math.max(3, (Math.min(L, l.s1) - Math.max(0, l.s0)) / L * W).toFixed(1);
    if (l.why === 'the water') parts.push(`<rect x="${x0}" y="${Y(0)}" width="${w}" height="6" fill="#3f86bf"/>`);
    else if (l.lo !== undefined && l.hi === undefined) parts.push(`<rect x="${x0}" y="${Y(l.lo - opts.spec.clear)}" width="${w}" height="4" fill="#9aa0a8"/><line x1="${x0}" y1="${Y(l.lo)}" x2="${(+x0 + +w).toFixed(1)}" y2="${Y(l.lo)}" stroke="#ffd35a" stroke-dasharray="3 2"/>`);
    else if (l.hi !== undefined && l.lo === undefined) parts.push(`<rect x="${x0}" y="${Y(l.hi + opts.spec.clear)}" width="${w}" height="4" fill="#9aa0a8"/>`);
  }
  const pts = p.s.map((s, i) => `${X(s)},${Y(p.y[i])}`).join(' ');
  parts.push(`<polyline points="${pts}" fill="none" stroke="${c.ok ? '#4cc3ff' : '#ff5a4d'}" stroke-width="2.5" stroke-linejoin="round"/>`);
  return `<svg class="prof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${parts.join('')}</svg>`;
}

// ---------------- blueprint ghost ----------------
const ghostMat = new THREE.MeshBasicMaterial({ color: '#4cc3ff', transparent: true, opacity: 0.55, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: '#ff5a4d', transparent: true, opacity: 0.55, depthWrite: false });
const handleMat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false });
const handleRing = new THREE.MeshBasicMaterial({ color: '#1f8fd6', depthTest: false });
const guideMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7, depthWrite: false });
const doomMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0.45, depthWrite: false });
const ghost = new THREE.Group();
ghost.renderOrder = 5;
scene.add(ghost);

function handles(): { p: P; key: 'a' | 'b' | 'c' }[] {
  if (draft) {
    const at = (e: End) => ({ ...e, y: net.endHeight(e) ?? 0 });
    const hs: { p: P; key: 'a' | 'b' | 'c' }[] = [{ p: at(draft.a), key: 'a' }, { p: at(draft.b), key: 'b' }];
    if (roadKind === 'curve' && draft.c) hs.push({ p: draft.c, key: 'c' });
    return hs;
  }
  return picks.map((p, i) => ({ p, key: i === 0 ? 'a' : 'c' }));
}

function drawGhost() {
  for (const c of [...ghost.children]) { ghost.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const hr = Math.max(2, view.h * 0.016);
  const hf = new Flat(), rf = new Flat(), gf = new Flat();
  for (const h of handles()) { rf.disc(h.p, hr * 1.35, 1.2); hf.disc(h.p, hr, 1.3); }
  // guide lines from the ends to the bend point, like Cities: Skylines
  const guide = (a: P, b: P) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let t = 0; t < L; t += 4) gf.ribbon(subPath([a, b], t, Math.min(L, t + 2.2)), 0.35, 1.0);
  };
  if (!draft && picks.length === 2) guide(picks[0], picks[1]);
  if (draft && roadKind === 'curve' && draft.c) { guide(draft.a, draft.c); guide(draft.c, draft.b); }
  if (draft && draftCheck) {
    const f = new Flat();
    const gh = halfOfType(opts.type);
    f.ribbon(draftCheck.path, gh, 0.6);
    f.disc(draft.a, gh, 0.6);
    f.disc(draft.b, gh, 0.6);
    const m = f.mesh(draftCheck.ok ? ghostMat : badMat);
    m.renderOrder = 5;
    ghost.add(m);
    // the bridge's sides, so its shape reads in 3D
    const sides = new Solid();
    structures(draftCheck.path, sides, null, halfOfType(opts.type));
    if (sides.pos.length) { const sm = sides.mesh(draftCheck.ok ? ghostMat : badMat); sm.castShadow = false; sm.renderOrder = 5; ghost.add(sm); }
    // every building in the way gets a flashing red block over it
    for (const l of draftCheck.clears) {
      const b = buildings.find((x) => x.lot === l);
      const h = (b?.height ?? l.h) + 1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(l.w + 1, h, l.d + 1), doomMat);
      box.position.set(l.x, h / 2, l.z);
      box.rotation.y = -l.rot;
      box.renderOrder = 6;
      ghost.add(box);
    }
  }
  if (stopPreview) {
    const { seg, t, side } = stopPreview, probe = { id: 0, s: t, side, kind: 'layby' as const, take: { pave: 0, lane: 0, land: 0, park: 0 } };
    const [a, b] = stopSpan(probe), path = net.path(seg), K = kerbOf(net.def(seg));
    const sp = subPath(path, Math.max(0, a), Math.min(pathLength(path), b));
    const pf = new Flat();
    pf.strip(sp, () => (side === 1 ? [K - 3.2, K + 0.2] : [-K - 0.2, -K + 3.2]), 0.8);
    const m = pf.mesh(ghostMat); m.renderOrder = 5; ghost.add(m);
  }
  for (const [f, mat, order] of [[gf, guideMat, 9], [rf, handleRing, 10], [hf, handleMat, 11]] as const) {
    if (!f.pos.length) continue;
    const m = f.mesh(mat);
    m.renderOrder = order;
    ghost.add(m);
  }
}

// ---------------- building card ----------------
const ray = new THREE.Raycaster();
// (sx, sy relative to the canvas, as the shared camera gives them)
function ndc(sx: number, sy: number) {
  return new THREE.Vector2((sx / canvas.clientWidth) * 2 - 1, -(sy / canvas.clientHeight) * 2 + 1);
}
function pickBuilding(sx: number, sy: number) {
  ray.setFromCamera(ndc(sx, sy), cam);
  const hit = ray.intersectObjects(cityGroup.children, true)[0];
  if (!hit) return null;
  // the building whose footprint (or failing that, plot) the hit is on
  const inside = (b: Built, pad: number, plot: boolean) => {
    const l = b.lot, c = plot ? net.parcelCentre(l) : l, co = Math.cos(l.rot), si = Math.sin(l.rot);
    const dx = hit.point.x - c.x, dz = hit.point.z - c.z;
    const w = plot ? l.pw : l.w, d = plot ? l.d + l.front + l.back : l.d;
    return Math.abs(dx * co + dz * si) < w / 2 + pad && Math.abs(-dx * si + dz * co) < d / 2 + pad;
  };
  const live = buildings.filter((b) => !b.dying);
  return live.find((b) => inside(b, 1.5, false)) ?? live.find((b) => inside(b, 0.2, true)) ?? null;
}
const CIVIC_USE = (a: string) => ({ label: `Community · ${CIVIC[a]?.label ?? a}`, pop: CIVIC[a]?.pop ?? 0, unit: CIVIC[a]?.unit ?? 'jobs' });
// Tapping a building (or a park, a car park...) with no tool in use: an info sheet.
function showBuildingInfo(b: Built) {
  const u = b.region ? { label: 'Open space', pop: 0, unit: '' } : b.lot.arch ? CIVIC_USE(b.lot.arch) : USE[b.lot.kind];
  const facts: [string, string][] = [['Use', u.label]];
  if (u.pop) facts.push([u.unit.charAt(0).toUpperCase() + u.unit.slice(1), String(u.pop)]);
  shell.openInfo({
    key: `building:${b.lot.x},${b.lot.z}`, title: b.name, sub: b.detail, icon: b.region ? 'trees' : 'building', facts,
    actions: b.region ? [] : [{ label: 'Add a bus stop', icon: 'busStop', onClick: () => startStopTool() }],
  });
}
// a junction: how busy it is, and the way into its editor
function showJunctionInfo(node: number) {
  const j = junctions.get(node)!, legs = legsAt(net, node).length;
  shell.openInfo({
    key: `junction-info:${node}`, title: FORM_NAME[j.form], sub: `${legs} arms · ${j.auto ? 'designed automatically for the best flow' : 'your design'}`, icon: formIcon(j.form), tone: 'road',
    facts: [['Busiest lane', `${pctFull(j.score.dos)} full`], ['Busiest approach', j.score.busiest || 'all approaches'], ['Takes', `about ${Math.round(Math.min(j.score.capacity, 9999)).toLocaleString('en-GB')} vehicles an hour`]],
    meter: j.score.dos,
    actions: [{ label: 'Edit junction', icon: formIcon(j.form), kind: 'primary', onClick: () => openJunction(node) }],
  });
}

// ---------------- bus stops ----------------
let stopPreview: { seg: RSeg; t: number; side: 1 | -1 } | null = null;
function stopAt(p: P) {
  for (const seg of net.segs.values()) for (const stop of seg.stops) {
    const q = closestOnPath(p, net.path(seg));
    const [a, b] = stopSpan(stop);
    if (q.s > a && q.s < b && q.d < net.half(seg) + 2 && net.sideOf(seg, p) === stop.side) return { seg, stop };
  }
  return null;
}
function showStopInfo(seg: RSeg, st: Stop) {
  const d = net.def(seg), t = st.take;
  const bits = st.kind === 'kerb' ? ['buses stop in the lane'] : [
    `pavement ${(d.pave - t.pave).toFixed(1)} m (was ${d.pave.toFixed(1)} m)`,
    t.lane ? `lanes ${(d.lane - t.lane / (d.lanes > 1 ? d.lanes : 2)).toFixed(2)} m (was ${d.lane.toFixed(2)} m)` : '',
    t.land ? `${t.land.toFixed(1)} m of front gardens bought` : '',
  ].filter(Boolean);
  shell.openInfo({
    key: `stop:${seg.id}:${st.id}`, title: st.kind === 'kerb' ? 'Kerbside stop' : 'Bus lay-by', sub: d.label, icon: 'busStop', tone: 'stop',
    facts: [['Buses call for', 'about 7 seconds']], note: bits.join(' · '),
  });
}

// The cross-section at the stop, before and after, with the stop's side on the right.
function crossSvg(d: RoadDef, plan: StopPlan) {
  const W = 320, t = plan.take, lay = plan.kind === 'layby';
  const K = kerbOf(d), total = (K + d.pave + d.verge) * 2 + t.land + 1;
  const sc = W / total;
  const row = (y: number, after: boolean) => {
    const parts: string[] = [];
    let x = 0;
    const seg = (w: number, fill: string, label = '') => {
      if (w <= 0.01) return;
      parts.push(`<rect x="${(x * sc).toFixed(1)}" y="${y}" width="${(w * sc).toFixed(1)}" height="18" fill="${fill}"/>`);
      if (label && w * sc > 20) parts.push(`<text x="${((x + w / 2) * sc).toFixed(1)}" y="${y + 30}" text-anchor="middle">${label}</text>`);
      x += w;
    };
    const laneW = after && lay ? d.lane - t.lane / (d.lanes > 1 ? d.lanes : 2) : d.lane;
    const otherLane = after && lay && d.lanes === 1 ? laneW : d.lane;
    seg(d.pave, '#bdb8ad', d.pave.toFixed(1));
    for (let i = 0; i < d.lanes; i++) seg(otherLane, '#4a4e54', otherLane.toFixed(2));
    seg(d.median, '#9d9a92');
    for (let i = 0; i < d.lanes; i++) seg(laneW, '#4a4e54', laneW.toFixed(2));
    if (after && lay) seg(3, '#6b5f2a', 'bay 3.0');
    if (after && !lay) parts.push(`<rect x="${((x - laneW) * sc).toFixed(1)}" y="${y}" width="${(laneW * sc).toFixed(1)}" height="18" fill="none" stroke="#e8c33a" stroke-width="2"/>`);
    // with a lay-by the pavement keeps its reduced width, pushed back into any land bought
    const pv = after && lay ? d.pave - t.pave : d.pave;
    seg(pv, after && t.land ? '#d9b36a' : '#bdb8ad', after && t.land ? `${pv.toFixed(1)} moved back` : pv.toFixed(1));
    if (!after || !lay) seg(t.land, '#6aa046', t.land ? 'garden' : '');
    return parts.join('');
  };
  return `<svg class="xs" viewBox="0 0 ${W} 96"><text x="0" y="9" class="h">now</text>${row(12, false)}<text x="0" y="57" class="h">with the ${lay ? 'lay-by' : 'stop'}</text>${row(60, true)}</svg>`;
}

function stopTap(p: P) {
  const q = net.nearestSeg(p, 30, (x) => net.def(x).cls === 'road');
  if (!q) { hint('Tap on a road'); return; }
  const side = net.sideOf(q.seg, p);
  const res = net.planStop(q.seg.id, q.s, side);
  stopPreview = { seg: q.seg, t: q.s, side };
  drawGhost();
  let el: HTMLElement;
  if (res.reason) el = openPanel('stop', 'Can’t put a stop here', 'busStop', `<div class="bad">${icon('alert')}<span>${res.reason}</span></div>`, true);
  else {
    const d = net.def(q.seg);
    el = openPanel('stop', `Stop on this ${d.family.toLowerCase()}`, 'busStop',
      res.plans.map((pl, i) => `<div class="plan${pl.ok ? '' : ' no'}"><div class="row"><span class="tab">${pl.title}</span><span class="cost">${money(pl.cost)}</span></div>
        ${crossSvg(d, pl)}<ul>${pl.notes.map((n) => `<li>${n}</li>`).join('')}</ul>${pl.blocked ? `<div class="bad">${icon('alert')}<span>${pl.blocked}</span></div>` : ''}
        <button class="act primary" data-plan="${i}" ${pl.ok ? '' : 'disabled'}>${icon('check')}<span>Build ${pl.kind === 'kerb' ? 'this stop' : 'lay-by'}</span></button></div>`).join(''), true);
  }
  // turn the road to run up the screen in the clear map above the sheet, so the lay-by can be seen as it's chosen
  focusOn({ x: q.x, z: q.z }, 75, { x: q.ux, z: q.uz }, 1.2);
  el.querySelectorAll<HTMLButtonElement>('[data-plan]').forEach((b) => b.addEventListener('click', () => {
    const pl = res.plans[+b.dataset.plan!];
    net.addStop(q.seg.id, q.s, side, pl);
    for (const l of net.touched) { const bb = buildings.find((x) => x.lot === l); if (bb && !bb.dying) regenerate(bb); }
    closeSheet();
    rebuildRoads();
    hint(`${pl.title} built${pl.take.land ? ` · ${pl.lots.length} front garden${pl.lots.length === 1 ? '' : 's'} trimmed` : ''}`, 'check');
  }));
}

// A tap on the map. With a tool in use it goes to the tool; with none, it inspects whatever it
// lands on (a stop, a junction, a building) and opens an info sheet, or closes the sheet if it
// lands on nothing. Returns the mode it was handled in (double-tap zoom only applies to 'look').
function tapMap(sx: number, sy: number): Mode {
  shell.guardTap();
  shell.dismissFirstRun();
  shell.closeLayers();
  const g = groundAt(sx, sy);
  if (editJ !== null && arrowTap(sx, sy)) return 'road';
  if (mode === 'road' || mode === 'rail') {
    if (mode === 'road' && !draft && !picks.length && junctionNear(g) !== null) openJunction(junctionNear(g)!);
    else if (roadKind === 'curve') curveTap(g);
    return mode;
  }
  if (mode === 'stop') { stopTap(g); return mode; }
  const st = stopAt(g);
  const jn = st ? null : junctionNear(g);
  const b = st || jn !== null ? null : pickBuilding(sx, sy) ?? infillCells.get(cellKey(g.x, g.z)) ?? null;
  if (st) showStopInfo(st.seg, st.stop);
  else if (jn !== null) showJunctionInfo(jn);
  else if (b) showBuildingInfo(b);
  else closeSheet();
  return 'look';
}

// ---------------- input ----------------
// The shared camera (kit/camera.ts) pans, pinches, turns and tilts the map (Google Maps style);
// the game takes the finger when a tool needs it, and hears about taps.
function groundAt(sx: number, sy: number): P {
  const g = nav.groundUnder(sx, sy);
  return { x: g.x, z: g.z };
}
const toScreen = (p: P) => nav.groundToScreen(p);

let grabbed: 'a' | 'b' | 'c' = 'b';
// what a finger the game has taken is doing: dragging a blueprint handle, or drawing a road
let claim: 'handle' | 'draw' | null = null;
// the mode the last tap was handled in: a double tap zooms in only while looking round
let tapMode: Mode = 'look';
const tol = () => view.h * 0.035;

function handleUnder(x: number, y: number) {
  if (mode !== 'road' && mode !== 'rail') return null;
  let best: 'a' | 'b' | 'c' | null = null, bd = 34;
  for (const h of handles()) { const s = toScreen(h.p); const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = h.key; } }
  return best;
}
// move a blueprint handle to a new spot, re-snapping it
function moveHandle(key: 'a' | 'b' | 'c', raw: P) {
  if (!draft) {
    if (key === 'a' && picks[0]) picks[0] = net.snapStart(raw, tol(), cls());
    if (key === 'c' && picks[0] && picks[1]) picks[1] = net.snapAngle(picks[0], raw);
    drawGhost();
    return;
  }
  if (key === 'a') draft.a = net.snapStart(raw, tol(), cls());
  if (key === 'b') draft.b = net.snapEnd(draft.a, raw, tol(), roadKind !== 'straight', cls());
  if (key === 'c') draft.c = { ...raw };
  draftChanged();
}
// Bend point for a curve that passes through the middle of the finger's path: B(½) = ¼a + ½c + ¼b.
function fitCurve(a: P, b: P, tr: P[]): P | undefined {
  const L = pathLength(tr);
  if (L < 10) return undefined;
  const m = pointAt(tr, L / 2);
  return { x: 2 * m.x - (a.x + b.x) / 2, z: 2 * m.z - (a.z + b.z) / 2 };
}
function curveTap(raw: P) {
  if (draft) return;
  if (picks.length === 0) picks = [net.snapStart(raw, tol(), cls())];
  else if (picks.length === 1) picks.push(net.snapAngle(picks[0], raw));
  else {
    const b = net.snapEnd(picks[0], raw, tol(), true, cls());
    draft = { a: picks[0], c: { x: picks[1].x, z: picks[1].z }, b };
    picks = [];
    draftChanged();
  }
  drawGhost();
  hint();
}

nav.hooks = {
  // a blueprint handle under the finger is dragged, not the map
  onPointerDown: (p) => {
    const h = handleUnder(p.sx, p.sy);
    if (!h) return false;
    claim = 'handle'; grabbed = h; dragging = true;
    return true;
  },
  // straight and smooth roads are drawn by dragging; the curve tool uses taps, so dragging pans
  // (the curve tool draws on a drag too, unless you've started placing it by taps)
  onDragStart: (p) => {
    if (!((mode === 'road' || mode === 'rail') && !draft && !(roadKind === 'curve' && picks.length))) return false;
    const a = net.snapStart(p.start.ground, tol(), cls());
    draft = { a, b: { ...a } };
    trace = [a];
    claim = 'draw'; dragging = true;
    return true;
  },
  onClaimMove: (p) => {
    const raw = groundAt(p.sx, p.sy);
    if (claim === 'handle') moveHandle(grabbed, raw);
    else if (claim === 'draw' && draft) {
      draft.b = net.snapEnd(draft.a, raw, tol(), roadKind !== 'straight', cls());
      if (roadKind === 'curve') { trace.push(raw); draft.c = fitCurve(draft.a, draft.b, trace); }
      draftChanged();
    }
  },
  onClaimEnd: (_p, why) => {
    const was = claim;
    claim = null;
    dragging = false;
    // a second finger turns it into a pinch, and a road half drawn is dropped
    if (why === 'second-finger') { if (was === 'draw') { draft = null; draftChanged(); } else renderBar(); return; }
    renderBar(); hint();
  },
  onTap: (p) => { tapMode = tapMap(p.sx, p.sy); },
  // a double tap zooms in on the spot while looking round; with a tool, taps place things
  onDoubleTap: () => tapMode !== 'look',
};
// point the compass needle at north (-z) as it appears on screen
// (the needle icon points up, so a quarter turn more than an arrow pointing right would need)
nav.onChange(() => {
  $('#needle').style.transform = `rotate(${(nav.northAngle() * 180) / Math.PI + 90}deg)`;
  shell.syncView();
});

// ---------------- loop ----------------
seedTown();
rebuildRoads();
refreshTrees();
setMode('look');
setKind('straight');
setType('street');
resize();
refreshInfill();
gameGround.start(trees);
refreshTrees();

// ---------------- clock and traffic ----------------
const traffic = new Traffic(net, scene, rng(5));
traffic.junctions = junctions;
seenAt = (node) => traffic.seen.get(node);
onRoadsChanged = () => { traffic.invalidate(); placesDirty = true; };
for (let i = 0; i < 4; i++) traffic.addBus();
for (const t of ['intercity', 'dmu']) traffic.addTrain(t);
let clock = 7 * 60; // minutes since midnight: a day passes in six minutes
let places: Places | null = null;
function getPlaces(): Places {
  if (places && !placesDirty) return places;
  placesDirty = false;
  const live = buildings.filter((b) => !b.dying).map((b) => b.lot);
  const home = (l: Lot) => l.kind === 'house' || l.kind === 'terrace' || l.kind === 'flats' || l.kind === 'tower';
  return (places = {
    homes: live.filter(home),
    jobs: live.filter((l) => l.kind === 'office' || l.kind === 'shop' || l.kind === 'industry' || l.kind === 'tower'),
    shops: live.filter((l) => l.kind === 'shop'),
    works: live.filter((l) => l.kind === 'industry'),
    weight: (l) => USE[l.kind].pop,
  });
}
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
// a count short enough for the stats line however big the town gets: 9,999 then 23.4k, 123k, 1.2m
// (rounded down, so it never claims more than there are)
const count = (n: number) => (n < 1e4 ? n.toLocaleString('en-GB') : n < 1e5 ? `${Math.floor(n / 100) / 10}k` : n < 1e6 ? `${Math.floor(n / 1e3)}k` : `${Math.floor(n / 1e5) / 10}m`);

let last = performance.now();
let growAt = 0; // game minutes until the next building
const GAME_MIN_PER_S = 4; // how fast the clock runs: game minutes per real second
// Game speed (pause, 1×, 2×, 4×) scales the clock, the town's growth and the traffic together.
// Traffic keeps its own time base, which only ever runs ahead of real time: vehicles stamp some
// moments with performance.now(), and a clock that fell behind would leave them stranded.
// Game speed: pause, and a rate (1×, 2×, 4×) that one button cycles through.
let speed = 1, rate = 1, simNow = performance.now();
function setSpeed(s: number) {
  speed = s;
  if (s) rate = s;
  shell.setSpeed(s === 0, rate);
}
function togglePause() {
  setSpeed(speed ? 0 : rate);
  hint(speed ? `Game speed ${speed}×` : 'Paused · the clock, traffic and new buildings wait; you can still build', speed ? 'play' : 'pause');
}
function cycleRate() {
  const r = rate === 4 ? 1 : rate * 2;
  setSpeed(r);
  hint(`Game speed ${r}×`, 'play');
}
setSpeed(1);
let lastH = view.h;
// ---------------- smoothness: adaptive quality and a performance readout ----------------
// Phones differ enormously, so rather than guess, the game watches its own frame times: if
// frames run slow it steps down (fewer pixels, then cheaper shadows, then none), and when
// there's headroom it steps back up. A step down holds for a while so it doesn't flicker.
const TIERS = [
  { name: 'High', pr: Math.min(2, window.devicePixelRatio || 1), shadow: 2048, every: 1 },
  { name: 'Good', pr: Math.min(1.5, window.devicePixelRatio || 1), shadow: 2048, every: 1 },
  { name: 'Balanced', pr: Math.min(1.25, window.devicePixelRatio || 1), shadow: 1024, every: 1 },
  { name: 'Fast', pr: 1, shadow: 1024, every: 3 },
  { name: 'Fastest', pr: 1, shadow: 0, every: 0 },
];
declare global { interface Window { __perf: unknown } }
let statsAt = 0, tier = 0, tierHeldUntil = 0, perfOn = false, frameNo = 0, tierAuto = true;
const perf = { frames: 0, frameMs: 0, simMs: 0, drawMs: 0, since: 0, worst: 0, worstSim: 0 };
renderer.shadowMap.autoUpdate = false;
function setTier(t: number) {
  tier = Math.max(0, Math.min(TIERS.length - 1, t));
  const q = TIERS[tier];
  renderer.setPixelRatio(q.pr);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  sun.castShadow = q.shadow > 0;
  if (q.shadow && sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  renderer.shadowMap.needsUpdate = true;
  setGroundQuality(tier >= 3 ? 'low' : tier === 2 ? 'medium' : 'high');
}
function judgeFrames(now: number) {
  if (!tierAuto) return;
  const avg = perf.frameMs / Math.max(1, perf.frames);
  if (avg > 26 && tier < TIERS.length - 1) { setTier(tier + 1); tierHeldUntil = now + 30000; }
  else if (avg < 17.5 && tier > 0 && now > tierHeldUntil) { setTier(tier - 1); tierHeldUntil = now + 8000; }
}
function togglePerf() { perfOn = !perfOn; shell.setPerf(perfOn); }

function frame(now: number) {
  const rawMs = now - last;
  const dt = Math.min(0.1, rawMs / 1000);
  last = now;
  const t0 = performance.now();
  perf.frames++; perf.frameMs += rawMs; perf.worst = Math.max(perf.worst, rawMs);
  nav.update(dt, now);
  if (gameGround.sync()) renderer.shadowMap.needsUpdate = true;
  // keep blueprint handles a finger's width wide at any zoom
  if ((draft || picks.length) && Math.abs(view.h - lastH) > view.h * 0.08) { lastH = view.h; drawGhost(); }
  doomMat.opacity = 0.3 + 0.25 * Math.sin(now / 160);
  const gdt = dt * speed; // game seconds this frame
  // the town grows at a town's pace: about one new building every 20 minutes of game time
  // (so it speeds up and slows down with the clock), with some randomness so it doesn't tick
  growAt -= gdt * GAME_MIN_PER_S;
  if (growAt <= 0 && queue.length) {
    growAt = 12 + rand() * 16;
    const l = queue.shift()!;
    if (net.lotFree(l)) { spawnLot(l); refreshTrees(l); gameGround.built(l); }
  }
  for (let i = buildings.length - 1; i >= 0; i--) {
    const b = buildings[i];
    if (!b.solo) continue;
    if (b.dying) {
      const k = (now - b.dying) / 700;
      b.solo.scale.y = Math.max(0.01, 1 - k);
      if (k >= 1) { cityGroup.remove(b.solo); for (const p of b.parts) p.g.dispose(); buildings.splice(i, 1); }
    } else {
      b.solo.scale.y = Math.min(1, (now - b.born) / 700);
      if (b.solo.scale.y >= 1) toChunk(b); // settled: merge into its chunk
    }
  }
  if (infillDue && !queue.length && !buildings.some((b) => b.solo)) { infillDue = false; refreshInfill(); }
  // merge at most a couple of changed chunks a frame
  let merged = 0;
  for (const c of chunks.values()) if (c.dirty && merged++ < 2) rebuildChunk(c);
  clock += gdt * GAME_MIN_PER_S;
  const hour = (clock / 60) % 24;
  // At 1× traffic steps once a frame as it always has; faster, it's cut into steps of at most
  // 1/30 s so cars don't jump through each other or past their stop lines. Paused, it holds still.
  if (speed > 0) {
    const n = speed > 1 ? Math.ceil(gdt * 30 - 1e-9) : 1, step = gdt / n;
    simNow = Math.max(simNow, now - gdt * 1000); // so it's caught up with real time by the last step
    for (let i = 0; i < n; i++) {
      simNow += step * 1000;
      traffic.generate(getPlaces(), hour, LEVELS[level][1], simNow);
      traffic.generate(getPlaces(), hour, LEVELS[level][1], simNow);
      traffic.update(step, simNow);
    }
  }
  for (const l of lamps) l.mesh.material = traffic.lightFor(l.node, l.seg, simNow) === l.col ? LAMP_ON[l.col] : LAMP_OFF;
  // (the readout only changes a few times a second, so it isn't rebuilt every frame)
  if (now - statsAt > 250) {
    statsAt = now;
    const pop = buildings.reduce((s, b) => s + (USE[b.lot.kind].unit === 'jobs' ? 0 : USE[b.lot.kind].pop), 0);
    $('#st-clock').textContent = hhmm(clock);
    // (the rush hours in the short form timetables use, so the line fits a phone)
    const rush = speed ? rushLabel(hour) : 'paused';
    $('#st-rush').textContent = ({ 'morning rush': 'AM peak', 'evening rush': 'PM peak' } as Record<string, string>)[rush] ?? rush;
    $('#st-rush').title = rush;
    $('#st-cars').textContent = count(traffic.live);
    $('#st-buses').textContent = String(traffic.buses);
    $('#st-trains').textContent = String(traffic.trains.length);
    $('#st-pop').textContent = count(pop);
  }
  const t1 = performance.now();
  const q = TIERS[tier];
  if (q.every && ++frameNo % q.every === 0) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, cam);
  const t2 = performance.now();
  perf.simMs += t1 - t0; perf.drawMs += t2 - t1; perf.worstSim = Math.max(perf.worstSim, t1 - t0);
  if (now - perf.since > 2000) {
    if (perf.since) judgeFrames(now);
    if (perfOn) {
      const n = Math.max(1, perf.frames), r = renderer.info.render;
      $('#perf-t').textContent = `${Math.round(1000 / (perf.frameMs / n))} fps · frame ${(perf.frameMs / n).toFixed(1)} ms (worst ${perf.worst.toFixed(0)}) · sim ${(perf.simMs / n).toFixed(1)} (worst ${perf.worstSim.toFixed(0)}) · draw ${(perf.drawMs / n).toFixed(1)} ms · ${r.calls} calls · ${Math.round(r.triangles / 1000)}k tris · ${TIERS[tier].name}`;
    }
    window.__perf = { ...perf, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, tier: TIERS[tier].name };
    Object.assign(perf, { frames: 0, frameMs: 0, simMs: 0, drawMs: 0, since: now, worst: 0, worstSim: 0 });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { proto: unknown }).proto = { renderer, setTier, perf: () => ({ tier: TIERS[tier].name }), buildRoad: (a: P, b: P, type = 'street') => buildRoad(net.snapStart(a, 4), net.snapStart(b, 4), undefined, { ...opts, type }), junctions, rebuild: () => rebuildRoads(), net, view, nav, buildings, infill: () => infill, refreshInfill: () => refreshInfill(), setMode, setKind, groundAt, toScreen, cam, THREE, pickBuilding, traffic, chunks, setClock: (m: number) => { clock = m; }, setSpeed, speed: () => speed, shell, startRoadTool, startStopTool, tapMap, endTool, ground: gameGround, growAll: () => { gameGround.invalidate(); for (const l of queue.splice(0)) if (net.lotFree(l)) spawnLot(l, false); refreshTrees(); } };
