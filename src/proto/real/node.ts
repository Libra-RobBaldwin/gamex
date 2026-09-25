// Reading a baked region from disk (tests and tools; the game fetches it: load.ts).
import { readFileSync } from 'node:fs';
import { decodeTile, tileFile, type RegionManifest } from './format';
import { tilesFor, windowBox, homeOf, type RealRegion } from './map';

export function readRegion(id: string, o: { home?: string; half?: number } = {}): RealRegion {
  const dir = new URL(`../../../public/regions/${id}/`, import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('region.json', dir), 'utf8')) as RegionManifest;
  const h = homeOf(manifest, o.home);
  const tiles = tilesFor(manifest, windowBox(h, o.half)).map(([i, j]) => decodeTile(new Uint8Array(readFileSync(new URL(tileFile(i, j), dir)))));
  return { manifest, tiles };
}
