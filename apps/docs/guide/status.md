<script setup>
import BenchChart from "../.vitepress/theme/components/BenchChart.vue";
</script>

# Project Status

Vifx is pre-1.0 and experimental. It has been validated on one production Expo SDK 54 app (about 2,000 modules), on iOS and Android, and on the default Expo SDK 58 template in Expo Go on iOS and Android. Expo SDK 55 to 57 are experimental: release bundles of their default templates were built and compared with Metro's, but not run on a device. Keep Metro available for anything Vifx does not cover. This page describes the project as of November 2026.

## What works today

That app loads in Expo Go from a Vifx-built bundle on iOS and Android, with the manifest, the bundle, the source map, assets, symbolication and reload messages served without Metro. The latest pass checked the server protocol on both platforms with `vifx expo smoke`, against a fresh install of the app with pnpm's default isolated layout, and ran the dev engine in Expo Go on an iOS simulator ([below](#expo-go-validation)). On SDK 58, the default template runs in Expo Go on an iOS simulator and an Android emulator, Fast Refresh included ([below](#expo-sdk-55-to-58-validation)).

- **Expo Go dev server.** `vifx expo dev --expo-go` serves `/`, `/manifest` and `/index.exp`, the bundle and source map routes, `/assets/*` (with path-traversal guards), `/status`, `POST /symbolicate`, React Native DevTools, and the `/message`, `/events` and `/hot` WebSockets. Fast Refresh runs on Rolldown's dev engine by default. See [Dev Server and Fast Refresh](/guide/dev-server).
- **Release builds.** `vifx export:embed` accepts the flags of `expo export:embed` and `react-native bundle` and writes a scope-hoisted, Oxc-minified bundle, its source map and the production asset layout. `@vifx/expo-config-plugin` routes the Xcode and Gradle bundle phases through it. `vifx expo export` writes an Expo artifact directory.
- **Resolution.** Platform extensions, `exports` conditions, native-safe main fields, workspace discovery, case-ambiguity detection, real-path package lookup for isolated installs, exact-file `exports` targets, and subpath directories that carry their own `package.json`.
- **Expo project semantics.** `.env` files with Expo CLI's precedence, and static and dynamic app configs (`app.config.js` / `.ts`) evaluated through the project's own `@expo/config`.
- **Assets.** Scale variants, image dimensions, deterministic hashing, and manifest asset entries.
- **Hermes and source maps.** `hermesc` discovery and bytecode compilation; source-map validation, comparison and symbolication.
- **CLI.** `--json` output on most commands; `vifx setup` writes only Vifx-owned files; captured Metro fixtures and a Metro-versus-Vifx compatibility runner run in CI.

## Expo SDK support

| Expo SDK | React Native | Tier                                         |
| -------- | ------------ | -------------------------------------------- |
| 54       | 0.81         | <Badge type="tip" text="validated" />        |
| 55       | 0.83         | <Badge type="warning" text="experimental" /> |
| 56       | 0.85         | <Badge type="warning" text="experimental" /> |
| 57       | 0.86         | <Badge type="warning" text="experimental" /> |
| 58       | 0.88         | <Badge type="tip" text="validated" />        |

SDK 58 is the current Expo release. Its tier rests on the default `create-expo-app` template, not on a production app. "Experimental" means fixtures, `vifx expo audit` and `vifx doctor` detection, and release bundles of the default template compared with Metro's; those SDKs were not run on a device. See the [support matrix](/reference/support-matrix#expo-sdk-support) for what each tier covers.

## Known gaps vs Expo CLI

Ordered by how much they block using Vifx instead of `expo start`:

1. **No production app validated on SDK 55 to 58.** SDK 58 was validated with the default template only, SDK 55 to 57 were not run on a device, and no native release build (Xcode or Gradle through `vifx export:embed`) was run on SDK 55 to 58.
2. **One platform per dev server.** Expo serves iOS and Android from one server (the `expo-platform` header or `?platform=`); Vifx starts one server per platform.
3. **`/symbolicate` returns frames only**, with no `codeFrame` and no `collapse` flags, so LogBox shows no source snippet and does not dim library frames.
4. **Manifest asset fields are rewritten in place** (`icon` becomes a URL); Expo keeps the path and adds `iconUrl` / `splash.imageUrl`.
5. **`runtimeVersion` policies** (`appVersion`, `nativeVersion`, `fingerprint`) are not evaluated; a policy object falls back to `exposdk:<sdk>`.
6. **The export layout differs from `npx expo export`** (`dist/expo/<platform>/index.bundle` instead of `dist/_expo/static/js/<platform>/entry-<hash>.hbc` with Expo's `metadata.json`), so `eas update --skip-bundler` cannot consume it.
7. **`exports` conditions ignore the import kind**: `import` is always preferred over `require`, where Metro picks by `import` versus `require()`.
8. No tunnel (`--tunnel`), no `i` / `a` keys to open a simulator, no typed-routes generation, and no API routes or server rendering.
9. **A JSON file that a package `require`s becomes one getter per key.** Metro emits one object literal. expo-symbols' Android `symbols.json` (about 4,000 keys) is why the SDK 57 template's Android Hermes bytecode is 14 % larger than Metro's (iOS: 3 %).

Also not done yet: the long tail of library compatibility (Reanimated worklets on native are the test case), and device end-to-end tests in CI.

## Expo Go validation

The dev engine was run in Expo Go 54.0.7 on an iPhone 17 simulator (iOS 26.4) with the production app, through `vifx expo dev --expo-go`. Seen in the app, with the final code:

- **Fast Refresh.** Editing a screen updates it in place and keeps its local state (the selected tab). The terminal prints one line per save, once the app has applied it, for example `fast refresh  app/(tabs)/index.tsx  36ms`. From save to applied took 33 to 87 ms over the session.
- **An edit to a module that is not a component** (a module of API endpoints) is applied without a reload and re-runs its importers up to the first boundary (32 modules). The state below the contexts those modules re-create is lost, as Metro's Fast Refresh rules imply. The same edit was not timed or observed under Metro.
- **Compile error.** React Native's own "Failed to compile" / "Syntax Error" screen appears with the code frame. It goes away when the file is fixed, and the screen keeps its state.
- **App logs.** `console.*` output is printed in the terminal (` LOG  …`).
- **Server restart.** A running app reconnects, is told its bundle is stale, and reloads itself.

### Defects found and fixed

Running in Expo Go found eight defects that no sandbox test had caught. Each one is fixed and now has a test:

1. **Assets disappeared after the first save.** The engine empties its output directory on every build and only re-emits the assets of the modules it loads again, so fonts and images answered 404 for any app started later. Assets are now kept beside the output directory.
2. **`require("./image.png")` returned a namespace object** instead of the asset id. React Native's LogBox requires its images that way, so its UI crashed while rendering and errors never appeared in the app.
3. **The dev bundle declared its top-level bindings on the global object**, as a scope-hoisted bundle evaluated as a script does. It now runs in a function scope, like the production bundle. This collision had kept React Native's `console` polyfill out of Vifx bundles; the polyfill is included again, which routes logs to the native log and to the dev server.
4. **Module ids were relative to the server's working directory** instead of the project, so the Fast Refresh keys only matched when the server was started from the project root. A server started elsewhere also produced a dev bundle 1.1 MB larger, all of it path prefixes.
5. **An app never re-attached after a server restart**, and an app that reconnected while the first bundle was still building was ignored.
6. **A server started while the project did not compile answered 500 for good.** The first build is now tried again on the next save.
7. **A build error was printed three or four times**, each time with dozens of stack frames. It is now printed once, as the cause and its code frame.
8. **The `SQLiteProvider` compatibility layer kept handing a closed database to its children** after its effect re-ran.

### Still open

- **Expo Go crashes on some full reloads of this app.** Of seven crash reports in the session, the five examined were four segmentation faults in expo-sqlite's native `closeDatabase` (FTS5 statement finalization on its async queue) and one in React Native's `Scheduler::uiManagerDidFinishTransaction`. The app opens an FTS5 database through `SQLiteProvider`, which closes it when the tree unmounts. Whether the same reloads crash when Metro serves the app is not known yet.
- **The registry format (`--fast-refresh`) was not re-validated**, `require()` of an asset included. The dev engine has since run on Android with the SDK 58 template ([below](#expo-sdk-55-to-58-validation)).
- **Stack frames inside a hot-patched module** are not yet symbolicated against the patch's own source map.

## Expo SDK 55 to 58 validation

Each SDK's default template (`npx create-expo-app`, Expo Router with its routes in `src/app`) was set up with `vifx setup --expo-go`, then built by Metro and by Vifx.

|                                                 | SDK 55                                    | SDK 56                                    | SDK 57                                    | SDK 58                                      |
| ----------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Expo / React Native                             | 55.0.32 / 0.83.10                         | 56.0.24 / 0.85.3                          | 57.0.33 / 0.86.3                          | 58.0.25 / 0.88.1                            |
| `vifx setup`, `vifx doctor`, `vifx expo export` | <Badge type="tip" text="pass" />          | <Badge type="tip" text="pass" />          | <Badge type="tip" text="pass" />          | <Badge type="tip" text="pass" />            |
| `export:embed` asset tree, iOS and Android      | <Badge type="tip" text="same as Metro" /> | <Badge type="tip" text="same as Metro" /> | <Badge type="tip" text="same as Metro" /> | <Badge type="tip" text="same as Metro" />   |
| Expo Go                                         | —                                         | —                                         | —                                         | <Badge type="tip" text="iOS and Android" /> |

<BenchChart
  caption="export:embed release build, iOS, one run each"
  unit="s"
  :decimals="1"
  :rows="[
    { label: 'SDK 55, cold', metro: 10.1, vifx: 4.2 },
    { label: 'SDK 55, warm', metro: 5.3, vifx: 1.4 },
    { label: 'SDK 56, cold', metro: 6.6, vifx: 4.1 },
    { label: 'SDK 56, warm', metro: 1.7, vifx: 1.5 },
    { label: 'SDK 57, cold', metro: 6.9, vifx: 4.2 },
    { label: 'SDK 57, warm', metro: 1.7, vifx: 1.4 },
  ]"
/>

The asset trees differ from Metro's only by Vifx's extra `assetmap.json`. Build times are one run each, on an Apple M4 Pro; SDK 58 was not timed. Android is within 0.2 s of iOS for Vifx. Warm release builds peak at 1.0 to 1.1 GB of memory against 0.4 to 0.7 GB for Metro.

On SDK 58, the template ran in Expo Go 58.0.7 on an iPhone 17 simulator (iOS 26.5) and in Expo Go 58.0.5 on an Android 16 emulator: both tabs render and navigate, and an edit to `src/app/index.tsx` is applied by Fast Refresh (33 to 60 ms on iOS, about 300 ms on the Android emulator). A native release build was not completed: on the validation machine, Xcode stopped in Expo's own `ExpoModulesJSI` build script, before the bundle phase.

### Defects found and fixed

1. **Expo Go for Android started the app without Expo modules** (`Cannot read property 'EventEmitter' of undefined`). The manifest's scope key, `@vifx/<slug>`, made Expo Go treat it as unverified. Vifx now sends an anonymous scope key (`@anonymous/<slug>-<id>`), as Expo CLI does for a logged-out user.
2. **React Native 0.88 moved its asset registry** to `react-native/asset-registry` and `hermesc` to the `hermes-compiler` package. Vifx finds both.
3. **The SDK 58 template's layout**: routes in `src/app` and an `@/*` path alias. Setup, the router root and alias resolution handle it.
4. **The release asset layout now follows Metro's**: platform variants, `/assets/<directory>` server locations, iOS scales 1x to 3x, Android `raw/keep.xml`, and Expo's asset extensions.
5. **Babel ran without the Hermes engine hint**, so babel-preset-expo picked its Hermes V0 profile on SDK 56 and later (classes lowered, `@babel/runtime` helpers added). The SDK 57 iOS Hermes bytecode went from 8.3 % to 3.3 % larger than Metro's, the Android one from 19.4 % to 14.2 % (see gap 9 above).
6. **Modules compiled through Vifx's transform id were missing from the bundle source map**: Expo Router, `@react-navigation/*`, and any package listed in `jsxInPackages`, so their frames could not be symbolicated. Rolldown drops the source map of a module whose id starts with a NUL byte, and the id no longer does. The SDK 55 iOS map went from 1,031 to 1,365 sources.
7. **`export:embed --sourcemap-output` copied the map** without rebasing its relative `sources`, and **`--minify` was parsed but ignored**.
8. **`vifx expo export` built development bundles** that contained the Expo Go compatibility mocks. It builds production bundles unless `--dev` is passed.
9. **The React Compiler was not applied.** The SDK 58 template turns it on with `experiments.reactCompiler` in `app.json`, which Expo CLI passes to babel-preset-expo. Vifx now passes it the same way: the template's iOS release bundle has 35 of the compiler's cache markers, against 36 for Metro and 1 before.

## Benchmark summary

Metro against Vifx on the production app (Expo SDK 54), iOS, on an Apple M4 Pro; median of 3 warm runs, one cold run per cell:

<BenchChart
  scale="row"
  :rows="[
    { label: 'export:embed release build, cold', metro: 15.18, vifx: 4.55, unit: 's', delta: -70.0 },
    { label: 'export:embed release build, warm', metro: 8.71, vifx: 1.57, unit: 's', delta: -82.0 },
    { label: 'Dev server, cold start until the first bundle', metro: 9.03, vifx: 4.58, unit: 's', delta: -49.2 },
    { label: 'Edit to Fast Refresh update in the app', metro: 0.14, vifx: 0.05, unit: 's', delta: -63.6 },
    { label: 'Edit to new full bundle available', metro: 0.18, vifx: 0.18, unit: 's' },
    { label: 'Release JS bundle', metro: 3.54, vifx: 3.37, unit: 'MB', delta: -4.9 },
    { label: 'Hermes bytecode', metro: 4.96, vifx: 5.15, unit: 'MB', delta: 3.9 },
    { label: 'Hermes compile', metro: 1.35, vifx: 1.53, unit: 's', delta: 13.4 },
    { label: 'Peak memory, warm release build', metro: 1070, vifx: 1229, unit: 'MB', decimals: 0, delta: 14.9 },
  ]"
/>

Metro is ahead on Hermes bytecode size (+3.9 %) and compile time (+13 %), and on the peak memory of a warm release build (+15 %). A new full bundle after an edit is level. These are single-app, single-machine results. [Vifx vs Metro](/reference/comparisons#measured-results) has every measured figure, and the [full report](https://github.com/Salnika/vifx/blob/master/docs/benchmarks/expo-vs-vifx-2026-11.md) describes the method and how to reproduce it.

The benchmark found and fixed two defects: modules bundled twice on isolated installs (198 duplicates, fixed by resolving packages to their real paths), and release builds transformed by Babel in development mode. A second benchmark on an open-source Expo SDK 58 app (`bluesky-social/social-app`) has not been built by either bundler yet.
