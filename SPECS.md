# Vifx SPECS

## Intent

Vifx replaces Metro for an Expo project by producing native Expo bundles with Vite and serving them through an Expo-compatible development server. "Complete and functional" means an Expo app can use Vifx instead of Metro for day-to-day development, including Expo Go loading.

The V2 product corridor is:

```sh
vifx setup <expo-project> --yes --expo-go
vifx expo dev <expo-project> --platform ios|android --expo-go
vifx build <expo-project> --platform ios|android
vifx expo export <expo-project> --out-dir dist/expo
vifx expo audit <expo-project>
```

The implementation must stay in the existing packages:

- Expo bundle and dev-server behavior lives in `@vifx/vite-plugin-expo`.
- CLI orchestration, setup, patching, and reports live in `@vifx/cli`.
- Metro evidence, fixture inspection, and parity reports live in `@vifx/metro-inspect`.
- Export artifact generation stays in `@vifx/expo-export`.

Do not add a new package for the V2 corridor.

## Scope Boundaries

### In Scope

- Expo SDK 54 first.
- Expo Go development flow for iOS and Android.
- Expo Router entrypoints, route manifests, and router-root transform options.
- Native bundle output for iOS and Android from Vite.
- Expo manifest responses that point Expo Go to Vifx bundle URLs.
- Asset URL serving compatible with Expo Go manifest assets and React Native asset loading.
- Source maps and symbolication endpoints for Vifx bundles.
- Reload and device messaging needed for a usable Expo Go loop.
- Project patching through `vifx setup`, without hand-editing Expo internals.
- Evidence-based Metro comparisons from captured artifacts and checked-in fixtures.

### Out Of Scope

- Replacing the Expo native runtime.
- Replacing Expo modules, Expo Router, React Native, Hermes, or native app binaries.
- EAS Build, EAS Submit, or hosted Expo Updates.
- Generating signed production Updates responses in V2.
- Running Metro live from Vifx for comparison or acceptance tests.
- A generic Metro clone for non-Expo React Native apps beyond the existing bundle corridor.

## Current State

The repository has been recentered toward V2, but it is not complete yet.

- `SPECS.md` now defines the Expo Go replacement corridor and HNewsPro gate.
- `vifx expo dev` still defaults to the older browser-compatible server and reports `nativeRuntime: false` in that mode.
- `vifx expo dev --expo-go` is wired to a first Vifx-backed native Expo Go protocol server.
- `@vifx/vite-plugin-expo` exposes `startExpoGoDevServer`, which currently serves a fixture-tested manifest, bundle URL, source map, packager status, `/symbolicate`, and `/message` plus `/events` WebSocket protocol response from Vifx/Vite artifacts.
- `startExpoGoDevServer` now emits `hostUri` and an `exp://` `expoGoUrl`; `vifx expo dev --expo-go` and `vifx expo smoke` accept `--public-host` for physical-device LAN testing when the bind host is `0.0.0.0`.
- `vifx expo smoke` is now routed in the CLI. It starts a temporary Vifx Expo Go server, fetches manifest, bundle, source map, `/status`, sampled assets, `/symbolicate`, and `/message` plus `/events`, then exits non-zero on failed evidence.
- Native Expo Go bundles now resolve the target app's real `expo` package instead of the Vifx browser-preview shim; the shim remains limited to web preview mode.
- `vifx setup --expo-go` now reads `tsconfig.json` path aliases into generated native Expo targets. The real HNewsPro `vifx.config.ts` has been updated with `aliases: {"@":"."}` for both iOS and Android targets and no browser `reactNativeCompat: "web"` on those native targets.
- Expo Go manifests now include Vite-emitted runtime assets, and the Expo Go server serves emitted `/assets/*` files before falling back to project config assets.
- Real HNewsPro smoke tests have fetched Vifx Expo Go manifests and bundles successfully for iOS and Android: manifest 200, bundle 200, `expo-router/entry.bundle`, `nativeRuntime: true`, `metro.serverReported: false`, `metro.spawnedByVifx: false`, and an `exp://127.0.0.1:<port>` Expo Go URL.
- The latest real HNewsPro iOS smoke fetched manifest 200, bundle 200 (3,196,500 bytes), source map 200 (701 sources), status `packager-status:running`, 12 manifest assets with 5 sampled assets returning 200, no `react-native-web`, no `__VIFX_WEB_RUNTIME__`, symbolication `sourceKnown: true`, and WebSocket reload round-trip through `/message` plus `/events`.
- The latest real HNewsPro Android smoke fetched manifest 200, bundle 200 (3,195,849 bytes), source map 200 (704 sources), status `packager-status:running`, 12 manifest assets with 5 sampled assets returning 200, no `react-native-web`, no `__VIFX_WEB_RUNTIME__`, symbolication `sourceKnown: true`, and WebSocket reload round-trip through `/message` plus `/events`.
- Earlier temporary HNewsPro copy smoke tests also passed after alias setup: iOS bundle 3,231,120 bytes with 701 source-map sources, Android bundle 3,230,676 bytes with 704 source-map sources, sampled runtime assets returning 200, no `react-native-web`, and no `__VIFX_WEB_RUNTIME__`.
- Earlier HNewsPro smoke used the existing web-preview-style config and confirmed `vifx expo dev --expo-go` writes to `.vifx/expo-go/<platform>`, resolves native `react-native/Libraries`, and does not include `react-native-web` or `__VIFX_WEB_RUNTIME__` markers; latest smoke uses the generated `--expo-go --force` native targets with aliases.
- `vifx setup --json --expo-go --force` on real HNewsPro plans only a `vifx.config.ts` update and emits the expected `vifx expo dev ... --expo-go` next command.
- `@vifx/expo-export` writes Vifx bundles, source maps, assets, `manifest.json`, and `metadata.json`, but not a live Expo Go manifest server.
- `@vifx/metro-inspect` reads captured Metro artifacts only; it does not spawn Metro.

Remaining V2 gaps include manual Expo Go/device validation from the `exp://` URL, proving the app reaches the Expo Router root layout and navigable tabs/articles, native Expo Router runtime parity beyond bundle evaluation, runtime asset parity beyond sampled emitted assets, broader reload/device messaging beyond the tested protocol slice, and real Android device acceptance.

## Acceptance Gate

Primary real-app gate:

```text
/Users/alexis.salnikoff/workspace/perso/projects/software/HNewsPro
```

Observed project shape:

- Expo SDK 54.
- React Native 0.81.
- React 19.
- Expo Router with `main: "expo-router/entry"`.
- `expo-dev-client` already installed.
- New Architecture enabled.
- Native app config in `app.json`.
- App dependencies include SQLite, Reanimated/worklets, Expo Image, Vector Icons, Fonts, Linking, WebBrowser, Haptics, Symbols, and Safe Area.
- Source imports use `@/*` aliases and platform files including `.ios` and `.web`.
- Existing untracked `.vifx/native*` files are stale artifacts from an older native-scope experiment and must not be used as V2 acceptance evidence.

HNewsPro acceptance requires:

- `vifx setup <HNewsPro> --yes --expo-go` produces only intentional Vifx config/script patches.
- `vifx expo dev <HNewsPro> --platform ios --expo-go --json` starts an Expo Go compatible Vifx server.
- Expo Go can load the app from the Vifx URL without any Metro process.
- The app reaches the root Expo Router layout and can navigate the tab screens.
- Bundle URLs, assets, source maps, symbolication, and reload/device messaging are served by Vifx.
- The CLI emits machine-readable evidence proving the server is Vifx-backed and Metro was not spawned by Vifx.
- The same gate must be repeated for Android before V2 is complete.

## Architecture Requirements

### Expo Go Server

`@vifx/vite-plugin-expo` must provide the native development server behind `vifx expo dev --expo-go`.

Required endpoints and behavior:

- Manifest routes: `/`, `/manifest`, and `/index.exp`.
- Manifest content negotiation for Expo Go and Expo Updates-style clients.
- A manifest response with `launchAsset.url` pointing to a Vifx bundle endpoint.
- `extra.expoClient` copied from resolved Expo config.
- `extra.expoGo.debuggerHost`, `developer.tool`, `packagerOpts.dev`, and `mainModuleName`.
- Bundle URL shape compatible with Expo CLI/Metro conventions, including `platform`, `dev`, `hot`, Hermes engine, router root, async routes, and React compiler query options where relevant.
- Bundle and source-map routes backed by Vite output, not Metro.
- Asset routes compatible with Expo manifest asset URLs and React Native asset references.
- `/symbolicate` backed by Vifx source maps.
- Packager status route expected by native clients.
- Websocket or message channel support for reload and dev commands needed by Expo Go.
- Clear JSON server details: URL, manifest URL, bundle URL, platform, Expo SDK, project root, and Metro process status.

### Bundling

Native Expo bundle generation must move beyond the current web-compatible preview path.

Required behavior:

- Resolve `expo-router/entry` for iOS and Android.
- Honor Expo Router app directory and router root.
- Support `@/*` aliases from TypeScript config.
- Preserve Expo public env behavior, including `EXPO_PUBLIC_*` and `process.env.EXPO_OS`.
- Use React Native platform resolution for `.ios`, `.android`, `.native`, and base files.
- Apply Expo/RN Babel behavior where required by Expo Router, Reanimated/worklets, and React Native packages.
- Emit source maps usable by the Vifx symbolication endpoint.
- Emit or expose asset metadata for manifest mutation and runtime asset loading.
- Keep Metro comparisons fixture-based and reproducible.

### Setup And Patching

`@vifx/cli` owns project-facing orchestration.

Required behavior:

- `vifx setup <expo-project> --yes --expo-go` detects Expo SDK, Expo Router, app config, TypeScript aliases, and package manager.
- Generated `vifx.config.ts` must describe native Expo targets, not browser preview targets.
- Existing user scripts must be preserved while adding Vifx scripts.
- Setup should patch only project-owned files such as `package.json`, `vifx.config.ts`, and optional Vifx-owned config files.
- Any required Expo config changes must be explicit in the setup plan and reversible.
- `--dry-run --json` must expose the exact patch plan.

## Milestone 0: Spec Recenter

Goal: make the V2 target unambiguous for future development.

Deliverables:

- Replace V1-only non-goals with this Expo Go replacement scope.
- Record HNewsPro as the acceptance gate.
- Keep package ownership explicit.
- Mark current implementation as not yet V2-complete.

Acceptance:

- `SPECS.md` no longer says Expo Go is out of scope for the target corridor.
- The spec explains that Vifx does not replace native runtimes or EAS.

## Milestone 1: Protocol Fixtures And Evidence

Goal: freeze the Expo CLI/Metro protocol that Vifx must emulate without making tests spawn Metro.

Deliverables:

- Captured manifest examples for Expo Go iOS and Android.
- Captured bundle URL examples for Expo Router SDK 54.
- Captured asset URL, source-map, status, and symbolication request examples.
- HNewsPro project audit fixture documenting dependencies, entrypoints, aliases, and platform files.
- Metro artifact fixture expansion where bundle comparison needs additional evidence.

Acceptance:

- Tests assert Vifx manifest and URL generation against checked-in fixtures.
- No test starts Metro as part of Vifx validation.
- `@vifx/metro-inspect` remains the Metro evidence package.

## Milestone 2: Native Expo Vite Bundles

Goal: produce iOS and Android Expo bundles that Expo Go can evaluate.

Deliverables:

- `@vifx/vite-plugin-expo` native bundle mode.
- Expo Router entry and router-root support.
- Reanimated/worklets transform support sufficient for HNewsPro.
- TypeScript alias support from the target project.
- Native source maps and asset metadata.
- Tests covering Expo SDK 54 fixtures and HNewsPro-like constraints.

Acceptance:

- `vifx build <fixture> --platform ios|android` emits native Expo bundles and source maps.
- Bundle output does not depend on browser `reactNativeCompat: "web"`.
- HNewsPro reaches a generated bundle without unresolved Expo Router, alias, Reanimated, or asset failures.

## Milestone 3: Expo Go Manifest Server

Goal: make Expo Go load Vifx bundles through Vifx server endpoints.

Deliverables:

- `startExpoGoDevServer` in `@vifx/vite-plugin-expo`.
- Manifest middleware for `/`, `/manifest`, and `/index.exp`.
- Bundle, source-map, asset, status, and symbolication endpoints.
- Reload/device messaging needed for Expo Go.
- JSON diagnostics for every served URL and compatibility mode.

Acceptance:

- Expo Go receives a valid manifest whose launch asset points to a Vifx bundle.
- Native clients can fetch the Vifx bundle and source map using Expo-style URLs.
- Symbolication uses Vifx source maps.
- No Vifx path starts Metro.

## Milestone 4: CLI Setup And Dev UX

Goal: replace the daily Metro-backed Expo workflow with a Vifx-backed workflow.

Deliverables:

- `vifx setup <project> --expo-go` plan/write support.
- `vifx expo dev <project> --expo-go` CLI orchestration.
- Machine-readable `--json` output for server URLs, platform, bundle URL, manifest URL, and Metro status.
- Package script additions for HNewsPro-style projects.
- Guardrails for unsupported Expo SDKs or unsupported native dependencies.

Acceptance:

- `vifx setup --dry-run --json <HNewsPro> --expo-go` shows the exact patch plan.
- `vifx setup --yes <HNewsPro> --expo-go` applies only expected project-owned changes.
- `vifx expo dev <HNewsPro> --platform ios --expo-go --json` starts the V2 server.

## Milestone 5: HNewsPro Real-App Acceptance

Goal: prove the complete V2 corridor on the selected real Expo app.

Deliverables:

- HNewsPro acceptance script or documented command sequence.
- Captured Vifx server JSON output.
- Captured manifest and bundle fetch evidence.
- Manual or automated Expo Go verification notes for iOS and Android.
- Known-gap report for any Expo SDK 54 features not exercised by HNewsPro.

Acceptance:

- HNewsPro opens in Expo Go from the Vifx URL.
- The app reaches the Expo Router root layout.
- Tabs and at least one story/article route can be opened.
- SQLite-backed app initialization does not fail because of Vifx bundling.
- Reanimated/worklets-dependent screens do not fail at module load.
- Metro is not launched by Vifx.

## Milestone 6: Export Without Metro

Goal: keep production-style export aligned with the full Metro replacement direction.

Deliverables:

- `vifx expo export` uses the same native Expo Vite bundle path as dev.
- Export metadata records Vifx bundle provenance.
- Audit reports distinguish V2 Expo Go dev support from static export support.

Acceptance:

- iOS and Android export artifacts are generated without Metro.
- Export audit confirms Vifx-generated bundles, source maps, assets, manifest, and metadata.
- Hosted Expo Updates signing remains explicitly out of scope.

## Acceptance Gates For Every Milestone

Each milestone must include:

- focused tests
- fixtures or fixture updates
- CLI surface when behavior is user-facing
- docs or spec updates
- Metro comparison only from captured evidence
- explicit non-goals when a nearby Expo, native, or EAS workflow remains unsupported
