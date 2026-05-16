# Getting Started

Vifx is a compatibility toolkit and experimental modern bundling layer for React Native and Expo. The project is deliberately docs-first: make the contract explicit, measure behavior, and only then introduce migration or plugin experiments.

## Why Vifx Exists

- Bundling behavior for React Native and Expo is broader than module resolution alone.
- Metro is the current reference behavior, but much of that contract is implicit.
- Trust has to be earned through reports, docs, and conservative workflows before parity is claimed.

## Inspect-First Workflow

1. Run `vifx doctor` to understand project readiness, config presence, and experimental boundaries.
2. Capture reference behavior before introducing a Vifx experiment.
3. Keep warn and todo states visible in reports and docs instead of hiding them.
4. Preserve existing Metro and Expo workflows while experimenting.

## First Commands

```sh
vifx init
vifx doctor
vifx inspect
vifx compat run --adapter vifx
vifx build --platform ios
vifx run --platform ios
```

## Config Contract Draft

The current docs describe the intended config surface, not a promise that every downstream capability is fully production-ready.

```ts
import { defineVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  projectRoot: process.cwd(),
  projectType: "expo",
  platforms: ["ios", "android"],
  expo: true,
  reactNative: true,
  vite: {
    mode: "expo",
    targets: [
      {
        platform: "ios",
        entry: "./index.js",
        hermes: false,
        outDir: "dist/vite/ios",
      },
      {
        platform: "android",
        entry: "./index.js",
        hermes: false,
        outDir: "dist/vite/android",
      },
    ],
  },
  expoOptions: {
    publicEnvPrefix: "EXPO_PUBLIC_",
  },
  resolver: {
    conditions: ["react-native", "import", "require", "default"],
  },
});
```

- Add `reactNativeCompat: "web"` on a target when you want `vifx run` to serve a browser preview.
- If you want the bounded Expo Router preview path, switch a target entry to `expo-router/entry` manually after `vifx init`.

## Report Shape

Compatibility is reported as evidence with context, not as a single green or red bit.

```text
Compatibility report

Adapter: vifx

doctor.projectDetection           PASS   2/2
resolver.platformExtensions       PASS   4/4
assets.scaleGroups                PASS   1/1
bundler.bundleArtifacts           PASS   1/1
bundler.sourceMapValidity         PASS   1/1
monorepo.workspaceResolution      PASS   2/2
```

Warn and todo states remain part of the reporting design as the suite grows. The current shared suite is simply earlier and smaller than the long-term contract.

## Read Next

- [Architecture](/guide/architecture)
- [Workflows](/guide/workflows)
- [Packages](/reference/packages)
