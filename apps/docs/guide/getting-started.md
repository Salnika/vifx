# Getting Started

Vifx bundles React Native and Expo apps with Vite and Rolldown instead of Metro. You point it at an existing project, serve the app to Expo Go with Fast Refresh, and build the release bundles that Xcode and Gradle embed, all from the `vifx` command. Native (iOS and Android) is the primary target; web is a companion preview served by the same engine.

Vifx is pre-1.0 and experimental. See [Project Status](/guide/status) for what has been validated so far.

This page takes you from installing the CLI to a running dev server to a release build.

## Install

The Vifx packages are published to npm under the `@vifx` scope. You need Node.js 22.18+, 24.11+ or 26+, and an Expo or React Native project. Add the CLI to the project:

```sh
npm install --save-dev @vifx/cli
```

`@vifx/cli` provides the `vifx` command. The examples on this site run it with `npx vifx`; with pnpm or Yarn, use `pnpm vifx` or `yarn vifx`.

Two more packages are only needed for specific setups:

| Package                    | Install it when                                                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vifx/config`             | Your `vifx.config.ts` imports `defineVifxConfig` from it. `@vifx/cli` re-exports `defineVifxConfig` as well.                                       |
| `@vifx/expo-config-plugin` | You want `expo prebuild` to route the Xcode and Gradle bundle phases through Vifx (see [Expo native builds](/guide/migration#expo-native-builds)). |

```sh
npm install --save-dev @vifx/config @vifx/expo-config-plugin
```

Confirm the command resolves and print the command list. Every command also accepts `--help` (or `-h`) for its full flag surface:

```sh
npx vifx --help
npx vifx expo dev --help
```

## Initialize on an existing project

Vifx reads an optional `vifx.config.ts` and an optional user `vite.config.vifx.ts`. You generate both with onboarding commands instead of writing them by hand.

### Expo projects

For an existing Expo app, run `vifx setup`. It writes a Vifx-owned `vifx.config.ts` without touching your Expo-owned files — it never edits `app.json`, `metro.config.js`, your Expo/EAS scripts, or app source. Setup is additive: your existing tooling stays in place.

```sh
npx vifx setup . --yes --expo-go
```

| Flag                 | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `--yes`              | Apply the planned changes (required in a non-interactive shell).            |
| `--dry-run`          | Preview the planned files without writing.                                  |
| `--expo-go`          | Generate native Expo Go targets (iOS + Android) for the Expo Go dev server. |
| `--with-vite-config` | Also create `vite.config.vifx.ts` for advanced Vite/Rollup plugins.         |
| `--force`            | Replace existing Vifx-owned files.                                          |
| `--json`             | Machine-readable output (previews unless combined with `--yes`).            |

Pass `--yes` or `--dry-run`, not both. `vifx setup` also reads any `metro.config.js` and prints a migration section that maps Metro settings to `vifx.config.ts` keys. See [Migration](/guide/migration) for the full mapping.

### Bare React Native projects

For a bare React Native app, generate a `vifx.config.ts` with `vifx init`:

```sh
npx vifx init . --write
```

To author the build pipeline directly — so any Vite or Rollup plugin (svgr, unplugin-icons, mdx, virtual modules) runs against your React Native app — add a user Vite config:

```sh
npx vifx vite init . --write
```

This writes `vite.config.vifx.ts` (and `vifx.config.ts` when it is missing), which Vifx auto-detects and merges. It also adds `vifx:*` scripts and Vifx dev dependencies to `package.json`, so run it once without `--write` to preview the changes. A minimal example that adds SVG support to a native bundle:

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
});
```

Vifx's own plugins run physically first, so user plugins never shadow `.ios`/`.native` resolution, and Vifx re-imposes the `resolve.*` and `define` keys it owns after the merge. See [Config](/reference/config) for the merge contract and the keys Vifx owns.

### Verify the project

`vifx doctor` reports project type, Node and package-manager versions, React Native and Expo versions, the detected config paths, the Vite mode, the Hermes compiler path, and the Expo SDK support tier:

```sh
npx vifx doctor .
npx vifx doctor . --json
```

`vifx inspect` is a quieter view of the same primitives — configs, platform files, and asset groups.

## Run the dev server

`vifx expo dev --expo-go` starts a Metro-compatible Expo Go server: it serves the manifest, the bundle, source maps, `/symbolicate`, `/status`, assets, and React Native DevTools. It prints a QR code for Expo Go right away and builds the first bundle in the background.

```sh
npx vifx expo dev . --expo-go --platform ios
```

Fast Refresh is on by default. Each save is compiled into a patch by Rolldown's dev engine, applied in the running app with Metro's Fast Refresh rules, and reported on one line:

```text
fast refresh  app/(tabs)/index.tsx  36ms
```

Compile errors appear in the app and in the terminal, and the app's `console.*` output is printed in the terminal. See [Dev Server and Fast Refresh](/guide/dev-server) for the flags, the keys, `--json` reports, reconnects, and the settings that change this behavior.

### Web companion preview

`vifx expo dev` without `--expo-go` serves a browser preview through real `react-native-web`. The selected target must set `reactNativeCompat: "web"`:

```sh
npx vifx expo dev . --platform ios
```

## Build and export for release

### Embed into a native build

`vifx export:embed` produces the release bundle and production asset layout that Xcode's "Bundle React Native code and images" phase and the Gradle bundle task consume. `--bundle-output` is required; production builds pass `--dev false`, which minifies with the Oxc minifier and scope-hoists the bundle into a single IIFE:

```sh
npx vifx export:embed . \
  --platform ios \
  --dev false \
  --bundle-output ios/main.jsbundle \
  --sourcemap-output ios/main.jsbundle.map \
  --assets-dest ios/assets
```

Its flag surface is drop-in compatible with `npx expo export:embed` and `npx react-native bundle`: unknown Metro flags (`--reset-cache`, `--max-workers`, `--transformer`, and more) are warned about and ignored rather than failing. To route prebuilt native projects through it, install `@vifx/expo-config-plugin` (see [Expo native builds](/guide/migration#expo-native-builds)) or point the Gradle bundle task at the Vifx CLI yourself in `android/app/build.gradle`:

```groovy
react {
  cliFile = file("../../node_modules/@vifx/cli/dist/bin.mjs")
  bundleCommand = "export:embed"
}
```

`EXPO_PUBLIC_*` environment variables are inlined into the bundle as both `import.meta.env.<KEY>` and `process.env.<KEY>`:

```sh
EXPO_PUBLIC_API_URL=https://api.example.com \
  npx vifx export:embed . --platform ios --dev false --bundle-output ios/main.jsbundle
```

### Export an Expo artifact directory

`vifx expo export` builds the configured Expo targets and writes production bundles (development ones with `--dev`), source maps, assets, `manifest.json`, and `metadata.json` to an output directory:

```sh
npx vifx expo export . --platform all --out-dir dist/expo
```

`vifx expo audit` reports the no-Metro bundling contract — config, Vite build, Metro parity, dev server, and export artifacts — across iOS and Android:

```sh
npx vifx expo audit .
```

### Hermes bytecode

Set `hermes: true` on a target to compile the release `.bundle` to `.hbc`. In production the bundle is already Oxc-minified, so bytecode is generated from the minified script. Vifx detects and orchestrates `hermesc`; it does not vendor Hermes.

## Next steps

- [Dev Server and Fast Refresh](/guide/dev-server) — flags, keys, terminal output, compile errors, `--json` reports, and settings.
- [Config](/reference/config) — the full `vifx.config.ts` shape, the user `vite.config.vifx.ts` merge contract, and the unified define/env table.
- [CLI](/reference/cli) — every command and flag, including the platform value sets per command.
- [Features](/reference/features) — the engine, transform cache, Fast Refresh, and platform resolution in depth.
- [Migration](/guide/migration) — moving an Expo or React Native app off Metro, including `metro.config.js` interop hints.
- [Migrate with an AI Agent](/guide/agent-migration) — a prompt to give your coding agent so it migrates an Expo project and reports back.
- [Project Status](/guide/status) — what has been validated, known gaps, and benchmark results.
