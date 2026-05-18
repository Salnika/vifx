# Workflows

## Analyze An Expo Project

Audience: Expo maintainers and tool authors.

Start with the primary setup flow, then validate and execute the current support corridor.

1. Run doctor when you want extra readiness detail.
2. Apply the Expo setup without editing Expo-owned app files.
3. Audit the resulting support corridor before claiming browser preview or native coverage.
4. Move into browser preview, native iOS, and export flows from the same config.

```sh
pnpm vifx doctor <expo-project-path>
pnpm vifx setup <expo-project-path> --yes
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx native run <expo-project-path> --platform ios
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
pnpm vifx expo serve <expo-project-path> --export-root dist/expo
```

## Analyze A React Native Project

Audience: bare React Native maintainers.

Use Metro inspection and primitive-focused comparison before manual React Native Vite setup.

1. Confirm the project type and current Metro assumptions.
2. Inspect bundle, assets, and maps on the target platform.
3. Only then evaluate migration scaffolding or future Vite plugin work.

```sh
vifx doctor
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx init ./fixtures/rn-bare-basic --write
vifx vite init ./fixtures/rn-bare-basic --write
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

## Use Direct Vite Configuration

Audience: bundler maintainers.

Treat direct Vite config as an advanced opt-in, not as the default Expo onboarding path.

1. Start with `pnpm vifx setup <expo-project-path> --yes` as the main onboarding path.
2. Add `--with-vite-config` only when you intentionally want a separate `vite.config.vifx.ts`.
3. Keep Metro workflows available while comparing results.

```sh
pnpm vifx setup <expo-project-path> --yes --with-vite-config
pnpm vifx expo audit <expo-project-path>
```

## Validate Repository Playgrounds

Audience: maintainers changing the Vite plugins, CLI build path, resolver, assets, or Expo env handling.

Use the maintained playgrounds as integration smoke tests for the current Vifx contract.

```sh
pnpm playground:rn-bare
pnpm playground:expo
pnpm playground:validate
```

The bare React Native playground and Expo playground each run doctor, inspect, iOS and Android `vifx build`, and a direct Vite build through `vite.config.vifx.ts`.

## Start Expo Browser Development

Audience: maintainers working on Expo browser-preview surfaces.

Use `vifx expo dev` to exercise the browser-only Expo development path with Vite HMR.

```sh
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo dev <expo-project-path> --platform android --port 5174
```

This workflow requires a configured Expo target with `reactNativeCompat: "web"`. The recommended setup path creates that only for Expo Router projects with an `app/` directory.

This workflow does not provide Expo Go, native dev-client protocol, device runtime parity, or React Native Fast Refresh parity.

## Generate And Serve Expo Exports

Audience: maintainers working on Expo export and Updates surfaces.

Use `vifx expo export` to generate Vifx bundle output, then use `vifx expo serve` to exercise the local Expo Updates v1 JSON manifest and asset response path.

```sh
vifx expo export ./apps/playground-expo --out-dir dist/expo --updates-url http://localhost:8081 --runtime-version 1.0.0
vifx expo audit ./apps/playground-expo --export-root dist/expo
vifx expo serve ./apps/playground-expo --export-root dist/expo --port 8081
vifx expo serve ./apps/playground-expo --export-root dist/expo --signing-key ./private.pem --signing-key-id root
```

This workflow does not provide multipart directives, EAS Update parity, or native client execution.

## Prepare Native Artifacts

Audience: maintainers working on native integration.

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

That command prepares both platforms, runs `native doctor`, verifies runtime target diagnostics, verifies build/install/launch planning, and verifies `native run` orchestration against the playground's iOS and Android host markers.

For advanced inspection without executing local toolchains, use the lifecycle preview commands:

```sh
vifx native build ./path/to/project --platform ios --dry-run
vifx native install ./path/to/project --platform android --dry-run --json
vifx native launch ./path/to/project --platform android --dry-run
```

The main maintained execution path is:

```sh
pnpm vifx native run <expo-project-path> --platform ios
```

Advanced preview mode remains available when you need it:

```sh
vifx native run ./path/to/project --platform ios --dry-run
vifx native run ./path/to/project --platform android --dry-run --json
```

Executed Android validation, provisioning-profile proof, and broader simulator, emulator, and device coverage remain not supported yet.
