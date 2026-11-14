# @vifx/types

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
