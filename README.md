# Tracks & Towns

A mobile-first isometric transport game. You run the transport for a whole region on one shared map, taking on challenges one at a time. Challenges include linking towns, hauling freight, building motorways, suburb junctions, a metro, airports and airport rail links, and fixing disaster damage. Everything you build keeps running. Good service makes towns grow and industries produce more, and that creates new bottlenecks, which turn up as new challenges.

- **Network rules (Locomotion-style):** 8 directions (straights and diagonals). Rail, metro and motorways can only turn 45° per tile, so curves form naturally. Streets can make any junction. Metro tunnels run under buildings.
- **Simulation:** passengers come from town buildings near stations. Freight chains are coal → power station, timber → sawmill → goods, and grain → food plant → goods. Cargo can transfer between lines. Busy streets slow down (motorways carry more), towns grow and densify, and industry production rises with service.
- **Stack:** TypeScript + Vite, custom Canvas 2D isometric renderer, no runtime dependencies. It's a static site on Vercel and a PWA (installable, works offline). Saves are stored on the device.

```bash
npm install
npm run dev      # local dev server
npm test         # simulation + challenge tests (vitest)
npm run build    # typecheck + production build to dist/
```

## Layout
- `src/defs.ts`: cargo, industries, infrastructure, stations, vehicles, technologies
- `src/geo.ts`: 8-direction edge grid, iso projection, smooth path curves, heap
- `src/world.ts`: seeded island, towns with street grids, industries
- `src/sim.ts`: network building, pathfinding with turn limits, stations, vehicles, congestion, growth
- `src/scenarios.ts`: challenge catalogue, board, objectives
- `src/render.ts`: isometric renderer
- `src/main.ts`: UI and touch input
