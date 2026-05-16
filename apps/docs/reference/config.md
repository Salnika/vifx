# Config

The config surface is intentionally conservative in this first pass. It exists to make experimental workflows explicit and reviewable.

## Supported Entry Files

```text
vifx.config.ts
vifx.config.mts
vifx.config.js
vifx.config.mjs
```

## Example `vifx.config.ts`

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

## Config Intent

- Use `defineVifxConfig` as the shared entrypoint.
- Keep defaults conservative while primitives and the CLI stabilize.
- Prefer explicit target, resolver, asset, and experimental flags over inferred behavior.

## Notes

- Validation is intentionally conservative and does not yet expose a full schema-doc pipeline.
- This page documents the contract draft used by the current repository state.
