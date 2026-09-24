import { describe, expect, it } from 'vitest';
import { DirtyPipeline, roadPipeline, type Stage } from './dirty';
import { TileStore } from './authority';

function recorder(names: string[], radii: number[] = [], outputs: Record<string, (keys: string[]) => string[] | void> = {}) {
  const log: string[] = [];
  const stages: Stage[] = names.map((name, k) => ({
    name, radius: radii[k] ?? 0, batch: 100,
    run: (keys) => { log.push(`${name}:${[...keys].sort().join(' ')}`); return outputs[name]?.(keys); },
  }));
  return { log, stages };
}

describe('dirty pipeline', () => {
  it('runs stages in order, spreading by each stage\'s radius', () => {
    const { log, stages } = recorder(['junctions', 'claims', 'plots'], [1, 0, 0]);
    const p = new DirtyPipeline(stages);
    p.mark('0,0');
    p.flush();
    expect(log.map((l) => l.split(':')[0])).toEqual(['junctions', 'claims', 'plots']);
    expect(log[0].split(':')[1].split(' ').length).toBe(9); // the tile and its eight neighbours
    expect(log[1]).toBe(log[0].replace('junctions', 'claims'));
  });
  it('later stages only redo what earlier ones actually changed', () => {
    const { log, stages } = recorder(['junctions', 'claims', 'plots'], [1, 0, 0], { junctions: () => ['0,0'], claims: () => [] });
    const p = new DirtyPipeline(stages);
    p.mark('0,0');
    p.flush();
    expect(log.slice(1)).toEqual(['claims:0,0']); // plots never ran: no claim changed
  });
  it('the same tile marked many times runs once', () => {
    const { log, stages } = recorder(['a', 'b']);
    const p = new DirtyPipeline(stages);
    for (let k = 0; k < 5; k++) p.mark(['1,1', '1,1', '2,1']);
    p.flush();
    expect(log).toEqual(['a:1,1 2,1', 'b:1,1 2,1']);
  });
  it('can start part-way down (a mesh-only change)', () => {
    const { log, stages } = recorder(['a', 'b', 'c']);
    const p = new DirtyPipeline(stages);
    p.mark('0,0', 'c');
    p.flush();
    expect(log).toEqual(['c:0,0']);
  });
  it('a change arriving half-way re-runs the earlier stage before carrying on', () => {
    const log: string[] = [];
    let p!: DirtyPipeline;
    let once = true;
    p = new DirtyPipeline([
      { name: 'a', run: (k) => { log.push(`a:${k}`); } },
      { name: 'b', run: (k) => { log.push(`b:${k}`); if (once) { once = false; p.mark('5,5'); } } },
      { name: 'c', run: (k) => { log.push(`c:${k}`); } },
    ]);
    p.mark('0,0');
    p.flush();
    expect(log).toEqual(['a:0,0', 'b:0,0', 'a:5,5', 'b:5,5', 'c:0,0', 'c:5,5']);
  });
  it('keeps within a tile budget and a millisecond budget', () => {
    let now = 0;
    const { stages } = recorder(['a', 'b']);
    stages.forEach((s) => { s.batch = 1; const run = s.run; s.run = (k) => { now += 2; return run(k); }; });
    const p = new DirtyPipeline(stages, { clock: () => now });
    p.mark(['0,0', '1,0', '2,0', '3,0']);
    expect(p.step({ items: 3 }).tiles).toBe(3);
    expect(p.pending()).toEqual({ a: 1, b: 3 });
    const s = p.step({ ms: 5 }); // 0, 2, 4 → 6 ≥ 5
    expect(s.tiles).toBe(3); expect(s.ms).toBe(6);
    expect(p.step({ ms: 1000 }).idle).toBe(true);
  });
  it('works nearest the camera first, and skips tiles that are not loaded', () => {
    const { log, stages } = recorder(['a'], [1]);
    stages[0].batch = 1;
    const loaded = new Set(['0,0', '1,0', '2,0', '1,1']);
    const p = new DirtyPipeline(stages, { live: (k) => loaded.has(k), priority: (k) => (k === '2,0' ? 0 : k === '1,1' ? 1 : 2) });
    p.mark('1,0');
    p.flush();
    expect(log).toEqual(['a:2,0', 'a:1,1', 'a:0,0', 'a:1,0']);
    p.mark('1,0'); p.drop('0,0'); p.drop('1,0');
    expect(p.pending()).toEqual({ a: 2 });
  });
  it('drives from store changes: moving a node dirties every tile its road touched', () => {
    const st = new TileStore(1);
    st.put({ kind: 'node', id: 'n1', x: 100, z: 100 });
    st.put({ kind: 'node', id: 'n2', x: 1900, z: 100 });
    st.put({ kind: 'seg', id: 's1', a: 'n1', b: 'n2', mid: [], type: 'street' });
    const seen: Record<string, string[]> = {};
    const rec = (name: string) => (keys: string[]) => { (seen[name] ??= []).push(...keys); };
    const p = roadPipeline({ junctions: rec('junctions'), claims: rec('claims'), evict: rec('evict'), plots: rec('plots'), meshes: rec('meshes') });
    p.mark(st.put({ kind: 'node', id: 'n2', x: 2900, z: 100 }));
    p.flush();
    expect(seen.claims.sort()).toEqual(['-1,-1', '-1,0', '-1,1', '0,-1', '0,0', '0,1', '1,-1', '1,0', '1,1', '2,-1', '2,0', '2,1', '3,-1', '3,0', '3,1'].sort());
    expect(Object.keys(seen)).toEqual(['junctions', 'claims', 'evict', 'plots', 'meshes']);
  });
});
