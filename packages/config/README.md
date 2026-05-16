# @vifx/config

Strict config definition, discovery, loading, and normalization for Vifx.

The loader supports `vifx.config.ts`, `vifx.config.mts`, `vifx.config.js`, and `vifx.config.mjs` on Node 22.12+ without extra runtime dependencies.

## Highlights

- `defineVifxConfig` helper with full TypeScript inference
- Strict validation with readable structured errors
- Normalized defaults for platforms, resolver settings, and logging

## Example

```ts
import { defineVifxConfig, loadVifxConfig } from "@vifx/config";

export default defineVifxConfig({
  platforms: ["ios", "android"],
  expo: true,
  resolver: {
    extensions: ["tsx", "ts", "jsx", "js", "json"],
  },
});

const loaded = await loadVifxConfig({ cwd: process.cwd() });
console.log(loaded.config.platforms);
```
