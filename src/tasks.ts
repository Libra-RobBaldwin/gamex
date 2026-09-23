// Guided task list (a light "quest log") that teaches the loop and pays rewards.
import { VEHICLES } from './data';
import type { Game } from './sim';

export interface Task {
  title: string;
  hint: string;
  reward: number;
  done: (g: Game) => boolean;
}

const servesKind = (g: Game, kinds: string[]) =>
  g.s.stations.some((st) => g.catchmentOf(st).some((b) => kinds.includes(b.kind)));

export const TASKS: Task[] = [
  {
    title: 'Timber!',
    hint: 'Pick 🚏 Stop and place a road stop within 2 tiles of the trees near the start town.',
    reward: 60,
    done: (g) => servesKind(g, ['tree']),
  },
  {
    title: 'Mill it',
    hint: 'Place another road stop next to the Sawmill.',
    reward: 60,
    done: (g) => servesKind(g, ['sawmill']),
  },
  {
    title: 'Pave the way',
    hint: 'Pick 🛤 Road and drag a road between the two stops.',
    reward: 80,
    done: (g) => g.s.infra.some((t) => t & 1) && g.s.stations.length >= 2,
  },
  {
    title: 'Hitch the ox',
    hint: 'Pick 🐂 Vehicle, choose an Ox cart, then tap the tree stop and the sawmill stop.',
    reward: 150,
    done: (g) => g.s.vehicles.length > 0,
  },
  {
    title: 'Plank run',
    hint: 'Put a stop by the town, link it to the sawmill stop and run a cart. Towns pay well for planks.',
    reward: 250,
    done: (g) => (g.s.stats.delivered.planks ?? 0) > 0,
  },
  {
    title: 'Pay-dirt',
    hint: 'Serve the copper and tin rocks and haul both ores to a Furnace to smelt bronze.',
    reward: 400,
    done: (g) => (g.s.stats.produced.bronze_bar ?? 0) > 0,
  },
  {
    title: 'Gone fishing',
    hint: 'Serve a fishing spot, cook the fish at a Cooking range, sell it in a town.',
    reward: 400,
    done: (g) => (g.s.stats.delivered.cooked_fish ?? 0) > 0,
  },
  {
    title: 'Iron horse',
    hint: 'Reach Transport level 12 to unlock rail. Keep deliveries flowing — longer routes give more XP.',
    reward: 1000,
    done: (g) => g.level('transport') >= 12,
  },
  {
    title: 'All aboard',
    hint: 'Build two rail stations, join them with 🚆 Rail and buy a Mine train.',
    reward: 1500,
    done: (g) => g.s.vehicles.some((v) => VEHICLES[v.type].mode === 'rail'),
  },
  {
    title: 'Gnome air',
    hint: 'At Transport 20 you can build Glider pads. Gliders fly straight over mountains and sea.',
    reward: 3000,
    done: (g) => g.s.vehicles.some((v) => VEHICLES[v.type].mode === 'air'),
  },
  {
    title: 'Man of steel',
    hint: 'At Mining 30 & Smithing 30, feed a furnace iron ore and coal to make steel bars.',
    reward: 6000,
    done: (g) => (g.s.stats.produced.steel_bar ?? 0) > 0,
  },
  {
    title: 'Tycoon',
    hint: 'Earn 250,000 coins in total. Hot-air balloons unlock at Transport 40.',
    reward: 25000,
    done: (g) => g.s.stats.earned >= 250_000,
  },
];

export function currentTask(g: Game): Task | null {
  return TASKS[g.s.stats.tasksDone] ?? null;
}

// Completes any finished tasks in order; returns the ones just completed.
export function checkTasks(g: Game): Task[] {
  const out: Task[] = [];
  let t = currentTask(g);
  while (t && t.done(g)) {
    g.s.coins += t.reward;
    g.s.stats.tasksDone++;
    out.push(t);
    t = currentTask(g);
  }
  return out;
}
