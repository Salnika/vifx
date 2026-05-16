# Config

The config surface is intentionally conservative in this first pass. It now carries the explicit Vite mode and target contract used by the CLI templates and bounded plugin workflows.

## Supported Entry Files

```text
vifx.config.ts
vifx.config.mts
vifx.config.js
vifx.config.mjs
```

## Example `vifx.config.ts`

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
        reactNativeCompat: "web",
      },
      {
        platform: "android",
        entry: "./index.js",
        hermes: false,
        outDir: "dist/vite/android",
        reactNativeCompat: "web",
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

## Config Intent

- Use `defineVifxConfig` from `@vifx/config` as the shared entrypoint.
- Keep defaults conservative while primitives, CLI workflows, and plugin boundaries stabilize.
- Prefer explicit `vite.mode`, `vite.targets`, resolver settings, and `expoOptions` over inferred behavior.

## Vite Target Notes

- `vite.targets[]` drives `vifx build` and `vifx run`.
- Set `reactNativeCompat: "web"` when you want browser runtime preview artifacts and local serving through `vifx run`.
- `entry` can be a local file like `./index.js` or a package-style entry such as `expo-router/entry` on the bounded browser-preview path.
- `outDir` stays explicit in docs because the current phase favors inspectable output over hidden conventions.

## Notes

- `vifx init` currently emits a conservative `vifx.config.ts`; it does not automatically enable `reactNativeCompat: "web"` or switch Expo projects to `expo-router/entry`.
- `loadVifxConfig()` imports the target config directly. External projects therefore need Vifx packages installed where the config resolves them.
- Validation is intentionally conservative and does not yet expose a full schema-doc pipeline.
- `@vifx/core` keeps compatibility re-exports, but `@vifx/config` is the source of truth for config definition and loading.
