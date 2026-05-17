# Native Artifacts And Lifecycle

Status: Program B started.

Vifx native support starts with a concrete artifact contract, host diagnostics, runtime target diagnostics, and a command planning surface. `vifx native prepare` builds configured Vifx targets, copies their outputs into native-ready directories, and writes a `vifx-native-manifest.json` file that future iOS and Android hosts can consume. `vifx native doctor` validates host and runtime readiness. `vifx native build|install|launch --dry-run` detects a host and shows the native commands Vifx would execute. `vifx native run --dry-run` ties those pieces together without claiming native execution parity.

## Native Artifacts

```sh
vifx native prepare --platform ios
vifx native prepare --platform android --json
```

Prepared output includes:

- iOS bundle: `main.jsbundle`
- Android bundle: `index.android.bundle`
- source map when the Vifx build emitted one
- Hermes bytecode when the Vifx target enabled Hermes and compilation succeeded
- emitted assets
- `vifx-native-manifest.json`

The manifest records source paths, output paths, asset metadata, platform, and output root. It is intended to be the stable handoff between Vifx bundle preparation and native host integration.

## Toolchain Diagnostics

Native preparation also reports host readiness:

- iOS: `xcodebuild` and `xcrun`
- Android: SDK root, `adb`, and Gradle or `android/gradlew`

Diagnostics are advisory in this phase. They do not replace a real Xcode or Gradle build.

## Runtime Target Diagnostics

`vifx native doctor` and `vifx native run` also inspect launch targets:

- iOS: `xcrun simctl list devices booted --json`, or a named simulator/UDID when `--device` is passed.
- Android: `adb devices`, or `adb -s <serial> get-state` when `--device` is passed.
- Android emulator readiness: the SDK emulator binary under `ANDROID_HOME` or `ANDROID_SDK_ROOT`.

These checks are still readiness diagnostics. They do not boot a simulator or emulator, install an app, or prove a device launch.

## Native Host Diagnostics

```sh
vifx native doctor ./path/to/project --platform ios
vifx native doctor ./path/to/project --platform android --json
```

Host diagnostics include:

- prepared Vifx manifest presence
- iOS host project detection
- iOS bundle id, development team, code signing style, and provisioning profile readiness
- Android host Gradle markers
- Android app Gradle file, application id, signing config references, and signing material references
- local toolchain readiness
- iOS booted simulator readiness
- Android connected emulator or device readiness

Warnings are surfaced as readiness diagnostics. They do not prove that Xcode or Gradle can build the app successfully.

## Native Host Command Plans

```sh
vifx native build ./path/to/project --platform ios --dry-run
vifx native install ./path/to/project --platform android --dry-run --json
vifx native launch ./path/to/project --platform android --application-id dev.vifx.app --dry-run
```

Host detection currently looks for:

- iOS: `ios/*.xcodeproj`, defaulting the scheme from the project name and reading `PRODUCT_BUNDLE_IDENTIFIER` when present.
- Android: `android/build.gradle`, `android/build.gradle.kts`, `android/settings.gradle`, or `android/settings.gradle.kts`, plus `android/gradlew` when available.

The repository maintains formal host markers in `apps/playground-rn-bare/ios` and `apps/playground-rn-bare/android`. They are used by:

```sh
pnpm native:validate
```

That validation prepares native artifacts, runs `native doctor` for both platforms, checks dry-run build/install/launch plans, and checks dry-run `native run` orchestration. It does not execute Xcode or Gradle.

The command plans are deterministic:

- iOS build: `xcodebuild -project <project> -scheme <scheme> -configuration Debug -destination "generic/platform=iOS Simulator" -derivedDataPath .vifx/native-build/ios build`
- iOS install: `xcrun simctl install booted <app>`
- iOS launch: `xcrun simctl launch booted <bundle-id>`
- Android build: `./gradlew :app:assembleDebug`
- Android install: `./gradlew :app:installDebug`, or `adb install -r <apk>` when `--app-path` is provided.
- Android launch: `adb shell monkey -p <applicationId> 1`

Without `--dry-run`, the CLI executes the planned command and reports `VIFX_NATIVE_COMMAND_FAILED` on non-zero exit. This is still command orchestration, not native parity proof.

## Native Run Orchestration

```sh
vifx native run ./path/to/project --platform ios --dry-run
vifx native run ./path/to/project --platform android --dry-run --json
vifx native run ./path/to/project --platform ios --no-prepare --dry-run
```

`native run` is the maintained Program B orchestration command. It prepares artifacts for the requested platform unless `--no-prepare` is passed, validates the native host and prepared manifest, creates build/install/launch command plans, and executes them only when `--dry-run` is omitted.

In JSON mode the command returns:

- `preparation`
- `hostValidation`
- `runtimeDiagnostics`
- `steps.build`
- `steps.install`
- `steps.launch`
- `execution`, or `null` in dry-run mode

The playground validation exercises this command for both iOS and Android in dry-run mode. It proves the orchestration shape, static host checks, and target readiness diagnostics, not real Xcode, Gradle, simulator, emulator, or device execution.

## Remaining Native Work

This page does not claim full Program B completion. Still missing:

- executable production-grade iOS host build
- executable production-grade Android host build
- provisioning profile validation beyond static signing markers
- simulator, emulator, and device execution validation
- executed build, install, and launch validation
- full native build documentation
