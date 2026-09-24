import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        proto: resolve(__dirname, 'proto.html'),
      },
    },
  },
  // Agents' git worktrees live under .claude/ and parked tests under docs/; neither is this checkout's suite.
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', 'docs/**'] },
});
