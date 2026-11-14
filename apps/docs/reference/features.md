# Features

Vifx is a unified, Vite/Rolldown-based toolchain that replaces Metro for React Native and Expo. One engine bundles your native and web targets, runs the full Vite/Rollup plugin ecosystem against a React Native app, serves a Metro-compatible dev server with Fast Refresh, and produces release bundles and Hermes bytecode that drop into the standard Xcode and Gradle build phases.

This page walks every feature pillar: what it is, why it matters, and the exact command, flag, or config you use to reach it. For the command-line surface see the [CLI reference](./cli); for the full config schema see the [config reference](./config).

## A single Vite/Rolldown engine for native and web

One plugin pair drives every target through the same Babel → OXC → Rolldown pipeline. `reactNative(options)` (from `@vifx/vite-plugin-react-native`) and `expo(options)` (from `@vifx/vite-plugin-expo`) build native targets (`platform: "ios" | "android"`) and a web companion target (`reactNativeCompat: "web"`, which rewires imports to `react-native-web`). The only differences between targets are the resolution platform and the output format — the transform, define table, and resolver are shared.

Why it matters: you configure native and web once, in one place, and they stay consistent. There is no separate Metro-web bundler with its own config and its own env handling.

Native is the primary target and web is a companion preview target by design. Native bundles are a single scope-hoisted IIFE script because Hermes and JSC evaluate `index.bundle` in a non-module context — ESM `import`/`export` and `import.meta` must never reach the bundle. Web bundles stay ESM (`format: "es"`) and load through `import()` in the browser. The web surface is the Vite dev server; native (Expo Go and bare React Native) is the path you ship.

```ts
// vifx.config.ts
import { defineVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  platforms: ["ios", "android"],
  vite: {
    mode: "expo",
    targets: [
      { platform: "ios", entry: "./index.js", hermes: false },
      { platform: "android", entry: "./index.js", hermes: false },
    ],
  },
});
```

```sh
npx vifx build --platform ios
```

## A user-extensible build pipeline (any Vite/Rollup plugin)

Vifx loads and merges your project's `vite.config.vifx.{ts,mts,js,mjs}` through Vite's own `loadConfigFromFile`, then appends your plugins after its own. Because vifx exposes the standard Rollup/Vite plugin protocol (`resolveId` / `load` / `transform` / `renderChunk`), any standard plugin — svgr, unplugin-icons, mdx, virtual modules — runs against your React Native bundle. This is the single biggest structural difference from Metro, whose closed `__d`/`__r` registry has no plugin protocol.

Why it matters: the entire Vite/Rollup ecosystem becomes available to a React Native app, with no bespoke transformer indirection.

Scaffold the file with `vifx vite init`, then add any plugin:

```sh
npx vifx vite init --write
```

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
});
```

Your plugins always run after vifx's own, so a user plugin can never shadow `.ios`/`.native` resolution. User contributions are bounded by a closed allow-list: `css`, `define`, `esbuild`, `json`, `plugins`, `resolve`, `worker` (plus `optimizeDeps` and `server` on the web dev server only). Keys vifx must own are re-imposed after the merge — `resolve.conditions`/`resolve.dedupe`, the define table (`__DEV__`, `global`, `process.env.NODE_ENV`, `process.env.EXPO_OS`), the vifx-owned aliases (`react-native` and the AssetRegistry), and top-level `appType`/`build`/`configFile`/`envFile`/`publicDir`/`root`. When a user override collides with an owned key it is neutralized and you get a `VIFX_USER_VITE_CONFIG_CONFLICT` warning. `optimizeDeps` and `server` are dropped on native builds because esbuild pre-bundling does not honor `.ios`/`.native` platform extensions; they remain available on the web dev server.

Opt out of the bridge entirely by setting `vite.userConfigFile: false`, or point it at an explicit path with a string. With no user config the build is byte-identical to the no-bridge path.

### Example: Vite plugins on a React Native app

The runnable [`apps/example-vite-plugins`](https://github.com/Salnika/vifx/tree/master/apps/example-vite-plugins) example in the Vifx repository wires three plugins into `vite.config.vifx.ts` — a virtual-module plugin (`resolveId`/`load`), a custom `transform` plugin that rewrites a token, and a `.yaml` asset loader (the `@rollup/plugin-yaml` pattern) — and proves each one ran with a single grep over the built native bundle, no device required. From the example's directory:

```sh
npx vifx export:embed . --platform ios --dev false --bundle-output dist/index.bundle
node ./scripts/verify-bundle.mjs dist/index.bundle
```

Each plugin emits a unique sentinel that survives tree-shaking (the app logs it) and therefore appears verbatim in the release IIFE, while the transform plugin's pre-rewrite token is asserted absent. See the example's `README.md` for the full walkthrough.

## Metro-compatible dev server and Fast Refresh

Vifx serves the Metro dev-server conventions the React Native and Expo tooling already speak, from a Vite-powered server with no Metro runtime dependency.

For bare React Native projects, `vifx dev` serves the routes the React Native community CLI expects: `GET /status`, `GET /<entry>.bundle?platform=…&dev=…`, the matching source-map route, `POST /symbolicate`, and a `/message` WebSocket channel. It serves a built bundle, without file watching or Fast Refresh.

```sh
npx vifx dev --platform ios --port 8081
```

For Expo, `vifx expo dev --expo-go` serves the Expo Go manifest and bundle server: the manifest (`/`, `/manifest`, `/index.exp` with multipart negotiation for `expo-dev-client`), the bundle and source map, `POST /symbolicate`, `/status`, `/assets`, and React Native DevTools through `@react-native/dev-middleware`. It listens before it bundles, so the QR code and URLs print at once and requests wait for the first bundle. It exposes interactive keybindings: `r` reload, `m` dev menu, `j` open DevTools, `o` open in your editor, `?` show all keys.

```sh
npx vifx expo dev --expo-go --platform ios --public-host 192.168.1.10
```

### Fast Refresh

Fast Refresh is on by default in `vifx expo dev --expo-go` for development builds with the default `hoisted` module format. It runs on Rolldown's native dev engine (`dev()` from `vite/rolldown/experimental`), driven with the same plugins and options as the regular development build. The module graph stays alive between saves: a save compiles only the changed modules into a patch, the server sends it to the app over the `/hot` WebSocket, and the full bundle is rebuilt in the background for the next reload.

`react-refresh/babel` runs over your project files, and the vifx HMR client replaces React Native's `HMRClient` in native bundles. In the app, a small runtime — Rolldown's dev runtime ported to ES5, so that Hermes parses it — applies Metro's Fast Refresh rules: a module whose exports are all React components is a refresh boundary; any other edited module re-runs together with its importers up to the nearest boundary; no boundary means a full reload. Compile errors show React Native's syntax-error screen in the app, and the app's `console.*` output is printed in the terminal. See [Dev Server and Fast Refresh](../guide/dev-server) for the details, the settings, and the limitations.

`--fast-refresh` selects the alternative, earlier path: the `metro` module format (the `__d`/`__r` Metro-graph serialization). On each save it rebuilds the whole bundle, `computeHmrUpdate` diffs the two builds, and each changed module is re-emitted as a `__d(...)` call routed through the registry's `global.__accept`. The `/hot` channel uses Metro's message shapes (`update-start`, `update`, `update-done`, `error`). A deleted module falls back to a full reload, because module ids must stay stable across rebuilds for the delta to apply. This path is experimental.

`VIFX_DEV_ENGINE=0` turns the dev engine off: each save then rebuilds the whole bundle and reloads the app.

The default `vifx expo dev` (no `--expo-go`) serves a browser preview through a real Vite dev server and requires the target's `reactNativeCompat: "web"`.

## Per-save output

Each save under `vifx expo dev --expo-go` prints one line once the app has applied it, so you can see what changed, what the app did with it, and how long it took:

```text
fast refresh  app/(tabs)/index.tsx  36ms
fast refresh  src/api/endpoints.ts  48ms  (32 modules re-run)
reload  index.js  52ms  — No root boundary: nothing that ran imports index.js
```

The time runs from the moment the file watcher saw the save to the moment the app reported the update applied. A save that reloads the app gives the reason; a save that does not compile prints `update failed` with the error's cause and code frame.

Add `--json` to keep stdout a pure NDJSON stream — line 1 is a compact dev-server snapshot, then one `VifxRebuildReport` line per save (`cycle`, `engine`, `hmr`, `changedPaths`, `moduleCount`, `reason`, `error`, `phases.totalMs`). Each line is independently parseable and can be aggregated for median and p95:

```sh
npx vifx expo dev --expo-go --platform ios --json > saves.ndjson
```

On the `--fast-refresh` path, the line breaks the rebuild down by phase instead, with a per-save transform-cache hit rate:

```text
~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
```

`transform` is the single Vite/Rolldown build span — Babel transform and Rolldown bundling are one call with no isolable pure-Babel sub-phase. `serialize` assembles the `__d`/`__r` registry and source map; `write` covers the file writes plus asset rename and staging cleanup; `apply` is the HMR diff and `/hot` broadcast. The `cache` segment is the **per-save** transform-cache hit rate, computed with `snapshotDelta()` — not the cumulative `stats()`, which converges toward ~100% on a warm cache and hides what a single save actually recomputed.

## Content-addressed transform cache

Every transform entry is keyed on the SHA-256 of a stable stringify of its key parts plus a cache version string, and stored at `<projectRoot>/.vifx/cache/transforms/<hash[0..2]>/<hash>.json` with atomic temp-file renames. The version key mixes the cache format with the plugin, Vite, and project Babel versions, so bumping any of those tools invalidates everything automatically. Both the OXC transform and the project-Babel transform are cached. Project-Babel transforms that miss the cache run on worker threads when there are many of them, as in a cold build (`VIFX_BABEL_WORKERS` sets the thread count; see [Babel worker threads](../guide/dev-server#babel-worker-threads)).

Why it matters: content-addressing makes an unchanged input a guaranteed hit regardless of mtime or order. On the benchmark app (iOS), a warm `export:embed` release build takes 1.57 s against 8.71 s for Metro, and a warm development build 1.43 s against 9.05 s. These are single-app, single-machine numbers (median of 3 runs) — see [Measured results](./comparisons#measured-results) for the method and the other figures.

The cache is on by default. Disable it per target with `transformCache: false`:

```ts
// vifx.config.ts — vite.targets[] entry
{ platform: "ios", entry: "./index.js", transformCache: false }
```

## Unified define and env

A single function, `resolveDefines`, is the sole source of the compile-time define table for both native and web:

- `__DEV__` and `process.env.NODE_ENV` follow the bundle **mode**, not the platform — so production native builds are possible, and the web companion follows the resolved mode (defaulting to `__DEV__: true`).
- `global` is `globalThis`.
- `process.env.EXPO_OS` is injected for native only; web detects the platform through `Platform.OS`.

Public env vars (default prefix `EXPO_PUBLIC_`, configurable via `publicEnvPrefix`) are filtered, sorted for byte-stability, and each surviving key is emitted as **both** `import.meta.env.<KEY>` and `process.env.<KEY>` — for native and web. So `import.meta.env` and `process.env` reads resolve to the same value on every target. With no public env var the define table is byte-identical to the plain Expo Go bundle.

```sh
EXPO_PUBLIC_API_URL=https://api.example.com \
  npx vifx export:embed . --platform ios --dev false --bundle-output ios.bundle
```

```ts
// In your app — both reads inline to the same value:
const url = import.meta.env.EXPO_PUBLIC_API_URL;
const same = process.env.EXPO_PUBLIC_API_URL;
```

Set the prefix in config:

```ts
// vifx.config.ts
{
  expoOptions: {
    publicEnvPrefix: "EXPO_PUBLIC_";
  }
}
```

### `.env` files

Every bundling command (`build`, `dev`, `expo dev`, `expo export`, `expo smoke`, `export:embed`, `run`) loads the project's dotenv files before bundling, with the semantics of Expo CLI:

| Priority | File                | Notes                                     |
| -------- | ------------------- | ----------------------------------------- |
| 1        | `.env.<mode>.local` | `<mode>` is `development` or `production` |
| 2        | `.env.local`        | Skipped in `test` mode                    |
| 3        | `.env.<mode>`       |                                           |
| 4        | `.env`              |                                           |

- The first file to define a key wins; a variable already set in the shell is never overridden.
- `$VAR`, `${VAR}` and `${VAR:-default}` references are expanded; `\$` is a literal dollar sign.
- The mode is `production` for `export:embed --dev false` and `build --mode production`, otherwise the target's mode (`development` by default).
- `EXPO_NO_DOTENV=1` disables loading entirely.
- The variables land in `process.env`, so a dynamic `app.config.js` sees them too. Only keys carrying the public prefix are inlined into the bundle.

## Expo app config

The Expo Go manifest and the export manifest are built from the resolved Expo config — static **and** dynamic:

- `app.json` / `app.config.json` (the `expo` key, or the whole file when there is none).
- `app.config.ts`, `.mts`, `.js`, `.mjs`, `.cjs`: an exported function receives `{ config }` (the static config) and returns the final config; an exported object replaces the static config.

When the project has `@expo/config` installed (every real Expo app does, through `expo`), Vifx calls its `getConfig` — the same call Expo CLI makes — so config plugins, SDK defaults and TypeScript configs behave identically. A config plugin that fails to load is retried without plugins rather than failing the manifest. Without `@expo/config`, a built-in evaluator applies the same static/dynamic rules. An explicit `expoOptions.appConfigPath` pins the file and always uses the built-in evaluator. A dynamic config that throws surfaces `VIFX_EXPO_CONFIG_INVALID`.

## Isolated installs (pnpm)

Vifx resolves packages from the **real** location of the importing file, as Node and Metro do, so pnpm's default isolated `node_modules` layout works without `node-linker=hoisted`:

- a package reached through its `node_modules/<name>` symlink finds its own dependencies in the virtual store, and its copy wins over a same-named package at the project root;
- an `exports` / `main` target that names an existing file (`./esm.mjs`) is that file, whatever its extension;
- a subpath directory carrying its own `package.json` (`pkg/presets/decimal/package.json`) is resolved through its main fields;
- imports written by tooling rather than by the importing file — `@babel/runtime` helpers, `@react-native/assets-registry`, `@react-native/js-polyfills`, `@expo/metro-runtime` — fall back to the dependency trees of `expo` / `react-native`, the fallback Expo's own Metro resolver applies;
- `@babel/core` and `babel-preset-expo` are found through `expo` when the project does not declare them.

## Native ↔ web platform resolution

A single resolver handles platform-extension variants (`.ios`, `.android`, `.native`, `.web`) and package conditions. On native the resolution priorities are `{ android: ["android", "native"], ios: ["ios", "native"], native: ["native"] }`; on web they are `["web", "native"]`. Resolver conditions are `[react-native, <platform>, …extra, import, default]` on native and `[browser, web, …extra, import, default]` on web. Default main fields are `[react-native, main, module]` on native and `[react-native, module, main]` on web.

The behavior is fixture-verified: an iOS/Android file wins over `.native`, `.native` is the cross-platform fallback, a plain file resolves last, and the `react-native` exports condition beats `default`.

Native asset imports register through `@react-native/assets-registry` and return a numeric asset id, exactly like Metro — not Vite's URL string. `require.context(...)` is resolved at build time into a virtual module, dynamic `import(...)` is rewritten, and Expo Router's `_ctx` route context is generated from your `app/` (or `src/app/`) directory with platform-aware route selection.

Tune resolution from `vifx.config.ts`:

```ts
// vifx.config.ts
{
  resolver: {
    extensions: ["tsx", "ts", "jsx", "js", "json"],
    // Extra `exports` conditions, tried before import and default.
    conditions: ["source"],
    mainFields: ["react-native", "module", "main"],
  },
}
```

Per-target aliases are also config keys:

```ts
{ platform: "ios", entry: "./index.js", aliases: { "@app": "./src" } }
```

## Production export

### export:embed — drop-in for the native build phases

`vifx export:embed` builds the release bundle and production asset layout consumed by Xcode's "Bundle React Native code and images" phase and the Gradle bundle task. Its flag surface is compatible with `npx expo export:embed` and `npx react-native bundle` — unknown Metro flags warn and are ignored rather than failing, so it slots straight into existing scripts.

```sh
npx vifx export:embed . \
  --platform ios --dev false --minify true \
  --bundle-output ios.bundle \
  --sourcemap-output ios.map \
  --assets-dest ./assets
```

`--bundle-output` is the only required flag. `--dev false` requests production semantics (mode `production`); `--minify` defaults to `!dev`. `--assets-dest` writes the Android `drawable-<density>/` and `raw/` layout, the iOS `assets/` layout, and an `assetmap.json`. The command auto-detects Expo versus bare React Native projects and routes to the matching bundler.

A fixed set of Metro flags are accepted and explicitly no-op (warned, never fatal): `--reset-cache`, `--max-workers`, `--transformer`, `--bundle-encoding`, `--asset-catalog-dest`, `--config-cmd`, `--sourcemap-sources-root`, `--unstable-transform-profile`, `--clear`, `--read-global-cache`, `--sourcemap-use-absolute-path`.

To route Expo's generated native build scripts through this command, register `@vifx/expo-config-plugin` (see the [migration guide](../guide/migration#expo-native-builds)); wired by hand, the Gradle side looks like:

```groovy
react {
  cliFile = file("../../node_modules/@vifx/cli/dist/bin.mjs")
  bundleCommand = "export:embed"
}
```

### expo export — Expo artifact directory

`vifx expo export` builds your configured Expo targets and writes an Expo artifact directory — bundles, source maps, assets, `manifest.json`, and `metadata.json`. It requires `vite.mode: "expo"`.

```sh
npx vifx expo export . --platform all --out-dir dist/expo
```

These commands produce bundle and artifact output. They do not replace EAS, Expo Updates runtime serving, response signing, or native app binaries — those remain Expo and EAS responsibilities. `vifx expo audit` reports the no-Metro bundling contract, and `vifx expo smoke` runs an end-to-end Expo Go endpoint check.

## Scope-hoisted, minified release and Hermes bytecode

Production native bundles are emitted as a single scope-hoisted IIFE (`format: "iife"`, `inlineDynamicImports`, `entryFileNames: "index.bundle"`, global name `__vifx`), which keeps Rolldown's cross-module tree-shaking and inlining. Minification uses the OXC minifier built into the toolchain (`minify: "oxc"` in production), which composes the minified source map natively. Because React Native ships one direct `eval` that would otherwise disable global mangling, `createIndirectEvalPlugin` rewrites `eval(` to `(0,eval)(` before minify (production only, behavior-preserving) so OXC can mangle the whole bundle.

Why it matters: Metro's output is the `__d`/`__r` registry even in release — every module stays a separately wrapped CommonJS factory with registry indirection, so there is no cross-module scope hoisting. On the benchmark app (iOS), the scope-hoisted release JS is 3.37 MB against Metro's 3.54 MB (−4.9 %); gzipped, both are 0.88 MB. The release source map lists 1,629 modules against 2,007 for Metro: part of that is tree-shaking, part a known source-map gap ([details](./comparisons#scope-hoisting-and-cross-module-tree-shaking-in-release)). One app, one machine, median of 3 runs.

When a target sets `hermes: true`, the build compiles `index.bundle` to `index.hbc` via the detected Hermes compiler (vifx orchestrates `hermesc`; it does not vendor Hermes). In production the bundle is already OXC-minified, so bytecode is generated from the minified script. You can also compile a bundle directly:

```sh
npx vifx hermes compile --input index.bundle --output index.hbc --source-map index.map
```

Honest boundary on bytecode: on the benchmark app, Hermes bytecode is 3.9 % larger than Metro's (5.15 MB against 4.96 MB), and compiling it takes 13 % longer (1.53 s against 1.35 s). The likely cause is the lazy `__esm`/`__export` interop wrappers that Rolldown emits for a CommonJS-heavy React Native graph it cannot hoist eagerly: each one is a small function that the bytecode carries. Removing them needs a de-lazification transform or eager-hoisting work in Rolldown, not a config flag, and mangling does not help because it shrinks the JS text, not the bytecode. Release builds always use the hoisted IIFE; the `metro` registry format remains for the `--fast-refresh` dev path.

## Compatibility layer and matrix

`vifx compat run` runs a fixture-backed matrix of resolver, asset, bundler, and library behaviors against adapters, with per-toolchain status (pass / partial / skip) and a terminal, JSON, or Markdown report. The fixtures live in the Vifx repository, so the matrix runs from a clone of it (see [CONTRIBUTING.md](https://github.com/Salnika/vifx/blob/master/CONTRIBUTING.md)):

```sh
vifx compat run --adapter all --report markdown
```

The plugin ships runtime compat shims for many React Native and Expo internals so native libraries bundle cleanly, plus a gated native compat-preview (for example a from-scratch reanimated mock) behind `compatPreview`. Pure-JS libraries such as `react-native-safe-area-context` and `react-native-vector-icons` are marked `pass`. Libraries with native host components — reanimated, gesture-handler, screens, svg, flash-list, expo-image, expo-sqlite, lottie, webview, nativewind — are marked `partial`: their JS surface bundles, but the native host component is unavailable at build time and the behavior needs a device. That is the nature of a bundler boundary, not a missing feature. See the [support matrix](./support-matrix) for the full library table.

To inspect your own project's primitives — project type, configs, Vite mode, platform files, asset groups — use:

```sh
npx vifx inspect --json
```

And to compare against Metro reference artifacts captured under `metro-output/<platform>`:

```sh
npx vifx metro inspect --platform ios
```

## Where to go next

- [Getting started](../guide/getting-started) — install vifx and run your first build.
- [Dev Server and Fast Refresh](../guide/dev-server) — how saves reach the app, and what the terminal prints.
- [Migration](../guide/migration) — onboard an existing Expo or React Native project.
- [CLI reference](./cli) — every command and flag.
- [Config reference](./config) — the full `vifx.config.ts` schema.
- [Comparisons](./comparisons) — vifx versus Metro, with measured numbers.
