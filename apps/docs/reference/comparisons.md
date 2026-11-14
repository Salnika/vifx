# vifx vs Metro

vifx replaces Metro as the bundling engine for React Native and Expo. The two tools solve the same problem — turn an app's source graph into a JavaScript bundle, source maps, assets, and (optionally) Hermes bytecode — but they are built on different foundations, and most of the differences come from there.

Metro transforms each file in isolation through a fixed Babel pipeline and serializes the result into its own closed `__d`/`__r` module registry. It has no plugin protocol, no cross-module scope hoisting, and a bespoke config schema unrelated to the rest of the JavaScript toolchain.

vifx is a single Vite/Rolldown engine. Your app is a real Rolldown module graph: every standard Vite/Rollup hook (`resolveId`, `load`, `transform`, `renderChunk`) is available, the release bundle is scope-hoisted, and the config is a plain Vite `defineConfig`. The same engine drives native and web from one resolution layer and one define/env table.

This page covers the structural differences, the [measured results](#measured-results) on one app, and the places where Metro is on par or ahead.

## At a glance

| Capability                         | Metro                                                      | vifx                                                                            |
| ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Plugin model                       | Closed `__d`/`__r` registry; fixed Babel pipeline          | Open Vite/Rollup plugin graph (svgr, unplugin-icons, mdx, virtual modules)      |
| Native + web                       | Native bundler; web goes through a separate Metro-web path | One engine, one config, one define/env table for both                           |
| Release output                     | `__d`/`__r` registry preserved in release                  | Scope-hoisted IIFE with cross-module tree-shaking                               |
| Modern ESM / `import.meta`         | Handled by CJS translation + interop shims                 | First-class graph input; `import.meta.env` inlined                              |
| Fast Refresh                       | Module registry, incremental rebuilds                      | Rolldown dev engine: patches of the changed modules, Metro's Fast Refresh rules |
| Per-save output                    | Bundling progress lines in the terminal                    | One line per save (outcome, reason, time); NDJSON reports with `--json`         |
| Config surface                     | Bespoke `metro.config.js` schema                           | Standard `vite.config.vifx.ts` (`defineConfig`)                                 |
| Warm release build (benchmark app) | 8.71 s                                                     | 1.57 s                                                                          |
| Hermes bytecode (benchmark app)    | 4.96 MB                                                    | 5.15 MB (+3.9 %, see [below](#where-metro-is-on-par-or-ahead))                  |
| Web target                         | react-native-web supported                                 | Companion dev target by design                                                  |

The sections below go through the structural differences, then the measured results, then the rows where Metro is on par or ahead.

## Open plugin graph vs a closed registry

This is the single biggest structural difference. vifx auto-detects and loads your project's `vite.config.vifx.{ts,mts,js,mjs}` through Vite's own `loadConfigFromFile`, merges the allowed slices, and appends your plugins after its own. Any standard Vite or Rollup plugin runs against a React Native bundle:

```ts
// vite.config.vifx.ts — any Vite/Rollup plugin works on the RN app
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
});
```

The injection seam is one composition point shared by every native, web, and dev call-site, so a plugin you add behaves identically across targets. vifx's own plugins always run physically first, which means a user plugin can never shadow `.ios`/`.native` resolution, and the keys vifx must own are re-imposed after the merge. See [Config](./config) for the full allow-list of user-contributable Vite keys.

Metro has no equivalent. Because it transforms files one at a time and serializes into its own registry, there is no `resolveId`/`load`/`transform`/`renderChunk` protocol to hook into — the entire Vite/Rollup plugin ecosystem is structurally unavailable. Matching a single svgr-style transform in Metro means writing a custom Babel transformer wired through `transformer.babelTransformerPath`, not dropping in a community plugin.

## Native and web from one engine

vifx drives native (`platform: "ios" | "android"`) and web (`reactNativeCompat: "web"`, which rewires imports to react-native-web) through the same Babel → OXC → Rolldown pipeline. A single `resolveDefines` function is the sole source of the compile-time define table for both targets: `__DEV__`, `global`, `process.env.NODE_ENV`, `process.env.EXPO_OS` (native only), and every public env var.

Public env vars — default prefix `EXPO_PUBLIC_`, configurable via `publicEnvPrefix` — are filtered, sorted for byte-stability, and each emitted as **both** `import.meta.env.<KEY>` and `process.env.<KEY>`, for native and web alike:

```sh
EXPO_PUBLIC_API_URL=https://api.example.com npx vifx export:embed . \
  --platform ios --dev false --bundle-output ios.bundle
```

Platform resolution (`.ios` / `.android` / `.native` / `.web`) is one resolver with a single priority table, so a `Component.ios.tsx` wins on iOS and `Component.native.tsx` is the cross-platform fallback — identical semantics to Metro, in one place that both native and web read.

Metro is the native bundler; web for Expo goes through a separate Metro-web / react-native-web path with its own config and env handling. vifx unifies them because both targets are the same Rolldown engine differing only by resolution platform and output format.

## Scope-hoisting and cross-module tree-shaking in release

vifx emits release builds as a single scope-hoisted bundle wrapped in an IIFE (`format: "iife"`, `inlineDynamicImports`, `entryFileNames: "index.bundle"`), because Hermes and JSC evaluate the bundle in a non-module context. This keeps Rolldown's cross-module dead-code elimination and inlining. On the benchmark app, the release JS bundle is 3.37 MB against Metro's 3.54 MB (−4.9 %); gzipped, both are 0.88 MB.

The release source map lists 1,629 modules against Metro's 2,007. Part of that difference is tree-shaking: Metro ships all of `@expo/vector-icons`' glyph maps, where vifx keeps the ones the app uses. Part of it was a vifx defect, since fixed: `expo-router` and `@react-navigation/*` modules had no entry in its source map, although their code was in the bundle. These figures predate the fix.

Metro's output **is** the `__d`/`__r` module registry even in release — every module stays a separately-wrapped CommonJS factory behind the registry indirection. There is no cross-module scope hoisting; Metro does within-module minification and optional inline-requires only. vifx can serialize to that registry layout too (its `metro` module format); in a June 2026 measurement, that layout produced larger Hermes bytecode than vifx's hoisted output, which is consistent with the registry giving up cross-module hoisting.

Release minification uses the OXC minifier built into the toolchain. React Native ships one direct `eval` that would otherwise disable global identifier mangling, so a behavior-preserving rewrite turns `eval(` into `(0,eval)(` before minify, letting OXC mangle the whole bundle.

## Modern ESM as first-class input

vifx ingests the modern dual-CJS/ESM ecosystem natively: it resolves `import.meta`, honors ESM `exports` conditions, and inlines `import.meta.env`. The native output is a guaranteed script IIFE, so no residual `import` / `export` / `import.meta` can reach Hermes — that closes an entire fragility class around residual ESM.

Metro's transform and runtime are built around CommonJS `__d`/`__r`. `import.meta` and modern `exports`-map resolution are handled by translation rather than as a native graph, and dual-package deps have historically needed interop shims.

## Content-addressed transform cache and warm builds

The transform cache keys every entry by SHA-256 of a stable stringify of its key parts combined with a cache version, stored at `<projectRoot>/.vifx/cache/transforms/<hash[0..2]>/<hash>.json` with atomic temp-file renames. The version key mixes the cache format with the plugin, Vite, and project Babel versions, so a tool bump invalidates everything automatically. Disable it per target with `transformCache: false`.

On a warm build, unchanged files are read back from this cache instead of being transformed again. Measured with `export:embed` on the benchmark app:

| Build             | Metro   | vifx   |
| ----------------- | ------- | ------ |
| Release, cold     | 15.18 s | 4.55 s |
| Release, warm     | 8.71 s  | 1.57 s |
| Development, cold | 12.78 s | 4.73 s |
| Development, warm | 9.05 s  | 1.43 s |

Cold builds start with both tools' caches cleared. During a cold build, the Babel transforms that miss the cache run on worker threads (see [Babel worker threads](../guide/dev-server#babel-worker-threads)).

## Fast Refresh and per-save output

In `vifx expo dev --expo-go`, Fast Refresh runs on Rolldown's dev engine by default: the module graph stays in memory, a save compiles only the changed modules into a patch, and the app applies it with Metro's Fast Refresh rules. Each save prints one line once the app has applied it:

```text
fast refresh  app/(tabs)/index.tsx  36ms
```

`--json` keeps stdout as NDJSON: a server snapshot line, then one report per save with the outcome (`fast-refresh`, `reload` or `error`), the changed files, the number of modules re-run, the reason for a reload, and the time from save to applied:

```sh
npx vifx expo dev . --expo-go --platform ios --json > saves.ndjson
```

On the benchmark app, an edit reached the app as a Fast Refresh update in 0.05 s, against 0.14 s for Metro, both measured on the `/hot` socket. See [Dev Server and Fast Refresh](../guide/dev-server) for how it works and for its limitations, and [CLI](./cli#vifx-expo-dev) for the flags.

## Standard config and standard tooling

Your user config is a plain Vite `vite.config.vifx.ts` loaded by Vite itself. vifx re-imposes only the keys it must own — `resolve.conditions`/`dedupe`, the `__DEV__`/`global`/`NODE_ENV`/`EXPO_OS` defines, and (on the `--fast-refresh` registry path) the `build.rollupOptions.output` layout — and warns with `VIFX_USER_VITE_CONFIG_CONFLICT` when a user override is neutralized. The reserved and allowed key sets are explicit and platform-conditional.

Metro's config is a bespoke `metro.config.js` schema (`resolver` / `transformer` / `serializer`) with no relation to the broader JavaScript tooling conventions. vifx's config is the same surface a web Vite project already uses. Generate it with:

```sh
npx vifx vite init --write
```

See [Config](./config) for the schema and [Getting Started](../guide/getting-started) for the first run.

## Measured results

All figures come from one app, HNewsPro: a private Expo SDK 54 app (React Native 0.81, expo-router, about 2,000 modules) installed with pnpm's default isolated layout, built for iOS on one machine (Apple M4 Pro, 14 cores, 24 GB) in November 2026. Metro is the project's own `expo export:embed` and `expo start`; vifx is `vifx export:embed` and `vifx expo dev --expo-go`. Warm figures are the median of 3 runs; cold figures are one run with the caches cleared first. Memory is the peak of the sum over the process tree, sampled every 100 ms, so Metro's worker processes and vifx's worker threads both count.

| Measure                                        | Metro    | vifx     | Difference                                                            |
| ---------------------------------------------- | -------- | -------- | --------------------------------------------------------------------- |
| `export:embed` release, cold                   | 15.18 s  | 4.55 s   | −70.0 %                                                               |
| `export:embed` release, warm                   | 8.71 s   | 1.57 s   | −82.0 %                                                               |
| `export:embed` dev, cold                       | 12.78 s  | 4.73 s   | −63.0 %                                                               |
| `export:embed` dev, warm                       | 9.05 s   | 1.43 s   | −84.2 %                                                               |
| Peak memory, release cold                      | 3,823 MB | 2,959 MB | −22.6 %                                                               |
| Peak memory, release warm                      | 1,070 MB | 1,229 MB | +14.9 %                                                               |
| Peak memory, dev cold                          | 3,511 MB | 2,911 MB | −17.1 %                                                               |
| Peak memory, dev warm                          | 1,346 MB | 1,033 MB | −23.3 %                                                               |
| Release JS bundle                              | 3.54 MB  | 3.37 MB  | −4.9 %                                                                |
| Modules in the release source map              | 2,007    | 1,629    | [see above](#scope-hoisting-and-cross-module-tree-shaking-in-release) |
| Hermes bytecode                                | 4.96 MB  | 5.15 MB  | +3.9 %                                                                |
| Hermes compile                                 | 1.35 s   | 1.53 s   | +13.4 %                                                               |
| Dev server, cold start until it answers        | 1.46 s   | 0.63 s   | −56.6 %                                                               |
| Dev server, cold start until the first bundle  | 9.03 s   | 4.58 s   | −49.2 %                                                               |
| Dev server, warm start until the first bundle  | 5.59 s   | 1.66 s   | −70.3 %                                                               |
| Repeat bundle fetch                            | 0.14 s   | 0.01 s   | −93.3 %                                                               |
| Edit → Fast Refresh update received by the app | 0.14 s   | 0.05 s   | −63.6 %                                                               |
| Edit → new full bundle available               | 0.18 s   | 0.18 s   | level (within 4 %)                                                    |

vifx is ahead on build times, dev-server start, Fast Refresh latency, JS bundle size and cold-build memory. Metro is ahead on Hermes bytecode size and compile time, and on the peak memory of a warm release build. A new full bundle after an edit is level.

These are single-app, single-machine results, not a general claim. Not measured, because it needs a device: startup time, time to interactive, and the memory and frame rate of the running app. The [full report](https://github.com/Salnika/vifx/blob/master/docs/benchmarks/expo-vs-vifx-2026-11.md) describes the method and how to reproduce it.

## Where Metro is on par or ahead

Some of these are measured results on the benchmark app; the others are design boundaries.

### Hermes bytecode size — Metro is smaller

Hermes bytecode is 3.9 % larger than Metro's on the benchmark app (5.15 MB against 4.96 MB), although the JS bundle is 4.9 % smaller. The likely cause is the lazy `__esm` / `__export` interop wrappers that Rolldown emits for a CommonJS-heavy React Native graph it cannot hoist eagerly: each wrapper and each export getter is a small function, and the bytecode carries every function. Removing them is not a configuration flag away; it needs either a de-lazification transform or eager-hoisting work in Rolldown itself. Identifier mangling does not help: it shrinks the JS text, not the bytecode.

### Hermes compile time — Metro is faster

Compiling the release bundle to bytecode with the same `hermesc -O` takes 1.53 s for vifx's bundle against 1.35 s for Metro's (+13 %). vifx does not vendor Hermes: it detects and runs the project's `hermesc`, and validates its source maps and symbolication against Metro's.

### Peak memory of a warm release build — Metro is lower

A warm `export:embed` release build peaks at 1,229 MB summed over the process tree, against 1,070 MB for Metro (+15 %). Cold builds, and development builds cold or warm, peak lower with vifx (see [Measured results](#measured-results)).

### A new full bundle after an edit — level

After an edit, the full bundle that a reload fetches is available in 0.18 s with both tools. vifx rebuilds it in the background while the app applies the Fast Refresh patch.

### Custom `resolveRequest` — supported; `serializer` — keep Metro

A custom `resolver.resolveRequest` is a drop-in: port it to `vite.config.vifx.ts` with `vifxResolveRequest(...)`, which mirrors Metro's `(context, moduleName, platform) => Resolution` contract — including the recursive `context.resolveRequest` for delegation — and routes the tagged-union result into vifx's asset/transform post-processing. vifx detects a `resolveRequest` in your `metro.config.js` and points you there with a migration hint. See [resolveRequest](../guide/migration#resolverequest).

A custom `serializer` still has no vifx equivalent: vifx flags it with the stable `VIFX_UNSUPPORTED_METRO_SERIALIZER` code, so keep Metro for serializer-specific workflows or remove the hook before migrating. Everything else vifx interop reports — `assetExts`, `sourceExts`, `extraNodeModules`, `babelTransformerPath`, `watchFolders` — maps to a `vifx.config.ts` setting or a Vite plugin. See [Migration](../guide/migration) for the full mapping.

### Web is a companion target

Web is served by real react-native-web through a Vite dev server and mounts through the genuine `AppRegistry.runApplication`. By design it is a companion to native: native-only libraries (reanimated, skia, sqlite, gesture-handler) are rerouted or degraded rather than brought to full parity. Native (iOS/Android) is the primary output; web is a development and preview surface. See [Support Matrix](./support-matrix) for per-library behavior.

### Expo CLI and EAS — a separate boundary

vifx replaces the Metro bundling path, not Expo. Expo Go orchestration, native build and run, Expo Updates serving and signing, and EAS remain Expo and EAS responsibilities. `vifx expo export` produces bundle, asset, and manifest artifacts — not an Expo Updates runtime payload. vifx slots into the bundling seam and leaves the rest of the Expo workflow intact.

## See also

- [Dev Server and Fast Refresh](../guide/dev-server) — how saves reach the app.
- [Project Status](../guide/status) — what has been validated and what is still open.
- [Features](./features) — the full capability inventory.
- [CLI](./cli) — every command and flag.
- [Config](./config) — the `vifx.config.ts` and `vite.config.vifx.ts` contracts.
- [Migration](../guide/migration) — moving an existing Metro or Expo project to vifx.
- [Getting Started](../guide/getting-started) — install and first build.
