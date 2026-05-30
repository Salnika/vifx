# @vifx/vite-plugin-expo

Experimental Expo layer on top of `@vifx/vite-plugin-react-native`.

## Highlights

- `expo(options)` layers Expo-specific config detection on top of the RN Vite plugin
- `findExpoAppConfig(projectRoot, explicitPath?)` locates `app.json` or `app.config.*`
- `startExpoDevServer(options)` starts a bounded Vite browser dev server for Expo experiments
- `startExpoGoDevServer(options)` starts the first Vifx-backed native Expo Go protocol server
- `buildExpoBundle(options)` builds Expo bundle artifacts through the Expo-aware Vite plugin
- Injects `EXPO_PUBLIC_*` variables into the Vite build
- Provides a minimal safe shim for `expo` and `registerRootComponent`
- Can mount the registered root into the Vifx browser runtime
- Can participate in bounded `expo-router/entry` experiments

## Example

```ts
import { defineConfig } from "vite";
import {
  expo,
  findExpoAppConfig,
  startExpoDevServer,
  startExpoGoDevServer,
} from "@vifx/vite-plugin-expo";

export default defineConfig({
  plugins: [expo({ platform: "ios", entry: "./index.js" })],
});

const appConfigPath = await findExpoAppConfig(process.cwd());
console.log(appConfigPath);

const server = await startExpoDevServer({
  platform: "ios",
  projectRoot: process.cwd(),
});
console.log(server.url);

const expoGoServer = await startExpoGoDevServer({
  entry: "./index.js",
  platform: "ios",
  projectRoot: process.cwd(),
});
console.log(expoGoServer.manifestUrl);
```

## Boundaries

- `startExpoDevServer` remains browser-only and uses Vite HMR.
- `startExpoGoDevServer` is an early native protocol server. It serves manifest, bundle, config asset, source-map, status, source-map-backed symbolication, and `/message` plus `/events` WebSocket endpoints for device commands such as reload, but it is not full `expo start` parity yet.
- React Native Fast Refresh parity, hosted Updates signing, native app binary replacement, and EAS integration remain out of scope.
- HNewsPro/real-device acceptance is still required before calling the Expo Go replacement complete.
- This package stays experimental and bounded to fixture-backed proof.
