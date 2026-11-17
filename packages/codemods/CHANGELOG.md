# @vifx/codemods

## 0.2.2

### Patch Changes

- b6ba34c: `vifx setup` reads `tsconfig.json` the way TypeScript does, with comments and trailing commas. Before, a trailing comma made the file unreadable and its `paths` were ignored without a word, so no aliases were written. Like Expo CLI, setup skips a `paths` target that is a declaration file (`.d.ts`): it only exists for type checking, and as an alias it would replace a module with its types.
- @vifx/compat-runner@0.2.2
  - @vifx/errors@0.2.2

## 0.2.1

### Patch Changes

- @vifx/compat-runner@0.2.1
  - @vifx/errors@0.2.1

## 0.2.0

### Patch Changes

- 8b79fef: `resolver.conditions` from `vifx.config.ts` now reaches every build and dev server: extra package `exports` conditions, tried after `react-native` and the platform and before `import` and `default`. The conditions the bundler sets itself (`react-native`, `ios`, `android`, `browser`, `web`, `import`, `default`), and `require`, which it never sets, are dropped from the list. The `["react-native", "import", "require", "default"]` that `vifx setup` and `vifx init` used to write therefore changes nothing, and they no longer write it. An empty `conditions` list is now accepted.
- @vifx/compat-runner@0.2.0
  - @vifx/errors@0.2.0

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
- Updated dependencies [4e715b5]
  - @vifx/compat-runner@0.1.0
  - @vifx/errors@0.1.0
