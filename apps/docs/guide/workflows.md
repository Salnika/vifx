# Workflows

The commands below run the CLI with `npx vifx`; with pnpm or Yarn, use `pnpm vifx` or `yarn vifx`. See [Getting Started](/guide/getting-started#install) to install it.

## Analyze An Expo Project

Audience: Expo maintainers and bundler authors.

```sh
npx vifx doctor <expo-project-path>
npx vifx setup <expo-project-path> --yes --expo-go
npx vifx build <expo-project-path>
npx vifx expo audit <expo-project-path>
npx vifx expo dev <expo-project-path> --platform ios --expo-go
npx vifx expo export <expo-project-path> --out-dir dist/expo
```

Use this flow to move from config to Vite bundle production, audit evidence, the Expo Go dev server, and export artifacts. Keep EAS and native app binary workflows unchanged.

## Analyze A React Native Project

Audience: bare React Native maintainers.

```sh
npx vifx doctor <rn-project-path>
npx vifx metro inspect <rn-project-path> --platform ios
npx vifx init <rn-project-path> --write
npx vifx build <rn-project-path> --platform ios
```

Use captured Metro output as the reference before comparing Vifx/Vite bundles.

## Inspect Metro Output

Audience: bundler researchers.

```sh
npx vifx metro inspect <project-path> --platform ios
npx vifx metro inspect <project-path> --platform android --json > report.json
```

`vifx metro inspect` reads Metro output captured under `metro-output/<platform>` in the project. Metro is the comparison baseline. Vifx should make differences visible before claiming replacement behavior.

## Run Compatibility Tests

Audience: package authors and CI maintainers.

`vifx compat run` runs the compatibility matrix against the Metro and Vifx adapters and prints a terminal, JSON or Markdown report. The matrix is built from the fixtures in the Vifx repository, so it runs from a clone of the repository; [CONTRIBUTING.md](https://github.com/Salnika/vifx/blob/master/CONTRIBUTING.md) explains how. See the [compatibility report format](/reference/compatibility-report-format) for the report schema.

Treat compatibility as a report with context, not a single boolean.

## Use Direct Vite Configuration

Audience: maintainers who need a hand-authored Vite surface.

```sh
npx vifx setup <expo-project-path> --yes --with-vite-config
npx vifx build <expo-project-path>
npx vifx expo audit <expo-project-path>
```

Direct Vite config is an advanced opt-in. It is not required for the main setup flow.

## Start Expo Development

Audience: Expo app developers.

```sh
npx vifx expo dev <expo-project-path> --platform ios --expo-go
npx vifx expo dev <expo-project-path> --platform android --expo-go --port 5174
npx vifx expo dev <expo-project-path> --platform ios
```

The `--expo-go` workflow serves the Expo Go manifest, bundle, source maps and assets from Vifx/Vite artifacts, with Fast Refresh on by default. One server serves one platform, so the Android server runs on a second port. See [Dev Server and Fast Refresh](/guide/dev-server) for the details and the current limitations.

Without `--expo-go`, the server requires a configured Expo target with `reactNativeCompat: "web"` and serves the browser preview.

## Generate Expo Export Artifacts

Audience: maintainers working on Metro-free Expo export artifacts.

```sh
npx vifx expo export <expo-project-path> --out-dir dist/expo
npx vifx expo audit <expo-project-path> --export-root dist/expo
```

The generated output is limited to bundles, source maps, assets, `manifest.json`, and `metadata.json`.
