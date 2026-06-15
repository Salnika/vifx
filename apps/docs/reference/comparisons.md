# vifx vs Metro

vifx replaces Metro as the bundling engine for React Native and Expo. The two tools solve the same problem — turn an app's source graph into a JavaScript bundle, source maps, assets, and (optionally) Hermes bytecode — but they are built on different foundations, and that foundation is where the advantages come from.

Metro transforms each file in isolation through a fixed Babel pipeline and serializes the result into its own closed `__d`/`__r` module registry. It has no plugin protocol, no cross-module scope hoisting, and a bespoke config schema unrelated to the rest of the JavaScript toolchain.

vifx is a single Vite/Rolldown engine. Your app is a real Rolldown module graph: every standard Vite/Rollup hook (`resolveId`, `load`, `transform`, `renderChunk`) is available, the release bundle is scope-hoisted, and the config is a plain Vite `defineConfig`. The same engine drives native and web from one resolution layer and one define/env table.

This page covers both sides of that comparison: the structural advantages Metro cannot easily match, and the places where Metro is on par or ahead.

## At a glance

| Capability                 | Metro                                                      | vifx                                                                       |
| -------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Plugin model               | Closed `__d`/`__r` registry; fixed Babel pipeline          | Open Vite/Rollup plugin graph (svgr, unplugin-icons, mdx, virtual modules) |
| Native + web               | Native bundler; web goes through a separate Metro-web path | One engine, one config, one define/env table for both                      |
| Release output             | `__d`/`__r` registry preserved in release                  | Scope-hoisted IIFE with cross-module tree-shaking                          |
| Modern ESM / `import.meta` | Handled by CJS translation + interop shims                 | First-class graph input; `import.meta.env` inlined                         |
| Warm-rebuild cache         | mtime/order-sensitive keys                                 | Content-addressed (SHA-256) transform cache                                |
| Per-save instrumentation   | None exposed                                               | Per-phase, per-cycle, `--json` NDJSON report                               |
| Config surface             | Bespoke `metro.config.js` schema                           | Standard `vite.config.vifx.ts` (`defineConfig`)                            |
| Hermes bytecode size       | Smaller (see below)                                        | Larger (cause isolated, see below)                                         |
| Web target                 | react-native-web supported                                 | Companion dev target by design                                             |

The sections below go through each row that favors vifx, then the rows where Metro is on par or ahead.

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
EXPO_PUBLIC_API_URL=https://api.example.com vifx export:embed . \
  --platform ios --dev false --bundle-output ios.bundle
```

Platform resolution (`.ios` / `.android` / `.native` / `.web`) is one resolver with a single priority table, so a `Component.ios.tsx` wins on iOS and `Component.native.tsx` is the cross-platform fallback — identical semantics to Metro, in one place that both native and web read.

Metro is the native bundler; web for Expo goes through a separate Metro-web / react-native-web path with its own config and env handling. vifx unifies them because both targets are the same Rolldown engine differing only by resolution platform and output format.

## Scope-hoisting and cross-module tree-shaking in release

vifx emits release builds as a single scope-hoisted bundle wrapped in an IIFE (`format: "iife"`, `inlineDynamicImports`, `entryFileNames: "index.bundle"`), because Hermes and JSC evaluate the bundle in a non-module context. This keeps Rolldown's cross-module dead-code elimination and inlining. On HNewsPro the scope-hoisted release JS is 3.46 MB vs Metro's 3.54 MB (−2.2%), at 1711 vs 2007 modules (−15%).

Metro's output **is** the `__d`/`__r` module registry even in release — every module stays a separately-wrapped CommonJS factory behind the registry indirection. There is no cross-module scope hoisting; Metro does within-module minification and optional inline-requires only. vifx measured this directly: its own `metro` serialization format (the `__d`/`__r` layout) loses Rolldown's cross-module hoisting and produces a _worse_ Hermes bytecode (+17.3% vs Metro) than the hoisted format (+5.8%) — concrete evidence the registry layout forecloses hoisting.

Release minification uses the OXC minifier built into the toolchain. React Native ships one direct `eval` that would otherwise disable global identifier mangling, so a behavior-preserving rewrite turns `eval(` into `(0,eval)(` before minify, letting OXC mangle the whole bundle.

## Modern ESM as first-class input

vifx ingests the modern dual-CJS/ESM ecosystem natively: it resolves `import.meta`, honors ESM `exports` conditions, and inlines `import.meta.env`. The native output is a guaranteed script IIFE, so no residual `import` / `export` / `import.meta` can reach Hermes — that closes an entire fragility class around residual ESM.

Metro's transform and runtime are built around CommonJS `__d`/`__r`. `import.meta` and modern `exports`-map resolution are handled by translation rather than as a native graph, and dual-package deps have historically needed interop shims.

## Content-addressed transform cache and warm rebuilds

The transform cache keys every entry by SHA-256 of a stable stringify of its key parts combined with a cache version, stored at `<projectRoot>/.vifx/cache/transforms/<hash[0..2]>/<hash>.json` with atomic temp-file renames. The version key mixes the cache format with the plugin, Vite, and project Babel versions, so a tool bump invalidates everything automatically. Disable it per target with `transformCache: false`.

Measured payoff on HNewsPro (iOS, local, single runs):

| Build               | Metro  | vifx                 |
| ------------------- | ------ | -------------------- |
| Cold                | 20.7 s | 13.2 s (−36%)        |
| Warm rebuild        | 12.3 s | 3.8 s (~3.2× faster) |
| Cold → warm speedup | 1.7×   | 3.4×                 |

Content-addressing means an unchanged input is a guaranteed hit regardless of mtime or order. Metro's cache is keyed and invalidated differently, and its measured cold → warm speedup on the same app is 1.7×.

These are single-app, single-machine figures — read them as a representative result, not a universal guarantee.

## Per-save build instrumentation

In `vifx expo dev --expo-go --fast-refresh`, every save prints one line ventilated by phase:

```text
~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
```

The phases map directly to the build: `transform` is the single `await build()` span (Babel transform plus Rolldown bundle, which are not separable), `serialize` is assembling the `__d`/`__r` registry and source map, `write` is the file writes plus asset rename and staging cleanup, `apply` is the HMR delta diff and `/hot` broadcast. The cache segment is the **per-cycle** hit-rate from `snapshotDelta()` — what this one save actually recomputed — not a cumulative number that converges toward ~100% on a warm cache.

`--json` keeps stdout pure NDJSON: line 1 is a compact dev-server snapshot, then one report per save, parseable line-by-line for median/p95:

```sh
vifx expo dev <app> --expo-go --fast-refresh --json > rebuilds.ndjson
```

Metro exposes no per-phase, per-cycle, machine-readable rebuild report. See [Workflows](../guide/workflows) for the full instrumentation surface and [CLI](./cli) for the flags.

## Standard config and standard tooling

Your user config is a plain Vite `vite.config.vifx.ts` loaded by Vite itself. vifx re-imposes only the keys it must own — `resolve.conditions`/`dedupe`, the `__DEV__`/`global`/`NODE_ENV`/`EXPO_OS` defines, and (on the Fast Refresh staging path) the `build.rollupOptions.output` layout — and warns with `VIFX_USER_VITE_CONFIG_CONFLICT` when a user override is neutralized. The reserved and allowed key sets are explicit and platform-conditional.

Metro's config is a bespoke `metro.config.js` schema (`resolver` / `transformer` / `serializer`) with no relation to the broader JavaScript tooling conventions. vifx's config is the same surface a web Vite project already uses. Generate it with:

```sh
vifx vite init --write
```

See [Config](./config) for the schema and [Getting Started](../guide/getting-started) for the first run.

## Where Metro is on par or ahead

These are design boundaries, not gaps.

### Hermes bytecode size — Metro is smaller

Hermes bytecode is +5.8% vs Metro (vifx 5.24 MB vs Metro 4.96 MB on HNewsPro). The cause is isolated: roughly 8,145 lazy `__esm`/`__export` getter-thunk arrows that Rolldown emits to interop a CJS-heavy React Native graph it cannot eagerly hoist (Metro emits 317). This is not a missing flag — eliminating them requires either a custom de-lazification transform or upstream Rolldown eager-hoisting work, and mangling does not help because Hermes ignores identifier names. The JS release is already −2.2% smaller than Metro; the bytecode axis is the one where Metro wins.

### Hermes compile time and source maps — parity

Compiling `.bundle` → `.hbc` is roughly equal (Metro 2.0 s vs vifx 1.8 s on HNewsPro). vifx does not vendor Hermes; it detects and orchestrates `hermesc` and validates its source maps and symbolication against Metro. Treat this as parity.

### Custom `resolveRequest` and `serializer` hooks — keep Metro

Two Metro extension points have no vifx equivalent, and vifx tells you so with stable error codes when it finds them in a `metro.config.js`: a custom `resolver.resolveRequest` (`VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST`) and a custom `serializer` (`VIFX_UNSUPPORTED_METRO_SERIALIZER`). For those paths you keep Metro, or remove the custom hook before migrating. Everything else vifx interop reports — `assetExts`, `sourceExts`, `extraNodeModules`, `babelTransformerPath`, `watchFolders` — maps to a `vifx.config.ts` setting or a Vite plugin. See [Migration](../guide/migration) for the full mapping.

### Web is a companion target

Web is served by real react-native-web through a Vite dev server and mounts through the genuine `AppRegistry.runApplication`. By design it is a companion to native: native-only libraries (reanimated, skia, sqlite, gesture-handler) are rerouted or degraded rather than brought to full parity. Native (iOS/Android) is the primary output; web is a development and preview surface. See [Support Matrix](./support-matrix) for per-library behavior.

### Expo CLI and EAS — a separate boundary

vifx replaces the Metro bundling path, not Expo. Expo Go orchestration, native build and run, Expo Updates serving and signing, and EAS remain Expo and EAS responsibilities. `vifx expo export` produces bundle, asset, and manifest artifacts — not an Expo Updates runtime payload. vifx slots into the bundling seam and leaves the rest of the Expo workflow intact.

## See also

- [Features](./features) — the full capability inventory.
- [CLI](./cli) — every command and flag.
- [Config](./config) — the `vifx.config.ts` and `vite.config.vifx.ts` contracts.
- [Migration](../guide/migration) — moving an existing Metro or Expo project to vifx.
- [Getting Started](../guide/getting-started) — install and first build.
