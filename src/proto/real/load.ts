// Fetching a baked real region (public/regions/<id>: tools/os/bake.mjs) and making the map the
// game plays: `?map=<region id>` (the region's home place in the middle), `&home=<place>` for
// another of its towns.
import { decodeTile, tileFile, type RegionManifest } from './format';
import { REAL_REGION_LIST } from './list';
import { homeOf, realMap, tilesFor, windowBox, type RealMap } from './map';
import { packMap, packUrl, type LivePack } from './live';

// the regions that have been baked (public/regions)
export const REAL_REGIONS = REAL_REGION_LIST.map((r) => r.id);
export const isRealQuery = (q: URLSearchParams) => REAL_REGIONS.includes(q.get('map') ?? '');

export async function loadRealMap(q: URLSearchParams, base = `${import.meta.env.BASE_URL}regions/`): Promise<RealMap> {
  const id = q.get('map')!, root = `${base}${id}/`;
  const got = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r; };
  const manifest = (await (await got(`${root}region.json`)).json()) as RegionManifest;
  const home = homeOf(manifest, q.get('home') ?? undefined);
  // (the live area packed ahead of time, when there is one: tools/os/pack.mjs; else it's made here from the tiles)
  if (q.get('pack') !== '0') {
    const r = await fetch(packUrl(base, id, home.name));
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const p = (await r.json()) as LivePack, m = packMap(p);
      return { ...m, real: { region: id, centre: p.centre, heights: { x0: 0, z0: 0, step: 1, n: 0, h: new Float32Array(0) }, stations: p.stations, pack: p } } as unknown as RealMap;
    }
  }
  const tiles = await Promise.all(tilesFor(manifest, windowBox(home)).map(async ([i, j]) => decodeTile(new Uint8Array(await (await got(root + tileFile(i, j))).arrayBuffer()))));
  return realMap({ manifest, tiles }, { home: home.name });
}
