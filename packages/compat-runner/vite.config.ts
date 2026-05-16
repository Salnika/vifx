import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@vifx/compat": fileURLToPath(new URL("../compat/src/index.ts", import.meta.url)),
      "@vifx/metro-inspect": fileURLToPath(
        new URL("../metro-inspect/src/index.ts", import.meta.url),
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
    exports: true,
    format: ["esm"],
    sourcemap: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
