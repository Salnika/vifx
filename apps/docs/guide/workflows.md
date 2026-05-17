# Workflows

## Analyze An Expo Project

Audience: Expo maintainers and tool authors.

Start with inspection and support reporting before any migration step.

1. Run doctor to inspect Expo, Metro, and config readiness.
2. Capture reference behavior before adding experimental Vifx layers.
3. Record inspect-only gaps in the support matrix instead of burying them in code.

```sh
vifx doctor
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
vifx migrate expo --dry-run
```

## Analyze A React Native Project

Audience: bare React Native maintainers.

Use Metro inspection and primitive-focused comparison before any plugin experiment.

1. Confirm the project type and current Metro assumptions.
2. Inspect bundle, assets, and maps on the target platform.
3. Only then evaluate migration scaffolding or future Vite plugin work.

```sh
vifx doctor
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx migrate react-native --dry-run
```

## Run Compatibility Tests

Audience: package authors and CI maintainers.

Treat compatibility as a report with context, not a single boolean.

1. Choose the adapter you want to measure.
2. Run the shared cases and keep the generated report reviewable.
3. Use warn and todo states honestly when support is still incomplete.

```sh
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

## Inspect Metro Output

Audience: bundler researchers.

Use Metro as a reference adapter, not as an invisible implementation dependency.

1. Choose a fixture or project and run the Metro inspector.
2. Capture bundle, asset, map, and warning output deterministically.
3. Use the report to inform support claims and docs updates.

```sh
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
```

## Use The Vite Plugin Experimentally

Audience: bundler experimenters.

Bound the experiment tightly and keep support gaps visible.

1. Start with the React Native plugin before layering Expo behavior.
2. Keep Metro workflows available while comparing results.
3. Document unsupported features in the support matrix and docs.

```sh
pnpm add -D @vifx/vite-plugin-react-native
pnpm add -D @vifx/vite-plugin-expo
vifx doctor
```

## Validate Repository Playgrounds

Audience: maintainers changing the Vite plugins, CLI build path, resolver, assets, or Expo env handling.

Use the maintained playgrounds as integration smoke tests for the current bounded Vite contract.

```sh
pnpm playground:rn-bare
pnpm playground:expo
pnpm playground:validate
```

The bare React Native playground and Expo playground each run doctor, inspect, iOS and Android `vifx build`, and a direct Vite build through `vite.config.vifx.ts`.

## Start Bounded Expo Browser Development

Audience: maintainers working on Program C Expo dev-server surfaces.

Use `vifx expo dev` to exercise the browser-only Expo development path with Vite HMR.

```sh
vifx expo dev ./apps/playground-expo --platform ios
vifx expo dev ./apps/playground-expo --platform android --port 5174
```

This workflow does not provide Expo Go, native dev-client protocol, device runtime parity, or React Native Fast Refresh parity.

## Generate And Serve Bounded Expo Exports

Audience: maintainers working on Program C Expo export and Updates surfaces.

Use `vifx expo export` to generate bounded Vifx bundle output, then use `vifx expo serve` to exercise the local Expo Updates v1 JSON manifest and asset response path.

```sh
vifx expo export ./apps/playground-expo --out-dir dist/expo --updates-url http://localhost:8081 --runtime-version 1.0.0
vifx expo audit ./apps/playground-expo --export-root dist/expo
vifx expo serve ./apps/playground-expo --export-root dist/expo --port 8081
vifx expo serve ./apps/playground-expo --export-root dist/expo --signing-key ./private.pem --signing-key-id root
```

This workflow does not provide multipart directives, EAS Update parity, or native client execution.

## Prepare Native Artifacts

Audience: maintainers starting Program B native integration work.

Use native artifact preparation after a Vifx target builds. This creates a deterministic bundle directory and manifest for future iOS and Android hosts, while keeping native build and launch claims separate.

```sh
vifx native prepare --platform ios
vifx native prepare --platform android --json
```

To inspect host, signing, toolchain, and runtime target readiness, run native doctor:

```sh
vifx native doctor ./path/to/project --platform ios
vifx native doctor ./path/to/project --platform android --json
vifx native doctor ./path/to/project --platform android --device emulator-5554 --json
```

The repository keeps a maintained native validation entrypoint for the bare React Native playground:

```sh
pnpm native:validate
```

That command prepares both platforms, runs `native doctor`, verifies runtime target diagnostics, verifies dry-run build/install/launch plans, and verifies dry-run `native run` orchestration against the playground's iOS and Android host markers.

To inspect the next native command without executing local toolchains, use the lifecycle dry-run commands:

```sh
vifx native build ./path/to/project --platform ios --dry-run
vifx native install ./path/to/project --platform android --dry-run --json
vifx native launch ./path/to/project --platform android --dry-run
```

To inspect the full prepare, diagnose, build, install, and launch orchestration without executing native host commands, use:

```sh
vifx native run ./path/to/project --platform ios --dry-run
vifx native run ./path/to/project --platform android --dry-run --json
```

Executed native host validation, provisioning profiles, simulator or emulator launch, and device installation remain later Program B work.
