# Gielinor Haulage

A mobile-first pixel-art idle/transport game. Gather resources in the style of old-school RuneScape skills and build a road, rail and glider network in the style of Transport Fever to feed industries and towns.

- **Stack:** TypeScript + Vite, a custom Canvas 2D renderer, no runtime dependencies. It's a static site on Vercel.
- **Saves:** stored on the device in localStorage. Vehicles keep running for up to 12 hours while you're away.
- **PWA:** add it to your home screen and it plays full-screen and offline.

```bash
npm install
npm run dev      # local dev server
npm test         # simulation tests (vitest)
npm run build    # typecheck + production build to dist/
```

## Layout
- `src/data.ts`: skills, XP table, cargo, buildings, vehicles, costs
- `src/world.ts`: seeded world generation
- `src/sim.ts`: simulation (production, catchment, vehicles, economy) and player actions
- `src/render.ts`, `src/sprites.ts`: canvas renderer and hand-made 16×16 sprites
- `src/main.ts`: UI, touch input (drag to build, two fingers to pan and pinch)
- `src/tasks.ts`: guided task list
