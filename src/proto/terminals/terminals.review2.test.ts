// Second adversarial review of the terminals: money and idle-rule exploits, handling kit, the
// passing of days, and the models against the sites they serve (every industry, every variant).
// Each test states what ought to hold, so a failing one is a finding. See terminals.review.test.ts
// for the first review; nothing here repeats it.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INDUSTRY_IDS, INDUSTRY_TYPES } from '../industries/catalogue';
import { buildIndustry, defaultPlot } from '../industries/models';
import { CARGO_CLASS, FITS, TIERS, TIER_IDS, suitOf, type CargoClass, type FitId, type Mode, type TierId } from './catalogue';
import { bounds, place, roomCheck, waterBehind, waterline } from './layout';
import { buildTerminals } from './models';
import {
  CANCEL_REFUND, apply, berthRate, offers, specFor, startingTerminals, terminalFor, tick,
  type SiteContext, type SiteTerminals, type Terminal,
} from './rules';

const open = (mode: Mode, tier: TierId, fit: FitId = 'standard', extra: Partial<Terminal> = {}): Terminal => ({ mode, tier, fit, status: 'open', ready: 0, idle: 0, ...extra });
const withT = (grade: 1 | 2 | 3, ...terminals: Terminal[]): SiteTerminals => ({ grade, terminals });
const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(`refused: ${(r as unknown as { reason: string }).reason}`); return r as Extract<T, { ok: true }>; };
const CTX: SiteContext = { year: 1975, rail: true };
const steelworks = specFor('steelworks');

describe('money and the idle rules', () => {
  it("doesn't bill the player for the docks' own quay at docks they have never used", () => {
    // Every docks on the map starts with SiteTerminals = startingTerminals('port'), and the economy
    // calls tick() daily and charges its upkeep (docs/terminals.md, integration plan 1 and 3).
    const docks = specFor('port', undefined, 1980);
    let st = startingTerminals('port'), upkeep = 0;
    const news: string[] = [];
    for (let d = 1; d <= 365; d++) { const r = tick(docks, st, 1, {}, d); st = r.st; upkeep += r.upkeep; news.push(...r.events.map((e) => e.text)); }
    expect(upkeep, `a year's upkeep charged for untouched docks (quay now ${terminalFor(st, 'water')!.status}); news: ${news.join(' | ')}`).toBe(0);
  });

  it('refunds no more of changed kit on unfinished work than cancelling it would', () => {
    // a standard rail freight terminal; the player orders a rapid loader, and the next day
    // "refits" the unfinished work back to standard instead of cancelling it
    const st0 = withT(3, open('rail', 'rail_terminal'));
    const order = ok(apply(steelworks, st0, { ...CTX, day: 0 }, { kind: 'refit', mode: 'rail', fit: 'rapid_loader' }));
    const back = ok(apply(steelworks, order.st, { ...CTX, day: 1 }, { kind: 'refit', mode: 'rail', fit: 'standard' }));
    const cancel = ok(apply(steelworks, order.st, { ...CTX, day: 1 }, { kind: 'cancel', mode: 'rail' }));
    expect(order.cost).toBe(24000);
    expect(-cancel.cost).toBe(CANCEL_REFUND * 24000);
    expect(order.cost + back.cost, `net cost of ordering a £${order.cost} rapid loader and switching the unfinished work back to standard (cancelling refunds only £${-cancel.cost})`)
      .toBeGreaterThanOrEqual(order.cost * (1 - CANCEL_REFUND));
  });

  it("can't keep an unused terminal from being mothballed for nothing", () => {
    // 80 days without a train and already warned; a rapid loader ordered and switched back to
    // standard the next day costs £0 net, freezes the idle clock while "pending", and the no-op
    // refit then "opens" with idle 0
    const st0 = withT(3, open('rail', 'rail_terminal', 'standard', { idle: 80, warned: true }));
    let st = ok(apply(steelworks, st0, { ...CTX, day: 0 }, { kind: 'refit', mode: 'rail', fit: 'rapid_loader' })).st;
    const back = ok(apply(steelworks, st, { ...CTX, day: 1 }, { kind: 'refit', mode: 'rail', fit: 'standard' }));
    st = back.st;
    for (let d = 1; d <= 30; d++) st = tick(steelworks, st, 1, {}, d).st;
    const t = terminalFor(st, 'rail')!;
    expect(t.status === 'mothballed' || t.idle >= 110, `after 110 days with no train and £${24000 + back.cost} spent: ${t.status}, idle ${t.idle} days, fit ${t.fit}`).toBe(true);
  });

  it('charges upkeep and counts idle days only from the day a terminal opens', () => {
    // private sidings ordered on day 0 open on day 8; the stand-in economy ticks a month at a time
    const built = ok(apply(steelworks, withT(1), { ...CTX, day: 0 }, { kind: 'build', mode: 'rail', tier: 'sidings', fit: 'standard' }));
    const t = tick(steelworks, built.st, 30, {}, 30);
    const sid = terminalFor(t.st, 'rail')!;
    expect(t.upkeep, `upkeep for a month in which the sidings were open 22 days (${TIERS.sidings.upkeep}/day)`).toBeLessThanOrEqual(TIERS.sidings.upkeep * 22);
    expect(sid.idle, `idle days of sidings open for 22 days: events ${t.events.map((e) => e.text).join(' | ')}`).toBeLessThanOrEqual(22);
  });
});

describe('handling kit', () => {
  it('handles a cargo class a fit does not suit at the standard rate, stops and all', () => {
    // catalogue: "Each suits one cargo class; the others are handled at the standard rates". But
    // the fit's `dwell` shortens every stop whatever the cargo, so a loading gantry (for steel and
    // timber) or a tank farm speeds up coal trains
    const faster: string[] = [];
    const sample: Record<CargoClass, 'coal' | 'steel' | 'fuel'> = { bulk: 'coal', general: 'steel', liquid: 'fuel' };
    for (const tier of TIER_IDS) for (const fit of TIERS[tier].fits) for (const cls of ['bulk', 'general', 'liquid'] as CargoClass[]) {
      if (FITS[fit].suits[cls] !== undefined || fit === 'standard') continue;
      const c = sample[cls];
      expect(suitOf(fit, cls)).toBe(suitOf('standard', cls));
      const k = berthRate({ tier, fit }, c) / berthRate({ tier, fit: 'standard' }, c);
      if (k > 1.001) faster.push(`${tier} ${fit} moves ${c} ${Math.round((k - 1) * 100)}% faster than standard`);
    }
    // and so a colliery is sold a loading gantry for its coal
    const colliery = specFor('coal_mine', undefined, 1900);
    const o = offers(colliery, withT(3), { year: 1900, rail: true }).find((x) => x.tier === 'rail_terminal')!;
    expect(CARGO_CLASS.coal).toBe('bulk');
    expect(faster.join('\n'), `(colliery rail freight terminal in 1900 recommends: ${o.fit})`).toBe('');
  });
});

// ---------------- models against the sites ----------------
// Footprints of what stands up (roofs, walls' tops, tanks, silos, posts' caps): every triangle
// whose corners are all at least `minY` up, rasterised on a half-metre grid in site-local metres.
const CELL = 0.5;
function tallCells(g: THREE.BufferGeometry, minY = 0.9) {
  const pos = g.getAttribute('position'), idx = g.getIndex();
  const n = idx ? idx.count : pos.count, cells = new Set<string>();
  const v = (i: number) => { const j = idx ? idx.getX(i) : i; return [pos.getX(j), pos.getY(j), pos.getZ(j)]; };
  for (let t = 0; t < n; t += 3) {
    const a = v(t), b = v(t + 1), c = v(t + 2);
    if (Math.min(a[1], b[1], c[1]) < minY) continue;
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
const geom = (g: THREE.Group) => (g.children[0] as THREE.Mesh).geometry;
const cellOf = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const everyVariant = () => INDUSTRY_IDS.flatMap((id) => INDUSTRY_TYPES[id].variants.map((v) => ({ id, v, m: buildIndustry(id, defaultPlot(id, v.id), { seed: 1, variant: v.id, bare: true }) })));
const SITES = everyVariant();

describe('models on their sites', () => {
  it("doesn't stand the loading bay's cabin and floodlight inside the site's buildings", () => {
    // the bay's pad reaches 10 m behind the lorry anchors, where the recipes put the building the
    // bays serve (a rolling mill, a warehouse, a Dutch barn), and the cabin and lamp go in its corner
    const bad: string[] = [];
    for (const { id, v, m } of SITES) {
      const site = tallCells(geom(m.group));
      const t = buildTerminals(m, [{ mode: 'road', tier: 'loading_bay', fit: 'standard' }], { year: 2000 });
      const clash = [...tallCells(geom(t.group))].filter((c) => site.has(c)).length * CELL * CELL;
      if (clash > 1) bad.push(`${id} ${v.id}: ${clash} m² of the loading bay inside the site's buildings (pad ${JSON.stringify(t.placements[0].pad)})`);
    }
    expect(bad.join('\n')).toBe('');
  });

  it("parks the loading bay's lorries where the site's own bay was clear, not inside its buildings", () => {
    const bad: string[] = [];
    for (const { id, v, m } of SITES) {
      const site = tallCells(geom(m.group));
      const full = buildIndustry(id, defaultPlot(id, v.id), { seed: 1, variant: v.id });
      const ownBlocked = full.dyn.berths.filter((b) => b.kind === 'lorry' && site.has(cellOf(b.x, b.z))).length;
      const t = buildTerminals(m, [{ mode: 'road', tier: 'loading_bay', fit: 'standard' }], { year: 2000 });
      const inside = t.dyn.berths.filter((b) => b.kind === 'lorry' && site.has(cellOf(b.x, b.z)));
      if (inside.length > ownBlocked) bad.push(`${id} ${v.id}: ${inside.length} of the loading bay's lorry berths stand inside a building (${inside.map((b) => `${b.x.toFixed(1)},${b.z.toFixed(1)}`).join(' ')}); the site's own bays had ${ownBlocked}`);
    }
    expect(bad.join('\n')).toBe('');
  });

  it('keeps every land terminal it offers on land, and off the road in front of the site', () => {
    const bad: string[] = [];
    for (const { id, v, m } of SITES) for (const water of [false, true]) {
      if (water && !INDUSTRY_TYPES[id].waterside) continue;
      const B = bounds(m), wl = waterline(m), wet = waterBehind(m, { water });
      const spec = specFor(id, v, 2000);
      // Fixer's note: offers() knows nothing of the plot's shape; the game (and the demo panel) tell
      // it through SiteContext.room, which is roomCheck. So it's asked here as the game asks it: a
      // tier that can't fit between the road and the water must be refused there, not drawn wrong.
      const room = roomCheck(m, [], { water });
      for (const o of offers(spec, withT(3), { year: 2000, rail: true, water, room }).filter((x) => x.status === 'available' && x.mode !== 'water')) {
        const [P] = place(m, [{ mode: o.mode, tier: o.tier }], { water });
        const where = `${id} ${v.id}${water ? ' on the water' : ''}: ${o.tier} pad z ${P.pad.z0.toFixed(1)}..${P.pad.z1.toFixed(1)}`;
        if (wet && P.pad.z0 < wl - 1e-6) bad.push(`${where} runs ${(wl - P.pad.z0).toFixed(1)} m into the water (waterline ${wl})`);
        if (P.side !== 'plot' && P.pad.z1 > B.z1 + 0.5) bad.push(`${where} runs ${(P.pad.z1 - B.z1).toFixed(1)} m past the frontage (${B.z1}) across the road`);
      }
    }
    expect(bad.join('\n')).toBe('');
  });

  it("joins the docks' bulk or container terminal to the docks, rather than sealing the basin", () => {
    // the docks draw their own quay and basin (water from the back fence up to the quay line); the
    // port terminal is built from the waterline behind the fence, across the basin's only mouth
    const docks = SITES.filter((s) => s.id === 'port');
    const bad: string[] = [];
    for (const { v, m } of docks) {
      const q = m.anchors.quay[0], B = bounds(m);
      const t = buildTerminals(m, [{ mode: 'water', tier: 'port_terminal', fit: 'container_cranes' }], { year: 2000 });
      const P = t.placements[0].pad;
      const gap = q.z - P.z1;
      const seals = P.x0 <= q.x0 && P.x1 >= q.x1;
      if (gap > 2) bad.push(`${v.id}: ${gap.toFixed(1)} m of basin water between the docks' quay (z ${q.z}) and the terminal's landward edge (z ${P.z1}); the terminal spans x ${P.x0}..${P.x1}${seals ? `, closing the basin (x ${q.x0.toFixed(1)}..${q.x1.toFixed(1)}, plot ${B.x0}..${B.x1}) to the sea` : ''}`);
    }
    expect(bad.join('\n')).toBe('');
  });
});

