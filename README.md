# Tracks & Towns

A mobile-first isometric transport game. You run the transport for a whole region on one shared map, taking on challenges one at a time. Challenges include linking towns, hauling freight, building motorways, suburb junctions, a metro, airports and airport rail links, and fixing disaster damage. Everything you build keeps running. Good service makes towns grow and industries produce more, and that creates new bottlenecks, which turn up as new challenges.

- **Network rules (Locomotion-style):** 8 directions (straights and diagonals). Rail, metro and motorways can only turn 45° per tile, so curves form naturally. Streets can make any junction. Metro tunnels run under buildings.
- **Simulation:** passengers come from town buildings near stations. Freight chains are coal → power station, timber → sawmill → goods, and grain → food plant → goods. Cargo can transfer between lines. Busy streets slow down (motorways carry more), towns grow and densify, and industry production rises with service.
- **Stack:** TypeScript + Vite + three.js. It's a static site on Vercel (the game is the front page, https://gamex-nu.vercel.app) and a PWA (installable, works offline).

```bash
npm install
npm run dev      # local dev server
npm test         # simulation + challenge tests (vitest)
npm run build    # typecheck + production build to dist/
```

## Layout
- `index.html` → `src/app/main.ts`: the start menu (New game, How to play, Settings, About) and the guided start. It loads the game, `src/proto/main.ts` (3D, three.js), only when a map is picked; `/?map=<id>` deep links go straight in. The maps are listed in `src/proto/maps.ts`. The game's HUD is `src/proto/ui/shell.ts` (see `docs/hud.md`).
- `src/proto/`: the game's systems: roads, junctions, traffic, economy, and the libraries (bridges, industries, vehicles, people, water, ground, terrain).
- `*-demo.html`: a page per library, for trying it on its own. `places.html` is Real Town Plans (`src/places`).
- `proto.html`: redirects old links to the front page.
- `src/defs.ts`, `src/sim.ts`, `src/world.ts`, `src/scenarios.ts`, `src/geo.ts`: the first 2D prototype's data and simulation. Its screen is retired; the game still uses `defs.ts`, and `sim.test.ts` still covers the rest.
