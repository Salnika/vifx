# CLI

`vifx` is the single command for building, serving, exporting, and migrating React Native and Expo projects on the Vite/Rolldown engine. Run every command from your project with:

```sh
pnpm vifx <command> [path] [flags]
```

Run `vifx help` for the command list and `vifx <command> --help` for a command's flags.

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
pnpm vifx setup ./my-expo-app --yes
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
vifx init ./my-rn-app --write
```

| Flag            | Effect                                |
| --------------- | ------------------------------------- |
| `--write`, `-w` | Write the planned files.              |
| `--force`       | Replace an existing `vifx.config.ts`. |

### `vifx vite init`

Create a Vifx-owned `vite.config.vifx.ts` for advanced direct Vite usage, so any Vite/Rollup plugin (svgr, unplugin-icons, mdx, virtual modules) runs against your React Native bundle. It also writes `vifx.config.ts` when one is missing. Previews by default; `--write` applies. See [Configuration](./config) for how the config is merged.

```sh
vifx vite init ./my-app --write
```

| Flag            | Effect                                     |
| --------------- | ------------------------------------------ |
| `--write`, `-w` | Write the planned files.                   |
| `--force`       | Replace an existing `vite.config.vifx.ts`. |

## Development

### `vifx dev`

Metro-compatible dev server for bare React Native projects. It serves the dev-server conventions the React Native community CLI expects: `GET /status`, `GET /<entry>.bundle?platform=...&dev=...`, the matching source-map route, `POST /symbolicate`, and a `/message` WebSocket channel.

```sh
vifx dev ./my-rn-app --platform ios --port 8081
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
vifx run ./my-app --platform ios --no-build --port 4173
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

Vite-powered Expo dev server. The default mode serves a browser preview through react-native-web and requires the target's `reactNativeCompat: "web"`. `--expo-go` switches to the native Expo Go manifest and bundle server with a QR code, manifest, bundle, source map, `/symbolicate`, `/status`, assets, React Native DevTools/Fusebox, and message/event sockets. Requires `vite.mode = "expo"`.

```sh
# Browser preview (target must set reactNativeCompat: "web")
pnpm vifx expo dev ./my-expo-app

# Native Expo Go server on the LAN
pnpm vifx expo dev ./my-expo-app --platform ios --expo-go --host 0.0.0.0 --public-host 192.168.1.25

# State-preserving Fast Refresh
pnpm vifx expo dev ./my-expo-app --platform ios --expo-go --fast-refresh
```

| Flag                      | Default                                  | Effect                                                                                                                               |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--platform ios\|android` | —                                        | Select the platform target.                                                                                                          |
| `--expo-go`               | —                                        | Serve the native Expo Go manifest and bundle instead of the browser preview.                                                         |
| `--fast-refresh`          | —                                        | Serve a Metro-format bundle with state-preserving Fast Refresh over `/hot`. Requires `--expo-go` and forces `moduleFormat: "metro"`. |
| `--config <file>`         | —                                        | Use a specific config file.                                                                                                          |
| `--host <host>`           | `127.0.0.1` (`0.0.0.0` with `--expo-go`) | Bind host.                                                                                                                           |
| `--public-host <host>`    | —                                        | LAN IP emitted in Expo Go URLs.                                                                                                      |
| `--port <number>`         | `5173`                                   | Bind port.                                                                                                                           |

With `--expo-go` in a TTY, interactive keybindings are available: `r` reload, `m` dev menu, `j` open React Native DevTools/Fusebox, `o` open the project in `$EXPO_EDITOR` or `$EDITOR`, `?` show all keys. `Ctrl+C`/`Ctrl+D` forward to `SIGINT`.

Without `--fast-refresh`, the dev server uses the target's configured `moduleFormat` — the default `hoisted` format does a full reload on each save. `--fast-refresh` engages the Metro module-registry runtime that preserves state across saves. Each `--expo-go` rebuild prints one per-save instrumentation line, ventilated by phase, with a per-cycle transform-cache hit-rate:

```text
~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
```

With `--json --expo-go`, stdout is pure NDJSON: line 1 is a compact dev-server snapshot, then one report line per save. Pipe it for median/p95 aggregation:

```sh
pnpm vifx expo dev ./my-expo-app --platform ios --expo-go --fast-refresh --json > rebuilds.ndjson
```

### `vifx expo export`

Build configured Expo targets and write an Expo artifact directory with bundles, source maps, assets, `manifest.json`, and `metadata.json`. Requires `vite.mode = "expo"`.

```sh
pnpm vifx expo export ./my-expo-app --platform all --out-dir dist/expo
```

| Flag                           | Default     | Effect                         |
| ------------------------------ | ----------- | ------------------------------ |
| `--platform ios\|android\|all` | `all`       | Select the platform target(s). |
| `--config <file>`              | —           | Use a specific config file.    |
| `--out-dir <dir>`              | `dist/expo` | Output directory.              |

`vifx expo export` produces bundle artifacts. It serves the Expo bundling path and covers bundles, source maps, assets, and manifests; Expo Updates runtime manifests, signed Updates responses, and EAS metadata are a separate concern.

### `vifx expo audit`

Audit the Expo no-Metro Vite bundling contract. Reports a decision, the supported Expo SDK and support tier, Expo/RN versions, Expo Router and `app/` detection, warnings, and per-workflow status, evidence, blockers, and notes.

```sh
pnpm vifx expo audit ./my-expo-app --json
```

| Flag                    | Default | Effect                                               |
| ----------------------- | ------- | ---------------------------------------------------- |
| `--export-root <dir>`   | —       | Inspect an existing Expo export instead of building. |
| `--supported-sdk <sdk>` | `54`    | Expo SDK major to evaluate against.                  |

### `vifx expo smoke`

Start a temporary Expo Go server, fetch the manifest, bundle, source map, status, sampled assets, and `/symbolicate`, run a message-plus-event WebSocket loop, then shut down. An end-to-end Expo Go endpoint test that exits non-zero on any failure.

```sh
pnpm vifx expo smoke ./my-expo-app --platform ios --asset-limit 10
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
vifx build ./my-app --platform all --json
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
vifx export:embed ./my-app \
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
| `--sourcemap-output <path>` | —                            | Output source map path.                                                            |
| `--assets-dest <dir>`       | —                            | Writes Android `drawable-<density>/` + `raw/`, iOS `assets/`, and `assetmap.json`. |
| `--config <path>`           | —                            | Use a specific config file.                                                        |

Boolean flags accept a following `0/1/true/false` token or an inline `=value`. The command auto-detects Expo vs bare React Native projects and routes to the matching bundler.

Wire it into the Gradle bundle task with:

```groovy
react { bundleCommand = "export:embed" }
```

On iOS, `@vifx/expo-config-plugin` repoints the Xcode bundle phase at `vifx export:embed` during `expo prebuild`. For Metro/Expo compatibility, these flags are accepted and ignored: `--reset-cache`, `--max-workers`, `--transformer`, `--bundle-encoding`, `--asset-catalog-dest`, `--config-cmd`, `--sourcemap-sources-root`, `--unstable-transform-profile`, `--clear`, `--read-global-cache`, and `--sourcemap-use-absolute-path`.

### `vifx hermes compile`

Compile a JS bundle to Hermes bytecode when a Hermes compiler is available.

```sh
vifx hermes compile --input ios.bundle --output ios.hbc --source-map ios.map
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
vifx doctor ./my-app --json
```

`--json` emits pure JSON with no extra logs. Use `vifx doctor` to verify a project after migration.

### `vifx inspect`

Inspect project primitives: project type, package manager, configs, Vite mode, workspace root, platform files, asset groups with scales, and diagnostics.

```sh
vifx inspect ./my-app --json
```

### `vifx metro inspect`

Inspect captured Metro reference artifacts for a fixture or project — an interop and parity tool.

```sh
vifx metro inspect ./my-app --platform ios --entry index.js --json
```

| Flag                                   | Default    | Effect                          |
| -------------------------------------- | ---------- | ------------------------------- |
| `--platform ios\|android\|native\|web` | `ios`      | Select the platform to inspect. |
| `--entry <file>`                       | `index.js` | Entry module.                   |

### `vifx compat run`

Run the compatibility matrix against adapters and produce a report. See the [compatibility report format](./compatibility-report-format) for the schema.

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
vifx migrate expo ./my-expo-app --dry-run --with-vite
vifx migrate react-native ./my-rn-app --write
```

| Flag            | Effect                                         |
| --------------- | ---------------------------------------------- |
| `--dry-run`     | Preview the plan without writing.              |
| `--write`, `-w` | Write the planned files.                       |
| `--with-vite`   | Also generate a minimal `vite.config.vifx.ts`. |

`--write` and `--dry-run` cannot be combined.

## See also

- [Getting started](../guide/getting-started) — install Vifx and run your first build.
- [Configuration](./config) — the `vifx.config.*` and `vite.config.vifx.*` reference.
- [Features](./features) — the engine, transform cache, Fast Refresh, and define/env table.
- [Comparisons](./comparisons) — how Vifx relates to Metro and Expo CLI.
