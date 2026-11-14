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
      "@vifx/expo-export": fileURLToPath(new URL("../expo-export/src/index.ts", import.meta.url)),
      "@vifx/hermes-tools": fileURLToPath(new URL("../hermes-tools/src/index.ts", import.meta.url)),
      "@vifx/metro-inspect": fileURLToPath(
        new URL("../metro-inspect/src/index.ts", import.meta.url),
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
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: true,
    entry: ["src/index.ts", "src/bin.ts"],
    exports: {
      bin: {
        vifx: "./src/bin.ts",
      },
    },
    format: ["esm"],
    sourcemap: true,
  },
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    include: ["tests/**/*.test.ts"],
    // Command output is colored on a color terminal. Tests compare plain text,
    // whatever the terminal or CI they run in.
    env: { FORCE_COLOR: "0" },
  },
});
