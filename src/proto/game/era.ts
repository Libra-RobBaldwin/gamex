// One game year for everything that depends on the era: vehicle models, liveries and
// plates, bridge types, industry variants, people's clothes. Every system reads it from
// here rather than keeping its own, so a change of decade reaches them all at once.
let year = 2025;
const listeners = new Set<(y: number) => void>();

export const gameYear = () => year;

export function setGameYear(y: number) {
  y = Math.round(y);
  if (y === year) return;
  year = y;
  for (const f of listeners) f(y);
}

// Returns an unsubscribe function.
export function onYearChange(f: (y: number) => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}
