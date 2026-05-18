# Packages

This page lists the packages that remain in the no-Metro Vite bundling scope.

## Package Snapshot

| Package                          | Status                 | Scope                                                                |
| -------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `@vifx/types`                    | Implemented first pass | Shared public TypeScript contracts.                                  |
| `@vifx/errors`                   | Implemented first pass | Structured errors with codes, hints, and docs paths.                 |
| `@vifx/logger`                   | Implemented first pass | Terminal and JSON logging helpers.                                   |
| `@vifx/config`                   | Implemented first pass | `vifx.config.*` definition, defaults, discovery, and loading.        |
| `@vifx/core`                     | Implemented first pass | Project discovery and orchestration glue.                            |
| `@vifx/platform-resolver`        | Implemented first pass | React Native-style platform resolution.                              |
| `@vifx/asset-registry`           | Implemented first pass | Asset scale grouping, dimensions, hashes, and metadata.              |
| `@vifx/source-map-tools`         | Implemented first pass | Source-map validation, normalization, and comparison helpers.        |
| `@vifx/hermes-tools`             | Implemented first pass | Hermes compiler detection and post-build bytecode orchestration.     |
| `@vifx/expo-export`              | Artifact generation    | Expo export artifact inspection and generation without Metro.        |
| `@vifx/compat`                   | Implemented first pass | Fixture manifests, compatibility cases, and assertions.              |
| `@vifx/compat-runner`            | Implemented first pass | Compatibility execution and report generation.                       |
| `@vifx/metro-inspect`            | Implemented first pass | Captured Metro artifact inspection.                                  |
| `@vifx/codemods`                 | Implemented first pass | Conservative setup/init/migration file planning.                     |
| `@vifx/cli`                      | Implemented first pass | CLI for setup, build, audit, dev/export, comparison, and inspection. |
| `@vifx/vite-plugin-react-native` | Available              | Core React Native Vite bundle production.                            |
| `@vifx/vite-plugin-expo`         | Available              | Expo-specific layer above the RN Vite plugin.                        |

## Primary Bundle Packages

### `@vifx/vite-plugin-react-native`

The core replacement surface for Metro bundle output. It wires platform resolution, asset collection, source maps, optional Hermes output, and controlled Vite builds.

### `@vifx/vite-plugin-expo`

The Expo layer above the RN plugin. It adds Expo app config handling, `EXPO_PUBLIC_*` env support, Expo shims, and the bounded Vite dev-server path.

### `@vifx/expo-export`

Generates and inspects Expo export artifacts from Vifx bundles:

- bundles
- source maps
- assets
- `manifest.json`
- `metadata.json`

It does not implement Expo Updates runtime, local Updates serving, response signing, EAS metadata parity, or app execution.

## Comparison Packages

### `@vifx/metro-inspect`

Inspects captured Metro reference artifacts so Vifx output can be compared against stable evidence.

### `@vifx/compat` and `@vifx/compat-runner`

Keep compatibility cases and report generation implementation-independent so Metro and Vifx adapters can be measured against the same expectations.

## Removed From Scope

`@vifx/native-artifacts` has been removed from the workspace. Native artifact manifests, native lifecycle planning, app install/launch orchestration, and toolchain diagnostics are outside the current product corridor.
