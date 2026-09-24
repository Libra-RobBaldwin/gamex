// Runs the importer off the page's thread, so the page stays smooth while a town is built.
import { buildPlans } from './build';
import type { OverpassJson } from '../proto/osm/overpass';

self.onmessage = (e: MessageEvent<{ json: OverpassJson }>) => {
  try {
    self.postMessage({ ok: true, built: buildPlans(e.data.json) });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
