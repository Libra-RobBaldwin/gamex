import { describe, expect, it } from 'vitest';
import { ROADS } from '../catalog';
import { BRIDGE_IDS } from './catalogue';
import { chooseBridge, chosenLayout, override } from './choose';
import { GALLERY, RIVER_CROSSING } from './gallery';
import { scenario } from './scenario';

const opt = (ch: ReturnType<typeof chooseBridge>, id: string) => ch.options.find((o) => o.def.id === id)!;

describe('choosing a bridge', () => {
  const ch = chooseBridge(scenario(RIVER_CROSSING).crossing);

  it('ranks the buildable types by cost and recommends the cheapest over its life', () => {
    const ok = ch.options.filter((o) => o.ok);
    expect(ok.length).toBeGreaterThan(2);
    for (let i = 1; i < ok.length; i++) expect(ok[i].cost).toBeGreaterThanOrEqual(ok[i - 1].cost);
    expect(ch.options.findIndex((o) => !o.ok)).toBeGreaterThanOrEqual(ok.length); // refused ones last
    const best = [...ok].sort((a, b) => a.wholeLife - b.wholeLife)[0];
    expect(ch.recommended).toBe(best.def.id);
    expect(ch.chosen).toBe(ch.recommended);
    expect(chosenLayout(ch)?.def.id).toBe(ch.recommended);
  });

  it('explains every refusal in plain words', () => {
    for (const o of ch.options.filter((x) => !x.ok)) expect(o.reasons.length).toBeGreaterThan(0);
    expect(opt(ch, 'trestle').reasons.join()).toMatch(/No longer built after 1930/);
    // a 120 m channel is beyond a girder: say what would reach
    expect(opt(ch, 'girder').reasons.join()).toMatch(/too long.*needs a .*(truss|arch|box)/);
  });

  it('lets the player override with any buildable type, but not a refused one', () => {
    const alt = ch.options.find((o) => o.ok && o.def.id !== ch.recommended)!;
    expect(override(ch, alt.def.id).chosen).toBe(alt.def.id);
    expect(override(ch, 'trestle').chosen).toBe(ch.recommended);
  });

  it('only offers what the year allows', () => {
    const old = chooseBridge(scenario({ ...GALLERY.girder, year: 1860 }).crossing);
    expect(opt(old, 'beam').reasons.join()).toMatch(/Not invented until 1950/);
    expect(opt(old, 'cable-stayed').ok).toBe(false);
  });

  it('knows what each can carry', () => {
    const main = chooseBridge(scenario({ ...GALLERY.trestle, road: ROADS['rail-main'] }).crossing);
    expect(opt(main, 'trestle').reasons.join()).toMatch(/Rail too heavy for a timber trestle/);
    const rail = chooseBridge(scenario({ ...GALLERY.suspension, road: ROADS['rail-main'] }).crossing);
    expect(opt(rail, 'suspension').reasons.join()).toMatch(/Can't carry a railway/);
    const heavy = chooseBridge(scenario({ ...GALLERY.suspension, heavy: true }).crossing);
    expect(opt(heavy, 'suspension').reasons.join()).toMatch(/Too heavy/);
  });

  it('raises the deck for a deeper structure when the route can be re-solved, and says so', () => {
    const sc = scenario(GALLERY.beam);
    const fixed = chooseBridge({ ...sc.crossing, resolve: undefined });
    expect(opt(fixed, 'beam').ok).toBe(false);
    expect(opt(fixed, 'beam').lift).toBeGreaterThan(0);
    const again = chooseBridge(sc.crossing);
    expect(opt(again, 'beam').ok).toBe(true);
    expect(opt(again, 'beam').reasons.join()).toMatch(/Deck raised/);
  });

  it('can build every type on its own showcase crossing', () => {
    for (const id of BRIDGE_IDS) {
      const o = opt(chooseBridge(scenario(GALLERY[id]).crossing), id);
      expect(o.ok, `${id}: ${o.reasons.join('; ')}`).toBe(true);
    }
  });
});
