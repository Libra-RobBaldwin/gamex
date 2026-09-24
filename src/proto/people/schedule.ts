// Rough shapes of a town's day (0–1), for places the economy doesn't yet give numbers for, and
// for the demo. Minutes since midnight in, share of the busiest hour out. The real game should
// replace these with the economy's own flows by hour.
const bump = (m: number, at: number, width: number) => Math.exp(-(((m - at) / width) ** 2));
const day = (m: number) => ((m % 1440) + 1440) % 1440;

export const DAY = {
  // shops: open 9 till half five, busiest at lunch and on the way home
  shops: (m: number) => { const t = day(m); return t < 8.5 * 60 || t > 18 * 60 ? 0.05 : 0.45 + 0.4 * bump(t, 12.8 * 60, 90) + 0.25 * bump(t, 16.8 * 60, 60); },
  // the pub: lunchtime, then evenings
  pub: (m: number) => { const t = day(m); return t < 11.5 * 60 ? 0 : t > 23 * 60 ? 0.05 : 0.25 * bump(t, 13 * 60, 60) + 0.9 * bump(t, 19.5 * 60, 110) + 0.05; },
  // general footfall: the two rush hours and a lunchtime bump
  street: (m: number) => { const t = day(m); return t < 5.5 * 60 ? 0.04 : 0.2 + 0.8 * bump(t, 8.3 * 60, 50) + 0.45 * bump(t, 13 * 60, 90) + 0.75 * bump(t, 17.3 * 60, 70); },
  commute: (m: number) => { const t = day(m); return 0.05 + bump(t, 8.1 * 60, 45) + 0.9 * bump(t, 17.4 * 60, 55); },
  // parks: strollers in the day, dog walkers first thing and after work
  park: (m: number) => { const t = day(m); return t < 6.5 * 60 || t > 21 * 60 ? 0.02 : 0.25 + 0.75 * bump(t, 14 * 60, 180); },
  dogs: (m: number) => { const t = day(m); return t < 6 * 60 || t > 22 * 60 ? 0.05 : 0.2 + 0.9 * bump(t, 7.4 * 60, 50) + bump(t, 18 * 60, 80); },
  joggers: (m: number) => { const t = day(m); return 0.1 + bump(t, 7 * 60, 45) + 0.7 * bump(t, 18.5 * 60, 50); },
  daylight: (m: number) => { const t = day(m); return t > 6 * 60 && t < 20.5 * 60 ? 1 : 0.3; },
};
