# Roadmap

## Snapshot

- Date: `2026-05-18`
- Current phase: `Repo-local Expo onboarding, browser preview, export, and iOS simulator execution`
- Summary: Milestones 0 through 7 are implemented first pass in this repository: foundations, compatibility and inspection, resolver and assets, migration codemods, source-map tooling, Hermes bytecode workflows, `vifx build`, `vifx run`, React Native and Expo Vite plugins, maintained bare React Native and Expo playground validation, native artifact preparation for future hosts, an `expo-router/entry` browser preview path, `vifx expo dev` browser serving with Vite HMR, Expo export analysis and generation, Expo Updates v1 manifest/local serving/signing, and an Expo SDK 54 iOS Debug simulator build/install/launch path through `vifx native run`. The current product corridor is `setup -> expo audit -> expo dev -> native run -> expo export/serve`, backed by controlled builds, playground validation, fixture-backed evidence, and one executed simulator path.

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

### Milestone 5 - Vite RN Plugin

Status: Implemented first pass.

A React Native Vite bundle path for controlled builds after the primitives exist.

- `@vifx/vite-plugin-react-native`
- `buildReactNativeBundle`
- `vifx build`
- browser runtime preview artifacts for targets with `reactNativeCompat: "web"`
- `fixtures/rn-bare-basic` smoke fixture
- `apps/playground-rn-bare` validation command
- Resolver and asset integration
- Valid source maps and optional Hermes compile on the controlled build path

### Milestone 6 - Expo Plugin

Status: Implemented first pass.

An Expo-specific layer that stays honest about support boundaries.

- `@vifx/vite-plugin-expo`
- `vifx run`
- Expo fixture integration
- Expo app config detection
- `EXPO_PUBLIC_*` env support
- Safe `expo` and `registerRootComponent` shim
- browser-preview support for `expo-router/entry`
- `apps/playground-expo` validation command

### Milestone 7 - Expo Export Inspection

Status: Implemented inspect first.

Inspect Expo export output and compare it to Vifx understanding.

- `@vifx/expo-export`
- `fixtures/expo-export-basic`
- Inspect existing Expo export output
- Normalize bundles, source maps, manifests, and assets
- `evaluateExpoNoMetroContract` as an executable support/blocker audit
- `vifx expo audit` as the CLI surface for the support matrix
- `startExpoDevServer` and `vifx expo dev` for Expo browser dev serving with Vite HMR
- `writeExpoExport` and `vifx expo export` for Vifx-generated export output, including optional Expo Updates v1 manifest JSON
- `startExpoUpdatesServer` and `vifx expo serve` for local JSON manifest and asset responses
- `apps/playground-expo` runs export generation and audit in its maintained validation command

### Native Support

Status: Started with iOS execution.

The first concrete native support slices now prepare native-ready artifacts from Vifx bundle outputs, plan native host lifecycle commands, and execute an Expo iOS Debug simulator path when explicitly requested.

- `@vifx/native-artifacts`
- `vifx native prepare`
- `vifx native doctor`
- `vifx native build|install|launch --dry-run`
- `vifx native run --dry-run`
- `apps/playground-rn-bare/ios` and `apps/playground-rn-bare/android` as formal host markers
- `pnpm native:validate`
- iOS `main.jsbundle` and Android `index.android.bundle` output conventions
- `vifx-native-manifest.json`
- Xcode and Android SDK toolchain diagnostics
- simulator, emulator, and device target diagnostics
- iOS and Android host detection for command planning
- static signing marker diagnostics
- provisioning profile and signing material readiness diagnostics
- preview-mode prepare, diagnose, build, install, and launch orchestration
- Expo SDK 54 iOS Debug simulator build, install, and launch through `vifx native run`

Still missing: production-grade iOS and Android host builds beyond the current Expo iOS Debug simulator path, executed Android build/install/launch validation, provisioning profile validation, broader simulator/emulator/device validation, and complete native docs.

### Expo Without Metro

Status: Contract audit, browser dev serving, export generation, and iOS simulator execution started.

The project now has an executable contract report and CLI audit for Expo without Metro workflows, plus browser dev serving, export generation, and an iOS simulator execution slice. It does not yet implement native Expo development parity.

- Dev server: partial browser-only Vite HMR via `vifx expo dev`; no Expo Go, native dev-client protocol, device runtime, or Fast Refresh parity
- Build: partial only for configured Vifx bundle experiments
- Export: partial generation for Vifx bundle, source-map, asset, manifest, metadata, and optional Updates manifest output
- Router: partial only for browser preview flows
- Native iOS and Android: partial only for inferred Expo iOS Debug simulator builds with generated prebuild host, local bundle server, and `simctl` install or launch; Android, devices, and broader parity remain blocked
- Updates: partial only for Expo Updates v1 manifests and local JSON or multipart manifest serving with optional response signing; multipart directives, EAS parity, and native execution remain blocked
- CLI: `vifx expo dev` starts the browser dev server, `vifx expo export` generates export output and optional Updates manifests, `vifx expo serve` serves that export locally, and `vifx expo audit` reports the current contract matrix and blockers; `pnpm playground:expo` now validates export, local Updates serving, and audit, and it still does not replace Expo CLI.
