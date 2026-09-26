// The start menu's settings, kept in localStorage. Storage can be blocked (a private window, a
// sandboxed frame, a full disk), and then every read and write throws: this falls back to memory,
// so the app still works and simply forgets when the page closes.

const memory = new Map<string, string>();

export function load(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch { /* blocked: memory only */ }
  return memory.get(key) ?? null;
}

export function save(key: string, value: string | null) {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* blocked: remembered until the page closes */ }
}

export const KEYS = {
  /** 'auto', or a quality tier's index (0 High … 4 Fastest, as in main.ts TIERS) */
  quality: 'untitled.quality',
  /** '1' once the first-visit guide has been finished or skipped */
  guide: 'untitled.guide.seen',
  /** the region options last started, as a query (region/options.ts optionsQuery) */
  region: 'untitled.region',
} as const;

// the game's quality tiers, in main.ts TIERS order (the menu can't load main.ts to read them)
export const TIER_NAMES = ['High', 'Good', 'Balanced', 'Fast', 'Fastest'];
export const TIER_NOTES = ['Sharpest, with full shadows', 'A little softer, full shadows', 'Softer, lighter shadows', 'Low resolution, shadows now and then', 'Low resolution, no shadows'];

export function quality(): number | 'auto' {
  const v = load(KEYS.quality);
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) && n >= 0 && n < TIER_NAMES.length ? n : 'auto';
}
export const setQuality = (q: number | 'auto') => save(KEYS.quality, String(q));
export const guideSeen = () => load(KEYS.guide) === '1';
export const setGuideSeen = (seen: boolean) => save(KEYS.guide, seen ? '1' : null);

/** Forget every setting this app keeps in localStorage (Settings > Delete all saved data). */
export function forgetSettings() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('untitled.')) localStorage.removeItem(k); } catch { /* storage blocked: nothing kept */ }
}
