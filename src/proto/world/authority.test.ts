import { describe, expect, it } from 'vitest';
import { TileStore, importNetwork, type SegRec } from './authority';
import { entitySeed, tileSeed, unitSeed } from './seed';
import { Network } from '../roads';

// three tiles in a row, a road across all of them, a park and an edit
function town() {
  const st = new TileStore(42);
  st.put({ kind: 'node', id: 'n1', x: 100, z: 100 });
  st.put({ kind: 'node', id: 'n2', x: 2500, z: 150, y: 4 });
  st.put({ kind: 'seg', id: 's1', a: 'n1', b: 'n2', mid: [{ x: 1300, z: 400 }], type: 'street' });
  st.put({ kind: 'claim', id: 'park1', owner: 'park', polys: [[{ x: 1800, z: 800 }, { x: 2300, z: 800 }, { x: 2300, z: 1300 }, { x: 1800, z: 1300 }]] });
  st.put({ kind: 'zone', id: 'z1', zone: 'industrial', poly: [{ x: 0, z: 0 }, { x: 900, z: 0 }, { x: 900, z: 900 }] });
  st.put({ kind: 'edit', id: 'e1', target: 's1', op: 'rename', data: { name: 'Mill Lane' } });
  return st;
}

describe('tile authority store', () => {
  it('owns each record in one tile and references it from the others it touches', () => {
    const st = town();
    expect(st.ownerOf('s1')).toBe('0,0'); // its first node's tile
    expect(st.coverOf('s1').sort()).toEqual(['0,0', '1,0', '2,0']);
    expect(st.inTile('1,0').owned).toEqual([]);
    expect(st.inTile('1,0').refs.map((r) => r.id)).toEqual(['park1', 's1']); // the park's corner reaches in too
    expect(st.refsOf('2,0')).toEqual([['park1', '2,1'], ['s1', '0,0']]);
    expect(st.ownerOf('park1')).toBe('2,1'); // box centre (2050, 1050)
    expect(st.coverOf('park1').sort()).toEqual(['1,0', '1,1', '2,0', '2,1']);
    expect(st.ownerOf('e1')).toBe('0,0'); // follows what it edits
  });
  it('moving a node re-homes its roads and their edits, and reports every tile touched', () => {
    const st = town();
    const touched = st.put({ kind: 'node', id: 'n1', x: 3500, z: 100 }).sort();
    expect(st.ownerOf('n1')).toBe('3,0');
    expect(st.ownerOf('s1')).toBe('3,0');
    expect(st.ownerOf('e1')).toBe('3,0');
    expect(st.coverOf('s1').sort()).toEqual(['1,0', '2,0', '3,0']);
    expect(touched).toEqual(['0,0', '1,0', '2,0', '3,0']);
    expect(st.inTile('0,0').refs).toEqual([]);
  });
  it('refuses dangling roads and keeps edits of removed things', () => {
    const st = town();
    expect(() => st.put({ kind: 'seg', id: 's2', a: 'n1', b: 'n9', mid: [], type: 'street' })).toThrow();
    expect(() => st.remove('n1')).toThrow(/still has roads/);
    st.remove('s1');
    expect(st.get('e1')).toBeDefined();
    expect(st.ownerOf('e1')).toBe('0,0');
    st.remove('n1');
    expect(st.inTile('1,0').refs.map((r) => r.id)).toEqual(['park1']);
  });
  it('save → load → save is exact, and holds only authorities', () => {
    const st = town();
    st.newId('p');
    const a = st.save();
    const json = JSON.stringify(a);
    const back = TileStore.load(JSON.parse(json));
    expect(JSON.stringify(back.save())).toBe(json);
    expect(back.next).toBe(st.next);
    expect(back.pathOf(back.get<SegRec>('s1')!)).toEqual(st.pathOf(st.get<SegRec>('s1')!));
    // the reference hints in the save agree with what the loaded store works out
    for (const k of Object.keys(a.tiles)) expect(back.refsOf(k)).toEqual(a.tiles[k].refs);
    // derived things (junctions, road claims, plots, meshes) never appear
    expect(new Set(Object.values(a.tiles).flatMap((t) => t.owned.map((r) => r.kind)))).toEqual(new Set(['node', 'seg', 'claim', 'zone', 'edit']));
  });
  it('tracks which tiles need writing for an incremental save', () => {
    const st = town();
    st.save();
    st.put({ kind: 'edit', id: 'e2', target: 'park1', op: 'trees', data: 'none' });
    expect(st.takeChanged()).toEqual(['2,1']);
    expect(st.takeChanged()).toEqual([]);
  });
  it('seeds are stable, per world, per tile and per thing', () => {
    const st = town();
    expect(st.seedOf('s1')).toBe(entitySeed(42, '0,0', 's1'));
    expect(entitySeed(42, '0,0', 's1')).toBe(entitySeed(42, '0,0', 's1'));
    expect(entitySeed(42, '0,0', 's1')).not.toBe(entitySeed(43, '0,0', 's1'));
    expect(entitySeed(42, '0,0', 's1')).not.toBe(entitySeed(42, '0,1', 's1'));
    expect(tileSeed(1, '1,23')).not.toBe(tileSeed(1, '12,3'));
    // pinned values: if these change, every saved world regrows differently
    expect(tileSeed(1, '0,0')).toBe(tileSeed(1, '0,0'));
    expect([tileSeed(1, '0,0'), entitySeed(7, '3,-2', 'lot:s12:L:3')]).toMatchInlineSnapshot(`
      [
        281353879,
        3322398619,
      ]
    `);
    const u = unitSeed(tileSeed(1, '0,0'));
    expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThan(1);
    // spread: 2,500 neighbouring tiles give 2,500 different seeds
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) for (let j = 0; j < 50; j++) seen.add(tileSeed(1, `${i},${j}`));
    expect(seen.size).toBe(2500);
  });
  it('imports the prototype road network', () => {
    const net = new Network();
    net.build({ x: -300, z: 0 }, { x: 1400, z: 0 });
    net.build({ x: 200, z: -200 }, { x: 200, z: 300 });
    const st = new TileStore(1);
    const touched = importNetwork(st, net);
    expect(touched.length).toBeGreaterThan(0);
    const segs = [...net.segs.values()];
    for (const s of segs) {
      const rec = st.get<SegRec>(`s${s.id}`)!;
      expect(st.pathOf(rec).map((p) => [p.x, p.z])).toEqual(net.path(s).map((p) => [p.x, p.z]));
    }
    const back = TileStore.load(JSON.parse(JSON.stringify(st.save())));
    expect(JSON.stringify(back.save())).toBe(JSON.stringify(st.save()));
  });
});
