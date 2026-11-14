# CLI

`vifx` is the single command for building, serving, exporting, and migrating React Native and Expo projects on the Vite/Rolldown engine. It is provided by the `@vifx/cli` package (`npm install --save-dev @vifx/cli`, see [Getting Started](../guide/getting-started#install)). Run every command from your project with:

```sh
npx vifx <command> [path] [flags]
```

The command blocks on this page have an npm, pnpm, Yarn and Bun tab. Add `--help` for the command list (`npx vifx --help`) or for a command's flags (`npx vifx <command> --help`).

## Global flags

| Flag              | Effect                                                                           |
| ----------------- | -------------------------------------------------------------------------------- |
| `--verbose`, `-v` | Print verbose diagnostics (sets `VIFX_VERBOSE`).                                 |
| `--debug`         | Print debug-level internals (sets `VIFX_DEBUG`).                                 |
| `--json`          | Emit machine-readable output. Errors serialize to JSON when `--json` is present. |
| `--help`, `-h`    | Print help and exit.                                                             |
| `--version`       | Print the CLI version.                                                           |

`--verbose`/`-v` and `--debug` are read on every command. `--version` and a bare `--help`/`-h` apply to the root command; pass `--help` after a subcommand for that command's help.

Every command accepts an optional `[path]` positional. When omitted, `vifx` resolves the project from the current directory, walking up to the nearest ancestor that contains a `package.json` (or a `vifx.config.*`).

Platform values are validated per command. `build` and `expo export` accept `ios`, `android`, or `all`. `dev`, `run`, `expo dev`, `expo smoke`, and `export:embed` accept `ios` or `android`. `metro inspect` also accepts `native` and `web`. An out-of-range value is rejected with a per-command error.

## Project setup

### `vifx setup`

Onboard an existing Expo project with a Vifx-owned `vifx.config.ts`. It writes config alongside your existing files without editing Expo-owned app files, `app.json`, EAS scripts, or app source. It also reads any `metro.config.js` and prints a Metro-config migration section with interop hints. This is the entry point for migrating an Expo app — see the [migration guide](../guide/migration).

```sh
npx vifx setup ./my-expo-app --yes
```

| Flag                   | Effect                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--yes`                | Apply changes without confirmation.                                                                                    |
| `--dry-run`            | Preview the plan without writing. Cannot be combined with `--yes`.                                                     |
| `--json`               | Machine-readable output. Previews unless combined with `--yes`.                                                        |
| `--force`              | Replace existing Vifx-owned files.                                                                                     |
| `--expo-go`            | Generate native Expo Go targets instead of browser-preview targets.                                                    |
| `--with-vite-config`   | Also create `vite.config.vifx.ts`.                                                                                     |
| `--experimental-embed` | Register `@vifx/expo-config-plugin` in `app.json` so `expo prebuild` routes native builds through `vifx export:embed`. |

Without `--yes` and without `--dry-run`/`--json`, `vifx setup` asks for interactive confirmation. `vifx setup` targets Expo projects. For bare React Native, use [`vifx init`](#vifx-init).

### `vifx init`

Create a `vifx.config.ts`. Previews by default; `--write` applies.

```sh
npx vifx init ./my-rn-app --write
```

| Flag            | Effect                                |
| --------------- | ------------------------------------- |
| `--write`, `-w` | Write the planned files.              |
| `--force`       | Replace an existing `vifx.config.ts`. |

### `vifx vite init`

Create a Vifx-owned `vite.config.vifx.ts` for advanced direct Vite usage, so any Vite/Rollup plugin (svgr, unplugin-icons, mdx, virtual modules) runs against your React Native bundle. It also writes `vifx.config.ts` when one is missing, and adds `vifx:*` scripts and Vifx dev dependencies to `package.json`. Previews by default; `--write` applies. See [Configuration](./config) for how the config is merged.

```sh
npx vifx vite init ./my-app --write
```

| Flag            | Effect                                     |
| --------------- | ------------------------------------------ |
| `--write`, `-w` | Write the planned files.                   |
| `--force`       | Replace an existing `vite.config.vifx.ts`. |

## Development

### `vifx dev`

Metro-compatible dev server for bare React Native projects. It serves the dev-server conventions the React Native community CLI expects: `GET /status`, `GET /<entry>.bundle?platform=...&dev=...`, the matching source-map route, `POST /symbolicate`, and a `/message` WebSocket channel. It builds the bundle before serving it; it does not watch files, and it has no Fast Refresh.

```sh
npx vifx dev ./my-rn-app --platform ios --port 8081
```

| Flag                      | Default     | Effect                                                                      |
| ------------------------- | ----------- | --------------------------------------------------------------------------- |
| `--platform ios\|android` | —           | Select the platform target (required when multiple targets are configured). |
| `--config <file>`         | —           | Use a specific config file.                                                 |
| `--host <host>`           | `127.0.0.1` | Bind host.                                                                  |
| `--port <number>`         | `8081`      | Bind port. Falls back to a free port unless `--port` is passed explicitly.  |
| `--no-build`              | —           | Reuse existing bundle artifacts instead of rebuilding first.                |

`vifx dev` serves bare React Native projects and directs Expo projects to [`vifx expo dev`](#vifx-expo-dev). It requires `vite.mode = "react-native"` and at least one target.

### `vifx run`

Serve a built web runtime over a static HTTP server. The selected target must set `reactNativeCompat: "web"`, and the runtime directory must already exist. For a live browser preview backed by real react-native-web, use [`vifx expo dev`](#vifx-expo-dev) without `--expo-go` — that is the browser path that compiles and serves your app.

```sh
npx vifx run ./my-app --platform ios --no-build --port 4173
```

| Flag                      | Default     | Effect                                                       |
| ------------------------- | ----------- | ------------------------------------------------------------ |
| `--platform ios\|android` | —           | Select the platform target.                                  |
| `--config <file>`         | —           | Use a specific config file.                                  |
| `--host <host>`           | `127.0.0.1` | Bind host.                                                   |
| `--port <number>`         | `4173`      | Bind port.                                                   |
| `--no-build`              | —           | Serve an existing runtime build instead of rebuilding first. |

## Expo

### `vifx expo dev`

Vite-powered Expo dev server. The default mode serves a browser preview through react-native-web and requires the target's `reactNativeCompat: "web"`. `--expo-go` switches to the native Expo Go server: a QR code, the manifest, the bundle and source map, `/symbolicate`, `/status`, assets, React Native DevTools, and the `/message`, `/events` and `/hot` sockets. Requires `vite.mode = "expo"`.

```sh
# Native Expo Go server, with Fast Refresh
npx vifx expo dev ./my-expo-app --platform ios --expo-go

# The same server on the LAN, with an explicit address for the device
npx vifx expo dev ./my-expo-app --platform ios --expo-go --host 0.0.0.0 --public-host 192.168.1.25

# Browser preview (target must set reactNativeCompat: "web")
npx vifx expo dev ./my-expo-app
```

| Flag                      | Default                                  | Effect                                                                                                                                                         |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--platform ios\|android` | —                                        | Select the platform target. Required when more than one target is configured.                                                                                  |
| `--expo-go`               | —                                        | Serve the native Expo Go manifest and bundle instead of the browser preview.                                                                                   |
| `--config <file>`         | —                                        | Use a specific config file.                                                                                                                                    |
| `--host <host>`           | `127.0.0.1` (`0.0.0.0` with `--expo-go`) | Bind host.                                                                                                                                                     |
| `--public-host <host>`    | —                                        | Hostname or LAN IP emitted in Expo Go URLs when it differs from `--host`.                                                                                      |
| `--port <number>`         | `5173`                                   | Bind port.                                                                                                                                                     |
| `--json`                  | —                                        | Machine-readable output. With `--expo-go`, NDJSON: a server snapshot line, then one report line per save.                                                      |
| `--fast-refresh`          | —                                        | Serve the Metro module-registry format (`moduleFormat: "metro"`) and its own Fast Refresh path instead of the dev engine. Experimental; only with `--expo-go`. |

With `--expo-go`, the server prints its URLs and QR code at once and builds the first bundle in the background: `/status` answers immediately and other requests wait for the bundle. In a TTY, interactive keys are available: `r` reload, `m` dev menu, `j` open React Native DevTools, `o` open the project in `$EXPO_EDITOR` or `$EDITOR`, `?` show all keys. `Ctrl+C`/`Ctrl+D` stop the server.

Fast Refresh is on by default for the `--expo-go` development server with the default `hoisted` module format. It runs on Rolldown's dev engine: a save compiles only the changed modules into a patch, which the app applies with Metro's Fast Refresh rules. Each save prints one line once the app has applied it:

```text
fast refresh  app/(tabs)/index.tsx  36ms
```

A save that reloads the app prints `reload` with the reason, and a save that does not compile prints `update failed` with the cause and its code frame. The app's `console.*` output is printed as ` LOG  …`, ` WARN  …` and ` ERROR  …` lines. `VIFX_DEV_ENGINE=0` replaces the dev engine with a loop that rebuilds the whole bundle and reloads the app on each save; `VIFX_BABEL_WORKERS` sets the number of Babel worker threads.

With `--json --expo-go`, stdout is NDJSON: line 1 is a compact dev-server snapshot, then one `VifxRebuildReport` line per save. Pipe it for aggregation:

```sh
npx vifx expo dev ./my-expo-app --platform ios --expo-go --json > saves.ndjson
```

See [Dev Server and Fast Refresh](../guide/dev-server) for the terminal output, the report fields, reconnects after a restart, and the limitations.

### `vifx expo export`

Build configured Expo targets and write an Expo artifact directory with bundles, source maps, assets, `manifest.json`, and `metadata.json`. Requires `vite.mode = "expo"`.

```sh
npx vifx expo export ./my-expo-app --platform all --out-dir dist/expo
```

| Flag                           | Default     | Effect                                                        |
| ------------------------------ | ----------- | ------------------------------------------------------------- |
| `--platform ios\|android\|all` | `all`       | Select the platform target(s).                                |
| `--config <file>`              | —           | Use a specific config file.                                   |
| `--out-dir <dir>`              | `dist/expo` | Output directory.                                             |
| `--dev`                        | off         | Export development bundles (unminified, `__DEV__` is `true`). |

Like `npx expo export`, the export is a production build unless `--dev` is passed. A production export never includes Vifx's Expo Go compatibility mocks (`compatPreview`), because the app that runs it ships the real native modules.

`vifx expo export` produces bundle artifacts. It serves the Expo bundling path and covers bundles, source maps, assets, and manifests; Expo Updates runtime manifests, signed Updates responses, and EAS metadata are a separate concern.

### `vifx expo audit`

Audit the Expo no-Metro Vite bundling contract. Reports a decision, the supported Expo SDK and support tier, Expo/RN versions, Expo Router and `app/` detection, warnings, and per-workflow status, evidence, blockers, and notes.

```sh
npx vifx expo audit ./my-expo-app --json
```

| Flag                    | Default | Effect                                               |
| ----------------------- | ------- | ---------------------------------------------------- |
| `--export-root <dir>`   | —       | Inspect an existing Expo export instead of building. |
| `--supported-sdk <sdk>` | `54-58` | Expo SDK major to evaluate against.                  |

### `vifx expo smoke`

Start a temporary Expo Go server, fetch the manifest, bundle, source map, status, sampled assets, and `/symbolicate`, run a message-plus-event WebSocket loop, then shut down. An end-to-end Expo Go endpoint test that exits non-zero on any failure.

```sh
npx vifx expo smoke ./my-expo-app --platform ios --asset-limit 10
```

| Flag                      | Default     | Effect                                 |
| ------------------------- | ----------- | -------------------------------------- |
| `--platform ios\|android` | —           | Select the platform target.            |
| `--config <file>`         | —           | Use a specific config file.            |
| `--host <host>`           | `127.0.0.1` | Bind host.                             |
| `--public-host <host>`    | —           | LAN IP emitted in Expo Go URLs.        |
| `--port <number>`         | ephemeral   | Bind port. Omit for an ephemeral port. |
| `--asset-limit <number>`  | `5`         | Number of manifest assets to sample.   |

## Build and release

### `vifx build`

Build all configured `vite.targets` from `vifx.config.*`. Reports per target: mode, entry, bundle path and size, asset count, source-map validity, and duration.

```sh
npx vifx build ./my-app --platform all --json
```

| Flag                             | Default    | Effect                                     |
| -------------------------------- | ---------- | ------------------------------------------ |
| `--platform ios\|android\|all`   | `all`      | Select the platform target(s).             |
| `--mode development\|production` | per-target | Override the bundle mode for every target. |
| `--config <file>`                | —          | Use a specific config file.                |

`vifx build` requires `vite.mode != "none"` and at least one target.

### `vifx export:embed`

Build the release bundle and production asset layout for Xcode's "Bundle React Native code and images" phase and the Gradle bundle task. The flag surface is compatible with `npx expo export:embed` and `npx react-native bundle`: unknown flags warn and are ignored rather than failing, so it is a drop-in replacement in native build scripts. `--bundle-output` is the only required flag.

```sh
npx vifx export:embed ./my-app \
  --platform ios --dev false --minify true \
  --bundle-output ios.bundle --sourcemap-output ios.map --assets-dest ./assets
```

| Flag                        | Default                      | Effect                                                                             |
| --------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `--bundle-output <path>`    | —                            | **Required.** Output bundle path.                                                  |
| `--entry-file <path>`       | target entry or `./index.js` | Entry module.                                                                      |
| `--platform ios\|android`   | `ios`                        | Select the platform target.                                                        |
| `--dev <true\|false>`       | `true`                       | `--dev false` requests production semantics (`mode: production`).                  |
| `--minify <true\|false>`    | matches `!dev`               | Minify with the OXC minifier.                                                      |
| `--sourcemap-output <path>` | —                            | Output source map path. Its `sources` are relative to this path.                   |
| `--assets-dest <dir>`       | —                            | Writes Android `drawable-<density>/` + `raw/`, iOS `assets/`, and `assetmap.json`. |
| `--config <path>`           | —                            | Use a specific config file.                                                        |

Boolean flags accept a following `0/1/true/false` token or an inline `=value`. The command auto-detects Expo vs bare React Native projects and routes to the matching bundler.

The asset layout follows Metro's: platform variants (`icon.ios.png`) replace the generic file, iOS keeps the 1x to 3x scales, Android names resources after their directory (`assets_images_icon`) and writes `raw/keep.xml` so resource shrinking keeps them. Vifx adds `assetmap.json`. React Native 0.88's opt-in asset catalog (`RCTUseAssetCatalog`, `--asset-catalog-dest`) is not supported: the flag is ignored and assets are copied as files.

Wire it into the Gradle bundle task in `android/app/build.gradle` with:

```groovy
react {
  cliFile = file("../../node_modules/@vifx/cli/dist/bin.mjs")
  bundleCommand = "export:embed"
}
```

On iOS, `@vifx/expo-config-plugin` repoints the Xcode bundle phase at `vifx export:embed` during `expo prebuild`. For Metro/Expo compatibility, these flags are accepted and ignored: `--reset-cache`, `--max-workers`, `--transformer`, `--bundle-encoding`, `--asset-catalog-dest`, `--config-cmd`, `--sourcemap-sources-root`, `--unstable-transform-profile`, `--clear`, `--read-global-cache`, and `--sourcemap-use-absolute-path`.

### `vifx hermes compile`

Compile a JS bundle to Hermes bytecode when a Hermes compiler is available.

```sh
npx vifx hermes compile --input ios.bundle --output ios.hbc --source-map ios.map
```

| Flag                  | Effect                                 |
| --------------------- | -------------------------------------- |
| `--input <bundle>`    | **Required.** Input JavaScript bundle. |
| `--output <file>`     | **Required.** Output bytecode file.    |
| `--source-map <file>` | Optional output source map.            |
| `--compiler <path>`   | Explicit Hermes compiler path.         |

## Diagnostics

### `vifx doctor`

Check project readiness. Reports project type, Node version, package manager, React Native/Expo versions, detected `metro`/`vite`/`vifx` config paths, Vite plugin mode, workspace root, Hermes compiler path, Expo SDK support tier, diagnostics, and (when a Metro config is found) a Metro-to-Vifx migration section.

```sh
npx vifx doctor ./my-app --json
```

`--json` emits pure JSON with no extra logs. Use `vifx doctor` to verify a project after migration.

### `vifx inspect`

Inspect project primitives: project type, package manager, configs, Vite mode, workspace root, platform files, asset groups with scales, and diagnostics.

```sh
npx vifx inspect ./my-app --json
```

### `vifx metro inspect`

Inspect Metro reference artifacts captured under `metro-output/<platform>` in a fixture or project — an interop and parity tool.

```sh
npx vifx metro inspect ./my-app --platform ios --entry index.js --json
```

| Flag                                   | Default    | Effect                          |
| -------------------------------------- | ---------- | ------------------------------- |
| `--platform ios\|android\|native\|web` | `ios`      | Select the platform to inspect. |
| `--entry <file>`                       | `index.js` | Entry module.                   |

### `vifx compat run`

Run the compatibility matrix against adapters and produce a report. See the [compatibility report format](./compatibility-report-format) for the schema. The matrix is built from the fixtures in the Vifx repository, so the command runs from a clone of the repository, with `vifx` set up as [CONTRIBUTING.md](https://github.com/Salnika/vifx/blob/master/CONTRIBUTING.md) describes.

```sh
vifx compat run --adapter all --report markdown
```

| Flag                                | Default    | Effect                                                            |
| ----------------------------------- | ---------- | ----------------------------------------------------------------- |
| `--adapter metro\|vifx\|all`        | `vifx`     | Adapter to run. `all` runs metro + vifx and concatenates reports. |
| `--report terminal\|json\|markdown` | `terminal` | Report format.                                                    |
| `--fixture <id>`                    | —          | Restrict to a single known fixture.                               |

## Legacy migration

### `vifx migrate`

`vifx migrate expo` and `vifx migrate react-native` are a legacy manual-migration surface. Use [`vifx setup`](#vifx-setup) for Expo and [`vifx init`](#vifx-init) / [`vifx vite init`](#vifx-vite-init) for bare React Native. The `<path>` argument is required.

```sh
npx vifx migrate expo ./my-expo-app --dry-run --with-vite
npx vifx migrate react-native ./my-rn-app --write
```

| Flag            | Effect                                         |
| --------------- | ---------------------------------------------- |
| `--dry-run`     | Preview the plan without writing.              |
| `--write`, `-w` | Write the planned files.                       |
| `--with-vite`   | Also generate a minimal `vite.config.vifx.ts`. |

`--write` and `--dry-run` cannot be combined.

## See also

- [Getting started](../guide/getting-started) — install Vifx and run your first build.
- [Dev Server and Fast Refresh](../guide/dev-server) — the Expo Go server in depth.
- [Configuration](./config) — the `vifx.config.*` and `vite.config.vifx.*` reference.
- [Features](./features) — the engine, transform cache, Fast Refresh, and define/env table.
- [Comparisons](./comparisons) — how Vifx relates to Metro and Expo CLI.
