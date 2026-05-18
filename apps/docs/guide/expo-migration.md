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
```

Optional advanced direct-Vite config:

```sh
pnpm vifx setup <expo-project-path> --yes --with-vite-config
```

By default, setup creates only `vifx.config.ts`. It does not edit `vite.config.ts`, `app.json`, Expo scripts, EAS scripts, or app source files.

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
```

This starts a Vite bundle/dev server for a configured target with `reactNativeCompat: "web"`. It is not `expo start`, Expo Go, native dev-client protocol parity, or full Fast Refresh.

## 5. Generate Export Artifacts

```sh
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
pnpm vifx expo audit <expo-project-path> --export-root dist/expo
```

The export contains bundles, source maps, assets, `manifest.json`, and `metadata.json`.

## Non-Goals

Vifx does not replace Expo CLI, Expo Go, EAS, app build/run workflows, Expo Updates runtime, Updates serving/signing, or production native validation.

## Related Docs

- [Getting Started](/guide/getting-started)
- [Workflows](/guide/workflows)
- [CLI Reference](/reference/cli)
