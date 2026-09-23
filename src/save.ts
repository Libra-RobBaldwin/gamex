// Local save/load. Progress lives on the device (localStorage).
import type { GameState } from './sim';

const KEY = 'gielinor-haulage-save-v1';

interface SaveBlob extends Omit<GameState, 'terrain' | 'infra'> {
  terrain: string;
  infra: string;
  savedAt: number;
}

const enc = (a: Uint8Array) => Array.from(a, (n) => String.fromCharCode(48 + n)).join('');
const dec = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) - 48);

export function save(s: GameState): void {
  const blob: SaveBlob = { ...s, terrain: enc(s.terrain), infra: enc(s.infra), savedAt: Date.now() };
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
    const { savedAt, terrain, infra, ...rest } = JSON.parse(raw) as SaveBlob;
    if (rest.v !== 1) return null;
    return { state: { ...rest, terrain: dec(terrain), infra: dec(infra) }, savedAt };
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
