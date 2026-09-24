import { describe, expect, it } from 'vitest';
import { BRIDGES, BRIDGE_IDS, COST_SCALE, approachFor, availableIn, closedPerOpening, deckRate, depthOf } from './catalogue';

describe('bridge catalogue', () => {
  it('has the types the game needs, each with sane figures', () => {
    for (const id of ['trestle', 'masonry', 'girder', 'truss-through', 'truss-deck', 'beam', 'box', 'arch-concrete', 'cable-stayed', 'suspension', 'bascule'] as const) expect(BRIDGES[id]).toBeDefined();
    for (const id of BRIDGE_IDS) {
      const d = BRIDGES[id];
      expect(d.id).toBe(id);
      expect(d.span.min).toBeLessThan(d.span.max);
      expect(d.length.min).toBeLessThan(d.length.max);
      expect(d.span.max).toBeLessThanOrEqual(d.length.max);
      expect(d.depth.min).toBeGreaterThan(0);
      expect(d.cost.deck).toBeGreaterThan(0);
      expect(d.cost.maint).toBeGreaterThan(0);
      expect(d.maxGrade).toBeGreaterThan(0);
      expect(d.era.to === undefined || d.era.to > d.era.from).toBe(true);
      if (d.layout === 'main') expect(d.cost.main).toBeGreaterThan(0);
    }
    expect(COST_SCALE).toBeGreaterThan(0);
  });

  it('orders the types by reach: the longest spans need the modern types', () => {
    const reach = (id: keyof typeof BRIDGES) => BRIDGES[id].span.max;
    expect(reach('trestle')).toBeLessThan(reach('masonry'));
    expect(reach('masonry')).toBeLessThan(reach('truss-through'));
    expect(reach('truss-through')).toBeLessThan(reach('cable-stayed'));
    expect(reach('cable-stayed')).toBeLessThan(reach('suspension'));
  });

  it('carries loads roughly as in the UK: no trains on a suspension bridge, light ones on timber', () => {
    expect(BRIDGES.suspension.railAxle).toBe(0);
    expect(BRIDGES.trestle.railAxle).toBeLessThan(22.5);
    expect(BRIDGES.masonry.railAxle).toBeGreaterThanOrEqual(25.5);
    expect(BRIDGES.trestle.roadTonnes).toBeLessThan(44);
  });

  it('unlocks by era', () => {
    expect(availableIn(BRIDGES.beam, 1900)).toBe(false);
    expect(availableIn(BRIDGES.beam, 1990)).toBe(true);
    expect(availableIn(BRIDGES.trestle, 1990)).toBe(false);
    expect(approachFor(1800).id).toBe('masonry');
    expect(approachFor(1900).id).toBe('girder');
    expect(approachFor(2000).id).toBe('beam');
  });

  it('prices longer spans and deeper structure higher', () => {
    const d = BRIDGES.girder;
    expect(deckRate(d, 45)).toBeGreaterThan(deckRate(d, 15));
    expect(depthOf(d, 45)).toBeGreaterThan(depthOf(d, 15));
    expect(depthOf(d, 5)).toBe(d.depth.min);
  });

  it('knows how long a lifting bridge shuts the road', () => {
    expect(closedPerOpening(BRIDGES.bascule)).toBeGreaterThan(200);
    expect(closedPerOpening(BRIDGES.beam)).toBe(0);
  });
});
