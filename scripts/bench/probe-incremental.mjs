#!/usr/bin/env node
// Probe: how fast is a rebuild when Rolldown keeps the module graph warm
// (`watch` + `experimental.incrementalBuild`) compared with a from-scratch build?
//
//   node scripts/bench/probe-incremental.mjs <expo-project> <file-to-edit> [--no-incremental]
//
// Builds the project's native dev bundle in watch mode with vifx's Expo
// plugins, then appends a line to <file-to-edit> a few times and reports the
// duration Rolldown gives for each rebuild. The file is restored at the end.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [projectArg, editArg, ...rest] = process.argv.slice(2);
if (!projectArg || !editArg) {
  console.error("Usage: probe-incremental.mjs <expo-project> <file-to-edit> [--no-incremental]");
  process.exit(2);
}

const projectRoot = path.resolve(projectArg);
const editFile = path.resolve(projectRoot, editArg);
const incremental = !rest.includes("--no-incremental");
const edits = 4;

const expoPluginDir = path.join(REPO_ROOT, "packages/vite-plugin-expo");
const requireFromPlugin = createRequire(path.join(expoPluginDir, "package.json"));
const { build } = await import(pathToFileURL(requireFromPlugin.resolve("vite")).href);
const { expo } = await import(pathToFileURL(path.join(expoPluginDir, "dist/index.mjs")).href);

const outDir = path.join(projectRoot, ".vifx/probe-incremental");
const input = path.join(outDir, "entry.js");
await mkdir(outDir, { recursive: true });
await writeFile(input, 'import "expo-router/entry";\n', "utf8");

const originalSource = await readFile(editFile, "utf8");
const durations = [];
let pendingEdits = edits;
let resolveDone;
const done = new Promise((resolve) => (resolveDone = resolve));

const watcher = await build({
  appType: "custom",
  build: {
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    emptyOutDir: false,
    minify: false,
    outDir: path.join(outDir, "out"),
    rollupOptions: {
      experimental: { incrementalBuild: incremental },
      input,
      output: {
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "chunks/[name].js",
        entryFileNames: "index.bundle",
        format: "es",
      },
    },
    sourcemap: true,
    target: "es2020",
    watch: {},
    write: true,
  },
  configFile: false,
  envFile: false,
  logLevel: "silent",
  plugins: expo({
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
  }),
  publicDir: false,
  root: projectRoot,
});

let bundleStartedAt = 0;
watcher.on("event", async (event) => {
  if (event.code === "BUNDLE_START") {
    bundleStartedAt = performance.now();
  }
  if (event.code === "ERROR") {
    console.error("build error:", event.error?.message ?? event.error);
    resolveDone();
  }
  if (event.code === "BUNDLE_END") {
    durations.push({
      reported: event.duration,
      wall: Math.round(performance.now() - bundleStartedAt),
    });
    await event.result?.close?.();
  }
  if (event.code === "END") {
    if (pendingEdits === 0) {
      resolveDone();
      return;
    }
    pendingEdits -= 1;
    // Let the watcher settle, then make a real content change.
    setTimeout(() => {
      void writeFile(
        editFile,
        `${originalSource}\nglobalThis.__vifxProbe = ${String(Date.now())};\n`,
        "utf8",
      );
    }, 400);
  }
});

await done;
await watcher.close();
await writeFile(editFile, originalSource, "utf8");

const [first, ...rebuilds] = durations;
console.log(`incrementalBuild: ${String(incremental)}`);
console.log(`initial build: ${String(first?.reported)} ms (wall ${String(first?.wall)} ms)`);
console.log(
  `rebuilds: ${rebuilds.map((entry) => `${String(entry.reported)} ms (wall ${String(entry.wall)})`).join(", ")}`,
);
process.exit(0);
