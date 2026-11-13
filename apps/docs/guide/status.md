# Project Status

Vifx is pre-1.0 and experimental. It has been validated on one Expo SDK 54 app, HNewsPro (about 2,000 modules), on iOS and Android. Expo SDK 55 to 58 are experimental tiers: no real app on those versions has been bundled with Vifx yet. Keep Metro available for anything Vifx does not cover. This page describes the project as of November 2026.

## What works today

HNewsPro loads in Expo Go from a Vifx-built bundle on iOS and Android, with the manifest, the bundle, the source map, assets, symbolication and reload messages served without Metro. The latest pass checked the server protocol on both platforms with `vifx expo smoke`, against a fresh install of the app with pnpm's default isolated layout, and ran the dev engine in Expo Go on an iOS simulator ([below](#expo-go-validation)).

- **Expo Go dev server.** `vifx expo dev --expo-go` serves `/`, `/manifest` and `/index.exp`, the bundle and source map routes, `/assets/*` (with path-traversal guards), `/status`, `POST /symbolicate`, React Native DevTools, and the `/message`, `/events` and `/hot` WebSockets. Fast Refresh runs on Rolldown's dev engine by default. See [Dev Server and Fast Refresh](/guide/dev-server).
- **Release builds.** `vifx export:embed` accepts the flags of `expo export:embed` and `react-native bundle` and writes a scope-hoisted, Oxc-minified bundle, its source map and the production asset layout. `@vifx/expo-config-plugin` routes the Xcode and Gradle bundle phases through it. `vifx expo export` writes an Expo artifact directory.
- **Resolution.** Platform extensions, `exports` conditions, native-safe main fields, workspace discovery, case-ambiguity detection, real-path package lookup for isolated installs, exact-file `exports` targets, and subpath directories that carry their own `package.json`.
- **Expo project semantics.** `.env` files with Expo CLI's precedence, and static and dynamic app configs (`app.config.js` / `.ts`) evaluated through the project's own `@expo/config`.
- **Assets.** Scale variants, image dimensions, deterministic hashing, and manifest asset entries.
- **Hermes and source maps.** `hermesc` discovery and bytecode compilation; source-map validation, comparison and symbolication.
- **CLI.** `--json` output on most commands; `vifx setup` writes only Vifx-owned files; captured Metro fixtures and a Metro-versus-Vifx compatibility runner run in CI.

## Expo SDK support

| Expo SDK | React Native | Tier         |
| -------- | ------------ | ------------ |
| 54       | 0.81         | validated    |
| 55       | 0.83         | experimental |
| 56       | 0.85         | experimental |
| 57       | 0.86         | experimental |
| 58       | 0.88         | experimental |

SDK 58 is the current Expo release. "Experimental" means fixtures, `vifx expo audit` and `vifx doctor` detection only: no real SDK 55 to 58 app has been bundled or run through Vifx yet. See the [support matrix](/reference/support-matrix#expo-sdk-support) for what each tier covers.

## Known gaps vs Expo CLI

Ordered by how much they block using Vifx instead of `expo start`:

1. **No real SDK 55 to 58 app validated.** The validated app is on SDK 54, four majors behind the current release. Bundling a real SDK 58 app is the next step.
2. **One platform per dev server.** Expo serves iOS and Android from one server (the `expo-platform` header or `?platform=`); Vifx starts one server per platform.
3. **`/symbolicate` returns frames only**, with no `codeFrame` and no `collapse` flags, so LogBox shows no source snippet and does not dim library frames.
4. **Manifest asset fields are rewritten in place** (`icon` becomes a URL); Expo keeps the path and adds `iconUrl` / `splash.imageUrl`.
5. **`runtimeVersion` policies** (`appVersion`, `nativeVersion`, `fingerprint`) are not evaluated; a policy object falls back to `exposdk:<sdk>`.
6. **The export layout differs from `npx expo export`** (`dist/expo/<platform>/index.bundle` instead of `dist/_expo/static/js/<platform>/entry-<hash>.hbc` with Expo's `metadata.json`), so `eas update --skip-bundler` cannot consume it.
7. **`exports` conditions ignore the import kind**: `import` is always preferred over `require`, where Metro picks by `import` versus `require()`.
8. No tunnel (`--tunnel`), no `i` / `a` keys to open a simulator, no typed-routes generation, and no API routes or server rendering.

Also not done yet: the long tail of library compatibility (Reanimated worklets on native are the test case), and device end-to-end tests in CI.

## Expo Go validation

The dev engine was run in Expo Go 54.0.7 on an iPhone 17 simulator (iOS 26.4) with HNewsPro, through `vifx expo dev --expo-go`. Seen in the app, with the final code:

- **Fast Refresh.** Editing a screen updates it in place and keeps its local state (the selected feed tab). The terminal prints one line per save, once the app has applied it, for example `fast refresh  app/(tabs)/index.tsx  36ms`. From save to applied took 33 to 87 ms over the session.
- **An edit to a module that is not a component** (`src/hn/hnEndpoints.ts`) is applied without a reload and re-runs its importers up to the first boundary (32 modules). The state below the contexts those modules re-create is lost, as Metro's Fast Refresh rules imply. The same edit was not timed or observed under Metro.
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

- **Expo Go crashes on some full reloads of this app.** Of seven crash reports in the session, the five examined were four segmentation faults in expo-sqlite's native `closeDatabase` (FTS5 statement finalization on its async queue) and one in React Native's `Scheduler::uiManagerDidFinishTransaction`. HNewsPro opens an FTS5 database through `SQLiteProvider`, which closes it when the tree unmounts. Whether the same reloads crash when Metro serves the app is not known yet.
- **Android was not exercised** with the dev engine, and the registry format (`--fast-refresh`) was not re-validated, `require()` of an asset included.
- **Stack frames inside a hot-patched module** are not yet symbolicated against the patch's own source map.
- **`expo-router` and `@react-navigation/*` modules have no entry in Vifx's source map**, although their code is in the bundle, so their stack frames cannot be symbolicated.

## Benchmark summary

Metro against Vifx on HNewsPro (Expo SDK 54), iOS, on an Apple M4 Pro; median of 3 warm runs, one cold run per cell:

| Measure                                        | Metro    | Vifx     |
| ---------------------------------------------- | -------- | -------- |
| `export:embed` release build, cold             | 15.18 s  | 4.55 s   |
| `export:embed` release build, warm             | 8.71 s   | 1.57 s   |
| Dev server, cold start until the first bundle  | 9.03 s   | 4.58 s   |
| Edit → Fast Refresh update received by the app | 0.14 s   | 0.05 s   |
| Edit → new full bundle available               | 0.18 s   | 0.18 s   |
| Release JS bundle                              | 3.54 MB  | 3.37 MB  |
| Hermes bytecode                                | 4.96 MB  | 5.15 MB  |
| Hermes compile                                 | 1.35 s   | 1.53 s   |
| Peak memory, warm release build                | 1,070 MB | 1,229 MB |

Metro is ahead on Hermes bytecode size (+3.9 %) and compile time (+13 %), and on the peak memory of a warm release build (+15 %). A new full bundle after an edit is level. These are single-app, single-machine results. [Vifx vs Metro](/reference/comparisons#measured-results) has every measured figure, and the [full report](https://github.com/Salnika/vifx/blob/master/docs/benchmarks/expo-vs-vifx-2026-11.md) describes the method and how to reproduce it.

The benchmark found and fixed two defects: modules bundled twice on isolated installs (198 duplicates, fixed by resolving packages to their real paths), and release builds transformed by Babel in development mode. A second benchmark on an open-source Expo SDK 58 app (`bluesky-social/social-app`) has not been built by either bundler yet.
