# Migration

Migrate a Metro/Expo project to vifx without giving up Expo CLI, EAS, or your existing app scripts. Migration is additive: vifx writes its own config alongside your project, moves bundling to the Vite/Rolldown engine, and optionally repoints native build phases at `vifx export:embed`. Nothing in your Expo or Metro setup is deleted or rewritten in place.

For an Expo project, the entry point is [`vifx setup`](#expo-projects). For a bare React Native project, the entry point is [`vifx init`](#bare-react-native-projects).

## What carries over vs. what changes

| Area                                 | Carries over unchanged                           | Changes                                                                               |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `metro.config.js`                    | Stays on disk; vifx reads it for migration hints | You mirror relevant settings into `vifx.config.ts` / `vite.config.vifx.ts`            |
| Expo CLI, EAS, app scripts           | Preserved as-is                                  | None                                                                                  |
| `app.json` / `app.config.js`         | Untouched by `vifx setup`                        | Edited only when you opt in with `--experimental-embed`                               |
| `package.json` scripts               | Preserved                                        | `vifx setup` adds Vifx-owned config; it does not rewrite your scripts                 |
| App source                           | Untouched                                        | None                                                                                  |
| Bundling                             | —                                                | Moves from Metro to the vifx Vite/Rolldown engine                                     |
| Native build phases (Xcode / Gradle) | Default to Metro's `expo export:embed`           | With [`@vifx/expo-config-plugin`](#expo-native-builds), they call `vifx export:embed` |
| Dev server                           | Metro stays available                            | `vifx expo dev --expo-go` serves a Metro-compatible Expo Go server                    |

## 1. Install

vifx ships as a global CLI plus a set of `@vifx/*` packages. Add the packages your project type needs:

```sh
# Expo project
pnpm add -D @vifx/cli @vifx/vite-plugin-expo

# Bare React Native project
pnpm add -D @vifx/cli @vifx/vite-plugin-react-native
```

A user-extensible Vite config (`vite.config.vifx.ts`) also depends on `vite`:

```sh
pnpm add -D vite
```

## 2. Generate config

### Expo projects

`vifx setup` onboards an existing Expo project. It writes a Vifx-owned config without touching `app.json`, Expo/EAS scripts, or app source:

```sh
pnpm vifx setup <expo-project-path> --dry-run   # preview, no writes
pnpm vifx setup <expo-project-path> --yes        # apply
```

`vifx setup` is Expo-only and reports `VIFX_SETUP_EXPO_ONLY` on a non-Expo project. Useful flags:

| Flag                   | Effect                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `--yes`                | Apply without interactive confirmation (required in non-TTY sessions)                             |
| `--dry-run`            | Preview the planned files, write nothing                                                          |
| `--json`               | Machine-readable output (previews unless combined with `--yes`)                                   |
| `--force`              | Replace existing Vifx-owned files                                                                 |
| `--expo-go`            | Generate native Expo Go targets instead of browser-preview targets                                |
| `--with-vite-config`   | Also create `vite.config.vifx.ts`                                                                 |
| `--experimental-embed` | Register `@vifx/expo-config-plugin` in `app.json` (see [Expo native builds](#expo-native-builds)) |

Setup auto-detects your project shape. When `expo-router` is a dependency and an `app/` directory exists, it sets the target entry to `expo-router/entry` and marks targets `reactNativeCompat: "web"`; otherwise the entry is `./index.js`. It also reads `tsconfig.json` `compilerOptions.paths` and converts them into per-target `aliases`. The generated `vifx.config.ts` looks like:

```ts
// vifx.config.ts
export default {
  projectRoot: process.cwd(),
  projectType: "expo",
  expo: true,
  reactNative: true,
  vite: {
    mode: "expo",
    targets: [
      { platform: "ios", entry: "./index.js", hermes: false, outDir: "dist/vite/ios" },
      { platform: "android", entry: "./index.js", hermes: false, outDir: "dist/vite/android" },
    ],
  },
  expoOptions: {
    publicEnvPrefix: "EXPO_PUBLIC_",
  },
  resolver: {
    conditions: ["react-native", "import", "require", "default"],
  },
};
```

`vifx setup` also analyzes any `metro.config.js` and prints a "Metro config migration" section (see [step 3](#_3-map-your-metro-config-js)), then lists the next commands to run.

### Bare React Native projects

`vifx setup` does not apply to bare React Native. Use `vifx init` to write a `vifx.config.ts` with `vite.mode: "react-native"`. It wraps the config with `defineVifxConfig` from `@vifx/config`:

```sh
pnpm vifx init <rn-project-path>            # preview
pnpm vifx init <rn-project-path> --write    # apply
```

### Adding a user Vite config

To run any Vite/Rollup plugin (svgr, unplugin-icons, mdx, virtual modules) against your app, generate a `vite.config.vifx.ts`:

```sh
pnpm vifx vite init <project-path> --write
```

vifx auto-detects `vite.config.vifx.{ts,mts,js,mjs}` under the project root and merges your allowed slices (`css`, `define`, `esbuild`, `json`, `plugins`, `resolve`, `worker`) on top of its own. The reserved `resolve.conditions`/`resolve.dedupe` and vifx-owned `define` keys stay owned by vifx. See [Config](/reference/config) for the full contract. Opt out entirely with `vite.userConfigFile: false`.

## 3. Map your `metro.config.js`

vifx never rewrites `metro.config.js` automatically. It analyzes the file and prints severity-bucketed hints — surfaced by both `vifx doctor` and `vifx setup` — that you apply by hand. The mapping is:

| `metro.config.js` field            | Where it goes in vifx                                            |
| ---------------------------------- | ---------------------------------------------------------------- |
| `resolver.sourceExts` (additions)  | `resolver.extensions` in `vifx.config.ts`                        |
| `resolver.extraNodeModules`        | per-target `aliases` in `vifx.config.ts`                         |
| `resolver.assetExts` (additions)   | `assetExtensions` on the Vite plugin in `vite.config.vifx.ts`    |
| `transformer.babelTransformerPath` | Port to a Vite/Rollup plugin in `vite.config.vifx.ts`            |
| `watchFolders`                     | No mapping needed — vifx resolves workspace packages natively    |
| `resolver.resolveRequest`          | No vifx equivalent — keep Metro for this path or remove the hook |
| `serializer` (custom hooks)        | No vifx equivalent — keep Metro for this path or remove the hook |

A note on asset extensions: the Metro-config hint phrases the target as `assetExtensions`, which is a Vite **plugin** option, not a `vifx.config.ts` key. Set it on the plugin instance in your `vite.config.vifx.ts`:

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import { reactNative } from "@vifx/vite-plugin-react-native";

const platform = process.env.VIFX_PLATFORM === "android" ? "android" : "ios";

export default defineConfig({
  plugins: [
    reactNative({
      entry: "./index.js",
      platform,
      assetExtensions: ["lottie", "riv"],
    }),
  ],
});
```

A custom `babelTransformerPath` becomes an ordinary Vite/Rollup plugin. For example, `react-native-svg-transformer` maps to a standard SVG plugin:

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({ plugins: [svgr()] });
```

`resolver.resolveRequest` and custom `serializer` hooks are reported with stable error codes (`VIFX_UNSUPPORTED_METRO_RESOLVE_REQUEST`, `VIFX_UNSUPPORTED_METRO_SERIALIZER`). These are a genuine boundary: keep Metro for those paths, or drop the custom hook before migrating.

`resolver.mainFields`, `resolver.conditions`, and `resolver.extensions` are first-class top-level keys in `vifx.config.ts`. The platform-extension resolution you rely on (`.ios` / `.android` / `.native` / `.web`) is built in — see [Features](/reference/features).

## 4. Build and preview

Once config is in place, produce bundles with the Vite/Rolldown engine instead of Metro:

```sh
pnpm vifx build <expo-project-path>
pnpm vifx build <expo-project-path> --platform ios --json
```

Serve a Metro-compatible Expo Go dev server (manifest, bundle, source map, `/symbolicate`, `/status`, React Native DevTools/Fusebox), with a QR code for the Expo Go app:

```sh
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go
```

Add `--fast-refresh` for native, state-preserving Fast Refresh over `/hot` (requires `--expo-go`):

```sh
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go --fast-refresh
```

Use `--public-host` when a physical device must fetch a LAN address that differs from the bind host:

```sh
pnpm vifx expo dev <expo-project-path> --platform ios --expo-go \
  --host 0.0.0.0 --public-host <lan-ip>
```

For a web preview (a target with `reactNativeCompat: "web"`), drop `--expo-go`:

```sh
pnpm vifx expo dev <expo-project-path>
```

## 5. Wire native builds to `vifx export:embed`

`vifx export:embed` is the drop-in replacement for `expo export:embed` that Xcode's "Bundle React Native code and images" phase and the Gradle bundle task invoke. Its flag surface is compatible with `npx expo export:embed` and `npx react-native bundle` — unknown Metro flags are warned about and ignored rather than failing the build:

```sh
vifx export:embed <path> --platform ios --dev false \
  --bundle-output ios.bundle --sourcemap-output ios.map --assets-dest ./assets
```

`--bundle-output` is the only required flag. `--dev false` requests production semantics, and `--minify` defaults to `!dev`.

### Expo native builds

The recommended way to repoint native builds is `@vifx/expo-config-plugin`. It rewrites the generated native build scripts so they call vifx instead of Metro:

- iOS — exports `CLI_PATH` and `BUNDLE_COMMAND` at the top of the "Bundle React Native code and images" Xcode shell build phase.
- Android — sets `cliFile` and `bundleCommand` inside the `react {}` block of `android/app/build.gradle`.

The edits are marker-guarded and idempotent, so they survive repeated `expo prebuild` runs without duplicating content. Register the plugin during setup:

```sh
pnpm vifx setup <expo-project-path> --yes --experimental-embed
npx expo prebuild --clean
```

`--experimental-embed` codemods a static `app.json`. For a dynamic `app.config.js`/`.ts`, add the plugin to the `plugins` array yourself:

```js
// app.config.js
export default {
  plugins: ["@vifx/expo-config-plugin"],
};
```

The plugin supports Groovy `android/app/build.gradle` (not Kotlin `.kts`), and on iOS it requires the prebuild-generated "Bundle React Native code and images" build phase to exist.

### Gradle bundle task

If you wire the Gradle task directly instead of through the plugin, point the bundle command at vifx:

```groovy
react {
    cliFile = file("../../node_modules/@vifx/cli/bin/vifx.mjs")
    bundleCommand = "export:embed"
}
```

### Expo export artifacts

To produce an Expo artifact directory (bundles, source maps, assets, `manifest.json`, `metadata.json`):

```sh
pnpm vifx expo export <expo-project-path> --out-dir dist/expo
```

## 6. Verify

Confirm the migration with `vifx doctor` and `vifx expo audit`.

`vifx doctor` reports project type, Node and package-manager versions, React Native / Expo versions, detected `metro` / `vite` / `vifx` config paths, the Vite plugin mode, the Hermes compiler path, the Expo SDK support tier, and — when a `metro.config.js` is present — the Metro→Vifx migration section:

```sh
pnpm vifx doctor <project-path>
pnpm vifx doctor <project-path> --json
```

`vifx expo audit` evaluates the no-Metro bundling contract across config, Vite build, Metro parity, dev server, and export artifacts:

```sh
pnpm vifx expo audit <expo-project-path>
pnpm vifx expo audit <expo-project-path> --json
pnpm vifx expo audit <expo-project-path> --export-root dist/expo
```

The Expo SDK support table covers majors 54, 55, and 56. SDK 54 is the device-validated tier; 55 and 56 are an experimental tier (fixture- and static-analysis-backed, not device-validated). Outside that table, `vifx doctor` reports `VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION`.

## Scope

Migration moves the bundling path. vifx does not replace EAS, native app build-and-run, the Expo Updates runtime, or Updates serving and signing — those remain Expo/EAS responsibilities. `vifx expo export` produces bundle artifacts, not an Expo Updates runtime payload. Native is the primary target; web is a companion preview target enabled per-target with `reactNativeCompat: "web"`. See [Comparisons](/reference/comparisons) for how vifx and Metro line up feature by feature.

## Related

- [Getting Started](/guide/getting-started)
- [Config](/reference/config)
- [CLI Reference](/reference/cli)
- [Features](/reference/features)
- [Comparisons](/reference/comparisons)
