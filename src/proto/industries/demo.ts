// Gallery of every industry type on a grid, seen from an isometric camera at phone size, with
// sliders driving the visual state. Open /industries-demo.html on the Vite dev server.
// Query parameters (for screenshots): ?focus=<type>&variant=<id>&prod=&in=&out=&neglect=&year=&night=1&ring=1&zoom=
import * as THREE from 'three';
import { Ground } from '../ground';
import { INDUSTRY_IDS, INDUSTRY_TYPES, type IndustryId } from './catalogue';
import { IndustryFx, type FxHandle } from './fx';
import { buildIndustry, type IndustryModel } from './models';
import { overlayFor } from './overlay';
import { plotRect, toWorld } from './site';
import type { IndustryVisualState } from './state';

const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('c');
if (q.get('ui') === '0') $('panel').style.display = 'none';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: q.has('shot') });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const DAY = new THREE.Color('#a9c7dd'), NIGHT = new THREE.Color('#0d1624');
scene.background = DAY.clone();
const hemi = new THREE.HemisphereLight('#dfeaf5', '#5d6b4a', 1.6);
const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
scene.add(hemi, sun, sun.target);

// ---------------- the gallery ----------------
const COLS = 4, CELL = 200;
const cellOf = (i: number) => ({ x: ((i % COLS) - (COLS - 1) / 2) * CELL, z: (Math.floor(i / COLS) - 1.5) * CELL });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new Ground().material);
ground.receiveShadow = true;
scene.add(ground);
const roadMat = new THREE.MeshLambertMaterial({ color: '#4c4f54' });
for (let r = 0; r < 4; r++) {
  const road = new THREE.Mesh(new THREE.PlaneGeometry(COLS * CELL + 400, 10).rotateX(-Math.PI / 2), roadMat);
  road.position.set(0, 0.01, cellOf(r * COLS).z + 88);
  road.receiveShadow = true;
  scene.add(road);
}

const fx = new IndustryFx();
scene.add(fx.group);

interface Site { id: IndustryId; variant: number; seed: number; model: IndustryModel; handle: FxHandle }
const sites: Site[] = [];
let year = Number(q.get('year') ?? 1965);
const state: IndustryVisualState = {
  production: Number(q.get('prod') ?? 2), input: Number(q.get('in') ?? 0.6), output: Number(q.get('out') ?? 0.6),
  running: q.get('running') !== '0', recentlyDelivered: q.get('delivered') !== '0', year, neglect: Number(q.get('neglect') ?? 0),
};

function place(i: number, id: IndustryId, variant: number, seed: number) {
  const t = INDUSTRY_TYPES[id], v = t.variants[variant];
  const { w, d } = v.size ?? t.size, c = cellOf(i);
  // sit each site's frontage on the road in front of its cell
  const model = buildIndustry(id, plotRect(c.x, c.z + 80 - d / 2, 0, w, d), { seed, variant: v.id, year });
  scene.add(model.group);
  const handle = fx.add(model, { ...state });
  return { id, variant, seed, model, handle };
}
function rebuild(i: number) {
  const s = sites[i];
  scene.remove(s.model.group);
  (s.model.group.children[0] as THREE.Mesh).geometry.dispose();
  fx.remove(s.handle);
  sites[i] = place(i, s.id, s.variant, s.seed);
}
INDUSTRY_IDS.forEach((id, i) => {
  const want = q.get('focus') === id ? q.get('variant') : null;
  const vi = Math.max(0, INDUSTRY_TYPES[id].variants.findIndex((v) => v.id === want));
  sites.push(place(i, id, want ? vi : i % INDUSTRY_TYPES[id].variants.length, 1));
});

// ---------------- camera: isometric, pinch and drag ----------------
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
const view = { x: 0, z: 0, zoom: Number(q.get('zoom') ?? 0) || 0 };
let focus = Math.max(0, INDUSTRY_IDS.indexOf((q.get('focus') ?? '') as IndustryId));
let gallery = !q.has('focus');
function fitView() {
  if (gallery) { view.x = 0; view.z = 0; view.zoom ||= 1100; }
  else { const m = sites[focus].model; view.x = m.frame.cx; view.z = m.frame.cz; view.zoom = Number(q.get('zoom') ?? 0) || Math.max(m.frame.w, m.frame.d) * 1.45; }
}
function placeCamera() {
  const a = innerWidth / innerHeight, h = view.zoom / 2;
  cam.left = -h * a; cam.right = h * a; cam.top = h; cam.bottom = -h;
  cam.updateProjectionMatrix();
  // the classic isometric: 45 degrees round, about 35 degrees down; nudged so the panel doesn't hide the subject
  const t = new THREE.Vector3(view.x, 0, view.z + (q.get('ui') === '0' ? 0 : view.zoom * 0.12));
  cam.position.copy(t).add(new THREE.Vector3(1, 1.15, 1).normalize().multiplyScalar(1000));
  cam.lookAt(t);
  sun.position.copy(t).add(new THREE.Vector3(-260, 420, 180));
  sun.target.position.copy(t);
  const sc = sun.shadow.camera as THREE.OrthographicCamera, r = Math.min(900, view.zoom * 0.9);
  sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 10; sc.far = 1500; sc.updateProjectionMatrix();
}
const ptrs = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
canvas.addEventListener('pointerup', (e) => { ptrs.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointercancel', (e) => { ptrs.delete(e.pointerId); pinch = 0; });
canvas.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) view.zoom = Math.max(40, Math.min(2400, view.zoom * (pinch / d)));
    pinch = d;
  } else {
    // screen drag to ground movement along the isometric axes
    const k = view.zoom / innerHeight, dx = (e.clientX - p.x) * k, dy = (e.clientY - p.y) * k * 1.4;
    view.x -= (dx - dy) * Math.SQRT1_2; view.z -= (-dx - dy) * Math.SQRT1_2;
  }
  p.x = e.clientX; p.y = e.clientY;
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom = Math.max(40, Math.min(2400, view.zoom * Math.exp(e.deltaY * 0.001))); }, { passive: false });

// ---------------- catchment ring and icons ----------------
let showRing = q.get('ring') === '1';
// the ring as a flat ribbon with a faint fill, since WebGL lines are one pixel wide on phones
const ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
const fillMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
const ringLine = new THREE.Group();
scene.add(ringLine);
function ribbon(pts: { x: number; z: number }[], w: number) {
  const pos: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = (-(b.z - a.z) / L) * w, nz = ((b.x - a.x) / L) * w;
    pos.push(a.x - nx, 0.6, a.z - nz, b.x - nx, 0.6, b.z - nz, b.x + nx, 0.6, b.z + nz, a.x - nx, 0.6, a.z - nz, b.x + nx, 0.6, b.z + nz, a.x + nx, 0.6, a.z + nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
const iconBox = $('icons');
function drawOverlay() {
  iconBox.innerHTML = '';
  ringLine.visible = showRing;
  if (!showRing) return;
  const ov = overlayFor(sites[focus].model, sites[focus].handle.state);
  for (const c of [...ringLine.children]) { ringLine.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const shape = new THREE.Shape(ov.ring.map((p) => new THREE.Vector2(p.x, -p.z)));
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), fillMat);
  fill.position.y = 0.5;
  ringLine.add(fill, new THREE.Mesh(ribbon(ov.ring, Math.max(1.5, view.zoom / 180)), ringMat));
  const col = ov.colour === '#2c2c2e' || ov.colour === '#1d1d1f' ? '#ffffff' : ov.colour;
  ringMat.color.set(col); fillMat.color.set(col);
  for (const ic of ov.icons) {
    const el = document.createElement('div');
    el.className = `icon ${ic.role}${ic.starved ? ' starved' : ''}`;
    el.style.borderColor = ic.colour;
    el.style.color = ic.colour;
    el.title = ic.label;
    el.innerHTML = `${ic.glyph}<i style="width:${Math.round(ic.level * 100)}%"></i>`;
    el.dataset.x = String(ic.at.x); el.dataset.z = String(ic.at.z);
    iconBox.appendChild(el);
  }
}
const _v = new THREE.Vector3();
function placeIcons() {
  for (const el of iconBox.children as HTMLCollectionOf<HTMLElement>) {
    _v.set(Number(el.dataset.x), 6, Number(el.dataset.z)).project(cam);
    el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

// ---------------- UI ----------------
let applyAll = true;
let night = q.get('night') === '1';
function applyState() {
  state.year = year;
  for (const [i, s] of sites.entries()) if (applyAll || i === focus) fx.setState(s.handle, { ...state });
  drawOverlay();
  info();
}
function info() {
  const s = sites[focus], t = INDUSTRY_TYPES[s.id];
  $('name').textContent = `${t.name} · ${s.model.variant.name}`;
  $('title').textContent = gallery ? 'Industries gallery' : `${t.name}: ${s.model.variant.name}`;
  const io = `${t.inputs.map((f) => `${f.amount} ${f.cargo}${f.optional ? '?' : ''}`).join(t.mix === 'any' ? ' or ' : ' + ') || 'the ground'} → ${t.outputs.map((f) => `${f.amount} ${f.cargo}`).join(' + ') || 'electricity'}`;
  $('detail').textContent = `${io} · serves ${t.serve.join('/')} · catchment ${t.catchment} m · ${s.model.detail}`;
  const st = fx.stats();
  $('stats').textContent = `${s.model.tris.toLocaleString('en-GB')} static triangles · fx ${st.drawCalls} draw calls for ${st.sites} sites · ${renderer.info.render.calls} calls/frame`;
}
function bindRange(id: string, key: 'production' | 'input' | 'output' | 'neglect', fmt = (v: number) => v.toFixed(2)) {
  const el = $<HTMLInputElement>(id), out = $<HTMLOutputElement>(`${id}v`);
  el.value = String(state[key]);
  out.textContent = fmt(Number(el.value));
  el.addEventListener('input', () => { state[key] = Number(el.value); out.textContent = fmt(Number(el.value)); applyState(); });
}
bindRange('prod', 'production', (v) => v.toFixed(1));
bindRange('inp', 'input');
bindRange('out', 'output');
bindRange('neg', 'neglect');
const yearEl = $<HTMLInputElement>('year');
yearEl.value = String(year); $('yearv').textContent = String(year);
yearEl.addEventListener('input', () => { year = Number(yearEl.value); $('yearv').textContent = String(year); applyState(); });
yearEl.addEventListener('change', () => { sites.forEach((_, i) => rebuild(i)); applyState(); }); // models pick era details at build time
const toggle = (id: string, get: () => boolean, set: (v: boolean) => void) => {
  const el = $(id);
  el.classList.toggle('on', get());
  el.addEventListener('click', () => { set(!get()); el.classList.toggle('on', get()); applyState(); });
};
toggle('running', () => state.running, (v) => { state.running = v; });
toggle('delivered', () => state.recentlyDelivered, (v) => { state.recentlyDelivered = v; });
toggle('all', () => applyAll, (v) => { applyAll = v; });
toggle('ring', () => showRing, (v) => { showRing = v; });
toggle('night', () => night, (v) => { night = v; setNight(); });
toggle('zoomall', () => gallery, (v) => { gallery = v; view.zoom = 0; fitView(); });
const go = (d: number) => { focus = (focus + d + sites.length) % sites.length; gallery = false; $('zoomall').classList.remove('on'); fitView(); applyState(); };
$('prev').addEventListener('click', () => go(-1));
$('next').addEventListener('click', () => go(1));
$('variant').addEventListener('click', () => { const s = sites[focus]; s.variant = (s.variant + 1) % INDUSTRY_TYPES[s.id].variants.length; rebuild(focus); applyState(); });
$('seed').addEventListener('click', () => { sites[focus].seed++; rebuild(focus); applyState(); });

function setNight() {
  scene.background = night ? NIGHT.clone() : DAY.clone();
  hemi.intensity = night ? 0.45 : 1.6;
  hemi.color.set(night ? '#6d84b0' : '#dfeaf5');
  sun.intensity = night ? 0.15 : 2.4;
  sun.color.set(night ? '#9fb4e0' : '#fff4e0');
  fx.setNight(night ? 1 : 0);
}

// ---------------- loop ----------------
function resize() { renderer.setSize(innerWidth, innerHeight, false); placeCamera(); }
addEventListener('resize', resize);
fitView();
setNight();
resize();
applyState();
const t0 = performance.now();
let fixedTime: number | null = q.has('t') ? Number(q.get('t')) : null;
function frame() {
  const t = fixedTime ?? (performance.now() - t0) / 1000;
  fx.update(t);
  placeCamera();
  renderer.render(scene, cam);
  placeIcons();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for headless screenshots and poking about in the console
(window as unknown as { demo: unknown }).demo = {
  fx, sites, state, scene, renderer, toWorld,
  setTime: (t: number | null) => { fixedTime = t; },
  focusOn: (id: IndustryId, variant?: string) => {
    focus = INDUSTRY_IDS.indexOf(id); gallery = false;
    if (variant) { const s = sites[focus]; s.variant = Math.max(0, INDUSTRY_TYPES[id].variants.findIndex((v) => v.id === variant)); rebuild(focus); }
    fitView(); applyState();
  },
  set: (patch: Partial<IndustryVisualState> & { night?: boolean; ring?: boolean; zoom?: number; gallery?: boolean }) => {
    const { night: n, ring, zoom, gallery: g, ...rest } = patch;
    Object.assign(state, rest);
    if (n !== undefined) { night = n; setNight(); }
    if (ring !== undefined) showRing = ring;
    if (g !== undefined) { gallery = g; view.zoom = 0; fitView(); }
    if (zoom) view.zoom = zoom;
    applyState();
  },
};
