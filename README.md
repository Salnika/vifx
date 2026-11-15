<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./apps/docs/public/logo-wordmark-dark.png" />
    <img src="./apps/docs/public/logo-wordmark.png" alt="Vifx" width="360" />
  </picture>
</h1>

<p align="center">
  Vite and Rolldown bundling for React Native and Expo, without Metro.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@vifx/cli"><img src="https://img.shields.io/npm/v/@vifx/cli?label=npm&color=7c3aed" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@vifx/cli"><img src="https://img.shields.io/npm/dm/@vifx/cli?color=7c3aed" alt="npm downloads" /></a>
  <a href="https://github.com/Salnika/vifx/actions/workflows/ci.yml"><img src="https://github.com/Salnika/vifx/actions/workflows/ci.yml/badge.svg?branch=master" alt="CI status" /></a>
  <a href="https://salnika.github.io/vifx/"><img src="https://img.shields.io/badge/docs-salnika.github.io%2Fvifx-7c3aed" alt="Documentation" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Salnika/vifx?color=blue" alt="MIT license" /></a>
</p>

Vifx builds your iOS and Android bundles, serves an Expo Go dev server with Fast Refresh, and produces the release bundle and assets that Xcode and Gradle embed. Your app is a real Rolldown module graph, so any Vite or Rollup plugin can run against it through a `vite.config.vifx.ts`.

> [!WARNING]
> Vifx is pre-1.0 and experimental. It is validated on one production Expo SDK 54 app (about 2,000 modules) and on the Expo SDK 58 default template, on iOS and Android; Expo SDK 55 to 57 are experimental. Expect rough edges, and keep Metro around for anything Vifx does not cover yet. See [Project status](https://salnika.github.io/vifx/guide/status).

## Features

- **Expo Go dev server with Fast Refresh.** `vifx expo dev --expo-go` serves the manifest, bundles, source maps, assets, `/symbolicate` and React Native DevTools. A save is compiled into a patch by Rolldown's incremental dev engine and applied in place in the running app, with Metro's Fast Refresh rules. Compile errors appear on the device; app logs appear in the terminal.
- **Release bundles for native builds.** `vifx export:embed` takes the flags of `expo export:embed` and `react-native bundle`, and writes a scope-hoisted, Oxc-minified bundle, its source map and the production asset layout. Hermes bytecode is compiled with the project's own `hermesc`.
- **Any Vite or Rollup plugin.** Vifx loads your `vite.config.vifx.ts` through Vite's own config loader and runs your plugins after its own, so `.ios` / `.android` / `.native` resolution stays correct.
- **One engine for native and web.** The same pipeline and the same define/env table serve a react-native-web preview.
- **Fast builds.** A content-addressed transform cache, the project's own Babel on worker threads where a library needs it, and Oxc everywhere else.
- **Onboarding without rewrites.** `vifx setup` writes a Vifx-owned config next to your Expo app and leaves `app.json`, scripts and sources alone. `vifx doctor` checks the project and reads your `metro.config.js` for settings to carry over.

## Benchmarks

Two Expo apps on iOS, Apple M4 Pro, November 2026: a private Expo SDK 54 app of about 2,000 modules, and the Expo SDK 58 default template, which anyone can recreate. Cold runs start with empty caches; warm figures are the median of 3 runs.

| Measure                                | SDK 54 app: Metro → Vifx | SDK 58 template: Metro → Vifx |
| -------------------------------------- | -----------------------: | ----------------------------: |
| Release build, cold                    |           15.2 s → 4.6 s |                10.5 s → 3.9 s |
| Release build, warm                    |            8.7 s → 1.6 s |                 1.7 s → 1.4 s |
| Dev server, cold start to first bundle |            9.0 s → 4.6 s |                 4.1 s → 3.9 s |
| Edit to Fast Refresh update in the app |          0.14 s → 0.05 s |               0.13 s → 0.05 s |
| Release JS bundle                      |        3.54 MB → 3.37 MB |             2.43 MB → 2.19 MB |
| Hermes bytecode                        |        4.96 MB → 5.15 MB |             3.59 MB → 3.72 MB |

Metro is still ahead on Hermes bytecode size (+3.9 % on the app, +3.6 % on the template), on Hermes compile time (+13 % on the app), and on the peak memory of a warm release build (+15 % and +68 %). On the small template, warm builds and the first dev bundle are close to Metro's. The full reports have every measure and how to reproduce them: [SDK 54 app](./docs/benchmarks/expo-vs-vifx-2026-11.md), [SDK 58 template](./docs/benchmarks/expo-template-sdk58-2026-11.md).

## Getting started

Requirements: Node.js 22.18+, 24.11+ or 26+, and an Expo or React Native project.

```bash
npm install --save-dev @vifx/cli
```

The package installs the `vifx` command. For an Expo project:

```bash
# Write a Vifx config next to the app (Expo-owned files are left untouched)
npx vifx setup . --yes --expo-go

# Start the Expo Go dev server, scan the QR code, edit
npx vifx expo dev . --expo-go --platform ios

# Check the project at any point
npx vifx doctor .
```

Build the release bundle, source map and assets for the native build:

```bash
npx vifx export:embed . \
  --platform ios \
  --dev false \
  --bundle-output ios/main.jsbundle \
  --sourcemap-output ios/main.jsbundle.map \
  --assets-dest ios/assets
```

To make `expo prebuild` route the Xcode and Gradle bundle phases through Vifx, add [`@vifx/expo-config-plugin`](./packages/expo-config-plugin) to `app.json`.

For a bare React Native project, `vifx init . --write` writes the config and `vifx dev . --platform ios` serves the Metro-compatible dev server the React Native CLI expects.

To let an AI coding agent do the migration, give it the [migration prompt](https://salnika.github.io/vifx/guide/agent-migration): it sets Vifx up, compares its release bundle with Metro's, runs the app in Expo Go and reports what is left.

## Configuration

`vifx.config.ts` (also `.mts`, `.js`, `.mjs`) is optional; without it Vifx runs from defaults rooted at the current directory.

```ts
import { defineVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  platforms: ["ios", "android"],
  vite: {
    mode: "expo",
    targets: [
      { platform: "ios", entry: "./index.js" },
      { platform: "android", entry: "./index.js" },
    ],
  },
});
```

Vite and Rollup plugins go in `vite.config.vifx.ts` (`vifx vite init` writes one):

```ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({ plugins: [svgr()] });
```

## Documentation

The documentation site is at **[salnika.github.io/vifx](https://salnika.github.io/vifx/)** (sources in [`apps/docs`](./apps/docs)):

- [Getting started](https://salnika.github.io/vifx/guide/getting-started), [migrating from Metro](https://salnika.github.io/vifx/guide/migration), and [migrating with an AI agent](https://salnika.github.io/vifx/guide/agent-migration)
- [Dev server and Fast Refresh](https://salnika.github.io/vifx/guide/dev-server)
- [CLI](https://salnika.github.io/vifx/reference/cli) and [configuration](https://salnika.github.io/vifx/reference/config) reference
- [Vifx vs Metro](https://salnika.github.io/vifx/reference/comparisons), [Vifx, Re.Pack and One](https://salnika.github.io/vifx/reference/alternatives), and the [library support matrix](https://salnika.github.io/vifx/reference/support-matrix)

## Packages

| Package                                                                 | What it is                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`@vifx/cli`](./packages/cli)                                           | The `vifx` command.                                                   |
| [`@vifx/config`](./packages/config)                                     | `defineVifxConfig` and the config loader.                             |
| [`@vifx/expo-config-plugin`](./packages/expo-config-plugin)             | Routes native release builds through `vifx export:embed`.             |
| [`@vifx/vite-plugin-expo`](./packages/vite-plugin-expo)                 | Expo builds and the Expo Go dev server.                               |
| [`@vifx/vite-plugin-react-native`](./packages/vite-plugin-react-native) | React Native resolution, transforms, assets, Hermes and Fast Refresh. |

The other `@vifx/*` packages are building blocks of these and have no stable API of their own. All packages are released together with the same version.

## Scope

Vifx replaces the Metro bundling path. Expo Go, the native projects, EAS Build, EAS Update and the Expo Updates runtime stay with Expo. A custom Metro `serializer` has no Vifx equivalent; `vifx doctor` reports it.

## Contributing

Tried Vifx on your app? A [compatibility report](https://github.com/Salnika/vifx/discussions/new?category=compat-reports) helps, whether it worked or not.

Contributions are welcome. [CONTRIBUTING.md](./CONTRIBUTING.md) explains how to set up the repository, run the checks and propose a change. Please report security issues privately as described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
