# Packages

The Vifx packages are published to npm under the `@vifx` scope. All of them are released together, with the same version.

## Packages you install

| Package                          | What it is                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@vifx/cli`                      | The `vifx` command. It brings the Vite plugins and the other building blocks with it.                                           |
| `@vifx/config`                   | `defineVifxConfig` and the config loader, for a typed `vifx.config.ts`.                                                         |
| `@vifx/expo-config-plugin`       | Routes the Xcode and Gradle bundle phases of `expo prebuild` projects through `vifx export:embed`.                              |
| `@vifx/vite-config-bridge`       | `vifxResolveRequest(...)`, for a Metro-style `resolveRequest` in `vite.config.vifx.ts`.                                         |
| `@vifx/vite-plugin-expo`         | Expo builds and the Expo Go dev server; `expo()` for a hand-written `vite.config.vifx.ts`.                                      |
| `@vifx/vite-plugin-react-native` | React Native resolution, transforms, assets, Hermes and Fast Refresh; `reactNative()` for a hand-written `vite.config.vifx.ts`. |

Install `@vifx/cli` first (see [Getting Started](../guide/getting-started#install)), and add the others when your config files import them.

### `@vifx/vite-plugin-react-native`

The core replacement for Metro's bundle output. It wires platform resolution, asset collection, source maps, optional Hermes output, the transform cache, and the in-app runtime that applies Fast Refresh patches.

### `@vifx/vite-plugin-expo`

The Expo layer above the React Native plugin. It adds Expo app config handling, `EXPO_PUBLIC_*` env support, Expo shims, the Expo Go dev server with its dev engine, and the browser preview server.

### `@vifx/expo-config-plugin`

An Expo config plugin that rewrites the generated native build scripts so that they call `vifx export:embed` instead of Metro. See [Expo native builds](../guide/migration#expo-native-builds).

## Building blocks

These packages are used by the ones above and have no stable API of their own:

| Package                               | Scope                                                            |
| ------------------------------------- | ---------------------------------------------------------------- |
| `@vifx/types`                         | Shared public TypeScript contracts.                              |
| `@vifx/errors`                        | Structured errors with codes, hints, and docs paths.             |
| `@vifx/logger`                        | Terminal and JSON logging helpers.                               |
| `@vifx/core`                          | Project discovery and orchestration glue.                        |
| `@vifx/platform-resolver`             | React Native-style platform resolution.                          |
| `@vifx/asset-registry`                | Asset scale grouping, dimensions, hashes, and metadata.          |
| `@vifx/transform-cache`               | The content-addressed transform cache.                           |
| `@vifx/source-map-tools`              | Source-map validation, normalization, and comparison helpers.    |
| `@vifx/hermes-tools`                  | Hermes compiler detection and post-build bytecode orchestration. |
| `@vifx/expo-export`                   | Expo export artifact inspection and generation without Metro.    |
| `@vifx/codemods`                      | Conservative setup, init, and migration file planning.           |
| `@vifx/metro-inspect`                 | Captured Metro artifact inspection.                              |
| `@vifx/compat`, `@vifx/compat-runner` | Compatibility cases, assertions, execution, and reports.         |

`@vifx/expo-export` generates and inspects Expo export artifacts from Vifx bundles: bundles, source maps, assets, `manifest.json`, and `metadata.json`. It does not implement the Expo Updates runtime, local Updates serving, response signing, EAS metadata parity, or app execution.

`@vifx/metro-inspect` inspects captured Metro reference artifacts so that Vifx output can be compared against stable evidence. `@vifx/compat` and `@vifx/compat-runner` keep compatibility cases and report generation independent of the implementation, so that the Metro and Vifx adapters are measured against the same expectations.
