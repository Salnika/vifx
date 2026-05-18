# Vifx

> Status: current focus is a no-Metro Vite bundling corridor for React Native and Expo.

Vifx provides a Vite-based bundling engine for React Native and Expo projects. The product promise is intentionally narrow: produce and compare Vifx/Vite bundle artifacts so teams can move away from Metro with explicit evidence.

## Current Corridor

The supported public flow is:

```bash
pnpm vifx setup <expo-project-path> --yes
pnpm vifx build <expo-project-path>
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
```

`vifx expo dev` is a Vite bundle/dev server for configured targets. `vifx expo export` writes bundles, source maps, assets, `manifest.json`, and `metadata.json` from Vifx builds.

## In Scope

- React Native bundle builds through `@vifx/vite-plugin-react-native`
- Expo bundle builds through `@vifx/vite-plugin-expo`
- `vifx build` for configured iOS and Android bundle targets
- `vifx expo audit` for configuration, Vite build, Metro parity, dev-server, and export-artifact evidence
- `vifx expo dev` as a bounded Vite dev server
- `vifx expo export` as Metro-free export artifact generation
- Metro reference inspection and compatibility reports
- resolver, asset, source-map, Hermes, config, and CLI primitives that support bundling

## Out Of Scope

- replacing Expo CLI, Expo Go, EAS, or native build/run workflows
- Expo Updates runtime, local Updates serving, response signing, or EAS Update parity
- full React Native Fast Refresh parity
- production native runtime validation

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
- `@vifx/codemods`: setup and migration file planning
- `@vifx/source-map-tools`: source map validation and symbolication
- `@vifx/hermes-tools`: Hermes compiler detection and bytecode orchestration
- `@vifx/cli`: `vifx` command surface
- `@vifx/expo-export`: Expo export artifact inspection and generation
- `@vifx/vite-plugin-react-native`: React Native Vite bundle builds
- `@vifx/vite-plugin-expo`: Expo layer on top of the RN Vite plugin

## Validation

```bash
vp install
vp check
vp test
vp run build
pnpm playground:validate
```

Focused package checks:

```bash
pnpm --filter @vifx/cli run test
pnpm --filter @vifx/expo-export run test
pnpm --filter @vifx/vite-plugin-react-native run test
pnpm --filter @vifx/vite-plugin-expo run test
```

## Documentation

The documentation app lives in `apps/docs`. The staged product and implementation truth is tracked in `SPECS.md`.

## License

MIT
