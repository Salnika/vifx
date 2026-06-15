# Getting Started

Vifx is a single Vite/Rolldown engine that bundles React Native and Expo apps without Metro. You point it at an existing project, run a Metro-compatible dev server with Fast Refresh, and build release bundles for Xcode and Gradle — all from the `vifx` CLI. Native (iOS and Android) is the primary target; web is a companion preview served by the same engine.

This page takes you from a configured project to a running dev server to a release build.

## Install

Vifx is a global CLI named `vifx`. Confirm it resolves and print the command list:

```sh
vifx --help
```

Every command also accepts `--help` (or `-h`) for its full flag surface:

```sh
vifx expo dev --help
```

The commands below use `pnpm vifx`, matching the workspace scripts. Drop the `pnpm` prefix to invoke the global CLI directly.

## Initialize on an existing project

Vifx reads an optional `vifx.config.ts` and an optional user `vite.config.vifx.ts`. You generate both with onboarding commands instead of writing them by hand.

### Expo projects

For an existing Expo app, run `vifx setup`. It writes a Vifx-owned `vifx.config.ts` without touching your Expo-owned files — it never edits `app.json`, `metro.config.js`, your Expo/EAS scripts, or app source. Setup is additive: your existing tooling stays in place.

```sh
pnpm vifx setup . --yes --expo-go
```

| Flag                 | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `--yes`              | Apply the planned changes (required in a non-interactive shell).            |
| `--dry-run`          | Preview the planned files without writing.                                  |
| `--expo-go`          | Generate native Expo Go targets (iOS + Android) for the Expo Go dev server. |
| `--with-vite-config` | Also create `vite.config.vifx.ts` for advanced Vite/Rollup plugins.         |
| `--force`            | Replace existing Vifx-owned files.                                          |
| `--json`             | Machine-readable output (previews unless combined with `--yes`).            |

Pass `--yes` or `--dry-run`, not both. `vifx setup` also reads any `metro.config.js` and prints a migration section that maps Metro settings to `vifx.config.ts` keys. See [Migration](/guide/migration) for the full mapping.

### Bare React Native projects

For a bare React Native app, generate a `vifx.config.ts` with `vifx init`:

```sh
pnpm vifx init . --write
```

To author the build pipeline directly — so any Vite or Rollup plugin (svgr, unplugin-icons, mdx, virtual modules) runs against your React Native app — add a user Vite config:

```sh
pnpm vifx vite init . --write
```

This writes `vite.config.vifx.ts`, which Vifx auto-detects and merges. A minimal example that adds SVG support to a native bundle:

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [svgr()],
});
```

Vifx's own plugins run physically first, so user plugins never shadow `.ios`/`.native` resolution, and Vifx re-imposes the `resolve.*` and `define` keys it owns after the merge. See [Config](/reference/config) for the merge contract and the keys Vifx owns.

### Verify the project

`vifx doctor` reports project type, Node and package-manager versions, React Native and Expo versions, the detected config paths, the Vite mode, the Hermes compiler path, and the Expo SDK support tier:

```sh
pnpm vifx doctor .
pnpm vifx doctor . --json
```

`vifx inspect` is a quieter view of the same primitives — configs, platform files, and asset groups.

## Run the dev server

`vifx expo dev --expo-go` starts a Metro-compatible Expo Go server: it serves the manifest, the bundle, source maps, `/symbolicate`, `/status`, assets, and React Native DevTools (Fusebox). It prints a QR code for Expo Go and binds to `0.0.0.0` so a device on your LAN can reach it.

```sh
pnpm vifx expo dev . --expo-go --platform ios
```

Useful flags:

| Flag                      | Default                                           | What it does                                                              |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| `--platform ios\|android` | —                                                 | Restrict the server to one target.                                        |
| `--host <host>`           | `0.0.0.0` with `--expo-go`, otherwise `127.0.0.1` | Hostname to bind.                                                         |
| `--public-host <host>`    | —                                                 | Hostname or LAN IP emitted in Expo Go URLs when it differs from `--host`. |
| `--port <number>`         | `5173`                                            | Port to bind.                                                             |
| `--config <file>`         | —                                                 | Use a specific Vifx config file.                                          |
| `--fast-refresh`          | off                                               | State-preserving Fast Refresh over `/hot` (requires `--expo-go`).         |
| `--json`                  | off                                               | Machine-readable server details, then one NDJSON line per rebuild.        |

With `--expo-go` running in a TTY you get interactive keybindings:

```text
Keys: r reload  m dev menu  j devtools  o editor  ? all
```

`r` reloads the app, `m` opens the dev menu, `j` opens React Native DevTools, `o` opens the project in `$EXPO_EDITOR` or `$EDITOR`, and `?` lists every key.

### Fast Refresh

Add `--fast-refresh` to preserve component state across saves. It serves a Metro-format bundle and streams updates over the `/hot` WebSocket channel, with no Metro runtime dependency in the bundle:

```sh
pnpm vifx expo dev . --expo-go --platform ios --fast-refresh
```

`--fast-refresh` requires `--expo-go` and switches the target to the `metro` module format. Without it, the default hoisted format does a full reload on each save.

## Make an edit and read the instrumentation

Every save during `vifx expo dev --expo-go` prints one line of per-phase, per-cycle instrumentation:

```text
~210ms  transform 120  serialize 35  write 40  apply 15  cache 92% (11/12)
```

- `transform` — the single Vite/Rolldown build (Babel transform + bundling).
- `serialize` — assembling the module registry and source map.
- `write` — writing the bundle, the map, and renaming assets.
- `apply` — applying the Fast Refresh delta and broadcasting it over `/hot`.
- `cache` — this cycle's transform-cache hit-rate as `hits/(hits+misses)`, measured per save rather than cumulatively.

The hit-rate comes from a content-addressed transform cache that keys every entry on a SHA-256 of its inputs and a cache-format/tooling version string, stored under `.vifx/cache/transforms`. Unchanged inputs are guaranteed hits, so warm rebuilds stay fast.

For aggregation, add `--json` to keep stdout as pure NDJSON — line one is a compact server snapshot, then one rebuild report per save:

```sh
pnpm vifx expo dev . --expo-go --fast-refresh --json > rebuilds.ndjson
```

Each rebuild line is a `VifxRebuildReport` with the cycle number, phase timings, this cycle's cache hits and misses, the module count, and the HMR result — parseable line by line for median and p95.

### Web companion preview

`vifx expo dev` without `--expo-go` serves a browser preview through real `react-native-web`. The selected target must set `reactNativeCompat: "web"`:

```sh
pnpm vifx expo dev . --platform ios
```

## Build and export for release

### Embed into a native build

`vifx export:embed` produces the release bundle and production asset layout that Xcode's "Bundle React Native code and images" phase and the Gradle bundle task consume. `--bundle-output` is required; production builds pass `--dev false`, which minifies with the Oxc minifier and scope-hoists the bundle into a single IIFE:

```sh
pnpm vifx export:embed . \
  --platform ios \
  --dev false \
  --bundle-output ios/main.jsbundle \
  --sourcemap-output ios/main.jsbundle.map \
  --assets-dest ios/assets
```

Its flag surface is drop-in compatible with `npx expo export:embed` and `npx react-native bundle`: unknown Metro flags (`--reset-cache`, `--max-workers`, `--transformer`, and more) are warned about and ignored rather than failing. To route prebuilt native projects through it, set the Gradle bundle command:

```groovy
react {
  bundleCommand = "export:embed"
}
```

`EXPO_PUBLIC_*` environment variables are inlined into the bundle as both `import.meta.env.<KEY>` and `process.env.<KEY>`:

```sh
EXPO_PUBLIC_API_URL=https://api.example.com \
  pnpm vifx export:embed . --platform ios --dev false --bundle-output ios/main.jsbundle
```

### Export an Expo artifact directory

`vifx expo export` builds the configured Expo targets and writes bundles, source maps, assets, `manifest.json`, and `metadata.json` to an output directory:

```sh
pnpm vifx expo export . --platform all --out-dir dist/expo
```

`vifx expo audit` reports the no-Metro bundling contract — config, Vite build, Metro parity, dev server, and export artifacts — across iOS and Android:

```sh
pnpm vifx expo audit .
```

### Hermes bytecode

Set `hermes: true` on a target to compile the release `.bundle` to `.hbc`. In production the bundle is already Oxc-minified, so bytecode is generated from the minified script. Vifx detects and orchestrates `hermesc`; it does not vendor Hermes.

## Next steps

- [Config](/reference/config) — the full `vifx.config.ts` shape, the user `vite.config.vifx.ts` merge contract, and the unified define/env table.
- [CLI](/reference/cli) — every command and flag, including the platform value sets per command.
- [Features](/reference/features) — the engine, transform cache, Fast Refresh, instrumentation, and platform resolution in depth.
- [Migration](/guide/migration) — moving an Expo or React Native app off Metro, including `metro.config.js` interop hints.
