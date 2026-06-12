import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@vifx/asset-registry": fileURLToPath(
        new URL("./packages/asset-registry/src/index.ts", import.meta.url),
      ),
      "@vifx/codemods": fileURLToPath(new URL("./packages/codemods/src/index.ts", import.meta.url)),
      "@vifx/compat": fileURLToPath(new URL("./packages/compat/src/index.ts", import.meta.url)),
      "@vifx/compat-runner": fileURLToPath(
        new URL("./packages/compat-runner/src/index.ts", import.meta.url),
      ),
      "@vifx/config": fileURLToPath(new URL("./packages/config/src/index.ts", import.meta.url)),
      "@vifx/errors": fileURLToPath(new URL("./packages/errors/src/index.ts", import.meta.url)),
      "@vifx/expo-config-plugin": fileURLToPath(
        new URL("./packages/expo-config-plugin/src/index.ts", import.meta.url),
      ),
      "@vifx/expo-export": fileURLToPath(
        new URL("./packages/expo-export/src/index.ts", import.meta.url),
      ),
      "@vifx/hermes-tools": fileURLToPath(
        new URL("./packages/hermes-tools/src/index.ts", import.meta.url),
      ),
      "@vifx/metro-inspect": fileURLToPath(
        new URL("./packages/metro-inspect/src/index.ts", import.meta.url),
      ),
      "@vifx/platform-resolver": fileURLToPath(
        new URL("./packages/platform-resolver/src/index.ts", import.meta.url),
      ),
      "@vifx/source-map-tools": fileURLToPath(
        new URL("./packages/source-map-tools/src/index.ts", import.meta.url),
      ),
      "@vifx/types": fileURLToPath(new URL("./packages/types/src/index.ts", import.meta.url)),
      "@vifx/vite-plugin-expo": fileURLToPath(
        new URL("./packages/vite-plugin-expo/src/index.ts", import.meta.url),
      ),
      "@vifx/vite-plugin-react-native": fileURLToPath(
        new URL("./packages/vite-plugin-react-native/src/index.ts", import.meta.url),
      ),
    },
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
  run: {
    cache: true,
  },
});
