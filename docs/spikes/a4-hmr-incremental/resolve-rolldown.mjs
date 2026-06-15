// Locates the `rolldown` package even though vifx pulls it in only as a
// transitive dependency of Vite (so a bare `import "rolldown"` does not
// resolve from the repo root). Tries, in order:
//   1. plain resolution (`rolldown` is a direct dep),
//   2. resolution relative to the installed `vite` package,
//   3. the pnpm content-addressed store glob.
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

function tryResolve() {
  try {
    return require.resolve("rolldown");
  } catch {}
  try {
    const vite = require.resolve("vite");
    return require.resolve("rolldown", { paths: [vite] });
  } catch {}
  // pnpm store: node_modules/.pnpm/rolldown@*/node_modules/rolldown/dist/index.mjs
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const store = join(dir, "node_modules", ".pnpm");
    if (existsSync(store)) {
      const match = readdirSync(store).find((d) => d.startsWith("rolldown@"));
      if (match) {
        const entry = join(store, match, "node_modules", "rolldown", "dist", "index.mjs");
        if (existsSync(entry)) return entry;
      }
    }
    dir = join(dir, "..");
  }
  throw new Error(
    "Could not resolve `rolldown`. Run this spike from a repo where `vp install` has populated node_modules.",
  );
}

const { rolldown } = await import(tryResolve());
export { rolldown };
