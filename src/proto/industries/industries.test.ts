import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INDUSTRIES as INDUSTRIES_2D } from '../../defs';
import {
  CARGO, INDUSTRY_IDS, INDUSTRY_TYPES, TOWN_ACCEPTS, consumersOf, producersOf, variantFor, type CargoId, type IndustryType,
} from './catalogue';
import { Kit } from './kit';
import { buildIndustry, defaultPlot, type IndustryModel } from './models';
import { fitPlot, plotFromLot, toWorld } from './site';
import { IndustryFx } from './fx';
import { chainFrom, linkCargo, overlayFor, serves } from './overlay';
import type { IndustryVisualState, Pile } from './state';

const ALL = INDUSTRY_IDS.flatMap((id) => INDUSTRY_TYPES[id].variants.map((v) => ({ id, v: v.id })));
const build = (id: (typeof ALL)[number]['id'], v: string, seed = 1) => buildIndustry(id, defaultPlot(id, v), { seed, variant: v });
const models = new Map<string, IndustryModel>(ALL.map(({ id, v }) => [`${id}:${v}`, build(id, v)]));

describe('catalogue', () => {
  const types = Object.values(INDUSTRY_TYPES);
  const cargos = Object.keys(CARGO) as CargoId[];

  it('keeps the 2D game ids, cargo and base rates', () => {
    for (const [id, d] of Object.entries(INDUSTRIES_2D)) {
      const t = INDUSTRY_TYPES[id as keyof typeof INDUSTRY_TYPES];
      expect(t, id).toBeDefined();
      if (d.produces) { expect(t.outputs[0].cargo).toBe(d.produces); expect(t.rate).toBe(d.rate); }
      for (const c of d.accepts) expect(t.inputs.some((f) => f.cargo === c), `${id} accepts ${c}`).toBe(true);
    }
  });

  it('every input is produced somewhere and every output is wanted somewhere', () => {
    for (const t of types) {
      for (const f of t.inputs) expect(producersOf(f.cargo).length, `${t.id} needs ${f.cargo}`).toBeGreaterThan(0);
      for (const f of t.outputs) { const c = consumersOf(f.cargo); expect(c.industries.length > 0 || c.towns, `${t.id} makes ${f.cargo}`).toBe(true); }
    }
    for (const c of cargos) expect(producersOf(c).length + consumersOf(c).industries.length, `${c} is used`).toBeGreaterThan(0);
  });

  it('has no dead-end chains: every cargo eventually reaches a town, a sink or the docks', () => {
    const terminal = new Map<CargoId, boolean>();
    const reaches = (c: CargoId, path: CargoId[] = []): boolean => {
      if (terminal.has(c)) return terminal.get(c)!;
      if (path.includes(c)) return false;
      let ok = TOWN_ACCEPTS.includes(c);
      for (const id of consumersOf(c).industries) {
        const t = INDUSTRY_TYPES[id];
        if (t.role === 'sink' || t.role === 'gateway') ok = true;
        else if (t.role === 'hub') ok ||= t.outputs.some((f) => f.cargo === c) && TOWN_ACCEPTS.includes(c);
        else ok ||= t.outputs.some((f) => reaches(f.cargo, [...path, c]));
      }
      terminal.set(c, ok);
      return ok;
    };
    for (const c of cargos) expect(reaches(c), c).toBe(true);
    // and every processor can actually be fed from primaries (or imports)
    const fed = (c: CargoId): boolean => producersOf(c).some((id) => INDUSTRY_TYPES[id].role === 'primary' || INDUSTRY_TYPES[id].role === 'gateway' || INDUSTRY_TYPES[id].inputs.every((f) => f.optional || fed(f.cargo)));
    for (const t of types.filter((t) => t.role === 'processor')) for (const f of t.inputs) expect(fed(f.cargo), `${t.id} ${f.cargo}`).toBe(true);
  });

  it('has sane ratios, and processing adds value', () => {
    const pay = (fs: { cargo: CargoId; amount: number }[]) => fs.reduce((s, f) => s + CARGO[f.cargo].pay * f.amount, 0);
    for (const t of types) {
      expect(t.rate).toBeGreaterThan(0);
      for (const f of [...t.inputs, ...t.outputs]) { expect(f.amount).toBeGreaterThanOrEqual(0.2); expect(f.amount).toBeLessThanOrEqual(5); }
      if (t.role !== 'processor') continue;
      const need = t.inputs.filter((f) => !f.optional);
      if (t.mix === 'all') expect(pay(t.outputs), t.id).toBeGreaterThanOrEqual(pay(need));
      else for (const f of need) expect(pay(t.outputs), `${t.id} from ${f.cargo}`).toBeGreaterThanOrEqual(pay([f]));
      if (t.boost) expect(t.boost).toBeLessThanOrEqual(1.5);
    }
  });

  it('has branching chains that make routing a puzzle', () => {
    const multi = types.filter((t) => t.role === 'processor' && t.mix === 'all' && t.inputs.filter((f) => !f.optional).length >= 2);
    expect(multi.map((t) => t.id)).toContain('steelworks');
    // coal has more than one customer, and iron ore more than one source
    expect(consumersOf('coal').industries.length).toBeGreaterThanOrEqual(3);
    expect(producersOf('iron_ore').length).toBeGreaterThanOrEqual(2);
  });

  it('gives every type sizes, eras, stations, a catchment and three variants', () => {
    for (const t of types as IndustryType[]) {
      expect(t.variants.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.minSize.w).toBeLessThanOrEqual(t.size.w); expect(t.minSize.d).toBeLessThanOrEqual(t.size.d);
      expect(t.serve.length).toBeGreaterThan(0);
      if (t.waterside === 'required') expect(t.serve).toContain('quay');
      expect(t.catchment).toBeGreaterThanOrEqual(50); expect(t.catchment).toBeLessThanOrEqual(200);
      for (const v of [t, ...t.variants]) if (v.era[1] !== null) expect(v.era[0]).toBeLessThan(v.era[1]);
      expect(variantFor(t, 2000, 0.3).id).toBeTruthy();
    }
    expect(variantFor(INDUSTRY_TYPES.power_station, 1910, 0.5).id).toBe('compact'); // the only one around in 1910
  });
});

describe('site fitting', () => {
  it('finds a rectangle inside an odd plot and faces the road', () => {
    const plot = { poly: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 110, z: 70 }, { x: 40, z: 90 }, { x: -10, z: 60 }], facing: { x: 0, z: -1 } };
    const f = fitPlot(plot);
    expect(f.w).toBeGreaterThan(50); expect(f.d).toBeGreaterThan(40);
    const inside = (p: { x: number; z: number }) => {
      let c = false;
      for (let i = 0, j = plot.poly.length - 1; i < plot.poly.length; j = i++) {
        const a = plot.poly[i], b = plot.poly[j];
        if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
      }
      return c;
    };
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) expect(inside(toWorld(f, (sx * f.w) / 2 * 0.999, (sz * f.d) / 2 * 0.999))).toBe(true);
    // local +z (the frontage) points at the road, which is towards -z in the world here
    const a = toWorld(f, 0, 0), b = toWorld(f, 0, 10);
    expect(b.z - a.z).toBeCloseTo(-10, 5);
  });

  it('takes a Lot the same way buildgen places buildings', () => {
    const lot = { id: 1, x: 50, z: 20, rot: 0.6, w: 80, d: 60, h: 10, kind: 'industry' as const, seg: 0, seed: 0.5, row: 0, front: 14, back: 16, px: 0, pw: 0 };
    const f = fitPlot(plotFromLot(lot));
    expect(f.w).toBeGreaterThan(78); expect(f.d).toBeGreaterThan(58);
    expect(f.rot).toBeCloseTo(0.6, 5);
    const g = new THREE.Group(); g.position.set(f.cx, 0, f.cz); g.rotation.y = -f.rot; g.updateMatrixWorld();
    const p = new THREE.Vector3(3, 0, 7).applyMatrix4(g.matrixWorld), w = toWorld(f, 3, 7);
    expect(p.x).toBeCloseTo(w.x, 5); expect(p.z).toBeCloseTo(w.z, 5);
  });
});

describe('models', () => {
  it('draws faces outwards and upwards', () => {
    const k = new Kit(); k.box(0, 0, 0, 2, 2, 2); k.prism(5, 0, 1, 8, 0, 2);
    const g = k.toGeometry(), P = g.getAttribute('position'), N = g.getAttribute('normal');
    for (let i = 0; i < P.count; i += 3) {
      const cx = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3, cz = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3, ox = cx > 2.5 ? 5 : 0;
      if (Math.abs(N.getY(i)) > 0.5) expect(N.getY(i)).toBeGreaterThan(0);
      else expect(N.getX(i) * (cx - ox) + N.getZ(i) * cz).toBeGreaterThan(0);
    }
  });

  it.each(ALL)('$id / $v builds within budget and inside its plot', ({ id, v }) => {
    const m = models.get(`${id}:${v}`)!;
    expect(m.tris).toBeGreaterThan(150);
    expect(m.tris).toBeLessThanOrEqual(6000);
    expect(m.group.children).toHaveLength(1); // one mesh, one draw call
    expect(m.height).toBeLessThan(120);
    const d = m.dyn;
    expect(d.piles.length, 'has a stockpile to show').toBeGreaterThan(0);
    const instances = d.piles.reduce((s, p) => s + (p.kind === 'stack' ? (p.slots ?? 6) * (p.layers ?? 3) : p.slots ?? 1), 0) + d.emitters.reduce((s, e) => s + e.puffs, 0) + d.lamps.length * 2 + d.decay.length + d.movers.length * 8 + d.berths.length * 3;
    expect(instances).toBeLessThan(400);
    // every vertex sits on the plot, give or take a fence post
    const P = (m.group.children[0] as THREE.Mesh).geometry.getAttribute('position');
    const xs = m.frame.outline.map((p) => p[0]), zs = m.frame.outline.map((p) => p[1]);
    for (let i = 0; i < P.count; i++) {
      expect(P.getX(i)).toBeGreaterThan(Math.min(...xs) - 3); expect(P.getX(i)).toBeLessThan(Math.max(...xs) + 3);
      expect(P.getZ(i)).toBeGreaterThan(Math.min(...zs) - 3); expect(P.getZ(i)).toBeLessThan(Math.max(...zs) + 3);
    }
    // where stations can go
    const t = INDUSTRY_TYPES[id];
    if (t.serve.includes('lorry')) expect(m.anchors.lorry.length).toBeGreaterThan(0);
    if (t.waterside === 'required') expect(m.anchors.quay.length).toBeGreaterThan(0);
  });

  it('builds the same model from the same seed, and a different one from another', () => {
    let differ = 0;
    for (const { id, v } of ALL) {
      const a = build(id, v, 7), b = build(id, v, 7), c = build(id, v, 8);
      const pos = (m: IndustryModel) => (m.group.children[0] as THREE.Mesh).geometry.getAttribute('position').array;
      expect(pos(a)).toEqual(pos(b));
      expect(JSON.stringify(a.dyn)).toBe(JSON.stringify(b.dyn));
      if (JSON.stringify(pos(a)) !== JSON.stringify(pos(c)) || JSON.stringify(a.dyn) !== JSON.stringify(c.dyn)) differ++;
    }
    expect(differ).toBe(ALL.length); // every recipe uses its seed somewhere
  });

  it('fits a smaller plot at the minimum size', () => {
    for (const id of INDUSTRY_IDS) {
      const { w, d } = INDUSTRY_TYPES[id].minSize;
      const m = buildIndustry(id, { poly: [{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }], facing: { x: 0, z: 1 } }, { seed: 3 });
      expect(m.tris, id).toBeGreaterThan(100);
    }
  });
});

describe('production visuals', () => {
  const S = (p: Partial<IndustryVisualState>): IndustryVisualState => ({ production: 2, input: 0.5, output: 0.5, running: true, recentlyDelivered: false, year: 1960, ...p });
  const det = (fx: IndustryFx, s: { pool: 'heap'; i: number }) => Math.abs(fx.matrixOf(s).determinant());

  it('uses the same few draw calls however many sites there are', () => {
    const fx = new IndustryFx();
    expect(fx.group.children).toHaveLength(9);
    const hs = [...models.values()].map((m) => fx.add(m));
    expect(fx.group.children).toHaveLength(9);
    expect(fx.stats().sites).toBe(models.size);
    hs.forEach((h) => fx.remove(h));
    expect(Object.values(fx.stats().instances).every((n) => n === 0)).toBe(true);
  });

  it('grows and shrinks every kind of stockpile with its stock level', () => {
    const kinds: Pile['kind'][] = ['heap', 'logs', 'stack', 'tank', 'herd'];
    for (const kind of kinds) {
      const m = [...models.values()].find((m) => m.dyn.piles.some((p) => p.kind === kind))!;
      const k = m.dyn.piles.findIndex((p) => p.kind === kind), p = m.dyn.piles[k];
      const fx = new IndustryFx(), h = fx.add(m);
      const measure = (level: number) => {
        fx.setState(h, S(p.role === 'in' ? { input: level } : { output: level }));
        if (kind === 'tank') return fx.matrixOf(h.piles[k][0]).elements[13]; // the roof's height
        return h.piles[k].reduce((s, sl) => s + det(fx, sl as { pool: 'heap'; i: number }), 0); // total volume
      };
      const vals = [0, 0.1, 0.35, 0.7, 1].map(measure);
      for (let i = 1; i < vals.length; i++) expect(vals[i], `${kind} at step ${i}`).toBeGreaterThan(vals[i - 1]);
      if (kind === 'heap') expect(vals[4] / vals[1]).toBeCloseTo(10, 0); // volume in proportion to stock
      if (kind !== 'tank') expect(vals[0]).toBe(0);
    }
  });

  it('per-cargo levels override the aggregate', () => {
    const m = models.get('steelworks:integrated')!, fx = new IndustryFx(), h = fx.add(m);
    const ore = m.dyn.piles.findIndex((p) => p.cargo === 'iron_ore'), coal = m.dyn.piles.findIndex((p) => p.cargo === 'coal');
    fx.setState(h, S({ input: 0.5, inputs: { iron_ore: 0 } }));
    expect(det(fx, h.piles[ore][0] as { pool: 'heap'; i: number })).toBe(0);
    expect(det(fx, h.piles[coal][0] as { pool: 'heap'; i: number })).toBeGreaterThan(0);
  });

  it('smokes, turns and lights up only while running, and goes to seed when neglected', () => {
    const m = models.get('coal_mine:victorian')!, fx = new IndustryFx({ hz: 1000 }), h = fx.add(m, S({}));
    const wheel = () => fx.matrixOf(h.rotors[0].slots[0]).elements.slice();
    const puff = () => Math.abs(fx.matrixOf(h.emitters[0][0]).determinant());
    fx.update(1); const w1 = wheel(); fx.update(2);
    expect(wheel()).not.toEqual(w1);
    expect(puff()).toBeGreaterThan(0);
    fx.setState(h, S({ running: false }));
    fx.update(3); const w2 = wheel(); fx.update(4);
    expect(wheel()).toEqual(w2);
    expect(puff()).toBe(0);
    // lamps: dark by day, lit at night
    const lampCol = () => { const c = new THREE.Color(); fx.group.children.find((o) => o.name === 'industry-fx-lamp') && (fx as unknown as { pools: { lamp: { mesh: THREE.InstancedMesh } } }).pools.lamp.mesh.getColorAt(h.lamps[0].lamp.i, c); return c.r + c.g + c.b; };
    fx.setState(h, S({})); const day = lampCol();
    fx.setNight(1); expect(lampCol()).toBeGreaterThan(day);
    // neglect: weeds appear, lights go out
    const weeds = () => h.decay.reduce((s, d) => s + Math.abs(fx.matrixOf(d).determinant()), 0);
    expect(weeds()).toBe(0);
    fx.setState(h, S({ neglect: 1, running: false, production: 0 }));
    expect(weeds()).toBeGreaterThan(0);
    expect(lampCol()).toBeCloseTo(day, 5);
  });

  it('only animates at its own rate', () => {
    const fx = new IndustryFx({ hz: 10 });
    fx.add(models.get('port:container')!);
    expect(fx.update(0)).toBe(true);
    expect(fx.update(0.05)).toBe(false);
    expect(fx.update(0.11)).toBe(true);
  });
});

describe('overlays', () => {
  it('draws a catchment ring round the site and knows which stations reach it', () => {
    const m = models.get('coal_mine:victorian')!, ov = overlayFor(m);
    const t = INDUSTRY_TYPES.coal_mine;
    // every ring point is about the catchment distance from the site
    const c = toWorld(m.frame, 0, 0);
    for (const p of ov.ring) expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(t.catchment);
    const edge = toWorld(m.frame, 0, m.frame.d / 2);
    const out = toWorld(m.frame, 0, m.frame.d / 2 + t.catchment - 5), far = toWorld(m.frame, 0, m.frame.d / 2 + t.catchment + 20);
    expect(serves(ov, edge)).toBe(true);
    expect(serves(ov, out, 0, 'rail')).toBe(true);
    expect(serves(ov, out, 0, 'quay')).toBe(false); // collieries have no quay
    expect(serves(ov, far)).toBe(false);
    expect(serves(ov, far, 30)).toBe(true); // the station's own catchment adds on
  });

  it('shows what a site needs and makes, with levels', () => {
    const ov = overlayFor(models.get('steelworks:integrated')!, { production: 1, input: 0.4, output: 0.9, running: true, recentlyDelivered: false, year: 1960, inputs: { coal: 0 } });
    expect(ov.icons.filter((i) => i.role === 'in').map((i) => i.cargo)).toEqual(['coal', 'iron_ore', 'stone']);
    expect(ov.icons.find((i) => i.cargo === 'coal')!.starved).toBe(true);
    expect(ov.icons.find((i) => i.cargo === 'stone')!.optional).toBe(true);
    expect(ov.icons.find((i) => i.cargo === 'steel')!.level).toBeCloseTo(0.9);
    expect(overlayFor(models.get('warehouse:railhead')!).icons).toHaveLength(4); // a hub shows its cargo once
  });

  it('follows chains from pit to town', () => {
    expect(linkCargo('coal_mine', 'steelworks')).toEqual(['coal']);
    expect(linkCargo('forest', 'steelworks')).toEqual([]);
    const chain = chainFrom('coal_mine');
    expect(chain.some((e) => e.to === 'power_station')).toBe(true);
    expect(chain.some((e) => e.from === 'goods_factory' && e.to === 'town' && e.cargo === 'goods')).toBe(true);
  });
});

describe('sidings on their sites', () => {
  // The top faces of what stands up on a site (roofs, walls' tops, pit benches), as half-metre
  // cells in site-local metres: a triangle counts when all its corners are at least 0.9 m up.
  const CELL = 0.5;
  function tallCells(g: THREE.BufferGeometry) {
    const pos = g.getAttribute('position'), idx = g.getIndex(), cells = new Set<string>();
    const n = idx ? idx.count : pos.count, v = (i: number) => { const j = idx ? idx.getX(i) : i; return [pos.getX(j), pos.getY(j), pos.getZ(j)]; };
    for (let t = 0; t < n; t += 3) {
      const a = v(t), b = v(t + 1), c = v(t + 2);
      if (Math.min(a[1], b[1], c[1]) < 0.9) continue;
      const x0 = Math.floor(Math.min(a[0], b[0], c[0]) / CELL), x1 = Math.ceil(Math.max(a[0], b[0], c[0]) / CELL);
      const z0 = Math.floor(Math.min(a[2], b[2], c[2]) / CELL), z1 = Math.ceil(Math.max(a[2], b[2], c[2]) / CELL);
      for (let i = x0; i <= x1; i++) for (let k = z0; k <= z1; k++) {
        const px = (i + 0.5) * CELL, pz = (k + 0.5) * CELL;
        const s = (p: number[], q: number[]) => (q[0] - p[0]) * (pz - p[2]) - (q[2] - p[2]) * (px - p[0]);
        const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) cells.add(`${i},${k}`);
      }
    }
    return cells;
  }

  it("keeps the opencast ironstone pit clear of the mine's own siding", () => {
    // the pit's back face once started at the back fence, and the siding 5 m in ran through it
    for (const seed of [1, 2, 3]) {
      const m = buildIndustry('iron_ore_mine', defaultPlot('iron_ore_mine', 'opencast'), { seed, variant: 'opencast', bare: true });
      const tall = tallCells((m.group.children[0] as THREE.Mesh).geometry);
      for (const r of m.anchors.rail) {
        let hit = 0;
        for (let x = r.x0 + 2; x <= r.x1 - 1; x += CELL) for (const dz of [-1.7, 0, 1.7]) if (tall.has(`${Math.floor(x / CELL)},${Math.floor((r.z + dz) / CELL)}`)) hit++;
        expect(hit * CELL / 3, `metres of pit across the siding at z ${r.z} (seed ${seed})`).toBe(0);
      }
    }
  });
});
