import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    alias: {
      "@vifx/asset-registry": fileURLToPath(
        new URL("../asset-registry/src/index.ts", import.meta.url),
      ),
      "@vifx/config": fileURLToPath(new URL("../config/src/index.ts", import.meta.url)),
      "@vifx/errors": fileURLToPath(new URL("../errors/src/index.ts", import.meta.url)),
      "@vifx/platform-resolver": fileURLToPath(
        new URL("../platform-resolver/src/index.ts", import.meta.url),
      ),
      "@vifx/types": fileURLToPath(new URL("../types/src/index.ts", import.meta.url)),
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
