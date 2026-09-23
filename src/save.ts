// Local save/load. Progress lives on the device (localStorage).
import type { GameState } from './sim';

const KEY = 'tracks-and-towns-v2';
const ARRAYS = ['terrain', 'bld', 'road', 'rail', 'metro'] as const;

const b64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function save(s: GameState): void {
  const blob: Record<string, unknown> = { ...s, savedAt: Date.now() };
  for (const k of ARRAYS) blob[k] = b64(s[k]);
  blob.bldTown = b64(new Uint8Array(s.bldTown.buffer, s.bldTown.byteOffset, s.bldTown.byteLength));
  try {
    localStorage.setItem(KEY, JSON.stringify(blob));
  } catch {
    /* storage unavailable: play on without saving */
  }
}

export function load(): { state: GameState; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (b.v !== 2) return null;
    for (const k of ARRAYS) b[k] = unb64(b[k]);
    const bt = unb64(b.bldTown);
    b.bldTown = new Int16Array(bt.buffer, 0, bt.byteLength / 2);
    const savedAt = b.savedAt as number;
    delete b.savedAt;
    return { state: b as GameState, savedAt };
  } catch {
    return null;
  }
}

export function wipe(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
