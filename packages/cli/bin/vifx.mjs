#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entryPath = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    "--disable-warning=ExperimentalWarning",
    "--experimental-transform-types",
    entryPath,
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
