# Vifx

> Status: experimental research toolkit. Not a production Metro replacement yet.

A compatibility toolkit and experimental modern bundling layer for React Native and Expo.

## Why Vifx exists

React Native bundling is more than JavaScript bundling. Platform file resolution, asset metadata, source maps, Hermes workflows, and Expo-specific output shape are all part of the contract. Vifx starts by making that contract observable, testable, and reusable before attempting a full Metro replacement.

## Current status

The current repository pass now covers the first full experimental slice through Expo export inspection:

- monorepo packages for Vifx primitives, compatibility tooling, and the CLI
- a documentation app in `apps/docs`
- fixtures for Expo, bare React Native, assets, workspace resolution, captured Metro artifacts, and Expo export output
- compatibility runners and reference inspection for Metro and Vifx
- codemods, source-map tools, and Hermes workflows
- an experimental React Native Vite plugin with a controlled bundle build path
- dedicated `vifx build` and `vifx run` commands for configured Vifx targets
- a browser runtime preview for Vifx targets that opt into `reactNativeCompat: "web"`
- a bounded Expo Router browser preview for `expo-router/entry` on that web runtime path
- an experimental Expo Vite layer with app config detection and `EXPO_PUBLIC_*` injection
- an inspect-only Expo export package for normalizing bundles, source maps, manifests, and assets

Still out of scope for this pass:

- Metro replacement or Expo CLI replacement
- Fast Refresh, HMR, Expo Go, or device runtime parity
- full Expo Router parity, Updates generation, and EAS integration

Known gaps in the current first pass:

- `vifx init` still writes a conservative `vifx.config.ts` and does not enable `reactNativeCompat: "web"` for runtime previews
- `vifx vite init` still scaffolds `entry: "./index.js"` and requires manual edits for Expo Router previews
- `loadVifxConfig()` imports the target config directly, so external projects need Vifx packages installed where the config resolves them

Common validation entrypoints in this repository:

```bash
vp install
vp check
pnpm test
pnpm build
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
- `@vifx/cli`: `vifx` command surface
- `@vifx/expo-export`: inspect-only Expo export normalization
- `@vifx/vite-plugin-react-native`: experimental controlled React Native Vite builds
- `@vifx/vite-plugin-expo`: experimental Expo layer on top of the RN Vite plugin

## Quick start

```bash
vp install
vp run build
vp run test
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

## Run compatibility tests

```bash
pnpm --filter @vifx/cli vifx compat run --adapter vifx
```

## Migrate an Expo project experimentally

```bash
pnpm --filter @vifx/cli vifx migrate expo ./fixtures/expo-basic --dry-run
```

## Documentation

The documentation app lives in `apps/docs`.

## Roadmap

The full staged roadmap is tracked in `SPECS.md`, with the current implementation status recorded directly in that file.

## Contributing

See `CONTRIBUTING.md` for repository conventions and validation commands.

## License

MIT
