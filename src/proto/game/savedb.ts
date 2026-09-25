// Where saved towns are kept: IndexedDB, in the phone's own storage, so they're there offline and
// after the page closes. Two stores: `saves` holds each whole town, `index` a small entry for
// each (its name, map, when and a summary line), so the lists of saves read no towns.
//
// The database has a version of its own (DB_VERSION) with an upgrade step per version in
// `upgrade`, as the saves' format has (game/save.ts). Storage can be missing or blocked (a
// private window, a sandboxed frame): every call then rejects, and the game says it can't save.
// Kept free of three.js and the game, so the start menu can read it too.
import { SAVE_VERSION, migrate, type GameSave, type SaveSummary } from './save';

const DB_NAME = 'untitled';
const DB_VERSION = 1;

export interface SaveEntry { id: string; name: string; map: { id: string; query: string }; savedAt: number; summary: SaveSummary; v: number }

// one step per database version: from `old` up to the next
function upgrade(db: IDBDatabase, old: number) {
  if (old < 1) {
    db.createObjectStore('saves', { keyPath: 'id' });
    db.createObjectStore('index', { keyPath: 'id' }).createIndex('savedAt', 'savedAt');
  }
}

let opening: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  return (opening ??= new Promise<IDBDatabase>((ok, fail) => {
    if (typeof indexedDB === 'undefined') { fail(new Error('No storage here')); return; }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion);
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); opening = null; }; ok(db); };
    r.onerror = () => fail(r.error ?? new Error('Storage refused'));
    r.onblocked = () => fail(new Error('Storage is busy in another tab'));
  }).catch((e) => { opening = null; throw e; }));
}
const done = (t: IDBTransaction) => new Promise<void>((ok, fail) => { t.oncomplete = () => ok(); t.onerror = () => fail(t.error); t.onabort = () => fail(t.error ?? new Error('Not saved')); });
const got = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => { r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });

export const entryOf = (s: GameSave): SaveEntry => ({ id: s.id, name: s.name, map: s.map, savedAt: s.savedAt, summary: s.summary, v: s.v });

// Write a town (the object is copied as it's put, so the game can carry on changing it at once).
export async function putSave(s: GameSave) {
  const db = await open(), t = db.transaction(['saves', 'index'], 'readwrite');
  t.objectStore('saves').put(s);
  t.objectStore('index').put(entryOf(s));
  await done(t);
}
// A town, brought up to this version of the game (null if there's no such save).
export async function getSave(id: string): Promise<GameSave | null> {
  const db = await open();
  const raw = await got(db.transaction('saves').objectStore('saves').get(id));
  return raw ? migrate(raw) : null;
}
// Every save, newest first.
export async function listSaves(): Promise<SaveEntry[]> {
  const db = await open();
  const all = await got(db.transaction('index').objectStore('index').getAll() as IDBRequest<SaveEntry[]>);
  return all.filter((e) => e.v <= SAVE_VERSION).sort((a, b) => b.savedAt - a.savedAt);
}
export async function deleteSave(id: string) {
  const db = await open(), t = db.transaction(['saves', 'index'], 'readwrite');
  t.objectStore('saves').delete(id);
  t.objectStore('index').delete(id);
  await done(t);
}

// the address a save is played at: its map's own query, and which save
export function saveSearch(e: Pick<SaveEntry, 'id' | 'map'>) {
  const q = new URLSearchParams(e.map.query);
  q.delete('guide');
  q.set('save', e.id);
  return `?${q}`;
}
