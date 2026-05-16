# @vifx/vite-plugin-react-native

Experimental React Native Vite plugin for controlled bundle builds on top of Vifx primitives.

## Highlights

- `reactNative(options)` Vite plugin for bounded React Native bundle experiments
- `buildReactNativeBundle(options)` helper that returns bundle, source-map, asset, and runtime artifacts
- Uses `@vifx/platform-resolver`, `@vifx/asset-registry`, and `@vifx/source-map-tools`
- Can optionally compile Hermes bytecode after the bundle is produced
- Emits a simple browser runtime when `reactNativeCompat: "web"` is enabled
- Can generate a bounded `expo-router/entry` preview context on that browser runtime path

## Example

```ts
import { defineConfig } from "vite";
import { buildReactNativeBundle, reactNative } from "@vifx/vite-plugin-react-native";

export default defineConfig({
  plugins: [
    reactNative({
      platform: "ios",
      entry: "./index.js",
      hermes: false,
    }),
  ],
});

const artifacts = await buildReactNativeBundle({
  platform: "ios",
  entry: "./index.js",
});

console.log(artifacts.runtime?.htmlPath ?? artifacts.bundle.path);
```

## Boundaries

- Controlled build plus browser runtime preview only. No Fast Refresh, HMR, Expo Go, or device runtime parity.
- `fixtures/rn-bare-basic` is the current smoke target for this package.
- Full Expo Router parity, Updates output, and production replacement claims stay out of scope.
- Only a bounded `expo-router/entry` browser preview is supported today.
