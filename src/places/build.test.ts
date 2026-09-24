import { describe, expect, it } from 'vitest';
import banbury from '../proto/osm/fixtures/banbury.json';
import { buildPlans } from './build';

describe('building the plans (what the worker runs)', () => {
  it('builds Banbury: both plans, the counts, and what the game can’t do', () => {
    const b = buildPlans(banbury);
    expect(b.gameSvg).toMatch(/^<svg[\s\S]*OpenStreetMap contributors[\s\S]*<\/svg>\s*$/);
    expect(b.rawSvg).toMatch(/^<svg[\s\S]*OpenStreetMap contributors/);
    expect(b.stats.segments).toBeGreaterThan(300);
    expect(b.stats.junctions).toBeGreaterThan(100);
    expect(b.stats.plots).toBeGreaterThan(1000);
    expect(b.stats.roundabouts).toBeGreaterThan(0);
    expect(b.stats.pairedDuals).toBeGreaterThan(0);
    expect(b.unsupported.find((u) => u.kind === 'one-way street')?.example).toMatch(/two-way/);
    expect(b.elements).toBe(banbury.elements.length);
  });

  it('copes with an empty square', () => {
    const b = buildPlans({ elements: [], bbox: [52.06, -1.34, 52.07, -1.33] });
    expect(b.stats.segments).toBe(0);
    expect(b.gameSvg).toContain('<svg');
  });
});
