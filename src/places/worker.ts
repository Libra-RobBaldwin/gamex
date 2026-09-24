// Everything heavy happens here, off the page's thread, so the page stays smooth: parsing the
// tiles Overpass sent, merging and trimming them into the fixture format, and the import itself.
import { clampFar, fixtureText, mergeTiles, trimJson, type Bbox, type OverpassRaw } from '../proto/osm/fetch';
import { buildPlans } from './build';

export interface Job { tiles: string[]; bbox: Bbox }
export type Reply =
  | { ok: true; empty: true }
  | { ok: true; empty: false; text: string; elements: number; osmBase?: string; built: ReturnType<typeof buildPlans> }
  | { ok: false; error: string };

self.onmessage = (e: MessageEvent<Job>) => {
  let reply: Reply;
  try {
    const trimmed = clampFar(trimJson(mergeTiles(e.data.tiles.map((t) => JSON.parse(t) as OverpassRaw)), e.data.bbox), e.data.bbox);
    const built = trimmed.elements.length ? buildPlans(trimmed) : undefined;
    // nothing the game can use (a field, the sea, a lone shop): don't keep an empty area
    if (!built || (!built.stats.segments && !built.stats.plots && !built.stats.zones)) reply = { ok: true, empty: true };
    else reply = { ok: true, empty: false, text: fixtureText(trimmed), elements: trimmed.elements.length, osmBase: trimmed.osm3s?.timestamp_osm_base, built };
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
