# CLI

The CLI is the main user-facing surface for inspection, onboarding, build, browser preview, native iOS execution, and Expo export workflows.

For the recommended Expo onboarding path, run the CLI from this repository through:

```sh
pnpm vifx <command> ...
```

## `vifx setup`

Status: Recommended Expo onboarding path.

Onboard an existing Expo project with one setup command.

- Use it for the v1 migration-first Expo path.
- Use it before `vifx expo audit`, `vifx expo dev`, or `vifx native run`.

```sh
pnpm vifx setup <expo-project-path> --yes
pnpm vifx setup <expo-project-path> --yes --with-vite-config
pnpm vifx setup <expo-project-path> --json
```

- `vifx setup` is Expo-only in v1.
- By default it creates only `vifx.config.ts`.
- It does not edit `vite.config.ts`, `app.json`, Expo scripts, EAS scripts, or app source files.
- It does not add `@vifx/*` dependencies to the target project's `package.json`.
- `--with-vite-config` adds `vite.config.vifx.ts` as an advanced opt-in surface for direct Vite usage.
- `--dry-run` remains available as an optional preview mode, but it is no longer part of the primary onboarding flow.
- Combine `--json --yes` when you want machine-readable output after applying changes.

## `vifx init`

Status: Current.

Bootstrap a conservative `vifx.config.*` file directly.

- Use it for low-level config authoring.
- Use it after doctor reports a missing config.

```sh
vifx init
vifx init --help
```

- The current command writes `vifx.config.ts` and should never overwrite user files silently.
- For existing Expo apps, prefer `vifx setup` as the recommended onboarding path.
- Expo Router projects with an `app/` directory scaffold `entry: "expo-router/entry"` and `reactNativeCompat: "web"` for the current browser-preview path.
- Other projects keep conservative `entry: "./index.js"` targets until the user opts into a runtime preview explicitly.

## `vifx doctor`

Status: Current.

Inspect readiness, versions, config presence, detected Vite plugin mode, and current support boundaries.

- Use it before widening support claims.
- Use it after changing config or plugin wiring.

```sh
vifx doctor
vifx doctor --json
```

- JSON mode should emit valid JSON with no extra logs.
- Doctor is the safest first command in the flow.
- Terminal mode reports detected Metro, Vite, and Vifx config paths when present.
- It reports `none`, `react-native`, or `expo` when a Vifx Vite plugin import is detected in `vite.config.*`.
- It warns when the Expo dependency is outside the fixture-backed SDK 54 experiment range.

## `vifx inspect`

Status: Current.

Umbrella inspection entrypoint before choosing Metro-specific or compatibility-specific workflows.

- Use it when you want an inspection-oriented entrypoint.
- Use it when docs need to reinforce inspect-first behavior.

```sh
vifx inspect
vifx inspect --help
```

- The current first pass reports project primitives, config paths, Vite mode, platform files, asset groups, and diagnostics.
- Use `vifx metro inspect` for dedicated captured Metro reference inspection.

## `vifx build`

Status: Current.

Build the configured Vifx bundle targets from `vifx.config.*`.

- Use it once `vite.mode` and `vite.targets` are defined.
- Use it before browser runtime previews or artifact comparisons.

```sh
vifx build
vifx build --platform ios
vifx build --platform all --json
```

- `--platform` supports `ios`, `android`, or `all`.
- Targets with `reactNativeCompat: "web"` emit runtime HTML and JS alongside the bundle artifacts.
- This is still a controlled build path, not a Metro replacement or native runtime claim.

## `vifx run`

Status: Current.

Serve one configured target as a local browser runtime preview.

- Use it after a target is configured for browser preview.
- Use it to validate the current runtime path without replacing native workflows.

```sh
vifx run --platform ios
vifx run --platform ios --no-build
vifx run --platform android --json
```

- `vifx run` requires `vite.targets[].reactNativeCompat = "web"`.
- If multiple targets exist, pass `--platform`.
- `--no-build` reuses the existing runtime artifacts instead of rebuilding first.
- `expo-router/entry` previews work on this path, but only as browser previews. Expo Go, device runtime parity, Fast Refresh, and HMR remain out of scope.

## `vifx compat run`

Status: Current.

Run shared compatibility cases and produce reviewable reports.

- Use it in CI to measure adapters against the same contract.
- Use it locally when validating a primitive or adapter change.

```sh
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

- `metro`, `vifx`, and `all` are supported.
- The current shared suite covers `15` cases across `9` categories and passes for both adapters today.
- Failures should carry fixture and docs context.

## `vifx metro inspect`

Status: Current.

Capture Metro reference behavior as structured evidence from captured fixture artifacts.

- Use it before claiming support.
- Use it when the support matrix needs evidence for a feature row.

```sh
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
```

- Metro is a reference adapter here.
- Reports should be deterministic enough for snapshots.

## `vifx migrate`

Status: Deprecated legacy manual surface.

Umbrella migration command that points to the older Expo and bare React Native manual flows.

- Use it only when you explicitly want file-level planning instead of the main onboarding corridor.
- Prefer `vifx setup` for Expo projects.

```sh
vifx migrate --help
vifx migrate expo --write
vifx migrate expo --write --with-vite
vifx migrate react-native --write
vifx migrate react-native --write --with-vite
```

- `--dry-run` remains available as an optional preview mode.
- Existing Metro and Expo workflows must remain visible.

## `vifx migrate expo`

Status: Deprecated legacy manual surface.

Prepare an Expo project through the older, more manual migration surface.

- Use it only after doctor and reference inspection.
- Use it when you explicitly do not want the newer `vifx setup` onboarding path.

```sh
pnpm vifx migrate expo <expo-project-path> --write
pnpm vifx migrate expo <expo-project-path> --write --with-vite
```

- Never replace `expo start` automatically.
- Prefer `vifx setup` for the main Expo migration-first guide.
- `--with-vite` reuses the same minimal plugin-backed Vite init plan as `vifx vite init`.
- Expo Router projects with an `app/` directory reuse the same automatic browser-preview target detection as `vifx vite init`.
- Rollback instructions should always be printed.
- `--dry-run` remains available when you explicitly want a preview.

## `vifx migrate react-native`

Status: Deprecated legacy manual surface.

Prepare a bare React Native project through the legacy manual migration surface.

- Use it when evaluating Vifx in a bare app without losing Metro.
- Use it after a reference report already exists.

```sh
vifx migrate react-native --write
vifx migrate react-native --write --with-vite
```

- Preserve Metro config and scripts.
- `--with-vite` adds the Vifx-owned `vite.config.vifx.ts` without claiming runtime parity.
- Expo Router projects with an `app/` directory scaffold `expo-router/entry` and browser-preview targets automatically.
- Keep rollback guidance prominent.
- `--dry-run` remains available when you explicitly want a preview.

## `vifx expo audit`

Status: Current support report.

Print the explicit Expo without Metro support matrix for a project. This command is intentionally an audit surface: it lists detected Expo and React Native versions, the fixture-backed SDK range, workflow statuses, evidence, and blockers.

```sh
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo audit <expo-project-path> --export-root dist
pnpm vifx expo audit <expo-project-path> --json
```

- Workflows currently reported: dev server, build, export, Expo Router, native iOS, native Android, and Updates.
- Setup-generated `vifx.config.ts` is enough to remove the missing-config blockers for Expo build coverage, and for browser dev coverage when a web-compatible target is configured.
- `--export-root` inspects an existing Expo export directory and can mark export support as inspect-only evidence.
- The command does not replace `expo start`, `expo export`, EAS, Expo Router native parity, Updates multipart directives, or native Updates validation.
- Use it before updating support claims so they stay tied to executable evidence.

## `vifx expo dev`

Status: Current browser preview server.

Start a Vite-powered browser dev server for one configured Expo target. This uses the Expo Vite plugin, the React Native web-compat shims, and Vite HMR for browser previews.

```sh
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo dev <expo-project-path> --platform android --port 5174
pnpm vifx expo dev <expo-project-path> --platform ios --json
```

- Requires `vite.mode = "expo"` and a single target with `reactNativeCompat = "web"`.
- The recommended `vifx setup` command configures that browser-preview target only when Expo Router and `app/` are both detected.
- Serves a generated dev HTML entry and virtual dev client from Vite; it does not write build output.
- Supports Vite browser HMR for the current preview path.
- Does not implement Expo Go, native dev-client protocol, device runtime parity, or React Native Fast Refresh parity.

## `vifx expo export`

Status: Current export generation.

Build configured Expo Vifx targets and write an Expo export directory containing bundles, source maps, assets, `manifest.json`, `metadata.json`, and optional Expo Updates v1 manifest files.

```sh
vifx expo export ./path/to/expo-app
vifx expo export ./path/to/expo-app --platform ios --out-dir dist/expo
vifx expo export ./path/to/expo-app --updates-url https://updates.example/app --runtime-version 1.0.0
vifx expo export ./path/to/expo-app --json
```

- Requires `vite.mode = "expo"` and at least one configured iOS or Android target.
- Uses Vifx bundle output; it does not call Metro or Expo CLI.
- The output is inspectable by `inspectExpoExport` and `vifx expo audit --export-root`.
- `--updates-url` and `--runtime-version` generate per-platform `updates/<platform>/manifest.json` files that reference the exported assets.
- `--created-at` can pin the Updates manifest timestamp for reproducible fixtures and tests.
- This is not full `expo export`, native Updates validation, or EAS parity yet; response signing is only available through `vifx expo serve` when configured.

## `vifx expo serve`

Status: Current local Updates serving.

Serve a Vifx-generated Expo export directory with the Expo Updates v1 JSON or multipart manifest request shape and static asset responses.

```sh
vifx expo serve ./path/to/expo-app
vifx expo serve ./path/to/expo-app --export-root dist/expo
vifx expo serve ./path/to/expo-app --host 0.0.0.0 --port 8081
vifx expo serve ./path/to/expo-app --signing-key ./private.pem --signing-key-id root
vifx expo serve ./path/to/expo-app --signing-key ./private.pem --signing-key-id root --signing-alg rsa-v1_5-sha256
vifx expo serve ./path/to/expo-app --json
```

- Serves `GET /`, `/manifest`, or `/update` as an Updates v1 JSON manifest response, or as a `multipart/mixed` manifest part when requested, with `expo-protocol-version: 1`, `expo-platform`, and `expo-runtime-version`.
- `--signing-key` enables `expo-signature` response headers for clients that send `expo-expect-signature`.
- `--signing-alg` currently supports `rsa-v1_5-sha256` only and defaults to that value when omitted.
- Serves referenced bundles and assets from the same export root with stable content types and immutable cache headers for asset-like files.
- Does not implement directive parts, rollback directives, native client execution, or EAS Update parity.

## `vifx vite init`

Status: Advanced manual surface.

Scaffold a plugin-backed `vite.config.vifx.ts` once the team intentionally enters advanced direct Vite work.

- Use it after config and primitive work exist.
- Use it when you explicitly want a separate Vifx-owned Vite config file.
- It is not required for the recommended `vifx setup -> expo audit -> expo dev/native run` flow.

```sh
vifx vite init
vifx vite init --help
vifx vite init --write
vifx vite init --force --write
```

- The current command supports `--write` and `--force`.
- Generated output imports the real Vifx plugin and keeps the manual Vite surface separate from the main onboarding flow.
- It preserves existing user `vite.config.ts` files and writes the Vifx-owned config separately.
- Expo Router projects with an `app/` directory scaffold `entry: "expo-router/entry"` and `reactNativeCompat: "web"` in `vifx.config.ts`.

## `vifx hermes compile`

Status: Current.

Expose Hermes bytecode compilation through the CLI when Hermes tooling is available.

- Use it after bundle output exists.
- Use it when Hermes readiness is in scope for the target app.

```sh
vifx hermes compile
vifx hermes compile --help
```

- It should fail gracefully if Hermes is unavailable.
- It must align with the package behavior in `@vifx/hermes-tools`.

## `vifx native prepare`

Status: Current artifact preparation.

Build configured Vifx targets and prepare native-ready bundle, source-map, Hermes, asset, and manifest files.

```sh
vifx native prepare
vifx native prepare --platform ios
vifx native prepare --platform android --out-dir .vifx/native/android --json
```

- Writes `vifx-native-manifest.json` next to the prepared native artifacts.
- iOS output uses `main.jsbundle`; Android output uses `index.android.bundle`.
- Reports Xcode or Android SDK toolchain diagnostics without claiming executed native build, install, signing, or launch parity.

## `vifx native doctor`

Status: Current host diagnostics.

Validate native host markers, prepared Vifx manifests, signing hints, local toolchain readiness, and runtime target readiness.

```sh
vifx native doctor ./path/to/project --platform ios
vifx native doctor ./path/to/project --platform android --json
vifx native doctor ./path/to/project --platform android --device emulator-5554 --json
vifx native doctor ./path/to/project --platform ios --manifest .vifx/native/ios/vifx-native-manifest.json
```

- iOS checks cover host project detection, `PRODUCT_BUNDLE_IDENTIFIER`, `DEVELOPMENT_TEAM`, `CODE_SIGN_STYLE`, automatic/manual provisioning profile readiness, prepared manifest presence, `xcodebuild`, `xcrun`, and a booted simulator target.
- Android checks cover Gradle host markers, app Gradle file, `applicationId`, signing config references, signing material references, prepared manifest presence, SDK root, `adb`, Gradle, connected adb device readiness, and Android Emulator availability.
- Warnings do not fail the command yet; they are readiness diagnostics for the later native execution gate.

## `vifx native build|install|launch`

Status: Advanced planning and execution.

Detect an iOS or Android host and create deterministic native command plans. Use `--dry-run` only when you explicitly want a preview without executing local toolchains.

```sh
vifx native build ./path/to/project --platform ios --dry-run
vifx native install ./path/to/project --platform android --dry-run --json
vifx native launch ./path/to/project --platform ios --bundle-id dev.vifx.app --dry-run
```

- iOS build plans use `xcodebuild` with `-derivedDataPath .vifx/native-build/ios`, prefer a matching CocoaPods workspace when present, and append `-quiet`.
- iOS install and launch plans use `xcrun simctl`.
- Android build and install plans use `android/gradlew` when available, otherwise `gradle`.
- Android launch plans use `adb shell monkey -p <applicationId> 1`.
- Without `--dry-run`, these commands execute the planned host command and fail with `VIFX_NATIVE_COMMAND_FAILED` if the toolchain returns a non-zero exit code or spawn failure. Error details include the exit code and available output tail metadata.
- This is not yet full native parity because the repo still lacks production-grade Android coverage, device signing proof, and broader simulator, emulator, and device execution gates.

## `vifx native run`

Status: Current native execution corridor.

Prepare native artifacts, validate host and runtime readiness, and plan build, install, and launch in one command.

```sh
pnpm vifx native run <expo-project-path> --platform ios
vifx native run ./path/to/project --platform android --json
vifx native run ./path/to/project --platform ios --no-prepare
```

- By default, `native run` calls `native prepare` for the requested platform before host validation.
- `--no-prepare` skips artifact preparation and validates the existing prepared manifest.
- The JSON output includes preparation results, host validation, runtime target diagnostics, and build/install/launch plans.
- Without `--dry-run`, it executes the planned host commands in build, install, launch order.
- On the current inferred Expo iOS no-Metro path, `native run` can prebuild the host, install CocoaPods, build the simulator app, install it, launch it, and keep the local bundle server alive until the process exits.
- `--dry-run` remains available as an advanced preview mode.
- The current repository proof is Expo SDK 54 iOS Debug simulator builds; real signing, Android execution, device execution, and broader native parity remain not supported yet.

## Repository Playground Commands

Status: Current.

The root workspace keeps maintained validation commands for the current Vifx paths:

```sh
pnpm native:validate
pnpm playground:rn-bare
pnpm playground:expo
pnpm playground:validate
```

- `apps/playground-rn-bare` validates the React Native Vite path.
- `pnpm native:validate` validates native artifact preparation, native doctor, lifecycle plans, and preview-mode `native run` orchestration against the bare React Native playground host markers.
- `apps/playground-expo` validates the Expo layer, Expo config detection, `vifx expo export`, `vifx expo audit`, and `EXPO_PUBLIC_*` injection.
- Each playground runs `vifx doctor`, `vifx inspect`, iOS and Android `vifx build`, and a direct Vite build through `vite.config.vifx.ts`.

## Example Report

```text
Compatibility report

Adapter: vifx

doctor.projectDetection           PASS   2/2
resolver.platformExtensions       PASS   4/4
resolver.packageMainFields        PASS   1/1
resolver.packageExports           PASS   1/1
assets.scaleGroups                PASS   1/1
assets.metadata                   PASS   1/1
bundler.bundleArtifacts           PASS   1/1
bundler.sourceMapValidity         PASS   1/1
monorepo.workspaceResolution      PASS   2/2
```
