import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
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
    fixedExtension: true,
    format: ["esm", "cjs"],
    sourcemap: true,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
