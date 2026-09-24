// The bridges demo: a gallery with each type over a river and a road, at a phone-sized viewport
// from the game's isometric camera, and a river crossing where the chooser picks the type (tap
// another to override it). Stand-alone: nothing here is used by the game.
//   /bridges-demo.html?type=masonry&view=top|iso|low&mode=chooser&open=1  (for screenshots)
import * as THREE from 'three';
import { BRIDGES, BRIDGE_IDS, type BridgeId } from './catalogue';
import { chooseBridge, override, type BridgeChoice } from './choose';
import type { Crossing } from './crossing';
import { frameAt } from './geometry';
import { metresPerPixel, type Track } from './track';
import type { BridgeLayout } from './layout';
import { bridgeScene, galleryCrossing } from './scene';
import { scenario, type Scenario } from './scenario';
import { RIVER_CROSSING } from './gallery';

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

// the game's camera: high isometric by default; top-down and a low angle for comparison
const VIEWS = { iso: { el: 0.6 }, top: { el: 1.5 }, low: { el: 0.32 } } as const;
const view = { az: Math.PI / 4, el: VIEWS.iso.el as number, zoom: 1, cx: 0, cz: 0, h: 300 };
let viewName: keyof typeof VIEWS = (params.get('view') as keyof typeof VIEWS) in VIEWS ? (params.get('view') as keyof typeof VIEWS) : 'iso';
view.el = VIEWS[viewName].el;
// what to frame: the bridge's box, and (when zoomed in) the part worth a closer look
let fit = { cx: 0, cy: 0, cz: 0, box: new THREE.Box3(), focus: null as THREE.Vector3 | null };

function place() {
  const w = canvas.clientWidth, h = canvas.clientHeight, aspect = w / h;
  const d = 6000, dir = new THREE.Vector3(Math.sin(view.az) * Math.cos(view.el), Math.sin(view.el), Math.cos(view.az) * Math.cos(view.el));
  cam.position.set(fit.cx + dir.x * d, fit.cy + dir.y * d, fit.cz + dir.z * d);
  cam.lookAt(fit.cx, fit.cy, fit.cz);
  cam.updateMatrixWorld();
  // fit the bridge's bounding box to the screen, whatever the angle
  const inv = cam.matrixWorldInverse, b = fit.box;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  // leave room for the panels top and bottom
  // keep the bridge clear of the panel at the top and the buttons (or the chooser's list) below
  const top = 0.17, bottom = mode === 'chooser' ? 0.46 : 0.09, free = 1 - top - bottom;
  const H = (Math.max((y1 - y0) / free, (x1 - x0) / aspect) * 1.1) / view.zoom;
  let ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
  if (fit.focus) { const f = fit.focus.clone().applyMatrix4(inv); ox += (f.x - ox) * Math.min(1, view.zoom - 1); oy += (f.y - oy) * Math.min(1, view.zoom - 1); }
  cam.left = ox - (H * aspect) / 2; cam.right = ox + (H * aspect) / 2;
  cam.bottom = oy - H * (bottom + free / 2); cam.top = cam.bottom + H;
  // keep the depth range to the scene: a phone's depth buffer may have only 16 bits, and every
  // metre of range wasted costs precision between surfaces a few centimetres apart
  cam.near = Math.max(1, d - worldR - Math.hypot(fit.cx, fit.cy, fit.cz)); cam.far = d + worldR + Math.hypot(fit.cx, fit.cy, fit.cz);
  cam.updateProjectionMatrix();
  // real sleepers and rails only when they can be seen
  detail?.(metresPerPixel(cam, renderer.getDrawingBufferSize(bufferSize).y));
  const r = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.75 + 50;
  sun.position.set(fit.cx - 160 * r / 100, fit.cy + 260 * r / 100, fit.cz + 110 * r / 100);
  sun.target.position.set(fit.cx, fit.cy, fit.cz);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = r * 8;
  sc.updateProjectionMatrix();
}

// ---------- modes ----------

let root: THREE.Group | null = null;
let track: Track | null = null;
let detail: ((mpp: number) => void) | null = null;
const bufferSize = new THREE.Vector2();
let worldR = 1000; // radius of the scene, for the camera's depth range
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
  root = null;
  lifter = null;
  const bs = bridgeScene(sc, c, lay);
  root = bs.group;
  lifter = bs.setOpen;
  detail = bs.setDetail;
  if (bs.bridge) fit.box = new THREE.Box3().setFromObject(bs.bridge);
  else {
    const [a, b] = [lay.s0, lay.s1], p = frameAt(c, (a + b) / 2);
    fit.box = new THREE.Box3(new THREE.Vector3(p.x - (b - a) / 2, -10, p.z - 30), new THREE.Vector3(p.x + (b - a) / 2, 20, p.z + 30));
  }
  track = bs.track;
  scene.add(root);
  const wb = new THREE.Box3().setFromObject(root);
  worldR = wb.getSize(new THREE.Vector3()).length() / 2 + 50;
  const ctr = fit.box.getCenter(new THREE.Vector3());
  // zooming in heads for the most telling part: a tower, pylon, lifting pier or the tallest pier
  const key = lay.supports.find((q) => q.kind === 'tower' || q.kind === 'pylon' || q.kind === 'leaf-pier' || q.kind === 'springing') ?? [...lay.supports].sort((p, q) => q.top - q.base - (p.top - p.base))[0];
  // ?at=start|end|<metres along the route> aims the zoom at an abutment or any point instead
  // (start-30 is 30 m back from the first abutment)
  const atM = /^(start|end)?([+-]?[\d.]+)?$/.exec(params.get('at') ?? '');
  const atS = atM && (atM[1] || atM[2]) ? (atM[1] === 'start' ? lay.s0 : atM[1] === 'end' ? lay.s1 : 0) + +(atM[2] ?? 0) : NaN;
  const fp = Number.isFinite(atS) ? frameAt(c, atS) : key ? frameAt(c, key.s) : null;
  fit = { ...fit, cx: ctr.x, cy: ctr.y * 0.5, cz: ctr.z, focus: fp ? new THREE.Vector3(fp.x, fp.y, fp.z) : null };
  liftNow = liftGoal = +(params.get('open') ?? 0);
  lifter?.(liftNow);
  $('#lift').style.display = lifter ? '' : 'none';
  const f = lay.def;
  const main = lay.spans.find((q) => q.role === 'main') ?? [...lay.spans].sort((p, q) => q.len - p.len)[0];
  $('#facts').innerHTML = lay.ok
    ? `${Math.round(lay.s1 - lay.s0)} m long · ${lay.spans.length} span${lay.spans.length > 1 ? 's' : ''}, longest ${Math.round(main.len)} m · ${money(lay.cost)} (${realMoney(lay.real.total)} real) · upkeep ${money(lay.maint)}/yr<br>${f.era.from}${f.era.to ? `–${f.era.to}` : '+'} · road ${f.roadTonnes} t · rail ${f.railAxle ? `${f.railAxle} t axles` : 'no'} · carrying ${c.road.label}, ${c.year}`
    : `<span style="color:var(--bad)">${lay.reason}</span>`;
  place();
}

function gallery() {
  const id = BRIDGE_IDS[index], def = BRIDGES[id];
  const { sc, c, lay, choice: o } = galleryCrossing(id);
  $('#title').textContent = `${def.icon} ${def.label}`;
  $('#notes').textContent = o.ok ? o.reasons.join(' · ') : '';
  $('#list').classList.remove('show');
  show(sc, c, lay);
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

$('#prev').onclick = () => { index = (index + BRIDGE_IDS.length - 1) % BRIDGE_IDS.length; view.zoom = 1; render(); };
$('#next').onclick = () => { index = (index + 1) % BRIDGE_IDS.length; view.zoom = 1; render(); };
$('#gallery').onclick = () => { mode = 'gallery'; render(); };
$('#chooser').onclick = () => { mode = 'chooser'; render(); };
$('#view').onclick = () => { viewName = viewName === 'iso' ? 'top' : viewName === 'top' ? 'low' : 'iso'; view.el = VIEWS[viewName].el; $('#view').textContent = viewName === 'iso' ? 'Top' : viewName === 'top' ? 'Low' : 'Iso'; place(); };
$('#lift').onclick = () => { liftGoal = liftGoal > 0.5 ? 0 : 1; };
$('#view').textContent = viewName === 'iso' ? 'Top' : viewName === 'top' ? 'Low' : 'Iso';

// drag to turn and tilt, wheel or pinch to zoom
const touches = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
canvas.addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId);
  if (!t) return;
  if (touches.size === 2) {
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    t.x = e.clientX; t.y = e.clientY;
    const d2 = Math.hypot(...(() => { const [p, q] = [...touches.values()]; return [p.x - q.x, p.y - q.y] as [number, number]; })());
    if (pinch) view.zoom = Math.max(0.5, Math.min(12, view.zoom * (d2 / d)));
    pinch = d2;
  } else {
    view.az -= (e.clientX - t.x) * 0.008;
    view.el = Math.max(0.2, Math.min(1.55, view.el + (e.clientY - t.y) * 0.005));
    t.x = e.clientX; t.y = e.clientY;
  }
  place();
});
const up = (e: PointerEvent) => { touches.delete(e.pointerId); pinch = 0; };
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { view.zoom = Math.max(0.5, Math.min(12, view.zoom * Math.exp(-e.deltaY * 0.001))); place(); }, { passive: true });

function resize() { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); place(); }
window.addEventListener('resize', resize);
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (lifter && Math.abs(liftGoal - liftNow) > 1e-3) { liftNow += Math.sign(liftGoal - liftNow) * Math.min(Math.abs(liftGoal - liftNow), dt / 3); lifter(liftNow); }
  renderer.render(scene, cam);
});
if (params.get('zoom')) view.zoom = +params.get('zoom')!;
render();
resize();
// for the screenshot scripts: draw calls and triangles per frame
(window as unknown as { demo: object }).demo = { renderer, scene, cam, get track() { return track; } };
(window as unknown as { demoReady: boolean }).demoReady = true;
