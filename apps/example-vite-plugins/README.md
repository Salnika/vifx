# example-vite-plugins

A tiny, runnable Expo/React Native app that proves **standard Vite/Rollup
plugins transform a vifx-bundled native bundle** — verified entirely on the
build side, with no device and no runtime.

vifx auto-loads this project's `vite.config.vifx.ts` through
[`@vifx/vite-config-bridge`](../../packages/vite-config-bridge) and appends the
user's plugins _after_ its own. Because vifx exposes the standard Rollup/Vite
plugin protocol (`resolveId` / `load` / `transform`), any ordinary plugin runs
against the React Native bundle. This example demonstrates three plugin shapes
and proves each ran by grepping the built `index.bundle` for a unique sentinel.

## What it demonstrates

Three plugins are wired in [`vite.config.vifx.ts`](./vite.config.vifx.ts), each
defined under [`plugins/`](./plugins):

| #   | Plugin                   | File                                                       | Pattern                                                                                                                                    | Greppable sentinel                                                             |
| --- | ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 1   | `example:virtual-module` | [`plugins/virtual-module.ts`](./plugins/virtual-module.ts) | **Virtual module** (`resolveId` + `load`) — synthesizes `virtual:vifx-example`, a module with no file on disk.                             | `VIFX_VIRTUAL_MODULE_SENTINEL_8f3a2c1d`                                        |
| 2   | `example:build-stamp`    | [`plugins/build-stamp.ts`](./plugins/build-stamp.ts)       | **Custom `transform`** — rewrites the token `__VIFX_BUILD_STAMP__` in app source to a unique value (the `@rollup/plugin-replace` pattern). | `vifx-build-stamp-7b91e4a0` (and the token `__VIFX_BUILD_STAMP__` is _absent_) |
| 3   | `example:yaml`           | [`plugins/yaml.ts`](./plugins/yaml.ts)                     | **Non-JS asset loader** — turns `import cfg from "./app-config.yaml"` into a JS module (the `@rollup/plugin-yaml` pattern).                | `yaml-channel-c4d5e6f7`, `vifx-example-vite-plugins`                           |

The app's single screen, [`src/App.tsx`](./src/App.tsx), imports each plugin's
output and `console.log`s it. Logging keeps the values **reachable** so
tree-shaking can't drop them — that is what makes them appear verbatim in the
release bundle. On a real device these would render in the UI instead; here the
proof is purely the built bytes.

> **Why a self-contained YAML loader instead of `@rollup/plugin-yaml`?**
> This app vendors its dependencies (see `vendor/`) so it builds fully offline
> in CI worktrees. The inline loader in `plugins/yaml.ts` follows the exact same
> plugin contract as `@rollup/plugin-yaml`, so swapping in the community package
> is a one-line change: `import yaml from "@rollup/plugin-yaml"` then
> `yaml()` in the plugins array.

## How vifx merges these plugins

`vite.config.vifx.ts` declares **only `plugins`**. vifx owns `build`,
`resolve.conditions`, the define table, and the `react-native` alias, and
re-imposes them after the merge — so a clean user config that contributes only
plugins produces **no `VIFX_USER_VITE_CONFIG_CONFLICT` warnings**. The `expo()`
plugin is listed first and documents the platform/entry the user plugins run
against; the bridge dedupes it (it strips plugins whose `name` starts with
`vifx`) so it is never registered twice when vifx loads the file during
`vifx build` / `vifx export:embed`.

## Build + verify

```sh
# 1. Build the release bundle (no device needed).
vifx export:embed . --platform ios --dev false --bundle-output dist/index.bundle

# 2. Prove every plugin ran by grepping the built bundle.
node ./scripts/verify-bundle.mjs dist/index.bundle
```

Or in one step from this directory:

```sh
pnpm run verify
```

`scripts/verify-bundle.mjs` asserts each sentinel is present **and** that the
transform plugin's pre-rewrite token is gone, then exits non-zero if any check
fails (so it works as a CI gate).

### Expected output

```
  ✓ [example:virtual-module] virtual module sentinel is present  (VIFX_VIRTUAL_MODULE_SENTINEL_8f3a2c1d)
  ✓ [example:build-stamp] transform replacement value is present  (vifx-build-stamp-7b91e4a0)
  ✓ [example:build-stamp] pre-transform token is absent (transform really ran)  (NOT __VIFX_BUILD_STAMP__)
  ✓ [example:yaml] yaml releaseChannel value is present  (yaml-channel-c4d5e6f7)
  ✓ [example:yaml] yaml appName value is present  (vifx-example-vite-plugins)

✓ All plugins proven: their output is present in the built native bundle.
```

The whole release bundle is a single scope-hoisted IIFE — the three plugins'
outputs are right there in plain text:

```js
(function(){var e=`VIFX_VIRTUAL_MODULE_SENTINEL_8f3a2c1d`,t={appName:`vifx-example-vite-plugins`,releaseChannel:`yaml-channel-c4d5e6f7`};console.log(`[example] virtual module ->`,e),console.log(`[example] build stamp ->`,`vifx-build-stamp-7b91e4a0`),/* ... */})();
```

## Layout

```
example-vite-plugins/
├─ vite.config.vifx.ts   # wires the 3 user plugins (auto-loaded by vifx)
├─ vifx.config.ts        # standard Expo-shaped vifx project config
├─ plugins/              # the 3 plugins, one per file
│  ├─ virtual-module.ts
│  ├─ build-stamp.ts
│  └─ yaml.ts
├─ src/
│  ├─ App.tsx            # imports + logs each plugin's output
│  └─ app-config.yaml    # data file loaded by example:yaml at build time
├─ scripts/
│  └─ verify-bundle.mjs  # the grep-proof (CI-friendly)
└─ vendor/               # dependency-free stubs so the build runs offline
```
