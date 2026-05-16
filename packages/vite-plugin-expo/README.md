# @vifx/vite-plugin-expo

Experimental Expo layer on top of `@vifx/vite-plugin-react-native`.

## Highlights

- `expo(options)` layers Expo-specific config detection on top of the RN Vite plugin
- `findExpoAppConfig(projectRoot, explicitPath?)` locates `app.json` or `app.config.*`
- Injects `EXPO_PUBLIC_*` variables into the Vite build
- Provides a minimal safe shim for `expo` and `registerRootComponent`
- Can mount the registered root into the Vifx browser runtime
- Can participate in bounded `expo-router/entry` browser previews on the web runtime path

## Example

```ts
import { defineConfig } from "vite";
import { expo, findExpoAppConfig } from "@vifx/vite-plugin-expo";

export default defineConfig({
  plugins: [expo({ platform: "ios", entry: "./index.js" })],
});

const appConfigPath = await findExpoAppConfig(process.cwd());
console.log(appConfigPath);
```

## Boundaries

- Does not replace `expo start`, `expo export`, or Expo Go.
- Full Expo Router parity, Updates generation, and EAS integration remain out of scope.
- Only a bounded browser preview path exists for `expo-router/entry`.
- This package stays experimental and bounded to fixture-backed proof.
