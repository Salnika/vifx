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
```

## Config Contract Draft

The current docs describe the intended config surface, not a promise that every downstream capability is fully production-ready.

```ts
import { defineVifxConfig } from "@vifx/core";

export default defineVifxConfig({
  projectRoot: process.cwd(),
  targets: [
    {
      platform: "ios",
      entry: "./index.js",
      hermes: true,
    },
    {
      platform: "android",
      entry: "./index.js",
      hermes: true,
    },
  ],
  expo: {
    enabled: true,
    router: false,
    updates: {
      inspectOnly: true,
    },
  },
  resolver: {
    conditions: ["react-native", "import", "require", "default"],
  },
  assets: {
    extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "ttf", "otf"],
  },
  experimental: {
    vite: true,
  },
});
```

## Report Shape

Compatibility is reported as evidence with context, not as a single green or red bit.

```text
Compatibility report

Adapter: vifx
Platform: ios

resolver.platformExtensions       PASS  12/12
assets.scaleGroups                PASS   8/8
sourcemaps.validity               WARN   2/3
expo.exportShape                  TODO   0/5
```

## Read Next

- [Architecture](/guide/architecture)
- [Workflows](/guide/workflows)
- [Packages](/reference/packages)
