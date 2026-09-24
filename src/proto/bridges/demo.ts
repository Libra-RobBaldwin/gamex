// The bridges demo: a gallery with each type over a river and a road, at a phone-sized viewport
// from the game's isometric camera, and a river crossing where the chooser picks the type (tap
// another to override it). Stand-alone: nothing here is used by the game.
//   /bridges-demo.html?type=masonry&view=top|iso|low&mode=chooser&open=1  (for screenshots)
import * as THREE from 'three';
import { BRIDGES, BRIDGE_IDS, type BridgeId } from './catalogue';
import { chooseBridge, override, type BridgeChoice } from './choose';
import { deckAt, deckWidth, extents, groundAt, type Crossing } from './crossing';
import { buildBridge, bridgeObject, frameAt, sectionRect, sweepAlong, Geo } from './geometry';
import { layoutBridge, type BridgeLayout } from './layout';
import { bridgeMaterials, type Mat } from './materials';
import { scenario, type Scenario, type ScenarioOpts } from './scenario';
import { GALLERY, RIVER_CROSSING } from './gallery';
import { NavRig, mountNavControls } from '../kit/camera';

const $ = <T extends HTMLElement>(q: string) => document.querySelector(q) as T;
const params = new URLSearchParams(location.search);
const canvas = $<HTMLCanvasElement>('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
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
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000);

// the game's camera, from the shared kit (kit/camera.ts): high isometric by default; top-down and
// a low angle for comparison
const VIEWS = { iso: { el: 0.6 }, top: { el: 1.5 }, low: { el: 0.32 } } as const;
let viewName: keyof typeof VIEWS = (params.get('view') as keyof typeof VIEWS) in VIEWS ? (params.get('view') as keyof typeof VIEWS) : 'iso';
const nav = new NavRig(cam, canvas, {
  view: { x: 0, z: 0, h: 300, az: Math.PI / 4, el: VIEWS[viewName].el },
  limits: { hMin: 4, hMax: 4000, elMin: 0.2, elMax: 1.55 },
  distance: 6000,
});
mountNavControls(nav, { top: 150 });
// what to frame: the bridge's box, and (with ?zoom=) the part worth a closer look
let fit = { box: new THREE.Box3(), focus: null as THREE.Vector3 | null };
let zoom = 1;

// Frame the bridge's box on the screen, clear of the panel at the top and the buttons (or the
// chooser's list) below, at the current angle.
function frame(ms = 0) {
  const H = canvas.clientHeight;
  const pad = { top: H * 0.17, bottom: H * (mode === 'chooser' ? 0.46 : 0.09) };
  const b = fit.box, v = nav.fitting({ min: b.min, max: b.max }, pad);
  let to = v;
  // zoomed in: the key part in the middle of the clear space
  if (zoom !== 1 && fit.focus) {
    const cx = canvas.clientWidth / 2, cy = pad.top + (H - pad.top - pad.bottom) / 2;
    const w = { x: fit.focus.x, y: 0, z: fit.focus.z };
    to = { ...v, h: v.h / zoom };
    to = nav.framing(w, cx, cy, to);
  }
  if (ms > 0) nav.animateTo(to, ms); else nav.setView(to);
}
// the sun lights the whole scene from the game's direction
function light() {
  const b = fit.box, c = b.getCenter(new THREE.Vector3());
  const r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.75 + 50;
  sun.position.set(c.x - 160 * r / 100, c.y * 0.5 + 260 * r / 100, c.z + 110 * r / 100);
  sun.target.position.set(c.x, c.y * 0.5, c.z);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = r * 8;
  sc.updateProjectionMatrix();
}

// ---------- the world around a bridge ----------

const lit = (c: string, o: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide, flatShading: true, ...o });
const grass = lit('#79a653'), bank = lit('#8d8a62'), waterMat = lit('#3f86b8', { transparent: true, opacity: 0.88 });
// the cut face at the edge of the map: turf, topsoil, subsoil, then rock
const turf = lit('#5f8a3e'), topsoil = lit('#5b4632'), subsoil = lit('#9b7a4c'), rock = lit('#7c7872'), waterCut = lit('#2f6f9e', { transparent: true, opacity: 0.8 });
const asph = lit('#4a4e54', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), mark = lit('#eeeeea', { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const ballastMat = lit('#8f887c', { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), leafMat = lit('#3f7a3a'), trunkMat = lit('#5b4330');
const red = lit('#d23b2e'), green = lit('#2f9a4a'), hullMat = lit('#2f3a48'), cabinMat = lit('#e9e4d8');

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow = true) { const x = new THREE.Mesh(g, m); x.receiveShadow = true; x.castShadow = shadow; return x; }
function strip(pos: number[]) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; }

// The map ends in a cut face, like a slice through the ground: a lip of turf, dark topsoil, a
// band of subsoil following the surface, then rock down to a level base. Where the cut meets the
// river it shows the water as a column down to its bed. (A paper-thin edge gives the game away.)
function earthEdges(c: Crossing, sc: Scenario, sOf: (x: number) => number, x0: number, x1: number, W: number, step: number) {
  const g = new THREE.Group();
  let lowest = Infinity;
  for (let x = x0; x <= x1; x += step) lowest = Math.min(lowest, groundAt(c, sOf(x)));
  const base = lowest - 18;
  const bands: [THREE.Material, number, number][] = [[turf, 0, 0.35], [topsoil, 0.35, 1.4], [subsoil, 1.4, 5]]; // depths below the surface
  const pos = new Map<THREE.Material, number[]>();
  const push = (m: THREE.Material, ...v: number[]) => { let a = pos.get(m); if (!a) pos.set(m, (a = [])); a.push(...v); };
  // a vertical quad on the face z = zf between x and xn, from height ya0..ya1 (at x) to yb0..yb1 (at xn)
  const face = (m: THREE.Material, zf: number, x: number, xn: number, ya0: number, ya1: number, yb0: number, yb1: number) => {
    if (ya1 - ya0 < 1e-3 && yb1 - yb0 < 1e-3) return;
    push(m, x, ya0, zf, xn, yb0, zf, xn, yb1, zf, x, ya0, zf, xn, yb1, zf, x, ya1, zf);
  };
  const wet = (x: number, xn: number) => sc.water.find((w) => sOf(x) >= w.s0 - 1e-6 && sOf(xn) <= w.s1 + 1e-6);
  for (const zf of [-W, W]) {
    for (let x = x0; x < x1 - 1e-6; x += step) {
      const xn = Math.min(x1, x + step), ga = groundAt(c, sOf(x)), gb = groundAt(c, sOf(xn));
      for (const [m, d0, d1] of bands) face(m, zf, x, xn, Math.max(base, ga - d1), ga - d0, Math.max(base, gb - d1), gb - d0);
      face(rock, zf, x, xn, base, Math.max(base, ga - 5), base, Math.max(base, gb - 5));
      const w = wet(x, xn);
      if (w) face(waterCut, zf, x, xn, ga, w.level, gb, w.level);
    }
  }
  // the two ends of the map, across the route (the ground is level across it)
  for (const xe of [x0, x1]) {
    const ge = groundAt(c, sOf(xe));
    const across = (m: THREE.Material, y0: number, y1: number) => { if (y1 - y0 > 1e-3) push(m, xe, y0, -W, xe, y0, W, xe, y1, W, xe, y0, -W, xe, y1, W, xe, y1, -W); };
    for (const [m, d0, d1] of bands) across(m, Math.max(base, ge - d1), ge - d0);
    across(rock, base, Math.max(base, ge - 5));
  }
  for (const [m, a] of pos) g.add(mesh(strip(a), m, false));
  return g;
}

function world(sc: Scenario, c: Crossing, lay: BridgeLayout) {
  const out = new THREE.Group();
  const L = c.path.reduce((a, p, i) => (i ? a + Math.hypot(p.x - c.path[i - 1].x, p.z - c.path[i - 1].z) : 0), 0);
  const x0 = c.path[0].x, x1 = c.path[c.path.length - 1].x, k = L / (x1 - x0);
  const sOf = (x: number) => (x - x0) * k;
  const W = Math.max(160, (lay.s1 - lay.s0) * 0.6);
  // ground: height only changes along the route, so strips across it are enough
  const gp: number[] = [], bp: number[] = [];
  const step = Math.max(2, L / 500);
  for (let x = x0; x < x1 - 1e-6; x += step) {
    const xb = Math.min(x1, x + step), ya = groundAt(c, sOf(x)), yb = groundAt(c, sOf(xb));
    const wet = sc.water.some((w) => sOf(x) > w.s0 - 1 && sOf(xb) < w.s1 + 1);
    (wet ? bp : gp).push(x, ya, -W, xb, yb, -W, xb, yb, W, x, ya, -W, xb, yb, W, x, ya, W);
  }
  out.add(mesh(strip(gp), grass, false), mesh(strip(bp), bank, false));
  out.add(earthEdges(c, sc, sOf, x0, x1, W, step));
  for (const w of sc.water) {
    const xa = x0 + w.s0 / k, xb = x0 + w.s1 / k;
    out.add(mesh(strip([xa, w.level, -W, xb, w.level, -W, xb, w.level, W, xa, w.level, -W, xb, w.level, W, xa, w.level, W]), waterMat, false));
  }
  // channel buoys and a boat, to show where the piers can't go
  for (const o of c.obstacles) {
    if (o.kind !== 'water' || !o.channel) continue;
    const ch = o.channel, xa = x0 + ch.s0 / k, xb = x0 + ch.s1 / k, buoy = new THREE.CylinderGeometry(1.2, 1.2, 2.4, 8);
    for (let z = -W + 20; z < W; z += 45) {
      if (Math.abs(z) < 30) continue;
      const a = mesh(buoy, red); a.position.set(xa, o.level + 1, z); out.add(a);
      const b = mesh(buoy, green); b.position.set(xb, o.level + 1, z); out.add(b);
    }
    const bw = Math.min(10, (xb - xa) * 0.3), bl = bw * 3.2, boat = new THREE.Group();
    const hull = mesh(new THREE.BoxGeometry(bw, 2.2, bl), hullMat); hull.position.y = 1.1; boat.add(hull);
    const cab = mesh(new THREE.BoxGeometry(bw * 0.7, 2.6, bl * 0.25), cabinMat); cab.position.set(0, 3.4, -bl * 0.25); boat.add(cab);
    const mast = mesh(new THREE.BoxGeometry(0.4, ch.clear - 2, 0.4), cabinMat); mast.position.set(0, (ch.clear - 2) / 2 + 2, bl * 0.1); boat.add(mast);
    boat.position.set((xa + xb) / 2, o.level, W * 0.55);
    out.add(boat);
  }
  // roads and railways underneath, running across the route
  for (const u of sc.under) {
    const xa = x0 + u.s0 / k, xb = x0 + u.s1 / k, y = groundAt(c, (u.s0 + u.s1) / 2) + 0.05, xm = (xa + xb) / 2;
    // laid on the ground metre by metre, so it never sinks into a slope
    const rp: number[] = [];
    for (let x = xa; x < xb - 1e-6; x += 1) {
      const xn = Math.min(xb, x + 1), ya = groundAt(c, sOf(x)) + 0.06, yb = groundAt(c, sOf(xn)) + 0.06;
      rp.push(x, ya, -W, xn, yb, -W, xn, yb, W, x, ya, -W, xn, yb, W, x, ya, W);
    }
    out.add(mesh(strip(rp), u.kind === 'rail' ? ballastMat : asph, false));
    if (u.kind === 'road') for (let z = -W; z < W; z += 9) out.add(mesh(strip([xm - 0.1, y + 0.02, z, xm + 0.1, y + 0.02, z, xm + 0.1, y + 0.02, z + 3, xm - 0.1, y + 0.02, z, xm + 0.1, y + 0.02, z + 3, xm - 0.1, y + 0.02, z + 3]), mark, false));
    else for (const r of [-2.72, -1.28, 1.28, 2.72]) out.add(mesh(strip([xm + r - 0.07, y + 0.15, -W, xm + r + 0.07, y + 0.15, -W, xm + r + 0.07, y + 0.15, W, xm + r - 0.07, y + 0.15, -W, xm + r + 0.07, y + 0.15, W, xm + r - 0.07, y + 0.15, W]), hullMat, false));
  }
  // the route on embankments either side of the bridge
  const hw = deckWidth(c.road) / 2, eg = new Geo(), sides = new Geo();
  const y = (s: number) => deckAt(c, s);
  for (const [a, b] of [[0, lay.s0], [lay.s1, L]]) {
    if (b - a < 0.5) continue;
    sweepAlong(sides, c, a, b, (s) => { const h = Math.max(0, y(s) - groundAt(c, s)); return [[-hw, y(s) - 0.05], [hw, y(s) - 0.05], [hw + 0.3 + h * 1.8, groundAt(c, s) - 0.3], [-hw - 0.3 - h * 1.8, groundAt(c, s) - 0.3]]; }, 'deck', 3, false);
    sweepAlong(eg, c, a, b, (s) => sectionRect(-hw + 0.2, hw - 0.2, y(s) - 0.02, y(s)), c.road.cls === 'rail' ? 'ballast' : 'surface', 3, false);
    if (c.road.cls === 'road') for (let s = a + 2; s + 3 < b; s += 9) sweepAlong(eg, c, s, s + 3, (t) => sectionRect(-0.08, 0.08, y(t) + 0.01, y(t) + 0.02), 'line', 3, false);
    else for (const r of c.road.tracks === 2 ? [-2.72, -1.28, 1.28, 2.72] : [-0.72, 0.72]) sweepAlong(eg, c, a, b, (t) => sectionRect(r - 0.06, r + 0.06, y(t), y(t) + 0.15), 'rail', 3, false);
  }
  const mats = bridgeMaterials();
  for (const [m, g] of Object.entries(eg.geometries()) as [Mat, THREE.BufferGeometry][]) out.add(mesh(g, mats[m], false));
  for (const g of Object.values(sides.geometries())) out.add(mesh(g!, grass, false));
  trees(out, c, sc, sOf, x0, x1, W, hw);
  return out;
}

// Scattered trees, one draw call each for crowns and trunks, clear of the water, roads and route.
function trees(out: THREE.Group, c: Crossing, sc: Scenario, sOf: (x: number) => number, x0: number, x1: number, W: number, hw: number) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const spots: THREE.Vector3[] = [];
  for (let i = 0; i < 900 && spots.length < 260; i++) {
    const x = x0 + (x1 - x0) * rnd(), z = (rnd() * 2 - 1) * W, s = sOf(x);
    if (sc.water.some((w) => s > w.s0 - 8 && s < w.s1 + 8)) continue;
    if (sc.under.some((u) => s > u.s0 - 6 && s < u.s1 + 6)) continue;
    const p = frameAt(c, Math.max(0, Math.min(s, c.path.length ? s : 0)));
    if (Math.abs(z - p.z) < hw + 14 + Math.max(0, p.y - groundAt(c, s)) * 2) continue;
    spots.push(new THREE.Vector3(x, groundAt(c, s), z));
  }
  const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 9, 7), leafMat, spots.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.6, 3, 5), trunkMat, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach((p, i) => {
    const s = 0.7 + rnd() * 0.6;
    m4.makeScale(s, s, s).setPosition(p.x, p.y + 7 * s, p.z); crown.setMatrixAt(i, m4);
    m4.makeScale(s, s, s).setPosition(p.x, p.y + 1.5 * s, p.z); trunk.setMatrixAt(i, m4);
  });
  crown.castShadow = true; trunk.castShadow = true;
  out.add(crown, trunk);
}

// ---------- modes ----------

let root: THREE.Group | null = null;
let lifter: ((t: number) => void) | null = null;
let liftGoal = 0, liftNow = 0;
let mode: 'gallery' | 'chooser' = params.get('mode') === 'chooser' ? 'chooser' : 'gallery';
let index = Math.max(0, BRIDGE_IDS.indexOf((params.get('type') ?? 'trestle') as BridgeId));
let choice: BridgeChoice | null = null;
let chooserScenario: Scenario | null = null;

const money = (v: number) => (v >= 1e6 ? `£${(v / 1e6).toFixed(2)}m` : v >= 1e4 ? `£${Math.round(v / 1000)}k` : `£${Math.round(v).toLocaleString('en-GB')}`);
const realMoney = (v: number) => (v >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v / 1000)}k`);

function show(sc: Scenario, c: Crossing, lay: BridgeLayout) {
  if (root) { scene.remove(root); root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); }
  root = new THREE.Group();
  lifter = null;
  if (lay.ok) {
    const bo = bridgeObject(buildBridge(c, lay));
    root.add(bo.object);
    if (lay.def.opening) lifter = bo.setOpen;
    fit.box = new THREE.Box3().setFromObject(bo.object);
  } else {
    const [a, b] = [lay.s0, lay.s1], p = frameAt(c, (a + b) / 2);
    fit.box = new THREE.Box3(new THREE.Vector3(p.x - (b - a) / 2, -10, p.z - 30), new THREE.Vector3(p.x + (b - a) / 2, 20, p.z + 30));
  }
  root.add(world(sc, c, lay));
  scene.add(root);
  // zooming in heads for the most telling part: a tower, pylon, lifting pier or the tallest pier
  const key = lay.supports.find((q) => q.kind === 'tower' || q.kind === 'pylon' || q.kind === 'leaf-pier' || q.kind === 'springing') ?? [...lay.supports].sort((p, q) => q.top - q.base - (p.top - p.base))[0];
  const fp = key ? frameAt(c, key.s) : null;
  fit = { ...fit, focus: fp ? new THREE.Vector3(fp.x, fp.y, fp.z) : null };
  liftNow = liftGoal = +(params.get('open') ?? 0);
  lifter?.(liftNow);
  $('#lift').style.display = lifter ? '' : 'none';
  const f = lay.def;
  const main = lay.spans.find((q) => q.role === 'main') ?? [...lay.spans].sort((p, q) => q.len - p.len)[0];
  $('#facts').innerHTML = lay.ok
    ? `${Math.round(lay.s1 - lay.s0)} m long · ${lay.spans.length} span${lay.spans.length > 1 ? 's' : ''}, longest ${Math.round(main.len)} m · ${money(lay.cost)} (${realMoney(lay.real.total)} real) · upkeep ${money(lay.maint)}/yr<br>${f.era.from}${f.era.to ? `–${f.era.to}` : '+'} · road ${f.roadTonnes} t · rail ${f.railAxle ? `${f.railAxle} t axles` : 'no'} · carrying ${c.road.label}, ${c.year}`
    : `<span style="color:var(--bad)">${lay.reason}</span>`;
  light();
  frame();
}

function gallery() {
  const id = BRIDGE_IDS[index], def = BRIDGES[id];
  const opts: ScenarioOpts = GALLERY[id];
  // the gallery shows each type on its own crossing, raised or eased as the chooser would
  const ch = chooseBridge(scenario(opts).crossing);
  const o = ch.options.find((x) => x.def.id === id)!;
  const c = o.crossing ?? scenario(opts).crossing;
  const sc = scenario(opts); // the water and roads underneath don't move when the deck is raised
  const lay = o.layout ?? layoutBridge(c, def, ...(extents(c)[0] ?? [0, 0]));
  $('#title').textContent = `${def.icon} ${def.label}`;
  $('#notes').textContent = o.ok ? o.reasons.join(' · ') : '';
  $('#list').classList.remove('show');
  show({ ...sc, crossing: c }, c, lay);
}

function chooser() {
  chooserScenario ??= scenario(RIVER_CROSSING);
  choice ??= chooseBridge(chooserScenario.crossing);
  const pick = choice.options.find((o) => o.def.id === choice!.chosen);
  $('#title').textContent = `🌊 River crossing · chooser`;
  $('#notes').textContent = pick ? pick.reasons.join(' · ') : 'Nothing can be built here';
  const list = $('#list');
  list.classList.add('show');
  list.innerHTML = choice.options.map((o) => `<div class="opt ${o.ok ? '' : 'no'} ${o.def.id === choice!.chosen ? 'on' : ''}" data-id="${o.def.id}">
    <span>${o.def.icon}</span><span><b>${o.def.label}</b>${o.def.id === choice!.recommended ? '<span class="rec">★ recommended</span>' : ''}</span><span>${o.ok ? money(o.cost) : ''}</span>
    <span class="why">${o.ok ? `upkeep ${money(o.maint)}/yr · 30-year cost ${money(o.wholeLife)}${o.reasons.length ? ' · ' + o.reasons.join(' · ') : ''}` : o.reasons.join(' · ')}</span></div>`).join('');
  list.querySelectorAll<HTMLElement>('.opt').forEach((el) => el.addEventListener('click', () => { choice = override(choice!, el.dataset.id as BridgeId); chooser(); }));
  if (pick?.layout && pick.crossing) {
    show(chooserScenario, pick.crossing, pick.layout);
  }
}

function render() { if (mode === 'gallery') gallery(); else chooser(); $('#gallery').classList.toggle('on', mode === 'gallery'); $('#chooser').classList.toggle('on', mode === 'chooser'); $('#prev').style.visibility = $('#next').style.visibility = mode === 'gallery' ? '' : 'hidden'; }

$('#prev').onclick = () => { index = (index + BRIDGE_IDS.length - 1) % BRIDGE_IDS.length; zoom = 1; render(); };
$('#next').onclick = () => { index = (index + 1) % BRIDGE_IDS.length; zoom = 1; render(); };
$('#gallery').onclick = () => { mode = 'gallery'; render(); };
$('#chooser').onclick = () => { mode = 'chooser'; render(); };
$('#view').onclick = () => { viewName = viewName === 'iso' ? 'top' : viewName === 'top' ? 'low' : 'iso'; $('#view').textContent = viewName === 'iso' ? 'Top' : viewName === 'top' ? 'Low' : 'Iso'; nav.tiltTo(VIEWS[viewName].el); };
$('#lift').onclick = () => { liftGoal = liftGoal > 0.5 ? 0 : 1; };
$('#view').textContent = viewName === 'iso' ? 'Top' : viewName === 'top' ? 'Low' : 'Iso';

function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); nav.apply(); }
window.addEventListener('resize', resize);
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (lifter && Math.abs(liftGoal - liftNow) > 1e-3) { liftNow += Math.sign(liftGoal - liftNow) * Math.min(Math.abs(liftGoal - liftNow), dt / 3); lifter(liftNow); }
  nav.update(dt, now);
  renderer.render(scene, cam);
});
if (params.get('zoom')) zoom = +params.get('zoom')!;
render();
resize();
(window as unknown as { demoReady: boolean; nav: NavRig }).demoReady = true;
(window as unknown as { nav: NavRig }).nav = nav;
