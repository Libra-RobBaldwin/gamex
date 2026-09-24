// Which world the game starts in. See docs/world-start.md.
import { inventedWorld } from './invented';
import { REAL_TOWN, realWorld, settleStanding } from './real';
import { chooseTown, chosenTown, type TownId, type World } from './world';

export * from './world';
export { REAL_TOWN, settleStanding };

export function startWorld(id: TownId, rand: () => number): World {
  return id === 'invented' ? inventedWorld(rand) : realWorld();
}
/** The towns Menu → New town offers, the default first. */
export const TOWNS: { id: TownId; label: string; sub: string }[] = [
  { id: 'real', label: `${REAL_TOWN.name} (real)`, sub: REAL_TOWN.standIn ? `From OpenStreetMap · standing in for ${REAL_TOWN.standIn} until its map data is fetched` : 'From OpenStreetMap' },
  { id: 'invented', label: 'Invented town', sub: 'The hand-laid seed town' },
];
export { chooseTown, chosenTown };
