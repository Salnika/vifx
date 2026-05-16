import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@vifx/compat-runner": fileURLToPath(
        new URL("../compat-runner/src/index.ts", import.meta.url),
      ),
      "@vifx/errors": fileURLToPath(new URL("../errors/src/index.ts", import.meta.url)),
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
