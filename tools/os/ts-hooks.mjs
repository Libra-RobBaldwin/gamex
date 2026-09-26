// Node resolve hooks for the bake tools: the game's TypeScript imports its own modules without an
// extension (Vite resolves them); this tries `.ts` (and `/index.ts`) for a relative import Node can't
// find, so node --import ./tools/os/ts-register.mjs can run the game's pure code (Node strips types).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith('.') || spec.startsWith('/')) && !/\.[cm]?[jt]s$|\.json$/.test(spec)) {
    for (const ext of ['.ts', '/index.ts']) {
      const u = new URL(spec + ext, ctx.parentURL);
      if (existsSync(fileURLToPath(u))) return next(u.href, ctx);
    }
  }
  return next(spec, ctx);
}
