// Everything heavy happens here, off the page's thread, so the page stays smooth: parsing the
// tiles Overpass sent, merging and trimming them into the fixture format, and the import itself.
import { fixtureText, mergeTiles, trimJson, type Bbox, type OverpassRaw } from '../proto/osm/fetch';
import { buildPlans } from './build';

export interface Job { tiles: string[]; bbox: Bbox }
export type Reply =
  | { ok: true; empty: true }
  | { ok: true; empty: false; text: string; elements: number; osmBase?: string; built: ReturnType<typeof buildPlans> }
  | { ok: false; error: string };

self.onmessage = (e: MessageEvent<Job>) => {
  let reply: Reply;
  try {
    const trimmed = trimJson(mergeTiles(e.data.tiles.map((t) => JSON.parse(t) as OverpassRaw)), e.data.bbox);
    if (!trimmed.elements.length) reply = { ok: true, empty: true };
    else {
      const text = fixtureText(trimmed);
      reply = { ok: true, empty: false, text, elements: trimmed.elements.length, osmBase: trimmed.osm3s?.timestamp_osm_base, built: buildPlans(trimmed) };
    }
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
