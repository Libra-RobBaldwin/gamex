// Adversarial review of the industries wiring (game/industry.ts, main.ts). Each test here failed
// against the code as reviewed; each states the behaviour the game should have.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_OPTS, Network, pathLength, pointAt, type P } from '../roads';
import { pointInPoly } from '../land';
import { Industries, townWishes, type IndustrySite } from './industry';
import { Traffic } from '../traffic';

// the seed town's zoning (main.ts)
const ESTATE = (p: P) => p.z < -215 && Math.abs(p.x) < 280;
const OUT = (p: P) => !ESTATE(p) && Math.hypot(p.x, p.z) > 300;
function town() {
  const net = new Network(() => false, 520, 11);
  const road = (a: P, b: P, type = 'street') => net.build(net.snapStart(a, 3), net.snapStart(b, 3), undefined, { ...DEFAULT_OPTS, type } as typeof DEFAULT_OPTS);
  road({ x: 0, z: -200 }, { x: 0, z: -470 });
  road({ x: -250, z: -330 }, { x: 250, z: -330 });
  road({ x: -230, z: 0 }, { x: 230, z: 0 });
  // the roads out of town, as in seedTown: national-limit rural roads
  road({ x: -230, z: 0 }, { x: -510, z: 0 }, 'rural-60');
  road({ x: 0, z: 200 }, { x: 0, z: 510 }, 'rural-60');
  const I = new Industries(net, new THREE.Group(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  I.placeAll(townWishes(ESTATE, OUT));
  return { net, I, road };
}

// Enough of a DOM for Industries' sprite badges (a canvas and an Image) to be made under Node.
function fakeDom() {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.document) return;
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  g.Image = class { onload: (() => void) | null = null; src = ''; };
}
const overlayOf = (I: Industries) => (I as unknown as { overlay: THREE.Group }).overlay;

describe('industries review', () => {
  it('lorries can reach the out-of-town sites (farm, forest, quarry): each site gate has traffic access', () => {
    const { net, I } = town();
    const tr = new Traffic(net, new THREE.Scene(), () => 0.5);
    const out = I.sites.filter((s) => OUT(s.lot));
    expect(out.map((s) => s.type).sort()).toEqual(['farm', 'forest', 'quarry']);
    // the sites are fitted along 60 mph roads (SiteWish.fast), but traffic only joins roads with
    // frontage, so accessOf gives null and getPlaces().works holds three dead lots
    for (const s of out) expect(tr.accessOf(s.lot), `${s.type} has no way in for traffic`).not.toBeNull();
  });

  it('the catchment ring drawn on the map is where stops serve the site (not 30 m beyond it)', () => {
    const { I } = town();
    const s = I.sites.find((x) => x.type === 'sawmill')!;
    // a stop point just outside the drawn ring, beyond the side of the site away from its road
    const f = s.model.frame, back = { x: -Math.sin(f.rot), z: Math.cos(f.rot) }; // +z local is the front
    let p: P = { x: f.cx, z: f.cz };
    for (let d = 0; d < 400; d += 1) { p = { x: f.cx - back.x * d, z: f.cz - back.z * d }; if (!pointInPoly(p, s.overlay.ring)) break; }
    p = { x: p.x - back.x * 10, z: p.z - back.z * 10 }; // 10 m outside the ring
    expect(pointInPoly(p, s.overlay.ring)).toBe(false);
    I.stops = () => [{ x: p.x, z: p.z, kind: 'lorry', radius: 30, label: 'outside the ring' }];
    I.refresh();
    // the sheet says "A stop within N m of the fence (the ring) can serve it", but this one does
    expect(s.servedBy).toEqual([]);
  });

  it('with the "Industry catchments" layer on, a tapped site still shows its cargo icons and a lit ring', () => {
    fakeDom();
    const { I } = town();
    const s = I.sites.find((x) => x.type === 'brewery')!;
    // main.ts: showOverlay(selectedSite, mode === 'stop' ? ... : siteRings ? null : undefined)
    I.showOverlay(s, undefined);
    const alone = overlayOf(I).children.filter((c) => c instanceof THREE.Sprite).length;
    expect(alone).toBeGreaterThan(0);
    I.showOverlay(s, null); // the layer is on
    expect(overlayOf(I).children.filter((c) => c instanceof THREE.Sprite).length).toBe(alone);
  });

  it('the stop tool lights a ring only when the stop it previews would really serve the site', () => {
    const { net, I } = town();
    // main.ts previews with the road's centre line (pointAt(path, t)), ignoring which side the
    // stop goes on; stops() puts the real stop at the kerb on its side
    const mismatches: string[] = [];
    for (const seg of net.segs.values()) {
      if (net.def(seg).cls !== 'road') continue;
      const path = net.path(seg), half = net.half(seg);
      for (let t = 5; t < pathLength(path) - 5; t += 1) {
        const q = pointAt(path, t);
        for (const side of [1, -1] as const) {
          const kerb = { x: q.x + q.uz * side * half, z: q.z - q.ux * side * half };
          for (const s of I.sites) {
            const preview = litByPreview(I, s, I.kerbPoint(seg, t, side)); // (main.ts previews at the kerb point)
            const real = I.servingStops(s, [{ x: kerb.x, z: kerb.z, kind: 'lorry', radius: 30, label: '' }]).length > 0;
            if (preview !== real) mismatches.push(`${s.type} seg ${seg.id} t ${t} side ${side}: ring ${preview ? 'lit' : 'unlit'}, stop ${real ? 'serves' : "doesn't serve"}`);
          }
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

// what Industries.showOverlay lights for a previewed stop at p
function litByPreview(I: Industries, s: IndustrySite, p: P) {
  return I.servedFrom(p).includes(s);
}
