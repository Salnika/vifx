# Roadmap

## Snapshot

- Date: `2026-05-16`
- Current phase: `Milestone 7 Expo export inspection landed`
- Summary: Milestones 0 through 7 are implemented first pass in this repository: foundations, compatibility and inspection, resolver and assets, migration codemods, source-map tooling, Hermes bytecode workflows, `vifx build`, `vifx run`, experimental React Native and Expo Vite plugins, a bounded `expo-router/entry` browser preview path, and inspect-first Expo export analysis. The proof remains bounded to controlled builds and fixture-backed evidence, especially `fixtures/rn-bare-basic`.

## Milestones

### Milestone 0 - Repository Foundation

Status: Complete.

Monorepo setup, docs, empty scaffolds, and CI basics.

- Monorepo setup
- TypeScript config
- Basic docs site
- Empty package scaffolds
- CI scripts

### Milestone 1 - Compatibility And Inspection

Status: Complete.

Compatibility cases, Metro inspection, and initial fixtures.

- `@vifx/compat`
- `@vifx/compat-runner`
- `@vifx/metro-inspect`
- Initial fixtures

### Milestone 2 - Resolver And Assets

Status: Complete.

Platform resolution and asset normalization with fixture coverage.

- `@vifx/platform-resolver`
- `@vifx/asset-registry`
- CLI commands using these packages

### Milestone 3 - CLI Migration Assistant

Status: Complete.

Doctor, init, migrate, and conservative codemods.

- `vifx doctor`
- `vifx init`
- `vifx migrate expo`
- `vifx migrate react-native`
- `@vifx/codemods`

### Milestone 4 - Source Maps And Hermes

Status: Complete.

Source-map validation and Hermes compile workflows.

- `@vifx/source-map-tools`
- `@vifx/hermes-tools`
- Source map validation
- Hermes compile command

### Milestone 5 - Vite RN Experimental Plugin

Status: Implemented first pass.

A bounded React Native Vite bundle path for controlled experiments after the primitives exist.

- `@vifx/vite-plugin-react-native`
- `buildReactNativeBundle`
- `vifx build`
- browser runtime preview artifacts for targets with `reactNativeCompat: "web"`
- `fixtures/rn-bare-basic` smoke fixture
- Resolver and asset integration
- Valid source maps and optional Hermes compile on the controlled build path

### Milestone 6 - Expo Experimental Plugin

Status: Implemented first pass.

An Expo-specific layer that stays honest about support boundaries.

- `@vifx/vite-plugin-expo`
- `vifx run`
- Expo fixture integration
- Expo app config detection
- `EXPO_PUBLIC_*` env support
- Safe `expo` and `registerRootComponent` shim
- bounded browser-preview support for `expo-router/entry`

### Milestone 7 - Expo Export Inspection

Status: Implemented inspect first.

Inspect Expo export output and compare it to Vifx understanding.

- `@vifx/expo-export`
- `fixtures/expo-export-basic`
- Inspect existing Expo export output
- Normalize bundles, source maps, manifests, and assets
