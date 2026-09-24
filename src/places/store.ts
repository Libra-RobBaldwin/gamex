// Built areas, kept on the device in IndexedDB so reopening one is instant. Keyed by the area and
// its name (area.ts areaId), never by the postcode that found it. Two stores: a small index for
// the list, and the files (the trimmed OSM data and both plans) read only when an area is opened.
//
// The game reads an area's data from here too: see placeData() and docs/places.md.

import type { Bbox, OverpassRaw } from '../proto/osm/fetch';
import type { Built } from './build';

const DB = 'untitled-places', VERSION = 1;

export interface AreaMeta { id: string; name: string; bbox: Bbox; sizeKm: number; savedAt: number; osmBase?: string; bytes: number; segments: number; plots: number }
export interface AreaFiles { id: string; data: string; built: Built }

let opening: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('This browser can’t keep areas (no IndexedDB).'));
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('areas', { keyPath: 'id' });
        r.result.createObjectStore('files', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error ?? new Error('Couldn’t open the saved areas.'));
      r.onblocked = () => rej(new Error('Close the page’s other tabs to open the saved areas.'));
    });
    opening.catch(() => { opening = undefined; });
  }
  return opening;
}

function run<T>(stores: string[], mode: IDBTransactionMode, work: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    const t = d.transaction(stores, mode);
    const req = work(t);
    t.oncomplete = () => res(req ? req.result : (undefined as T));
    t.onerror = () => rej(t.error ?? new Error('Saved areas: the browser refused.'));
    t.onabort = () => rej(t.error ?? new Error('Saved areas: the browser refused (is the device full?).'));
  }));
}

export async function listAreas(): Promise<AreaMeta[]> {
  const all = await run<AreaMeta[]>(['areas'], 'readonly', (t) => t.objectStore('areas').getAll());
  return all.sort((a, b) => b.savedAt - a.savedAt);
}
export const getArea = (id: string) => run<AreaMeta | undefined>(['areas'], 'readonly', (t) => t.objectStore('areas').get(id));
export const getFiles = (id: string) => run<AreaFiles | undefined>(['files'], 'readonly', (t) => t.objectStore('files').get(id));
export const saveArea = (meta: AreaMeta, files: AreaFiles) => run<void>(['areas', 'files'], 'readwrite', (t) => { t.objectStore('areas').put(meta); t.objectStore('files').put(files); });
export const deleteArea = (id: string) => run<void>(['areas', 'files'], 'readwrite', (t) => { t.objectStore('areas').delete(id); t.objectStore('files').delete(id); });

/**
 * The hand-over to the game: an area's trimmed OSM data (the fixture format, with its bbox and
 * ODbL credit), for `importOsm`. The game opens `proto.html?place=<id>` and calls this.
 */
export async function placeData(id: string): Promise<OverpassRaw | undefined> {
  const f = await getFiles(id);
  return f ? JSON.parse(f.data) : undefined;
}
export const PLACE_PARAM = 'place';
