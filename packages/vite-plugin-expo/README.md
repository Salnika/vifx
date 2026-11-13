# @vifx/vite-plugin-expo

The Expo layer of [Vifx](https://github.com/Salnika/vifx): Expo-aware builds on top of [`@vifx/vite-plugin-react-native`](../vite-plugin-react-native), the Expo Go dev server and Expo export artifacts.

Most projects use it through the `vifx` command (`vifx expo dev`, `vifx export:embed`, `vifx expo export`) from [`@vifx/cli`](../cli). Use this package directly to embed the dev server or the builds in your own tooling.

## What it provides

- `expo(options)`: the Vite plugins for an Expo app (app config, `EXPO_PUBLIC_*` variables, Expo Router entry, assets).
- `startExpoGoDevServer(options)`: the Expo Go dev server. It serves the manifest, bundles, source maps, assets, `/status`, `/symbolicate`, React Native DevTools and the `/message`, `/events` and `/hot` sockets. In development, Fast Refresh runs on Rolldown's incremental dev engine; see [Dev server and Fast Refresh](https://salnika.github.io/vifx/guide/dev-server).
- `buildExpoBundle(options)`: one build of an Expo bundle (development or production), with its source map and assets.
- `startExpoDevServer(options)`: the browser preview server (react-native-web).
- `findExpoAppConfig(projectRoot)`: locates `app.json` or `app.config.*`.

## Example

```ts
import { startExpoGoDevServer } from "@vifx/vite-plugin-expo";

const server = await startExpoGoDevServer({
  entry: "./index.js",
  platform: "ios",
  projectRoot: process.cwd(),
  lazyStart: true,
});

console.log(server.expoGoUrl);
```

## Scope

Vifx replaces the Metro bundling path. Expo Go itself, native builds, EAS and Expo Updates stay with Expo. See the [project status](https://salnika.github.io/vifx/guide/status) for what is validated and what is not.
