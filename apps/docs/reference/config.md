# Config reference

vifx reads a single optional project config file and resolves everything else from it: which platforms to bundle, which Vite mode to run, the targets to emit, the resolver order, and the Expo options. The file is authored with the typed `defineVifxConfig` helper from `@vifx/config`. When no config file is present, vifx runs from normalized defaults rooted at the current directory, so a config is something you add to override the defaults — not a prerequisite.

This page documents the `vifx.config.*` shape key by key, then the separate `vite.config.vifx.*` user-config contract that lets any Vite or Rollup plugin run against your React Native app.

## Config file names

vifx resolves the first file that exists, in this priority order:

```text
vifx.config.ts
vifx.config.mts
vifx.config.js
vifx.config.mjs
```

The file must `export default` the config object (an `export const vifxConfig` is also accepted). Anything else throws `VIFX_CONFIG_INVALID` with the hint to use `export default defineVifxConfig({ ... })`.

## Annotated example

```ts
import { defineVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  // Platforms vifx is aware of. Only ios/android become bundle targets;
  // native/web are accepted values but are filtered out of the target list.
  platforms: ["ios", "android"],

  // Forced project type. Omit to let vifx infer it from vite.mode / expo / reactNative.
  projectType: "expo",

  // Vite engine configuration.
  vite: {
    // none | react-native | expo. Inferred from project flags when omitted.
    mode: "expo",

    // One entry per bundle. platform and entry are required.
    targets: [
      { platform: "ios", entry: "./index.js", hermes: false, outDir: "dist/vite/ios" },
      { platform: "android", entry: "./index.js", hermes: false, outDir: "dist/vite/android" },
    ],

    // Omit to auto-detect vite.config.vifx.*; a string sets an explicit path;
    // false opts out of the user Vite config entirely.
    userConfigFile: undefined,
  },

  // Expo-specific options threaded into the Expo bundler.
  expoOptions: {
    appConfigPath: "./app.json",
    publicEnvPrefix: "EXPO_PUBLIC_",
  },

  // Module resolution order shared by native and web.
  resolver: {
    extensions: ["tsx", "ts", "jsx", "js", "json"],
    conditions: ["react-native", "import", "require", "default"],
    mainFields: ["react-native", "module", "main"],
  },

  // Logger output.
  logger: { level: "info", json: false },
});
```

You rarely write all of this by hand. [`vifx setup`](./cli) onboards an existing Expo project with a generated config, and [`vifx init`](./cli) writes a `vifx.config.ts` into any project without overwriting your files. See [the migration guide](../guide/migration) for the onboarding flow.

## Top-level keys

The config shape is closed: any key outside the documented set throws `VIFX_CONFIG_INVALID` with `Unknown config key`. The same closed-set rule applies inside `resolver`, `logger`, `expoOptions`, `vite`, and each `vite.targets[]` entry.

| Key           | Type                                                           | Default                          | Purpose                                                                                    |
| ------------- | -------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `projectRoot` | `string`                                                       | resolved cwd                     | Absolute or relative root the build resolves against.                                      |
| `platforms`   | `("ios" \| "android" \| "native" \| "web")[]`                  | `["ios", "android"]`             | Platforms vifx is aware of. Deduped; an empty array is rejected.                           |
| `projectType` | `"expo" \| "react-native" \| "workspace-package" \| "unknown"` | inferred                         | Project shape. See [inference](#inference-and-defaults).                                   |
| `expo`        | `boolean`                                                      | `projectType === "expo"`         | Marks the project as Expo.                                                                 |
| `reactNative` | `boolean`                                                      | derived                          | Marks the project as React Native.                                                         |
| `expoOptions` | object                                                         | see [below](#expooptions)        | Expo bundler options.                                                                      |
| `vite`        | object                                                         | see [below](#vite)               | The Vite engine config (mode, targets, user config).                                       |
| `resolver`    | object                                                         | see [below](#resolver)           | Module resolution order.                                                                   |
| `logger`      | object                                                         | see [below](#logger)             | Log level and JSON output.                                                                 |
| `docsBaseUrl` | `string`                                                       | `https://salnika.github.io/vifx` | Base URL used in doc links. Must be an absolute HTTP(S) URL; a trailing slash is stripped. |

### `platforms`

Drawn from `ios`, `android`, `native`, and `web`. Values are deduped and an empty array is rejected. `native` and `web` are valid platform values, but only `ios` and `android` produce Vite bundle targets — `native`/`web` are filtered out of the generated target list. The target-level `platform` key is itself restricted to `ios | android`.

### Inference and defaults

When you omit them, vifx derives the project flags so a minimal config still resolves to a coherent shape:

- `projectType` is `expo` when `vite.mode === "expo"` or `expo: true`; `react-native` when `vite.mode === "react-native"` or `reactNative: true`; otherwise `unknown`.
- `expo` defaults to `projectType === "expo"`.
- `reactNative` defaults to `true` when `expo` is set, when `projectType === "react-native"`, or when any platform is not `web`.

## `vite`

The Vite engine config has exactly three sub-keys: `mode`, `targets`, and `userConfigFile`.

| Key              | Type                                 | Default     | Purpose                                                    |
| ---------------- | ------------------------------------ | ----------- | ---------------------------------------------------------- |
| `mode`           | `"none" \| "react-native" \| "expo"` | inferred    | Which plugin drives the build.                             |
| `targets`        | `VifxBundleTargetConfig[]`           | synthesized | One entry per bundle.                                      |
| `userConfigFile` | `string \| false`                    | auto-detect | Controls the [user Vite config bridge](#user-vite-config). |

`vite.mode` is inferred from the project flags when omitted: with targets present it resolves to `expo` (Expo project), `react-native` (RN project), or `none`. When `mode` is `none`, the normalized `targets` array is empty.

If `vite.targets` is omitted (and `mode` is not `none`), vifx synthesizes one target per `ios`/`android` platform with `entry: "./index.js"`, `hermes: false`, and `outDir: "dist/vite/<platform>"`.

### `vite.targets[]`

Each target accepts exactly these keys. `platform` and `entry` are required; everything else is optional.

| Key                 | Type                            | Default                | Purpose                                                                                                                       |
| ------------------- | ------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `platform`          | `"ios" \| "android"`            | — (required)           | Bundle platform. `native`/`web` are not valid here.                                                                           |
| `entry`             | `string`                        | — (required)           | Entry module, e.g. `./index.js` or `expo-router/entry`.                                                                       |
| `hermes`            | `boolean`                       | `false`                | Compile the release `index.bundle` to Hermes bytecode (`index.hbc`).                                                          |
| `outDir`            | `string`                        | `dist/vite/<platform>` | Output directory.                                                                                                             |
| `mode`              | `"development" \| "production"` | per build              | Overrides the resolved bundle mode for this target.                                                                           |
| `moduleFormat`      | `"hoisted" \| "metro"`          | `hoisted`              | Serialization format — see [module formats](#module-formats).                                                                 |
| `reactNativeCompat` | `"none" \| "web"`               | `none`                 | Set `web` to build the companion browser target (react-native-web).                                                           |
| `aliases`           | `Record<string, string>`        | —                      | Per-target module aliases.                                                                                                    |
| `babelInPackages`   | `string[]`                      | —                      | Extra `node_modules` packages to run project Babel over.                                                                      |
| `jsxInPackages`     | `string[]`                      | —                      | Extra packages to run the JSX transform over.                                                                                 |
| `compatPreview`     | `boolean`                       | `false`                | Gate the native compat-preview shims (e.g. the from-scratch reanimated mock).                                                 |
| `shimReact`         | `boolean`                       | —                      | Dedupe/shim the React runtime for this target.                                                                                |
| `shimReactNative`   | `boolean`                       | —                      | Dedupe/shim the React Native runtime.                                                                                         |
| `shimJsxRuntime`    | `boolean`                       | —                      | Dedupe/shim the JSX runtime.                                                                                                  |
| `transformCache`    | `boolean`                       | `true`                 | Set `false` to disable the [content-addressed transform cache](./features#content-addressed-transform-cache) for this target. |

Targets are deduped by a composite key over all of their fields, so two identical target entries collapse into one.

### Module formats

`moduleFormat` selects how the bundle is serialized:

- **`hoisted`** is the default. In release it is a single scope-hoisted IIFE script (`index.bundle`, `format: "iife"`, inlined dynamic imports, global name `__vifx`). Hermes and JSC evaluate the bundle in a non-module (script) context, so this format guarantees no residual `import`/`export`/`import.meta` reaches the engine. In development, `vifx expo dev --expo-go` serves this format through Rolldown's dev engine, with Fast Refresh (see [Dev Server and Fast Refresh](../guide/dev-server)). Web targets always emit ESM.
- **`metro`** is the Metro-graph `__d`/`__r` registry format behind the alternative, experimental `--fast-refresh` dev path. The hoisted IIFE serializer does not produce this format: a native target whose `moduleFormat` is `metro` throws `VIFX_MODULE_FORMAT_UNSUPPORTED`. The [`--fast-refresh`](./cli#vifx-expo-dev) flag on `vifx expo dev` selects the registry format for the dev server itself, where the module-registry serializer produces it. Fast Refresh does not require it.

Native is the primary target by design; web is a companion target set per-target via `reactNativeCompat: "web"`.

## `resolver`

Controls module resolution, shared by native and web. Four sub-keys.

| Key               | Type       | Default                              | Purpose                                                                                                                                                                                       |
| ----------------- | ---------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `extensions`      | `string[]` | `["tsx", "ts", "jsx", "js", "json"]` | File extensions tried during resolution.                                                                                                                                                      |
| `assetExtensions` | `string[]` | Vifx's asset list                    | Extensions bundled as assets: `require("./a.lottie")` returns an asset id. Replaces the default list, which covers images, video, audio, fonts, `pdf`, `html`, `db`, `xml`, `yaml` and `zip`. |
| `conditions`      | `string[]` | `[]`                                 | Extra package `exports` conditions (may be empty).                                                                                                                                            |
| `mainFields`      | `string[]` | `["react-native", "module", "main"]` | `package.json` entry fallback order after `exports` resolution.                                                                                                                               |

`vifx doctor --fix` fills `extensions` and `assetExtensions` from your `metro.config.js` (see [Migration](../guide/migration#_3-map-your-metro-config-js)).

List entries are trimmed, a leading `.` is stripped, and duplicates are deduped. `mainFields` controls the entry fallback order after `exports` resolution: the default tries `react-native`, then `module`, then `main`.

Platform-extension resolution (`.ios`, `.android`, `.native`, `.web`) and the on-platform `exports` conditions are applied by the engine on top of these settings; see [Architecture](../guide/architecture) for the full resolution order.

## `expoOptions`

Exactly three sub-keys.

| Key                 | Type     | Default        | Purpose                                                                                     |
| ------------------- | -------- | -------------- | ------------------------------------------------------------------------------------------- |
| `appConfigPath`     | `string` | `undefined`    | Path to the Expo app config (`app.json` / `app.config.js`). Threaded into the Expo bundler. |
| `inspectExportPath` | `string` | `undefined`    | Path to an existing Expo export to inspect.                                                 |
| `publicEnvPrefix`   | `string` | `EXPO_PUBLIC_` | Prefix for public env vars inlined as build-time defines.                                   |

`appConfigPath` and `publicEnvPrefix` are threaded into `vifx export:embed`'s Expo build. Public env vars matching `publicEnvPrefix` are inlined as both `import.meta.env.<KEY>` and `process.env.<KEY>` for native and web — see [the env table in Features](./features#unified-define-and-env).

## `logger`

Exactly two sub-keys.

| Key     | Type                                     | Default | Purpose                    |
| ------- | ---------------------------------------- | ------- | -------------------------- |
| `level` | `"error" \| "warn" \| "info" \| "debug"` | `info`  | Log verbosity.             |
| `json`  | `boolean`                                | `false` | Emit structured JSON logs. |

## User Vite config

vifx loads and merges a project-owned `vite.config.vifx.*` file, so any standard Vite or Rollup plugin — svgr, unplugin-icons, mdx, virtual modules — runs against your React Native bundle. This is the single biggest structural difference from Metro, which has no Vite/Rollup plugin protocol. Generate the file with [`vifx vite init`](./cli); it is loaded with Vite's own `loadConfigFromFile`.

The file uses the standard Vite `defineConfig` surface:

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
});
```

`vite` here is your project's own Vite: install it as a dev dependency (`npm install --save-dev vite`; `vifx vite init` adds it to `package.json`). Vifx builds with the Vite+ toolchain, `@voidzero-dev/vite-plus-core` (Vite 8 and Rolldown), which its plugins depend on under that name, so it never takes your project's `vite` slot. Your config and its plugins run inside that build.

### Detection and opt-out

vifx auto-detects the file in this priority order under the project root:

```text
vite.config.vifx.ts
vite.config.vifx.mts
vite.config.vifx.js
vite.config.vifx.mjs
```

`vite.userConfigFile` in `vifx.config.*` controls the bridge: a string sets an explicit path, `false` opts out entirely, and omitting it means auto-detect. An explicit path that does not exist is treated as no user config at all.

### Keys you may set

A user config may contribute this closed set of Vite keys. On the web dev server, `optimizeDeps` and `server` are also allowed.

| Key            | Native build               | Web dev server             |
| -------------- | -------------------------- | -------------------------- |
| `plugins`      | yes                        | yes                        |
| `resolve`      | yes (minus owned sub-keys) | yes (minus owned sub-keys) |
| `define`       | yes (minus owned keys)     | yes (minus owned keys)     |
| `css`          | yes                        | yes                        |
| `esbuild`      | yes                        | yes                        |
| `json`         | yes                        | yes                        |
| `worker`       | yes                        | yes                        |
| `optimizeDeps` | dropped (web only)         | yes                        |
| `server`       | dropped (web only)         | yes                        |

Your plugins are appended _after_ vifx's own, which always run physically first. This ordering means a user plugin can never shadow `.ios`/`.native` resolution, while your plugins still see every module in the graph.

### Keys vifx owns

vifx re-imposes the keys it must control for native output, platform resolution, and the registry-format serialization. When your config sets one of these, vifx neutralizes it and emits a `VIFX_USER_VITE_CONFIG_CONFLICT` warning so the override is never silently dropped. A config that sets none of them merges identically to the no-user-config path.

| Owned key                                                                           | What vifx does                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appType`, `build`, `configFile`, `envFile`, `publicDir`, `root`                    | Dropped from the user config; vifx owns the bundle output contract and build root.                                                                      |
| `optimizeDeps`, `server` (native only)                                              | Dropped on native builds — `optimizeDeps` pre-bundles through esbuild, which does not honor `.ios`/`.native` extensions. Allowed on the web dev server. |
| `resolve.conditions`, `resolve.dedupe`                                              | Re-imposed from vifx after merge to keep platform resolution and React/RN deduping correct. The rest of your `resolve` survives.                        |
| `resolve.alias` for `react-native` and `react-native/Libraries/Image/AssetRegistry` | Physically stripped (Vite's alias plugin can win the resolution race). Your other aliases survive.                                                      |
| `define` for `__DEV__`, `global`, `process.env.NODE_ENV`, `process.env.EXPO_OS`     | Re-imposed from vifx after merge. Your other `define` entries layer on top.                                                                             |

### Warnings the bridge emits

All of these carry the `VIFX_USER_VITE_CONFIG_CONFLICT` code:

- Aliasing `react-native` or the AssetRegistry — these are stripped because they would reroute the native runtime.
- Setting `optimizeDeps.include` on a native target — ignored because it cannot resolve `.ios`/`.native` extensions.
- A user plugin with `enforce: "pre"` and a `resolveId` hook — vifx runs first, but same-`enforce` order is not contractually guaranteed by Vite, so the collision is flagged.
- Setting any reserved top-level key, reserved `resolve.*` sub-key, or reserved `define` key.

A user config that fails to load (a syntax or export error in `vite.config.vifx.*`) also throws `VIFX_USER_VITE_CONFIG_CONFLICT`, with the hint to fix the file or set `vite.userConfigFile: false`. When the file imports `vite` and the project has none installed, the hint says to install it instead.

### The registry-format staging path

The `moduleFormat: "metro"` dev build used by `--fast-refresh` does not merge your whole config. It pulls only your plugins plus the non-reserved parts of `resolve` and `define`, because its CJS staging output (`format: "cjs"`, `preserveModules`, `exports: "named"`) is the registry serialization contract and must stay vifx-owned. Your plugins still run; the output layout does not change. The default dev engine merges your config like a regular development build.

### `resolveRequest` (Metro drop-in)

A Metro-compatible `resolver.resolveRequest` is supported through the user Vite config, declared with the `vifxResolveRequest` helper from `@vifx/vite-config-bridge`. The hook is a function, so it lives in the in-process `vite.config.vifx.*` (it never crosses the `vifx export:embed` / CLI subprocess boundary, where only the serializable `vifx.config.*` travels).

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import { vifxResolveRequest } from "@vifx/vite-config-bridge";

export default defineConfig({
  plugins: [
    vifxResolveRequest((context, moduleName, platform) => {
      if (moduleName === "crypto") {
        return context.resolveRequest(context, "expo-crypto", platform);
      }
      return context.resolveRequest(context, moduleName, platform);
    }),
  ],
});
```

The contract mirrors Metro: `(context, moduleName, platform) => Resolution` (may be `async`), where `context.resolveRequest` is the recursive default resolver for delegation, and the return is the tagged union `{ type: "sourceFile", filePath }` | `{ type: "assetFiles", filePaths }` | `{ type: "empty" }`. The hook runs above vifx's alias/compat pre-filter and its result routes into vifx's asset/transform post-processing. A throwing hook falls through to vifx's default resolution rather than failing the build. See the [migration guide](../guide/migration#resolverequest) for the full walkthrough.

The sentinel plugin `vifxResolveRequest(...)` produces is a transport only — it never runs as a normal Vite plugin and is not appended to your plugin list. A `vifx.resolveRequest` field on the config object works as an alternative channel; the plugin form wins when both are present. Programmatic callers may pass `userResolveRequest` directly to `reactNative()` / `expo()`, which takes precedence over the config-declared hook.

## Related

- [CLI reference](./cli) — every command and flag.
- [Features](./features) — the engine, transform cache, define/env table, and instrumentation.
- [Comparisons](./comparisons) — how the config surface differs from `metro.config.js`.
- [Architecture](../guide/architecture) — resolution order and bundle formats.
- [Migration guide](../guide/migration) — onboarding an existing project.
