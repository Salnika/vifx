#!/usr/bin/env node
// Probe: Rolldown's native dev engine (`dev()` from rolldown/experimental) on a
// real Expo project. Reports the initial build time, then for a few edits of
// <file-to-edit> the time until the HMR patch arrives and the time to bring
// the full bundle up to date. The file is restored at the end.
//
//   node scripts/bench/probe-dev-engine.mjs <expo-project> <file-to-edit> [--dump <dir>]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [projectArg, editArg, ...rest] = process.argv.slice(2);
if (!projectArg || !editArg) {
  console.error("Usage: probe-dev-engine.mjs <expo-project> <file-to-edit> [--dump <dir>]");
  process.exit(2);
}

const projectRoot = path.resolve(projectArg);
const editFile = path.resolve(projectRoot, editArg);
const dumpIndex = rest.indexOf("--dump");
const dumpDir = dumpIndex === -1 ? null : path.resolve(rest[dumpIndex + 1] ?? ".bench/dev-engine");
const edits = 4;

const expoPluginDir = path.join(REPO_ROOT, "packages/vite-plugin-expo");
const requireFromPlugin = createRequire(path.join(expoPluginDir, "package.json"));
const { dev } = await import(
  pathToFileURL(requireFromPlugin.resolve("vite/rolldown/experimental")).href
);
const { expo } = await import(pathToFileURL(path.join(expoPluginDir, "dist/index.mjs")).href);

const outDir = path.join(projectRoot, ".vifx/probe-dev-engine");
const input = path.join(outDir, "entry.js");
await mkdir(outDir, { recursive: true });
await writeFile(input, 'import "expo-router/entry";\n', "utf8");

const plugins = expo({
  aliases: { "@": "." },
  entry: "expo-router/entry",
  mode: "development",
  platform: "ios",
  projectRoot,
  reactNativeCompat: "none",
  resolvePlatform: "ios",
  reuseResolverCaches: true,
  shimJsxRuntime: false,
  shimReact: false,
  shimReactNative: false,
});

// The plugins are Vite plugins: their `config()` hook carries the defines Vite
// would hand to Rolldown. Collect them by hand since no Vite build runs here.
const define = {};
for (const plugin of plugins) {
  const partial = typeof plugin.config === "function" ? await plugin.config({}, {}) : null;
  Object.assign(define, partial?.define ?? {});
}

const originalSource = await readFile(editFile, "utf8");
let outputCount = 0;
let lastOutput = null;
let resolvePatch = null;
const patches = [];

const startedAt = performance.now();
const engine = await dev(
  {
    cwd: projectRoot,
    experimental: { devMode: {} },
    input,
    plugins: plugins.map(({ config: _config, enforce: _enforce, ...plugin }) => plugin),
    transform: { define },
  },
  {
    dir: path.join(outDir, "out"),
    entryFileNames: "index.bundle",
    format: "es",
    sourcemap: !rest.includes("--no-sourcemap"),
  },
  {
    onHmrUpdates(result) {
      resolvePatch?.(result);
    },
    onOutput(result) {
      outputCount += 1;
      lastOutput = result;
    },
    rebuildStrategy: "never",
    watch: { debounceDuration: 10, skipWrite: true },
  },
);
await engine.run();
await engine.ensureCurrentBuildFinish();
console.log(`initial build: ${String(Math.round(performance.now() - startedAt))} ms`);
if (lastOutput instanceof Error) {
  console.error("initial build failed:", lastOutput.message);
  await engine.close();
  process.exit(1);
}
const entryChunk = lastOutput?.output?.find((item) => item.type === "chunk" && item.isEntry);
console.log(
  `chunks: ${String(lastOutput?.output?.length)}; entry bytes: ${String(entryChunk?.code.length)}`,
);
if (dumpDir && entryChunk) {
  await mkdir(dumpDir, { recursive: true });
  await writeFile(path.join(dumpDir, "initial.bundle.js"), entryChunk.code, "utf8");
}

const clientId = "probe-client";
await engine.registerClient(clientId);

for (let index = 0; index < edits; index += 1) {
  const patch = new Promise((resolve) => (resolvePatch = resolve));
  const editedAt = performance.now();
  await writeFile(
    editFile,
    `${originalSource}\nglobalThis.__vifxProbe = ${String(Date.now())};\n`,
    "utf8",
  );
  const result = await Promise.race([
    patch,
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 10_000)),
  ]);
  const patchMs = Math.round(performance.now() - editedAt);
  if (result === "timeout" || result instanceof Error) {
    console.log(`edit ${String(index + 1)}: no patch (${String(result?.message ?? result)})`);
    continue;
  }
  const update = result.updates[0]?.update;
  patches.push(update);
  const outputsBefore = outputCount;
  const bundleStartedAt = performance.now();
  await engine.ensureLatestBuildOutput();
  const bundleMs = Math.round(performance.now() - bundleStartedAt);
  console.log(
    `edit ${String(index + 1)}: patch in ${String(patchMs)} ms (type ${String(update?.type)}, ${String(update?.code?.length ?? 0)} bytes, clients ${String(result.updates.length)}); full bundle refreshed in ${String(bundleMs)} ms (outputs +${String(outputCount - outputsBefore)})`,
  );
  if (update?.filename) {
    await engine.notifyPayloadDelivered(update.filename);
  }
  if (dumpDir && update?.code && index === 0) {
    await writeFile(path.join(dumpDir, "patch-0.js"), update.code, "utf8");
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
}

await writeFile(editFile, originalSource, "utf8");
await engine.close();
process.exit(0);
