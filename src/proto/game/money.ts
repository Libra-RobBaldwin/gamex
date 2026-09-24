// Money (docs/loop.md, M3). One purse: fares come in from every line's passengers, running costs
// go out for every bus, and building roads, bridges and stops, and buying buses, are charged
// when they're done. You can't build what you can't afford.
//
// A game day stands for a month of the town's life (the economy reviews the town once a game
// day, game/econ.ts), so money comes and goes at a month's pace each day. The numbers are the
// game's, not an operator's books; they're here in one place to tune:
export const FARE = 2; // £ a passenger, whatever the distance (the UK's capped bus fare)
export const MONTH = 30; // days of the town's life in each game day
export const PRICE_SHARE = 0.1; // of the list prices (roads, bridges, stops, vehicles)
export const START = 400_000; // £ in the bank on a new game
// running a bus for a game day (its month): driver, fuel, upkeep
export const RUNNING: Record<'minibus' | 'bus' | 'decker' | 'coach' | 'dmu' | 'tram' | 'rack' | 'intercity' | 'hs', number> = {
  minibus: 700, bus: 1100, decker: 1300, coach: 1500,
  dmu: 4000, tram: 3500, rack: 3500, intercity: 9000, hs: 14000, // a train for a game day
};

export interface Books { fares: number; running: number; building: number; vehicles: number; sold: number }
const empty = (): Books => ({ fares: 0, running: 0, building: 0, vehicles: 0, sold: 0 });

export class Purse {
  balance = START;
  today = empty(); // since the start of this game day
  yesterday = empty();
  byLine = new Map<number, { fares: number; running: number; lastFares: number; lastRunning: number }>();
  private listeners: (() => void)[] = [];

  price(list: number) { return Math.round((list * PRICE_SHARE) / 100) * 100; }
  can(amount: number) { return amount <= this.balance + 1e-6; }
  onChange(f: () => void) { this.listeners.push(f); }
  private changed() { for (const f of this.listeners) f(); }

  // building and buying: false (and nothing charged) if there isn't the money
  spend(amount: number, what: 'building' | 'vehicles') {
    if (!this.can(amount)) return false;
    this.balance -= amount;
    this.today[what] += amount;
    this.changed();
    return true;
  }
  // a bus sold second-hand
  refund(amount: number) { this.balance += amount; this.today.sold += amount; this.changed(); }

  // a line's takings and running costs as they come (the balance may go below zero on running
  // costs: buses keep running, but nothing new can be bought)
  flow(line: number, fares: number, running: number) {
    let b = this.byLine.get(line);
    if (!b) this.byLine.set(line, (b = { fares: 0, running: 0, lastFares: 0, lastRunning: 0 }));
    b.fares += fares; b.running += running;
    this.today.fares += fares; this.today.running += running;
    this.balance += fares - running;
    this.changed();
  }
  newDay() {
    this.yesterday = this.today;
    this.today = empty();
    for (const b of this.byLine.values()) { b.lastFares = b.fares; b.lastRunning = b.running; b.fares = 0; b.running = 0; }
  }
  line(id: number) { return this.byLine.get(id) ?? { fares: 0, running: 0, lastFares: 0, lastRunning: 0 }; }

  // ---------- saving (game/save.ts) ----------
  save(): PurseSave { return { balance: this.balance, today: { ...this.today }, yesterday: { ...this.yesterday }, byLine: [...this.byLine].map(([id, b]) => [id, { ...b }]) }; }
  load(s: PurseSave) {
    this.balance = s.balance;
    this.today = { ...empty(), ...s.today };
    this.yesterday = { ...empty(), ...s.yesterday };
    this.byLine = new Map(s.byLine.map(([id, b]) => [id, { ...b }]));
    this.changed();
  }
}
export interface PurseSave { balance: number; today: Books; yesterday: Books; byLine: [number, { fares: number; running: number; lastFares: number; lastRunning: number }][] }

export const money = (n: number) => `${n < 0 ? '−' : ''}£${Math.round(Math.abs(n)).toLocaleString('en-GB')}`;
