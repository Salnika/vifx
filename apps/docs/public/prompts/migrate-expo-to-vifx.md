# Migrate this Expo app from Metro to Vifx

You are migrating the JavaScript bundling of the Expo app in the current directory from Metro to Vifx, which bundles React Native and Expo apps with Vite and Rolldown. Documentation: https://salnika.github.io/vifx/ (the migration guide is https://salnika.github.io/vifx/guide/migration and every error code links to https://salnika.github.io/vifx/reference/errors).

The migration is additive and reversible: Metro, `expo start`, EAS and the existing scripts must keep working when you are done (the Metro build in step 5 doubles as that check). Work through the steps below in order, verify each one before moving on, and finish with the report described in the last step.

## Rules

- Run every command from the app's root directory. Use the project's package manager, chosen from its lockfile: `bun.lock` or `bun.lockb` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → Yarn, otherwise npm. Run the Vifx CLI the same way (`npx vifx`, `pnpm vifx`, `yarn vifx` or `bunx vifx`).
- Do not upgrade, downgrade or remove any existing dependency, and do not change the Expo SDK version.
- Do not delete or rewrite `metro.config.js`, `babel.config.js`, `app.json` / `app.config.*` or the app's source code, except for the exact edits a step below asks for.
- Do not edit `ios/` or `android/` by hand. If those directories exist and are committed (a "bare" or prebuilt project), do not run `expo prebuild` in any form: on recent SDKs it recreates both directories even without `--clean`. Report what would change instead.
- Do not commit, push, publish, run EAS builds or submit anything. Leave every change in the working tree for the user to review.
- If the project's own agent instructions (an `AGENTS.md`, for example) conflict with these rules, say so in the report. In particular, a rule to "always use `npx expo install`" does not apply to the two `@vifx/*` packages of step 2: they are development tools outside the Expo SDK, so `expo install` has no SDK version to pick for them.
- If a step fails, read the error. Vifx errors carry a code (`VIFX_…`), documented at https://salnika.github.io/vifx/reference/errors: apply the documented fix if it is within these rules, and otherwise stop that step and report it. Never patch files under `node_modules`.
- Stop and ask the user before doing anything these rules do not cover.

## 1. Check the project

1. Read `package.json`. The Expo SDK is the major version of `expo` (for example `~58.0.25` is SDK 58). Vifx supports Expo SDK 54 to 58. If the app is on another SDK, or does not depend on `expo`, stop and report.
2. Check `node --version`: Vifx needs Node.js 22.18+, 24.11+ or 26+.
3. Note, for the report: the package manager, `package.json` `main`, whether the app uses Expo Router (and whether its routes are in `src/app` or `app`), whether `metro.config.js`, `babel.config.js`, `app.config.js`/`.ts`, `ios/` and `android/` exist, the `experiments` of the app config (for example `reactCompiler`), and whether the app is part of a monorepo.
4. If the directory is a git repository with uncommitted changes, stop and ask the user to commit or stash them first, so the migration's diff stays readable.
5. Run the project's own lint and type-check scripts, if it has any, and keep their results: some templates fail them before any change. At the end, report only the errors the migration added.

## 2. Install Vifx

Add the CLI as a development dependency, plus the config plugin that routes native release builds through Vifx:

```sh
npm install --save-dev @vifx/cli @vifx/expo-config-plugin
```

(`pnpm add -D`, `yarn add -D` or `bun add -d` with another package manager.) Then confirm the CLI runs and read what it detects:

```sh
npx vifx --version
npx vifx doctor .
```

`vifx doctor` prints the Expo SDK support tier, the Hermes compiler it found, and, when there is a `metro.config.js`, the Metro settings that need porting. Keep its output for the report. At this point it warns `VIFX_CONFIG_MISSING`: that is expected, step 3 creates the config.

## 3. Generate the Vifx config

Preview, then apply:

```sh
npx vifx setup . --expo-go --dry-run
npx vifx setup . --expo-go --yes
```

`vifx setup` writes `vifx.config.ts` and leaves Expo's own files alone. Then check `vifx.config.ts`:

- each target's `entry` matches what Expo bundles: `package.json` `main` (`expo-router/entry` for Expo Router apps), or the root `index` file;
- `aliases` mirror the `paths` of `tsconfig.json`, if it has any, without the `/*`: `"@/*": ["./src/*"]` becomes `"@": "./src"`.

Make sure `.vifx/`, `dist/vite/` and `dist/expo/` are ignored by git (`git check-ignore -v --no-index .vifx/x dist/vite/x dist/expo/x` shows which rule ignores each one), and add the missing ones to `.gitignore`.

## 4. Port `metro.config.js`

If there is no `metro.config.js`, or the "Metro config migration" section of `vifx doctor` reports no action, skip this step. Otherwise run:

```sh
npx vifx doctor . --fix
```

It writes the source extensions, asset extensions and module aliases into `vifx.config.ts` and prints what it wrote. Then port what it leaves, by hand:

| `metro.config.js`                                       | In Vifx                                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `resolver.sourceExts` additions                         | `resolver.extensions` in `vifx.config.ts` (written by `--fix`)                                                                  |
| `resolver.extraNodeModules`                             | the `aliases` of each `vite.targets` entry in `vifx.config.ts` (written by `--fix`)                                             |
| `resolver.assetExts` additions                          | `resolver.assetExtensions` in `vifx.config.ts` (written by `--fix`)                                                             |
| `transformer.babelTransformerPath` (e.g. an SVG loader) | a Vite or Rollup plugin in `vite.config.vifx.ts`, e.g. `vite-plugin-svgr` for `react-native-svg-transformer`                    |
| `resolver.resolveRequest`                               | `vifxResolveRequest(...)` from `@vifx/vite-config-bridge` in `vite.config.vifx.ts`, same signature and return values as Metro's |
| `watchFolders`                                          | nothing to do: Vifx resolves workspace packages itself                                                                          |
| `serializer` customizations                             | no Vifx equivalent: stop this step and report it                                                                                |

Create `vite.config.vifx.ts` with `npx vifx vite init . --write` when you need it, and install the packages it imports (`vite`, plus any plugin you add) as development dependencies. When `metro.config.js` wraps the config in a library's helper (`withNativeWind`, `withSentryConfig`, …), check that library in https://salnika.github.io/vifx/reference/support-matrix and report what Vifx does not cover instead of guessing.

## 5. Bundle with both bundlers and compare

Build the iOS release bundle with Metro, then with Vifx, under the ignored `.vifx/` directory. The bundles go beside the asset directories, not inside them, so the asset comparison only sees assets:

```sh
npx expo export:embed --platform ios --dev false --bundle-output .vifx/compare/metro/ios.jsbundle --assets-dest .vifx/compare/metro/ios
npx vifx export:embed . --platform ios --dev false --bundle-output .vifx/compare/vifx/ios.jsbundle --assets-dest .vifx/compare/vifx/ios
```

Repeat both for Android:

```sh
npx expo export:embed --platform android --dev false --bundle-output .vifx/compare/metro/android.bundle --assets-dest .vifx/compare/metro/android
npx vifx export:embed . --platform android --dev false --bundle-output .vifx/compare/vifx/android.bundle --assets-dest .vifx/compare/vifx/android
```

Both bundlers must succeed on both platforms. Then compare:

- the bundle sizes. Vifx's bundle is normally smaller than Metro's, by about 5 to 10 %: it drops modules Metro keeps (type-only and development-only ones) and has no per-module wrapper. Report a Vifx bundle that is larger than Metro's, or more than about 15 % smaller;
- the asset files: `diff -rq .vifx/compare/metro/ios .vifx/compare/vifx/ios`, and the same for `android`. Vifx adds an `assetmap.json`, and on Android `raw/keep.xml` lists the same resources in another order; any other missing, extra or different file is a finding for the report.

Then run Vifx's own checks:

```sh
npx vifx expo export . --platform all
npx vifx expo audit . --export-root dist/expo
```

Expect `Decision: partial` from the audit. `export-artifacts` should be SUPPORTED. `metro-parity` stays PARTIAL: your comparison above is that evidence. The `dev-server` row is about the browser preview (`reactNativeCompat: "web"`), which this migration does not set up: do not add it. Report any other row that is BLOCKED.

## 6. Run the app with Vifx

The Expo Go dev server keeps running until it is stopped, one platform per server: start it in the background (or in a second terminal) and read its output.

- On a device, run `npx vifx expo dev . --expo-go --platform ios` and scan the QR code it prints; the device must reach this machine on the network, and Expo Go must be the version for the app's SDK.
- On an iOS simulator, run `npx vifx expo dev . --expo-go --platform ios --public-host 127.0.0.1`, then open the `exp://` URL it prints with `xcrun simctl openurl booted <url>`.
- On an Android emulator, run a second server with `npx vifx expo dev . --expo-go --platform android --public-host 127.0.0.1 --port 5174`, then run `adb reverse tcp:5174 tcp:5174` and `adb shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:5174`.

The default port is 5173: if it is busy, pass `--port <free port>` and use that port in the commands above. The first load builds the bundle and can take about 20 seconds.

Then verify:

1. the app loads and its images, icons and fonts appear;
2. you can navigate between screens;
3. Fast Refresh: first change some state on screen (open another tab, expand a section), then make a visible text edit in that screen's file. The app must show the edit and keep that state, and the server must print a `fast refresh  <file>  <time>` line. Then revert the edit.

When you are done, stop every server you started, and run `adb reverse --remove tcp:5174` if you added it. If you cannot run a simulator or a device, say so in the report and give the user these commands to run themselves.

## 7. Native release builds (only if the user builds the app natively)

Ask the user before this step. Register the config plugin, regenerate the native projects and build in Release:

```sh
npx vifx setup . --expo-go --experimental-embed --yes
npx expo prebuild --clean
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

`--experimental-embed` adds `@vifx/expo-config-plugin` to a static `app.json`; with `app.config.js` or `app.config.ts`, add `"@vifx/expo-config-plugin"` to its `plugins` array instead. The plugin makes Xcode's "Bundle React Native code and images" phase and the Gradle bundle task call `vifx export:embed` instead of Metro. Check the release app the same way as in step 6.

## 8. Report

End with a report for the user:

- what you detected in step 1, and the `vifx doctor` summary;
- every file you created or changed, and why;
- every command you ran and whether it succeeded;
- the Metro and Vifx comparison from step 5, and the audit's rows;
- what you verified in the running app, and what you could not verify;
- anything Vifx does not cover in this app, and any error you could not fix, with its code;
- lint or type-check errors the migration added, if any;
- how to undo the migration: uninstall the `@vifx/*` packages (`npm uninstall @vifx/cli @vifx/expo-config-plugin`, or your package manager's equivalent), delete `vifx.config.ts`, `vite.config.vifx.ts`, `.vifx/`, `dist/vite/` and `dist/expo/`, revert the `.gitignore` lines, and, if step 7 ran, remove `@vifx/expo-config-plugin` from the app config and run `npx expo prebuild --clean` again.
