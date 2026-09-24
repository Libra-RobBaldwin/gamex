import { describe, expect, it } from 'vitest';
import { generateTile, runBenchmark, saveSizeEstimate } from './bench';
import { tileSeed } from './seed';

const f = (n: number, d = 1) => n.toFixed(d);

describe('streaming benchmark: 50 × 50 km, camera flying corner to corner', () => {
  it('generation is deterministic', () => {
    const req = { key: '7,9', i: 7, j: 9, lod: 'near' as const, seed: tileSeed(1, '7,9'), size: 1000 };
    expect(generateTile(req).boxes).toEqual(generateTile(req).boxes);
  });
  for (const speed of [100, 400]) {
    it(`keeps to its budget at ${speed} m/s`, async () => {
      const r = await runBenchmark({ speed });
      console.log([
        `\n  ${speed} m/s: ${f(r.km)} km in ${f(r.seconds)} s (${r.frames} frames)`,
        `  loads ${r.loads} (${f(r.loadsPerSec)}/s), unloads ${r.unloads} (${f(r.unloadsPerSec)}/s), cancels ${r.cancels}`,
        `  frame ms p50 ${f(r.frameMs.p50, 2)}, p99 ${f(r.frameMs.p99, 2)}, max ${f(r.frameMs.max, 2)}; over budget ${r.overBudget}`,
        `  bookkeeping ms mean ${f(r.bookkeepingMs.mean, 3)}, max ${f(r.bookkeepingMs.max, 2)}`,
        `  near coverage ${f(r.nearCoverage * 100)}%; peak tiles near ${r.peak.near} mid ${r.peak.mid} far ${r.peak.far}; peak tile data ${f(r.peak.bytes / 2 ** 20)} MiB, modelled drawn memory ${f(r.peak.modelBytes / 2 ** 20)} MiB`,
      ].join('\n'));
      expect(r.loads).toBeGreaterThan(500);
      // bookkeeping is real time, so allow a slow CI machine a rare hitch
      expect(r.overBudget / r.frames).toBeLessThan(0.01);
      expect(r.peak.far + r.peak.mid + r.peak.near).toBeLessThan(700);
      if (speed <= 100) expect(r.nearCoverage).toBeGreaterThan(0.99);
    }, 60000);
  }
  it('saves the whole map small', () => {
    const s = saveSizeEstimate();
    console.log(`\n  save of ${s.tiles} tiles, ${s.records} records: ${f(s.bytes / 2 ** 20, 2)} MiB of JSON`);
    expect(s.bytes).toBeLessThan(64 * 2 ** 20);
  }, 60000);
});
