# Expo Migration

The recommended path for an existing Expo project is no-Metro Vite bundling activation: setup, build, audit, dev-server proof, and export artifact generation.

Run Vifx from this repository:

```sh
pnpm vifx <command> ...
```

## Prerequisites

- Node `>=22.12.0`
- An existing Expo project with `expo` and `react-native` dependencies
- A project path you can pass to Vifx commands

## 1. Run Setup

```sh
pnpm vifx setup <expo-project-path> --yes
pnpm vifx setup <expo-project-path> --yes --expo-go
```

Optional advanced direct-Vite config:

```sh
pnpm vifx setup <expo-project-path> --yes --with-vite-config
```

By default, setup creates only `vifx.config.ts`. Pass `--expo-go` to generate native Expo targets for the Vifx Expo Go server instead of browser-preview targets. Setup does not edit `vite.config.ts`, `app.json`, Expo scripts, EAS scripts, or app source files.

## 2. Build Vite Bundles

```sh
pnpm vifx build <expo-project-path>
pnpm vifx build <expo-project-path> --platform ios --json
```

This is the core replacement surface: configured Expo targets produce Vifx/Vite bundle artifacts without Metro.

## 3. Audit The Bundling Contract

```sh
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo audit <expo-project-path> --json
```

The audit reports only bundling workflows:

- config
- Vite build
- Metro parity
- dev server
- export artifacts

## 4. Start Vite Dev Server When Configured

```sh
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go --host 0.0.0.0 --public-host <lan-ip>
```

Without `--expo-go`, this starts the older Vite browser preview for a configured target with `reactNativeCompat: "web"`. With `--expo-go`, it starts the first Vifx native manifest and bundle server for Expo Go and prints an `exp://` URL. Use `--public-host` when a physical device must fetch a LAN address instead of the bind host. The Expo Go path is still fixture-backed and is not full `expo start` or Fast Refresh parity.

## 5. Smoke The Expo Go Server

```sh
pnpm vifx expo smoke <expo-project-path> --platform ios
pnpm vifx expo smoke <expo-project-path> --platform android --json
pnpm vifx expo smoke <expo-project-path> --platform ios --host 0.0.0.0 --public-host <lan-ip>
```

The smoke command starts the Vifx Expo Go server temporarily, fetches the manifest, bundle, source map, `/status`, sampled assets, `/symbolicate`, and WebSocket reload loop, then shuts the server down. Use it before manual Expo Go/device validation.

## 6. Generate Export Artifacts

```sh
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
pnpm vifx expo audit <expo-project-path> --export-root dist/expo
```

The export contains bundles, source maps, assets, `manifest.json`, and `metadata.json`.

## Non-Goals

Vifx does not replace EAS, app build/run workflows, Expo Updates runtime, Updates serving/signing, or production native validation. Full Expo CLI and Expo Go parity is still in progress beyond the initial `--expo-go` server.

## Related Docs

- [Getting Started](/guide/getting-started)
- [Workflows](/guide/workflows)
- [CLI Reference](/reference/cli)
