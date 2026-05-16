# @vifx/config

Strict config definition, discovery, loading, and normalization for Vifx.

This package is the source of truth for `defineVifxConfig()` and `loadVifxConfig()`. The loader supports `vifx.config.ts`, `vifx.config.mts`, `vifx.config.js`, and `vifx.config.mjs` on Node 22.12+ without extra runtime dependencies.

## Highlights

- `defineVifxConfig` helper with full TypeScript inference
- Strict validation with readable structured errors
- Normalized defaults for platforms, resolver settings, logging, Vite targets, and Expo public env handling

## Example

```ts
import { defineVifxConfig, loadVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  projectType: "expo",
  platforms: ["ios", "android"],
  expo: true,
  vite: {
    mode: "expo",
    targets: [{ platform: "ios", entry: "./index.js", hermes: false, reactNativeCompat: "web" }],
  },
  expoOptions: {
    publicEnvPrefix: "EXPO_PUBLIC_",
  },
  resolver: {
    extensions: ["tsx", "ts", "jsx", "js", "json"],
  },
});

const loaded = await loadVifxConfig({ cwd: process.cwd() });
console.log(loaded.config.vite.mode);
```

## Notes

- `loadVifxConfig()` imports the target config directly. External projects need the referenced Vifx packages installed where the config resolves them.
- `vifx init` still emits a conservative template and does not enable `reactNativeCompat: "web"` by default.
