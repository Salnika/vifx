# Vifx

> Status: current focus is a repo-local Expo onboarding and execution corridor.

A React Native and Expo toolchain alternative built around explicit compatibility, deterministic artifacts, and a Vifx-owned setup flow.

## Why Vifx exists

React Native bundling is more than JavaScript bundling. Platform file resolution, asset metadata, source maps, Hermes workflows, and Expo-specific output shape are all part of the contract. Vifx makes that contract observable, testable, and reusable so teams can move away from Metro with explicit evidence instead of guesswork.

## Current support

This repository currently supports one concrete corridor:

- monorepo packages for Vifx primitives, compatibility tooling, and the CLI
- a documentation app in `apps/docs`
- fixtures for Expo, bare React Native, assets, workspace resolution, captured Metro artifacts, and Expo export output
- compatibility runners and reference inspection for Metro and Vifx, including package entry fields, package exports, and asset metadata cases
- codemods, source-map tools, and Hermes workflows
- a React Native Vite plugin with a controlled bundle build path
- dedicated `vifx build` and `vifx run` commands for configured Vifx targets
- a browser runtime preview for Vifx targets that opt into `reactNativeCompat: "web"`
- formal bare React Native and Expo playgrounds under `apps/playground-*` with maintained validation commands
- native artifact preparation, formal playground native host markers, native doctor checks, native build/install/launch planning, and an executed Expo SDK 54 iOS simulator path
- an Expo Router browser preview for `expo-router/entry` on that web runtime path
- `vifx expo dev` browser serving with Vite HMR for configured Expo web-compatible targets
- an Expo Vite layer with app config detection and `EXPO_PUBLIC_*` injection
- an Expo export package for inspection plus Vifx-generated bundles, source maps, manifests, metadata, assets, optional Expo Updates v1 manifests, and a local Updates server with optional response signing

The supported repo-local Expo flow is:

```bash
pnpm vifx setup <expo-project-path> --yes
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx native run <expo-project-path> --platform ios
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
pnpm vifx expo serve <expo-project-path> --export-root dist/expo
```

Not supported yet:

- Expo Go
- native dev-client protocol parity
- React Native Fast Refresh parity
- Android native execution parity
- EAS parity
- broad Expo Router native parity beyond the current browser preview and iOS simulator corridor

Common validation entrypoints in this repository:

```bash
vp install
vp check
vp test
vp run build
pnpm playground:validate
```

## Packages

- `@vifx/types`: shared public types
- `@vifx/errors`: structured errors and diagnostics
- `@vifx/logger`: terminal and JSON logging helpers
- `@vifx/config`: config definition and loading
- `@vifx/platform-resolver`: React Native-style platform resolution
- `@vifx/asset-registry`: asset grouping and normalization
- `@vifx/core`: project discovery and orchestration
- `@vifx/compat`: compatibility cases and fixture metadata
- `@vifx/compat-runner`: report generation for adapters
- `@vifx/metro-inspect`: captured Metro artifact inspection
- `@vifx/codemods`: safe init and migration file planning
- `@vifx/source-map-tools`: source map validation and symbolication
- `@vifx/hermes-tools`: Hermes compiler detection and bytecode orchestration
- `@vifx/native-artifacts`: native-ready artifact directories and manifests
- `@vifx/cli`: `vifx` command surface
- `@vifx/expo-export`: Expo export inspection and generation, including optional Updates v1 manifests and local serving
- `@vifx/vite-plugin-react-native`: controlled React Native Vite builds
- `@vifx/vite-plugin-expo`: Expo layer on top of the RN Vite plugin

## Quick start

```bash
vp install
vp run build
vp test
pnpm playground:validate
vp run docs#dev
```

## Analyze a project

```bash
pnpm --filter @vifx/cli vifx doctor ./fixtures/expo-basic
pnpm --filter @vifx/cli vifx inspect ./fixtures/rn-bare-basic
```

## Run a built target in the browser

```bash
pnpm --filter @vifx/cli vifx build ./fixtures/rn-bare-basic --platform ios
pnpm --filter @vifx/cli vifx run ./fixtures/rn-bare-basic --platform ios
```

## Start the Expo browser preview server

```bash
pnpm --filter @vifx/cli vifx expo dev ./apps/playground-expo --platform ios
```

## Run native iOS

```bash
pnpm vifx setup ./apps/playground-expo --yes
pnpm vifx native run ./apps/playground-expo --platform ios
```

## Advanced native inspection

```bash
pnpm --filter @vifx/cli vifx native prepare ./apps/playground-rn-bare --platform ios
pnpm --filter @vifx/cli vifx native build ./path/to/native-project --platform ios --dry-run
pnpm --filter @vifx/cli vifx native run ./apps/playground-rn-bare --platform ios --dry-run
pnpm native:validate
```

## Run compatibility tests

```bash
pnpm --filter @vifx/cli vifx compat run --adapter vifx
```

## Legacy manual migration

```bash
pnpm --filter @vifx/cli vifx migrate expo ./fixtures/expo-basic --write
```

## Documentation

The documentation app lives in `apps/docs`.

## Roadmap

The full staged roadmap is tracked in `SPECS.md`, with the current implementation status recorded directly in that file.

## Contributing

See `CONTRIBUTING.md` for repository conventions and validation commands.

## License

MIT
