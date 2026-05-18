# Vifx SPECS

## Intent

Vifx replaces Metro bundle production with Vite for React Native and Expo projects.

The product corridor is intentionally narrow:

```sh
vifx setup <project>
vifx build <project> --platform ios|android
vifx expo audit <project>
vifx expo dev <project> --platform ios|android
vifx expo export <project> --out-dir dist/expo
```

Vifx should produce, inspect, and compare bundle artifacts. It should not become an Expo runtime, native host runner, or EAS/Updates replacement.

## Non-Goals

- No Expo CLI replacement.
- No Expo Go replacement.
- No EAS replacement.
- No native build, install, launch, or run workflow.
- No native artifact manifest contract.
- No Expo Updates runtime.
- No local Expo Updates server.
- No Expo Updates response signing.
- No full React Native Fast Refresh parity at the current stage.

## Current State After Cleanup

### Packages Kept

- `@vifx/types`
- `@vifx/errors`
- `@vifx/logger`
- `@vifx/config`
- `@vifx/core`
- `@vifx/platform-resolver`
- `@vifx/asset-registry`
- `@vifx/source-map-tools`
- `@vifx/hermes-tools`
- `@vifx/expo-export`
- `@vifx/compat`
- `@vifx/compat-runner`
- `@vifx/metro-inspect`
- `@vifx/codemods`
- `@vifx/cli`
- `@vifx/vite-plugin-react-native`
- `@vifx/vite-plugin-expo`

### Commands Kept

- `vifx setup`
- `vifx build`
- `vifx expo audit`
- `vifx expo dev`
- `vifx expo export`
- `vifx doctor`
- `vifx inspect`
- `vifx run`
- `vifx compat run`
- `vifx metro inspect`
- `vifx init`
- `vifx vite init`
- `vifx migrate expo`
- `vifx migrate react-native`
- `vifx hermes compile`

### Commands Removed

- `vifx native prepare`
- `vifx native doctor`
- `vifx native build`
- `vifx native install`
- `vifx native launch`
- `vifx native run`
- `vifx expo serve`

### Package Removed

- `@vifx/native-artifacts`

### Export Scope

`@vifx/expo-export` stays in scope only for Metro-free export artifacts:

- bundles
- source maps
- assets
- `manifest.json`
- `metadata.json`

It must not generate Expo Updates manifests or start a local Updates server.

## Milestone 1: Cleanup And Recentering

Goal: remove native and Updates/server scope from code, docs, tests, and scripts.

Deliverables:

- Remove `packages/native-artifacts`.
- Remove `vifx native *` commands and CLI routing.
- Remove `vifx expo serve`.
- Remove Updates manifest generation, server responses, signing, and tests.
- Rewrite public docs around the no-Metro Vite bundling corridor.
- Stabilize root scripts and playground validation without native or Updates surfaces.

Acceptance:

- Root help does not expose `native` or `expo serve`.
- `expo --help` does not expose `serve`, Updates flags, signing flags, or native workflow claims.
- `expo audit --json` reports only `config`, `vite-build`, `metro-parity`, `dev-server`, and `export-artifacts`.
- `expo export --json` reports bundle, source-map, asset, manifest, and metadata files only.

## Milestone 2: React Native Bundle Parity

Goal: prove the first real Metro-free React Native bundle path.

Reference fixture:

```text
fixtures/rn-bare-basic/metro-output/ios
```

Deliverables:

- Compare Vifx/Vite bundle output to the captured Metro iOS bundle.
- Compare source-map shape, module path normalization, and asset metadata.
- Add focused CLI/report output for parity evidence.
- Keep the result bounded to bundle artifacts, not native execution.

Acceptance:

- Tests cover Vifx output against Metro fixture artifacts.
- A CLI command exposes the comparison in machine-readable form.
- Docs explain remaining parity gaps.

## Milestone 3: Expo Vite Bundling

Goal: produce Expo iOS and Android bundles through Vite using Expo-aware config.

Deliverables:

- Vite targets for Expo iOS and Android.
- Expo app config handling.
- `EXPO_PUBLIC_*` env handling.
- Resolver and asset behavior compatible with Expo fixtures.
- Bundle output suitable for export artifact generation.

Acceptance:

- Tests cover Expo iOS and Android bundle builds.
- Playground validation exercises Expo Vite bundle output.
- Docs state that Expo CLI, Expo Go, EAS, and native runtime remain out of scope.

## Milestone 4: Export Artifacts Without Metro

Goal: generate Expo export artifacts from Vifx bundles without Metro.

Deliverables:

- Copy Vifx bundles and source maps into the export root.
- Copy and normalize assets.
- Write `manifest.json`.
- Write `metadata.json`.
- Inspect generated output through `inspectExpoExport`.

Acceptance:

- `vifx expo export --json` lists generated bundles, source maps, assets, manifest, and metadata.
- Tests verify no Updates manifest is generated.
- `vifx expo audit --export-root` recognizes Vifx-generated metadata.

## Milestone 5: Dev Server Proof

Goal: make `vifx expo dev` useful as a Vite bundle/dev server for configured targets.

Deliverables:

- Serve one selected Expo target.
- Expose JSON server details.
- Keep Vite HMR for browser-compatible targets.
- Keep limits explicit.

Acceptance:

- Tests cover target selection and invalid configuration errors.
- Docs state that `vifx expo dev` is not `expo start`, Expo Go, native dev-client protocol parity, or full Fast Refresh.

## Acceptance Gates For Every Milestone

Each milestone must include:

- focused tests
- fixtures or fixture updates
- a CLI surface when the behavior is user-facing
- docs updates
- Metro comparison when the milestone changes bundle behavior
- explicit non-goals when a nearby Expo or native workflow remains unsupported
