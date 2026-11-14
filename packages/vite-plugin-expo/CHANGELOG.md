# @vifx/vite-plugin-expo

## 0.2.0

### Patch Changes

- Updated dependencies [f104cb2]
- Updated dependencies [8b79fef]
  - @vifx/types@0.2.0
  - @vifx/asset-registry@0.2.0
  - @vifx/errors@0.2.0
  - @vifx/platform-resolver@0.2.0
  - @vifx/vite-config-bridge@0.2.0
  - @vifx/vite-plugin-react-native@0.2.0
  - @vifx/source-map-tools@0.2.0

## 0.1.0

### Patch Changes

- 4e715b5: Validate Expo SDK 55 to 58. SDK 58 moves to the validated tier: its default template runs in Expo Go on iOS and Android with Fast Refresh.
  
  - Expo Go for Android now installs Expo modules for a Vifx-served app: the manifest sends an anonymous scope key, as Expo CLI does, instead of `@vifx/<slug>`, which Expo Go treated as unverified.
  - React Native 0.88: assets register through `react-native/asset-registry`, and `hermesc` is found in the `hermes-compiler` package.
  - Projects with routes in `src/app` and an `@/*` path alias (the SDK 58 template) are set up and resolved correctly.
  - The release asset layout follows Metro's: platform variants, `/assets/<directory>` server locations, iOS scales 1x to 3x, Android `raw/keep.xml`, and Expo's asset extensions.
  - Native bundles pass the Hermes engine to Babel, so babel-preset-expo uses the same Hermes profile as under Metro.
  - The app config's `experiments.reactCompiler` turns on the React Compiler, as with Expo CLI (new `reactCompiler` option of the React Native plugin).
  - Packages compiled through Vifx's transform step (expo-router, `@react-navigation/*`, `jsxInPackages`) are back in the bundle source map, mapped to their own sources.
  - `export:embed` honors `--minify` and rebases the source map's `sources` onto `--sourcemap-output`.
  - `vifx expo export` builds production bundles, without the Expo Go compatibility mocks, unless `--dev` is passed.
  - `vifx expo audit` finds Expo Router routes in `src/app`, and the `--fast-refresh` and `--minify` help texts say what the flags do.
- a5f6b2e: Depend on the Vite+ toolchain as `@voidzero-dev/vite-plus-core` instead of a `vite` alias, so installs with npm, Yarn classic, Bun or pnpm's hoisted linker leave `node_modules/vite` to the app and keep a single copy of the toolchain. A `vite.config.vifx.ts` uses the app's own `vite` (install it as a dev dependency); when it is missing, the load error now says so.
- Updated dependencies [4e715b5]
- Updated dependencies [a5f6b2e]
  - @vifx/vite-plugin-react-native@0.1.0
  - @vifx/asset-registry@0.1.0
  - @vifx/types@0.1.0
  - @vifx/vite-config-bridge@0.1.0
  - @vifx/errors@0.1.0
  - @vifx/platform-resolver@0.1.0
  - @vifx/source-map-tools@0.1.0
