# Vifx

A Vite + Rolldown bundling engine for React Native and Expo, without Metro. One toolchain builds your native iOS and Android bundles, serves an Expo Go-compatible dev server, and produces release artifacts for Xcode and Gradle — and your `vite.config.vifx.ts` makes the entire Vite/Rollup plugin ecosystem available to a React Native app.

```bash
npm install --save-dev @vifx/cli
```

The CLI installs a `vifx` binary. Every command below runs through it.

## Why teams choose Vifx over Metro

- **An open plugin graph.** Vifx loads and merges your project's `vite.config.vifx.ts` through Vite's own config loader, so any standard Vite/Rollup plugin — svgr, unplugin-icons, mdx, virtual modules — runs against your React Native bundle. Vifx's own plugins run physically first, so platform resolution for `.ios`/`.android`/`.native`/`.web` stays correct. Metro's closed `__d`/`__r` registry has no equivalent plugin protocol.
- **Native and web from one engine.** A single Rolldown pipeline and a single define/env table drive both targets. Public env vars (`EXPO_PUBLIC_*`) are inlined as both `import.meta.env.*` and `process.env.*` for native and web alike.
- **Scope-hoisted release bundles.** Production native bundles are a single scope-hoisted IIFE, minified with the Oxc minifier, keeping Rolldown's cross-module tree-shaking. On HNewsPro the release JS is 2.2% smaller than Metro with 15% fewer modules.
- **Fast warm rebuilds.** A content-addressed transform cache keys every entry by SHA-256 of its inputs and a tool-version stamp, so an unchanged file is a guaranteed hit. Warm rebuilds run around 3.2x faster than Metro on the same app.
- **Per-save instrumentation Metro doesn't expose.** `vifx expo dev --expo-go` prints one phase-ventilated line per save — transform, serialize, write, apply — with a per-cycle transform-cache hit rate, and `--json` emits pure NDJSON you can aggregate for median and p95.

See [Vifx vs Metro](apps/docs/reference/comparisons.md) for the benchmark-backed comparison.

## 60-second quickstart

Onboard an existing Expo project. `vifx setup` writes a Vifx-owned `vifx.config.ts` and leaves your Expo-owned files (`app.json`, scripts, source) untouched:

```bash
vifx setup ./my-expo-app --yes
```

Start the Expo Go dev server with state-preserving Fast Refresh, scan the QR code, and edit:

```bash
vifx expo dev ./my-expo-app --expo-go --fast-refresh --platform ios
```

Build the release bundle, source map, and production asset layout for embedding:

```bash
vifx export:embed ./my-expo-app \
  --platform ios \
  --dev false \
  --bundle-output ios.bundle \
  --sourcemap-output ios.map \
  --assets-dest ./assets
```

Check the project at any point:

```bash
vifx doctor ./my-expo-app
```

For a bare React Native project, use `vifx init` to write `vifx.config.ts`, then run the Metro-compatible dev server:

```bash
vifx init ./my-rn-app --write
vifx dev ./my-rn-app --platform ios
```

`vifx dev` serves the Metro dev-server conventions the React Native community CLI expects: `GET /status`, `GET /<entry>.bundle`, the matching source-map route, `POST /symbolicate`, and a `/message` WebSocket. It is the bare React Native path; Expo projects use `vifx expo dev`.

## Headline capabilities

| Capability                                                | Command                                                  |
| --------------------------------------------------------- | -------------------------------------------------------- |
| Onboard an Expo project                                   | `vifx setup`                                             |
| Onboard a bare React Native project                       | `vifx init`, `vifx vite init`                            |
| Expo Go dev server + Fast Refresh                         | `vifx expo dev --expo-go --fast-refresh`                 |
| Web preview (react-native-web)                            | `vifx expo dev` (target sets `reactNativeCompat: "web"`) |
| Bare React Native dev server                              | `vifx dev`                                               |
| Build configured targets                                  | `vifx build`                                             |
| Release bundle + assets for Xcode/Gradle                  | `vifx export:embed`                                      |
| Expo export artifacts (bundles, maps, manifest, metadata) | `vifx expo export`                                       |
| Hermes bytecode                                           | per-target `hermes: true`, or `vifx hermes compile`      |
| Project readiness check                                   | `vifx doctor`                                            |
| Audit the no-Metro bundling contract                      | `vifx expo audit`                                        |

The full surface is in the [CLI reference](apps/docs/reference/cli.md). Each command accepts `--json` for machine-readable output and `--help` for its flags.

## Configuration

Vifx reads an optional `vifx.config.ts` (also `.mts`, `.js`, `.mjs`). With no config file it runs from defaults rooted at the current directory. Author it with the typed `defineVifxConfig` helper:

```ts
import { defineVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  platforms: ["ios", "android"],
  vite: {
    mode: "expo",
    targets: [
      { platform: "ios", entry: "./index.js", hermes: false },
      { platform: "android", entry: "./index.js", hermes: false },
    ],
  },
  expoOptions: { publicEnvPrefix: "EXPO_PUBLIC_" },
});
```

To run any Vite/Rollup plugin against your React Native app, add a `vite.config.vifx.ts` (generate one with `vifx vite init`). Vifx auto-detects it, loads it with Vite's own config loader, and appends your plugins after its own so platform resolution stays intact:

```ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({ plugins: [svgr()] });
```

See the [config reference](apps/docs/reference/config.md) for the complete shape.

## Migrating from Metro

Migration is additive. `vifx setup` writes Vifx-owned config alongside your existing Metro, Expo CLI, EAS, and app scripts without deleting or rewriting them. To repoint native build phases at Vifx, register `@vifx/expo-config-plugin` in `app.json` so `expo prebuild` injects `export:embed` as the Xcode and Gradle bundle command, routing native builds through `vifx export:embed`. Vifx also reads your `metro.config.js` and reports field-by-field migration hints through `vifx doctor` and `vifx setup`.

The [migration guide](apps/docs/guide/migration.md) walks through the full path.

## Scope

Vifx owns the Metro bundling path. Native (iOS and Android) is the primary target; web is a companion preview served by real react-native-web through the Vite dev server. Vifx orchestrates the Hermes compiler rather than vendoring it, and it leaves EAS, native app build-and-run, and the Expo Updates runtime to Expo and EAS. Custom Metro `resolver.resolveRequest` and `serializer` hooks have no Vifx equivalent; `vifx doctor` flags them so you keep Metro for those paths.

## Documentation

Full guides and reference live under [`apps/docs`](apps/docs/index.md): [getting started](apps/docs/guide/getting-started.md), [features](apps/docs/reference/features.md), [CLI](apps/docs/reference/cli.md), [config](apps/docs/reference/config.md), and [Vifx vs Metro](apps/docs/reference/comparisons.md).

## License

MIT
