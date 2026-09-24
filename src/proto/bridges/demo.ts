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
mountNavControls(nav, { below: $('#top') });
// what to frame: the bridge's box, and (with ?zoom=) the part worth a closer look
let fit = { cx: 0, cy: 0, cz: 0, box: new THREE.Box3(), focus: null as THREE.Vector3 | null };
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

// ---------- modes ----------

let root: THREE.Group | null = null;
let track: Track | null = null;
let detail: ((mpp: number) => void) | null = null;
let disposeScene: (() => void) | null = null;
const bufferSize = new THREE.Vector2();
let worldR = 1000; // radius of the scene, for the camera's depth range
// Keep the depth range to the scene: a phone's depth buffer may have only 16 bits, and every metre
// of range wasted costs precision between surfaces a few centimetres apart. The camera stands
// 6000 m back from the view's target (the rig's distance, below).
function depthAndDetail() {
  const v = nav.view, off = Math.hypot(fit.cx - v.x, fit.cy - (v.y ?? 0), fit.cz - v.z);
  cam.near = Math.max(1, 6000 - worldR - off); cam.far = 6000 + worldR + off;
  cam.updateProjectionMatrix();
  // real sleepers and rails only when they can be seen
  detail?.(metresPerPixel(cam, renderer.getDrawingBufferSize(bufferSize).y));
}
nav.onChange(depthAndDetail);
let lifter: ((t: number) => void) | null = null;
let liftGoal = 0, liftNow = 0;
let mode: 'gallery' | 'chooser' = params.get('mode') === 'chooser' ? 'chooser' : 'gallery';
let index = Math.max(0, BRIDGE_IDS.indexOf((params.get('type') ?? 'trestle') as BridgeId));
let choice: BridgeChoice | null = null;
let chooserScenario: Scenario | null = null;

const money = (v: number) => (v >= 1e6 ? `£${(v / 1e6).toFixed(2)}m` : v >= 1e4 ? `£${Math.round(v / 1000)}k` : `£${Math.round(v).toLocaleString('en-GB')}`);
const realMoney = (v: number) => (v >= 1e6 ? `£${(v / 1e6).toFixed(1)}m` : `£${Math.round(v / 1000)}k`);

function show(sc: Scenario, c: Crossing, lay: BridgeLayout) {
  if (root) { scene.remove(root); disposeScene?.(); }
  root = null;
  lifter = null;
  const bs = bridgeScene(sc, c, lay);
  disposeScene = bs.dispose;
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
  depthAndDetail();
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
// for the screenshot scripts: draw calls and triangles per frame
(window as unknown as { demo: object }).demo = { renderer, scene, cam, get track() { return track; } };
(window as unknown as { demoReady: boolean; nav: NavRig }).demoReady = true;
(window as unknown as { nav: NavRig }).nav = nav;
