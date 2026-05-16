import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@vifx/types": fileURLToPath(new URL("../types/src/index.ts", import.meta.url)),
    },
  },
  pack: {
    tsconfig: "./tsconfig.build.json",
    dts: true,
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
