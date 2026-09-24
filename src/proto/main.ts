// 3D prototype: free-form roads, plots along any street, buses and cars, rotating camera.
import * as THREE from 'three';
import './proto.css';
import { DEFAULT_OPTS, Network, ROADS, kerbOf, rectCorners, rng, closestOnPath, pointAt, stopSpan, subPath, pathLength, type Check, type End, type Lot, type P, type RSeg, type RoadDef, type RoadOpts, type RoadType, type Stop, type StopPlan } from './roads';
import { FORM_NAME, design, landFits, laneOptions, legsAt, moveOf, rescore, type Form, type Junction } from './junction';
import { PRESETS, RAIL_PRESETS, filterRoads, isSlip, type RoadFilter } from './catalog';
import { GRADES } from './grade';
import { Flat, Solid, drawRoads, halfOfType, laneCentre, structures, GRASS_MATS, LAMP_OFF, LAMP_ON, type Lamp } from './roaddraw';
import { GRADE_STEPS } from './grade';
import { Traffic, rushLabel, type Places } from './traffic';
import { MODEL, purchaseList, type Offer } from './vehicles';
import { gameYear } from './game/era';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CIVIC, grassMats, makeBuilding as generate, makeRegion, USE } from './buildgen';
import { CELL, findRegions, type Region } from './infill';
import { NavRig, SunFollow } from './kit/camera';
import { GameGround } from './ground/game';
import { patchGround, setGroundQuality } from './ground';
import { GameWater, LAKE, WATER_LEVEL } from './game/water';
import './ui/fonts';
import { formIcon, icon, roadIcon, trainIcon, type Icon } from './ui/icons';
import { Shell, type SheetSpec, type ToolHandle } from './ui/shell';
import { Industries, townWishes, type IndustrySite } from './game/industry'; // industrial sites (docs/industries.md)
import { PLAIN_MAT } from './buildgen';
import { BridgeLayer, type BuiltBridge } from './game/bridges';
import { TownCrowds } from './game/crowds';
import { Lines, StopMarkers, routeMesh, callOrder, type Line } from './game/lines';
import { TownEconomy, TOWN_NAME } from './game/econ';
import { Purse, PRICE_SHARE } from './game/money';
import { Stations, STATION_LIST_PRICE } from './game/rail';
import type { TrainDef } from './catalog';
import { IX_BLURB, IX_FORMS, IX_NAME, IX_SIZES, IX_SIZE_BLURB, IX_SIZE_NAME, buildPair, motorwayCloverleaf, motorwayWithJunction, pairCrossed, pairToNode, pairUpMotorways, scratch, type Interchange, type IxForm, type IxSize, type SlipStyle } from './interchange/build'; // motorway junctions (docs/motorways.md)
import { buildSlip, planCloverleaf, planJunction, planSlip, roadCrossed, type IxPlan, type SlipPlan } from './interchange/plan';
import { Railway } from './rail/railway'; // stations, signalling and rail lines (docs/rail.md)
import { RailDraw } from './rail/draw';
import { RailGame } from './rail/game';
import { layRegionRail, planRegionRail } from './rail/region';
import { edgeCrossings, edgeMesh } from './game/edge';
import { STD } from './standards';
import { Loading } from './loading';
import { STYLE_LOOKS, buildStreets, centrality, centreDistance, inCentre, mapFromQuery, plotCentre, zoneOf } from './region'; // maps as data (docs/region.md)

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const money = (n: number) => `${n < 0 ? '−' : ''}£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
// the purse (game/money.ts): prices are the game's share of list prices, charged when built
const purse = new Purse();
const price = (list: number) => purse.price(list);
const perM = (list: number) => `£${Math.round(list * PRICE_SHARE).toLocaleString('en-GB')}/m`;
const short = (need: number) => `Not enough money · ${money(need)} needed, ${money(purse.balance)} in the bank`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

// ---------------- world ----------------
// The map is data (region/mapspec.ts): ?map= picks it (a region with its options), the invented town by default.
const MAP = mapFromQuery(new URLSearchParams(location.search));
const LOOK = STYLE_LOOKS[MAP.style]; // (its ground palette, woods and sky: region/styles.ts)
// the loading screen, while the map is built (it goes once the first frame is drawn)
const loading = new Loading(MAP.name, mapLine());
function mapLine() {
  const o = MAP.options, n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  if (!o) return '';
  return [`seed ${o.seed}`, n(MAP.settlements.length, 'place', 'places'), n(MAP.water.rivers.length, 'river', 'rivers'), n(MAP.water.lakes.length, 'lake', 'lakes'), o.style].join(' · ');
}
await loading.stage(MAP.water.rivers.length ? 'Filling the rivers and lakes' : 'Filling the lake', 0.08);
const BOUND = MAP.bound;
// the water: one water system (src/proto/game/water.ts) gives isWater to roads, plots, bridges and traffic
// A big map (the region) is drawn more coarsely until it streams (docs/region.md R4); the town, even
// widened, is drawn in full. The town's ground ends just past where you can build (the region's runs
// on further, for its rivers), and the camera goes right out to it.
const BIG = BOUND > 2000;
const gameWater = new GameWater(BIG ? BOUND * 1.5 : BOUND + STD.mapEdge + 10, MAP.water); // (the ground's half-width)
const isWater = (p: P) => gameWater.isWater(p);
const EDGE = gameWater.half; // (where the ground ends, in a cut face: game/edge.ts)
const net = new Network(isWater, BOUND, 11);
net.edge = EDGE; // (roads running off the map run on to the ground's edge)
const railway = new Railway(net); // (rebuilt with the roads: commitRoads)
gameWater.claim(net.land); // the water's land ('water', 3 m past the waterline): plots and parks keep off it
// the map's industrial estates (the town's is south of the centre)
const INDUSTRIAL = (p: P) => zoneOf(MAP, p) === 'industrial';
net.zoneAt = (p) => (INDUSTRIAL(p) ? 'industrial' : 'town');
const rand = rng(MAP.seed);

// ---------------- three setup ----------------
const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(LOOK.sky);

scene.add(new THREE.HemisphereLight('#e8f3ff', '#5d7040', 1.25));
const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
const SCALE = BOUND / 520; // (a bigger map: the camera stands further back and can zoom further out)
const HOME = { az: Math.PI / 4, el: 0.6 };
const EL_MIN = 0.35, EL_MAX = 1.52;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// The shared camera (kit/camera.ts), the one every page uses: gestures, wheel, keys and animated moves
// (any touch cancels those). The sun follows the view so shadows stay sharp where you're looking;
// its shadow area only changes size in big steps and slides in whole shadow-map texels, so edges
// don't shimmer. The game's own input hooks are set with the rest of the input code below.
const nav = new NavRig(cam, canvas, {
  view: { ...MAP.view, ...HOME },
  distance: 1200 * SCALE,
  limits: { hMin: 35, hMax: 900 * SCALE, elMin: EL_MIN, elMax: EL_MAX, bounds: { minX: -EDGE, maxX: EDGE, minZ: -EDGE, maxZ: EDGE } },
  shadow: new SunFollow(sun, { dir: { x: -160, y: 260, z: 110 } }),
});
const view = nav.view;
// (and its depth range follows the zoom, so depth stays as fine as the town's)
if (SCALE > 1) { const fit = () => { const r = (2 * view.h) / Math.sin(view.el) + 600; cam.near = Math.max(1, 1200 * SCALE - r); cam.far = 1200 * SCALE + r; cam.updateProjectionMatrix(); }; nav.onChange(fit); fit(); }

function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  nav.apply();
}
window.addEventListener('resize', resize);

// ---------------- ground, water ----------------
// the shared ground (src/proto/ground): pasture, fields and hedgerows, lawns, woods, verges
const gameGround = new GameGround({ net, queue: () => queue, trees: () => trees, lake: LAKE, water: () => gameWater.outline(), industrial: INDUSTRIAL, parks: () => infill.map((b) => ({ cells: b.region?.cells ?? [], size: CELL })) }, BOUND, BIG ? 4 : undefined, !BIG, BIG ? undefined : gameWater.half); // (no 3D hedgerows on a big map until it streams: docs/region.md R4; the town's fields run to its edge)
gameGround.setStyle(LOOK);
// (the water system's ground: flat, dipping into the lake's bed, in the plane's frame)
const ground = new THREE.Mesh(gameWater.groundGeometry(gameWater.half * 2), gameGround.ground.material);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
// Grass drawn on top of the ground (verges, roundabout islands, cutting slopes, gardens, parks)
// takes the ground's own look: the painter already paints those places as lawn or rough grass.
for (const m of [...GRASS_MATS, ...grassMats()]) { m.color.set('#ffffff'); patchGround(m, gameGround.ground.uniforms); }
// the ground leaves out any cutting a road or railway runs down into (they mark the stencil first)
{ const gm = ground.material as THREE.MeshLambertMaterial; gm.stencilWrite = true; gm.stencilRef = 1; gm.stencilFunc = THREE.NotEqualStencilFunc; ground.renderOrder = -9; }
scene.add(gameGround.ground.hedges);
scene.add(ground);
// the cut face round the edge of the map (the roads running off it are added once they're built)
let mapEdge = edgeMesh(EDGE, [], gameWater.shapes.ground, WATER_LEVEL);
scene.add(mapEdge);
function refreshEdge() { scene.remove(mapEdge); mapEdge.geometry.dispose(); mapEdge = edgeMesh(EDGE, edgeCrossings(net, EDGE), gameWater.shapes.ground, WATER_LEVEL); scene.add(mapEdge); }
// the lake (src/proto/game/water.ts): beaches and the bed laid over the ground (chained after the
// ground's own patch), and the water and reeds on top: two draw calls
gameWater.patch(gameGround.ground.material);
scene.add(gameWater.group);
gameWater.light(scene, sun); // (evening light: the sun, sky and water change together)
// rivers' beds, in a ground material of their own (the flat ground leaves out what they cover)
for (const m of gameWater.beds(() => gameWater.patch(patchGround(new THREE.MeshLambertMaterial(), gameGround.ground.uniforms)))) scene.add(m);

// ---------------- trees (instanced) ----------------
interface Tree { x: number; z: number; s: number; kind: number }
let trees: Tree[] = [];
for (let i = 0; i < MAP.trees.count; i++) {
  const p = { x: (rand() * 2 - 1) * BOUND, z: (rand() * 2 - 1) * BOUND };
  // woods on the outskirts, a few in town
  if (inCentre(MAP, p) && rand() < 0.85) continue;
  if (isWater(p) || gameWater.near(p, 10)) continue;
  trees.push({ ...p, s: 0.8 + rand() * 0.7, kind: rand() < LOOK.trees.pines ? 1 : 0 });
}
const crownGeo = new THREE.IcosahedronGeometry(3.4, 1);
const pineGeo = new THREE.ConeGeometry(3, 9, 7);
const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3.5, 6);
const crownMat = new THREE.MeshLambertMaterial({ color: LOOK.trees.crown, flatShading: true });
const pineMat = new THREE.MeshLambertMaterial({ color: LOOK.trees.pine, flatShading: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: '#6b4a2f' });
const MAXT = Math.max(1600, MAP.trees.count + 200);
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
  } else {
    // (plots bucketed by where they stand, so each tree looks only at those near it)
    const B = 60, near = new Map<string, Lot[]>();
    for (const l of net.lots) {
      const c = net.parcelCentre(l), r = net.parcelR(l) + 3;
      for (let i = Math.floor((c.x - r) / B); i <= Math.floor((c.x + r) / B); i++) for (let j = Math.floor((c.z - r) / B); j <= Math.floor((c.z + r) / B); j++) {
        const k = `${i},${j}`, a = near.get(k);
        if (a) a.push(l); else near.set(k, [l]);
      }
    }
    trees = trees.filter((t) => !treeBlocked(t, near.get(`${Math.floor(t.x / B)},${Math.floor(t.z / B)}`) ?? []));
  }
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
// every bridge in the town: one mesh per material (game/bridges.ts)
const bridgeLayer = new BridgeLayer();
scene.add(bridgeLayer.group);
// ---------------- junctions ----------------
// Every junction designs itself (see junction.ts) whenever the roads meeting there change; a
// junction the player has customised keeps their choices as long as its roads stay the same.
const junctions = new Map<number, Junction>();
let seenAt: (node: number) => Map<string, number> | undefined = () => undefined;
const geoFor = (node: number) => ({ fits: (polys: P[][]) => landFits(net, node, polys) });
// motorway junctions built (interchange/build.ts): each is one junction to the player, and says
// which form each of its own junctions takes (its roundabouts, give-ways, merges and diverges)
const interchanges: Interchange[] = [];
// (an interchange's junctions take the form it built them for, without slip lanes of their own)
const preferAt = (node: number) => { for (const ix of interchanges) if (ix.prefer[node]) return { form: ix.prefer[node], slip: false }; return undefined; };
function redesignJunctions() {
  for (const id of [...junctions.keys()]) if (!net.nodes.has(id) || legsAt(net, id).length < 3) junctions.delete(id);
  for (const n of net.nodes.values()) {
    const legs = legsAt(net, n.id);
    if (legs.length < 3) continue;
    const old = junctions.get(n.id);
    const same = old && old.legs.length === legs.length && legs.every((l) => old.legs.includes(l.seg.id));
    if (same && !old!.auto) continue;
    const j = design(net, n.id, geoFor(n.id), seenAt(n.id), preferAt(n.id));
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
  // lays out the bridges (short of the junctions at their ends) and stores their types on the
  // segments, which drawRoads reads
  const reach = (s: RSeg, node: number) => (net.segsAt(node).length > 2 ? (junctions.get(node)?.shape?.mouth[s.id] ?? 0) + 2 : 0);
  bridgeLayer.sync(net, (s) => [reach(s, s.a), reach(s, s.b)]);
  railway.rebuild(); // (its stations tell drawRoads where they lay their own track)
  lamps = drawRoads(net, roadGroup, junctions, trunkMat, crownMat, editJ);
  if (made.length) queuePlots(made);
  onRoadsChanged();
  gameGround.invalidate();
  refreshEdge();
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
const CH = BIG ? 240 : 120; // (bigger on a big map: fewer draw calls when it's all in view)
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

// ---------------- industries (game/industry.ts) ----------------
// Library sites, baked into the chunks with buildgen's shared vertex-coloured material, so they add
// no draw calls; their moving parts are one IndustryFx in the scene. They aren't in `buildings`:
// the stand-in lot only keys the chunk (and gives traffic's lorries a gate to go to).
const industries = new Industries(net, scene, PLAIN_MAT);
const siteBuilt = new Map<IndustrySite, Built>();
industries.onAdd = (s) => { const b: Built = { lot: s.lot, born: 0, height: s.model.height, name: s.model.name, detail: s.model.detail, parts: s.parts, solo: null, chunk: null }; siteBuilt.set(s, b); toChunk(b); placesDirty = true; };
industries.onRemove = (s) => { const b = siteBuilt.get(s); if (b) fromChunk(b); siteBuilt.delete(s); if (selectedSite === s) closeSheet(); placesDirty = true; };
let selectedSite: IndustrySite | null = null, siteRings = false, siteT = 0;
function showSite(s: IndustrySite) {
  industries.openInfo(s, shell, [{ label: 'Add a stop nearby', icon: 'busStop', onClick: () => startStopTool() }], () => { if (selectedSite === s) selectedSite = null; });
  selectedSite = s;
  focusOn({ x: s.model.frame.cx, z: s.model.frame.cz }, industries.frameHeight(s)); // with its catchment, in the clear map above the sheet
}
// the site under a tap: where the ray meets what's drawn (a tall building hides the ground behind it)
function siteUnder(sx: number, sy: number, g: P) {
  ray.setFromCamera(ndc(sx, sy), cam);
  const hit = ray.intersectObjects(cityGroup.children, true)[0];
  return industries.at(hit ? { x: hit.point.x, z: hit.point.z } : g);
}

let queue: Lot[] = [];
let placesDirty = true;
let onRoadsChanged = () => {};
let townRef: TownEconomy | null = null; // (made once the town is laid out, below)
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
  industries.evict(); // a road through an industrial site takes it
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

// the centre to lay a road's plots out from: its settlement's, as central as its size says (region/mapspec.ts)
const centreFor = (a: P, b: P = { x: a.x + 1, z: a.z }) => plotCentre(MAP, a, b);
function queuePlots(segs: number[]) {
  for (const id of segs) {
    const sg = net.segs.get(id);
    const plots = sg ? net.plotsFor(id, centreFor(net.node(sg.a), net.node(sg.b))) : [];
    // denser, taller near the centre; a few gaps elsewhere
    for (const p of plots) if (centrality(MAP, p) < 200 || rand() < 0.75) queue.push(p);
  }
  // and around any roundabout these roads meet at
  const nodes = new Set(segs.flatMap((id) => { const s = net.segs.get(id); return s ? [s.a, s.b] : []; }));
  for (const id of nodes) {
    const j = junctions.get(id);
    if (!j || j.form !== 'roundabout' || !j.shape) continue;
    const legs = legsAt(net, id).map((l) => ({ seg: l.seg.id, ang: l.ang, half: net.half(l.seg) }));
    queue.push(...net.plotsAround(id, j.R + 3, legs, centreFor(net.node(id))));
  }
  // nearest a settlement's centre first
  queue.sort((a, b) => centreDistance(MAP, a) - centreDistance(MAP, b));
}

// ---------------- the map's roads and towns ----------------
async function seedTown() {
  // a generated region's railway first: a main line through the city and two towns, a branch to a
  // village, stations and a line on each (rail/region.ts); the streets then cross it on the level
  // or bridge it, and keep out of its stations
  if (MAP.generated) {
    await loading.stage('Laying the railway', 0.03);
    const plan = planRegionRail(MAP.settlements, { bound: BOUND, isWater });
    // (track only: stations and lines are the player's to build)
    const made = plan ? layRegionRail(railway, plan, { trackOnly: true }) : null;
    if (made?.problems.length) console.info('railway:', made.problems.join(' · '));
  }
  // the map's streets (region/: the town's hand-drawn roads, or each of a generated region's settlements in turn)
  if (MAP.generated) {
    for (const [i, st] of MAP.settlements.entries()) {
      await loading.stage(i ? `Laying out ${st.name}` : `Laying out ${st.name}'s streets`, 0.06 / MAP.settlements.length);
      buildStreets(net, MAP.streets.filter((x) => x.settlement === st.id), DEFAULT_OPTS, true);
    }
  } else {
    await loading.stage('Laying out the streets', 0.06);
    buildStreets(net, MAP.streets, DEFAULT_OPTS, false);
    // (the town's motorway as a pair of one-way carriageways, splaying into the roundabout at its end: interchange/build.ts)
    pairUpMotorways(net);
  }
  // junctions are designed (and take their land) before any plot is laid out
  await loading.stage('Designing the junctions', 0.05);
  commitRoads([...net.segs.keys()]);

  // industry: library sites on the estate and out of town claim their land before any plot is
  // built; the estate's plots are theirs, so its buildgen sheds are dropped (game/industry.ts)
  if (MAP.industries) {
    industries.placeAll(townWishes(INDUSTRIAL, (p) => !INDUSTRIAL(p) && Math.hypot(p.x, p.z) > 300));
    queue = queue.filter((l) => !INDUSTRIAL(l) && net.lotFree(l));
  }
  // most of the town exists at the start, the rest grows in front of you
  const now = Math.floor(queue.length * 0.8);
  const start = queue.splice(0, now);
  await loading.stage(`Putting up ${start.length.toLocaleString('en-GB')} buildings`, 0.22);
  for (const [i, l] of start.entries()) {
    if (net.lotFree(l)) spawnLot(l, false);
    if (i % 16 === 0) await loading.tick(i / start.length);
  }
}

// ---------------- UI ----------------
type Mode = 'look' | 'road' | 'rail' | 'stop' | 'line' | 'station';
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
  onTown: () => showTown(),
});
// the tool in use (a road or rail type, or bus stops), if any
let tool: ToolHandle | null = null;
// "Junction here": the road a motorway blueprint crosses, the junction picked for it, and its plan
// (ixPair: the motorway a motorway blueprint crosses, for a cloverleaf)
let ixPair: ReturnType<typeof pairCrossed> = null;
let ixRoad: RSeg | null = null, ixPick: { form: IxForm; style: SlipStyle; size: IxSize } | null = null, ixPlan: IxPlan | null = null;
let ixStyle: SlipStyle = 'taper', ixSize: IxSize = 'tight';
// a slip road dragged off a motorway (interchange/plan.ts planSlip), and how many lanes it has
let slipPlan: SlipPlan | null = null, slipLanes: 1 | 2 = 1;

const ctrlOf = (d: Draft) => (roadKind === 'smooth' ? net.smoothCtrl(d.a, d.b) : d.c);
function draftChanged() {
  draftCheck = draft ? net.check(draft.a, draft.b, ctrlOf(draft), opts) : null;
  // dragged off a motorway's carriageway, whatever road was picked, it's a slip road
  slipPlan = draft && mode === 'road' ? planSlip(net, draft.a, draft.b, slipLanes) : null;
  // a motorway drawn across a road can have a junction there (interchange/plan.ts)
  const mwDraft = draft && !slipPlan && ROADS[opts.type].family === 'Motorway' && !isSlip(opts.type) && !opts.oneway ? net.makePath(draft.a, draft.b, ctrlOf(draft)) : null;
  // (across another motorway, a cloverleaf; across a road, the rest)
  ixPair = mwDraft ? pairCrossed(net, mwDraft) : null;
  ixRoad = mwDraft && !ixPair ? roadCrossed(net, mwDraft) : null;
  if (!ixRoad && !ixPair) ixPick = null;
  if (ixPick && (ixPick.form === 'cloverleaf') !== !!ixPair) ixPick = null;
  ixPlan = ixPick && mwDraft ? (ixPair ? planCloverleaf(net, mwDraft, opts.type, ixPick.size) : ixRoad ? planJunction(net, ixPick.form, ixPick.style, mwDraft, opts.type, ixRoad, ixPick.size) : null) : null;
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
  document.body.dataset.mode = m === 'line' ? 'stop' : m === 'station' ? 'rail' : m;
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
const MODE_ICON: Record<Mode, Icon> = { look: 'finger', road: 'road', rail: 'train', stop: 'busStop', line: 'transport', station: 'train' };
function hint(text?: string, ic?: Icon) {
  let t = text;
  if (t === undefined) {
    if (!tool) return shell.hint(null);
    if (mode === 'stop') t = stopPreview ? '' : 'Tap a road, on the side you want the stop'; // (with a blueprint down, the card says it all)
    else if (mode === 'station') t = 'Tap a straight, level stretch of railway · platforms go either side';
    else if (mode === 'line') t = lineDraft.length === 0 ? 'Tap the stop the line starts from' : lineDraft.length === 1 ? 'Tap the next stop' : 'Tap more stops, or the first again for a circular line · then Create';
    else if (draft && slipPlan) t = 'A slip road: drag ahead and out to leave the motorway, back and out to join it · then Build';
    else if (draft) t = 'Drag the white handles to adjust, then Build';
    else if (roadKind === 'straight') t = mode === 'rail' ? 'Drag to lay track · tap a junction to see how it works' : 'Drag to draw a road · tap a junction to redesign it';
    else if (roadKind === 'smooth') t = 'Drag from a road: the new one curves smoothly out of it';
    else t = ['Drag along the curve you want · or tap start, bend, end', '2/3 · Tap the bend point: the curve pulls towards it', '3/3 · Tap where the curve ends'][picks.length];
  }
  tool?.setUndo(!!draft || picks.length > 0);
  shell.hint(t ? `${icon(ic ?? MODE_ICON[mode])}<span>${esc(t)}</span>` : null, tool ? 0 : 4000);
}

// ---- tools: picking a card in the Build sheet swaps the bar for a tool strip ----
const typeSpec = (t: RoadType) => { const d = ROADS[t]; return `${Math.round(halfOfType(t) * 2)} m wide · ${d.mph} mph · ${perM(d.cost)}`; };
function endTool() {
  tool = null;
  shell.endTool();
  shell.closeSheet();
  stopPreview = null;
  if (mode === 'line') { lineDraft = []; showLine(null); }
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
  tool = shell.startTool({ name: 'Bus stop', spec: 'Tap the side of a road', icon: 'busStop', tone: 'stop', onDone: endTool, onCancel: endTool });
  setMode('stop');
  hint();
}
// ---- railway stations (game/rail.ts): tap the track ----
function startStationTool() {
  tool = shell.startTool({ name: 'Railway station', spec: `Platforms either side of the track · ${money(price(STATION_LIST_PRICE))}`, icon: 'train', tone: 'rail', onDone: endTool, onCancel: endTool });
  setMode('station');
  hint();
}
function stationTap(g: P) {
  const pl = stations.plan(g), cost = price(STATION_LIST_PRICE), afford = purse.can(cost);
  focusOn({ x: pl.x, z: pl.z }, 160);
  const el = openPanel('station', pl.ok ? 'Railway station here' : 'Can’t put a station here', 'train', pl.ok
    ? `<div class="plan"><div class="row"><span class="tab">Two side platforms</span><span class="cost">${money(cost)}</span></div>
        <ul><li>110 m platforms, long enough for a four-car train</li><li>Trains on your rail lines draw up here</li></ul>
        ${afford ? '' : `<div class="bad">${icon('alert')}<span>${short(cost)}</span></div>`}
        <button class="act primary" data-build="1" ${afford ? '' : 'disabled'}>${icon('check')}<span>Build station</span></button></div>`
    : `<div class="bad">${icon('alert')}<span>${esc(pl.reason ?? '')}</span></div>`, true);
  el.querySelector('[data-build]')?.addEventListener('click', () => {
    if (!purse.spend(cost, 'building')) { hint(short(cost), 'alert'); return; }
    const st = stations.add(pl);
    closeSheet();
    if (!st) return;
    town.sync();
    hint(`${st.name} station built for ${money(cost)} · draw a rail line from Transport > Lines`, 'train');
  });
}
function showStationInfo(id: number) {
  const st = stations.byId(id);
  if (!st) return;
  const on = lines.list.filter((l) => l.stops.includes(id)), e = townRef?.stop(id);
  shell.openInfo({
    key: `station:${id}`, title: st.name, sub: 'Railway station', icon: 'train', tone: 'rail',
    facts: [['Lines', on.map((l) => `${l.num}`).join(', ') || 'None yet'], ['Waiting', `${Math.round(e?.waiting ?? 0)}`], ['Boarded this month', `${Math.round((e?.boarded ?? 0) * 30).toLocaleString('en-GB')}`]],
    actions: on.slice(0, 3).map((l) => ({ label: `Line ${l.num}`, icon: 'transport' as Icon, onClick: () => showLineInfo(l) })),
  });
}

// ---- the line tool: tap stops in the order the buses call; the first again makes it circular ----
let lineDraft: number[] = [];
let lineLoop = false;
let busOffer: string | undefined; // the bus model new lines get (picked in Transport > Buy vehicles)
let trainChoice: (TrainDef & { offer: string }) | undefined; // the trains new rail lines get
const NEW_LINE_TRAINS = 1;
function defaultTrain() { const o = traffic.fleet.offerFor('dmu'); return trainChoice ?? (o ? traffic.fleet.defFor(o) : undefined); }
function trainPrice(t?: TrainDef & { offer?: string }) { const f = traffic.fleet, o = t?.offer ? f.trainOffers().find((x) => x.id === t.offer) : undefined; return price(o?.cost ?? 1_200_000); }
const draftRail = () => lineDraft.length > 0 && lines.isStation(lineDraft[0]);
// what the line being drawn will cost: its buses, or its train
function draftCost() { return draftRail() ? trainPrice(defaultTrain()) * NEW_LINE_TRAINS : busPrice(busOffer) * NEW_LINE_BUSES; }
function startLineTool() {
  lineDraft = []; lineLoop = false;
  tool = shell.startTool({ name: 'New line', spec: 'Buses call only at the stops you tap', icon: 'transport', tone: 'stop', onUndo: () => { if (lineLoop) lineLoop = false; else lineDraft.pop(); lineChanged(); }, onDone: endTool, onCancel: endTool });
  setMode('line');
  lineChanged();
}
function lineChanged() {
  const n = lineDraft.length;
  showLine(n ? callOrder(lineDraft, lineLoop) : [], lineDraft);
  tool?.setUndo(n > 0);
  const cost = draftCost();
  tool?.setPrimary({ label: n < 2 ? 'Create' : `Create · ${money(cost)}`, icon: 'check', kind: 'primary', disabled: n < 2 || !purse.can(cost), title: purse.can(cost) ? (draftRail() ? `${NEW_LINE_TRAINS} train` : `${NEW_LINE_BUSES} buses`) : short(cost), onClick: finishLine });
  tool?.setPanel(n ? `<div class="what">${icon('transport')}<span>${lineDraft.map((id, i) => `<b>${i + 1}</b> ${esc(lines.name(id))}`).join(' · ')}${lineLoop ? ' · <b>back to 1</b>' : n > 2 ? ' · and back' : ''}</span></div>` : null);
  hint();
}
function lineTap(sx: number, sy: number) {
  const id = stopNear(sx, sy);
  if (id === null) { hint(allStops().length || stations.list.length ? 'Tap one of the stop or station badges' : 'There are no stops yet · add them from Build > Stops', 'alert'); return; }
  if (lineDraft.length && lines.isStation(id) !== draftRail()) { hint('A line calls at bus stops or at stations, not both', 'alert'); return; }
  if (lineDraft.length && lines.same(lineDraft[lineDraft.length - 1], id)) return;
  if (lineDraft.length >= 2 && lines.same(lineDraft[0], id)) { lineLoop = !lineLoop; lineChanged(); return; }
  if (lineDraft.some((x) => lines.same(x, id))) { hint('That stop is on the line already · a line calls at each stop once each way', 'alert'); return; }
  lineLoop = false;
  lineDraft.push(id);
  lineChanged();
}
function finishLine() {
  if (lineDraft.length < 2) return;
  const rail = draftRail(), cost = draftCost();
  if (!purse.can(cost)) { hint(short(cost), 'alert'); return; }
  // (the old operator's trains are withdrawn once you run your own: nothing signals them apart)
  if (rail && !lines.list.some((x) => x.mode === 'rail')) traffic.clearOtherTrains();
  const l = rail ? lines.add(lineDraft, lineLoop, NEW_LINE_TRAINS, undefined, defaultTrain()) : lines.add(lineDraft, lineLoop, NEW_LINE_BUSES, busOffer);
  const each = rail ? trainPrice(l.train as TrainDef & { offer?: string }) : busPrice(busOffer), k = lines.buses(l).length;
  purse.spend(each * k, 'vehicles');
  lineDraft = [];
  endTool();
  showLineInfo(l);
  hint(`Line ${l.num} is running · ${k} ${rail ? (k === 1 ? 'train' : 'trains') : 'buses'} · ${money(each * k)}`, rail ? 'train' : 'bus');
}
// what a bus costs (the model the line runs, or the default one)
function busPrice(offer?: string) { const f = traffic.fleet, o = (offer && f.busOffers().find((x) => x.id === offer)) || f.defaultBus(); return price(o?.cost ?? 180_000); }
const NEW_LINE_BUSES = 2;
// buy a bus for a line: false if there isn't the money or the room
function vehiclePrice(l: Line) { return l.mode === 'rail' ? trainPrice(l.train as TrainDef & { offer?: string }) : busPrice(l.offer); }
function buyBus(l: Line) {
  const cost = vehiclePrice(l);
  if (!purse.can(cost)) { hint(short(cost), 'alert'); return false; }
  const c = lines.addBus(l);
  if (!c) { hint(l.mode === 'rail' ? 'No track there the train can use' : 'No room on the roads for a bus just now', 'alert'); return false; }
  purse.spend(cost, 'vehicles');
  hint(l.mode === 'rail' ? `A train joins line ${l.num} · ${money(cost)}` : `Bus ${c.dress?.fleetNo ?? ''} joins line ${l.num} · ${money(cost)}`, l.mode === 'rail' ? 'train' : 'bus');
  return true;
}
// the stop badge nearest a tap, within a finger's width
function stopNear(sx: number, sy: number): number | null {
  let best: number | null = null, bd = 30;
  for (const { id, p } of [...markers.places(), ...markers.stationPlaces()]) {
    const q = toScreen(p), d = Math.hypot(q.x - sx, q.y - sy);
    if (d < bd) { bd = d; best = id; }
  }
  if (best === null) { const st = stopAt(groundAt(sx, sy)); if (st) best = st.stop.id; }
  return best;
}
// the route and the stop badges on the map, for a line being drawn or looked at (null: neither)
let routeShown: ReturnType<typeof routeMesh> = null;
function showLine(seq: number[] | null, stops: number[] = []) {
  if (routeShown) { scene.remove(routeShown); routeShown.geometry.dispose(); routeShown.material.dispose(); routeShown = null; }
  if (seq && seq.length > 1) { routeShown = routeMesh(net, traffic, seq, '#5cb83a', stations); if (routeShown) scene.add(routeShown); }
  markers.show(seq ? new Map(stops.map((id, i) => [id, String(i + 1)])) : null);
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
// (the small card's name and line: "Dual 2+2" over "50 mph · £950/m")
const cardName = (t: RoadType) => ROADS[t].label.split(' · ')[0];
const cardSpec = (t: RoadType) => `${ROADS[t].mph} mph · ${perM(ROADS[t].cost)}`;
for (const id of PRESETS) shell.addBuildItem('roads', { id, label: ROADS[id].label, spec: `${ROADS[id].blurb} · ${typeSpec(id)}`, name: cardName(id), short: cardSpec(id), icon: roadIcon(ROADS[id]), tone: 'road', on: () => lastType.road === id, onPick: () => startRoadTool(id) });
shell.addBuildItem('roads', { id: 'more', label: 'More road types', spec: 'Filter by lanes, speed, trees, bus and cycle lanes', short: 'Lanes, speed, trees…', icon: 'adjustments', tone: 'road', on: () => !PRESETS.includes(lastType.road), onPick: () => { openRoadPicker(true); return false; } });
shell.addBuildCategory({ id: 'rail', label: 'Rail', icon: 'train' });
for (const id of RAIL_PRESETS) shell.addBuildItem('rail', { id, label: ROADS[id].label, spec: ROADS[id].blurb, short: `${ROADS[id].mph} mph · ${pctTxt(ROADS[id].maxGrade)}`, icon: roadIcon(ROADS[id]), tone: 'rail', on: () => lastType.rail === id, onPick: () => startRoadTool(id) });
shell.addBuildCategory({ id: 'stops', label: 'Stops', icon: 'busStop' });
shell.addBuildItem('stops', { id: 'bus-stop', label: 'Bus stop', spec: 'On any road; a lay-by where there is room', short: 'On any road', icon: 'busStop', tone: 'stop', onPick: () => startStopTool() });
shell.addBuildItem('stops', { id: 'bus-station', label: 'Bus station', spec: 'Several bays, for busy routes', icon: 'bus', locked: 'Not in the game yet' });
shell.addBuildItem('stops', { id: 'rail-station', label: 'Railway station', spec: 'Platforms on a straight, level run of track', short: 'On straight track', icon: 'train', tone: 'rail', onPick: () => { endTool(); railGame.startStationTool(); } });
shell.addBuildItem('stops', { id: 'depot', label: 'Lorry depot', spec: 'Where your lorries start and are kept', icon: 'warehouse', locked: 'Not in the game yet' });
shell.addBuildCategory({ id: 'freight', label: 'Freight', icon: 'warehouse', note: 'Terminals are bought for an industry; better ones unlock as it grows.' });
shell.addBuildItem('freight', { id: 'terminals', label: 'Freight terminals', name: 'Terminals', spec: 'Loading bays, sidings and jetties for industries', icon: 'warehouse', locked: 'Come with the terminals update' });
shell.addBuildCategory({ id: 'bulldoze', label: 'Bulldoze', icon: 'bulldozer' });
shell.addBuildItem('bulldoze', { id: 'bulldoze', label: 'Bulldoze', spec: 'Tap or drag over what you want to remove; costs shown first', icon: 'bulldozer', locked: 'Not in the game yet: roads stay once built' });
shell.addBuildCategory({ id: 'landscape', label: 'Landscape', icon: 'mountain' });
shell.addBuildItem('landscape', { id: 'terrain', label: 'Raise and lower land', name: 'Raise, lower', spec: 'Hills, cuttings and embankments', icon: 'mountain', locked: 'Needs terrain, which isn’t in the game yet' });

// ---- the Layers pop-over: overlays (none are in the game yet) and the view ----
shell.addLayer({ id: 'flow', label: 'Traffic flow', icon: 'lights', disabled: 'Not in the game yet' });
shell.addLayer({ id: 'catchment', label: 'Stop catchments', icon: 'busStop', disabled: 'Not in the game yet' });
shell.addLayer({ id: 'demand', label: 'Where people want to go', icon: 'users', disabled: 'Not in the game yet' });
shell.addLayer({ id: 'landuse', label: 'Land use', icon: 'building', disabled: 'Not in the game yet' });
shell.addLayer({ id: 'industry', label: 'Industry catchments', icon: 'warehouse', on: false, onToggle: (on) => { siteRings = on; } });
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
type PanelKind = 'junction' | 'stop' | 'station' | 'roads' | 'reset' | 'quality';
// the colourway a sheet wears: stops are orange, road work green, the rest the house green
const TONE = { junction: 'road', roads: 'road', stop: 'stop', station: 'rail', reset: 'look', quality: 'look' } as const;
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
    <div class="rl">${list.map((d) => `<button data-pick="${d.id}" class="${d.id === lastType.road ? 'on' : ''}"><b>${icon(roadIcon(d))}${d.label}</b>${roadSvg(d)}<small>${Math.round(halfOfType(d.id) * 2)} m wide · ${perM(d.cost)} · ${d.blurb}</small></button>`).join('')}</div>`,
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
    hint(`${d.label} · ${Math.round(halfOfType(d.id) * 2)} m wide · ${perM(d.cost)} · drag to draw it`);
  }));
}

// ---- Transport: lines (the stops buses call at) and buying vehicles ----
function allStops() { return [...net.segs.values()].flatMap((seg) => seg.stops.map((stop) => ({ seg, stop }))); }
shell.addTransportTab({
  id: 'lines', label: 'Lines', icon: 'transport', sub: 'Your bus lines and stops',
  render: (el) => {
    const stops = markers.places().map(({ id }) => { const pl = traffic.place(id)!; return { seg: pl.seg, stop: pl.stops[0], sides: pl.stops.length }; });
    el.innerHTML = `<p class="note">${lines.list.length ? 'Buses call only at their line’s stops. Tap a line to see its route.' : 'No lines yet. A line is stops in order; its buses call at those and nothing else.'}</p>
      ${lines.list.map((l, i) => `<button class="lrow tone-stop" data-line="${i}"><span class="num">${l.num}</span><b>${esc(lines.title(l))}</b><span>${l.stops.length} ${l.mode === 'rail' ? 'stations' : 'stops'} · ${lines.buses(l).length} ${l.mode === 'rail' ? 'train' : 'bus'}${lines.buses(l).length === 1 ? '' : l.mode === 'rail' ? 's' : 'es'} · ${l.loop ? 'circular' : 'there and back'}</span></button>`).join('')}
      <div class="acts"><button class="act primary tone-stop" data-newline="1" ${stops.length < 2 && stations.list.length < 2 ? 'disabled' : ''}>${icon('transport')}<span>New line</span></button><button class="act" data-addstop="1">${icon('plus')}<span>Add a bus stop</span></button></div>
      <div class="grp"><span class="tab">Stops</span><small>${stops.length ? `${stops.length} stop${stops.length === 1 ? '' : 's'}, tap one to show it` : 'There are no stops yet.'}</small>
      ${stops.map(({ seg, stop, sides }, i) => `<button class="lrow tone-stop" data-stop="${i}"><span class="num">${icon('busStop')}</span><b>${esc(lines.name(stop.id))}</b><span>${sides > 1 ? 'Both sides' : 'One side'} · ${stop.kind === 'kerb' ? 'kerbside' : 'lay-by'} · ${esc(net.def(seg).label)}</span></button>`).join('')}</div>`;
    el.querySelector('[data-addstop]')!.addEventListener('click', () => startStopTool());
    el.querySelector('[data-newline]')!.addEventListener('click', () => startLineTool());
    el.querySelectorAll<HTMLButtonElement>('[data-line]').forEach((b) => b.addEventListener('click', () => showLineInfo(lines.list[+b.dataset.line!])));
    el.querySelectorAll<HTMLButtonElement>('[data-stop]').forEach((b) => b.addEventListener('click', () => {
      const { seg, stop } = stops[+b.dataset.stop!];
      const at = pointAt(net.path(seg), stop.s);
      showStopInfo(seg, stop);
      focusOn(at, 75);
    }));
  },
});
// A line's sheet: its stops, its buses, and its route on the map while the sheet is open.
function showLineInfo(l: Line) {
  if (!lines.list.includes(l)) { closeSheet(); return; }
  const n = lines.buses(l).length, st = townRef?.line(l.id), books = purse.line(l.id);
  lastLine = l;
  const profit = books.lastFares - books.lastRunning, sell = Math.round(vehiclePrice(l) / 2), rail = l.mode === 'rail', veh = rail ? 'train' : 'bus';
  showLine(l.bus.seq, l.stops);
  shell.openInfo({
    key: `line:${l.id}`, title: `Line ${l.num}`, sub: lines.title(l), icon: l.mode === 'rail' ? 'train' : 'transport', tone: l.mode === 'rail' ? 'rail' : 'stop',
    facts: [
      [rail ? 'Stations' : 'Stops', l.stops.map((id) => lines.name(id)).join(' · ')], ['Runs', l.loop ? 'Circular, round and round' : 'There and back'], [rail ? 'Trains' : 'Buses', `${n}`],
      ['Passengers last month', st ? Math.round(st.carriedLastMonth * 30).toLocaleString('en-GB') : '—'],
      ['Fares last month', money(books.lastFares)], ['Running costs', money(-books.lastRunning)], ['Profit', money(profit)],
    ],
    note: rail ? `Trains call at each station and turn round at the ends of the line. Each passenger pays £2. A day here is a month in the town's life.` : `Buses take the quickest way between stops, and call on whichever side of the road they come along. Each passenger pays £2. A day here is a month in the town's life.`,
    actions: [
      { label: `Add a ${veh} · ${money(vehiclePrice(l))}`, icon: 'plus', kind: 'primary', disabled: !purse.can(vehiclePrice(l)), onClick: () => { buyBus(l); showLineInfo(l); } },
      { label: `Sell a ${veh} · ${money(sell)}`, icon: 'minus', disabled: n === 0, onClick: () => { lines.removeBus(l); purse.refund(sell); hint(`${rail ? 'Train' : 'Bus'} sold for ${money(sell)}`, rail ? 'train' : 'bus'); setTimeout(() => showLineInfo(l), 50); } },
      { label: 'Withdraw line', icon: 'trash', kind: 'danger', onClick: () => { const k = lines.buses(l).length; lines.remove(l); purse.refund(sell * k); closeSheet(); hint(`Line ${l.num} withdrawn · ${k} ${veh}${k === 1 ? '' : rail ? 's' : 'es'} sold for ${money(sell * k)}`, 'transport'); } },
    ],
    onClose: () => { if (mode !== 'line') showLine(null); },
  });
}
let lastLine: Line | null = null;
// A train's sheet, when one of your trains is tapped.
function showTrainInfo(id: number) {
  const t = traffic.train(id);
  if (!t) return;
  const l = lines.of(id);
  const facts: [string, string][] = [['Line', l ? `${l.num} · ${lines.title(l)}` : 'Not on a line'], ['Model', t.model]];
  if (t.next !== undefined) facts.push([t.dwelling ? 'At' : 'Next station', lines.name(t.next)]);
  facts.push(['Speed', `${Math.round(t.speed * 2.237)} mph`]);
  if (l) showLine(l.bus.seq, l.stops);
  shell.openInfo({
    key: `train:${id}`, title: t.model, sub: l ? `Line ${l.num}` : 'Train', icon: 'train', tone: 'rail', facts,
    actions: l ? [{ label: `Line ${l.num}`, icon: 'train', onClick: () => showLineInfo(l) }] : [],
    onClose: () => { if (mode !== 'line') showLine(null); },
  });
}
// A bus's sheet, when it's tapped on the map.
function showBusInfo(id: number) {
  const b = traffic.bus(id);
  if (!b) return;
  const l = lines.of(id);
  const facts: [string, string][] = [['Line', l ? `${l.num} · ${lines.title(l)}` : 'Not on a line'], ['Model', b.model || 'Bus']];
  if (l && b.next !== undefined) facts.push([b.dwelling ? 'At' : 'Next stop', lines.name(b.next)]);
  facts.push(['On board', `${people.aboard(id)}`], ['Speed', `${Math.round(b.speed * 2.237)} mph`]);
  if (l) showLine(l.bus.seq, l.stops);
  shell.openInfo({
    key: `bus:${id}`, title: `Bus ${b.fleetNo}`, sub: l ? `Line ${l.num}` : 'Bus', icon: 'bus', tone: 'stop', facts,
    actions: l ? [{ label: `Line ${l.num}`, icon: 'transport', onClick: () => showLineInfo(l) }] : [],
    onClose: () => { if (mode !== 'line') showLine(null); },
  });
}
shell.addTransportTab({
  id: 'buy', label: 'Buy vehicles', icon: 'bus', sub: 'Buses, trains and how busy the roads are',
  render: (el) => {
    // the vehicle library's fleet for the game year (game/fleet.ts); buses and trains run now
    const year = gameYear(), list = purchaseList(year), fleet = traffic.fleet;
    const facts = (o: Offer) => `${o.capacity ? `${o.capacity} ${o.unit === 'pax' ? 'seats' : 't'} · ` : ''}${Math.round(o.speedKmh / 1.609)} mph · ${money(price(o.cost))}`;
    const row = (o: Offer, attr: string, ic: Icon, off = false) => `<button ${attr}${off ? ' disabled' : ''}><b>${icon(ic)}${esc(o.name)}</b><small>${facts(o)}</small></button>`;
    const trainKind = (o: Offer) => (o.kind === 'tram' ? 'tram' : MODEL[o.models[0]].style === 'rack-car' ? 'rack' : MODEL[o.models[0]].stats.power === 'electric' ? 'hs' : 'dmu');
    const buses = list.filter((o) => o.kind === 'bus' || o.kind === 'coach'), trains = list.filter((o) => o.kind === 'train' || o.kind === 'tram');
    const later = list.filter((o) => !buses.includes(o) && !trains.includes(o));
    el.innerHTML = `
      <div class="grp"><span class="tab">Buses and coaches</span><small>In your company's colours with fleet numbers. Tap one to put it on ${lastLine && lines.list.includes(lastLine) ? `line ${lastLine.num}` : lines.list.length ? `line ${lines.list[0].num}` : 'your next line'}; new lines get that model.</small>
        ${buses.map((o) => row(o, `data-bus="${o.id}"`, 'bus')).join('')}</div>
      <div class="grp"><span class="tab">Trains and trams</span><small>Each runs only on track it can manage: rack, electric wires, gradient</small>
        ${trains.map((o) => row(o, `data-set="${o.id}"`, trainIcon(trainKind(o)))).join('')}</div>
      <div class="grp"><span class="tab">Background traffic</span><small>Cars come from homes, jobs, shops and works, and follow the clock</small>
        <div class="row3" role="group" aria-label="How busy">${LEVELS.map(([n], i) => `<button data-lvl="${i}" class="${i === level ? 'on' : ''}" aria-pressed="${i === level}">${n === 'Traffic' ? 'Normal' : n}</button>`).join('')}</div></div>
      <div class="grp"><span class="tab">Lorries, vans, boats and planes</span><small>On sale in ${year}; not in the game yet</small>
        ${later.map((o) => row(o, '', o.kind === 'boat' ? 'droplet' : o.kind === 'plane' ? 'route' : 'building', true)).join('')}</div>`;
    el.querySelectorAll<HTMLButtonElement>('[data-bus]').forEach((b) => b.addEventListener('click', () => {
      const o = buses.find((x) => x.id === b.dataset.bus)!, l = lastLine && lines.list.includes(lastLine) ? lastLine : lines.list[0];
      busOffer = o.id;
      if (!l) { hint(`New lines will run the ${o.name}`, 'bus'); return; }
      l.offer = o.id;
      buyBus(l);
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-set]').forEach((b) => b.addEventListener('click', () => {
      const o = trains.find((x) => x.id === b.dataset.set)!, t = fleet.defFor(o);
      railGame.buyTrain(t, o.name); // (on a rail line: rail/game.ts)
    }));
    el.querySelectorAll<HTMLButtonElement>('[data-lvl]').forEach((b) => b.addEventListener('click', () => { level = +b.dataset.lvl!; shell.refreshTransport(); }));
  },
});

// ---- the town panel: how the town is doing, and why (game/econ.ts) ----
const STATUS_WORD = { growing: 'Growing', stable: 'Steady', stalling: 'Stalling', declining: 'Declining' } as const;
function showTown() {
  const r = townRef?.report;
  if (!r) return;
  const n = (x: number) => Math.round(x).toLocaleString('en-GB');
  const hist = [...r.history, r.residents], lo = Math.min(...hist), hi = Math.max(...hist), span = Math.max(1, hi - lo);
  const pts = hist.map((v, i) => `${hist.length > 1 ? (i / (hist.length - 1)) * 100 : 100},${40 - ((v - lo) / span) * 34}`);
  const spark = hist.length > 1 ? `<svg class="spark" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="M0,44 L${pts.join(' L')} L100,44 Z"/><path d="M${pts.join(' L')}"/></svg>
    <div class="spark-cap"><span>${hist.length - 1} days ago · ${n(hist[0])}</span><span>now · ${n(r.residents)}</span></div>` : '';
  const reasons = r.reasons.slice(0, 5).map((x) => `<li class="${x.good ? 'good' : 'bad'}">${icon(x.good ? 'check' : 'alert')}<span>${esc(x.text.charAt(0).toUpperCase() + x.text.slice(1))}</span></li>`).join('');
  const lineRows = lines.list.map((l) => { const s = townRef!.line(l.id); return s ? `<button class="lrow tone-stop" data-tl="${l.id}"><span class="num">${l.num}</span><b>${esc(lines.title(l))}</b><span>${n(s.carriedLastMonth || s.carried)} carried a day · ${Math.round(s.loadFactor * 100)}% full · ${n(s.waiting)} waiting</span></button>` : ''; }).join('');
  const el = shell.openInfo({
    key: 'town', title: TOWN_NAME, sub: `${n(r.residents)} people · ${n(r.jobs)} jobs`, icon: 'building',
    html: `<div class="townhead"><span class="pill ${r.status}">${STATUS_WORD[r.status]}</span></div>
      <p class="note">${esc(r.headline.replace(/^\w+: /, ''))}</p>${spark}
      <dl class="facts" style="margin-top:10px">
        <dt>In the bank</dt><dd>${money(purse.balance)}</dd>
        <dt>Fares yesterday</dt><dd>${money(purse.yesterday.fares)}</dd>
        <dt>Running costs yesterday</dt><dd>${money(-purse.yesterday.running)}</dd>
        <dt>Homes</dt><dd>${n(r.homes)}${r.vacancy > 0.02 ? ` · ${Math.round(r.vacancy * 100)}% empty` : ''}</dd>
        <dt>Homes near a stop</dt><dd>${Math.round(r.service.homesNearStop * 100)}%</dd>
        <dt>Workers who can reach a job</dt><dd>${Math.round(r.reach.work * 100)}%</dd>
        <dt>Free plots</dt><dd>${n(r.service.plots)}</dd>
      </dl>
      <ul class="why">${reasons}</ul>
      <p class="note" style="margin-top:10px">A day here is a month in the town's life: it reviews how it's doing each day, and fares and running costs come and go at a month's pace.</p>
      ${lineRows ? `<div class="grp" style="margin-top:12px"><span class="tab">Your lines</span>${lineRows}</div>` : ''}`,
  });
  el.querySelectorAll<HTMLButtonElement>('[data-tl]').forEach((b) => b.addEventListener('click', () => { const l = lines.list.find((x) => x.id === +b.dataset.tl!); if (l) showLineInfo(l); }));
}

// ---- Menu: quality, the performance readout, a new town ----
shell.addMenuItem({ id: 'quality', label: 'Quality', icon: 'sparkles', sub: () => (tierAuto ? `Auto · ${TIERS[tier].name} now` : TIERS[tier].name), onClick: () => openQuality() });
shell.addMenuItem({ id: 'perf', label: 'Performance', icon: 'activity', sub: () => (perfOn ? 'Readout showing' : 'Readout off'), onClick: () => { togglePerf(); closeSheet(); } });
shell.addMenuItem({ id: 'town', label: TOWN_NAME, icon: 'building', sub: () => (townRef?.report ? `${STATUS_WORD[townRef.report.status]} · ${Math.round(townRef.report.residents).toLocaleString('en-GB')} people` : 'The town panel'), onClick: () => showTown() });
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
    menuLink?.onQuality(tierAuto ? 'auto' : tier);
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
    if (j.form === 'join' || j.form === 'merge' || j.form === 'diverge') continue;
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
  if (slipPlan) { renderSlipBar(slipPlan); return; }
  const c = draftCheck;
  const n = c.clears.length;
  const kind = ctrlOf(draft) ? 'Curved road' : 'New road';
  const demo = n ? demolitionSummary(c.clears) : null;
  const pr = c.profile;
  const lift = pr && pr.maxY > 0.05
    ? `<div class="lift">${icon('mountain')}<span>${c.ok ? `up to <b>${pr.maxY.toFixed(1)} m</b> · steepest <b>${(pr.maxGrade * 100).toFixed(1)}%</b>${c.bridges ? ` · ${c.bridges} bridge${c.bridges > 1 ? 's' : ''}` : ''} · ${Math.round(c.raised)} m raised` : `would need <b>${pr.maxY.toFixed(1)} m</b> — red line shows the lowest it could go`}</span></div>${profileSvg(c)}` : '';
  // across a road, a motorway can have a junction there: pick one, and the card is its blueprint
  const forms: IxForm[] = ixPair ? ['cloverleaf'] : IX_FORMS;
  const ix = ixRoad || ixPair ? `<div class="ix"><span class="ixh">${icon('arrowsCross')}Junction here with the ${ixPair ? 'motorway' : esc(net.def(ixRoad!).label.split(' · ')[0].toLowerCase())}?</span>
      <div class="ixrow"><button data-ix="" class="${ixPick ? '' : 'on'}" aria-pressed="${!ixPick}">No junction</button>${forms.map((f) => `<button data-ix="${f}" class="${ixPick?.form === f ? 'on' : ''}" aria-pressed="${ixPick?.form === f}" title="${IX_BLURB[f]}">${IX_NAME[f]}</button>`).join('')}</div>
      ${ixPick ? `<div class="ixrow">${IX_SIZES.map((z) => `<button data-ixz="${z}" class="${ixSize === z ? 'on' : ''}" aria-pressed="${ixSize === z}" title="${IX_SIZE_BLURB[z]}">${IX_SIZE_NAME[z]}</button>`).join('')}</div>
      ${ixPair ? '' : `<div class="ixrow"><button data-ixs="taper" class="${ixStyle === 'taper' ? 'on' : ''}">Taper slip roads</button><button data-ixs="parallel" class="${ixStyle === 'parallel' ? 'on' : ''}">Long parallel lanes</button></div>`}
      <small>${IX_BLURB[ixPick.form]} · ${ixPair ? (ixSize === 'tight' ? 'Compact: tighter loops and ramps, steeper climbs' : 'Spread out: wide loops, gentle climbs') : IX_SIZE_BLURB[ixSize]} · slip roads to DMRB CD 122</small>` : ''}</div>` : '';
  const bindIx = (el: HTMLElement) => {
    el.querySelectorAll<HTMLButtonElement>('[data-ix]').forEach((b) => b.addEventListener('click', () => { ixPick = b.dataset.ix ? { form: b.dataset.ix as IxForm, style: ixStyle, size: ixSize } : null; draftChanged(); }));
    el.querySelectorAll<HTMLButtonElement>('[data-ixz]').forEach((b) => b.addEventListener('click', () => { ixSize = b.dataset.ixz as IxSize; if (ixPick) ixPick = { ...ixPick, size: ixSize }; draftChanged(); }));
    el.querySelectorAll<HTMLButtonElement>('[data-ixs]').forEach((b) => b.addEventListener('click', () => { ixStyle = b.dataset.ixs as SlipStyle; if (ixPick) ixPick = { ...ixPick, style: ixStyle }; draftChanged(); }));
  };
  if (ixPick && ixPlan) {
    const p = ixPlan, nd = p.clears.length, dm = nd ? demolitionSummary(p.clears) : null;
    tool.setPanel(`<div class="what">${icon('ruler')}<span>Motorway and ${IX_NAME[ixPick.form].toLowerCase()} · <b class="cost">${p.ok ? `about ${money(price(p.cost))}` : '—'}</b></span></div>
      ${p.ok && !purse.can(price(p.cost)) ? `<div class="bad">${icon('alert')}<span>${short(price(p.cost))}</span></div>` : ''}
      ${dm ? `<div class="demo">${icon('alert')}<div><b>It demolishes ${nd} building${nd > 1 ? 's' : ''}</b> (flashing red): ${dm.list}.<br>${dm.people}</div></div>` : ''}
      ${ix}
      ${p.ok ? '' : `<div class="bad">${icon('alert')}<span>${esc(p.reason ?? '')}</span></div>`}`, bindIx);
    tool.avoid(handles().map((h) => toScreen(h.p)));
    tool.setPrimary({ label: 'Build', title: 'Build the motorway and its junction', icon: nd ? 'bulldozer' : 'check', kind: nd ? 'danger' : 'primary', disabled: !(p.ok && !dragging && purse.can(price(p.cost))), onClick: buildDraft });
    return;
  }
  const cost = price(c.cost), afford = purse.can(cost);
  tool.setPanel(`<div class="what">${icon('ruler')}<span>${kind} <b>${Math.round(c.length)} m</b> · <b class="cost">${money(cost)}</b></span></div>
    ${ix}
    ${afford ? '' : `<div class="bad">${icon('alert')}<span>${short(cost)}</span></div>`}
    ${demo ? `<div class="demo">${icon('alert')}<div><b>This road demolishes ${n} building${n > 1 ? 's' : ''}</b> (flashing red): ${demo.list}.<br>${demo.people} · ${money(price(n * 6000))} compensation included</div></div>` : ''}
    ${lift}
    ${c.ok ? bridgeLines(c) : ''}
    ${c.ok ? '' : `<div class="bad">${icon('alert')}<span>${c.reason}</span></div>`}`, bindIx);
  // (demolishing, it's red with the bulldozer; the card above says what goes)
  tool.avoid(handles().map((h) => toScreen(h.p)));
  tool.setPrimary({ label: 'Build', title: n ? `Demolish ${n} building${n > 1 ? 's' : ''} and build` : 'Build', icon: n ? 'bulldozer' : 'check', kind: n ? 'danger' : 'primary', disabled: !(c.ok && !dragging && afford), onClick: buildDraft });
}
// the bridges in a blueprint: the type the chooser picked, its price and what's worth knowing
function bridgeLines(c: Check) {
  return c.choices.map((ch) => {
    const o = ch.options.find((x) => x.def.id === ch.chosen);
    if (!o) return '';
    return `<div class="lift">${icon('bridge')}<span><b>${o.def.label}</b> · ${Math.round(ch.s1 - ch.s0)} m · <b class="cost">${money(price(o.cost))}</b>${o.reasons.length ? ` · ${o.reasons.slice(0, 2).join(' · ')}` : ''}</span></div>`;
  }).join('');
}
// How a motorway blueprint is built as a pair of carriageways, or null to build it as drawn (a
// junction at both ends, or joined part-way along a road, where one road is all that fits)
function motorwayPair(d: Draft) {
  if (mode !== 'road' || ROADS[opts.type].family !== 'Motorway' || isSlip(opts.type) || opts.oneway) return null;
  if (d.a.seg !== undefined || d.b.seg !== undefined || (d.a.node !== undefined && d.b.node !== undefined)) return null;
  const path = net.makePath(d.a, d.b, ctrlOf(d)), o = { height: opts.height, grade: opts.grade, cross: opts.cross }, type = opts.type;
  return (n: Network) => (d.b.node !== undefined ? pairToNode(n, path, type, d.b, 0.3, o) : d.a.node !== undefined ? pairToNode(n, [...path].reverse(), type, d.a, 0.3, o) : buildPair(n, path, type, o));
}
// A slip road off (or onto) a motorway: which way it goes, one lane or two, its price, why not
function renderSlipBar(p: SlipPlan) {
  if (!tool) return;
  const cost = price(p.cost), afford = purse.can(cost), nd = p.clears.length, dm = nd ? demolitionSummary(p.clears) : null;
  const what = p.kind === 'diverge' ? 'Slip road off the motorway' : 'Slip road onto the motorway';
  tool.setPanel(`<div class="what">${icon('ruler')}<span>${what}${p.ok ? ` <b>${Math.round(p.length)} m</b> · <b class="cost">${money(cost)}</b>` : ''}</span></div>
    <div class="ix"><div class="ixrow">${([1, 2] as const).map((n) => `<button data-sl="${n}" class="${slipLanes === n ? 'on' : ''}" aria-pressed="${slipLanes === n}">${n === 1 ? '1 lane' : '2 lanes'}</button>`).join('')}</div>
    <small>${p.kind === 'diverge' ? 'Leaves the nearside lane along a DMRB taper, past a hatched nose' : 'Joins the nearside lane past a hatched nose, along a DMRB taper'} · drag ahead to leave, back to join</small></div>
    ${p.ok && !afford ? `<div class="bad">${icon('alert')}<span>${short(cost)}</span></div>` : ''}
    ${dm ? `<div class="demo">${icon('alert')}<div><b>It demolishes ${nd} building${nd > 1 ? 's' : ''}</b> (flashing red): ${dm.list}.<br>${dm.people}</div></div>` : ''}
    ${p.ok ? '' : `<div class="bad">${icon('alert')}<span>${esc(p.reason ?? '')}</span></div>`}`, (el) => {
    el.querySelectorAll<HTMLButtonElement>('[data-sl]').forEach((b) => b.addEventListener('click', () => { slipLanes = Number(b.dataset.sl) as 1 | 2; draftChanged(); }));
  });
  tool.avoid(handles().map((h) => toScreen(h.p)));
  tool.setPrimary({ label: 'Build', title: 'Build the slip road', icon: nd ? 'bulldozer' : 'check', kind: nd ? 'danger' : 'primary', disabled: !(p.ok && !dragging && afford), onClick: buildDraft });
}
function buildDraft() {
  if (draft && slipPlan) {
    if (!slipPlan.ok) return;
    const cost = price(slipPlan.cost);
    if (!purse.spend(cost, 'building')) { hint(short(cost), 'alert'); return; }
    const segs = buildSlip(net, slipPlan), kind = slipPlan.kind;
    // (as buildRoad: what it demolishes sinks away, what it touches is redone)
    for (const x of buildings) if (x.lot.id >= 0 && !net.lots.includes(x.lot) && !x.dying) demolish(x);
    for (const l of net.touched) { const x = buildings.find((y) => y.lot === l); if (x && !x.dying) regenerate(x); }
    commitRoads(segs);
    refreshTrees();
    infillDue = true;
    draft = null;
    draftChanged();
    hint(`${kind === 'diverge' ? 'Slip road off the motorway' : 'Slip road onto the motorway'} built for ${money(cost)}`, 'check');
    return;
  }
  if (draft && ixPick && (ixRoad || ixPair) && ixPlan?.ok) { buildJunctionDraft(draft, ixPick, ixRoad); return; }
  if (!draft || !draftCheck?.ok) return;
  const cost = price(draftCheck.cost);
  // a motorway is built as a pair of one-way carriageways (so slip roads can be dragged off it),
  // meeting a junction at either end if it's drawn to one; otherwise as it's drawn
  const pair = motorwayPair(draft);
  if (pair) { const t = pair(scratch(net)); if (!t.ok) { hint(t.reason, 'alert'); return; } }
  if (!purse.spend(cost, 'building')) { hint(short(cost), 'alert'); return; }
  const doomed = new Set(draftCheck.clears);
  const summary = doomed.size ? demolitionSummary([...doomed]) : null;
  if (pair) {
    const r = pair(net), made = r.ok ? [...r.ab, ...r.ba] : [];
    for (const x of buildings) if (x.lot.id >= 0 && !net.lots.includes(x.lot) && !x.dying) demolish(x);
    for (const l of net.touched) { const x = buildings.find((y) => y.lot === l); if (x && !x.dying) regenerate(x); }
    commitRoads(made);
    refreshTrees();
    infillDue = true;
  } else buildRoad(draft.a, draft.b, ctrlOf(draft), opts);
  draft = null;
  draftChanged();
  hint(summary ? `Demolished ${doomed.size}: ${summary.list} · ${money(cost)}` : `Built for ${money(cost)} · the town builds along it as it needs`, summary ? 'bulldozer' : 'check');
}

// The motorway blueprint with its junction, built (interchange/build.ts): both carriageways, the
// slip roads, the bridge or ring, the junction's roundabouts or give-ways; one junction to the player.
function buildJunctionDraft(d: Draft, pick: { form: IxForm; style: SlipStyle; size: IxSize }, road: RSeg | null) {
  const had = new Set(net.segs.keys()), cost = price(ixPlan?.cost ?? 0);
  if (!purse.can(cost)) { hint(short(cost), 'alert'); return; }
  const mw = net.makePath(d.a, d.b, ctrlOf(d)), id = interchanges.length + 1;
  const r = pick.form === 'cloverleaf' || !road ? motorwayCloverleaf(net, mw, opts.type, id, pick.size) : motorwayWithJunction(net, pick.form, mw, opts.type, road, id, pick.style, pick.size);
  if (!r.ok) { hint(r.reason, 'alert'); return; }
  purse.spend(cost, 'building');
  interchanges.push(r.ix);
  for (const x of buildings) if (x.lot.id >= 0 && !net.lots.includes(x.lot) && !x.dying) demolish(x);
  commitRoads([...net.segs.keys()].filter((id) => !had.has(id)));
  refreshTrees();
  infillDue = true;
  draft = null; ixPick = null;
  draftChanged();
  hint(`Built for ${money(cost)}: the motorway and a ${IX_NAME[pick.form].toLowerCase()}. Tap the junction to see how it's working.`, 'check');
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
const xrayMat = new THREE.MeshBasicMaterial({ color: '#4cc3ff', transparent: true, opacity: 0.3, depthTest: false, depthWrite: false });
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
  const plan = ixPlan?.ok ? ixPlan : slipPlan?.ok ? slipPlan : null;
  if (draft && plan) {
    // the junction blueprint: every piece it builds (both carriageways, slip roads, the bridge or ring),
    // or a slip road's
    const f = new Flat();
    for (const g of plan.ghost) f.ribbon(g.path, g.half, 0.6);
    const m = f.mesh(ghostMat);
    m.renderOrder = 5;
    ghost.add(m);
    for (const l of plan.clears) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(l.w + 1, l.h + 1, l.d + 1), doomMat);
      box.position.set(l.x, (l.h + 1) / 2, l.z); box.rotation.y = -l.rot; box.renderOrder = 6;
      ghost.add(box);
    }
  } else if (draft && draftCheck) {
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
    // (the blueprint: a lay-by reaches out past the kerb; a kerbside stop takes the edge of the lane)
    const { seg, t, side, kind = 'kerb' } = stopPreview, probe = { id: 0, s: t, side, kind, take: { pave: 0, lane: 0, land: 0, park: 0 } };
    const [a, b] = stopSpan(probe), path = net.path(seg), K = kerbOf(net.def(seg));
    const sp = subPath(path, Math.max(0, a), Math.min(pathLength(path), b));
    const pf = new Flat();
    const [i0, i1] = kind === 'layby' ? [K - 0.4, K + 3.0] : [K - 3.2, K + 0.2];
    pf.strip(sp, () => (side === 1 ? [i0, i1] : [-i1, -i0]), 0.8);
    const m = pf.mesh(ghostMat); m.renderOrder = 5; ghost.add(m);
    // and faintly through any building in front of it, so it's never lost behind one
    const xm = pf.mesh(xrayMat); xm.renderOrder = 8; ghost.add(xm);
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
    actions: b.region ? [] : [{ label: 'Add a bus stop', icon: 'busStop', onClick: () => startStopTool() }, { label: TOWN_NAME, icon: 'building', onClick: () => showTown() }],
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

// ---- motorway junctions (interchange/build.ts): one junction to the player ----
function interchangeAt(p: P) {
  for (const ix of interchanges) {
    for (const n of ix.nodes) { const c = net.nodes.get(n), j = junctions.get(n); if (c && Math.hypot(c.x - p.x, c.z - p.z) < Math.max(14, (j?.R ?? 0) + 4)) return ix; }
    for (const id of ix.segs) { const sg = net.segs.get(id); if (sg && closestOnPath(p, net.path(sg)).d < net.half(sg)) return ix; }
  }
  return null;
}
function showInterchangeInfo(ix: Interchange) {
  const js = ix.nodes.map((n) => junctions.get(n)).filter((j): j is Junction => !!j);
  const own = js.filter((j) => j.form !== 'merge' && j.form !== 'diverge'), worst = Math.max(0, ...js.map((j) => j.score.dos));
  const ofKind = (k: 'merge' | 'diverge') => ix.slips.find((x) => x.kind === k);
  const dv = ofKind('diverge'), mg = ofKind('merge');
  const lane = (x: typeof dv) => (x ? `${x.aux ? `${x.aux} m alongside, ` : ''}${x.taper} m taper, ${x.nose} m nose` : '—');
  const busiest = js.reduce<Junction | null>((b, j) => (!b || j.score.dos > b.score.dos ? j : b), null);
  shell.openInfo({
    key: `interchange-info:${ix.id}`, title: IX_NAME[ix.form], sub: `${IX_BLURB[ix.form]} · ${ix.slips.length} slip roads${ix.style === 'parallel' ? ' with parallel lanes' : ''}`, icon: formIcon(ix.form === 'diamond' ? 'priority' : 'roundabout'), tone: 'road',
    facts: [['Busiest lane', `${pctFull(worst)} full${busiest ? ` (${FORM_NAME[busiest.form].toLowerCase()})` : ''}`], ['Leaving the motorway', lane(dv)], ['Joining it', lane(mg)], ['Junctions in it', own.map((j) => FORM_NAME[j.form]).join(', ') || '—']],
    meter: worst,
    actions: own.slice(0, 2).map((j, i) => ({ label: own.length > 1 ? `Edit ${FORM_NAME[j.form].toLowerCase()} ${i + 1}` : `Edit ${FORM_NAME[j.form].toLowerCase()}`, icon: formIcon(j.form), kind: i ? undefined : 'primary', onClick: () => openJunction(j.node) })),
  });
}

// ---------------- bridges (game/bridges.ts) ----------------
// the bridge drawn under a screen point: its deck, sampled along its length
function bridgeAt(sx: number, sy: number) {
  let best: BuiltBridge | null = null, bd = Infinity;
  for (const b of bridgeLayer.list()) {
    const hw = b.layout.width / 2;
    for (let s = b.s0; s <= b.s1; s += 2) {
      // within the deck's width as drawn on screen (and a finger's slack)
      const p = pointAt(b.crossing.path, s), q = toScreen(p), e = toScreen({ x: p.x - p.uz * hw, z: p.z + p.ux * hw, y: p.y });
      const d = Math.hypot(q.x - sx, q.y - sy);
      if (d < Math.hypot(e.x - q.x, e.y - q.y) + 10 && d < bd) { bd = d; best = b; }
    }
  }
  return best;
}
const bridgeKey = (b: BuiltBridge) => `${b.seg}:${b.idx}`;
function showBridgeInfo(b: BuiltBridge) {
  const L = b.layout, d = L.def, piers = L.supports.filter((q) => q.kind !== 'abutment').length;
  const mph = net.segs.get(b.seg)?.type.startsWith('rail') ? d.railMph : d.roadMph;
  const facts: [string, string][] = [['Length', `${Math.round(b.s1 - b.s0)} m`], ['Spans', `${L.spans.length}${piers ? ` on ${piers} support${piers > 1 ? 's' : ''}` : ''}`], ['Cost to build', money(price(L.cost))]];
  if (mph) facts.push(['Speed limit', `${mph} mph`]);
  const over = net.segs.get(b.seg)?.bridges?.[b.idx]?.override;
  shell.openInfo({
    key: `bridge-info:${bridgeKey(b)}`, title: d.label, sub: over ? 'Your choice of type' : 'Chosen for the lowest cost over its life', icon: 'bridge', tone: 'road',
    facts, note: L.notes.join(' · ') || undefined,
    actions: [{ label: 'Change bridge type', icon: 'bridge', kind: 'primary', onClick: () => openBridgeEditor(b) }],
  });
  const m = pointAt(b.crossing.path, (b.s0 + b.s1) / 2);
  focusOn(m, Math.max(140, (b.s1 - b.s0) * 1.8), undefined, 0.9);
}
// every type that could stand here this year: price, a mark on the recommended one, and the
// refused ones greyed with their reason. Picking one re-commits the town with it.
function openBridgeEditor(b: BuiltBridge, fresh = true) {
  const ch = bridgeLayer.options(b);
  const el = shell.openSheet({
    key: `bridge-edit:${bridgeKey(b)}`, title: 'Bridge type', sub: `${Math.round(b.s1 - b.s0)} m · now a ${b.layout.def.label.toLowerCase()}`, icon: 'bridge', tone: 'road', fresh,
    back: () => showBridgeInfo(b),
    body: `<div class="grp"><span class="tab">Types</span>${ch.options.map((o) => {
      const on = o.def.id === b.layout.def.id, rec = o.def.id === ch.recommended;
      const sub = o.ok ? `${on ? 'built' : `${money(price(o.cost))} to rebuild`}${o.reasons.length ? ` · ${o.reasons[0]}` : ''}` : o.reasons[0] ?? 'Can’t be built here';
      return `<button data-type="${o.def.id}" class="${on ? 'on' : ''}" aria-pressed="${on}" ${o.ok ? '' : 'disabled'}><b>${rec ? icon('sparkles') : ''}${o.def.label}${rec ? ' · recommended' : ''}${on ? icon('check', 'tick') : ''}</b><small>${sub}</small></button>`;
    }).join('')}</div>`,
  });
  el.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((btn) => btn.addEventListener('click', () => {
    const mid = (b.s0 + b.s1) / 2, o = ch.options.find((x) => x.def.id === btn.dataset.type);
    if (!o || o.def.id === b.layout.def.id) return;
    if (!purse.can(price(o.cost))) { hint(short(price(o.cost)), 'alert'); return; }
    if (!bridgeLayer.setType(net, b, btn.dataset.type as BuiltBridge['layout']['def']['id'])) return;
    purse.spend(price(o.cost), 'building');
    rebuildRoads();
    const nb = bridgeLayer.at(b.seg, mid);
    if (nb) openBridgeEditor(nb, false);
    hint(`Rebuilt as a ${nb?.layout.def.label.toLowerCase() ?? 'bridge'}`, 'check');
  }));
}

// ---------------- bus stops ----------------
let stopPreview: { seg: RSeg; t: number; side: 1 | -1; kind?: 'kerb' | 'layby' } | null = null;
function stopAt(p: P) {
  for (const seg of net.segs.values()) for (const stop of seg.stops) {
    const q = closestOnPath(p, net.path(seg));
    const [a, b] = stopSpan(stop);
    if (q.s > a && q.s < b && q.d < net.half(seg) + 2 && net.sideOf(seg, p) === stop.side) return { seg, stop };
  }
  return null;
}
// a stop's figures from the economy (both sides of the road together), a month being a game day
function stopFigures(st: Stop): [string, string][] {
  const e = townRef?.stop(st.id);
  if (!e || !e.lines.length) return [['Waiting', '0 (no line calls here yet)']];
  const n = (x: number) => Math.round(x).toLocaleString('en-GB');
  return [['Waiting', n(e.waiting)], ['Boarded this month', n(e.boarded * 30)], ['Got off this month', n(e.alighted * 30)]];
}
function showStopInfo(seg: RSeg, st: Stop) {
  const d = net.def(seg), t = st.take;
  const bits = st.kind === 'kerb' ? ['buses stop in the lane'] : [
    `pavement ${(d.pave - t.pave).toFixed(1)} m (was ${d.pave.toFixed(1)} m)`,
    t.lane ? `lanes ${(d.lane - t.lane / (d.lanes > 1 ? d.lanes : 2)).toFixed(2)} m (was ${d.lane.toFixed(2)} m)` : '',
    t.land ? `${t.land.toFixed(1)} m of front gardens bought` : '',
  ].filter(Boolean);
  shell.openInfo({
    key: `stop:${seg.id}:${st.id}`, title: lines.name(st.id), sub: `${st.kind === 'kerb' ? 'Kerbside stop' : 'Bus lay-by'} · ${d.label}`, icon: 'busStop', tone: 'stop',
    facts: [['Lines', lines.list.filter((l) => l.stops.some((x) => lines.same(x, st.id))).map((l) => `${l.num}`).join(', ') || 'None yet'], ...stopFigures(st)], note: bits.join(' · '),
    actions: lines.list.filter((l) => l.stops.some((x) => lines.same(x, st.id))).slice(0, 3).map((l) => ({ label: `Line ${l.num}`, icon: 'transport' as Icon, onClick: () => showLineInfo(l) })),
  });
}


// Tap a road: the stop's blueprint appears there, with a choice of two (kerbside or lay-by, each
// with its price) in a small card above the tool strip, and Build to confirm. Tap again to move it.
function stopTap(p: P) {
  const q = net.nearestSeg(p, 30, (x) => net.def(x).cls === 'road');
  if (!q) { hint('Tap on a road', 'alert'); return; }
  const side = net.sideOf(q.seg, p);
  const res = net.planStop(q.seg.id, q.s, side);
  if (res.reason) {
    stopPreview = null; drawGhost();
    tool?.setPanel(`<div class="bad">${icon('alert')}<span>${esc(res.reason)}</span></div>`);
    tool?.setPrimary(null);
    return;
  }
  const afford = (pl: StopPlan) => pl.ok && purse.can(price(pl.cost));
  let pick = Math.max(0, res.plans.findIndex(afford));
  const feeds = industries.servedFrom(industries.kerbPoint(q.seg, q.s, side)).map((x) => x.model.variant.name); // (game/industry.ts)
  const WHAT = { kerb: ['Kerbside', 'Buses stop in the lane'], layby: ['Lay-by', 'Buses pull in, clear of the traffic'] } as const;
  // (centred in the clear map above the card, closer in if far out, so the blueprint can be seen)
  focusOn({ x: q.x, z: q.z }, Math.min(view.h, 140));
  const show = () => {
    const pl = res.plans[pick], cost = price(pl.cost);
    stopPreview = { seg: q.seg, t: q.s, side, kind: pl.kind };
    drawGhost();
    const why = !pl.ok ? pl.blocked ?? 'Can’t be built here' : !purse.can(cost) ? short(cost) : `${WHAT[pl.kind][1]}${feeds.length ? ` · serves the ${feeds.join(' and the ')} too` : ''} · tap elsewhere to move it`;
    tool?.setPanel(`<div class="choice">${res.plans.map((x, i) => `<button data-pick="${i}" class="${i === pick ? 'on' : ''}" ${x.ok ? '' : 'disabled'}><b>${WHAT[x.kind][0]}</b><span>${money(price(x.cost))}</span></button>`).join('')}</div>
      <p class="why">${esc(why)}</p>`, (el) => el.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => b.addEventListener('click', () => { pick = +b.dataset.pick!; show(); })));
    tool?.setPrimary({ label: `Build · ${money(cost)}`, icon: 'check', kind: 'primary', disabled: !afford(pl), onClick: build });
    hint();
  };
  const build = () => {
    const pl = res.plans[pick], cost = price(pl.cost);
    if (!afford(pl) || !purse.spend(cost, 'building')) { hint(short(cost), 'alert'); return; }
    net.addStop(q.seg.id, q.s, side, pl);
    for (const l of net.touched) { const bb = buildings.find((x) => x.lot === l); if (bb && !bb.dying) regenerate(bb); }
    stopPreview = null;
    drawGhost();
    rebuildRoads();
    tool?.setPanel(null);
    tool?.setPrimary(null);
    hint(`${WHAT[pl.kind][0]} stop built for ${money(cost)} · tap to place another, or Done`, 'check');
  };
  show();
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
  if (mode === 'line') { lineTap(sx, sy); return mode; }
  if (railGame.tap(sx, sy, g)) return 'stop'; // (a railway tool: rail/game.ts)
  if (mode === 'station') { stationTap(g); return mode; } // (the interim stations, game/rail.ts: not offered while rail/ is)
  const bus = traffic.busNear(g);
  if (bus !== null) { showBusInfo(bus); return 'look'; }
  const ixAt = interchangeAt(g); // (a motorway junction is one junction, whichever part of it is tapped)
  if (ixAt) { showInterchangeInfo(ixAt); return 'look'; }
  if (railGame.inspect(g)) return 'look'; // a train or a station
  const train = traffic.trainNear(g);
  if (train !== null) { showTrainInfo(train); return 'look'; }
  const sta = stations.near(g, 60);
  if (sta) { showStationInfo(sta.id); return 'look'; }
  const st = stopAt(g);
  const jn = st ? null : junctionNear(g);
  const br = st || jn !== null ? null : bridgeAt(sx, sy); // (a bridge is tapped where it's drawn, up in the air)
  if (br) { showBridgeInfo(br); return 'look'; }
  const site = st || jn !== null ? null : siteUnder(sx, sy, g); // an industrial site (game/industry.ts)
  if (site) { showSite(site); return 'look'; }
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

// A motorway junction on its own, to look at: /proto.html?junction=dumbbell (or gsr, diamond; &slips=parallel)
function seedJunctionDemo(form: IxForm | null, style: SlipStyle, size: IxSize = 'open') {
  if (form === 'cloverleaf') {
    // (two motorways crossing: an east–west one there first, the cloverleaf built with a north–south one)
    const C = size === 'tight' ? 900 : 1250;
    net.bound = Math.max(BOUND, C + 250);
    buildPair(net, [{ x: -C, z: 230 }, { x: C, z: 230 }], 'motorway');
    const r = motorwayCloverleaf(net, [{ x: 100, z: 230 - C }, { x: 100, z: 230 + C }], 'motorway', 1, size);
    if (r.ok) interchanges.push(r.ix); else console.warn(r.reason);
    commitRoads([...net.segs.keys()]);
    return;
  }
  const R = 780;
  net.bound = Math.max(BOUND, R + 10); // (a grade-separated roundabout's slip roads reach past the town's edge)
  // (north of the lake)
  net.build({ x: -60, z: -510 }, { x: -60, z: 510 }, undefined, { ...DEFAULT_OPTS, type: 'dual' });
  // (blank: just the road, for drawing a motorway across)
  const r = form ? motorwayWithJunction(net, form, [{ x: -R, z: 230 }, { x: R, z: 230 }], 'motorway', [...net.segs.values()][0], 1, style, size) : null;
  if (r?.ok) interchanges.push(r.ix); else if (r) console.warn(r.reason);
  commitRoads([...net.segs.keys()]);
  for (const l of queue.splice(0, Math.floor(queue.length * 0.8))) if (net.lotFree(l)) spawnLot(l, false);
}

// ---------------- loop ----------------
// the map is `?map=<id>` (maps.ts); the sandbox is the same land with nothing built on it yet
const sandbox = new URLSearchParams(location.search).get('map') === 'sandbox';
// (or a motorway junction on its own, to look at: /proto.html?junction=dumbbell, see seedJunctionDemo)
const demoJunction = new URLSearchParams(location.search).get('junction');
const demo = demoJunction === 'blank' || demoJunction === 'cloverleaf' || (IX_FORMS as string[]).includes(demoJunction ?? '');
if (demo) seedJunctionDemo(demoJunction === 'blank' ? null : (demoJunction as IxForm), new URLSearchParams(location.search).get('slips') === 'parallel' ? 'parallel' : 'taper', new URLSearchParams(location.search).get('size') === 'tight' ? 'tight' : 'open');
else if (!sandbox) await seedTown();
await loading.stage('Adding bus stops and drawing the roads', 0.1);
// (no stops, lines, stations or trains to start with: every bit of the transport is the player's to build)
rebuildRoads();
refreshTrees();
setMode('look');
setKind('straight');
setType('street');
resize();
await loading.stage('Parks, playgrounds and car parks', 0.14);
refreshInfill();
await loading.stage(MAP.style === 'arctic' ? 'Laying the snow' : MAP.style === 'desert' ? 'Spreading the sand' : 'Painting the fields and woods', 0.07);
gameGround.start(trees);
refreshTrees();
// every building merged into its chunk before the first frame (not two a frame as it plays)
await loading.stage('Finishing the buildings', 0.03);
{ const dirty = [...chunks.values()].filter((c) => c.dirty); for (const [i, c] of dirty.entries()) { rebuildChunk(c); await loading.tick(i / dirty.length); } }
await loading.stage('Starting the traffic and the town', 0.15);

// ---------------- clock and traffic ----------------
const traffic = new Traffic(net, scene, rng(5));
traffic.speedCap = (seg, s, dir, ahead) => bridgeLayer.capAt(seg, s, dir, ahead); // speed limits on bridges (game/bridges.ts)
traffic.junctions = junctions;
seenAt = (node) => traffic.seen.get(node);
onRoadsChanged = () => { traffic.invalidate(); placesDirty = true; lines.prune(); townRef?.networkChanged(); };
const stations = new Stations(net);
scene.add(stations.group);
traffic.stationAt = (id) => stations.spot(id);
traffic.onTrainStop = () => 30; // seconds at the platform
const lines = new Lines(traffic, stations);
const markers = new StopMarkers(net, traffic, stations);
scene.add(markers.group);
const dbSize = new THREE.Vector2();
let clock = 7 * 60; // minutes since midnight: a day passes in six minutes
let places: Places | null = null;
function getPlaces(): Places {
  if (places && !placesDirty) return places;
  placesDirty = false;
  const live = buildings.filter((b) => !b.dying).map((b) => b.lot);
  const home = (l: Lot) => l.kind === 'house' || l.kind === 'terrace' || l.kind === 'flats' || l.kind === 'tower';
  return (places = {
    homes: live.filter(home),
    jobs: live.filter((l) => l.kind === 'office' || l.kind === 'shop' || l.kind === 'industry' || l.kind === 'tower').concat(industries.works()),
    shops: live.filter((l) => l.kind === 'shop'),
    works: live.filter((l) => l.kind === 'industry').concat(industries.works()),
    weight: (l) => USE[l.kind].pop,
  });
}
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
// a count short enough for the stats line however big the town gets: 9,999 then 23.4k, 123k, 1.2m
// (rounded down, so it never claims more than there are)
const count = (n: number) => (n < 1e4 ? n.toLocaleString('en-GB') : n < 1e5 ? `${Math.floor(n / 100) / 10}k` : n < 1e6 ? `${Math.floor(n / 1e3)}k` : `${Math.floor(n / 1e5) / 10}m`);

let last = performance.now();
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
// the town's people: on the footways, at the stops, in the parks (see game/crowds.ts)
const people = new TownCrowds({ scene, net, junctions, traffic, regions: () => infill }, GAME_MIN_PER_S);
(window as unknown as { people: TownCrowds }).people = people;
// the railway: its trains drawn with the traffic, held by the level crossings' barriers (rail/, docs/rail.md)
const railDraw = new RailDraw(railway, traffic.fleet);
railway.useRoads(traffic);
traffic.onDraw = (dt) => railDraw.drawTrains(dt);
const railGame = new RailGame({
  net, shell, railway, draw: railDraw, people, scene, toScreen, focusOn, rebuildRoads, hint, purse,
  clear: (lots) => { for (const l of lots) { const b = buildings.find((x) => x.lot === l); if (b && !b.dying) demolish(b); } placesDirty = true; },
});
rebuildRoads();
shell.addTransportTab({ id: 'rail', label: 'Railway', icon: 'train', sub: 'Your rail lines and stations', render: (el) => railGame.renderTab(el) });
// the economy runs the town from here on (game/econ.ts): it decides what gets built, and how
// many wait at the stops
const town = new TownEconomy({
  net, traffic, lines, industrial: INDUSTRIAL, clock: () => clock, purse, rail: railGame.econ(),
  standing: () => buildings.filter((b) => !b.dying && !b.region && b.lot.id >= 0).map((b) => b.lot),
  free: () => queue,
  build: (l) => { queue = queue.filter((x) => x !== l); if (!net.lotFree(l)) return; spawnLot(l); refreshTrees(l); gameGround.built(l); },
  rebuild: (l, kind) => { const b = buildings.find((x) => x.lot === l && !x.dying); if (!b) return; l.kind = kind; regenerate(b); placesDirty = true; },
  clear: (l) => { const b = buildings.find((x) => x.lot === l && !x.dying); if (!b) return; net.lots = net.lots.filter((x) => x !== l); demolish(b); queue.push(l); },
});
townRef = town;
people.numbers = town.numbers();
let syncAt = 2;
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
  setGroundQuality(tier >= 3 ? 'low' : tier >= 1 ? 'medium' : 'high');
  people.setTier(tier); // fewer, simpler figures on the lower tiers, and no shadows from them
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
  // the town grows and shrinks with how well it's served: the economy decides (game/econ.ts)
  town.advance(gdt * GAME_MIN_PER_S);
  syncAt -= dt;
  if (syncAt <= 0) { syncAt = 2; town.sync(); if (shell.sheetKey === 'town') showTown(); }
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
  if (infillDue && !buildings.some((b) => b.solo)) { infillDue = false; refreshInfill(); }
  // merge at most a couple of changed chunks a frame
  let merged = 0;
  for (const c of chunks.values()) if (c.dirty && merged++ < 2) rebuildChunk(c);
  clock += gdt * GAME_MIN_PER_S;
  const hour = (clock / 60) % 24;
  gameWater.update(now / 1000, hour); // ripples and reeds, and the water's light from the clock
  // industrial sites: state once a game minute, moving parts at their own low rate, lamps at night;
  // catchment rings for the selected site, or for every site while a stop is placed
  siteT += gdt;
  industries.tick(clock);
  industries.frame(siteT, hour, cam);
  industries.showOverlay(selectedSite, mode === 'stop' ? (stopPreview ? industries.kerbPoint(stopPreview.seg, stopPreview.t, stopPreview.side) : null) : undefined, mode === 'stop' || siteRings);
  // At 1× traffic steps once a frame as it always has; faster, it's cut into steps of at most
  // 1/30 s so cars don't jump through each other or past their stop lines. Paused, it holds still.
  // the vehicles' levels of detail, culling and lamps (game/fleet.ts): how many device pixels a metre is, and the hour
  traffic.fleet.frame(cam, renderer.getDrawingBufferSize(dbSize).y / view.h, hour);
  if (speed > 0) {
    const n = speed > 1 ? Math.ceil(gdt * 30 - 1e-9) : 1, step = gdt / n;
    simNow = Math.max(simNow, now - gdt * 1000); // so it's caught up with real time by the last step
    for (let i = 0; i < n; i++) {
      simNow += step * 1000;
      traffic.generate(getPlaces(), hour, LEVELS[level][1], simNow);
      traffic.generate(getPlaces(), hour, LEVELS[level][1], simNow);
      railway.update(step);
      traffic.update(step, simNow);
    }
  } else traffic.redraw();
  for (const l of lamps) l.mesh.material = (l.pedx ? people.pelicanLight(l.pedx) : traffic.lightFor(l.node, l.seg, simNow)) === l.col ? LAMP_ON[l.col] : LAMP_OFF; // (a pelican's lights follow its people)
  railGame.frame(dt, cam, canvas.clientHeight);
  people.update(cam, canvas.clientHeight, gdt, dt, clock); // (they stand still while paused; their fades don't)
  markers.frame(cam, canvas.clientHeight);
  if (routeShown) routeShown.material.resolution.set(canvas.width, canvas.height);
  // (the readout only changes a few times a second, so it isn't rebuilt every frame)
  if (now - statsAt > 250) {
    statsAt = now;
    const pop = town.report?.residents ?? 0;
    $('#st-clock').textContent = hhmm(clock);
    // (the rush hours in the short form timetables use, so the line fits a phone)
    const rush = speed ? rushLabel(hour) : 'paused';
    $('#st-rush').textContent = ({ 'morning rush': 'AM peak', 'evening rush': 'PM peak' } as Record<string, string>)[rush] ?? rush;
    $('#st-rush').title = rush;
    $('#st-cars').textContent = count(traffic.live);
    $('#st-buses').textContent = String(traffic.buses);
    $('#st-trains').textContent = String(railway.trains.length);
    $('#st-pop').textContent = count(pop);
    shell.setMoney(money(purse.balance));
  }
  const t1 = performance.now();
  const q = TIERS[tier];
  if (q.every && ++frameNo % q.every === 0) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, cam);
  if (!loaded) { loaded = true; loading.done(); } // (the first frame is drawn: the loading screen goes)
  const t2 = performance.now();
  perf.simMs += t1 - t0; perf.drawMs += t2 - t1; perf.worstSim = Math.max(perf.worstSim, t1 - t0);
  if (now - perf.since > 2000) {
    if (perf.since) judgeFrames(now);
    if (perfOn) {
      const n = Math.max(1, perf.frames), r = renderer.info.render;
      $('#perf-t').textContent = `${Math.round(1000 / (perf.frameMs / n))} fps · frame ${(perf.frameMs / n).toFixed(1)} ms (worst ${perf.worst.toFixed(0)}) · sim ${(perf.simMs / n).toFixed(1)} (worst ${perf.worstSim.toFixed(0)}) · draw ${(perf.drawMs / n).toFixed(1)} ms · ${r.calls} calls · ${Math.round(r.triangles / 1000)}k tris · ${TIERS[tier].name}`;
      $('#perf-t').textContent += ` · ${people.readout()}`;
    }
    window.__perf = { ...perf, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, tier: TIERS[tier].name };
    Object.assign(perf, { frames: 0, frameMs: 0, simMs: 0, drawMs: 0, since: now, worst: 0, worstSim: 0 });
  }
  requestAnimationFrame(frame);
}
// the shaders compile before the first frame, not during it (where the screen would sit still)
await loading.stage('Getting ready to draw', 0.1);
await renderer.compileAsync(scene, cam).catch(() => {});
loading.finish();
let loaded = false;
requestAnimationFrame(frame);

(window as unknown as { proto: unknown }).proto = { renderer, setTier, perf: () => ({ tier: TIERS[tier].name }), buildRoad: (a: P, b: P, type = 'street') => buildRoad(net.snapStart(a, 4), net.snapStart(b, 4), undefined, { ...opts, type }), junctions, rebuild: () => rebuildRoads(), net, view, nav, buildings, infill: () => infill, refreshInfill: () => refreshInfill(), setMode, setKind, groundAt, toScreen, cam, THREE, pickBuilding, traffic, chunks, setClock: (m: number) => { clock = m; }, setSpeed, speed: () => speed, shell, startRoadTool, startStopTool, startLineTool, tapMap, endTool, lines, markers, focusOn, people, town, showTown, purse, stations, startStationTool, skip: (min: number) => { for (let m = 0; m < min; m += 60) { clock += 60; town.advance(60); } town.sync(); }, ground: gameGround, growAll: () => { gameGround.invalidate(); for (const l of queue.splice(0)) if (net.lotFree(l)) spawnLot(l, false); refreshTrees(); } };
Object.assign((window as unknown as { proto: object }).proto, { industries, showSite }); // (game/industry.ts)
// (motorway junctions: the ones built, and a blueprint from a to b in the road tool, for tests)
Object.assign((window as unknown as { proto: object }).proto, { interchanges, blueprint: (a: P, b: P) => { draft = { a: net.snapStart(a, 4), b: net.snapEnd(net.snapStart(a, 4), b, 4, true) }; draftChanged(); } });
Object.assign((window as unknown as { proto: object }).proto, { railway, railDraw, railGame }); // (rail/)
Object.assign((window as unknown as { proto: object }).proto, { bridges: bridgeLayer, showBridgeInfo, openBridgeEditor }); // (game/bridges.ts)
(window as unknown as { proto: Record<string, unknown> }).proto.water = gameWater; // (the lake, for tests)
Object.assign((window as unknown as { proto: object }).proto, { map: MAP, loading }); // (the map being played, and how long its loading took, stage by stage)

// the site's offline worker (public/sw.js): the game keeps working with no signal once it has been opened
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// ---- the start menu (src/app/main.ts) loads this module, then links it: the quality set on the
// menu, the Menu sheet's way back to it, and quality picked here remembered for next time ----
export interface MenuLink { quality: number | 'auto'; onQuality: (q: number | 'auto') => void; onMenu: () => void }
let menuLink: MenuLink | null = null;
export function linkMenu(link: MenuLink) {
  menuLink = link;
  if (link.quality !== 'auto') { tierAuto = false; setTier(link.quality); }
  shell.addMenuItem({ id: 'home', label: 'Main menu', icon: 'home', sub: 'Leave this town for the start menu', onClick: () => link.onMenu() });
}
