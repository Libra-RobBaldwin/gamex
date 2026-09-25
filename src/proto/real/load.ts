// Fetching a baked real region (public/regions/<id>: tools/os/bake.mjs) and making the map the
// game plays: `?map=<region id>` (the region's home place in the middle), `&home=<place>` for
// another of its towns.
import { decodeTile, tileFile, type RegionManifest } from './format';
import { homeOf, realMap, tilesFor, windowBox, type RealMap } from './map';

// the regions that have been baked (public/regions)
export const REAL_REGIONS = ['exe'];
export const isRealQuery = (q: URLSearchParams) => REAL_REGIONS.includes(q.get('map') ?? '');

export async function loadRealMap(q: URLSearchParams, base = `${import.meta.env.BASE_URL}regions/`): Promise<RealMap> {
  const id = q.get('map')!, root = `${base}${id}/`;
  const got = async (url: string) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r; };
  const manifest = (await (await got(`${root}region.json`)).json()) as RegionManifest;
  const home = homeOf(manifest, q.get('home') ?? undefined);
  const tiles = await Promise.all(tilesFor(manifest, windowBox(home)).map(async ([i, j]) => decodeTile(new Uint8Array(await (await got(root + tileFile(i, j))).arrayBuffer()))));
  return realMap({ manifest, tiles }, { home: home.name });
}
