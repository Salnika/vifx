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
vifx build --platform ios
```

## A user-extensible build pipeline (any Vite/Rollup plugin)

Vifx loads and merges your project's `vite.config.vifx.{ts,mts,js,mjs}` through Vite's own `loadConfigFromFile`, then appends your plugins after its own. Because vifx exposes the standard Rollup/Vite plugin protocol (`resolveId` / `load` / `transform` / `renderChunk`), any standard plugin — svgr, unplugin-icons, mdx, virtual modules — runs against your React Native bundle. This is the single biggest structural difference from Metro, whose closed `__d`/`__r` registry has no plugin protocol.

Why it matters: the entire Vite/Rollup ecosystem becomes available to a React Native app, with no bespoke transformer indirection.

Scaffold the file with `vifx vite init`, then add any plugin:

```sh
vifx vite init --write
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

The runnable [`apps/example-vite-plugins`](https://github.com/) example (in this repo) wires three plugins into `vite.config.vifx.ts` — a virtual-module plugin (`resolveId`/`load`), a custom `transform` plugin that rewrites a token, and a `.yaml` asset loader (the `@rollup/plugin-yaml` pattern) — and proves each one ran with a single grep over the built native bundle, no device required:

```sh
vifx export:embed apps/example-vite-plugins --platform ios --dev false \
  --bundle-output dist/index.bundle
node apps/example-vite-plugins/scripts/verify-bundle.mjs dist/index.bundle
```

Each plugin emits a unique sentinel that survives tree-shaking (the app logs it) and therefore appears verbatim in the release IIFE, while the transform plugin's pre-rewrite token is asserted absent. See the example's `README.md` for the full walkthrough.

## Metro-compatible dev server and Fast Refresh

Vifx serves the Metro dev-server conventions the React Native and Expo tooling already speak, from a Vite-powered server with no Metro runtime dependency.

For bare React Native projects, `vifx dev` serves the routes the React Native community CLI expects: `GET /status`, `GET /<entry>.bundle?platform=…&dev=…`, the matching source-map route, `POST /symbolicate`, and a `/message` WebSocket channel.

```sh
vifx dev --platform ios --port 8081
```

For Expo, `vifx expo dev --expo-go` serves the Expo Go manifest and bundle server: the manifest (`/`, `/manifest`, `/index.exp` with multipart negotiation for `expo-dev-client`), the bundle and source map, `POST /symbolicate`, `/status`, `/assets`, and React Native DevTools / Fusebox through `@react-native/dev-middleware`. It prints a QR code for Expo Go and exposes interactive keybindings: `r` reload, `m` dev menu, `j` open DevTools/Fusebox, `o` open in your editor, `?` show all keys.

```sh
vifx expo dev --expo-go --platform ios --public-host 192.168.1.10
```

### Fast Refresh

Fast Refresh is a native, state-preserving update path over a `/hot` WebSocket channel, written from scratch with no Metro runtime dependency. Enable it with `--fast-refresh`, which builds on the Expo Go server and so requires `--expo-go`:

```sh
vifx expo dev --expo-go --fast-refresh
```

`--fast-refresh` selects the `metro` module format (the `__d`/`__r` Metro-graph serialization), which is the format the Fast Refresh engine consumes. `react-refresh/babel` runs over your source, the vifx HMR client replaces React Native's `HMRClient.js` on both native and web, and `computeHmrUpdate` diffs two builds and re-emits each changed module as a `__d(...)` call routed through the registry's `global.__accept`. The `/hot` channel speaks the Metro protocol verbatim (`update-start`, `update`, `update-done`, `error`), so React Native's built-in client parses the deltas untranslated.

Without `--fast-refresh`, the default `hoisted` module format does a full reload on each save — correct, just not state-preserving. A deleted module also falls back to a full reload even under Fast Refresh, because module ids must stay stable across rebuilds for the delta to apply.

The default `vifx expo dev` (no `--expo-go`) serves a browser preview through a real Vite dev server and requires the target's `reactNativeCompat: "web"`.

## Per-save build instrumentation

Every rebuild under `vifx expo dev --expo-go` prints one line ventilated by phase, so you can see exactly where a save spends its time:

```text
~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
```

The phases are honest about what they measure. `transform` is the single `await build()` Vite/Rolldown span — Babel transform and Rolldown bundling are one call with no isolable pure-Babel sub-phase. `serialize` assembles the `__d`/`__r` registry and source map; `write` covers the two `writeFile` calls plus asset rename and staging cleanup; `apply` is the HMR diff and `/hot` broadcast. When a target compiles Hermes bytecode, an `hbc` phase joins the line.

The `cache` segment is the **per-cycle** transform-cache hit-rate for that one save, computed via `snapshotDelta()` — not the cumulative `stats()`, which falsely converges toward ~100% on a warm cache and hides what a single save actually recomputed.

Add `--json` to keep stdout a pure NDJSON stream — line 1 is a compact dev-server snapshot, then one `VifxRebuildReport` line per save (`cycle`, per-phase timings, cache stats, `moduleCount`, `hmr`). Each line is independently parseable and aggregable for median/p95:

```sh
vifx expo dev --expo-go --fast-refresh --json > rebuilds.ndjson
```

This per-phase, per-cycle, machine-readable rebuild report is a vifx surface; Metro exposes no equivalent.

## Content-addressed transform cache

Every transform entry is keyed on the SHA-256 of a stable stringify of its key parts plus a cache version string, and stored at `<projectRoot>/.vifx/cache/transforms/<hash[0..2]>/<hash>.json` with atomic temp-file renames. The version key mixes the cache format with the plugin, Vite, and project Babel versions, so bumping any of those tools invalidates everything automatically. Both the OXC transform and the project-Babel transform are cached.

Why it matters: content-addressing makes an unchanged input a guaranteed hit regardless of mtime or order. On HNewsPro (iOS), a warm rebuild lands at 3.8 s versus Metro's 12.3 s (~3.2× faster), and the cold→warm speedup is 3.4× for vifx against Metro's 1.7× on the same app. These are single-app, single-machine, local numbers — see the [comparisons](./comparisons) page for the full methodology.

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
  vifx export:embed . --platform ios --dev false --bundle-output ios.bundle
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
    conditions: ["react-native", "import", "require", "default"],
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
vifx export:embed . \
  --platform ios --dev false --minify true \
  --bundle-output ios.bundle \
  --sourcemap-output ios.map \
  --assets-dest ./assets
```

`--bundle-output` is the only required flag. `--dev false` requests production semantics (mode `production`); `--minify` defaults to `!dev`. `--assets-dest` writes the Android `drawable-<density>/` and `raw/` layout, the iOS `assets/` layout, and an `assetmap.json`. The command auto-detects Expo versus bare React Native projects and routes to the matching bundler.

A fixed set of Metro flags are accepted and explicitly no-op (warned, never fatal): `--reset-cache`, `--max-workers`, `--transformer`, `--bundle-encoding`, `--asset-catalog-dest`, `--config-cmd`, `--sourcemap-sources-root`, `--unstable-transform-profile`, `--clear`, `--read-global-cache`, `--sourcemap-use-absolute-path`.

To route Expo's generated native build scripts through this command, register `@vifx/expo-config-plugin` (see the [migration guide](../guide/migration)); the Gradle side wires up as:

```groovy
react { bundleCommand = "export:embed" }
```

### expo export — Expo artifact directory

`vifx expo export` builds your configured Expo targets and writes an Expo artifact directory — bundles, source maps, assets, `manifest.json`, and `metadata.json`. It requires `vite.mode: "expo"`.

```sh
vifx expo export . --platform all --out-dir dist/expo
```

These commands produce bundle and artifact output. They do not replace EAS, Expo Updates runtime serving, response signing, or native app binaries — those remain Expo and EAS responsibilities. `vifx expo audit` reports the no-Metro bundling contract, and `vifx expo smoke` runs an end-to-end Expo Go endpoint check.

## Scope-hoisted, minified release and Hermes bytecode

Production native bundles are emitted as a single scope-hoisted IIFE (`format: "iife"`, `inlineDynamicImports`, `entryFileNames: "index.bundle"`, global name `__vifx`), which keeps Rolldown's cross-module tree-shaking and inlining. Minification uses the OXC minifier built into the toolchain (`minify: "oxc"` in production), which composes the minified source map natively. Because React Native ships one direct `eval` that would otherwise disable global mangling, `createIndirectEvalPlugin` rewrites `eval(` to `(0,eval)(` before minify (production only, behavior-preserving) so OXC can mangle the whole bundle.

Why it matters: Metro's output is the `__d`/`__r` registry even in release — every module stays a separately wrapped CommonJS factory with registry indirection, so there is no cross-module scope hoisting. On HNewsPro the scope-hoisted release JS is 3.46 MB versus Metro's 3.54 MB (−2.2%), with 1711 versus 2007 modules (−15%). This is one app, one machine, single runs.

When a target sets `hermes: true`, the build compiles `index.bundle` to `index.hbc` via the detected Hermes compiler (vifx orchestrates `hermesc`; it does not vendor Hermes). In production the bundle is already OXC-minified, so bytecode is generated from the minified script. You can also compile a bundle directly:

```sh
vifx hermes compile --input index.bundle --output index.hbc --source-map index.map
```

Honest boundary on bytecode size: Hermes bytecode is +5.8% versus Metro (5.24 MB vs 4.96 MB on HNewsPro). The cause is isolated — roughly 8,145 lazy `__esm`/`__export` getter-thunk arrows that Rolldown emits to interop a CJS-heavy React Native graph (Metro emits 317). This is not a config flag away: eliminating it needs a de-lazification transform or upstream Rolldown eager-hoisting, and mangling does not help because Hermes ignores identifier names. The `metro` serialization format measures worse for bytecode (+17.3%) precisely because it loses cross-module hoisting. The dev format (Metro-compatible registry) and the release format (hoisted IIFE) are two serializers by design.

## Compatibility layer and matrix

`vifx compat run` runs a fixture-backed matrix of resolver, asset, bundler, and library behaviors against adapters, with per-toolchain status (pass / partial / skip) and a terminal, JSON, or Markdown report:

```sh
vifx compat run --adapter all --report markdown
```

The plugin ships runtime compat shims for many React Native and Expo internals so native libraries bundle cleanly, plus a gated native compat-preview (for example a from-scratch reanimated mock) behind `compatPreview`. Pure-JS libraries such as `react-native-safe-area-context` and `react-native-vector-icons` are marked `pass`. Libraries with native host components — reanimated, gesture-handler, screens, svg, flash-list, expo-image, expo-sqlite, lottie, webview, nativewind — are marked `partial`: their JS surface bundles, but the native host component is unavailable at build time and the behavior needs a device. That is the nature of a bundler boundary, not a missing feature. See the [support matrix](./support-matrix) for the full library table.

To inspect your own project's primitives — project type, configs, Vite mode, platform files, asset groups — use:

```sh
vifx inspect --json
```

And to compare against captured Metro reference artifacts:

```sh
vifx metro inspect --platform ios
```

## Where to go next

- [Getting started](../guide/getting-started) — install vifx and run your first build.
- [Migration](../guide/migration) — onboard an existing Expo or React Native project.
- [CLI reference](./cli) — every command and flag.
- [Config reference](./config) — the full `vifx.config.ts` schema.
- [Comparisons](./comparisons) — vifx versus Metro, with measured numbers.
