# Migration

Migrate a Metro/Expo project to vifx without giving up Expo CLI, EAS, or your existing app scripts. Migration is additive: vifx writes its own config alongside your project, moves bundling to the Vite/Rolldown engine, and optionally repoints native build phases at `vifx export:embed`. Nothing in your Expo or Metro setup is deleted or rewritten in place.

For an Expo project, the entry point is [`vifx setup`](#expo-projects). For a bare React Native project, the entry point is [`vifx init`](#bare-react-native-projects). To have a coding agent run these steps on an Expo app, give it the prompt in [Migrate with an AI Agent](/guide/agent-migration).

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

The vifx packages are published to npm under the `@vifx` scope. Add the CLI as a dev dependency:

```sh
npm install --save-dev @vifx/cli
```

`@vifx/cli` provides the `vifx` command and brings the Vite plugins it builds with. Add the other packages when you need them:

- `@vifx/config` provides `defineVifxConfig` for a typed `vifx.config.ts` (`@vifx/cli` re-exports it too).
- `@vifx/expo-config-plugin` routes `expo prebuild` native builds through `vifx export:embed` (see [step 5](#expo-native-builds)).
- A `vite.config.vifx.ts` imports `defineConfig` from `vite`, and possibly helpers from `@vifx/vite-config-bridge` (`vifxResolveRequest`) or `@vifx/vite-plugin-react-native` (`reactNative()`): install the ones it imports.

```sh
npm install --save-dev @vifx/config @vifx/expo-config-plugin
npm install --save-dev vite   # when you add a vite.config.vifx.ts
```

The command blocks below have an npm, pnpm, Yarn and Bun tab; the site remembers the one you pick.

## 2. Generate config

### Expo projects

`vifx setup` onboards an existing Expo project. It writes a Vifx-owned config without touching `app.json`, Expo/EAS scripts, or app source:

```sh
npx vifx setup <expo-project-path> --dry-run   # preview, no writes
npx vifx setup <expo-project-path> --yes        # apply
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
};
```

`vifx setup` also analyzes any `metro.config.js` and prints a "Metro config migration" section (see [step 3](#_3-map-your-metro-config-js)), then lists the next commands to run.

### Bare React Native projects

`vifx setup` does not apply to bare React Native. Use `vifx init` to write a `vifx.config.ts` with `vite.mode: "react-native"`. It wraps the config with `defineVifxConfig`, imported from `@vifx/cli`:

```sh
npx vifx init <rn-project-path>            # preview
npx vifx init <rn-project-path> --write    # apply
```

### Adding a user Vite config

To run any Vite/Rollup plugin (svgr, unplugin-icons, mdx, virtual modules) against your app, generate a `vite.config.vifx.ts`:

```sh
npx vifx vite init <project-path> --write
```

Besides `vite.config.vifx.ts` (and `vifx.config.ts` when it is missing), `vifx vite init` adds `vifx:*` scripts and Vifx dev dependencies to `package.json`; run it without `--write` first to preview the changes.

vifx auto-detects `vite.config.vifx.{ts,mts,js,mjs}` under the project root and merges your allowed slices (`css`, `define`, `esbuild`, `json`, `plugins`, `resolve`, `worker`) on top of its own. The reserved `resolve.conditions`/`resolve.dedupe` and vifx-owned `define` keys stay owned by vifx. See [Config](/reference/config) for the full contract. Opt out entirely with `vite.userConfigFile: false`.

## 3. Map your `metro.config.js`

`vifx doctor` reads your `metro.config.js` and compares it with the config your framework builds on its own (`getDefaultConfig` from `expo/metro-config` or `@react-native/metro-config`), so it reports only what your project changed; `vifx setup` prints the same findings. The settings that have a `vifx.config.ts` equivalent are written for you:

```sh
npx vifx doctor . --fix
```

`--fix` edits `vifx.config.ts` in place, keeping its comments and other keys, and a second `vifx doctor` no longer reports what it wrote. It needs a `vifx.config.ts`, so run `vifx setup` (or `vifx init`) first. `metro.config.js` itself is never changed.

| `metro.config.js` field            | Where it goes in vifx                                            | Written by `--fix` |
| ---------------------------------- | ---------------------------------------------------------------- | ------------------ |
| `resolver.sourceExts` (additions)  | `resolver.extensions` in `vifx.config.ts`                        | yes                |
| `resolver.assetExts` (additions)   | `resolver.assetExtensions` in `vifx.config.ts`                   | yes                |
| `resolver.extraNodeModules`        | the `aliases` of each `vite.targets` entry in `vifx.config.ts`   | yes                |
| `transformer.babelTransformerPath` | Port to a Vite/Rollup plugin in `vite.config.vifx.ts`            | no                 |
| `resolver.resolveRequest`          | `vifxResolveRequest(...)` in `vite.config.vifx.ts` (see below)   | no                 |
| `watchFolders`                     | No mapping needed — vifx resolves workspace packages natively    | —                  |
| `serializer` (custom hooks)        | No vifx equivalent — keep Metro for this path or remove the hook | —                  |

Expo's and React Native's own settings are not reported: Expo's CSS source extensions, its extra asset extensions, its Babel transformer and its serializer. Neither are extensions Vifx already bundles, such as `heic`, `avif`, `xml` or `woff2` assets. Metro-only tuning such as `transformer.inlineRequires` or `resolver.useWatchman` has nothing to map: Vifx bundles are scope-hoisted, and it does not use Watchman.

`resolver.assetExtensions` replaces Vifx's default asset list, so `--fix` writes the defaults followed by your additions:

```ts
// vifx.config.ts
export default {
  // …
  resolver: {
    assetExtensions: ["aac", "aiff", "avif" /* … the other defaults … */, "lottie", "riv"],
  },
};
```

With Sentry's `getSentryExpoConfig` or `withSentryConfig`, `vifx doctor` reports `VIFX_UNSUPPORTED_METRO_SERIALIZER`: their Metro serializer adds a Debug ID to the bundle, and Vifx bundles have none. Upload source maps to Sentry another way, or keep Metro for release builds.

A custom `babelTransformerPath` becomes an ordinary Vite/Rollup plugin. For example, `react-native-svg-transformer` maps to a standard SVG plugin:

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({ plugins: [svgr()] });
```

A custom `serializer` is still a genuine boundary: it is reported with the stable `VIFX_UNSUPPORTED_METRO_SERIALIZER` code, so keep Metro for serializer-specific workflows or drop the hook before migrating. `resolver.resolveRequest`, by contrast, is supported — see below.

`resolver.extensions`, `resolver.assetExtensions` and `resolver.mainFields` are keys of `vifx.config.ts` that every build and dev server uses (see [Config](/reference/config#resolver)). The platform-extension resolution you rely on (`.ios` / `.android` / `.native` / `.web`) is built in — see [Features](/reference/features).

### resolveRequest

A custom `resolver.resolveRequest` — the single biggest Metro drop-in blocker for monorepos, `react-native-svg-transformer`, and conditional aliasing — is supported. Because the hook is a **function**, it cannot ride vifx's serializable config across the `vifx export:embed` / CLI subprocess boundary, so its home is the in-process `vite.config.vifx.ts`, declared with `vifxResolveRequest(...)`:

```ts
// vite.config.vifx.ts
import { defineConfig } from "vite";
import { vifxResolveRequest } from "@vifx/vite-config-bridge";

export default defineConfig({
  plugins: [
    vifxResolveRequest((context, moduleName, platform) => {
      // Conditional swap: reroute "crypto" to "expo-crypto".
      if (moduleName === "crypto") {
        return context.resolveRequest(context, "expo-crypto", platform);
      }
      // Delegate everything else to vifx's default resolver.
      return context.resolveRequest(context, moduleName, platform);
    }),
  ],
});
```

The contract matches Metro's exactly:

- **Signature**: `(context, moduleName, platform) => Resolution`, and the hook may be `async`.
- **Delegation**: `context.resolveRequest(context, moduleName, platform)` runs vifx's own resolver (backed by `@vifx/platform-resolver`), so the dominant Metro pattern — delegate to the default with modified arguments — works unchanged. `context` also carries `originModulePath`, `projectRoot`, `sourceExts`, and `assetExts`.
- **Return**: a tagged union — `{ type: "sourceFile", filePath }`, `{ type: "assetFiles", filePaths }`, or `{ type: "empty" }`. vifx routes each variant into its own asset / transform post-processing, so a `sourceFile` resolving to a `.png` still becomes an `AssetRegistry` id, a `.tsx` still gets transformed, and `{ type: "empty" }` stubs the import out (Metro's empty module).

The hook runs **above** vifx's alias/compat pre-filter, matching Metro's surface (it sees the raw specifier). If it throws, vifx falls through to its own default resolution for that request — it does not hard-fail the build, mirroring Metro. When no `resolveRequest` is declared, resolution is byte-identical to the historic path.

An `svg-transformer`-style resolver that inspects the resolved file then delegates works the same way:

```ts
vifxResolveRequest(async (context, moduleName, platform) => {
  const resolution = await context.resolveRequest(context, moduleName, platform);
  // branch on resolution.filePath, e.g. route *.svg to a transform
  return resolution;
});
```

A migration hint (`vifx doctor` / `vifx setup`) points you here when it detects a `resolveRequest` in your `metro.config.js`.

> Note: an explicit `userResolveRequest` option on `reactNative()` / `expo()` takes precedence over the `vite.config.vifx.ts` hook, for programmatic callers.

## 4. Build and preview

Once config is in place, produce bundles with the Vite/Rolldown engine instead of Metro:

```sh
npx vifx build <expo-project-path>
npx vifx build <expo-project-path> --platform ios --json
```

Serve a Metro-compatible Expo Go dev server (manifest, bundle, source map, `/symbolicate`, `/status`, React Native DevTools), with a QR code for the Expo Go app. Fast Refresh is on by default:

```sh
npx vifx expo dev <expo-project-path> --platform ios --expo-go
```

Each save is compiled into a patch by Rolldown's dev engine and applied in the running app with Metro's Fast Refresh rules. [Dev Server and Fast Refresh](/guide/dev-server) describes the terminal output, compile errors, app logs and the settings that change this behavior. You do not need `--fast-refresh` for Fast Refresh: that flag selects the older, experimental Metro module-registry format instead of the dev engine.

Use `--public-host` when a physical device must fetch a LAN address that differs from the bind host:

```sh
npx vifx expo dev <expo-project-path> --platform ios --expo-go \
  --host 0.0.0.0 --public-host <lan-ip>
```

For a web preview (a target with `reactNativeCompat: "web"`), drop `--expo-go`:

```sh
npx vifx expo dev <expo-project-path>
```

## 5. Wire native builds to `vifx export:embed`

`vifx export:embed` is the drop-in replacement for `expo export:embed` that Xcode's "Bundle React Native code and images" phase and the Gradle bundle task invoke. Its flag surface is compatible with `npx expo export:embed` and `npx react-native bundle` — unknown Metro flags are warned about and ignored rather than failing the build:

```sh
npx vifx export:embed <path> --platform ios --dev false \
  --bundle-output ios.bundle --sourcemap-output ios.map --assets-dest ./assets
```

`--bundle-output` is the only required flag. `--dev false` requests production semantics, and `--minify` defaults to `!dev`.

### Expo native builds

The recommended way to repoint native builds is `@vifx/expo-config-plugin` (install it with `npm install --save-dev @vifx/expo-config-plugin`). It rewrites the generated native build scripts so they call vifx instead of Metro:

- iOS — exports `CLI_PATH` (by default `$PROJECT_DIR/../node_modules/@vifx/cli/dist/bin.mjs`) and `BUNDLE_COMMAND` at the top of the "Bundle React Native code and images" Xcode shell build phase.
- Android — sets `cliFile` (by default `../../node_modules/@vifx/cli/dist/bin.mjs`) and `bundleCommand` inside the `react {}` block of `android/app/build.gradle`.

The edits are marker-guarded and idempotent, so they survive repeated `expo prebuild` runs without duplicating content. Register the plugin during setup:

```sh
npx vifx setup <expo-project-path> --yes --experimental-embed
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

If you wire the Gradle task directly instead of through the plugin, point the bundle command at the vifx CLI. The published `@vifx/cli` package runs from `dist/bin.mjs`:

```groovy
react {
    cliFile = file("../../node_modules/@vifx/cli/dist/bin.mjs")
    bundleCommand = "export:embed"
}
```

### Expo export artifacts

To produce an Expo artifact directory (bundles, source maps, assets, `manifest.json`, `metadata.json`):

```sh
npx vifx expo export <expo-project-path> --out-dir dist/expo
```

## 6. Verify

Confirm the migration with `vifx doctor` and `vifx expo audit`.

`vifx doctor` reports project type, Node and package-manager versions, React Native / Expo versions, detected `metro` / `vite` / `vifx` config paths, the Vite plugin mode, the Hermes compiler path, the Expo SDK support tier, and — when a `metro.config.js` is present — the Metro→Vifx migration section:

```sh
npx vifx doctor <project-path>
npx vifx doctor <project-path> --json
```

`vifx expo audit` evaluates the no-Metro bundling contract across config, Vite build, Metro parity, dev server, and export artifacts:

```sh
npx vifx expo audit <expo-project-path>
npx vifx expo audit <expo-project-path> --json
npx vifx expo audit <expo-project-path> --export-root dist/expo
```

The Expo SDK support table covers majors 54 to 58. SDK 54 and 58 are the validated tier (58 with the default template only); 55 to 57 are an experimental tier (fixtures, audits, doctor detection and release bundles compared with Metro's, not run on a device). Outside that table, `vifx doctor` reports `VIFX_PROJECT_UNSUPPORTED_EXPO_VERSION`. See [Project Status](/guide/status) for what has been validated.

## Scope

Migration moves the bundling path. vifx does not replace EAS, native app build-and-run, the Expo Updates runtime, or Updates serving and signing — those remain Expo/EAS responsibilities. `vifx expo export` produces bundle artifacts, not an Expo Updates runtime payload. Native is the primary target; web is a companion preview target enabled per-target with `reactNativeCompat: "web"`. See [Comparisons](/reference/comparisons) for how vifx and Metro line up feature by feature.

## Related

- [Getting Started](/guide/getting-started)
- [Dev Server and Fast Refresh](/guide/dev-server)
- [Config](/reference/config)
- [CLI Reference](/reference/cli)
- [Features](/reference/features)
- [Comparisons](/reference/comparisons)
