# Workflows

## Analyze An Expo Project

Audience: Expo maintainers and bundler authors.

```sh
pnpm vifx doctor <expo-project-path>
pnpm vifx setup <expo-project-path> --yes --expo-go
pnpm vifx build <expo-project-path>
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
```

Use this flow to move from config to Vite bundle production, audit evidence, Expo Go dev-server proof, and export artifacts. Keep EAS and native app binary workflows unchanged.

## Analyze A React Native Project

Audience: bare React Native maintainers.

```sh
vifx doctor ./fixtures/rn-bare-basic
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx init ./fixtures/rn-bare-basic --write
vifx build ./fixtures/rn-bare-basic --platform ios
```

Use captured Metro output as the reference before comparing Vifx/Vite bundles.

## Run Compatibility Tests

Audience: package authors and CI maintainers.

```sh
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

Treat compatibility as a report with context, not a single boolean.

## Inspect Metro Output

Audience: bundler researchers.

```sh
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json > report.json
```

Metro is the comparison baseline. Vifx should make differences visible before claiming replacement behavior.

## Use Direct Vite Configuration

Audience: maintainers who need a hand-authored Vite surface.

```sh
pnpm vifx setup <expo-project-path> --yes --with-vite-config
pnpm vifx build <expo-project-path>
pnpm vifx expo audit <expo-project-path>
```

Direct Vite config is an advanced opt-in. It is not required for the main setup flow.

## Validate Repository Playgrounds

Audience: maintainers changing Vite plugins, CLI build paths, resolver behavior, assets, or Expo env handling.

```sh
pnpm playground:rn-bare
pnpm playground:expo
pnpm playground:validate
```

The bare React Native and Expo playgrounds run doctor, inspect, iOS and Android `vifx build`, and a direct Vite build through `vite.config.vifx.ts`.

## Start Expo Vite Development

Audience: maintainers working on Expo dev-server proof.

```sh
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo dev <expo-project-path> --platform android --port 5174
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go
```

The default workflow requires a configured Expo target with `reactNativeCompat: "web"` and serves the browser preview path. The `--expo-go` workflow serves the first native Expo Go manifest and bundle endpoints from Vifx/Vite artifacts; full Expo CLI parity and Fast Refresh are still incomplete.

## Generate Expo Export Artifacts

Audience: maintainers working on Metro-free Expo export artifacts.

```sh
vifx expo export ./apps/playground-expo --out-dir dist/expo
vifx expo audit ./apps/playground-expo --export-root dist/expo
```

The generated output is limited to bundles, source maps, assets, `manifest.json`, and `metadata.json`.
