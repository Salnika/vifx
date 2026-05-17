import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@vifx/asset-registry": fileURLToPath(
        new URL("../asset-registry/src/index.ts", import.meta.url),
      ),
      "@vifx/codemods": fileURLToPath(new URL("../codemods/src/index.ts", import.meta.url)),
      "@vifx/compat": fileURLToPath(new URL("../compat/src/index.ts", import.meta.url)),
      "@vifx/compat-runner": fileURLToPath(
        new URL("../compat-runner/src/index.ts", import.meta.url),
      ),
      "@vifx/config": fileURLToPath(new URL("../config/src/index.ts", import.meta.url)),
      "@vifx/errors": fileURLToPath(new URL("../errors/src/index.ts", import.meta.url)),
      "@vifx/hermes-tools": fileURLToPath(new URL("../hermes-tools/src/index.ts", import.meta.url)),
      "@vifx/metro-inspect": fileURLToPath(
        new URL("../metro-inspect/src/index.ts", import.meta.url),
      ),
      "@vifx/native-artifacts": fileURLToPath(
        new URL("../native-artifacts/src/index.ts", import.meta.url),
      ),
      "@vifx/platform-resolver": fileURLToPath(
        new URL("../platform-resolver/src/index.ts", import.meta.url),
      ),
      "@vifx/source-map-tools": fileURLToPath(
        new URL("../source-map-tools/src/index.ts", import.meta.url),
      ),
      "@vifx/types": fileURLToPath(new URL("../types/src/index.ts", import.meta.url)),
      "@vifx/vite-plugin-expo": fileURLToPath(
        new URL("../vite-plugin-expo/src/index.ts", import.meta.url),
      ),
      "@vifx/vite-plugin-react-native": fileURLToPath(
        new URL("../vite-plugin-react-native/src/index.ts", import.meta.url),
      ),
    },
  },
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  pack: {
    dts: true,
    entry: ["src/index.ts", "src/bin.ts"],
    exports: {
      bin: {
        cli: "./src/bin.ts",
        vifx: "./src/bin.ts",
      },
    },
    format: ["esm"],
    sourcemap: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
