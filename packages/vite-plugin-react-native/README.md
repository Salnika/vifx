# @vifx/vite-plugin-react-native

The React Native core of [Vifx](https://github.com/Salnika/vifx): a Vite plugin that bundles a React Native app with Rolldown instead of Metro.

Most projects use it through the `vifx` command from [`@vifx/cli`](../cli), or through [`@vifx/vite-plugin-expo`](../vite-plugin-expo) for Expo apps.

## What it does

- Resolves modules the way React Native does: `.ios` / `.android` / `.native` / `.web` files, `react-native` and `exports` conditions, workspaces and isolated installs.
- Transforms with the project's own Babel where a library needs it (worklets, React Compiler, `babel.config.js` plugins), on worker threads under load, and with Oxc everywhere else, behind a persistent transform cache.
- Turns `require("./image.png")` into React Native asset registrations and emits every scale variant.
- Emits the development bundle (with Vifx's Fast Refresh runtime) or a scope-hoisted, Oxc-minified production IIFE, and can compile it to Hermes bytecode with the project's `hermesc`.
- Serves a react-native-web preview when a target sets `reactNativeCompat: "web"`.

## Example

```ts
import { buildReactNativeBundle } from "@vifx/vite-plugin-react-native";

const artifacts = await buildReactNativeBundle({
  entry: "./index.js",
  mode: "production",
  platform: "ios",
});

console.log(artifacts.bundle.path);
```

See the [documentation](https://salnika.github.io/vifx/) for the configuration and the CLI.
