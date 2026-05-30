# CLI

The CLI is the main user-facing surface for setup, inspection, Vite bundle builds, Metro comparison, Expo dev-server proof, and Expo export artifacts.

Run commands from this repository with:

```sh
pnpm vifx <command> ...
```

## `vifx setup`

Onboard an existing Expo project with a Vifx-owned config.

```sh
pnpm vifx setup <expo-project-path> --yes
pnpm vifx setup <expo-project-path> --yes --expo-go
pnpm vifx setup <expo-project-path> --yes --with-vite-config
pnpm vifx setup <expo-project-path> --json
```

- Expo-only in v1.
- Creates `vifx.config.ts` by default.
- `--expo-go` generates native Expo targets for `vifx expo dev --expo-go`.
- Does not edit Expo-owned app files, EAS scripts, or app source files.
- Prints next commands for `build`, `expo audit`, optional `expo dev`, and `expo export`.

## `vifx build`

Build configured Vifx bundle targets from `vifx.config.*`.

```sh
vifx build <project-path>
vifx build <project-path> --platform ios
vifx build <project-path> --platform all --json
```

This is the central production bundle command. It does not run app build workflows.

## `vifx expo audit`

Report the Expo no-Metro Vite bundling contract for a project.

```sh
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo audit <expo-project-path> --export-root dist/expo
pnpm vifx expo audit <expo-project-path> --json
```

Reported workflows:

- `config`
- `vite-build`
- `metro-parity`
- `dev-server`
- `export-artifacts`

Use this before updating support claims.

## `vifx expo dev`

Start a Vite bundle/dev server for one configured Expo target.

```sh
pnpm vifx expo dev <expo-project-path> --platform ios
pnpm vifx expo dev <expo-project-path> --platform android --port 5174
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go --host 0.0.0.0 --public-host 192.168.1.25
pnpm vifx expo dev <expo-project-path> --platform ios --json
```

- Requires `vite.mode = "expo"`.
- Browser preview mode requires one selected target with `reactNativeCompat = "web"`.
- `--expo-go` serves native manifest, bundle, source-map, status, symbolication, `/message`, `/events`, and an `exp://` Expo Go URL from Vifx/Vite artifacts.
- Use `--host 0.0.0.0 --public-host <lan-ip>` when testing from a physical device and the bind host is not the host Expo Go should fetch.
- Does not yet provide full Expo CLI parity, native binary replacement, or full Fast Refresh.

## `vifx expo smoke`

Start a temporary Expo Go server, fetch its Vifx-backed endpoints, and shut it down.

```sh
pnpm vifx expo smoke <expo-project-path> --platform ios
pnpm vifx expo smoke <expo-project-path> --platform android --asset-limit 10
pnpm vifx expo smoke <expo-project-path> --platform ios --host 0.0.0.0 --public-host 192.168.1.25
pnpm vifx expo smoke <expo-project-path> --platform ios --json
```

The smoke report checks the manifest, bundle, source map, `/status`, sampled manifest assets, `/symbolicate`, and `/message` plus `/events` WebSocket reload loop. It exits non-zero when any check fails.

## `vifx expo export`

Build configured Expo targets and write export artifacts from Vifx bundles.

```sh
vifx expo export ./path/to/expo-app
vifx expo export ./path/to/expo-app --platform ios --out-dir dist/expo
vifx expo export ./path/to/expo-app --json
```

The output contains bundles, source maps, assets, `manifest.json`, and `metadata.json`. It does not generate Expo Updates runtime manifests, serve Updates responses, sign responses, or produce EAS metadata parity.

## `vifx doctor`

Inspect readiness, versions, config presence, detected Vite plugin mode, and support boundaries.

```sh
vifx doctor <project-path>
vifx doctor <project-path> --json
```

## `vifx inspect`

Inspect project primitives before choosing Metro-specific or compatibility-specific workflows.

```sh
vifx inspect <project-path>
vifx inspect <project-path> --help
```

## `vifx metro inspect`

Inspect captured Metro reference artifacts.

```sh
vifx metro inspect ./fixtures/rn-bare-basic --platform ios
vifx metro inspect ./fixtures/expo-basic --platform android --json
```

## `vifx compat run`

Run shared compatibility cases and produce reviewable reports.

```sh
vifx compat run --adapter metro
vifx compat run --adapter vifx
vifx compat run --adapter all --report markdown
```

## Legacy And Advanced Commands

These remain useful for maintainers but are not the public no-Metro corridor:

```sh
vifx init
vifx vite init
vifx migrate expo <path>
vifx migrate react-native <path>
vifx run <path>
vifx hermes compile --help
```

## Repository Playground Commands

```sh
pnpm playground:rn-bare
pnpm playground:expo
pnpm playground:validate
```

Each playground runs doctor, inspect, iOS and Android `vifx build`, and a direct Vite build through `vite.config.vifx.ts`.
