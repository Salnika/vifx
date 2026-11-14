# Support Matrix

The support matrix is product-facing. It distinguishes what the no-Metro Vite bundling path covers from workflows Vifx intentionally does not replace. See [Project Status](/guide/status) for what has been validated and the known gaps.

## Versions And Scope

The current Expo work is device-validated against Expo SDK 54 and SDK 58 (the current Expo SDK). SDK 55 through 57 are checked with fixtures and with release bundles of their default templates compared against Metro's. See [Expo SDK Support](#expo-sdk-support) for the per-SDK tiers. `vifx doctor` warns when an Expo dependency falls outside the supported SDK majors, and reports the support tier for SDKs inside it.

| Surface                                    | Supported now | Available for maintainers                                     | Out of scope                                | Notes                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------- | ------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vifx setup` for Expo projects             | yes           | `--expo-go`, `--with-vite-config`, JSON preview               | non-Expo onboarding through `setup`         | Generates Vifx-owned config without editing Expo-owned app files.                                                                                                                                                      |
| `vifx build`                               | yes           | platform filtering and JSON output                            | native app builds                           | Central production bundle command for configured Vite targets.                                                                                                                                                         |
| `vifx expo audit`                          | yes           | export-root inspection and JSON reporting                     | parity claims by itself                     | Reports config, Vite build, Metro parity, dev-server, and export-artifact workflows only.                                                                                                                              |
| `vifx expo dev`                            | partial       | browser preview plus the `--expo-go` server with Fast Refresh | full Expo CLI parity, native binaries       | Browser mode requires `reactNativeCompat: "web"`; the Expo Go server and its Fast Refresh were validated in Expo Go on iOS (SDK 54 and 58) and Android (SDK 58). See [Dev Server and Fast Refresh](/guide/dev-server). |
| `vifx expo export`                         | yes           | platform filtering, `--dev`, and JSON output                  | Expo Updates runtime, serving, signing, EAS | Writes production bundles (development with `--dev`), source maps, assets, `manifest.json`, and `metadata.json`.                                                                                                       |
| Metro comparison and compatibility reports | yes           | deeper fixture expansion                                      | live Metro replacement by comparison alone  | Metro remains the reference surface for bundle parity evidence.                                                                                                                                                        |
| Legacy migration surface                   | no            | `vifx migrate`                                                | product-facing onboarding                   | Kept as a legacy surface; use `vifx setup` for Expo and `vifx init` for bare React Native.                                                                                                                             |

## Expo SDK Support

Vifx tracks Expo SDK majors with explicit support tiers. The tiers are deliberately honest about what evidence backs them:

- **validated** — fixture-backed AND device-validated against Expo Go. This is the current gate.
- **experimental** — fixtures, `vifx expo audit`, `vifx doctor` detection, compat cases, and release bundles of the SDK's default template compared with Metro's exist, but dev-server protocols and runtime behavior are NOT device-validated.

| Expo SDK | React Native | Tier         | What is covered                                                                                   | What is NOT covered                                               |
| -------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 54       | 0.81         | validated    | Fixtures, audits, doctor detection, device-validated Expo Go dev server with a production app     | EAS, Expo Updates runtime, native binaries (see Non-Goals)        |
| 55       | 0.83         | experimental | Fixtures, audits, doctor detection, compat cases; default template's release build vs Metro       | Device validation; dev-server protocols on real devices           |
| 56       | 0.85         | experimental | Fixtures, audits, doctor detection, compat cases; default template's release build vs Metro       | Device validation; Hermes V1 runtime behavior on real devices     |
| 57       | 0.86         | experimental | Fixtures, audits, doctor detection, compat cases; default template's release build vs Metro       | Device validation; dev-server protocols on real devices           |
| 58       | 0.88         | validated    | Fixtures, audits, doctor detection; default template in Expo Go on iOS and Android, release build | A production app; native release builds (Xcode, Gradle) on SDK 58 |

SDK-specific notes:

- **SDK 55** ships New Architecture only. The `expo-sdk55-basic` fixture sets `newArchEnabled: true` accordingly.
- **SDK 56** defaults to the Hermes V1 engine. Vifx passes the Hermes engine to babel-preset-expo, as Metro does, so it picks the same Hermes V1 profile.
- **SDK 58** is the current Expo SDK (React 19.3). The dev server mounts `@react-native/dev-middleware` 0.88, the version Expo CLI 58 ships. React Native 0.88's asset registry (`react-native/asset-registry`) and its `hermes-compiler` package are supported; its opt-in iOS asset catalog is not.
- Projects on SDK majors outside this table are reported as unsupported by `vifx doctor` and `vifx expo audit`.

`vifx doctor` prints the detected SDK, its tier, and the tier notes for Expo projects, and `vifx doctor --json` exposes the same data under `expoSdkSupport`. `vifx expo audit` accepts SDK 54-58 by default and emits tier-appropriate warnings for the experimental SDKs instead of failing on the SDK version alone; an explicit `--supported-sdk` value overrides the support table and restores strict range reporting.

## Non-Goals

- full Expo CLI replacement
- full Expo CLI parity for the `--expo-go` server (see the [known gaps](/guide/status#known-gaps-vs-expo-cli))
- EAS integration
- app build/run orchestration
- Expo Updates runtime or local Updates server

<!-- BEGIN AUTO-GENERATED: library-compat-matrix -->

## Library Compatibility

_Auto-generated by `scripts/generate-support-matrix.mjs` from the `@vifx/compat-runner` library matrix. Do not edit by hand; run `pnpm docs:support-matrix` to refresh._

Each library is a synthetic fixture replicating the real package's publishing quirks (exports maps, `react-native` fields at TypeScript sources, JSX/Flow in published `.js`, native-module imports, CSS entries). The status is what the Vifx bundler produces today; the live Metro reference adapter records every library as `skip` because it is never spawned.

Snapshot for the `vifx` toolchain: 2 pass, 14 partial, 0 fail (of 16).

| Status  | Meaning                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| pass    | Resolves and bundles from the synthetic package sources with no build-time-invisible gaps.                                   |
| partial | JavaScript resolves and bundles, but a build cannot exercise a native module, worklet compilation, or a CSS/Babel transform. |
| fail    | The default build cannot produce a bundle (for example, untranspiled JSX shipped in a published `.js` file).                 |
| skip    | Not exercised by this toolchain.                                                                                             |

| Library                                     | vifx status | Detail                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-reanimated`                   | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: worklet directives are not compiled to UI-thread worklets without the Reanimated Babel plugin.                                                                                                           |
| `react-native-gesture-handler`              | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the RNGestureHandlerModule native module is only registered on a device, so gesture recognition does not run from a bundler build.                                                                       |
| `react-native-screens`                      | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the RNSScreen native host component is only available on a device, so native screen containers do not mount from a bundler build.                                                                        |
| `react-native-safe-area-context`            | pass        | Bundle built from the synthetic package sources.                                                                                                                                                                                                                      |
| `react-native-svg`                          | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the RNSVGSvgView and RNSVGPath native host components are only available on a device, so SVG rendering does not run from a bundler build.                                                                |
| `expo-image`                                | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the ExpoImage native view manager is only registered on a device, so images do not decode or render from a bundler build.                                                                                |
| `@shopify/flash-list`                       | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the AutoLayoutView native host component is only available on a device, so the high-performance list layout does not run from a bundler build.                                                           |
| `expo-sqlite`                               | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the ExpoSQLite native module is only registered on a device, so opening a database throws from a bundler build.                                                                                          |
| `react-native-vector-icons`                 | pass        | Bundle built from the synthetic package sources.                                                                                                                                                                                                                      |
| `lottie-react-native`                       | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the LottieAnimationView native host component is only available on a device, so animations do not render from a bundler build.                                                                           |
| `nativewind`                                | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the NativeWind Babel preset (jsxImportSource) and the Tailwind/PostCSS compilation of the imported CSS entry are not applied by a plain bundler build, so utility classes are not registered at runtime. |
| `react-native-webview`                      | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the RNCWebView native host component is only available on a device, so the web view does not mount from a bundler build.                                                                                 |
| `react-native-mmkv`                         | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the JSI-installed MMKV native binding is only available on a device, so a storage instance backed by real persistence cannot be created from a bundler build.                                            |
| `@react-native-async-storage/async-storage` | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the RNCAsyncStorage native module is only registered on a device, so reads and writes do not reach native storage from a bundler build.                                                                  |
| `react-native-maps`                         | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the AIRMap and AIRMapMarker native host components are only available on a device, so the map and its markers do not render from a bundler build.                                                        |
| `expo-camera`                               | partial     | Bundle built. Remaining gaps: aspects a build cannot verify: the ExpoCamera native view manager and module are only registered on a device, so the camera preview does not render and capability queries return empty from a bundler build.                           |

<!-- END AUTO-GENERATED: library-compat-matrix -->
