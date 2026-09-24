// Gallery of every industry type on a grid, seen from an isometric camera at phone size, with
// sliders driving the visual state, and a Terminals panel for buying loading facilities as
// add-ons (src/proto/terminals/panel.ts). Open /industries-demo.html on the Vite dev server.
// Query parameters (for screenshots): ?focus=<type>&variant=<id>&prod=&in=&out=&neglect=&year=&night=1&ring=1&zoom=
// and for terminals: &terminals=1&tset=road:lorry_depot:conveyor,rail:rail_terminal:rapid_loader&rail=0&water=1
// &level=&fill=&service=&crowded=1&reviews=<n>&idle=<days>&anchors=1&zoomk=<scale on the fitted zoom>
import * as THREE from 'three';
import { Ground } from '../ground';
import { INDUSTRY_IDS, INDUSTRY_TYPES, type IndustryId } from './catalogue';
import { IndustryFx, type FxHandle } from './fx';
import { buildIndustry, type IndustryModel } from './models';
import { offsetRing, overlayFor } from './overlay';
import { TerminalsPanel } from '../terminals/panel';
import { plotRect, toWorld } from './site';
import type { IndustryVisualState } from './state';
import { NavRig, SunFollow, mountNavControls } from '../kit/camera';

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

interface Site { id: IndustryId; variant: number; seed: number; model: IndustryModel; handle: FxHandle; hidden?: boolean }
const sites: Site[] = [];
let year = Number(q.get('year') ?? 1965);
const state: IndustryVisualState = {
  production: Number(q.get('prod') ?? 2), input: Number(q.get('in') ?? 0.6), output: Number(q.get('out') ?? 0.6),
  running: q.get('running') !== '0', recentlyDelivered: q.get('delivered') !== '0', year, neglect: Number(q.get('neglect') ?? 0),
};

// While the Terminals panel is open the focused site is built bare (no bays or sidings of its
// own) and the panel draws the terminals bought for it; `tvis` is the panel's visual state.
let panel: TerminalsPanel;
let tvis: Partial<IndustryVisualState> = {};
// ?anchors=1 marks the site's anchors in magenta, above everything, so screenshots show whether
// the terminals sit on them: a post at the gate, a pin per lorry bay, a line per siding or quay.
const showAnchors = q.get('anchors') === '1';
function anchorMarks(m: IndustryModel) {
  const pos: number[] = [], H = 0.8;
  const quad = (x0: number, z0: number, x1: number, z1: number, w: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = (-(z1 - z0) / L) * w, nz = ((x1 - x0) / L) * w;
    pos.push(x0 - nx, H, z0 - nz, x1 - nx, H, z1 - nz, x1 + nx, H, z1 + nz, x0 - nx, H, z0 - nz, x1 + nx, H, z1 + nz, x0 + nx, H, z0 + nz);
  };
  const pin = (x: number, z: number, r: number) => { quad(x - r, z, x + r, z, r); };
  const a = m.anchors;
  pin(a.gate.x, a.gate.z, 2.2);
  for (const l of a.lorry) pin(l.x, l.z, 1.4);
  for (const r of a.rail) quad(r.x0, r.z, r.x1, r.z, 0.5);
  for (const w of a.quay) quad(w.x0, w.z, w.x1, w.z, 0.7);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ff2bd6', depthTest: false, side: THREE.DoubleSide }));
  mesh.renderOrder = 10;
  return mesh;
}
const stateFor = (i: number) => ({ ...state, ...(panel?.on && i === focus ? tvis : {}) });
function place(i: number, id: IndustryId, variant: number, seed: number) {
  const t = INDUSTRY_TYPES[id], v = t.variants[variant];
  const { w, d } = v.size ?? t.size, c = cellOf(i);
  // sit each site's frontage on the road in front of its cell
  const model = buildIndustry(id, plotRect(c.x, c.z + 80 - d / 2, 0, w, d), { seed, variant: v.id, year, bare: !!panel?.on && i === focus });
  if (showAnchors) model.group.add(anchorMarks(model));
  scene.add(model.group);
  const handle = fx.add(model, stateFor(i));
  return { id, variant, seed, model, handle };
}
function rebuild(i: number) {
  const s = sites[i];
  scene.remove(s.model.group);
  (s.model.group.children[0] as THREE.Mesh).geometry.dispose();
  if (!s.hidden) fx.remove(s.handle);
  sites[i] = place(i, s.id, s.variant, s.seed);
  if (panel?.on && i === focus) panel.refresh();
}
// The Terminals view shows the selected site alone: its yards and quays can reach well into the
// neighbouring cells of the gallery.
function showOthers(show: boolean) {
  sites.forEach((s, i) => {
    const hide = !show && i !== focus;
    if (hide === !!s.hidden) return;
    s.model.group.visible = !hide;
    if (hide) fx.remove(s.handle); else s.handle = fx.add(s.model, stateFor(i));
    s.hidden = hide;
  });
}
INDUSTRY_IDS.forEach((id, i) => {
  const want = q.get('focus') === id ? q.get('variant') : null;
  const vi = Math.max(0, INDUSTRY_TYPES[id].variants.findIndex((v) => v.id === want));
  sites.push(place(i, id, want ? vi : i % INDUSTRY_TYPES[id].variants.length, 1));
});

// ---------------- camera: the shared kit (kit/camera.ts), the same gestures as the game ----------------
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
// the classic isometric: 45 degrees round, about 35 degrees down
const ISO = { az: Math.PI / 4, el: Math.atan2(1.15, Math.SQRT2) };
const nav = new NavRig(cam, canvas, {
  view: { x: 0, z: 0, h: 1100, ...ISO },
  limits: { hMin: 40, hMax: 2400, elMin: 0.35, elMax: 1.52 },
  distance: 1000,
  shadow: new SunFollow(sun, { dir: { x: -260, y: 420, z: 180 }, back: 525, far: 1500 }),
});
const view = nav.view;
mountNavControls(nav, { below: $('top') });
let focus = Math.max(0, INDUSTRY_IDS.indexOf((q.get('focus') ?? '') as IndustryId));
let gallery = !q.has('focus');
// Show the whole gallery, or the whole site in focus, in the space the title and the panel leave
// clear. zoom: the height of the view in metres (0 to fit).
function siteBox(list: typeof sites) {
  const min = { x: Infinity, y: 0, z: Infinity }, max = { x: -Infinity, y: 25, z: -Infinity };
  for (const s of list) for (const p of s.model.frame.outline) {
    const w = toWorld(s.model.frame, p[0], p[1]);
    min.x = Math.min(min.x, w.x); max.x = Math.max(max.x, w.x); min.z = Math.min(min.z, w.z); max.z = Math.max(max.z, w.z);
  }
  return { min, max };
}
function fitView(zoom = Number(q.get('zoom') ?? 0) || 0, ms = 0) {
  // with the Terminals panel open, the panel frames the site and what's built round it
  if (panel?.on && !gallery) { panel.refresh(true); return; }
  const ui = q.get('ui') !== '0';
  const pad = ui ? { top: $('top').getBoundingClientRect().bottom, bottom: $('panel').getBoundingClientRect().height, left: 8, right: 60 } : {};
  let to = nav.fitting(siteBox(gallery ? sites : [sites[focus]]), pad, ISO);
  // room to zoom out a little past the whole gallery
  if (gallery) nav.setLimits({ hMax: Math.max(2400, to.h * 1.5) });
  if (zoom) to = { ...to, h: zoom };
  if (ms > 0) nav.animateTo(to, ms); else nav.setView(to);
}
// the catchment ring is drawn a few pixels wide: redraw it when the zoom changes
let ringH = 0;
// (while it moves, only after a big change; once it comes to rest, exactly)
nav.onChange((v) => { if (showRing && Math.abs(v.h - ringH) > ringH * (nav.busy ? 0.15 : 0.001)) drawOverlay(); });

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
  if (panel?.on) { const r = panel.state().report.capacity.catchment; ov.ring = offsetRing(ov.site, r); ov.radius = r; } // terminals widen the reach
  for (const c of [...ringLine.children]) { ringLine.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  const shape = new THREE.Shape(ov.ring.map((p) => new THREE.Vector2(p.x, -p.z)));
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), fillMat);
  fill.position.y = 0.5;
  ringH = view.h;
  ringLine.add(fill, new THREE.Mesh(ribbon(ov.ring, Math.max(1.5, view.h / 180)), ringMat));
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
  for (const [i, s] of sites.entries()) if ((applyAll || i === focus) && !s.hidden) fx.setState(s.handle, stateFor(i));
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
toggle('zoomall', () => gallery, (v) => { gallery = v; fitView(0, 450); });
const go = (d: number) => {
  const was = focus;
  focus = (focus + d + sites.length) % sites.length; gallery = false; $('zoomall').classList.remove('on');
  if (panel.on) { tvis = {}; showOthers(true); rebuild(was); rebuild(focus); showOthers(false); }
  fitView(0, 450); applyState();
};
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

// ---------------- terminals ----------------
panel = new TerminalsPanel({
  scene, fx, year: () => year, el: (id) => $(id),
  site: () => { const s = sites[focus]; return { key: `${focus}:${s.variant}:${s.seed}`, id: s.id, model: s.model, handle: s.handle }; },
  rebuildSite: (bare) => { tvis = {}; showOthers(!bare); rebuild(focus); },
  setVisual: (patch) => { tvis = { ...tvis, ...patch }; fx.setState(sites[focus].handle, stateFor(focus)); drawOverlay(); },
  // the site and its terminals, in the space the title and the (tall) panel leave clear
  fit: (b) => {
    const ui = q.get('ui') !== '0';
    const pad = ui ? { top: $('top').getBoundingClientRect().bottom, bottom: $('panel').getBoundingClientRect().height, left: 8, right: 60 } : {};
    let to = nav.fitting({ min: { x: b.x0, y: 0, z: b.z0 }, max: { x: b.x1, y: 25, z: b.z1 } }, pad, ISO);
    const zoom = Number(q.get('zoom') ?? 0);
    to = { ...to, h: Math.max(120, zoom || to.h * Number(q.get('zoomk') ?? 1)) };
    nav.animateTo(to, 450);
  },
});
$('terms').addEventListener('click', () => {
  gallery = false; $('zoomall').classList.remove('on');
  panel.toggle(!panel.on);
  $('terms').classList.toggle('on', panel.on);
  if (!panel.on) { tvis = {}; fitView(); }
  applyState();
});
if (q.get('terminals') === '1') {
  gallery = false;
  panel.toggle(true);
  $('terms').classList.add('on');
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  panel.set({ rail: q.get('rail') !== '0', crowded: q.get('crowded') === '1', water: q.get('water') === '1' || INDUSTRY_TYPES[sites[focus].id].waterside === 'required', level: num('level'), fill: num('fill'), service: num('service') });
  if (q.get('tset')) panel.preset(q.get('tset')!);
  for (let i = 0; i < (num('reviews') ?? 0); i++) panel.step();
  if (num('idle')) for (let d = 0; d < num('idle')!; d += 30) panel.step(30, true);
}

// ---------------- loop ----------------
function resize() { renderer.setSize(innerWidth, innerHeight, false); nav.apply(); }
addEventListener('resize', resize);
fitView();
setNight();
resize();
applyState();
const t0 = performance.now();
let fixedTime: number | null = q.has('t') ? Number(q.get('t')) : null;
let last = performance.now();
function frame(now: number) {
  const t = fixedTime ?? (performance.now() - t0) / 1000;
  fx.update(t);
  nav.update(Math.min(0.1, (now - last) / 1000), now);
  last = now;
  renderer.render(scene, cam);
  placeIcons();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// for headless screenshots and poking about in the console
(window as unknown as { nav: NavRig }).nav = nav;
(window as unknown as { demo: unknown }).demo = {
  fx, nav, sites, state, scene, renderer, toWorld, terminals: panel,
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
    if (g !== undefined) { gallery = g; fitView(zoom ?? 0); }
    else if (zoom) nav.setView({ h: zoom });
    applyState();
  },
};
