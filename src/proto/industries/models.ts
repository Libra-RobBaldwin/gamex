// Procedural industrial sites. Each type has a recipe that lays out its buildings, stockyards,
// sidings, bays, roads and fence inside the rectangle fitted to its plot, with a few seeded
// variants each. The static parts come out as one vertex-coloured mesh (bakeable into the town's
// chunks); the moving parts come out as plain data for fx.ts to draw with instancing.
import * as THREE from 'three';
import { rng } from '../roads';
import { rect, shadeHex } from './kit';
import { INDUSTRY_TYPES, variantFor, type IndustryId, type Variant } from './catalogue';
import { fitPlot, PAL, Site, type Plot, type SiteFrame } from './site';
import type { Anchors, Dynamics } from './state';

export interface IndustryModel {
  type: IndustryId;
  variant: Variant;
  name: string;
  detail: string;
  group: THREE.Group; // static parts, placed in the world like a building (rotation.y = -rot)
  frame: SiteFrame;
  dyn: Dynamics; // moving parts, site-local
  anchors: Anchors; // gate, bays, sidings and quays, site-local
  tris: number;
  height: number;
}

export interface BuildOpts { seed: number; variant?: string; year?: number }

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const CONTAINERS = ['#b0463a', '#2f6f9e', '#d69a2d', '#3f7a4a', '#8a8f94', '#5a3f7a', '#c9c3b6'];

type Recipe = (s: Site, v: string) => void;

// ---------------- extraction ----------------
const coal_mine: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.rough);
  s.pad(0, 0, W - 4, D - 4, '#8a857b');
  s.k.mound(-W * 0.28, back + D * 0.22, W * 0.38, D * 0.34, v === 'victorian' ? 14 : 22, '#4a4642', 0.3); // spoil heap
  s.notes.push('spoil heap');
  s.siding(back + 5, -W / 2 + 3, W / 2 - 3, 2, 3);
  s.k.box(W * 0.28, 0, back + 7.2, 8, 9, 8, '#5a5e62'); // loading bunker over the siding
  s.k.box(W * 0.28, 9, back + 7.2, 10, 3, 10, '#6c7176');
  s.entrance(W * 0.32, [[W * 0.32, front - 14], [-W * 0.1, front - 14]]);
  s.bays(W * 0.32, front - 20, 3, 0);
  const hx = -W * 0.12, hz = -D * 0.02;
  if (v === 'victorian') {
    s.shed(hx, hz - 9, 12, 9, 9, PAL.brick, PAL.roof, 3.5); // engine house
    s.headframe(hx, hz, 16, '#6b4a33', 1, 0, true);
    s.chimney(hx + 8, hz - 12, 1.4, 26, PAL.darkBrick);
    s.shed(hx + 14, hz + 4, 16, 8, 5, PAL.brick, '#4d545b');
  } else if (v === 'steel_headframe') {
    for (const dx of [-7, 7]) { s.headframe(hx + dx, hz, 24, '#b33b2e', 2, 0); s.block(hx + dx, hz - 12, 8, 7, 8, PAL.brick, PAL.roof, 0); }
    s.block(hx + 22, hz + 8, 18, 10, 6, '#d8cbb0', PAL.roof, 2); s.notes.push('pithead baths');
    s.chimney(hx - 16, hz - 10, 1.3, 30, PAL.brick);
  } else {
    s.k.box(hx, 0, hz, 11, 38, 11, '#bdb8ad'); // concrete tower winder
    s.k.box(hx, 38, hz, 12, 2, 12, '#9a958b');
    s.dyn.rotors.push({ kind: 'wheel', x: hx - 2.5, y: 36, z: hz + 6, r: 2.6, rot: Math.PI / 2, speed: 1.4, colour: '#3b3f44' }, { kind: 'wheel', x: hx + 2.5, y: 36, z: hz + 6, r: 2.6, rot: Math.PI / 2, speed: -1.4, colour: '#3b3f44' });
    s.notes.push('tower winder');
    s.shed(hx + 20, hz - 2, 18, 14, 14, '#7f8a93', '#5b636b', 2.5); // coal preparation plant
    s.block(-W * 0.36, front - 18, 16, 9, 6.4, '#d8d2c4', PAL.roof, 2);
  }
  s.heap(W * 0.3, -D * 0.05, 18, 14, 7, 'coal', 'out');
  s.conveyor(hx + 5, hz, 12, W * 0.3 - 6, -D * 0.05, 9, PAL.soot);
  if (v !== 'tower_winder') s.office(-W * 0.36, front - 16, 14, 8, 2, PAL.brick);
  for (const [x, z] of [[-W * 0.45, front - 8], [W * 0.45, 0], [0, back + 12]]) s.floodlight(x, z);
  s.decay(22);
};

// Stepped benches cut into a hillside at the back of the site, working floor at the front.
function benches(s: Site, w: number, d: number, z: number, steps: number, rock: string, step = 6) {
  for (let i = 0; i < steps; i++) {
    const inset = i * 5, h = (i + 1) * step, col = shadeHex(rock, 1 - i * 0.07);
    const bd = Math.max(3, d * 0.35 - inset), sw = Math.max(3, w * 0.12 - inset * 0.6);
    s.k.box(0, 0, z - d / 2 + bd / 2, w, h, bd, col); // back face, each bench higher and further back
    const sd2 = d * (1 - i * 0.18); // higher benches stop short of the working floor
    for (const sd of [-1, 1]) s.k.box(sd * (w / 2 - sw / 2), 0, z - d / 2 + sd2 / 2, sw, h, sd2, col);
  }
}

const quarry: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  const rock = v === 'granite' ? '#9d9a94' : v === 'slate' ? '#5f6469' : '#d9d2bf';
  s.ground(PAL.rough);
  s.pad(0, -D * 0.05, W - 6, D * 0.6, shadeHex(rock, 0.85));
  benches(s, W - 4, D * 0.62, back + D * 0.31, v === 'slate' ? 4 : 3, rock, v === 'granite' ? 7 : 6);
  s.notes.push('stepped benches');
  if (v === 'slate') { s.k.mound(W * 0.36, front - 22, W * 0.2, 16, 9, '#4f5358', 0.2); s.notes.push('slate tips'); }
  // crusher: a tall shed on legs, a conveyor up to it and graded stone heaps under it
  const cx = -W * 0.18, cz = front - D * 0.36;
  for (const [a, b] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) s.k.box(cx + a, 0, cz + b, 0.8, 8, 0.8, '#6d7378');
  s.shed(cx, cz, 9, 9, 7, '#8a969e', '#5b636b', 1.5);
  s.k.box(cx, 0, cz, 9, 8, 9, '#8a969e');
  s.notes.push('crusher');
  s.conveyor(cx, cz - 5, 0.5, cx, back + D * 0.34, 12, rock); // from the face
  s.heap(cx + 16, cz + 2, 10, 9, 6, 'stone', 'out', false);
  s.heap(cx - 16, cz + 2, 10, 9, 6, 'stone', 'out', false);
  s.conveyor(cx + 4, cz, 9, cx + 13, cz + 2, 7, rock);
  s.entrance(W * 0.3, [[W * 0.3, front - 12], [cx, front - 12]]);
  s.bays(W * 0.3, front - 20, 2);
  if (v !== 'slate') s.siding(front - 34, 0, W / 2 - 3, 1, 2);
  s.jibCrane(W * 0.12, -D * 0.02, 14, 16, '#d4a02a', true); // a face shovel stands in for the dig
  s.block(W * 0.38, front - 8, 10, 6, 3, '#e3ddcf', PAL.roof, 1);
  s.floodlight(-W * 0.4, front - 10); s.floodlight(W * 0.1, front - 30);
  s.decay(18);
};

const forest: Recipe = (s, v) => {
  const { W, D, front } = s;
  s.ground(v === 'clearfell' ? '#8b8a5a' : '#5e8a45');
  const yardW = Math.min(W * 0.55, 60), yardD = Math.min(26, D * 0.32), yz = front - yardD / 2 - 2;
  s.pad(0, yz, yardW, yardD, PAL.gravel);
  const inYard = (x: number, z: number) => Math.abs(x) < yardW / 2 + 3 && z > yz - yardD / 2 - 3;
  const sp = v === 'broadleaf' ? 9 : 7;
  let trees = 0;
  for (let z = -D / 2 + 4; z < D / 2 - 3; z += sp)
    for (let x = -W / 2 + 4; x < W / 2 - 3; x += sp) {
      const jx = x + (v === 'conifer' ? 0.8 : 3) * (s.r() - 0.5), jz = z + (v === 'conifer' ? 0.8 : 3) * (s.r() - 0.5);
      if (inYard(jx, jz) || Math.abs(jx - W * 0.1) < 4) continue; // yard and the ride through the trees
      if (v === 'clearfell' && jx < W * 0.1) { if (s.r() < 0.35) s.tree(jx, jz, 0.8 + s.r() * 0.5, 'young'); else s.k.box(jx, 0, jz, 0.6, 0.4, 0.6, '#8a6a4a'); continue; }
      const kind = v === 'conifer' ? 'conifer' : v === 'broadleaf' ? (s.r() < 0.15 ? 'conifer' : 'broadleaf') : 'conifer';
      s.tree(jx, jz, (v === 'broadleaf' ? 1.6 : 1.8) + s.r() * 0.6, kind, v === 'broadleaf' ? s.pick(['#4f8a36', '#5b9440', '#3e7a35', '#6c9a3a']) : undefined);
      trees++;
    }
  s.notes.push(`${trees} trees`, v === 'clearfell' ? 'clear-felled coupe replanted' : v === 'conifer' ? 'Sitka spruce in rows' : 'oak and ash');
  s.road([[W * 0.1, yz], [W * 0.1, -D / 2 + 4]], 5, PAL.gravel);
  const n = v === 'clearfell' ? 10 : 7;
  s.logs(-yardW * 0.15, yz - 3, yardW * 0.5, 8, 'wood', 'out', n);
  s.jibCrane(yardW * 0.2, yz - 6, 7, 9, '#2f6f3a');
  s.shed(yardW * 0.38, yz - 4, 8, 6, 3.2, PAL.timber, '#4d545b', 1.2);
  s.entrance(-yardW * 0.3, [[-yardW * 0.3, yz + 5], [yardW * 0.2, yz + 5]], 6);
  s.bays(-yardW * 0.3 - 10, yz + 4, 1, 0);
  if (W > 90) s.siding(yz + yardD / 2 - 2, yardW * 0.05, yardW / 2 - 1, 1, 1);
  s.floodlight(yardW * 0.45, yz + 6, 8);
  s.decay(10);
};

const farm: Recipe = (s, v) => {
  const { W, D, front } = s;
  s.ground('#86a85c');
  const yardW = Math.min(46, W * 0.45), yardD = Math.min(32, D * 0.4), yx = W / 2 - yardW / 2 - 3, yz = front - yardD / 2 - 2;
  // fields in the rest of the plot, split by hedges
  const crops = v === 'livestock' ? ['#79a857', '#86b35e', '#6f9c4f'] : ['#d8bb5c', '#b98b52', '#9fbf5a', '#e1c56a', '#7b5a3a'];
  const cols = 3, rows = 2, fw = (W - 6) / cols, fd = (D - 6) / rows;
  let pasture: [number, number] | null = null;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) {
      const z = -D / 2 + 3 + fd * (j + 0.5);
      let x = -W / 2 + 3 + fw * (i + 0.5), cw = fw;
      if (x + fw / 2 > yx - yardW / 2 - 2 && z + fd / 2 > yz - yardD / 2) {
        // the farmyard takes the front corner: trim the field short of it, or leave it out
        const x1 = Math.min(x + fw / 2, yx - yardW / 2 - 3), x0 = x - fw / 2;
        if (x1 - x0 < 14) continue;
        x = (x0 + x1) / 2; cw = x1 - x0;
      }
      const grass = v === 'livestock' || (v === 'mixed' && (i + j) % 2 === 0);
      const c = grass ? s.pick(['#79a857', '#86b35e']) : s.pick(crops);
      s.pad(x, z, cw - 2.4, fd - 2.4, c, 0.04);
      if (!grass) for (let k = -cw / 2 + 3; k < cw / 2 - 2; k += 3) s.pad(x + k, z, 0.4, fd - 4, shadeHex(c, 0.88), 0.05);
      else pasture ??= [x, z];
      s.k.beam(x - cw / 2, z - fd / 2, x + cw / 2, z - fd / 2, 0, 1.4, 1.1, '#4a7535');
      s.k.beam(x - cw / 2, z - fd / 2, x - cw / 2, z + fd / 2, 0, 1.4, 1.1, '#4a7535');
      if (s.r() < 0.5) s.tree(x - cw / 2, z + (s.r() - 0.5) * fd, 1.6, 'broadleaf');
    }
  s.notes.push(v === 'arable' ? 'wheat, barley and plough' : v === 'livestock' ? 'pasture' : 'fields and pasture');
  s.pad(yx, yz, yardW, yardD, PAL.gravel);
  s.shed(yx - yardW * 0.3, yz - yardD * 0.15, 10, 8, 5.5, PAL.brick, '#8c3f33', 3.5); // farmhouse
  s.k.box(yx - yardW * 0.3 + 4, 5.5, yz - yardD * 0.15, 0.9, 4.5, 0.7, PAL.brick);
  s.bands(yx - yardW * 0.3, yz - yardD * 0.15, 10, 8, 0, 2, 2.75, PAL.glass);
  // Dutch barn: open sides, curved-looking roof on posts
  const bx = yx + yardW * 0.18, bz = yz - yardD * 0.25;
  for (let i = 0; i <= 3; i++) for (const sd of [-1, 1]) s.k.box(bx - 9 + i * 6, 0, bz + sd * 5, 0.4, 6, 0.4, '#5d6166');
  s.k.gable(bx, bz, 18, 10, 6, 2.4, '#8a4a36', '#8a4a36');
  s.pile({ kind: 'stack', cargo: 'grain', role: 'out', x: bx, z: bz, rot: 0, w: 16, d: 8, h: 1.2, slots: 6, layers: 4, colour: '#e0c45a' }); // straw bales
  s.notes.push('Dutch barn');
  const silos = v === 'livestock' ? 1 : v === 'mixed' ? 2 : 3;
  for (let i = 0; i < silos; i++) s.silo(yx + yardW * 0.42 - i * 7, yz + yardD * 0.2, 2.8, 13, 'grain', 'out', '#c7cacc');
  s.notes.push(`${silos} grain silo${silos > 1 ? 's' : ''}`);
  if (v !== 'arable') { s.shed(yx - yardW * 0.05, yz + yardD * 0.22, 16, 8, 4, '#b8bcbf', '#6e7f5a', 1.8); s.notes.push('cattle shed'); }
  if (pasture) { const [px, pz] = pasture; s.herd(px, pz, fw - 6, fd - 6, v === 'livestock' ? 18 : 10); }
  s.entrance(yx - yardW * 0.1, [[yx - yardW * 0.1, yz]], 5);
  s.bays(yx + yardW * 0.2, yz + yardD * 0.35 - 6, 1, 0);
  s.floodlight(yx, yz, 6);
  s.decay(8);
};

const iron_ore_mine: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.rough);
  s.pad(0, 0, W - 4, D - 4, '#a27a62');
  if (v === 'opencast') {
    benches(s, W - 4, D * 0.55, back + D * 0.28, 2, '#9a5a3e', 5);
    const dx = -W * 0.1, dz = -D * 0.05;
    s.k.box(dx, 0, dz, 9, 5, 9, '#c9b24a'); s.k.box(dx, 5, dz, 6, 4, 6, '#c9b24a');
    s.dyn.movers.push({ kind: 'jib', x: dx, y: 8, z: dz, rot: 0, len: 30, colour: '#c9b24a', phase: s.r() });
    s.notes.push('walking dragline', 'ironstone face');
  } else if (v === 'shaft') {
    s.headframe(-W * 0.15, -D * 0.05, 20, '#3f4a55', 2, 0);
    s.shed(-W * 0.15, -D * 0.05 - 12, 12, 8, 8, PAL.brick, PAL.roof, 3);
    s.k.mound(-W * 0.3, back + 14, W * 0.3, 18, 12, '#7a4a38', 0.3);
    s.chimney(-W * 0.3, -D * 0.1, 1.2, 22, PAL.brick);
  } else {
    for (let i = 0; i < 4; i++) {
      const x = -W * 0.3 + i * 11;
      s.k.lathe(x, -D * 0.08, [[4.5, 0], [4.2, 6], [3, 10], [2, 12]], 10, '#9a5a44', '#3b2a22');
      s.dyn.emitters.push({ kind: 'smoke', x, y: 12, z: -D * 0.08, r: 1.6, rise: 12, puffs: 4 });
    }
    s.k.beam(-W * 0.36, -D * 0.08, -W * 0.3 + 38, -D * 0.08, 10, 1, 3, '#6a6f74', 10); s.notes.push('calcining kilns');
  }
  s.heap(W * 0.28, -D * 0.02, 18, 12, 7, 'iron_ore', 'out');
  s.conveyor(-W * 0.02, -D * 0.02, 1, W * 0.28 - 7, -D * 0.02, 8, '#8e4a35');
  s.siding(back + 5, -W / 2 + 3, W / 2 - 3, 1, 3);
  s.entrance(W * 0.3, [[W * 0.3, front - 12], [0, front - 12]]);
  s.bays(W * 0.3, front - 20, 2);
  s.office(-W * 0.35, front - 10, 12, 7, 1, PAL.brick);
  s.floodlight(-W * 0.4, 0); s.floodlight(W * 0.42, front - 26);
  s.decay(20);
};

const oil_well: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(v === 'screened' ? '#6f9a4e' : PAL.rough);
  const n = v === 'nodding_donkeys' ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const x = -W * 0.32 + (i % 2) * W * 0.3, z = back + D * (0.22 + Math.floor(i / 2) * 0.28);
    s.pad(x, z, 14, 10, PAL.gravel);
    s.k.box(x, 0, z, 7, 0.6, 2.2, '#6c6f72'); s.k.box(x - 0.5, 0.6, z, 0.9, 4.5, 1, '#2c4f7a'); // base and samson post
    s.dyn.rotors.push({ kind: 'pumpjack', x: x - 0.5, y: 5, z, r: 4, rot: 0, speed: 0.9 + s.r() * 0.3, colour: '#2c4f7a' });
    s.road([[x + 7, z], [W * 0.12, z]], 4, PAL.gravel);
  }
  s.notes.push(`${n} nodding donkey${n > 1 ? 's' : ''}`);
  if (v === 'wellsite') {
    const x = W * 0.3, z = back + D * 0.3;
    s.pad(x, z, 22, 18, PAL.gravel);
    for (const [a, b] of [[-2.5, -2.5], [2.5, -2.5], [2.5, 2.5], [-2.5, 2.5]]) s.k.beam(x + a, z + b, x + a * 0.25, z + b * 0.25, 0, 0.5, 0.5, '#c8452f', 32);
    for (let y = 6; y < 30; y += 6) s.k.box(x, y, z, 5 * (1 - y / 40), 0.3, 5 * (1 - y / 40), '#c8452f');
    s.shed(x - 8, z + 6, 8, 5, 3, '#d8d6cf', '#8a969e', 0.8);
    s.notes.push('drilling rig');
  }
  if (v === 'screened') { for (let x = -W / 2 + 4; x < W / 2 - 3; x += 5) s.tree(x, front - 3, 1.4 + s.r() * 0.5, s.r() < 0.5 ? 'broadleaf' : 'conifer'); s.k.mound(0, back + 2.5, W - 6, 4, 2.5, '#6a8f4a', 0.9); s.notes.push('tree screen and bund'); }
  const gx = W * 0.12, gz = front - D * 0.32;
  s.pad(gx, gz, 30, 20, PAL.concrete);
  s.tank(gx - 7, gz - 3, 4.5, 7, 'oil', 'out', '#e1ded6');
  s.tank(gx + 4, gz - 3, 4.5, 7, 'oil', 'out', '#e1ded6');
  s.k.box(gx - 1, 0, gz + 6, 18, 0.6, 3, '#9aa0a4'); // pipe rack and separators
  s.k.prism(gx + 8, gz + 5, 0.4, 6, 0, 10, '#6c6f72');
  s.dyn.emitters.push({ kind: 'flame', x: gx + 8, y: 10.2, z: gz + 5, r: 0.8, rise: 3, puffs: 3 });
  s.notes.push('gathering station', 'flare');
  s.entrance(W * 0.3, [[W * 0.3, front - 10], [W * 0.12, front - 10], [W * 0.12, back + 6]], 6);
  s.bays(W * 0.36, front - 18, 2);
  if (v !== 'screened') s.siding(front - 36, W * 0.2, W / 2 - 3, 1, 2);
  s.floodlight(gx - 14, gz + 9, 8);
  s.decay(14);
};

// ---------------- processing ----------------
const sawmill: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.rough);
  s.pad(0, 0, W - 4, D - 4, PAL.gravel);
  const wall = v === 'riverside' ? PAL.timber : v === 'estate' ? '#7a5a3c' : '#8a969e';
  const mw = Math.min(W * 0.45, 36), mz = -D * 0.05;
  if (v === 'estate') {
    for (let i = 0; i <= 4; i++) for (const sd of [-1, 1]) s.k.box(-mw / 2 + (i * mw) / 4, 0, mz + sd * 5, 0.35, 4.5, 0.35, '#5a4330');
    s.k.gable(0, mz, mw, 10, 4.5, 2.4, '#4d545b', wall);
    s.notes.push('open-sided saw shed');
  } else {
    s.shed(0, mz, mw, 14, v === 'modern' ? 9 : 7, wall, v === 'modern' ? '#5b636b' : '#4d545b', 2.5);
    s.doors(0, mz + 7, 3, mw * 0.8, 4.5);
  }
  if (v === 'riverside') { s.chimney(mw / 2 + 4, mz - 5, 1, 16, PAL.brick, 'smoke'); s.notes.push('boiler chimney'); }
  if (v === 'modern') { for (let i = 0; i < 3; i++) s.block(mw / 2 + 7, mz - 8 + i * 7, 9, 6, 6, '#c9cdd0', PAL.roof); s.notes.push('drying kilns'); s.chimney(mw / 2 + 14, mz + 10, 0.8, 14, '#9aa0a4', 'steam'); }
  s.logs(-W * 0.32, back + D * 0.24, W * 0.3, 14, 'wood', 'in', v === 'estate' ? 5 : 8);
  s.jibCrane(-W * 0.12, back + D * 0.2, 9, 12, '#d4a02a');
  s.conveyor(-W * 0.2, mz, 0.4, -mw / 2 + 2, mz, 3, '#8a5a32');
  s.stack(W * 0.32, front - D * 0.3, W * 0.26, 10, 'planks', 'out', 6, 3, 1.1);
  if (v !== 'estate') s.siding(back + 5, -W / 2 + 3, W / 2 - 3, 1, 2);
  s.entrance(W * 0.08, [[W * 0.08, front - 12], [W * 0.32, front - 12]]);
  s.bays(-W * 0.25, front - 10, 2);
  s.office(W * 0.38, front - 7, 10, 6, 1, v === 'modern' ? '#d8d2c4' : PAL.brick);
  s.floodlight(-W * 0.45, 0, 10); s.floodlight(W * 0.45, back + 10, 10);
  s.decay(16);
};

function blastFurnace(s: Site, x: number, z: number, h: number) {
  s.k.prism(x, z, 5, 10, 0, h * 0.2, '#6d6660', 5.5);
  s.k.prism(x, z, 5.5, 10, h * 0.2, h * 0.5, '#5a5550', 3.4);
  s.k.prism(x, z, 3.4, 10, h * 0.7, h * 0.3, '#4c4844', 2.2);
  for (let i = 0; i < 3; i++) { s.k.prism(x - 9, z - 6 + i * 6, 2.6, 10, 0, h * 0.62, '#8b8680', 2.6); s.k.prism(x - 9, z - 6 + i * 6, 2.6, 10, h * 0.62, 2, '#8b8680', 0); } // hot blast stoves
  s.k.beam(x, z, x + 10, z + 4, h, 1.4, 1.4, '#5a5550', h * 0.5); // downcomer
  s.k.box(x + 10, 0, z + 4, 4, h * 0.5, 4, '#5a5550');
  s.dyn.emitters.push({ kind: 'smoke', x, y: h + 0.5, z, r: 2, rise: 18, puffs: 5 });
  s.dyn.lamps.push({ x: x + 5.6, y: 3, z, glow: 12 }); // the cast house glows at night
}

const steelworks: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.rough);
  s.pad(0, 0, W - 4, D - 4, '#8f8a82');
  s.siding(back + 5, -W / 2 + 3, W / 2 - 3, 3, 3);
  // raw materials along the sidings: ore, coal and limestone
  const hz = back + 22, hw = Math.min(26, W * 0.18);
  s.heap(-W * 0.34, hz, hw, 12, 7, 'iron_ore', 'in');
  s.heap(-W * 0.34 + hw + 6, hz, hw, 12, 7, 'coal', 'in');
  s.heap(-W * 0.34 + (hw + 6) * 2, hz, hw * 0.6, 10, 5, 'stone', 'in');
  const fx = -W * 0.1, fz = -D * 0.02;
  if (v === 'bessemer') {
    for (let i = 0; i < 2; i++) s.shed(fx + i * 22 - 11, fz, 20, 18, 12, PAL.brick, PAL.roof, 4);
    for (let i = 0; i < 4; i++) s.chimney(fx - 20 + i * 12, fz - 13, 1.5, 34, PAL.darkBrick, 'smoke');
    blastFurnace(s, fx + 26, fz - 4, 26);
    s.notes.push('Bessemer converter sheds', 'blast furnace');
  } else if (v === 'integrated') {
    blastFurnace(s, fx, fz, 38);
    blastFurnace(s, fx + 22, fz, 34);
    s.k.box(fx - 26, 0, fz + 2, 12, 9, 30, '#6a5a50'); s.chimney(fx - 26, fz - 16, 2, 50, '#8b8680', 'smoke'); // coke ovens
    s.notes.push('two blast furnaces', 'coke ovens');
  } else {
    s.shed(fx, fz, 44, 24, 22, '#5f7f8f', '#4d545b', 3);
    s.k.box(fx + 10, 25, fz, 8, 6, 8, '#6c7176');
    s.chimney(fx - 24, fz - 8, 2.2, 45, '#b8bcbf', 'smoke', 10);
    s.notes.push('electric arc furnace hall');
  }
  // rolling mill down the front, steel stacked at the end
  s.shed(0, front - 24, W * 0.6, 14, 11, v === 'bessemer' ? PAL.brick : '#8a969e', PAL.roof, 2.5);
  s.stack(W * 0.38, front - 24, 20, 12, 'steel', 'out', 8, 3, 1.3);
  s.conveyor(-W * 0.34 + hw / 2, hz + 7, 1, fx - 6, fz - 6, 16, '#8e4a35');
  s.entrance(W * 0.4, [[W * 0.4, front - 10], [-W * 0.2, front - 10]]);
  s.bays(W * 0.12, front - 10, 3);
  s.office(-W * 0.38, front - 8, 16, 8, 3, PAL.brick);
  for (const [x, z] of [[-W * 0.45, 0], [W * 0.45, 0], [0, back + 12], [W * 0.3, front - 36]]) s.floodlight(x, z, 14);
  s.decay(30);
};

const power_station: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.grass);
  s.pad(0, 0, W - 4, D - 4, '#a9a498');
  s.siding(back + 5, -W / 2 + 3, W / 2 - 3, v === 'compact' ? 1 : 2, 3);
  s.heap(-W * 0.3, back + 22, Math.min(40, W * 0.32), 16, 8, 'coal', 'in', false);
  s.notes.push('coal stockyard');
  const bx = -W * 0.02, bz = -D * 0.02;
  if (v === 'classic') {
    const bw = Math.min(56, W * 0.42);
    s.block(bx, bz, bw, 30, 30, PAL.brick, '#4d545b');
    s.k.box(bx, 0, bz + 18, bw * 0.9, 18, 6, PAL.darkBrick);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.chimney(bx + a * (bw / 2 - 3), bz + b * 12, 2.4, 70, '#ece8df', 'smoke', 10);
    s.notes.push('brick cathedral with four chimneys');
  } else if (v === 'compact') {
    s.shed(bx, bz, 30, 18, 16, PAL.brick, PAL.roof, 4);
    s.chimney(bx - 8, bz - 13, 1.8, 40, PAL.darkBrick); s.chimney(bx + 8, bz - 13, 1.8, 40, PAL.darkBrick);
  } else {
    s.block(bx - 10, bz, 34, 22, 34, '#c9c3b6', '#5b636b');
    s.block(bx - 10, bz + 16, 34, 10, 16, '#9aa0a4', PAL.roof, 0); // turbine hall
    s.chimney(bx + 12, bz - 12, 3.4, 95, '#bdb8ad', 'smoke', 12);
    const tr = Math.min(12, W * 0.08), tx = W / 2 - tr - 4;
    const towers = W > 130 ? 4 : 2;
    for (let i = 0; i < towers; i++) s.coolingTower(tx - (i % 2) * (tr * 2.3), -D * 0.25 + Math.floor(i / 2) * tr * 2.4, tr, tr * 2.9);
    s.notes.push(`${towers} cooling towers`, 'tall chimney');
  }
  s.conveyor(-W * 0.3, back + 22, 1, bx - 12, bz - 8, 22, PAL.soot);
  // switchyard: gantries and transformers at the front
  const sx = -W * 0.3, sz = front - 16;
  s.pad(sx, sz, 30, 16, PAL.gravel);
  for (let i = 0; i < 4; i++) { s.k.box(sx - 11 + i * 7, 0, sz, 0.5, 9, 0.5, '#9aa0a4'); s.k.box(sx - 11 + i * 7, 0, sz - 5, 3, 3, 2.4, '#6c7176'); }
  s.k.box(sx, 9, sz, 26, 0.5, 0.5, '#9aa0a4');
  s.notes.push('switchyard');
  s.entrance(W * 0.25, [[W * 0.25, front - 10], [0, front - 10]]);
  s.bays(W * 0.1, front - 12, 2);
  s.office(W * 0.4, front - 10, 16, 8, 2, v === 'cooling_towers' ? '#d8d2c4' : PAL.brick);
  for (const [x, z] of [[-W * 0.45, 0], [W * 0.1, back + 14], [W * 0.45, front - 26]]) s.floodlight(x, z, 14);
  s.decay(24);
};

const refinery: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.grass);
  s.pad(0, 0, W - 4, D - 4, '#b3aea3');
  s.siding(back + 5, -W / 2 + 3, W * 0.2, 2, 3);
  const tanks = v === 'tank_farm' ? 8 : 4;
  const tr = Math.min(8, W * 0.05);
  for (let i = 0; i < tanks; i++) {
    const cargo = i < tanks / 2 ? 'oil' : i % 2 ? 'chemicals' : 'fuel';
    const role = cargo === 'oil' ? 'in' : 'out';
    s.tank(-W / 2 + tr + 5 + (i % 4) * (tr * 2 + 4), back + 20 + Math.floor(i / 4) * (tr * 2 + 5), tr, 9, cargo, role, '#e3e0d8');
  }
  s.k.beam(-W * 0.3, back + 14, -W * 0.3, back + 20 + (tanks > 4 ? tr * 2 + 5 : 0), 0.3, 1.2, 0.6, '#7a7f84'); // bund wall
  const px = W * 0.12, pz = -D * 0.02;
  if (v === 'chemical_works') {
    for (let i = 0; i < 3; i++) s.block(px - 18 + i * 16, pz, 12, 18, 10 + i * 3, i % 2 ? '#d8d6cf' : '#9aa0a4', PAL.roof, 0);
    for (let i = 0; i < 2; i++) s.k.lathe(px - 10 + i * 20, pz + 16, [[0.5, 3], [3, 3.6], [4, 6], [3, 8.4], [0.4, 9]], 10, '#e8e6e0');
    s.coolingTower(W * 0.36, back + 22, 8, 20);
    s.chimney(px + 26, pz - 12, 1.4, 40, '#e2dfd8', 'steam');
    s.notes.push('process buildings', 'spherical tanks');
  } else {
    for (let i = 0; i < 5; i++) s.k.prism(px - 12 + i * 6, pz + (i % 2) * 5, 1.2 + (i % 3) * 0.4, 8, 0, 22 + (i % 3) * 8, '#c9cdd0', undefined);
    s.k.beam(px - 20, pz + 10, px + 22, pz + 10, 5, 1.4, 5, '#8a6f55'); // pipe rack
    s.block(px + 20, pz - 6, 14, 12, 12, '#9aa0a4', PAL.roof);
    for (let y = 3; y < 12; y += 3) s.k.box(px + 20, y, pz - 6, 14.6, 0.3, 12.6, '#e2b93b');
    s.notes.push('distillation columns', 'pipe racks');
  }
  s.k.prism(W * 0.42, back + 10, 0.6, 6, 0, 38, '#b8bcbf', 0.4);
  s.dyn.emitters.push({ kind: 'flame', x: W * 0.42, y: 38.4, z: back + 10, r: 1.4, rise: 5, puffs: 3 });
  s.notes.push('flare stack');
  s.entrance(W * 0.3, [[W * 0.3, front - 10], [-W * 0.2, front - 10]]);
  s.bays(-W * 0.3, front - 12, 4); // road tanker gantry
  s.k.box(-W * 0.3, 5, front - 12, 20, 0.6, 18, '#d8d6cf');
  s.office(W * 0.4, front - 8, 12, 7, 2, '#d8d2c4');
  for (const [x, z] of [[-W * 0.45, 0], [W * 0.45, -D * 0.1], [0, back + 12], [W * 0.1, front - 22]]) s.floodlight(x, z, 14);
  s.decay(20);
};

const brewery: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.grass);
  s.pad(0, 0, W - 4, D - 4, PAL.yard);
  const bx = -W * 0.18, bz = -D * 0.05;
  if (v === 'tower') {
    s.block(bx, bz, 16, 14, 22, PAL.brick, PAL.roof, 5);
    s.k.gable(bx, bz, 16, 14, 22, 4, '#4d545b', PAL.brick);
    s.k.box(bx, 26, bz, 5, 3, 5, '#e8e4d8'); s.k.prism(bx, bz, 3.6, 4, 29, 2.5, '#4d545b', 0);
    s.shed(bx + 18, bz + 2, 18, 12, 9, PAL.brick, PAL.roof, 3);
    s.chimney(bx - 11, bz - 10, 1.3, 30, PAL.brick);
    s.notes.push('Victorian tower brewhouse');
  } else if (v === 'maltings') {
    s.shed(bx + 6, bz - 4, 40, 12, 10, '#b0603f', '#535c66', 3.5);
    for (let i = 0; i < 3; i++) { const x = bx - 8 + i * 9; s.k.prism(x, bz - 4, 4, 4, 13.5, 5, '#535c66', 0.5); s.k.box(x, 18.5, bz - 4, 1.4, 1.6, 1.4, '#ece6d8'); s.dyn.emitters.push({ kind: 'steam', x, y: 20, z: bz - 4, r: 1, rise: 10, puffs: 4 }); }
    s.shed(bx + 6, bz + 12, 26, 10, 8, PAL.brick, PAL.roof, 3);
    s.notes.push('maltings with kiln cowls');
  } else {
    s.block(bx, bz, 26, 18, 12, '#d8d6cf', PAL.roof, 0);
    for (let i = 0; i < 6; i++) { const x = bx + 18 + (i % 3) * 5, z = bz - 5 + Math.floor(i / 3) * 6; s.k.prism(x, z, 2, 10, 0, 14, '#d6dadd'); s.k.prism(x, z, 2, 10, 14, 1.5, '#d6dadd', 0.3); }
    s.chimney(bx - 10, bz - 8, 0.8, 18, '#b8bcbf', 'steam');
    s.notes.push('stainless fermenting vessels');
  }
  s.silo(-W * 0.4, back + 10, 3, 14, 'grain', 'in', '#c9ccce');
  s.silo(-W * 0.4 + 7, back + 10, 3, 14, 'grain', 'in', '#c9ccce');
  s.stack(W * 0.3, front - D * 0.3, W * 0.28, 10, 'beer', 'out', 6, 3, 1.1, ['#9a6a3a', '#b67b3e', '#8a5a2e']);
  s.notes.push('cask yard');
  s.entrance(W * 0.12, [[W * 0.12, front - 10], [W * 0.3, front - 10]]);
  s.bays(W * 0.3, front - 12, 2);
  if (W > 60) s.siding(back + 4, -W * 0.2, W / 2 - 3, 1, 1);
  s.floodlight(W * 0.45, 0, 9);
  s.decay(12);
};

const food_plant: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.grass);
  s.pad(0, 0, W - 4, D - 4, PAL.yard);
  const bx = -W * 0.12, bz = -D * 0.05;
  if (v === 'flour_mill') {
    s.block(bx, bz, 20, 14, 24, '#c9a678', PAL.roof, 6);
    s.k.gable(bx, bz, 20, 14, 24, 3, '#535c66', '#c9a678');
    for (let i = 0; i < 4; i++) s.silo(bx + 16 + (i % 2) * 7, bz - 4 + Math.floor(i / 2) * 7, 3.2, 22, 'grain', 'in', '#d8d4ca');
    s.notes.push('six-storey mill', 'grain silos');
  } else if (v === 'biscuit_works') {
    s.block(bx, bz, W * 0.5, 18, 12, '#ece6d8', '#5b636b', 3);
    s.k.box(bx, 12, bz + 9, 10, 4, 1, '#2e7d5b'); // art deco entrance tower
    s.k.box(bx, 0, bz + 9.5, 8, 16, 2, '#ece6d8');
    s.chimney(bx + W * 0.25 + 3, bz - 8, 1.2, 24, PAL.brick);
    s.silo(-W * 0.4, back + 10, 3, 14, 'grain', 'in', '#c9ccce');
    s.notes.push('art deco factory');
  } else {
    s.shed(bx, bz, W * 0.45, 22, 9, '#c9cdd0', '#5b636b', 2);
    s.block(bx + W * 0.3, bz, 14, 16, 11, '#ecebe4', PAL.roof, 0); // cold store
    s.silo(-W * 0.4, back + 10, 3, 16, 'grain', 'in', '#c9ccce'); s.silo(-W * 0.4 + 7, back + 10, 3, 16, 'grain', 'in', '#c9ccce');
    s.chimney(bx - W * 0.2, bz - 8, 0.8, 16, '#b8bcbf', 'steam');
    s.notes.push('cold store');
  }
  // lairage: pens where livestock wait
  const lx = W * 0.3, lz = back + 12;
  s.pad(lx, lz, 20, 12, '#9a8a6a');
  s.k.beam(lx - 10, lz - 6, lx + 10, lz - 6, 0, 1.2, 0.2, '#6b4a33'); s.k.beam(lx - 10, lz + 6, lx + 10, lz + 6, 0, 1.2, 0.2, '#6b4a33');
  s.k.beam(lx - 10, lz - 6, lx - 10, lz + 6, 0, 1.2, 0.2, '#6b4a33'); s.k.beam(lx + 10, lz - 6, lx + 10, lz + 6, 0, 1.2, 0.2, '#6b4a33');
  s.pile({ kind: 'herd', cargo: 'livestock', role: 'in', x: lx, z: lz, rot: 0, w: 17, d: 9, h: 1.4, slots: 10, colour: '#f1ede4' });
  s.notes.push('livestock pens');
  s.stack(W * 0.3, front - D * 0.3, W * 0.26, 10, 'food', 'out', 6, 3, 1.2);
  s.entrance(W * 0.08, [[W * 0.08, front - 10], [W * 0.3, front - 10]]);
  s.bays(-W * 0.28, front - 10, 3);
  if (W > 60) s.siding(back + 4, -W / 2 + 3, W * 0.15, 1, 1);
  s.floodlight(-W * 0.45, 0, 10); s.floodlight(W * 0.45, front - 22, 10);
  s.decay(14);
};

const goods_factory: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.grass);
  s.pad(0, 0, W - 4, D - 4, PAL.yard);
  const bx = -W * 0.08, bz = -D * 0.04, bw = Math.min(W * 0.5, 44);
  if (v === 'mill') {
    s.block(bx, bz, bw, 16, 20, PAL.brick, PAL.roof, 5);
    s.k.box(bx + bw / 2 - 3, 0, bz + 8.4, 5, 24, 5, PAL.brick); // stair tower
    s.k.prism(bx + bw / 2 - 3, bz + 8.4, 3.4, 4, 24, 3, '#535c66', 0);
    s.chimney(bx - bw / 2 - 5, bz - 6, 1.8, 42, PAL.darkBrick);
    s.shed(bx - bw / 2 - 5, bz + 6, 8, 8, 8, PAL.brick, PAL.roof, 3);
    s.notes.push('five-storey mill', 'engine house', 'mill chimney');
  } else if (v === 'works') {
    const n = 4, td = 16 / n;
    s.k.box(bx, 0, bz, bw, 7, 16, '#8a4a35', false);
    for (let i = 0; i < n; i++) {
      const z0 = bz - 8 + i * td, z1 = z0 + td;
      s.k.paint('#535c66').quad([bx + bw / 2, 7, z0], [bx - bw / 2, 7, z0], [bx - bw / 2, 10, z1], [bx + bw / 2, 10, z1]);
      s.k.paint('#8ea4b8').quad([bx - bw / 2, 7, z1], [bx + bw / 2, 7, z1], [bx + bw / 2, 10, z1], [bx - bw / 2, 10, z1]);
    }
    s.chimney(bx + bw / 2 + 3, bz - 6, 1.2, 26, PAL.brick);
    s.notes.push('north-light sawtooth roof');
  } else {
    s.shed(bx, bz, bw, 22, 10, '#5f7f8f', '#8a969e', 1.6);
    s.block(bx - bw / 2 + 6, bz + 13, 12, 5, 6.4, '#ecebe4', PAL.roof, 2);
    s.k.box(bx + 8, 11, bz - 4, 4, 1.6, 3, '#b8bcbf'); s.k.box(bx - 8, 11, bz - 4, 4, 1.6, 3, '#b8bcbf');
    s.notes.push('portal-frame sheds');
  }
  s.doors(bx, bz + (v === 'mill' ? 8 : v === 'works' ? 8 : 11), 3, bw * 0.7);
  // inputs at the back by the siding, goods out the front
  s.stack(-W * 0.3, back + 14, 16, 8, 'steel', 'in', 5, 2, 1.1);
  s.stack(0, back + 14, 16, 8, 'planks', 'in', 5, 3, 1.0);
  s.tank(W * 0.28, back + 14, 4, 7, 'chemicals', 'in', '#e3e0d8');
  s.siding(back + 4, -W / 2 + 3, W / 2 - 3, 1, 2);
  s.stack(W * 0.3, front - D * 0.28, W * 0.26, 10, 'goods', 'out', 6, 3, 1.3, ['#d7659b', '#c9a678', '#8a8f94']);
  s.entrance(W * 0.08, [[W * 0.08, front - 10], [W * 0.3, front - 10]]);
  s.bays(-W * 0.28, front - 10, 3);
  s.floodlight(-W * 0.45, 0, 10); s.floodlight(W * 0.45, 0, 10);
  s.decay(16);
};

// ---------------- trade and distribution ----------------
const port: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.rough);
  const qz = back + Math.min(22, D * 0.25); // quay edge; water behind it
  s.pad(0, (qz + front) / 2, W - 2, front - qz - 2, v === 'container' ? '#9d998f' : PAL.yard);
  s.quay(qz, -W / 2 + 1, W / 2 - 1);
  s.siding(qz + 12, -W / 2 + 3, W / 2 - 3, 2, 3);
  if (v === 'container') {
    const n = W > 120 ? 3 : 2;
    for (let i = 0; i < n; i++) s.gantry(-W * 0.3 + i * (W * 0.6) / Math.max(1, n - 1), qz + 6, 28, 16, 22);
    for (let i = 0; i < 4; i++) s.stack(-W * 0.3 + (i % 2) * W * 0.4, qz + 30 + Math.floor(i / 2) * 14, W * 0.3, 9, i < 2 ? 'goods' : 'steel', i < 2 ? 'in' : 'in', 6, 4, 2.6, CONTAINERS);
    s.stack(W * 0.1, front - 12, W * 0.3, 9, 'oil', 'out', 6, 3, 2.6, ['#6b6f73', '#8a8f94']); // tank containers
    s.notes.push(`${n} ship-to-shore cranes`, 'container stacks');
  } else if (v === 'bulk') {
    s.heap(-W * 0.25, qz + 32, W * 0.3, 14, 8, 'iron_ore', 'out', false);
    s.heap(W * 0.18, qz + 32, W * 0.25, 14, 8, 'coal', 'in', false);
    for (let i = 0; i < 3; i++) s.jibCrane(-W * 0.35 + i * W * 0.35, qz + 4, 18, 22, '#3f6d93', true);
    for (let i = 0; i < 2; i++) s.tank(W * 0.38 - i * 13, front - 14, 6, 10, 'oil', 'out', '#e3e0d8');
    s.conveyor(-W * 0.25, qz + 4, 12, -W * 0.25, qz + 26, 9, '#8e4a35');
    s.notes.push('grab cranes', 'ore and coal stockyards', 'oil tanks');
  } else {
    for (let i = 0; i < 3; i++) { const x = -W * 0.3 + i * W * 0.3; s.block(x, qz + 22, W * 0.24, 14, 16, PAL.brick, PAL.roof, 4); s.k.gable(x, qz + 22, W * 0.24, 14, 16, 3, '#535c66', PAL.brick); }
    for (let i = 0; i < 4; i++) s.jibCrane(-W * 0.4 + i * W * 0.27, qz + 3, 12, 14, '#2e2e2e', true);
    s.stack(-W * 0.15, front - 14, W * 0.3, 8, 'goods', 'in', 6, 2, 1.3, ['#8a6446', '#c9a678']);
    s.stack(W * 0.25, front - 14, W * 0.2, 8, 'steel', 'in', 4, 2, 1.2);
    s.tank(W * 0.42, front - 16, 4, 7, 'oil', 'out', '#e3e0d8');
    s.pile({ kind: 'heap', cargo: 'iron_ore', role: 'out', x: W * 0.4, z: qz + 38, rot: 0, w: 12, d: 10, h: 6, colour: '#8e4a35' });
    s.notes.push('brick bonded warehouses', 'level-luffing cranes');
  }
  s.entrance(0, [[0, front - 6], [-W * 0.35, front - 6]], 8);
  s.bays(-W * 0.35, front - 14, 4);
  s.office(W * 0.4, front - 6, 14, 7, 2, v === 'victorian_dock' ? PAL.brick : '#d8d2c4');
  for (let i = 0; i < 4; i++) s.floodlight(-W * 0.4 + i * W * 0.27, qz + 16, 18);
  s.decay(20);
};

const warehouse: Recipe = (s, v) => {
  const { W, D, front, back } = s;
  s.ground(PAL.grass);
  s.pad(0, 0, W - 4, D - 4, PAL.tarmac);
  const bw = Math.min(W * 0.62, 70), bd = Math.min(D * 0.45, 32), bz = -D * 0.08;
  const wall = v === 'cold_store' ? '#ecebe4' : v === 'railhead' ? PAL.brick : '#c9cdd0';
  s.block(0, bz, bw, bd, v === 'cold_store' ? 16 : 12, wall, v === 'railhead' ? PAL.roof : '#8a969e');
  s.k.box(0, v === 'cold_store' ? 14.6 : 10.6, bz, bw + 0.2, 1.4, bd + 0.2, v === 'cold_store' ? '#3f6d93' : '#2e7d5b');
  const docks = Math.max(3, Math.floor(bw / 5));
  for (let i = 0; i < docks; i++) { const x = -bw / 2 + (i + 0.5) * (bw / docks); s.k.box(x, 0, bz + bd / 2 + 0.05, 3.2, 4, 0.12, '#4d5258'); s.k.box(x, 0, bz + bd / 2 + 0.6, 3.4, 1.2, 1.2, '#2e3034'); }
  s.bays(0, bz + bd / 2 + 9, Math.min(docks, 10), 0, bw / docks);
  s.notes.push(`${docks} dock doors`);
  s.block(bw / 2 + 5, front - 10, 12, 6, 6.4, '#ecebe4', PAL.roof, 2);
  if (v === 'cold_store') { for (let i = 0; i < 4; i++) s.k.box(-bw / 2 + 8 + i * 8, 16, bz, 5, 1.6, 4, '#b8bcbf'); s.notes.push('refrigeration plant'); }
  if (v === 'railhead') {
    s.siding(back + 5, -W / 2 + 3, W / 2 - 3, 2, 4);
    s.k.box(0, 6, back + 7, bw, 0.5, 12, '#8a969e'); // canopy over the rail dock
    for (let x = -bw / 2; x <= bw / 2; x += 10) s.k.box(x, 0, back + 12.5, 0.4, 6, 0.4, '#5d6166');
  } else if (W > 80) s.siding(back + 4, -W / 2 + 3, W * 0.1, 1, 2);
  // pallet stacks inside the yard fence: goods, food and beer waiting to go
  s.stack(-(bw / 2 + W / 2) / 2, bz, bd * 0.8, 6, 'goods', 'in', 5, 3, 1.2, undefined, Math.PI / 2);
  s.stack((bw / 2 + W / 2) / 2, bz, bd * 0.8, 6, 'food', 'out', 5, 3, 1.2, undefined, Math.PI / 2);
  s.stack((bw / 2 + W / 2) / 2, bz - bd * 0.5 - 6, 6, 8, 'beer', 'out', 4, 2, 1.1, ['#9a6a3a', '#b67b3e']);
  s.tank(-(bw / 2 + W / 2) / 2, back + 10, 3, 6, 'fuel', 'in', '#e3e0d8');
  s.entrance(-W * 0.3, [[-W * 0.3, front - 6], [W * 0.3, front - 6]], 8);
  for (let i = 0; i < 4; i++) s.floodlight(-W * 0.36 + i * W * 0.24, front - 4, 12);
  s.decay(16);
};

const RECIPES: Record<IndustryId, Recipe> = {
  coal_mine, quarry, forest, farm, sawmill, steelworks, iron_ore_mine, power_station, refinery, oil_well, brewery, food_plant, goods_factory, port, warehouse,
};

// Build a site of a type on a plot. The same (type, variant, seed, year, plot) always builds the
// same model, so a save only needs those, never the geometry.
export function buildIndustry(id: IndustryId, plot: Plot, opts: BuildOpts): IndustryModel {
  const type = INDUSTRY_TYPES[id];
  const year = opts.year ?? 1960;
  const variant = type.variants.find((v) => v.id === opts.variant) ?? variantFor(type, year, opts.seed);
  const frame = fitPlot(plot);
  const s = new Site(frame, rng(hash(`${id}|${variant.id}|${opts.seed}`)), year);
  RECIPES[id](s, variant.id);
  const group = s.k.build();
  group.position.set(frame.cx, 0, frame.cz);
  group.rotation.y = -frame.rot;
  group.userData.industry = { type: id, variant: variant.id, seed: opts.seed };
  return { type: id, variant, name: variant.name, detail: [...new Set(s.notes)].join(' · '), group, frame, dyn: s.dyn, anchors: s.anchors, tris: s.k.tris, height: s.k.top };
}

// A plot of the type's preferred size (or a variant's), centred at a point, facing +z.
export function defaultPlot(id: IndustryId, variant?: string, cx = 0, cz = 0) {
  const t = INDUSTRY_TYPES[id], v = t.variants.find((x) => x.id === variant);
  const { w, d } = v?.size ?? t.size;
  return { poly: rect(cx, cz, w, d).map(([x, z]) => ({ x, z })), facing: { x: 0, z: 1 } };
}
