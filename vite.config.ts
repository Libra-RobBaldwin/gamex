import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // relative asset paths: dist works at a site's root (Vercel) and from any sub-folder alike
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        proto: resolve(__dirname, 'proto.html'),
        places: resolve(__dirname, 'places.html'),
        ground: resolve(__dirname, 'ground-demo.html'),
        bridges: resolve(__dirname, 'bridges-demo.html'),
        industries: resolve(__dirname, 'industries-demo.html'),
        buildings: resolve(__dirname, 'buildings-demo.html'),
        people: resolve(__dirname, 'people-demo.html'),
        vehicles: resolve(__dirname, 'vehicles-demo.html'),
        water: resolve(__dirname, 'water-demo.html'),
      },
    },
  },
  // Agents' git worktrees live under .claude/: changes there mustn't reload the pages being served.
  server: { watch: { ignored: ['**/.claude/**'] } },
  // Agents' git worktrees live under .claude/ and parked tests under docs/; neither is this checkout's suite.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', 'docs/**', 'e2e/**'],
    // Geometry and benchmark tests run for seconds on a shared machine; 5 s is a hang guard, not a
    // budget (the tests assert their own time budgets).
    testTimeout: 30_000,
  },
});
