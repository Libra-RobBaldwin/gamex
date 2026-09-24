// The game's side of the industries library (src/proto/industries, docs/industries.md): real
// industrial sites on the town's land, drawn as cheaply as its buildings, driven by a small feed
// the economy will take over, inspected through the HUD shell.
//
// - Sites are placed on plots fitted along roads and claimed in the land registry as
//   `industry:<n>`, so houses, trees and hedges keep off.
// - Each site's static mesh is baked into world space (the caller merges it into the town's
//   chunks with buildgen's shared vertex-coloured material, so it adds no draw calls). The moving
//   parts all live in one IndustryFx.
// - What a site shows (production, stockyards, lorries in the bays) comes from an IndustryFeed.
//   Until the economy is wired, `standInFeed` makes it up from the stops near each site.
// - A selected site, or every site while a stop is being placed, shows its catchment ring; the
//   selected one also shows what it takes in and sends out as icons over the map.
import * as THREE from 'three';
import { pointAt, pathLength, rectCorners, stopSpan, type Lot, type Network, type P } from '../roads';
import { polysTouch, pointInPoly } from '../land';
import { buildIndustry, CARGO, INDUSTRY_TYPES, IndustryFx, overlayFor, serves, variantFor, type CargoId, type CatchmentOverlay, type FxHandle, type IndustryId, type IndustryModel, type IndustryVisualState, type Plot, type ServeKind } from '../industries';
import { gameYear } from './era';
import type { Action, Shell } from '../ui/shell';
import flame from './icons/flame.svg?raw';
import wall from './icons/wall.svg?raw';
import pick from './icons/pick.svg?raw';
import stack from './icons/stack.svg?raw';
import trees from './icons/trees.svg?raw';
import wood from './icons/wood.svg?raw';
import wheat from './icons/wheat.svg?raw';
import paw from './icons/paw.svg?raw';
import pkg from './icons/package.svg?raw';
import barrel from './icons/barrel.svg?raw';
import gas from './icons/gas-station.svg?raw';
import flask from './icons/flask.svg?raw';
import bread from './icons/bread.svg?raw';
import beer from './icons/beer.svg?raw';

// ---------------- cargo icons (Tabler, MIT: ./icons/LICENSE) ----------------
const CARGO_SVG: Record<CargoId, string> = {
  coal: flame, stone: wall, iron_ore: pick, steel: stack, wood: trees, planks: wood, grain: wheat, livestock: paw,
  goods: pkg, oil: barrel, fuel: gas, chemicals: flask, food: bread, beer,
};
const cleanSvg = (s: string) => s.replace(/\s(width|height|class)="[^"]*"/g, '').replace(/<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*\/>/, '').replace(/\s+/g, ' ');
/** A cargo's icon as inline SVG for the HUD (sized by the text around it, like ui/icons). */
export const cargoIcon = (c: CargoId) => cleanSvg(CARGO_SVG[c]).replace('<svg', '<svg class="ic" aria-hidden="true" focusable="false"');

// ---------------- the feed: what each site shows ----------------
/** A stop (or later a station or terminal) that can serve sites. */
export interface ServePoint { x: number; z: number; kind: ServeKind; radius: number; label: string }
export interface FeedContext { year: number; hour: number; stops: ServePoint[] }
/** What the economy will provide. Until then `standInFeed` makes it up. */
export interface IndustryFeed { visual(site: IndustrySite, ctx: FeedContext): IndustryVisualState }

// The stand-in: a site with nothing calling ticks over at level 1 with its yard filling up; each
// stop in its catchment raises production a level (to 4), lorries stand in its bays and stock
// moves. Processors are short of inputs until they're served.
export const standInFeed: IndustryFeed = {
  visual(site, ctx) {
    const n = site.servedBy.length, served = n > 0, t = INDUSTRY_TYPES[site.type];
    return {
      production: served ? Math.min(4, 1 + n) : 1,
      input: t.inputs.length ? (served ? 0.7 : 0.2) : 0,
      output: served ? 0.4 : 0.85,
      running: true,
      recentlyDelivered: served,
      year: ctx.year,
    };
  },
};

// ---------------- sites ----------------
export interface IndustrySite {
  n: number;
  key: string; // its land claim, `industry:<n>`
  type: IndustryId;
  seed: number;
  plot: Plot;
  poly: P[]; // the plot, world metres (what's claimed)
  model: IndustryModel;
  overlay: CatchmentOverlay;
  state: IndustryVisualState;
  fx: FxHandle;
  lot: Lot; // a stand-in lot at the gate: traffic's lorries start and end there; it also keys the chunk
  parts: { m: THREE.Material; g: THREE.BufferGeometry }[]; // the static mesh, baked into world space
  servedBy: ServePoint[];
}

/** Where to look for a plot: near a point, on land `ok` accepts; `fast` allows fast roads (a farm gate on a 60 mph road), never motorways. */
export interface SiteWish { type: IndustryId; near: P; radius: number; variant?: string; ok: (p: P) => boolean; fast?: boolean }

/**
 * Extra actions on a site's info sheet. The terminals stream registers "Buy a terminal" here
 * (Build → Freight), so the sheet needs no change when terminals land.
 */
export const siteActions: ((site: IndustrySite) => Action | null)[] = [];

const SETBACK = 5; // metres from the kerb to the site fence
const BUS_STOP_RADIUS = 30; // how far a stop's own catchment reaches, added to the site's
const same = (a: IndustryVisualState, b: IndustryVisualState) =>
  a.running === b.running && a.recentlyDelivered === b.recentlyDelivered && a.year === b.year &&
  Math.abs(a.production - b.production) < 0.05 && Math.abs(a.input - b.input) < 0.03 && Math.abs(a.output - b.output) < 0.03 && (a.neglect ?? 0) === (b.neglect ?? 0);

// how dark it is (0 day .. 1 night) from the hour: dusk 18:30-20:00, dawn 5:30-7:00
export function nightAt(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h <= 18.5) return 0;
  if (h > 18.5 && h < 20) return (h - 18.5) / 1.5;
  if (h > 5.5 && h < 7) return (7 - h) / 1.5;
  return 1;
}

export class Industries {
  readonly sites: IndustrySite[] = [];
  readonly fx = new IndustryFx();
  feed: IndustryFeed = standInFeed;
  /** Called when a site appears or goes, so the caller can bake it into (or out of) its chunks. */
  onAdd: (s: IndustrySite) => void = () => {};
  onRemove: (s: IndustrySite) => void = () => {};
  private next = 1;
  private lastMinute = -1;
  private overlay = new THREE.Group();
  private ringMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  private fillMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  private overlayKey = '';
  private sprites = new Map<string, THREE.SpriteMaterial>();

  constructor(private net: Network, parent: THREE.Object3D, private mat: THREE.Material) {
    parent.add(this.fx.group);
    this.overlay.name = 'industry-overlay';
    this.overlay.renderOrder = 4;
    parent.add(this.overlay);
  }

  // ---------------- placing ----------------
  /** Find a plot for a site along the roads near a point: the biggest that fits, nearest the point. */
  findPlot(w: SiteWish): Plot | null {
    const t = INDUSTRY_TYPES[w.type], v = t.variants.find((x) => x.id === w.variant);
    const size = v?.size ?? t.size, min = t.minSize, net = this.net;
    for (let k = 1; k >= 0; k -= 0.1) {
      const W = Math.max(min.w, size.w * (0.7 + 0.3 * k)), D = Math.max(min.d, size.d * (0.7 + 0.3 * k));
      let best: Plot | null = null, bd = Infinity;
      for (const seg of net.segs.values()) {
        const def = net.def(seg);
        if (def.cls !== 'road' || !(def.frontage || (w.fast && def.family !== 'Motorway'))) continue;
        const path = net.path(seg), L = pathLength(path), half = net.half(seg);
        for (let s = W / 2 + 12; s < L - W / 2 - 12; s += 6) {
          const q = pointAt(path, s);
          if (Math.hypot(q.x - w.near.x, q.z - w.near.z) > w.radius) continue;
          for (const side of [1, -1] as const) {
            const nx = q.uz * side, nz = -q.ux * side, off = half + SETBACK + D / 2;
            const c = { x: q.x + nx * off, z: q.z + nz * off };
            const d = Math.hypot(c.x - w.near.x, c.z - w.near.z);
            if (d >= bd) continue;
            const rot = Math.atan2(nx, -nz);
            if (!this.fits(c, rot, W, D, w.ok)) continue;
            bd = d;
            best = { poly: rectCorners(c.x, c.z, rot, W, D), facing: { x: -nx, z: -nz } };
          }
        }
      }
      if (best) return best;
      if (W === min.w && D === min.d) break;
    }
    return null;
  }
  private fits(c: P, rot: number, W: number, D: number, ok: (p: P) => boolean) {
    const net = this.net, poly = rectCorners(c.x, c.z, rot, W, D);
    const probe = [...poly, c, ...poly.map((p, i) => ({ x: (p.x + poly[(i + 1) % 4].x) / 2, z: (p.z + poly[(i + 1) % 4].z) / 2 }))];
    if (probe.some((p) => !ok(p) || net.isWater(p) || Math.abs(p.x) > net.bound - 8 || Math.abs(p.z) > net.bound - 8)) return false;
    // clear of every claim (roads, junctions, other sites) by a couple of metres
    const pad = rectCorners(c.x, c.z, rot, W + 4, D + 4);
    if (!net.land.free(pad)) return false;
    // (the registry's test misses polygons whose edges lie on one line, which sites set back the
    // same distance from the same road do, so sites are also checked with separating axes)
    if (this.sites.some((s) => convexOverlap(pad, s.poly))) return false;
    // and of any plot already built on
    for (const l of net.lots) if (Math.hypot(l.x - c.x, l.z - c.z) < (W + D) / 2 + 40 && polysTouch(net.parcelRect(l), poly)) return false;
    return true;
  }

  /** Build a site on a plot and claim its land. Null if the land isn't free. */
  place(type: IndustryId, plot: Plot, seed: number, variant?: string): IndustrySite | null {
    if (!this.net.land.free(plot.poly)) return null;
    const year = gameYear(), t = INDUSTRY_TYPES[type];
    const v = t.variants.find((x) => x.id === variant) ?? variantFor(t, year, seed);
    const model = buildIndustry(type, plot, { seed, variant: v.id, year });
    const n = this.next++, key = `industry:${n}`;
    this.net.land.claim(key, 'industry', [plot.poly]);
    const f = model.frame;
    const lot: Lot = { id: -1000 - n, x: f.cx, z: f.cz, rot: f.rot, w: f.w, d: f.d, h: model.height, kind: 'industry', seg: -1, seed, row: 0, front: 0, back: 0, px: 0, pw: f.w };
    const ctx = this.context(12);
    const site: IndustrySite = { n, key, type, seed, plot, poly: plot.poly, model, overlay: overlayFor(model), state: { production: 1, input: 0, output: 0, running: true, recentlyDelivered: false, year }, fx: null!, lot, parts: this.bake(model), servedBy: [] };
    site.servedBy = this.servingStops(site, ctx.stops);
    site.state = this.feed.visual(site, ctx);
    site.overlay = overlayFor(model, site.state);
    site.fx = this.fx.add(model, site.state);
    this.sites.push(site);
    this.onAdd(site);
    this.overlayKey = '';
    return site;
  }
  /** Place what it can of a list of wishes. Returns the sites built. */
  placeAll(wishes: SiteWish[], seed = 1) {
    const out: IndustrySite[] = [];
    wishes.forEach((w, i) => {
      const plot = this.findPlot(w);
      const s = plot && this.place(w.type, plot, seed * 97 + i * 13 + 5, w.variant);
      if (s) out.push(s);
    });
    return out;
  }
  remove(s: IndustrySite) {
    const i = this.sites.indexOf(s);
    if (i < 0) return;
    this.sites.splice(i, 1);
    this.fx.remove(s.fx);
    this.net.land.release(s.key);
    this.onRemove(s);
    for (const p of s.parts) p.g.dispose();
    this.overlayKey = '';
  }
  // A road was built across a site: it's compulsorily purchased, like a house would be.
  evict() {
    for (const s of [...this.sites]) if (!this.net.land.free(s.poly, (c) => c.key === s.key || c.owner === 'industry')) this.remove(s);
  }

  // The static mesh in world space, with the attributes buildgen's geometry has (so it merges
  // into the same chunk mesh): position, normal, colour and an unused uv.
  private bake(m: IndustryModel) {
    m.group.updateMatrixWorld(true);
    const parts: IndustrySite['parts'] = [];
    for (const o of m.group.children) {
      const mesh = o as THREE.Mesh, g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
      parts.push({ m: this.mat, g });
      mesh.geometry.dispose();
    }
    return parts;
  }

  // ---------------- serving ----------------
  /** Every bus stop on the network, as a point on its kerb. */
  stops(): ServePoint[] {
    const out: ServePoint[] = [];
    for (const seg of this.net.segs.values()) {
      if (!seg.stops.length) continue;
      const path = this.net.path(seg), half = this.net.half(seg), label = this.net.def(seg).label;
      for (const st of seg.stops) {
        const [a, b] = stopSpan(st), q = pointAt(path, (a + b) / 2);
        out.push({ x: q.x + q.uz * st.side * half, z: q.z - q.ux * st.side * half, kind: 'lorry', radius: BUS_STOP_RADIUS, label: `${st.kind === 'kerb' ? 'Kerbside stop' : 'Bus lay-by'} on the ${label.toLowerCase()}` });
      }
    }
    return out;
  }
  servingStops(s: IndustrySite, stops: ServePoint[]) { return stops.filter((p) => serves(s.overlay, p, p.radius, p.kind)); }
  private context(hour: number): FeedContext { return { year: gameYear(), hour, stops: this.stops() }; }

  /** Once a game minute: ask the feed what each site should show, and redraw only what changed. */
  tick(clockMinutes: number) {
    const m = Math.floor(clockMinutes);
    if (m === this.lastMinute) return;
    this.lastMinute = m;
    this.refresh((clockMinutes / 60) % 24);
  }
  refresh(hour = 12) {
    const ctx = this.context(hour);
    for (const s of this.sites) {
      s.servedBy = this.servingStops(s, ctx.stops);
      const st = this.feed.visual(s, ctx);
      if (same(st, s.state)) continue;
      s.state = st;
      s.overlay = overlayFor(s.model, st);
      this.fx.setState(s.fx, st);
    }
  }
  /** Every frame: animate at the fx's own low rate, lamps from the clock. `t` is game seconds. */
  frame(t: number, hour: number) {
    this.fx.setNight(nightAt(hour));
    this.fx.update(t);
  }

  // ---------------- inspecting ----------------
  at(p: P) { return this.sites.find((s) => pointInPoly(p, s.poly)) ?? null; }
  /** A stand-in lot per site, for traffic: lorries come and go at the gate. */
  works() { return this.sites.map((s) => s.lot); }

  openInfo(s: IndustrySite, shell: Shell, extra: Action[] = [], onClose?: () => void) {
    const t = INDUSTRY_TYPES[s.type], st = s.state;
    const list = (fl: { cargo: CargoId; optional?: boolean }[]) => fl.map((f) => `${CARGO[f.cargo].name}${f.optional ? ' (helps)' : ''}`).join(', ');
    const facts: [string, string][] = [];
    if (t.inputs.length) facts.push(['Takes in', list(t.inputs)]);
    if (t.outputs.length) facts.push([t.role === 'hub' ? 'Sends on' : 'Sends out', list(t.outputs)]);
    facts.push(['Production', st.running ? `level ${Math.round(st.production * 10) / 10} of 4` : 'stopped']);
    facts.push(['Served by', s.servedBy.length ? s.servedBy.length === 1 ? s.servedBy[0].label : `${s.servedBy.length} stops` : 'nothing yet']);
    facts.push(['Catchment', `${t.catchment} m from the fence`]);
    const chip = (c: CargoId, role: 'in' | 'out', level: number) =>
      `<span style="display:inline-flex;align-items:center;gap:6px;margin:0 10px 6px 0;white-space:nowrap"><span style="display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:${CARGO[c].colour};color:#fff;box-shadow:0 0 0 2px ${role === 'in' ? '#b8964e' : '#5cb83a'}">${cargoIcon(c)}</span><small>${role === 'in' ? 'In' : 'Out'}: ${CARGO[c].name} · ${Math.round(level * 100)}%</small></span>`;
    const chips = s.overlay.icons.map((ic) => chip(ic.cargo, ic.role, ic.level)).join('');
    const note = s.servedBy.length ? `${s.servedBy.map((p) => p.label).join(' · ')}. Each stop within the ring raises production.` : `Nothing calls here yet. A stop within ${t.catchment} m of the fence (the ring) can serve it.`;
    const actions = [...extra, ...siteActions.map((f) => f(s)).filter((a): a is Action => !!a)];
    return shell.openInfo({
      key: `industry:${s.n}`, title: s.model.variant.name, sub: `${industryLabel(s.type)} · ${s.model.detail}`, icon: 'warehouse', tone: 'look',
      facts, meter: st.running ? st.production / 4 : 0, note, html: chips ? `<div style="display:flex;flex-wrap:wrap;margin-top:8px">${chips}</div>` : '', actions, onClose,
    });
  }

  // ---------------- overlays ----------------
  /**
   * Show catchments: `selected` gets its ring and cargo icons. While a stop is being placed
   * (`placing` is the stop's spot, or null before the first tap), every site shows its ring, lit
   * up if a stop there would serve it. Cheap to call every
   * frame: it only rebuilds when what it shows changes.
   */
  showOverlay(selected: IndustrySite | null, placing?: P | null) {
    const isPlacing = placing !== undefined;
    const serveAt = placing ? { x: placing.x, z: placing.z, kind: 'lorry' as const, radius: BUS_STOP_RADIUS, label: '' } : null;
    const shown = isPlacing ? this.sites : selected ? [selected] : [];
    const lit = (s: IndustrySite) => (serveAt ? serves(s.overlay, serveAt, serveAt.radius, 'lorry') : !isPlacing && s === selected);
    const icons = !isPlacing && selected ? selected : null;
    const key = `${shown.map((s) => `${s.n}${lit(s) ? '+' : ''}`).join(',')}|${icons ? `${icons.n}:${s2(icons)}` : ''}`;
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    for (const c of [...this.overlay.children]) { this.overlay.remove(c); if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose(); }
    if (!shown.length) return;
    const rp: number[] = [], rc: number[] = [], fp: number[] = [], fc: number[] = [];
    const col = new THREE.Color();
    for (const s of shown) {
      const ring = s.overlay.ring, n = ring.length;
      col.set(lit(s) ? '#5cb83a' : '#f4f1e6');
      const cx = ring.reduce((a, p) => a + p.x, 0) / n, cz = ring.reduce((a, p) => a + p.z, 0) / n;
      for (let i = 0; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        fp.push(cx, 0.3, cz, b.x, 0.3, b.z, a.x, 0.3, a.z);
        for (let k = 0; k < 3; k++) fc.push(col.r, col.g, col.b);
        // the ring as a ribbon 2.5 m wide (WebGL lines are a pixel wide on a phone)
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nx = -(b.z - a.z) / L * 1.25, nz = (b.x - a.x) / L * 1.25;
        const A0 = [a.x - nx, 0.35, a.z - nz], A1 = [a.x + nx, 0.35, a.z + nz], B0 = [b.x - nx, 0.35, b.z - nz], B1 = [b.x + nx, 0.35, b.z + nz];
        rp.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1);
        for (let k = 0; k < 6; k++) rc.push(col.r, col.g, col.b);
      }
    }
    const mesh = (p: number[], c: number[], m: THREE.Material, order: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      const o = new THREE.Mesh(g, m);
      o.renderOrder = order;
      return o;
    };
    this.overlay.add(mesh(fp, fc, this.fillMat, 4), mesh(rp, rc, this.ringMat, 5));
    if (icons) for (const ic of icons.overlay.icons) {
      const sp = new THREE.Sprite(this.spriteMat(ic.cargo, ic.role));
      sp.position.set(ic.at.x, 9, ic.at.z);
      sp.scale.set(9, 9, 1);
      sp.renderOrder = 6;
      this.overlay.add(sp);
    }
  }
  // a round badge in the cargo's colour with its icon, gold rimmed for what comes in, lime for what goes out
  private spriteMat(c: CargoId, role: 'in' | 'out') {
    const k = `${c}|${role}`;
    let m = this.sprites.get(k);
    if (m) return m;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const x = cv.getContext('2d')!;
    const draw = (img?: HTMLImageElement) => {
      x.clearRect(0, 0, 128, 128);
      x.beginPath(); x.arc(64, 64, 58, 0, Math.PI * 2); x.fillStyle = role === 'in' ? '#b8964e' : '#5cb83a'; x.fill();
      x.beginPath(); x.arc(64, 64, 48, 0, Math.PI * 2); x.fillStyle = CARGO[c].colour; x.fill();
      if (img) x.drawImage(img, 32, 32, 64, 64);
      tex.needsUpdate = true;
    };
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    draw();
    const light = new THREE.Color(CARGO[c].colour).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6;
    const img = new Image();
    img.onload = () => draw(img);
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(CARGO_SVG[c].replace('currentColor', light ? '#1b2a20' : '#ffffff').replace('width="24"', 'width="96"').replace('height="24"', 'height="96"'))}`;
    m = new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true });
    this.sprites.set(k, m);
    return m;
  }
}
// Do two convex polygons overlap (touching edges count)? Separating axes.
export function convexOverlap(A: P[], B: P[]) {
  for (const poly of [A, B]) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], nx = -(b.z - a.z), nz = b.x - a.x;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = p.x * nx + p.z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of B) { const d = p.x * nx + p.z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
const s2 = (s: IndustrySite) => s.overlay.icons.map((i) => Math.round(i.level * 10)).join('');

const LABEL: Record<IndustryId, string> = {
  coal_mine: 'Coal mine', quarry: 'Quarry', forest: 'Forest', farm: 'Farm', sawmill: 'Sawmill', steelworks: 'Steelworks', iron_ore_mine: 'Iron ore mine',
  power_station: 'Power station', refinery: 'Refinery', oil_well: 'Oil wells', brewery: 'Brewery', food_plant: 'Food plant', goods_factory: 'Factory', port: 'Docks', warehouse: 'Warehouse',
};
export const industryLabel = (id: IndustryId) => LABEL[id];

/**
 * A British market town now: on the estate a sawmill, a brewery, a food plant, a factory and a
 * distribution centre; out of town a farm, a forest and a quarry where there's room.
 */
export function townWishes(estate: (p: P) => boolean, outskirts: (p: P) => boolean): SiteWish[] {
  const E = (type: IndustryId, x: number, z: number, variant?: string): SiteWish => ({ type, near: { x, z }, radius: 220, ok: estate, variant });
  const O = (type: IndustryId, x: number, z: number, variant?: string): SiteWish => ({ type, near: { x, z }, radius: 300, ok: outskirts, variant, fast: true });
  return [
    E('warehouse', 40, -420, 'distribution'),
    E('goods_factory', 110, -340),
    E('sawmill', -120, -250),
    E('brewery', 100, -250),
    E('food_plant', -120, -330),
    O('farm', -390, 90),
    O('forest', -390, -120),
    O('quarry', 140, 400),
    // then whatever else the estate has room for: a cold store and an engineering works
    { ...E('warehouse', -150, -400, 'cold_store'), radius: 400 },
    { ...E('goods_factory', 0, -300, 'works'), radius: 400 },
  ];
}
