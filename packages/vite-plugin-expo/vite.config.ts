import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@vifx/errors": fileURLToPath(new URL("../errors/src/index.ts", import.meta.url)),
      "@vifx/source-map-tools": fileURLToPath(
        new URL("../source-map-tools/src/index.ts", import.meta.url),
      ),
      "@vifx/types": fileURLToPath(new URL("../types/src/index.ts", import.meta.url)),
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
    exports: true,
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
  },
});
