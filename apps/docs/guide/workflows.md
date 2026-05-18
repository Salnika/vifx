# Workflows

## Analyze An Expo Project

Audience: Expo maintainers and bundler authors.

```sh
pnpm vifx doctor <expo-project-path>
pnpm vifx setup <expo-project-path> --yes
pnpm vifx build <expo-project-path>
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
```

Use this flow to move from config to Vite bundle production, audit evidence, dev-server proof, and export artifacts. Keep Expo CLI and native app workflows unchanged.

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
```

This workflow requires a configured Expo target with `reactNativeCompat: "web"`. It is a Vite bundle/dev server, not Expo CLI, Expo Go, native dev-client protocol parity, or full Fast Refresh.

## Generate Expo Export Artifacts

Audience: maintainers working on Metro-free Expo export artifacts.

```sh
vifx expo export ./apps/playground-expo --out-dir dist/expo
vifx expo audit ./apps/playground-expo --export-root dist/expo
```

The generated output is limited to bundles, source maps, assets, `manifest.json`, and `metadata.json`.
