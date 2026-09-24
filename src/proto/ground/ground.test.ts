import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bandPolys, circlePoly, pointInPoly } from '../land';
import { DIRS, packCover, SAMPLES, unpackCover, type GroundQuality } from './covers';
import { Ground, type GroundInput, type XZ } from './index';
import { Layout } from './layout';
import { groundFragment, patchGround, groundUniforms, setOrigin } from './material';
import { makeDetail, makeMacro, seamStats, MACRO_PERIOD } from './textures';
import { rng } from './noise';

// A town about the size of the game's: a grid of streets, plots along them, some landscaped
// cells, country roads out to the edge, a lake and a thousand trees.
function town(seed = 1): GroundInput {
  const r = rng(seed), blocked: XZ[][] = [], plots: NonNullable<GroundInput['plots']> = [], parks: NonNullable<GroundInput['parks']> = [];
  const lanes: NonNullable<GroundInput['lanes']> = [];
  const road = (a: XZ, b: XZ, half: number, lane = false) => {
    const path: XZ[] = [];
    for (let t = 0; t <= 1.0001; t += 0.05) path.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    blocked.push(...bandPolys(path, half, half));
    if (lane) lanes.push({ path, half });
  };
  for (let k = -2; k <= 2; k++) { road({ x: -260, z: k * 100 }, { x: 260, z: k * 100 }, 8); road({ x: k * 100, z: -260 }, { x: k * 100, z: 260 }, 8); }
  road({ x: -260, z: 30 }, { x: -600, z: 90 }, 6, true);
  road({ x: 30, z: 260 }, { x: 60, z: 600 }, 6, true);
  road({ x: 260, z: -60 }, { x: 600, z: -140 }, 6, true);
  road({ x: -600, z: -470 }, { x: 600, z: -470 }, 14);
  for (let k = -2; k <= 1; k++) for (let x = -250; x < 250; x += 18) {
    if (Math.abs(((x + 1000) % 100) - 0) < 12) continue;
    for (const side of [1, -1]) {
      const z = k * 100 + 50 + side * 25;
      plots.push({ poly: [{ x, z: z - 15 }, { x: x + 15, z: z - 15 }, { x: x + 15, z: z + 15 }, { x, z: z + 15 }], kind: r() < 0.1 ? 'yard' : 'garden' });
    }
  }
  for (let i = 0; i < 1500; i++) {
    const cx = 120 + (i % 30) * 5, cz = -230 + Math.floor(i / 30) * 5;
    parks.push({ poly: [{ x: cx - 2.5, z: cz - 2.5 }, { x: cx + 2.5, z: cz - 2.5 }, { x: cx + 2.5, z: cz + 2.5 }, { x: cx - 2.5, z: cz + 2.5 }] });
  }
  const trees: XZ[] = [];
  for (let i = 0; i < 1000; i++) trees.push({ x: (r() - 0.5) * 1100, z: (r() - 0.5) * 1100 });
  return { seed, blocked, lanes, plots, parks, trees, water: [circlePoly({ x: 250, z: -190 }, 96, 48)], town: [{ x: 0, z: 0 }] };
}
const REGION = { x0: -600, z0: -600, size: 1200 };
// how many bytes differ (vitest's deep equality is slow on million-byte arrays)
const diffs = (a: Uint8Array, b: Uint8Array) => { let n = Math.abs(a.length - b.length); for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++; return n; };
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

describe('generated textures', () => {
  it('tile without a seam, in every channel', () => {
    const d = makeDetail(1, 512), m = makeMacro(1, 256);
    for (const t of [d, m]) for (let ch = 0; ch < 4; ch++) {
      const s = seamStats(t, ch);
      // across the wrap is no rougher than anywhere inside
      expect(s.wrap).toBeLessThan(s.inner * 1.6 + 2);
    }
  });
  it('are the same for the same seed and differ for another', () => {
    expect(makeDetail(3, 128).data).toEqual(makeDetail(3, 128).data);
    expect(makeDetail(4, 128).data).not.toEqual(makeDetail(3, 128).data);
  });
  it('keep their greyscale channels centred, so distance never shifts the colour', () => {
    const d = makeDetail(1, 256);
    for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let i = ch; i < d.data.length; i += 4) s += d.data[i];
      expect(Math.abs(s / (d.data.length / 4) - 127.5)).toBeLessThan(6);
    }
  });
  it('fit the memory budget with a game-sized cover map (4 MB with mipmaps)', () => {
    const detail = 512 * 512 * 4 * (4 / 3), macro = 256 * 256 * 4 * (4 / 3), cover = Math.ceil(1200 / 2.5) ** 2 * 4;
    expect(detail + macro + cover).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(MACRO_PERIOD % 8).toBe(0); // (detail repeats fit the period, so rebasing the origin never jumps)
  });
});

describe('the packed cover map', () => {
  it('round-trips every cover, crop and direction', () => {
    const d = new Uint8Array(4);
    for (const [lawn, field, wood, bare, rough, wet] of [[0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0.8, 0], [0, 0, 1, 0, 0, 0], [0, 0, 0, 1, 0, 1], [0.3, 0, 0.2, 0, 0, 0.5]]) {
      for (let crop = 0; crop < 8; crop++) for (let k = 0; k < DIRS; k++) {
        packCover(lawn, field, wood, bare, rough, wet, crop, (k * Math.PI) / DIRS, d, 0);
        const c = unpackCover(d, 0);
        expect(c.crop).toBe(crop);
        expect(c.dir).toBeCloseTo((k * Math.PI) / DIRS, 6);
        for (const [x, y] of [[c.lawn, lawn], [c.field, field], [c.wood, wood], [c.bare, bare], [c.rough, rough], [c.wet, wet]]) expect(Math.abs(x - y)).toBeLessThan(0.01);
      }
    }
  });
});

describe('field parcels', () => {
  it('are 2 to 8 ha and not a grid', () => {
    const L = new Layout({ seed: 2 }), areas: number[] = [], seen = new Set<number>();
    const h = { id: 0, cell: L.parcels.cell(0, 0), edge: 0 };
    for (let x = -2000; x < 2000; x += 25) for (let z = -2000; z < 2000; z += 25) seen.add(L.parcels.hit(x, z, h).id);
    // area by counting 25 m samples per parcel
    const count = new Map<number, number>();
    for (let x = -2000; x < 2000; x += 25) for (let z = -2000; z < 2000; z += 25) { const id = L.parcels.hit(x, z, h).id; count.set(id, (count.get(id) ?? 0) + 1); }
    for (const [, n] of count) areas.push((n * 625) / 10000);
    const inner = areas.filter((a) => a > 0.3); // (drop slivers cut by the sampled square's edge)
    const m = median(inner);
    expect(m).toBeGreaterThan(2);
    expect(m).toBeLessThan(8);
    const ok = inner.filter((a) => a >= 1.2 && a <= 10).length / inner.length;
    expect(ok).toBeGreaterThan(0.8);
    // sizes vary (a grid's would all be the same)
    const sd = Math.sqrt(inner.reduce((s, a) => s + (a - m) ** 2, 0) / inner.length);
    expect(sd / m).toBeGreaterThan(0.25);
  });
});

describe('painting', () => {
  it('gives valid weights and crop codes', () => {
    const g = new Ground({ region: REGION });
    g.paint(town());
    const { a } = g.cover!;
    let fields = 0, bad = 0;
    for (let o = 0; o < a.length; o += 4) {
      const c = unpackCover(a, o);
      if (c.lawn + c.field + c.wood + c.bare > 1.02 || c.crop > 7 || c.dir >= Math.PI) bad++;
      if (c.field > 0.8) fields++;
    }
    expect(bad).toBe(0);
    expect(fields).toBeGreaterThan(a.length / 4 / 10); // there's countryside, and it's farmed
    g.dispose();
  });
  it('is deterministic', () => {
    const g1 = new Ground({ region: REGION }), g2 = new Ground({ region: REGION });
    g1.paint(town()); g2.paint(town());
    expect(diffs(g1.cover!.a, g2.cover!.a)).toBe(0);
    expect(g1.hedgeList()).toEqual(g2.hedgeList());
  });
  it('an incremental repaint after a plot is built equals a full repaint', () => {
    const A = town(), B = { ...A, plots: [...A.plots!] };
    // a new garden out in the fields (turns a field into town) and one in town
    const add = (x: number, z: number) => { const poly = [{ x, z }, { x: x + 16, z }, { x: x + 16, z: z + 30 }, { x, z: z + 30 }]; B.plots!.push({ poly, kind: 'garden' }); return { x0: x, z0: z, x1: x + 16, z1: z + 30 }; };
    const boxes = [add(-420, 320), add(-60, 20)];
    const inc = new Ground({ region: REGION }), full = new Ground({ region: REGION });
    inc.paint(A);
    inc.change(B, boxes);
    full.paint(B);
    let diff = 0;
    for (let i = 0; i < full.cover!.a.length; i++) if (inc.cover!.a[i] !== full.cover!.a[i]) diff++;
    expect(diff).toBe(0);
    const key = (l: ReturnType<Ground['hedgeList']>) => JSON.stringify([...l.pieces].sort((p, q) => p.x - q.x || p.z - q.z));
    expect(key(inc.hedgeList())).toBe(key(full.hedgeList()));
  });
  it('repaints at the map edge and away from the origin', () => {
    const far = { x0: 100000 - 300, z0: -250000 - 300, size: 600 };
    const inp: GroundInput = { seed: 4, plots: [{ poly: [{ x: 100000 + 280, z: -250000 }, { x: 100000 + 320, z: -250000 }, { x: 100000 + 320, z: -250000 + 30 }, { x: 100000 + 280, z: -250000 + 30 }], kind: 'site' }] };
    const inc = new Ground({ region: far }), full = new Ground({ region: far });
    inc.paint({ seed: 4 });
    inc.change(inp, [{ x0: 100000 + 280, z0: -250000, x1: 100000 + 320, z1: -250000 + 30 }]);
    full.paint(inp);
    expect(diffs(inc.cover!.a, full.cover!.a)).toBe(0);
    // and the far-off map has fields and hedges of its own
    expect(full.hedgeList().pieces.length).toBeGreaterThan(20);
  });
  it('copes with an empty world', () => {
    const g = new Ground({ region: { x0: -100, z0: -100, size: 200 } });
    g.paint({});
    g.change({}, [{ x0: -10, z0: -10, x1: 10, z1: 10 }]);
    expect(g.cover!.a.length).toBe(80 * 80 * 4);
  });
});

describe('hedgerows', () => {
  const inp = town();
  const g = new Ground({ region: REGION });
  g.paint(inp);
  const { pieces, trees } = g.hedgeList();
  const near = (p: XZ, poly: XZ[], r: number) => {
    if (pointInPoly(p, poly)) return true;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const A = poly[b], B = poly[a], ex = B.x - A.x, ez = B.z - A.z, L = ex * ex + ez * ez;
      const s = L ? Math.max(0, Math.min(1, ((p.x - A.x) * ex + (p.z - A.z) * ez) / L)) : 0;
      if (Math.hypot(A.x + ex * s - p.x, A.z + ez * s - p.z) < r) return true;
    }
    return false;
  };
  it('are planted', () => {
    expect(pieces.length).toBeGreaterThan(200);
    expect(trees.length).toBeGreaterThan(10);
  });
  it('never touch roads, plots, parks or water (either end of every piece)', () => {
    const polys = [...inp.blocked!, ...inp.plots!.map((p) => p.poly), ...inp.parks!.map((p) => p.poly), ...inp.water!];
    let bad = 0;
    for (const p of pieces) {
      const ux = Math.cos(p.a) * p.len / 2, uz = Math.sin(p.a) * p.len / 2;
      for (const q of [{ x: p.x, z: p.z }, { x: p.x - ux, z: p.z - uz }, { x: p.x + ux, z: p.z + uz }]) for (const poly of polys) if (near(q, poly, 0.5)) bad++;
    }
    expect(bad).toBe(0);
  });
  it('never run on top of one another', () => {
    let dup = 0;
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const p = pieces[i], q = pieces[j];
      if (Math.abs(p.x - q.x) > 3 || Math.abs(p.z - q.z) > 3) continue;
      const da = Math.abs(((p.a - q.a + Math.PI * 2.5) % Math.PI) - Math.PI / 2);
      if (Math.hypot(p.x - q.x, p.z - q.z) < 3 && da > Math.PI / 2 - 0.2) dup++;
    }
    expect(dup).toBe(0);
  });
  it('stay cheap: under 60k triangles for the whole map', () => {
    const tris = pieces.length * 14 + trees.length * 90;
    expect(tris).toBeLessThan(60000);
  });
});

describe('budgets', () => {
  it('a full paint of a game-sized map takes under 30 ms, a repaint after one building under 2 ms', () => {
    const A = town(), g = new Ground({ region: REGION });
    // (the first few paints run cold, before the JIT has compiled the painter: start-up pays that
    // once; these budgets are for painting during play)
    const full: number[] = [];
    for (let i = 0; i < 8; i++) { g.paint(A); full.push(g.stats.paint); }
    const inc: number[] = [];
    let cur = A;
    for (let i = 0; i < 15; i++) {
      const x = -240 + i * 30, z = 330, poly = [{ x, z }, { x: x + 14, z }, { x: x + 14, z: z + 28 }, { x, z: z + 28 }];
      cur = { ...cur, plots: [...cur.plots!, { poly, kind: 'garden' }] };
      g.change(cur, [{ x0: x, z0: z, x1: x + 14, z1: z + 28 }]);
      inc.push(g.stats.change);
    }
    expect(median(full.slice(3))).toBeLessThan(30);
    expect(median(inc)).toBeLessThan(2);
  });
});

describe('the material', () => {
  it('reads at most 6 textures at high quality and 3 at low (in fact 4 and 2)', () => {
    const count = (q: GroundQuality) => (groundFragment(q).match(/texture2D\s*\(/g) ?? []).length;
    expect(count('high')).toBeLessThanOrEqual(6);
    expect(count('low')).toBeLessThanOrEqual(3);
    for (const q of ['high', 'medium', 'low'] as GroundQuality[]) expect(count(q)).toBe(SAMPLES[q]);
    // no loops in the per-pixel code
    expect(groundFragment('high')).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
  });
  it('composes with onBeforeCompile patches before and after it (the water shore overlay)', () => {
    const m = new THREE.MeshLambertMaterial();
    let before = false;
    m.onBeforeCompile = (sh) => { before = true; sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', '// earlier patch\n#include <alphamap_fragment>'); };
    const u = groundUniforms(new THREE.Texture());
    patchGround(m, u);
    // a later patch that chains, as water/material.ts patchGroundMaterial does
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { prev.call(m, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', 'diffuseColor.rgb = mix( diffuseColor.rgb, vColor.rgb, vColor.a );'); };
    const sh = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    expect(before).toBe(true);
    expect(sh.fragmentShader).toContain('// earlier patch');
    expect(sh.fragmentShader).toContain('uCoverMap');
    expect(sh.fragmentShader).toContain('vColor.a');
    expect(sh.fragmentShader).not.toContain('#include <map_fragment>');
    expect(sh.vertexShader).toContain('vGW = gw.xyz');
    expect((sh as unknown as { uniforms: Record<string, unknown> }).uniforms.uDetail).toBeDefined();
    expect(m.customProgramCacheKey()).toContain('ground');
  });
  it('keeps precision far from the origin: the shader only sees the origin modulo the period', () => {
    const u = groundUniforms(new THREE.Texture());
    setOrigin(u, 100000.25, -250000.5, { x0: 99500, z0: -250500, size: 1000, n: 400 });
    const m = u.uOriginMod.value;
    expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x).toBeLessThan(MACRO_PERIOD);
    expect(m.x).toBeCloseTo(((100000.25 % MACRO_PERIOD) + MACRO_PERIOD) % MACRO_PERIOD, 6);
    expect(m.y).toBeCloseTo(((-250000.5 % MACRO_PERIOD) + MACRO_PERIOD) % MACRO_PERIOD, 6);
    // the cover map's corner is given relative to the origin: small numbers
    expect(u.uCover.value.x).toBeCloseTo(-500.25, 6);
    expect(u.uCover.value.y).toBeCloseTo(-499.5, 6);
  });
});
