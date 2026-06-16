#!/usr/bin/env node
// Proves, with no device and no runtime, that each user Vite/Rollup plugin in
// vite.config.vifx.ts actually transformed the React Native bundle: it greps the
// built bundle for each plugin's unique output (and asserts the pre-transform
// token is GONE for the transform plugin).
//
// Usage: node scripts/verify-bundle.mjs [path-to-bundle]
//   default path: dist/index.bundle

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.resolve(process.argv[2] ?? path.join(here, "..", "dist", "index.bundle"));

let bundle;
try {
  bundle = readFileSync(bundlePath, "utf8");
} catch {
  console.error(`✗ Could not read bundle at ${bundlePath}.`);
  console.error("  Build it first: vifx export:embed . --platform ios --dev false \\");
  console.error("    --bundle-output dist/index.bundle");
  process.exit(2);
}

// Each plugin's greppable sentinel. Kept in sync with the plugins/* sources.
const VIRTUAL_SENTINEL = "VIFX_VIRTUAL_MODULE_SENTINEL_8f3a2c1d";
const BUILD_STAMP_VALUE = "vifx-build-stamp-7b91e4a0";
const BUILD_STAMP_TOKEN = "__VIFX_BUILD_STAMP__";
const YAML_RELEASE_CHANNEL = "yaml-channel-c4d5e6f7";
const YAML_APP_NAME = "vifx-example-vite-plugins";

const checks = [
  {
    plugin: "example:virtual-module",
    label: "virtual module sentinel is present",
    ok: bundle.includes(VIRTUAL_SENTINEL),
    needle: VIRTUAL_SENTINEL,
  },
  {
    plugin: "example:build-stamp",
    label: "transform replacement value is present",
    ok: bundle.includes(BUILD_STAMP_VALUE),
    needle: BUILD_STAMP_VALUE,
  },
  {
    plugin: "example:build-stamp",
    label: "pre-transform token is absent (transform really ran)",
    ok: !bundle.includes(BUILD_STAMP_TOKEN),
    needle: `NOT ${BUILD_STAMP_TOKEN}`,
  },
  {
    plugin: "example:yaml",
    label: "yaml releaseChannel value is present",
    ok: bundle.includes(YAML_RELEASE_CHANNEL),
    needle: YAML_RELEASE_CHANNEL,
  },
  {
    plugin: "example:yaml",
    label: "yaml appName value is present",
    ok: bundle.includes(YAML_APP_NAME),
    needle: YAML_APP_NAME,
  },
];

let failed = 0;
console.log(`Verifying ${bundlePath}\n`);
for (const check of checks) {
  const mark = check.ok ? "✓" : "✗";
  if (!check.ok) {
    failed += 1;
  }
  console.log(`  ${mark} [${check.plugin}] ${check.label}  (${check.needle})`);
}

console.log("");
if (failed > 0) {
  console.error(`✗ ${failed} check(s) failed — a plugin did not affect the bundle.`);
  process.exit(1);
}
console.log("✓ All plugins proven: their output is present in the built native bundle.");
